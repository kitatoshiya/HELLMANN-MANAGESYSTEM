import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shipment, ShipmentStatus, StatusFilterType } from '../types';
import { Search, Plane, Clock, CheckCircle2, Circle, AlertCircle, ArrowRight, Calendar, Trash2, LayoutGrid, List, FileText, ZoomIn, Star, Zap, AlertOctagon, Package, Scale, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Edit3, Pin, Mail, Layers, FileCheck, MessageSquare, MessageSquareText, BarChart3, Database, Flame, Table } from 'lucide-react';
import { deleteShipment, togglePinShipment, getCurrentUser } from '../lib/storageManager';
import { SiDocumentViewer } from './SiDocumentViewer';
import { PdfZoomModal } from './PdfZoomModal';
import { CalendarView } from './CalendarView';
import { ShipmentEditModal } from './ShipmentEditModal';
import { CustomsEmailModal } from './CustomsEmailModal';
import { TableView } from './TableView';

interface DashboardProps {
  shipments: Shipment[];
  onSelectShipment: (shipment: Shipment) => void;
  onOpenUpload: () => void;
  todayTrigger?: number;
  onOpenXrayAnalysis?: () => void;
  onOpenReport?: () => void;
  onOpenBackup?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ shipments, onSelectShipment, onOpenUpload, todayTrigger, onOpenXrayAnalysis, onOpenReport, onOpenBackup }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const STORAGE_DASHBOARD_STATUS_FILTER_KEY = 'export_app_dashboard_status_filter';
  const [statusFilter, setStatusFilterState] = useState<StatusFilterType>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DASHBOARD_STATUS_FILTER_KEY);
      if (saved && ['UNCOMPLETED', 'ALL', 'Todo', 'In Progress', 'Completed'].includes(saved)) {
        return saved as StatusFilterType;
      }
    } catch {}
    return 'UNCOMPLETED';
  });

  const setStatusFilter = (filter: StatusFilterType) => {
    setStatusFilterState(filter);
    try {
      localStorage.setItem(STORAGE_DASHBOARD_STATUS_FILTER_KEY, filter);
    } catch {}
  };
  const STORAGE_DASHBOARD_VIEW_KEY = 'export_app_dashboard_view_mode';
  const [viewMode, setViewModeState] = useState<'grid' | 'table' | 'data_table'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DASHBOARD_VIEW_KEY);
      if (saved === 'grid' || saved === 'table' || saved === 'data_table') return saved;
    } catch {}
    return 'grid';
  });

  const handleSetViewMode = (mode: 'grid' | 'table' | 'data_table') => {
    setViewModeState(mode);
    try {
      localStorage.setItem(STORAGE_DASHBOARD_VIEW_KEY, mode);
    } catch {}
  };

  // ログインユーザー別のサブコントロール（通関日・展開切替・リスト切替・ステータスタブ）折りたたみ状態
  const currentUser = getCurrentUser();
  const currentUserId = currentUser?.uid || currentUser?.email || 'default';
  const STORAGE_DASHBOARD_SUB_CONTROLS_KEY = `export_app_dashboard_sub_controls_open_${currentUserId}`;

  const [isSubControlsOpen, setIsSubControlsOpenState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DASHBOARD_SUB_CONTROLS_KEY);
      if (saved !== null) {
        return saved === 'true';
      }
    } catch {}
    return false; // 起動時のデフォルトは折りたたみ状態 (collapsed)
  });

  const toggleSubControls = () => {
    setIsSubControlsOpenState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_DASHBOARD_SUB_CONTROLS_KEY, String(next));
      } catch {}
      return next;
    });
  };
  const [zoomShipment, setZoomShipment] = useState<Shipment | null>(null);
  const [editShipment, setEditShipment] = useState<Shipment | null>(null);
  const [emailModalShipment, setEmailModalShipment] = useState<Shipment | null>(null);
  const [shipmentToDelete, setShipmentToDelete] = useState<Shipment | null>(null);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});

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

  // Base shipments matching text search & date range (ALL dates logic)
  const baseRangeShipments = shipments.filter((s) => {
    const matchesSearch =
      s.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.mawbNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.hawbNumber && s.hawbNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
      s.shipper.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.consignee.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.destination && s.destination.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (s.flag && s.flag.toLowerCase().includes(searchTerm.toLowerCase())) ||
      s.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase());

    let matchesDateRange = true;
    if (startDate || endDate) {
      if (!s.customsClearanceDate) {
        matchesDateRange = false;
      } else {
        const cDateStr = s.customsClearanceDate.replace(/\//g, '-').trim();
        if (startDate && cDateStr < startDate) matchesDateRange = false;
        if (endDate && cDateStr > endDate) matchesDateRange = false;
      }
    }

    return matchesSearch && matchesDateRange;
  });

  const totalCount = baseRangeShipments.length;
  const todoCount = baseRangeShipments.filter((s) => s.status === 'Todo').length;
  const inProgressCount = baseRangeShipments.filter((s) => s.status === 'In Progress').length;
  const uncompletedCount = todoCount + inProgressCount;
  const completedCount = baseRangeShipments.filter((s) => s.status === 'Completed').length;

  const filteredShipments = baseRangeShipments.filter((s) => {
    const matchesStatus =
      statusFilter === 'ALL'
        ? true
        : statusFilter === 'UNCOMPLETED'
        ? s.status !== 'Completed'
        : s.status === statusFilter;

    return matchesStatus;
  });

  // Priority Sorting: Pinned (ピン留め固定) -> Urgent (緊急) -> Important (重要) -> Normal
  const sortedShipments = [...filteredShipments].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    if (a.isUrgent && !b.isUrgent) return -1;
    if (!a.isUrgent && b.isUrgent) return 1;
    if (a.isImportant && !b.isImportant) return -1;
    if (!a.isImportant && b.isImportant) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const getStatusBadge = (status: ShipmentStatus) => {
    switch (status) {
      case 'Todo':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <Circle className="w-3 h-3 mr-1 text-slate-500" />
            未着手
          </span>
        );
      case 'In Progress':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-xs">
            <Clock className="w-3 h-3 mr-1 text-amber-600 animate-pulse" />
            進行中
          </span>
        );
      case 'Completed':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
            完了
          </span>
        );
    }
  };

  const handleDelete = (e: React.MouseEvent, shipment: Shipment) => {
    e.stopPropagation();
    setShipmentToDelete(shipment);
  };

  return (
    <div className="space-y-6">
      {/* Top Always-Visible Customs Clearance Calendar & Metrics Overview */}
      <CalendarView
        shipments={shipments}
        onSelectShipment={onSelectShipment}
        onEditShipment={(s) => setEditShipment(s)}
        onDeleteShipment={(s) => setShipmentToDelete(s)}
        onOpenUpload={onOpenUpload}
        onZoomShipment={(s) => setZoomShipment(s)}
        statusFilter={statusFilter}
        onSelectStatusFilter={setStatusFilter}
        todayTrigger={todayTrigger}
      />

      {/* Filter, Search, and View Switcher Controls (添付画像同等のデザインコントロールバー) */}
      <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/90 space-y-3 shadow-2xs">
        {/* Top Primary Bar (添付画像と同一レイアウト・スタイル) */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Left: Legend and Count */}
          <div className="flex items-center space-x-3 flex-wrap gap-y-1.5 text-xs">
            <span className="font-bold text-slate-800 flex items-center space-x-1">
              <Layers className="w-4 h-4 text-blue-600" />
              <span>対象貨物: <strong className="text-blue-700 font-mono text-sm">{sortedShipments.length}</strong> 件</span>
            </span>

            <div className="h-4 w-px bg-slate-300 hidden sm:block" />

            {/* Status Legends */}
            <div className="flex items-center space-x-2 text-[11px]">
              <span className="inline-flex items-center font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-300">
                <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
                完了工程
              </span>
              <span className="inline-flex items-center font-bold text-amber-900 bg-amber-200 px-2 py-0.5 rounded-md border border-amber-400 shadow-2xs animate-pulse">
                <Clock className="w-3 h-3 mr-1 text-amber-700" />
                現在進行中ステップ
              </span>
              <span className="inline-flex items-center font-medium text-slate-600 bg-white px-2 py-0.5 rounded-md border border-dashed border-slate-300">
                <Circle className="w-3 h-3 mr-1 text-slate-400" />
                予定ステータス
              </span>
            </div>
          </div>

          {/* Right: Search Input & Quick Filter Switcher */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
            {/* X-ray Inspection Parsing Button */}
            {onOpenXrayAnalysis && (
              <button
                type="button"
                onClick={onOpenXrayAnalysis}
                className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 active:scale-95 text-white font-extrabold text-xs rounded-lg shadow-2xs transition-all flex items-center justify-center space-x-1.5 cursor-pointer shrink-0 border border-amber-400/80"
                title="X線検査結果・爆発物検査依頼書PDFをAI OCR解析して一括分割ダウンロード"
              >
                <FileCheck className="w-3.5 h-3.5 text-white" />
                <span>X線検査結果解析</span>
              </button>
            )}

            {/* Progress Summary Report Button */}
            {onOpenReport && (
              <button
                type="button"
                onClick={onOpenReport}
                className="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 active:scale-95 text-white font-extrabold text-xs rounded-lg shadow-2xs transition-all flex items-center justify-center space-x-1.5 cursor-pointer shrink-0 border border-indigo-400/80"
                title="全案件の進捗サマリーレポート & チーム週間アウトプット分析を表示"
              >
                <BarChart3 className="w-3.5 h-3.5 text-indigo-200" />
                <span>進捗サマリー・週間分析</span>
              </button>
            )}

            {/* Backup & Snapshot Button */}
            {onOpenBackup && (
              <button
                type="button"
                onClick={onOpenBackup}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-100 font-extrabold text-xs rounded-lg shadow-2xs transition-all flex items-center justify-center space-x-1.5 cursor-pointer shrink-0 border border-slate-700"
                title="進捗データのJSON出力・Firebase Storage自動スナップショット"
              >
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                <span>バックアップ</span>
              </button>
            )}

            {/* Search Input (向け地、MAWB、CONSIGNEE等) */}
            <div className="relative w-full sm:w-64 lg:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="向け地、MAWB、CONSIGNEEで検索..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Filter Toggle Buttons ("すべて" / "進行中のみ") */}
            <div className="flex items-center bg-white p-0.5 border border-slate-200 rounded-lg text-xs shrink-0">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  statusFilter === 'ALL' ? 'bg-slate-800 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                すべて
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('UNCOMPLETED')}
                className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  statusFilter === 'UNCOMPLETED' ? 'bg-amber-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                進行中のみ
              </button>
            </div>

            {/* Toggle Button for Bottom Sub Controls */}
            <button
              type="button"
              onClick={toggleSubControls}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center space-x-1 cursor-pointer shrink-0 border ${
                isSubControlsOpen
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:text-slate-900 shadow-2xs'
              }`}
              title={isSubControlsOpen ? '詳細操作・タスク一覧を折りたたむ' : '詳細操作・タスク一覧を展開する'}
            >
              <span>{isSubControlsOpen ? '表示をたたむ' : '詳細操作・タスク一覧を展開'}</span>
              {isSubControlsOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              )}
            </button>
          </div>

          {/* Bottom Sub Controls: Date Range, Collapse Controls, View Switcher & Detailed Status Tabs */}
          <AnimatePresence initial={false}>
            {isSubControlsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="pt-2 border-t border-slate-200/60 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 text-xs">
                  {/* Date Range Filter */}
                  <div className="flex items-center space-x-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1 text-xs shrink-0">
                    <Calendar className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span className="text-[11px] font-bold text-slate-700 shrink-0 whitespace-nowrap">通関日:</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5 text-[11px] text-slate-800 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                      title="開始日 (通関日)"
                    />
                    <span className="text-slate-400 font-bold text-[11px]">~</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5 text-[11px] text-slate-800 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                      title="終了日 (通関日)"
                    />
                    {(startDate || endDate) && (
                      <button
                        type="button"
                        onClick={() => {
                          setStartDate('');
                          setEndDate('');
                        }}
                        className="ml-1 text-slate-400 hover:text-red-600 text-xs font-bold p-0.5 hover:bg-slate-200 rounded transition-colors cursor-pointer"
                        title="日付指定を解除"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 justify-between xl:justify-end">
                    {/* Collapse Controls */}
                    <div className="flex items-center space-x-1 bg-white p-0.5 border border-slate-200 rounded-xl">
                      <button
                        type="button"
                        onClick={handleCollapseAll}
                        className="px-2 py-1 text-[11px] font-bold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all flex items-center space-x-1 cursor-pointer"
                        title="すべての案件カードを折りたたみます"
                      >
                        <ChevronsUp className="w-3 h-3 text-slate-600" />
                        <span>全て折りたたむ</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleExpandAll}
                        className="px-2 py-1 text-[11px] font-bold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all flex items-center space-x-1 cursor-pointer"
                        title="すべての案件カードを展開表示します"
                      >
                        <ChevronsDown className="w-3 h-3 text-slate-600" />
                        <span>全て展開する</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCollapseCompleted}
                        className="px-2 py-1 text-[11px] font-bold text-emerald-800 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100/90 border border-emerald-200 rounded-lg transition-all flex items-center space-x-1 cursor-pointer"
                        title="完了済みの案件のみを折りたたんで表示します"
                      >
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>完了済を折りたたむ</span>
                      </button>
                    </div>

                    {/* View Mode Toggle */}
                    <div className="flex items-center space-x-1 bg-white p-0.5 border border-slate-200 rounded-xl">
                      <button
                        type="button"
                        onClick={() => handleSetViewMode('grid')}
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all flex items-center space-x-1 cursor-pointer ${
                          viewMode === 'grid' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <LayoutGrid className="w-3 h-3" />
                        <span>PDFサムネイル</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetViewMode('table')}
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all flex items-center space-x-1 cursor-pointer ${
                          viewMode === 'table' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <List className="w-3 h-3" />
                        <span>リスト</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetViewMode('data_table')}
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all flex items-center space-x-1 cursor-pointer ${
                          viewMode === 'data_table' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Table className="w-3 h-3" />
                        <span>テーブル</span>
                      </button>
                    </div>

                    {/* Detailed Status Filter Tabs */}
                    <div className="flex items-center space-x-1 bg-white p-0.5 border border-slate-200 rounded-xl overflow-x-auto">
                      <button
                        type="button"
                        onClick={() => setStatusFilter('Todo')}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                          statusFilter === 'Todo' ? 'bg-slate-700 text-white shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        未着手 ({todoCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('In Progress')}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                          statusFilter === 'In Progress' ? 'bg-amber-600 text-white shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        進行中 ({inProgressCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusFilter('Completed')}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                          statusFilter === 'Completed' ? 'bg-emerald-600 text-white shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        完了 ({completedCount})
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

        {/* Main Content View (Thumbnail Grid vs Table) - Wrapped in isSubControlsOpen AnimatePresence */}
        <AnimatePresence initial={false}>
          {isSubControlsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              {sortedShipments.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">該当する案件が見つかりません</h3>
                  <p className="text-xs text-slate-500 mt-1">検索条件を変更するか、新しいSI指示書PDFを取り込んでください。</p>
                  <button
                    onClick={onOpenUpload}
                    className="mt-4 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-xl inline-flex items-center shadow-xs"
                  >
                    SI (PDF) を取り込む
                  </button>
                </div>
              ) : viewMode === 'grid' ? (
                /* PDF THUMBNAIL GRID VIEW */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-6 pt-2">
          {sortedShipments.map((shipment, idx) => {
            const completedCount = shipment.tasks.filter((t) => t.status === 'Completed').length;
            const totalCount = shipment.tasks.length;
            const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
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
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: idx * 0.05 }}
                whileHover={{ y: -2 }}
                onClick={() => onSelectShipment(shipment)}
                className={`bg-white rounded-3xl border transition-all p-4 flex flex-col justify-between space-y-3 group relative cursor-pointer ${
                  shipment.isPinned
                    ? 'border-blue-500 ring-2 ring-blue-400/50 bg-blue-50/10 shadow-md hover:shadow-xl'
                    : shipment.isUrgent
                    ? 'border-rose-400 bg-rose-50/10 shadow-md hover:border-rose-500 hover:shadow-xl'
                    : shipment.isImportant
                    ? 'border-amber-400 bg-amber-50/10 shadow-md hover:border-amber-500 hover:shadow-xl'
                    : 'border-slate-200 shadow-xs hover:shadow-xl hover:border-blue-400'
                }`}
              >
                {/* Header Meta & Priority Warning Badges */}
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                      {shipment.isPinned && (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg bg-blue-600 text-white shadow-xs flex items-center space-x-1">
                          <Pin className="w-3 h-3 fill-current text-blue-100 rotate-45" />
                          <span>📌 ピン留め固定</span>
                        </span>
                      )}

                      {/* AWB番号 (Prominent high-contrast badge) */}
                      <span className="px-2.5 py-0.5 text-xs sm:text-[13px] font-black tracking-tight rounded-md bg-blue-950 text-white border border-blue-800 uppercase font-mono shadow-2xs">
                        {shipment.id}
                      </span>

                      {/* Status Badge */}
                      <span
                        className={`px-2 py-0.5 text-[10px] font-bold rounded-lg border ${
                          shipment.status === 'Completed'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : shipment.status === 'In Progress'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {shipment.status === 'Completed'
                          ? '全工程完了'
                          : shipment.status === 'In Progress'
                          ? '進行中'
                          : '未着手'}
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

                      {/* Priority Level Badge (Only High or Medium; hide when Low) */}
                      {(() => {
                        const prio = shipment.priorityLevel || shipment.priority || (shipment.isUrgent ? 'High' : shipment.isImportant ? 'Medium' : 'Low');
                        if (prio === 'Low' || !prio) return null;
                        return (
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-lg border ${
                              prio === 'High'
                                ? 'bg-rose-100 text-rose-800 border-rose-300'
                                : 'bg-amber-100 text-amber-800 border-amber-300'
                            }`}
                          >
                            優先度: {prio === 'High' ? '高' : '中'}
                          </span>
                        );
                      })()}

                      {/* DG (危険物) Cargo Badge - Only shown when isDgCargo is true; hidden when non-DG */}
                      {shipment.isDgCargo && (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg bg-amber-500 text-white shadow-xs flex items-center space-x-1 border border-amber-400">
                          <Flame className="w-3 h-3 text-amber-100" />
                          <span>DG (危険物)</span>
                        </span>
                      )}

                      {/* Warning Display for Urgent / Important */}
                      {shipment.isUrgent && (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg bg-rose-600 text-white shadow-xs flex items-center space-x-1 animate-pulse">
                          <Zap className="w-3 h-3 fill-current text-rose-100" />
                          <span>⚡ 緊急</span>
                        </span>
                      )}
                      {shipment.isImportant && (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg bg-amber-500 text-white shadow-xs flex items-center space-x-1">
                          <Star className="w-3 h-3 fill-current text-amber-100" />
                          <span>⭐ 重要</span>
                        </span>
                      )}
                      {shipment.cutTime && (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg bg-rose-600 text-white shadow-xs flex items-center space-x-1 animate-pulse border border-rose-400">
                          <Clock className="w-3 h-3 text-white" />
                          <span>⏰ CUT: {shipment.cutTime}</span>
                        </span>
                      )}
                    </div>

                    <h3 className="text-xs sm:text-[13px] font-black text-slate-900 mt-1 truncate max-w-[200px] leading-tight" title={shipment.shipper}>
                      {shipment.shipper}
                    </h3>
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

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditShipment(shipment);
                      }}
                      className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-xl transition-colors flex items-center gap-1 cursor-pointer border border-slate-200 bg-slate-50/80"
                      title="基本情報・担当者を編集"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-amber-600" />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, shipment)}
                      className="text-slate-300 hover:text-red-500 p-1.5 rounded transition-colors cursor-pointer"
                      title="削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Progress Status Bar (進捗状態) - Always Visible */}
                <div
                  className={`rounded-2xl p-2.5 space-y-1.5 border transition-all ${
                    progressPct === 100 || shipment.status === 'Completed'
                      ? 'bg-emerald-50/90 border-emerald-400 ring-1 ring-emerald-300/80 shadow-2xs'
                      : 'bg-slate-50/90 border-slate-200/80'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                    <span className={progressPct === 100 || shipment.status === 'Completed' ? 'text-emerald-950 font-bold' : ''}>
                      進捗状態 ({completedCount}/{totalCount} 工程完了)
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        progressPct === 100 || shipment.status === 'Completed' ? 'text-emerald-700' : 'text-blue-700'
                      }`}
                    >
                      {progressPct}%
                    </span>
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
                </div>

                {/* PDF Document Thumbnail Container & Lower Details (Collapses when isCollapsed is true) */}
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
                        className="h-56"
                        onClick={(e) => {
                          e.stopPropagation();
                          setZoomShipment(shipment);
                        }}
                      >
                        <SiDocumentViewer
                          shipment={shipment}
                          isThumbnail={true}
                        />
                      </div>

                      {/* Extracted Cargo Details: Destination (向地(DEST)), Pieces & Weight Bar */}
                      <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 p-1.5 rounded-xl border border-slate-200/80 font-mono flex-wrap gap-1.5">
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

                        {shipment.grossWeight && (
                          <div className="flex items-center gap-1 bg-slate-200 text-slate-800 px-2 py-1 rounded-lg shrink-0 font-mono text-[11px] font-bold" title="重量 (Gross Weight)">
                            <Scale className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                            <span className="text-[9.5px] text-slate-500 font-sans">重量:</span>
                            <span className="font-extrabold text-slate-900">{shipment.grossWeight}</span>
                          </div>
                        )}

                        {shipment.cutTime && (
                          <div className="flex items-center gap-1 bg-rose-600 text-white px-2 py-1 rounded-lg shadow-2xs shrink-0 font-mono animate-pulse border border-rose-400" title="カット時間">
                            <Clock className="w-3.5 h-3.5 text-white shrink-0" />
                            <span className="text-[10px] font-bold text-rose-100 font-sans shrink-0">CUT:</span>
                            <span className="font-black text-xs text-white shrink-0">{shipment.cutTime}</span>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setZoomShipment(shipment);
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
      ) : viewMode === 'table' ? (
        /* TABLE LIST VIEW */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">PDFイメージ / AWB番号</th>
                  <th className="py-3 px-4">CNEE (荷受人) / 荷主</th>
                  <th className="py-3 px-4">個数 / 重量</th>
                  <th className="py-3 px-4">仕向け地 / フライト / 通関予定日</th>
                  <th className="py-3 px-4">INVOICE / 受注NO.</th>
                  <th className="py-3 px-4">作業進捗状況</th>
                  <th className="py-3 px-4">案件ステータス</th>
                  <th className="py-3 px-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {sortedShipments.map((s) => {
                  const completedTaskCount = s.tasks.filter((t) => t.status === 'Completed').length;
                  const totalTaskCount = s.tasks.length;
                  const progressPct = totalTaskCount > 0 ? Math.round((completedTaskCount / totalTaskCount) * 100) : 0;
                  const isHawbPrimary = !!s.hawbNumber;

                  // User registered comments / memo
                  const memoCount = s.comments?.length || 0;
                  const importantComments = (s.comments || []).filter((c) => c.isImportant);
                  const hasImportantMemo = importantComments.length > 0;
                  const latestImportantComment = hasImportantMemo
                    ? [...importantComments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
                    : null;
                  const importantSnippet = latestImportantComment ? latestImportantComment.content.trim().slice(0, 20) : '';
                  const latestComment = memoCount > 0 ? s.comments![0] : null;
                  const memoTooltip = memoCount > 0
                    ? `【ユーザー登録メモ (${memoCount}件)${hasImportantMemo ? ' ★重要メモあり' : ''}】\n${latestImportantComment ? `[重要メモ] ${latestImportantComment.content}\n\n` : ''}最新 (${latestComment?.formattedTime || ''}):\n${latestComment?.authorName ? `[${latestComment.authorName}] ` : ''}${latestComment?.content || ''}`
                    : '';

                  return (
                    <tr
                      key={s.id}
                      onClick={() => onSelectShipment(s)}
                      className={`hover:bg-blue-50/40 cursor-pointer transition-colors group ${
                        s.isPinned
                          ? 'bg-blue-50/25 border-l-4 border-l-blue-600'
                          : s.isUrgent
                          ? 'bg-rose-50/20'
                          : s.isImportant
                          ? 'bg-amber-50/20'
                          : ''
                      }`}
                    >
                      {/* Primary Key / AWB Column with PDF Icon and Priority Warnings */}
                      <td className="py-3.5 px-4 font-medium text-slate-900">
                        <div className="flex items-center space-x-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setZoomShipment(s);
                            }}
                            className="p-2 bg-slate-100 hover:bg-blue-100 text-blue-700 rounded-xl border border-slate-200 transition-colors shrink-0"
                            title="PDFプレビュー拡大"
                          >
                            <FileText className="w-4 h-4" />
                          </button>

                          <div>
                            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                              {s.isPinned && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-600 text-white shadow-2xs flex items-center space-x-0.5">
                                  <Pin className="w-2.5 h-2.5 fill-current rotate-45" />
                                  <span>📌 固定</span>
                                </span>
                              )}
                              <span className="font-mono text-[21px] font-black text-blue-950 tracking-tight leading-none">{s.id}</span>
                              {isHawbPrimary ? (
                                <span className="px-2 py-0.5 text-[11px] font-extrabold rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                                  HAWB
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 text-[11px] font-extrabold rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200 shadow-2xs">
                                  MAWB直截
                                </span>
                              )}

                              {/* User Memo / Comment Count Badge */}
                              {memoCount > 0 && (
                                <span
                                  className={`px-1.5 py-0.5 text-[10px] font-bold rounded border flex items-center space-x-1 transition-colors max-w-[240px] ${
                                    hasImportantMemo
                                      ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700 font-black shadow-xs ring-1 ring-rose-300'
                                      : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-300'
                                  }`}
                                  title={memoTooltip}
                                >
                                  <MessageSquareText className={`w-3 h-3 shrink-0 ${hasImportantMemo ? 'text-white' : 'text-indigo-600'}`} />
                                  <span className="truncate">
                                    {hasImportantMemo ? `🔴 ${memoCount}件: ${importantSnippet}` : `メモ ${memoCount}件`}
                                  </span>
                                </span>
                              )}
                              {(() => {
                                const prio = s.priorityLevel || s.priority || (s.isUrgent ? 'High' : s.isImportant ? 'Medium' : 'Low');
                                if (prio === 'Low' || !prio) return null;
                                return (
                                  <span
                                    className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${
                                      prio === 'High'
                                        ? 'bg-rose-100 text-rose-800 border-rose-300'
                                        : 'bg-amber-100 text-amber-800 border-amber-300'
                                    }`}
                                  >
                                    優先度: {prio === 'High' ? '高' : '中'}
                                  </span>
                                );
                              })()}
                              {s.isDgCargo && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-500 text-white shadow-2xs flex items-center space-x-0.5">
                                  <Flame className="w-2.5 h-2.5 text-amber-100" />
                                  <span>DG</span>
                                </span>
                              )}
                              {s.isUrgent && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-600 text-white shadow-2xs flex items-center space-x-0.5 animate-pulse">
                                  <Zap className="w-2.5 h-2.5 fill-current" />
                                  <span>緊急</span>
                                </span>
                              )}
                              {s.isImportant && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-500 text-white shadow-2xs flex items-center space-x-0.5">
                                  <Star className="w-2.5 h-2.5 fill-current" />
                                  <span>重要</span>
                                </span>
                              )}
                              {s.cutTime && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-600 text-white shadow-2xs flex items-center space-x-0.5 animate-pulse border border-rose-400">
                                  <Clock className="w-2.5 h-2.5 text-white" />
                                  <span>⏰ CUT: {s.cutTime}</span>
                                </span>
                              )}
                            </div>
                            {isHawbPrimary && (
                              <div className="text-xs text-slate-500 font-medium mt-0.5">
                                MAWB: <span className="font-mono font-bold text-slate-700">{s.mawbNumber}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Shipper & Consignee */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="text-[13.5px] font-extrabold text-slate-950 truncate flex items-center" title={s.consignee}>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-bold border border-slate-200 mr-1.5 shrink-0">
                            CNEE
                          </span>
                          <span className="truncate">{s.consignee || '未記載'}</span>
                        </div>
                        <div className="text-xs text-slate-500 font-medium truncate mt-1 flex items-center" title={s.shipper}>
                          <span className="text-[10px] text-slate-400 mr-1 shrink-0">荷主:</span>
                          <span className="truncate">{s.shipper || '未記載'}</span>
                        </div>
                      </td>

                      {/* Pieces & Gross Weight */}
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-800">
                        <div className="font-bold flex items-center">
                          <Package className="w-3 h-3 mr-1 text-blue-600 shrink-0" />
                          {s.pieces || '未記載'}
                        </div>
                        <div className="text-slate-500 flex items-center mt-0.5 font-bold">
                          <Scale className="w-3 h-3 mr-1 text-blue-600 shrink-0" />
                          {s.grossWeight || '未記載'}
                        </div>
                      </td>

                      {/* Destination, Flight & Date */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-1.5 mb-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-bold border border-blue-200 shrink-0">
                            仕向け地
                          </span>
                          <span className="text-[21px] font-black text-blue-950 font-mono tracking-wide leading-none">
                            {s.destination || '未定'}
                          </span>
                        </div>
                        <div className="font-medium text-slate-800 flex items-center text-xs">
                          <Plane className="w-3.5 h-3.5 mr-1 text-slate-400 shrink-0" />
                          <span className="truncate">{s.flightRoute || '未定'}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center mt-0.5">
                          <Calendar className="w-3 h-3 mr-1 text-slate-400 shrink-0" />
                          通関日: {s.customsClearanceDate || '未定'}
                        </div>
                        {s.cutTime && (
                          <div className="text-[11px] font-bold text-rose-800 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md flex items-center mt-1 w-fit shadow-2xs">
                            <Clock className="w-3 h-3 mr-1 text-rose-600 animate-pulse shrink-0" />
                            カット時間: <span className="font-mono font-extrabold ml-1 text-rose-950">{s.cutTime}</span>
                          </div>
                        )}
                      </td>

                      {/* Invoice & Order */}
                      <td className="py-3.5 px-4 font-mono text-[11px]">
                        <div className="text-slate-800 font-semibold">{s.invoiceNumber}</div>
                        <div className="text-slate-400">{s.orderNumber}</div>
                      </td>

                      {/* Task Progress Bar & Ratio */}
                      <td className="py-3.5 px-4 min-w-[150px]">
                        <div
                          className={`p-2 rounded-xl border transition-all ${
                            progressPct === 100 || s.status === 'Completed'
                              ? 'bg-emerald-50/90 border-emerald-300 ring-1 ring-emerald-200'
                              : 'bg-slate-50/50 border-slate-200/50'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span
                              className={`font-medium ${
                                progressPct === 100 || s.status === 'Completed' ? 'text-emerald-950 font-bold' : 'text-slate-600'
                              }`}
                            >
                              タスク完了: {completedTaskCount}/{totalTaskCount}
                            </span>
                            <span
                              className={`font-bold ${
                                progressPct === 100 || s.status === 'Completed' ? 'text-emerald-700' : 'text-slate-800'
                              }`}
                            >
                              {progressPct}%
                            </span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${
                                progressPct === 100 || s.status === 'Completed'
                                  ? 'bg-emerald-500'
                                  : progressPct > 0
                                  ? 'bg-amber-500'
                                  : 'bg-slate-300'
                              }`}
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Shipment Status Badge */}
                      <td className="py-3.5 px-4 whitespace-nowrap">{getStatusBadge(s.status)}</td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePinShipment(s.id);
                            }}
                            title={s.isPinned ? 'ピン留め解除' : '最上部に固定ピン留め'}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              s.isPinned
                                ? 'text-white bg-blue-600 hover:bg-blue-700 shadow-2xs'
                                : 'text-slate-400 hover:text-blue-600 hover:bg-slate-100'
                            }`}
                          >
                            <Pin className={`w-3.5 h-3.5 ${s.isPinned ? 'fill-current rotate-45' : ''}`} />
                          </button>

                          <button
                            onClick={() => onSelectShipment(s)}
                            className="p-1.5 rounded-lg text-blue-600 hover:text-blue-800 hover:bg-blue-100/60 font-medium text-xs inline-flex items-center transition-colors"
                          >
                            進捗詳細 <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEmailModalShipment(s);
                            }}
                            title="通関依頼メール作成"
                            className="p-1.5 rounded-lg text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 transition-colors cursor-pointer"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditShipment(s);
                            }}
                            title="基本情報・担当者を編集"
                            className="p-1.5 rounded-lg text-amber-600 hover:text-amber-800 hover:bg-amber-50 transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(e, s)}
                            title="案件削除"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : viewMode === 'data_table' ? (
        <TableView
          shipments={sortedShipments}
          onSelectShipment={(shipment) => onSelectShipment(shipment)}
          onEditShipment={(shipment) => setEditShipment(shipment)}
          onDeleteShipment={(shipment) => setShipmentToDelete(shipment)}
        />
      ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      {/* PDF Zoom Interactive Modal */}
      <PdfZoomModal
        shipment={zoomShipment}
        isOpen={!!zoomShipment}
        onClose={() => setZoomShipment(null)}
        onShipmentUpdated={(updated) => setZoomShipment(updated)}
      />

      {/* Delete Shipment Confirmation Modal */}
      {shipmentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">案件情報の削除確認</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">管理ID: {shipmentToDelete.id}</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              この案件情報（MAWB: <span className="font-semibold text-slate-800">{shipmentToDelete.mawbNumber}</span> / HAWB: <span className="font-semibold text-slate-800">{shipmentToDelete.hawbNumber || 'なし'}</span>）を完全に削除してもよろしいですか？
            </p>
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 p-2.5 rounded-xl">
              ※ 関連する工程タスクやアクティビティログも削除されます。この操作は取り消せません。
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShipmentToDelete(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteShipment(shipmentToDelete.id);
                  setShipmentToDelete(null);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-md transition-colors cursor-pointer"
              >
                案件を完全削除する
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Shipment Edit Modal */}
      {editShipment && (
        <ShipmentEditModal
          shipment={editShipment}
          isOpen={!!editShipment}
          onClose={() => setEditShipment(null)}
          onShipmentUpdated={(updated) => {
            setEditShipment(null);
          }}
        />
      )}

      {/* Customs Email Modal */}
      {emailModalShipment && (
        <CustomsEmailModal
          shipment={emailModalShipment}
          onClose={() => setEmailModalShipment(null)}
        />
      )}
    </div>
  );
};
