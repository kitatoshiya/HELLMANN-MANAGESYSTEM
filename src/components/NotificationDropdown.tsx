import React, { useState, useRef, useEffect } from "react";
import {
  Bell,
  AtSign,
  Volume2,
  VolumeX,
  CheckCheck,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  MessageSquare,
  Clock,
  UserCheck,
} from "lucide-react";
import { QuotationItem, QuoteMessage, StaffMember, UserProfile } from "../types";
import { isUserMentioned, stripHtmlToPlainText } from "../lib/mentionUtils";
import {
  getNotificationSettings,
  saveNotificationSettings,
  requestNotificationPermission,
  playNotificationSound,
} from "../lib/notificationHelper";

interface NotificationItem {
  id: string;
  quoteId: string;
  quoteTitle: string;
  vesselName: string;
  authorName: string;
  createdAt: string;
  snippet: string;
  isMention: boolean;
  isRead: boolean;
}

interface NotificationDropdownProps {
  quotes: QuotationItem[];
  messages: QuoteMessage[];
  currentUser: UserProfile;
  staffMembers: StaffMember[];
  onSelectQuote: (quote: QuotationItem) => void;
  onFilterMyMentions?: () => void;
  onMarkAllAsRead?: () => void;
}

export const NotificationDropdown: React.FC<NotificationDropdownProps> = ({
  quotes,
  messages,
  currentUser,
  staffMembers,
  onSelectQuote,
  onFilterMyMentions,
  onMarkAllAsRead,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState(getNotificationSettings);
  const [pushPermissionStatus, setPushPermissionStatus] = useState<NotificationPermission>(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "default"
  );
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calculate notifications where currentUser is mentioned or assigned
  const notifications = React.useMemo<NotificationItem[]>(() => {
    const list: NotificationItem[] = [];

    // Find messages where user is mentioned or is assigned staff
    messages.forEach((msg) => {
      const parentQuote = quotes.find((q) => q.id === msg.quoteId);
      if (!parentQuote || parentQuote.isArchived) return;

      // Exclude messages authored by the current logged-in user and system status logs
      if (msg.authorEmail?.toLowerCase() === currentUser.email.toLowerCase()) return;
      if (msg.isSystemLog) return;

      const mentioned = isUserMentioned(msg.contentHtml, currentUser, staffMembers);
      const isAssigned = parentQuote.assignedStaffId &&
        staffMembers.find((s) => s.id === parentQuote.assignedStaffId)?.email.toLowerCase() === currentUser.email.toLowerCase();

      if (mentioned || isAssigned) {
        const isRead = parentQuote.readBy?.includes(currentUser.email) || false;
        list.push({
          id: msg.id,
          quoteId: parentQuote.id,
          quoteTitle: parentQuote.title,
          vesselName: parentQuote.vesselName,
          authorName: msg.authorName || msg.authorEmail.split("@")[0],
          createdAt: msg.createdAt,
          snippet: stripHtmlToPlainText(msg.contentHtml),
          isMention: mentioned,
          isRead,
        });
      }
    });

    // Sort newest first
    return list.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [messages, quotes, currentUser, staffMembers]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleTogglePush = async () => {
    if (pushPermissionStatus !== "granted") {
      const res = await requestNotificationPermission();
      setPushPermissionStatus(res);
      if (res === "granted") {
        const updated = { ...settings, enableBrowserPush: true };
        setSettings(updated);
        saveNotificationSettings(updated);
        playNotificationSound();
      }
    } else {
      const updated = { ...settings, enableBrowserPush: !settings.enableBrowserPush };
      setSettings(updated);
      saveNotificationSettings(updated);
    }
  };

  const handleToggleAudio = () => {
    const updated = { ...settings, enableAudioAlert: !settings.enableAudioAlert };
    setSettings(updated);
    saveNotificationSettings(updated);
    if (updated.enableAudioAlert) {
      playNotificationSound();
    }
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="通知センター & メンション着信一覧"
        className={`relative p-2 rounded-lg border transition-all cursor-pointer ${
          unreadCount > 0
            ? "bg-rose-950/80 border-rose-500 text-rose-300 ring-2 ring-rose-500/40 shadow-lg animate-pulse"
            : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300"
        }`}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.2 rounded-full bg-rose-600 text-white text-[10px] font-black shadow-xs border border-slate-900">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu Box */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-slate-900 border border-slate-700 rounded-2xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-sky-600 flex items-center justify-center text-white font-bold">
                <AtSign className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-extrabold text-xs text-slate-100 flex items-center gap-1.5">
                  <span>自分宛てメンション & 通知</span>
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.2 bg-rose-600 text-white rounded-full text-[10px] font-black">
                      {unreadCount}件未読
                    </span>
                  )}
                </h4>
                <p className="text-[10px] text-slate-400 font-bold">
                  {currentUser.name} ({currentUser.email})
                </p>
              </div>
            </div>

            {onMarkAllAsRead && unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllAsRead}
                className="text-[10px] font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                title="すべて既読にする"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>一括既読</span>
              </button>
            )}
          </div>

          {/* Quick Settings Bar: Push Notification & Audio Toggles */}
          <div className="px-3 py-2 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-[11px] font-bold">
            {/* Desktop Push Status Toggle */}
            <button
              type="button"
              onClick={handleTogglePush}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border cursor-pointer ${
                pushPermissionStatus === "granted" && settings.enableBrowserPush
                  ? "bg-emerald-950 text-emerald-300 border-emerald-700"
                  : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
              }`}
              title="アプリを閉じていてもデスクトップ通知を受け取る設定"
            >
              {pushPermissionStatus === "granted" && settings.enableBrowserPush ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>デスクトップ通知: ON</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  <span>デスクトップ通知を有効化</span>
                </>
              )}
            </button>

            {/* Audio Alert Toggle */}
            <button
              type="button"
              onClick={handleToggleAudio}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border cursor-pointer ${
                settings.enableAudioAlert
                  ? "bg-sky-950 text-sky-300 border-sky-700"
                  : "bg-slate-800 text-slate-400 border-slate-700"
              }`}
              title="着信音 (Web Audioチャイム) の切り替え"
            >
              {settings.enableAudioAlert ? (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-sky-400" />
                  <span>効果音: ON</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                  <span>効果音: OFF</span>
                </>
              )}
            </button>
          </div>

          {/* Notifications List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/80 custom-scrollbar">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 font-bold space-y-1">
                <Sparkles className="w-6 h-6 text-slate-500 mx-auto" />
                <p>あなた宛ての新しいメンションや担当通知はありません</p>
              </div>
            ) : (
              notifications.map((item) => {
                const parentQuote = quotes.find((q) => q.id === item.quoteId);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (parentQuote) {
                        onSelectQuote(parentQuote);
                        setIsOpen(false);
                      }
                    }}
                    className={`w-full text-left p-3 hover:bg-slate-800/80 transition-all cursor-pointer flex flex-col gap-1 ${
                      !item.isRead ? "bg-sky-950/40 border-l-4 border-l-sky-500" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5 font-extrabold text-sky-300 truncate">
                        {item.isMention ? (
                          <span className="px-1.5 py-0.2 bg-fuchsia-950 text-fuchsia-300 border border-fuchsia-800 rounded font-mono text-[10px] shrink-0">
                            @メンション
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 bg-indigo-950 text-indigo-300 border border-indigo-800 rounded font-mono text-[10px] shrink-0">
                            担当案件
                          </span>
                        )}
                        <span className="truncate">{item.quoteTitle}</span>
                      </div>

                      <span className="text-[10px] text-slate-400 shrink-0 font-mono flex items-center gap-0.5">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {new Date(item.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <p className="text-xs text-slate-200 font-bold truncate">
                      船名: <span className="text-amber-300">{item.vesselName}</span>
                    </p>

                    <p className="text-[11px] text-slate-300 line-clamp-2 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 mt-0.5 font-medium">
                      <span className="text-sky-400 font-bold mr-1">{item.authorName}:</span>
                      {item.snippet}
                    </p>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer Filter Trigger */}
          {onFilterMyMentions && (
            <div className="p-2.5 bg-slate-950 border-t border-slate-800 text-center">
              <button
                type="button"
                onClick={() => {
                  onFilterMyMentions();
                  setIsOpen(false);
                }}
                className="w-full py-1.5 bg-sky-950 hover:bg-sky-900 text-sky-200 border border-sky-800/80 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <UserCheck className="w-3.5 h-3.5 text-sky-400" />
                <span>メイン画面で「自分宛てメンション」を絞り込み表示</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
