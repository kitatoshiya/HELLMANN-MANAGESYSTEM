import React, { useState, useEffect, useRef } from 'react';
import { Shipment, Task } from '../types';
import {
  FileText,
  ZoomIn,
  ZoomOut,
  Download,
  ExternalLink,
  RotateCcw,
  GripVertical,
  Trash2,
  X,
  FileUp,
  UploadCloud,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { PdfCanvasViewer } from './PdfCanvasViewer';
import { generateOverlayPdfFromShipment } from '../lib/pdfGenerator';
import { reorderShipmentTasks, deleteTaskFromShipment, updateShipmentPdf } from '../lib/storageManager';
import { getPdfFromStorageSync, getShipmentPdfAsync, savePdfToStorage } from '../lib/pdfStorageService';

interface SiDocumentViewerProps {
  shipment: Shipment;
  isThumbnail?: boolean;
  scale?: number;
  onClick?: () => void;
  onShipmentUpdated?: (updated: Shipment) => void;
}

interface TaskOverlayBadgesProps {
  tasks: Task[];
  shipmentId: string;
  isSmall?: boolean;
  onTasksReordered?: (updatedShipment: Shipment) => void;
}

export const TaskOverlayBadges: React.FC<TaskOverlayBadgesProps> = ({
  tasks,
  shipmentId,
  isSmall = false,
  onTasksReordered,
}) => {
  const [taskList, setTaskList] = useState<Task[]>(tasks || []);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  useEffect(() => {
    setTaskList(tasks || []);
  }, [tasks]);

  if (!taskList || taskList.length === 0) return null;

  const handleReorder = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= taskList.length || toIdx >= taskList.length) return;
    const updated = [...taskList];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    setTaskList(updated);

    if (shipmentId) {
      const updatedShipment = reorderShipmentTasks(shipmentId, updated);
      if (updatedShipment && onTasksReordered) {
        onTasksReordered(updatedShipment);
      }
    }
  };

  const handleDeleteTask = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    e.preventDefault();
    if (confirm(`工程タスク「${task.title}」を削除してもよろしいですか？`)) {
      const updatedShipment = deleteTaskFromShipment(shipmentId, task.id);
      if (updatedShipment) {
        setTaskList(updatedShipment.tasks);
        if (onTasksReordered) {
          onTasksReordered(updatedShipment);
        }
      }
    }
  };

  return (
    <div
      className={`progress-overlay-wrapper flex items-center flex-nowrap ${
        isSmall ? 'space-x-0 px-1 py-0.5' : 'space-x-0 px-2 py-1'
      } bg-slate-800/90 border border-slate-700/80 rounded-xl shadow-xs z-20 pointer-events-auto select-none transition-all shrink-0`}
      title="指示書工程タスク進捗（ドラッグ＆ドロップで工程順序を並べ替え可能）"
    >
      {!isSmall && (
        <div className="flex items-center space-x-1 mr-1 text-slate-400 text-[9px] font-bold shrink-0">
          <GripVertical className="w-3 h-3 text-slate-400" />
          <span className="hidden sm:inline text-[9px] text-slate-400 font-medium">順序変更:</span>
        </div>
      )}

      {taskList.map((task, idx) => {
        const shortText = task.shortName || task.title.slice(0, 3);
        const isInProgress = task.status === 'In Progress';
        const isCompleted = task.status === 'Completed';

        let circleStyle = 'border-slate-300 bg-white';
        if (isInProgress) {
          circleStyle = 'border-amber-400 bg-amber-100 ring-1 ring-amber-300/60';
        } else if (isCompleted) {
          circleStyle = 'border-emerald-500 bg-emerald-50/90';
        }

        const badgeDimensions = isSmall
          ? 'min-w-[20px] h-5 px-1 text-[9px]'
          : 'min-w-[24px] h-5.5 px-1.5 text-[10px]';

        const isDragging = draggedIdx === idx;
        const isHovered = dragOverIdx === idx;

        return (
          <div
            key={task.id}
            draggable={!isSmall}
            onDragStart={(e) => {
              if (isSmall) return;
              e.dataTransfer.setData('text/plain', idx.toString());
              e.dataTransfer.effectAllowed = 'move';
              setDraggedIdx(idx);
            }}
            onDragOver={(e) => {
              if (isSmall) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverIdx !== idx) setDragOverIdx(idx);
            }}
            onDragLeave={() => {
              if (dragOverIdx === idx) setDragOverIdx(null);
            }}
            onDrop={(e) => {
              if (isSmall) return;
              e.preventDefault();
              const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
              if (!isNaN(fromIdx)) {
                handleReorder(fromIdx, idx);
              }
              setDraggedIdx(null);
              setDragOverIdx(null);
            }}
            onDragEnd={() => {
              setDraggedIdx(null);
              setDragOverIdx(null);
            }}
            className={`group relative shrink-0 rounded-full border-2 ${circleStyle} ${badgeDimensions} flex items-center justify-center font-extrabold transition-all ${
              !isSmall ? 'cursor-grab active:cursor-grabbing' : ''
            } ${isDragging ? 'opacity-40 scale-95 ring-2 ring-blue-500' : ''} ${
              isHovered ? 'scale-110 ring-2 ring-blue-400 shadow-md' : 'hover:scale-105'
            }`}
            title={
              !isSmall
                ? `[ドラッグして並べ替え] ${task.title}: ${isCompleted ? '完了' : isInProgress ? '作業中' : '未着手'}`
                : `${task.title}: ${isCompleted ? '完了' : isInProgress ? '作業中' : '未着手'}`
            }
          >
            <span className="z-20 text-black font-extrabold tracking-tight whitespace-nowrap">{shortText}</span>

            {!isSmall && (
              <button
                type="button"
                onClick={(e) => handleDeleteTask(e, task)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-600 hover:bg-rose-700 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 z-30 transition-opacity shadow-xs cursor-pointer"
                title={`タスク「${task.title}」を削除`}
              >
                <X className="w-2.5 h-2.5 stroke-[3]" />
              </button>
            )}

            {isCompleted && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                <line
                  x1="12"
                  y1="88"
                  x2="88"
                  y2="12"
                  stroke="#ef4444"
                  strokeWidth="8"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const SiDocumentViewer: React.FC<SiDocumentViewerProps> = ({
  shipment,
  isThumbnail = false,
  scale = 1,
  onClick,
  onShipmentUpdated,
}) => {
  const [zoomScale, setZoomScale] = useState<number>(scale || 1);
  const [rawPdfUrl, setRawPdfUrl] = useState<string>(() => {
    return (
      (shipment.originalPdfUrl && shipment.originalPdfUrl.length > 500 ? shipment.originalPdfUrl : null) ||
      (shipment.pdfDataUrl && shipment.pdfDataUrl.length > 500 ? shipment.pdfDataUrl : null) ||
      getPdfFromStorageSync(shipment.id) ||
      (shipment.hawbNumber ? getPdfFromStorageSync(shipment.hawbNumber) : null) ||
      (shipment.mawbNumber ? getPdfFromStorageSync(shipment.mawbNumber) : null) ||
      ''
    );
  });
  const [embeddedPdfUrl, setEmbeddedPdfUrl] = useState<string>('');
  const [isLoadingServerPdf, setIsLoadingServerPdf] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isUploadingPdf, setIsUploadingPdf] = useState<boolean>(false);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);

  const thumbnailContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDraggingRef = useRef<boolean>(false);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const scrollPosRef = useRef<{ left: number; top: number }>({ left: 0, top: 0 });
  const hasMovedRef = useRef<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);

  // Sync zoom scale from props
  useEffect(() => {
    if (scale) {
      setZoomScale(scale);
    }
  }, [scale]);

  // Attempt local and server PDF retrieval when shipment changes
  useEffect(() => {
    let isMounted = true;

    const initialPdf =
      (shipment.originalPdfUrl && shipment.originalPdfUrl.length > 500 ? shipment.originalPdfUrl : null) ||
      (shipment.pdfDataUrl && shipment.pdfDataUrl.length > 500 ? shipment.pdfDataUrl : null) ||
      getPdfFromStorageSync(shipment.id) ||
      (shipment.hawbNumber ? getPdfFromStorageSync(shipment.hawbNumber) : null) ||
      (shipment.mawbNumber ? getPdfFromStorageSync(shipment.mawbNumber) : null);

    if (initialPdf && initialPdf.length > 500) {
      setRawPdfUrl(initialPdf);
      setIsLoadingServerPdf(false);
      return;
    }

    // Fetch from server / IndexedDB if not found synchronously
    setIsLoadingServerPdf(true);
    getShipmentPdfAsync(shipment.id, shipment.hawbNumber, shipment.mawbNumber)
      .then((serverPdf) => {
        if (!isMounted) return;
        if (serverPdf && serverPdf.length > 500) {
          setRawPdfUrl(serverPdf);
          const updated = updateShipmentPdf(shipment.id, serverPdf);
          if (updated && onShipmentUpdated) {
            onShipmentUpdated(updated);
          }
        } else {
          setRawPdfUrl('');
        }
        setIsLoadingServerPdf(false);
      })
      .catch(() => {
        if (isMounted) {
          setRawPdfUrl('');
          setIsLoadingServerPdf(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [shipment.id, shipment.hawbNumber, shipment.mawbNumber, shipment.pdfDataUrl, shipment.originalPdfUrl]);

  // Generate overlay PDF if raw PDF exists
  useEffect(() => {
    let isMounted = true;

    if (!rawPdfUrl || rawPdfUrl.length < 500) {
      setEmbeddedPdfUrl('');
      return;
    }

    async function updateOverlayPdf() {
      try {
        const url = await generateOverlayPdfFromShipment({
          ...shipment,
          originalPdfUrl: rawPdfUrl,
          pdfDataUrl: rawPdfUrl,
        });
        if (isMounted && url && url.length > 500) {
          setEmbeddedPdfUrl(url);
        } else if (isMounted) {
          setEmbeddedPdfUrl(rawPdfUrl);
        }
      } catch (err) {
        if (isMounted) {
          setEmbeddedPdfUrl(rawPdfUrl);
        }
      }
    }
    updateOverlayPdf();

    return () => {
      isMounted = false;
    };
  }, [
    rawPdfUrl,
    shipment.id,
    shipment.tasks,
    shipment.billingItems,
    shipment.specialNotes,
    shipment.status,
  ]);

  // Thumbnail pan / drag navigation
  useEffect(() => {
    if (!isThumbnail) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const container = thumbnailContainerRef.current;
      if (!container) return;

      const dx = e.clientX - startPosRef.current.x;
      const dy = e.clientY - startPosRef.current.y;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMovedRef.current = true;
      }

      container.scrollLeft = scrollPosRef.current.left - dx;
      container.scrollTop = scrollPosRef.current.top - dy;
    };

    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsPanning(false);
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isThumbnail]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const container = thumbnailContainerRef.current;
    if (!container) return;

    isDraggingRef.current = true;
    hasMovedRef.current = false;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    scrollPosRef.current = { left: container.scrollLeft, top: container.scrollTop };
    setIsPanning(true);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const container = thumbnailContainerRef.current;
    if (!container) return;

    const touch = e.touches[0];
    isDraggingRef.current = true;
    hasMovedRef.current = false;
    startPosRef.current = { x: touch.clientX, y: touch.clientY };
    scrollPosRef.current = { left: container.scrollLeft, top: container.scrollTop };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const container = thumbnailContainerRef.current;
    if (!container) return;

    const touch = e.touches[0];
    const dx = touch.clientX - startPosRef.current.x;
    const dy = touch.clientY - startPosRef.current.y;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMovedRef.current = true;
    }

    container.scrollLeft = scrollPosRef.current.left - dx;
    container.scrollTop = scrollPosRef.current.top - dy;
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
  };

  const handleThumbnailClick = (e: React.MouseEvent) => {
    if (hasMovedRef.current) {
      e.stopPropagation();
      e.preventDefault();
      hasMovedRef.current = false;
      return;
    }
    if (onClick) {
      onClick();
    }
  };

  // PDF File Upload & Drag-and-Drop Handlers
  const handleOpenFileDialog = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const processUploadedPdfFile = (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('PDFファイル（.pdf）を選択してください。');
      return;
    }

    setIsUploadingPdf(true);
    setUploadSuccessMessage(null);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      if (!base64 || base64.length < 500) {
        setIsUploadingPdf(false);
        alert('PDFファイルの読み込みに失敗しました。');
        return;
      }

      await savePdfToStorage(shipment.id, base64, [shipment.hawbNumber || '', shipment.mawbNumber || '']);
      const updated = updateShipmentPdf(shipment.id, base64);
      setRawPdfUrl(base64);
      setIsLoadingServerPdf(false);
      setIsUploadingPdf(false);
      setUploadSuccessMessage(`S/I PDF「${file.name}」を正常に登録しました`);

      if (updated && onShipmentUpdated) {
        onShipmentUpdated(updated);
      }

      setTimeout(() => {
        setUploadSuccessMessage(null);
      }, 4000);
    };

    reader.onerror = () => {
      setIsUploadingPdf(false);
      alert('PDFファイルの読み取り中にエラーが発生しました。');
    };

    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processUploadedPdfFile(file);
    }
    if (e.target) e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      processUploadedPdfFile(file);
    }
  };

  const activePdfUrl = embeddedPdfUrl || rawPdfUrl;
  const hasValidPdf = Boolean(activePdfUrl && activePdfUrl.length > 500);

  const completedTasks = shipment.tasks.filter((t) => t.status === 'Completed').length;
  const totalTasks = shipment.tasks.length;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const handleOpenPdfNewTab = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasValidPdf) return;
    const win = window.open();
    if (win) {
      win.document.write(
        `<iframe src="${activePdfUrl}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`
      );
    }
  };

  const handleDownloadPdf = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasValidPdf) return;
    try {
      const highResUrl = await generateOverlayPdfFromShipment(shipment, { forceRefresh: true });
      const downloadTarget = highResUrl || activePdfUrl;
      const link = document.createElement('a');
      link.href = downloadTarget;
      link.download = `SI_${shipment.id || 'export'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      const link = document.createElement('a');
      link.href = activePdfUrl;
      link.download = `SI_${shipment.id || 'export'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomScale((prev) => Math.min(prev + 0.25, 2.5));
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleResetZoom = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomScale(1);
  };

  // ----------------------------------------------------
  // Render Thumbnail Mode
  // ----------------------------------------------------
  if (isThumbnail) {
    return (
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`group relative bg-slate-900 border rounded-2xl overflow-hidden shadow-xs transition-all flex flex-col h-full select-none ${
          isDragOver
            ? 'border-blue-400 ring-2 ring-blue-500/60 shadow-xl'
            : 'border-slate-800 hover:border-blue-400 hover:shadow-xl'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".pdf,application/pdf"
          className="hidden"
        />

        {/* Header Ribbon */}
        <div className="bg-slate-900 text-white px-2.5 py-1.5 flex items-center justify-between border-b border-slate-800 shrink-0 select-none z-10 gap-2 overflow-x-auto">
          <div className="flex items-center space-x-2 shrink-0">
            <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-[11px] font-bold tracking-tight text-slate-100 shrink-0">指示書</span>
            <TaskOverlayBadges
              tasks={shipment.tasks}
              shipmentId={shipment.id}
              isSmall={true}
              onTasksReordered={onShipmentUpdated}
            />
          </div>

          <div className="flex items-center space-x-1 shrink-0">
            {/* Interactive Zoom Controls (only shown when valid PDF exists) */}
            {hasValidPdf && (
              <div className="flex items-center space-x-1 bg-slate-800/90 px-1.5 py-0.5 rounded-lg border border-slate-700 shrink-0">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  disabled={zoomScale <= 0.5}
                  className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded disabled:opacity-30 cursor-pointer transition-colors"
                  title="縮小 (-)"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
                <span
                  onClick={handleResetZoom}
                  className="text-[10px] font-mono font-bold text-blue-300 px-1 cursor-pointer hover:text-white hover:underline"
                  title="クリックで標準サイズにリセット"
                >
                  {Math.round(zoomScale * 100)}%
                </span>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  disabled={zoomScale >= 2.5}
                  className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded disabled:opacity-30 cursor-pointer transition-colors"
                  title="拡大 (+)"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center Area: PDF Canvas Viewer OR Drop-Zone Upload Prompt */}
        {isLoadingServerPdf ? (
          <div className="relative flex-1 bg-slate-900/90 p-4 flex flex-col items-center justify-center min-h-[160px] text-slate-300 space-y-2">
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            <span className="text-[11px] font-medium text-slate-400">サーバーからS/I PDFを取得中...</span>
          </div>
        ) : hasValidPdf ? (
          <div
            ref={thumbnailContainerRef}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onClick={handleThumbnailClick}
            className={`relative flex-1 bg-slate-100 p-2 overflow-auto flex items-start justify-center min-h-0 select-none ${
              isPanning ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            title="ドラッグで移動、クリックで全画面拡大表示（ここに新しいS/I PDFをドロップして差し替えも可能）"
          >
            {/* Drag-over overlay when user drags a replacement PDF */}
            {isDragOver && (
              <div className="absolute inset-0 bg-blue-950/85 backdrop-blur-xs z-30 flex flex-col items-center justify-center p-3 text-center pointer-events-none animate-in fade-in duration-150">
                <UploadCloud className="w-8 h-8 text-blue-400 animate-bounce mb-1" />
                <span className="text-xs font-bold text-white">S/I (PDF) をドロップして差し替え</span>
                <span className="text-[10px] text-blue-200 mt-0.5">サーバーおよび端末に自動同期保存</span>
              </div>
            )}
            <PdfCanvasViewer pdfDataUrl={activePdfUrl} isThumbnail={true} scale={zoomScale} />
          </div>
        ) : (
          /* Missing PDF Drop-Zone in Thumbnail Mode */
          <div
            onClick={handleOpenFileDialog}
            className={`relative flex-1 p-3.5 flex flex-col items-center justify-center min-h-[160px] text-center transition-all cursor-pointer ${
              isDragOver
                ? 'bg-blue-950/70 text-blue-200'
                : 'bg-slate-900/90 hover:bg-slate-800/80 text-slate-400'
            }`}
            title="クリックまたはPDFをドラッグ＆ドロップしてS/Iを登録"
          >
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center mb-2 transition-all ${
                isDragOver
                  ? 'bg-blue-600 text-white scale-110 shadow-lg shadow-blue-500/30'
                  : 'bg-slate-800 text-blue-400 border border-slate-700/80'
              }`}
            >
              {isUploadingPdf ? (
                <Loader2 className="w-5 h-5 animate-spin text-white" />
              ) : (
                <UploadCloud className="w-5 h-5" />
              )}
            </div>

            <div className="text-xs font-bold text-slate-200">S/I (PDF) 未登録</div>
            <div className="text-[10px] text-slate-400 mt-0.5 max-w-[200px] leading-tight">
              {isUploadingPdf
                ? 'PDFアップロード処理中...'
                : isDragOver
                ? 'ここにドロップして即時アップロード'
                : 'PDFファイルをここにドロップ または クリックして登録'}
            </div>

            <button
              type="button"
              onClick={handleOpenFileDialog}
              disabled={isUploadingPdf}
              className="mt-2.5 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white font-bold text-[10px] rounded-lg shadow-xs transition-colors flex items-center space-x-1 cursor-pointer"
            >
              <FileUp className="w-3 h-3" />
              <span>S/I PDFを選択</span>
            </button>
          </div>
        )}

        {/* Footer Task Progress */}
        <div className="p-2 bg-slate-50 border-t border-slate-200 shrink-0 space-y-1.5">
          <div className="flex justify-between items-center text-[10px] text-slate-600 font-medium">
            <span>工程進捗ステータス</span>
            <span className="font-bold text-blue-600 font-mono">
              {progressPct}% ({completedTasks}/{totalTasks})
            </span>
          </div>

          <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                progressPct === 100 ? 'bg-emerald-500' : 'bg-blue-600'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // Render Full Preview Mode
  // ----------------------------------------------------
  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col items-center w-full h-full flex-1 min-h-0"
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".pdf,application/pdf"
        className="hidden"
      />

      {uploadSuccessMessage && (
        <div className="w-full max-w-3xl px-4 py-2 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs flex items-center space-x-2 animate-in fade-in duration-200 shrink-0 mb-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">{uploadSuccessMessage}</span>
        </div>
      )}

      {/* Main Preview Area */}
      {isLoadingServerPdf ? (
        <div className="w-full max-w-3xl min-h-[400px] bg-slate-900/40 rounded-2xl border border-slate-800 flex flex-col items-center justify-center p-8 text-center space-y-3 shadow-inner">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <div className="text-sm font-bold text-slate-200">サーバーからS/I PDF指示書を取得中...</div>
          <p className="text-xs text-slate-400">最新のPDFデータを確認しています</p>
        </div>
      ) : hasValidPdf ? (
        <div className="relative w-full h-full flex-1 flex flex-col items-center bg-slate-900/40 rounded-2xl border border-slate-800 shadow-inner overflow-hidden min-h-[450px]">
          {isDragOver && (
            <div className="absolute inset-0 bg-blue-950/85 backdrop-blur-xs z-40 flex flex-col items-center justify-center p-6 text-center pointer-events-none rounded-2xl animate-in fade-in duration-150">
              <UploadCloud className="w-12 h-12 text-blue-400 animate-bounce mb-2" />
              <div className="text-base font-bold text-white">新しいS/I (PDF) をドロップして差し替え</div>
              <div className="text-xs text-blue-200 mt-1">サーバーおよび端末に自動同期保存されます</div>
            </div>
          )}
          <PdfCanvasViewer
            pdfDataUrl={activePdfUrl}
            shipmentId={shipment.id}
            isThumbnail={false}
            scale={zoomScale}
            enableAnnotation={true}
            authorName={shipment.assignedOperator || '担当者'}
            className="w-full h-full"
          />
        </div>
      ) : (
        /* Full Missing PDF Drop-Zone */
        <div
          onClick={handleOpenFileDialog}
          className={`w-full max-w-3xl min-h-[380px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-8 text-center transition-all cursor-pointer ${
            isDragOver
              ? 'border-blue-400 bg-blue-950/40 text-blue-200 ring-4 ring-blue-500/20'
              : 'border-slate-700 bg-slate-900/60 hover:bg-slate-900/80 hover:border-blue-400/80 text-slate-300 shadow-inner'
          }`}
        >
          <div
            className={`w-16 h-16 rounded-3xl flex items-center justify-center mb-4 transition-all ${
              isDragOver
                ? 'bg-blue-600 text-white scale-110 shadow-xl shadow-blue-500/30'
                : 'bg-slate-800 text-blue-400 border border-slate-700'
            }`}
          >
            {isUploadingPdf ? (
              <Loader2 className="w-8 h-8 animate-spin text-white" />
            ) : (
              <UploadCloud className="w-8 h-8" />
            )}
          </div>

          <h3 className="text-base font-bold text-slate-100 mb-1">
            S/I（輸出指示書）PDFが未登録です
          </h3>
          <p className="text-xs text-slate-400 max-w-md leading-relaxed mb-4">
            実物のS/I（PDF）ファイルをこのエリアにドラッグ＆ドロップするか、下のボタンから選択してアップロードしてください。
            アップロードされたPDFはサーバーおよび端末に安全に保存され、次回以降も即座に表示されます。
          </p>

          <button
            type="button"
            onClick={handleOpenFileDialog}
            disabled={isUploadingPdf}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-2 cursor-pointer transform active:scale-95"
          >
            <FileUp className="w-4 h-4" />
            <span>{isUploadingPdf ? 'PDF処理中...' : 'S/I（PDF）ファイルをアップロード'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
