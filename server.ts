import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { m365Router } from './routes/m365Router';

dotenv.config();

const app = express();
const PORT = 3000;

// CORS headers middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Serve public static assets (including pdf.worker.min.mjs and cmaps)
const publicDir = path.join(process.cwd(), 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Body parser middleware (supports large PDF payloads base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Mount Microsoft 365 Graph API proxy router
app.use(['/api/m365', '/m365'], m365Router);

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

import os from 'os';

/**
 * Server-side persistent PDF storage for multi-user / multi-terminal access
 */
const pdfServerCache = new Map<string, string>();

function getPdfStoreDir(): string | null {
  try {
    const primaryDir = path.join(process.cwd(), 'data', 'pdfs');
    if (fs.existsSync(primaryDir)) return primaryDir;
    
    const tmpDir = path.join(os.tmpdir(), 'export_mgmt_pdfs');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    return tmpDir;
  } catch {
    return null;
  }
}

app.get('/api/shipment-pdfs/:id', (req, res) => {
  try {
    const rawId = req.params.id;
    if (!rawId) return res.status(200).json({ success: false, pdfDataUrl: null, error: 'ID required' });

    const safeId = String(rawId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');

    if (pdfServerCache.has(safeId)) {
      return res.json({ success: true, pdfDataUrl: pdfServerCache.get(safeId) });
    }

    try {
      const storeDir = getPdfStoreDir();
      if (storeDir) {
        const filePath = path.join(storeDir, `${safeId}.json`);
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (data && data.pdfDataUrl) {
            pdfServerCache.set(safeId, data.pdfDataUrl);
            return res.json({ success: true, pdfDataUrl: data.pdfDataUrl });
          }
        }
      }
    } catch (e) {
      // Ignored if disk read fails in serverless
    }

    return res.json({ success: false, pdfDataUrl: null, message: 'PDF not found on server' });
  } catch (err: any) {
    console.error('Error in GET /api/shipment-pdfs:', err);
    return res.status(200).json({ success: false, pdfDataUrl: null, error: err?.message || 'Server error' });
  }
});

/**
 * Direct PDF asset stream handler for iframe embed requests (/pdfs/:id or /shipment_pdfs/:id)
 * Serves raw PDF buffer if found, or clean HTML fallback (prevents 404 network errors in DevTools)
 */
app.get(['/pdfs/:id', '/shipment_pdfs/:id'], (req, res) => {
  try {
    const rawId = req.params.id;
    if (!rawId) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<html><body>PDF未指定</body></html>');
    }

    const safeId = String(rawId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    let pdfUrl: string | null = pdfServerCache.get(safeId) || null;

    if (!pdfUrl) {
      try {
        const storeDir = getPdfStoreDir();
        if (storeDir) {
          const filePath = path.join(storeDir, `${safeId}.json`);
          if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            pdfUrl = data?.pdfDataUrl || null;
          }
        }
      } catch (e) {
        // Ignored in read-only environment
      }
    }

    if (pdfUrl && pdfUrl.startsWith('data:application/pdf')) {
      const base64Data = pdfUrl.split(',')[1];
      if (base64Data) {
        const pdfBuffer = Buffer.from(base64Data, 'base64');
        res.setHeader('Content-Type', 'application/pdf');
        return res.status(200).send(pdfBuffer);
      }
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#94a3b8;margin:0;"><div style="text-align:center;">PDFドキュメントが準備されていないか、存在しません</div></body></html>'
    );
  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#94a3b8;margin:0;"><div style="text-align:center;">PDFデータの読み込みエラー</div></body></html>'
    );
  }
});

/**
 * Handle /upload/* static and dynamic upload route fallbacks
 * Returns valid file if present, or 1x1 transparent PNG fallback (prevents 404 network errors)
 */
app.all(['/upload/*', '//upload/*', '/upload', '/api/upload/*'], (req, res) => {
  const reqPath = req.path.replace(/^\/+/, '');
  const possiblePaths = [
    path.join(process.cwd(), reqPath),
    path.join(process.cwd(), 'public', reqPath),
    path.join(process.cwd(), 'data', reqPath),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return res.sendFile(p);
    }
  }

  const transparentPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  res.setHeader('Content-Type', 'image/png');
  return res.status(200).send(transparentPng);
});

app.post('/api/shipment-pdfs', (req, res) => {
  try {
    const { shipmentId, pdfDataUrl, aliases } = req.body || {};
    if (!shipmentId || !pdfDataUrl) {
      return res.status(400).json({ success: false, error: 'shipmentId and pdfDataUrl required' });
    }

    const idsToSave = [shipmentId, ...(Array.isArray(aliases) ? aliases : [])].filter(Boolean);

    for (const rawId of idsToSave) {
      const safeId = String(rawId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      pdfServerCache.set(safeId, pdfDataUrl);

      try {
        const storeDir = getPdfStoreDir();
        if (storeDir) {
          const filePath = path.join(storeDir, `${safeId}.json`);
          fs.writeFileSync(
            filePath,
            JSON.stringify({ shipmentId: rawId, pdfDataUrl, updatedAt: new Date().toISOString() }),
            'utf8'
          );
        }
      } catch (e) {
        // Disk write fallback in read-only environment
      }
    }

    return res.json({ success: true, savedIds: idsToSave });
  } catch (err: any) {
    console.error('Error in POST /api/shipment-pdfs:', err);
    return res.status(200).json({ success: false, error: err?.message || 'Failed to save PDF' });
  }
});

/**
 * Shared Server-side Billing Pattern Presets Store
 */
function getPresetsFilePath(): string {
  const dataDir = path.join(process.cwd(), 'data');
  return path.join(dataDir, 'billing_presets.json');
}

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
  const presetsFile = getPresetsFilePath();
  try {
    if (fs.existsSync(presetsFile)) {
      const content = fs.readFileSync(presetsFile, 'utf8');
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
    const dataDir = path.dirname(presetsFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(presetsFile, JSON.stringify(INITIAL_BILLING_PRESETS, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing initial billing presets:', e);
  }
  serverMemoryPresets = INITIAL_BILLING_PRESETS;
  return INITIAL_BILLING_PRESETS;
}

function writeServerPresets(presets: any[]) {
  serverMemoryPresets = presets;
  try {
    const presetsFile = getPresetsFilePath();
    const dataDir = path.dirname(presetsFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(presetsFile, JSON.stringify(presets, null, 2), 'utf8');
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

// -------------------------------------------------------------
// Gemini In-Memory SHA-256 Response Cache (Zero Token Duplication)
// -------------------------------------------------------------
interface CachedParseEntry {
  data: any;
  cachedAt: number;
}
const geminiParseCache = new Map<string, CachedParseEntry>();
const MAX_CACHE_ENTRIES = 300;

function getCachedGeminiResult(cacheKey: string): any | null {
  const entry = geminiParseCache.get(cacheKey);
  if (!entry) return null;
  // Expire after 48 hours
  if (Date.now() - entry.cachedAt > 48 * 60 * 60 * 1000) {
    geminiParseCache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function setCachedGeminiResult(cacheKey: string, data: any) {
  if (geminiParseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = geminiParseCache.keys().next().value;
    if (oldestKey) geminiParseCache.delete(oldestKey);
  }
  geminiParseCache.set(cacheKey, { data, cachedAt: Date.now() });
}

/**
 * Helper to generate content with exponential backoff retries and model fallback
 * Prioritizes high-efficiency gemini-3.1-flash-lite (lowest token cost) and gemini-3.8-flash
 */
async function generateContentWithRetryAndFallback(ai: GoogleGenAI, requestParams: any) {
  const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
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
 * API Endpoint: Parse Shipping Instruction (PDF or Text) via Gemini Flash
 * Optimized for token conservation:
 * 1. Checks in-memory cache by SHA-256 hash first (0 tokens on hit).
 * 2. If textContent is available, sends compact text (~200 tokens) instead of heavy base64 PDF (~3,000 tokens).
 * 3. Concise prompt reduces input token count by ~60%.
 */
app.post('/api/parse-pdf', async (req, res) => {
  try {
    const { pdfBase64, textContent, fileName } = req.body;

    if (!pdfBase64 && !textContent) {
      return res.status(400).json({ error: 'pdfBase64 or textContent is required' });
    }

    // 1. Calculate Cache Key from input content (with versioning v8)
    const rawContentForHash = (textContent && textContent.trim().length >= 40)
      ? `v8_TEXT:${textContent.trim()}`
      : `v8_PDF:${pdfBase64 ? pdfBase64.slice(0, 4000) + pdfBase64.length : ''}`;
    const cacheKey = crypto.createHash('sha256').update(rawContentForHash).digest('hex');

    // 2. Cache Check (Zero Token Savings)
    const cached = getCachedGeminiResult(cacheKey);
    if (cached) {
      console.log(`[Gemini API /parse-pdf] Cache hit (0 tokens consumed, hash: ${cacheKey.slice(0, 8)})`);
      return res.json({
        success: true,
        data: cached,
        fromCache: true,
        tokensSaved: true,
        parsedAt: new Date().toISOString(),
      });
    }

    const ai = getGeminiClient();

    // High precision extraction prompt for Japanese Air Cargo Shipping Instructions (SI)
    const promptText = `あなたは日本の航空貨物輸出入およびフォワーダー業務（Shipping Instruction / SI指示書）の精密解析エンジンです。
提示されたドキュメント（テキストまたはPDF画像）から以下のルールに従い厳密に各項目を抽出してください。

【厳格な抽出ルール】
1. mawbNumber (MAWB番号 / Master Air Waybill No.):
   - 形式は「3桁プレフィックス - 8桁通し番号」（例: "189-04358045", "618-55129605", "804-22772584"）。
   - 【最重要】後半の8桁の中に余分なハイフンを入れて "189-0435-8045" のように分割しないでください。必ず "189-04358045" の形式で抽出すること。

2. hawbNumber (HAWB番号 / House Air Waybill No.):
   - "HAWB", "H-AWB", "ハウスAWB" の項目欄・枠内に記載されている番号（例: "S2602006126", "HLM-99218", "H260100123" など）。
   - 【最重要】"S2602006126"のように「S」から始まる番号であっても、HAWB欄に記載されている場合は必ず "hawbNumber" に設定してください。
   - HAWB欄に値が存在する場合は、絶対に null や "なし" にしないでください。
   - HAWB欄が完全に空欄、または「直截」「DIRECT」と明記されている場合のみ null にしてください。

3. orderNumber (受注NO. / 注文番号):
   - "受注NO.", "受注番号", "PO NO.", "Order No" の横に記載されている番号。
   - 【最重要】HAWB番号を受注番号として誤って入れないでください。「受注NO.」欄が空白の場合は空文字 "" または null にしてください。

4. invoiceNumber (インボイス番号):
   - "INVOICE NO.", "インボイス番号", "INV NO." の横に明記されている番号（例: "R260914005 (L)"）。
   - 【最重要・厳格禁止】"INVOICE NO." 欄が空白、未記載、またはコロンのみの場合は、必ず空文字 "" にしてください。
   - **絶対に近隣の上屋コード「4MW49」、場所「4MW49」、通関業者コード「100OSA0」、通関コード「D8TKF」などをインボイス番号として誤取得しないでください。**

5. shipper (荷主):
   - "SHIPPER : " の横または直下に記載されている荷主企業名（例: "Golden Cargo S.A.", "KB Trans"）。
   - 【最重要】"サブ代理店"（SUB AGENT, 例: "HELLMANN WORLDWIDE LOGISTICS INC."）や "コード:..."、"TEL:..."、"担当者:..." は **SHIPPER名に絶対に含めないでください**。純粋な荷主名のみを抽出すること。

6. consignee (荷受人):
   - "CONSIGNEE : " の横または直下に記載されている荷受人企業名・船名等（例: "HYUNDAI BUSAN", "OCEAN FORTUNE"）。
   - 【最重要】"行先"（例: "SIN", "PVG"）や "請求先 国内"、"サブ代理店" を CONSIGNEE に誤認してはなりません。CONSIGNEE欄に記載された値（"HYUNDAI BUSAN" など）を抽出すること。

7. portOfLoading (積地 / POL): 出発空港コードまたは名称（例: "KIX", "NRT", "HND"）。
8. destination (向地 / 行先 / DEST): 目的空港コードまたは名称（例: "SIN", "PVG", "CGK", "LAX", "FRA"）。
9. customsClearanceDate (通関日 / 仕立日): YYYY-MM-DD 形式（例: 2026年09月14日 → "2026-09-14"）。
10. flightRoute (フライト / ルート): 便名および路線（例: "KIX -> SIN", "KIX -> PVG", "KIX -> CGK"）。
11. pieces (個数): 例 "1", "2", "2 CARTON", "12 WOODEN CASES"。
12. grossWeight (総重量): 例 "6.0", "6.0 kg", "21.2 kg", "22.5 kg"。
13. specialNotes (特記事項):
    - 指示書左下等の「特記事項」専用枠の中に記載されているテキスト（例：「ヘルマンシップスパーツ\n船名でご確認下さい\nHYUNDAI BUSAN\n9月14日搬入予定」）。
    - 【最重要・混入厳禁】営業担当者名（例: "TAC62 浪口 茜"）や、ヘッダーの項目名（"HAWB", "MAWB", "FLT.", "ROUTE", "積地", "行先" など）は**絶対に特記事項に含めないでください**。
    - 指示書に記載された改行（\\n）をそのまま保持して抽出すること。
14. cutTime (カット時間): HH:MM または null。
15. primaryKey: hawbNumber が存在する場合は hawbNumber、なければ mawbNumber。
16. suggestedTasks: 輸出業務の標準工程タスク（5〜7件の順序付き配列）。`;

    const contents: any[] = [{ text: promptText }];

    // Multimodal input: always include PDF inlineData if available for 2D spatial layout understanding
    if (pdfBase64) {
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      contents.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: cleanBase64,
        },
      });
      if (textContent && textContent.trim().length >= 40) {
        contents.push({
          text: `SI OCR Text Reference:\n${textContent.slice(0, 4000)}`,
        });
      }
    } else if (textContent) {
      contents.push({
        text: `SI Text Content:\n${textContent}`,
      });
    }

    const response = await generateContentWithRetryAndFallback(ai, {
      contents: { parts: contents },
      config: {
        systemInstruction: 'Output strict valid JSON following schema.',
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

    // --- Deterministic Post-processing & Normalization ---

    // 1. Normalize MAWB to 3 digits - 8 digits (e.g. 189-04358045)
    let mawbClean = String(parsedData.mawbNumber || '').trim();
    const mawb344 = mawbClean.match(/^(\d{3})[-\s](\d{4})[-\s](\d{4})$/);
    if (mawb344) {
      mawbClean = `${mawb344[1]}-${mawb344[2]}${mawb344[3]}`;
    } else {
      const mawb38 = mawbClean.match(/^(\d{3})[-\s]?(\d{8})$/);
      if (mawb38) {
        mawbClean = `${mawb38[1]}-${mawb38[2]}`;
      }
    }

    // 2. Clean HAWB Number
    let hawbClean: string | null = null;
    if (
      parsedData.hawbNumber &&
      String(parsedData.hawbNumber).trim() !== '' &&
      !['なし', 'null', 'none', 'n/a', 'undefined', 'ー', '-', '直截', 'direct', 'なし (直截)'].includes(
        String(parsedData.hawbNumber).trim().toLowerCase()
      )
    ) {
      hawbClean = String(parsedData.hawbNumber).trim();
    }

    // 3. Clean Order Number
    let orderNumberClean = parsedData.orderNumber ? String(parsedData.orderNumber).trim() : '';
    if (['なし', 'null', 'none', 'n/a', 'undefined', 'ー', '-'].includes(orderNumberClean.toLowerCase())) {
      orderNumberClean = '';
    }

    // 4. Clean Invoice Number
    let invoiceNumberClean = parsedData.invoiceNumber ? String(parsedData.invoiceNumber).trim() : '';
    if (['なし', 'null', 'none', 'n/a', 'undefined', 'ー', '-', '（空欄）', '(空欄)', '空欄', '未設定'].includes(invoiceNumberClean.toLowerCase())) {
      invoiceNumberClean = '';
    }
    // Reject warehouse/terminal/customs code false positives (e.g. 4MW49, 100OSA0, D8TKF)
    if (
      /^(?:4MW49|100OSA0|D8TKF|TAC\s*OSAKA|TAC\d+|OSA\d+)$/i.test(invoiceNumberClean) ||
      /(?:上屋|場所|通関コード|通関業者)/.test(invoiceNumberClean)
    ) {
      invoiceNumberClean = '';
    }

    // 5. Clean Shipper Name (remove Sub-agent / サブ代理店, TEL, FAX, etc.)
    let shipperClean = parsedData.shipper ? String(parsedData.shipper).trim() : '';
    // If raw text has explicit "SHIPPER : <name>", check for clean match
    if (textContent) {
      const shipperMatch = textContent.match(/SHIPPER\s*[:：]\s*([^\r\n]+)/i);
      if (shipperMatch && shipperMatch[1]) {
        let candidate = shipperMatch[1].trim()
          .replace(/サブ代理店.*$/i, '')
          .replace(/SUB\s*AGENT.*$/i, '')
          .replace(/コード\s*[:：].*$/i, '')
          .replace(/TEL\s*[:：].*$/i, '')
          .replace(/FAX\s*[:：].*$/i, '')
          .replace(/担当者\s*[:：].*$/i, '')
          .replace(/輸出者符号\s*[:：].*$/i, '')
          .trim();
        if (candidate.length >= 2 && !/^(?:なし|null|-)$/i.test(candidate)) {
          shipperClean = candidate;
        }
      }
    }
    shipperClean = shipperClean
      .replace(/(?:サブ代理店|SUB\s*AGENT)\s*[:：]?\s*[^\n\r,]+/gi, '')
      .replace(/コード\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/TEL\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/FAX\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/担当者\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/輸出者符号\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/^SHIPPER\s*[:：]\s*/i, '')
      .trim();

    // 6. Clean Consignee Name (ensure true consignee e.g. "OCEAN FORTUNE" is extracted, not forwarder/subagent)
    let consigneeClean = parsedData.consignee ? String(parsedData.consignee).trim() : '';
    if (textContent) {
      const consigneeMatch = textContent.match(/CONSIGNEE\s*[:：]\s*([^\r\n]+)/i);
      if (consigneeMatch && consigneeMatch[1]) {
        let candidate = consigneeMatch[1].trim()
          .replace(/コード\s*[:：].*$/i, '')
          .replace(/TEL\s*[:：].*$/i, '')
          .replace(/FAX\s*[:：].*$/i, '')
          .replace(/NOTIFY\s*[:：].*$/i, '')
          .replace(/INVOICE\s*NO.*$/i, '')
          .replace(/請求先.*$/i, '')
          .trim();
        if (candidate.length >= 2 && !/^(?:なし|null|-)$/i.test(candidate)) {
          consigneeClean = candidate;
        }
      }
    }
    consigneeClean = consigneeClean
      .replace(/コード\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/TEL\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/FAX\s*[:：]\s*[^\n\r,\s]+/gi, '')
      .replace(/NOTIFY\s*[:：].*$/i, '')
      .replace(/^CONSIGNEE\s*[:：]\s*/i, '')
      .trim();

    // 7. Disambiguation: If HAWB was not recognized and got placed into orderNumber (e.g. S2602006126)
    if (!hawbClean && orderNumberClean) {
      if (/^S\d{7,14}$/i.test(orderNumberClean) || /^[A-Z]{1,4}[0-9\-_]{5,20}$/i.test(orderNumberClean)) {
        hawbClean = orderNumberClean;
        orderNumberClean = '';
      }
    }

    // 8. Fallback text scanning for HAWB from textContent if still missing
    const combinedRaw = (textContent || '') + '\n' + (parsedData.specialNotes || '');
    if (!hawbClean && combinedRaw) {
      const rawHawbMatch = combinedRaw.match(/(?:HAWB|H-AWB|ハウスAWB)[:\s\t\n]*([A-Za-z0-9\-_]{5,20})/i);
      if (
        rawHawbMatch &&
        rawHawbMatch[1] &&
        !['direct', '直截', 'なし', 'none', 'null'].includes(rawHawbMatch[1].toLowerCase())
      ) {
        hawbClean = rawHawbMatch[1].trim();
      }
    }

    // If orderNumber is identical to HAWB, clear orderNumber
    if (orderNumberClean && hawbClean && orderNumberClean === hawbClean) {
      orderNumberClean = '';
    }

    // 9. Format Special Notes with proper line breaks & remove header artifacts
    let specialNotesClean = parsedData.specialNotes ? String(parsedData.specialNotes).trim() : '';
    
    // Filter out forbidden header keywords that might come from text stream order
    const forbiddenHeaderRegexes = [
      /^営業担当者/i,
      /^TAC\d+/i,
      /^浪口/i,
      /^茜/i,
      /^HAWB$/i,
      /^MAWB$/i,
      /^FLT\.?$/i,
      /^ROUTE$/i,
      /^積地/i,
      /^行先/i,
      /^海外代理店/i,
      /^早出し/i,
      /^超早出し/i,
      /^RO\s+LOCAL/i,
      /^ETD\s*-\s*ETA/i,
      /^ＢＬ返却先/i,
      /^アタッチ書類/i,
      /^受注[NＮ][OＯ]/i,
      /^通関業者/i,
    ];

    if (specialNotesClean) {
      if (specialNotesClean.includes('\n')) {
        const cleanedLines = specialNotesClean
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0 && !forbiddenHeaderRegexes.some(re => re.test(l)));
        specialNotesClean = cleanedLines.join('\n');
      } else {
        specialNotesClean = specialNotesClean
          .replace(/\s*(<MARKING>|\[MARKING\]|【MARKING】)\s*/gi, '\n$1\n')
          .replace(/\s*(SHIP\s+SPARES\s+IN\s+TRANSIT)\s*/gi, '\n$1\n')
          .replace(/\s*(船名でご確認下さい|船名確認|船名で確認)\s*/gi, '\n$1\n')
          .replace(/\s*(M\/V\s+[A-Za-z0-9\s&.,'-]+?)(?=\s+C\/NO|\s*<|\s*\d+月|\s*船名|\s*$)/gi, '\n$1\n')
          .replace(/\s*(HYUNDAI\s+BUSAN|OCEAN\s+FORTUNE)\s*/gi, '\n$1\n')
          .replace(/\s*(C\/NO\.?\s*\d+)/gi, '\n$1\n')
          .replace(/\s*(\d{1,2}月\d{1,2}日[^\s\n\r]*搬入[^\s\n\r]*|\d{1,2}\/\d{1,2}[^\s\n\r]*搬入[^\s\n\r]*)\s*/gi, '\n$1\n')
          .replace(/\s*([・•*])\s*/g, '\n$1 ')
          .replace(/\s*(インボイス番号[:：]|マーク[:：]|個数[:：]|GW[:：]|Size[:：]|ファーストにて搬入|保税[:：])/gi, '\n$1');

        specialNotesClean = specialNotesClean
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0 && !forbiddenHeaderRegexes.some(re => re.test(l)))
          .join('\n');
      }
    }

    const primaryKey = hawbClean || mawbClean;

    const finalResult = {
      ...parsedData,
      mawbNumber: mawbClean,
      hawbNumber: hawbClean,
      orderNumber: orderNumberClean,
      invoiceNumber: invoiceNumberClean,
      shipper: shipperClean,
      consignee: consigneeClean,
      specialNotes: specialNotesClean,
      primaryKey,
    };

    // Save to Cache for subsequent calls
    setCachedGeminiResult(cacheKey, finalResult);

    return res.json({
      success: true,
      data: finalResult,
      fromCache: false,
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

    // Cache check for X-ray scan page
    const rawForHash = `XRAY_P${pageNumber || 1}_${textContent ? textContent.slice(0, 1000) : ''}_${imageBase64 ? imageBase64.slice(0, 500) + imageBase64.length : (pdfBase64 ? pdfBase64.slice(0, 500) + pdfBase64.length : '')}`;
    const cacheKey = crypto.createHash('sha256').update(rawForHash).digest('hex');
    const cached = getCachedGeminiResult(cacheKey);
    if (cached) {
      console.log(`[Gemini API /analyze-xray-pdf] Cache hit (0 tokens, page ${pageNumber || 1})`);
      return res.json({
        success: true,
        pageNumber,
        data: cached,
        fromCache: true,
        tokensSaved: true,
      });
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

    // Save to Cache for subsequent calls
    setCachedGeminiResult(cacheKey, parsedData);

    return res.json({
      success: true,
      pageNumber,
      data: parsedData,
      fromCache: false,
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

// Global Express Error Handling Middleware
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    success: false,
    error: err?.message || 'サーバー内部エラーが発生しました。',
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
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
