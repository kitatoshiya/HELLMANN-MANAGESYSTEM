import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { Shipment, Task, TaskStatus, StatusFilterType } from '../types';
import {
  getShipments,
  subscribeToStore,
  updateTaskStatus,
  togglePinShipment,
} from '../lib/storageManager';
import { exportShipmentsToExcel } from '../lib/excelExportService';
import { GanttChartView } from './GanttChartView';
import { PdfZoomModal } from './PdfZoomModal';
import { ShipmentDetail } from './ShipmentDetail';
import {
  BarChart2,
  LayoutGrid,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Search,
  CheckCircle2,
  Clock,
  Circle,
  FileSpreadsheet,
  Download,
  ChevronsUp,
  ChevronsDown,
  Pin,
  MessageSquareText,
  Plane,
  Package,
  Zap,
  Star,
  Flame,
  ZoomIn,
  Maximize2,
  Minimize2,
  X,
  Layers,
  ArrowLeft,
  Sparkles,
  Check,
} from 'lucide-react';

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

function normalizeDateStr(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/\//g, '-').trim();
  const parts = cleaned.split('-');
  if (parts.length === 3) {
    const year = parts[0].padStart(4, '20');
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

function formatDateToKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const StandaloneTaskView: React.FC = () => {
  const [shipments, setShipments] = useState<Shipment[]>(() => getShipments());

  // URL search params
  const searchParams = useMemo(() => {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);

  const today = new Date();
  const todayKey = formatDateToKey(today);

  const initialDate = searchParams.get('date') || todayKey;
  const initialMode = (searchParams.get('mode') as 'gantt' | 'cards') || 'gantt';
  const initialFilter = (searchParams.get('filter') as StatusFilterType) || 'ALL';
  const initialSearch = searchParams.get('search') || '';

  const [selectedDateKey, setSelectedDateKey] = useState<string>(initialDate);
  const [viewMode, setViewMode] = useState<'gantt' | 'cards'>(initialMode);
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>(initialFilter);
  const [searchTerm, setSearchTerm] = useState<string>(initialSearch);

  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [zoomShipment, setZoomShipment] = useState<Shipment | null>(null);
  const [detailShipment, setDetailShipment] = useState<Shipment | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  const [animatingTask, setAnimatingTask] = useState<{ id: string; type: 'complete' | 'deflate' } | null>(null);

  // Subscribe to reactive store
  useEffect(() => {
    const unsubscribe = subscribeToStore(() => {
      const updated = getShipments();
      setShipments(updated);
      setLastSyncTime(new Date());
    });
    return () => unsubscribe();
  }, []);

  // Sync state to URL without reloading
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('view', 'tasks-standalone');
    params.set('date', selectedDateKey);
    params.set('mode', viewMode);
    params.set('filter', statusFilter);
    if (searchTerm) {
      params.set('search', searchTerm);
    } else {
      params.delete('search');
    }
    const newRelativePathQuery = window.location.pathname + '?' + params.toString();
    window.history.replaceState(null, '', newRelativePathQuery);
  }, [selectedDateKey, viewMode, statusFilter, searchTerm]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Date manipulation
  const parseCurrentDate = (key: string): Date => {
    const parts = key.split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    return new Date();
  };

  const handlePrevDay = () => {
    const d = parseCurrentDate(selectedDateKey);
    d.setDate(d.getDate() - 1);
    setSelectedDateKey(formatDateToKey(d));
  };

  const handleNextDay = () => {
    const d = parseCurrentDate(selectedDateKey);
    d.setDate(d.getDate() + 1);
    setSelectedDateKey(formatDateToKey(d));
  };

  const handleToday = () => {
    setSelectedDateKey(todayKey);
  };

  const getSelectedDateLabel = (): string => {
    const d = parseCurrentDate(selectedDateKey);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const weekday = WEEKDAYS_JA[d.getDay()];
    return `${y}年${m}月${day}日 (${weekday})`;
  };

  // Group shipments by customs clearance date
  const shipmentsByDateKey = useMemo(() => {
    const map: Record<string, Shipment[]> = {};
    shipments.forEach((s) => {
      const key = normalizeDateStr(s.customsClearanceDate);
      if (key) {
        if (!map[key]) map[key] = [];
        map[key].push(s);
      }
    });
    return map;
  }, [shipments]);

  // Selected date raw shipments
  const rawDateShipments = shipmentsByDateKey[selectedDateKey] || [];

  // Metrics
  const totalCount = rawDateShipments.length;
  const todoCount = rawDateShipments.filter((s) => s.status === 'Todo').length;
  const inProgressCount = rawDateShipments.filter((s) => s.status === 'In Progress').length;
  const uncompletedCount = todoCount + inProgressCount;
  const completedCount = rawDateShipments.filter((s) => s.status === 'Completed').length;

  // Sorted shipments (Pinned first, then priority)
  const sortedDateShipments = useMemo(() => {
    return [...rawDateShipments].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      const getPriorityScore = (s: Shipment) => {
        let score = 0;
        if (s.isUrgent) score += 20;
        if (s.isImportant) score += 10;
        if (s.isDgCargo) score += 1;
        return score;
      };
      return getPriorityScore(b) - getPriorityScore(a);
    });
  }, [rawDateShipments]);

  // Filtered displayed shipments
  const displayedShipments = useMemo(() => {
    return sortedDateShipments.filter((s) => {
      // 1. Text Search Filter
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matchId = s.id.toLowerCase().includes(q);
        const matchMawb = (s.mawbNumber || '').toLowerCase().includes(q);
        const matchHawb = (s.hawbNumber || '').toLowerCase().includes(q);
        const matchShipper = (s.shipper || '').toLowerCase().includes(q);
        const matchConsignee = (s.consignee || '').toLowerCase().includes(q);
        const matchDestination = (s.destination || '').toLowerCase().includes(q);
        const matchFlight = (s.flightRoute || '').toLowerCase().includes(q);
        const matchOrder = (s.orderNumber || '').toLowerCase().includes(q);
        const matchInvoice = (s.invoiceNumber || '').toLowerCase().includes(q);

        if (
          !matchId &&
          !matchMawb &&
          !matchHawb &&
          !matchShipper &&
          !matchConsignee &&
          !matchDestination &&
          !matchFlight &&
          !matchOrder &&
          !matchInvoice
        ) {
          return false;
        }
      }

      // 2. Status Filter
      if (statusFilter === 'UNCOMPLETED') {
        return s.status !== 'Completed';
      }
      if (statusFilter === 'Todo') {
        return s.status === 'Todo';
      }
      if (statusFilter === 'In Progress') {
        return s.status === 'In Progress' || s.tasks.some((t) => t.status === 'In Progress');
      }
      if (statusFilter === 'Completed') {
        return s.status === 'Completed';
      }
      return true;
    });
  }, [sortedDateShipments, searchTerm, statusFilter]);

  // Card collapse controls
  const handleCollapseAll = () => {
    const newMap: Record<string, boolean> = {};
    shipments.forEach((s) => {
      newMap[s.id] = true;
    });
    setCollapsedMap(newMap);
  };

  const handleExpandAll = () => {
    const newMap: Record<string, boolean> = {};
    shipments.forEach((s) => {
      newMap[s.id] = false;
    });
    setCollapsedMap(newMap);
  };

  const handleCollapseCompleted = () => {
    const newMap: Record<string, boolean> = {};
    shipments.forEach((s) => {
      const isCompleted =
        s.status === 'Completed' || (s.tasks.length > 0 && s.tasks.every((t) => t.status === 'Completed'));
      newMap[s.id] = isCompleted;
    });
    setCollapsedMap(newMap);
  };

  const toggleCollapse = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedMap((prev) => {
      const current = prev[id] !== false;
      return { ...prev, [id]: !current };
    });
  };

  // Excel Export
  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      await exportShipmentsToExcel(getSelectedDateLabel(), selectedDateKey, sortedDateShipments);
    } catch (err) {
      console.error('Excel Export Error:', err);
      alert('Excelファイルの出力中にエラーが発生しました。');
    } finally {
      setIsExporting(false);
    }
  };

  // Handle task status toggle in card view
  const handleTaskStatusToggle = (e: React.MouseEvent, shipmentId: string, task: Task) => {
    e.stopPropagation();
    const isNowCompleting = task.status !== 'Completed';
    const nextStatus: TaskStatus = isNowCompleting ? 'Completed' : 'Todo';
    const taskKey = `${shipmentId}-${task.id}`;

    if (isNowCompleting) {
      setAnimatingTask({ id: taskKey, type: 'complete' });
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (rect.left + rect.width / 2) / window.innerWidth;
      const y = (rect.top + rect.height / 2) / window.innerHeight;

      try {
        confetti({
          particleCount: 50,
          spread: 70,
          origin: { x, y },
          colors: ['#10B981', '#34D399', '#059669', '#F59E0B', '#3B82F6', '#EC4899'],
          ticks: 200,
          gravity: 1.1,
          scalar: 1.0,
          shapes: ['circle', 'square'],
        });

        setTimeout(() => {
          confetti({
            particleCount: 25,
            angle: 90,
            spread: 90,
            origin: { x, y: Math.max(0, y - 0.04) },
            colors: ['#34D399', '#FBBF24', '#F43F5E', '#A7F3D0'],
            ticks: 170,
            gravity: 1.2,
            scalar: 1.2,
          });
        }, 90);
      } catch {
        // ignore
      }

      setTimeout(() => {
        setAnimatingTask(null);
      }, 950);
    }

    updateTaskStatus(shipmentId, task.id, nextStatus);
  };

  // Return to main dashboard
  const handleReturnToMain = () => {
    if (window.opener && !window.opener.closed) {
      window.close();
    } else {
      window.location.href = window.location.origin + window.location.pathname;
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans antialiased flex flex-col selection:bg-blue-500 selection:text-white">
      {/* Top Standalone Header Bar (Light Mode) */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs px-4 sm:px-6 py-2.5 shrink-0">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 max-w-[2400px] mx-auto">
          {/* Left: Branding & Date Navigator */}
          <div className="flex items-center space-x-3 flex-wrap gap-y-2">
            <div className="flex items-center space-x-2 shrink-0">
              <button
                type="button"
                onClick={handleReturnToMain}
                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 rounded-xl border border-slate-200 transition-all cursor-pointer shadow-2xs"
                title="メインダッシュボード画面へ戻る / タブを閉じる"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-sm font-black tracking-tight text-slate-900 flex items-center gap-1.5">
                    <span>輸出通関・作業進捗タスクモニター</span>
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold rounded-md font-mono">
                      全画面モニター表示
                    </span>
                  </h1>
                </div>
                <div className="flex items-center space-x-2 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1 text-emerald-600 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    リアルタイム同期中
                  </span>
                  <span>•</span>
                  <span>最終更新: {lastSyncTime.toLocaleTimeString('ja-JP')}</span>
                </div>
              </div>
            </div>

            <div className="h-6 w-px bg-slate-200 hidden sm:block" />

            {/* Date Navigator Bar */}
            <div className="flex items-center space-x-1.5 bg-slate-100 border border-slate-200 p-1 rounded-xl shadow-2xs">
              <button
                type="button"
                onClick={handlePrevDay}
                className="px-2 py-1 bg-white hover:bg-slate-50 active:scale-95 text-slate-700 text-xs font-bold rounded-lg transition-all flex items-center space-x-0.5 cursor-pointer border border-slate-200 shadow-2xs"
                title="前日へ移動"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>前日</span>
              </button>

              <button
                type="button"
                onClick={handleToday}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer border ${
                  selectedDateKey === todayKey
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200 shadow-2xs'
                }`}
                title="本日を選択"
              >
                本日
              </button>

              <button
                type="button"
                onClick={handleNextDay}
                className="px-2 py-1 bg-white hover:bg-slate-50 active:scale-95 text-slate-700 text-xs font-bold rounded-lg transition-all flex items-center space-x-0.5 cursor-pointer border border-slate-200 shadow-2xs"
                title="翌日へ移動"
              >
                <span>翌日</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              <input
                type="date"
                value={selectedDateKey}
                onChange={(e) => e.target.value && setSelectedDateKey(e.target.value)}
                className="bg-white border border-slate-300 rounded-lg px-2 py-0.5 text-xs text-slate-800 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs"
                title="日付を選択"
              />

              <div className="px-2.5 py-0.5 bg-blue-50/90 rounded-lg border border-blue-200 text-xs font-black text-blue-900 tracking-tight">
                {getSelectedDateLabel()}
              </div>
            </div>
          </div>

          {/* Right: Search, Filter, Mode Switcher, Excel, Fullscreen */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-2 justify-between lg:justify-end">
            {/* Search Input */}
            <div className="relative w-full sm:w-56 lg:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="向け地、MAWB、CONSIGNEE..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-7 py-1 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Status Filter Toggle */}
            <div className="flex items-center bg-slate-100 p-0.5 border border-slate-200 rounded-lg text-xs shrink-0">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-white text-slate-900 shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                すべて ({totalCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('UNCOMPLETED')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  statusFilter === 'UNCOMPLETED'
                    ? 'bg-amber-500 text-white shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                進行中のみ ({uncompletedCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('Completed')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  statusFilter === 'Completed'
                    ? 'bg-emerald-600 text-white shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                完了 ({completedCount})
              </button>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center space-x-0.5 bg-slate-100 p-0.5 border border-slate-200 rounded-lg shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('gantt')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center space-x-1 cursor-pointer ${
                  viewMode === 'gantt'
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BarChart2 className="w-3.5 h-3.5" />
                <span>ガントチャート</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center space-x-1 cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>カード表示</span>
              </button>
            </div>

            {/* Excel Download Button */}
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={isExporting || sortedDateShipments.length === 0}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all shadow-2xs flex items-center space-x-1 border cursor-pointer shrink-0 ${
                sortedDateShipments.length === 0
                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white border-emerald-500 shadow-2xs'
              }`}
              title="選択された通関日の出荷一覧情報をExcelファイル(.xlsx)で出力します"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-100" />
              <span>{isExporting ? '出力中...' : '輸出一覧EXCEL'}</span>
              <Download className="w-3 h-3 text-emerald-100 ml-0.5" />
            </button>

            {/* Card view collapse buttons */}
            {viewMode === 'cards' && (
              <div className="flex items-center space-x-0.5 bg-slate-100 p-0.5 border border-slate-200 rounded-lg shrink-0">
                <button
                  type="button"
                  onClick={handleCollapseAll}
                  className="px-2 py-1 text-[11px] font-bold text-slate-700 hover:text-slate-900 hover:bg-white rounded-md transition-all flex items-center space-x-0.5 cursor-pointer shadow-2xs"
                  title="すべての案件カードを折りたたみます"
                >
                  <ChevronsUp className="w-3 h-3 text-slate-600" />
                  <span>全て折りたたむ</span>
                </button>
                <button
                  type="button"
                  onClick={handleExpandAll}
                  className="px-2 py-1 text-[11px] font-bold text-slate-700 hover:text-slate-900 hover:bg-white rounded-md transition-all flex items-center space-x-0.5 cursor-pointer shadow-2xs"
                  title="すべての案件カードを展開表示します"
                >
                  <ChevronsDown className="w-3 h-3 text-slate-600" />
                  <span>全て展開する</span>
                </button>
                <button
                  type="button"
                  onClick={handleCollapseCompleted}
                  className="px-2 py-1 text-[11px] font-bold text-emerald-800 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100/90 border border-emerald-200 rounded-md transition-all flex items-center space-x-0.5 cursor-pointer shadow-2xs"
                  title="完了済みの案件のみを折りたたんで表示します"
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  <span>完了済を折りたたむ</span>
                </button>
              </div>
            )}

            {/* Fullscreen Button */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1.5 bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 rounded-lg border border-slate-200 transition-all cursor-pointer shrink-0 shadow-2xs"
              title={isFullscreen ? '全画面表示を解除' : 'ブラウザ全画面表示 (F11同等)'}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Full-Screen Task Content Body */}
      <main className="flex-1 w-full max-w-[2400px] mx-auto p-4 sm:p-6 lg:p-8 space-y-4">
        {/* Cut Time Alert Banner (ガントチャート表示 & カード表示共通) */}
        {displayedShipments.some((s) => !!s.cutTime) && (
          <div className="bg-gradient-to-r from-rose-900 via-rose-800 to-slate-900 border-2 border-rose-500 rounded-2xl p-4 text-white shadow-md flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-rose-600 rounded-xl text-white shadow-sm animate-pulse shrink-0">
                <Clock className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-[11px] font-black uppercase text-rose-300 tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping inline-block"></span>
                  選択日 ({getSelectedDateLabel()}) カット時間 (CUT TIME) 指定案件
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {displayedShipments
                    .filter((s) => !!s.cutTime)
                    .map((s) => (
                      <span
                        key={s.id}
                        onClick={() => setZoomShipment(s)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/10 hover:bg-white/20 border border-rose-400/60 rounded-xl text-xs font-bold text-white transition-colors cursor-pointer"
                        title="クリックしてSI指示書PDFを表示"
                      >
                        <span className="font-mono text-rose-200">{s.id}:</span>
                        <span className="font-mono font-extrabold text-amber-300 text-sm">⏰ {s.cutTime}</span>
                        <span className="text-[10px] text-rose-200">({s.shipper})</span>
                      </span>
                    ))}
                </div>
              </div>
            </div>
            <span className="px-3 py-1 bg-rose-600 text-white font-bold text-xs rounded-xl border border-rose-400/80 shadow-2xs flex items-center gap-1.5 shrink-0">
              <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
              カット時間注意
            </span>
          </div>
        )}

        {/* Dynamic Task Content: Gantt View vs Cards Grid */}
        {viewMode === 'gantt' ? (
          <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-xs overflow-hidden">
            <GanttChartView
              shipments={displayedShipments}
              dateLabel={getSelectedDateLabel()}
              dateKey={selectedDateKey}
              onSelectShipment={(s) => setDetailShipment(s)}
            />
          </div>
        ) : displayedShipments.length === 0 ? (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-3xl p-16 text-center shadow-xs">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3 border border-slate-200">
              <Calendar className="w-7 h-7" />
            </div>
            <h3 className="text-sm font-bold text-slate-700">
              選択された条件 (通関日: {getSelectedDateLabel()}) に該当する案件はありません
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              日付を変更するか、検索フィルター（すべて、進行中のみ、完了）を変更してください。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {displayedShipments.map((shipment, idx) => {
              const completedTasks = shipment.tasks.filter((t) => t.status === 'Completed').length;
              const totalTasks = shipment.tasks.length;
              const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
              const isCollapsed = collapsedMap[shipment.id] !== false;

              // Comments / Memo
              const memoCount = shipment.comments?.length || 0;
              const hasImportantMemo = shipment.comments?.some((c) => c.isImportant);
              const latestComment = memoCount > 0 ? shipment.comments![0] : null;
              const memoTooltip =
                memoCount > 0
                  ? `【ユーザー登録メモ (${memoCount}件)${hasImportantMemo ? ' ★重要メモあり' : ''}】\n最新 (${latestComment?.formattedTime || ''}):\n${latestComment?.authorName ? `[${latestComment.authorName}] ` : ''}${latestComment?.content || ''}`
                  : '';

              return (
                <motion.div
                  key={shipment.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.04 }}
                  className={`rounded-3xl border transition-all p-3.5 flex flex-col justify-between space-y-2.5 shadow-xs hover:shadow-md ${
                    shipment.isPinned
                      ? 'border-blue-500 ring-2 ring-blue-400/50 bg-blue-50/20 shadow-md'
                      : shipment.isUrgent
                      ? 'border-rose-400 bg-rose-50/20 shadow-md hover:border-rose-500'
                      : shipment.isImportant
                      ? 'border-amber-400 bg-amber-50/20 shadow-md hover:border-amber-500'
                      : 'border-slate-200 bg-white hover:border-blue-300'
                  }`}
                >
                  {/* Header Meta */}
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                        {shipment.isPinned && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg bg-blue-600 text-white shadow-xs flex items-center space-x-1">
                            <Pin className="w-3 h-3 fill-current text-blue-100 rotate-45" />
                            <span>📌 固定中</span>
                          </span>
                        )}

                        <span className="px-2.5 py-0.5 text-xs sm:text-[13px] font-black tracking-tight rounded-md bg-blue-950 text-white border border-blue-800 uppercase font-mono shadow-2xs">
                          {shipment.id}
                        </span>

                        {memoCount > 0 && (
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-lg border shadow-2xs flex items-center space-x-1 transition-colors ${
                              hasImportantMemo
                                ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700 shadow-xs ring-2 ring-rose-300 font-extrabold animate-pulse'
                                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                            }`}
                            title={memoTooltip}
                          >
                            <MessageSquareText
                              className={`w-3 h-3 shrink-0 ${hasImportantMemo ? 'text-white' : 'text-indigo-600'}`}
                            />
                            <span>{hasImportantMemo ? `🔴 重要メモ ${memoCount}件` : `メモ ${memoCount}件`}</span>
                          </span>
                        )}
                      </div>
                      <h4
                        className="text-xs sm:text-[13px] font-black text-slate-900 mt-1 truncate max-w-[220px] leading-tight"
                        title={shipment.shipper}
                      >
                        {shipment.shipper}
                      </h4>
                      <p
                        className="text-[11.5px] sm:text-[12px] font-bold text-slate-700 truncate leading-tight mt-0.5"
                        title={shipment.consignee}
                      >
                        ↳ CNEE: <span className="font-semibold text-slate-800">{shipment.consignee || '未設定'}</span>
                      </p>
                    </div>

                    <div className="flex items-center space-x-1 shrink-0">
                      {/* Pin Toggle */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePinShipment(shipment.id);
                        }}
                        className={`p-1.5 rounded-xl transition-all flex items-center gap-1 cursor-pointer border ${
                          shipment.isPinned
                            ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-2xs'
                            : 'text-slate-600 hover:text-blue-700 hover:bg-blue-50 border-slate-200 bg-slate-50/80'
                        }`}
                        title={shipment.isPinned ? 'ピン留め解除' : '最上部に固定ピン留め'}
                      >
                        <Pin
                          className={`w-3.5 h-3.5 ${shipment.isPinned ? 'fill-current rotate-45 text-white' : 'text-slate-500'}`}
                        />
                        <span className="text-[10px] font-bold">
                          {shipment.isPinned ? '固定中' : 'ピン留め'}
                        </span>
                      </button>

                      {/* Status pill */}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          shipment.status === 'Completed'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : shipment.status === 'In Progress'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {shipment.status === 'Completed'
                          ? '完了'
                          : shipment.status === 'In Progress'
                          ? '進行中'
                          : '未着手'}
                      </span>

                      {/* Fold/Unfold */}
                      <button
                        type="button"
                        onClick={(e) => toggleCollapse(shipment.id, e)}
                        className="p-1.5 text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-colors flex items-center gap-1 cursor-pointer border border-slate-200 bg-slate-50/80"
                        title={isCollapsed ? '展開表示する' : '折りたたむ'}
                      >
                        <span className="text-[10px] font-bold">{isCollapsed ? '展開' : '折りたたみ'}</span>
                        {isCollapsed ? (
                          <ChevronsDown className="w-3.5 h-3.5 text-blue-600" />
                        ) : (
                          <ChevronsUp className="w-3.5 h-3.5 text-slate-500" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Priority & Cargo Badges */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {shipment.cutTime && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-600 text-white flex items-center gap-1 shadow-2xs animate-pulse border border-rose-400">
                        <Clock className="w-3 h-3 text-white shrink-0" />
                        <span>⏰ CUT: {shipment.cutTime}</span>
                      </span>
                    )}

                    {(() => {
                      const prio =
                        shipment.priorityLevel ||
                        shipment.priority ||
                        (shipment.isUrgent ? 'High' : shipment.isImportant ? 'Medium' : 'Low');
                      if (prio === 'Low' || !prio) return null;
                      return (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            prio === 'High'
                              ? 'bg-rose-100 text-rose-800 border-rose-300'
                              : 'bg-amber-100 text-amber-800 border-amber-300'
                          }`}
                        >
                          優先度: {prio === 'High' ? '高' : '中'}
                        </span>
                      );
                    })()}

                    {shipment.isUrgent && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-600 text-white flex items-center gap-1 shadow-2xs animate-pulse">
                        <Zap className="w-3 h-3 fill-current shrink-0" />
                        <span>緊急案件</span>
                      </span>
                    )}

                    {shipment.isImportant && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500 text-white flex items-center gap-1 shadow-2xs">
                        <Star className="w-3 h-3 fill-current shrink-0" />
                        <span>重要案件</span>
                      </span>
                    )}

                    {shipment.isDgCargo && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                        <Flame className="w-3 h-3 text-amber-600 fill-amber-500/30 shrink-0" />
                        <span>DG品 (危険物)</span>
                      </span>
                    )}
                  </div>

                  {/* Task Progress & Destination Banner */}
                  <div
                    className={`rounded-2xl p-2.5 space-y-1.5 border transition-all ${
                      progressPct === 100 || shipment.status === 'Completed'
                        ? 'bg-emerald-50/90 border-emerald-400 ring-1 ring-emerald-300/80'
                        : 'bg-slate-50/80 border-slate-200/80'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                      <span
                        className={
                          progressPct === 100 || shipment.status === 'Completed'
                            ? 'text-emerald-950 font-black'
                            : ''
                        }
                      >
                        タスク進捗率 ({completedTasks}/{totalTasks} 完了)
                      </span>
                      <span
                        className={`font-mono font-black text-xs ${
                          progressPct === 100 || shipment.status === 'Completed'
                            ? 'text-emerald-700'
                            : 'text-blue-700'
                        }`}
                      >
                        {progressPct}%
                      </span>
                    </div>

                    {/* Destination & Pieces */}
                    <div className="flex items-center justify-between gap-1.5 py-0.5">
                      <div className="flex items-center gap-1.5 bg-gradient-to-r from-blue-700 to-indigo-800 text-white px-2.5 py-1 rounded-lg shadow-2xs flex-1 min-w-0">
                        <Plane className="w-4 h-4 text-blue-200 shrink-0" />
                        <span className="text-[10px] font-bold text-blue-200 shrink-0">向地(DEST):</span>
                        <span className="font-black text-xs sm:text-[13.5px] tracking-wide text-white font-mono truncate">
                          {shipment.destination || shipment.consignee || '未設定'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg shadow-2xs shrink-0 font-mono" title="個数 / RCP">
                        <Package className="w-4 h-4 text-amber-100 shrink-0" />
                        <span className="text-[10px] font-bold text-amber-100 shrink-0">個数:</span>
                        <span className="font-black text-xs sm:text-[13.5px] text-white shrink-0">{shipment.pieces || '未記載'}</span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          progressPct === 100 || shipment.status === 'Completed'
                            ? 'bg-emerald-500'
                            : progressPct > 0
                            ? 'bg-amber-500'
                            : 'bg-slate-300'
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Task Step List (When Unfolded) */}
                  {!isCollapsed && (
                    <div className="space-y-1.5 pt-1 border-t border-slate-100">
                      <div className="text-[11px] font-bold text-slate-600 mb-1 flex items-center justify-between">
                        <span>作業工程ステップ一覧:</span>
                        <span className="text-[10px] text-slate-500 font-normal">
                          クリックでステータス変更
                        </span>
                      </div>
                      {shipment.tasks.map((task) => {
                        const isDone = task.status === 'Completed';
                        const isInProgress = task.status === 'In Progress';
                        const taskKey = `${shipment.id}-${task.id}`;
                        const isAnimating = animatingTask?.id === taskKey;

                        return (
                          <motion.div
                            key={task.id}
                            animate={
                              isAnimating
                                ? {
                                    scale: [1, 1.035, 0.98, 1.01, 1],
                                    borderColor: ['#10B981', '#34D399', '#059669', '#10B981'],
                                    boxShadow: [
                                      '0 0 0 0 rgba(16, 185, 129, 0)',
                                      '0 0 16px 4px rgba(16, 185, 129, 0.3)',
                                      '0 0 0 0 rgba(16, 185, 129, 0)',
                                    ],
                                  }
                                : { scale: 1 }
                            }
                            transition={{ duration: 0.65, ease: 'backOut' }}
                            onClick={(e) => handleTaskStatusToggle(e, shipment.id, task)}
                            className={`p-2 rounded-xl border transition-all flex items-center justify-between gap-2 cursor-pointer relative ${
                              isDone
                                ? 'bg-emerald-50 border-emerald-300/90 text-emerald-950 hover:bg-emerald-100/80'
                                : isInProgress
                                ? 'bg-amber-50 border-amber-400 text-amber-950 shadow-2xs'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {/* Floating celebration badge on complete */}
                            <AnimatePresence>
                              {isAnimating && (
                                <motion.div
                                  initial={{ opacity: 0, y: 4, scale: 0.6 }}
                                  animate={{ opacity: 1, y: -18, scale: 1.1 }}
                                  exit={{ opacity: 0, y: -26, scale: 0.8 }}
                                  transition={{ duration: 0.7, ease: 'easeOut' }}
                                  className="absolute -top-1 left-6 z-30 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-lg flex items-center space-x-1 whitespace-nowrap pointer-events-none border border-emerald-300 ring-1 ring-emerald-400/40"
                                >
                                  <Sparkles className="w-3 h-3 text-amber-300 animate-spin" />
                                  <span>🎉 完了! ✨</span>
                                </motion.div>
                              )}
                            </AnimatePresence>

                            <div className="flex items-center space-x-2.5 min-w-0">
                              {/* Dedicated check button */}
                              <div className="relative shrink-0 flex items-center justify-center">
                                <motion.div
                                  whileHover={{ scale: 1.18 }}
                                  whileTap={{ scale: 0.8 }}
                                  className={`relative w-6 h-6 rounded-lg flex items-center justify-center transition-all border shadow-2xs ${
                                    isDone
                                      ? 'bg-gradient-to-br from-emerald-500 to-teal-600 border-emerald-400 text-white shadow-emerald-500/30'
                                      : isInProgress
                                      ? 'bg-amber-50 border-amber-400 text-amber-600'
                                      : 'bg-slate-100 border-slate-300 text-slate-400 group-hover:border-emerald-400'
                                  }`}
                                >
                                  {isAnimating && (
                                    <>
                                      <motion.span
                                        initial={{ scale: 0.7, opacity: 0.95 }}
                                        animate={{ scale: 2.8, opacity: 0 }}
                                        transition={{ duration: 0.65, ease: 'easeOut' }}
                                        className="absolute inset-0 rounded-lg bg-emerald-400/50 pointer-events-none"
                                      />
                                      <motion.span
                                        initial={{ scale: 0.8, opacity: 0.9 }}
                                        animate={{ scale: 3.5, opacity: 0 }}
                                        transition={{ duration: 0.85, ease: 'easeOut', delay: 0.08 }}
                                        className="absolute inset-0 rounded-lg border-2 border-emerald-400 pointer-events-none"
                                      />
                                      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
                                        const rad = (angle * Math.PI) / 180;
                                        const dist = 18;
                                        return (
                                          <motion.span
                                            key={i}
                                            initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                                            animate={{
                                              x: Math.cos(rad) * dist,
                                              y: Math.sin(rad) * dist,
                                              scale: [0, 1.4, 0],
                                              opacity: [1, 1, 0],
                                            }}
                                            transition={{ duration: 0.6, ease: 'easeOut' }}
                                            className="absolute w-1.5 h-1.5 rounded-full bg-amber-300 shadow-xs pointer-events-none"
                                          />
                                        );
                                      })}
                                    </>
                                  )}

                                  {isDone ? (
                                    <motion.div
                                      initial={isAnimating ? { scale: 0, rotate: -45 } : false}
                                      animate={{ scale: 1, rotate: 0 }}
                                      transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                                    >
                                      <Check className="w-3.5 h-3.5 stroke-[3.5]" />
                                    </motion.div>
                                  ) : isInProgress ? (
                                    <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                                  ) : (
                                    <Circle className="w-3.5 h-3.5 text-slate-300" />
                                  )}
                                </motion.div>
                              </div>

                              <span
                                className={`text-xs font-bold truncate ${
                                  isDone ? 'line-through text-emerald-700' : 'text-slate-800'
                                }`}
                              >
                                {task.title}
                              </span>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold shrink-0 ${
                                isDone
                                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                  : isInProgress
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-slate-100 text-slate-700 border border-slate-200'
                              }`}
                            >
                              {isDone ? '完了' : isInProgress ? '進行中' : '未着手'}
                            </span>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}

                  {/* Bottom Action Footer */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setZoomShipment(shipment)}
                      className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-2xs"
                      title="SI指示書PDF・付箋メモ・請求プレビューを表示"
                    >
                      <ZoomIn className="w-3.5 h-3.5 text-blue-600" />
                      <span>SI指示書 (PDF)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDetailShipment(shipment)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-blue-600 active:scale-95 text-white rounded-xl text-xs font-extrabold flex items-center space-x-1 transition-all cursor-pointer shadow-2xs"
                    >
                      <span>詳細・編集</span>
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </main>

      {/* PDF Zoom & Annotation Modal */}
      {zoomShipment && (
        <PdfZoomModal
          shipment={zoomShipment}
          isOpen={!!zoomShipment}
          onClose={() => setZoomShipment(null)}
          onShipmentUpdated={(updated) => {
            setZoomShipment(updated);
          }}
        />
      )}

      {/* Shipment Detail Modal (Overlay within Standalone Tab) */}
      {detailShipment && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 backdrop-blur-sm p-4 sm:p-6 flex items-center justify-center animate-in fade-in duration-200">
          <div className="bg-white text-slate-900 rounded-3xl shadow-2xl w-full max-w-7xl max-h-[92vh] overflow-hidden flex flex-col border border-slate-200">
            <div className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shrink-0 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm">案件詳細: {detailShipment.id} ({detailShipment.shipper})</span>
              </div>
              <button
                type="button"
                onClick={() => setDetailShipment(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-4 sm:p-6 flex-1 bg-slate-50">
              <ShipmentDetail
                shipment={detailShipment}
                onBack={() => setDetailShipment(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
