import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { Shipment, TaskStatus } from '../types';
import { SiDocumentViewer, TaskOverlayBadges } from './SiDocumentViewer';
import { updateTaskStatus, updateShipmentPdf, getShipments, completeAllTasksForShipment } from '../lib/storageManager';
import { BillingOverlayEditor } from './BillingOverlayEditor';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  FileText,
  ShieldCheck,
  Layers,
  Receipt,
  FileUp,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  CheckCheck,
  CheckCircle2,
  Check,
  Clock,
  Circle,
} from 'lucide-react';

interface PdfZoomModalProps {
  shipment: Shipment | null;
  isOpen: boolean;
  onClose: () => void;
  onShipmentUpdated?: (updated: Shipment) => void;
  shipments?: Shipment[];
  onNavigateShipment?: (nextShipment: Shipment) => void;
}

export const PdfZoomModal: React.FC<PdfZoomModalProps> = ({
  shipment: initialShipment,
  isOpen,
  onClose,
  onShipmentUpdated,
  shipments: propsShipments,
  onNavigateShipment,
}) => {
  const [shipment, setShipment] = useState<Shipment | null>(initialShipment);
  const [scale, setScale] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<'tasks' | 'billing'>('tasks'); // 初期選択を工程タスクにする
  const zoomFileInputRef = React.useRef<HTMLInputElement>(null);
  const [isUploadingZoomPdf, setIsUploadingZoomPdf] = useState(false);
  const [animatingTask, setAnimatingTask] = useState<{ id: string; type: 'complete' | 'deflate' } | null>(null);
  const [showCompleteAllModal, setShowCompleteAllModal] = useState(false);

  const completedCount = shipment?.tasks.filter((t) => t.status === 'Completed').length || 0;
  const uncompletedTasksCount = shipment?.tasks.filter((t) => t.status !== 'Completed').length || 0;
  const isAllCompleted = (shipment?.tasks.length || 0) > 0 && uncompletedTasksCount === 0;
  const totalCount = shipment?.tasks.length || 0;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const handleCompleteAllTasks = () => {
    if (!shipment) return;
    const updated = completeAllTasksForShipment(shipment.id);
    if (updated) {
      setShipment({ ...updated });
      if (onShipmentUpdated) onShipmentUpdated(updated);
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch {
        // ignore
      }
    }
    setShowCompleteAllModal(false);
  };

  // Sync state if initialShipment changes
  React.useEffect(() => {
    setShipment(initialShipment);
  }, [initialShipment]);

  // List of all shipments for navigation
  const allShipments = React.useMemo(() => {
    if (propsShipments && propsShipments.length > 0) return propsShipments;
    return getShipments();
  }, [propsShipments]);

  const currentIndex = React.useMemo(() => {
    if (!shipment) return -1;
    return allShipments.findIndex((s) => s.id === shipment.id);
  }, [allShipments, shipment?.id]);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < allShipments.length - 1;

  const handlePrevShipment = React.useCallback(() => {
    if (!hasPrev) return;
    const prevItem = allShipments[currentIndex - 1];
    setShipment(prevItem);
    if (onNavigateShipment) onNavigateShipment(prevItem);
    if (onShipmentUpdated) onShipmentUpdated(prevItem);
  }, [hasPrev, allShipments, currentIndex, onNavigateShipment, onShipmentUpdated]);

  const handleNextShipment = React.useCallback(() => {
    if (!hasNext) return;
    const nextItem = allShipments[currentIndex + 1];
    setShipment(nextItem);
    if (onNavigateShipment) onNavigateShipment(nextItem);
    if (onShipmentUpdated) onShipmentUpdated(nextItem);
  }, [hasNext, allShipments, currentIndex, onNavigateShipment, onShipmentUpdated]);

  const handleZoomIn = React.useCallback(() => {
    setScale((prev) => Math.min(prev + 0.2, 2.2));
  }, []);

  const handleZoomOut = React.useCallback(() => {
    setScale((prev) => Math.max(prev - 0.2, 0.6));
  }, []);

  const handleResetZoom = React.useCallback(() => {
    setScale(1);
  }, []);

  // Global Keyboard Shortcuts (← / → for navigation, + / - for zoom, 1 / 2 for tabs, Esc to close)
  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing inside an input/textarea/select/contentEditable
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (isInputFocused) {
        return;
      }

      // Shift + C: Complete all tasks shortcut
      if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        if (isAllCompleted) {
          alert('すべての工程タスクは既に完了しています。');
          return;
        }
        setShowCompleteAllModal(true);
        return;
      }

      // Prev / Next navigation: '[' / ']' or ArrowLeft / ArrowRight or PageUp / PageDown
      if (e.key === '[' || e.key === 'PageUp' || (e.altKey && e.key === 'ArrowLeft') || e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevShipment();
      } else if (e.key === ']' || e.key === 'PageDown' || (e.altKey && e.key === 'ArrowRight') || e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextShipment();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        handleResetZoom();
      } else if (e.key === '1') {
        e.preventDefault();
        setActiveTab('tasks');
      } else if (e.key === '2') {
        e.preventDefault();
        setActiveTab('billing');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, handlePrevShipment, handleNextShipment, handleZoomIn, handleZoomOut, handleResetZoom, isAllCompleted]);

  if (!isOpen || !shipment) return null;

  const handleZoomPdfReuploadClick = () => {
    if (zoomFileInputRef.current) {
      zoomFileInputRef.current.click();
    }
  };

  const handleZoomPdfChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('PDFファイル(.pdf)を選択してください。');
      return;
    }

    setIsUploadingZoomPdf(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64 = reader.result as string;
        const updated = updateShipmentPdf(shipment.id, base64);
        if (updated) {
          setShipment({ ...updated });
          if (onShipmentUpdated) onShipmentUpdated(updated);
        }
        setIsUploadingZoomPdf(false);
        alert(`指示書「${file.name}」を正常に再アップロードし、全端末へ同期更新しました。`);
      };
      reader.onerror = () => {
        setIsUploadingZoomPdf(false);
        alert('ファイルの読み込みに失敗しました。');
      };
    } catch (err) {
      setIsUploadingZoomPdf(false);
      alert('PDF再アップロード処理に失敗しました。');
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleTaskStatusChange = (e: React.MouseEvent | undefined, taskId: string, newStatus: TaskStatus) => {
    const isNowCompleting = newStatus === 'Completed';
    const isNowTodo = newStatus === 'Todo';
    const currentTask = shipment?.tasks.find((t) => t.id === taskId);
    const wasCompleted = currentTask?.status === 'Completed';

    if (isNowCompleting) {
      setAnimatingTask({ id: taskId, type: 'complete' });

      if (e) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = (rect.left + rect.width / 2) / window.innerWidth;
        const y = (rect.top + rect.height / 2) / window.innerHeight;

        try {
          // Wave 1: Immediate punchy burst from check button
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

          // Wave 2: Sparkling stars
          setTimeout(() => {
            confetti({
              particleCount: 25,
              angle: 90,
              spread: 90,
              origin: { x, y: Math.max(0, y - 0.04) },
              colors: ['#34D399', '#FBBF24', '#F43F5E', '#A7F3D0', '#60A5FA'],
              ticks: 170,
              gravity: 1.2,
              scalar: 1.2,
            });
          }, 90);

          // All-completed grand celebration check
          const remainingIncomplete = (shipment?.tasks || []).filter((t) => t.id !== taskId && t.status !== 'Completed').length;
          if (remainingIncomplete === 0) {
            setTimeout(() => {
              confetti({
                particleCount: 80,
                spread: 110,
                origin: { x: 0.5, y: 0.4 },
                colors: ['#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#8B5CF6'],
                ticks: 240,
                gravity: 1.0,
                scalar: 1.1,
              });
            }, 280);
          }
        } catch {
          // safe fallback
        }
      }
    } else if (isNowTodo || wasCompleted) {
      setAnimatingTask({ id: taskId, type: 'deflate' });
    }

    setTimeout(() => {
      setAnimatingTask((prev) => (prev?.id === taskId ? null : prev));
    }, 950);

    const updated = updateTaskStatus(shipment.id, taskId, newStatus);
    if (updated) {
      setShipment({ ...updated });
      if (onShipmentUpdated) onShipmentUpdated(updated);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col z-50 overflow-hidden animate-fadeIn">
      <input
        type="file"
        ref={zoomFileInputRef}
        onChange={handleZoomPdfChange}
        accept=".pdf,application/pdf"
        className="hidden"
      />
      {/* Top Fixed Control Bar */}
      <div className="bg-slate-900 border-b border-slate-800 text-white px-6 py-3 flex flex-wrap items-center justify-between gap-4 shrink-0 shadow-lg">
        {/* Document Meta Info & Shipment Summary */}
        <div className="flex items-center flex-wrap gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/30 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-bold text-white font-mono">{shipment.id}</h2>
                <span className="text-xs text-slate-300 font-bold">指示書</span>
                <TaskOverlayBadges
                  tasks={shipment.tasks}
                  shipmentId={shipment.id}
                  isSmall={true}
                  onTasksReordered={(updated) => {
                    setShipment({ ...updated });
                    if (onShipmentUpdated) onShipmentUpdated(updated);
                  }}
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Shipper: {shipment.shipper} • MAWB: {shipment.mawbNumber}
              </p>
            </div>
          </div>

          {/* Shipment Navigation (前へ / 次へ / インデックス表示) */}
          {allShipments.length > 1 && currentIndex >= 0 && (
            <div className="flex items-center space-x-1 bg-slate-800/90 px-2 py-1 rounded-xl border border-slate-700/80 shadow-xs">
              <button
                type="button"
                onClick={handlePrevShipment}
                disabled={!hasPrev}
                className={`px-2 py-1 rounded-lg transition-colors flex items-center space-x-1 text-xs font-bold ${
                  hasPrev
                    ? 'text-slate-200 hover:text-white hover:bg-slate-700 cursor-pointer active:scale-95'
                    : 'text-slate-600 cursor-not-allowed opacity-40'
                }`}
                title="前の案件へ (ショートカット: [ または ←)"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">前へ</span>
              </button>
              <span className="px-2 py-0.5 rounded-md bg-slate-900/90 text-[11px] font-mono text-blue-300 font-bold border border-slate-700/50">
                {currentIndex + 1} / {allShipments.length}
              </span>
              <button
                type="button"
                onClick={handleNextShipment}
                disabled={!hasNext}
                className={`px-2 py-1 rounded-lg transition-colors flex items-center space-x-1 text-xs font-bold ${
                  hasNext
                    ? 'text-slate-200 hover:text-white hover:bg-slate-700 cursor-pointer active:scale-95'
                    : 'text-slate-600 cursor-not-allowed opacity-40'
                }`}
                title="次の案件へ (ショートカット: ] または →)"
              >
                <span className="hidden sm:inline">次へ</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 通関日, 向け地, カット時間, 個数, 重量 表示エリア */}
          <div className="flex items-center flex-wrap gap-2.5 text-xs bg-slate-800/90 px-3 py-1.5 rounded-xl border border-slate-700/80 shadow-xs">
            <div className="flex items-center space-x-1">
              <span className="text-[10px] text-slate-400 font-medium">通関日:</span>
              <span className="font-bold text-emerald-300 font-mono">{shipment.customsClearanceDate || '未設定'}</span>
            </div>
            <div className="h-3 w-[1px] bg-slate-700" />
            <div className="flex items-center space-x-1">
              <span className="text-[10px] text-slate-400 font-medium">向け地:</span>
              <span className="font-bold text-blue-200">{shipment.destination || '未設定'}</span>
            </div>
            <div className="h-3 w-[1px] bg-slate-700" />
            <div className="flex items-center space-x-1">
              <span className="text-[10px] text-slate-400 font-medium">カット時間:</span>
              <span className={`font-bold ${shipment.cutTime ? 'text-rose-300' : 'text-slate-300'}`}>
                {shipment.cutTime || '未設定'}
              </span>
            </div>
            <div className="h-3 w-[1px] bg-slate-700" />
            <div className="flex items-center space-x-1">
              <span className="text-[10px] text-slate-400 font-medium">個数:</span>
              <span className="font-bold text-indigo-300 font-mono">
                {shipment.pieces || (shipment.pkgCount ? `${shipment.pkgCount}個` : '-')}
              </span>
            </div>
            <div className="h-3 w-[1px] bg-slate-700" />
            <div className="flex items-center space-x-1">
              <span className="text-[10px] text-slate-400 font-medium">重量:</span>
              <span className="font-bold text-indigo-300 font-mono">
                {shipment.grossWeight || (shipment.weight ? `${shipment.weight}kg` : '-')}
              </span>
            </div>
          </div>
        </div>

        {/* Zoom Action Controls (Req: 拡大・縮小ボタン & PDF再アップロード) */}
        <div className="flex items-center space-x-2 bg-slate-800/90 p-1.5 rounded-2xl border border-slate-700/80 shadow-xs">
          <button
            onClick={handleZoomPdfReuploadClick}
            disabled={isUploadingZoomPdf}
            className="px-2.5 py-1 text-xs font-bold text-indigo-200 bg-indigo-600/80 hover:bg-indigo-500 text-white rounded-lg transition-all flex items-center space-x-1 border border-indigo-400/30 cursor-pointer disabled:opacity-50"
            title="この案件の指示書PDFを再アップロード・差し替え"
          >
            <FileUp className="w-3.5 h-3.5 mr-1" />
            <span>{isUploadingZoomPdf ? '更新中...' : 'PDF再アップロード'}</span>
          </button>

          <div className="h-4 w-[1px] bg-slate-700 mx-1" />

          <button
            onClick={handleZoomOut}
            disabled={scale <= 0.6}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-700/60 rounded-xl transition-all disabled:opacity-30 disabled:hover:bg-transparent"
            title="縮小 (Zoom Out)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <span className="text-xs font-mono font-bold text-blue-300 px-2 min-w-[50px] text-center">
            {Math.round(scale * 100)}%
          </span>

          <button
            onClick={handleZoomIn}
            disabled={scale >= 2.2}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-700/60 rounded-xl transition-all disabled:opacity-30 disabled:hover:bg-transparent"
            title="拡大 (Zoom In)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <div className="h-4 w-[1px] bg-slate-700 mx-1" />

          <button
            onClick={handleResetZoom}
            className="px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700/60 rounded-lg transition-all flex items-center space-x-1"
            title="標準サイズリセット (100%)"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            <span>リセット</span>
          </button>
        </div>

        {/* Progress, Shortcuts & Close */}
        <div className="flex items-center space-x-3">
          {/* Keyboard Shortcuts Hint Badge */}
          <div className="hidden lg:flex items-center space-x-2 text-[11px] text-slate-300 bg-slate-800/90 px-3 py-1.5 rounded-xl border border-slate-700/80 shadow-xs">
            <Keyboard className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="font-mono bg-slate-900/90 px-1.5 py-0.5 rounded text-slate-200 font-bold border border-slate-700/50">← / →</span>
            <span>案件切替</span>
            <span className="text-slate-600">•</span>
            <span className="font-mono bg-slate-900/90 px-1.5 py-0.5 rounded text-slate-200 font-bold border border-slate-700/50">+/-</span>
            <span>ズーム</span>
            <span className="text-slate-600">•</span>
            <span className="font-mono bg-slate-900/90 px-1.5 py-0.5 rounded text-slate-200 font-bold border border-slate-700/50">1/2</span>
            <span>タブ切替</span>
            <span className="text-slate-600">•</span>
            <span className="font-mono bg-slate-900/90 px-1.5 py-0.5 rounded text-emerald-300 font-bold border border-emerald-500/40">Shift+C</span>
            <span>全完了</span>
            <span className="text-slate-600">•</span>
            <span className="font-mono bg-slate-900/90 px-1.5 py-0.5 rounded text-slate-200 font-bold border border-slate-700/50">Esc</span>
            <span>閉じる</span>
          </div>

          <div className="hidden md:flex items-center space-x-2 text-xs bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700">
            <span className="text-slate-400">進捗達成度:</span>
            <span className="font-bold font-mono text-emerald-400">{progressPct}%</span>
            <span className="text-slate-500">({completedCount}/{totalCount})</span>
          </div>

          <button
            type="button"
            onClick={() => {
              if (isAllCompleted) {
                alert('すべての工程タスクは既に完了しています。');
                return;
              }
              setShowCompleteAllModal(true);
            }}
            disabled={isAllCompleted}
            className={`hidden sm:flex items-center space-x-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
              isAllCompleted
                ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40 opacity-80 cursor-default'
                : 'bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white border-emerald-500 shadow-xs hover:shadow-emerald-600/30'
            }`}
            title="すべての工程タスクを一括完了 [Shift + C]"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>{isAllCompleted ? '全工程完了済' : '全タスク完了'}</span>
            <kbd
              className={`px-1 py-0.2 text-[9px] font-mono rounded font-extrabold ${
                isAllCompleted ? 'bg-emerald-900/60 text-emerald-300' : 'bg-emerald-700 text-emerald-100'
              }`}
            >
              Shift+C
            </kbd>
          </button>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors border border-transparent hover:border-slate-700 cursor-pointer"
            title="閉じる (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Content Area (Zoomable Document + Side Quick Task Bar) */}
      <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
        {/* Document Canvas Container (Full height layout, toolbar fixed at top, PDF scrolls inside) */}
        <div className="flex-1 overflow-hidden flex flex-col items-center justify-start bg-slate-950/50 p-2 sm:p-4 min-w-0">
          <SiDocumentViewer
            shipment={shipment}
            scale={scale}
            onShipmentUpdated={(updated) => {
              setShipment({ ...updated });
              if (onShipmentUpdated) onShipmentUpdated(updated);
            }}
          />
        </div>

        {/* Side Inspector / Billing Overlay Controls Panel (幅を20%削減して528pxに調整) */}
        <div className="w-full md:w-[528px] bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 p-4 overflow-y-auto shrink-0 flex flex-col justify-between text-white space-y-4">
          <div className="space-y-4">
            {/* Tab Navigation Selector (工程タスク左、請求明細オーバーレイ右) */}
            <div className="flex items-center space-x-1 bg-slate-800/90 p-1 rounded-xl border border-slate-700/80">
              <button
                type="button"
                onClick={() => setActiveTab('tasks')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                  activeTab === 'tasks'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>工程タスク ({completedCount}/{totalCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('billing')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                  activeTab === 'billing'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>請求明細オーバーレイ</span>
              </button>
            </div>

            {/* Tab Content 1: Billing Overlay Editor (Keep mounted to preserve any active inputs seamlessly) */}
            <div className={activeTab === 'billing' ? 'block' : 'hidden'}>
              <BillingOverlayEditor
                shipment={shipment}
                onShipmentUpdated={(updated) => {
                  setShipment({ ...updated });
                  if (onShipmentUpdated) onShipmentUpdated(updated);
                }}
              />
            </div>

            {/* Tab Content 2: Task List Status Inspector */}
            {activeTab === 'tasks' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center">
                    <ShieldCheck className="w-4 h-4 mr-1.5 text-blue-400" />
                    指示書工程タスク一覧
                  </h3>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (isAllCompleted) {
                          alert('すべての工程タスクは既に完了しています。');
                          return;
                        }
                        setShowCompleteAllModal(true);
                      }}
                      disabled={isAllCompleted}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer border ${
                        isAllCompleted
                          ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40 opacity-70 cursor-default'
                          : 'bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white border-emerald-500 shadow-xs'
                      }`}
                      title="すべての工程タスクを一括完了 [Shift + C]"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>{isAllCompleted ? '全完了済' : '全タスク完了'}</span>
                      <kbd className="text-[9.5px] font-mono opacity-80 ml-0.5">Shift+C</kbd>
                    </button>
                    <span className="text-[11px] font-mono text-blue-400">{completedCount}/{totalCount} 完了</span>
                  </div>
                </div>

                <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
                  {shipment.tasks.map((task, idx) => {
                    const isAnimating = animatingTask?.id === task.id;
                    const animType = isAnimating ? animatingTask?.type : null;

                    return (
                      <motion.div
                        key={task.id}
                        animate={
                          animType === 'complete'
                            ? {
                                scale: [1, 1.035, 0.98, 1.01, 1],
                                borderColor: ['#10B981', '#34D399', '#10B981'],
                                boxShadow: [
                                  '0 0 0 0 rgba(16, 185, 129, 0)',
                                  '0 0 0 8px rgba(16, 185, 129, 0.35)',
                                  '0 0 0 14px rgba(16, 185, 129, 0)',
                                  '0 1px 3px 0 rgba(0, 0, 0, 0.2)',
                                ],
                              }
                            : animType === 'deflate'
                            ? {
                                scale: [1, 0.94, 0.98, 1],
                                y: [0, 2, -1, 0],
                                filter: [
                                  'brightness(1)',
                                  'brightness(0.85) grayscale(0.4)',
                                  'brightness(1) grayscale(0)',
                                ],
                              }
                            : { scale: 1, y: 0 }
                        }
                        transition={{
                          duration: animType === 'complete' ? 0.65 : 0.5,
                          ease: animType === 'complete' ? 'backOut' : 'easeInOut',
                        }}
                        className={`p-3 rounded-xl border text-xs space-y-2 transition-colors relative ${
                          task.status === 'Completed'
                            ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-100 ring-1 ring-emerald-500/20'
                            : task.status === 'In Progress'
                            ? 'bg-amber-500/15 border-amber-500/50 text-amber-100 ring-1 ring-amber-500/30'
                            : 'bg-slate-800/90 border-slate-700 text-slate-200'
                        }`}
                      >
                        {/* Pop-up Celebration Badge on Complete */}
                        <AnimatePresence>
                          {animType === 'complete' && (
                            <motion.div
                              initial={{ opacity: 0, y: 5, scale: 0.5, rotate: -4 }}
                              animate={{ opacity: 1, y: -24, scale: 1.15, rotate: 0 }}
                              exit={{ opacity: 0, y: -34, scale: 0.8 }}
                              transition={{ duration: 0.75, ease: 'easeOut' }}
                              className="absolute -top-1 left-8 z-30 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[10px] font-black px-3 py-0.5 rounded-full shadow-lg flex items-center space-x-1.5 whitespace-nowrap pointer-events-none border border-emerald-300 ring-2 ring-emerald-400/40"
                            >
                              <Sparkles className="w-3 h-3 text-amber-300 animate-spin" />
                              <span>🎉 工程完了! ✨</span>
                            </motion.div>
                          )}

                          {/* Deflation Puff Badge on Revert to Todo */}
                          {animType === 'deflate' && (
                            <motion.div
                              initial={{ opacity: 0, scale: 1.05, y: 0 }}
                              animate={{ opacity: 1, scale: 0.9, y: -16 }}
                              exit={{ opacity: 0, scale: 0.7, y: -24 }}
                              transition={{ duration: 0.5, ease: 'easeOut' }}
                              className="absolute -top-1 left-8 z-30 bg-slate-700 text-white text-[9px] font-bold px-2 py-0.5 rounded-full shadow-md flex items-center space-x-1 whitespace-nowrap pointer-events-none"
                            >
                              <span>💨 予定へ変更</span>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start space-x-2 min-w-0">
                            {/* Dedicated Task Check Button with Tactile Spring, Shockwaves & Sparkle Burst */}
                            <div className="relative shrink-0 flex items-center justify-center mt-0.5">
                              <motion.button
                                type="button"
                                whileHover={{ scale: 1.15 }}
                                whileTap={{ scale: 0.82 }}
                                onClick={(e) => {
                                  const nextStatus: TaskStatus = task.status === 'Completed' ? 'Todo' : 'Completed';
                                  handleTaskStatusChange(e, task.id, nextStatus);
                                }}
                                className={`group/chk relative w-6 h-6 rounded-lg flex items-center justify-center transition-all cursor-pointer shadow-xs border ${
                                  task.status === 'Completed'
                                    ? 'bg-gradient-to-br from-emerald-500 to-teal-600 border-emerald-400 text-white shadow-emerald-500/30'
                                    : task.status === 'In Progress'
                                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 hover:border-amber-400'
                                    : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-emerald-400 hover:border-emerald-500'
                                }`}
                                title={task.status === 'Completed' ? 'クリックで未着手に戻す' : 'クリックで完了にする'}
                              >
                                {animType === 'complete' && (
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
                                      const dist = 20;
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

                                {task.status === 'Completed' ? (
                                  <motion.div
                                    initial={animType === 'complete' ? { scale: 0, rotate: -45 } : false}
                                    animate={{ scale: 1, rotate: 0 }}
                                    transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                                  >
                                    <Check className="w-3.5 h-3.5 stroke-[3.5]" />
                                  </motion.div>
                                ) : task.status === 'In Progress' ? (
                                  <Clock className="w-3.5 h-3.5 animate-pulse text-amber-400" />
                                ) : (
                                  <Check className="w-3 h-3 opacity-0 group-hover/chk:opacity-60 transition-opacity" />
                                )}
                              </motion.button>
                            </div>

                            <span className="font-semibold leading-snug">
                              {idx + 1}. {task.title}
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                              task.status === 'Completed'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : task.status === 'In Progress'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-slate-700 text-slate-400'
                            }`}
                          >
                            {task.status === 'Completed' ? '完了' : task.status === 'In Progress' ? '進行中' : '未着手'}
                          </span>
                        </div>

                        {/* Quick Change Controls inside modal */}
                        <div className="flex items-center justify-end space-x-1 pt-1">
                          <button
                            onClick={(e) => handleTaskStatusChange(e, task.id, 'Todo')}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                              task.status === 'Todo'
                                ? 'bg-slate-700 text-white font-bold'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            未着手
                          </button>
                          <button
                            onClick={(e) => handleTaskStatusChange(e, task.id, 'In Progress')}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                              task.status === 'In Progress'
                                ? 'bg-amber-500 text-white font-bold'
                                : 'text-slate-400 hover:text-amber-300'
                            }`}
                          >
                            進行中
                          </button>
                          <motion.button
                            whileTap={{ scale: 0.92 }}
                            onClick={(e) => handleTaskStatusChange(e, task.id, 'Completed')}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer flex items-center space-x-1 ${
                              task.status === 'Completed'
                                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold ring-1 ring-emerald-400 shadow-xs'
                                : 'text-slate-400 hover:text-emerald-300'
                            }`}
                          >
                            <Check className="w-3 h-3 stroke-[3]" />
                            <span>完了</span>
                          </motion.button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-800 text-[11px] text-slate-400 text-center">
            プレビュー上のズーム操作は上部のコントロールで調整できます。
          </div>
        </div>
      </div>

      {/* Complete All Tasks Confirmation Modal */}
      {showCompleteAllModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 rounded-3xl shadow-2xl border border-slate-700 max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150 text-white">
            <div className="flex items-center space-x-3.5 text-emerald-400">
              <div className="w-11 h-11 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center shrink-0 shadow-xs">
                <CheckCheck className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-1.5">
                  <span>工程タスクの一括完了</span>
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-900/60 text-emerald-300 border border-emerald-600/40">
                    Shift + C
                  </span>
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">案件ID: {shipment.id}</p>
              </div>
            </div>

            <div className="space-y-2 text-sm text-slate-300 leading-relaxed">
              <p>
                この案件の未完了タスク（<span className="font-bold text-emerald-400">{uncompletedTasksCount}件</span>）を一括ですべて【<span className="font-bold text-white">完了</span>】に更新しますか？
              </p>
              <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-2xl p-3 text-xs text-emerald-200 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>各タスクに現在のタイムスタンプおよび操作ユーザーが記録されます</span>
                </div>
                <div className="flex items-center gap-1.5 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>案件全体の総合ステータスも自動的に【全工程完了】になります</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCompleteAllModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 rounded-xl transition-colors cursor-pointer border border-slate-700"
              >
                キャンセル (Esc)
              </button>
              <button
                type="button"
                onClick={handleCompleteAllTasks}
                autoFocus
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-98 rounded-xl shadow-md hover:shadow-emerald-600/30 transition-all inline-flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
                <span>全タスクを一括完了にする</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
