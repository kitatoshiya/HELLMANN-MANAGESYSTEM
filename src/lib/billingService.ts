import { doc, setDoc, deleteDoc, collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { BillingItem, BillingPresetPattern, Shipment } from '../types';
import { getShipments, saveShipmentsHelper, saveSingleShipmentHelper, addActivityLog, getCurrentUser } from './storageManager';

const PRESETS_COLLECTION = 'billing_preset_patterns';
const LOCAL_PRESETS_KEY = 'export_mgmt_billing_presets_v2';

// Default preset patterns (Up to 10 max)
export const DEFAULT_BILLING_PRESETS: BillingPresetPattern[] = [
  {
    id: 'preset_standard_export',
    name: '1. 標準航空輸出通関プラン',
    isDefault: true,
    items: [
      { taxable: true, name: '輸出通関料', amount: 11800 },
      { taxable: true, name: '取扱料 (Handling Fee)', amount: 5000 },
      { taxable: false, name: '上屋使用料 (Terminal)', amount: 3200 },
      { taxable: true, name: 'X線検査費用', amount: 2500 },
      { taxable: false, name: 'トラック集荷料', amount: '' }, // 翌日確定 (空欄)
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
      { taxable: false, name: '時間外緊急対応費', amount: '' }, // 空欄
    ],
    createdAt: '2026-01-01T00:02:00.000Z',
  },
];

// Default initial billing items if a shipment doesn't have any
export const DEFAULT_INITIAL_BILLING_ITEMS: BillingItem[] = [
  { id: 'item_1', taxable: true, name: '輸出通関料', amount: 11800 },
  { id: 'item_2', taxable: true, name: '取扱料 (Handling)', amount: 5000 },
  { id: 'item_3', taxable: false, name: '上屋保管使用料', amount: 2400 },
  { id: 'item_4', taxable: true, name: 'X線検査作業料', amount: 2000 },
  { id: 'item_5', taxable: false, name: '時間外配送手配費', amount: '' }, // 手書き・翌日確定用空欄
];

/**
 * Get synchronous local cached presets immediately (0ms delay for UI combo box)
 */
export function getLocalPresets(): BillingPresetPattern[] {
  try {
    const saved = localStorage.getItem(LOCAL_PRESETS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
    // Also check previous storage key for backward compatibility
    const oldSaved = localStorage.getItem('export_mgmt_billing_presets_v1');
    if (oldSaved) {
      const parsedOld = JSON.parse(oldSaved);
      if (Array.isArray(parsedOld) && parsedOld.length > 0) {
        saveLocalPresets(parsedOld);
        return parsedOld;
      }
    }
  } catch {
    // Ignore error
  }
  return DEFAULT_BILLING_PRESETS;
}

export function saveLocalPresets(presets: BillingPresetPattern[]): void {
  try {
    localStorage.setItem(LOCAL_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Ignore
  }
}

/**
 * Get the currently configured active default preset pattern
 */
export function getDefaultBillingPreset(): BillingPresetPattern {
  const list = getLocalPresets();
  const found = list.find((p) => p.isDefault);
  if (found) return found;
  if (list.length > 0) return list[0];
  return DEFAULT_BILLING_PRESETS[0];
}

/**
 * Get initial billing items converted from the default preset pattern
 */
export function getDefaultBillingItems(): BillingItem[] {
  const preset = getDefaultBillingPreset();
  if (preset && Array.isArray(preset.items) && preset.items.length > 0) {
    return preset.items.map((it, idx) => ({
      id: `item_${Date.now()}_${idx}`,
      taxable: it.taxable,
      name: it.name,
      amount: it.amount,
    }));
  }
  return DEFAULT_INITIAL_BILLING_ITEMS;
}

/**
 * TAX & TTL calculation logic fulfilling exact user requirements:
 * - If ALL amounts are filled (including 0):
 *   TAX = Math.floor(sum of taxable amounts * 0.10)
 *   TTL = sum of all amounts + TAX
 * - If ANY amount is empty (null or ''):
 *   TAX & TTL calculation STOPS -> returned as null (empty space for handwriting)
 */
export interface BillingCalculationResult {
  taxableSubtotal: number | null;
  totalSubtotal: number | null;
  tax: number | null; // null represents empty/uncalculated space
  ttl: number | null; // null represents empty/uncalculated space
  isCalculated: boolean; // true if all items entered, false if any item is empty
  emptyItemNames: string[];
}

export function calculateBillingTotals(items: BillingItem[]): BillingCalculationResult {
  if (!items || items.length === 0) {
    return {
      taxableSubtotal: 0,
      totalSubtotal: 0,
      tax: 0,
      ttl: 0,
      isCalculated: true,
      emptyItemNames: [],
    };
  }

  const emptyItemNames: string[] = [];

  // Check if any active item's amount is empty (null, undefined, or empty string '')
  const hasEmptyAmount = items.some((item) => {
    const isEmpty = item.amount === null || item.amount === undefined || item.amount === '';
    if (isEmpty) {
      emptyItemNames.push(item.name || '名称未設定項目');
    }
    return isEmpty;
  });

  if (hasEmptyAmount) {
    return {
      taxableSubtotal: null,
      totalSubtotal: null,
      tax: null, // 表示は空欄
      ttl: null, // 表示は空欄
      isCalculated: false,
      emptyItemNames,
    };
  }

  let taxableSum = 0;
  let totalSum = 0;

  items.forEach((item) => {
    const numericAmount = typeof item.amount === 'number' ? item.amount : Number(item.amount) || 0;
    if (item.taxable) {
      taxableSum += numericAmount;
    }
    totalSum += numericAmount;
  });

  const tax = Math.floor(taxableSum * 0.10); // 10% 切り捨て
  const ttl = totalSum + tax;

  return {
    taxableSubtotal: taxableSum,
    totalSubtotal: totalSum,
    tax,
    ttl,
    isCalculated: true,
    emptyItemNames: [],
  };
}

// Timeout wrapper for non-blocking Firestore calls
function withTimeout<T>(promise: Promise<T>, ms = 2500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), ms)),
  ]);
}

let hasSeededPresets = false;

/**
 * Helper to seed initial default presets to Firestore if collection is empty
 */
async function seedFirestorePresets(initialPresets: BillingPresetPattern[]): Promise<void> {
  if (hasSeededPresets) return;
  hasSeededPresets = true;
  try {
    for (const preset of initialPresets) {
      const docRef = doc(db, PRESETS_COLLECTION, preset.id);
      await setDoc(docRef, preset, { merge: true });
    }
  } catch (err) {
    // Ignore seeding error
  }
}

/**
 * Real-time subscription to billing presets across all connected clients & cloud database
 * - Emits local cached data immediately (0ms)
 * - Emits latest remote Firestore / Server data when available
 * - Keeps all users synchronized in real time
 */
export function subscribeBillingPresets(
  callback: (presets: BillingPresetPattern[]) => void
): () => void {
  // 1. Immediately emit local cached presets
  const initialLocal = getLocalPresets();
  callback(initialLocal);

  // 2. Fetch server API in parallel for redundancy
  fetchBillingPresets().then((serverPresets) => {
    if (serverPresets && serverPresets.length > 0) {
      callback(serverPresets);
    }
  }).catch(() => {});

  // 3. Listen to Firestore real-time changes
  try {
    const colRef = collection(db, PRESETS_COLLECTION);
    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        if (!snapshot.empty) {
          const list: BillingPresetPattern[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as BillingPresetPattern;
            if (data && data.name && Array.isArray(data.items)) {
              list.push(data);
            }
          });
          if (list.length > 0) {
            // Sort deterministically: default first, then by createdAt
            list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
            const finalPresets = list.slice(0, 10);
            saveLocalPresets(finalPresets);
            callback(finalPresets);
            return;
          }
        }
        // If collection was empty, seed with initial presets
        seedFirestorePresets(DEFAULT_BILLING_PRESETS);
      },
      (error) => {
        console.warn('Firestore billing preset subscription note:', error);
      }
    );
    return unsubscribe;
  } catch (err) {
    console.warn('Firestore subscription unavailable, using local/server mode:', err);
    return () => {};
  }
}

/**
 * Fetch preset patterns (Firestore + Server API shared persistence with local fallback)
 * Max 10 patterns supported.
 */
export async function fetchBillingPresets(): Promise<BillingPresetPattern[]> {
  // 1. Try Firestore direct query first
  try {
    const colRef = collection(db, PRESETS_COLLECTION);
    const querySnap = await withTimeout(getDocs(colRef), 2000);
    if (!querySnap.empty) {
      const list: BillingPresetPattern[] = [];
      querySnap.forEach((d) => {
        const data = d.data() as BillingPresetPattern;
        if (data && data.name && Array.isArray(data.items)) {
          list.push(data);
        }
      });
      if (list.length > 0) {
        list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        const finalPresets = list.slice(0, 10);
        saveLocalPresets(finalPresets);
        return finalPresets;
      }
    }
  } catch {
    // Fallthrough to server API / local
  }

  // 2. Try Server API
  try {
    const res = await fetch('/api/billing-presets');
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.presets) && data.presets.length > 0) {
        saveLocalPresets(data.presets);
        return data.presets.slice(0, 10);
      }
    }
  } catch (err) {
    console.warn('Server billing presets fetch failed, using fallback:', err);
  }

  const localList = getLocalPresets();
  return localList.slice(0, 10);
}

/**
 * Save a new preset pattern or update existing one (Firestore Cloud + Server + Local shared persistence)
 */
export async function saveBillingPresetPattern(
  name: string,
  items: Array<{ taxable: boolean; name: string; amount: number | null | '' }>,
  setAsDefault: boolean = false
): Promise<BillingPresetPattern[]> {
  const existing = getLocalPresets();
  const id = `preset_${Date.now()}`;
  const now = new Date().toISOString();
  const newPreset: BillingPresetPattern = {
    id,
    name: name.trim().slice(0, 30),
    isDefault: setAsDefault,
    items: items.map((it) => ({
      taxable: Boolean(it.taxable),
      name: (it.name || '').slice(0, 20),
      amount: it.amount === '' || it.amount === null ? '' : Number(it.amount),
    })),
    createdAt: now,
    updatedAt: now,
  };

  let updatedList = [newPreset, ...existing.filter((p) => p.name !== newPreset.name)].slice(0, 10);
  if (setAsDefault) {
    updatedList = updatedList.map((p) => ({
      ...p,
      isDefault: p.id === id,
    }));
  } else if (!updatedList.some((p) => p.isDefault) && updatedList.length > 0) {
    updatedList[0].isDefault = true;
  }

  // 1. Instantly update local cache (0ms instant response for user)
  saveLocalPresets(updatedList);

  // 2. Persist to Cloud Firestore for permanent global storage
  try {
    const docRef = doc(db, PRESETS_COLLECTION, newPreset.id);
    await withTimeout(setDoc(docRef, newPreset, { merge: true }), 3000);
    if (setAsDefault) {
      for (const p of updatedList) {
        if (p.id !== newPreset.id) {
          const otherDoc = doc(db, PRESETS_COLLECTION, p.id);
          setDoc(otherDoc, { isDefault: false }, { merge: true }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('Firestore billing preset save warning:', err);
  }

  // 3. Persist to Server backend API in background
  try {
    fetch('/api/billing-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, items, isDefault: setAsDefault }),
    }).catch(() => {});
  } catch {}

  return updatedList;
}

/**
 * Set a preset pattern as the active default for newly registered tasks/shipments (Cloud & Server persistent)
 */
export async function setDefaultBillingPreset(presetId: string): Promise<BillingPresetPattern[]> {
  const existing = getLocalPresets();
  const updatedList = existing.map((p) => ({
    ...p,
    isDefault: p.id === presetId,
  }));
  saveLocalPresets(updatedList);

  // Update in Firestore
  try {
    for (const p of updatedList) {
      const docRef = doc(db, PRESETS_COLLECTION, p.id);
      setDoc(docRef, { isDefault: p.id === presetId }, { merge: true }).catch(() => {});
    }
  } catch (err) {
    console.warn('Firestore setDefault warning:', err);
  }

  // Update on server API
  try {
    fetch(`/api/billing-presets/${presetId}/default`, {
      method: 'POST',
    }).catch(() => {});
  } catch {}

  return updatedList;
}

/**
 * Delete a preset pattern by ID (Firestore Cloud & Server shared persistence)
 */
export async function deleteBillingPresetPattern(presetId: string): Promise<BillingPresetPattern[]> {
  const existing = getLocalPresets();
  let updatedList = existing.filter((p) => p.id !== presetId);
  if (updatedList.length > 0 && !updatedList.some((p) => p.isDefault)) {
    updatedList[0].isDefault = true;
  }
  saveLocalPresets(updatedList);

  // Delete from Firestore
  try {
    const docRef = doc(db, PRESETS_COLLECTION, presetId);
    await withTimeout(deleteDoc(docRef), 3000);
    if (updatedList.length > 0 && updatedList[0].isDefault) {
      const defRef = doc(db, PRESETS_COLLECTION, updatedList[0].id);
      setDoc(defRef, { isDefault: true }, { merge: true }).catch(() => {});
    }
  } catch (err) {
    console.warn('Firestore preset delete warning:', err);
  }

  // Delete on server API
  try {
    fetch(`/api/billing-presets/${presetId}`, {
      method: 'DELETE',
    }).catch(() => {});
  } catch {}

  return updatedList;
}

/**
 * Save shipment billing items (Server & Local Store persistence)
 */
export function updateShipmentBillingItems(
  shipmentId: string,
  billingItems: BillingItem[],
  recordLog: boolean = true
): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  // Enforce max 14 items & max 20 chars per item name
  const validItems: BillingItem[] = billingItems.slice(0, 14).map((it, idx) => {
    const rawAmt = it.amount;
    let amt: number | null | '' = '';
    if (rawAmt === '' || rawAmt === null || rawAmt === undefined) {
      amt = '';
    } else {
      const parsed = Number(rawAmt);
      amt = isNaN(parsed) ? '' : parsed;
    }

    return {
      id: it.id || `item_${Date.now()}_${idx}`,
      taxable: !!it.taxable,
      name: (it.name || '').slice(0, 20),
      amount: amt,
    };
  });

  shipment.billingItems = validItems;
  shipment.billingInitialized = true;
  shipment.updatedAt = new Date().toISOString();

  // Optimistically persist to local store and debounced batch
  saveShipmentsHelper(shipments);

  // CRITICAL: Immediately persist single shipment to Firestore without waiting for 400ms debounce
  // This guarantees the updated billing items/amounts survive immediate page refresh or container restart
  saveSingleShipmentHelper(shipment).catch((err) => {
    console.warn('[BillingService] Immediate single shipment sync notice:', err);
  });

  if (recordLog) {
    const currentUser = getCurrentUser();
    const calc = calculateBillingTotals(validItems);
    const ttlText = calc.isCalculated && calc.ttl !== null ? `¥${calc.ttl.toLocaleString()}` : '手書き用空欄';

    addActivityLog(
      shipmentId,
      currentUser,
      'STATUS_CHANGE',
      '請求明細オーバーレイ更新',
      `🧾 請求明細 ${validItems.length} 件を更新しました。（TTL: ${ttlText}）`
    );
  }

  return shipment;
}

