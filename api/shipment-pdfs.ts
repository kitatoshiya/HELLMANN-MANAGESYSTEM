import fs from 'fs';
import path from 'path';
import os from 'os';

function getPdfStoreDir(): string {
  try {
    const primaryDir = path.join(process.cwd(), 'data', 'pdfs');
    if (fs.existsSync(primaryDir)) return primaryDir;
    const tmpDir = path.join(os.tmpdir(), 'export_mgmt_pdfs');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    return tmpDir;
  } catch {
    return os.tmpdir();
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
  maxDuration: 30,
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const { id, pdfDataUrl, fileName, fileSize, hawbNumber, mawbNumber } = req.body || {};
      if (!id || !pdfDataUrl) {
        return res.status(400).json({ success: false, error: 'id and pdfDataUrl required' });
      }

      const safeId = String(id).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const storeDir = getPdfStoreDir();
      const filePath = path.join(storeDir, `${safeId}.json`);

      fs.writeFileSync(
        filePath,
        JSON.stringify({
          id: safeId,
          pdfDataUrl,
          fileName: fileName || `${safeId}.pdf`,
          fileSize: fileSize || 0,
          hawbNumber: hawbNumber || null,
          mawbNumber: mawbNumber || null,
          savedAt: new Date().toISOString(),
        }),
        'utf8'
      );

      return res.status(200).json({ success: true, id: safeId });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
}
