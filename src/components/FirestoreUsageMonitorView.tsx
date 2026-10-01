import React, { useState, useMemo, useEffect } from "react";
import {
  Activity,
  Calendar,
  Clock,
  Database,
  Download,
  Filter,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Flame,
  Layers,
  Sparkles,
  Trash2,
  TrendingUp,
  Zap,
  BarChart3,
  X,
  FileSpreadsheet,
  Cpu,
  ShieldAlert,
  Sliders,
  Maximize2,
  Info,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
} from "recharts";
import * as XLSX from "xlsx";
import { AppTheme, StaffMember, UserProfile } from "../types";
import {
  FirestoreReadLogEntry,
  getFirestoreReadLogs,
  saveFirestoreReadLogs,
  generateDefaultPast7DaysLogs,
  calculate7DaysSummary,
  getPast7DaysList,
  recordFirestoreRead,
} from "../lib/firestoreMonitor";

interface FirestoreUsageMonitorViewProps {
  currentTheme: AppTheme;
  currentUser?: UserProfile | StaffMember | null;
  onBackToKanban?: () => void;
}

type TabType = "trends" | "heatmap" | "collections" | "advisor" | "logs";

const FREE_TIER_DAILY_LIMIT = 50000;

const COLORS = [
  "#0284c7", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#64748b", // slate
  "#06b6d4", // cyan
  "#f97316", // orange
];

export const FirestoreUsageMonitorView: React.FC<FirestoreUsageMonitorViewProps> = ({
  currentTheme,
  currentUser,
  onBackToKanban,
}) => {
  const [logs, setLogs] = useState<FirestoreReadLogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("trends");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedCollectionFilter, setSelectedCollectionFilter] = useState<string>("all");
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>("all");
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [logPage, setLogPage] = useState<number>(1);
  const logsPerPage = 20;

  // ログの読み込み
  const reloadLogs = () => {
    setIsRefreshing(true);
    const loaded = getFirestoreReadLogs();
    setLogs(loaded);
    setTimeout(() => setIsRefreshing(false), 300);
  };

  useEffect(() => {
    reloadLogs();
  }, []);

  // 集計サマリー
  const summary = useMemo(() => {
    return calculate7DaysSummary(logs);
  }, [logs]);

  // コレクション一覧
  const collectionNames = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => set.add(l.collectionName));
    return Array.from(set).sort();
  }, [logs]);

  // 日別チャート用データ
  const dailyChartData = useMemo(() => {
    return summary.dailySummaries.map((d) => {
      const parts = d.date.split("-");
      const shortDate = `${parts[1]}/${parts[2]}`;
      return {
        date: shortDate,
        fullDate: d.date,
        totalReads: d.totalReads,
        quotaPercent: d.quotaPercent,
        limit: FREE_TIER_DAILY_LIMIT,
        ...d.byCollection,
      };
    });
  }, [summary.dailySummaries]);

  // 時間別チャート用データ (0〜23時)
  const hourlyChartData = useMemo(() => {
    return summary.hourlyAggregated.map((h) => ({
      hourLabel: `${h.hour}:00`,
      hour: h.hour,
      totalReads: h.totalReads,
      ...h.byCollection,
    }));
  }, [summary.hourlyAggregated]);

  // コレクション別円グラフ用データ
  const collectionPieData = useMemo(() => {
    const total = summary.total7DaysReads || 1;
    return Object.entries(summary.collectionTotals)
      .map(([name, count]) => {
        const numVal = typeof count === "number" ? count : Number(count) || 0;
        return {
          name,
          value: numVal,
          percent: Math.round((numVal / total) * 100),
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [summary.collectionTotals, summary.total7DaysReads]);

  // フィルタリングされたログ一覧
  const filteredLogs = useMemo(() => {
    return logs
      .filter((l) => {
        if (selectedCollectionFilter !== "all" && l.collectionName !== selectedCollectionFilter) {
          return false;
        }
        if (selectedDateFilter !== "all" && l.date !== selectedDateFilter) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchCol = l.collectionName.toLowerCase().includes(q);
          const matchDetails = l.details?.toLowerCase().includes(q);
          const matchEmail = l.userEmail?.toLowerCase().includes(q);
          if (!matchCol && !matchDetails && !matchEmail) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [logs, selectedCollectionFilter, selectedDateFilter, searchQuery]);

  // ページネーションログ
  const paginatedLogs = useMemo(() => {
    const start = (logPage - 1) * logsPerPage;
    return filteredLogs.slice(start, start + logsPerPage);
  }, [filteredLogs, logPage]);

  const totalPages = Math.ceil(filteredLogs.length / logsPerPage) || 1;

  // テスト用データシミュレーションの注入
  const handleInjectSimulation = () => {
    const simulated = generateDefaultPast7DaysLogs();
    saveFirestoreReadLogs(simulated);
    setLogs(simulated);
  };

  // ログクリア
  const handleClearLogs = () => {
    if (confirm("Firestoreの読み取り履歴ログを初期化しますか？")) {
      saveFirestoreReadLogs([]);
      setLogs([]);
    }
  };

  // Excel / CSV エクスポート
  const handleExportData = () => {
    const wsDailyData = [
      ["日付 (YYYY-MM-DD)", "総読み取り回数 (Reads)", "無料枠消費率 (%)", "クォータエラー件数"],
      ...summary.dailySummaries.map((d) => [d.date, d.totalReads, `${d.quotaPercent}%`, d.quotaErrors]),
    ];

    const wsHourlyData = [
      ["時間帯 (時)", "総読み取り回数 (Reads)"],
      ...summary.hourlyAggregated.map((h) => [`${h.hour}:00`, h.totalReads]),
    ];

    const wsLogsData = [
      ["ID", "タイムスタンプ", "日付", "時間", "コレクション", "読み取り数", "操作種別", "詳細", "ユーザー"],
      ...filteredLogs.map((l) => [
        l.id,
        l.timestamp,
        l.date,
        l.hour,
        l.collectionName,
        l.count,
        l.operationType,
        l.details || "",
        l.userEmail || "",
      ]),
    ];

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(wsDailyData);
    const ws2 = XLSX.utils.aoa_to_sheet(wsHourlyData);
    const ws3 = XLSX.utils.aoa_to_sheet(wsLogsData);

    XLSX.utils.book_append_sheet(wb, ws1, "日別集計_7Days");
    XLSX.utils.book_append_sheet(wb, ws2, "時間別集計_Hourly");
    XLSX.utils.book_append_sheet(wb, ws3, "詳細読取ログ");

    const dateStr = new Date().toISOString().split("T")[0];
    XLSX.writeFile(wb, `Firestore_Read_Usage_Report_${dateStr}.xlsx`);
  };

  // ヒートマップセルの色判定
  const getHeatmapColor = (reads: number) => {
    if (reads === 0) return currentTheme === "light" ? "bg-slate-100 text-slate-400" : "bg-slate-800/40 text-slate-500";
    if (reads < 50) return "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-medium";
    if (reads < 200) return "bg-sky-100 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300 font-semibold";
    if (reads < 500) return "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 font-bold";
    return "bg-rose-500 text-white font-black shadow-xs";
  };

  // テーマ別コンテナスタイル
  const containerBg =
    currentTheme === "light"
      ? "bg-slate-50 text-slate-900 border-slate-200"
      : currentTheme === "digital"
      ? "bg-[#060e14] text-emerald-300 border-emerald-900/60"
      : "bg-slate-950 text-slate-100 border-slate-800";

  const cardBg =
    currentTheme === "light"
      ? "bg-white border-slate-200 shadow-xs"
      : currentTheme === "digital"
      ? "bg-[#08151f] border-emerald-900/50 shadow-sm"
      : "bg-slate-900 border-slate-800 shadow-sm";

  return (
    <div className={`flex flex-col h-full w-full overflow-hidden ${containerBg}`}>
      {/* 1. Header Toolbar (StockExtractorViewテイスト) */}
      <div className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3 ${
        currentTheme === "light" ? "bg-white border-slate-200" : "bg-slate-900/80 border-slate-800"
      }`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-red-600 flex items-center justify-center text-white shadow-md">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black tracking-wide">
                Firestore 読み取りメトリクス & クォータ監視
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                Spark無料枠: 50,000 reads/日
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                過去7日間テレメトリ
              </span>
            </div>
            <p className={`text-xs ${currentTheme === "light" ? "text-slate-500" : "text-slate-400"}`}>
              Firestoreの読み取り回数を時間別・日別に集計・可視化し、クォータ超過の事前防止と最適化を支援します
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={reloadLogs}
            disabled={isRefreshing}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
              currentTheme === "light"
                ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300"
                : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
            }`}
            title="最新の読み取りログを再集計"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>再集計</span>
          </button>

          <button
            type="button"
            onClick={handleExportData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
            title="集計データと詳細ログをExcel形式で出力"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Excel / CSV 出力</span>
          </button>

          <button
            type="button"
            onClick={handleInjectSimulation}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
            title="7日間のデモ用ログデータを生成"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>デモ生成</span>
          </button>

          <button
            type="button"
            onClick={handleClearLogs}
            className={`p-1.5 rounded-lg text-xs border transition-all cursor-pointer ${
              currentTheme === "light"
                ? "bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border-slate-200"
                : "bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 border-slate-700"
            }`}
            title="テレメトリログをクリア"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {onBackToKanban && (
            <button
              type="button"
              onClick={onBackToKanban}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold shadow-xs transition-all cursor-pointer ml-1"
            >
              <X className="w-4 h-4" />
              <span>閉じる</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Top Summary KPI Cards (5 Cards) */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 shrink-0">
        {/* Card 1: 過去7日間の総読み取り */}
        <div className={`p-3.5 rounded-xl border flex flex-col justify-between ${cardBg}`}>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-sky-500" />
              7日間 総読み取り
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-500 font-bold">
              Total Reads
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black tracking-tight text-sky-500">
              {summary.total7DaysReads.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400 font-medium">回</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-500" />
            1日平均: <span className="font-bold">{summary.averageDailyReads.toLocaleString()}</span> 回
          </div>
        </div>

        {/* Card 2: 本日の読み取り & クォータ消費率 */}
        <div className={`p-3.5 rounded-xl border flex flex-col justify-between ${cardBg}`}>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              本日の読み取り
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
              summary.todayQuotaPercent > 80
                ? "bg-rose-500/10 text-rose-500"
                : summary.todayQuotaPercent > 50
                ? "bg-amber-500/10 text-amber-500"
                : "bg-emerald-500/10 text-emerald-500"
            }`}>
              {summary.todayQuotaPercent}% 消費
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black tracking-tight text-amber-500">
              {summary.todayReads.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400 font-medium">/ 50,000</span>
          </div>
          <div className="mt-2 w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                summary.todayQuotaPercent > 80
                  ? "bg-rose-500"
                  : summary.todayQuotaPercent > 50
                  ? "bg-amber-500"
                  : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(100, summary.todayQuotaPercent)}%` }}
            />
          </div>
        </div>

        {/* Card 3: ピーク時間帯 */}
        <div className={`p-3.5 rounded-xl border flex flex-col justify-between ${cardBg}`}>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-purple-500" />
              アクセス集中時間帯
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 font-bold">
              Peak Hour
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-black tracking-tight text-purple-500">
              {summary.peakHour.hour}:00
            </span>
            <span className="text-xs text-slate-400 font-medium">
              ({summary.peakHour.totalReads.toLocaleString()} 回)
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            業務中の更新・リロードが最多の時間帯
          </div>
        </div>

        {/* Card 4: クォータエラー発生履歴 */}
        <div className={`p-3.5 rounded-xl border flex flex-col justify-between ${cardBg}`}>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
              クォータエラー履歴
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
              summary.totalQuotaErrors > 0 ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-500"
            }`}>
              {summary.totalQuotaErrors > 0 ? "要対策" : "正常"}
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className={`text-2xl font-black tracking-tight ${
              summary.totalQuotaErrors > 0 ? "text-rose-500" : "text-emerald-500"
            }`}>
              {summary.totalQuotaErrors}
            </span>
            <span className="text-xs text-slate-400 font-medium">件</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {summary.totalQuotaErrors > 0 ? "50,000件超過による遮断を検知" : "無料枠内で安定稼働中"}
          </div>
        </div>

        {/* Card 5: 最多利用コレクション */}
        <div className={`p-3.5 rounded-xl border flex flex-col justify-between ${cardBg}`}>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-bold flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-500" />
              最多読み取り
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-bold">
              Top Collection
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-lg font-black tracking-tight text-emerald-500 truncate max-w-[120px]">
              {collectionPieData[0]?.name || "N/A"}
            </span>
            <span className="text-xs font-bold text-slate-400">
              {collectionPieData[0]?.percent || 0}%
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {collectionPieData[0]?.value.toLocaleString() || 0} 回の同期・取得
          </div>
        </div>
      </div>

      {/* 3. Navigation Tabs */}
      <div className={`px-4 border-b flex items-center gap-2 overflow-x-auto ${
        currentTheme === "light" ? "border-slate-200 bg-slate-100/50" : "border-slate-800 bg-slate-900/40"
      }`}>
        <button
          type="button"
          onClick={() => setActiveTab("trends")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === "trends"
              ? "border-sky-500 text-sky-600 dark:text-sky-400 bg-white dark:bg-slate-900 shadow-2xs rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>日別・時間別推移グラフ</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("heatmap")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === "heatmap"
              ? "border-sky-500 text-sky-600 dark:text-sky-400 bg-white dark:bg-slate-900 shadow-2xs rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Flame className="w-4 h-4" />
          <span>7日間 × 24時間 ヒートマップ</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("collections")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === "collections"
              ? "border-sky-500 text-sky-600 dark:text-sky-400 bg-white dark:bg-slate-900 shadow-2xs rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>コレクション別内訳</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("advisor")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === "advisor"
              ? "border-sky-500 text-sky-600 dark:text-sky-400 bg-white dark:bg-slate-900 shadow-2xs rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>クォータ診断 & 最適化ガイド</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("logs")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === "logs"
              ? "border-sky-500 text-sky-600 dark:text-sky-400 bg-white dark:bg-slate-900 shadow-2xs rounded-t-lg"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Database className="w-4 h-4" />
          <span>読取イベント詳細ログ ({filteredLogs.length})</span>
        </button>
      </div>

      {/* 4. Tab Content Area */}
      <div className="flex-1 p-4 overflow-y-auto">
        {/* TAB 1: 日別・時間別推移グラフ */}
        {activeTab === "trends" && (
          <div className="space-y-4">
            {/* Row 1: 日別読み取り推移 (BarChart) */}
            <div className={`p-4 rounded-xl border ${cardBg}`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-sky-500" />
                    過去7日間の日別 読み取り推移 (Daily Reads vs. 50k Free Quota)
                  </h3>
                  <p className="text-xs text-slate-400">
                    50,000 Reads/日の上限ラインに対する日ごとの消費量
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs font-medium">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-xs bg-sky-500" />
                    <span>読み取り件数</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-rose-500">
                    <div className="w-3 h-0.5 bg-rose-500" />
                    <span>無料枠上限 (50,000)</span>
                  </div>
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: number) => [`${val.toLocaleString()} reads`, "読み取り数"]}
                      labelFormatter={(label) => `日付: ${label}`}
                      contentStyle={{
                        backgroundColor: currentTheme === "light" ? "#fff" : "#0f172a",
                        borderColor: currentTheme === "light" ? "#e2e8f0" : "#334155",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <ReferenceLine y={50000} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Quota 50,000", fill: "#ef4444", fontSize: 10 }} />
                    <Bar dataKey="totalReads" fill="#0284c7" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Row 2: 時間別アクセス集中密度 (AreaChart) */}
            <div className={`p-4 rounded-xl border ${cardBg}`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    時間帯別 (0:00〜23:00) 読み取りアクセス集中推移
                  </h3>
                  <p className="text-xs text-slate-400">
                    過去7日間の各時間帯ごとの累積読み取り回数（業務時間・ピーク時間帯の把握）
                  </p>
                </div>
              </div>

              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={hourlyChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorHourly" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="hourLabel" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: number) => [`${val.toLocaleString()} reads`, "累積読み取り"]}
                      labelFormatter={(label) => `時間帯: ${label}`}
                      contentStyle={{
                        backgroundColor: currentTheme === "light" ? "#fff" : "#0f172a",
                        borderColor: currentTheme === "light" ? "#e2e8f0" : "#334155",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Area type="monotone" dataKey="totalReads" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#colorHourly)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: 7日間 × 24時間 ヒートマップ */}
        {activeTab === "heatmap" && (
          <div className={`p-4 rounded-xl border ${cardBg}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-500" />
                  日別 × 24時間 読み取り密度ヒートマップマトリックス
                </h3>
                <p className="text-xs text-slate-400">
                  過去7日間の各日・各時間ごとの読み取り回数を色別に可視化
                </p>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-400">凡例:</span>
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-400">0件</span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">1〜50件</span>
                <span className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300">50〜200件</span>
                <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">200〜500件</span>
                <span className="px-2 py-0.5 rounded bg-rose-500 text-white font-bold">500件以上</span>
              </div>
            </div>

            <div className="overflow-x-auto pb-2">
              <table className="w-full border-collapse text-center text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="p-2 text-left text-slate-400 font-bold w-24">日付</th>
                    {Array.from({ length: 24 }, (_, i) => (
                      <th key={i} className="p-1 text-[10px] text-slate-400 font-medium min-w-[32px]">
                        {i}時
                      </th>
                    ))}
                    <th className="p-2 text-right text-slate-400 font-bold w-24">日合計</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  {summary.dailySummaries.map((day) => (
                    <tr key={day.date} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="p-2 text-left font-bold whitespace-nowrap">
                        {day.date.substring(5)}
                      </td>
                      {day.hourlyReads.map((reads, h) => (
                        <td key={h} className="p-0.5">
                          <div
                            className={`w-full py-1.5 rounded-xs transition-all text-[10px] ${getHeatmapColor(
                              reads
                            )}`}
                            title={`${day.date} ${h}:00 - ${reads.toLocaleString()} reads`}
                          >
                            {reads > 0 ? (reads >= 1000 ? `${(reads / 1000).toFixed(1)}k` : reads) : "-"}
                          </div>
                        </td>
                      ))}
                      <td className="p-2 text-right font-black text-sky-600 dark:text-sky-400 whitespace-nowrap">
                        {day.totalReads.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: コレクション別内訳 */}
        {activeTab === "collections" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Pie Chart */}
            <div className={`p-4 rounded-xl border ${cardBg}`}>
              <h3 className="text-sm font-bold mb-1 flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-500" />
                コレクション別 読み取り比率
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                どのFirestoreコレクションが最も読み取り回数を消費しているかの割合
              </p>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={collectionPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {collectionPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: number) => [`${val.toLocaleString()} reads`, "読み取り数"]}
                      contentStyle={{
                        backgroundColor: currentTheme === "light" ? "#fff" : "#0f172a",
                        borderColor: currentTheme === "light" ? "#e2e8f0" : "#334155",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Collection Table */}
            <div className={`p-4 rounded-xl border ${cardBg}`}>
              <h3 className="text-sm font-bold mb-1 flex items-center gap-2">
                <Database className="w-4 h-4 text-sky-500" />
                コレクション別 累積アクセス集計表
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                コレクションごとの読み取り総数と推奨クエリ頻度
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-400 font-bold">
                      <th className="pb-2">コレクション名</th>
                      <th className="pb-2 text-right">読み取り回数</th>
                      <th className="pb-2 text-right">全体比率</th>
                      <th className="pb-2 text-right">同期種別</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {collectionPieData.map((col, idx) => (
                      <tr key={col.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 flex items-center gap-2 font-bold">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                          />
                          <span className="font-mono text-[11px]">{col.name}</span>
                        </td>
                        <td className="py-2.5 text-right font-bold text-sky-600 dark:text-sky-400">
                          {col.value.toLocaleString()} 回
                        </td>
                        <td className="py-2.5 text-right font-medium">
                          {col.percent}%
                        </td>
                        <td className="py-2.5 text-right text-[11px] text-slate-400">
                          {col.name === "quotations" || col.name === "messages"
                            ? "リアルタイム (onSnapshot)"
                            : "個別取得 (getDoc)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: クォータ診断 & 最適化ガイド */}
        {activeTab === "advisor" && (
          <div className="space-y-4">
            {/* Alert Banner */}
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <h4 className="font-bold text-amber-600 dark:text-amber-400 text-sm">
                  Firebase Firestore 無料枠（Spark Plan）のクォータ上限について
                </h4>
                <p className="text-slate-600 dark:text-slate-300">
                  Cloud Firestoreの無料利用枠では、<strong>1日あたり 50,000 Document Reads（読み取り）</strong>が上限となっています。
                  これを超過すると「<code>Quota limit exceeded</code>」エラーが発生し、翌日（太平洋時間の深夜／日本時間夕方）まで読み取りがブロックされます。
                </p>
              </div>
            </div>

            {/* 3 Optimization Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className={`p-4 rounded-xl border ${cardBg} space-y-2`}>
                <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-500 flex items-center justify-center font-bold">
                  1
                </div>
                <h4 className="text-xs font-bold">リアルタイムリスナーの節約</h4>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <code>onSnapshot</code> は画面を開いているユーザー全員が、データ変更のたびに全件ドキュメントを読み直します。複数タブや開きっぱなしの端末が多いと急増します。
                </p>
                <div className="text-[11px] text-sky-500 font-bold bg-sky-500/10 p-2 rounded-lg">
                  💡 document.hidden判定によるバックグラウンド取得停止＆ローカルキャッシュ連携を実装済み
                </div>
              </div>

              <div className={`p-4 rounded-xl border ${cardBg} space-y-2`}>
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold">
                  2
                </div>
                <h4 className="text-xs font-bold">クライアント完結機能の活用</h4>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  「未出荷在庫データ抽出 (Excel / XLSM 解析)」や「過去見積もり検索」など、Firestore通信を行わないクライアント完結型ツールはクォータを一切消費しません。
                </p>
                <div className="text-[11px] text-emerald-500 font-bold bg-emerald-500/10 p-2 rounded-lg">
                  💡 Excel解析はFirestore 0 readで完全動作
                </div>
              </div>

              <div className={`p-4 rounded-xl border ${cardBg} space-y-2`}>
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center font-bold">
                  3
                </div>
                <h4 className="text-xs font-bold">Blazeプランへのアップグレード</h4>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  業務利用等で50,000件以上の同時アクセスが必要な場合は、従量課金プラン（Blaze）にアップグレードすることで上限なしで利用可能です（月5万件まで無料枠継続）。
                </p>
                <a
                  href="https://console.firebase.google.com/project/ringed-codex-500814-a1/firestore/databases/ai-studio-34d4c85e-4bd2-4779-98a6-22562a204375/usage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-purple-500 hover:underline font-bold bg-purple-500/10 p-2 rounded-lg w-full"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Firebase Console で使用量を確認
                </a>
              </div>
            </div>

            {/* Quick External Links */}
            <div className={`p-4 rounded-xl border ${cardBg} flex flex-wrap items-center justify-between gap-3`}>
              <div>
                <h4 className="text-xs font-bold">Google Cloud 監視ダッシュボードへの直接リンク</h4>
                <p className="text-[11px] text-slate-400">
                  Google Cloud Metrics Explorer で秒・分単位の詳細なFirestore API呼び出しグラフを確認できます
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href="https://console.cloud.google.com/monitoring/metrics-explorer?project=ringed-codex-500814-a1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-all shadow-xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Google Cloud Metrics Explorer</span>
                </a>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: 読取イベント詳細ログ一覧 */}
        {activeTab === "logs" && (
          <div className={`p-4 rounded-xl border ${cardBg} space-y-3`}>
            {/* Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setLogPage(1);
                    }}
                    placeholder="コレクション名・詳細・ユーザーで検索..."
                    className={`w-full pl-9 pr-3 py-1.5 rounded-lg text-xs border focus:outline-hidden focus:ring-1 focus:ring-sky-500 ${
                      currentTheme === "light"
                        ? "bg-slate-50 border-slate-300 text-slate-900"
                        : "bg-slate-800 border-slate-700 text-slate-100"
                    }`}
                  />
                </div>

                {/* Collection Filter */}
                <select
                  value={selectedCollectionFilter}
                  onChange={(e) => {
                    setSelectedCollectionFilter(e.target.value);
                    setLogPage(1);
                  }}
                  className={`py-1.5 px-2.5 rounded-lg text-xs border font-medium ${
                    currentTheme === "light"
                      ? "bg-slate-50 border-slate-300 text-slate-800"
                      : "bg-slate-800 border-slate-700 text-slate-200"
                  }`}
                >
                  <option value="all">全コレクション</option>
                  {collectionNames.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                {/* Date Filter */}
                <select
                  value={selectedDateFilter}
                  onChange={(e) => {
                    setSelectedDateFilter(e.target.value);
                    setLogPage(1);
                  }}
                  className={`py-1.5 px-2.5 rounded-lg text-xs border font-medium ${
                    currentTheme === "light"
                      ? "bg-slate-50 border-slate-300 text-slate-800"
                      : "bg-slate-800 border-slate-700 text-slate-200"
                  }`}
                >
                  <option value="all">全期間 (7日間)</option>
                  {getPast7DaysList().map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-xs text-slate-400 font-bold">
                該当件数: {filteredLogs.length.toLocaleString()} 件
              </div>
            </div>

            {/* Logs Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-400 font-bold">
                    <th className="pb-2 pl-2">日時 (JST)</th>
                    <th className="pb-2">コレクション</th>
                    <th className="pb-2 text-right">読取件数</th>
                    <th className="pb-2">種別</th>
                    <th className="pb-2">詳細</th>
                    <th className="pb-2 pr-2">実行元ユーザー</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50 font-mono">
                  {paginatedLogs.map((log) => (
                    <tr
                      key={log.id}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-800/30 ${
                        log.operationType === "quota_error" ? "bg-rose-500/10 text-rose-500" : ""
                      }`}
                    >
                      <td className="py-2 pl-2 text-[11px] whitespace-nowrap text-slate-400">
                        {log.timestamp.replace("T", " ").substring(0, 19)}
                      </td>
                      <td className="py-2 font-bold text-sky-600 dark:text-sky-400">
                        {log.collectionName}
                      </td>
                      <td className="py-2 text-right font-black">
                        {log.count.toLocaleString()}
                      </td>
                      <td className="py-2 text-[10px]">
                        <span className={`px-1.5 py-0.5 rounded font-sans font-bold ${
                          log.operationType === "quota_error"
                            ? "bg-rose-500 text-white"
                            : log.operationType === "snapshot_initial"
                            ? "bg-purple-500/10 text-purple-500"
                            : "bg-emerald-500/10 text-emerald-500"
                        }`}>
                          {log.operationType}
                        </span>
                      </td>
                      <td className="py-2 text-[11px] font-sans text-slate-500 dark:text-slate-400 truncate max-w-xs">
                        {log.details}
                      </td>
                      <td className="py-2 pr-2 text-[11px] font-sans text-slate-400 truncate max-w-[140px]">
                        {log.userEmail || "-"}
                      </td>
                    </tr>
                  ))}
                  {paginatedLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 font-sans">
                        該当する読み取りログはありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
                <button
                  type="button"
                  disabled={logPage <= 1}
                  onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40"
                >
                  前へ
                </button>
                <span className="text-slate-400">
                  {logPage} / {totalPages} ページ
                </span>
                <button
                  type="button"
                  disabled={logPage >= totalPages}
                  onClick={() => setLogPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40"
                >
                  次へ
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
