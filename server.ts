import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

// Serve public static assets (including pdf.worker.min.mjs and cmaps)
const publicDir = path.join(process.cwd(), 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Body parser middleware (supports large PDF payloads base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize Gemini SDK lazily
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Health check route
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
  });
});

/**
 * Server-side persistent PDF storage for multi-user / multi-terminal access
 */
const PDF_STORE_DIR = path.join(process.cwd(), 'data', 'pdfs');
try {
  if (!fs.existsSync(PDF_STORE_DIR)) {
    fs.mkdirSync(PDF_STORE_DIR, { recursive: true });
  }
} catch (e) {
  // Ignored in read-only serverless environments
}

const pdfServerCache = new Map<string, string>();

app.get('/api/shipment-pdfs/:id', (req, res) => {
  try {
    const rawId = req.params.id;
    if (!rawId) return res.status(400).json({ success: false, error: 'ID required' });

    const safeId = String(rawId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');

    if (pdfServerCache.has(safeId)) {
      return res.json({ success: true, pdfDataUrl: pdfServerCache.get(safeId) });
    }

    const filePath = path.join(PDF_STORE_DIR, `${safeId}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      pdfServerCache.set(safeId, data.pdfDataUrl);
      return res.json({ success: true, pdfDataUrl: data.pdfDataUrl });
    }

    return res.status(404).json({ success: false, error: 'PDF not found on server' });
  } catch (err: any) {
    console.error('Error in GET /api/shipment-pdfs:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/shipment-pdfs', (req, res) => {
  try {
    const { shipmentId, pdfDataUrl, aliases } = req.body;
    if (!shipmentId || !pdfDataUrl) {
      return res.status(400).json({ success: false, error: 'shipmentId and pdfDataUrl required' });
    }

    const idsToSave = [shipmentId, ...(Array.isArray(aliases) ? aliases : [])].filter(Boolean);

    for (const rawId of idsToSave) {
      const safeId = String(rawId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      pdfServerCache.set(safeId, pdfDataUrl);

      const filePath = path.join(PDF_STORE_DIR, `${safeId}.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify({ shipmentId: rawId, pdfDataUrl, updatedAt: new Date().toISOString() }),
        'utf8'
      );
    }

    return res.json({ success: true, savedIds: idsToSave });
  } catch (err: any) {
    console.error('Error in POST /api/shipment-pdfs:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Shared Server-side Billing Pattern Presets Store
 */
const DATA_DIR = path.join(process.cwd(), 'data');
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  // Ignored in read-only serverless environments
}
const PRESETS_FILE = path.join(DATA_DIR, 'billing_presets.json');

const INITIAL_BILLING_PRESETS = [
  {
    id: 'preset_standard_export',
    name: '1. 標準航空輸出通関プラン',
    isDefault: true,
    items: [
      { taxable: true, name: '輸出通関料', amount: 11800 },
      { taxable: true, name: '取扱料 (Handling Fee)', amount: 5000 },
      { taxable: false, name: '上屋使用料 (Terminal)', amount: 3200 },
      { taxable: true, name: 'X線検査費用', amount: 2500 },
      { taxable: false, name: 'トラック集荷料', amount: '' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'preset_customs_only',
    name: '2. 通関申告のみ',
    isDefault: false,
    items: [
      { taxable: true, name: '輸出通関料', amount: 11800 },
      { taxable: true, name: '書類点検作成料', amount: 3000 },
    ],
    createdAt: '2026-01-01T00:01:00.000Z',
  },
  {
    id: 'preset_express_dg',
    name: '3. 危険物・緊急出荷フルセット',
    isDefault: false,
    items: [
      { taxable: true, name: '輸出通関料', amount: 11800 },
      { taxable: true, name: '危険物点検梱包費', amount: 15000 },
      { taxable: true, name: 'X線・爆発物検査費', amount: 3500 },
      { taxable: true, name: 'アタッチ書類作成費', amount: 4000 },
      { taxable: false, name: '時間外緊急対応費', amount: '' },
    ],
    createdAt: '2026-01-01T00:02:00.000Z',
  },
];

let serverMemoryPresets: any[] | null = null;

function readServerPresets() {
  if (serverMemoryPresets && serverMemoryPresets.length > 0) {
    return serverMemoryPresets;
  }
  try {
    if (fs.existsSync(PRESETS_FILE)) {
      const content = fs.readFileSync(PRESETS_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const hasDefault = parsed.some((p: any) => p.isDefault);
        if (!hasDefault && parsed.length > 0) {
          parsed[0].isDefault = true;
        }
        serverMemoryPresets = parsed;
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error reading billing presets file:', e);
  }
  // Initialize file if missing or empty
  try {
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(INITIAL_BILLING_PRESETS, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing initial billing presets:', e);
  }
  serverMemoryPresets = INITIAL_BILLING_PRESETS;
  return INITIAL_BILLING_PRESETS;
}

function writeServerPresets(presets: any[]) {
  serverMemoryPresets = presets;
  try {
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing billing presets:', e);
  }
}

app.get('/api/billing-presets', (req, res) => {
  try {
    const presets = readServerPresets();
    return res.json({ success: true, presets });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/billing-presets', (req, res) => {
  try {
    const { name, items, isDefault } = req.body;
    if (!name || !Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Name and items required' });
    }

    const presets = readServerPresets();
    const id = `preset_${Date.now()}`;
    const shouldBeDefault = Boolean(isDefault);

    const newPreset = {
      id,
      name: String(name).trim().slice(0, 30),
      isDefault: shouldBeDefault,
      items: items.map((it: any) => ({
        taxable: Boolean(it.taxable),
        name: String(it.name || '').slice(0, 20),
        amount: it.amount === '' || it.amount === null ? '' : Number(it.amount),
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let updated = [newPreset, ...presets.filter((p: any) => p.name !== newPreset.name)].slice(0, 10);
    if (shouldBeDefault) {
      updated = updated.map((p: any) => ({
        ...p,
        isDefault: p.id === id,
      }));
    } else if (!updated.some((p: any) => p.isDefault) && updated.length > 0) {
      updated[0].isDefault = true;
    }
    writeServerPresets(updated);

    return res.json({ success: true, presets: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Set default preset pattern
app.post('/api/billing-presets/:id/default', (req, res) => {
  try {
    const presetId = req.params.id;
    const presets = readServerPresets();
    const target = presets.find((p: any) => p.id === presetId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'Preset not found' });
    }

    const updated = presets.map((p: any) => ({
      ...p,
      isDefault: p.id === presetId,
    }));
    writeServerPresets(updated);

    return res.json({ success: true, presets: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/billing-presets/:id', (req, res) => {
  try {
    const presetId = req.params.id;
    if (!presetId) return res.status(400).json({ success: false, error: 'Preset ID required' });

    const presets = readServerPresets();
    let updated = presets.filter((p: any) => p.id !== presetId);
    if (updated.length > 0 && !updated.some((p: any) => p.isDefault)) {
      updated[0].isDefault = true;
    }
    writeServerPresets(updated);

    return res.json({ success: true, presets: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Helper to generate content with exponential backoff retries and model fallback
 * Handles temporary 503 (UNAVAILABLE / high demand / Deadline expired) or 429 quota depletion gracefully.
 */
async function generateContentWithRetryAndFallback(ai: GoogleGenAI, requestParams: any) {
  // Use gemini-3.8-flash as primary, fallback to gemini-3.7-flash and gemini-3.1-flash-lite
  const modelsToTry = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Gemini API] Requesting model ${modelName} (attempt ${attempt}/2)...`);
        const response = await ai.models.generateContent({
          ...requestParams,
          model: modelName,
        });
        return response;
      } catch (err: any) {
        lastError = err;
        const errStr = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));

        const isModelUnavailable =
          errStr.includes('not found') ||
          errStr.includes('NOT_FOUND') ||
          errStr.includes('404') ||
          errStr.includes('no longer available');

        if (isModelUnavailable) {
          console.warn(`[Gemini API] Model ${modelName} is not available, falling back to next model...`);
          break;
        }

        const isTransientOrQuota =
          errStr.includes('503') ||
          errStr.includes('UNAVAILABLE') ||
          errStr.includes('Deadline expired') ||
          errStr.includes('deadline') ||
          errStr.includes('high demand') ||
          errStr.includes('rate limit') ||
          errStr.includes('429') ||
          errStr.includes('RESOURCE_EXHAUSTED') ||
          errStr.includes('quota');

        console.warn(`[Gemini API] Error on model ${modelName} (attempt ${attempt}/2):`, errStr);

        if (isTransientOrQuota && attempt < 2 && !errStr.includes('RESOURCE_EXHAUSTED')) {
          const delayMs = attempt * 600;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          console.warn(`[Gemini API] Failed on model ${modelName}. Moving to next fallback model...`);
          break;
        }
      }
    }
  }

  throw lastError;
}

/**
 * API Endpoint: Parse Shipping Instruction (PDF or Text) via Gemini 3.6 Flash
 */
app.post('/api/parse-pdf', async (req, res) => {
  try {
    const { pdfBase64, textContent, fileName } = req.body;

    if (!pdfBase64 && !textContent) {
      return res.status(400).json({ error: 'pdfBase64 or textContent is required' });
    }

    const ai = getGeminiClient();

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
      // Clean up data URI scheme if present
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
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

    const response = await generateContentWithRetryAndFallback(ai, {
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

    let jsonText = response.text || '{}';
    jsonText = jsonText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    const parsedData = JSON.parse(jsonText);

    // Double-check Primary Key logic (HAWB priority, fallback MAWB)
    const hawbClean = parsedData.hawbNumber && String(parsedData.hawbNumber).trim() !== '' ? String(parsedData.hawbNumber).trim() : null;
    const primaryKey = hawbClean || parsedData.mawbNumber;

    return res.json({
      success: true,
      data: {
        ...parsedData,
        hawbNumber: hawbClean,
        primaryKey,
      },
      parsedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error in /api/parse-pdf:', err);
    let userMsg = err.message || 'Failed to parse Shipping Instruction PDF with Gemini API';
    if (userMsg.includes('GEMINI_API_KEY')) {
      userMsg = 'PUBLISH環境（本番サーバー）に GEMINI_API_KEY 環境変数が設定されていません。画面左上の Settings メニューにて GEMINI_API_KEY を設定してデプロイしてください。';
    }
    return res.status(err.isQuotaError ? 429 : 500).json({
      success: false,
      error: userMsg,
      isQuotaError: !!err.isQuotaError,
    });
  }
});

/**
 * API Endpoint: Analyze X-ray Inspection PDF Page via Gemini Vision AI
 * High-accuracy Image OCR to fully transcribe scanned PDF pages, detect "爆発物検査依頼書" and extract AWB No.
 */
app.post('/api/analyze-xray-pdf', async (req, res) => {
  try {
    const { pdfBase64, imageBase64, textContent, pageNumber, totalPages } = req.body;

    if (!pdfBase64 && !imageBase64 && !textContent) {
      return res.status(400).json({ success: false, error: 'pdfBase64, imageBase64 or textContent is required' });
    }

    const ai = getGeminiClient();
    let mimeType = 'image/jpeg';
    let cleanBase64 = '';

    // Prefer pdfBase64 if available (contains full lossless scan data directly ingestible by Gemini), or fallback to imageBase64
    if (pdfBase64) {
      mimeType = 'application/pdf';
      cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
    } else if (imageBase64) {
      mimeType = 'image/jpeg';
      if (imageBase64.startsWith('data:image/png')) {
        mimeType = 'image/png';
      }
      cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
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
          mimeType: mimeType,
          data: cleanBase64,
        },
      });
    }

    const response = await generateContentWithRetryAndFallback(ai, {
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

    let jsonText = response.text || '{}';
    jsonText = jsonText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    let parsedData: any = {};
    try {
      parsedData = JSON.parse(jsonText);
    } catch {
      // Fallback regex parsing if raw json has minor flaws
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

    return res.json({
      success: true,
      pageNumber,
      data: parsedData,
    });
  } catch (err: any) {
    console.error('Error in /api/analyze-xray-pdf:', err);
    return res.status(err.isQuotaError ? 429 : 500).json({
      success: false,
      error: err.message || 'X線検査PDFの画像解析OCRに失敗しました。',
      isQuotaError: !!err.isQuotaError,
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`輸出進捗管理システム running on http://0.0.0.0:${PORT}`);
  });
}

// Only start standalone server if not imported by Vercel serverless handler
if (!process.env.VERCEL) {
  startServer();
}

export { app };
export default app;
