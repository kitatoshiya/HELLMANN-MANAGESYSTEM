import { GoogleGenAI, Type } from '@google/genai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const { pdfBase64, textContent, fileName } = req.body || {};

    if (!pdfBase64 && !textContent) {
      return res.status(400).json({ success: false, error: 'pdfBase64 or textContent is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'Vercelの環境変数に GEMINI_API_KEY が設定されていません。Vercel Project Settings > Environment Variables でキーを設定して再デプロイしてください。',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build-vercel',
        },
      },
    });

    const promptText = `
You are an expert logistics AI document parser for Japanese Export Freight Forwarders.
Analyze the provided Shipping Instruction (輸出指示書 SI) document and extract the required fields accurately into JSON.

Rules:
1. "mawbNumber": Master Air Waybill number (e.g., "999-1234-5678").
2. "hawbNumber": House Air Waybill number. If not present or marked N/A, set to null.
3. "orderNumber": 受注NO. or 特記事項番号.
4. "invoiceNumber": INVOICE NO.
5. "shipper": Shipper (荷主) name and location.
6. "consignee": Consignee (荷受人) name and location.
7. "portOfLoading": 積地 / 出発地 (Port/Airport of Loading/Departure, e.g., "NRT", "成田", "KIX", "関空", "TYO", "TOKYO"). Extract or infer from route or departure field. If unknown, set to null.
8. "destination": 向地(DEST) / 行先 (Port/Airport of Discharge/Destination/Place of Delivery, e.g., "LAX", "ロサンゼルス", "JFK", "FRA", "SIN"). Extract or infer from route or consignee address or destination field. If unknown, set to null.
9. "customsClearanceDate": 通関予定日 / 仕立日 in YYYY-MM-DD format if possible.
10. "flightRoute": Flight number and route (e.g., "NH006 / NRT -> LAX").
11. "pieces": 個数 (No.of Pieces RCP, e.g., "12 PKG" or "12"). If unknown, set to null or empty string.
12. "grossWeight": 重量 (Gross Weight, e.g., "350.5 KGS" or "350.5"). If unknown, set to null or empty string.
13. "specialNotes": 特記事項 / 備考 (Special Instructions, handling notes, or remarks - can be multi-line string). If not present, set to null.
14. "primaryKey": CRITICAL RULE - If hawbNumber exists and is valid, primaryKey MUST be hawbNumber. If hawbNumber is null, primaryKey MUST be mawbNumber.
15. "suggestedTasks": Generate a list of 5-7 standard sequential Japanese export workflow task titles tailored to this specific cargo and route.
`;

    const contents: any[] = [{ text: promptText }];

    if (pdfBase64) {
      const cleanBase64 = String(pdfBase64).replace(/^data:application\/pdf;base64,/, '');
      contents.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: cleanBase64,
        },
      });
    } else if (textContent) {
      contents.push({
        text: `SI Text Content:\n${textContent}`,
      });
    }

    // Use modern supported Gemini models (gemini-1.5-flash is deprecated/not found)
    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
    let lastError: any = null;
    let responseText = '';

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: { parts: contents },
          config: {
            systemInstruction: 'Output strict valid JSON following the schema.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                mawbNumber: { type: Type.STRING },
                hawbNumber: { type: Type.STRING, nullable: true },
                orderNumber: { type: Type.STRING },
                invoiceNumber: { type: Type.STRING },
                shipper: { type: Type.STRING },
                consignee: { type: Type.STRING },
                portOfLoading: { type: Type.STRING, nullable: true },
                destination: { type: Type.STRING, nullable: true },
                customsClearanceDate: { type: Type.STRING },
                flightRoute: { type: Type.STRING },
                pieces: { type: Type.STRING, nullable: true },
                grossWeight: { type: Type.STRING, nullable: true },
                specialNotes: { type: Type.STRING, nullable: true },
                cutTime: { type: Type.STRING, nullable: true, description: 'カット時間 (e.g. 17:00). Null if not present.' },
                primaryKey: { type: Type.STRING },
                suggestedTasks: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                'mawbNumber',
                'orderNumber',
                'invoiceNumber',
                'shipper',
                'consignee',
                'customsClearanceDate',
                'flightRoute',
                'primaryKey',
                'suggestedTasks',
              ],
            },
          },
        });

        responseText = response.text || '{}';
        break;
      } catch (err: any) {
        lastError = err;
        console.warn(`[Vercel parse-pdf] Model ${modelName} failed, fallback next:`, err?.message);
      }
    }

    if (!responseText && lastError) {
      throw lastError;
    }

    let jsonText = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    const parsedData = JSON.parse(jsonText);
    const hawbClean = parsedData.hawbNumber && String(parsedData.hawbNumber).trim() !== '' ? String(parsedData.hawbNumber).trim() : null;
    const primaryKey = hawbClean || parsedData.mawbNumber;

    return res.status(200).json({
      success: true,
      data: {
        ...parsedData,
        hawbNumber: hawbClean,
        primaryKey,
      },
      parsedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error in Vercel /api/parse-pdf handler:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'PDF解析処理中にエラーが発生しました',
    });
  }
}
