import React, { useState, useMemo } from "react";
import { QuotationItem, QuoteMessage, QuoteStatus, StaffMember, StatusColumnConfig, UserProfile, isQuoteAssignedToUser, parseCustomsDateToTime } from "../types";
import { KanbanCard } from "./KanbanCard";
import { FileText, Send, CheckCircle2, RefreshCw, Award, ArchiveX, ArrowDown, AlertTriangle, AlertOctagon, Timer, Clock, Filter, Calendar, Plus, Eye, EyeOff } from "lucide-react";
import { getElapsedStats } from "../lib/timeUtils";

interface KanbanBoardProps {
  quotes: QuotationItem[];
  messages: QuoteMessage[];
  currentUser: UserProfile;
  staffMembers?: StaffMember[];
  onSelectQuote: (quote: QuotationItem) => void;
  onStatusChange: (quoteId: string, newStatus: QuoteStatus) => void;
  onArchiveQuote?: (quoteId: string) => void;
  onUpdateQuote?: (quote: QuotationItem) => void;
  onNewQuoteInStatus?: (status: QuoteStatus) => void;
  onOpenArrangementProgress?: () => void;
  showQuickMemos?: boolean;
  onToggleQuickMemos?: () => void;
}

export const KANBAN_COLUMNS: StatusColumnConfig[] = [
  {
    id: "requested",
    title: "見積依頼",
    badgeBg: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800",
    badgeText: "Requested",
    description: "顧客からの見積回答待ち",
  },
  {
    id: "estimated",
    title: "見積済み",
    badgeBg: "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-800",
    badgeText: "Estimated",
    description: "顧客へ見積提出済み",
  },
  {
    id: "re_estimating",
    title: "見積連絡済",
    badgeBg: "bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-200 border-purple-300 dark:border-purple-800",
    badgeText: "Communicated",
    description: "顧客へ見積内容を連絡済み",
  },
  {
    id: "accepted",
    title: "受託",
    badgeBg: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800",
    badgeText: "Accepted",
    description: "受注決定・フライト手配へ",
  },
  {
    id: "closed_or_on_hold",
    title: "失注・保留",
    badgeBg: "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-800",
    badgeText: "Closed/Hold",
    description: "キャンセルのため完了",
  },
];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  quotes,
  messages,
  currentUser,
  staffMembers = [],
  onSelectQuote,
  onStatusChange,
  onArchiveQuote,
  onUpdateQuote,
  onNewQuoteInStatus,
  onOpenArrangementProgress,
  showQuickMemos,
  onToggleQuickMemos,
}) => {
  const [activeDragOverCol, setActiveDragOverCol] = useState<QuoteStatus | null>(null);
  const [staleFilterMode, setStaleFilterMode] = useState<"all" | "stale_only" | "stale_24h" | "stale_48h" | "stale_72h">("all");

  // Fallback internal state for quick memo bulk visibility if not passed as prop
  const [localShowQuickMemos, setLocalShowQuickMemos] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("app_show_quick_memos");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });

  const isMemosVisible = showQuickMemos !== undefined ? showQuickMemos : localShowQuickMemos;

  const handleToggleMemos = () => {
    if (onToggleQuickMemos) {
      onToggleQuickMemos();
    } else {
      setLocalShowQuickMemos((prev) => {
        const next = !prev;
        try {
          localStorage.setItem("app_show_quick_memos", String(next));
        } catch {}
        return next;
      });
    }
  };

  // Count messages per quote
  const getMessageCount = (quoteId: string) => {
    return messages.filter((m) => m.quoteId === quoteId).length;
  };

  // Compute stale statistics for all quotes
  const staleSummary = useMemo(() => {
    let count24h = 0;
    let count48h = 0;
    let count72h = 0;

    quotes.forEach((q) => {
      const isOpen = q.status === "requested" || q.status === "estimated" || q.status === "re_estimating";
      const stats = getElapsedStats(q.updatedAt || q.lastRepliedAt || q.createdAt, isOpen);
      if (stats.warningLevel === "caution") count24h++;
      if (stats.warningLevel === "warning") count48h++;
      if (stats.warningLevel === "danger") count72h++;
    });

    const totalStale = count24h + count48h + count72h;
    return { count24h, count48h, count72h, totalStale };
  }, [quotes]);

  // Filter quotes based on stale filter mode
  const filteredQuotes = useMemo(() => {
    if (staleFilterMode === "all") return quotes;

    return quotes.filter((q) => {
      const isOpen = q.status === "requested" || q.status === "estimated" || q.status === "re_estimating";
      const stats = getElapsedStats(q.updatedAt || q.lastRepliedAt || q.createdAt, isOpen);

      if (staleFilterMode === "stale_only") return stats.isStale;
      if (staleFilterMode === "stale_24h") return stats.warningLevel === "caution";
      if (staleFilterMode === "stale_48h") return stats.warningLevel === "warning";
      if (staleFilterMode === "stale_72h") return stats.warningLevel === "danger";
      return true;
    });
  }, [quotes, staleFilterMode]);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, colId: QuoteStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (activeDragOverCol !== colId) {
      setActiveDragOverCol(colId);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>, colId: QuoteStatus) => {
    e.preventDefault();
    if (activeDragOverCol === colId) {
      setActiveDragOverCol(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetStatus: QuoteStatus) => {
    e.preventDefault();
    setActiveDragOverCol(null);
    const quoteId = e.dataTransfer.getData("quoteId") || e.dataTransfer.getData("text/plain");
    if (quoteId) {
      onStatusChange(quoteId, targetStatus);
    }
  };

  return (
    <div className="w-full h-full overflow-x-auto pb-8 pt-2 px-4 sm:px-6 lg:px-8 space-y-3">
      {/* Top Elapsed Time & Stale Warning Summary Toolbar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm min-w-[1300px]">
        {/* Left: Stale Status Indicator */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-200 text-xs font-bold">
            <Clock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>最終更新からの経過時間 監視ステータス</span>
          </div>

          {staleSummary.totalStale > 0 ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-300 font-medium">
                進行中案件のうち <strong className="text-amber-400 font-bold">{staleSummary.totalStale} 件</strong> で更新が滞留しています:
              </span>

              {staleSummary.count72h > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950 text-rose-200 border border-rose-500 font-bold text-[11px] animate-pulse">
                  <AlertOctagon className="w-3 h-3 text-rose-400" />
                  🚨 72h+滞留: {staleSummary.count72h}件
                </span>
              )}

              {staleSummary.count48h > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-950 text-orange-200 border border-orange-500 font-bold text-[11px]">
                  <AlertTriangle className="w-3 h-3 text-orange-400" />
                  ⚠️ 48h+放置: {staleSummary.count48h}件
                </span>
              )}

              {staleSummary.count24h > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950 text-amber-200 border border-amber-500/70 font-bold text-[11px]">
                  <Timer className="w-3 h-3 text-amber-400" />
                  ⏳ 24h+未更新: {staleSummary.count24h}件
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-emerald-400 font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              すべての進行中案件が24時間以内に更新されています (滞留なし)
            </span>
          )}
        </div>

        {/* Right: Quick Stale Filter Buttons */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1 mr-1">
            <Filter className="w-3 h-3 text-sky-400" />
            フィルター:
          </span>

          <button
            type="button"
            onClick={() => setStaleFilterMode("all")}
            className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
              staleFilterMode === "all"
                ? "bg-sky-600 text-white shadow-sm ring-1 ring-sky-400"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
            }`}
          >
            全案件 ({quotes.length})
          </button>

          <button
            type="button"
            onClick={() => setStaleFilterMode("stale_only")}
            className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${
              staleFilterMode === "stale_only"
                ? "bg-amber-600 text-white shadow-sm ring-1 ring-amber-400"
                : "bg-slate-800 text-amber-300 hover:bg-slate-700 border border-amber-500/40"
            }`}
          >
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            滞留警告のみ ({staleSummary.totalStale})
          </button>

          {staleSummary.count72h > 0 && (
            <button
              type="button"
              onClick={() => setStaleFilterMode("stale_72h")}
              className={`px-2 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${
                staleFilterMode === "stale_72h"
                  ? "bg-rose-600 text-white shadow-sm ring-1 ring-rose-400"
                  : "bg-slate-800 text-rose-300 hover:bg-slate-700 border border-rose-500/40"
              }`}
            >
              🚨 72h+ ({staleSummary.count72h})
            </button>
          )}

          {/* Quick Memo Bulk Visibility Toggle Button */}
          <div className="border-l border-slate-700 pl-2 ml-1">
            <button
              type="button"
              onClick={handleToggleMemos}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border shadow-2xs cursor-pointer ${
                isMemosVisible
                  ? "bg-amber-950/80 hover:bg-amber-900/80 text-amber-200 border-amber-500/70 shadow-amber-950/30 ring-1 ring-amber-500/30"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700 hover:text-slate-200"
              }`}
              title={
                isMemosVisible
                  ? "全タスクの簡易メモを非表示にする（カードを縮小表示）"
                  : "全タスクの簡易メモを表示する"
              }
            >
              {isMemosVisible ? (
                <>
                  <Eye className="w-3.5 h-3.5 text-amber-400" />
                  <span>簡易メモ: 表示</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                  <span>簡易メモ: 非表示</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Kanban Columns Row */}
      <div className="flex gap-4 items-start min-w-[1300px]">
        {KANBAN_COLUMNS.map((column) => {
          const rawColQuotes = filteredQuotes.filter((q) => q.status === column.id);
          const colQuotes = [...rawColQuotes].sort((a, b) => {
            if (column.id === "accepted") {
              const aIsMine = isQuoteAssignedToUser(a, currentUser, staffMembers);
              const bIsMine = isQuoteAssignedToUser(b, currentUser, staffMembers);

              // 1. Logged in user priority
              if (aIsMine && !bIsMine) return -1;
              if (!aIsMine && bIsMine) return 1;

              // 2. Customs clearance date ascending
              const dateA = parseCustomsDateToTime(a.customsClearanceDate || a.grossWeight);
              const dateB = parseCustomsDateToTime(b.customsClearanceDate || b.grossWeight);

              if (dateA !== dateB) {
                return dateA - dateB;
              }

              // 3. Fallback: createdAt ascending
              return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            }
            return 0;
          });

          const allColQuotes = quotes.filter((q) => q.status === column.id);

          const unreadInCol = colQuotes.filter(
            (q) => !q.readBy?.includes(currentUser.email)
          ).length;

          // Stale count for this column
          const staleInCol = allColQuotes.filter((q) => {
            const isOpen = q.status === "requested" || q.status === "estimated" || q.status === "re_estimating";
            return getElapsedStats(q.updatedAt || q.lastRepliedAt || q.createdAt, isOpen).isStale;
          }).length;

          const isRequestedCol = column.id === "requested";
          const isTargeted = activeDragOverCol === column.id;

          return (
            <div
              key={column.id}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={(e) => handleDragLeave(e, column.id)}
              onDrop={(e) => handleDrop(e, column.id)}
              className={`kanban-column ${isRequestedCol ? "kanban-column-requested" : ""} flex-1 rounded-2xl p-3 border-2 flex flex-col max-h-[calc(100vh-210px)] shadow-2xs transition-all relative ${
                isTargeted
                  ? "border-sky-500 bg-sky-500/10 ring-4 ring-sky-500/20 scale-[1.01]"
                  : "border-slate-800 bg-slate-900/80"
              } ${
                isRequestedCol
                  ? "min-w-[270px] max-w-[320px] bg-emerald-950/25 border-emerald-800/50 shadow-emerald-950/20"
                  : "min-w-[270px] max-w-[320px]"
              }`}
            >
              {/* Drag Target Highlight Overlay Banner */}
              {isTargeted && (
                <div className="absolute top-2 right-2 left-2 z-10 bg-sky-500 text-white font-bold text-xs py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 shadow-md animate-pulse pointer-events-none">
                  <ArrowDown className="w-4 h-4" />
                  【{column.title}】に移動してステータス変更
                </div>
              )}

              {/* Column Header */}
              <div className="flex items-center justify-between pb-3 px-1 border-b border-slate-200/80 dark:border-slate-800 mb-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <h2 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-1.5 shrink-0">
                    {column.title}
                  </h2>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-full border shrink-0 ${column.badgeBg}`}
                  >
                    {colQuotes.length}
                  </span>
                  {column.id === "requested" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewQuoteInStatus?.("requested");
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-extrabold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs hover:shadow-emerald-500/30 transition-all cursor-pointer transform hover:scale-105 active:scale-95 shrink-0 ml-auto"
                      title="新規見積作成モーダルを開く"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>+新規見積作成</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {/* Accepted Column Quick Switcher Button */}
                  {column.id === "accepted" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenArrangementProgress?.();
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-extrabold rounded-lg bg-gradient-to-r from-cyan-600 via-sky-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-xs hover:shadow-cyan-500/30 transition-all cursor-pointer transform hover:scale-105 active:scale-95"
                      title="通関日・ETD基準の「受託手配進捗タイムライン」画面を開く"
                    >
                      <Calendar className="w-3 h-3 text-cyan-200" />
                      <span>受託手配進捗 ➔</span>
                    </button>
                  )}

                  {/* Column Stale Warning Pill */}
                  {staleInCol > 0 && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-extrabold bg-amber-950/90 text-amber-200 border border-amber-500/70 rounded-full shadow-xs"
                      title={`この列に更新が24時間以上滞留している案件が ${staleInCol} 件あります`}
                    >
                      ⚠️ {staleInCol}件滞留
                    </span>
                  )}

                  {unreadInCol > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-extrabold bg-rose-600 text-white rounded-full animate-pulse">
                      🔴 {unreadInCol}
                    </span>
                  )}
                </div>
              </div>

              {/* Cards List Container */}
              <div
                className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-3"
              >
                {colQuotes.length === 0 ? (
                  <div
                    className="py-8 text-center text-slate-400 dark:text-slate-600 text-xs border-2 border-dashed border-slate-200 dark:border-slate-800/80 rounded-xl"
                  >
                    {staleFilterMode !== "all"
                      ? "該当する滞留案件はありません"
                      : "ドラッグ＆ドロップで案件を追加"}
                  </div>
                ) : (
                  colQuotes.map((quote) => (
                    <KanbanCard
                      key={quote.id}
                      quote={quote}
                      currentUser={currentUser}
                      staffMembers={staffMembers}
                      onSelectQuote={onSelectQuote}
                      onStatusChange={onStatusChange}
                      onArchiveQuote={onArchiveQuote}
                      onUpdateQuote={onUpdateQuote}
                      showQuickMemo={isMemosVisible}
                      messagesCount={getMessageCount(quote.id)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};


