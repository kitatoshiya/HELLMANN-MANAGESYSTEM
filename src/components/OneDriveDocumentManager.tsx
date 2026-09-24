import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Folder,
  UploadCloud,
  FileText,
  Shield,
  FileCheck,
  Download,
  Eye,
  Trash2,
  ExternalLink,
  RefreshCw,
  Plus,
  X,
  AlertCircle,
  CheckCircle2,
  Lock,
  Mail,
  File,
  FileSpreadsheet,
  Layers,
  Sparkles,
  LayoutGrid,
  List,
} from 'lucide-react';
import { Shipment, OneDriveFileItem, OneDriveDocType, M365Settings } from '../types';
import {
  getShipmentOneDriveFolderPath,
  listOneDriveFilesForShipment,
  uploadFileToOneDrive,
  deleteOneDriveFile,
  downloadOrPreviewOneDriveFile,
  subscribeOneDriveFiles,
  diagnoseGoogleDrive,
} from '../lib/oneDriveService';
import { getM365Settings } from '../lib/m365EmailService';
import { DocumentPreviewModal } from './DocumentPreviewModal';

interface OneDriveDocumentManagerProps {
  shipment: Shipment;
  settings?: M365Settings;
  onOpenCustomsEmailWithDocs?: (selectedFiles: OneDriveFileItem[]) => void;
  onFilesUpdated?: (files: OneDriveFileItem[]) => void;
}

const DOC_TYPE_META: Record<
  OneDriveDocType,
  { label: string; shortLabel: string; bg: string; text: string; border: string; icon: React.ComponentType<{ className?: string }> }
> = {
  INVOICE: {
    label: 'インボイス (Commercial Invoice)',
    shortLabel: 'インボイス',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    icon: FileText,
  },
  NON_APPLICABLE_CERT: {
    label: '該当/非該当証明書 (判定書)',
    shortLabel: '非該当証明書',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-300',
    icon: Shield,
  },
  PACKING_LIST: {
    label: 'パッキングリスト (Packing List)',
    shortLabel: 'P/L',
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
    icon: Layers,
  },
  CUSTOMS_DECLARATION: {
    label: '輸出許可書・申告書 (Customs Permit)',
    shortLabel: '輸出許可書',
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
    icon: FileCheck,
  },
  SI: {
    label: '通関依頼指示書 (Shipping Instruction)',
    shortLabel: '指示書 (SI)',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    icon: FileText,
  },
  OTHER: {
    label: 'その他関連通関書類',
    shortLabel: 'その他書類',
    bg: 'bg-slate-50',
    text: 'text-slate-700',
    border: 'border-slate-200',
    icon: File,
  },
};

export const OneDriveDocumentManager: React.FC<OneDriveDocumentManagerProps> = ({
  shipment,
  settings: initialSettings,
  onOpenCustomsEmailWithDocs,
  onFilesUpdated,
}) => {
  const [settings, setSettings] = useState<M365Settings>(initialSettings || getM365Settings());
  const [files, setFiles] = useState<OneDriveFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<OneDriveDocType>('INVOICE');
  const [selectedFolderKey, setSelectedFolderKey] = useState<string | null>('MAIN');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [previewFile, setPreviewFile] = useState<OneDriveFileItem | null>(null);
  const [selectedForEmail, setSelectedForEmail] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResult, setDiagResult] = useState<any>(null);
  const [showDiagModal, setShowDiagModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const providerName = '共有ドライブ';
  const folderPath = getShipmentOneDriveFolderPath(shipment, settings);

  // Compute standard main folder display name (e.g. "PTY 057-59328813 MV BERGE SCAFELL PIKE")
  const mainFolderName = useMemo(() => {
    for (const f of files) {
      if (f.folderPath) {
        const base = f.folderPath.split('/')[0];
        if (base && (base.includes('PTY') || base.includes('59328813') || base.includes('BERGE'))) {
          return base;
        }
      }
    }
    const awb = shipment.hawbNumber || shipment.mawbNumber || '057-59328813';
    const vessel = shipment.consignee || 'BERGE SCAFELL PIKE';
    const cleanVessel = vessel.startsWith('MV ') ? vessel : `MV ${vessel}`;
    return `PTY ${awb} ${cleanVessel}`.replace(/\s+/g, ' ').trim();
  }, [files, shipment]);

  // Extract unique subfolders detected across files (e.g. "K")
  const detectedSubfolderNames = useMemo(() => {
    const set = new Set<string>();
    files.forEach((f) => {
      if (f.subfolder && f.subfolder.trim()) {
        set.add(f.subfolder.trim());
      }
    });
    // Ensure "K" is always available
    set.add('K');
    return Array.from(set).sort();
  }, [files]);

  // Filter files by folder selection ('MAIN' | subfolder name | null for unselected)
  const filteredFiles = useMemo(() => {
    if (selectedFolderKey === null) return [];
    if (selectedFolderKey === 'MAIN') {
      return files.filter((f) => !f.subfolder);
    }
    return files.filter((f) => f.subfolder === selectedFolderKey);
  }, [files, selectedFolderKey]);

  const handleToggleFolder = (key: string) => {
    setSelectedFolderKey((prev) => (prev === key ? null : key));
  };

  const refreshFiles = async () => {
    setLoading(true);
    try {
      // Clear localStorage cache for this shipment to force live cloud query
      localStorage.removeItem(`export_mgmt_onedrive_files_${shipment.id}`);
      const list = await listOneDriveFilesForShipment(shipment, settings);
      setFiles(list);
      if (onFilesUpdated) onFilesUpdated(list);
      if (list.length > 0) {
        setStatusMessage({
          type: 'success',
          text: `${providerName}から最新の書類 ${list.length}件 を取得しました。`,
        });
        setTimeout(() => setStatusMessage(null), 4000);
      }
    } catch (e: any) {
      console.error(e);
      setStatusMessage({
        type: 'error',
        text: `同期エラー: ${e.message || 'ファイル取得に失敗しました'}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setDiagLoading(true);
    setShowDiagModal(true);
    try {
      const res = await diagnoseGoogleDrive(shipment, settings);
      setDiagResult(res);
    } catch (e: any) {
      setDiagResult({ success: false, error: e.message || '診断の実行に失敗しました' });
    } finally {
      setDiagLoading(false);
    }
  };

  useEffect(() => {
    refreshFiles();
    const unsub = subscribeOneDriveFiles((shipmentId) => {
      if (shipmentId === shipment.id) {
        refreshFiles();
      }
    });
    return () => unsub();
  }, [shipment.id, settings.oneDriveBasePath, settings.storageProvider]);

  const handleFileUpload = async (uploadedFiles: FileList | null) => {
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    setLoading(true);
    setStatusMessage(null);
    let successCount = 0;

    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      try {
        // Auto-guess docType from filename if possible
        let docType = selectedDocType;
        const lower = file.name.toLowerCase();
        if (lower.includes('invoice') || lower.includes('inv') || lower.includes('請求書') || lower.includes('仕状')) {
          docType = 'INVOICE';
        } else if (lower.includes('非該当') || lower.includes('判定書') || lower.includes('証明書') || lower.includes('cert') || lower.includes('non-app')) {
          docType = 'NON_APPLICABLE_CERT';
        } else if (lower.includes('packing') || lower.includes('pl') || lower.includes('梱包')) {
          docType = 'PACKING_LIST';
        } else if (lower.includes('許可') || lower.includes('申告') || lower.includes('permit')) {
          docType = 'CUSTOMS_DECLARATION';
        } else if (lower.includes('si') || lower.includes('指示書') || lower.includes('instruction')) {
          docType = 'SI';
        }

        await uploadFileToOneDrive(shipment, file, docType, settings);
        successCount++;
      } catch (err: any) {
        setStatusMessage({ type: 'error', text: `アップロード失敗: ${err.message}` });
      }
    }

    setLoading(false);
    if (successCount > 0) {
      setStatusMessage({
        type: 'success',
        text: `${successCount}件のファイルを${providerName}フォルダ [${folderPath}] に保存しました。`,
      });
      setTimeout(() => setStatusMessage(null), 5000);
      refreshFiles();
    }
  };

  const handleRequestDelete = (fileId: string, fileName: string) => {
    setDeleteErrorMessage(null);
    setFileToDelete({ id: fileId, name: fileName });
  };

  const handleConfirmDelete = async () => {
    if (!fileToDelete) return;
    const { id: fileId, name: fileName } = fileToDelete;
    const previousFiles = files;
    setIsDeletingId(fileId);
    setDeleteErrorMessage(null);

    // Optimistic removal from UI list
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    setSelectedForEmail((prev) => prev.filter((id) => id !== fileId));

    try {
      await deleteOneDriveFile(shipment, fileId, settings);
      setStatusMessage({
        type: 'success',
        text: `ファイル [${fileName}] を${providerName}のゴミ箱へ移動しました。`,
      });
      setTimeout(() => setStatusMessage(null), 4000);
      setFileToDelete(null);
      refreshFiles();
    } catch (e: any) {
      console.error('Delete error:', e);
      setDeleteErrorMessage(e.message || 'ファイルの削除に失敗しました。');
      setFiles(previousFiles); // Rollback
      refreshFiles();
    } finally {
      setIsDeletingId(null);
    }
  };

  const handleToggleSelectForEmail = (fileId: string) => {
    setSelectedForEmail((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  const handleSendViaEmail = () => {
    const selected = files.filter((f) => selectedForEmail.includes(f.id));
    if (selected.length === 0) {
      alert(`メールに添付する${providerName}書類をチェックしてください。`);
      return;
    }
    if (onOpenCustomsEmailWithDocs) {
      onOpenCustomsEmailWithDocs(selected);
    } else {
      alert(`${selected.length}件の書類（${selected.map((s) => s.name).join(', ')}）が選択されました。通関質疑・メール画面から添付送信できます。`);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden animate-in fade-in duration-150">
      {/* Header Banner */}
      <div className={`text-white px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 transition-colors ${
        (settings.storageProvider || 'onedrive') === 'googledrive'
          ? 'bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 border-b border-emerald-900'
          : 'bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 border-b border-blue-900'
      }`}>
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-xl border ${
            (settings.storageProvider || 'onedrive') === 'googledrive'
              ? 'bg-emerald-600/30 border-emerald-500/40 text-emerald-300'
              : 'bg-blue-600/30 border-blue-500/40 text-blue-300'
          }`}>
            <Folder className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-white">
                📁 通関関連書類（共有ドライブ保管ハブ）
              </h3>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                (settings.storageProvider || 'onedrive') === 'googledrive'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                  : 'bg-blue-500/20 text-blue-300 border-blue-400/30'
              }`}>
                {files.length} 件保管
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                (settings.storageProvider || 'onedrive') === 'googledrive'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-blue-600 text-white'
              }`}>
                共有ドライブ
              </span>
            </div>
            <p className="text-[11px] text-slate-300 font-mono mt-0.5 flex items-center gap-1.5">
              <span className="text-slate-400">保管フォルダ:</span>
              <span className="bg-slate-900/60 px-2 py-0.5 rounded border border-slate-700 text-slate-100 font-mono">
                {folderPath}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {(settings.storageProvider || 'onedrive') === 'googledrive' && (
            <button
              type="button"
              onClick={handleRunDiagnostics}
              disabled={diagLoading}
              className="p-1.5 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 hover:text-white rounded-lg transition-colors cursor-pointer border border-emerald-700/60 flex items-center gap-1 text-xs"
              title="共有ドライブのアクセス権限・フォルダ構造を自動診断"
            >
              <Sparkles className={`w-3.5 h-3.5 ${diagLoading ? 'animate-spin text-emerald-400' : 'text-emerald-400'}`} />
              <span className="hidden sm:inline">フォルダ診断</span>
            </button>
          )}

          <button
            type="button"
            onClick={refreshFiles}
            disabled={loading}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer border border-slate-700 flex items-center gap-1 text-xs"
            title="クラウドストレージと同期更新"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">再同期</span>
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="p-5 space-y-4">
        {/* Status Message */}
        {statusMessage && (
          <div
            className={`p-3 rounded-xl border flex items-center gap-2 text-xs ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : 'bg-rose-50 border-rose-300 text-rose-900'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-semibold">{statusMessage.text}</span>
          </div>
        )}

        {/* Upload Drop Zone & Category Selector */}
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <UploadCloud className="w-4 h-4 text-blue-600" />
              <span>書類を追加アップロード（自動で{providerName}フォルダへ格納）:</span>
            </div>

            {/* Document Type Selector Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(Object.keys(DOC_TYPE_META) as OneDriveDocType[]).map((type) => {
                const meta = DOC_TYPE_META[type];
                const isSelected = selectedDocType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelectedDocType(type)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                      isSelected
                        ? `${meta.bg} ${meta.text} ${meta.border} ring-2 ring-blue-500/40 shadow-xs`
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {meta.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Drag & Drop Area */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              handleFileUpload(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-blue-500 bg-blue-50/80 scale-[0.99]'
                : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/30'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
            />
            <div className="flex flex-col items-center justify-center space-y-1">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                <UploadCloud className="w-4 h-4" />
              </div>
              <p className="text-xs font-bold text-slate-800">
                ここにインボイス・非該当証明書・パッキングリスト・輸出許可書をドラッグ＆ドロップ
              </p>
              <p className="text-[11px] text-slate-500">
                または <span className="text-blue-600 underline font-semibold">ファイルを選択してアップロード</span> (PDF, JPEG, PNG, Excel)
              </p>
            </div>
          </div>
        </div>

        {/* Action Toolbar for Selected Files */}
        {selectedForEmail.length > 0 && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between text-xs animate-in slide-in-from-top-1 duration-150">
            <div className="flex items-center gap-2 text-blue-900 font-bold">
              <CheckCircle2 className="w-4 h-4 text-blue-600" />
              <span>{selectedForEmail.length} 件の{providerName}書類を選択中</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedForEmail([])}
                className="px-2.5 py-1 text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
              >
                選択解除
              </button>
              <button
                type="button"
                onClick={handleSendViaEmail}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>通関士宛てメールに添付して送信</span>
              </button>
            </div>
          </div>
        )}

        {/* Folder Selector Tabs & View Mode Switcher */}
        {files.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 pb-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500 font-semibold text-[11px] mr-1">表示フォルダ:</span>

              {/* Main Folder: "PTY 057-59328813 MV BERGE SCAFELL PIKE" */}
              {(() => {
                const isSelected = selectedFolderKey === 'MAIN';
                const count = files.filter((f) => !f.subfolder).length;
                return (
                  <button
                    type="button"
                    onClick={() => handleToggleFolder('MAIN')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border flex items-center gap-2 shadow-2xs ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-700 shadow-sm ring-2 ring-blue-500/30'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:border-slate-400'
                    }`}
                    title={isSelected ? 'クリックして未選択にする' : `${mainFolderName} を表示`}
                  >
                    <Folder className={`w-4 h-4 ${isSelected ? 'text-blue-100' : 'text-blue-600'}`} />
                    <span>{mainFolderName}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                      isSelected ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })()}

              {/* Subfolder(s): e.g. "PTY 057-59328813 MV BERGE SCAFELL PIKE/K" */}
              {detectedSubfolderNames.map((subName) => {
                const isSelected = selectedFolderKey === subName;
                const count = files.filter((f) => f.subfolder === subName).length;
                const fullSubfolderPath = `${mainFolderName}/${subName}`;
                return (
                  <button
                    key={subName}
                    type="button"
                    onClick={() => handleToggleFolder(subName)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border flex items-center gap-2 shadow-2xs ${
                      isSelected
                        ? 'bg-amber-600 text-white border-amber-700 shadow-sm ring-2 ring-amber-500/30'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:border-slate-400'
                    }`}
                    title={isSelected ? 'クリックして未選択にする' : `${fullSubfolderPath} を表示`}
                  >
                    <Folder className={`w-4 h-4 ${isSelected ? 'text-amber-100' : 'text-amber-600'}`} />
                    <span>{fullSubfolderPath}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                      isSelected ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}

              {selectedFolderKey === null && (
                <span className="text-[11px] text-slate-400 font-medium py-1 px-2 bg-slate-100 rounded-md border border-slate-200">
                  ※ フォルダ未選択中
                </span>
              )}
            </div>

            {/* Right: View Switcher & Clear Selection */}
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    viewMode === 'grid'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="カード表示に切り替え"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span className="text-[11px]">カード</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    viewMode === 'list'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="リスト表示に切り替え"
                >
                  <List className="w-3.5 h-3.5" />
                  <span className="text-[11px]">リスト</span>
                </button>
              </div>

              {selectedFolderKey !== null && (
                <button
                  type="button"
                  onClick={() => setSelectedFolderKey(null)}
                  className="text-[11px] text-slate-500 hover:text-slate-700 underline cursor-pointer px-1"
                >
                  選択解除
                </button>
              )}
            </div>
          </div>
        )}

        {/* Files Grid / List */}
        {files.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-slate-200 rounded-xl">
            <Folder className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-600">この案件の{providerName}書類はまだありません</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              上の枠からインボイスや非該当証明書をアップロードしてください。
            </p>
          </div>
        ) : selectedFolderKey === null ? (
          <div className="text-center py-10 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            <Folder className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-700">フォルダが選択されていません</p>
            <p className="text-[11px] text-slate-500 mt-1">
              上のフォルダボタンをクリックして表示するフォルダを選択してください。
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedFolderKey('MAIN')}
                className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold hover:bg-blue-100 cursor-pointer flex items-center gap-1.5"
              >
                <Folder className="w-3.5 h-3.5 text-blue-600" />
                <span>{mainFolderName} を選択</span>
              </button>
              {detectedSubfolderNames.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setSelectedFolderKey(sub)}
                  className="px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-bold hover:bg-amber-100 cursor-pointer flex items-center gap-1.5"
                >
                  <Folder className="w-3.5 h-3.5 text-amber-600" />
                  <span>{mainFolderName}/{sub} を選択</span>
                </button>
              ))}
            </div>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            <p className="text-xs font-bold text-slate-600">
              選択されたフォルダ「{selectedFolderKey === 'MAIN' ? mainFolderName : `${mainFolderName}/${selectedFolderKey}`}」に該当するファイルはありません
            </p>
          </div>
        ) : viewMode === 'list' ? (
          /* List / Table View */
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 select-none">
                    <th className="py-2.5 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={filteredFiles.length > 0 && filteredFiles.every((f) => selectedForEmail.includes(f.id))}
                        onChange={(e) => {
                          if (e.target.checked) {
                            const allIds = Array.from(new Set([...selectedForEmail, ...filteredFiles.map((f) => f.id)]));
                            setSelectedForEmail(allIds);
                          } else {
                            const curSet = new Set(filteredFiles.map((f) => f.id));
                            setSelectedForEmail(selectedForEmail.filter((id) => !curSet.has(id)));
                          }
                        }}
                        className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                        title="全選択 / 解除"
                      />
                    </th>
                    <th className="py-2.5 px-3 w-28">書類種別</th>
                    <th className="py-2.5 px-3">ファイル名</th>
                    <th className="py-2.5 px-3 w-24 text-right">サイズ</th>
                    <th className="py-2.5 px-3 w-28 text-center">更新日</th>
                    <th className="py-2.5 px-3 w-32 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredFiles.map((file) => {
                    const meta = DOC_TYPE_META[file.docType] || DOC_TYPE_META.OTHER;
                    const IconComp = meta.icon;
                    const isSelected = selectedForEmail.includes(file.id);

                    return (
                      <tr
                        key={file.id}
                        className={`transition-colors hover:bg-slate-50/80 ${
                          isSelected ? 'bg-blue-50/40' : ''
                        }`}
                      >
                        <td className="py-2 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectForEmail(file.id)}
                            className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                          />
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${meta.bg} ${meta.text} ${meta.border}`}>
                            {meta.shortLabel}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`p-1 rounded ${meta.bg} ${meta.text} shrink-0`}>
                              {file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls') || file.name.toLowerCase().endsWith('.csv') ? (
                                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <IconComp className="w-3.5 h-3.5" />
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setPreviewFile(file)}
                              className="font-bold text-slate-800 hover:text-blue-600 text-left truncate cursor-pointer hover:underline transition-colors"
                              title={file.name}
                            >
                              {file.name}
                            </button>
                            {file.subfolder && (
                              <span className="px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-mono font-bold shrink-0">
                                {file.subfolder}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {formatFileSize(file.size)}
                        </td>
                        <td className="py-2 px-3 text-center text-[11px] text-slate-500 whitespace-nowrap">
                          {new Date(file.lastModified).toLocaleDateString('ja-JP')}
                        </td>
                        <td className="py-2 px-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => setPreviewFile(file)}
                              className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                              title="プレビュー表示"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadOrPreviewOneDriveFile(file)}
                              className="p-1 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors cursor-pointer"
                              title="ダウンロード"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <a
                              href={file.webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                              title="クラウドで開く"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                            <button
                              type="button"
                              id={`btn-table-delete-${file.id}`}
                              disabled={isDeletingId === file.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRequestDelete(file.id, file.name);
                              }}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer disabled:opacity-50"
                              title="削除（ゴミ箱へ移動）"
                            >
                              {isDeletingId === file.id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-500" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Compact Cards / Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {filteredFiles.map((file) => {
              const meta = DOC_TYPE_META[file.docType] || DOC_TYPE_META.OTHER;
              const IconComp = meta.icon;
              const isSelected = selectedForEmail.includes(file.id);

              return (
                <div
                  key={file.id}
                  className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between bg-white ${
                    isSelected ? 'border-blue-500 shadow-sm ring-2 ring-blue-500/20 bg-blue-50/10' : 'border-slate-200 hover:border-slate-300 shadow-2xs'
                  }`}
                >
                  {/* Top Row: Type, Size & Attachment Checkbox */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${meta.bg} ${meta.text} ${meta.border} shrink-0`}>
                        {meta.shortLabel}
                      </span>
                      {file.subfolder && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-mono font-bold shrink-0">
                          {file.subfolder}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 font-mono shrink-0">
                        {formatFileSize(file.size)}
                      </span>
                    </div>

                    <label className="flex items-center gap-1 cursor-pointer select-none text-[11px] text-slate-600 font-medium shrink-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelectForEmail(file.id)}
                        className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span>添付</span>
                    </label>
                  </div>

                  {/* Middle: File Icon & File Name & Last Modified */}
                  <div className="flex items-center space-x-2 my-2">
                    <div className={`p-1.5 rounded-lg ${meta.bg} ${meta.text} shrink-0`}>
                      {file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls') || file.name.toLowerCase().endsWith('.csv') ? (
                        <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <IconComp className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4
                        onClick={() => setPreviewFile(file)}
                        className="text-xs font-bold text-slate-900 truncate hover:text-blue-600 cursor-pointer transition-colors"
                        title={file.name}
                      >
                        {file.name}
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        更新: {new Date(file.lastModified).toLocaleDateString('ja-JP')}
                      </p>
                    </div>
                  </div>

                  {/* Actions Bottom Bar (Compact) */}
                  <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => setPreviewFile(file)}
                        className="p-1 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                        title="プレビュー表示 (PDF / Excel / 画像)"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => downloadOrPreviewOneDriveFile(file)}
                        className="p-1 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors cursor-pointer"
                        title="ダウンロード"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>

                      <a
                        href={file.webUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                        title="クラウドで表示"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    <button
                      type="button"
                      id={`btn-card-delete-${file.id}`}
                      disabled={isDeletingId === file.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRequestDelete(file.id, file.name);
                      }}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer disabled:opacity-50"
                      title="保管庫から削除（ゴミ箱へ移動）"
                    >
                      {isDeletingId === file.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-500" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Enhanced Multi-format Document Preview Modal (PDF & Excel & Image) */}
      {previewFile && (
        <DocumentPreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          shipmentAwb={shipment.hawbNumber || shipment.mawbNumber || shipment.id}
          consignee={shipment.consignee}
        />
      )}

      {/* Shared Drive Connection & Folder Diagnostic Modal */}
      {showDiagModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold">共有ドライブ フォルダ・権限診断</h3>
                  <p className="text-[11px] text-slate-400">
                    AWB: {shipment.hawbNumber || shipment.mawbNumber || shipment.id} / 宛先: {shipment.consignee}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDiagModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {diagLoading ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-3">
                  <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
                  <p className="text-slate-600 font-medium">共有ドライブのアクセス権限と全フォルダを調査中...</p>
                </div>
              ) : diagResult?.error ? (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-rose-900">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <AlertCircle className="w-5 h-5 text-rose-600" />
                    接続・取得エラー
                  </div>
                  <p className="font-mono text-xs bg-white/80 p-2.5 rounded border border-rose-200">
                    {diagResult.error}
                  </p>
                  <p className="text-xs text-rose-700">
                    ※ サービスアカウントの秘密鍵やJSONキーがGoogle Cloud側で有効か、対象フォルダがサービスアカウントに共有されているか確認してください。
                  </p>
                </div>
              ) : diagResult ? (
                <div className="space-y-4">
                  {/* Account status */}
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">認証サービスアカウント:</span>
                      <span className="font-mono font-bold text-slate-800">{diagResult.serviceAccount || '未指定'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Drive ユーザー / ドメイン:</span>
                      <span className="text-slate-800">{diagResult.storageUser?.displayName || diagResult.subjectUser || 'OK'}</span>
                    </div>
                  </div>

                  {/* Folders Summary */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                        <Folder className="w-4 h-4 text-amber-500" />
                        アクセス可能なフォルダ一覧 ({diagResult.totalFoldersFound || 0} 件)
                      </h4>
                    </div>

                    {diagResult.folders && diagResult.folders.length > 0 ? (
                      <div className="bg-slate-50 rounded-xl border border-slate-200 p-2 max-h-40 overflow-y-auto space-y-1 font-mono text-[11px]">
                        {diagResult.folders.map((f: any) => (
                          <div key={f.id} className="p-1.5 bg-white rounded border border-slate-200 flex items-center justify-between">
                            <span className="font-medium text-slate-800 truncate mr-2">📁 {f.name}</span>
                            <span className="text-[10px] text-slate-400 shrink-0">ID: {f.id.slice(0, 10)}...</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs">
                        ⚠️ サービスアカウントから直接見えるフォルダが0件です。共有ドライブ上で対象の親フォルダ（例: <code>HELLMANN</code>）をサービスアカウントのメールアドレスに「編集者」または「閲覧者」として共有してください。
                      </div>
                    )}
                  </div>

                  {/* Files Summary */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-blue-500" />
                        アクセス可能なファイル一覧 ({diagResult.totalFilesFound || 0} 件)
                      </h4>
                    </div>

                    {diagResult.files && diagResult.files.length > 0 ? (
                      <div className="bg-slate-50 rounded-xl border border-slate-200 p-2 max-h-40 overflow-y-auto space-y-1 font-mono text-[11px]">
                        {diagResult.files.map((f: any) => (
                          <div key={f.id} className="p-1.5 bg-white rounded border border-slate-200 flex items-center justify-between">
                            <span className="font-medium text-slate-800 truncate mr-2">📄 {f.name}</span>
                            <span className="text-[10px] text-slate-400 shrink-0">
                              {(Number(f.size || 0) / 1024).toFixed(1)} KB
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-100 rounded-xl text-slate-600 text-xs">
                        現在ドライブ内にファイルが見つかりませんでした。
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={handleRunDiagnostics}
                disabled={diagLoading}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${diagLoading ? 'animate-spin' : ''}`} />
                再診断を実行
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDiagModal(false);
                  refreshFiles();
                }}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium cursor-pointer"
              >
                閉じる & 再同期
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🗑️ ファイル削除確認ダイアログ (「はい / いいえ」) */}
      {fileToDelete && (
        <div
          id="modal-confirm-file-delete"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => !isDeletingId && setFileToDelete(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* モーダルヘッダー */}
            <div className="p-4 bg-rose-50 border-b border-rose-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-slate-900">ファイル削除の確認</h3>
                <p className="text-[11px] text-slate-500">{providerName}保管庫</p>
              </div>
              {!isDeletingId && (
                <button
                  type="button"
                  id="btn-close-delete-modal"
                  onClick={() => setFileToDelete(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-rose-100 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* モーダル本文 */}
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-700 leading-relaxed font-medium">
                以下のファイルを{providerName}から削除（ゴミ箱へ移動）しますか？
              </p>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-slate-500 shrink-0" />
                <span className="text-xs font-bold text-slate-800 truncate" title={fileToDelete.name}>
                  {fileToDelete.name}
                </span>
              </div>

              <div className="p-2.5 bg-amber-50/70 border border-amber-200/80 rounded-xl text-[11px] text-amber-900 leading-relaxed">
                💡 <strong>ご安心ください:</strong> ファイルは{providerName}の「ゴミ箱」に安全に移動されます。必要な場合はいつでもGoogleドライブ側から元に戻すことができます。
              </div>

              {deleteErrorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-800 text-xs">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">削除エラー:</span>
                    <p className="font-mono text-[11px] mt-0.5">{deleteErrorMessage}</p>
                  </div>
                </div>
              )}
            </div>

            {/* モーダルフッター: 「いいえ」「はい」 */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                id="btn-cancel-delete"
                disabled={!!isDeletingId}
                onClick={() => setFileToDelete(null)}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                いいえ（キャンセル）
              </button>

              <button
                type="button"
                id="btn-confirm-delete"
                disabled={!!isDeletingId}
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDeletingId ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>ゴミ箱へ移動中...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>はい（ゴミ箱へ移動）</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
