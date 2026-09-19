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
    const { pdfBase64, imageBase64, textContent, pageNumber, totalPages } = req.body || {};

    if (!pdfBase64 && !imageBase64 && !textContent) {
      return res.status(400).json({ success: false, error: 'pdfBase64, imageBase64 or textContent is required' });
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
          'User-Agent': 'aistudio-build-vercel-xray',
        },
      },
    });

    let mimeType = 'image/jpeg';
    let cleanBase64 = '';

    if (pdfBase64) {
      mimeType = 'application/pdf';
      cleanBase64 = String(pdfBase64).replace(/^data:application\/pdf;base64,/, '');
    } else if (imageBase64) {
      mimeType = 'image/jpeg';
      if (String(imageBase64).startsWith('data:image/png')) {
        mimeType = 'image/png';
      }
      cleanBase64 = String(imageBase64).replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    }

    const promptText = `
あなたは日本の航空貨物輸出検査書類（X線検査結果報告書、爆発物検査依頼書、航空貨物安全確認状、貨物受領書等）を高精度に画像解析・OCRテキスト化する専門AIです。
対象の文書はスキャン画像・FAX画像・デジタル画像から成るPDF（画像情報）です。
添付された画像（ページ ${pageNumber || 1} / ${totalPages || 1}）の全領域（上部タイトル、ヘッダー、表組み、印字テキスト、スタンプ・印影、手書き文字、チェックボックス、注釈、下部フッター）をくまなくスキャンし、高精度なOCRテキスト化を実施して以下のJSON形式で出力してください：

1. "hasExplosiveInspectionRequest": ページ内に「爆発物検査依頼書」という文字・タイトル・項目名が存在するかどうか。論理値 (true または false)。
   ※「爆発物検査依頼書」または「爆発物検査」の表記・依頼書タイトルが見つかる場合は true、それ以外の書類（例: 航空貨物安全確認状、受領書、通常X線検査結果表など）の場合は false。

2. "awbNumber": 書類に記載されている Air Waybill Number (AWB No / MAWB No / HAWB No)。
   ・印字テキスト、スタンプ印影、および手書き数字のいずれも高精度に認識してください。
   ・例: "074-71650644", "074 7165 0644", "123-45678901", "074-7165-0644" など。
   ・抽出の際は "074-71650644" のようにハイフン区切りの形式に正規化して出力してください。見つからない場合は null。

3. "documentTitle": ページの主要なタイトルまたは文書種別（例: "爆発物検査依頼書", "航空貨物安全確認状", "X線検査結果報告書", "貨物受領書" など）。

4. "summaryText": ページの主要記載内容の要約（例: "依頼年月日: 2026年08月13日, 代理店: TOKYO AIRCARGO, 荷主: KB TRANS, 個数: 9個, 重量: 1,012.0 KG, 検査結果: 異常なし" など）。

5. "extractedRawText": 画像から高精度OCRにて読み取れた全ての文字列・項目・値（OCR生テキスト全文）。
   ・表内の全項目名と値、日付、会社名、担当者署名・印影、個数・重量、品名、便名・行先、検査項目・判定結果などを改行区切りで漏れなく正確に文字起こししてください。

6. "detectedDate": 記載されている日付（例: "2026/08/13", "令和8年8月13日" など）。見つからない場合は null。
7. "agentOrShipper": 代理店名・荷主名・依頼者名。見つからない場合は null。
8. "piecesAndWeight": 個数・重量（例: "9 PKG / 1,012.0 KGS"）。見つからない場合は null。
9. "inspectionResultText": 検査結果・判定（例: "異常なし", "X線検査済", "合格" など）。見つからない場合は null。

${textContent ? `【参考テキスト（PDF内部テキストレイヤー）】:\n${textContent}\n` : ''}

厳格なJSONフォーマットで回答してください。
`;

    const parts: any[] = [{ text: promptText }];
    if (cleanBase64) {
      parts.push({
        inlineData: {
          mimeType,
          data: cleanBase64,
        },
      });
    }

    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
    let lastError: any = null;
    let responseText = '';

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: { parts },
          config: {
            systemInstruction: 'You are a professional Japanese OCR and Document Analysis engine. Transcribe every text, number, and table from the image accurately into valid JSON.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                hasExplosiveInspectionRequest: { type: Type.BOOLEAN },
                awbNumber: { type: Type.STRING, nullable: true },
                documentTitle: { type: Type.STRING },
                summaryText: { type: Type.STRING },
                extractedRawText: { type: Type.STRING },
                detectedDate: { type: Type.STRING, nullable: true },
                agentOrShipper: { type: Type.STRING, nullable: true },
                piecesAndWeight: { type: Type.STRING, nullable: true },
                inspectionResultText: { type: Type.STRING, nullable: true },
              },
              required: ['hasExplosiveInspectionRequest', 'documentTitle', 'summaryText', 'extractedRawText'],
            },
          },
        });

        responseText = response.text || '{}';
        break;
      } catch (err: any) {
        lastError = err;
        console.warn(`[Vercel analyze-xray-pdf] Model ${modelName} failed, fallback next:`, err?.message);
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

    let parsedData: any = {};
    try {
      parsedData = JSON.parse(jsonText);
    } catch {
      const hasExplosive = /"hasExplosiveInspectionRequest"\s*:\s*true/i.test(jsonText) || /爆発物検査依頼書/.test(jsonText);
      const awbMatch = jsonText.match(/"awbNumber"\s*:\s*"([^"]+)"/i) || jsonText.match(/(\d{3}[-\s]?\d{8})/);
      const titleMatch = jsonText.match(/"documentTitle"\s*:\s*"([^"]+)"/i);
      const rawTextMatch = jsonText.match(/"extractedRawText"\s*:\s*"([^"]+)"/i);
      parsedData = {
        hasExplosiveInspectionRequest: hasExplosive,
        awbNumber: awbMatch ? awbMatch[1] : null,
        documentTitle: titleMatch ? titleMatch[1] : (hasExplosive ? '爆発物検査依頼書' : '検査書類'),
        summaryText: 'AI 画像OCR解析完了',
        extractedRawText: rawTextMatch ? rawTextMatch[1] : (textContent || 'OCR解析テキスト取得'),
      };
    }

    if (!parsedData.extractedRawText) {
      parsedData.extractedRawText = textContent || `${parsedData.documentTitle}\n${parsedData.summaryText}`;
    }

    return res.status(200).json({
      success: true,
      pageNumber,
      data: parsedData,
    });
  } catch (err: any) {
    console.error('Error in Vercel /api/analyze-xray-pdf handler:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'X線検査PDFの画像解析OCRに失敗しました。',
    });
  }
}
