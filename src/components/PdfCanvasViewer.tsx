import React, { useEffect, useRef, useState } from 'react';
import { pdfjsLib, getPdfLoadOptions } from '../lib/pdfWorkerSetup';
import {
  PdfAnnotationNote,
  subscribePdfNotes,
  savePdfNote,
  deletePdfNote,
  clearAllPdfNotes,
} from '../lib/pdfNoteService';
import { generateOverlayPdfFromShipment } from '../lib/pdfGenerator';
import { getShipments } from '../lib/storageManager';
import { Shipment } from '../types';
import { PdfNoteCanvasOverlay } from './PdfNoteCanvasOverlay';
import {
  MousePointer,
  Edit2,
  Minus,
  MessageSquare,
  Square,
  Squircle,
  Circle,
  Eraser,
  Trash2,
  Cloud,
  CheckCircle2,
  Sparkles,
  Download,
  ExternalLink,
  Loader2,
} from 'lucide-react';

interface PdfCanvasViewerProps {
  pdfDataUrl: string;
  shipmentId?: string;
  isThumbnail?: boolean;
  scale?: number;
  className?: string;
  enableAnnotation?: boolean;
  authorName?: string;
  onClick?: () => void;
}

const COLOR_OPTIONS = [
  { label: '赤', value: '#ef4444' },
  { label: '黄', value: '#f59e0b' },
  { label: '青', value: '#3b82f6' },
  { label: '緑', value: '#10b981' },
  { label: '黒', value: '#0f172a' },
  { label: '白', value: '#ffffff' },
];

const LINE_WIDTHS = [
  { label: '細', value: 2 },
  { label: '中', value: 4 },
  { label: '太', value: 8 },
];

// Global memory cache for parsed PDF document proxies to eliminate re-fetching/re-parsing latency
const pdfDocMemoryCache = new Map<string, pdfjsLib.PDFDocumentProxy>();

export const PdfCanvasViewer: React.FC<PdfCanvasViewerProps> = ({
  pdfDataUrl,
  shipmentId,
  isThumbnail = false,
  scale = 1,
  className = '',
  enableAnnotation = true,
  authorName = '担当者',
  onClick,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const [numPages, setNumPages] = useState<number>(1);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  // Store rendered page dimensions for explicit CSS styling
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number }[]>([]);

  // Real-time Firestore notes state
  const [notes, setNotes] = useState<PdfAnnotationNote[]>([]);
  const [activeTool, setActiveTool] = useState<'view' | 'pen' | 'line' | 'text' | 'rect' | 'eraser'>('view');
  const [activeColor, setActiveColor] = useState<string>('#ef4444');
  const [lineWidth, setLineWidth] = useState<number>(3);
  const [rectShape, setRectShape] = useState<'rectangle' | 'rounded' | 'circle'>('rectangle');
  const [rectFillMode, setRectFillMode] = useState<'transparent' | 'tint' | 'solid'>('tint');
  const [rectFillColor, setRectFillColor] = useState<string>('auto');

  // Subscribe to real-time Firestore notes
  useEffect(() => {
    if (!shipmentId || isThumbnail) return;

    const unsubscribe = subscribePdfNotes(shipmentId, (updatedNotes) => {
      setNotes(updatedNotes);
    });

    return () => {
      unsubscribe();
    };
  }, [shipmentId, isThumbnail]);

  // Convert base64 data URL or fetch URL to Uint8Array using fast native decoding
  const getPdfUint8Array = async (dataUrl: string): Promise<Uint8Array> => {
    if (!dataUrl) return new Uint8Array(0);
    if (dataUrl.startsWith('data:')) {
      try {
        const res = await fetch(dataUrl);
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
      } catch {
        const base64Part = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        const binaryString = atob(base64Part);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      }
    } else {
      const response = await fetch(dataUrl);
      const arrayBuffer = await response.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    }
  };

  // Load PDF document (with instant memory cache check)
  useEffect(() => {
    let isCancelled = false;

    async function loadPdf() {
      if (!pdfDataUrl) return;

      // Check cache first for instant render
      const cacheKey = pdfDataUrl.slice(0, 100) + '_' + pdfDataUrl.length;
      if (pdfDocMemoryCache.has(cacheKey)) {
        const cachedDoc = pdfDocMemoryCache.get(cacheKey)!;
        setPdfDoc(cachedDoc);
        setNumPages(cachedDoc.numPages);
        setLoading(false);
        setError(false);
        return;
      }

      setLoading(true);
      setError(false);

      try {
        const uint8Data = await getPdfUint8Array(pdfDataUrl);
        const loadingTask = pdfjsLib.getDocument(getPdfLoadOptions(uint8Data));

        const doc = await loadingTask.promise;
        if (isCancelled) return;

        pdfDocMemoryCache.set(cacheKey, doc);
        setPdfDoc(doc);
        setNumPages(doc.numPages);
      } catch (err: any) {
        console.error('PDF Canvas Load Error:', err);
        if (!isCancelled) {
          setError(true);
          setLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      isCancelled = true;
    };
  }, [pdfDataUrl]);

  // Render pages onto canvases
  useEffect(() => {
    let isCancelled = false;
    const activeRenderTasks: any[] = [];

    async function renderAllPages() {
      if (!pdfDoc) return;

      try {
        const pageCount = isThumbnail ? 1 : pdfDoc.numPages;
        const dims: { width: number; height: number }[] = [];

        for (let i = 1; i <= pageCount; i++) {
          if (isCancelled) return;
          const page = await pdfDoc.getPage(i);
          const canvas = canvasRefs.current[i - 1];
          if (!canvas) continue;

          const context = canvas.getContext('2d', { alpha: false });
          if (!context) continue;

          let targetScale = scale;
          if (isThumbnail) {
            const containerWidth = containerRef.current?.clientWidth || 100;
            const unscaledViewport = page.getViewport({ scale: 1.0 });
            const availWidth = containerWidth > 0 ? containerWidth : 100;
            const baseFitScale = availWidth / unscaledViewport.width;
            targetScale = Math.max(baseFitScale * scale, 0.15);
          } else {
            targetScale = scale * 1.35; // Crisp high-performance scale
          }

          // Optimized devicePixelRatio for balance between performance and crispness
          const pixelRatio = isThumbnail ? 1.5 : Math.min(Math.max(window.devicePixelRatio || 1, 1.8), 2.0);
          const cssViewport = page.getViewport({ scale: targetScale });
          const renderViewport = page.getViewport({ scale: targetScale * pixelRatio });

          canvas.width = Math.floor(renderViewport.width);
          canvas.height = Math.floor(renderViewport.height);
          canvas.style.width = `${Math.floor(cssViewport.width)}px`;
          canvas.style.height = `${Math.floor(cssViewport.height)}px`;

          dims.push({ width: Math.floor(cssViewport.width), height: Math.floor(cssViewport.height) });

          // Fill canvas background with solid white before rendering PDF layers
          context.fillStyle = '#FFFFFF';
          context.fillRect(0, 0, canvas.width, canvas.height);

          const renderContext = {
            canvasContext: context,
            viewport: renderViewport,
            intent: 'display',
          };

          const renderTask = page.render(renderContext);
          activeRenderTasks.push(renderTask);

          await renderTask.promise;
        }

        if (!isCancelled) {
          setPageDimensions((prev) => {
            if (
              prev.length === dims.length &&
              prev.every((d, idx) => d.width === dims[idx]?.width && d.height === dims[idx]?.height)
            ) {
              return prev;
            }
            return dims;
          });
          setLoading(false);
        }
      } catch (err: any) {
        if (err?.name === 'RenderingCancelledException' || isCancelled) {
          // Normal cancellation when re-rendering or unmounting
          return;
        }
        console.error('PDF Page Render Error:', err);
        if (!isCancelled) {
          setError(true);
          setLoading(false);
        }
      }
    }

    renderAllPages();

    return () => {
      isCancelled = true;
      activeRenderTasks.forEach((task) => {
        try {
          if (task && typeof task.cancel === 'function') {
            task.cancel();
          }
        } catch (_) {}
      });
    };
  }, [pdfDoc, scale, isThumbnail]);

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleOpenPdfNewTab = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!pdfDataUrl) return;
    try {
      const fullShipment = shipmentId ? getShipments().find((s) => s.id === shipmentId) : null;
      const shipmentPayload: Partial<Shipment> = fullShipment
        ? { ...fullShipment, originalPdfUrl: pdfDataUrl, pdfDataUrl }
        : { id: shipmentId, originalPdfUrl: pdfDataUrl, pdfDataUrl };

      const highResUrl = await generateOverlayPdfFromShipment(
        shipmentPayload,
        { forceRefresh: true, notes }
      );
      const targetUrl = highResUrl || pdfDataUrl;
      const base64Clean = targetUrl.split(',')[1] || targetUrl;
      const byteCharacters = atob(base64Clean);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } catch (_) {
      window.open(pdfDataUrl, '_blank');
    }
  };

  const handleDownloadCurrentPdf = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!pdfDataUrl || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const fullShipment = shipmentId ? getShipments().find((s) => s.id === shipmentId) : null;
      const shipmentPayload: Partial<Shipment> = fullShipment
        ? { ...fullShipment, originalPdfUrl: pdfDataUrl, pdfDataUrl }
        : { id: shipmentId, originalPdfUrl: pdfDataUrl, pdfDataUrl };

      const highResUrl = await generateOverlayPdfFromShipment(
        shipmentPayload,
        { forceRefresh: true, notes }
      );
      const downloadTarget = highResUrl || pdfDataUrl;
      const link = document.createElement('a');
      link.href = downloadTarget;
      link.download = `SI_${shipmentId || 'export'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Download failed:', err);
      const link = document.createElement('a');
      link.href = pdfDataUrl;
      link.download = `SI_${shipmentId || 'export'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleClearAllNotes = async () => {
    if (!shipmentId) return;
    if (confirm('PDF上のすべての手書きメモ・テキスト注記を削除しますか？ (Firestoreからも一括削除されます)')) {
      await clearAllPdfNotes(shipmentId);
      setNotes([]);
    }
  };

  // Fallback to Native Embedded PDF / iframe viewer if canvas rendering encounters browser limitations
  if (error) {
    if (isThumbnail) {
      return (
        <div
          onClick={onClick}
          className="w-full h-full min-h-[180px] bg-slate-900 border border-slate-700 rounded-xl flex flex-col items-center justify-center p-4 text-center text-white space-y-2 cursor-pointer hover:border-blue-400 transition-colors"
        >
          <div className="w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
            PDF
          </div>
          <div className="text-xs font-bold text-slate-200">PDF指示書ドキュメント</div>
          <div className="text-[10px] text-slate-400">クリックしてインタラクティブプレビューを表示</div>
        </div>
      );
    }

    return (
      <div className={`w-full h-[650px] bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 ${className}`}>
        <iframe
          src={pdfDataUrl}
          title="PDF Document Preview"
          className="w-full h-full border-0"
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col items-center justify-start w-full h-full select-none ${className}`}
    >
      {/* Interactive PDF Drawing Toolbar (Only displayed in full preview mode with annotation enabled) - Detached & Fixed Header */}
      {!isThumbnail && enableAnnotation && shipmentId && (
        <div className="sticky top-0 z-30 w-full shrink-0 flex justify-center py-2.5 px-3 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 shadow-lg">
          <div className="w-full max-w-4xl bg-slate-900 border border-slate-700/90 p-2 rounded-2xl shadow-xl text-white flex flex-wrap items-center justify-between gap-2.5 text-xs">
            {/* Tool Modes */}
            <div className="flex items-center space-x-1 bg-slate-800/90 p-1 rounded-xl border border-slate-700">
            <button
              type="button"
              onClick={() => setActiveTool('view')}
              className={`px-2.5 py-1.5 rounded-lg flex items-center space-x-1.5 text-xs font-bold transition-all cursor-pointer ${
                activeTool === 'view'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
              }`}
              title="閲覧・オブジェクト選択移動モード (描画した注記をクリック＆ドラッグで自由に位置微調整・矢印キー微調整)"
            >
              <MousePointer className="w-3.5 h-3.5" />
              <span>閲覧・移動</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTool('pen')}
              className={`px-2.5 py-1.5 rounded-lg flex items-center space-x-1.5 text-xs font-bold transition-all cursor-pointer ${
                activeTool === 'pen'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
              }`}
              title="ペンフリーハンド描画"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>ペン</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTool('line')}
              className={`px-2.5 py-1.5 rounded-lg flex items-center space-x-1.5 text-xs font-bold transition-all cursor-pointer ${
                activeTool === 'line'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
              }`}
              title="直線・斜め線を描画 (ドラッグして任意の直線・斜め線を引く)"
            >
              <Minus className="w-3.5 h-3.5 -rotate-45 stroke-[2.5]" />
              <span>直線</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTool('text')}
              className={`px-2.5 py-1.5 rounded-lg flex items-center space-x-1.5 text-xs font-bold transition-all cursor-pointer ${
                activeTool === 'text'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
              }`}
              title="PDFに文字注記を追加 (クリック位置にテキスト挿入)"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>文字注記</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTool('rect')}
              className={`px-2.5 py-1.5 rounded-lg flex items-center space-x-1.5 text-xs font-bold transition-all cursor-pointer ${
                activeTool === 'rect'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
              }`}
              title="矩形・ハイライト囲み"
            >
              <Square className="w-3.5 h-3.5" />
              <span>囲み</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTool('eraser')}
              className={`px-2.5 py-1.5 rounded-lg flex items-center space-x-1.5 text-xs font-bold transition-all cursor-pointer ${
                activeTool === 'eraser'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
              }`}
              title="消しゴム (注記をクリックして個別削除)"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>消しゴム</span>
            </button>
          </div>

          {/* Color & Stroke Controls (When drawing) */}
          {activeTool !== 'view' && activeTool !== 'eraser' && (
            <div className="flex items-center space-x-3">
              {/* Color Palette */}
              <div className="flex items-center space-x-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setActiveColor(c.value)}
                    className={`w-5 h-5 rounded-full transition-transform cursor-pointer border ${
                      activeColor === c.value ? 'scale-125 ring-2 ring-white ring-offset-1 ring-offset-slate-900 border-white' : 'border-slate-600 hover:scale-110'
                    }`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>

              {/* Line Width (Pen, Line, Rect) or Text note hint */}
              {activeTool === 'rect' ? (
                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                  {/* Shape selector for Rect */}
                  <div className="flex items-center space-x-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700 text-[10px]">
                    <span className="text-slate-400 px-1 font-semibold">形状:</span>
                    <button
                      type="button"
                      onClick={() => setRectShape('rectangle')}
                      className={`px-2 py-0.5 rounded-md font-bold transition-colors flex items-center gap-1 cursor-pointer ${
                        rectShape === 'rectangle' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="四角（標準の長方形）"
                    >
                      <Square className="w-3 h-3" />
                      <span>四角</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRectShape('rounded')}
                      className={`px-2 py-0.5 rounded-md font-bold transition-colors flex items-center gap-1 cursor-pointer ${
                        rectShape === 'rounded' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="角丸（角が丸みのある四角形）"
                    >
                      <Squircle className="w-3 h-3" />
                      <span>角丸</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRectShape('circle')}
                      className={`px-2 py-0.5 rounded-md font-bold transition-colors flex items-center gap-1 cursor-pointer ${
                        rectShape === 'circle' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="丸（円・楕円）"
                    >
                      <Circle className="w-3 h-3" />
                      <span>丸</span>
                    </button>
                  </div>

                  {/* Border Width */}
                  <div className="flex items-center space-x-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
                    {LINE_WIDTHS.map((w) => (
                      <button
                        key={w.value}
                        type="button"
                        onClick={() => setLineWidth(w.value)}
                        className={`px-2 py-0.5 text-[10px] rounded-md font-bold transition-colors cursor-pointer ${
                          lineWidth === w.value ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>

                  {/* Fill mode selector for Rect */}
                  <div className="flex items-center space-x-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700 text-[10px]">
                    <span className="text-slate-400 px-1 font-semibold">塗り:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setRectFillMode('transparent');
                        setRectFillColor('transparent');
                      }}
                      className={`px-2 py-0.5 rounded-md font-bold transition-colors cursor-pointer ${
                        rectFillMode === 'transparent' ? 'bg-amber-500 text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      透明
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRectFillMode('tint');
                        setRectFillColor('auto');
                      }}
                      className={`px-2 py-0.5 rounded-md font-bold transition-colors cursor-pointer ${
                        rectFillMode === 'tint' ? 'bg-amber-500 text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      薄色
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRectFillMode('solid');
                        setRectFillColor('#ffffff');
                      }}
                      className={`px-2 py-0.5 rounded-md font-bold transition-colors cursor-pointer ${
                        rectFillMode === 'solid' && rectFillColor === '#ffffff' ? 'bg-amber-500 text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="白塗り・文字目隠し修正に最適"
                    >
                      白塗り
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRectFillMode('solid');
                        setRectFillColor('auto');
                      }}
                      className={`px-2 py-0.5 rounded-md font-bold transition-colors cursor-pointer ${
                        rectFillMode === 'solid' && rectFillColor === 'auto' ? 'bg-amber-500 text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      ベタ塗り
                    </button>
                  </div>
                </div>
              ) : activeTool !== 'text' ? (
                <div className="flex items-center space-x-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
                  {LINE_WIDTHS.map((w) => (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => setLineWidth(w.value)}
                      className={`px-2 py-0.5 text-[10px] rounded-md font-bold transition-colors cursor-pointer ${
                        lineWidth === w.value ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="hidden sm:inline-flex items-center text-[10px] text-blue-300 font-medium bg-blue-500/10 px-2 py-1 rounded-lg border border-blue-500/20">
                  クリック位置で文字色・背景色・枠色を指定できます
                </span>
              )}
            </div>
          )}

          {/* Firestore Sync Badge & Clear Actions */}
          <div className="flex items-center space-x-2 ml-auto">
            <div className="flex items-center space-x-1.5 text-[10px] text-emerald-400 font-mono bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-xl">
              <Cloud className="w-3 h-3 text-emerald-400 animate-pulse" />
              <span>Firestore同期中 ({notes.length}件)</span>
            </div>

            {notes.length > 0 && (
              <button
                type="button"
                onClick={handleClearAllNotes}
                className="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/40 border border-rose-500/30 text-rose-300 rounded-xl text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1"
                title="すべての注記を一括削除"
              >
                <Trash2 className="w-3 h-3" />
                <span>全消去</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleOpenPdfNewTab}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-[11px] font-medium transition-colors border border-slate-700 cursor-pointer flex items-center gap-1"
              title="別タブでPDFを開く"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
              <span>別タブ表示</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadCurrentPdf}
              disabled={isExportingPdf}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[11px] font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              title="編集内容を反映したPDFを保存・ダウンロード"
            >
              {isExportingPdf ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{isExportingPdf ? 'PDF生成中...' : 'PDF保存'}</span>
            </button>
          </div>
        </div>
      </div>
      )}

      {loading && (
        <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center z-10 p-4 rounded-xl text-white">
          <div className="flex items-center space-x-2 text-xs text-blue-400 font-bold">
            <span className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span>PDFイメージを読み込み中...</span>
          </div>
        </div>
      )}

      {/* Pages Container - Scrollable PDF pages */}
      <div
        onClick={isThumbnail ? onClick : undefined}
        className={`w-full flex flex-col items-center justify-start ${
          isThumbnail ? 'overflow-visible' : 'flex-1 overflow-auto p-4 space-y-4'
        }`}
      >
        {Array.from({ length: isThumbnail ? 1 : numPages }).map((_, idx) => {
          const dim = pageDimensions[idx];
          return (
            <div
              key={idx}
              className={`relative rounded-lg overflow-hidden border border-slate-300 bg-white shrink-0 ${
                isThumbnail ? 'shadow-xs cursor-pointer' : 'shadow-xl'
              }`}
              style={dim ? { width: `${dim.width}px`, height: `${dim.height}px` } : undefined}
            >
              {/* PDF Render Canvas */}
              <canvas
                ref={(el) => (canvasRefs.current[idx] = el)}
                className="block max-w-none"
                style={dim ? { width: `${dim.width}px`, height: `${dim.height}px` } : undefined}
              />

              {/* Drawing Annotation Canvas Overlay Layer */}
              {dim && !isThumbnail && enableAnnotation && shipmentId && (
                <PdfNoteCanvasOverlay
                  shipmentId={shipmentId}
                  pageNumber={idx + 1}
                  notes={notes}
                  activeTool={activeTool}
                  activeColor={activeColor}
                  lineWidth={lineWidth}
                  width={dim.width}
                  height={dim.height}
                  rectShape={rectShape}
                  rectFillMode={rectFillMode}
                  rectFillColor={rectFillColor}
                  authorName={authorName}
                  onNoteAdded={(newNote) => {
                    setNotes((prev) => [...prev.filter((n) => n.id !== newNote.id), newNote]);
                  }}
                  onNoteDeleted={(deletedId) => {
                    setNotes((prev) => prev.filter((n) => n.id !== deletedId));
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};


