import React, { useState, useEffect } from "react";
import { X, Bell, Mail, CheckCircle2, ShieldAlert, Sparkles, Monitor } from "lucide-react";
import {
  NotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
  AppTheme,
  UserProfile,
} from "../types";
import { requestNotificationPermission, triggerDesktopNotification } from "../lib/notificationHelper";

interface NotificationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  currentTheme: AppTheme;
  preferences: NotificationPreferences;
  onSave: (prefs: NotificationPreferences) => void;
}

export function NotificationSettingsModal({
  isOpen,
  onClose,
  currentUser,
  currentTheme,
  preferences,
  onSave,
}: NotificationSettingsModalProps) {
  const [prefs, setPrefs] = useState<NotificationPreferences>(() =>
    normalizeNotificationPreferences(preferences)
  );
  const [permissionState, setPermissionState] = useState<string>(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default"
  );
  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPrefs(normalizeNotificationPreferences(preferences));
    }
  }, [isOpen, preferences]);

  if (!isOpen) return null;

  const isLight = currentTheme === "light";
  const bgClass = isLight ? "bg-white text-slate-900 border-slate-200" : "bg-slate-900 text-slate-100 border-slate-800";
  const sectionBgClass = isLight ? "bg-slate-50 border-slate-200" : "bg-slate-950/70 border-slate-800";

  const handleTestNotification = async () => {
    const perm = await requestNotificationPermission();
    setPermissionState(perm);
    if (perm === "granted") {
      triggerDesktopNotification(
        "通知テスト成功",
        `こんにちは ${currentUser.name} さん！デスクトップ通知が正常に機能しています。`
      );
    } else {
      alert("ブラウザの通知権限が拒否されています。ブラウザの設定から通知を許可してください。");
    }
  };

  const handleSave = () => {
    onSave(prefs);
    setSavedFeedback(true);
    setTimeout(() => {
      setSavedFeedback(false);
      onClose();
    }, 600);
  };

  const toggleStatusChange = (statusKey: keyof NotificationPreferences["notifyOnStatusChanges"]) => {
    setPrefs((prev) => ({
      ...prev,
      notifyOnStatusChanges: {
        ...prev.notifyOnStatusChanges,
        [statusKey]: !prev.notifyOnStatusChanges[statusKey],
      },
    }));
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className={`w-full max-w-lg rounded-xl shadow-2xl border ${bgClass} my-8`}>
        {/* Modal Header */}
        <div className={`flex items-center justify-between p-4 border-b ${isLight ? "border-slate-200" : "border-slate-800"}`}>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
              <Bell className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h2 className="text-lg font-black leading-tight">通知・メール配信設定</h2>
              <p className={`text-xs ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                {currentUser.name} ({currentUser.email}) の通知設定
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isLight ? "hover:bg-slate-200 text-slate-500" : "hover:bg-slate-800 text-slate-400"
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Main Delivery Channels */}
          <div className={`p-4 rounded-xl border space-y-4 ${sectionBgClass}`}>
            <h3 className="text-sm font-bold flex items-center gap-2 text-sky-400">
              <Monitor className="w-4 h-4" />
              通知チャネル基本設定
            </h3>

            {/* Desktop Notification Toggle */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <span className="text-sm font-bold block">デスクトップ通知 (Web Push)</span>
                <span className={`text-xs block ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                  ブラウザ画面にポップアップ通知を発行します
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={prefs.desktopEnabled}
                  onChange={(e) => setPrefs({ ...prefs, desktopEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
              </label>
            </div>

            {/* Test Push Button */}
            {prefs.desktopEnabled && (
              <div className="flex items-center justify-between pt-1 border-t border-slate-700/50">
                <span className="text-xs text-slate-400">
                  権限状態: <strong className={permissionState === "granted" ? "text-emerald-400" : "text-amber-400"}>
                    {permissionState === "granted" ? "許可済み" : permissionState === "denied" ? "拒否されています" : "未設定"}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={handleTestNotification}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-sky-900/60 hover:bg-sky-800 text-sky-300 border border-sky-600/50 transition-colors flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  通知テスト / 許可申請
                </button>
              </div>
            )}

            {/* Email Notification Toggle */}
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-700/50">
              <div>
                <span className="text-sm font-bold flex items-center gap-1.5">
                  <Mail className="w-4 h-4 text-emerald-400" />
                  メール通知受信
                </span>
                <span className={`text-xs block ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                  自分宛てのメンションや指定イベントをメール通知します
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={prefs.emailEnabled}
                  onChange={(e) => setPrefs({ ...prefs, emailEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>
          </div>

          {/* Special Trigger Events */}
          <div className={`p-4 rounded-xl border space-y-3 ${sectionBgClass}`}>
            <h3 className="text-sm font-bold flex items-center gap-2 text-amber-400">
              <ShieldAlert className="w-4 h-4" />
              個別トリガー設定
            </h3>

            <div className="space-y-2.5">
              <label className="flex items-center justify-between cursor-pointer p-2 rounded-lg hover:bg-slate-800/40 transition-colors">
                <span className="text-sm font-semibold">@メンションで自分が指名された時</span>
                <input
                  type="checkbox"
                  checked={prefs.notifyOnMentions}
                  onChange={(e) => setPrefs({ ...prefs, notifyOnMentions: e.target.checked })}
                  className="w-4 h-4 rounded text-sky-500 focus:ring-sky-400 accent-sky-500"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer p-2 rounded-lg hover:bg-slate-800/40 transition-colors">
                <span className="text-sm font-semibold">自分が案件の担当者に割り当てられた時</span>
                <input
                  type="checkbox"
                  checked={prefs.notifyOnAssignedTasks}
                  onChange={(e) => setPrefs({ ...prefs, notifyOnAssignedTasks: e.target.checked })}
                  className="w-4 h-4 rounded text-sky-500 focus:ring-sky-400 accent-sky-500"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer p-2 rounded-lg hover:bg-slate-800/40 transition-colors">
                <span className="text-sm font-semibold">「至急・緊急」フラグ案件が登録された時</span>
                <input
                  type="checkbox"
                  checked={prefs.notifyOnUrgent}
                  onChange={(e) => setPrefs({ ...prefs, notifyOnUrgent: e.target.checked })}
                  className="w-4 h-4 rounded text-sky-500 focus:ring-sky-400 accent-sky-500"
                />
              </label>
            </div>
          </div>

          {/* Status Change & Task Addition Notifications */}
          <div className={`p-4 rounded-xl border space-y-4 ${sectionBgClass}`}>
            <div>
              <h3 className="text-sm font-bold text-sky-400 flex items-center gap-2">
                <Bell className="w-4 h-4" />
                ステータス変更・タスク追加時の通知設定
              </h3>
              <p className={`text-xs mt-1 ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                タスクが指定状態へ変更・追加された際、およびアーカイブ時の通知条件を設定します。
              </p>
            </div>

            {/* Consolidated Task Scope Setting */}
            <div className="space-y-1.5 pt-2 border-t border-slate-700/50">
              <label className="text-xs font-bold text-slate-300 block">
                対象タスクの指定（以下の通知イベント共通）
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPrefs((prev) => ({ ...prev, statusChangeScope: "all" }))}
                  className={`p-2.5 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                    prefs.statusChangeScope === "all"
                      ? "bg-sky-600 text-white border-sky-500 shadow-sm"
                      : isLight
                      ? "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                      : "bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  すべてのタスク
                </button>

                <button
                  type="button"
                  onClick={() => setPrefs((prev) => ({ ...prev, statusChangeScope: "mentioned_only" }))}
                  className={`p-2.5 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                    prefs.statusChangeScope === "mentioned_only"
                      ? "bg-sky-600 text-white border-sky-500 shadow-sm"
                      : isLight
                      ? "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                      : "bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  メンションで自分が指定されたタスクのみ
                </button>
              </div>
            </div>

            {/* 6 Event Toggles */}
            <div className="space-y-2 pt-2 border-t border-slate-700/50">
              <label className="text-xs font-bold text-slate-300 block mb-1">
                通知を受け取る状態（ON/OFF設定）
              </label>
              <div className="space-y-2">
                {[
                  { key: "requested", label: "”見積依頼”にタスクが追加された", badge: "見積依頼", color: "text-emerald-400 border-emerald-500/30 bg-emerald-950/20" },
                  { key: "estimated", label: "”見積済み”にタスクが追加された", badge: "見積済み", color: "text-blue-400 border-blue-500/30 bg-blue-950/20" },
                  { key: "re_estimating", label: "”見積連絡済”にタスクが追加された", badge: "見積連絡済", color: "text-purple-400 border-purple-500/30 bg-purple-950/20" },
                  { key: "accepted", label: "”受託”にタスクが追加された", badge: "受託", color: "text-emerald-400 border-emerald-500/30 bg-emerald-950/20" },
                  { key: "closed_or_on_hold", label: "”失注・保留”にタスクが追加された", badge: "失注・保留", color: "text-rose-400 border-rose-500/30 bg-rose-950/20" },
                  { key: "archived", label: "タスクがアーカイブされた", badge: "アーカイブ", color: "text-slate-400 border-slate-500/30 bg-slate-900/40" },
                ].map((item) => {
                  const isChecked = Boolean(
                    prefs.notifyOnStatusChanges[item.key as keyof NotificationPreferences["notifyOnStatusChanges"]]
                  );
                  return (
                    <label
                      key={item.key}
                      className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                        isChecked
                          ? isLight ? "bg-sky-50 border-sky-300 text-slate-900" : "bg-sky-950/40 border-sky-700/60 text-slate-100"
                          : isLight ? "bg-white border-slate-200 text-slate-500" : "bg-slate-900/60 border-slate-800/80 text-slate-400"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${item.color}`}>
                          {item.badge}
                        </span>
                        <span className="text-xs font-semibold">{item.label}</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleStatusChange(item.key as keyof NotificationPreferences["notifyOnStatusChanges"])}
                        className="w-4 h-4 rounded text-sky-500 focus:ring-sky-400 accent-sky-500 shrink-0"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className={`p-4 border-t flex items-center justify-between ${isLight ? "border-slate-200 bg-slate-50" : "border-slate-800 bg-slate-900/50"}`}>
          <div className="flex items-center gap-1.5">
            {savedFeedback && (
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 animate-fadeIn">
                <CheckCircle2 className="w-4 h-4" />
                設定を保存しました
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 text-sm font-bold rounded-lg border transition-colors ${
                isLight
                  ? "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              }`}
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 text-sm font-bold rounded-lg bg-sky-600 hover:bg-sky-500 text-white shadow-md transition-colors flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              設定を保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
