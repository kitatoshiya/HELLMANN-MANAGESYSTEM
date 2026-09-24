import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { OperatorMasterModal } from './OperatorMasterModal';
import { TaskMasterModal } from './TaskMasterModal';
import { SignatureSettingsModal } from './SignatureSettingsModal';
import { ReplyTemplateSettingsModal } from './ReplyTemplateSettingsModal';
import { getNotificationSettings, subscribeToNotificationSettings } from '../lib/notificationService';
import { subscribeToSyncStatus, flushPendingSyncQueue } from '../lib/storageManager';
import {
  subscribeM365Store,
  getUnifiedMailMessages,
  subscribeM365SyncTimerState,
  M365SyncTimerState,
  getM365Settings,
} from '../lib/m365EmailService';
import { CloudSyncStatus } from '../types';
import {
  FileUp,
  ShieldCheck,
  FileText,
  ChevronDown,
  Calendar,
  LogOut,
  Users,
  Badge,
  Mail,
  ListChecks,
  FileCheck,
  BarChart3,
  Database,
  Bell,
  BellRing,
  Settings,
  Sparkles,
  Smartphone,
  Cloud,
  CloudCheck,
  CloudAlert,
  Loader2,
  RefreshCw,
} from 'lucide-react';

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

interface NavbarProps {
  onOpenUpload: () => void;
  onOpenSpecs: () => void;
  onSelectToday?: () => void;
  onOpenXrayAnalysis?: () => void;
  onOpenReport?: () => void;
  onOpenBackup?: () => void;
  onOpenNotificationSettings?: () => void;
  onOpenM365Settings?: () => void;
  onShowSplash?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenUpload,
  onOpenSpecs,
  onSelectToday,
  onOpenXrayAnalysis,
  onOpenReport,
  onOpenBackup,
  onOpenNotificationSettings,
  onOpenM365Settings,
  onShowSplash,
}) => {
  const { currentOperator, currentUser, firebaseUser, logout, refreshOperator } = useAuth();
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showOperatorMasterModal, setShowOperatorMasterModal] = useState(false);
  const [showTaskMasterModal, setShowTaskMasterModal] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [showReplyTemplateModal, setShowReplyTemplateModal] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState(getNotificationSettings());
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>({
    state: 'synced',
    lastSyncedAt: Date.now(),
    pendingCount: 0,
  });
  const [pendingMailCount, setPendingMailCount] = useState<number>(0);
  const [m365Settings, setM365Settings] = useState(getM365Settings());
  const [syncTimerState, setSyncTimerState] = useState<M365SyncTimerState>({
    lastSyncTime: null,
    lastInboxSyncTime: null,
    lastSentSyncTime: null,
    isInboxSyncing: false,
    isSentSyncing: false,
    nextInboxSyncRemainingSec: 120,
    nextSentSyncRemainingSec: 300,
  });

  useEffect(() => {
    const unsubNotify = subscribeToNotificationSettings((settings) => {
      setNotificationSettings(settings);
    });
    const unsubSync = subscribeToSyncStatus((status) => {
      setSyncStatus(status);
    });
    
    // Track pending decision emails count and settings
    const updateMailCount = () => {
      const allMails = getUnifiedMailMessages();
      const pending = allMails.filter((m) => m.decisionStatus === 'PENDING_DECISION').length;
      setPendingMailCount(pending);
      setM365Settings(getM365Settings());
    };
    updateMailCount();
    const unsubM365 = subscribeM365Store(updateMailCount);

    // Track M365 background auto sync timer state (10-second tick updates)
    const unsubTimerState = subscribeM365SyncTimerState((state) => {
      setSyncTimerState(state);
    });

    return () => {
      unsubNotify();
      unsubSync();
      unsubM365();
      unsubTimerState();
    };
  }, []);

  const today = new Date();
  const todayFormattedStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 (${WEEKDAYS_JA[today.getDay()]})`;

  const operatorName = currentOperator?.name || currentUser?.displayName || firebaseUser?.email?.split('@')[0] || '担当者';
  const employeeNum = currentOperator?.employeeNumber || currentUser?.employeeNumber || '-';
  const emailAddr = currentOperator?.email || firebaseUser?.email || 'user@export-logistics.co.jp';

  const handleLogoutClick = async () => {
    setShowUserDropdown(false);
    await logout();
  };

  // Format last sync time to hh:mm
  const formatSyncTime = (isoString: string | null) => {
    if (!isoString) return '--:--';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '--:--';
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // Format remaining seconds into clean label (e.g. "2分後" or "40秒後" or "1分20秒後")
  const formatRemainingTime = (sec: number) => {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const remainderSec = s % 60;
    if (m === 0) return `${remainderSec}秒後`;
    if (remainderSec === 0) return `${m}分後`;
    return `${m}分${remainderSec}秒後`;
  };

  const isSyncingAny = syncTimerState.isInboxSyncing || syncTimerState.isSentSyncing;
  const syncingLabel =
    syncTimerState.isInboxSyncing && syncTimerState.isSentSyncing
      ? 'メール送受信 同期中...'
      : syncTimerState.isInboxSyncing
      ? '受信メール同期中...'
      : syncTimerState.isSentSyncing
      ? '送信メール同期中...'
      : 'メール同期中...';

  // Earliest next sync between inbox and sent
  const minRemainingSec = Math.min(
    syncTimerState.nextInboxSyncRemainingSec,
    syncTimerState.nextSentSyncRemainingSec
  );

  return (
    <>
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40 shadow-md">
        <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo & System Title */}
            <div className="flex items-center space-x-3.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white leading-tight">
                  輸出進捗管理システムVer2.0
                </h1>
                <p className="text-xs text-slate-400 hidden sm:block mt-0.5">SI (PDF) 自動データ抽出 & リアルタイム進捗追跡</p>
              </div>
            </div>

            {/* Action Buttons & User Profile */}
            <div className="flex items-center space-x-3">
              {/* Today Date Badge Area (Clicking executes today date selection in calendar) */}
              <button
                type="button"
                onClick={onSelectToday}
                title="クリックして本日の情報・案件を表示"
                className="flex items-center space-x-2 bg-gradient-to-r from-slate-800 to-blue-950/80 hover:from-slate-700 hover:to-blue-900 border border-blue-800/60 hover:border-blue-500 rounded-xl px-3 py-1.5 shadow-inner transition-all active:scale-95 cursor-pointer text-left"
              >
                <Calendar className="w-4 h-4 text-blue-400 shrink-0" />
                <div className="text-xs font-extrabold text-white">
                  本日: {todayFormattedStr}
                </div>
              </button>

              {/* Cloud Sync Status Indicator */}
              <div className="hidden xl:flex items-center">
                {syncStatus.state === 'syncing' && (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-blue-950/60 border border-blue-800/80 text-blue-300 text-xs animate-pulse" title="クラウドと同期中...">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    <span>クラウド同期中...</span>
                  </div>
                )}
                {syncStatus.state === 'synced' && (
                  <div className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs" title="すべての端末と同期完了">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span>同期完了</span>
                  </div>
                )}
                {syncStatus.state === 'error' && (
                  <button
                    type="button"
                    onClick={() => flushPendingSyncQueue()}
                    className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 hover:bg-rose-900/60 text-xs cursor-pointer transition-colors"
                    title={`${syncStatus.errorMessage || '同期エラーが発生しました'} - クリックして再送信`}
                  >
                    <CloudAlert className="w-3.5 h-3.5 text-rose-400" />
                    <span>未同期 {syncStatus.pendingCount > 0 ? `(${syncStatus.pendingCount}件)` : ''} 再試行</span>
                  </button>
                )}
                {syncStatus.state === 'offline' && (
                  <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-amber-950/50 border border-amber-800 text-amber-300 text-xs" title="オフライン動作中（ローカル保持）">
                    <Cloud className="w-3.5 h-3.5 text-amber-400" />
                    <span>オフライン保持</span>
                  </div>
                )}
              </div>

              {/* Architecture Specs Modal moved to user menu */}

              {/* X-ray Inspection PDF OCR Analysis Button */}
              {onOpenXrayAnalysis && (
                <button
                  type="button"
                  onClick={onOpenXrayAnalysis}
                  className="inline-flex items-center px-3.5 py-1.5 text-xs font-bold text-amber-950 bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 rounded-lg shadow-sm transition-all transform active:scale-95 cursor-pointer border border-amber-300/60"
                  title="X線検査結果・爆発物検査依頼書PDFをAI OCR解析して一括分割ダウンロード"
                >
                  <FileCheck className="w-4 h-4 mr-1.5 text-amber-950" />
                  X線検査結果解析
                </button>
              )}

              {/* Progress Summary Report Modal Trigger */}
              {onOpenReport && (
                <button
                  type="button"
                  onClick={onOpenReport}
                  className="inline-flex items-center px-3.5 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 rounded-lg shadow-sm transition-all transform active:scale-95 cursor-pointer border border-indigo-400/50"
                  title="全案件の進捗サマリーおよびチーム週間アウトプット分析グラフを表示"
                >
                  <BarChart3 className="w-4 h-4 mr-1.5 text-indigo-200" />
                  <span>進捗サマリー & 週間分析</span>
                </button>
              )}

              {/* Progress Data Backup & Cloud Snapshot Trigger */}
              {onOpenBackup && (
                <button
                  type="button"
                  onClick={onOpenBackup}
                  className="hidden md:inline-flex items-center px-3.5 py-1.5 text-xs font-bold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg shadow-sm transition-all transform active:scale-95 cursor-pointer border border-slate-700"
                  title="Firestore進捗データのJSON出力・Firebase Storage自動スナップショット"
                >
                  <Database className="w-4 h-4 mr-1.5 text-blue-400" />
                  <span>バックアップ</span>
                </button>
              )}

              {/* Notification Settings Modal Trigger */}
              {onOpenNotificationSettings && (
                <button
                  type="button"
                  onClick={onOpenNotificationSettings}
                  title="システム通知 & カット時間アラート設定 (トースト通知のON/OFF・事前通知設定)"
                  className="relative inline-flex items-center px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg shadow-sm transition-all transform active:scale-95 cursor-pointer"
                >
                  {notificationSettings.enabled ? (
                    <BellRing className="w-3.5 h-3.5 mr-1.5 text-amber-400 animate-pulse" />
                  ) : (
                    <Bell className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                  )}
                  <span className="hidden sm:inline">通知設定</span>
                  {notificationSettings.enabled && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 absolute top-1 right-1"></span>
                  )}
                </button>
              )}

              {/* M365 Email Integration Button & Sync Status Badge */}
              {onOpenM365Settings && (
                <div className="flex items-center space-x-1.5">
                  {/* Compact Auto Sync Status Badge (10-second tick updates) */}
                  {m365Settings.enabled && (
                    <div
                      className={`hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono transition-all select-none ${
                        isSyncingAny
                          ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-sm shadow-emerald-900/50'
                          : 'bg-slate-800/90 border-slate-700 text-slate-300'
                      }`}
                      title={
                        isSyncingAny
                          ? syncingLabel
                          : `最終同期: ${formatSyncTime(syncTimerState.lastSyncTime)} (次回受信チェック: ${formatRemainingTime(
                              syncTimerState.nextInboxSyncRemainingSec
                            )}, 送信チェック: ${formatRemainingTime(syncTimerState.nextSentSyncRemainingSec)})`
                      }
                    >
                      {isSyncingAny ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" />
                          <span className="font-bold text-emerald-300 animate-pulse font-sans">
                            {syncingLabel}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse"></span>
                          <span className="text-slate-400 font-sans">最終同期:</span>
                          <span className="text-white font-bold">{formatSyncTime(syncTimerState.lastSyncTime)}</span>
                          <span className="text-slate-500 font-sans text-[11px]">
                            (次回 {formatRemainingTime(minRemainingSec)})
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={onOpenM365Settings}
                    title="Microsoft 365 共通メールハブ（メール送受信・案件決定）を開く"
                    className="relative inline-flex items-center px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg shadow-sm transition-all transform active:scale-95 cursor-pointer"
                  >
                    <Mail className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
                    <span className="hidden sm:inline">M365メール連携</span>
                    {pendingMailCount > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.2 bg-amber-500 text-slate-950 font-bold text-[10px] rounded-full shadow-sm">
                        {pendingMailCount}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* SI Upload Button */}
              <button
                type="button"
                onClick={onOpenUpload}
                className="inline-flex items-center px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-sm transition-all transform active:scale-95 cursor-pointer"
              >
                <FileUp className="w-4 h-4 mr-1.5" />
                SI (PDF) 取り込み
              </button>

              {/* Current Operating User Selector & Master Info Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowUserDropdown(!showUserDropdown)}
                  className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-xl px-3 py-1.5 transition-all cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0 shadow-xs">
                    {operatorName.charAt(0)}
                  </div>
                  <div className="text-left hidden sm:block">
                    <div className="text-xs font-bold text-white leading-none flex items-center gap-1.5">
                      <span>{operatorName}</span>
                    </div>
                    {employeeNum && employeeNum !== '-' && (
                      <div className="text-[10px] font-mono text-blue-300 font-semibold mt-0.5">
                        {employeeNum}
                      </div>
                    )}
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {/* Logged in User Menu Dropdown */}
                {showUserDropdown && (
                  <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl py-2 z-50 animate-in fade-in duration-100">
                    <div className="px-4 py-3 border-b border-slate-800 bg-slate-800/40">
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
                          {operatorName.charAt(0)}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">{operatorName}</div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5 font-mono">
                            <Mail className="w-3 h-3 text-blue-400 shrink-0" />
                            <span className="truncate">{emailAddr}</span>
                          </div>
                        </div>
                      </div>

                      {employeeNum && employeeNum !== '-' && (
                        <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center gap-1 text-[10px] text-slate-300">
                          <Badge className="w-3 h-3 text-blue-400" />
                          <span className="font-mono">社員番号: {employeeNum}</span>
                        </div>
                      )}
                    </div>

                    <div className="p-1.5 space-y-1">
                      {/* Operator Master Management Trigger */}
                      <button
                        type="button"
                        onClick={() => {
                          setShowUserDropdown(false);
                          setShowOperatorMasterModal(true);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center space-x-2">
                          <Users className="w-4 h-4 text-blue-400" />
                          <span>担当者マスタ確認・編集</span>
                        </div>
                        <span className="text-[9px] bg-blue-900/60 text-blue-300 border border-blue-700/50 px-1.5 py-0.5 rounded font-mono">
                          Master
                        </span>
                      </button>

                      {/* Task Process Master Trigger */}
                      <button
                        type="button"
                        onClick={() => {
                          setShowUserDropdown(false);
                          setShowTaskMasterModal(true);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center space-x-2">
                          <ListChecks className="w-4 h-4 text-indigo-400" />
                          <span>作業工程タスクマスタ</span>
                        </div>
                        <span className="text-[9px] bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 px-1.5 py-0.5 rounded font-mono">
                          Tasks
                        </span>
                      </button>

                      {/* Email Signature Settings Trigger */}
                      <button
                        type="button"
                        onClick={() => {
                          setShowUserDropdown(false);
                          setShowSignatureModal(true);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center space-x-2">
                          <Mail className="w-4 h-4 text-purple-400" />
                          <span>メール署名・シグニチャー設定</span>
                        </div>
                        <span className="text-[9px] bg-purple-900/60 text-purple-300 border border-purple-700/50 px-1.5 py-0.5 rounded font-mono">
                          Signature
                        </span>
                      </button>

                      {/* Reply Templates Master Trigger */}
                      <button
                        type="button"
                        onClick={() => {
                          setShowUserDropdown(false);
                          setShowReplyTemplateModal(true);
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center space-x-2">
                          <FileText className="w-4 h-4 text-emerald-400" />
                          <span>返信・全員返信 業務定型文マスタ</span>
                        </div>
                        <span className="text-[9px] bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 px-1.5 py-0.5 rounded font-mono">
                          Templates
                        </span>
                      </button>

                      {/* Notification & Cut-Off Alert Settings */}
                      {onOpenNotificationSettings && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowUserDropdown(false);
                            onOpenNotificationSettings();
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                        >
                          <div className="flex items-center space-x-2">
                            <Bell className="w-4 h-4 text-amber-400" />
                            <span>システム通知・アラート設定</span>
                          </div>
                          <span className="text-[9px] bg-amber-900/60 text-amber-300 border border-amber-700/50 px-1.5 py-0.5 rounded font-mono">
                            Alerts
                          </span>
                        </button>
                      )}

                      {/* Backup & Snapshot Manager Trigger */}
                      {onOpenBackup && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowUserDropdown(false);
                            onOpenBackup();
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                        >
                          <div className="flex items-center space-x-2">
                            <Database className="w-4 h-4 text-emerald-400" />
                            <span>バックアップ & スナップショット</span>
                          </div>
                          <span className="text-[9px] bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 px-1.5 py-0.5 rounded font-mono">
                            Backup
                          </span>
                        </button>
                      )}

                      {/* Replay Splash Screen Trigger */}
                      {onShowSplash && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowUserDropdown(false);
                            onShowSplash();
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-800 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                        >
                          <div className="flex items-center space-x-2">
                            <Sparkles className="w-4 h-4 text-cyan-400" />
                            <span>起動スプラッシュ画面を表示</span>
                          </div>
                          <span className="text-[9px] bg-cyan-900/60 text-cyan-300 border border-cyan-700/50 px-1.5 py-0.5 rounded font-mono">
                            Intro
                          </span>
                        </button>
                      )}

                      {/* Mobile Viewer Direct Link */}
                      <a
                        href="/viewer"
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setShowUserDropdown(false)}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-blue-300 hover:text-white hover:bg-blue-950/50 rounded-xl transition-colors flex items-center justify-between cursor-pointer border border-blue-900/40"
                      >
                        <div className="flex items-center space-x-2">
                          <Smartphone className="w-4 h-4 text-blue-400" />
                          <span>スマホ閲覧モード (/viewer)</span>
                        </div>
                        <span className="text-[9px] bg-blue-900/60 text-blue-300 border border-blue-700/50 px-1.5 py-0.5 rounded font-mono">
                          Mobile
                        </span>
                      </a>

                      {/* Architecture Specs Modal Trigger (Moved from navbar) */}
                      {onOpenSpecs && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowUserDropdown(false);
                            onOpenSpecs();
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-semibold text-amber-300 hover:text-white hover:bg-amber-950/40 rounded-xl transition-colors flex items-center justify-between cursor-pointer border border-amber-900/30"
                        >
                          <div className="flex items-center space-x-2">
                            <ShieldCheck className="w-4 h-4 text-amber-400" />
                            <span>システム仕様書・設計書</span>
                          </div>
                          <span className="text-[9px] bg-amber-900/60 text-amber-300 border border-amber-700/50 px-1.5 py-0.5 rounded font-mono">
                            Specs
                          </span>
                        </button>
                      )}

                      {/* Logoff Button */}
                      <button
                        type="button"
                        onClick={handleLogoutClick}
                        className="w-full text-left px-3 py-2 text-xs font-bold text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded-xl transition-colors flex items-center space-x-2 cursor-pointer"
                      >
                        <LogOut className="w-4 h-4 text-red-400" />
                        <span>ログオフ</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Operator Master Modal */}
      <OperatorMasterModal
        isOpen={showOperatorMasterModal}
        onClose={() => setShowOperatorMasterModal(false)}
        onOperatorUpdated={refreshOperator}
      />

      {/* Task Process Master Modal */}
      <TaskMasterModal
        isOpen={showTaskMasterModal}
        onClose={() => setShowTaskMasterModal(false)}
      />

      {/* Signature Settings Modal */}
      <SignatureSettingsModal
        isOpen={showSignatureModal}
        onClose={() => setShowSignatureModal(false)}
      />

      {/* Reply Template Settings Modal */}
      <ReplyTemplateSettingsModal
        isOpen={showReplyTemplateModal}
        onClose={() => setShowReplyTemplateModal(false)}
      />
    </>
  );
};
