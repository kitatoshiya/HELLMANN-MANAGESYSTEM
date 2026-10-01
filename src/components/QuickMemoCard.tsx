import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  Pencil,
  Trash2,
  Check,
  X,
  Plus,
  Clock,
  User,
} from "lucide-react";
import {
  QuotationItem,
  UserProfile,
  QuickMemo,
  getQuickMemo,
  formatMemoTimestamp,
} from "../types";

interface QuickMemoCardProps {
  quote: QuotationItem;
  currentUser: UserProfile;
  onUpdateQuote: (quote: QuotationItem) => void;
  className?: string;
  variant?: "timeline" | "kanban" | "drawer";
}

export const QuickMemoCard: React.FC<QuickMemoCardProps> = ({
  quote,
  currentUser,
  onUpdateQuote,
  className = "",
  variant = "timeline",
}) => {
  const memo = getQuickMemo(quote);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync edit text when entering edit mode or quote updates
  useEffect(() => {
    if (isEditing) {
      setEditText(memo?.text || "");
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.selectionStart = textareaRef.current.value.length;
          textareaRef.current.selectionEnd = textareaRef.current.value.length;
        }
      }, 50);
    }
  }, [isEditing]);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditText(memo?.text || "");
    setIsEditing(true);
  };

  const handleCancelEdit = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIsEditing(false);
    setEditText("");
  };

  const handleSave = (e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.stopPropagation();

    const trimmed = editText.trim();
    const nowIso = new Date().toISOString();

    if (!trimmed) {
      // Empty text = delete memo
      handleDelete(e);
      return;
    }

    const newMemo: QuickMemo = {
      text: trimmed,
      updatedAt: nowIso,
      updatedBy: currentUser.email,
      updatedByName: currentUser.name || currentUser.email.split("@")[0],
    };

    const updatedQuote: QuotationItem = {
      ...quote,
      quickMemo: newMemo,
      arrangementMemo: trimmed,
      updatedAt: nowIso,
      updatedBy: currentUser.email,
    };

    onUpdateQuote(updatedQuote);
    setIsEditing(false);
  };

  const handleDelete = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const nowIso = new Date().toISOString();

    const updatedQuote: QuotationItem = {
      ...quote,
      quickMemo: undefined,
      arrangementMemo: undefined,
      updatedAt: nowIso,
      updatedBy: currentUser.email,
    };

    onUpdateQuote(updatedQuote);
    setIsEditing(false);
    setEditText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  // Determine author display name
  const authorName =
    memo?.updatedByName ||
    (memo?.updatedBy ? memo.updatedBy.split("@")[0] : "");
  const timeDisplay = formatMemoTimestamp(memo?.updatedAt);

  // Variant styling
  const isTimeline = variant === "timeline";
  const isDrawer = variant === "drawer";

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`relative quick-memo-container select-text ${className}`}
    >
      {isEditing ? (
        // INLINE EDIT MODE
        <div className="bg-slate-950/95 border-2 border-amber-500/80 rounded-lg p-2 shadow-lg animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-extrabold text-amber-300 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span>簡易メモの編集</span>
            </span>
            <span className="text-[9px] text-slate-400 font-mono">
              Ctrl+Enterで保存 / Escで取消
            </span>
          </div>

          <textarea
            ref={textareaRef}
            rows={2}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            placeholder="現在の状況・簡易メモを入力 (例: インボイス確認済、明日午前中に搬入予定)"
            className="w-full bg-slate-900 border border-slate-700 focus:border-amber-400 rounded p-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-y custom-scrollbar"
          />

          <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-800">
            <div>
              {memo && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-rose-400 hover:text-rose-200 hover:bg-rose-950/60 border border-rose-900/50 transition-all cursor-pointer"
                  title="このメモを削除する"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>削除</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-2 py-0.5 rounded text-[10px] font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-black bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-xs transition-all cursor-pointer transform hover:scale-102 active:scale-98"
              >
                <Check className="w-3 h-3 stroke-[3]" />
                <span>保存</span>
              </button>
            </div>
          </div>
        </div>
      ) : memo ? (
        // DISPLAY MODE (Memo Exists)
        <div
          className={`group/memo rounded-lg border transition-all ${
            isDrawer
              ? "bg-amber-950/30 border-amber-500/50 p-2.5 shadow-sm"
              : isTimeline
              ? "bg-slate-950/90 border-amber-500/40 hover:border-amber-400/80 p-2 shadow-sm"
              : "bg-slate-950/80 border-amber-500/40 hover:border-amber-400/80 p-2 shadow-xs"
          }`}
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between gap-1 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                <FileText className="w-3 h-3 text-amber-400 shrink-0" />
                <span>簡易メモ</span>
              </span>

              {/* Author & Timestamp */}
              <span
                className="text-[9px] text-slate-400 truncate flex items-center gap-1"
                title={`最終更新: ${authorName || "不明"} (${memo.updatedAt})`}
              >
                <User className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                <span className="font-semibold text-slate-300 truncate max-w-[70px]">
                  {authorName}
                </span>
                {timeDisplay && (
                  <span className="font-mono text-slate-500">
                    {timeDisplay}
                  </span>
                )}
              </span>
            </div>

            {/* Quick Action Buttons (Edit / Delete) */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleStartEdit}
                className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition-colors cursor-pointer"
                title="簡易メモを変更・修正する"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/50 transition-colors cursor-pointer"
                title="簡易メモを削除する"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Memo Body Text */}
          <div
            onClick={handleStartEdit}
            className="text-xs text-amber-100/90 leading-relaxed whitespace-pre-wrap break-words font-medium cursor-pointer hover:text-white transition-colors"
            title="クリックしてメモを編集"
          >
            {memo.text}
          </div>
        </div>
      ) : (
        // NO MEMO: Button to add memo
        <div className="pt-0.5">
          <button
            type="button"
            onClick={handleStartEdit}
            className="w-full inline-flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg border border-dashed border-slate-700 hover:border-amber-500/70 bg-slate-950/40 hover:bg-amber-950/20 text-slate-400 hover:text-amber-300 text-[11px] font-bold transition-all cursor-pointer group/addbtn"
            title="この案件に現在の状況や簡易メモを追加"
          >
            <Plus className="w-3 h-3 text-slate-500 group-hover/addbtn:text-amber-400 transition-colors" />
            <span>簡易メモを追加</span>
          </button>
        </div>
      )}
    </div>
  );
};
