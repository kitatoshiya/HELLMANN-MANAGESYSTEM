import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { Shipment, Task, TaskStatus } from '../types';
import {
  Clock,
  CheckCircle2,
  Circle,
  ArrowRight,
  User,
  Zap,
  Star,
  Flame,
  Check,
  ChevronRight,
  Calendar,
  AlertCircle,
  CheckSquare,
  Search,
  Layers,
  Plane,
  Package,
  Pin,
  FileText,
  Maximize2,
  MapPin,
  MessageSquare,
  MessageSquareText,
  Sparkles,
  HelpCircle,
} from 'lucide-react';
import { updateTaskStatus, togglePinShipment } from '../lib/storageManager';
import { isHeavyShipment, isImportantShipment } from '../lib/awbUtils';
import { getCustomsQaDashboardBadge } from '../lib/m365EmailService';
import { PdfZoomModal } from './PdfZoomModal';

interface GanttChartViewProps {
  shipments: Shipment[];
  dateLabel: string;
  dateKey: string;
  onSelectShipment: (shipment: Shipment) => void;
}

export const GanttChartView: React.FC<GanttChartViewProps> = ({
  shipments,
  dateLabel,
  dateKey,
  onSelectShipment,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'IN_PROGRESS' | 'UNCOMPLETED'>('ALL');
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [zoomShipment, setZoomShipment] = useState<Shipment | null>(null);
  const [animatingTask, setAnimatingTask] = useState<{ id: string; type: 'complete' | 'deflate' } | null>(null);

  // Filter shipments based on search & filterMode
  const filteredShipments = shipments.filter((s) => {
    const matchesSearch =
      s.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.shipper.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.consignee.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.mawbNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.hawbNumber && s.hawbNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (s.destination && s.destination.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterMode === 'IN_PROGRESS') {
      return s.status === 'In Progress' || s.tasks.some((t) => t.status === 'In Progress');
    }
    if (filterMode === 'UNCOMPLETED') {
      return s.status !== 'Completed';
    }
    return true;
  });

  const handleTaskStatusToggle = (e: React.MouseEvent, shipmentId: string, task: Task) => {
    e.stopPropagation();
    const isNowCompleting = task.status !== 'Completed';
    const nextStatus: TaskStatus = isNowCompleting ? 'Completed' : 'Todo';
    const taskKey = `${shipmentId}-${task.id}`;

    if (isNowCompleting) {
      // 派手な完了アニメーション & 紙吹雪エフェクト
      setAnimatingTask({ id: taskKey, type: 'complete' });

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (rect.left + rect.width / 2) / window.innerWidth;
      const y = (rect.top + rect.height / 2) / window.innerHeight;

      // 鮮やかな2連打コンフェッティ（紙吹雪＆ゴールドスター）
      try {
        confetti({
          particleCount: 45,
          spread: 65,
          origin: { x, y },
          colors: ['#10B981', '#34D399', '#6EE7B7', '#F59E0B', '#3B82F6', '#EC4899'],
          ticks: 180,
          gravity: 1.1,
          scalar: 0.9,
          shapes: ['circle', 'square'],
        });

        setTimeout(() => {
          confetti({
            particleCount: 25,
            angle: 90,
            spread: 90,
            origin: { x, y: Math.max(0, y - 0.05) },
            colors: ['#10B981', '#FBBF24', '#60A5FA'],
            ticks: 150,
            gravity: 1.2,
            scalar: 1.1,
          });
        }, 120);
      } catch {
        // Safe fallback
      }
    } else {
      // 萎む感じのアニメーション (Deflation effect)
      setAnimatingTask({ id: taskKey, type: 'deflate' });
    }

    setTimeout(() => {
      setAnimatingTask((prev) => (prev?.id === taskKey ? null : prev));
    }, 900);

    updateTaskStatus(shipmentId, task.id, nextStatus);
  };

  if (shipments.length === 0) {
    return (
      <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-8 text-center">
        <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
        <p className="text-xs font-bold text-slate-600">選択された通関日 ({dateLabel}) の案件データはありません</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Gantt View Controls & Filter Bar */}
      <div className="bg-slate-50/90 p-3.5 rounded-2xl border-2 border-slate-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Left: Legend and Count */}
        <div className="flex items-center space-x-3 flex-wrap gap-y-1.5 text-xs">
          <span className="font-bold text-slate-800 flex items-center space-x-1.5">
            <Layers className="w-4 h-4 text-blue-600" />
            <span>対象貨物: <strong className="text-blue-700 font-mono text-sm font-black">{filteredShipments.length}</strong> 件</span>
          </span>

          <div className="h-4 w-px bg-slate-300 hidden sm:block" />

          {/* Status Legends */}
          <div className="flex items-center space-x-2 text-[11px]">
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

        {/* Right: Search & Filter Switcher */}
        <div className="flex items-center space-x-2 shrink-0">
          <div className="relative w-48 sm:w-60">
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
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center bg-white p-0.5 border-2 border-slate-200 rounded-lg text-xs shadow-2xs">
            <button
              onClick={() => setFilterMode('ALL')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                filterMode === 'ALL' ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              すべて
            </button>
            <button
              onClick={() => setFilterMode('IN_PROGRESS')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                filterMode === 'IN_PROGRESS' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              進行中のみ
            </button>
          </div>
        </div>
      </div>

      {/* Main Gantt Chart Table Canvas */}
      <div className="bg-white rounded-2xl border-2 border-slate-300 shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            {/* Table Header Row */}
            <div className="grid grid-cols-12 bg-slate-100/90 border-b border-slate-200 text-[11px] font-bold text-slate-700 uppercase tracking-wider py-2.5 px-4 items-center">
              <div className="col-span-4 sm:col-span-3 flex items-center space-x-1.5">
                <Plane className="w-3.5 h-3.5 text-blue-600" />
                <span>貨物案件情報 (通関日: {dateKey})</span>
              </div>
              <div className="col-span-8 sm:col-span-9 flex items-center justify-between px-2">
                <span>進行ステップ & 予定ステータス タイムラインガント</span>
                <span className="text-[10px] text-slate-500 font-normal">※ ステップクリックで予定 ↔ 完了 切替</span>
              </div>
            </div>

            {/* Shipment Rows */}
            <div className="divide-y divide-slate-100 text-xs">
              {[...filteredShipments]
                .sort((a, b) => {
                  if (a.isPinned && !b.isPinned) return -1;
                  if (!a.isPinned && b.isPinned) return 1;
                  if (a.isUrgent && !b.isUrgent) return -1;
                  if (!a.isUrgent && b.isUrgent) return 1;
                  if (a.isImportant && !b.isImportant) return -1;
                  if (!a.isImportant && b.isImportant) return 1;
                  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                })
                .map((shipment, sIdx) => {
                const completedTasks = shipment.tasks.filter((t) => t.status === 'Completed').length;
                const totalTasks = shipment.tasks.length;
                const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

                // User registered comments / memo
                const memoCount = shipment.comments?.length || 0;
                const hasImportantMemo = shipment.comments?.some((c) => c.isImportant);
                const latestComment = memoCount > 0 ? shipment.comments![0] : null;
                const memoTooltip = memoCount > 0
                  ? `【ユーザー登録メモ (${memoCount}件)${hasImportantMemo ? ' ★重要メモあり' : ''}】\n最新 (${latestComment?.formattedTime || ''}):\n${latestComment?.authorName ? `[${latestComment.authorName}] ` : ''}${latestComment?.content || ''}`
                  : '';

                // Identify the currently active / ongoing step
                const currentOngoingTask = shipment.tasks.find((t) => t.status === 'In Progress');
                const isAllCompleted = shipment.status === 'Completed' || (totalTasks > 0 && completedTasks === totalTasks);
                const isHeavy = isHeavyShipment(shipment);
                const isImportant = isImportantShipment(shipment);
                const qaBadge = getCustomsQaDashboardBadge(shipment.customsQas);

                return (
                  <motion.div
                    key={`${shipment.id}-${sIdx}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: sIdx * 0.03 }}
                    className={`grid grid-cols-12 p-2.5 sm:p-3 transition-colors items-center group ${
                      shipment.isPinned
                        ? isImportant
                          ? 'bg-red-100/80 hover:bg-red-200/70 border-l-4 border-l-blue-600'
                          : isHeavy
                          ? 'bg-amber-100/80 hover:bg-amber-200/70 border-l-4 border-l-blue-600'
                          : 'bg-blue-50/30 hover:bg-slate-50/80 border-l-4 border-l-blue-600'
                        : isImportant
                        ? 'bg-red-50/90 hover:bg-red-100/80 border-l-4 border-l-red-500 shadow-2xs'
                        : isHeavy
                        ? 'bg-amber-50/90 hover:bg-amber-100/80 border-l-4 border-l-amber-500'
                        : shipment.isUrgent
                        ? 'bg-rose-50/20 hover:bg-slate-50/80'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    {/* Left Info Column (3 or 4 cols) */}
                    <div
                      onClick={() => onSelectShipment(shipment)}
                      className="col-span-4 sm:col-span-3 pr-3 border-r border-slate-100 cursor-pointer space-y-1"
                    >
                      <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                        {shipment.isPinned && (
                          <span className="px-1.5 py-0.5 text-[9.5px] font-bold bg-blue-600 text-white rounded shadow-2xs flex items-center space-x-0.5">
                            <Pin className="w-2.5 h-2.5 fill-current rotate-45" />
                            <span>固定</span>
                          </span>
                        )}

                        {/* AWB番号 (Prominent high-contrast badge) */}
                        <span className="px-2 py-0.5 text-xs sm:text-[13px] font-black tracking-tight rounded-md bg-blue-950 text-white border border-blue-800 uppercase font-mono shadow-2xs">
                          {shipment.id}
                        </span>

                        {/* 重要案件バッジ (薄赤ハイライト対応) */}
                        {isImportant && (
                          <span className="px-1.5 py-0.2 text-[9.5px] font-black bg-red-600 text-white rounded shadow-2xs flex items-center gap-0.5 border border-red-500 animate-pulse">
                            <Star className="w-2.5 h-2.5 fill-current text-white" />
                            <span>重要案件</span>
                          </span>
                        )}

                        {/* 重量案件バッジ (黄色系ハイライト対応) */}
                        {isHeavy && (
                          <span className="px-1.5 py-0.2 text-[9.5px] font-black bg-amber-500 text-white rounded shadow-2xs flex items-center gap-0.5 border border-amber-600">
                            <span>重量案件</span>
                          </span>
                        )}

                        <span
                          className={`px-2 py-0.5 text-[10.5px] font-extrabold rounded-full ${
                            isAllCompleted
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : shipment.status === 'In Progress'
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {isAllCompleted ? '全完了' : shipment.status === 'In Progress' ? '進行中' : '未着手'}
                        </span>

                        {shipment.cutTime && (
                          <span className="px-1.5 py-0.2 text-[9.5px] font-black bg-rose-600 text-white rounded shadow-2xs flex items-center gap-0.5 animate-pulse border border-rose-400">
                            <Clock className="w-2.5 h-2.5 text-white" />
                            <span>CUT: {shipment.cutTime}</span>
                          </span>
                        )}

                        {shipment.isUrgent && (
                          <span className="px-1.5 py-0.2 text-[9.5px] font-bold bg-rose-600 text-white rounded shadow-2xs">
                            緊急
                          </span>
                        )}
                        {shipment.isDgCargo && (
                          <span className="px-1.5 py-0.2 text-[9.5px] font-bold bg-amber-500 text-white rounded shadow-2xs">
                            DG品
                          </span>
                        )}

                        {/* User Memo / Comment Count Badge */}
                        {memoCount > 0 && (
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-bold rounded shadow-2xs flex items-center gap-1 transition-colors ${
                              hasImportantMemo
                                ? 'bg-rose-600 hover:bg-rose-700 text-white border border-rose-700 shadow-xs ring-1 ring-rose-300 font-black animate-pulse'
                                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-300'
                            }`}
                            title={memoTooltip}
                          >
                            <MessageSquareText className={`w-3 h-3 shrink-0 ${hasImportantMemo ? 'text-white' : 'text-indigo-600'}`} />
                            <span>{hasImportantMemo ? `🔴 重要メモ ${memoCount}件` : `メモ ${memoCount}件`}</span>
                          </span>
                        )}

                        {/* Customs QA Badge in Left Card Header */}
                        {qaBadge && (
                          <span
                            className={`px-1.5 py-0.5 text-[9.5px] font-extrabold rounded shadow-2xs flex items-center gap-1 transition-colors border ${qaBadge.badgeClass}`}
                            title={`【通関質疑ハブ】\n${qaBadge.fullLabel}\nクリックで通関質疑ハブ・案件詳細を開きます`}
                          >
                            <HelpCircle className="w-3 h-3 shrink-0" />
                            <span>{qaBadge.shortLabel}</span>
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinShipment(shipment.id);
                          }}
                          className={`ml-auto p-1 rounded transition-colors cursor-pointer ${
                            shipment.isPinned ? 'text-blue-600 bg-blue-100' : 'text-slate-400 hover:text-blue-600'
                          }`}
                          title={shipment.isPinned ? 'ピン留め解除' : '最上部に固定ピン留め'}
                        >
                          <Pin className={`w-3 h-3 ${shipment.isPinned ? 'fill-current rotate-45' : ''}`} />
                        </button>
                      </div>

                      {/* 向け地 (Destination) & 個数 (Pieces) - Prominently featured together without expanding vertical space */}
                      <div className="flex items-center justify-between gap-1.5 my-0.5">
                        {/* 向け地 Destination */}
                        <div className="flex items-center gap-1 bg-gradient-to-r from-blue-700 to-indigo-800 text-white px-2 py-0.5 rounded-md shadow-2xs flex-1 min-w-0">
                          <MapPin className="w-3.5 h-3.5 text-blue-200 shrink-0" />
                          <span className="text-[10px] font-bold text-blue-200 shrink-0">向け地:</span>
                          <span className="font-black text-xs sm:text-[13px] tracking-wide text-white font-mono truncate">{shipment.destination || '未設定'}</span>
                        </div>

                        {/* 個数 Pieces */}
                        <div className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded-md shadow-2xs shrink-0 font-mono" title="個数 / RCP">
                          <Package className="w-3.5 h-3.5 text-amber-100 shrink-0" />
                          <span className="text-[10px] font-bold text-amber-100 shrink-0">個数:</span>
                          <span className="font-black text-xs sm:text-[13px] text-white shrink-0">{shipment.pieces || '—'}</span>
                        </div>
                      </div>

                      <div className="font-extrabold text-slate-900 truncate text-xs sm:text-[12.5px] leading-tight" title={shipment.shipper}>
                        {shipment.shipper}
                      </div>

                      <div className="text-[11px] sm:text-[11.5px] font-bold text-slate-700 truncate leading-tight" title={shipment.consignee}>
                        ↳ CNEE: <span className="font-medium text-slate-800">{shipment.consignee || '未設定'}</span>
                      </div>

                      {/* Progress Bar */}
                      <div className="pt-0.5">
                        <div className="flex justify-between items-center text-[10.5px] text-slate-600 mb-0.5 font-mono">
                          <span className="font-bold">進捗率: {completedTasks}/{totalTasks}</span>
                          <span className="font-black text-xs text-blue-700">{progressPct}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              isAllCompleted ? 'bg-emerald-500' : progressPct > 0 ? 'bg-amber-500' : 'bg-slate-300'
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>

                      {/* Direct Action: Instruction Fullscreen / PDF Zoom */}
                      <div className="pt-1 flex items-center justify-between gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setZoomShipment(shipment);
                          }}
                          className="w-full py-1 px-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10.5px] sm:text-[11px] font-extrabold flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
                          title="SI指示書（PDF）を全画面で拡大プレビュー表示します"
                        >
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          <span>指示書全画面表示</span>
                        </button>
                      </div>
                    </div>

                    {/* Right Timeline Steps Column (8 or 9 cols) */}
                    <div className="col-span-8 sm:col-span-9 pl-4">
                      {shipment.tasks.length === 0 ? (
                        <div className="text-xs text-slate-400 italic py-2">タスク未登録</div>
                      ) : (
                        <div className="space-y-1.5">
                          {/* Currently Active Step Banner Header & Memo Alert & QA Badge */}
                          {(currentOngoingTask || memoCount > 0 || qaBadge) && (
                            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                              {currentOngoingTask ? (
                                <div className="flex items-center justify-between bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-0.5 text-xs text-amber-900 font-extrabold shadow-2xs flex-1 min-w-[200px]">
                                  <span className="flex items-center space-x-1.5">
                                    <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse shrink-0" />
                                    <span>現在進行中: <strong className="text-amber-950 underline underline-offset-2 ml-1 text-xs">{currentOngoingTask.title}</strong></span>
                                  </span>
                                  {currentOngoingTask.assignedTo && (
                                    <span className="text-[10px] bg-amber-200/80 px-1.5 py-0.2 rounded text-amber-900 font-bold flex items-center shrink-0 ml-2">
                                      <User className="w-2.5 h-2.5 mr-0.5" />
                                      {currentOngoingTask.assignedTo.displayName || currentOngoingTask.assignedTo.email}
                                    </span>
                                  )}
                                </div>
                              ) : <div />}

                              {/* Right items: Memo + Customs QA Badge */}
                              {(memoCount > 0 || qaBadge) && (
                                <div className="flex items-center gap-1.5 shrink-0 max-w-full">
                                  {memoCount > 0 && (
                                    <div
                                      className="flex items-center space-x-1.5 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100/90 rounded-lg px-2.5 py-0.5 text-xs text-indigo-900 font-medium shadow-2xs cursor-pointer transition-colors max-w-full truncate"
                                      onClick={() => onSelectShipment(shipment)}
                                      title={memoTooltip}
                                    >
                                      <MessageSquareText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                      <span className="font-bold text-indigo-700 shrink-0">メモ ({memoCount}件):</span>
                                      <span className="truncate text-slate-700 text-[11px]">
                                        {latestComment?.authorName ? `${latestComment.authorName}: ` : ''}{latestComment?.content || ''}
                                      </span>
                                    </div>
                                  )}

                                  {/* Customs QA Status Badge (e.g., ヘルマン照会中) next to Memo display */}
                                  {qaBadge && (
                                    <div
                                      className={`flex items-center space-x-1 px-2.5 py-0.5 rounded-lg text-xs font-black shadow-2xs cursor-pointer transition-colors border ${qaBadge.badgeClass}`}
                                      onClick={() => onSelectShipment(shipment)}
                                      title={`【通関質疑ハブ】\n${qaBadge.fullLabel}\nクリックで通関質疑ハブ・案件詳細を開きます`}
                                    >
                                      <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                                      <span>{qaBadge.shortLabel}</span>
                                      {qaBadge.count > 1 && (
                                        <span className="text-[10px] bg-black/20 px-1.5 py-0.2 rounded font-black ml-0.5">
                                          {qaBadge.count}件
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Horizontal Timeline Bar Nodes */}
                          <div className="flex items-stretch gap-1.5 overflow-x-auto pb-0.5 pt-0.5 scrollbar-thin">
                            {shipment.tasks.map((task, tIdx) => {
                              const isCompleted = task.status === 'Completed';
                              const isInProgress = task.status === 'In Progress';
                              const isTodo = task.status === 'Todo';
                              const taskKey = `${shipment.id}-${task.id}`;
                              const isAnimating = animatingTask?.id === taskKey;
                              const animType = isAnimating ? animatingTask?.type : null;

                              return (
                                <motion.div
                                  key={task.id}
                                  onClick={(e) => handleTaskStatusToggle(e, shipment.id, task)}
                                  onMouseEnter={() => setHoveredTaskId(taskKey)}
                                  onMouseLeave={() => setHoveredTaskId(null)}
                                  animate={
                                    animType === 'complete'
                                      ? {
                                          scale: [1, 1.14, 0.96, 1.04, 1],
                                          rotate: [0, -3, 3, -1, 0],
                                          boxShadow: [
                                            '0 0 0 0 rgba(16, 185, 129, 0)',
                                            '0 0 0 8px rgba(16, 185, 129, 0.4)',
                                            '0 0 0 12px rgba(16, 185, 129, 0)',
                                            '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                                          ],
                                        }
                                      : animType === 'deflate'
                                      ? {
                                          scale: [1, 0.86, 0.94, 0.98, 1],
                                          y: [0, 2, -1, 0],
                                          filter: [
                                            'brightness(1)',
                                            'brightness(0.9) grayscale(0.4)',
                                            'brightness(1) grayscale(0)',
                                          ],
                                        }
                                      : { scale: 1, rotate: 0 }
                                  }
                                  transition={{
                                    duration: animType === 'complete' ? 0.65 : 0.5,
                                    ease: animType === 'complete' ? 'backOut' : 'easeInOut',
                                  }}
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.95 }}
                                  className={`flex-1 min-w-[110px] max-w-[170px] p-2 rounded-xl border transition-colors cursor-pointer relative group/step flex flex-col justify-between space-y-1 select-none ${
                                    isCompleted
                                      ? 'bg-emerald-50/95 border-emerald-400 hover:border-emerald-500 hover:shadow-xs text-emerald-950 ring-1 ring-emerald-300/40'
                                      : isInProgress
                                      ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-300/80 shadow-xs text-amber-950 animate-pulse'
                                      : 'bg-white border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/30 text-slate-700'
                                  }`}
                                  title={`クリックでステータス変更 (現在: ${
                                    isCompleted ? '完了' : isInProgress ? '進行中' : '未着手 (予定)'
                                  })`}
                                >
                                  {/* Pop-up Celebration Badge on Complete */}
                                  <AnimatePresence>
                                    {animType === 'complete' && (
                                      <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.5 }}
                                        animate={{ opacity: 1, y: -20, scale: 1.15 }}
                                        exit={{ opacity: 0, y: -28, scale: 0.8 }}
                                        transition={{ duration: 0.7, ease: 'easeOut' }}
                                        className="absolute -top-1 left-1/2 -translate-x-1/2 z-30 bg-emerald-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg flex items-center space-x-1 whitespace-nowrap pointer-events-none border border-emerald-400"
                                      >
                                        <Sparkles className="w-3 h-3 text-amber-300 animate-spin" />
                                        <span>🎉 完了!</span>
                                      </motion.div>
                                    )}

                                    {/* Deflation Puff Badge on Revert to Todo */}
                                    {animType === 'deflate' && (
                                      <motion.div
                                        initial={{ opacity: 0, scale: 1.1, y: 0 }}
                                        animate={{ opacity: 1, scale: 0.85, y: -16 }}
                                        exit={{ opacity: 0, scale: 0.6, y: -24 }}
                                        transition={{ duration: 0.5, ease: 'easeOut' }}
                                        className="absolute -top-1 left-1/2 -translate-x-1/2 z-30 bg-slate-700 text-white text-[9px] font-bold px-2 py-0.5 rounded-full shadow-md flex items-center space-x-1 whitespace-nowrap pointer-events-none"
                                      >
                                        <span>💨 予定へ変更</span>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>

                                  {/* Step Header */}
                                  <div className="flex items-center justify-between text-[10.5px] font-mono leading-none">
                                    <span className="font-black opacity-80">
                                      STEP {tIdx + 1}
                                    </span>
                                    {isCompleted ? (
                                      <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-emerald-200 text-emerald-950 font-black text-[9.5px]">
                                        <Check className="w-2.5 h-2.5 mr-0.5 stroke-[3]" /> 完了
                                      </span>
                                    ) : isInProgress ? (
                                      <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-amber-500 text-white font-black text-[9.5px] shadow-2xs">
                                        進行中
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-bold text-[9.5px]">
                                        予定
                                      </span>
                                    )}
                                  </div>

                                  {/* Step Title */}
                                  <div className="text-xs sm:text-[12px] font-black text-slate-900 leading-tight line-clamp-2">
                                    {task.title}
                                  </div>

                                  {/* Footer timestamp / assigned info */}
                                  <div className="text-[10px] font-mono text-slate-600 flex items-center justify-between pt-0.5 border-t border-slate-200/60 font-semibold">
                                    {isCompleted ? (
                                      <span className="text-emerald-800 font-bold truncate">
                                        {task.completedAt || '完了'}
                                      </span>
                                    ) : isInProgress ? (
                                      <span className="text-amber-950 font-black truncate">
                                        {task.assignedTo?.displayName || '進行作業中'}
                                      </span>
                                    ) : (
                                      <span className="text-slate-400 italic">
                                        次回予定
                                      </span>
                                    )}
                                  </div>

                                  {/* Connector Arrow (except last task) */}
                                  {tIdx < shipment.tasks.length - 1 && (
                                    <div className="absolute -right-2 top-1/2 -translate-y-1/2 z-10 hidden sm:block pointer-events-none">
                                      <ChevronRight
                                        className={`w-3.5 h-3.5 ${
                                          isCompleted ? 'text-emerald-500' : isInProgress ? 'text-amber-500' : 'text-slate-300'
                                        }`}
                                      />
                                    </div>
                                  )}
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* PDF Zoom Interactive Modal */}
      <PdfZoomModal
        shipment={zoomShipment}
        isOpen={!!zoomShipment}
        onClose={() => setZoomShipment(null)}
        onReturnToDashboard={() => setZoomShipment(null)}
        onShipmentUpdated={(updated) => setZoomShipment(updated)}
      />
    </div>
  );
};
