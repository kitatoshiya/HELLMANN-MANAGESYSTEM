// Service to permanently persist uploaded/imported SI PDF Data URLs across updates and sessions
import { uploadPdfToFirebase, getPdfFromFirebase, deletePdfFromFirebase } from './firebasePdfService';

const pdfMemoryCache = new Map<string, string>();
const pendingFetches = new Map<string, Promise<string | null>>();
const NOT_FOUND_SENTINEL = '__PDF_NOT_FOUND__';

const DB_NAME = 'export_mgmt_pdf_db_v1';
const STORE_NAME = 'pdfs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openPdfDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported'));
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

/**
 * Clean up legacy PDF base64 keys from localStorage to prevent QuotaExceededError
 */
export function purgeLegacyPdfLocalStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('pdf_store_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch (_) {}
    });
    if (keysToRemove.length > 0) {
      console.log(`[Storage] Purged ${keysToRemove.length} legacy PDF entries from localStorage to release quota.`);
    }
  } catch (err) {
    console.warn('[Storage] Error during legacy PDF localStorage purge:', err);
  }
}

// Automatically execute once on client load
if (typeof window !== 'undefined') {
  setTimeout(() => {
    purgeLegacyPdfLocalStorage();
  }, 1000);
}

/**
 * Save PDF Data URL for a shipment ID to memory cache, IndexedDB, Express server storage, AND Firebase Cloud.
 * (LocalStorage writing is completely excluded to prevent QuotaExceededError).
 */
export async function savePdfToStorage(shipmentId: string, pdfDataUrl: string, aliases: string[] = []): Promise<void> {
  if (!shipmentId || !pdfDataUrl) return;

  const cleanId = shipmentId.trim();
  pdfMemoryCache.set(cleanId, pdfDataUrl);
  aliases.forEach((alias) => {
    if (alias && alias.trim()) {
      pdfMemoryCache.set(alias.trim(), pdfDataUrl);
    }
  });

  // IndexedDB persistence (Dedicated multi-megabyte client storage)
  try {
    const db = await openPdfDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(pdfDataUrl, cleanId);
    aliases.forEach((alias) => {
      if (alias) store.put(pdfDataUrl, alias.trim());
    });
  } catch (err) {
    console.warn('[pdfStorageService] Failed to save PDF to IndexedDB:', err);
  }

  // Firebase Cloud Storage persistence (Multi-terminal & persistent across container reboots)
  uploadPdfToFirebase(cleanId, pdfDataUrl, aliases).catch((err) => {
    console.warn('[pdfStorageService] Firebase Cloud upload error:', err);
  });

  // Server-side sync for multi-user / multi-terminal access (non-blocking in background)
  fetch('/api/shipment-pdfs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shipmentId: cleanId,
      pdfDataUrl,
      aliases,
    }),
  }).catch((err) => {
    console.warn('[pdfStorageService] Server POST fetch failed:', err);
  });
}

/**
 * Synchronously retrieve PDF Data URL from memory cache or localStorage
 */
export function getPdfFromStorageSync(shipmentId: string): string | null {
  if (!shipmentId) return null;
  const cleanId = shipmentId.trim();

  // 1. Memory Cache
  if (pdfMemoryCache.has(cleanId)) {
    const val = pdfMemoryCache.get(cleanId);
    return val === NOT_FOUND_SENTINEL ? null : val || null;
  }

  // 2. LocalStorage
  try {
    const local = localStorage.getItem(`pdf_store_${cleanId}`);
    if (local) {
      pdfMemoryCache.set(cleanId, local);
      return local;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Asynchronously retrieve PDF Data URL from IndexedDB or Server API (/api/shipment-pdfs/:id)
 * Optimized with immediate memory check, reliable server fetch, and promise memoization.
 */
export async function getPdfFromStorageAsync(shipmentId: string): Promise<string | null> {
  if (!shipmentId) return null;
  const cleanId = shipmentId.trim();

  // Check sync cache first
  const syncVal = getPdfFromStorageSync(cleanId);
  if (syncVal) return syncVal;

  if (pdfMemoryCache.get(cleanId) === NOT_FOUND_SENTINEL) {
    return null;
  }

  // Deduplicate inflight requests
  if (pendingFetches.has(cleanId)) {
    return pendingFetches.get(cleanId)!;
  }

  const fetchPromise = (async () => {
    // 1. Check IndexedDB
    try {
      const db = await openPdfDb();
      const idbVal = await new Promise<string | null>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(cleanId);
        req.onsuccess = () => {
          const result = req.result as string | undefined;
          resolve(result || null);
        };
        req.onerror = () => resolve(null);
      });

      if (idbVal && idbVal.length > 500) {
        pdfMemoryCache.set(cleanId, idbVal);
        return idbVal;
      }
    } catch {
      // proceed to server fetch
    }

    // 2. Server API lookup with 3500ms abort controller timeout to reliably fetch over network
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`/api/shipment-pdfs/${encodeURIComponent(cleanId)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.pdfDataUrl && json.pdfDataUrl.length > 500) {
          pdfMemoryCache.set(cleanId, json.pdfDataUrl);

          // Store locally in IndexedDB in background
          openPdfDb().then((db) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(json.pdfDataUrl, cleanId);
          }).catch(() => {});

          return json.pdfDataUrl;
        }
      }
    } catch {
      // ignore timeout or network error
    }

    // 3. Cloud Persistent Storage fallback (Firebase Cloud Storage / Firestore)
    try {
      const fbPdf = await getPdfFromFirebase(cleanId);
      if (fbPdf && fbPdf.length > 500) {
        pdfMemoryCache.set(cleanId, fbPdf);

        // Store locally in IndexedDB and server in background for high-speed cache
        openPdfDb().then((db) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(fbPdf, cleanId);
        }).catch(() => {});

        return fbPdf;
      }
    } catch (fbErr) {
      console.warn('[pdfStorageService] Firebase Cloud fallback lookup failed:', fbErr);
    }

    // Mark as not found in memory to prevent repeated stalled requests
    pdfMemoryCache.set(cleanId, NOT_FOUND_SENTINEL);
    return null;
  })();

  pendingFetches.set(cleanId, fetchPromise);
  try {
    const result = await fetchPromise;
    return result;
  } finally {
    pendingFetches.delete(cleanId);
  }
}

/**
 * Retrieve PDF Data URL for a shipment across all possible keys (Primary ID, HAWB, MAWB)
 */
export async function getShipmentPdfAsync(
  shipmentId: string,
  hawbNumber?: string | null,
  mawbNumber?: string | null
): Promise<string | null> {
  const ids = [shipmentId, hawbNumber, mawbNumber].filter((id): id is string => Boolean(id && id.trim()));
  for (const id of ids) {
    const pdf = await getPdfFromStorageAsync(id);
    if (pdf && pdf.length > 500) {
      // Also cache for all other sibling IDs
      for (const siblingId of ids) {
        if (siblingId !== id) {
          pdfMemoryCache.set(siblingId.trim(), pdf);
        }
      }
      return pdf;
    }
  }
  return null;
}

/**
 * Delete PDF data from memory cache, localStorage, IndexedDB, server API, and Firebase
 */
export async function deletePdfFromStorage(id: string, aliases: string[] = []): Promise<void> {
  if (!id) return;
  const targetIds = [id, ...aliases].map((k) => k?.trim()).filter(Boolean);

  // Clean Firebase Firestore / Storage records
  deletePdfFromFirebase(id, aliases).catch(() => {});

  for (const cleanId of targetIds) {
    pdfMemoryCache.delete(cleanId);
    try {
      localStorage.removeItem(`pdf_store_${cleanId}`);
    } catch (_) {}

    try {
      const db = await openPdfDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(cleanId);
    } catch (_) {}

    try {
      fetch(`/api/shipment-pdfs/${encodeURIComponent(cleanId)}`, { method: 'DELETE' }).catch(() => {});
    } catch (_) {}
  }
}

/**
 * Clear not-found sentinel in memory cache to permit fresh server re-fetch
 */
export function clearPdfCacheForId(id: string): void {
  if (!id) return;
  const cleanId = id.trim();
  pdfMemoryCache.delete(cleanId);
}

/**
 * Alias or re-assign key if primary ID changes (e.g. HAWB/MAWB edit)
 */
export async function rekeyPdfStorage(oldId: string, newId: string): Promise<void> {
  if (!oldId || !newId || oldId === newId) return;
  const pdf = await getPdfFromStorageAsync(oldId);
  if (pdf) {
    await savePdfToStorage(newId, pdf);
  }
}
