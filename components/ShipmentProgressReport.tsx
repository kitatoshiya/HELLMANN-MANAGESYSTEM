import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  TooltipProps,
} from 'recharts';
import {
  Shipment,
  TaskStatus,
  Operator,
} from '../types';
import {
  BarChart3,
  TrendingUp,
  CheckCircle2,
  Clock,
  Circle,
  AlertOctagon,
  Star,
  Package,
  Scale,
  Users,
  Calendar,
  Download,
  Printer,
  ChevronRight,
  Filter,
  X,
  Layers,
  ArrowUpRight,
  Sparkles,
  Plane,
} from 'lucide-react';

interface ShipmentProgressReportProps {
  shipments: Shipment[];
  operators?: Operator[];
  isOpen?: boolean;
  onClose?: () => void;
  onSelectShipment?: (shipment: Shipment) => void;
  isEmbedded?: boolean;
}

type ChartViewType = 'daily' | 'weekly' | 'team';
type SummaryPeriodType = 'all' | 'this_month' | 'custom_month' | 'this_week' | 'custom_week';

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Helper to normalize and parse dates
function parseClearanceDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const clean = dateStr.replace(/\//g, '-').trim();
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateJa(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()} (${DAY_NAMES[d.getDay()]})`;
}

function formatFullDateJa(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getWeekRangeFromDate(dateInput: string | Date): { monday: Date; sunday: Date; mondayStr: string; sundayStr: string } {
  const d = typeof dateInput === 'string' ? new Date(dateInput + 'T00:00:00') : new Date(dateInput);
  const target = isNaN(d.getTime()) ? new Date() : d;
  const dayOfWeek = target.getDay(); // 0 is Sunday
  const distanceToMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(target);
  monday.setDate(target.getDate() - distanceToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    monday,
    sunday,
    mondayStr: formatYmd(monday),
    sundayStr: formatYmd(sunday),
  };
}

// Custom Tooltip component for Recharts
interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    payload: Record<string, any>;
  }>;
  label?: string;
}

const CustomBarTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-700 shadow-xl text-xs backdrop-blur-md min-w-[170px] z-50">
        <div className="font-bold text-slate-200 border-b border-slate-800 pb-1.5 mb-2 flex items-center justify-between">
          <span>{label}</span>
        </div>
        <div className="space-y-1.5 font-mono">
          {payload.map((entry, index) => (
            <div key={`item-${index}`} className="flex items-center justify-between space-x-3 text-[11px]">
              <span className="flex items-center space-x-1.5 text-slate-300">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-2xs"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="font-sans text-slate-300">{entry.name}:</span>
              </span>
              <span className="font-bold text-white text-xs">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export const ShipmentProgressReport: React.FC<ShipmentProgressReportProps> = ({
  shipments,
  operators = [],
  isOpen = true,
  onClose,
  onSelectShipment,
  isEmbedded = false,
}) => {
  const [chartView, setChartView] = useState<ChartViewType>('daily');
  const [selectedWeekOffset, setSelectedWeekOffset] = useState<number>(0); // 0 = 今週, -1 = 先週
  const [filterDestination, setFilterDestination] = useState<string>('ALL');

  // Summary Period Filter State
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriodType>('all');
  const [customMonth, setCustomMonth] = useState<string>(currentYm);
  const [customWeekDate, setCustomWeekDate] = useState<string>(currentYmd);

  // Week ranges for Summary
  const thisWeekRange = useMemo(() => getWeekRangeFromDate(new Date()), []);
  const customWeekRange = useMemo(() => getWeekRangeFromDate(customWeekDate), [customWeekDate]);

  // Step helper for custom week
  const handleStepCustomWeek = (offsetWeeks: number) => {
    const current = new Date(customWeekDate + 'T00:00:00');
    const d = isNaN(current.getTime()) ? new Date() : current;
    d.setDate(d.getDate() + offsetWeeks * 7);
    setCustomWeekDate(formatYmd(d));
  };

  // Step helper for custom month
  const handleStepCustomMonth = (offsetMonths: number) => {
    const targetYm = customMonth || currentYm;
    const [yStr, mStr] = targetYm.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const d = new Date(y, m - 1 + offsetMonths, 1);
    setCustomMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // Helper to extract date from shipment
  const getShipmentDateStr = (s: Shipment): string => {
    if (s.customsClearanceDate) {
      return s.customsClearanceDate.replace(/\//g, '-').trim();
    }
    if (s.createdAt) {
      return s.createdAt.slice(0, 10);
    }
    return '';
  };

  // Filtered shipments for the 4 Core Summary Metric KPI Cards
  const { filteredSummaryShipments, periodLabel, periodDetail } = useMemo(() => {
    const nowDate = new Date();
    const thisYm = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;

    if (summaryPeriod === 'all') {
      return {
        filteredSummaryShipments: shipments,
        periodLabel: '全期間',
        periodDetail: '全登録データ',
      };
    }

    if (summaryPeriod === 'this_month') {
      const list = shipments.filter((s) => {
        const d = getShipmentDateStr(s);
        return d.startsWith(thisYm);
      });
      return {
        filteredSummaryShipments: list,
        periodLabel: '今月',
        periodDetail: `${nowDate.getFullYear()}年${nowDate.getMonth() + 1}月`,
      };
    }

    if (summaryPeriod === 'custom_month') {
      const targetYm = customMonth || thisYm;
      const [y, m] = targetYm.split('-');
      const list = shipments.filter((s) => {
        const d = getShipmentDateStr(s);
        return d.startsWith(targetYm);
      });
      return {
        filteredSummaryShipments: list,
        periodLabel: '指定月',
        periodDetail: `${y}年${Number(m)}月`,
      };
    }

    if (summaryPeriod === 'this_week') {
      const { mondayStr, sundayStr, monday, sunday } = thisWeekRange;
      const list = shipments.filter((s) => {
        const d = getShipmentDateStr(s);
        return d >= mondayStr && d <= sundayStr;
      });
      return {
        filteredSummaryShipments: list,
        periodLabel: '今週',
        periodDetail: `${monday.getMonth() + 1}/${monday.getDate()}(月) 〜 ${sunday.getMonth() + 1}/${sunday.getDate()}(日)`,
      };
    }

    if (summaryPeriod === 'custom_week') {
      const { mondayStr, sundayStr, monday, sunday } = customWeekRange;
      const list = shipments.filter((s) => {
        const d = getShipmentDateStr(s);
        return d >= mondayStr && d <= sundayStr;
      });
      return {
        filteredSummaryShipments: list,
        periodLabel: '指定週',
        periodDetail: `${monday.getFullYear()}年${monday.getMonth() + 1}/${monday.getDate()}(月) 〜 ${sunday.getMonth() + 1}/${sunday.getDate()}(日)`,
      };
    }

    return {
      filteredSummaryShipments: shipments,
      periodLabel: '全期間',
      periodDetail: '全登録データ',
    };
  }, [shipments, summaryPeriod, customMonth, customWeekRange, thisWeekRange]);

  // Calculate current week bounds (Monday to Sunday) for Output Analysis Chart
  const currentWeekInfo = useMemo(() => {
    const now = new Date();
    // Offset by selectedWeekOffset weeks
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + selectedWeekOffset * 7);

    const dayOfWeek = targetDate.getDay(); // 0 is Sunday
    // Make Monday the first day (if Sunday (0), treat as 7)
    const distanceToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(targetDate);
    monday.setDate(targetDate.getDate() - distanceToMonday);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }

    return { monday, sunday, days, targetDate };
  }, [selectedWeekOffset]);

  // Summary statistics calculated strictly for the filtered period
  const stats = useMemo(() => {
    const total = filteredSummaryShipments.length;
    const completed = filteredSummaryShipments.filter(
      (s) => s.status === 'Completed' || (s.tasks.length > 0 && s.tasks.every((t) => t.status === 'Completed'))
    ).length;
    const inProgress = filteredSummaryShipments.filter(
      (s) => s.status === 'In Progress' || (s.status !== 'Completed' && s.tasks.some((t) => t.status === 'Completed' || t.status === 'In Progress'))
    ).length;
    const todo = Math.max(0, total - completed - inProgress);
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Total tasks in filtered period
    let totalTasks = 0;
    let completedTasks = 0;
    let inProgressTasks = 0;
    let todoTasks = 0;
    let urgentCount = 0;
    let importantCount = 0;
    let totalPieces = 0;
    let totalWeight = 0;

    filteredSummaryShipments.forEach((s) => {
      if (s.isUrgent) urgentCount++;
      if (s.isImportant) importantCount++;

      // Parse pieces
      if (s.pieces) {
        const pNum = parseFloat(s.pieces.replace(/[^0-9.]/g, ''));
        if (!isNaN(pNum)) totalPieces += pNum;
      }
      // Parse weight
      if (s.grossWeight) {
        const wNum = parseFloat(s.grossWeight.replace(/[^0-9.]/g, ''));
        if (!isNaN(wNum)) totalWeight += wNum;
      }

      s.tasks.forEach((t) => {
        totalTasks++;
        if (t.status === 'Completed') completedTasks++;
        else if (t.status === 'In Progress') inProgressTasks++;
        else todoTasks++;
      });
    });

    const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return {
      total,
      completed,
      inProgress,
      todo,
      completionRate,
      totalTasks,
      completedTasks,
      inProgressTasks,
      todoTasks,
      taskCompletionRate,
      urgentCount,
      importantCount,
      totalPieces,
      totalWeight: Math.round(totalWeight * 10) / 10,
    };
  }, [filteredSummaryShipments]);

  // Daily weekly output data (Monday to Sunday)
  const dailyChartData = useMemo(() => {
    const { days } = currentWeekInfo;

    return days.map((dayDate) => {
      const year = dayDate.getFullYear();
      const month = String(dayDate.getMonth() + 1).padStart(2, '0');
      const day = String(dayDate.getDate()).padStart(2, '0');
      const ymdHyphen = `${year}-${month}-${day}`;
      const ymdSlash = `${year}/${month}/${day}`;

      // Shipments for this date
      const matchingShipments = shipments.filter((s) => {
        if (!s.customsClearanceDate) return false;
        const sDate = s.customsClearanceDate.replace(/\//g, '-').trim();
        return sDate === ymdHyphen || s.customsClearanceDate.trim() === ymdSlash;
      });

      const dayCompletedShipments = matchingShipments.filter(
        (s) => s.status === 'Completed' || (s.tasks.length > 0 && s.tasks.every((t) => t.status === 'Completed'))
      ).length;

      const dayInProgressShipments = matchingShipments.filter(
        (s) => s.status === 'In Progress' || (s.status !== 'Completed' && s.tasks.some((t) => t.status === 'Completed' || t.status === 'In Progress'))
      ).length;

      const dayTodoShipments = Math.max(0, matchingShipments.length - dayCompletedShipments - dayInProgressShipments);

      // Tasks completed for these shipments
      let dayCompletedTasks = 0;
      let dayTotalTasks = 0;
      matchingShipments.forEach((s) => {
        s.tasks.forEach((t) => {
          dayTotalTasks++;
          if (t.status === 'Completed') dayCompletedTasks++;
        });
      });

      const isToday = new Date().toDateString() === dayDate.toDateString();

      return {
        dateStr: ymdHyphen,
        name: `${dayDate.getMonth() + 1}/${dayDate.getDate()} (${DAY_NAMES[dayDate.getDay()]})${isToday ? ' ★今日' : ''}`,
        shortName: `${DAY_NAMES[dayDate.getDay()]}`,
        '完了案件': dayCompletedShipments,
        '進行中案件': dayInProgressShipments,
        '未着手案件': dayTodoShipments,
        '完了タスク数': dayCompletedTasks,
        '総案件数': matchingShipments.length,
        '総タスク数': dayTotalTasks,
      };
    });
  }, [shipments, currentWeekInfo]);

  // Weekly historical comparison (Last 4 weeks)
  const weeklyChartData = useMemo(() => {
    const now = new Date();
    const result = [];

    for (let w = 3; w >= 0; w--) {
      const weekTarget = new Date(now);
      weekTarget.setDate(now.getDate() - w * 7);

      const dayOfWeek = weekTarget.getDay();
      const distanceToMonday = (dayOfWeek + 6) % 7;
      const wMon = new Date(weekTarget);
      wMon.setDate(weekTarget.getDate() - distanceToMonday);
      wMon.setHours(0, 0, 0, 0);

      const wSun = new Date(wMon);
      wSun.setDate(wMon.getDate() + 6);
      wSun.setHours(23, 59, 59, 999);

      const wMonStr = `${wMon.getFullYear()}-${String(wMon.getMonth() + 1).padStart(2, '0')}-${String(wMon.getDate()).padStart(2, '0')}`;
      const wSunStr = `${wSun.getFullYear()}-${String(wSun.getMonth() + 1).padStart(2, '0')}-${String(wSun.getDate()).padStart(2, '0')}`;

      const weekShipments = shipments.filter((s) => {
        if (!s.customsClearanceDate) return false;
        const sDate = s.customsClearanceDate.replace(/\//g, '-').trim();
        return sDate >= wMonStr && sDate <= wSunStr;
      });

      const completedCount = weekShipments.filter(
        (s) => s.status === 'Completed' || (s.tasks.length > 0 && s.tasks.every((t) => t.status === 'Completed'))
      ).length;
      const inProgressCount = weekShipments.filter(
        (s) => s.status === 'In Progress'
      ).length;
      const todoCount = Math.max(0, weekShipments.length - completedCount - inProgressCount);

      let weekCompletedTasks = 0;
      weekShipments.forEach((s) => {
        s.tasks.forEach((t) => {
          if (t.status === 'Completed') weekCompletedTasks++;
        });
      });

      const label = w === 0 ? '今週 (Current)' : w === 1 ? '先週 (Last Wk)' : `${w}週間前`;

      result.push({
        name: label,
        range: `${wMon.getMonth() + 1}/${wMon.getDate()}~${wSun.getMonth() + 1}/${wSun.getDate()}`,
        '完了案件': completedCount,
        '進行中案件': inProgressCount,
        '未着手案件': todoCount,
        '完了タスク数': weekCompletedTasks,
        '総案件数': weekShipments.length,
      });
    }

    return result;
  }, [shipments]);

  // Team operator output comparison
  const teamChartData = useMemo(() => {
    const operatorMap: Record<string, { name: string; completedTasks: number; inProgressTasks: number; todoTasks: number; totalTasks: number; shipmentsCount: number }> = {};

    // Initialize with existing operators
    operators.forEach((op) => {
      const key = op.name || op.email;
      operatorMap[key] = {
        name: op.name,
        completedTasks: 0,
        inProgressTasks: 0,
        todoTasks: 0,
        totalTasks: 0,
        shipmentsCount: 0,
      };
    });

    // Populate from tasks assigned/completed
    shipments.forEach((s) => {
      const assignedOpName = s.assignedOperator?.name;
      if (assignedOpName) {
        if (!operatorMap[assignedOpName]) {
          operatorMap[assignedOpName] = {
            name: assignedOpName,
            completedTasks: 0,
            inProgressTasks: 0,
            todoTasks: 0,
            totalTasks: 0,
            shipmentsCount: 0,
          };
        }
        operatorMap[assignedOpName].shipmentsCount++;
      }

      s.tasks.forEach((t) => {
        const workerName = t.completedBy?.displayName || t.assignedTo?.displayName || '未割当';
        if (!operatorMap[workerName]) {
          operatorMap[workerName] = {
            name: workerName,
            completedTasks: 0,
            inProgressTasks: 0,
            todoTasks: 0,
            totalTasks: 0,
            shipmentsCount: 0,
          };
        }

        operatorMap[workerName].totalTasks++;
        if (t.status === 'Completed') {
          operatorMap[workerName].completedTasks++;
        } else if (t.status === 'In Progress') {
          operatorMap[workerName].inProgressTasks++;
        } else {
          operatorMap[workerName].todoTasks++;
        }
      });
    });

    return Object.values(operatorMap)
      .filter((d) => d.totalTasks > 0 || d.shipmentsCount > 0)
      .sort((a, b) => b.completedTasks - a.completedTasks)
      .map((item) => ({
        name: item.name,
        '完了タスク数': item.completedTasks,
        '進行中タスク数': item.inProgressTasks,
        '未着手タスク数': item.todoTasks,
        '担当案件数': item.shipmentsCount,
      }));
  }, [shipments, operators]);

  // Destination / Shipper distribution summary
  const destinationSummary = useMemo(() => {
    const map: Record<string, { total: number; completed: number; inProgress: number }> = {};
    shipments.forEach((s) => {
      const dest = s.destination || s.consignee || '未設定';
      if (!map[dest]) map[dest] = { total: 0, completed: 0, inProgress: 0 };
      map[dest].total++;
      if (s.status === 'Completed') map[dest].completed++;
      else if (s.status === 'In Progress') map[dest].inProgress++;
    });

    return Object.entries(map)
      .map(([name, val]) => ({
        name,
        total: val.total,
        completed: val.completed,
        inProgress: val.inProgress,
        rate: Math.round((val.completed / val.total) * 100),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [shipments]);

  // CSV Export handler (exports currently filtered summary range)
  const handleExportCSV = () => {
    try {
      const headers = [
        '案件ID(HAWB/MAWB)',
        'MAWB番号',
        'HAWB番号',
        '通関日',
        '荷主(Shipper)',
        '向け地(Consignee)',
        'ステータス',
        '完了率',
        'タスク総数',
        '完了タスク数',
        '緊急',
        '重要',
        '個数',
        '総重量(kg)',
      ];

      const rows = filteredSummaryShipments.map((s) => {
        const completedT = s.tasks.filter((t) => t.status === 'Completed').length;
        const totalT = s.tasks.length;
        const rate = totalT > 0 ? `${Math.round((completedT / totalT) * 100)}%` : '0%';
        return [
          `"${s.id}"`,
          `"${s.mawbNumber}"`,
          `"${s.hawbNumber || ''}"`,
          `"${s.customsClearanceDate || ''}"`,
          `"${(s.shipper || '').replace(/"/g, '""')}"`,
          `"${(s.consignee || '').replace(/"/g, '""')}"`,
          `"${s.status === 'Completed' ? '完了' : s.status === 'In Progress' ? '進行中' : '未着手'}"`,
          `"${rate}"`,
          totalT,
          completedT,
          s.isUrgent ? '緊急' : '',
          s.isImportant ? '重要' : '',
          `"${s.pieces || ''}"`,
          `"${s.grossWeight || ''}"`,
        ].join(',');
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute(
        'download',
        `輸出進捗サマリー_${periodLabel}_${new Date().toISOString().slice(0, 10)}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      alert('CSVエクスポートに失敗しました。');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen && !isEmbedded) return null;

  const content = (
    <div className="space-y-6">
      {/* Header Banner & Summary Controls */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 shrink-0">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <span>輸出進捗サマリー & チーム週間アウトプット分析</span>
                <span className="px-2 py-0.5 text-[11px] font-extrabold bg-blue-100 text-blue-800 rounded-full border border-blue-200">
                  Live Report
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                全案件のリアルタイム進捗状況・タスク達成率・チーム週間アウトプットの可視化
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons: Week Switcher, CSV Export, Print, Close */}
        <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
          {/* CSV Export Button */}
          <button
            type="button"
            onClick={handleExportCSV}
            className="inline-flex items-center px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl shadow-2xs transition-all active:scale-95 cursor-pointer"
            title="選択中期間の進捗サマリーをCSVファイルとして保存"
          >
            <Download className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
            <span>CSV出力</span>
          </button>

          {/* Print Button */}
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl shadow-2xs transition-all active:scale-95 cursor-pointer"
            title="サマリーレポートを印刷"
          >
            <Printer className="w-3.5 h-3.5 mr-1.5 text-slate-600" />
            <span>印刷</span>
          </button>

          {!isEmbedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              title="閉じる"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Summary Period Filter Bar */}
      <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-3 sm:p-3.5 shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mr-1.5 shrink-0">
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            <span>サマリー集計期間:</span>
          </span>

          {/* 5 Period Selection Buttons */}
          <div className="inline-flex items-center p-0.5 bg-slate-200/80 rounded-xl border border-slate-300/80 gap-0.5">
            <button
              type="button"
              onClick={() => setSummaryPeriod('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                summaryPeriod === 'all'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              全期間
            </button>
            <button
              type="button"
              onClick={() => setSummaryPeriod('this_month')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                summaryPeriod === 'this_month'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              今月
            </button>
            <button
              type="button"
              onClick={() => setSummaryPeriod('custom_month')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                summaryPeriod === 'custom_month'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              指定月
            </button>
            <button
              type="button"
              onClick={() => setSummaryPeriod('this_week')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                summaryPeriod === 'this_week'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              今週
            </button>
            <button
              type="button"
              onClick={() => setSummaryPeriod('custom_week')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                summaryPeriod === 'custom_week'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              指定週
            </button>
          </div>
        </div>

        {/* Dynamic Period Detail / Pickers */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {summaryPeriod === 'custom_month' && (
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-xl border border-slate-300 shadow-2xs">
              <button
                type="button"
                onClick={() => handleStepCustomMonth(-1)}
                className="px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                title="前月へ"
              >
                ← 前月
              </button>
              <input
                type="month"
                value={customMonth}
                onChange={(e) => setCustomMonth(e.target.value)}
                className="text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer font-mono"
              />
              <button
                type="button"
                onClick={() => handleStepCustomMonth(1)}
                className="px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                title="翌月へ"
              >
                翌月 →
              </button>
            </div>
          )}

          {summaryPeriod === 'custom_week' && (
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-xl border border-slate-300 shadow-2xs">
              <button
                type="button"
                onClick={() => handleStepCustomWeek(-1)}
                className="px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                title="前週へ"
              >
                ← 前週
              </button>
              <input
                type="date"
                value={customWeekDate}
                onChange={(e) => setCustomWeekDate(e.target.value)}
                className="text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer font-mono"
                title="週に含まれる任意の日付を選択"
              />
              <button
                type="button"
                onClick={() => handleStepCustomWeek(1)}
                className="px-1.5 py-0.5 text-[11px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                title="翌週へ"
              >
                翌週 →
              </button>
            </div>
          )}

          {/* Active Period & Match Count Badge */}
          <div className="flex items-center gap-1.5 bg-blue-50 text-blue-900 border border-blue-200/80 px-2.5 py-1 rounded-xl font-medium">
            <span className="text-[11px] text-blue-600 font-bold">対象:</span>
            <span className="font-bold">{periodDetail}</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600 text-[11px]">
              該当 <strong className="font-mono text-blue-700 font-black">{stats.total}</strong> 件
            </span>
          </div>
        </div>
      </div>

      {/* 4 Core Summary Metric KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* KPI 1: Overall Shipments & Completion Rate */}
        <div className="bg-gradient-to-br from-white to-slate-50 border border-slate-200/90 rounded-2xl p-4 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">
              {summaryPeriod === 'all' ? '全案件数 & 完了率' : '対象案件数 & 完了率'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <span className="text-2xl font-black text-slate-900 font-mono">{stats.total}</span>
              <span className="text-xs text-slate-400 ml-1 font-medium">件</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-black text-emerald-600 font-mono">{stats.completionRate}%</span>
              <span className="text-[10px] text-slate-400 block font-medium">完了達成</span>
            </div>
          </div>
          {/* Progress Bar */}
          <div className="w-full bg-slate-100 h-2 rounded-full mt-2.5 overflow-hidden border border-slate-200/60">
            <div
              className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500"
              style={{ width: `${stats.completionRate}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-medium">
            <span className="text-emerald-700 font-bold">完了 {stats.completed}</span>
            <span className="text-amber-700 font-bold">進行中 {stats.inProgress}</span>
            <span className="text-slate-600 font-bold">未着手 {stats.todo}</span>
          </div>
        </div>

        {/* KPI 2: Total Engineering Tasks & Progress */}
        <div className="bg-gradient-to-br from-white to-slate-50 border border-slate-200/90 rounded-2xl p-4 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">工程タスク消化率</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <span className="text-2xl font-black text-slate-900 font-mono">{stats.completedTasks}</span>
              <span className="text-xs text-slate-400 ml-1 font-medium">/ {stats.totalTasks} 件</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-black text-blue-600 font-mono">{stats.taskCompletionRate}%</span>
              <span className="text-[10px] text-slate-400 block font-medium">タスク消化</span>
            </div>
          </div>
          {/* Progress Bar */}
          <div className="w-full bg-slate-100 h-2 rounded-full mt-2.5 overflow-hidden border border-slate-200/60">
            <div
              className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${stats.taskCompletionRate}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-medium">
            <span className="text-slate-500">残タスク: <strong className="text-amber-600">{stats.inProgressTasks + stats.todoTasks}</strong> 件</span>
            <span className="text-blue-600 font-bold">進行中: {stats.inProgressTasks}</span>
          </div>
        </div>

        {/* KPI 3: Urgent & Important Attention Items */}
        <div className="bg-gradient-to-br from-white to-slate-50 border border-slate-200/90 rounded-2xl p-4 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">優先対応アラート</span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertOctagon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-center space-x-3">
            <div className="flex items-center space-x-1.5 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-xl">
              <span className="text-base font-black text-rose-600 font-mono">{stats.urgentCount}</span>
              <span className="text-[11px] font-bold text-rose-700">⚡緊急案件</span>
            </div>
            <div className="flex items-center space-x-1.5 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-xl">
              <span className="text-base font-black text-amber-600 font-mono">{stats.importantCount}</span>
              <span className="text-[11px] font-bold text-amber-700">★重要案件</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 font-medium leading-tight">
            締切間近または最優先対応が必要な貨物
          </p>
        </div>

        {/* KPI 4: Total Cargo Volume & Gross Weight */}
        <div className="bg-gradient-to-br from-white to-slate-50 border border-slate-200/90 rounded-2xl p-4 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">貨物取扱総量 (集計)</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <span className="text-xl font-black text-slate-900 font-mono">{stats.totalPieces.toLocaleString()}</span>
              <span className="text-xs text-slate-500 ml-1 font-medium">個 (PCS)</span>
            </div>
            <div className="text-right">
              <span className="text-xl font-black text-indigo-700 font-mono">{stats.totalWeight.toLocaleString()}</span>
              <span className="text-xs text-slate-500 ml-1 font-medium">kg (GW)</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-400 font-medium truncate" title={`${periodLabel} (${periodDetail}) の仕立・通関対象貨物ボリューム`}>
            {summaryPeriod === 'all' ? '全登録案件の仕立・通関対象貨物ボリューム' : `${periodLabel} (${periodDetail}) の貨物ボリューム`}
          </p>
        </div>
      </div>

      {/* Main Weekly Output Visualization Card (Recharts Bar Chart) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
        {/* Bar Chart Header & View Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2.5">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {chartView === 'daily'
                  ? `チーム週間アウトプット分析 (${formatDateJa(currentWeekInfo.monday)} ~ ${formatDateJa(currentWeekInfo.sunday)})`
                  : chartView === 'weekly'
                  ? '過去4週間の案件・タスク消化推移'
                  : '担当オペレーター別タスク完了実績'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {chartView === 'daily'
                  ? '曜日ごとの完了案件・進行中案件および完了タスク数'
                  : chartView === 'weekly'
                  ? '週ごとの処理完了キャパシティと業務量の推移'
                  : 'チームメンバーごとの完了実績と現在負荷状況'}
              </p>
            </div>
          </div>

          {/* Switchers */}
          <div className="flex items-center space-x-2 shrink-0">
            {chartView === 'daily' && (
              <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedWeekOffset((prev) => prev - 1)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-700 hover:bg-white transition-all cursor-pointer"
                >
                  ← 先週
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedWeekOffset(0)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    selectedWeekOffset === 0 ? 'bg-white text-blue-700 shadow-2xs font-extrabold' : 'text-slate-600'
                  }`}
                >
                  今週
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedWeekOffset((prev) => prev + 1)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-700 hover:bg-white transition-all cursor-pointer"
                >
                  翌週 →
                </button>
              </div>
            )}

            {/* View Mode Toggle: Daily / Weekly / Team */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs border border-slate-200">
              <button
                type="button"
                onClick={() => setChartView('daily')}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  chartView === 'daily' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                日別 (週間)
              </button>
              <button
                type="button"
                onClick={() => setChartView('weekly')}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  chartView === 'weekly' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                週次推移
              </button>
              <button
                type="button"
                onClick={() => setChartView('team')}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  chartView === 'team' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                担当者別
              </button>
            </div>
          </div>
        </div>

        {/* Recharts Chart Area */}
        <div className="w-full h-72 sm:h-80 pt-2">
          {chartView === 'daily' ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dailyChartData}
                margin={{ top: 10, right: 15, left: -15, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#64748B', fontWeight: 600 }}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                />
                <Tooltip content={<CustomBarTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: 10, fontSize: 12 }}
                  iconType="circle"
                />
                <Bar
                  dataKey="完了案件"
                  fill="#10B981"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                />
                <Bar
                  dataKey="進行中案件"
                  fill="#F59E0B"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                />
                <Bar
                  dataKey="完了タスク数"
                  fill="#3B82F6"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : chartView === 'weekly' ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={weeklyChartData}
                margin={{ top: 10, right: 15, left: -15, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#64748B', fontWeight: 600 }}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                />
                <Tooltip content={<CustomBarTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: 10, fontSize: 12 }}
                  iconType="circle"
                />
                <Bar
                  dataKey="完了案件"
                  fill="#10B981"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={45}
                />
                <Bar
                  dataKey="進行中案件"
                  fill="#F59E0B"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={45}
                />
                <Bar
                  dataKey="完了タスク数"
                  fill="#6366F1"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={45}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={teamChartData}
                margin={{ top: 10, right: 15, left: -15, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#64748B', fontWeight: 600 }}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                />
                <Tooltip content={<CustomBarTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: 10, fontSize: 12 }}
                  iconType="circle"
                />
                <Bar
                  dataKey="完了タスク数"
                  fill="#10B981"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={38}
                />
                <Bar
                  dataKey="進行中タスク数"
                  fill="#F59E0B"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={38}
                />
                <Bar
                  dataKey="未着手タスク数"
                  fill="#94A3B8"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={38}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Destination Breakdown & Detailed Status Breakdown Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Destination & Route Output Distribution */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
              <Plane className="w-4 h-4 text-blue-600" />
              <span>向け地・航路別 進捗分布 (Top 8)</span>
            </h3>
            <span className="text-[11px] text-slate-400 font-mono">完了率</span>
          </div>

          <div className="space-y-2.5">
            {destinationSummary.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs">データがありません。</div>
            ) : (
              destinationSummary.map((item) => (
                <div key={item.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 truncate max-w-[200px]" title={item.name}>
                      {item.name}
                    </span>
                    <div className="flex items-center space-x-2 text-[11px] font-mono">
                      <span className="text-slate-500">全 {item.total} 件</span>
                      <span className="text-emerald-600 font-bold">({item.completed} 完了)</span>
                      <span className="font-bold text-slate-900 w-9 text-right">{item.rate}%</span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full rounded-full transition-all duration-300"
                      style={{ width: `${item.rate}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Active Uncompleted Attention List */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
              <Clock className="w-4 h-4 text-amber-600" />
              <span>現在進行中・要注意案件リスト</span>
            </h3>
            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
              {stats.inProgress} 件進行中
            </span>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {shipments
              .filter((s) => s.status !== 'Completed')
              .sort((a, b) => (b.isUrgent ? 1 : 0) - (a.isUrgent ? 1 : 0))
              .slice(0, 6)
              .map((s, idx) => {
                const completedTasks = s.tasks.filter((t) => t.status === 'Completed').length;
                const totalTasks = s.tasks.length;
                const currentTask = s.tasks.find((t) => t.status === 'In Progress') || s.tasks.find((t) => t.status === 'Todo');

                return (
                  <div
                    key={`${s.id}-${idx}`}
                    onClick={() => onSelectShipment && onSelectShipment(s)}
                    className="p-2.5 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/20 transition-all cursor-pointer flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-1.5 flex-wrap">
                        {s.isUrgent && (
                          <span className="px-1.5 py-0.5 text-[9px] font-extrabold bg-rose-600 text-white rounded">
                            ⚡緊急
                          </span>
                        )}
                        {s.isImportant && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold bg-amber-500 text-white rounded">
                            ★重要
                          </span>
                        )}
                        <span className="font-bold text-xs text-slate-900 font-mono">{s.id}</span>
                        <span className="text-[11px] text-slate-500 truncate">({s.consignee})</span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5 truncate">
                        現在工程: <span className="font-semibold text-amber-800">{currentTask?.title || '未設定'}</span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xs font-mono font-bold text-slate-700">
                        {completedTasks}/{totalTasks}
                      </span>
                      <span className="text-[10px] text-slate-400 block font-mono">
                        {s.customsClearanceDate ? s.customsClearanceDate.slice(5) : '-'}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );

  // If embedded mode, render directly inline
  if (isEmbedded) {
    return <div className="w-full">{content}</div>;
  }

  // Modal mode
  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-6 overflow-y-auto animate-fadeIn">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2 }}
        className="bg-slate-50 border border-slate-200 rounded-3xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        <div className="overflow-y-auto p-5 sm:p-7 space-y-6">
          {content}
        </div>
      </motion.div>
    </div>
  );
};
