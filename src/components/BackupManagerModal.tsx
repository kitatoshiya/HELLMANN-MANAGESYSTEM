import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Database,
  Cloud,
  Download,
  Upload,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileJson,
  HardDrive,
  Trash2,
  RotateCcw,
  Sliders,
  X,
  History,
  ShieldCheck,
  Package,
  Layers,
  Users,
  Check,
  AlertCircle,
  FileText,
  ExternalLink,
} from 'lucide-react';
import {
  BackupPayload,
  BackupSnapshotMeta,
  BackupSettings,
  Shipment,
} from '../types';
import {
  generateBackupPayload,
  downloadBackupJson,
  saveSnapshotToFirebaseStorage,
  fetchSnapshotList,
  downloadSnapshotPayload,
  deleteSnapshot,
  restoreFromBackup,
  getBackupSettings,
  fetchBackupSettingsFromCloud,
  saveBackupSettings,
  saveBackupSettingsAsync,
} from '../lib/backupService';
import { useAuth } from '../lib/AuthContext';

interface BackupManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipments: Shipment[];
}

type TabType = 'overview' | 'snapshots' | 'settings' | 'restore';

export const BackupManagerModal: React.FC<BackupManagerModalProps> = ({
  isOpen,
  onClose,
  shipments,
}) => {
  const { currentOperator, currentUser } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [snapshots, setSnapshots] = useState<BackupSnapshotMeta[]>([]);
  const [settings, setSettings] = useState<BackupSettings>(getBackupSettings());
  const [isLoading, setIsLoading] = useState(false);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Restore State
  const [importedJson, setImportedJson] = useState<BackupPayload | null>(null);
  const [restoreMode, setRestoreMode] = useState<'OVERWRITE' | 'MERGE'>('OVERWRITE');
  const [isRestoring, setIsRestoring] = useState(false);
  const [snapshotToRestore, setSnapshotToRestore] = useState<BackupSnapshotMeta | null>(null);

  // Load snapshots list
  const loadSnapshots = async () => {
    setIsLoading(true);
    try {
      const list = await fetchSnapshotList();
      setSnapshots(list);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      // 1. Load local immediate settings
      setSettings(getBackupSettings());
      // 2. Fetch latest settings from Firestore cloud storage
      fetchBackupSettingsFromCloud().then((cloudSettings) => {
        setSettings(cloudSettings);
      });
      loadSnapshots();
      setStatusMessage(null);
      setImportedJson(null);
    }
  }, [isOpen]);

  const showFeedback = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setStatusMessage({ text, type });
    setTimeout(() => {
      setStatusMessage((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // Immediate JSON Download Handler
  const handleDownloadNow = async () => {
    setIsDownloading(true);
    try {
      await downloadBackupJson();
      setSettings(getBackupSettings());
      showFeedback('進捗データのJSONファイルをダウンロードしました。', 'success');
    } catch (err: any) {
      showFeedback(err?.message || 'ダウンロードに失敗しました。', 'error');
    } finally {
      setIsDownloading(false);
    }
  };

  // Immediate Snapshot to Firebase Storage Handler
  const handleSaveSnapshotNow = async () => {
    setIsSnapshotting(true);
    try {
      const authorInfo = {
        name: currentOperator?.name || currentUser?.displayName || '管理者',
        email: currentOperator?.email || currentUser?.email || 'admin@export-logistics.co.jp',
        employeeNumber: currentOperator?.employeeNumber,
      };

      const meta = await saveSnapshotToFirebaseStorage('MANUAL', authorInfo);
      if (meta.status === 'SUCCESS') {
        showFeedback('Firebase Storageへのスナップショット保存が完了しました。', 'success');
        await loadSnapshots();
        setSettings(getBackupSettings());
      } else {
        showFeedback(meta.errorMessage || 'スナップショットの保存に失敗しました。', 'error');
      }
    } catch (err: any) {
      showFeedback(err?.message || 'スナップショットの保存に失敗しました。', 'error');
    } finally {
      setIsSnapshotting(false);
    }
  };

  // Delete snapshot
  const handleDeleteSnapshot = async (s: BackupSnapshotMeta) => {
    if (!confirm(`スナップショット [${s.formattedDate}] を削除しますか？`)) return;
    try {
      const ok = await deleteSnapshot(s);
      if (ok) {
        setSnapshots((prev) => prev.filter((item) => item.id !== s.id));
        showFeedback('スナップショットを削除しました。', 'info');
      } else {
        showFeedback('削除に失敗しました。', 'error');
      }
    } catch (e) {
      showFeedback('削除中にエラーが発生しました。', 'error');
    }
  };

  // Download a past snapshot as JSON file
  const handleDownloadSnapshotFile = async (s: BackupSnapshotMeta) => {
    try {
      setIsLoading(true);
      const payload = await downloadSnapshotPayload(s);
      if (payload) {
        await downloadBackupJson(payload);
        showFeedback(`スナップショット [${s.formattedDate}] のJSONを出力しました。`, 'success');
      } else {
        showFeedback('スナップショットデータの取得に失敗しました。', 'error');
      }
    } catch (e: any) {
      showFeedback(e?.message || '取得に失敗しました。', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Restore confirmation from snapshot list
  const handleConfirmRestoreSnapshot = async (s: BackupSnapshotMeta) => {
    if (
      !confirm(
        `【復元の確認】\nスナップショット [${s.formattedDate}] (${s.shipmentsCount}件の案件) から復元しますか？\n現在のデータはバックアップ時点の状態に復元されます。`
      )
    ) {
      return;
    }

    setIsRestoring(true);
    try {
      const payload = await downloadSnapshotPayload(s);
      if (!payload) {
        throw new Error('スナップショットデータの取得に失敗しました。');
      }

      const res = await restoreFromBackup(payload, 'OVERWRITE');
      showFeedback(res.message, 'success');
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      showFeedback(err?.message || '復元処理に失敗しました。', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  // File Upload Handler for Restore Tab
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (!parsed.data || !parsed.data.shipments) {
          throw new Error('有効なバックアップJSONファイル形式ではありません。');
        }
        setImportedJson(parsed);
        showFeedback('バックアップJSONファイルを正常に読み込みました。', 'info');
      } catch (err: any) {
        showFeedback(err?.message || 'JSONファイルの解析に失敗しました。', 'error');
      }
    };
    reader.readAsText(file);
  };

  // Execute Restore from Uploaded JSON
  const handleExecuteJsonRestore = async () => {
    if (!importedJson) return;

    if (
      !confirm(
        `【復元実行の確認】\n読み込んだバックアップ (${importedJson.stats?.shipmentsCount || 0}件) を復元しますか？\n復元モード: ${
          restoreMode === 'OVERWRITE' ? '上書き完全同期' : '既存データにマージ追加'
        }`
      )
    ) {
      return;
    }

    setIsRestoring(true);
    try {
      const res = await restoreFromBackup(importedJson, restoreMode);
      showFeedback(res.message, 'success');
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      showFeedback(err?.message || '復元に失敗しました。', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  // Settings save handler with async Firestore cloud sync
  const handleSaveSettings = async (newSettings: Partial<BackupSettings>) => {
    // 1. Optimistically update local state & localStorage
    const updated = saveBackupSettings(newSettings);
    setSettings(updated);

    try {
      // 2. Persist to Firestore cloud
      await saveBackupSettingsAsync(newSettings);
      showFeedback('バックアップ設定をクラウド(Firestore)に保存・全端末同期しました。', 'success');
    } catch (e) {
      showFeedback('ローカル設定を保存しました（クラウド保存は再試行されます）。', 'info');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-6 overflow-y-auto animate-fadeIn">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2 }}
        className="bg-slate-50 border border-slate-200 rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Modal Header */}
        <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900">進捗データバックアップ & クラウドスナップショット</h2>
                <span className="px-2 py-0.5 text-[10px] font-extrabold bg-blue-100 text-blue-800 rounded-full border border-blue-200">
                  Firebase Storage
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Firestore進捗データの定期JSON出力・Firebase Storage自動スナップショット・安全なデータ復元
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Notification Banner */}
        {statusMessage && (
          <div
            className={`px-6 py-2.5 text-xs font-semibold flex items-center justify-between border-b ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : statusMessage.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-blue-50 text-blue-800 border-blue-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : statusMessage.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-rose-600" />
              ) : (
                <Check className="w-4 h-4 text-blue-600" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-xs text-slate-400 hover:text-slate-600 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="bg-slate-100 px-6 pt-3 border-b border-slate-200 flex items-center justify-between shrink-0 overflow-x-auto">
          <div className="flex space-x-1">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center space-x-2 cursor-pointer border-t border-x ${
                activeTab === 'overview'
                  ? 'bg-white text-blue-700 border-slate-200 -mb-px shadow-2xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900 border-transparent hover:bg-slate-200/60'
              }`}
            >
              <HardDrive className="w-4 h-4" />
              <span>バックアップ実行</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('snapshots');
                loadSnapshots();
              }}
              className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center space-x-2 cursor-pointer border-t border-x ${
                activeTab === 'snapshots'
                  ? 'bg-white text-blue-700 border-slate-200 -mb-px shadow-2xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900 border-transparent hover:bg-slate-200/60'
              }`}
            >
              <Cloud className="w-4 h-4" />
              <span>クラウド履歴 ({snapshots.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center space-x-2 cursor-pointer border-t border-x ${
                activeTab === 'settings'
                  ? 'bg-white text-blue-700 border-slate-200 -mb-px shadow-2xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900 border-transparent hover:bg-slate-200/60'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>自動実行設定</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('restore')}
              className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center space-x-2 cursor-pointer border-t border-x ${
                activeTab === 'restore'
                  ? 'bg-white text-blue-700 border-slate-200 -mb-px shadow-2xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900 border-transparent hover:bg-slate-200/60'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              <span>データ復元 (インポート)</span>
            </button>
          </div>

          <div className="flex items-center space-x-2 pb-2">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                settings.autoBackupEnabled
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                  : 'bg-slate-200 text-slate-600 border-slate-300'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                  settings.autoBackupEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                }`}
              />
              {settings.autoBackupEnabled ? `自動バックアップ: ${settings.intervalHours}時間毎` : '自動保存: 停止中'}
            </span>
          </div>
        </div>

        {/* Tab Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: OVERVIEW & INSTANT ACTIONS */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Top 2 Primary Action Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Action Card 1: Immediate JSON File Download */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-blue-300 transition-all">
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <FileJson className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">進捗データ JSONダウンロード</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      現在の全案件、工程タスク、アクティビティログ、担当者マスタを単一のJSONファイルとしてPCに保存します。
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400 font-mono">
                      最終出力: {settings.lastManualBackupTime || '未実施'}
                    </span>
                    <button
                      type="button"
                      onClick={handleDownloadNow}
                      disabled={isDownloading}
                      className="inline-flex items-center px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                    >
                      <Download className="w-4 h-4 mr-1.5" />
                      <span>{isDownloading ? '生成中...' : 'JSONを保存'}</span>
                    </button>
                  </div>
                </div>

                {/* Action Card 2: Immediate Snapshot to Firebase Storage */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-indigo-300 transition-all">
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <Cloud className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">Firebase Storageへスナップショット保存</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      クラウド上のFirebase Storage内にタイムスタンプ付きスナップショットを安全に格納します。
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400 font-mono">
                      最終クラウド保存: {settings.lastAutoBackupTime || settings.lastManualBackupTime || '未実施'}
                    </span>
                    <button
                      type="button"
                      onClick={handleSaveSnapshotNow}
                      disabled={isSnapshotting}
                      className="inline-flex items-center px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 rounded-xl shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                    >
                      <Cloud className="w-4 h-4 mr-1.5" />
                      <span>{isSnapshotting ? 'アップロード中...' : 'スナップショット作成'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Data Summary Stats Box */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                    <Layers className="w-4 h-4 text-blue-600" />
                    <span>バックアップ対象データ規模 (リアルタイム集計)</span>
                  </h4>
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    同期中
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[11px] text-slate-500 font-medium block">登録案件総数</span>
                    <span className="text-xl font-bold font-mono text-slate-900">{shipments.length}</span>
                    <span className="text-[10px] text-slate-400 ml-1">件</span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[11px] text-slate-500 font-medium block">全工程タスク数</span>
                    <span className="text-xl font-bold font-mono text-blue-600">
                      {shipments.reduce((acc, s) => acc + (s.tasks?.length || 0), 0)}
                    </span>
                    <span className="text-[10px] text-slate-400 ml-1">件</span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[11px] text-slate-500 font-medium block">完了案件数</span>
                    <span className="text-xl font-bold font-mono text-emerald-600">
                      {shipments.filter((s) => s.status === 'Completed').length}
                    </span>
                    <span className="text-[10px] text-slate-400 ml-1">件</span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[11px] text-slate-500 font-medium block">クラウドスナップショット</span>
                    <span className="text-xl font-bold font-mono text-indigo-600">{snapshots.length}</span>
                    <span className="text-[10px] text-slate-400 ml-1">世代</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CLOUD SNAPSHOTS HISTORY */}
          {activeTab === 'snapshots' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Firebase Storage スナップショット一覧</h3>
                  <p className="text-xs text-slate-500">
                    保存された過去のスナップショットからJSONファイルの再ダウンロードやデータ復元を実行できます。
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={loadSnapshots}
                    className="p-1.5 text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1"
                    title="再読込"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    <span>更新</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveSnapshotNow}
                    disabled={isSnapshotting}
                    className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                  >
                    + 新規作成
                  </button>
                </div>
              </div>

              {isLoading && snapshots.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs font-mono">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                  スナップショットを取得中...
                </div>
              ) : snapshots.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center space-y-3">
                  <Cloud className="w-8 h-8 text-slate-300 mx-auto" />
                  <div className="text-xs text-slate-500">まだクラウドスナップショットがありません。</div>
                  <button
                    type="button"
                    onClick={handleSaveSnapshotNow}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                  >
                    最初のスナップショットを保存
                  </button>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                          <th className="py-2.5 px-4">保存日時</th>
                          <th className="py-2.5 px-3">種別</th>
                          <th className="py-2.5 px-3">案件数</th>
                          <th className="py-2.5 px-3">タスク数</th>
                          <th className="py-2.5 px-3">サイズ</th>
                          <th className="py-2.5 px-3">実行者</th>
                          <th className="py-2.5 px-4 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {snapshots.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                              <div className="flex items-center space-x-1.5">
                                <Clock className="w-3.5 h-3.5 text-slate-400" />
                                <span>{s.formattedDate}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                                  s.type === 'AUTO'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-blue-50 text-blue-700 border-blue-200'
                                }`}
                              >
                                {s.type === 'AUTO' ? '自動' : '手動'}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-mono font-bold text-slate-700">
                              {s.shipmentsCount} 件
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-500">
                              {s.tasksCount}
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-400 text-[11px]">
                              {s.fileSizeBytes ? `${Math.round(s.fileSizeBytes / 1024)} KB` : '-'}
                            </td>
                            <td className="py-3 px-3 text-slate-600 truncate max-w-[120px]" title={s.authorName}>
                              {s.authorName || 'システム'}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end space-x-1">
                                <button
                                  type="button"
                                  onClick={() => handleDownloadSnapshotFile(s)}
                                  className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                  title="JSONファイルをダウンロード"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleConfirmRestoreSnapshot(s)}
                                  className="p-1.5 text-amber-700 hover:text-amber-900 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer font-bold text-[11px] flex items-center space-x-1"
                                  title="このスナップショットからデータを復元"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>復元</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSnapshot(s)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="削除"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: AUTO BACKUP SETTINGS */}
          {activeTab === 'settings' && (
            <div className="space-y-6 max-w-2xl">
              {/* Cloud Sync Status Banner */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs">
                    <Cloud className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-900">クラウド設定同期ステータス</span>
                      <span className="px-2 py-0.5 text-[10px] font-extrabold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200 flex items-center space-x-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Firestore クラウド永続化</span>
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Vercel環境、各PC端末、モバイルビューアー等ですべての設定がリアルタイムに共有・保存されます。
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                    <Sliders className="w-4 h-4 text-blue-600" />
                    <span>自動定期バックアップ・スナップショット設定</span>
                  </h3>
                  {settings.lastAutoBackupTime && (
                    <span className="text-[11px] text-slate-500 flex items-center space-x-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>最終自動実行: {settings.lastAutoBackupTime}</span>
                    </span>
                  )}
                </div>

                {/* Switch: Auto Snapshot */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <div>
                    <label className="text-xs font-bold text-slate-900 block">
                      Firebase Storageへの自動定期スナップショット
                    </label>
                    <p className="text-[11px] text-slate-500">
                      バックグラウンドで指定間隔ごとに自動でクラウドへ進捗データをバックアップします。
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoBackupEnabled}
                    onChange={(e) => handleSaveSettings({ autoBackupEnabled: e.target.checked })}
                    className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </div>

                {/* Interval Selector */}
                {settings.autoBackupEnabled && (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-900 block">
                        自動実行インターバル (実行間隔)
                      </label>
                      <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                        現在: {settings.intervalHours}時間ごと
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[1, 3, 6, 12, 24].map((hours) => (
                        <button
                          key={hours}
                          type="button"
                          onClick={() => handleSaveSettings({ intervalHours: hours })}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                            settings.intervalHours === hours
                              ? 'bg-blue-600 border-blue-600 text-white shadow-sm font-extrabold ring-2 ring-blue-300'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {hours}時間ごと
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Option: Auto JSON Download */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <div>
                    <label className="text-xs font-bold text-slate-900 block">
                      バックアップ実行時のJSONファイル自動ダウンロード通知
                    </label>
                    <p className="text-[11px] text-slate-500">
                      定期バックアップ時にブラウザのローカルファイル保存も同時に自動トリガーします。
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoDownloadJson}
                    onChange={(e) => handleSaveSettings({ autoDownloadJson: e.target.checked })}
                    className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Technical Info Box */}
              <div className="bg-slate-100/80 rounded-2xl p-4 border border-slate-200 text-xs space-y-1.5 text-slate-600">
                <div className="font-bold text-slate-800 flex items-center space-x-1.5">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>ストレージセキュリティと冗長化仕様</span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  スナップショットは Firebase Storage (<code className="font-mono text-blue-700 font-bold">backups/snapshots/</code>) および Firestore のバックアップレジストリへ多重保存され、万一のネットワーク障害時もローカルストレージに自動キャッシュされます。
                </p>
              </div>
            </div>
          )}

          {/* TAB 4: RESTORE / IMPORT */}
          {activeTab === 'restore' && (
            <div className="space-y-6 max-w-2xl">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                  <Upload className="w-4 h-4 text-blue-600" />
                  <span>JSONファイルからのデータ復元・インポート</span>
                </h3>

                {/* File Upload Zone */}
                <div className="border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-2xl p-6 text-center transition-colors relative">
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  />
                  <FileJson className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                  <div className="text-xs font-bold text-slate-800">
                    バックアップJSONファイルを選択またはドラッグ＆ドロップ
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    （export_progress_backup_*.json 形式に対応）
                  </div>
                </div>

                {/* Loaded JSON Preview Card */}
                {importedJson && (
                  <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-blue-900 flex items-center space-x-1">
                        <CheckCircle2 className="w-4 h-4 text-blue-600" />
                        <span>バックアップファイル解析結果</span>
                      </span>
                      <span className="text-[10px] font-mono text-blue-700 font-bold">
                        {importedJson.formattedDate || importedJson.timestamp}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="bg-white p-2 rounded-lg border border-blue-100">
                        <span className="text-[10px] text-slate-400 block">案件数</span>
                        <span className="font-bold text-slate-800 font-mono">
                          {importedJson.data?.shipments?.length || importedJson.stats?.shipmentsCount || 0} 件
                        </span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-blue-100">
                        <span className="text-[10px] text-slate-400 block">ログ数</span>
                        <span className="font-bold text-slate-800 font-mono">
                          {importedJson.data?.activityLogs?.length || importedJson.stats?.logsCount || 0} 件
                        </span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-blue-100">
                        <span className="text-[10px] text-slate-400 block">担当者マスタ</span>
                        <span className="font-bold text-slate-800 font-mono">
                          {importedJson.data?.operators?.length || importedJson.stats?.operatorsCount || 0} 名
                        </span>
                      </div>
                    </div>

                    {/* Mode Selector */}
                    <div className="pt-2 space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 block">復元モードの選択</label>
                      <div className="flex space-x-3">
                        <label className="flex items-center space-x-1.5 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="radio"
                            name="restoreMode"
                            value="OVERWRITE"
                            checked={restoreMode === 'OVERWRITE'}
                            onChange={() => setRestoreMode('OVERWRITE')}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          <span className="font-bold">上書き復元 (完全同期)</span>
                        </label>
                        <label className="flex items-center space-x-1.5 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="radio"
                            name="restoreMode"
                            value="MERGE"
                            checked={restoreMode === 'MERGE'}
                            onChange={() => setRestoreMode('MERGE')}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          <span className="font-bold">マージ復元 (既存に追加)</span>
                        </label>
                      </div>
                    </div>

                    {/* Restore Button */}
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={handleExecuteJsonRestore}
                        disabled={isRestoring}
                        className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs font-extrabold shadow-md transition-all active:scale-98 cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-1.5"
                      >
                        <RotateCcw className="w-4 h-4" />
                        <span>{isRestoring ? '復元処理を実行中...' : 'このバックアップから復元を実行'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-100 px-6 py-3 border-t border-slate-200 flex items-center justify-between shrink-0 text-xs text-slate-500">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Firestore & Firebase Storage 連携稼働中</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-white hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-xl font-bold transition-colors cursor-pointer"
          >
            閉じる
          </button>
        </div>
      </motion.div>
    </div>
  );
};
