import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shipment, ShipmentStatus, StatusFilterType } from '../types';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  Circle,
  Plane,
  FileText,
  ZoomIn,
  ArrowRight,
  Plus,
  Layers,
  Sparkles,
  Star,
  Zap,
  Flame,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Package,
  Scale,
  FileSpreadsheet,
  Download,
  BarChart2,
  LayoutGrid,
  List,
  Pin,
  Mail,
  Search,
  MessageSquare,
  MessageSquareText,
  ExternalLink,
  FileSearch,
} from 'lucide-react';
import { SiDocumentViewer } from './SiDocumentViewer';
import { exportShipmentsToExcel } from '../lib/excelExportService';
import { GanttChartView } from './GanttChartView';
import { TableView } from './TableView';
import { togglePinShipment } from '../lib/storageManager';
import { CustomsEmailModal } from './CustomsEmailModal';
import { DateStatusPieChart } from './DateStatusPieChart';
import { CustomsClearanceParserModal } from './CustomsClearanceParserModal';
import { EdXraySubmitModal } from './EdXraySubmitModal';

interface CalendarViewProps {
  shipments: Shipment[];
  onSelectShipment: (shipment: Shipment) => void;
  onEditShipment?: (shipment: Shipment) => void;
  onDeleteShipment?: (shipment: Shipment) => void;
  onOpenUpload?: () => void;
  onZoomShipment?: (shipment: Shipment) => void;
  statusFilter?: StatusFilterType;
  onSelectStatusFilter?: (status: StatusFilterType) => void;
  todayTrigger?: number;
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const CALENDAR_HEADER_WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];

// Normalize YYYY-MM-DD or YYYY/MM/DD to YYYY-MM-DD
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

// Format Date object to YYYY-MM-DD string
function formatDateToKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  shipments,
  onSelectShipment,
  onEditShipment,
  onDeleteShipment,
  onOpenUpload,
  onZoomShipment,
  statusFilter = 'ALL',
  onSelectStatusFilter,
  todayTrigger,
}) => {
  const today = new Date();
  const todayKey = formatDateToKey(today);

  const taskInfoRef = useRef<HTMLDivElement>(null);

  const [isParserModalOpen, setIsParserModalOpen] = useState(false);
  const [isEdXrayModalOpen, setIsEdXrayModalOpen] = useState(false);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');

  const STORAGE_CALENDAR_METRIC_FILTER_KEY = 'export_app_calendar_metric_status_filter';
  const [localStatusFilter, setLocalStatusFilterState] = useState<StatusFilterType>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_CALENDAR_METRIC_FILTER_KEY);
      if (saved && ['UNCOMPLETED', 'ALL', 'Todo', 'In Progress', 'Completed'].includes(saved)) {
        return saved as StatusFilterType;
      }
    } catch {
      // ignore
    }
    return 'ALL';
  });

  const setLocalStatusFilter = (filter: StatusFilterType) => {
    setLocalStatusFilterState(filter);
    try {
      localStorage.setItem(STORAGE_CALENDAR_METRIC_FILTER_KEY, filter);
    } catch {
      // ignore
    }
  };

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
      const isCompleted = s.status === 'Completed' || (s.tasks.length > 0 && s.tasks.every((t) => t.status === 'Completed'));
      if (isCompleted) {
        newMap[s.id] = true;
      } else {
        newMap[s.id] = false;
      }
    });
    setCollapsedMap(newMap);
  };

  const toggleCollapse = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedMap((prev) => {
      const current = prev[id] !== false; // Default is collapsed (true)
      return {
        ...prev,
        [id]: !current,
      };
    });
  };

  // Storage Key for selected date persistence
  const STORAGE_DATE_KEY = 'export_mgmt_last_selected_date_v1';

  const savedDateKey = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_DATE_KEY) : null;
  const initialDateKey = savedDateKey || todayKey;

  const getInitialCurrentDate = (key: string) => {
    const parts = key.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      if (!isNaN(y) && !isNaN(m)) {
        return new Date(y, m, 1);
      }
    }
    return new Date(today.getFullYear(), today.getMonth(), 1);
  };

  // Calendar view state (year and month)
  const [currentDate, setCurrentDate] = useState<Date>(() => getInitialCurrentDate(initialDateKey));
  const [selectedDateKey, setSelectedDateKey] = useState<string>(initialDateKey);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [emailModalShipment, setEmailModalShipment] = useState<Shipment | null>(null);
  const STORAGE_SUBVIEW_KEY = 'export_app_sub_view_mode';
  const [subViewMode, setSubViewModeState] = useState<'cards' | 'gantt' | 'table'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SUBVIEW_KEY);
      if (saved === 'cards' || saved === 'gantt' || saved === 'table') return saved;
    } catch {
      // ignore
    }
    return 'gantt';
  });

  const handleSetSubViewMode = (mode: 'cards' | 'gantt' | 'table') => {
    setSubViewModeState(mode);
    try {
      localStorage.setItem(STORAGE_SUBVIEW_KEY, mode);
    } catch {
      // ignore
    }
  };

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      await exportShipmentsToExcel(getSelectedDateLabel(), selectedDateKey, selectedDateShipments);
    } catch (err) {
      console.error('Excel Export Error:', err);
      alert('Excelファイルの出力中にエラーが発生しました。');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSelectDateKey = (key: string) => {
    setSelectedDateKey(key);
    try {
      localStorage.setItem(STORAGE_DATE_KEY, key);
    } catch {
      // ignore quota or iframe sandbox restrictions
    }
  };

  const prevTodayTriggerRef = useRef<number>(todayTrigger || 0);

  // Effect to handle Today trigger from Header button ONLY when todayTrigger is incremented
  useEffect(() => {
    if (todayTrigger && todayTrigger > prevTodayTriggerRef.current) {
      prevTodayTriggerRef.current = todayTrigger;
      const now = new Date();
      const nowKey = formatDateToKey(now);
      setCurrentDate(new Date(now.getFullYear(), now.getMonth(), 1));
      handleSelectDateKey(nowKey);

      if (taskInfoRef.current) {
        taskInfoRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } else if (todayTrigger !== undefined) {
      prevTodayTriggerRef.current = todayTrigger;
    }
  }, [todayTrigger]);

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth(); // 0-indexed

  // Today formatting: e.g. "2026年7月31日 (金)"
  const getFormattedTodayStr = () => {
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const weekday = WEEKDAYS_JA[today.getDay()];
    return `${year}年${month}月${day}日 (${weekday})`;
  };

  // Move month
  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  };

  // Handle Today Header click
  const handleSelectToday = () => {
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
    handleSelectDateKey(todayKey);
  };

  // Generate days for calendar grid (月曜はじまり: Monday = 0, Sunday = 6)
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
  const startingDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; // 0 = Mon, 1 = Tue, ..., 5 = Sat, 6 = Sun
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // Create grid cells (42 cells max for 6 weeks)
  const calendarCells: Array<{ dateKey: string; dayNum: number; isCurrentMonth: boolean }> = [];

  // Previous month padding
  const prevMonthLastDate = new Date(currentYear, currentMonth, 0).getDate();
  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
    const pDate = new Date(currentYear, currentMonth - 1, prevMonthLastDate - i);
    calendarCells.push({
      dateKey: formatDateToKey(pDate),
      dayNum: pDate.getDate(),
      isCurrentMonth: false,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const cDate = new Date(currentYear, currentMonth, d);
    calendarCells.push({
      dateKey: formatDateToKey(cDate),
      dayNum: d,
      isCurrentMonth: true,
    });
  }

  // Next month padding
  const remainingCells = (7 - (calendarCells.length % 7)) % 7;
  for (let i = 1; i <= remainingCells; i++) {
    const nDate = new Date(currentYear, currentMonth + 1, i);
    calendarCells.push({
      dateKey: formatDateToKey(nDate),
      dayNum: i,
      isCurrentMonth: false,
    });
  }

  // Map shipments by customsClearanceDate key
  const shipmentsByDateKey: Record<string, Shipment[]> = {};
  shipments.forEach((s) => {
    const key = normalizeDateStr(s.customsClearanceDate);
    if (key) {
      if (!shipmentsByDateKey[key]) {
        shipmentsByDateKey[key] = [];
      }
      shipmentsByDateKey[key].push(s);
    }
  });

  // Filtered shipments for the selected date, sorted by priority (Urgent > Important > DG > Normal)
  const rawSelectedDateShipments = shipmentsByDateKey[selectedDateKey] || [];

  // Metric counts calculated strictly for the selected date (選択日の件数を反映)
  const totalCount = rawSelectedDateShipments.length;
  const todoCount = rawSelectedDateShipments.filter((s) => s.status === 'Todo').length;
  const inProgressCount = rawSelectedDateShipments.filter((s) => s.status === 'In Progress').length;
  const uncompletedCount = todoCount + inProgressCount;
  const completedCount = rawSelectedDateShipments.filter((s) => s.status === 'Completed').length;

  const selectedDateShipments = [...rawSelectedDateShipments].sort((a, b) => {
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

  // Filter selected date shipments by active local status filter card & text search (選択日のテキスト検索・状態別絞り込み)
  const displayedDateShipments = selectedDateShipments.filter((s) => {
    // 1. Text Search Filter (向け地、MAWB、HAWB、Shipper、Consignee、フライトルート、受注NO)
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

      if (!matchId && !matchMawb && !matchHawb && !matchShipper && !matchConsignee && !matchDestination && !matchFlight && !matchOrder && !matchInvoice) {
        return false;
      }
    }

    // 2. Status Filter
    if (!localStatusFilter || localStatusFilter === 'ALL') return true;
    if (localStatusFilter === 'UNCOMPLETED') return s.status === 'Todo' || s.status === 'In Progress';
    return s.status === localStatusFilter;
  });

  // Format selected date label
  const getSelectedDateLabel = () => {
    if (!selectedDateKey) return '';
    const parts = selectedDateKey.split('-');
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      const weekday = WEEKDAYS_JA[d.getDay()];
      return `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日 (${weekday})`;
    }
    return selectedDateKey;
  };

  return (
    <div className="space-y-6">
      {/* TOP ROW: ULTRA-COMPACT CALENDAR ON LEFT + HALF-HEIGHT METRIC BUTTONS ON RIGHT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT: ULTRA-COMPACT MINI CALENDAR (50% SCALE IN WIDTH AND HEIGHT) */}
        <div className="lg:col-span-5 xl:col-span-4 bg-white rounded-2xl border-2 border-slate-300 shadow-md p-3 flex flex-col justify-between space-y-2 max-w-sm mx-auto lg:max-w-none w-full">
          {/* Calendar Navigation & Month Controller */}
          <div className="flex items-center justify-between border-b-2 border-slate-200 pb-2">
            <div className="flex items-center space-x-1.5">
              <h2 className="text-sm font-black text-slate-950 font-mono tracking-tight">
                {currentYear}年 {currentMonth + 1}月
              </h2>
              <span className="text-[9.5px] text-blue-900 font-bold bg-blue-100 px-1.5 py-0.5 rounded border border-blue-300 shadow-2xs">
                通関日
              </span>
            </div>

            <div className="flex items-center space-x-1">
              <button
                onClick={handlePrevMonth}
                className="p-1 hover:bg-slate-100 text-slate-800 rounded-lg border-2 border-slate-200 hover:border-slate-300 shadow-2xs transition-colors cursor-pointer"
                title="前月"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleSelectToday}
                className="px-2.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg text-[9.5px] font-black border-2 border-slate-200 hover:border-slate-300 transition-colors cursor-pointer shadow-2xs"
              >
                今月
              </button>

              <button
                onClick={handleNextMonth}
                className="p-1 hover:bg-slate-100 text-slate-800 rounded-lg border-2 border-slate-200 hover:border-slate-300 shadow-2xs transition-colors cursor-pointer"
                title="次月"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* ULTRA-COMPACT CALENDAR GRID (1/2 HEIGHT & WIDTH) */}
          <div className="grid grid-cols-7 gap-1">
            {CALENDAR_HEADER_WEEKDAYS.map((day, idx) => (
              <div
                key={day}
                className={`py-0.5 text-center text-[10px] font-black rounded-lg border ${
                  idx === 5 // 土曜日 (Saturday)
                    ? 'text-blue-700 bg-blue-100/90 border-blue-200 shadow-2xs'
                    : idx === 6 // 日曜日 (Sunday)
                    ? 'text-rose-700 bg-rose-100/90 border-rose-200 shadow-2xs'
                    : 'text-slate-800 bg-slate-100 border-slate-200/90 shadow-2xs'
                }`}
              >
                {day}
              </div>
            ))}

            {calendarCells.map((cell) => {
              const dayShipments = shipmentsByDateKey[cell.dateKey] || [];
              const totalCount = dayShipments.length;
              const completedCount = dayShipments.filter((s) => s.status === 'Completed').length;
              const hasCutTime = dayShipments.some((s) => !!s.cutTime);
              const isToday = cell.dateKey === todayKey;
              const isSelected = cell.dateKey === selectedDateKey;

              return (
                <div
                  key={cell.dateKey}
                  onClick={() => handleSelectDateKey(cell.dateKey)}
                  className={`min-h-[24px] p-0.5 rounded-lg border-2 transition-all cursor-pointer flex flex-col justify-between relative shadow-2xs ${
                    isSelected
                      ? 'border-blue-600 ring-2 ring-blue-500/40 bg-blue-50/90 shadow-sm z-10'
                      : isToday
                      ? 'border-amber-500 bg-amber-50/50 shadow-xs'
                      : cell.isCurrentMonth
                      ? 'border-slate-200 hover:border-blue-400 hover:bg-blue-50/30 bg-white hover:shadow-xs'
                      : 'border-slate-200/60 bg-slate-100/60 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-mono leading-none ${
                        isToday
                          ? 'w-3.5 h-3.5 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] font-black shadow-2xs'
                          : isSelected
                          ? 'text-blue-900 font-black text-[10px]'
                          : cell.isCurrentMonth
                          ? 'text-slate-950 font-black text-[10px]'
                          : 'text-slate-400 font-bold text-[9.5px]'
                      }`}
                    >
                      {cell.dayNum}
                    </span>

                    <div className="flex items-center gap-0.5">
                      {hasCutTime && (
                        <span className="text-[8.5px] font-black text-rose-700 bg-rose-100 border border-rose-400 px-0.5 rounded leading-none shadow-2xs" title="カット時間設定あり案件あり">
                          ⏰
                        </span>
                      )}
                      {isToday && (
                        <span className="text-[8px] font-black text-amber-900 bg-amber-200 border border-amber-400 px-0.5 rounded leading-none">
                          今
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-0.5">
                    {totalCount > 0 ? (
                      <div
                        className={`px-0.5 py-[0.5px] rounded text-[8px] font-black font-mono text-center transition-all leading-tight shadow-2xs ${
                          completedCount === totalCount
                            ? 'bg-emerald-600 text-white border border-emerald-700'
                            : completedCount > 0
                            ? 'bg-amber-500 text-white border border-amber-600'
                            : 'bg-blue-600 text-white border border-blue-700'
                        }`}
                        title={`通関完了件数: ${completedCount}/${totalCount}件`}
                      >
                        {completedCount}/{totalCount}
                      </div>
                    ) : (
                      <div className="text-[9px] text-slate-400 font-black font-mono text-center leading-none">-</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: METRIC CARDS & CONTROL PANEL (カレンダーの右側) */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-3">
          {/* Compact Cut Time Alert Banner (カット時間の警告表示: 上部サマリーエリアへ統合・スリム表示) */}
          {selectedDateShipments.some((s) => !!s.cutTime) && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-r from-rose-950 via-rose-900 to-slate-900 border-2 border-rose-500/90 rounded-2xl px-3.5 py-2 text-white shadow-md shadow-rose-950/20 flex flex-wrap items-center justify-between gap-2"
            >
              <div className="flex items-center space-x-2.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
                <div className="flex items-center space-x-1.5 shrink-0 text-rose-300 font-bold text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping inline-block" />
                  <Clock className="w-3.5 h-3.5 text-rose-400" />
                  <span>カット時間指定:</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {selectedDateShipments
                    .filter((s) => !!s.cutTime)
                    .map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onSelectShipment(s)}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-white/10 hover:bg-white/20 border border-rose-400/60 rounded-lg text-[11px] font-bold text-white transition-all cursor-pointer shadow-xs active:scale-95"
                        title={`${s.shipper} (AWB: ${s.mawbNumber}) - クリックで案件詳細を開きます`}
                      >
                        <span className="font-mono text-rose-200">{s.id}:</span>
                        <span className="font-mono font-extrabold text-amber-300">⏰ {s.cutTime}</span>
                        <span className="text-[10px] text-rose-200 truncate max-w-[120px]">({s.shipper})</span>
                      </button>
                    ))}
                </div>
              </div>
              <span className="px-2.5 py-1 bg-rose-600 text-white font-black text-[10.5px] rounded-lg border-2 border-rose-400 shadow-xs flex items-center gap-1 shrink-0">
                <Zap className="w-3 h-3 text-amber-300 fill-amber-300" />
                カット時間注意
              </span>
            </motion.div>
          )}

          {/* Status Filter Metric Buttons & Selected Date Status Pie Chart */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-2.5 items-stretch">
            {/* Left: 5 Status Filter Metric Buttons */}
            <div className="xl:col-span-7 2xl:col-span-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5 sm:gap-2">
              {/* Uncompleted Metric */}
              <motion.div
                whileHover={{ y: -1, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setLocalStatusFilter('UNCOMPLETED')}
                className={`cursor-pointer bg-white py-1 px-2.5 rounded-xl border-2 transition-all flex items-center justify-between min-h-[44px] ${
                  localStatusFilter === 'UNCOMPLETED'
                    ? 'border-blue-600 ring-2 ring-blue-200 shadow-md bg-blue-50/40'
                    : 'border-slate-200 hover:border-blue-300 hover:shadow-md shadow-sm'
                }`}
              >
                <div className="leading-tight">
                  <div className="text-[11px] font-black text-blue-700 tracking-tight flex items-center gap-0.5">
                    <span>未完了</span>
                  </div>
                  <div className="text-[16px] font-black text-blue-700 leading-none mt-0.5 font-mono">
                    {uncompletedCount} <span className="text-[10px] font-bold text-slate-500">件</span>
                  </div>
                </div>
                <div className="w-5 h-5 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 border border-blue-200 shadow-2xs ml-1">
                  <Clock className="w-3 h-3" />
                </div>
              </motion.div>

              {/* Total Metric */}
              <motion.div
                whileHover={{ y: -1, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setLocalStatusFilter('ALL')}
                className={`cursor-pointer bg-white py-1 px-2.5 rounded-xl border-2 transition-all flex items-center justify-between min-h-[44px] ${
                  localStatusFilter === 'ALL'
                    ? 'border-slate-800 ring-2 ring-slate-200 shadow-md bg-slate-50/50'
                    : 'border-slate-200 hover:border-slate-400 hover:shadow-md shadow-sm'
                }`}
              >
                <div className="leading-tight">
                  <div className="text-[11px] font-black text-slate-700 tracking-tight flex items-center gap-0.5">
                    <span>全件</span>
                  </div>
                  <div className="text-[16px] font-black text-slate-900 leading-none mt-0.5 font-mono">
                    {totalCount} <span className="text-[10px] font-bold text-slate-500">件</span>
                  </div>
                </div>
                <div className="w-5 h-5 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 border border-slate-200 shadow-2xs ml-1">
                  <Plane className="w-3 h-3" />
                </div>
              </motion.div>

              {/* Todo Metric */}
              <motion.div
                whileHover={{ y: -1, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setLocalStatusFilter('Todo')}
                className={`cursor-pointer bg-white py-1 px-2.5 rounded-xl border-2 transition-all flex items-center justify-between min-h-[44px] ${
                  localStatusFilter === 'Todo'
                    ? 'border-slate-600 ring-2 ring-slate-200 shadow-md bg-slate-50/50'
                    : 'border-slate-200 hover:border-slate-400 hover:shadow-md shadow-sm'
                }`}
              >
                <div className="leading-tight">
                  <div className="text-[11px] font-black text-slate-700 tracking-tight flex items-center gap-0.5">
                    <span>未着手</span>
                  </div>
                  <div className="text-[16px] font-black text-slate-800 leading-none mt-0.5 font-mono">
                    {todoCount} <span className="text-[10px] font-bold text-slate-500">件</span>
                  </div>
                </div>
                <div className="w-5 h-5 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 border border-slate-200 shadow-2xs ml-1">
                  <Circle className="w-3 h-3" />
                </div>
              </motion.div>

              {/* In Progress Metric */}
              <motion.div
                whileHover={{ y: -1, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setLocalStatusFilter('In Progress')}
                className={`cursor-pointer bg-white py-1 px-2.5 rounded-xl border-2 transition-all flex items-center justify-between min-h-[44px] ${
                  localStatusFilter === 'In Progress'
                    ? 'border-amber-500 ring-2 ring-amber-200 shadow-md bg-amber-50/40'
                    : 'border-slate-200 hover:border-amber-400 hover:shadow-md shadow-sm'
                }`}
              >
                <div className="leading-tight">
                  <div className="text-[11px] font-black text-amber-700 tracking-tight flex items-center gap-0.5">
                    <span>進行中</span>
                  </div>
                  <div className="text-[16px] font-black text-amber-600 leading-none mt-0.5 font-mono">
                    {inProgressCount} <span className="text-[10px] font-bold text-slate-500">件</span>
                  </div>
                </div>
                <div className="w-5 h-5 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200 shadow-2xs ml-1">
                  <Clock className="w-3 h-3" />
                </div>
              </motion.div>

              {/* Completed Metric */}
              <motion.div
                whileHover={{ y: -1, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setLocalStatusFilter('Completed')}
                className={`cursor-pointer bg-white py-1 px-2.5 rounded-xl border-2 transition-all flex items-center justify-between min-h-[44px] ${
                  localStatusFilter === 'Completed'
                    ? 'border-emerald-500 ring-2 ring-emerald-200 shadow-md bg-emerald-50/40'
                    : 'border-slate-200 hover:border-emerald-400 hover:shadow-md shadow-sm'
                }`}
              >
                <div className="leading-tight">
                  <div className="text-[11px] font-black text-emerald-700 tracking-tight flex items-center gap-0.5">
                    <span>完了</span>
                  </div>
                  <div className="text-[16px] font-black text-emerald-600 leading-none mt-0.5 font-mono">
                    {completedCount} <span className="text-[10px] font-bold text-slate-500">件</span>
                  </div>
                </div>
                <div className="w-5 h-5 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200 shadow-2xs ml-1">
                  <CheckCircle2 className="w-3 h-3" />
                </div>
              </motion.div>
            </div>

            {/* Right: Selected Date Status Distribution Donut Chart (コンパクト・非圧迫) */}
            <div className="xl:col-span-5 2xl:col-span-4">
              <DateStatusPieChart
                shipments={selectedDateShipments}
                dateLabel={getSelectedDateLabel()}
              />
            </div>
          </div>

          {/* CONTROL PANEL CARD (画像のエリア: 検索・フィルターバー ＆ 通関日タイトル・コントロール群) */}
          <div className="bg-white rounded-2xl border-2 border-slate-300 shadow-md p-4 space-y-3.5">
            {/* Filter & Search Bar */}
            <div className="bg-slate-50/90 p-3 rounded-xl border-2 border-slate-200 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shadow-xs">
              {/* Left: Count & Status Legends */}
              <div className="flex items-center space-x-3 flex-wrap gap-y-1.5 text-xs">
                <span className="font-bold text-slate-800 flex items-center space-x-1.5">
                  <Layers className="w-4 h-4 text-blue-600" />
                  <span>対象貨物: <strong className="text-blue-700 font-mono text-sm font-black">{displayedDateShipments.length}</strong> 件</span>
                </span>

                <div className="h-4 w-px bg-slate-300 hidden sm:block" />

                {/* Status Legends */}
                <div className="flex items-center space-x-1.5 text-[10px]">
                  <span className="inline-flex items-center font-bold text-emerald-800 bg-emerald-100/90 px-2 py-0.5 rounded-md border border-emerald-300 shadow-2xs">
                    <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
                    完了工程
                  </span>
                  <span className="inline-flex items-center font-extrabold text-amber-900 bg-amber-200 px-2 py-0.5 rounded-md border border-amber-400 shadow-2xs animate-pulse">
                    <Clock className="w-3 h-3 mr-1 text-amber-700" />
                    現在進行中ステップ
                  </span>
                  <span className="inline-flex items-center font-semibold text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-300 shadow-2xs">
                    <Circle className="w-3 h-3 mr-1 text-slate-400" />
                    予定ステータス
                  </span>
                </div>
              </div>

              {/* Right: Search Input & Quick Filter Switcher */}
              <div className="flex items-center space-x-2 shrink-0">
                <div className="relative w-full sm:w-56 lg:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="向け地、MAWB、CONSIGNEEで検索..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 bg-white border-2 border-slate-200 hover:border-slate-300 focus:border-blue-500 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-xs transition-colors"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center bg-white p-0.5 border-2 border-slate-200 rounded-lg text-xs shrink-0 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setLocalStatusFilter('ALL')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                      localStatusFilter === 'ALL' ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    すべて
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocalStatusFilter('UNCOMPLETED')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                      localStatusFilter === 'UNCOMPLETED' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    進行中のみ
                  </button>
                </div>
              </div>
            </div>

            {/* Section Header Title & Actions */}
            <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-2.5 border-t-2 border-slate-100 pt-3">
              <div>
                <div className="flex items-center space-x-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse ring-4 ring-blue-100" />
                  <h3 className="text-sm font-black text-slate-900 tracking-tight">
                    通関日: {getSelectedDateLabel()} の案件・タスク情報
                  </h3>
                  {selectedDateKey === todayKey && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold text-[10px] rounded-full border border-amber-300 shadow-2xs">
                      本日
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 font-medium">
                  該当日の輸出通関申告および作業進捗指示一覧 ({displayedDateShipments.length} 件 / 通関日合計: {selectedDateShipments.length} 件)
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {/* View Mode Toggle: Gantt Chart vs Cards vs List/Table */}
                <div className="flex items-center space-x-0.5 bg-slate-100 p-0.5 rounded-lg border-2 border-slate-200/80 shadow-xs">
                  <button
                    type="button"
                    onClick={() => handleSetSubViewMode('gantt')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center space-x-1 cursor-pointer ${
                      subViewMode === 'gantt' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <BarChart2 className="w-3.5 h-3.5" />
                    <span>ガントチャート</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSetSubViewMode('cards')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center space-x-1 cursor-pointer ${
                      subViewMode === 'cards' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    <span>カード表示</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSetSubViewMode('table')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center space-x-1 cursor-pointer ${
                      subViewMode === 'table' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <List className="w-3.5 h-3.5" />
                    <span>リスト表示</span>
                  </button>
                </div>

                {/* Parser Button */}
                <button
                  type="button"
                  onClick={() => setIsParserModalOpen(true)}
                  className="px-3 py-1 text-xs font-bold rounded-lg transition-all shadow-xs flex items-center space-x-1 border-2 cursor-pointer bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white border-indigo-700 ml-1"
                  title="許可書PDFをドラッグ＆ドロップして自動リネーム・ダウンロードします"
                >
                  <FileSearch className="w-3.5 h-3.5 text-indigo-200" />
                  <span>許可書解析</span>
                </button>

                {/* ED/XRAY請求書提出 Button (PAD連携) */}
                <button
                  type="button"
                  onClick={() => setIsEdXrayModalOpen(true)}
                  className="px-3 py-1 text-xs font-bold rounded-lg transition-all shadow-xs flex items-center space-x-1 border-2 cursor-pointer bg-blue-700 hover:bg-blue-800 active:scale-95 text-white border-blue-800 ml-1"
                  title="該当通関日の許可書、X-RAY結果、請求書の3ファイルを本船名で圧縮してコピー (Power Automate Desktop連携)"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-200" />
                  <span>ED/XRAY請求書提出</span>
                </button>

                {/* Excel Download Button */}
                <button
                  type="button"
                  onClick={handleExportExcel}
                  disabled={isExporting || selectedDateShipments.length === 0}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all shadow-xs flex items-center space-x-1 border-2 cursor-pointer ml-1 ${
                    selectedDateShipments.length === 0
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
                      : 'bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white border-emerald-800'
                  }`}
                  title="選択された日付の出荷一覧情報をExcelファイル(.xlsx)で出力します (倉庫用FAX入庫指示フォーマット)"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
                  <span>{isExporting ? '作成中...' : '輸出一覧EXCEL'}</span>
                  <Download className="w-3 h-3 text-emerald-100 ml-0.5" />
                </button>

                {/* Collapse Controls Bar */}
                {subViewMode === 'cards' && (
                  <div className="flex items-center space-x-0.5 bg-slate-100 p-0.5 rounded-lg border-2 border-slate-200 shadow-2xs">
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

                <span className="px-2.5 py-1 bg-slate-100 text-slate-700 text-[11px] font-bold rounded-lg border-2 border-slate-200 shadow-2xs">
                  全工程完了: {selectedDateShipments.filter((s) => s.status === 'Completed').length} / {selectedDateShipments.length} 件
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM AREA: SELECTED DATE DETAILS LIST (GANTT CHART / CARD GRID) */}
      <div ref={taskInfoRef} className="space-y-4">
        {/* Selected Date Body: Gantt Chart View vs Card Grid View vs Table View */}
        {subViewMode === 'gantt' ? (
          <GanttChartView
            shipments={displayedDateShipments}
            dateLabel={getSelectedDateLabel()}
            dateKey={selectedDateKey}
            onSelectShipment={onSelectShipment}
          />
        ) : subViewMode === 'table' ? (
          displayedDateShipments.length === 0 ? (
            <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-10 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <CalendarIcon className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-700">
                選択された条件 (通関日: {getSelectedDateLabel()}) に該当する案件はありません
              </h4>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                カードフィルター（全件、未完了、未着手、進行中、完了）の選択を変更するか、他の通関日を選択してください。
              </p>
            </div>
          ) : (
            <TableView
              shipments={displayedDateShipments}
              onSelectShipment={onSelectShipment}
              onEditShipment={onEditShipment || onSelectShipment}
              onDeleteShipment={onDeleteShipment || (() => {})}
            />
          )
        ) : displayedDateShipments.length === 0 ? (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-10 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <CalendarIcon className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-700">
              選択された条件 (通関日: {getSelectedDateLabel()}) に該当する案件はありません
            </h4>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              カードフィルター（全件、未完了、未着手、進行中、完了）の選択を変更するか、他の通関日を選択してください。
            </p>
            {onOpenUpload && (
              <button
                onClick={onOpenUpload}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl inline-flex items-center shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4 mr-1" />
                <span>SI指示書 (PDF) を取り込む</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {displayedDateShipments.map((shipment, idx) => {
              const completedTasks = shipment.tasks.filter((t) => t.status === 'Completed').length;
              const totalTasks = shipment.tasks.length;
              const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
              const isCollapsed = collapsedMap[shipment.id] !== false;

              // User registered comments / memo
              const memoCount = shipment.comments?.length || 0;
              const hasImportantMemo = shipment.comments?.some((c) => c.isImportant);
              const latestComment = memoCount > 0 ? shipment.comments![0] : null;
              const memoTooltip = memoCount > 0
                ? `【ユーザー登録メモ (${memoCount}件)${hasImportantMemo ? ' ★重要メモあり' : ''}】\n最新 (${latestComment?.formattedTime || ''}):\n${latestComment?.authorName ? `[${latestComment.authorName}] ` : ''}${latestComment?.content || ''}`
                : '';

              return (
                <motion.div
                  key={shipment.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.05 }}
                  whileHover={{ y: -2 }}
                  onClick={() => onSelectShipment(shipment)}
                  className={`rounded-3xl border cursor-pointer transition-all p-3.5 flex flex-col justify-between space-y-2.5 group ${
                    shipment.isPinned
                      ? 'border-blue-500 ring-2 ring-blue-400/50 bg-blue-50/10 shadow-md hover:shadow-xl'
                      : shipment.isUrgent
                      ? 'border-rose-400 bg-rose-50/10 shadow-md hover:border-rose-500 hover:shadow-xl'
                      : shipment.isImportant
                      ? 'border-amber-400 bg-amber-50/10 shadow-md hover:border-amber-500 hover:shadow-xl'
                      : 'border-slate-200 bg-white shadow-xs hover:shadow-xl hover:border-blue-400'
                  }`}
                >
                  {/* Header Meta */}
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                        {shipment.isPinned && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg bg-blue-600 text-white shadow-xs flex items-center space-x-1">
                            <Pin className="w-3 h-3 fill-current text-blue-100 rotate-45" />
                            <span>📌 ピン留め固定</span>
                          </span>
                        )}

                        <span className="px-2.5 py-0.5 text-xs sm:text-[13px] font-black tracking-tight rounded-md bg-blue-950 text-white border border-blue-800 uppercase font-mono shadow-2xs">
                          {shipment.id}
                        </span>

                        {/* User Memo / Comment Count Badge */}
                        {memoCount > 0 && (
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-lg border shadow-2xs flex items-center space-x-1 transition-colors ${
                              hasImportantMemo
                                ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700 shadow-xs ring-2 ring-rose-300 font-extrabold animate-pulse'
                                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                            }`}
                            title={memoTooltip}
                          >
                            <MessageSquareText className={`w-3 h-3 shrink-0 ${hasImportantMemo ? 'text-white' : 'text-indigo-600'}`} />
                            <span>{hasImportantMemo ? `🔴 重要メモ ${memoCount}件` : `メモ ${memoCount}件`}</span>
                          </span>
                        )}
                      </div>
                      <h4 className="text-xs sm:text-[13px] font-black text-slate-900 mt-1 truncate max-w-[200px] leading-tight" title={shipment.shipper}>
                        {shipment.shipper}
                      </h4>
                      <p className="text-[11.5px] sm:text-[12px] font-bold text-slate-700 truncate leading-tight" title={shipment.consignee}>
                        ↳ CNEE: <span className="font-semibold text-slate-800">{shipment.consignee || '未設定'}</span>
                      </p>
                    </div>

                    <div className="flex items-center space-x-1 shrink-0">
                      {/* Pin Toggle Button */}
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
                        <Pin className={`w-3.5 h-3.5 ${shipment.isPinned ? 'fill-current rotate-45 text-white' : 'text-slate-500'}`} />
                        <span className="text-[10px] font-bold">
                          {shipment.isPinned ? '固定中' : 'ピン留め'}
                        </span>
                      </button>

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

                      {/* Individual Fold / Unfold Toggle Button */}
                      <button
                        type="button"
                        onClick={(e) => toggleCollapse(shipment.id, e)}
                        className="p-1.5 text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-colors flex items-center gap-1 cursor-pointer border border-slate-200 bg-slate-50/80"
                        title={isCollapsed ? '展開表示する' : '折りたたむ'}
                      >
                        <span className="text-[10px] font-bold">
                          {isCollapsed ? '展開' : '折りたたみ'}
                        </span>
                        {isCollapsed ? <ChevronDown className="w-3.5 h-3.5 text-blue-600" /> : <ChevronUp className="w-3.5 h-3.5 text-slate-500" />}
                      </button>
                    </div>
                  </div>

                  {/* Priority & Cargo Badges (カット時間, 重要案件, 緊急案件, DG品, 優先度) */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {shipment.cutTime && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-600 text-white flex items-center gap-1 shadow-2xs animate-pulse border border-rose-400">
                        <Clock className="w-3 h-3 text-white shrink-0" />
                        <span>⏰ CUT: {shipment.cutTime}</span>
                      </span>
                    )}

                    {(() => {
                      const prio = shipment.priorityLevel || shipment.priority || (shipment.isUrgent ? 'High' : shipment.isImportant ? 'Medium' : 'Low');
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

                  {/* Task Information Breakdown (進捗状態) - Always Visible */}
                  <div
                    className={`rounded-2xl p-2.5 space-y-1.5 border transition-all ${
                      progressPct === 100 || shipment.status === 'Completed'
                        ? 'bg-emerald-50/90 border-emerald-400 ring-1 ring-emerald-300/80'
                        : 'bg-slate-50/80 border-slate-200/80'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                      <span className={progressPct === 100 || shipment.status === 'Completed' ? 'text-emerald-950 font-black' : ''}>
                        タスク進捗率 ({completedTasks}/{totalTasks} 完了)
                      </span>
                      <span
                        className={`font-mono font-black text-xs ${
                          progressPct === 100 || shipment.status === 'Completed' ? 'text-emerald-700' : 'text-blue-700'
                        }`}
                      >
                        {progressPct}%
                      </span>
                    </div>

                    {/* 向地(DEST)・個数・カット時間 クイックバッジ (Prominent High-Contrast) */}
                    <div className="flex items-center justify-between gap-1.5 py-0.5">
                      {/* 向け地 Destination */}
                      <div className="flex items-center gap-1.5 bg-gradient-to-r from-blue-700 to-indigo-800 text-white px-2.5 py-1 rounded-lg shadow-2xs flex-1 min-w-0">
                        <Plane className="w-4 h-4 text-blue-200 shrink-0" />
                        <span className="text-[10px] font-bold text-blue-200 shrink-0 font-sans">向地(DEST):</span>
                        <span className="font-black text-xs sm:text-[13.5px] tracking-wide text-white font-mono truncate">{shipment.destination || shipment.consignee || '未設定'}</span>
                      </div>

                      {/* 個数 Pieces */}
                      <div className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg shadow-2xs shrink-0 font-mono" title="個数 / RCP">
                        <Package className="w-4 h-4 text-amber-100 shrink-0" />
                        <span className="text-[10px] font-bold text-amber-100 shrink-0 font-sans">個数:</span>
                        <span className="font-black text-xs sm:text-[13.5px] text-white shrink-0">{shipment.pieces || '未記載'}</span>
                      </div>
                    </div>

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

                    {/* Task Pills */}
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {shipment.tasks.map((task) => (
                        <span
                          key={task.id}
                          className={`px-2 py-0.5 rounded-md text-[10.5px] sm:text-[11px] font-extrabold flex items-center ${
                            task.status === 'Completed'
                              ? 'bg-emerald-100 text-emerald-950 border border-emerald-300'
                              : task.status === 'In Progress'
                              ? 'bg-amber-100 text-amber-950 border border-amber-300'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {task.status === 'Completed' ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 mr-1 shrink-0" />
                          ) : task.status === 'In Progress' ? (
                            <Clock className="w-3 h-3 text-amber-600 mr-1 shrink-0" />
                          ) : (
                            <Circle className="w-3 h-3 text-slate-400 mr-1 shrink-0" />
                          )}
                          <span>{task.title}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* PDF Document Thumbnail Container & Actions (Folds/Collapses) */}
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-3 overflow-hidden pt-1"
                      >
                        {/* PDF Document Thumbnail Container */}
                        <div
                          className="h-52"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onZoomShipment) onZoomShipment(shipment);
                          }}
                        >
                          <SiDocumentViewer
                            shipment={shipment}
                            isThumbnail={true}
                          />
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onZoomShipment) onZoomShipment(shipment);
                            }}
                            className="text-blue-600 hover:text-blue-800 font-bold inline-flex items-center space-x-1 cursor-pointer"
                          >
                            <ZoomIn className="w-3.5 h-3.5 mr-1" />
                            <span>PDF拡大</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEmailModalShipment(shipment);
                            }}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl inline-flex items-center border border-indigo-200/80 transition-colors cursor-pointer"
                            title="通関依頼メールの作成・コピー"
                          >
                            <Mail className="w-3.5 h-3.5 mr-1 text-indigo-600" />
                            <span>通関依頼メール作成</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectShipment(shipment);
                            }}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl inline-flex items-center transition-colors cursor-pointer group-hover:bg-blue-600"
                          >
                            進捗管理 <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Customs Email Modal */}
      {emailModalShipment && (
        <CustomsEmailModal
          shipment={emailModalShipment}
          onClose={() => setEmailModalShipment(null)}
        />
      )}

      {/* Parser Modal */}
      {isParserModalOpen && (
        <CustomsClearanceParserModal
          initialDate={selectedDateKey}
          shipments={shipments}
          onClose={() => setIsParserModalOpen(false)}
        />
      )}

      {/* ED/XRAY 請求書提出 Modal (PAD連携) */}
      {isEdXrayModalOpen && (
        <EdXraySubmitModal
          initialDate={selectedDateKey}
          onClose={() => setIsEdXrayModalOpen(false)}
        />
      )}
    </div>
  );
};

