import { Shipment, M365Settings, OneDriveFileItem, OneDriveDocType, EmailAttachment } from '../types';
import { getM365Settings } from './m365EmailService';

const ONEDRIVE_FILES_STORAGE_KEY_PREFIX = 'export_mgmt_onedrive_files_';

// Listeners for OneDrive file updates
const fileListeners = new Set<(shipmentId: string) => void>();

export function subscribeOneDriveFiles(callback: (shipmentId: string) => void): () => void {
  fileListeners.add(callback);
  return () => {
    fileListeners.delete(callback);
  };
}

function notifyOneDriveFilesChanged(shipmentId: string) {
  fileListeners.forEach((fn) => {
    try {
      fn(shipmentId);
    } catch (e) {
      console.error(e);
    }
  });
}

/**
 * Clean and format string for safe OneDrive path
 */
function sanitizePathSegment(str: string): string {
  return str
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Format date string YYYYMMDD
 */
function formatDateToYYYYMMDD(dateStr?: string): string {
  if (!dateStr) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
  const clean = dateStr.replace(/[^0-9]/g, '');
  if (clean.length === 8) return clean;
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Generate full folder path for a shipment based on selected storage provider
 * Format: [Base Path] / [YYYYMMDD] / [AWB] [CONSIGNEE]
 */
export function getShipmentOneDriveFolderPath(shipment: Shipment, settings?: M365Settings): string {
  const currentSettings = settings || getM365Settings();
  const provider = currentSettings.storageProvider || 'onedrive';

  let rawBase = '';
  if (provider === 'googledrive') {
    rawBase = (currentSettings.googleDriveBasePath || 'HELLMANN').trim();
  } else {
    rawBase = currentSettings.oneDriveBasePath?.trim() || '/TAC大阪IBP関連/USER/●サブエージェント/HELLMANN';
  }
  const basePath = rawBase.startsWith('/') ? rawBase : (provider === 'googledrive' ? rawBase : `/${rawBase}`);

  // Date folder (Priority: customsClearanceDate -> createdAt)
  const targetDate = shipment.customsClearanceDate || shipment.createdAt;
  const dateFolder = formatDateToYYYYMMDD(targetDate);

  // Shipment subfolder
  const awb = shipment.hawbNumber || shipment.mawbNumber || shipment.orderNumber || `SHIP-${shipment.id.slice(0, 8)}`;
  const consignee = shipment.consignee || 'UNKNOWN_CONSIGNEE';
  const folderName = sanitizePathSegment(`[${awb}] ${consignee}`);

  return `${basePath.replace(/\/+$/, '')}/${dateFolder}/${folderName}`;
}

export const getShipmentCloudStorageFolderPath = getShipmentOneDriveFolderPath;

/**
 * Helper to resolve effective credentials for OneDrive operations
 */
export function getOneDriveEffectiveCredentials(settings: M365Settings): {
  tenantId: string;
  clientId: string;
  clientSecret?: string;
  userEmail: string;
} {
  const useSeparate = settings.useSeparateOneDriveCredentials;
  const tenantId = (useSeparate && settings.oneDriveTenantId?.trim())
    ? settings.oneDriveTenantId.trim()
    : (settings.tenantId || '').trim();
  const clientId = (useSeparate && settings.oneDriveClientId?.trim())
    ? settings.oneDriveClientId.trim()
    : (settings.clientId || '').trim();
  const clientSecret = (useSeparate && settings.oneDriveClientSecret?.trim())
    ? settings.oneDriveClientSecret.trim()
    : (settings.clientSecret || '').trim();
  const userEmail = (settings.oneDriveUserEmail || settings.userPrincipalName || settings.groupEmail || '').trim();

  return { tenantId, clientId, clientSecret, userEmail };
}

/**
 * Test connection to Google Drive
 */
export async function testGoogleDriveConnection(settings?: Partial<M365Settings>): Promise<{
  success: boolean;
  message: string;
  folderPath?: string;
  driveInfo?: any;
}> {
  const current = settings ? { ...getM365Settings(), ...settings } : getM365Settings();

  if (current.isDemoMode) {
    const samplePath = (current.googleDriveBasePath || 'HELLMANN').trim();
    return {
      success: true,
      message: `Google ドライブ 接続成功 (デモモード): 保管先 [${samplePath}] のシミュレーション環境が確認できました。`,
      folderPath: samplePath,
    };
  }

  try {
    const res = await fetch('/api/storage/gdrive/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        googleDriveServiceAccountEmail: current.googleDriveServiceAccountEmail,
        googleDrivePrivateKey: current.googleDrivePrivateKey,
        googleDriveServiceAccountKeyJson: current.googleDriveServiceAccountKeyJson,
        googleDriveApiKey: current.googleDriveApiKey,
        googleDriveRootFolderId: current.googleDriveRootFolderId,
        googleDriveBasePath: current.googleDriveBasePath || 'HELLMANN',
        googleDriveUserEmail: current.googleDriveUserEmail,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        message: data?.error || data?.message || `Google ドライブ 接続確認に失敗しました (HTTP ${res.status})`,
      };
    }

    return {
      success: true,
      message: data.message || 'Google ドライブ 接続成功: サービスアカウント権限が正常に確認されました。',
      folderPath: data.folderPath,
      driveInfo: data.driveInfo,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Google ドライブ 接続エラー: ${err.message || '通信エラーが発生しました'}`,
    };
  }
}

/**
 * Test connection to OneDrive and check target base folder via Microsoft Graph API
 */
export async function testOneDriveConnection(settings?: Partial<M365Settings>): Promise<{
  success: boolean;
  message: string;
  folderPath?: string;
  driveInfo?: any;
}> {
  const current = settings ? { ...getM365Settings(), ...settings } : getM365Settings();
  const creds = getOneDriveEffectiveCredentials(current);

  if (current.isDemoMode) {
    const samplePath = (current.oneDriveBasePath || '/TAC大阪IBP関連/USER/●サブエージェント/HELLMANN').trim();
    return {
      success: true,
      message: `OneDrive 接続成功 (デモモード): 保管先 [${samplePath}] のシミュレーション環境が確認できました。`,
      folderPath: samplePath,
    };
  }

  if (!creds.tenantId || !creds.clientId) {
    return {
      success: false,
      message: 'OneDrive用のテナントIDおよびクライアントIDが設定されていません。認証情報を入力してください。',
    };
  }

  try {
    const res = await fetch('/api/m365/onedrive/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: creds.tenantId,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        groupEmail: current.groupEmail,
        userPrincipalName: current.userPrincipalName,
        oneDriveUserEmail: current.oneDriveUserEmail,
        oneDriveBasePath: current.oneDriveBasePath || '/TAC大阪IBP関連/USER/●サブエージェント/HELLMANN',
        useSeparateOneDriveCredentials: current.useSeparateOneDriveCredentials,
        oneDriveTenantId: current.oneDriveTenantId,
        oneDriveClientId: current.oneDriveClientId,
        oneDriveClientSecret: current.oneDriveClientSecret,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        message: data?.error || data?.message || `OneDrive 接続確認に失敗しました (HTTP ${res.status})`,
      };
    }

    return {
      success: true,
      message: data.message || 'OneDrive 接続成功: フォルダアクセスおよび権限が正常に確認されました。',
      folderPath: data.folderPath,
      driveInfo: data.driveInfo,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `OneDrive 接続エラー: ${err.message || '通信エラーが発生しました'}`,
    };
  }
}

/**
 * Unified Cloud Storage Connection Test (OneDrive or Google Drive based on settings)
 */
export async function testCloudStorageConnection(settings?: Partial<M365Settings>): Promise<{
  success: boolean;
  message: string;
  folderPath?: string;
  driveInfo?: any;
}> {
  const current = settings ? { ...getM365Settings(), ...settings } : getM365Settings();
  if (current.storageProvider === 'googledrive') {
    return testGoogleDriveConnection(settings);
  }
  return testOneDriveConnection(settings);
}

/**
 * Get initial default sample documents for a shipment (Invoice, Certificate, SI)
 */
function getInitialDefaultFiles(shipment: Shipment, folderPath: string): OneDriveFileItem[] {
  const awb = shipment.hawbNumber || shipment.mawbNumber || 'AWB-MAIN';
  const now = new Date().toISOString();

  return [
    {
      id: `doc_inv_${shipment.id}`,
      name: `INVOICE_${awb}.pdf`,
      docType: 'INVOICE',
      size: 142800,
      folderPath,
      lastModified: now,
      contentType: 'application/pdf',
      isUploadedToGraph: true,
      webUrl: `https://tacjapan-my.sharepoint.com/personal/onedrive/${encodeURIComponent(folderPath)}/INVOICE_${awb}.pdf`,
    },
    {
      id: `doc_nonapp_${shipment.id}`,
      name: `非該当判定書_${awb}.pdf`,
      docType: 'NON_APPLICABLE_CERT',
      size: 89400,
      folderPath,
      lastModified: now,
      contentType: 'application/pdf',
      isUploadedToGraph: true,
      webUrl: `https://tacjapan-my.sharepoint.com/personal/onedrive/${encodeURIComponent(folderPath)}/非該当判定書_${awb}.pdf`,
    },
    {
      id: `doc_pl_${shipment.id}`,
      name: `PACKING_LIST_${awb}.xlsx`,
      docType: 'PACKING_LIST',
      size: 64200,
      folderPath,
      lastModified: now,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      isUploadedToGraph: true,
      webUrl: `https://tacjapan-my.sharepoint.com/personal/onedrive/${encodeURIComponent(folderPath)}/PACKING_LIST_${awb}.xlsx`,
    },
    {
      id: `doc_si_${shipment.id}`,
      name: `通関依頼書(SI)_${awb}.pdf`,
      docType: 'SI',
      size: 198500,
      folderPath,
      lastModified: now,
      contentType: 'application/pdf',
      isUploadedToGraph: true,
      webUrl: `https://tacjapan-my.sharepoint.com/personal/onedrive/${encodeURIComponent(folderPath)}/通関依頼書(SI)_${awb}.pdf`,
    },
  ];
}

/**
 * List all files in the cloud storage folder (OneDrive or Google Drive) for a shipment
 */
export async function listOneDriveFilesForShipment(
  shipment: Shipment,
  settings?: M365Settings
): Promise<OneDriveFileItem[]> {
  const currentSettings = settings || getM365Settings();
  const provider = currentSettings.storageProvider || 'onedrive';
  const folderPath = getShipmentOneDriveFolderPath(shipment, currentSettings);
  const storageKey = `${ONEDRIVE_FILES_STORAGE_KEY_PREFIX}${shipment.id}`;
  const creds = getOneDriveEffectiveCredentials(currentSettings);

  // Google Drive Provider Mode
  if (provider === 'googledrive') {
    if (!currentSettings.isDemoMode) {
      try {
        const res = await fetch('/api/storage/gdrive/list-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            googleDriveServiceAccountEmail: currentSettings.googleDriveServiceAccountEmail,
            googleDrivePrivateKey: currentSettings.googleDrivePrivateKey,
            googleDriveServiceAccountKeyJson: currentSettings.googleDriveServiceAccountKeyJson,
            googleDriveApiKey: currentSettings.googleDriveApiKey,
            googleDriveRootFolderId: currentSettings.googleDriveRootFolderId,
            googleDriveBasePath: currentSettings.googleDriveBasePath || 'HELLMANN',
            googleDriveUserEmail: currentSettings.googleDriveUserEmail,
            folderPath,
            awbNumber: shipment.hawbNumber || shipment.mawbNumber || shipment.orderNumber || shipment.id,
            consignee: shipment.consignee,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.files)) {
            localStorage.setItem(storageKey, JSON.stringify(data.files));
            return data.files;
          }
          if (data.error) {
            console.error('Google Drive list-files returned error:', data.error);
          }
        } else {
          const errData = await res.json().catch(() => ({ error: 'サーバー通信エラー' }));
          console.error('Google Drive list-files HTTP error:', errData);
        }
      } catch (e) {
        console.warn('Google Drive list error, falling back to cached files:', e);
      }
    }
  } else {
    // OneDrive Graph API Provider Mode
    if (!currentSettings.isDemoMode && creds.tenantId && creds.clientId && creds.clientSecret) {
      try {
        const res = await fetch('/api/m365/onedrive/list-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: creds.tenantId,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            groupEmail: currentSettings.groupEmail,
            userPrincipalName: currentSettings.userPrincipalName,
            oneDriveUserEmail: currentSettings.oneDriveUserEmail,
            folderPath,
            useSeparateOneDriveCredentials: currentSettings.useSeparateOneDriveCredentials,
            oneDriveTenantId: currentSettings.oneDriveTenantId,
            oneDriveClientId: currentSettings.oneDriveClientId,
            oneDriveClientSecret: currentSettings.oneDriveClientSecret,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.files)) {
            localStorage.setItem(storageKey, JSON.stringify(data.files));
            return data.files;
          }
        }
      } catch (e) {
        console.warn('Graph API OneDrive list error, falling back to cached files:', e);
      }
    }
  }

  // Fallback to local cache
  const raw = localStorage.getItem(storageKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Filter out legacy hardcoded sample files if cloud storage is configured
        const isCloudConfigured = provider === 'googledrive'
          ? !!(currentSettings.googleDriveServiceAccountKeyJson || currentSettings.googleDriveServiceAccountEmail)
          : !!(creds.tenantId && creds.clientId);
        if (isCloudConfigured) {
          const cleaned = parsed.filter((f: any) => !f.id?.startsWith('doc_inv_') && !f.id?.startsWith('doc_nonapp_') && !f.id?.startsWith('doc_pl_') && !f.id?.startsWith('doc_si_'));
          return cleaned;
        }
        return parsed;
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Only if strictly in pure demo mode without cloud auth, show initial demo templates
  if (currentSettings.isDemoMode) {
    const defaults = getInitialDefaultFiles(shipment, folderPath);
    localStorage.setItem(storageKey, JSON.stringify(defaults));
    return defaults;
  }

  return [];
}

export const listCloudStorageFilesForShipment = listOneDriveFilesForShipment;

/**
 * Upload a document to the shipment's cloud storage folder (OneDrive or Google Drive)
 */
export async function uploadFileToOneDrive(
  shipment: Shipment,
  file: File,
  docType: OneDriveDocType = 'OTHER',
  settings?: M365Settings
): Promise<OneDriveFileItem> {
  const currentSettings = settings || getM365Settings();
  const provider = currentSettings.storageProvider || 'onedrive';
  const folderPath = getShipmentOneDriveFolderPath(shipment, currentSettings);
  const storageKey = `${ONEDRIVE_FILES_STORAGE_KEY_PREFIX}${shipment.id}`;
  const creds = getOneDriveEffectiveCredentials(currentSettings);

  // Read file as Base64 for local preview
  const base64 = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });

  const fileItem: OneDriveFileItem = {
    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    docType,
    size: file.size,
    contentType: file.type || 'application/octet-stream',
    folderPath,
    lastModified: new Date().toISOString(),
    isUploadedToGraph: false,
    dataBase64: base64,
    webUrl: provider === 'googledrive'
      ? `https://drive.google.com/drive/u/0/folders/`
      : `https://tacjapan-my.sharepoint.com/personal/onedrive/${encodeURIComponent(folderPath)}/${encodeURIComponent(file.name)}`,
  };

  // Google Drive Provider Mode
  if (provider === 'googledrive') {
    const hasGoogleAuth = currentSettings.googleDriveServiceAccountKeyJson ||
      (currentSettings.googleDriveServiceAccountEmail && currentSettings.googleDrivePrivateKey);

    if (!currentSettings.isDemoMode && hasGoogleAuth) {
      try {
        const res = await fetch('/api/storage/gdrive/upload-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            googleDriveServiceAccountEmail: currentSettings.googleDriveServiceAccountEmail,
            googleDrivePrivateKey: currentSettings.googleDrivePrivateKey,
            googleDriveServiceAccountKeyJson: currentSettings.googleDriveServiceAccountKeyJson,
            googleDriveApiKey: currentSettings.googleDriveApiKey,
            googleDriveRootFolderId: currentSettings.googleDriveRootFolderId,
            googleDriveBasePath: currentSettings.googleDriveBasePath || 'HELLMANN',
            googleDriveUserEmail: currentSettings.googleDriveUserEmail,
            folderPath,
            fileName: file.name,
            contentType: file.type || 'application/pdf',
            fileDataBase64: base64.split(',')[1] || base64,
            docType,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.file) {
            fileItem.id = data.file.id || fileItem.id;
            fileItem.isUploadedToGraph = true;
            fileItem.webUrl = data.file.webUrl || fileItem.webUrl;
            fileItem.downloadUrl = data.file.downloadUrl;
          }
        }
      } catch (e) {
        console.warn('Google Drive upload API error, saved locally:', e);
      }
    }
  } else {
    // OneDrive Graph API Provider Mode
    if (!currentSettings.isDemoMode && creds.tenantId && creds.clientId && creds.clientSecret) {
      try {
        const res = await fetch('/api/m365/onedrive/upload-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: creds.tenantId,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            groupEmail: currentSettings.groupEmail,
            userPrincipalName: currentSettings.userPrincipalName,
            oneDriveUserEmail: currentSettings.oneDriveUserEmail,
            folderPath,
            fileName: file.name,
            contentType: file.type,
            fileDataBase64: base64.split(',')[1] || base64,
            docType,
            useSeparateOneDriveCredentials: currentSettings.useSeparateOneDriveCredentials,
            oneDriveTenantId: currentSettings.oneDriveTenantId,
            oneDriveClientId: currentSettings.oneDriveClientId,
            oneDriveClientSecret: currentSettings.oneDriveClientSecret,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.file) {
            fileItem.isUploadedToGraph = true;
            fileItem.webUrl = data.file.webUrl || fileItem.webUrl;
            fileItem.downloadUrl = data.file.downloadUrl;
          }
        }
      } catch (e) {
        console.warn('OneDrive upload API error, saved locally:', e);
      }
    }
  }

  // Save to local store
  const existing = await listOneDriveFilesForShipment(shipment, currentSettings);
  const updated = [fileItem, ...existing.filter((f) => f.name !== fileItem.name)];
  localStorage.setItem(storageKey, JSON.stringify(updated));
  notifyOneDriveFilesChanged(shipment.id);

  return fileItem;
}

export const uploadFileToCloudStorage = uploadFileToOneDrive;

/**
 * Delete a file from cloud storage (OneDrive or Google Drive)
 */
export async function deleteOneDriveFile(
  shipment: Shipment,
  fileId: string,
  settings?: M365Settings
): Promise<boolean> {
  const currentSettings = settings || getM365Settings();
  const provider = currentSettings.storageProvider || 'onedrive';
  const storageKey = `${ONEDRIVE_FILES_STORAGE_KEY_PREFIX}${shipment.id}`;
  const creds = getOneDriveEffectiveCredentials(currentSettings);

  // 1. Immediately remove from local cached list
  const rawCache = localStorage.getItem(storageKey);
  let fileNameForLog = '';
  if (rawCache) {
    try {
      const parsed = JSON.parse(rawCache);
      if (Array.isArray(parsed)) {
        const item = parsed.find((f: any) => f.id === fileId);
        if (item) fileNameForLog = item.name;
        const filtered = parsed.filter((f: any) => f.id !== fileId);
        localStorage.setItem(storageKey, JSON.stringify(filtered));
      }
    } catch (e) {
      console.warn('Failed to parse cached files during delete:', e);
    }
  }

  // 2. Call remote cloud API if not demo mode
  if (!currentSettings.isDemoMode) {
    if (provider === 'googledrive') {
      const resp = await fetch('/api/storage/gdrive/delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleDriveServiceAccountEmail: currentSettings.googleDriveServiceAccountEmail,
          googleDrivePrivateKey: currentSettings.googleDrivePrivateKey,
          googleDriveServiceAccountKeyJson: currentSettings.googleDriveServiceAccountKeyJson,
          googleDriveApiKey: currentSettings.googleDriveApiKey,
          googleDriveRootFolderId: currentSettings.googleDriveRootFolderId,
          googleDriveBasePath: currentSettings.googleDriveBasePath || 'HELLMANN',
          googleDriveUserEmail: currentSettings.googleDriveUserEmail,
          fileId: fileId,
        }),
      });

      if (!resp.ok) {
        const errJson = (await resp.json().catch(() => ({}))) as any;
        throw new Error(errJson.error || `共有ドライブのファイル削除に失敗しました (HTTP ${resp.status})`);
      }
    } else if (creds.tenantId && creds.clientId && creds.clientSecret) {
      const resp = await fetch('/api/m365/onedrive/delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: creds.tenantId,
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          groupEmail: currentSettings.groupEmail,
          userPrincipalName: currentSettings.userPrincipalName,
          oneDriveUserEmail: currentSettings.oneDriveUserEmail,
          fileId: fileId,
          fileName: fileNameForLog,
          useSeparateOneDriveCredentials: currentSettings.useSeparateOneDriveCredentials,
          oneDriveTenantId: currentSettings.oneDriveTenantId,
          oneDriveClientId: currentSettings.oneDriveClientId,
          oneDriveClientSecret: currentSettings.oneDriveClientSecret,
        }),
      });

      if (!resp.ok) {
        const errJson = (await resp.json().catch(() => ({}))) as any;
        throw new Error(errJson.error || `OneDriveのファイル削除に失敗しました (HTTP ${resp.status})`);
      }
    }
  }

  notifyOneDriveFilesChanged(shipment.id);
  return true;
}

export const deleteCloudStorageFile = deleteOneDriveFile;

/**
 * Trigger file download or open preview
 */
export function downloadOrPreviewOneDriveFile(file: OneDriveFileItem): void {
  if (file.dataBase64) {
    const a = document.createElement('a');
    a.href = file.dataBase64;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  if (file.downloadUrl) {
    window.open(file.downloadUrl, '_blank');
    return;
  }

  if (file.webUrl) {
    window.open(file.webUrl, '_blank');
    return;
  }

  alert(`ファイル [${file.name}] のダウンロードURLが見つかりませんでした。`);
}

/**
 * Execute full diagnostic inspection for Google Drive storage
 */
export async function diagnoseGoogleDrive(shipment: Shipment, settings?: M365Settings): Promise<any> {
  const currentSettings = settings || getM365Settings();
  const awb = shipment.hawbNumber || shipment.mawbNumber || shipment.orderNumber || shipment.id;

  const res = await fetch('/api/storage/gdrive/diagnose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      googleDriveServiceAccountEmail: currentSettings.googleDriveServiceAccountEmail,
      googleDrivePrivateKey: currentSettings.googleDrivePrivateKey,
      googleDriveServiceAccountKeyJson: currentSettings.googleDriveServiceAccountKeyJson,
      googleDriveApiKey: currentSettings.googleDriveApiKey,
      googleDriveRootFolderId: currentSettings.googleDriveRootFolderId,
      googleDriveBasePath: currentSettings.googleDriveBasePath || 'HELLMANN',
      googleDriveUserEmail: currentSettings.googleDriveUserEmail,
      awbNumber: awb,
    }),
  });

  return await res.json();
}

/**
 * Fetch and prepare binary base64 attachments for selected cloud files
 */
export async function prepareEmailAttachmentsFromCloudFiles(
  files: OneDriveFileItem[]
): Promise<EmailAttachment[]> {
  const results: EmailAttachment[] = [];

  for (const file of files) {
    try {
      let dataUrl: string | undefined = file.dataBase64;
      let contentBytes: string | undefined = undefined;

      // If already base64 dataUrl
      if (dataUrl && dataUrl.includes('base64,')) {
        contentBytes = dataUrl.split('base64,')[1];
      }

      // If not yet fetched and is a cloud file
      if (!contentBytes && file.id) {
        // Try Google Drive download API with base64 format
        try {
          const resp = await fetch(
            `/api/storage/gdrive/download-file?fileId=${encodeURIComponent(file.id)}&format=base64`
          );
          if (resp.ok) {
            const json = await resp.json();
            if (json.success && json.dataBase64) {
              dataUrl = json.dataBase64;
              contentBytes = json.dataBase64.split('base64,')[1];
            }
          }
        } catch (e) {
          console.warn(`Failed to fetch base64 from Google Drive for ${file.name}:`, e);
        }

        // If still not fetched, try downloading from downloadUrl
        if (!contentBytes && file.downloadUrl) {
          try {
            const dlResp = await fetch(file.downloadUrl);
            if (dlResp.ok) {
              const blob = await dlResp.blob();
              const base64Str = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              dataUrl = base64Str;
              if (base64Str.includes('base64,')) {
                contentBytes = base64Str.split('base64,')[1];
              }
            }
          } catch (e) {
            console.warn(`Failed to fetch from downloadUrl for ${file.name}:`, e);
          }
        }
      }

      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      const contentType = isPdf ? 'application/pdf' : 'application/octet-stream';

      results.push({
        id: file.id,
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
        dataUrl,
        contentBytes,
        downloadUrl: file.downloadUrl || file.webUrl,
        isPdf,
      });
    } catch (err) {
      console.error(`Error preparing attachment for ${file.name}:`, err);
      // Still add metadata even if binary loading fails
      results.push({
        id: file.id,
        fileName: file.name,
        contentType: file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
        sizeBytes: file.size,
        downloadUrl: file.downloadUrl || file.webUrl,
        isPdf: file.name.toLowerCase().endsWith('.pdf'),
      });
    }
  }

  return results;
}

