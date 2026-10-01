import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  MessageSquare,
  Minus,
  Maximize2,
  X,
  Send,
  Settings,
  Bell,
  CheckCheck,
  Clock,
  Trash2,
  GripHorizontal,
  AtSign,
  RotateCcw,
} from "lucide-react";
import { ChatMessage, ChatWindowState, ChatTypingStatus, StaffMember, UserProfile } from "../types";
import { isUserMentioned, processMentionNotificationsAndEmails } from "../lib/mentionUtils";
import { formatNotificationTimestamp, isEventAlreadyNotified, markEventAsNotified, triggerDesktopNotification } from "../lib/notificationHelper";

interface KanbanChatWindowProps {
  currentUser: UserProfile;
  staffMembers: StaffMember[];
  chatMessages: ChatMessage[];
  chatTypingUsers?: ChatTypingStatus[];
  onSendMessage: (content: string, mentions: string[]) => void;
  onMarkAllRead: () => void;
  onCleanupOldMessages?: (retentionDays: number) => void;
  onDeleteMessage?: (msgId: string) => void;
  onTyping?: () => void;
}

const STORAGE_KEY_RETENTION = "chat_retention_days";
const HEADER_HEIGHT = 44;

export function KanbanChatWindow({
  currentUser,
  staffMembers,
  chatMessages,
  chatTypingUsers = [],
  onSendMessage,
  onMarkAllRead,
  onCleanupOldMessages,
  onDeleteMessage,
  onTyping,
}: KanbanChatWindowProps) {
  // --- Window State (Pos, Size, Minimized) per Logged-in User ---
  const storageKey = `kanban_chat_window_state_${currentUser.email}`;

  const [windowState, setWindowState] = useState<ChatWindowState>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          typeof parsed.x === "number" &&
          typeof parsed.y === "number" &&
          typeof parsed.width === "number" &&
          typeof parsed.height === "number"
        ) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Failed to parse chat window state", e);
    }
    // Default initial window position (bottom right)
    const initialWidth = 350;
    const initialHeight = 440;
    const initialX = Math.max(16, typeof window !== "undefined" ? window.innerWidth - initialWidth - 30 : 800);
    const initialY = Math.max(70, typeof window !== "undefined" ? window.innerHeight - initialHeight - 30 : 300);

    return {
      x: initialX,
      y: initialY,
      width: initialWidth,
      height: initialHeight,
      isMinimized: false,
    };
  });

  // Re-load state when currentUser changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        setWindowState(JSON.parse(saved));
        return;
      }
    } catch (e) {
      console.error(e);
    }
    const initialWidth = 350;
    const initialHeight = 440;
    const initialX = Math.max(16, typeof window !== "undefined" ? window.innerWidth - initialWidth - 30 : 800);
    const initialY = Math.max(70, typeof window !== "undefined" ? window.innerHeight - initialHeight - 30 : 300);

    setWindowState({
      x: initialX,
      y: initialY,
      width: initialWidth,
      height: initialHeight,
      isMinimized: false,
    });
  }, [currentUser.email, storageKey]);

  // Save window state whenever it changes
  const saveState = (newState: ChatWindowState) => {
    setWindowState(newState);
    try {
      localStorage.setItem(storageKey, JSON.stringify(newState));
    } catch (e) {
      console.error("Failed to save chat window state", e);
    }
  };

  // --- Retention Setting State ---
  const [retentionDays, setRetentionDays] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_RETENTION);
      if (saved !== null) return parseInt(saved, 10);
    } catch (e) {
      console.error(e);
    }
    return 30; // Default 30 days retention
  });

  const [showSettings, setShowSettings] = useState(false);

  const handleUpdateRetention = (days: number) => {
    setRetentionDays(days);
    try {
      localStorage.setItem(STORAGE_KEY_RETENTION, String(days));
    } catch (e) {
      console.error(e);
    }
    if (onCleanupOldMessages) {
      onCleanupOldMessages(days);
    }
  };

  // --- Input & Mention Autocomplete ---
  const [inputText, setInputText] = useState("");
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Filter messages according to retention period
  const activeChatMessages = useMemo(() => {
    if (retentionDays <= 0) return chatMessages;
    const cutoffTime = Date.now() - retentionDays * 86400000;
    return chatMessages.filter((msg) => {
      const time = new Date(msg.createdAt).getTime();
      return isNaN(time) || time >= cutoffTime;
    });
  }, [chatMessages, retentionDays]);

  // Active Typers logic (last 3 seconds, excluding self)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const activeTypers = useMemo(() => {
    return chatTypingUsers
      .filter((t) => t.email !== currentUser.email && now - t.lastTypedAt < 3000)
      .map((t) => t.name);
  }, [chatTypingUsers, currentUser.email, now]);

  // Scroll to bottom when new messages arrive or typing status changes
  useEffect(() => {
    if (!windowState.isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeChatMessages.length, windowState.isMinimized, activeTypers.length]);

  // --- Unread & Mention Counts ---
  const totalUnreadCount = useMemo(() => {
    return activeChatMessages.filter((msg) => !msg.readBy?.includes(currentUser.email)).length;
  }, [activeChatMessages, currentUser.email]);

  const mentionUnreadCount = useMemo(() => {
    return activeChatMessages.filter((msg) => {
      if (msg.readBy?.includes(currentUser.email)) return false;
      return isUserMentioned(msg.content, currentUser, staffMembers);
    }).length;
  }, [activeChatMessages, currentUser.email, staffMembers]);

  // Has unread mention targeting current user -> Window Highlight!
  const hasUnreadMention = mentionUnreadCount > 0;

  // --- Track Notified Message IDs for Browser Notification ---
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const isInitialChatLoadRef = useRef(true);

  useEffect(() => {
    if (isInitialChatLoadRef.current) {
      // Mark all current chat messages as already processed so opening window / restarting app doesn't re-notify
      activeChatMessages.forEach((msg) => {
        notifiedIdsRef.current.add(msg.id);
        markEventAsNotified(msg.id);
        markEventAsNotified(`chat-mention-${msg.id}`);
      });
      isInitialChatLoadRef.current = false;
      return;
    }

    activeChatMessages.forEach((msg) => {
      const tag = `chat-mention-${msg.id}`;
      // If author is someone else, user is mentioned, and message is not yet notified
      if (
        msg.authorEmail?.toLowerCase() !== currentUser.email?.toLowerCase() &&
        !notifiedIdsRef.current.has(msg.id) &&
        !isEventAlreadyNotified(msg.id) &&
        !isEventAlreadyNotified(tag) &&
        isUserMentioned(msg.content, currentUser, staffMembers)
      ) {
        notifiedIdsRef.current.add(msg.id);
        markEventAsNotified(msg.id);
        markEventAsNotified(tag);

        // Trigger browser notification (NO email sent for chat mentions as per requirement)
        const timeStr = formatNotificationTimestamp(msg.createdAt);
        triggerDesktopNotification(
          `🔔 [チャット] ${msg.authorName || msg.authorEmail}さんからのメンション`,
          `${(msg.content || "").replace(/<[^>]*>/g, "").slice(0, 100)}\n【発信時刻: ${timeStr}】`,
          tag
        );
      }
    });
  }, [activeChatMessages, currentUser, staffMembers]);

  // --- Drag / Move Logic ---
  const isDraggingRef = useRef(false);
  const dragStartOffsetRef = useRef({ x: 0, y: 0 });

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore button clicks
    if ((e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("select")) {
      return;
    }
    isDraggingRef.current = true;
    
    // 現在の見かけの Y 座標を取得
    const currentRenderedY = windowState.isMinimized 
      ? windowState.y + windowState.height - HEADER_HEIGHT 
      : windowState.y;

    dragStartOffsetRef.current = {
      x: e.clientX - windowState.x,
      y: e.clientY - currentRenderedY,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const maxX = Math.max(0, window.innerWidth - windowState.width);
    const maxY = Math.max(0, window.innerHeight - HEADER_HEIGHT);

    const newX = Math.min(Math.max(0, e.clientX - dragStartOffsetRef.current.x), maxX);
    const newRenderedY = Math.min(Math.max(0, e.clientY - dragStartOffsetRef.current.y), maxY);

    setWindowState((prev) => {
      // 最小化中にドラッグした場合、ベースとなる y は、newRenderedY - prev.height + HEADER_HEIGHT となる
      const newY = prev.isMinimized ? newRenderedY - prev.height + HEADER_HEIGHT : newRenderedY;
      return { ...prev, x: newX, y: newY };
    });
  };

  const handleHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {
        console.warn(err);
      }
      saveState(windowState);
    }
  };

  // --- Resize Logic ---
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isResizingRef.current = true;
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: windowState.width,
      height: windowState.height,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingRef.current) return;
    const deltaX = e.clientX - resizeStartRef.current.x;
    const deltaY = e.clientY - resizeStartRef.current.y;

    const newWidth = Math.min(Math.max(280, resizeStartRef.current.width + deltaX), 700);
    const newHeight = Math.min(Math.max(180, resizeStartRef.current.height + deltaY), 800);

    setWindowState((prev) => ({ ...prev, width: newWidth, height: newHeight }));
  };

  const handleResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isResizingRef.current) {
      isResizingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {
        console.warn(err);
      }
      saveState(windowState);
    }
  };

  // --- Handle Input Text Change & @ Mentions ---
  const lastTypingTimeRef = useRef<number>(0);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

    if (onTyping) {
      const now = Date.now();
      if (now - lastTypingTimeRef.current > 2000) {
        onTyping();
        lastTypingTimeRef.current = now;
      }
    }

    const lastAtIdx = val.lastIndexOf("@");
    if (lastAtIdx !== -1 && lastAtIdx >= val.length - 15) {
      const filterStr = val.substring(lastAtIdx + 1);
      if (!filterStr.includes(" ")) {
        setMentionFilter(filterStr.toLowerCase());
        setShowMentionMenu(true);
        return;
      }
    }
    setShowMentionMenu(false);
  };

  const handleInsertMention = (staff: StaffMember) => {
    const lastAtIdx = inputText.lastIndexOf("@");
    const prefix = inputText.substring(0, lastAtIdx);
    const newText = `${prefix}@${staff.name} `;
    setInputText(newText);
    setShowMentionMenu(false);
    textareaRef.current?.focus();
  };

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;

    // Extract mentioned staff emails
    const mentionedEmails: string[] = [];
    staffMembers.forEach((staff) => {
      if (
        trimmed.includes(`@${staff.name}`) ||
        trimmed.includes(`@${staff.email}`) ||
        trimmed.toLowerCase().includes(staff.email.toLowerCase())
      ) {
        mentionedEmails.push(staff.email);
      }
    });

    onSendMessage(trimmed, mentionedEmails);

    setInputText("");
    setShowMentionMenu(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    }

    if (e.key === "Enter") {
      if (e.shiftKey) {
        // Shift+Enter -> insert newline in textarea
        return;
      } else {
        // Enter -> send message
        e.preventDefault();
        handleSend();
      }
    }
  };

  const toggleMinimize = () => {
    const nextState = { ...windowState, isMinimized: !windowState.isMinimized };
    saveState(nextState);
    if (!nextState.isMinimized) {
      onMarkAllRead();
    }
  };

  // Staff members matching mention filter
  const filteredStaffForMention = useMemo(() => {
    if (!mentionFilter) return staffMembers;
    return staffMembers.filter(
      (s) =>
        s.name.toLowerCase().includes(mentionFilter) ||
        s.email.toLowerCase().includes(mentionFilter)
    );
  }, [staffMembers, mentionFilter]);

  return (
    <div
      style={{
        position: "fixed",
        left: `${windowState.x}px`,
        top: windowState.isMinimized ? `${windowState.y + windowState.height - HEADER_HEIGHT}px` : `${windowState.y}px`,
        width: `${windowState.width}px`,
        height: windowState.isMinimized ? `${HEADER_HEIGHT}px` : `${windowState.height}px`,
        zIndex: 9990,
      }}
      onClick={() => {
        if (totalUnreadCount > 0) {
          onMarkAllRead();
        }
      }}
      className={`rounded-xl shadow-2xl transition-shadow flex flex-col select-none border backdrop-blur-md overflow-hidden ${
        hasUnreadMention
          ? "ring-4 ring-amber-400 border-2 border-amber-500 shadow-amber-500/50 animate-pulse bg-slate-900/95 dark:bg-slate-900/95"
          : "border-slate-300 dark:border-slate-700 bg-slate-900/95 dark:bg-slate-900/95 text-slate-100"
      }`}
    >
      {/* --- Title Bar & Status Header --- */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        className={`h-[44px] shrink-0 px-3 py-2.5 flex items-center justify-between cursor-move select-none border-b transition-colors ${
          hasUnreadMention
            ? "bg-gradient-to-r from-amber-600 via-amber-700 to-amber-600 text-white border-amber-400"
            : "bg-slate-800/90 hover:bg-slate-800 text-slate-100 border-slate-700"
        }`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <GripHorizontal className="w-4 h-4 opacity-50 shrink-0" />
          <MessageSquare className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="font-bold text-xs sm:text-sm truncate">チャット</span>

          {/* Status Badges */}
          <div className="flex items-center gap-1.5 ml-1 shrink-0">
            {totalUnreadCount > 0 ? (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/30">
                未読:{totalUnreadCount}
              </span>
            ) : (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-slate-700 text-slate-400">
                未読:0
              </span>
            )}

            {mentionUnreadCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-black rounded-full bg-red-600 text-white shadow-xs animate-bounce flex items-center gap-0.5">
                <Bell className="w-2.5 h-2.5 fill-current" />
                自分宛:{mentionUnreadCount}
              </span>
            )}
          </div>
        </div>

        {/* Window Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowSettings(!showSettings);
            }}
            title="メッセージ保持期間設定"
            className="p-1 rounded-md hover:bg-slate-700/60 text-slate-300 hover:text-white transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMinimize();
            }}
            title={windowState.isMinimized ? "ウィンドウを展開" : "ウィンドウを最小化"}
            className="p-1 rounded-md hover:bg-slate-700/60 text-slate-300 hover:text-white transition-colors"
          >
            {windowState.isMinimized ? (
              <Maximize2 className="w-3.5 h-3.5" />
            ) : (
              <Minus className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* --- Settings Popover (Retention Days) --- */}
      {showSettings && (
        <div className="p-3 bg-slate-800 border-b border-slate-700 text-xs text-slate-200 flex flex-col gap-2">
          <div className="flex items-center justify-between font-bold text-sky-300">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> メッセージ保持期間設定
            </span>
            <button
              onClick={() => setShowSettings(false)}
              className="hover:text-white p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            指定した期間を過ぎたチャットメッセージは自動的に表示・保存データから削除されます。
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-slate-300 shrink-0">保持期間:</span>
            <select
              value={retentionDays}
              onChange={(e) => handleUpdateRetention(parseInt(e.target.value, 10))}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-sky-500 w-full"
            >
              <option value={7}>7日</option>
              <option value={14}>14日</option>
              <option value={30}>30日 (標準)</option>
              <option value={60}>60日</option>
              <option value={90}>90日</option>
              <option value={0}>無制限 (データ保持)</option>
            </select>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="bg-amber-500/20 border-b border-amber-500/40 text-amber-200 text-[11px] px-3 py-1.5 flex items-center justify-between font-bold animate-in fade-in duration-150">
          <span>{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="hover:text-white p-0.5">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* --- Main Chat Body (Hidden if Minimized) --- */}
      {!windowState.isMinimized && (
        <>
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs custom-scrollbar bg-slate-900/80">
            {activeChatMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center p-4">
                <MessageSquare className="w-8 h-8 mb-2 opacity-30" />
                <p>チャットメッセージはありません。</p>
                <p className="text-[10px] text-slate-600 mt-1">
                  @メンションを使ってチームメンバーにメッセージを送信できます。
                </p>
              </div>
            ) : (
              activeChatMessages.map((msg) => {
                const isMe = msg.authorEmail === currentUser.email;
                const isMentionedMe = isUserMentioned(msg.content, currentUser, staffMembers);
                const isRead = msg.readBy?.includes(currentUser.email);

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col group ${isMe ? "items-end" : "items-start"}`}
                  >
                    {/* Author & Timestamp Header */}
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      <span className="font-semibold text-[11px] text-slate-400">
                        {msg.authorName || msg.authorEmail.split("@")[0]}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(msg.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {onDeleteMessage && isMe && (
                        confirmDeleteId === msg.id ? (
                          <div className="flex items-center gap-1.5 bg-amber-950/90 border border-amber-500/80 text-amber-100 text-[10px] px-2 py-0.5 rounded-lg ml-1 animate-in fade-in duration-150 shadow-md">
                            <span className="font-bold">取り消しますか？</span>
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteMessage(msg.id);
                                setToastMessage("送信を取り消しました");
                                setConfirmDeleteId(null);
                              }}
                              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-1.5 py-0.5 rounded text-[10px] cursor-pointer shadow-xs transition-all active:scale-95"
                            >
                              はい
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors"
                            >
                              いいえ
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(msg.id)}
                            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] text-slate-300 hover:text-amber-300 bg-slate-800/90 hover:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-700/80 transition-all shadow-2xs cursor-pointer ml-1"
                            title="送信取り消し"
                          >
                            <RotateCcw className="w-3 h-3 text-amber-400" />
                            <span className="font-semibold">送信取り消し</span>
                          </button>
                        )
                      )}
                    </div>

                    {/* Message Bubble */}
                    <div
                      className={`max-w-[88%] rounded-2xl px-3 py-2 leading-relaxed break-words shadow-xs border whitespace-pre-wrap ${
                        isMe
                          ? "bg-sky-600 text-white border-sky-500 rounded-tr-none"
                          : isMentionedMe
                          ? "bg-amber-950/90 text-amber-100 border-amber-500 ring-2 ring-amber-500/40 rounded-tl-none font-medium"
                          : "bg-slate-800 text-slate-200 border-slate-700 rounded-tl-none"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                );
              })
            )}

            {/* Typing Indicator */}
            {activeTypers.length > 0 && (
              <div className="flex items-start gap-2 mt-2 px-1">
                <div className="flex gap-1 mt-1.5 ml-2">
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-[10px] text-slate-500 italic">
                  {activeTypers.join(", ")}さんが入力中...
                </span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Autocomplete Mention Menu */}
          {showMentionMenu && filteredStaffForMention.length > 0 && (
            <div className="bg-slate-800 border-t border-slate-700 max-h-32 overflow-y-auto custom-scrollbar p-1">
              <div className="text-[10px] text-slate-400 px-2 py-1 font-semibold border-b border-slate-700/60 flex items-center gap-1">
                <AtSign className="w-3 h-3 text-sky-400" /> メンバーをメンション:
              </div>
              {filteredStaffForMention.map((staff) => (
                <button
                  key={staff.id}
                  onClick={() => handleInsertMention(staff)}
                  className="w-full text-left px-2 py-1.5 hover:bg-slate-700/70 rounded text-xs flex items-center justify-between text-slate-200 transition-colors"
                >
                  <span className="font-medium">{staff.name}</span>
                  <span className="text-[10px] text-slate-400">{staff.email}</span>
                </button>
              ))}
            </div>
          )}

          {/* Input & Send Controls */}
          <div className="p-2 border-t border-slate-700 bg-slate-800/90 flex items-end gap-1.5">
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力... (Shift+Enterで改行 / Enterで送信)"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 resize-none max-h-24 overflow-y-auto leading-normal"
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              className="bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:hover:bg-sky-600 text-white p-2 rounded-lg transition-colors shrink-0 mb-0.5 cursor-pointer"
              title="送信 (Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          {/* Resize handle */}
          <div
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center text-slate-500 hover:text-slate-300"
            title="ドラッグでサイズ調整"
          >
            <div className="w-2 h-2 border-r-2 border-b-2 border-slate-500 rounded-br-xs" />
          </div>
        </>
      )}
    </div>
  );
}
