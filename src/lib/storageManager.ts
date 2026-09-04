import { Shipment, Task, ActivityLog, User, ShipmentStatus, TaskStatus, Operator, ShipmentComment, MilestoneKey, MilestoneState, CloudSyncStatus } from '../types';
import { INITIAL_SHIPMENTS, INITIAL_LOGS } from './sampleData';
import { generatePdfDataUrlFromShipment } from './pdfGenerator';
import { savePdfToStorage, getPdfFromStorageSync, getPdfFromStorageAsync, getShipmentPdfAsync, rekeyPdfStorage, deletePdfFromStorage } from './pdfStorageService';
import { getDefaultBillingItems } from './billingService';
import { db } from './firebase';
import { doc, setDoc, collection, onSnapshot, writeBatch, deleteDoc } from 'firebase/firestore';
import { recordFirestoreRead } from './firestoreMetricsService';
import { showToast } from './notificationService';


let cachedShipments: Shipment[] | null = null;
let cachedLogs: ActivityLog[] | null = null;
let isFirebaseInitialized = false;
let hasSeededShipments = false;
let hasSeededLogs = false;

const SYNC_QUEUE_KEY = 'export_mgmt_pending_sync_v1';

// Global Cloud Sync Status State
let cloudSyncStatus: CloudSyncStatus = {
  state: 'synced',
  lastSyncedAt: Date.now(),
  pendingCount: 0,
};

type SyncStatusListener = (status: CloudSyncStatus) => void;
let syncStatusListeners: SyncStatusListener[] = [];

export function subscribeToSyncStatus(listener: SyncStatusListener): () => void {
  syncStatusListeners.push(listener);
  listener({ ...cloudSyncStatus });
  return () => {
    syncStatusListeners = syncStatusListeners.filter((l) => l !== listener);
  };
}

function updateSyncStatus(updates: Partial<CloudSyncStatus>) {
  cloudSyncStatus = { ...cloudSyncStatus, ...updates };
  syncStatusListeners.forEach((fn) => fn({ ...cloudSyncStatus }));
}

export function getCloudSyncStatus(): CloudSyncStatus {
  return { ...cloudSyncStatus };
}

// Pending Sync Queue Helpers
function getPendingSyncQueue(): Record<string, { type: 'SET' | 'DELETE'; payload?: any; timestamp: number }> {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePendingSyncQueue(queue: Record<string, { type: 'SET' | 'DELETE'; payload?: any; timestamp: number }>) {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    updateSyncStatus({ pendingCount: Object.keys(queue).length });
  } catch {}
}

function addToSyncQueue(id: string, type: 'SET' | 'DELETE', payload?: any) {
  const queue = getPendingSyncQueue();
  queue[id] = { type, payload, timestamp: Date.now() };
  savePendingSyncQueue(queue);
}

function removeFromSyncQueue(id: string) {
  const queue = getPendingSyncQueue();
  if (queue[id]) {
    delete queue[id];
    savePendingSyncQueue(queue);
  }
}

let isFlushingQueue = false;
export async function flushPendingSyncQueue(): Promise<void> {
  if (isFlushingQueue) return;
  const queue = getPendingSyncQueue();
  const keys = Object.keys(queue);
  if (keys.length === 0) return;

  isFlushingQueue = true;
  updateSyncStatus({ state: 'syncing', pendingCount: keys.length });

  let successCount = 0;
  for (const id of keys) {
    const item = queue[id];
    try {
      if (item.type === 'SET' && item.payload) {
        await setDoc(doc(db, 'shipments', id), item.payload, { merge: true });
      } else if (item.type === 'DELETE') {
        await deleteDoc(doc(db, 'shipments', id));
      }
      removeFromSyncQueue(id);
      successCount++;
    } catch (err: any) {
      console.warn(`[SyncQueue] Failed to sync ${id}:`, err);
    }
  }

  const remaining = Object.keys(getPendingSyncQueue()).length;
  if (remaining === 0) {
    updateSyncStatus({
      state: 'synced',
      lastSyncedAt: Date.now(),
      pendingCount: 0,
      errorMessage: undefined,
    });
  } else {
    updateSyncStatus({
      state: 'error',
      pendingCount: remaining,
      errorMessage: `${remaining}件の未送信データがあります（再試行待機中）`,
    });
  }
  isFlushingQueue = false;
}

/**
 * Asynchronously fetch and hydrate original PDF Data URLs for shipments
 */
let isHydratingPdfs = false;
export async function hydrateShipmentPdfsAsync(shipments: Shipment[]): Promise<boolean> {
  if (!shipments || shipments.length === 0 || isHydratingPdfs) return false;
  isHydratingPdfs = true;
  let updated = false;

  try {
    for (const s of shipments) {
      if (!s.originalPdfUrl || s.originalPdfUrl.length < 500) {
        const storedPdf = await getShipmentPdfAsync(s.id, s.hawbNumber, s.mawbNumber);

        if (storedPdf) {
          s.originalPdfUrl = storedPdf;
          s.pdfDataUrl = storedPdf;
          s.hasCustomPdf = true;
          updated = true;
        }
      }
    }

    if (updated) {
      notifyListeners();
    }
  } catch (err) {
    console.warn('[PDFHydrate] Error during PDF hydration:', err);
  } finally {
    isHydratingPdfs = false;
  }

  return updated;
}

/**
 * Ensures that imported/uploaded PDF Data URLs are retained and synced in memory
 */
export function ensureShipmentPdf(s: Shipment): Shipment {
  if (!s) return s;
  const storedPdf =
    (s.originalPdfUrl && s.originalPdfUrl.length > 500 ? s.originalPdfUrl : null) ||
    (s.pdfDataUrl && s.pdfDataUrl.length > 500 && s.hasCustomPdf ? s.pdfDataUrl : null) ||
    getPdfFromStorageSync(s.id) ||
    (s.hawbNumber ? getPdfFromStorageSync(s.hawbNumber) : null) ||
    (s.mawbNumber ? getPdfFromStorageSync(s.mawbNumber) : null);

  if (storedPdf) {
    s.originalPdfUrl = storedPdf;
    s.pdfDataUrl = storedPdf;
    s.hasCustomPdf = true;
  }
  return s;
}

// Prepare shipment for Firestore by omitting large generated PDF Data URLs
// (PDFs are persisted in client-side pdfStorageService if missing from cloud)
export function prepareShipmentForFirestore(s: Shipment): Record<string, any> {
  const copy: Record<string, any> = JSON.parse(JSON.stringify(s));
  if (typeof copy.pdfDataUrl === 'string' && copy.pdfDataUrl.length > 10000) {
    delete copy.pdfDataUrl;
  }
  if (typeof copy.originalPdfUrl === 'string' && copy.originalPdfUrl.length > 10000) {
    delete copy.originalPdfUrl;
  }
  return copy;
}

export function initializeFirebaseStorage() {
  if (isFirebaseInitialized) return;
  isFirebaseInitialized = true;
  
  // Try flushing any unsynced offline items on startup
  flushPendingSyncQueue().catch(() => {});

  onSnapshot(collection(db, 'shipments'), (snapshot) => {
    if (snapshot.docs.length === 0 && !hasSeededShipments) {
      hasSeededShipments = true;
      const saved = localStorage.getItem(STORAGE_KEYS.SHIPMENTS);
      let localData: Shipment[] = [];
      if (saved) {
        try {
          localData = JSON.parse(saved);
        } catch(e){}
      }
      if (!localData || localData.length === 0) {
        localData = INITIAL_SHIPMENTS;
      }
      if (localData && localData.length > 0) {
        saveShipmentsHelper(localData);
        return;
      }
    }
    
    const remoteShipments = snapshot.docs
      .map(d => ensureShipmentPdf(d.data() as Shipment))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    // Retrieve local shipments (from cache or localStorage) to compare timestamps and preserve un-synced updates
    const queue = getPendingSyncQueue();
    let localList: Shipment[] = cachedShipments || [];
    if (localList.length === 0) {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.SHIPMENTS);
        if (saved) {
          localList = JSON.parse(saved);
        }
      } catch (e) {}
    }

    const localMap = new Map<string, Shipment>();
    localList.forEach(s => localMap.set(s.id, s));

    // Smart merge: if local copy has newer updates (by updatedAt) or is in sync queue, preserve local version
    let needsReSync = false;
    const mergedShipments = remoteShipments.map(remoteItem => {
      const localItem = localMap.get(remoteItem.id);
      if (!localItem) return remoteItem;

      const remoteTime = new Date(remoteItem.updatedAt || remoteItem.createdAt || 0).getTime();
      const localTime = new Date(localItem.updatedAt || localItem.createdAt || 0).getTime();

      // If local item is in queue or locally updated more recently than remote, keep local version
      if (queue[localItem.id] || localTime > remoteTime) {
        // Also ensure billing items and status are preserved from local
        if (localItem.billingInitialized && !remoteItem.billingInitialized) {
          remoteItem.billingInitialized = true;
          remoteItem.billingItems = localItem.billingItems;
        }
        needsReSync = true;
        return ensureShipmentPdf(localItem);
      }

      // If remote has no billingItems but local does, preserve local billingItems
      if ((!remoteItem.billingItems || remoteItem.billingItems.length === 0) && (localItem.billingItems && localItem.billingItems.length > 0)) {
        remoteItem.billingItems = localItem.billingItems;
        remoteItem.billingInitialized = true;
      }

      return remoteItem;
    });

    // Also include any purely local items that are in sync queue and not yet on remote
    const remoteIdSet = new Set(remoteShipments.map(s => s.id));
    localList.forEach(localItem => {
      if ((queue[localItem.id] || !remoteIdSet.has(localItem.id)) && !remoteIdSet.has(localItem.id)) {
        mergedShipments.unshift(ensureShipmentPdf(localItem));
        needsReSync = true;
      }
    });

    cachedShipments = mergedShipments;
    
    // Record read metric
    if (snapshot.docs.length > 0) {
      recordFirestoreRead('shipments', snapshot.docs.length, snapshot.metadata.fromCache, 'storageManager (onSnapshot)');
    }

    hydrateShipmentPdfsAsync(cachedShipments);
    
    // Seed committed snapshots for cleanly synchronized shipments to enable Diff Sync
    remoteShipments.forEach((remoteItem) => {
      if (!needsReSync || !queue[remoteItem.id]) {
        committedShipmentSnapshots.set(remoteItem.id, computeShipmentFingerprint(remoteItem));
        pendingDirtyShipmentIds.delete(remoteItem.id);
      }
    });

    // Also save to localStorage for offline fallback (sanitized, excluding large PDF blobs)
    try {
      localStorage.setItem(STORAGE_KEYS.SHIPMENTS, sanitizeShipmentsForLocalStorage(cachedShipments));
    } catch (e) {
      console.warn('[Storage] LocalStorage setItem failed:', e);
    }

    if (needsReSync) {
      flushPendingSyncQueue().catch(() => {});
    }
    
    updateSyncStatus({
      state: 'synced',
      lastSyncedAt: Date.now(),
      pendingCount: Object.keys(getPendingSyncQueue()).length,
    });

    notifyListeners();
  }, (err) => {
    console.warn("Firestore shipments subscription error:", err);
    updateSyncStatus({
      state: 'offline',
      errorMessage: 'クラウドサーバーとの通信が一時的に切断されています',
    });
  });
  
  onSnapshot(collection(db, 'logs'), (snapshot) => {
    if (snapshot.docs.length === 0 && !hasSeededLogs) {
      hasSeededLogs = true;
      const saved = localStorage.getItem(STORAGE_KEYS.LOGS);
      let localLogs: ActivityLog[] = [];
      if (saved) {
        try {
          localLogs = JSON.parse(saved);
        } catch(e){}
      }
      if (!localLogs || localLogs.length === 0) {
        localLogs = INITIAL_LOGS;
      }
      if (localLogs && localLogs.length > 0) {
        localLogs.forEach(log => {
          setDoc(doc(db, 'logs', log.id), JSON.parse(JSON.stringify(log))).catch(() => {});
        });
        return;
      }
    }
    
    cachedLogs = snapshot.docs.map(d => d.data() as ActivityLog).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (snapshot.docs.length > 0) {
      recordFirestoreRead('logs_and_notifications', snapshot.docs.length, snapshot.metadata.fromCache, 'storageManager (logs snapshot)');
    }
    try {
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(cachedLogs));
    } catch(e){}
    notifyListeners();
  }, (err) => {
    console.warn("Firestore logs subscription error:", err);
  });
}

const STORAGE_KEYS = {
  SHIPMENTS: 'export_mgmt_shipments_v1',
  LOGS: 'export_mgmt_logs_v1',
  CURRENT_USER: 'export_mgmt_user_v1',
};

// Event emitter for real-time reactivity
type Listener = () => void;
const listeners: Set<Listener> = new Set();

export function subscribeToStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyListeners() {
  listeners.forEach((l) => l());
}

// Current Active User
export function getCurrentUser(): User {
  const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // fallback
    }
  }
  return {
    uid: 'user_operator_01',
    email: 'tsukan@customs.logistics.co.jp',
    displayName: '通関担当者',
    department: '通関部',
  };
}

export function setCurrentUser(user: User): void {
  localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
  notifyListeners();
}

// Get Shipments
export function getShipments(): Shipment[] {
  if (!isFirebaseInitialized) initializeFirebaseStorage();
  if (cachedShipments !== null) {
    hydrateShipmentPdfsAsync(cachedShipments);
    return cachedShipments;
  }
  const saved = localStorage.getItem(STORAGE_KEYS.SHIPMENTS);
  let shipments: Shipment[] = [];
  if (saved) {
    try {
      shipments = JSON.parse(saved);
    } catch {
      shipments = INITIAL_SHIPMENTS;
    }
  } else {
    shipments = INITIAL_SHIPMENTS;
  }
  cachedShipments = shipments.map(s => ensureShipmentPdf(s));
  hydrateShipmentPdfsAsync(cachedShipments);
  return cachedShipments;
}

// Get Single Shipment
export function getShipmentById(id: string): Shipment | undefined {
  const shipments = getShipments();
  return shipments.find((s) => s.id === id);
}

// Find existing shipment by MAWB or HAWB primary keys
export function findExistingShipmentByKey(mawbNumber: string, hawbNumber?: string | null): Shipment | undefined {
  const shipments = getShipments();
  const hawbClean = hawbNumber && hawbNumber.trim() !== '' ? hawbNumber.trim() : null;
  const mawbClean = mawbNumber ? mawbNumber.trim() : '';
  const primaryId = hawbClean || mawbClean;

  return shipments.find((s) => {
    if (s.id === primaryId) return true;
    if (hawbClean && s.hawbNumber === hawbClean) return true;
    if (!hawbClean && s.mawbNumber === mawbClean && (!s.hawbNumber || s.hawbNumber === '')) return true;
    return false;
  });
}

export async function saveSingleShipmentHelper(shipment: Shipment): Promise<boolean> {
  try {
    const payload = prepareShipmentForFirestore(shipment);
    updateSyncStatus({ state: 'syncing' });
    await setDoc(doc(db, 'shipments', shipment.id), payload, { merge: true });
    removeFromSyncQueue(shipment.id);
    updateSyncStatus({
      state: 'synced',
      lastSyncedAt: Date.now(),
      pendingCount: Object.keys(getPendingSyncQueue()).length,
      errorMessage: undefined,
    });
    committedShipmentSnapshots.set(shipment.id, computeShipmentFingerprint(shipment));
    pendingDirtyShipmentIds.delete(shipment.id);
    return true;
  } catch (err: any) {
    console.error("Firestore single shipment save failure:", err);
    // Add to pending sync queue so it persists offline and can be retried
    addToSyncQueue(shipment.id, 'SET', prepareShipmentForFirestore(shipment));
    updateSyncStatus({
      state: 'error',
      errorMessage: `クラウド保存に失敗しました（ローカルに一時保持中）: ${err?.message || '通信エラー'}`,
    });
    showToast({
      title: 'クラウド保存警告',
      message: `案件【${shipment.id}】のサーバー保存に一時失敗しました。ローカルに保持しており、自動再試行されます。`,
      type: 'warning',
    });
    return false;
  }
}

/**
 * Strip large PDF data URLs to keep localStorage payload compact and eliminate QuotaExceededError
 */
export function sanitizeShipmentsForLocalStorage(shipments: Shipment[]): string {
  const stripped = shipments.map((s) => {
    if ((!s.pdfDataUrl || s.pdfDataUrl.length < 500) && (!s.originalPdfUrl || s.originalPdfUrl.length < 500)) {
      return s;
    }
    const copy = { ...s };
    if (copy.pdfDataUrl && copy.pdfDataUrl.length >= 500) {
      delete copy.pdfDataUrl;
    }
    if (copy.originalPdfUrl && copy.originalPdfUrl.length >= 500) {
      delete copy.originalPdfUrl;
    }
    return copy;
  });
  return JSON.stringify(stripped);
}

/**
 * Compute lightweight string signature/fingerprint for Diff Sync detection
 */
export function computeShipmentFingerprint(s: Shipment): string {
  const billingSummary = s.billingItems
    ? s.billingItems.map((b) => `${b.id}:${b.name}:${b.amount}:${b.taxable}`).join('|')
    : '';
  const tasksSummary = s.tasks
    ? s.tasks.map((t) => `${t.id}:${t.status}:${t.assignedTo?.uid || ''}`).join('|')
    : '';
  const milestoneSummary = s.milestones ? JSON.stringify(s.milestones) : '';

  return `${s.id}#${s.updatedAt || ''}#${s.status}#${s.mawbNumber}#${s.hawbNumber || ''}#${s.assignedOperator?.id || ''}#${s.pieces || ''}#${s.grossWeight || ''}#${s.flightRoute || ''}#${s.customsClearanceDate || ''}#${s.cutTime || ''}#${s.shipper || ''}#${s.consignee || ''}#${s.billingInitialized ? '1' : '0'}#${billingSummary}#${tasksSummary}#${milestoneSummary}#${s.hasCustomPdf ? '1' : '0'}`;
}

const committedShipmentSnapshots = new Map<string, string>();
const pendingDirtyShipmentIds = new Set<string>();

let firestoreBatchTimeout: any = null;
let pendingBatchShipments: Shipment[] | null = null;
const pendingDeletedShipmentIds = new Set<string>();

async function commitShipmentsToFirestore(shipments: Shipment[]) {
  try {
    updateSyncStatus({ state: 'syncing' });

    // Process all pending deleted shipment IDs directly
    if (pendingDeletedShipmentIds.size > 0) {
      const idsToDelete = Array.from(pendingDeletedShipmentIds);
      pendingDeletedShipmentIds.clear();
      
      for (const deletedId of idsToDelete) {
        try {
          await deleteDoc(doc(db, 'shipments', deletedId));
          removeFromSyncQueue(deletedId);
          committedShipmentSnapshots.delete(deletedId);
          pendingDirtyShipmentIds.delete(deletedId);
        } catch (e: any) {
          console.warn(`Failed to deleteDoc for ${deletedId}:`, e);
          addToSyncQueue(deletedId, 'DELETE');
        }
      }
    }

    // Diff Sync: Only write shipments that have actually changed (dirty)
    const dirtyIds = Array.from(pendingDirtyShipmentIds);
    if (dirtyIds.length === 0) {
      updateSyncStatus({
        state: 'synced',
        lastSyncedAt: Date.now(),
        pendingCount: Object.keys(getPendingSyncQueue()).length,
        errorMessage: undefined,
      });
      return;
    }

    const dirtySet = new Set(dirtyIds);
    const shipmentsToCommit = shipments.filter((s) => dirtySet.has(s.id));

    if (shipmentsToCommit.length > 0) {
      // Use individual promises with Promise.allSettled to prevent single document failure from breaking entire dataset
      const writePromises = shipmentsToCommit.map(async (s) => {
        const payload = prepareShipmentForFirestore(s);
        const ref = doc(db, 'shipments', s.id);
        await setDoc(ref, payload, { merge: true });
        removeFromSyncQueue(s.id);
        pendingDirtyShipmentIds.delete(s.id);
        committedShipmentSnapshots.set(s.id, computeShipmentFingerprint(s));
      });

      const results = await Promise.allSettled(writePromises);
      const failed = results.filter((r) => r.status === 'rejected');

      if (failed.length > 0) {
        console.warn(`[Firestore Diff Sync] ${failed.length} / ${shipmentsToCommit.length} writes failed`);
        // Queue failed ones
        results.forEach((r, idx) => {
          if (r.status === 'rejected') {
            const failedShipment = shipmentsToCommit[idx];
            addToSyncQueue(failedShipment.id, 'SET', prepareShipmentForFirestore(failedShipment));
          }
        });
        
        updateSyncStatus({
          state: 'error',
          errorMessage: `${failed.length}件の同期に失敗しました（再試行待機中）`,
        });
      } else {
        updateSyncStatus({
          state: 'synced',
          lastSyncedAt: Date.now(),
          pendingCount: Object.keys(getPendingSyncQueue()).length,
          errorMessage: undefined,
        });
      }
    } else {
      updateSyncStatus({
        state: 'synced',
        lastSyncedAt: Date.now(),
        pendingCount: Object.keys(getPendingSyncQueue()).length,
        errorMessage: undefined,
      });
    }
  } catch (err: any) {
    console.error("Firestore batch sync error:", err);
    updateSyncStatus({
      state: 'error',
      errorMessage: `クラウド同期エラー: ${err?.message || '通信障害'}`,
    });
  }
}

// Flush any debounced shipment batch saves immediately (e.g. before unload / restart)
export function flushPendingBatchShipments(): void {
  if (firestoreBatchTimeout) {
    clearTimeout(firestoreBatchTimeout);
    firestoreBatchTimeout = null;
  }
  if (pendingBatchShipments !== null) {
    const toCommit = pendingBatchShipments;
    pendingBatchShipments = null;
    commitShipmentsToFirestore(toCommit);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushPendingBatchShipments();
  });
  window.addEventListener('pagehide', () => {
    flushPendingBatchShipments();
  });
}

// Save Shipments with robust Diff Sync & QuotaExceededError protection
export function saveShipmentsHelper(shipments: Shipment[], explicitDirtyIds?: string[]) {
  // Track deleted shipments before updating cachedShipments
  if (cachedShipments) {
    const currentIds = new Set(shipments.map(s => s.id));
    cachedShipments.forEach(s => {
      if (!currentIds.has(s.id)) {
        pendingDeletedShipmentIds.add(s.id);
        pendingDirtyShipmentIds.delete(s.id);
        committedShipmentSnapshots.delete(s.id);
      }
    });
  }

  // Explicitly marked dirty shipments
  if (explicitDirtyIds && explicitDirtyIds.length > 0) {
    explicitDirtyIds.forEach((id) => pendingDirtyShipmentIds.add(id));
  }

  // Automatically detect modified or added shipments against committed snapshots
  shipments.forEach((s) => {
    const fp = computeShipmentFingerprint(s);
    const prevFp = committedShipmentSnapshots.get(s.id);
    if (!prevFp || prevFp !== fp) {
      pendingDirtyShipmentIds.add(s.id);
    }
  });

  // Local cache optimistic update
  cachedShipments = [...shipments];
  try {
    localStorage.setItem(STORAGE_KEYS.SHIPMENTS, sanitizeShipmentsForLocalStorage(cachedShipments));
  } catch (e) {
    console.warn('[Storage] LocalStorage setItem failed:', e);
  }
  notifyListeners();

  // Debounced Diff Sync to Firestore to prevent write stream exhaustion
  pendingBatchShipments = shipments;
  if (firestoreBatchTimeout) clearTimeout(firestoreBatchTimeout);
  firestoreBatchTimeout = setTimeout(() => {
    if (pendingBatchShipments !== null) {
      commitShipmentsToFirestore(pendingBatchShipments);
      pendingBatchShipments = null;
    }
  }, 400);
}

function saveShipments(shipments: Shipment[]) {
  saveShipmentsHelper(shipments);
}

// Get Activity Logs
export function getActivityLogs(shipmentId?: string): ActivityLog[] {
  if (!isFirebaseInitialized) initializeFirebaseStorage();
  
  let logs: ActivityLog[] = [];
  if (cachedLogs !== null) {
    logs = cachedLogs;
  } else {
    const saved = localStorage.getItem(STORAGE_KEYS.LOGS);
    if (saved) {
      try {
        logs = JSON.parse(saved);
      } catch {
        logs = INITIAL_LOGS;
      }
    } else {
      logs = INITIAL_LOGS;
    }
  }

  if (shipmentId) {
    return logs
      .filter((l) => l.shipmentId === shipmentId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// Append Activity Log (Immutable)
export function addActivityLog(
  shipmentId: string,
  user: User,
  actionType: ActivityLog['actionType'],
  actionTitle: string,
  details: string
): ActivityLog {
  const logs = getActivityLogs();
  const now = new Date();
  
  // Format MM/DD HH:mm:ss for Japan local view
  const formattedTime = now.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const newLog: ActivityLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    shipmentId,
    timestamp: now.toISOString(),
    formattedTime,
    userId: user.uid,
    userName: user.displayName,
    userEmail: user.email,
    actionType,
    actionTitle,
    details,
  };

  const updatedLogs = [newLog, ...logs];
  cachedLogs = updatedLogs;
  setDoc(doc(db, 'logs', newLog.id), JSON.parse(JSON.stringify(newLog))).catch(e => console.error("Failed to save log:", e));
  notifyListeners();
  return newLog;
}

/**
 * Requirement 5 Logic:
 * Calculate Overall Shipment Status based on sub-tasks
 * - Todo: ALL tasks are Todo
 * - Completed: ALL tasks are Completed
 * - In Progress: 1 or more tasks are In Progress OR partial completion with remaining non-completed tasks
 */
export function calculateShipmentStatus(tasks: Task[]): ShipmentStatus {
  if (!tasks || tasks.length === 0) return 'Todo';

  const allTodo = tasks.every((t) => t.status === 'Todo');
  if (allTodo) return 'Todo';

  const allCompleted = tasks.every((t) => t.status === 'Completed');
  if (allCompleted) return 'Completed';

  return 'In Progress';
}

/**
 * Create New Shipment
 * Requirement 3: Primary Key is HAWB if present, else MAWB.
 */
export function createShipment(data: {
  mawbNumber: string;
  hawbNumber: string | null;
  orderNumber: string;
  invoiceNumber: string;
  shipper: string;
  consignee: string;
  portOfLoading?: string | null;
  destination?: string | null;
  flag?: string | null;
  customsClearanceDate: string;
  flightRoute: string;
  cutTime?: string | null;
  pieces?: string | null;
  grossWeight?: string | null;
  specialNotes?: string | null;
  tasksTitles?: string[];
  initialTasks?: { title: string; shortName?: string }[];
  isDgCargo?: boolean;
  isImportant?: boolean;
  isUrgent?: boolean;
  assignedOperator?: Operator | null;
  pdfDataUrl?: string;
}): Shipment {
  const user = getCurrentUser();
  const hawbClean = data.hawbNumber && data.hawbNumber.trim() !== '' ? data.hawbNumber.trim() : null;
  const mawbClean = data.mawbNumber.trim();
  
  // Primary Key determination
  const primaryId = hawbClean || mawbClean;

  const initialAssignedUser: User | null = data.assignedOperator
    ? {
        uid: `op_${data.assignedOperator.email}`,
        displayName: data.assignedOperator.name,
        email: data.assignedOperator.email,
        employeeNumber: data.assignedOperator.employeeNumber,
        department: data.assignedOperator.department,
      }
    : null;

  const now = new Date().toISOString();

  let tasks: Task[] = [];

  if (data.initialTasks && data.initialTasks.length > 0) {
    tasks = data.initialTasks.map((t, index) => ({
      id: `task_${Date.now()}_${index}`,
      title: t.title,
      shortName: t.shortName,
      status: 'Todo',
      order: index + 1,
      assignedTo: initialAssignedUser,
      completedBy: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }));
  } else {
    const defaultTaskTitles = data.tasksTitles || [
      'SI（輸出指示書）内容確認・検証',
      '書類点検（インボイス・パッキングリスト）',
      '輸出通関申告書類作成 & 税関提出',
      '航空会社スペース予約・搬入手配',
      'HAWB / MAWB 確定発行',
      'Shipper / Consignee へ確定通知送付',
    ];

    tasks = defaultTaskTitles.map((title, index) => ({
      id: `task_${Date.now()}_${index}`,
      title,
      status: 'Todo',
      order: index + 1,
      assignedTo: initialAssignedUser,
      completedBy: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }));
  }

  const initialStatus = calculateShipmentStatus(tasks);

  const newShipmentTemp: Partial<Shipment> = {
    id: primaryId,
    mawbNumber: mawbClean,
    hawbNumber: hawbClean,
    orderNumber: data.orderNumber || 'ORD-NEW',
    invoiceNumber: data.invoiceNumber || 'INV-NEW',
    shipper: data.shipper || 'N/A',
    consignee: data.consignee || 'N/A',
    portOfLoading: data.portOfLoading || (data.flightRoute ? (data.flightRoute.includes('KIX') ? 'KIX (関空)' : 'NRT (成田)') : 'NRT (成田)'),
    destination: data.destination || (data.flightRoute && data.flightRoute.includes('→') ? data.flightRoute.split('→')[1]?.trim() : (data.consignee ? data.consignee.split(' ')[0] : 'N/A')),
    flag: data.flag || null,
    customsClearanceDate: data.customsClearanceDate || new Date().toISOString().split('T')[0],
    flightRoute: data.flightRoute || 'NRT → Overseas',
    pieces: data.pieces || null,
    grossWeight: data.grossWeight || null,
    specialNotes: data.specialNotes || null,
    cutTime: data.cutTime || null,
    status: initialStatus,
    isDgCargo: !!data.isDgCargo,
    isImportant: !!data.isImportant,
    isUrgent: !!data.isUrgent,
    assignedOperator: data.assignedOperator || null,
    hasCustomPdf: !!data.pdfDataUrl,
    originalPdfUrl: data.pdfDataUrl || undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: user,
    tasks,
    billingInitialized: false,
    billingItems: undefined,
  };

  const finalPdfDataUrl = data.pdfDataUrl || generatePdfDataUrlFromShipment(newShipmentTemp);
  const pdfToSave = data.pdfDataUrl || finalPdfDataUrl;

  const newShipment: Shipment = {
    ...newShipmentTemp,
    hasCustomPdf: !!data.pdfDataUrl,
    originalPdfUrl: pdfToSave,
    pdfDataUrl: pdfToSave,
  } as Shipment;

  if (pdfToSave) {
    savePdfToStorage(primaryId, pdfToSave);
    if (hawbClean) savePdfToStorage(hawbClean, pdfToSave);
    if (mawbClean) savePdfToStorage(mawbClean, pdfToSave);
  }

  const shipments = getShipments();
  // Filter out if duplicate ID exists
  const existingIndex = shipments.findIndex((s) => s.id === primaryId);
  let updatedShipments: Shipment[];
  if (existingIndex >= 0) {
    updatedShipments = [...shipments];
    updatedShipments[existingIndex] = newShipment;
  } else {
    updatedShipments = [newShipment, ...shipments];
  }

  saveShipments(updatedShipments);

  // Directly & immediately persist newly created shipment to Firestore to guarantee immediate multi-device visibility
  saveSingleShipmentHelper(newShipment).then((success) => {
    if (success) {
      showToast({
        title: 'クラウド保存完了',
        message: `案件【${primaryId}】がサーバーに正常登録されました。他端末にも即時同期されます。`,
        type: 'success',
      });
    }
  }).catch(() => {});

  // Add Log
  const keyType = hawbClean ? 'HAWB' : 'MAWB';
  addActivityLog(
    primaryId,
    user,
    'CREATE',
    '案件新規登録',
    `SI自動取り込みにより【${keyType}: ${primaryId}】を登録しました（初期タスク ${tasks.length} 件）。`
  );

  return newShipment;
}

/**
 * Update Task Status & Assignee
 * Requirement 5 & 6:
 * - When set to "In Progress", set assignedTo if provided or current user.
 * - When set to "Completed", record completedBy user and completedAt timestamp (MM/DD HH:MM).
 * - Trigger shipment overall status recalculation and log activity.
 */
export function updateTaskStatus(
  shipmentId: string,
  taskId: string,
  newStatus: TaskStatus,
  assignedToUser?: User | null
): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  const currentUser = getCurrentUser();
  const taskIndex = shipment.tasks.findIndex((t) => t.id === taskId);
  if (taskIndex === -1) return undefined;

  const targetTask = { ...shipment.tasks[taskIndex] };
  const oldStatus = targetTask.status;

  targetTask.status = newStatus;
  targetTask.updatedAt = new Date().toISOString();

  // Handle Assignee: 未選択の状態で進行中や完了状態にすれば、現在ログインしている者を担当者にする
  if (assignedToUser !== undefined) {
    targetTask.assignedTo = assignedToUser;
  } else if ((newStatus === 'In Progress' || newStatus === 'Completed') && !targetTask.assignedTo) {
    targetTask.assignedTo = currentUser;
  }

  // Handle Completion Metadata
  if (newStatus === 'Completed') {
    targetTask.completedBy = currentUser;
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    targetTask.completedAt = `${mm}/${dd} ${hh}:${min}`;
  } else {
    targetTask.completedBy = null;
    targetTask.completedAt = null;
  }

  shipment.tasks[taskIndex] = targetTask;

  // Recalculate Overall Shipment Status
  const oldShipmentStatus = shipment.status;
  const newShipmentStatus = calculateShipmentStatus(shipment.tasks);
  shipment.status = newShipmentStatus;
  shipment.updatedAt = new Date().toISOString();
  ensureShipmentPdf(shipment);

  saveShipments(shipments);

  // Log Activity
  const statusLabelMap: Record<TaskStatus, string> = {
    Todo: '未着手',
    'In Progress': '進行中',
    Completed: '完了',
  };

  let detailMsg = `タスク「${targetTask.title}」のステータスを【${statusLabelMap[oldStatus]}】から【${statusLabelMap[newStatus]}】に変更しました。`;
  if (targetTask.assignedTo) {
    detailMsg += ` （担当: ${targetTask.assignedTo.displayName}）`;
  }
  if (oldShipmentStatus !== newShipmentStatus) {
    detailMsg += ` ⚡ 案件全体のステータスが【${oldShipmentStatus}】から【${newShipmentStatus}】に自動更新されました。`;
  }

  addActivityLog(shipmentId, currentUser, 'STATUS_CHANGE', `タスク状態更新 (${statusLabelMap[newStatus]})`, detailMsg);

  return shipment;
}

/**
 * Complete all tasks for a shipment in a single batch operation
 */
export function completeAllTasksForShipment(shipmentId: string): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  const currentUser = getCurrentUser();
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const completedAtStr = `${mm}/${dd} ${hh}:${min}`;
  const isoNow = now.toISOString();

  let modifiedCount = 0;
  shipment.tasks.forEach((t) => {
    if (t.status !== 'Completed') {
      t.status = 'Completed';
      t.completedBy = currentUser;
      t.completedAt = completedAtStr;
      t.updatedAt = isoNow;
      modifiedCount++;
    }
  });

  if (modifiedCount === 0) {
    return shipment;
  }

  const oldShipmentStatus = shipment.status;
  const newShipmentStatus = calculateShipmentStatus(shipment.tasks);
  shipment.status = newShipmentStatus;
  shipment.updatedAt = isoNow;
  ensureShipmentPdf(shipment);

  saveShipments(shipments);

  addActivityLog(
    shipmentId,
    currentUser,
    'STATUS_CHANGE',
    '全タスク一括完了',
    `すべての工程タスク（${modifiedCount}件）を一括で【完了】に更新しました。⚡ 案件全体のステータスが【${oldShipmentStatus}】から【${newShipmentStatus}】に更新されました。`
  );

  return shipment;
}

// Assign Task to User
export function assignTask(shipmentId: string, taskId: string, user: User | null): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  const taskIndex = shipment.tasks.findIndex((t) => t.id === taskId);
  if (taskIndex === -1) return undefined;

  const task = shipment.tasks[taskIndex];
  task.assignedTo = user;
  task.updatedAt = new Date().toISOString();

  saveShipments(shipments);

  const currentUser = getCurrentUser();
  const userName = user ? user.displayName : '未割当';
  addActivityLog(
    shipmentId,
    currentUser,
    'ASSIGN',
    '担当者割り当て',
    `タスク「${task.title}」の担当者を【${userName}】に設定しました。`
  );

  return shipment;
}

// Add New Dynamic Task to Shipment
export function addTaskToShipment(
  shipmentId: string,
  title: string,
  shortName?: string
): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  const currentUser = getCurrentUser();
  const now = new Date().toISOString();
  const maxOrder = shipment.tasks.reduce((max, t) => Math.max(max, t.order || 0), 0);

  const newTask: Task = {
    id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    title: title.trim(),
    shortName: shortName?.trim() || (title.length <= 4 ? title.trim() : undefined),
    status: 'Todo',
    order: maxOrder + 1,
    assignedTo: null,
    completedBy: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  shipment.tasks.push(newTask);
  shipment.status = calculateShipmentStatus(shipment.tasks);
  shipment.updatedAt = now;
  ensureShipmentPdf(shipment);

  saveShipments(shipments);

  addActivityLog(
    shipmentId,
    currentUser,
    'TASK_ADD',
    '作業タスク追加',
    `新規タスク「${title}」${shortName ? ` (短縮: ${shortName})` : ''}を追加しました。`
  );

  return shipment;
}

// Delete Dynamic Task from Shipment
export function deleteTaskFromShipment(shipmentId: string, taskId: string): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  const currentUser = getCurrentUser();
  const task = shipment.tasks.find((t) => t.id === taskId);
  if (!task) return undefined;

  shipment.tasks = shipment.tasks.filter((t) => t.id !== taskId);
  shipment.status = calculateShipmentStatus(shipment.tasks);
  shipment.updatedAt = new Date().toISOString();
  ensureShipmentPdf(shipment);

  saveShipments(shipments);

  addActivityLog(
    shipmentId,
    currentUser,
    'TASK_DELETE',
    '作業タスク削除',
    `タスク「${task.title}」を削除しました。`
  );

  return shipment;
}

// Reorder Tasks
export function reorderTasks(shipmentId: string, reorderedTasks: Task[]): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  shipment.tasks = reorderedTasks.map((t, idx) => ({
    ...t,
    order: idx + 1,
  }));
  shipment.updatedAt = new Date().toISOString();
  ensureShipmentPdf(shipment);

  saveShipments(shipments);
  return shipment;
}

// Delete Entire Shipment
export function deleteShipment(shipmentId: string): void {
  const target = getShipmentById(shipmentId);
  const aliases = target ? [target.hawbNumber, target.mawbNumber].filter((x): x is string => Boolean(x)) : [];

  // Register deletion tracking for batch
  pendingDeletedShipmentIds.add(shipmentId);

  // Directly & immediately invoke deleteDoc on Firestore for instant server-side deletion
  try {
    deleteDoc(doc(db, 'shipments', shipmentId)).catch((err) => {
      console.warn('Direct Firestore deleteDoc warning:', err);
    });
  } catch (e) {
    console.warn('Direct deleteDoc invocation warning:', e);
  }

  // Clean up associated PDF storage & cache asynchronously
  deletePdfFromStorage(shipmentId, aliases).catch(() => {});

  const shipments = getShipments().filter((s) => s.id !== shipmentId);
  saveShipments(shipments);
}

// Update Shipment Flags (isImportant, isUrgent, isDgCargo)
export function updateShipmentFlags(
  shipmentId: string,
  updates: Partial<Pick<Shipment, 'isImportant' | 'isUrgent' | 'isDgCargo'>>
): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  const currentUser = getCurrentUser();
  const changedFields: string[] = [];

  if (updates.isImportant !== undefined && updates.isImportant !== shipment.isImportant) {
    shipment.isImportant = updates.isImportant;
    changedFields.push(`重要フラグ: ${updates.isImportant ? 'ON' : 'OFF'}`);
  }
  if (updates.isUrgent !== undefined && updates.isUrgent !== shipment.isUrgent) {
    shipment.isUrgent = updates.isUrgent;
    changedFields.push(`緊急フラグ: ${updates.isUrgent ? 'ON' : 'OFF'}`);
  }
  if (updates.isDgCargo !== undefined && updates.isDgCargo !== shipment.isDgCargo) {
    shipment.isDgCargo = updates.isDgCargo;
    changedFields.push(`DG設定: ${updates.isDgCargo ? 'ON' : 'OFF'}`);
  }

  shipment.updatedAt = new Date().toISOString();
  saveShipments(shipments);

  if (changedFields.length > 0) {
    addActivityLog(
      shipmentId,
      currentUser,
      'STATUS_CHANGE',
      '案件属性・フラグ更新',
      `フラグ変更: ${changedFields.join(' / ')}`
    );
  }

  return shipment;
}

// Update Shipment Fields (MAWB, HAWB, Pieces, Weight, Shipper, Consignee, Flight, Clearance Date, Assigned Operator)
export function updateShipmentFields(
  shipmentId: string,
  updates: {
    mawbNumber?: string;
    hawbNumber?: string | null;
    pieces?: string | null;
    grossWeight?: string | null;
    shipper?: string;
    consignee?: string;
    portOfLoading?: string | null;
    destination?: string | null;
    flag?: string | null;
    flightRoute?: string;
    customsClearanceDate?: string;
    cutTime?: string | null;
    assignedOperator?: Operator | null;
  }
): Shipment | undefined {
  const shipments = getShipments();
  const index = shipments.findIndex((s) => s.id === shipmentId);
  if (index === -1) return undefined;

  const currentShipment = shipments[index];
  const shipment: Shipment = { ...currentShipment };
  const currentUser = getCurrentUser();
  const changedList: string[] = [];

  if (updates.mawbNumber !== undefined && updates.mawbNumber !== shipment.mawbNumber) {
    changedList.push(`MAWB番号: ${shipment.mawbNumber} → ${updates.mawbNumber}`);
    shipment.mawbNumber = updates.mawbNumber.trim();
  }
  if (updates.hawbNumber !== undefined && updates.hawbNumber !== shipment.hawbNumber) {
    const oldHawb = shipment.hawbNumber || '未割当';
    const newHawb = updates.hawbNumber && updates.hawbNumber.trim() ? updates.hawbNumber.trim() : null;
    changedList.push(`HAWB番号: ${oldHawb} → ${newHawb || '未割当'}`);
    shipment.hawbNumber = newHawb;
  }
  if (updates.pieces !== undefined && updates.pieces !== shipment.pieces) {
    changedList.push(`個数: ${shipment.pieces || '-'} → ${updates.pieces || '-'}`);
    shipment.pieces = updates.pieces && updates.pieces.trim() ? updates.pieces.trim() : null;
  }
  if (updates.grossWeight !== undefined && updates.grossWeight !== shipment.grossWeight) {
    changedList.push(`重量: ${shipment.grossWeight || '-'} → ${updates.grossWeight || '-'}`);
    shipment.grossWeight = updates.grossWeight && updates.grossWeight.trim() ? updates.grossWeight.trim() : null;
  }
  if (updates.shipper !== undefined && updates.shipper !== shipment.shipper) {
    changedList.push(`SHIPPER: ${shipment.shipper} → ${updates.shipper}`);
    shipment.shipper = updates.shipper.trim();
  }
  if (updates.consignee !== undefined && updates.consignee !== shipment.consignee) {
    changedList.push(`CONSIGNEE: ${shipment.consignee} → ${updates.consignee}`);
    shipment.consignee = updates.consignee.trim();
  }
  if (updates.portOfLoading !== undefined && updates.portOfLoading !== shipment.portOfLoading) {
    const oldPol = shipment.portOfLoading || '未設定';
    const newPol = updates.portOfLoading && updates.portOfLoading.trim() ? updates.portOfLoading.trim() : null;
    changedList.push(`積地: ${oldPol} → ${newPol || '未設定'}`);
    shipment.portOfLoading = newPol;
  }
  if (updates.destination !== undefined && updates.destination !== shipment.destination) {
    const oldDest = shipment.destination || '未設定';
    const newDest = updates.destination && updates.destination.trim() ? updates.destination.trim() : null;
    changedList.push(`向地(DEST): ${oldDest} → ${newDest || '未設定'}`);
    shipment.destination = newDest;
  }
  if (updates.flag !== undefined && updates.flag !== shipment.flag) {
    const oldFlag = shipment.flag || '未設定';
    const newFlag = updates.flag && updates.flag.trim() ? updates.flag.trim() : null;
    changedList.push(`FLAG (船籍): ${oldFlag} → ${newFlag || '未設定'}`);
    shipment.flag = newFlag;
  }
  if (updates.flightRoute !== undefined && updates.flightRoute !== shipment.flightRoute) {
    changedList.push(`フライト: ${shipment.flightRoute} → ${updates.flightRoute}`);
    shipment.flightRoute = updates.flightRoute.trim();
  }

  if (updates.cutTime !== undefined && updates.cutTime !== shipment.cutTime) {
    changedList.push(`カット時間: ${shipment.cutTime || '未設定'} → ${updates.cutTime || '未設定'}`);
    shipment.cutTime = updates.cutTime;
  }
  if (updates.customsClearanceDate !== undefined && updates.customsClearanceDate !== shipment.customsClearanceDate) {
    changedList.push(`通関予定日: ${shipment.customsClearanceDate} → ${updates.customsClearanceDate}`);
    shipment.customsClearanceDate = updates.customsClearanceDate.trim();
  }
  if (updates.assignedOperator !== undefined) {
    const prevName = shipment.assignedOperator ? shipment.assignedOperator.name : '未割当';
    const newName = updates.assignedOperator ? updates.assignedOperator.name : '未割当';
    if (prevName !== newName) {
      changedList.push(`担当者: ${prevName} → ${newName}`);
      shipment.assignedOperator = updates.assignedOperator || null;
    }
  }

  // Update primary key ID if hawb/mawb changed
  const newPrimaryId = (shipment.hawbNumber && shipment.hawbNumber.trim() !== '')
    ? shipment.hawbNumber.trim()
    : shipment.mawbNumber.trim();

  if (newPrimaryId && newPrimaryId !== shipment.id) {
    const oldId = shipment.id;
    shipment.id = newPrimaryId;
    rekeyPdfStorage(oldId, newPrimaryId);
  }

  shipment.updatedAt = new Date().toISOString();
  ensureShipmentPdf(shipment);

  shipments[index] = shipment;
  saveShipmentsHelper(shipments);

  if (changedList.length > 0) {
    addActivityLog(
      shipment.id,
      currentUser,
      'STATUS_CHANGE',
      '案件基本情報の変更・更新',
      `✏️ 以下の情報が更新されました:\n${changedList.join('\n')}`
    );
  }

  return shipment;
}

// Add Comment to Shipment
export function addCommentToShipment(
  shipmentId: string,
  content: string,
  authorName?: string,
  isImportant?: boolean
): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  const currentUser = getCurrentUser();
  const now = new Date();
  const formattedTime = now.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const newComment: ShipmentComment = {
    id: `cmt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    shipmentId,
    authorName: (authorName && authorName.trim() !== '') ? authorName.trim() : currentUser.displayName || 'チームメンバー',
    authorEmail: currentUser.email,
    createdAt: now.toISOString(),
    formattedTime,
    content: content.trim(),
    isImportant: !!isImportant,
  };

  if (!shipment.comments) {
    shipment.comments = [];
  }
  shipment.comments.unshift(newComment);
  shipment.updatedAt = now.toISOString();

  saveShipments(shipments);

  const previewStr = content.length > 25 ? `${content.slice(0, 25)}...` : content;
  addActivityLog(
    shipmentId,
    currentUser,
    'STATUS_CHANGE',
    'チームコメント投稿',
    `💬 コメント投稿 (${newComment.authorName}${isImportant ? ' ★重要' : ''}): 「${previewStr}」`
  );

  return shipment;
}

// Toggle Comment Important Flag
export function toggleCommentImportant(shipmentId: string, commentId: string): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment || !shipment.comments) return undefined;

  const targetComment = shipment.comments.find((c) => c.id === commentId);
  if (!targetComment) return undefined;

  targetComment.isImportant = !targetComment.isImportant;
  shipment.updatedAt = new Date().toISOString();

  saveShipments(shipments);
  return shipment;
}

// Delete Comment from Shipment
export function deleteCommentFromShipment(shipmentId: string, commentId: string): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment || !shipment.comments) return undefined;

  shipment.comments = shipment.comments.filter((c) => c.id !== commentId);
  shipment.updatedAt = new Date().toISOString();

  saveShipments(shipments);
  return shipment;
}

// Reorder tasks of a shipment
export function reorderShipmentTasks(shipmentId: string, newTasks: Task[]): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  // Update order property for each task
  shipment.tasks = newTasks.map((t, index) => ({
    ...t,
    order: index + 1,
  }));
  shipment.updatedAt = new Date().toISOString();

  // Re-generate PDF Data URL with new task order and styles
  ensureShipmentPdf(shipment);

  saveShipments(shipments);

  const currentUser = getCurrentUser();
  addActivityLog(
    shipmentId,
    currentUser,
    'STATUS_CHANGE',
    '工程タスク順序変更',
    `🔄 工程タスクの順序が並べ替えられました (${shipment.tasks.length}件)`
  );

  return shipment;
}

/**
 * Toggle Pin (ピン留め) status for a shipment
 */
export function togglePinShipment(shipmentId: string): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  const newPinState = !shipment.isPinned;
  shipment.isPinned = newPinState;
  shipment.updatedAt = new Date().toISOString();

  saveShipments(shipments);

  // Sync to Firestore automatically in background
  // Handled by saveShipmentsHelper

  const currentUser = getCurrentUser();
  addActivityLog(
    shipmentId,
    currentUser,
    'STATUS_CHANGE',
    'ピン留め変更',
    newPinState ? '📌 案件を最上部にピン留めしました' : '📌 案件のピン留めを解除しました'
  );

  return shipment;
}

// Reset Store to Initial Demo Data
export function resetToDemoData(): void {
  localStorage.setItem(STORAGE_KEYS.SHIPMENTS, JSON.stringify(INITIAL_SHIPMENTS));
  localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(INITIAL_LOGS));
  notifyListeners();
}

/**
 * Requirement: Progress Milestones ('貨物搬入済', 'X線検査結果入手', '許可書入手', '請求書メール')
 * Update milestone status, save locally & sync automatically to Firestore with timestamp.
 */
export function updateShipmentMilestones(
  shipmentId: string,
  milestoneKey: MilestoneKey,
  completed: boolean
): Shipment | undefined {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return undefined;

  const now = new Date();
  const formattedTime = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const defaultMilestones: MilestoneState[] = [
    { key: 'document_received', label: '貨物搬入済', completed: false, completedAt: null },
    { key: 'customs_cleared', label: 'X線検査結果入手', completed: false, completedAt: null },
    { key: 'customs_permit', label: '許可書入手', completed: false, completedAt: null },
    { key: 'onboarded', label: '請求書メール', completed: false, completedAt: null },
  ];

  const existingMap = new Map<MilestoneKey, MilestoneState>(
    (shipment.milestones || []).map((m) => [m.key, m])
  );
  const currentMilestones: MilestoneState[] = defaultMilestones.map((def) => {
    const existing = existingMap.get(def.key);
    if (existing) {
      return {
        key: def.key,
        label: def.label,
        completed: !!existing.completed,
        completedAt: existing.completedAt || null,
        updatedAt: existing.updatedAt || null,
      };
    }
    return def;
  });

  const targetIdx = currentMilestones.findIndex((m) => m.key === milestoneKey);
  if (targetIdx >= 0) {
    currentMilestones[targetIdx] = {
      ...currentMilestones[targetIdx],
      completed,
      completedAt: completed ? formattedTime : null,
      updatedAt: now.toISOString(),
    };
  }

  shipment.milestones = currentMilestones;
  shipment.updatedAt = now.toISOString();

  // Save to LocalStorage & notify UI listeners
  saveShipments(shipments);

  // Sync to Firestore automatically in background without blocking UI
  // Handled by saveShipmentsHelper

  // Activity Log
  const currentUser = getCurrentUser();
  const milestoneLabel = currentMilestones[targetIdx]?.label || milestoneKey;
  const statusStr = completed ? `完了 (${formattedTime})` : '未完了';
  addActivityLog(
    shipmentId,
    currentUser,
    'STATUS_CHANGE',
    'マイルストーン更新',
    `🚩 マイルストーン「${milestoneLabel}」を【${statusStr}】に変更しました。`
  );

  return shipment;
}

// Update / Re-upload Shipment PDF Data URL
export function updateShipmentPdf(shipmentId: string, pdfDataUrl: string): Shipment | undefined {
  const shipments = getShipments();
  const index = shipments.findIndex((s) => s.id === shipmentId);
  if (index === -1) return undefined;

  const currentShipment = shipments[index];
  const updatedShipment: Shipment = {
    ...currentShipment,
    hasCustomPdf: true,
    originalPdfUrl: pdfDataUrl,
    pdfDataUrl: pdfDataUrl,
    updatedAt: new Date().toISOString(),
  };

  const aliases = [updatedShipment.hawbNumber, updatedShipment.mawbNumber].filter(Boolean) as string[];
  savePdfToStorage(updatedShipment.id, pdfDataUrl, aliases);

  shipments[index] = updatedShipment;
  saveShipments(shipments);

  const currentUser = getCurrentUser();
  addActivityLog(
    updatedShipment.id,
    currentUser,
    'TASK_UPDATE',
    'PDF再アップロード',
    '📄 指示書PDFが再アップロード・更新されました。'
  );

  return updatedShipment;
}

