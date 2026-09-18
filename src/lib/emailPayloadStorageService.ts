// IndexedDB-backed service for permanent offloading of large email bodies and attachments
// Prevents browser localStorage QuotaExceededError while retaining full fidelity of email data.
import { EmailAttachment } from '../types';

export interface StoredEmailPayload {
  mailId: string;
  bodyHtml?: string;
  bodyText?: string;
  attachments?: EmailAttachment[];
  updatedAt: number;
}

const DB_NAME = 'export_mgmt_email_db_v1';
const STORE_NAME = 'email_payloads';

let dbPromise: Promise<IDBDatabase> | null = null;
const memoryCache = new Map<string, StoredEmailPayload>();

function openEmailDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return reject(new Error('IndexedDB not supported'));
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'mailId' });
          }
        } catch (_) {}
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('IndexedDB open error'));
      };
      request.onblocked = () => {
        dbPromise = null;
        reject(new Error('IndexedDB open blocked'));
      };
    } catch (err) {
      dbPromise = null;
      reject(err instanceof Error ? err : new Error(String(err) || 'IndexedDB initialization failed'));
    }
  });
  return dbPromise;
}

/**
 * Save an email payload (heavy HTML body and attachments with base64 dataUrl) to IndexedDB & memory cache.
 */
export async function saveEmailPayloadToIndexedDB(
  mailId: string,
  payload: {
    bodyHtml?: string;
    bodyText?: string;
    attachments?: EmailAttachment[];
  }
): Promise<void> {
  if (!mailId) return;
  const cleanId = mailId.trim();
  const existing = memoryCache.get(cleanId) || { mailId: cleanId, updatedAt: Date.now() };

  const mergedAttachments =
    payload.attachments && payload.attachments.length > 0
      ? payload.attachments
      : existing.attachments && existing.attachments.length > 0
      ? existing.attachments
      : payload.attachments || [];

  const record: StoredEmailPayload = {
    mailId: cleanId,
    bodyHtml: payload.bodyHtml !== undefined ? payload.bodyHtml : existing.bodyHtml,
    bodyText: payload.bodyText !== undefined ? payload.bodyText : existing.bodyText,
    attachments: mergedAttachments,
    updatedAt: Date.now(),
  };

  memoryCache.set(cleanId, record);

  try {
    const db = await openEmailDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(new Error('Transaction aborted'));
    });
  } catch (err) {
    console.warn('[EmailStorage] Failed to persist payload to IndexedDB:', err);
  }
}

/**
 * Batch save multiple email payloads to IndexedDB
 */
export async function saveBatchEmailPayloadsToIndexedDB(
  items: Array<{
    mailId: string;
    bodyHtml?: string;
    bodyText?: string;
    attachments?: EmailAttachment[];
  }>
): Promise<void> {
  if (!Array.isArray(items) || items.length === 0) return;

  // Immediate synchronous memory cache update
  for (const item of items) {
    if (!item || !item.mailId) continue;
    const cleanId = item.mailId.trim();
    const existing = memoryCache.get(cleanId) || { mailId: cleanId, updatedAt: Date.now() };
    const record: StoredEmailPayload = {
      mailId: cleanId,
      bodyHtml: item.bodyHtml !== undefined ? item.bodyHtml : existing.bodyHtml,
      bodyText: item.bodyText !== undefined ? item.bodyText : existing.bodyText,
      attachments:
        item.attachments && item.attachments.length > 0
          ? item.attachments
          : existing.attachments && existing.attachments.length > 0
          ? existing.attachments
          : item.attachments || [],
      updatedAt: Date.now(),
    };
    memoryCache.set(cleanId, record);
  }

  try {
    const db = await openEmailDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const item of items) {
      if (!item || !item.mailId) continue;
      const cleanId = item.mailId.trim();
      const cached = memoryCache.get(cleanId);
      if (cached) {
        store.put(cached);
      }
    }
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(new Error('Transaction aborted'));
    });
  } catch (err) {
    console.warn('[EmailStorage] Failed batch save to IndexedDB:', err);
  }
}

/**
 * Retrieve an email payload from memory cache or IndexedDB
 */
export async function getEmailPayload(mailId: string): Promise<StoredEmailPayload | null> {
  if (!mailId) return null;
  const cleanId = mailId.trim();
  const cached = memoryCache.get(cleanId);
  if (cached) return cached;

  try {
    const db = await openEmailDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(cleanId);
    const result = await new Promise<StoredEmailPayload | null>((res, rej) => {
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });

    if (result) {
      memoryCache.set(cleanId, result);
    }
    return result;
  } catch (err) {
    console.warn(`[EmailStorage] Error fetching payload for '${mailId}':`, err);
    return null;
  }
}

/**
 * Synchronous read from memory cache
 */
export function getEmailPayloadSync(mailId: string): StoredEmailPayload | null {
  if (!mailId) return null;
  return memoryCache.get(mailId.trim()) || null;
}

/**
 * Retrieve an attachment's data URL by mailId and attachment ID or filename
 */
export async function getAttachmentDataUrl(
  mailId: string,
  attachmentIdOrFileName?: string
): Promise<string | null> {
  if (!mailId) return null;
  const cleanId = mailId.trim();
  const payload = await getEmailPayload(cleanId);
  if (!payload || !Array.isArray(payload.attachments)) return null;

  const target = payload.attachments.find((att) => {
    if (!att) return false;
    if (!attachmentIdOrFileName) return !!att.dataUrl;
    return (
      att.id === attachmentIdOrFileName ||
      att.fileName === attachmentIdOrFileName ||
      att.fileName?.toLowerCase() === attachmentIdOrFileName?.toLowerCase()
    );
  });

  return target?.dataUrl || null;
}

/**
 * One-time startup migration to offload existing bloated localStorage items
 * (export_mgmt_hellmann_new_orders, graph inboxes) to IndexedDB and vacuum localStorage.
 */
export async function migrateAndPruneLegacyLocalStorageEmails(): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    const HELLMANN_KEY = 'export_mgmt_hellmann_new_orders';
    const GRAPH_INBOX_KEY = 'export_mgmt_graph_inbox_mails_v1';
    const GRAPH_SENT_KEY = 'export_mgmt_graph_sent_mails_v1';

    // 1. Process Hellmann New Orders
    const rawHellmann = localStorage.getItem(HELLMANN_KEY);
    if (rawHellmann && rawHellmann.length > 50000) {
      try {
        const orders = JSON.parse(rawHellmann);
        if (Array.isArray(orders) && orders.length > 0) {
          const payloads = orders.map((o: any) => ({
            mailId: o.id || '',
            bodyHtml: o.bodyHtml,
            bodyText: o.bodyText,
            attachments: o.attachments,
          }));
          await saveBatchEmailPayloadsToIndexedDB(payloads);

          // Strip heavy fields and resave slim version
          const slimmed = orders.slice(-40).map((o: any) => {
            const copy = { ...o };
            delete copy.bodyHtml;
            if (typeof copy.bodyText === 'string' && copy.bodyText.length > 800) {
              copy.bodyText = copy.bodyText.substring(0, 800) + '...';
            }
            if (Array.isArray(copy.attachments)) {
              copy.attachments = copy.attachments.map((a: any) => {
                const { dataUrl, ...rest } = a || {};
                return rest;
              });
            }
            return copy;
          });
          localStorage.setItem(HELLMANN_KEY, JSON.stringify(slimmed));
          console.log(`[EmailStorage] Migrated and slimmed ${orders.length} Hellmann orders to IndexedDB.`);
        }
      } catch (err) {
        console.warn('[EmailStorage] Migration error on Hellmann orders:', err);
      }
    }

    // 2. Process Graph Inbox Mails
    const rawInbox = localStorage.getItem(GRAPH_INBOX_KEY);
    if (rawInbox && rawInbox.length > 50000) {
      try {
        const inbox = JSON.parse(rawInbox);
        if (Array.isArray(inbox) && inbox.length > 0) {
          const payloads = inbox.map((m: any) => ({
            mailId: m.id || '',
            bodyHtml: m.bodyHtml,
            bodyText: m.body,
            attachments: m.attachments,
          }));
          await saveBatchEmailPayloadsToIndexedDB(payloads);

          const slimmed = inbox.slice(-40).map((m: any) => {
            const copy = { ...m };
            delete copy.bodyHtml;
            if (typeof copy.body === 'string' && copy.body.length > 800) {
              copy.body = copy.body.substring(0, 800) + '...';
            }
            if (Array.isArray(copy.attachments)) {
              copy.attachments = copy.attachments.map((a: any) => {
                const { dataUrl, ...rest } = a || {};
                return rest;
              });
            }
            return copy;
          });
          localStorage.setItem(GRAPH_INBOX_KEY, JSON.stringify(slimmed));
          console.log(`[EmailStorage] Migrated and slimmed ${inbox.length} Graph inbox mails to IndexedDB.`);
        }
      } catch (err) {
        console.warn('[EmailStorage] Migration error on Graph inbox:', err);
      }
    }

    // 3. Clean up legacy oversized metric logs if present
    try {
      localStorage.removeItem('firestore_metrics_events');
      localStorage.removeItem('firestore_read_metrics');
    } catch (_) {}
  } catch (err) {
    console.warn('[EmailStorage] Migration exception:', err);
  }
}

// Automatically trigger migration on client load
if (typeof window !== 'undefined') {
  setTimeout(() => {
    migrateAndPruneLegacyLocalStorageEmails().catch(() => {});
  }, 500);
}
