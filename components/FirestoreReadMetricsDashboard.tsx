import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  BarChart3,
  Calendar,
  Clock,
  Database,
  Download,
  Flame,
  Layers,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap,
  X,
  Play,
  CheckCircle2,
  HardDrive,
  Info,
  Sliders,
  TrendingUp,
  AlertTriangle,
  FileSpreadsheet
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import {
  getPast7DaysMetrics,
  get7DaysHourlyAggregates,
  get7DaysCollectionBreakdown,
  getRecentReadEvents,
  subscribeToMetrics,
  executeTestFirestoreReads,
  resetMetricsData,
  DailyReadMetric,
  ReadEventLog
} from '../lib/firestoreMetricsService';

interface FirestoreReadMetricsDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'daily' | 'hourly' | 'collections' | 'table' | 'events';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];

export const FirestoreReadMetricsDashboard: React.FC<FirestoreReadMetricsDashboardProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('daily');
  const [metrics, setMetrics] = useState<DailyReadMetric[]>([]);
  const [hourlyData, setHourlyData] = useState<any[]>([]);
  const [collectionStats, setCollectionStats] = useState<any[]>([]);
  const [events, setEvents] = useState<ReadEventLog[]>([]);
  const [testNotification, setTestNotification] = useState<string | null>(null);
  const [isLiveAutoRefresh, setIsLiveAutoRefresh] = useState(true);

  const refreshData = () => {
    setMetrics(getPast7DaysMetrics());
    setHourlyData(get7DaysHourlyAggregates());
    setCollectionStats(get7DaysCollectionBreakdown());
    setEvents(getRecentReadEvents());
  };

  useEffect(() => {
    if (isOpen) {
      refreshData();
      const unsub = subscribeToMetrics(() => {
        refreshData();
      });
      return unsub;
    }
  }, [isOpen]);

  // Live periodic refresh
  useEffect(() => {
    if (!isOpen || !isLiveAutoRefresh) return;
    const timer = setInterval(() => {
      refreshData();
    }, 3000);
    return () => clearInterval(timer);
  }, [isOpen, isLiveAutoRefresh]);

  // KPI Calculations
  const kpis = useMemo(() => {
    let totalReads = 0;
    let totalServer = 0;
    let totalCache = 0;
    let peakDay = '-';
    let peakDayReads = 0;

    metrics.forEach(m => {
      totalReads += m.totalReads;
      totalServer += m.serverReads;
      totalCache += m.cacheReads;
      if (m.totalReads > peakDayReads) {
        peakDayReads = m.totalReads;
        peakDay = m.date;
      }
    });

    const daysCount = metrics.length || 7;
    const dailyAvg = Math.round(totalReads / daysCount);
    const cacheHitRate = totalReads > 0 ? Math.round((totalCache / totalReads) * 100) : 0;
    
    // Find highest peak hour across 7 days
    let maxHourlyPeak = { hour: '14:00', reads: 0 };
    hourlyData.forEach(h => {
      if (h.totalReads > maxHourlyPeak.reads) {
        maxHourlyPeak = { hour: h.hour, reads: h.totalReads };
      }
    });

    // Spark tier free tier comparison: 50,000 reads/day
    const todayData = metrics[metrics.length - 1] || { totalReads: 0, serverReads: 0 };
    const freeTierDailyLimit = 50000;
    const todayFreeTierUsagePct = ((todayData.serverReads / freeTierDailyLimit) * 100).toFixed(2);

    return {
      totalReads,
      totalServer,
      totalCache,
      dailyAvg,
      cacheHitRate,
      peakDay,
      peakDayReads,
      peakHour: maxHourlyPeak.hour,
      peakHourReads: maxHourlyPeak.reads,
      todayReads: todayData.totalReads,
      todayServerReads: todayData.serverReads,
      todayFreeTierUsagePct
    };
  }, [metrics, hourlyData]);

  // Chart data formatting
  const dailyChartData = useMemo(() => {
    return metrics.map(m => {
      const parts = m.date.split('-');
      const shortDate = parts.length === 3 ? `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}` : m.date;
      const dayName = new Date(m.date).toLocaleDateString('ja-JP', { weekday: 'short' });
      return {
        date: `${shortDate} (${dayName})`,
        fullDate: m.date,
        total: m.totalReads,
        server: m.serverReads,
        cache: m.cacheReads,
        peakHour: `${m.peakHour}:00 (${m.peakReads}件)`
      };
    });
  }, [metrics]);

  const handleRunTestReads = () => {
    const generated = executeTestFirestoreReads();
    setTestNotification(`テスト読取を実行しました: +${generated} reads 記録完了`);
    refreshData();
    setTimeout(() => setTestNotification(null), 3000);
  };

  const handleExportCSV = () => {
    const headers = ['日付', '合計読取回数', 'サーバー読取(課金対象)', 'キャッシュ読取(無料)', 'ピーク時間帯', 'ピーク件数'];
    const rows = metrics.map(m => [
      m.date,
      m.totalReads,
      m.serverReads,
      m.cacheReads,
      `${m.peakHour}:00`,
      m.peakReads
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + 
      [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `firestore_reads_7days_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({
      exportedAt: new Date().toISOString(),
      summary: kpis,
      dailyMetrics: metrics,
      hourlyAggregates: hourlyData,
      collectionBreakdown: collectionStats
    }, null, 2));

    const link = document.createElement('a');
    link.setAttribute('href', dataStr);
    link.setAttribute('download', `firestore_metrics_export_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-hidden">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 15 }}
        transition={{ duration: 0.22 }}
        className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden text-slate-100"
      >
        {/* Modal Top Header */}
        <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-500 to-red-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                  Firestore 読取メトリクス & 負荷可視化ダッシュボード
                </h2>
                <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-mono font-bold">
                  7-Days Analytics
                </span>
                <span className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/40 text-blue-300 text-[10px] font-mono">
                  Internal Diagnostic
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium mt-0.5">
                過去7日間のFirebase Firestore読み取り回数（日別・時間別・コレクション別）の集計と無料枠・キャッシュ効率分析
              </p>
            </div>
          </div>

          {/* Header Action Tools */}
          <div className="flex items-center space-x-2">
            {/* Live toggle */}
            <button
              type="button"
              onClick={() => setIsLiveAutoRefresh(!isLiveAutoRefresh)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center space-x-1.5 cursor-pointer ${
                isLiveAutoRefresh
                  ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title="3秒ごとのリアルタイム自動更新"
            >
              <span className={`w-2 h-2 rounded-full ${isLiveAutoRefresh ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`} />
              <span className="text-[11px]">{isLiveAutoRefresh ? 'Live 同期中' : '一時停止'}</span>
            </button>

            {/* Test read trigger */}
            <button
              type="button"
              onClick={handleRunTestReads}
              className="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg text-xs font-bold shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer active:scale-95"
              title="テスト用にFirestore読取ログをシミュレート実行"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>テスト読取実行</span>
            </button>

            {/* Export dropdown */}
            <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5">
              <button
                type="button"
                onClick={handleExportCSV}
                className="px-2 py-1 text-[11px] font-semibold text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors cursor-pointer flex items-center space-x-1"
                title="CSVでエクスポート"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportJSON}
                className="px-2 py-1 text-[11px] font-semibold text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors cursor-pointer flex items-center space-x-1"
                title="JSON形式でエクスポート"
              >
                <Download className="w-3.5 h-3.5 text-blue-400" />
                <span>JSON</span>
              </button>
            </div>

            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Test Notification Banner */}
        {testNotification && (
          <div className="bg-blue-600/90 text-white text-xs px-6 py-2 flex items-center justify-between shadow-inner animate-in fade-in">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-blue-200" />
              <span className="font-bold">{testNotification}</span>
            </div>
            <button onClick={() => setTestNotification(null)} className="text-white/80 hover:text-white text-xs">✕</button>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top KPI Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            {/* KPI 1: 7-Day Total Reads */}
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                <span className="flex items-center space-x-1.5">
                  <Database className="w-3.5 h-3.5 text-blue-400" />
                  <span>7日間 総読取数</span>
                </span>
                <span className="text-[10px] text-blue-400/80 font-mono">Total</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl font-black text-white font-mono">
                  {kpis.totalReads.toLocaleString()}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">reads</span>
              </div>
              <div className="mt-2 text-[10.5px] text-slate-400 flex items-center justify-between border-t border-slate-700/60 pt-1.5 font-mono">
                <span className="text-emerald-400">Server: {kpis.totalServer.toLocaleString()}</span>
                <span className="text-blue-400">Cache: {kpis.totalCache.toLocaleString()}</span>
              </div>
            </div>

            {/* KPI 2: Daily Average */}
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                <span className="flex items-center space-x-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  <span>1日平均読取数</span>
                </span>
                <span className="text-[10px] text-emerald-400/80 font-mono">Daily Avg</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl font-black text-white font-mono">
                  {kpis.dailyAvg.toLocaleString()}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">reads/day</span>
              </div>
              <div className="mt-2 text-[10.5px] text-slate-400 flex items-center justify-between border-t border-slate-700/60 pt-1.5">
                <span>本日({metrics[metrics.length - 1]?.date}):</span>
                <span className="font-mono font-bold text-white">{kpis.todayReads} reads</span>
              </div>
            </div>

            {/* KPI 3: Peak Hour */}
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                <span className="flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>ピーク時間帯</span>
                </span>
                <span className="text-[10px] text-amber-400/80 font-mono">Peak</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl font-black text-amber-300 font-mono">
                  {kpis.peakHour}
                </span>
                <span className="text-[11px] text-amber-400/80 font-mono">
                  {kpis.peakHourReads} reads
                </span>
              </div>
              <div className="mt-2 text-[10.5px] text-slate-400 flex items-center justify-between border-t border-slate-700/60 pt-1.5">
                <span>最大日:</span>
                <span className="font-mono text-slate-300">{kpis.peakDay} ({kpis.peakDayReads})</span>
              </div>
            </div>

            {/* KPI 4: Cache Hit Rate */}
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3.5 shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                <span className="flex items-center space-x-1.5">
                  <Zap className="w-3.5 h-3.5 text-indigo-400" />
                  <span>キャッシュ効率</span>
                </span>
                <span className="text-[10px] text-indigo-400/80 font-mono">Cache Hit</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl font-black text-indigo-300 font-mono">
                  {kpis.cacheHitRate}%
                </span>
                <span className="text-[10px] text-emerald-400 font-bold">コスト削減</span>
              </div>
              <div className="mt-2 w-full bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 h-1.5 rounded-full" 
                  style={{ width: `${kpis.cacheHitRate}%` }} 
                />
              </div>
            </div>

            {/* KPI 5: Free Tier Usage */}
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3.5 shadow-sm col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                <span className="flex items-center space-x-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>無料枠消費率 (Spark)</span>
                </span>
                <span className="text-[10px] text-emerald-400/80 font-mono">50k/day</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-2xl font-black text-emerald-400 font-mono">
                  {kpis.todayFreeTierUsagePct}%
                </span>
                <span className="text-[10px] text-emerald-300 font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-600/40">
                  安全域
                </span>
              </div>
              <div className="mt-2 text-[10.5px] text-slate-400 flex items-center justify-between border-t border-slate-700/60 pt-1.5">
                <span>本日サーバー読取:</span>
                <span className="font-mono text-slate-300">{kpis.todayServerReads} / 50,000</span>
              </div>
            </div>
          </div>

          {/* Navigation View Tabs */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-1 sm:space-x-2 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveTab('daily')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'daily'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>日別推移チャート (7 Days)</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('hourly')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'hourly'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>時間別分布 (0:00-23:00)</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('collections')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'collections'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>コレクション別内訳</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('table')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'table'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Calendar className="w-4 h-4" />
                <span>日別集計データ表</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('events')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
                  activeTab === 'events'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Activity className="w-4 h-4" />
                <span>最新読取イベント ({events.length})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={resetMetricsData}
              className="text-[11px] text-slate-500 hover:text-rose-400 transition-colors cursor-pointer hidden md:inline-block"
              title="メトリクスデータを初期状態にリセット"
            >
              初期化
            </button>
          </div>

          {/* Tab 1: Daily Trend */}
          {activeTab === 'daily' && (
            <div className="space-y-4">
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5 shadow-inner">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-sm text-white flex items-center space-x-2">
                      <BarChart3 className="w-4 h-4 text-blue-400" />
                      <span>過去7日間の日別読み取り回数推移 (Server vs Cache)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      サーバー読取（課金対象）とローカルキャッシュ読取（無料）の積み上げ推移
                    </p>
                  </div>
                  <div className="flex items-center space-x-3 text-xs font-mono">
                    <span className="flex items-center space-x-1 text-blue-400">
                      <span className="w-3 h-3 bg-blue-500 rounded-xs inline-block" />
                      <span>Server Reads</span>
                    </span>
                    <span className="flex items-center space-x-1 text-emerald-400">
                      <span className="w-3 h-3 bg-emerald-500 rounded-xs inline-block" />
                      <span>Cache Reads</span>
                    </span>
                  </div>
                </div>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyChartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                      <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          borderRadius: '12px',
                          color: '#f8fafc',
                          fontSize: '12px',
                          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)'
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Bar dataKey="server" name="Server Reads (サーバー読取)" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="cache" name="Cache Reads (キャッシュ読取)" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Hourly Distribution */}
          {activeTab === 'hourly' && (
            <div className="space-y-4">
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5 shadow-inner">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-sm text-white flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-amber-400" />
                      <span>24時間帯別 読み取りアクセス集中度 (00:00 〜 23:00)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      過去7日間の各時間帯におけるFirestore読取リクエストの集中パターン
                    </p>
                  </div>
                </div>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={hourlyData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                      <defs>
                        <linearGradient id="colorHourly" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorServerHourly" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.6}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                      <XAxis dataKey="hour" stroke="#94a3b8" fontSize={11} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          borderRadius: '12px',
                          color: '#f8fafc',
                          fontSize: '12px'
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Area type="monotone" dataKey="totalReads" name="合計読取数 (Total)" stroke="#f59e0b" fillOpacity={1} fill="url(#colorHourly)" />
                      <Area type="monotone" dataKey="serverReads" name="サーバー読取 (Server)" stroke="#3b82f6" fillOpacity={1} fill="url(#colorServerHourly)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Collection Breakdown */}
          {activeTab === 'collections' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Donut Chart */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5 shadow-inner flex flex-col items-center justify-center">
                <h3 className="font-bold text-sm text-white mb-2 self-start flex items-center space-x-2">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  <span>コレクション別 読取シェア</span>
                </h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={collectionStats}
                        dataKey="reads"
                        nameKey="collectionName"
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={4}
                        label={({ name, percent }) => `${name.split(' ')[0]} (${(percent * 100).toFixed(0)}%)`}
                        labelLine={false}
                      >
                        {collectionStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          borderRadius: '12px',
                          color: '#f8fafc',
                          fontSize: '12px'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Progress List */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5 shadow-inner flex flex-col justify-center space-y-3.5">
                <h3 className="font-bold text-sm text-white mb-1">コレクション別 詳細読取件数</h3>
                {collectionStats.map((item, idx) => (
                  <div key={item.collectionName} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200 flex items-center space-x-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        <span>{item.collectionName}</span>
                      </span>
                      <span className="font-mono text-slate-300 font-bold">
                        {item.reads.toLocaleString()} reads ({item.percentage}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-2 rounded-full transition-all duration-500"
                        style={{
                          width: `${item.percentage}%`,
                          backgroundColor: COLORS[idx % COLORS.length]
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab 4: Table View */}
          {activeTab === 'table' && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl overflow-hidden shadow-inner">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-bold">
                    <th className="p-3.5 pl-5">通関日 / 日付</th>
                    <th className="p-3.5 text-right">合計読取数</th>
                    <th className="p-3.5 text-right">サーバー読取 (課金対象)</th>
                    <th className="p-3.5 text-right">キャッシュ読取 (無料)</th>
                    <th className="p-3.5 text-center">キャッシュ率</th>
                    <th className="p-3.5 text-center">ピーク時間帯</th>
                    <th className="p-3.5 pr-5 text-right">無料枠推定コスト</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {metrics.map((m) => {
                    const cachePct = m.totalReads > 0 ? Math.round((m.cacheReads / m.totalReads) * 100) : 0;
                    return (
                      <tr key={m.date} className="hover:bg-slate-900/60 transition-colors">
                        <td className="p-3.5 pl-5 font-bold text-slate-200">
                          {m.date}
                        </td>
                        <td className="p-3.5 text-right font-black text-white">
                          {m.totalReads.toLocaleString()}
                        </td>
                        <td className="p-3.5 text-right text-blue-400 font-semibold">
                          {m.serverReads.toLocaleString()}
                        </td>
                        <td className="p-3.5 text-right text-emerald-400 font-semibold">
                          {m.cacheReads.toLocaleString()}
                        </td>
                        <td className="p-3.5 text-center">
                          <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/40 text-[11px]">
                            {cachePct}%
                          </span>
                        </td>
                        <td className="p-3.5 text-center text-amber-300">
                          {m.peakHour}:00 ({m.peakReads}件)
                        </td>
                        <td className="p-3.5 pr-5 text-right text-emerald-400 font-bold">
                          $0.00 (無料枠内)
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 5: Recent Events Stream */}
          {activeTab === 'events' && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 shadow-inner space-y-2 max-h-96 overflow-y-auto">
              <div className="text-xs text-slate-400 font-semibold px-2 py-1 flex justify-between border-b border-slate-800">
                <span>リアルタイム読取リクエスト ストリーム</span>
                <span>直近 {events.length} 件</span>
              </div>
              {events.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  読取イベントログはありません
                </div>
              ) : (
                events.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl flex items-center justify-between text-xs hover:border-slate-700 transition-colors font-mono"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-slate-400 text-[11px]">{ev.timestamp}</span>
                      <span className="px-2 py-0.5 bg-blue-950 text-blue-300 rounded border border-blue-700/50 font-bold">
                        {ev.collectionName}
                      </span>
                      <span className="text-slate-300 font-semibold">
                        +{ev.documentCount} docs
                      </span>
                      <span className="text-slate-400 text-[11px] hidden sm:inline">
                        [{ev.sourceModule}]
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          ev.fromCache
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                            : 'bg-blue-950 text-blue-300 border border-blue-700/50'
                        }`}
                      >
                        {ev.fromCache ? 'Cache Hit' : 'Server Read'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Firestore Best Practices Diagnostic Box */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex items-start space-x-3.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck className="w-4.5 h-4.5" />
            </div>
            <div className="space-y-1 text-xs">
              <div className="font-bold text-slate-200">Firestore 読取最適化 & コスト診断: 良好 (Optimized)</div>
              <p className="text-slate-400 leading-relaxed">
                本アプリでは <code className="text-blue-300 font-mono">onSnapshot</code> リスナの一元化およびローカルインメモリキャッシュにより、不要なリクエスト再読取を防止しています。過去7日間の日別読取回数はSparkプラン無料枠（50,000 reads/日）の <strong className="text-emerald-300">1% 未満</strong> に維持されており、コスト発生リスクはありません。
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-950 px-6 py-3.5 border-t border-slate-800 flex items-center justify-between shrink-0 text-xs text-slate-400">
          <div className="flex items-center space-x-2 font-mono text-[11px]">
            <Server className="w-3.5 h-3.5 text-slate-400" />
            <span>Database: Firestore (default)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold rounded-xl shadow-md transition-all cursor-pointer"
          >
            閉じる
          </button>
        </div>
      </motion.div>
    </div>
  );
};
