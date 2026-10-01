import React, { useState, useMemo } from "react";
import {
  Ship,
  Plane,
  Scale,
  Clock,
  AlertTriangle,
  AlertOctagon,
  Timer,
  Link2,
  ChevronDown,
  User,
  MessageSquare,
  GripVertical,
  UserCheck,
  CheckCircle2,
  Calendar,
} from "lucide-react";
import {
  QuotationItem,
  QuoteStatus,
  StaffMember,
  UserProfile,
  formatCustomsDate,
  isQuoteAssignedToUser,
  ARRANGEMENT_TASKS,
  parseCustomsDateToTime,
  getQuickMemo,
} from "../types";
import { getAirportLabel } from "../lib/iataAirports";
import { getElapsedStats } from "../lib/timeUtils";
import { QuickMemoCard } from "./QuickMemoCard";

interface KanbanCardProps {
  quote: QuotationItem;
  currentUser: UserProfile;
  staffMembers?: StaffMember[];
  onSelectQuote: (quote: QuotationItem) => void;
  onStatusChange: (quoteId: string, newStatus: QuoteStatus) => void;
  onArchiveQuote?: (quoteId: string) => void;
  onUpdateQuote?: (quote: QuotationItem) => void;
  showQuickMemo?: boolean;
  messagesCount: number;
}

export const KanbanCard: React.FC<KanbanCardProps> = ({
  quote,
  currentUser,
  staffMembers = [],
  onSelectQuote,
  onStatusChange,
  onArchiveQuote,
  onUpdateQuote,
  showQuickMemo = true,
  messagesCount,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const isUnread = !quote.readBy?.includes(currentUser.email);

  const assignedStaff = staffMembers.find((s) => s.id === quote.assignedStaffId);

  // Check if this quote is assigned to the current logged-in user
  const isAssignedToCurrentUser = isQuoteAssignedToUser(quote, currentUser, staffMembers);

  // Is this task in "accepted" (受託) status AND assigned to the current user?
  const isMyAcceptedTask = quote.status === "accepted" && isAssignedToCurrentUser;

  // Determine if quote is in an active/open status where stale warning applies
  const isOpenStatus = quote.status === "requested" || quote.status === "estimated" || quote.status === "re_estimating";

  // Compute hidden elapsed time metric & warning stats
  const elapsedStats = useMemo(() => {
    const lastTimeIso = quote.updatedAt || quote.lastRepliedAt || quote.createdAt;
    return getElapsedStats(lastTimeIso, isOpenStatus);
  }, [quote.updatedAt, quote.lastRepliedAt, quote.createdAt, isOpenStatus]);

  // Format date display (always show date and time)
  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      const month = (d.getMonth() + 1).toString().padStart(2, "0");
      const day = d.getDate().toString().padStart(2, "0");
      const hours = d.getHours().toString().padStart(2, "0");
      const minutes = d.getMinutes().toString().padStart(2, "0");
      return `${month}/${day} ${hours}:${minutes}`;
    } catch {
      return isoString;
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", quote.id);
    e.dataTransfer.setData("quoteId", quote.id);
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Card border & background styling based on status, assigned user, unread status, and elapsed time warning level
  const getCardBgAndBorderClasses = () => {
    if (isDragging) {
      return "bg-slate-900 opacity-40 scale-95 border-sky-500 border-dashed ring-2 ring-sky-400";
    }
    // High Priority: Logged-in user's assigned shipping task in "Accepted" (受託) column -> Prominent Red Background
    if (isMyAcceptedTask) {
      return "is-my-accepted-task bg-gradient-to-br from-red-950 via-rose-900 to-red-950 border-2 border-red-500 shadow-xl shadow-red-950/60 ring-2 ring-red-500/60 hover:border-red-400";
    }
    if (isUnread) {
      return "bg-slate-900 border-2 border-rose-500 shadow-md shadow-rose-500/20 ring-1 ring-rose-400/50";
    }
    if (elapsedStats.warningLevel === "danger") {
      return "bg-gradient-to-b from-rose-950/25 via-slate-900 to-slate-900 border-2 border-rose-500 shadow-md shadow-rose-500/20 ring-1 ring-rose-500/60";
    }
    if (elapsedStats.warningLevel === "warning") {
      return "bg-gradient-to-b from-orange-950/20 via-slate-900 to-slate-900 border-2 border-orange-500 shadow-md shadow-orange-500/15 ring-1 ring-orange-400/50";
    }
    if (elapsedStats.warningLevel === "caution") {
      return "bg-gradient-to-b from-amber-950/15 via-slate-900 to-slate-900 border-2 border-amber-500/80 shadow-xs shadow-amber-500/10 ring-1 ring-amber-400/40";
    }
    return "bg-slate-900 dark:bg-slate-900 border-slate-700/80 hover:border-sky-500 dark:hover:border-sky-500";
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => onSelectQuote(quote)}
      data-elapsed-ms={elapsedStats.elapsedMs}
      data-elapsed-hours={elapsedStats.elapsedHours}
      data-warning-level={elapsedStats.warningLevel}
      className={`group relative kanban-card rounded-xl p-4 transition-all duration-200 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-lg border ${getCardBgAndBorderClasses()}`}
    >
      {/* Absolute Pulsing Unread Dot Indicator on Card Corner */}
      {isUnread && (
        <div className="absolute -top-1.5 -left-1.5 z-10 flex items-center justify-center pointer-events-none" title="未読メッセージあり">
          <span className="relative flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500 border-2 border-slate-900 shadow-md"></span>
          </span>
        </div>
      )}

      {/* Top Banner Accent for My Accepted Shipping Task */}
      {isMyAcceptedTask && (
        <div className="absolute top-0 left-0 right-0 h-1.5 rounded-t-xl bg-red-500 shadow-xs animate-pulse" />
      )}

      {/* Top Banner Accent for Stale Cards */}
      {!isMyAcceptedTask && elapsedStats.isStale && !isUnread && (
        <div
          className={`absolute top-0 left-0 right-0 h-1 rounded-t-xl ${
            elapsedStats.warningLevel === "danger"
              ? "bg-rose-500 animate-pulse"
              : elapsedStats.warningLevel === "warning"
              ? "bg-orange-500"
              : "bg-amber-500"
          }`}
        />
      )}

      {/* Drag Indicator handle */}
      <div className="absolute top-2 right-2 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Top Header: Badges & Warning Indicators */}
      <div className="flex items-center justify-between gap-2 mb-2 pr-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* My Shipping Assignment Badge for Accepted tasks assigned to logged-in user */}
          {isMyAcceptedTask && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black bg-red-600 text-white border border-red-400 shadow-xs animate-pulse"
              title="あなたが出荷担当として割り当てられている受託案件です"
            >
              <Ship className="w-3 h-3 text-white shrink-0" />
              🚢 担当出荷案件
            </span>
          )}

          {/* Unread Badge */}
          {isUnread && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-950/90 text-rose-200 border border-rose-500/60 shadow-xs">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
              NEW! 未読
            </span>
          )}

          {/* Stale Warning Badges (Visual Alert for Old Updates) */}
          {elapsedStats.warningLevel === "danger" && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black bg-rose-950 text-rose-200 border border-rose-500 shadow-xs animate-pulse"
              title={`【放置危険】最終更新から ${elapsedStats.formattedElapsed} 経過 (${elapsedStats.elapsedHours}時間未更新) - 至急確認・連絡が必要です`}
            >
              <AlertOctagon className="w-3 h-3 text-rose-400 shrink-0" />
              🚨 滞留 {elapsedStats.formattedElapsed}
            </span>
          )}

          {elapsedStats.warningLevel === "warning" && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-orange-950 text-orange-200 border border-orange-500 shadow-xs"
              title={`【更新警告】最終更新から ${elapsedStats.formattedElapsed} 経過 (${elapsedStats.elapsedHours}時間未更新)`}
            >
              <AlertTriangle className="w-3 h-3 text-orange-400 shrink-0" />
              ⚠️ 放置 {elapsedStats.formattedElapsed}
            </span>
          )}

          {elapsedStats.warningLevel === "caution" && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-950/90 text-amber-200 border border-amber-500/70"
              title={`【注意】最終更新から ${elapsedStats.formattedElapsed} 経過 (${elapsedStats.elapsedHours}時間未更新)`}
            >
              <Timer className="w-3 h-3 text-amber-400 shrink-0" />
              ⏳ 24h+未更新
            </span>
          )}

          {/* Urgent Badge */}
          {quote.isUrgent && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              URGENT
            </span>
          )}

          {/* Destination Airport Badges */}
          {quote.airportCodes.map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-sky-950/90 text-sky-200 border border-sky-700"
            >
              <Plane className="w-2.5 h-2.5 text-sky-400" />
              {code}
            </span>
          ))}

          {/* Weight Break (重量帯) Badge */}
          {quote.weightBreak && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-950/90 text-indigo-300 border border-indigo-700/80 shadow-2xs"
              title={`重量帯: ${quote.weightBreak}`}
            >
              <Scale className="w-2.5 h-2.5 text-indigo-400" />
              {quote.weightBreak}
            </span>
          )}

          {/* Assigned Staff Member Badge */}
          {assignedStaff && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-950/90 text-indigo-200 border border-indigo-700" title={`担当者: ${assignedStaff.name} (${assignedStaff.email})`}>
              <UserCheck className="w-2.5 h-2.5 text-indigo-400" />
              {assignedStaff.name}
            </span>
          )}
        </div>

        {/* Updated Time with Tooltip showing Hidden Metric */}
        <div
          className={`text-[10px] flex items-center gap-1 shrink-0 font-mono ${
            elapsedStats.warningLevel === "danger"
              ? "text-rose-300 font-bold"
              : elapsedStats.warningLevel === "warning"
              ? "text-orange-300 font-bold"
              : elapsedStats.warningLevel === "caution"
              ? "text-amber-300"
              : "text-slate-300"
          }`}
          title={`【隠しメトリクス保持】最終更新: ${formatDate(quote.updatedAt)} | 経過時間: ${elapsedStats.formattedElapsed} (${elapsedStats.elapsedHours}時間)`}
        >
          <Clock className={`w-3 h-3 ${
            elapsedStats.warningLevel === "danger"
              ? "text-rose-400 animate-spin-slow"
              : elapsedStats.warningLevel === "warning"
              ? "text-orange-400"
              : elapsedStats.warningLevel === "caution"
              ? "text-amber-400"
              : "text-slate-400"
          }`} />
          <span>{formatDate(quote.updatedAt)}</span>
        </div>
      </div>

      {/* Case Title */}
      <h3
        className={`text-xs sm:text-sm leading-snug line-clamp-2 mb-2 transition-colors ${
          isMyAcceptedTask
            ? "font-black text-white !text-white dark:!text-white group-hover:!text-white drop-shadow-xs"
            : "font-bold text-white group-hover:text-sky-300"
        }`}
      >
        {quote.title}
      </h3>

      {/* Customs Clearance Date (通関日) */}
      {(() => {
        const formattedDate = formatCustomsDate(quote.customsClearanceDate || quote.grossWeight);
        if (!formattedDate) return null;
        return (
          <div className="my-1.5 text-xs">
            <span
              className={`kanban-customs-date transition-colors ${
                isMyAcceptedTask
                  ? "font-black text-white !text-white dark:!text-white group-hover:!text-white drop-shadow-xs"
                  : "font-bold text-white group-hover:text-sky-300"
              }`}
            >
              通関日：{formattedDate}
            </span>
          </div>
        );
      })()}

      {/* 受託案件（status === "accepted"）の簡易手配進捗インジケーター */}
      {quote.status === "accepted" && (() => {
        const tasks = quote.arrangementTasks || {};
        const completedTasksCount = ARRANGEMENT_TASKS.filter((t) => tasks[t.id]?.completed).length;
        const isAllDone = completedTasksCount === 7 || quote.isArrangementCompleted;
        
        // Check risk
        const customsTime = parseCustomsDateToTime(quote.customsClearanceDate || quote.grossWeight);
        const now = Date.now();
        const isOverdueOrToday = customsTime !== Infinity && customsTime <= now + 24 * 60 * 60 * 1000;
        const isRisk = (quote.arrangementUrgency === "risk") || (isOverdueOrToday && !tasks[4]?.completed && !isAllDone);

        let statusText = `${completedTasksCount}/7 完了`;
        let statusBadgeClass = "bg-sky-950 text-sky-300 border-sky-700";

        if (isAllDone) {
          statusText = "全手配完了";
          statusBadgeClass = "bg-emerald-950 text-emerald-300 border-emerald-600 font-bold";
        } else if (isRisk) {
          statusText = "通関要確認";
          statusBadgeClass = "bg-rose-950 text-rose-300 border-rose-600 font-bold animate-pulse";
        } else if (completedTasksCount >= 4) {
          statusText = `${completedTasksCount}/7 順調`;
          statusBadgeClass = "bg-teal-950 text-teal-300 border-teal-600";
        } else if (completedTasksCount > 0) {
          statusText = `${completedTasksCount}/7 進行中`;
          statusBadgeClass = "bg-amber-950 text-amber-300 border-amber-600";
        }

        return (
          <div className="my-2 p-2 rounded-lg bg-slate-950/80 border border-slate-800 shadow-inner">
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-extrabold text-slate-300 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isAllDone ? "bg-emerald-400" : isRisk ? "bg-rose-500 animate-ping" : "bg-cyan-400"}`} />
                  手配進捗:
                </span>
                <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${statusBadgeClass}`}>
                  {statusText}
                </span>
              </div>

              {quote.etdDate && (
                <span className="text-[9px] text-slate-400 font-mono">
                  ETD: <strong className="text-slate-200">{quote.etdDate}</strong>
                </span>
              )}
            </div>

            {/* 7-Step Mini Progress Dots / Bars */}
            <div className="grid grid-cols-7 gap-1 pt-0.5">
              {ARRANGEMENT_TASKS.map((task) => {
                const isDone = Boolean(tasks[task.id]?.completed);
                const isRiskStep = isRisk && !isDone && task.id === 4;

                return (
                  <div
                    key={task.id}
                    className="flex flex-col items-center group/step relative"
                    title={`${task.id}. ${task.label} (${task.subLabel}) : ${isDone ? "完了済" : "未完了"}`}
                  >
                    <div
                      className={`w-full h-1.5 rounded-full transition-all ${
                        isDone
                          ? "bg-emerald-400 shadow-xs shadow-emerald-400/50"
                          : isRiskStep
                          ? "bg-rose-500 ring-1 ring-rose-400 animate-pulse"
                          : "bg-slate-800 border border-slate-700"
                      }`}
                    />
                    <span
                      className={`text-[8px] font-mono font-bold mt-0.5 ${
                        isDone
                          ? "text-emerald-400 font-black"
                          : isRiskStep
                          ? "text-rose-400 font-black"
                          : "text-slate-500"
                      }`}
                    >
                      {task.id}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* External Links Preview */}
      {quote.externalLinks && quote.externalLinks.length > 0 && (
        <div className="flex items-center gap-1 mb-3 text-[10px] text-sky-300 truncate">
          <Link2 className="w-3 h-3 shrink-0 text-sky-400" />
          <span className="truncate font-semibold text-sky-300">
            {quote.externalLinks[0].title || "補足資料リンク"}
            {quote.externalLinks.length > 1 && ` (+${quote.externalLinks.length - 1})`}
          </span>
        </div>
      )}

      {/* 簡易メモ (1案件に1つ、現在の状況の表示・変更・削除) */}
      {onUpdateQuote && showQuickMemo && (
        <div className="my-2">
          <QuickMemoCard
            quote={quote}
            currentUser={currentUser}
            onUpdateQuote={onUpdateQuote}
            variant="kanban"
          />
        </div>
      )}

      {/* Footer: Author & Quick Status Dropdown */}
      <div className="pt-2.5 mt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-300">
        <div className="flex items-center gap-1.5 truncate max-w-[140px]" title={quote.createdBy}>
          <User className="w-3 h-3 text-slate-400 shrink-0" />
          <span className="truncate">{quote.createdBy.split("@")[0]}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Mini memo indicator when bulk memos are collapsed */}
          {!showQuickMemo && (() => {
            const memo = getQuickMemo(quote);
            if (!memo) return null;
            return (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/50 text-[10px] font-bold max-w-[120px] truncate"
                title={`【簡易メモ】${memo.updatedByName ? `${memo.updatedByName}: ` : ""}${memo.text}`}
              >
                <span>📝</span>
                <span className="truncate">{memo.text}</span>
              </span>
            );
          })()}

          {/* Elapsed time pill if stale */}
          {elapsedStats.isStale && (
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700"
              title={`非表示で保持された経過時間: ${elapsedStats.elapsedHours}時間 (${elapsedStats.formattedElapsed})`}
            >
              経過 {elapsedStats.formattedElapsed}
            </span>
          )}

          {/* Thread messages counter */}
          <div className="flex items-center gap-1.5 text-[10px] text-slate-300 font-medium">
            <div className="relative flex items-center">
              <MessageSquare className={`w-3.5 h-3.5 ${isUnread ? "text-rose-400" : "text-slate-400"}`} />
              {isUnread && (
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                </span>
              )}
            </div>
            <span className={isUnread ? "text-rose-300 font-bold" : ""}>{messagesCount}</span>
          </div>

          {/* Quick status dropdown */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative inline-block"
          >
            <select
              value={quote.status}
              onChange={(e) =>
                onStatusChange(quote.id, e.target.value as QuoteStatus)
              }
              className="appearance-none bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium py-1 pl-2 pr-5 rounded-md text-[10px] border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
            >
              <option value="requested">見積依頼</option>
              <option value="estimated">見積済み</option>
              <option value="re_estimating">見積連絡済</option>
              <option value="accepted">受託</option>
              <option value="closed_or_on_hold">失注・保留</option>
            </select>
            <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>
    </div>
  );
};

