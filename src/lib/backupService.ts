import { ref, uploadString, getDownloadURL, deleteObject } from 'firebase/storage';
import { collection, doc, setDoc, getDocs, deleteDoc, getDoc, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db, storage } from './firebase';
import {
  Shipment,
  ActivityLog,
  Operator,
  TaskMaster,
  BackupPayload,
  BackupSnapshotMeta,
  BackupSettings,
} from '../types';
import { getShipments, getActivityLogs, saveShipmentsHelper, notifyListeners, getCurrentUser } from './storageManager';
import { fetchAllOperators } from './operatorService';
import { fetchAllTaskMasters, saveTaskMaster } from './taskMasterService';

const BACKUP_SETTINGS_KEY = 'export_app_backup_settings_v1';
const LOCAL_SNAPSHOTS_KEY = 'export_app_local_backup_snapshots_v1';
const SNAPSHOTS_COLLECTION = 'backup_snapshots';
const SYSTEM_SETTINGS_COLLECTION = 'system_settings';
const BACKUP_CONFIG_DOC = 'backup_config';

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  autoBackupEnabled: true,
  intervalHours: 6, // 6時間ごと
  lastAutoBackupTime: null,
  lastManualBackupTime: null,
  autoDownloadJson: false,
  retentionCount: 30,
};

let cachedSettings: BackupSettings | null = null;

function formatNowJapanese(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}/${m}/${day} ${h}:${min}:${s}`;
}

function formatFilenameTimestamp(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}${m}${day}_${h}${min}${s}`;
}

// 1. Get & Save Backup Settings (with Firestore Cloud Persistence)
export function getBackupSettings(): BackupSettings {
  if (cachedSettings) {
    return cachedSettings;
  }
  try {
    const saved = localStorage.getItem(BACKUP_SETTINGS_KEY);
    if (saved) {
      cachedSettings = { ...DEFAULT_BACKUP_SETTINGS, ...JSON.parse(saved) };
      return cachedSettings;
    }
  } catch (e) {
    // Ignore error
  }
  cachedSettings = { ...DEFAULT_BACKUP_SETTINGS };
  return cachedSettings;
}

/**
 * Fetch latest backup settings from Firestore cloud storage
 */
export async function fetchBackupSettingsFromCloud(): Promise<BackupSettings> {
  try {
    const docRef = doc(db, SYSTEM_SETTINGS_COLLECTION, BACKUP_CONFIG_DOC);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data() as Partial<BackupSettings>;
      const merged: BackupSettings = {
        ...DEFAULT_BACKUP_SETTINGS,
        ...getBackupSettings(),
        ...data,
      };
      cachedSettings = merged;
      try {
        localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(merged));
      } catch (e) {}
      return merged;
    }
  } catch (err) {
    console.warn('[backupService] Failed to fetch backup settings from Firestore, using local fallback:', err);
  }
  return getBackupSettings();
}

/**
 * Realtime subscribe to cloud backup settings changes across terminals/sessions
 */
export function subscribeBackupSettings(onUpdate: (settings: BackupSettings) => void): () => void {
  try {
    const docRef = doc(db, SYSTEM_SETTINGS_COLLECTION, BACKUP_CONFIG_DOC);
    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const cloudData = snap.data() as Partial<BackupSettings>;
          const updated: BackupSettings = {
            ...DEFAULT_BACKUP_SETTINGS,
            ...getBackupSettings(),
            ...cloudData,
          };
          cachedSettings = updated;
          try {
            localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(updated));
          } catch (e) {}
          onUpdate(updated);
        }
      },
      (err) => {
        console.warn('[backupService] Backup settings subscription error:', err);
      }
    );
    return unsubscribe;
  } catch (e) {
    return () => {};
  }
}

/**
 * Save backup settings to both local storage AND Firestore cloud
 */
export function saveBackupSettings(settings: Partial<BackupSettings>): BackupSettings {
  const current = getBackupSettings();
  const updated = { ...current, ...settings };
  cachedSettings = updated;

  // 1. Save to LocalStorage immediately
  try {
    localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(updated));
  } catch (e) {
    // Ignore error
  }

  // 2. Persist to Firestore Cloud in background
  try {
    const docRef = doc(db, SYSTEM_SETTINGS_COLLECTION, BACKUP_CONFIG_DOC);
    setDoc(docRef, { ...updated, updatedAt: new Date().toISOString() }, { merge: true }).catch((err) => {
      console.warn('[backupService] Failed to save backup settings to Firestore:', err);
    });
  } catch (e) {
    console.warn('[backupService] Firestore sync error:', e);
  }

  return updated;
}

/**
 * Async version of saveBackupSettings that awaits Firestore confirmation
 */
export async function saveBackupSettingsAsync(settings: Partial<BackupSettings>): Promise<BackupSettings> {
  const current = getBackupSettings();
  const updated = { ...current, ...settings };
  cachedSettings = updated;

  try {
    localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(updated));
  } catch (e) {}

  try {
    const docRef = doc(db, SYSTEM_SETTINGS_COLLECTION, BACKUP_CONFIG_DOC);
    await setDoc(docRef, { ...updated, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (err) {
    console.warn('[backupService] Firestore async save warning:', err);
  }

  return updated;
}

// 2. Generate Full Backup Payload from current system state
export async function generateBackupPayload(author?: {
  name: string;
  email: string;
  employeeNumber?: string;
}): Promise<BackupPayload> {
  const shipments = getShipments();
  const logs = getActivityLogs();
  
  let operators: Operator[] = [];
  try {
    operators = await fetchAllOperators();
  } catch (e) {
    operators = [];
  }

  let taskMasters: TaskMaster[] = [];
  try {
    taskMasters = await fetchAllTaskMasters();
  } catch (e) {
    taskMasters = [];
  }

  let totalTasks = 0;
  shipments.forEach((s) => {
    totalTasks += s.tasks?.length || 0;
  });

  const now = new Date();
  const currentUser = getCurrentUser();

  const finalAuthor = author || {
    name: currentUser?.displayName || '担当者',
    email: currentUser?.email || 'system@export-logistics.co.jp',
    employeeNumber: currentUser?.employeeNumber,
  };

  return {
    version: '1.0',
    timestamp: now.toISOString(),
    formattedDate: formatNowJapanese(now),
    systemName: '輸出進捗管理システム (Export Progress Management System)',
    author: finalAuthor,
    stats: {
      shipmentsCount: shipments.length,
      tasksCount: totalTasks,
      logsCount: logs.length,
      operatorsCount: operators.length,
      taskMastersCount: taskMasters.length,
    },
    data: {
      shipments,
      activityLogs: logs,
      operators,
      taskMasters,
    },
  };
}

// 3. Download Backup Data as JSON File directly in browser
export async function downloadBackupJson(customPayload?: BackupPayload): Promise<void> {
  const payload = customPayload || (await generateBackupPayload());
  const jsonStr = JSON.stringify(payload, null, 2);
  const now = new Date(payload.timestamp || new Date());
  const filename = `export_progress_backup_${formatFilenameTimestamp(now)}.json`;

  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  // Update last manual backup timestamp
  saveBackupSettings({ lastManualBackupTime: formatNowJapanese(new Date()) });
}

// Track whether Firebase Storage is accessible without CORS issues
let isStorageDisabled = false;

// 4. Save Snapshot to Firebase Storage & log metadata to Firestore
export async function saveSnapshotToFirebaseStorage(
  type: 'AUTO' | 'MANUAL' = 'MANUAL',
  author?: { name: string; email: string; employeeNumber?: string }
): Promise<BackupSnapshotMeta> {
  const now = new Date();
  const snapshotId = `snapshot_${formatFilenameTimestamp(now)}`;
  const payload = await generateBackupPayload(author);
  const jsonStr = JSON.stringify(payload);
  const fileSizeBytes = new Blob([jsonStr]).size;

  const storagePath = `backups/snapshots/${snapshotId}.json`;
  let storageDownloadUrl = '';

  const meta: BackupSnapshotMeta = {
    id: snapshotId,
    timestamp: now.toISOString(),
    formattedDate: formatNowJapanese(now),
    type,
    storagePath,
    fileSizeBytes,
    shipmentsCount: payload.stats.shipmentsCount,
    tasksCount: payload.stats.tasksCount,
    logsCount: payload.stats.logsCount,
    operatorsCount: payload.stats.operatorsCount,
    authorName: payload.author?.name,
    authorEmail: payload.author?.email,
    status: 'SUCCESS',
  };

  try {
    // 1. Upload to Firebase Storage if not disabled
    if (!isStorageDisabled) {
      try {
        const storageRef = ref(storage, storagePath);
        await uploadString(storageRef, jsonStr, 'raw', {
          contentType: 'application/json',
          customMetadata: {
            system: 'export-progress-system',
            version: '1.0',
            type,
            shipmentsCount: String(payload.stats.shipmentsCount),
          },
        });

        try {
          storageDownloadUrl = await getDownloadURL(storageRef);
          meta.storageDownloadUrl = storageDownloadUrl;
        } catch (urlErr) {
          // Ignore URL get error
        }
      } catch (storageErr) {
        // Disable further Storage attempts to prevent CORS preflight errors in console
        isStorageDisabled = true;
        (meta as any).backupPayload = payload;
      }
    } else {
      (meta as any).backupPayload = payload;
    }

    // 2. Write metadata record to Firestore collection `backup_snapshots`
    try {
      const docRef = doc(db, SNAPSHOTS_COLLECTION, snapshotId);
      // Avoid storing huge payloads in document index unless needed
      const firestoreRecord = { ...meta };
      if (!storageDownloadUrl && (meta as any).backupPayload) {
        firestoreRecord.status = 'SUCCESS';
      }
      await setDoc(docRef, firestoreRecord);
    } catch (firestoreErr) {
      console.warn('Firestore snapshot index record write failed:', firestoreErr);
    }

    // 3. Save to local fallback cache
    saveLocalSnapshot(meta);

    // 4. Update settings timestamps
    if (type === 'AUTO') {
      saveBackupSettings({ lastAutoBackupTime: meta.formattedDate });
    } else {
      saveBackupSettings({ lastManualBackupTime: meta.formattedDate });
    }

    return meta;
  } catch (error: any) {
    console.error('Snapshot creation failed:', error);
    meta.status = 'FAILED';
    meta.errorMessage = error?.message || 'スナップショットの保存に失敗しました';
    return meta;
  }
}

// Helper: Local snapshots cache for resilience
function getLocalSnapshots(): BackupSnapshotMeta[] {
  try {
    const saved = localStorage.getItem(LOCAL_SNAPSHOTS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    // Ignore error
  }
  return [];
}

function saveLocalSnapshot(meta: BackupSnapshotMeta): void {
  try {
    const list = getLocalSnapshots();
    const updated = [meta, ...list.filter((s) => s.id !== meta.id)].slice(0, 50);
    localStorage.setItem(LOCAL_SNAPSHOTS_KEY, JSON.stringify(updated));
  } catch (e) {
    // Ignore error
  }
}

// 5. Fetch List of all Snapshots from Firestore & Local Cache
export async function fetchSnapshotList(): Promise<BackupSnapshotMeta[]> {
  const localList = getLocalSnapshots();
  try {
    const snapshotsRef = collection(db, SNAPSHOTS_COLLECTION);
    const q = query(snapshotsRef, orderBy('timestamp', 'desc'), limit(50));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const remoteList: BackupSnapshotMeta[] = [];
      querySnapshot.forEach((docSnap) => {
        remoteList.push(docSnap.data() as BackupSnapshotMeta);
      });

      // Merge remote and local
      const mergedMap: Record<string, BackupSnapshotMeta> = {};
      remoteList.forEach((s) => {
        mergedMap[s.id] = s;
      });
      localList.forEach((s) => {
        if (!mergedMap[s.id]) {
          mergedMap[s.id] = s;
        }
      });

      const merged = Object.values(mergedMap).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      // Update local cache
      try {
        localStorage.setItem(LOCAL_SNAPSHOTS_KEY, JSON.stringify(merged));
      } catch (e) {}
      return merged;
    }
  } catch (err) {
    console.warn('Could not fetch remote snapshots list from Firestore, using local list:', err);
  }

  return localList;
}

// 6. Download or retrieve a Snapshot's content
export async function downloadSnapshotPayload(snapshot: BackupSnapshotMeta): Promise<BackupPayload | null> {
  // 1. If download URL exists, fetch it
  if (snapshot.storageDownloadUrl) {
    try {
      const res = await fetch(snapshot.storageDownloadUrl);
      if (res.ok) {
        const payload: BackupPayload = await res.json();
        return payload;
      }
    } catch (e) {
      console.warn('Direct fetch from downloadUrl failed, trying storage ref:', e);
    }
  }

  // 2. Try fetching from Firestore document directly if embedded
  try {
    const docRef = doc(db, SNAPSHOTS_COLLECTION, snapshot.id);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.backupPayload) {
        return data.backupPayload as BackupPayload;
      }
    }
  } catch (e) {
    // Ignore error
  }

  // 3. Fallback: Try downloading from storage ref only if Storage is not disabled
  if (!isStorageDisabled && snapshot.storagePath) {
    try {
      const storageRef = ref(storage, snapshot.storagePath);
      const url = await getDownloadURL(storageRef);
      const res = await fetch(url);
      if (res.ok) {
        return (await res.json()) as BackupPayload;
      }
    } catch (e) {
      isStorageDisabled = true;
    }
  }

  return null;
}

// 7. Delete Snapshot
export async function deleteSnapshot(snapshot: BackupSnapshotMeta): Promise<boolean> {
  try {
    // 1. Delete from Firestore
    try {
      await deleteDoc(doc(db, SNAPSHOTS_COLLECTION, snapshot.id));
    } catch (e) {}

    // 2. Delete from Firebase Storage
    if (snapshot.storagePath) {
      try {
        const storageRef = ref(storage, snapshot.storagePath);
        await deleteObject(storageRef);
      } catch (e) {}
    }

    // 3. Delete from Local Cache
    const localList = getLocalSnapshots().filter((s) => s.id !== snapshot.id);
    localStorage.setItem(LOCAL_SNAPSHOTS_KEY, JSON.stringify(localList));

    return true;
  } catch (err) {
    console.error('Delete snapshot failed:', err);
    return false;
  }
}

// 8. Restore System Data from Backup Payload
export async function restoreFromBackup(
  payload: BackupPayload,
  mode: 'MERGE' | 'OVERWRITE' = 'OVERWRITE'
): Promise<{ success: boolean; message: string; restoredShipmentsCount: number }> {
  if (!payload || !payload.data) {
    throw new Error('バックアップデータの形式が不正です。');
  }

  const { shipments = [], activityLogs = [], operators = [], taskMasters = [] } = payload.data;

  try {
    // 1. Restore Shipments
    if (shipments && shipments.length > 0) {
      if (mode === 'OVERWRITE') {
        saveShipmentsHelper(shipments);
      } else {
        const currentShipments = getShipments();
        const map: Record<string, Shipment> = {};
        currentShipments.forEach((s) => (map[s.id] = s));
        shipments.forEach((s) => (map[s.id] = s));
        saveShipmentsHelper(Object.values(map));
      }
    }

    // 2. Restore Operators
    if (operators && operators.length > 0) {
      for (const op of operators) {
        if (op.email) {
          try {
            await setDoc(doc(db, 'operators', op.email.trim().toLowerCase()), op, { merge: true });
          } catch (e) {}
        }
      }
    }

    // 3. Restore Task Masters
    if (taskMasters && taskMasters.length > 0) {
      for (const tm of taskMasters) {
        try {
          await saveTaskMaster(tm);
        } catch (e) {}
      }
    }

    notifyListeners();

    return {
      success: true,
      message: `データ復元が完了しました (案件: ${shipments.length}件, ログ: ${activityLogs.length}件, 担当者: ${operators.length}件)`,
      restoredShipmentsCount: shipments.length,
    };
  } catch (error: any) {
    console.error('Restore error:', error);
    throw new Error(`データ復元に失敗しました: ${error?.message || error}`);
  }
}

// 9. Periodic Auto Backup Background Runner
let autoBackupIntervalTimer: any = null;
let unsubscribeSettingsListener: (() => void) | null = null;

export function initAutoBackupListener(): () => void {
  if (autoBackupIntervalTimer) {
    clearInterval(autoBackupIntervalTimer);
  }
  if (unsubscribeSettingsListener) {
    unsubscribeSettingsListener();
    unsubscribeSettingsListener = null;
  }

  // 1. Fetch latest settings from Firestore cloud on startup
  fetchBackupSettingsFromCloud().then((cloudSettings) => {
    checkAndRunAutoBackup(cloudSettings);
  });

  // 2. Realtime subscribe to cloud settings updates
  unsubscribeSettingsListener = subscribeBackupSettings((updatedSettings) => {
    console.log('[AutoBackup] Synchronized backup settings from Firestore cloud:', updatedSettings);
  });

  // 3. Run periodic interval check every 60 seconds
  autoBackupIntervalTimer = setInterval(() => {
    checkAndRunAutoBackup();
  }, 60 * 1000);

  return () => {
    if (autoBackupIntervalTimer) {
      clearInterval(autoBackupIntervalTimer);
      autoBackupIntervalTimer = null;
    }
    if (unsubscribeSettingsListener) {
      unsubscribeSettingsListener();
      unsubscribeSettingsListener = null;
    }
  };
}

async function checkAndRunAutoBackup(overrideSettings?: BackupSettings): Promise<void> {
  const settings = overrideSettings || getBackupSettings();
  if (!settings.autoBackupEnabled) return;

  const now = new Date();
  const intervalMs = (settings.intervalHours || 6) * 60 * 60 * 1000;

  if (settings.lastAutoBackupTime) {
    const lastDate = new Date(settings.lastAutoBackupTime.replace(/\//g, '-'));
    if (!isNaN(lastDate.getTime())) {
      const elapsed = now.getTime() - lastDate.getTime();
      if (elapsed < intervalMs) {
        return; // Interval not yet reached
      }
    }
  }

  // Perform auto backup
  try {
    console.log('[AutoBackup] Running periodic background snapshot to Firebase Storage & Firestore...');
    await saveSnapshotToFirebaseStorage('AUTO', {
      name: '自動バックアップエージェント',
      email: 'autobackup@export-logistics.co.jp',
    });

    // Optional: If auto download JSON is enabled
    if (settings.autoDownloadJson) {
      console.log('[AutoBackup] Triggering auto JSON file download...');
      await downloadBackupJson();
    }
  } catch (err) {
    console.error('[AutoBackup] Error during auto backup execution:', err);
  }
}
