import React, { useState, useEffect } from 'react';
import { NotificationSettings } from '../types';
import {
  getNotificationSettings,
  saveNotificationSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
  showToast,
  playNotificationChime,
} from '../lib/notificationService';
import {
  Bell,
  CheckCircle2,
  Clock,
  Volume2,
  VolumeX,
  Sparkles,
  AlertTriangle,
  Flame,
  RotateCcw,
  Save,
  X,
  HelpCircle,
  ShieldCheck,
  Zap,
} from 'lucide-react';

interface SystemNotificationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WARNING_MINUTE_OPTIONS = [
  { value: 15, label: '15分前', desc: '直前アラート' },
  { value: 30, label: '30分前', desc: '標準' },
  { value: 45, label: '45分前', desc: '余裕あり' },
  { value: 60, label: '60分前', desc: '推奨 (デフォルト)' },
  { value: 90, label: '90分前', desc: '早め' },
  { value: 120, label: '120分前 (2時間前)', desc: '最長' },
];

const AUTO_DISMISS_OPTIONS = [
  { value: 4, label: '4秒 (短め)' },
  { value: 6, label: '6秒 (標準)' },
  { value: 8, label: '8秒 (ゆっくり)' },
  { value: 12, label: '12秒 (長め)' },
];

export const SystemNotificationSettingsModal: React.FC<SystemNotificationSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [settings, setSettings] = useState<NotificationSettings>(getNotificationSettings());
  const [savedSuccessMsg, setSavedSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSettings(getNotificationSettings());
      setSavedSuccessMsg(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    saveNotificationSettings(settings);
    setSavedSuccessMsg('通知設定を保存しました。');
    setTimeout(() => {
      onClose();
    }, 400);
  };

  const handleResetDefaults = () => {
    if (confirm('通知設定をシステム初期値にリセットしますか？')) {
      setSettings(DEFAULT_NOTIFICATION_SETTINGS);
      saveNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);
      setSavedSuccessMsg('初期設定に戻しました。');
    }
  };

  const handleTestNewShipmentToast = () => {
    showToast({
      type: 'success',
      title: '新規案件 登録完了 (テスト通知)',
      message: '[HAWB-TEST-8890] 株式会社グローバルロジスティクス (向地: LAX)',
      subMessage: '全自動SI解析によりタスク 6件を正常に初期化しました。',
      actions: [
        {
          label: '案件詳細を開く (デモ)',
          primary: true,
          onClick: () => {
            alert('通知アクションの動作確認に成功しました。');
          },
        },
      ],
    });
  };

  const handleTestCutTimeAlertToast = () => {
    const minutes = settings.cutTimeWarningMinutes || 60;
    showToast({
      type: 'warning',
      title: `【カット時間警告】残り ${minutes} 分 (テスト通知)`,
      message: '[999-7711-2233] 締切時刻: 17:00 (東京エレクトロニクス)',
      subMessage: '未完了作業工程: 3件 残っています。至急ご対応ください。 (※完了済案件は非対象)',
      isCutTimeAlert: true,
      cutTime: '17:00',
      remainingMinutes: minutes,
      actions: [
        {
          label: '未完了タスクを確認 (デモ)',
          primary: true,
          onClick: () => {
            alert('カット時間アラート通知のアクション確認に成功しました。');
          },
        },
      ],
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150 flex flex-col">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-6 flex justify-between items-start shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Bell className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold">システム通知 & カット時間アラート設定</h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-blue-900 text-blue-300 border border-blue-700">
                  Settings
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                新規案件登録時のトースト通知および当日カット時間接近アラートの有効・無効を切替えます。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(85vh-160px)]">
          {savedSuccessMsg && (
            <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{savedSuccessMsg}</span>
            </div>
          )}

          {/* Master Toggle */}
          <div className="bg-slate-900 text-white p-4 rounded-2xl border border-slate-800 flex items-center justify-between shadow-sm">
            <div>
              <div className="text-sm font-bold flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>トースト通知システム (全体マスター設定)</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                画面右上へのトースト通知のポップアップ表示を一括で制御します。
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-12 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:width-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* Specific Notification Toggles */}
          <div className={`space-y-4 transition-opacity ${settings.enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 font-mono">
              通知イベント個別設定 (Notification Events)
            </h3>

            {/* Toggle 1: New Shipment Processed */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-slate-50 transition-colors flex items-start justify-between gap-4">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    新規案件の登録完了トースト通知
                  </div>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    SI (PDF) 自動解析や手動登録により新規案件が正常に取り込まれた際、成功トーストと案件詳細へのクイック遷移ボタンを表示します。
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                <input
                  type="checkbox"
                  checked={settings.notifyOnNewShipment}
                  onChange={(e) => setSettings({ ...settings, notifyOnNewShipment: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            {/* Toggle 2: Approaching Cut-off Time Alert */}
            <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/50 hover:bg-amber-50 transition-colors flex items-start justify-between gap-4">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
                  <Flame className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <span>当日カット時間・締切接近アラート通知</span>
                    <span className="text-[10px] bg-amber-200/80 text-amber-900 px-1.5 py-0.5 rounded font-bold">
                      要件準拠
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                    本日対応予定の案件で、カット時間（搬入締切）が迫っている未完了タスクがある場合に警告トーストを発行します。
                  </p>
                  <div className="mt-2 text-[11px] font-bold text-emerald-800 bg-emerald-100/70 border border-emerald-200 px-2.5 py-1 rounded-lg inline-flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>完了済（Completed）の案件・工程タスクは自動的に非対象（除外）となります</span>
                  </div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                <input
                  type="checkbox"
                  checked={settings.notifyOnApproachingCutTime}
                  onChange={(e) => setSettings({ ...settings, notifyOnApproachingCutTime: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
              </label>
            </div>

            {/* Cut-off Warning Time Selector */}
            {settings.notifyOnApproachingCutTime && (
              <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-blue-600" />
                    <span>カット時間 事前警告タイミング:</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                    締切の {settings.cutTimeWarningMinutes} 分前に通知
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {WARNING_MINUTE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSettings({ ...settings, cutTimeWarningMinutes: opt.value })}
                      className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                        settings.cutTimeWarningMinutes === opt.value
                          ? 'border-blue-600 bg-blue-50 text-blue-900 font-bold shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      <div className="text-xs font-bold">{opt.label}</div>
                      <div className="text-[10px] text-slate-400">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sound and Auto-Dismiss Settings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Sound Setting */}
              <div className="p-4 rounded-2xl border border-slate-200 bg-white flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  {settings.soundEnabled ? (
                    <Volume2 className="w-5 h-5 text-indigo-600 shrink-0" />
                  ) : (
                    <VolumeX className="w-5 h-5 text-slate-400 shrink-0" />
                  )}
                  <div>
                    <div className="text-xs font-bold text-slate-800">通知音 (サウンド効果)</div>
                    <div className="text-[11px] text-slate-500">Web Audio チャイム再生</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.soundEnabled}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setSettings({ ...settings, soundEnabled: val });
                      if (val) playNotificationChime('success');
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {/* Auto Dismiss Duration */}
              <div className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col justify-between">
                <div className="text-xs font-bold text-slate-800 mb-1.5 flex items-center justify-between">
                  <span>表示フェードアウト時間:</span>
                  <span className="text-[11px] font-mono text-slate-600">{settings.autoDismissSeconds} 秒</span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {AUTO_DISMISS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSettings({ ...settings, autoDismissSeconds: opt.value })}
                      className={`py-1 text-[10px] font-bold rounded-lg border transition-all text-center cursor-pointer ${
                        settings.autoDismissSeconds === opt.value
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      {opt.value}秒
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Test Notification Trigger Area */}
            <div className="p-4 rounded-2xl bg-slate-100/80 border border-slate-200 space-y-2">
              <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                  通知プレビュー & 動作テスト
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Real-time Test</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleTestNewShipmentToast}
                  className="px-3 py-2 text-xs font-bold text-emerald-900 bg-emerald-100/80 hover:bg-emerald-100 border border-emerald-300 rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  <span>登録完了トースト テスト</span>
                </button>
                <button
                  type="button"
                  onClick={handleTestCutTimeAlertToast}
                  className="px-3 py-2 text-xs font-bold text-amber-950 bg-amber-100/90 hover:bg-amber-100 border border-amber-300 rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 cursor-pointer"
                >
                  <Flame className="w-3.5 h-3.5 text-amber-700" />
                  <span>カット時間警告 テスト</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>初期値にリセット</span>
          </button>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-xl transition-colors cursor-pointer"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm active:scale-95 flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>設定を保存する</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
