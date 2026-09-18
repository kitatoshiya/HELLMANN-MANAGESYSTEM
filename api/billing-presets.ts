import fs from 'fs';
import path from 'path';
import os from 'os';

function getPresetsFilePath(): string {
  try {
    const primaryDir = path.join(process.cwd(), 'data');
    if (fs.existsSync(primaryDir)) return path.join(primaryDir, 'billing_presets.json');
    const tmpDir = path.join(os.tmpdir(), 'export_mgmt_data');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    return path.join(tmpDir, 'billing_presets.json');
  } catch {
    return path.join(os.tmpdir(), 'billing_presets.json');
  }
}

function readServerPresets(): any[] {
  try {
    const fp = getPresetsFilePath();
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch {}
  return [];
}

function writeServerPresets(presets: any[]): void {
  try {
    const fp = getPresetsFilePath();
    fs.writeFileSync(fp, JSON.stringify(presets, null, 2), 'utf8');
  } catch {}
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const presets = readServerPresets();
    return res.status(200).json({ success: true, presets });
  }

  if (req.method === 'POST') {
    try {
      const { name, items, isDefault } = req.body || {};
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

      return res.status(200).json({ success: true, presets: updated });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
}
