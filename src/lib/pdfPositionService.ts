import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { PdfPositionTemplate } from '../types';

const POSITION_COLLECTION = 'pdf_position_templates';
const LOCAL_POSITION_KEY = 'export_mgmt_pdf_position_templates_v1';

export const DEFAULT_POSITION_TEMPLATES: PdfPositionTemplate[] = [
  {
    id: 'tmpl_standard_si_a4',
    name: '標準A4航空SI指示書レイアウト位置情報',
    description: 'MAWB, HAWB, Shipper, Consignee, Flightの抽出用xy座標ゾーン定義',
    confidenceScore: 0.99,
    zones: {
      mawb: { x: 14, y: 32, w: 90, h: 10, label: 'MAWB NO.' },
      hawb: { x: 104, y: 32, w: 92, h: 10, label: 'HAWB NO.' },
      shipper: { x: 14, y: 92, w: 182, h: 20, label: 'SHIPPER' },
      consignee: { x: 14, y: 115, w: 182, h: 20, label: 'CONSIGNEE' },
      invoice: { x: 14, y: 55, w: 90, h: 10, label: 'INVOICE NO.' },
      order: { x: 104, y: 55, w: 92, h: 10, label: 'ORDER NO.' },
      flight: { x: 14, y: 70, w: 90, h: 10, label: 'FLIGHT / ROUTE' },
      customsDate: { x: 104, y: 70, w: 92, h: 10, label: 'CUSTOMS CLEARANCE DATE' },
    },
    savedAt: '2026-07-31T10:00:00Z',
    usageCount: 12,
  },
];

function getLocalTemplates(): PdfPositionTemplate[] {
  try {
    const saved = localStorage.getItem(LOCAL_POSITION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    // Ignore error
  }
  return DEFAULT_POSITION_TEMPLATES;
}

function saveLocalTemplates(items: PdfPositionTemplate[]): void {
  try {
    localStorage.setItem(LOCAL_POSITION_KEY, JSON.stringify(items));
  } catch (e) {
    // Ignore error
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number = 2500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), ms)),
  ]);
}

export async function fetchPdfPositionTemplates(): Promise<PdfPositionTemplate[]> {
  const localList = getLocalTemplates();

  try {
    const colRef = collection(db, POSITION_COLLECTION);
    const querySnap = await withTimeout(getDocs(colRef), 2000);
    if (!querySnap.empty) {
      const results: PdfPositionTemplate[] = [];
      querySnap.forEach((d) => {
        results.push(d.data() as PdfPositionTemplate);
      });
      if (results.length > 0) {
        saveLocalTemplates(results);
        return results;
      }
    }
  } catch (err) {
    // Fallback
  }

  return localList;
}

export async function savePdfPositionTemplate(tmpl: PdfPositionTemplate): Promise<void> {
  const localList = getLocalTemplates();
  const updatedList = [tmpl, ...localList.filter((t) => t.id !== tmpl.id)];
  saveLocalTemplates(updatedList);

  try {
    const docRef = doc(db, POSITION_COLLECTION, tmpl.id);
    await withTimeout(setDoc(docRef, tmpl, { merge: true }), 3000);
  } catch (err) {
    // Ignore
  }
}

export async function recordTemplateUsage(templateId: string): Promise<void> {
  const localList = getLocalTemplates();
  const found = localList.find((t) => t.id === templateId);
  if (found) {
    found.usageCount = (found.usageCount || 0) + 1;
    saveLocalTemplates(localList);
  }
}
