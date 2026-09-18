import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shipment, Task, TaskStatus, StatusFilterType, CustomsEmailLog } from '../types';
import { getShipments, subscribeToStore, getCustomsEmailThreadForShipment } from '../lib/storageManager';
import { SiDocumentViewer } from './SiDocumentViewer';
import {
  Search,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  Circle,
  Plane,
  Package,
  MapPin,
  User as UserIcon,
  FileText,
  Copy,
  Check,
  RefreshCw,
  Zap,
  Star,
  Flame,
  AlertTriangle,
  X,
  MessageSquare,
  ShieldCheck,
  Share2,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  Receipt,
  Layers,
  Sparkles,
  Mail,
  ArrowDownLeft,
  ArrowUpRight,
  Paperclip,
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

export const MobileViewerApp: React.FC = () => {
  const [shipments, setShipments] = useState<Shipment[]>(() => getShipments());
  const [selectedDate, setSelectedDate] = useState<string>(() => formatDateToKey(new Date()));
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterType | 'CUT_TIME'>('ALL');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [copiedAwb, setCopiedAwb] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<'info' | 'tasks' | 'notes' | 'pdf'>('info');

  // Customs Email Thread State (for active shipment)
  const [emailThread, setEmailThread] = useState<CustomsEmailLog[]>([]);
  const [expandedEmailIds, setExpandedEmailIds] = useState<Set<string>>(new Set());
  const [copiedEmailTextId, setCopiedEmailTextId] = useState<string | null>(null);

  const formatMailDateTime = (isoString?: string) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      const now = new Date();
      const diffMin = Math.round((now.getTime() - d.getTime()) / (60 * 1000));
      if (diffMin >= 0 && diffMin < 60) {
        return `${diffMin}分前`;
      }
      if (diffMin >= 60 && diffMin < 24 * 60) {
        return `${Math.floor(diffMin / 60)}時間前`;
      }
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${m}/${day} ${h}:${min}`;
    } catch {
      return isoString;
    }
  };

  const todayKey = useMemo(() => formatDateToKey(new Date()), []);

  // Subscribe to storage changes for live sync
  useEffect(() => {
    const reload = () => {
      const latest = getShipments();
      setShipments(latest);
      setLastUpdated(new Date());
      setSelectedShipment((prev) => {
        if (!prev) return null;
        const found = latest.find(
          (s) => s.id === prev.id || (s.mawbNumber && s.mawbNumber === prev.mawbNumber)
        );
        return found || prev;
      });
    };
    reload();
    const unsub = subscribeToStore(() => {
      reload();
    });

    // Auto refresh timer every 20 seconds
    const interval = setInterval(() => {
      reload();
    }, 20000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  // Fetch updated email thread whenever selectedShipment changes or storage updates
  useEffect(() => {
    if (!selectedShipment) {
      setEmailThread([]);
      return;
    }
    const thread = getCustomsEmailThreadForShipment(selectedShipment);
    setEmailThread(thread);
    if (thread.length > 0) {
      // Default to expand the latest email
      setExpandedEmailIds(new Set([thread[thread.length - 1].id]));
    }
  }, [selectedShipment, lastUpdated]);

  const toggleExpandEmail = (id: string) => {
    setExpandedEmailIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopyEmailContent = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedEmailTextId(id);
      setTimeout(() => setCopiedEmailTextId(null), 2000);
    } catch (e) {
      console.error('Failed to copy', e);
    }
  };

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    setShipments(getShipments());
    setLastUpdated(new Date());
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Date Navigation Helpers
  const handlePrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(formatDateToKey(d));
  };

  const handleNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(formatDateToKey(d));
  };

  const handleToday = () => {
    setSelectedDate(todayKey);
  };

  // Format selected date for display
  const dateDisplayInfo = useMemo(() => {
    try {
      const d = new Date(selectedDate);
      if (isNaN(d.getTime())) {
        return { text: selectedDate, weekday: '', isToday: false, isSunday: false, isSaturday: false };
      }
      const m = d.getMonth() + 1;
      const day = d.getDate();
      const dayOfWeek = d.getDay();
      const w = WEEKDAYS_JA[dayOfWeek];
      const isToday = selectedDate === todayKey;
      return {
        text: `${m}月${day}日`,
        weekday: `(${w})`,
        isToday,
        isSunday: dayOfWeek === 0,
        isSaturday: dayOfWeek === 6,
      };
    } catch {
      return { text: selectedDate, weekday: '', isToday: false, isSunday: false, isSaturday: false };
    }
  }, [selectedDate, todayKey]);

  const selectedDateLabel = useMemo(() => {
    return `${dateDisplayInfo.text} ${dateDisplayInfo.weekday}${dateDisplayInfo.isToday ? ' 【本日】' : ''}`;
  }, [dateDisplayInfo]);

  // Filter shipments for selected date
  const dateShipments = useMemo(() => {
    return shipments.filter((s) => {
      const normalized = normalizeDateStr(s.customsClearanceDate);
      return normalized === selectedDate;
    });
  }, [shipments, selectedDate]);

  // Overall Stats for selected date
  const stats = useMemo(() => {
    const total = dateShipments.length;
    const completed = dateShipments.filter((s) => s.status === 'Completed').length;
    const inProgress = dateShipments.filter((s) => s.status === 'In Progress').length;
    const todo = dateShipments.filter((s) => s.status === 'Todo').length;
    const uncompleted = total - completed;
    const cutTimeCount = dateShipments.filter((s) => !!s.cutTime).length;
    const progressRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, inProgress, todo, uncompleted, cutTimeCount, progressRate };
  }, [dateShipments]);

  // Cut-off Time Alert Shipments for today/selected date
  const cutTimeShipments = useMemo(() => {
    return dateShipments
      .filter((s) => !!s.cutTime && s.status !== 'Completed')
      .sort((a, b) => (a.cutTime || '').localeCompare(b.cutTime || ''));
  }, [dateShipments]);

  // Filtered shipments based on search and statusFilter
  const displayedShipments = useMemo(() => {
    const filtered = dateShipments.filter((s) => {
      // Status Filter
      if (statusFilter === 'UNCOMPLETED' && s.status === 'Completed') return false;
      if (statusFilter === 'CUT_TIME' && !s.cutTime) return false;
      if (statusFilter !== 'ALL' && statusFilter !== 'UNCOMPLETED' && statusFilter !== 'CUT_TIME') {
        if (s.status !== statusFilter) return false;
      }

      // Search Query
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const awb = (s.mawbNumber || s.id || '').toLowerCase();
      const hawb = (s.hawbNumber || '').toLowerCase();
      const shipper = (s.shipper || '').toLowerCase();
      const consignee = (s.consignee || '').toLowerCase();
      const flight = (s.flightRoute || '').toLowerCase();
      const dest = (s.destination || '').toLowerCase();
      const staff = (s.assignedOperator?.name || '').toLowerCase();
      const order = (s.orderNumber || '').toLowerCase();
      const invoice = (s.invoiceNumber || '').toLowerCase();

      return (
        awb.includes(q) ||
        hawb.includes(q) ||
        shipper.includes(q) ||
        consignee.includes(q) ||
        flight.includes(q) ||
        dest.includes(q) ||
        staff.includes(q) ||
        order.includes(q) ||
        invoice.includes(q)
      );
    });

    return filtered.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return 0;
    });
  }, [dateShipments, statusFilter, searchQuery]);

  const handleCopyAwb = (e: React.MouseEvent, awb: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(awb);
    setCopiedAwb(awb);
    setTimeout(() => setCopiedAwb(null), 2000);
  };

  const handleShareLink = () => {
    const url = window.location.origin + '/viewer';
    navigator.clipboard.writeText(url);
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 2500);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col antialiased select-none pb-12">
      {/* 1. Header (Mobile Optimized Sticky App Bar) */}
      <header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur-md border-b border-slate-800 px-3.5 py-2.5 flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 shrink-0">
            <Plane className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold text-white tracking-tight truncate">貨物進捗ビューア</h1>
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-800 text-emerald-400 border border-emerald-500/30 flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                閲覧専用
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono truncate">
              {lastUpdated.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} 更新
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          {/* Manual Refresh Button */}
          <button
            type="button"
            onClick={handleManualRefresh}
            className={`p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 active:scale-95 text-slate-300 transition-all border border-slate-700 cursor-pointer ${
              isRefreshing ? 'opacity-70' : ''
            }`}
            title="最新データに更新"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          {/* Share Link Button */}
          <button
            type="button"
            onClick={handleShareLink}
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 active:scale-95 text-slate-300 transition-all border border-slate-700 cursor-pointer"
            title="閲覧用URLをコピー"
          >
            <Share2 className="w-4 h-4 text-slate-300" />
          </button>

          {/* Go to Admin Link */}
          <a
            href="/"
            className="px-2 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-[11px] font-semibold flex items-center gap-1 transition-all active:scale-95"
            title="PC管理画面へ移動"
          >
            <ExternalLink className="w-3 h-3" />
            <span className="hidden xs:inline">管理画面</span>
          </a>
        </div>
      </header>

      {/* Share Toast */}
      <AnimatePresence>
        {showShareToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4 text-white" />
            <span>閲覧用URLをコピーしました</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Sticky Date Navigation & Daily Summary */}
      <div className="sticky top-[53px] z-20 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 px-3.5 py-2.5 space-y-2">
        {/* Date Selector Row */}
        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={handlePrevDay}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 text-xs font-semibold flex items-center gap-0.5 border border-slate-700 shrink-0 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="text-[11px]">前日</span>
          </button>

          <div className="flex-1 flex items-center justify-center min-w-0 px-1">
            <div className="relative group flex items-center justify-center w-full max-w-[230px]">
              <div
                className={`w-full flex items-center justify-between gap-1.5 px-3 py-1.5 rounded-xl transition-all duration-150 cursor-pointer active:scale-98 ${
                  dateDisplayInfo.isToday
                    ? 'bg-gradient-to-r from-blue-950/90 via-slate-900/95 to-blue-950/90 border-2 border-blue-500/80 ring-1 ring-blue-400/25 shadow-md shadow-blue-950/80 drop-shadow-sm'
                    : 'bg-slate-900/90 hover:bg-slate-850/90 border border-amber-500/40 hover:border-amber-400/60 shadow-sm shadow-slate-950/50 drop-shadow-xs'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                      dateDisplayInfo.isToday
                        ? 'bg-blue-600/35 text-blue-300 border border-blue-400/40'
                        : 'bg-amber-600/25 text-amber-300 border border-amber-400/40'
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[15px] font-black tracking-normal flex items-center gap-1.5 truncate font-mono">
                    <span className="text-white drop-shadow-xs">{dateDisplayInfo.text}</span>
                    <span
                      className={`text-xs sm:text-[13px] font-extrabold ${
                        dateDisplayInfo.isSunday
                          ? 'text-rose-300'
                          : dateDisplayInfo.isSaturday
                          ? 'text-sky-300'
                          : 'text-slate-100'
                      }`}
                    >
                      {dateDisplayInfo.weekday}
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {dateDisplayInfo.isToday ? (
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-blue-500 text-white tracking-wide shadow-xs shrink-0 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      本日
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                      別日
                    </span>
                  )}
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 transition-colors" />
                </div>
              </div>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                title="タップして日付を変更"
              />
            </div>
          </div>

          <div className="flex items-center space-x-1 shrink-0">
            {selectedDate !== todayKey && (
              <button
                type="button"
                onClick={handleToday}
                className="px-2 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-[11px] font-bold shadow-sm transition-all cursor-pointer"
              >
                今日
              </button>
            )}
            <button
              type="button"
              onClick={handleNextDay}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 text-xs font-semibold flex items-center gap-0.5 border border-slate-700 cursor-pointer"
            >
              <span className="text-[11px]">翌日</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Progress Bar & Key Counts */}
        <div className="bg-slate-900/90 rounded-xl p-2 border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-400 text-[11px]">
              本日案件: <strong className="text-white text-sm">{stats.total}</strong> 件
            </span>
            <span className="text-slate-300 text-[11px] flex items-center gap-1">
              完了 <span className="font-bold text-emerald-400">{stats.completed}</span> / 残り{' '}
              <span className="font-bold text-amber-400">{stats.uncompleted}</span> ({stats.progressRate}%)
            </span>
          </div>

          {/* Visual Progress Bar */}
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden flex">
            <div
              className="bg-emerald-500 h-full transition-all duration-500"
              style={{ width: `${stats.progressRate}%` }}
            />
            <div
              className="bg-amber-500 h-full transition-all duration-500"
              style={{
                width: `${stats.total > 0 ? (stats.inProgress / stats.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 px-3.5 pt-3 space-y-3 max-w-lg mx-auto w-full">
        {/* 3. Cut-off Time Alert Banner (If any approaching cut time on this day) */}
        {cutTimeShipments.length > 0 && (
          <div className="bg-gradient-to-r from-rose-950 via-rose-900/90 to-slate-900 border border-rose-500/80 rounded-xl p-2.5 text-white shadow-md space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-rose-300 font-bold text-xs">
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping inline-block" />
                <Clock className="w-3.5 h-3.5 text-rose-400" />
                <span>カット時間 (CUT TIME) 指定案件:</span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white font-bold text-[10px] flex items-center gap-0.5">
                <Zap className="w-2.5 h-2.5 fill-amber-300 text-amber-300" />
                要確認
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {cutTimeShipments.map((s, idx) => (
                <button
                  key={`${s.id}-${idx}`}
                  type="button"
                  onClick={() => setSelectedShipment(s)}
                  className="inline-flex items-center gap-1.5 px-2 py-1 bg-white/10 hover:bg-white/20 active:scale-95 border border-rose-400/50 rounded-lg text-xs font-bold text-white transition-all cursor-pointer"
                >
                  <span className="font-mono text-rose-200">{s.id}:</span>
                  <span className="font-mono text-amber-300 font-black">⏰ {s.cutTime}</span>
                  <span className="text-[10px] text-slate-200 truncate max-w-[100px]">({s.shipper})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 4. Search & Filter Bar */}
        <div className="space-y-2">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="AWB, 荷主, FLT, DEST, 担当者で検索..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter Pills (Horizontal Scroll) */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'ALL'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              全件 ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('UNCOMPLETED')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'UNCOMPLETED'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              未完了 ({stats.uncompleted})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('In Progress')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'In Progress'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              進行中 ({stats.inProgress})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('Completed')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'Completed'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              完了 ({stats.completed})
            </button>
            {stats.cutTimeCount > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('CUT_TIME')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  statusFilter === 'CUT_TIME'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-slate-800 text-rose-300 hover:bg-slate-700'
                }`}
              >
                ⏰ カット指定 ({stats.cutTimeCount})
              </button>
            )}
          </div>
        </div>

        {/* 5. Shipment Cards List */}
        <div className="space-y-2.5">
          {displayedShipments.length === 0 ? (
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-8 text-center space-y-2">
              <Package className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-sm font-bold text-slate-400">対象の貨物案件はありません</p>
              <p className="text-xs text-slate-500">
                {searchQuery ? '検索条件を変更してください' : '選択日の案件は登録されていません'}
              </p>
            </div>
          ) : (
            displayedShipments.map((s, idx) => {
              const completedTasks = s.tasks?.filter((t) => t.status === 'Completed').length || 0;
              const totalTasks = s.tasks?.length || 0;
              const taskPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

              return (
                <motion.div
                  key={`${s.id}-${idx}`}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedShipment(s)}
                  className={`bg-slate-950 border rounded-xl p-3.5 space-y-2.5 shadow-sm transition-all cursor-pointer ${
                    s.status === 'Completed'
                      ? 'border-emerald-500/30 hover:border-emerald-500/60'
                      : s.status === 'In Progress'
                      ? 'border-amber-500/40 hover:border-amber-500/70 bg-gradient-to-br from-slate-950 to-slate-900/60'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Card Top Row: Status Badge & AWB */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center space-x-2 min-w-0">
                      {/* Status Tag */}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 flex items-center gap-1 ${
                          s.status === 'Completed'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : s.status === 'In Progress'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        {s.status === 'Completed' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            完了
                          </>
                        ) : s.status === 'In Progress' ? (
                          <>
                            <Clock className="w-3 h-3 text-amber-300 animate-spin" />
                            進行中
                          </>
                        ) : (
                          <>
                            <Circle className="w-3 h-3 text-slate-400" />
                            未着手
                          </>
                        )}
                      </span>

                      {/* AWB Number */}
                      <div className="flex items-center space-x-1.5 min-w-0">
                        <span className="font-mono font-black text-base text-white tracking-tight truncate">
                          {s.mawbNumber || s.id}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleCopyAwb(e, s.mawbNumber || s.id)}
                          className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
                          title="AWB番号をコピー"
                        >
                          {copiedAwb === (s.mawbNumber || s.id) ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Cut Time Badge */}
                    {s.cutTime && (
                      <span className="px-2 py-0.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono font-bold text-xs shrink-0 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-rose-400" />
                        {s.cutTime} CUT
                      </span>
                    )}
                  </div>

                  {/* Priority Badges */}
                  {(s.isPinned || s.isUrgent || s.isImportant || s.isDgCargo || s.hawbNumber) && (
                    <div className="flex flex-wrap items-center gap-1">
                      {s.isPinned && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-600 border border-blue-400 text-white text-[10px] font-bold flex items-center gap-0.5 shadow-2xs">
                          <span>📌</span>
                          <span>固定中</span>
                        </span>
                      )}
                      {s.hawbNumber && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-950/70 border border-indigo-500/40 text-indigo-300 text-[10px] font-mono font-bold">
                          HAWB: {s.hawbNumber}
                        </span>
                      )}
                      {s.isUrgent && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-950 border border-rose-500 text-rose-300 text-[10px] font-bold flex items-center gap-0.5">
                          <Flame className="w-2.5 h-2.5 text-rose-400 fill-rose-400" />
                          緊急
                        </span>
                      )}
                      {s.isImportant && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-950 border border-amber-500 text-amber-300 text-[10px] font-bold flex items-center gap-0.5">
                          <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                          重要
                        </span>
                      )}
                      {s.isDgCargo && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-950 border border-purple-500 text-purple-300 text-[10px] font-bold flex items-center gap-0.5">
                          <AlertTriangle className="w-2.5 h-2.5 text-purple-400" />
                          DG品
                        </span>
                      )}
                    </div>
                  )}

                  {/* Card Main Info Grid */}
                  <div className="space-y-1.5 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 text-xs">
                    {/* Shipper & Consignee Row */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-slate-400 text-[10px] font-medium">荷主 (Shipper)</div>
                        <div className="font-semibold text-slate-100 truncate text-xs" title={s.shipper}>
                          {s.shipper || '-'}
                        </div>
                      </div>
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-slate-400 text-[10px] font-medium">荷受人 (Consignee)</div>
                        <div className="font-semibold text-indigo-300 truncate text-xs" title={s.consignee}>
                          {s.consignee || '-'}
                        </div>
                      </div>
                    </div>

                    {/* Flight & Destination / Pieces & Weight / Operator Row */}
                    <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-800/60">
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-slate-400 text-[10px] font-medium">向地 / FLT</div>
                        <div className="font-semibold text-slate-100 truncate text-xs flex items-center gap-0.5">
                          <span className="font-bold text-blue-300">{s.destination || '-'}</span>
                          <span className="text-slate-500">/</span>
                          <span className="text-slate-300">{s.flightRoute || '-'}</span>
                        </div>
                      </div>

                      <div className="space-y-0.5 min-w-0">
                        <div className="text-slate-400 text-[10px] font-medium">個数 / 重量</div>
                        <div className="font-mono text-slate-200 text-xs truncate">
                          <span>{s.pieces || '-'}</span>
                          <span className="text-slate-500"> / </span>
                          <span>{s.grossWeight || '-'}</span>
                        </div>
                      </div>

                      <div className="space-y-0.5 min-w-0">
                        <div className="text-slate-400 text-[10px] font-medium">担当者</div>
                        <div className="text-slate-200 text-xs truncate flex items-center gap-0.5">
                          <UserIcon className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                          <span>{s.assignedOperator?.name || '未割当'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Task Progress Bar & Badges */}
                  {totalTasks > 0 && (
                    <div className="space-y-1.5 pt-0.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 font-medium">作業工程進捗</span>
                        <span className="font-semibold text-slate-300">
                          {completedTasks}/{totalTasks} 完了 ({taskPercent}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            s.status === 'Completed' ? 'bg-emerald-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${taskPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Card Bottom: Notes count & Open Detail Indicator */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-900 text-[11px] text-slate-400">
                    <div className="flex items-center space-x-2">
                      {s.comments && s.comments.length > 0 && (
                        <span className="flex items-center gap-0.5 text-blue-400">
                          <MessageSquare className="w-3 h-3" />
                          {s.comments.length}
                        </span>
                      )}
                      {s.hasCustomPdf && (
                        <span className="flex items-center gap-0.5 text-emerald-400">
                          <FileText className="w-3 h-3" />
                          PDF添付
                        </span>
                      )}
                    </div>
                    <span className="text-blue-400 font-medium flex items-center gap-0.5">
                      詳細を確認 →
                    </span>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </main>

      {/* 6. Read-Only Detail Modal / Bottom Sheet */}
      <AnimatePresence>
        {selectedShipment && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-sm">
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            >
              {/* Bottom Sheet Header */}
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        selectedShipment.status === 'Completed'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : selectedShipment.status === 'In Progress'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {selectedShipment.status === 'Completed'
                        ? '完了'
                        : selectedShipment.status === 'In Progress'
                        ? '進行中'
                        : '未着手'}
                    </span>
                    <span className="font-mono font-black text-base text-white truncate">
                      {selectedShipment.mawbNumber || selectedShipment.id}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 truncate mt-0.5">{selectedShipment.shipper}</p>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedShipment(null)}
                  className="p-2 rounded-full bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex items-center border-b border-slate-800 bg-slate-950/60 px-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveDetailTab('info')}
                  className={`flex-1 py-2.5 text-xs font-bold border-b-2 text-center transition-colors cursor-pointer ${
                    activeDetailTab === 'info'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  基本情報
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDetailTab('tasks')}
                  className={`flex-1 py-2.5 text-xs font-bold border-b-2 text-center transition-colors cursor-pointer ${
                    activeDetailTab === 'tasks'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  作業工程 ({selectedShipment.tasks?.length || 0})
                </button>
                {selectedShipment.comments && selectedShipment.comments.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveDetailTab('notes')}
                    className={`flex-1 py-2.5 text-xs font-bold border-b-2 text-center transition-colors cursor-pointer ${
                      activeDetailTab === 'notes'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    社内メモ ({selectedShipment.comments.length})
                  </button>
                )}
                {selectedShipment.hasCustomPdf && (
                  <button
                    type="button"
                    onClick={() => setActiveDetailTab('pdf')}
                    className={`flex-1 py-2.5 text-xs font-bold border-b-2 text-center transition-colors cursor-pointer ${
                      activeDetailTab === 'pdf'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    添付PDF
                  </button>
                )}
              </div>

              {/* Tab Content Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                {activeDetailTab === 'info' && (
                  <div className="space-y-3">
                    {/* Key Attributes Box */}
                    <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800 space-y-2.5">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-slate-500 block text-[10.5px]">通関日 (仕立日)</span>
                          <span className="font-bold text-slate-200">
                            {selectedShipment.customsClearanceDate || '-'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10.5px]">カット時間 (CUT TIME)</span>
                          <span className="font-bold text-rose-300 font-mono">
                            {selectedShipment.cutTime ? `⏰ ${selectedShipment.cutTime}` : '指定なし'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10.5px]">向地 (DEST)</span>
                          <span className="font-bold text-blue-400">{selectedShipment.destination || '-'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10.5px]">フライト / ルート</span>
                          <span className="font-bold text-slate-200">{selectedShipment.flightRoute || '-'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10.5px]">個数 (PCS)</span>
                          <span className="font-mono text-slate-200">{selectedShipment.pieces || '-'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10.5px]">総重量 (GW)</span>
                          <span className="font-mono text-slate-200">{selectedShipment.grossWeight || '-'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10.5px]">受注NO.</span>
                          <span className="font-mono text-slate-200">{selectedShipment.orderNumber || '-'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10.5px]">INVOICE NO.</span>
                          <span className="font-mono text-slate-200">{selectedShipment.invoiceNumber || '-'}</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-900 space-y-1.5">
                        <div>
                          <span className="text-slate-500 block text-[10.5px]">荷主 (Shipper)</span>
                          <span className="font-semibold text-slate-200">{selectedShipment.shipper || '-'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10.5px]">荷受人 (Consignee)</span>
                          <span className="font-semibold text-slate-200">{selectedShipment.consignee || '-'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10.5px]">担当者</span>
                          <span className="font-semibold text-slate-200">
                            {selectedShipment.assignedOperator?.name || '未割当'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Special Notes */}
                    {selectedShipment.specialNotes && (
                      <div className="bg-slate-950 rounded-xl p-3 border border-slate-800 space-y-1">
                        <span className="text-slate-500 block text-[10.5px] font-bold">特記事項 (Notes)</span>
                        <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                          {selectedShipment.specialNotes}
                        </p>
                      </div>
                    )}

                    {/* Customs Email Thread Section (StorageManager connected) */}
                    <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800 space-y-3">
                      {/* Thread Header */}
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                        <div className="flex items-center space-x-2">
                          <div className="w-6 h-6 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
                            <Mail className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-100 text-xs">通関依頼メール スレッド</span>
                              {emailThread.length > 0 && (
                                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-blue-500/20 text-blue-300 font-bold border border-blue-400/30">
                                  {emailThread.length}通
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 block font-mono">
                              AWB: {(selectedShipment as any).primaryKey || selectedShipment.mawbNumber || selectedShipment.id}
                            </span>
                          </div>
                        </div>

                        {emailThread.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (expandedEmailIds.size === emailThread.length) {
                                setExpandedEmailIds(new Set());
                              } else {
                                setExpandedEmailIds(new Set(emailThread.map((e) => e.id)));
                              }
                            }}
                            className="text-[10px] font-medium text-slate-400 hover:text-slate-200 px-2 py-1 rounded bg-slate-900 border border-slate-800 transition-colors"
                          >
                            {expandedEmailIds.size === emailThread.length ? 'すべて折りたたむ' : 'すべて展開'}
                          </button>
                        )}
                      </div>

                      {/* Thread Messages */}
                      {emailThread.length === 0 ? (
                        <div className="p-4 text-center text-slate-500 text-[11px] rounded-lg bg-slate-900/50 border border-dashed border-slate-800">
                          現在この貨物に関連する通関依頼メールログはありません。
                        </div>
                      ) : (
                        <div className="space-y-3 relative before:absolute before:top-3 before:bottom-3 before:left-3.5 before:w-0.5 before:bg-slate-800/80">
                          {emailThread.map((mail, idx) => {
                            const isExpanded = expandedEmailIds.has(mail.id);
                            const isIncoming = mail.direction === 'INCOMING';
                            const isHellmannOrder = mail.type === 'HELLMANN_ORDER';
                            const isCustomsReq = mail.type === 'CUSTOMS_REQUEST';

                            let badgeLabel = '通関メール';
                            let badgeStyle = 'bg-blue-500/10 text-blue-300 border-blue-500/30';
                            let iconBg = 'bg-blue-600 text-white';

                            if (isHellmannOrder) {
                              badgeLabel = '📥 ヘルマン通関依頼 (SI送付)';
                              badgeStyle = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
                              iconBg = 'bg-emerald-600 text-white';
                            } else if (isCustomsReq) {
                              badgeLabel = '📤 輸出通関依頼 (通関士宛)';
                              badgeStyle = 'bg-blue-500/15 text-blue-300 border-blue-500/30';
                              iconBg = 'bg-blue-600 text-white';
                            } else if (mail.type === 'BROKER_QUESTION') {
                              badgeLabel = '❓ 通関士 質疑';
                              badgeStyle = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
                              iconBg = 'bg-amber-600 text-white';
                            } else if (mail.type === 'CUSTOMS_INQUIRY') {
                              badgeLabel = '🔄 ヘルマン照会';
                              badgeStyle = 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
                              iconBg = 'bg-indigo-600 text-white';
                            } else if (mail.type === 'HELLMANN_ANSWER') {
                              badgeLabel = '💡 ヘルマン回答';
                              badgeStyle = 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
                              iconBg = 'bg-cyan-600 text-white';
                            } else if (mail.type === 'BROKER_REPLY') {
                              badgeLabel = '✅ 通関士回答完了';
                              badgeStyle = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
                              iconBg = 'bg-emerald-600 text-white';
                            }

                            const dateDisplay = formatMailDateTime(mail.sentOrReceivedAt);

                            return (
                              <div key={mail.id || idx} className="relative pl-7 text-[11px]">
                                {/* Timeline node icon */}
                                <div
                                  className={`absolute left-1 top-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] ring-4 ring-slate-950 z-10 ${iconBg}`}
                                >
                                  {isIncoming ? (
                                    <ArrowDownLeft className="w-2.5 h-2.5" />
                                  ) : (
                                    <ArrowUpRight className="w-2.5 h-2.5" />
                                  )}
                                </div>

                                {/* Email Message Card */}
                                <div
                                  className={`rounded-xl border transition-colors ${
                                    isExpanded
                                      ? 'bg-slate-900 border-slate-700/80 shadow-md'
                                      : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-900'
                                  }`}
                                >
                                  {/* Card Header (clickable to toggle) */}
                                  <div
                                    onClick={() => toggleExpandEmail(mail.id)}
                                    className="p-2.5 flex flex-col gap-1.5 cursor-pointer"
                                  >
                                    <div className="flex items-center justify-between gap-1">
                                      <span className={`px-2 py-0.5 rounded-md text-[9.5px] font-bold border ${badgeStyle}`}>
                                        {badgeLabel}
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-mono">
                                        {dateDisplay}
                                      </span>
                                    </div>

                                    <div className="flex items-start justify-between gap-2">
                                      <div className="font-semibold text-slate-200 text-xs line-clamp-1 leading-snug">
                                        {mail.subject}
                                      </div>
                                      <div className="text-slate-400 p-0.5 shrink-0">
                                        {isExpanded ? (
                                          <ChevronUp className="w-3.5 h-3.5" />
                                        ) : (
                                          <ChevronDown className="w-3.5 h-3.5" />
                                        )}
                                      </div>
                                    </div>

                                    {/* Sender / Recipient Bar */}
                                    <div className="flex items-center justify-between text-[10px] text-slate-400 gap-1 overflow-hidden">
                                      <span className="truncate">
                                        <span className="text-slate-500">From:</span> {mail.sender.name || mail.sender.email}
                                      </span>
                                      <span className="shrink-0 text-slate-500">➔</span>
                                      <span className="truncate text-right">
                                        <span className="text-slate-500">To:</span> {Array.isArray(mail.toRecipients) && mail.toRecipients.length > 0 ? mail.toRecipients.join(', ') : (mail.toRecipients || 'グループアドレス')}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Collapsed Preview vs Expanded Full Body */}
                                  {isExpanded ? (
                                    <div className="px-2.5 pb-2.5 pt-1 border-t border-slate-800/70 space-y-2 text-[11px] animate-in fade-in duration-100">
                                      {/* Detailed Addresses */}
                                      <div className="bg-slate-950/70 p-2 rounded-lg text-[10px] space-y-0.5 text-slate-400 border border-slate-800/60 font-mono">
                                        <div>
                                          <span className="text-slate-500">差出人:</span> {mail.sender.name} &lt;{mail.sender.email}&gt;
                                        </div>
                                        <div>
                                          <span className="text-slate-500">宛先:</span> {Array.isArray(mail.toRecipients) && mail.toRecipients.length > 0 ? mail.toRecipients.join(', ') : (mail.toRecipients || '未指定')}
                                        </div>
                                        {mail.ccRecipients && (Array.isArray(mail.ccRecipients) ? mail.ccRecipients.length > 0 : !!mail.ccRecipients) && (
                                          <div>
                                            <span className="text-slate-500">CC:</span> {Array.isArray(mail.ccRecipients) ? mail.ccRecipients.join(', ') : mail.ccRecipients}
                                          </div>
                                        )}
                                      </div>

                                      {/* Body Text */}
                                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 text-slate-300 font-mono text-[10.5px] whitespace-pre-wrap leading-relaxed select-text">
                                        {mail.body}
                                      </div>

                                      {/* Attachments */}
                                      {mail.attachments && mail.attachments.length > 0 && (
                                        <div className="space-y-1 pt-1">
                                          <span className="text-[10px] text-slate-400 flex items-center gap-1 font-bold">
                                            <Paperclip className="w-3 h-3 text-blue-400" />
                                            <span>添付書類 ({mail.attachments.length}件):</span>
                                          </span>
                                          <div className="flex flex-wrap gap-1.5">
                                            {mail.attachments.map((att, attIdx) => (
                                              <div
                                                key={att.id || attIdx}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  if (att.isPdf && selectedShipment.pdfDataUrl) {
                                                    setActiveDetailTab('pdf');
                                                  }
                                                }}
                                                className="flex items-center gap-1.5 px-2 py-1 bg-slate-950 border border-slate-800 rounded-lg text-[10px] text-blue-300 hover:border-blue-500/50 hover:bg-slate-900 transition-colors cursor-pointer"
                                              >
                                                <FileText className="w-3 h-3 text-red-400 shrink-0" />
                                                <span className="truncate max-w-[170px]">{att.fileName}</span>
                                                {att.sizeBytes && (
                                                  <span className="text-slate-500 font-mono">
                                                    ({Math.round(att.sizeBytes / 1024)}KB)
                                                  </span>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {/* Action Buttons: Copy Subject / Copy Body */}
                                      <div className="flex items-center justify-end gap-1.5 pt-1">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleCopyEmailContent(mail.id, `件名: ${mail.subject}\n\n${mail.body}`);
                                          }}
                                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] flex items-center gap-1 transition-colors"
                                        >
                                          {copiedEmailTextId === mail.id ? (
                                            <>
                                              <Check className="w-3 h-3 text-emerald-400" />
                                              <span className="text-emerald-300">コピー完了</span>
                                            </>
                                          ) : (
                                            <>
                                              <Copy className="w-3 h-3" />
                                              <span>メール内容をコピー</span>
                                            </>
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div
                                      onClick={() => toggleExpandEmail(mail.id)}
                                      className="px-2.5 pb-2 text-[10.5px] text-slate-400 line-clamp-1 cursor-pointer font-mono"
                                    >
                                      {mail.body.slice(0, 70)}...
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Read-Only Notice */}
                    <div className="p-2.5 rounded-lg bg-blue-950/40 border border-blue-800/40 text-slate-400 text-[11px] flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
                      <span>閲覧専用モードです。データの変更や更新は管理画面で行ってください。</span>
                    </div>
                  </div>
                )}

                {activeDetailTab === 'tasks' && (
                  <div className="space-y-2">
                    <p className="text-slate-400 text-[11px] mb-1">各作業工程のステータス一覧（閲覧のみ）:</p>
                    {selectedShipment.tasks?.map((task, index) => (
                      <div
                        key={task.id || index}
                        className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
                          task.status === 'Completed'
                            ? 'bg-emerald-950/20 border-emerald-500/30 text-slate-200'
                            : task.status === 'In Progress'
                            ? 'bg-amber-950/20 border-amber-500/30 text-slate-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5 min-w-0">
                          {task.status === 'Completed' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : task.status === 'In Progress' ? (
                            <Clock className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-slate-500 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="font-semibold text-xs text-white block truncate">
                              {task.title}
                            </span>
                            {task.completedAt && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                完了日時: {task.completedAt}
                              </span>
                            )}
                          </div>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                            task.status === 'Completed'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : task.status === 'In Progress'
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {task.status === 'Completed'
                            ? '完了'
                            : task.status === 'In Progress'
                            ? '進行中'
                            : '未着手'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {activeDetailTab === 'notes' && (
                  <div className="space-y-2">
                    {selectedShipment.comments?.map((comment) => (
                      <div
                        key={comment.id}
                        className={`p-3 rounded-xl border ${
                          comment.isImportant
                            ? 'bg-rose-950/30 border-rose-500/50'
                            : 'bg-slate-950 border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10.5px] text-slate-400 mb-1">
                          <span className="font-bold text-slate-200">{comment.authorName}</span>
                          <span className="font-mono">{comment.formattedTime}</span>
                        </div>
                        <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">{comment.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                {activeDetailTab === 'pdf' && (
                  <div className="space-y-2">
                    <p className="text-slate-400 text-[11px]">取り込み原本PDF書類プレビュー:</p>
                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden min-h-[300px] flex items-center justify-center">
                      <SiDocumentViewer shipment={selectedShipment} isThumbnail={false} scale={0.7} />
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Sheet Footer */}
              <div className="p-3 border-t border-slate-800 bg-slate-950 flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedShipment(null)}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-bold text-xs transition-colors"
                >
                  閉じる
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
