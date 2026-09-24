import React, { useState } from 'react';
import {
  Mail,
  CheckCircle2,
  AlertCircle,
  X,
  Shield,
  Key,
  Server,
  Building2,
  RefreshCw,
  Sparkles,
  HelpCircle,
  ExternalLink,
  Cloud,
  Search,
  UserCheck,
  User,
  Clock,
  Calendar,
  Folder,
  UploadCloud,
  FolderCheck,
} from 'lucide-react';
import { M365Settings } from '../types';
import {
  getM365Settings,
  saveM365Settings,
  simulateIncomingHellmannOrder,
  simulateIncomingBrokerQuestionEmail,
  testM365ConnectionViaBackend,
  fetchTenantUsersFromBackend,
} from '../lib/m365EmailService';
import {
  testOneDriveConnection,
  testGoogleDriveConnection,
  testCloudStorageConnection,
} from '../lib/oneDriveService';
import { getShipments } from '../lib/storageManager';

interface M365SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAndSync?: () => void;
}

export const M365SettingsModal: React.FC<M365SettingsModalProps> = ({
  isOpen,
  onClose,
  onSaveAndSync,
}) => {
  const [settings, setSettings] = useState<M365Settings>(getM365Settings());
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    availableUsers?: Array<{ id: string; displayName: string; mail: string; userPrincipalName: string }>;
  } | null>(null);
  const [oneDriveTestResult, setOneDriveTestResult] = useState<{
    success: boolean;
    message: string;
    folderPath?: string;
  } | null>(null);
  const [googleDriveTestResult, setGoogleDriveTestResult] = useState<{
    success: boolean;
    message: string;
    folderPath?: string;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingOneDrive, setIsTestingOneDrive] = useState(false);
  const [isTestingGoogleDrive, setIsTestingGoogleDrive] = useState(false);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [tenantUsers, setTenantUsers] = useState<
    Array<{ id: string; displayName: string; mail: string; userPrincipalName: string }>
  >([]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveM365Settings(settings);
    if (onSaveAndSync) {
      onSaveAndSync();
    }
    onClose();
  };

  const handleTestOneDrive = async () => {
    setIsTestingOneDrive(true);
    setOneDriveTestResult(null);
    try {
      const res = await testOneDriveConnection(settings);
      setIsTestingOneDrive(false);
      setOneDriveTestResult({
        success: res.success,
        message: res.message,
        folderPath: res.folderPath,
      });
    } catch (err: any) {
      setIsTestingOneDrive(false);
      setOneDriveTestResult({
        success: false,
        message: `OneDrive 接続テスト失敗: ${err.message || '通信エラーが発生しました'}`,
      });
    }
  };

  const handleTestGoogleDrive = async () => {
    setIsTestingGoogleDrive(true);
    setGoogleDriveTestResult(null);
    try {
      const res = await testGoogleDriveConnection(settings);
      setIsTestingGoogleDrive(false);
      setGoogleDriveTestResult({
        success: res.success,
        message: res.message,
        folderPath: res.folderPath,
      });
    } catch (err: any) {
      setIsTestingGoogleDrive(false);
      setGoogleDriveTestResult({
        success: false,
        message: `Google ドライブ 接続テスト失敗: ${err.message || '通信エラーが発生しました'}`,
      });
    }
  };

  const handleGoogleJsonChange = (rawJson: string) => {
    let updated = { ...settings, googleDriveServiceAccountKeyJson: rawJson };
    try {
      if (rawJson.trim().startsWith('{')) {
        const parsed = JSON.parse(rawJson.trim());
        if (parsed.client_email) {
          updated.googleDriveServiceAccountEmail = parsed.client_email;
        }
        if (parsed.private_key) {
          updated.googleDrivePrivateKey = parsed.private_key;
        }
      }
    } catch {
      // ignore parse error while typing
    }
    setSettings(updated);
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await testM365ConnectionViaBackend(settings);
      setIsTesting(false);
      
      // Auto-populate userPrincipalName if userPrincipalName/mail is returned (and is a valid email, not a GUID)
      const returnedUpn = result.mailbox?.userPrincipalName || result.mailbox?.mail;
      const isGuid = (str?: string) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
      if (result.success && returnedUpn && returnedUpn.includes('@') && !isGuid(returnedUpn)) {
        setSettings((prev) => ({
          ...prev,
          userPrincipalName: prev.userPrincipalName || returnedUpn,
        }));
      }

      setTestResult({
        success: result.success,
        message: result.message,
      });
    } catch (err: any) {
      setIsTesting(false);
      setTestResult({
        success: false,
        message: `接続テスト失敗: ${err.message || '通信エラーが発生しました'}`,
      });
    }
  };

  const handleFetchTenantUsers = async () => {
    setIsSearchingUsers(true);
    try {
      const res = await fetchTenantUsersFromBackend(settings);
      setIsSearchingUsers(false);
      if (res.success && res.users.length > 0) {
        setTenantUsers(res.users);
      } else {
        setTestResult({
          success: false,
          message: res.error || 'テナント内のユーザーが見つかりませんでした。テナントID/クライアントID/シークレットをご確認ください。',
        });
      }
    } catch (err: any) {
      setIsSearchingUsers(false);
      setTestResult({
        success: false,
        message: `ユーザー検索エラー: ${err.message}`,
      });
    }
  };

  const handleSelectDiscoveredUser = (u: { displayName: string; mail: string; userPrincipalName: string }) => {
    setSettings((prev) => ({
      ...prev,
      groupEmail: u.mail || u.userPrincipalName || prev.groupEmail,
      userPrincipalName: u.userPrincipalName || '',
    }));
  };

  const handleSimulateEmail = () => {
    simulateIncomingHellmannOrder();
    setTestResult({
      success: true,
      message: 'ヘルマン社からのテスト通関依頼メール（SI PDF添付付き）を受信しました。ダッシュボード上部のアラートをご確認ください。',
    });
  };

  const handleSimulateBrokerEmail = () => {
    const shipments = getShipments();
    const targetShipment = shipments[0] || null;
    simulateIncomingBrokerQuestionEmail(targetShipment);
    setTestResult({
      success: true,
      message: `共通グループメール [${settings.groupEmail}] 宛てに、通関士からのテスト質問メールを受信しました。該当案件の「通関質疑ハブ」にて確認できます。`,
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">Microsoft 365 共通グループメール連携設定</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                ヘルマン社 ＆ 社内通関士 共通グループメール送受信設定
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSave} className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          {/* Cloud Auto-Sync Banner */}
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3 text-emerald-900">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Cloud className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-xs block text-emerald-950">
                  Firestore クラウドリアルタイム同期 有効
                </span>
                <span className="text-[11px] text-emerald-800">
                  保存した設定情報はチームメンバー全員の端末に自動共有・即時同期されます。
                </span>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-200/80 text-emerald-900 rounded-full shrink-0">
              全PC自動同期中
            </span>
          </div>

          {/* Group Email Clarification Box */}
          <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-2xl space-y-1">
            <span className="font-bold text-blue-900 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-blue-600" />
              <span>同一のグループメールアドレス（共有メールボックス）で完結</span>
            </span>
            <p className="text-[11px] text-blue-950 leading-relaxed">
              ヘルマン社との通関依頼・照会および、<strong>社内通関士からの質問起票・回答送受信の双方を、同一のグループメールアドレスで送受信・一元管理</strong>します。
              個人のメールに埋もれることなく、チーム全員で質疑履歴と案件進捗を把握できます。
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="bg-slate-100 p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="font-bold text-slate-900 text-sm block">動作モード選択</span>
              <p className="text-slate-600 text-[11px] mt-0.5">
                {settings.isDemoMode
                  ? '【デモ / シミュレーター稼働中】実APIキー未設定でも、新着アラートや通関質疑リレーの全機能を操作確認できます。'
                  : '【本番 Microsoft Graph API モード】Entra ID (Azure AD) の資格情報で実メールボックスと双方向通信します。'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setSettings({ ...settings, isDemoMode: true })}
                className={`px-3 py-1.5 rounded-xl font-bold cursor-pointer transition-all ${
                  settings.isDemoMode
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-300'
                }`}
              >
                デモ / テスト
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, isDemoMode: false })}
                className={`px-3 py-1.5 rounded-xl font-bold cursor-pointer transition-all ${
                  !settings.isDemoMode
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-300'
                }`}
              >
                本番 Graph API
              </button>
            </div>
          </div>

          {/* 📁 通関書類保管・自動連携ストレージ設定 (OneDrive ⇄ Google ドライブ 切替対応) */}
          <div className="p-4 bg-gradient-to-br from-slate-50 via-blue-50/50 to-indigo-50/40 border-2 border-slate-300 rounded-2xl space-y-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-3 gap-2">
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-xl text-white flex items-center justify-center shrink-0 shadow-sm transition-colors ${
                  (settings.storageProvider || 'onedrive') === 'googledrive' ? 'bg-emerald-600' : 'bg-blue-600'
                }`}>
                  <Folder className="w-4.5 h-4.5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-xs text-slate-900">📁 通関書類保管・クラウド連携ストレージ設定</h4>
                    <span className={`px-2 py-0.5 text-white text-[9px] font-bold rounded-full transition-colors ${
                      (settings.storageProvider || 'onedrive') === 'googledrive' ? 'bg-emerald-600' : 'bg-blue-600'
                    }`}>
                      {(settings.storageProvider || 'onedrive') === 'googledrive' ? 'Google ドライブ稼働中' : 'OneDrive稼働中'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    案件のインボイス・非該当判定書・指示書をクラウド保管し、一覧からプレビュー・通関士メールへ自動添付します。
                  </p>
                </div>
              </div>

              {/* Provider Selection Tabs */}
              <div className="flex items-center bg-white p-1 rounded-xl border border-slate-300 shadow-xs self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, storageProvider: 'onedrive' })}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    (settings.storageProvider || 'onedrive') === 'onedrive'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span>OneDrive</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, storageProvider: 'googledrive' })}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    settings.storageProvider === 'googledrive'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <FolderCheck className="w-3.5 h-3.5" />
                  <span>Google ドライブ (方式B)</span>
                </button>
              </div>
            </div>

            {/* Google Drive Configuration Tab */}
            {settings.storageProvider === 'googledrive' && (
              <div className="space-y-3.5 animate-in fade-in duration-200">
                <div className="flex items-center justify-between bg-emerald-50/80 p-3 rounded-xl border border-emerald-200">
                  <div className="text-xs text-emerald-950">
                    <span className="font-bold flex items-center gap-1">
                      <Sparkles className="w-4 h-4 text-emerald-600" />
                      Google ドライブ連携 (方式B - 組織管理者不在時の推奨構成)
                    </span>
                    <p className="text-[11px] text-emerald-800 mt-0.5">
                      Power Automateで会社OneDriveから同期されたGoogleドライブ内の <code>/HELLMANN</code> を本システムで直接読み書きします。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestGoogleDrive}
                    disabled={isTestingGoogleDrive}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50 shrink-0"
                    title="Google ドライブのアクセス権限を確認します"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingGoogleDrive ? 'animate-spin' : ''}`} />
                    <span>{isTestingGoogleDrive ? '確認中...' : 'Google ドライブ 接続テスト'}</span>
                  </button>
                </div>

                {/* Google Drive Test Result */}
                {googleDriveTestResult && (
                  <div
                    className={`p-3 rounded-xl border flex items-start gap-2 text-xs ${
                      googleDriveTestResult.success
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                        : 'bg-rose-50 border-rose-300 text-rose-900'
                    }`}
                  >
                    {googleDriveTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-bold block">{googleDriveTestResult.message}</span>
                      {googleDriveTestResult.folderPath && (
                        <span className="text-[10px] text-emerald-800 font-mono mt-0.5 block">
                          対象フォルダ: {googleDriveTestResult.folderPath}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Google Service Account JSON Key Input */}
                <div className="bg-white p-3.5 rounded-xl border border-emerald-200 space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-slate-800 font-bold flex items-center gap-1.5 text-xs">
                        <Key className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Google サービスアカウント 鍵 JSON (推奨・一発設定):</span>
                      </label>
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-semibold border border-emerald-200">
                        貼り付けると自動解析・展開されます
                      </span>
                    </div>
                    <textarea
                      value={settings.googleDriveServiceAccountKeyJson || ''}
                      onChange={(e) => handleGoogleJsonChange(e.target.value)}
                      placeholder='Google Cloud Consoleからダウンロードした service-account.json の中身をそのまま貼り付けてください {"type": "service_account", "client_email": "...", "private_key": "..."}'
                      rows={3}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-slate-800 font-mono text-[11px] focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                    <div>
                      <label className="block text-slate-700 font-bold mb-1 text-xs">
                        サービスアカウント Email (client_email):
                      </label>
                      <input
                        type="text"
                        value={settings.googleDriveServiceAccountEmail || ''}
                        onChange={(e) => setSettings({ ...settings, googleDriveServiceAccountEmail: e.target.value })}
                        placeholder="例: hellmann-sync@project-id.iam.gserviceaccount.com"
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold mb-1 text-xs">
                        Google ドライブ保管フォルダ名 / フォルダID:
                      </label>
                      <input
                        type="text"
                        value={settings.googleDriveBasePath || 'HELLMANN'}
                        onChange={(e) => setSettings({ ...settings, googleDriveBasePath: e.target.value })}
                        placeholder="HELLMANN または フォルダURL"
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 mt-0.5 block">
                        ※ Google ドライブの共有フォルダURLまたはフォルダ名 <code>HELLMANN</code> を指定
                      </span>
                    </div>
                  </div>

                  {/* Private Key textarea if manually editing */}
                  <div>
                    <label className="block text-slate-700 font-bold mb-1 text-xs">
                      秘密鍵 (private_key PEM):
                    </label>
                    <input
                      type="password"
                      value={settings.googleDrivePrivateKey || ''}
                      onChange={(e) => setSettings({ ...settings, googleDrivePrivateKey: e.target.value })}
                      placeholder="-----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-700 font-semibold bg-white/80 p-2.5 rounded-lg border border-emerald-100">
                  <input
                    type="checkbox"
                    checked={settings.googleDriveAutoSaveNewOrders ?? true}
                    onChange={(e) => setSettings({ ...settings, googleDriveAutoSaveNewOrders: e.target.checked })}
                    className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                  />
                  <span>新着通関依頼メールの添付書類（SI・インボイス等）を受信時にGoogle ドライブへ自動保存する</span>
                </label>

                {/* Setup Guide for Google Drive & Power Automate */}
                <details className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200 text-xs text-emerald-950 group">
                  <summary className="font-bold flex items-center justify-between cursor-pointer list-none select-none">
                    <span className="flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 text-emerald-600" />
                      <span>💡 Google ドライブ ＆ Power Automate 3分かんたん連携手順</span>
                    </span>
                    <span className="text-[11px] text-emerald-700 font-normal group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="pt-2.5 mt-2 border-t border-emerald-200/80 space-y-2 text-[11px] leading-relaxed text-emerald-900">
                    <p><strong>ステップ 1 (Google Cloud):</strong> Google Cloud Consoleでプロジェクトを作成し、「Google Drive API」を有効化してサービスアカウント（鍵JSON）を作成します。</p>
                    <p><strong>ステップ 2 (ドライブ共有):</strong> Google ドライブ上に <code>HELLMANN</code> フォルダを作成し、上記サービスアカウントのメールアドレス（<code>xxx@xxx.iam.gserviceaccount.com</code>）を「編集者」として共有します。</p>
                    <p><strong>ステップ 3 (Power Automate):</strong> 会社OneDriveの <code>/HELLMANN</code> フォルダをトリガーにし、Google ドライブの <code>HELLMANN</code> フォルダへファイル作成・同期するフローを稼働させます。</p>
                  </div>
                </details>
              </div>
            )}

            {/* Microsoft OneDrive Configuration Tab */}
            {(settings.storageProvider || 'onedrive') === 'onedrive' && (
              <div className="space-y-3.5 animate-in fade-in duration-200">
                <div className="flex items-center justify-between bg-blue-50/80 p-3 rounded-xl border border-blue-200">
                  <div className="text-xs text-blue-950">
                    <span className="font-bold flex items-center gap-1">
                      <Cloud className="w-4 h-4 text-blue-600" />
                      Microsoft 365 OneDrive 直接連携
                    </span>
                    <p className="text-[11px] text-blue-800 mt-0.5">
                      Microsoft Graph API を使用して、組織または共有アカウントの OneDrive へ直接読み書きします。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestOneDrive}
                    disabled={isTestingOneDrive}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50 shrink-0"
                    title="OneDriveフォルダアクセスと権限を確認します"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingOneDrive ? 'animate-spin' : ''}`} />
                    <span>{isTestingOneDrive ? '接続確認中...' : 'OneDrive 接続テスト'}</span>
                  </button>
                </div>

                {/* OneDrive Test Result Message */}
                {oneDriveTestResult && (
                  <div
                    className={`p-3 rounded-xl border flex items-start gap-2 text-xs ${
                      oneDriveTestResult.success
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                        : 'bg-rose-50 border-rose-300 text-rose-900'
                    }`}
                  >
                    {oneDriveTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-bold block">{oneDriveTestResult.message}</span>
                      {oneDriveTestResult.folderPath && (
                        <span className="text-[10px] text-emerald-800 font-mono mt-0.5 block">
                          確認フォルダパス: {oneDriveTestResult.folderPath}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white/90 p-3 rounded-xl border border-blue-100">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1 flex items-center gap-1.5 text-xs">
                      <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                      <span>OneDrive 保管用アカウント (メール/UPN):</span>
                    </label>
                    <input
                      type="email"
                      value={settings.oneDriveUserEmail || ''}
                      onChange={(e) => setSettings({ ...settings, oneDriveUserEmail: e.target.value })}
                      placeholder="例: kitatoshiya@gmail.com (空欄時はグループメール)"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-500 mt-0.5 block">
                      ※ 空欄の場合は上記共通グループメールまたは認証ユーザーのOneDriveを使用します。
                    </span>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1 flex items-center gap-1.5 text-xs">
                      <FolderCheck className="w-3.5 h-3.5 text-blue-600" />
                      <span>OneDrive 基本保管フォルダパス:</span>
                    </label>
                    <input
                      type="text"
                      value={settings.oneDriveBasePath || '/TAC大阪IBP関連/USER/●サブエージェント/HELLMANN'}
                      onChange={(e) => setSettings({ ...settings, oneDriveBasePath: e.target.value })}
                      placeholder="/TAC大阪IBP関連/USER/●サブエージェント/HELLMANN"
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-500 mt-0.5 block">
                      ※ 案件ごとに <code>/[基本パス]/[YYYYMMDD]/[AWB] [荷受人]</code> が自動作成されます。
                    </span>
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-700 font-semibold bg-white/70 p-2.5 rounded-lg border border-blue-100">
                  <input
                    type="checkbox"
                    checked={settings.oneDriveAutoSaveNewOrders ?? true}
                    onChange={(e) => setSettings({ ...settings, oneDriveAutoSaveNewOrders: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                  />
                  <span>新着通関依頼メールの添付書類（SI・インボイス等）を受信時にOneDriveへ自動保存する</span>
                </label>

                {/* Separate OneDrive Tenant / Credentials Toggle */}
                <div className="bg-white/95 p-3.5 rounded-xl border border-blue-200 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-blue-950 font-bold">
                    <input
                      type="checkbox"
                      checked={settings.useSeparateOneDriveCredentials ?? true}
                      onChange={(e) => setSettings({ ...settings, useSeparateOneDriveCredentials: e.target.checked })}
                      className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="flex items-center gap-1">
                      <Shield className="w-3.5 h-3.5 text-blue-600" />
                      <span>OneDrive専用の認証情報（別ドメイン / 別テナントID）を使用する</span>
                    </span>
                    <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 font-normal">
                      メールとドメインが異なる場合に必須
                    </span>
                  </label>

                  {(settings.useSeparateOneDriveCredentials ?? true) && (
                    <div className="space-y-3 pt-2 border-t border-blue-100/80">
                      <div className="p-2 bg-blue-50/70 rounded-lg text-[11px] text-blue-900 leading-relaxed border border-blue-100">
                        💡 <strong>マルチテナント設定:</strong> メール送信用テナントとは別に、OneDrive（例: <code>kita@tac0015.onmicrosoft.com</code>）が所属するテナントで発行したアプリ登録情報を入力してください。
                      </div>

                      <div>
                        <label className="block text-slate-700 font-bold mb-1 flex items-center gap-1.5 text-xs">
                          <Server className="w-3.5 h-3.5 text-blue-600" />
                          <span>OneDrive側 テナントID (Directory ID):</span>
                        </label>
                        <input
                          type="text"
                          value={settings.oneDriveTenantId || ''}
                          onChange={(e) => setSettings({ ...settings, oneDriveTenantId: e.target.value })}
                          placeholder="例: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (tac0015のテナントID)"
                          className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-slate-700 font-bold mb-1 flex items-center gap-1.5 text-xs">
                            <Key className="w-3.5 h-3.5 text-blue-600" />
                            <span>OneDrive側 クライアントID (Application ID):</span>
                          </label>
                          <input
                            type="text"
                            value={settings.oneDriveClientId || ''}
                            onChange={(e) => setSettings({ ...settings, oneDriveClientId: e.target.value })}
                            placeholder="例: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                            className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-slate-700 font-bold mb-1 flex items-center gap-1.5 text-xs">
                            <Key className="w-3.5 h-3.5 text-blue-600" />
                            <span>OneDrive側 クライアントシークレット (鍵):</span>
                          </label>
                          <input
                            type="password"
                            value={settings.oneDriveClientSecret || ''}
                            onChange={(e) => setSettings({ ...settings, oneDriveClientSecret: e.target.value })}
                            placeholder="シークレットの値"
                            className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Email addresses */}
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-800 font-bold flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>ヘルマン社 ＆ 社内通関士 共通グループメールアドレス (共有メールボックス):</span>
                </label>
                <button
                  type="button"
                  onClick={handleFetchTenantUsers}
                  disabled={isSearchingUsers || !settings.tenantId || !settings.clientId}
                  className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40"
                  title="Entra IDに登録されている実ユーザー/共有メールボックスを一覧取得して自動反映します"
                >
                  <Search className={`w-3 h-3 ${isSearchingUsers ? 'animate-spin' : ''}`} />
                  <span>テナント内候補を検索</span>
                </button>
              </div>
              <input
                type="text"
                value={settings.groupEmail}
                onChange={(e) => setSettings({ ...settings, groupEmail: e.target.value })}
                placeholder="hellmann-team@yourcompany.com"
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                required
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                ※ ヘルマン社からの通関依頼・回答を受信し、<strong>通関士からの質問もこの同一アドレス宛てに受領・返信</strong>します。
              </span>
            </div>

            {/* User Principal Name (UPN) field */}
            <div>
              <label className="block text-slate-700 font-bold mb-1 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                <span>UPN / ユーザー識別子 (通常は自動検出・空欄可):</span>
              </label>
              <input
                type="text"
                value={settings.userPrincipalName || ''}
                onChange={(e) => setSettings({ ...settings, userPrincipalName: e.target.value })}
                placeholder="tac-hellmann@company.onmicrosoft.com または オブジェクトID"
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                ※ テナント内でメールアドレスとUPN（ログインID）が異なる場合や、404エラーが出る場合はこちらにUPNまたはオブジェクトIDを指定してください。
              </span>
            </div>

            {/* Discovered Users List */}
            {tenantUsers.length > 0 && (
              <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-xl space-y-1.5">
                <span className="font-bold text-blue-900 text-xs block">
                  検出されたテナント内メールボックス（クリックで設定に即時反映）:
                </span>
                <div className="max-h-36 overflow-y-auto space-y-1">
                  {tenantUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => handleSelectDiscoveredUser(u)}
                      className="w-full text-left p-2 bg-white hover:bg-blue-100/70 rounded-lg border border-slate-200 transition-colors flex items-center justify-between text-[11px] cursor-pointer"
                    >
                      <div>
                        <span className="font-bold text-slate-800 block">{u.displayName || '名称未設定'}</span>
                        <span className="text-slate-500 font-mono text-[10px]">{u.mail || u.userPrincipalName}</span>
                      </div>
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                        選択
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-700 font-bold mb-1 flex items-center gap-1.5 text-xs">
                  <User className="w-3.5 h-3.5 text-blue-600" />
                  <span>通関士の氏名（宛名用）:</span>
                </label>
                <input
                  type="text"
                  value={settings.brokerDefaultName ?? ''}
                  onChange={(e) => setSettings({ ...settings, brokerDefaultName: e.target.value })}
                  placeholder="白名"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none text-xs"
                />
                <span className="text-[11px] text-slate-500 mt-0.5 block">
                  ※返信メール1行目の「〇〇様」に使用されます
                </span>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1 flex items-center gap-1.5 text-xs">
                  <Mail className="w-3.5 h-3.5 text-blue-600" />
                  <span>社内通関士 送信用メールアドレス:</span>
                </label>
                <input
                  type="email"
                  value={settings.brokerDefaultEmail || ''}
                  onChange={(e) => setSettings({ ...settings, brokerDefaultEmail: e.target.value })}
                  placeholder="shirana@tac-japan.co.jp"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none text-xs"
                />
                <span className="text-[11px] text-slate-500 mt-0.5 block">
                  ※返信メールの送信先（To）初期値に使用されます
                </span>
              </div>
            </div>
          </div>

          {/* Automated Sync Intervals Settings (Common to all users) */}
          <div className="p-4 bg-blue-50/50 border border-blue-200 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-blue-600" />
                <span>メール自動チェック周期設定 (全ユーザー共通)</span>
              </span>
              <span className="text-[11px] font-bold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-full border border-blue-300">
                秒単位設定
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              受信メール（新着案件や通関士からの回答）と、送信メール（他担当者による外部返信検知）のチェック間隔をそれぞれ秒単位で独立設定できます。設定内容はリアルタイムに全端末へ共有・適用されます。
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Inbox Interval */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>受信メールチェック周期:</span>
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">
                    {Math.floor((Number(settings.inboxSyncIntervalSeconds) || 120) / 60)}分
                    {(Number(settings.inboxSyncIntervalSeconds) || 120) % 60 > 0
                      ? ` ${(Number(settings.inboxSyncIntervalSeconds) || 120) % 60}秒`
                      : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="10"
                    step="5"
                    value={settings.inboxSyncIntervalSeconds ?? 120}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        inboxSyncIntervalSeconds: Math.max(10, parseInt(e.target.value, 10) || 10),
                      })
                    }
                    className="w-28 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 font-mono font-bold text-sm text-right focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <span className="text-xs text-slate-600 font-bold">秒</span>
                </div>
                {/* Presets */}
                <div className="flex flex-wrap gap-1 pt-1">
                  {[
                    { label: '1分 (60秒)', val: 60 },
                    { label: '2分 (120秒)', val: 120 },
                    { label: '3分 (180秒)', val: 180 },
                    { label: '5分 (300秒)', val: 300 },
                  ].map((p) => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => setSettings({ ...settings, inboxSyncIntervalSeconds: p.val })}
                      className={`text-[10px] px-2 py-0.5 rounded-md border font-medium cursor-pointer transition-colors ${
                        (settings.inboxSyncIntervalSeconds ?? 120) === p.val
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sent Items Interval */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span>送信メールチェック周期:</span>
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">
                    {Math.floor((Number(settings.sentSyncIntervalSeconds) || 300) / 60)}分
                    {(Number(settings.sentSyncIntervalSeconds) || 300) % 60 > 0
                      ? ` ${(Number(settings.sentSyncIntervalSeconds) || 300) % 60}秒`
                      : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="10"
                    step="5"
                    value={settings.sentSyncIntervalSeconds ?? 300}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        sentSyncIntervalSeconds: Math.max(10, parseInt(e.target.value, 10) || 10),
                      })
                    }
                    className="w-28 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 font-mono font-bold text-sm text-right focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <span className="text-xs text-slate-600 font-bold">秒</span>
                </div>
                {/* Presets */}
                <div className="flex flex-wrap gap-1 pt-1">
                  {[
                    { label: '2分 (120秒)', val: 120 },
                    { label: '3分 (180秒)', val: 180 },
                    { label: '5分 (300秒)', val: 300 },
                    { label: '10分 (600秒)', val: 600 },
                  ].map((p) => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => setSettings({ ...settings, sentSyncIntervalSeconds: p.val })}
                      className={`text-[10px] px-2 py-0.5 rounded-md border font-medium cursor-pointer transition-colors ${
                        (settings.sentSyncIntervalSeconds ?? 300) === p.val
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Email Retention & Display Period (Performance Optimization) */}
          <div className="p-4 bg-indigo-50/60 border border-indigo-200 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-indigo-600" />
                <span>メール同期・表示対象期間 (パフォーマンス最適化)</span>
              </span>
              <span className="text-[11px] font-bold text-indigo-700 bg-indigo-100/90 px-2 py-0.5 rounded-full border border-indigo-300">
                {settings.syncRetentionMode === 'date' && settings.syncRetentionStartDate
                  ? `${settings.syncRetentionStartDate} 以降`
                  : (settings.syncRetentionDays ?? 7) === 0
                  ? '全期間'
                  : `直近 ${settings.syncRetentionDays ?? 7} 日間`}
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              1週間以上前の過去メールはメーラー（Outlook等）で確認する運用に合わせ、共通メールハブの同期・表示対象を直近に限定します。不要な過去メールや重い添付データの通信を排除し、動作と同期速度を大幅に高速化します。
            </p>

            {/* Presets + Custom Selection */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
              {[
                { label: '直近 7 日間', sub: '推奨 (1週間・最速)', mode: 'days' as const, days: 7 },
                { label: '直近 14 日間', sub: '2週間', mode: 'days' as const, days: 14 },
                { label: '直近 30 日間', sub: '1ヶ月間', mode: 'days' as const, days: 30 },
                { label: 'すべてのメール', sub: '全期間 (制限なし)', mode: 'days' as const, days: 0 },
                { label: '任意の日付・日数', sub: 'カスタム指定', mode: 'custom' as const, days: -1 },
              ].map((opt) => {
                const isCustomSelected =
                  opt.mode === 'custom' &&
                  (settings.syncRetentionMode === 'date' ||
                    (settings.syncRetentionMode === 'days' &&
                      settings.syncRetentionDays !== 7 &&
                      settings.syncRetentionDays !== 14 &&
                      settings.syncRetentionDays !== 30 &&
                      settings.syncRetentionDays !== 0));

                const isPresetSelected =
                  opt.mode === 'days' &&
                  settings.syncRetentionMode !== 'date' &&
                  (settings.syncRetentionDays ?? 7) === opt.days &&
                  !isCustomSelected;

                const isSelected = opt.mode === 'custom' ? isCustomSelected : isPresetSelected;

                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => {
                      if (opt.mode === 'custom') {
                        // Switch to custom (default to date or custom days)
                        setSettings({
                          ...settings,
                          syncRetentionMode: settings.syncRetentionMode || 'date',
                          syncRetentionStartDate:
                            settings.syncRetentionStartDate ||
                            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                          syncRetentionDays: settings.syncRetentionDays ?? 7,
                        });
                      } else {
                        setSettings({
                          ...settings,
                          syncRetentionMode: 'days',
                          syncRetentionDays: opt.days,
                        });
                      }
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-200 ring-2 ring-indigo-400 ring-offset-1'
                        : 'bg-white text-slate-800 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                        {opt.label}
                      </span>
                      {opt.days === 7 && (
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                            isSelected ? 'bg-indigo-500 text-white' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          推奨
                        </span>
                      )}
                    </div>
                    <span className={`text-[10px] ${isSelected ? 'text-indigo-100' : 'text-slate-500'}`}>
                      {opt.sub}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Custom Date / Days Input Box */}
            <div className="bg-white p-3 rounded-xl border border-indigo-100 space-y-2.5 mt-2">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span>任意設定 (日付カレンダー指定 または 過去日数指定):</span>
                </span>
                <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      setSettings({
                        ...settings,
                        syncRetentionMode: 'date',
                        syncRetentionStartDate:
                          settings.syncRetentionStartDate ||
                          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                      })
                    }
                    className={`px-2.5 py-0.5 rounded-md font-bold transition-all cursor-pointer ${
                      settings.syncRetentionMode === 'date'
                        ? 'bg-white text-indigo-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    📅 開始日付で指定
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings({
                        ...settings,
                        syncRetentionMode: 'days',
                      })
                    }
                    className={`px-2.5 py-0.5 rounded-md font-bold transition-all cursor-pointer ${
                      settings.syncRetentionMode !== 'date'
                        ? 'bg-white text-indigo-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    🔢 過去日数で指定
                  </button>
                </div>
              </div>

              {settings.syncRetentionMode === 'date' ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-0.5">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-700 font-bold block">
                      この日付以降のメールをすべて同期・表示:
                    </label>
                    <span className="text-[11px] text-slate-500 block">
                      指定日以降に受信・送信されたメールを対象にします。
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={
                        settings.syncRetentionStartDate ||
                        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
                      }
                      onChange={(e) => {
                        const newDate = e.target.value;
                        setSettings({
                          ...settings,
                          syncRetentionMode: 'date',
                          syncRetentionStartDate: newDate,
                        });
                      }}
                      className="bg-slate-50 border border-indigo-300 rounded-lg px-3 py-1.5 text-slate-800 font-mono font-bold text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                    <span className="text-xs font-bold text-indigo-700 whitespace-nowrap">〜 本日</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-0.5">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-700 font-bold block">
                      過去何日間のメールを対象にするか:
                    </label>
                    <span className="text-[11px] text-slate-500 block">
                      例: 3日間、10日間、60日間など自由に入力できます (0 = 全期間)。
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 font-bold">直近</span>
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={settings.syncRetentionDays ?? 7}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setSettings({
                          ...settings,
                          syncRetentionMode: 'days',
                          syncRetentionDays: isNaN(val) ? 0 : Math.max(0, val),
                        });
                      }}
                      className="w-20 bg-slate-50 border border-indigo-300 rounded-lg px-2.5 py-1.5 text-slate-800 font-mono font-bold text-xs text-right focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                    <span className="text-xs font-bold text-indigo-700 whitespace-nowrap">
                      {(settings.syncRetentionDays ?? 7) === 0 ? '(全期間)' : '日間'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Azure AD / Graph API Credentials */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
            <span className="font-bold text-slate-800 block flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-amber-600" />
              <span>Microsoft Entra ID (Azure AD) アプリ認証設定</span>
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 font-medium mb-1">テナントID (Directory ID):</label>
                <input
                  type="text"
                  value={settings.tenantId}
                  onChange={(e) => setSettings({ ...settings, tenantId: e.target.value })}
                  placeholder="your-company.onmicrosoft.com"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">クライアントID (App ID):</label>
                <input
                  type="text"
                  value={settings.clientId}
                  onChange={(e) => setSettings({ ...settings, clientId: e.target.value })}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">クライアントシークレット (鍵):</label>
              <input
                type="password"
                value={settings.clientSecret || ''}
                onChange={(e) => setSettings({ ...settings, clientSecret: e.target.value })}
                placeholder="••••••••••••••••••••••••••••••••"
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Test connection results */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-rose-50 border-rose-300 text-rose-900'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span className="font-medium text-xs leading-relaxed">{testResult.message}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl border border-slate-300 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                <span>M365接続・同期テスト</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>設定を保存して今すぐ同期</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
