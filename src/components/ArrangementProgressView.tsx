import React, { useState, useMemo } from "react";
import {
  QuotationItem,
  QuoteMessage,
  StaffMember,
  UserProfile,
  AppTheme,
  ARRANGEMENT_TASKS,
  ArrangementTaskStatus,
  formatCustomsDate,
  parseCustomsDateToTime,
  isQuoteAssignedToUser,
  formatMemoTimestamp,
  getQuickMemo,
} from "../types";
import { QuickMemoCard } from "./QuickMemoCard";
import {
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  Search,
  ArrowLeft,
  Ship,
  Plane,
  FileText,
  User,
  Plus,
  Edit3,
  ExternalLink,
  Check,
  X,
  Sparkles,
  ChevronRight,
  Info,
  CalendarCheck2,
  CalendarClock,
  Layers,
  ListFilter,
  Download,
  Eye,
  EyeOff,
} from "lucide-react";

interface ArrangementProgressViewProps {
  quotes: QuotationItem[];
  messages: QuoteMessage[];
  currentUser: UserProfile;
  staffMembers: StaffMember[];
  currentTheme: AppTheme;
  onBackToKanban: () => void;
  onSelectQuote: (quote: QuotationItem) => void;
  onUpdateQuote: (quote: QuotationItem) => void;
  showQuickMemos?: boolean;
  onToggleQuickMemos?: () => void;
}

export const ArrangementProgressView: React.FC<ArrangementProgressViewProps> = ({
  quotes,
  messages,
  currentUser,
  staffMembers,
  currentTheme,
  onBackToKanban,
  onSelectQuote,
  onUpdateQuote,
  showQuickMemos,
  onToggleQuickMemos,
}) => {
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

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState<string>("ALL");
  const [selectedDestCode, setSelectedDestCode] = useState<string>("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState<"ALL" | "risk" | "in_progress" | "smooth" | "arranging" | "completed">("ALL");

  // Quick edit modal state
  const [editingQuote, setEditingQuote] = useState<QuotationItem | null>(null);
  const [activeTaskTooltip, setActiveTaskTooltip] = useState<{ quoteId: string; taskId: number } | null>(null);

  // Filter only accepted quotes
  const acceptedQuotes = useMemo(() => {
    return quotes.filter((q) => q.status === "accepted" && !q.isArchived);
  }, [quotes]);

  // Helper to determine automatic arrangement status based on tasks & customs clearance date
  const getCardStatus = (quote: QuotationItem) => {
    if (quote.arrangementUrgency) {
      return quote.arrangementUrgency;
    }

    const tasks = quote.arrangementTasks || {};
    const completedCount = ARRANGEMENT_TASKS.filter((t) => tasks[t.id]?.completed).length;

    if (completedCount === 7 || quote.isArrangementCompleted) {
      return "completed";
    }

    const customsTime = parseCustomsDateToTime(quote.customsClearanceDate || quote.grossWeight);
    const now = Date.now();
    const isOverdueOrToday = customsTime !== Infinity && customsTime <= now + 24 * 60 * 60 * 1000;

    // If customs date is today/past and step 4 (customs) is NOT done, it's risk
    if (isOverdueOrToday && !tasks[4]?.completed) {
      return "risk";
    }

    if (completedCount >= 4) {
      return "smooth";
    }

    if (completedCount >= 2) {
      return "in_progress";
    }

    return "arranging";
  };

  // Toggle single task completion
  const handleToggleTask = (quote: QuotationItem, taskId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentTasks = quote.arrangementTasks || {};
    const currentStatus = currentTasks[taskId];
    const isNowCompleted = !currentStatus?.completed;

    const taskStatus: ArrangementTaskStatus = {
      completed: isNowCompleted,
      ...(isNowCompleted ? { completedAt: new Date().toISOString(), completedBy: currentUser.name } : {}),
      ...(currentStatus?.note ? { note: currentStatus.note } : {}),
    };

    const updatedTasks: Record<number, ArrangementTaskStatus> = {
      ...currentTasks,
      [taskId]: taskStatus,
    };

    const completedCount = ARRANGEMENT_TASKS.filter((t) => updatedTasks[t.id]?.completed).length;
    const isAllDone = completedCount === 7;

    const updatedQuote: QuotationItem = {
      ...quote,
      arrangementTasks: updatedTasks,
      isArrangementCompleted: isAllDone,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.email,
    };

    onUpdateQuote(updatedQuote);
  };

  // Toggle all tasks completion (Bulk Complete All at once)
  const handleCompleteAllTasks = (quote: QuotationItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentTasks = quote.arrangementTasks || {};
    const completedCount = ARRANGEMENT_TASKS.filter((t) => currentTasks[t.id]?.completed).length;
    const isAllDone = completedCount === 7;
    const targetCompleted = !isAllDone;

    const updatedTasks: Record<number, ArrangementTaskStatus> = {};
    const nowStr = new Date().toISOString();

    ARRANGEMENT_TASKS.forEach((t) => {
      const prevStatus = currentTasks[t.id];
      updatedTasks[t.id] = {
        completed: targetCompleted,
        ...(targetCompleted
          ? { completedAt: prevStatus?.completedAt || nowStr, completedBy: prevStatus?.completedBy || currentUser.name }
          : {}),
        ...(prevStatus?.note ? { note: prevStatus.note } : {}),
      };
    });

    const updatedQuote: QuotationItem = {
      ...quote,
      arrangementTasks: updatedTasks,
      isArrangementCompleted: targetCompleted,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.email,
    };

    onUpdateQuote(updatedQuote);
  };

  // Filter quotes based on search and filters
  const filteredAcceptedQuotes = useMemo(() => {
    return acceptedQuotes.filter((quote) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = quote.title?.toLowerCase().includes(q);
        const matchVessel = quote.vesselName?.toLowerCase().includes(q);
        const matchShipper = quote.shipperName?.toLowerCase().includes(q);
        const matchDest = quote.airportCodes?.some((c) => c.toLowerCase().includes(q));
        if (!matchTitle && !matchVessel && !matchShipper && !matchDest) {
          return false;
        }
      }

      // Staff
      if (selectedStaffId !== "ALL") {
        if (selectedStaffId === "UNASSIGNED" && quote.assignedStaffId) return false;
        if (selectedStaffId !== "UNASSIGNED" && quote.assignedStaffId !== selectedStaffId) {
          // Check if assigned to current user
          const staffObj = staffMembers.find((s) => s.id === selectedStaffId);
          if (staffObj && !isQuoteAssignedToUser(quote, { email: staffObj.email, name: staffObj.name }, staffMembers)) {
            return false;
          }
        }
      }

      // Dest
      if (selectedDestCode !== "ALL") {
        if (!quote.airportCodes?.includes(selectedDestCode)) return false;
      }

      // Urgency / Status
      if (urgencyFilter !== "ALL") {
        const st = getCardStatus(quote);
        if (st !== urgencyFilter) return false;
      }

      return true;
    });
  }, [acceptedQuotes, searchQuery, selectedStaffId, selectedDestCode, urgencyFilter, staffMembers]);

  // Destination codes list for filter
  const allDestCodes = useMemo(() => {
    const set = new Set<string>();
    acceptedQuotes.forEach((q) => {
      q.airportCodes?.forEach((code) => {
        if (code && code.trim()) set.add(code.trim().toUpperCase());
      });
    });
    return Array.from(set).sort();
  }, [acceptedQuotes]);

  // Statistics Summary
  const statsSummary = useMemo(() => {
    let riskCount = 0;
    let todayCount = 0;
    let tomorrowCount = 0;
    let inProgressCount = 0;
    let completedCount = 0;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
    const dayAfterTomorrowStart = tomorrowStart + 24 * 60 * 60 * 1000;

    acceptedQuotes.forEach((quote) => {
      const st = getCardStatus(quote);
      if (st === "risk") riskCount++;
      if (st === "completed") completedCount++;
      if (st === "in_progress") inProgressCount++;

      const cTime = parseCustomsDateToTime(quote.customsClearanceDate || quote.grossWeight);
      if (cTime >= todayStart && cTime < tomorrowStart) todayCount++;
      if (cTime >= tomorrowStart && cTime < dayAfterTomorrowStart) tomorrowCount++;
    });

    return {
      total: acceptedQuotes.length,
      riskCount,
      todayCount,
      tomorrowCount,
      inProgressCount,
      completedCount,
    };
  }, [acceptedQuotes]);

  // Group quotes by Schedule Dates (Timeline Columns)
  const timelineColumns = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Helper to format date label
    const formatColTitle = (timestamp: number, isUndated = false) => {
      if (isUndated) return { label: "通関日 未定", subText: "日程未設定", isToday: false, isOverdue: false };

      const diffDays = Math.floor((timestamp - todayStart) / oneDayMs);
      const d = new Date(timestamp);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
      const dayName = dayNames[d.getDay()];

      if (diffDays < 0) {
        return {
          label: `${m}/${day} (${dayName})`,
          subText: `期日超過 (${Math.abs(diffDays)}日前)`,
          isToday: false,
          isOverdue: true,
        };
      }
      if (diffDays === 0) {
        return {
          label: `本日通関 (${m}/${day})`,
          subText: "本日予定",
          isToday: true,
          isOverdue: false,
        };
      }
      if (diffDays === 1) {
        return {
          label: `${m}/${day} (明日)`,
          subText: "明日予定",
          isToday: false,
          isOverdue: false,
        };
      }
      if (diffDays <= 7) {
        return {
          label: `${m}/${day} (${dayName})`,
          subText: "今週予定",
          isToday: false,
          isOverdue: false,
        };
      }
      return {
        label: `${m}/${day} (${dayName})`,
        subText: "来週以降",
        isToday: false,
        isOverdue: false,
      };
    };

    // Extract unique dates
    const dateMap = new Map<number, QuotationItem[]>();
    const undatedQuotes: QuotationItem[] = [];

    filteredAcceptedQuotes.forEach((q) => {
      const cTime = parseCustomsDateToTime(q.customsClearanceDate || q.grossWeight);
      if (cTime === Infinity) {
        undatedQuotes.push(q);
      } else {
        const d = new Date(cTime);
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        if (!dateMap.has(dayStart)) {
          dateMap.set(dayStart, []);
        }
        dateMap.get(dayStart)!.push(q);
      }
    });

    // Ensure at least today and next few business days exist in columns
    for (let i = 0; i < 5; i++) {
      const dayStart = todayStart + i * oneDayMs;
      if (!dateMap.has(dayStart)) {
        dateMap.set(dayStart, []);
      }
    }

    const sortedDates = Array.from(dateMap.keys()).sort((a, b) => a - b);

    const cols = sortedDates.map((ts) => {
      const quotesInDate = dateMap.get(ts) || [];
      const info = formatColTitle(ts);
      return {
        key: String(ts),
        timestamp: ts,
        label: info.label,
        subText: info.subText,
        isToday: info.isToday,
        isOverdue: info.isOverdue,
        quotes: quotesInDate,
      };
    });

    if (undatedQuotes.length > 0) {
      cols.push({
        key: "undated",
        timestamp: Infinity,
        label: "通関日 未定",
        subText: `${undatedQuotes.length}件`,
        isToday: false,
        isOverdue: false,
        quotes: undatedQuotes,
      });
    }

    return cols;
  }, [filteredAcceptedQuotes]);

  // Save quick edit
  const handleSaveQuickEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuote) return;

    const nowIso = new Date().toISOString();
    const memoText = (editingQuote.quickMemo?.text ?? editingQuote.arrangementMemo ?? "").trim();
    const quickMemoObj = memoText
      ? {
          text: memoText,
          updatedAt: nowIso,
          updatedBy: currentUser.email,
          updatedByName: currentUser.name || currentUser.email.split("@")[0],
        }
      : undefined;

    const updated: QuotationItem = {
      ...editingQuote,
      quickMemo: quickMemoObj,
      arrangementMemo: memoText || undefined,
      updatedAt: nowIso,
      updatedBy: currentUser.email,
    };

    onUpdateQuote(updated);
    setEditingQuote(null);
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* 1. TOP HEADER & KPI CONTROL BAR */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 shrink-0 flex flex-wrap items-center justify-between gap-3 shadow-md z-20">
        {/* Left: Title & Mode Switch */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToKanban}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-all border border-slate-700 shadow-2xs"
            title="案件カンバン画面に戻る"
          >
            <ArrowLeft className="w-4 h-4 text-sky-400" />
            <span>カンバンへ戻る</span>
          </button>

          <div className="flex items-center gap-2 border-l border-slate-700 pl-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-sky-500 flex items-center justify-center text-white shadow-md">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-white tracking-wide flex items-center gap-1.5">
                  受託案件 手配進捗管理タイムライン
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-cyan-950 text-cyan-300 border border-cyan-800">
                  {acceptedQuotes.length} 案件受託中
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                通関日・ETD基準の全体進捗管理 ＆ 7ステップ非同期チェック
              </p>
            </div>
          </div>
        </div>

        {/* Center: KPI Counters */}
        <div className="flex items-center gap-2 flex-wrap">
          {statsSummary.riskCount > 0 && (
            <button
              onClick={() => setUrgencyFilter(urgencyFilter === "risk" ? "ALL" : "risk")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
                urgencyFilter === "risk"
                  ? "bg-rose-600 text-white border-rose-400 ring-2 ring-rose-500/40"
                  : "bg-rose-950/80 text-rose-300 border-rose-800 hover:bg-rose-900/60"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              <span>遅延リスク: {statsSummary.riskCount}件</span>
            </button>
          )}

          <div className="flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-slate-400 font-medium">本日通関:</span>
            <strong className="text-cyan-400 font-bold">{statsSummary.todayCount}件</strong>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400 font-medium">明日通関:</span>
            <strong className="text-amber-400 font-bold">{statsSummary.tomorrowCount}件</strong>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400 font-medium">手配完了:</span>
            <strong className="text-emerald-400 font-bold">{statsSummary.completedCount}件</strong>
          </div>
        </div>

        {/* Right: Quick Search & Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="船名・案件・荷主・空港で検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-44"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Assignee Filter */}
          <select
            value={selectedStaffId}
            onChange={(e) => setSelectedStaffId(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-cyan-500 font-bold cursor-pointer"
          >
            <option value="ALL">全担当者</option>
            {staffMembers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Destination Filter */}
          <select
            value={selectedDestCode}
            onChange={(e) => setSelectedDestCode(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-cyan-500 font-bold cursor-pointer"
          >
            <option value="ALL">全仕向地</option>
            {allDestCodes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* Quick Memo Bulk Visibility Toggle Button */}
          <button
            type="button"
            onClick={handleToggleMemos}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border shadow-2xs cursor-pointer ${
              isMemosVisible
                ? "bg-amber-950/80 hover:bg-amber-900/80 text-amber-200 border-amber-500/70 shadow-amber-950/30 ring-1 ring-amber-500/30"
                : "bg-slate-950 hover:bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200"
            }`}
            title={
              isMemosVisible
                ? "全カードの簡易メモを非表示にする（カードを縮小表示）"
                : "全カードの簡易メモを表示する"
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

      {/* 2. TASK GUIDE LEGEND BAR */}
      <div className="bg-slate-900/60 border-b border-slate-800/80 px-4 py-2 flex items-center justify-between gap-2 overflow-x-auto text-[11px] shrink-0 text-slate-300">
        <div className="flex items-center gap-1.5 font-bold text-slate-400 shrink-0">
          <Info className="w-3.5 h-3.5 text-cyan-400" />
          <span>7つの手配ステップ:</span>
        </div>
        <div className="flex items-center gap-3 overflow-x-auto custom-scrollbar shrink-0">
          {ARRANGEMENT_TASKS.map((task) => (
            <span key={task.id} className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className="w-4 h-4 rounded-full bg-slate-800 border border-slate-600 text-slate-300 flex items-center justify-center text-[10px] font-bold">
                {task.id}
              </span>
              <span className="font-semibold text-slate-200">{task.label}</span>
              <span className="text-[10px] text-slate-500 font-normal">({task.subLabel})</span>
            </span>
          ))}
        </div>
        <div className="text-[10px] text-slate-400 shrink-0 font-medium hidden md:block">
          ※各丸数字をクリックで即時完了チェック
        </div>
      </div>

      {/* 3. MAIN SCHEDULE TIMELINE COLUMNS (Horizontal Layout matching Image) */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex gap-4 h-full min-w-max items-stretch">
          {timelineColumns.map((col) => (
            <div
              key={col.key}
              className={`w-[290px] sm:w-[320px] rounded-xl border flex flex-col overflow-hidden shadow-lg transition-all ${
                col.isToday
                  ? "bg-slate-900/90 border-cyan-500/70 ring-1 ring-cyan-500/30"
                  : col.isOverdue
                  ? "bg-slate-900/90 border-rose-700/60"
                  : "bg-slate-900/70 border-slate-800"
              }`}
            >
              {/* Column Date Header Banner */}
              <div
                className={`px-3 py-2 border-b flex items-center justify-between shrink-0 ${
                  col.isToday
                    ? "bg-gradient-to-r from-cyan-950 via-slate-900 to-sky-950 border-cyan-500/50 text-cyan-300"
                    : col.isOverdue
                    ? "bg-gradient-to-r from-rose-950 to-slate-900 border-rose-800 text-rose-300"
                    : "bg-slate-800/80 border-slate-700 text-slate-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <CalendarClock className={`w-4 h-4 ${col.isToday ? "text-cyan-400" : col.isOverdue ? "text-rose-400" : "text-slate-400"}`} />
                  <div>
                    <h3 className="font-extrabold text-xs tracking-wide">
                      {col.label}
                    </h3>
                    <span className="text-[10px] text-slate-400 font-medium">
                      {col.subText}
                    </span>
                  </div>
                </div>

                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold border ${
                    col.isToday
                      ? "bg-cyan-900/80 text-cyan-200 border-cyan-600"
                      : col.isOverdue
                      ? "bg-rose-900/80 text-rose-200 border-rose-600"
                      : "bg-slate-950 text-slate-300 border-slate-700"
                  }`}
                >
                  {col.quotes.length}件
                </span>
              </div>

              {/* Cards Container */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                {col.quotes.length === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center text-center p-4 border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs">
                    <CalendarCheck2 className="w-6 h-6 mb-1 text-slate-600" />
                    <span>この日の通関予定はありません</span>
                  </div>
                ) : (
                  col.quotes.map((quote) => {
                    const cardStatus = getCardStatus(quote);
                    const tasks = quote.arrangementTasks || {};
                    const assignedStaff = staffMembers.find((s) => s.id === quote.assignedStaffId);
                    const staffName = assignedStaff?.name?.split(" ")[0] || quote.assignedStaffId || "未指定";
                    const isMyQuote = isQuoteAssignedToUser(quote, currentUser, staffMembers);
                    const completedTasksCount = ARRANGEMENT_TASKS.filter((t) => tasks[t.id]?.completed).length;

                    // Color theme configuration based on status (matching user's provided image!)
                    let headerBgClass = "bg-sky-600 text-white";
                    let cardBorderClass = "border-sky-500/60";
                    let statusBadge = { text: "手配中", bg: "bg-sky-950 text-sky-200 border-sky-400" };

                    if (cardStatus === "risk") {
                      headerBgClass = "bg-gradient-to-r from-rose-600 to-rose-700 text-white shadow-rose-900/40";
                      cardBorderClass = "border-rose-500 ring-1 ring-rose-500/30";
                      statusBadge = { text: "重要", bg: "bg-rose-950 text-rose-200 border-rose-300 font-black" };
                    } else if (cardStatus === "in_progress") {
                      headerBgClass = "bg-gradient-to-r from-amber-500 to-yellow-600 text-slate-950 font-black";
                      cardBorderClass = "border-amber-500/60";
                      statusBadge = { text: "進行中", bg: "bg-amber-950 text-amber-200 border-amber-400" };
                    } else if (cardStatus === "smooth") {
                      headerBgClass = "bg-gradient-to-r from-emerald-600 to-teal-700 text-white";
                      cardBorderClass = "border-emerald-500/60";
                      statusBadge = { text: "順調", bg: "bg-emerald-950 text-emerald-200 border-emerald-400" };
                    } else if (cardStatus === "completed") {
                      headerBgClass = "bg-gradient-to-r from-teal-700 to-emerald-800 text-white";
                      cardBorderClass = "border-teal-500/60 opacity-90";
                      statusBadge = { text: "手配完了", bg: "bg-teal-950 text-teal-200 border-teal-400" };
                    }

                    const routeDisplay = `${quote.airportCodes?.join(", ") || "JP"} // ${quote.vesselName || quote.title}`;
                    const shipperDisplay = quote.shipperName || "GHI Inc / 荷主未登録";

                    return (
                      <div
                        key={quote.id}
                        onClick={() => onSelectQuote(quote)}
                        className={`rounded-xl border bg-slate-900/95 overflow-hidden shadow-md transition-all hover:shadow-cyan-500/10 hover:border-cyan-400 cursor-pointer group flex flex-col ${cardBorderClass}`}
                      >
                        {/* Card Header (Colored Banner matching image) */}
                        <div className={`px-3 py-2.5 flex items-center justify-between gap-2 ${headerBgClass}`}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <Ship className="w-3.5 h-3.5 shrink-0" />
                              <h4 className="font-extrabold text-xs truncate tracking-wide" title={quote.title}>
                                {quote.vesselName ? `${quote.vesselName} // ${quote.airportCodes?.join("-") || "N/A"}` : quote.title}
                              </h4>
                            </div>
                          </div>

                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${statusBadge.bg}`}>
                            {statusBadge.text}
                          </span>
                        </div>

                        {/* Card Body Details */}
                        <div className="p-3 space-y-2 text-xs">
                          {/* Ship, Dest, Shipper */}
                          <div className="space-y-0.5 text-[11px] text-slate-300 font-medium">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Ship:</span>
                              <span className="font-bold text-slate-100 truncate max-w-[170px]" title={quote.vesselName || quote.title}>
                                {quote.vesselName || quote.title}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Dest:</span>
                              <span className="font-bold text-cyan-300">
                                {quote.airportCodes?.join(", ") || "未設定"}
                                {quote.weightBreak ? ` (${quote.weightBreak})` : ""}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">Shipper:</span>
                              <span className="font-medium text-slate-200 truncate max-w-[170px]" title={quote.shipperName || "荷主未指定"}>
                                {quote.shipperName || "荷主未指定"}
                              </span>
                            </div>
                          </div>

                          {/* 7-STEP PROGRESS INDICATOR (Connecting line and dots matching screenshot) */}
                          <div className="pt-2 pb-1 border-t border-slate-800">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-bold text-slate-400">
                                手配工程: <strong className="text-cyan-400">{completedTasksCount}/7 完了</strong>
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => handleCompleteAllTasks(quote, e)}
                                  className={`text-[10px] flex items-center gap-0.5 font-bold px-1.5 py-0.5 rounded transition-all active:scale-95 border ${
                                    completedTasksCount === 7
                                      ? "bg-emerald-950/80 text-emerald-300 border-emerald-600/80 hover:bg-emerald-900/80"
                                      : "bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-400 border border-emerald-500/50"
                                  }`}
                                  title={completedTasksCount === 7 ? "全7ステップを一括解除" : "全7ステップを一括で完了にする"}
                                >
                                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                                  <span>{completedTasksCount === 7 ? "全完了済" : "一括完了"}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingQuote(quote);
                                  }}
                                  className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-0.5 font-bold"
                                  title="手配情報・日程・タスクの編集"
                                >
                                  <Edit3 className="w-2.5 h-2.5" />
                                  編集
                                </button>
                              </div>
                            </div>

                            {/* Stepper Dots Row 1..7 */}
                            <div className="relative flex items-center justify-between px-1 py-1">
                              {/* Background Connecting Line */}
                              <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-0.5 bg-slate-700 z-0" />

                              {ARRANGEMENT_TASKS.map((task) => {
                                const isDone = Boolean(tasks[task.id]?.completed);
                                const isRiskStep = cardStatus === "risk" && !isDone && task.id === 4;

                                return (
                                  <div
                                    key={task.id}
                                    className="relative z-10 group/step"
                                    onMouseEnter={() => setActiveTaskTooltip({ quoteId: quote.id, taskId: task.id })}
                                    onMouseLeave={() => setActiveTaskTooltip(null)}
                                  >
                                    <button
                                      type="button"
                                      onClick={(e) => handleToggleTask(quote, task.id, e)}
                                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all transform hover:scale-115 active:scale-95 shadow-sm ${
                                        isDone
                                          ? "bg-emerald-500 text-slate-950 font-black ring-2 ring-emerald-400 shadow-emerald-500/30"
                                          : isRiskStep
                                          ? "bg-rose-600 text-white font-black ring-2 ring-rose-400 animate-bounce"
                                          : cardStatus === "in_progress" && task.id <= 3
                                          ? "bg-amber-500 text-slate-950 ring-1 ring-amber-300"
                                          : "bg-slate-800 text-slate-400 border border-slate-600 hover:border-slate-400"
                                      }`}
                                      title={`${task.id}. ${task.label} (${task.subLabel}) - ${isDone ? "完了済 (クリックで解除)" : "未完了 (クリックで完了)"}`}
                                    >
                                      {isDone ? (
                                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                                      ) : isRiskStep ? (
                                        <AlertTriangle className="w-3 h-3" />
                                      ) : (
                                        task.id
                                      )}
                                    </button>

                                    {/* Task hover tooltip */}
                                    {activeTaskTooltip?.quoteId === quote.id && activeTaskTooltip?.taskId === task.id && (
                                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-900 text-white text-[10px] rounded shadow-xl border border-slate-700 whitespace-nowrap z-50 pointer-events-none">
                                        <div className="font-bold text-cyan-300">
                                          {task.id}. {task.label}
                                        </div>
                                        <div className="text-slate-300">{task.subLabel}</div>
                                        <div className={`mt-0.5 font-bold ${isDone ? "text-emerald-400" : "text-amber-400"}`}>
                                          {isDone ? `✓ 完了 (${tasks[task.id]?.completedBy || "記録済"})` : "未完了"}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Risk Warning Alert Box (if risk) */}
                          {cardStatus === "risk" && (
                            <div className="bg-rose-950/90 border border-rose-600/80 rounded-lg px-2.5 py-1 flex items-center justify-between text-rose-200 text-[11px] font-bold">
                              <span className="flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                通関遅延リスク
                              </span>
                              <span className="text-[10px] text-rose-300 font-normal">
                                通関依頼未済
                              </span>
                            </div>
                          )}

                          {/* 簡易メモ (1案件に1つ、現在の状況の表示・変更・削除) */}
                          {isMemosVisible ? (
                            <div className="pt-0.5">
                              <QuickMemoCard
                                quote={quote}
                                currentUser={currentUser}
                                onUpdateQuote={onUpdateQuote}
                                variant="timeline"
                              />
                            </div>
                          ) : (
                            (() => {
                              const memo = getQuickMemo(quote);
                              if (!memo) return null;
                              return (
                                <div
                                  className="pt-0.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/50 text-[10px] font-bold max-w-full"
                                    title={`【簡易メモ】${memo.updatedByName ? `${memo.updatedByName}: ` : ""}${memo.text}`}
                                  >
                                    <span className="shrink-0">📝</span>
                                    <span className="truncate">{memo.text}</span>
                                  </div>
                                </div>
                              );
                            })()
                          )}

                          {/* Bottom Footer Info: ETA, ETD, Assignee */}
                          <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                            <div>
                              <div>ETA: <span className="text-slate-200 font-mono font-bold">{quote.etaDate || "未定"}</span></div>
                              <div>ETD: <span className="text-slate-200 font-mono font-bold">{quote.etdDate || formatCustomsDate(quote.customsClearanceDate) || "未定"}</span></div>
                            </div>

                            <div className="text-right">
                              <div className="flex items-center gap-1 justify-end">
                                <User className="w-3 h-3 text-slate-400" />
                                <span className={`font-bold ${isMyQuote ? "text-cyan-300 font-black" : "text-slate-200"}`}>
                                  {staffName}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono">
                                通関: {formatCustomsDate(quote.customsClearanceDate) || "未定"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. QUICK EDIT MODAL FOR DATES & TASKS */}
      {editingQuote && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-sm text-white">
                  手配情報・日程・タスクの編集
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingQuote(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveQuickEdit} className="space-y-4">
              <div>
                <span className="text-xs font-bold text-cyan-300 block mb-1">
                  案件名: {editingQuote.title}
                </span>
                <span className="text-xs text-slate-400 block">
                  船名: {editingQuote.vesselName || "未指定"} | 仕向地: {editingQuote.airportCodes?.join(", ")}
                </span>
              </div>

              {/* Schedule Dates & Shipper */}
              <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    通関日 (Customs Date)
                  </label>
                  <input
                    type="date"
                    value={editingQuote.customsClearanceDate || ""}
                    onChange={(e) =>
                      setEditingQuote({ ...editingQuote, customsClearanceDate: e.target.value })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 font-bold"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    ETD 出発日
                  </label>
                  <input
                    type="date"
                    value={editingQuote.etdDate || ""}
                    onChange={(e) =>
                      setEditingQuote({ ...editingQuote, etdDate: e.target.value })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 font-bold"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    ETA 到着予定日
                  </label>
                  <input
                    type="date"
                    value={editingQuote.etaDate || ""}
                    onChange={(e) =>
                      setEditingQuote({ ...editingQuote, etaDate: e.target.value })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 font-bold"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    荷主名 (Shipper)
                  </label>
                  <input
                    type="text"
                    placeholder="例: GHI Inc, XYZ Trading"
                    value={editingQuote.shipperName || ""}
                    onChange={(e) =>
                      setEditingQuote({ ...editingQuote, shipperName: e.target.value })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 font-medium"
                  />
                </div>
              </div>

              {/* 7 Tasks Checkbox Matrix */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-300">
                    7つの手配ステップチェック
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const currentTasks = editingQuote.arrangementTasks || {};
                      const completedCount = ARRANGEMENT_TASKS.filter((t) => currentTasks[t.id]?.completed).length;
                      const targetCompleted = completedCount !== 7;
                      const updatedTasks: Record<number, ArrangementTaskStatus> = {};
                      const nowStr = new Date().toISOString();

                      ARRANGEMENT_TASKS.forEach((t) => {
                        const prevStatus = currentTasks[t.id];
                        updatedTasks[t.id] = {
                          completed: targetCompleted,
                          ...(targetCompleted
                            ? { completedAt: prevStatus?.completedAt || nowStr, completedBy: prevStatus?.completedBy || currentUser.name }
                            : {}),
                          ...(prevStatus?.note ? { note: prevStatus.note } : {}),
                        };
                      });

                      setEditingQuote({
                        ...editingQuote,
                        arrangementTasks: updatedTasks,
                        isArrangementCompleted: targetCompleted,
                      });
                    }}
                    className="text-[11px] px-2 py-0.5 rounded bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700 flex items-center gap-1 font-bold transition-all"
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span>一括完了</span>
                  </button>
                </div>
                <div className="space-y-1.5 bg-slate-950 p-3 rounded-xl border border-slate-800 max-h-48 overflow-y-auto custom-scrollbar">
                  {ARRANGEMENT_TASKS.map((task) => {
                    const tasks = editingQuote.arrangementTasks || {};
                    const isDone = Boolean(tasks[task.id]?.completed);

                    return (
                      <label
                        key={task.id}
                        className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer transition-all ${
                          isDone
                            ? "bg-emerald-950/60 border-emerald-700 text-emerald-200 font-bold"
                            : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isDone}
                            onChange={(e) => {
                              const isChecked = e.target.checked;
                              const updatedTasks = {
                                ...tasks,
                                [task.id]: {
                                  completed: isChecked,
                                  ...(isChecked ? { completedAt: new Date().toISOString(), completedBy: currentUser.name } : {}),
                                },
                              };
                              setEditingQuote({
                                ...editingQuote,
                                arrangementTasks: updatedTasks,
                              });
                            }}
                            className="w-4 h-4 rounded text-cyan-600 focus:ring-cyan-500"
                          />
                          <span>
                            <strong className="text-cyan-400 mr-1">{task.id}.</strong>
                            {task.label}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500">
                          {task.subLabel}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Handover Note / Quick Memo */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-slate-300">
                    簡易メモ・現在の状況 (引継ぎ特記事項)
                  </label>
                  {editingQuote.quickMemo?.updatedByName && (
                    <span className="text-[10px] text-slate-400">
                      最終更新: {editingQuote.quickMemo.updatedByName} ({formatMemoTimestamp(editingQuote.quickMemo.updatedAt)})
                    </span>
                  )}
                </div>
                <textarea
                  rows={2}
                  placeholder="例: インボイス確認済、明日午前中に搬入予定。"
                  value={editingQuote.quickMemo?.text ?? editingQuote.arrangementMemo ?? ""}
                  onChange={(e) => {
                    const text = e.target.value;
                    const nowIso = new Date().toISOString();
                    setEditingQuote({
                      ...editingQuote,
                      arrangementMemo: text,
                      quickMemo: text.trim()
                        ? {
                            text: text.trim(),
                            updatedAt: nowIso,
                            updatedBy: currentUser.email,
                            updatedByName: currentUser.name || currentUser.email.split("@")[0],
                          }
                        : undefined,
                    });
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingQuote(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-md transition-all"
                >
                  保存する
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
