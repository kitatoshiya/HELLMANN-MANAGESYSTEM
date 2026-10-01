import jsPDF from 'jspdf';
import { pdfjsLib, getPdfLoadOptions } from './pdfWorkerSetup';
import { Shipment, Task } from '../types';
import { calculateBillingTotals, DEFAULT_INITIAL_BILLING_ITEMS } from './billingService';
import { getShipments } from './storageManager';
import { getPdfFromStorageSync, getPdfFromStorageAsync } from './pdfStorageService';
import { getShipmentNotesSync, PdfAnnotationNote } from './pdfNoteService';

// Convert base64 data URL or fetch URL to Uint8Array using native browser C++ decoding (100x faster than JS atob loop)
export async function getPdfUint8Array(dataUrl: string): Promise<Uint8Array> {
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
}

// Cache generated overlay PDF data URLs by cache key (id + tasks checksum + billing items checksum)
const overlayPdfCache = new Map<string, string>();

// Cache rendered base PDF canvases in memory to eliminate re-rendering on text/badge edits
interface CachedBaseCanvas {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scale: number;
  viewportWidth: number;
  viewportHeight: number;
}
const baseCanvasCache = new Map<string, CachedBaseCanvas>();

function getOverlayCacheKey(shipment: Partial<Shipment>, options?: { forceRefresh?: boolean; notes?: PdfAnnotationNote[] }): string {
  if (options?.forceRefresh) {
    return `fresh_${Date.now()}_${Math.random()}`;
  }
  const taskIdStatus = (shipment.tasks || []).map((t) => `${t.id}:${t.status}:${t.shortName || ''}`).join('|');
  const billingChecksum = (shipment.billingItems || [])
    .map((b) => `${b.taxable ? '1' : '0'}:${b.name}:${b.amount}`)
    .join('|');
  const baseKey = shipment.id || shipment.hawbNumber || shipment.mawbNumber || 'unknown';
  const pdfLength = (shipment.originalPdfUrl || shipment.pdfDataUrl || '').length;
  const notes = options?.notes || (shipment.id ? getShipmentNotesSync(shipment.id) : []);
  const notesChecksum = notes
    .map(
      (n) =>
        `${n.id}:${n.pageNumber}:${n.type}:${n.x}:${n.y}:${n.width}:${n.height}:${n.color}:${n.textColor || ''}:${n.bgColor || ''}:${n.borderColor || ''}:${n.fillColor || ''}:${n.fillOpacity || ''}:${n.lineWidth || ''}:${n.fontSize || ''}:${n.text || ''}:${n.points?.length || 0}`
    )
    .join('||');
  return `v3_res4_${baseKey}_${pdfLength}_${taskIdStatus}_${billingChecksum}_${notesChecksum}`;
}

export interface GenerateOverlayOptions {
  forceRefresh?: boolean;
  notes?: PdfAnnotationNote[];
}

/**
 * 元のPDF（または画像/ベースPDF）の上に、工程タスクバッジ（丸文字）、請求明細、
 * および手書き・図形・文字注記をオーバーレイ描画し、
 * 高解像度（scale 4.0 / 約300DPI）で全ページ埋め込み済みの新しいPDFの Data URL を生成して返します。
 */
export async function generateOverlayPdfFromShipment(
  shipment: Partial<Shipment>,
  options?: GenerateOverlayOptions
): Promise<string> {
  // 1. 最新の案件情報（タスク、請求明細 billingItems 等）を確実にマージ・補完
  let effectiveShipment: Partial<Shipment> = { ...shipment };
  if (shipment.id) {
    const full = getShipments().find((s) => s.id === shipment.id);
    if (full) {
      effectiveShipment = {
        ...full,
        ...shipment,
        billingItems: shipment.billingItems !== undefined ? shipment.billingItems : full.billingItems,
        tasks: shipment.tasks !== undefined ? shipment.tasks : full.tasks,
      };
    }
  }

  const cacheKey = getOverlayCacheKey(effectiveShipment, options);
  if (!options?.forceRefresh && overlayPdfCache.has(cacheKey)) {
    return overlayPdfCache.get(cacheKey)!;
  }

  // 2. 高速特定: メモリ上の既存URL・同期キャッシュを最優先 (サーバー通信待ちを完全に排除)
  let sourcePdfUrl: string | null =
    (effectiveShipment.originalPdfUrl && effectiveShipment.originalPdfUrl.length > 500 ? effectiveShipment.originalPdfUrl : null) ||
    (effectiveShipment.pdfDataUrl && effectiveShipment.pdfDataUrl.length > 500 ? effectiveShipment.pdfDataUrl : null) ||
    (effectiveShipment.id ? getPdfFromStorageSync(effectiveShipment.id) : null) ||
    (effectiveShipment.hawbNumber ? getPdfFromStorageSync(effectiveShipment.hawbNumber) : null) ||
    (effectiveShipment.mawbNumber ? getPdfFromStorageSync(effectiveShipment.mawbNumber) : null);

  // 3. 同期キャッシュになければ非同期ストレージ (IndexedDB / Fast Server) から1回だけ検索
  if (!sourcePdfUrl && effectiveShipment.id) {
    sourcePdfUrl = await getPdfFromStorageAsync(effectiveShipment.id);
    if (sourcePdfUrl && sourcePdfUrl.length > 500) {
      effectiveShipment.originalPdfUrl = sourcePdfUrl;
      effectiveShipment.pdfDataUrl = sourcePdfUrl;
      effectiveShipment.hasCustomPdf = true;
    }
  }

  if (!sourcePdfUrl || sourcePdfUrl.length < 500) {
    return '';
  }

  // 高解像度スケール (scale 4.0: 約300DPI相当で印刷・拡大時も文字や線が一切荒れない高品質)
  const scale = 4.0;
  const allNotes: PdfAnnotationNote[] =
    options?.notes || (effectiveShipment.id ? getShipmentNotesSync(effectiveShipment.id) : []);

  // もし元データが画像 (PNG/JPEG等) の場合はキャンバスに直描画してオーバーレイ
  if (sourcePdfUrl.startsWith('data:image/')) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(sourcePdfUrl);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const tasks = effectiveShipment.tasks || [];
        if (tasks.length > 0) {
          drawBadgesOnCanvas(ctx, tasks, canvas.width, canvas.height, scale);
        }

        drawBillingOverlayOnCanvas(ctx, effectiveShipment, canvas.width, canvas.height, scale);

        if (allNotes.length > 0) {
          const page1Notes = allNotes.filter((n) => (n.pageNumber || 1) === 1);
          drawNotesOnCanvas(ctx, page1Notes, canvas.width, canvas.height, scale);
        }

        const imgData = canvas.toDataURL('image/jpeg', 0.96);
        const pdfWidthMm = (img.width) * (25.4 / 96);
        const pdfHeightMm = (img.height) * (25.4 / 96);
        const orientation = pdfWidthMm > pdfHeightMm ? 'l' : 'p';

        const outDoc = new jsPDF({
          orientation,
          unit: 'mm',
          format: [pdfWidthMm, pdfHeightMm],
          compress: true,
        });
        outDoc.addImage(imgData, 'JPEG', 0, 0, pdfWidthMm, pdfHeightMm, undefined, 'FAST');
        const result = outDoc.output('datauristring');
        overlayPdfCache.set(cacheKey, result);
        resolve(result);
      };
      img.onerror = () => resolve(sourcePdfUrl);
      img.src = sourcePdfUrl;
    });
  }

  try {
    const uint8Data = await getPdfUint8Array(sourcePdfUrl);
    const loadingTask = pdfjsLib.getDocument(getPdfLoadOptions(uint8Data));
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages || 1;

    let outDoc: jsPDF | null = null;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const workCanvas = document.createElement('canvas');
      workCanvas.width = viewport.width;
      workCanvas.height = viewport.height;
      const ctx = workCanvas.getContext('2d', { alpha: false });
      if (!ctx) continue;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      await page.render({
        canvasContext: ctx,
        viewport: viewport,
        canvas: workCanvas,
        intent: 'print',
      }).promise;

      // 1ページ目に工程タスクバッジおよび請求明細をオーバーレイ
      if (pageNum === 1) {
        const tasks = effectiveShipment.tasks || [];
        if (tasks.length > 0) {
          drawBadgesOnCanvas(ctx, tasks, workCanvas.width, workCanvas.height, scale);
        }
        drawBillingOverlayOnCanvas(ctx, effectiveShipment, workCanvas.width, workCanvas.height, scale);
      }

      // 各ページの注記（手書きペン・直線・矩形囲み・文字注記）を合成描画
      const pageNotes = allNotes.filter((n) => (n.pageNumber || 1) === pageNum);
      if (pageNotes.length > 0) {
        drawNotesOnCanvas(ctx, pageNotes, workCanvas.width, workCanvas.height, scale);
      }

      // 高解像度・高品質JPEGエンコード (0.96 品質)
      const imgData = workCanvas.toDataURL('image/jpeg', 0.96);

      const pdfWidthMm = (viewport.width / scale) * (25.4 / 72);
      const pdfHeightMm = (viewport.height / scale) * (25.4 / 72);
      const orientation = pdfWidthMm > pdfHeightMm ? 'l' : 'p';

      if (pageNum === 1) {
        outDoc = new jsPDF({
          orientation,
          unit: 'mm',
          format: [pdfWidthMm, pdfHeightMm],
          compress: true,
        });
        outDoc.addImage(imgData, 'JPEG', 0, 0, pdfWidthMm, pdfHeightMm, undefined, 'FAST');
      } else if (outDoc) {
        outDoc.addPage([pdfWidthMm, pdfHeightMm], orientation);
        outDoc.addImage(imgData, 'JPEG', 0, 0, pdfWidthMm, pdfHeightMm, undefined, 'FAST');
      }
    }

    if (!outDoc) {
      return sourcePdfUrl;
    }

    const result = outDoc.output('datauristring');
    if (!options?.forceRefresh) {
      overlayPdfCache.set(cacheKey, result);
    }
    return result;
  } catch (err) {
    console.error('Failed to generate overlay PDF, fallback to source:', err);
    return sourcePdfUrl || generatePdfDataUrlFromShipment(effectiveShipment);
  }
}

/**
 * Helper to convert hex color to rgba string
 */
function hexToRgba(hex: string, opacity: number = 1): string {
  if (!hex || hex === 'transparent') return 'transparent';
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * ユーザーの手書き注記・囲み・文字メモをPDF出力キャンバスに高解像度描画するヘルパー
 */
// Helper for drawing rounded rectangle on canvas
function drawCanvasRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
}

function drawNotesOnCanvas(
  ctx: CanvasRenderingContext2D,
  notes: PdfAnnotationNote[],
  width: number,
  height: number,
  scale: number
) {
  if (!notes || notes.length === 0) return;

  const REF_WIDTH = 800;
  const scaleRatio = width / REF_WIDTH;

  ctx.save();
  notes.forEach((note) => {
    if (note.type === 'stroke' && note.points && note.points.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = note.color || '#ef4444';
      ctx.lineWidth = (note.lineWidth || 3) * scaleRatio;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const p0 = note.points[0];
      ctx.moveTo(p0.x * width, p0.y * height);
      for (let i = 1; i < note.points.length; i++) {
        const pt = note.points[i];
        ctx.lineTo(pt.x * width, pt.y * height);
      }
      ctx.stroke();
    } else if (note.type === 'line') {
      const sx = (note.startX !== undefined ? note.startX : note.points?.[0]?.x || 0) * width;
      const sy = (note.startY !== undefined ? note.startY : note.points?.[0]?.y || 0) * height;
      const ex = (note.endX !== undefined ? note.endX : note.points?.[1]?.x || 0) * width;
      const ey = (note.endY !== undefined ? note.endY : note.points?.[1]?.y || 0) * height;

      ctx.beginPath();
      ctx.strokeStyle = note.color || '#ef4444';
      ctx.lineWidth = (note.lineWidth || 3) * scaleRatio;
      ctx.lineCap = 'round';
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    } else if (
      note.type === 'rect' &&
      note.x !== undefined &&
      note.y !== undefined &&
      note.width !== undefined &&
      note.height !== undefined
    ) {
      const rx = note.x * width;
      const ry = note.y * height;
      const rw = note.width * width;
      const rh = note.height * height;

      // Fill background
      const fillColor = note.fillColor !== undefined ? note.fillColor : (note.bgColor !== undefined ? note.bgColor : note.color);
      const fillOpacity = note.fillOpacity !== undefined ? note.fillOpacity : (fillColor === 'transparent' ? 0 : 0.15);
      const shape = note.rectShape || 'rectangle';

      if (shape === 'circle') {
        const cx = rx + rw / 2;
        const cy = ry + rh / 2;
        const radiusX = Math.max(0.1, Math.abs(rw / 2));
        const radiusY = Math.max(0.1, Math.abs(rh / 2));

        if (fillColor !== 'transparent' && fillOpacity > 0) {
          ctx.beginPath();
          ctx.fillStyle = hexToRgba(fillColor, fillOpacity);
          ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.strokeStyle = note.color || '#ef4444';
        ctx.lineWidth = (note.lineWidth || 2) * scaleRatio;
        ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (shape === 'rounded') {
        const radius = Math.min(10 * scaleRatio, Math.min(Math.abs(rw), Math.abs(rh)) / 4);

        if (fillColor !== 'transparent' && fillOpacity > 0) {
          ctx.beginPath();
          ctx.fillStyle = hexToRgba(fillColor, fillOpacity);
          drawCanvasRoundRect(ctx, rx, ry, rw, rh, radius);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.strokeStyle = note.color || '#ef4444';
        ctx.lineWidth = (note.lineWidth || 2) * scaleRatio;
        drawCanvasRoundRect(ctx, rx, ry, rw, rh, radius);
        ctx.stroke();
      } else {
        if (fillColor !== 'transparent' && fillOpacity > 0) {
          ctx.fillStyle = hexToRgba(fillColor, fillOpacity);
          ctx.fillRect(rx, ry, rw, rh);
        }

        // Border outline
        ctx.strokeStyle = note.color || '#ef4444';
        ctx.lineWidth = (note.lineWidth || 2) * scaleRatio;
        ctx.strokeRect(rx, ry, rw, rh);
      }
    } else if (note.type === 'text' && note.x !== undefined && note.y !== undefined && note.text) {
      const fontSize = Math.max(10, Math.round((note.fontSize || 13) * scaleRatio));
      ctx.font = `bold ${fontSize}px sans-serif`;
      const textMetrics = ctx.measureText(note.text);
      const defaultPaddingX = 8 * scaleRatio;
      const defaultPaddingY = 4 * scaleRatio;
      const autoBoxW = textMetrics.width + defaultPaddingX * 2;
      const autoBoxH = fontSize + defaultPaddingY * 2;

      let boxX: number;
      let boxY: number;
      let boxW: number;
      let boxH: number;

      if (note.width !== undefined && note.height !== undefined) {
        boxX = note.x * width;
        boxY = note.y * height;
        boxW = note.width * width;
        boxH = note.height * height;
      } else {
        boxX = note.x * width;
        boxY = note.y * height - (fontSize * 0.85);
        boxW = autoBoxW;
        boxH = autoBoxH;
      }

      const effectiveBgColor = note.bgColor !== undefined ? note.bgColor : 'rgba(15, 23, 42, 0.88)';
      const effectiveTextColor = note.textColor || note.color || '#ffffff';
      const effectiveBorderColor = note.borderColor !== undefined
        ? note.borderColor
        : (effectiveBgColor === '#ffffff' || effectiveBgColor.startsWith('#f') || effectiveBgColor.startsWith('#d')
          ? '#94a3b8'
          : effectiveTextColor);

      // Draw background if not transparent
      if (effectiveBgColor !== 'transparent') {
        ctx.fillStyle = effectiveBgColor;
        const radius = Math.min(6 * scaleRatio, boxH / 2);
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(boxX, boxY, boxW, boxH, radius);
        } else {
          ctx.rect(boxX, boxY, boxW, boxH);
        }
        ctx.fill();

        if (effectiveBorderColor !== 'transparent') {
          ctx.strokeStyle = effectiveBorderColor;
          ctx.lineWidth = Math.max(1, (note.borderWidth || 1) * scaleRatio);
          ctx.stroke();
        }
      }

      // Draw text centered/padded in box
      ctx.fillStyle = effectiveTextColor;
      const textY = boxY + (boxH + fontSize * 0.72) / 2;
      const textX = boxX + Math.max(defaultPaddingX, (boxW - textMetrics.width) / 2);

      ctx.save();
      ctx.beginPath();
      ctx.rect(boxX, boxY, boxW, boxH);
      ctx.clip();
      ctx.fillText(note.text, textX, textY);
      ctx.restore();
    }
  });
  ctx.restore();
}

/**
 * キャンバスの左下に丸文字（工程タスクバッジ）を描画するヘルパー
 */
function drawBadgesOnCanvas(
  ctx: CanvasRenderingContext2D,
  tasks: Task[],
  canvasWidth: number,
  canvasHeight: number,
  scale: number
) {
  ctx.save();

  // バッジ描画位置の計算（左下）
  const paddingLeft = 16 * scale;
  const paddingBottom = 16 * scale;

  // 各バッジの寸法計算 (隙間0、フォント小型化で表示量増加)
  const badgeGap = 0 * scale; // 隙間0
  const badgeHeight = 22 * scale; // 28px -> 22px
  const badgeRadius = badgeHeight / 2;

  // 各バッジ幅の測定 (フォント 9px, パディング縮小)
  const fontSize = Math.round(9 * scale);
  ctx.font = `bold ${fontSize}px sans-serif`;
  const badgeWidths = tasks.map((t) => {
    const shortText = t.shortName || t.title.slice(0, 3);
    const textWidth = ctx.measureText(shortText).width;
    return Math.max(badgeHeight, textWidth + 8 * scale);
  });

  const totalBadgesWidth = badgeWidths.reduce((a, b) => a + b, 0) + (tasks.length - 1) * badgeGap;
  const containerWidth = Math.max(180 * scale, totalBadgesWidth + 16 * scale);
  const containerHeight = 36 * scale;

  const containerX = paddingLeft;
  const containerY = canvasHeight - paddingBottom - containerHeight;

  // フロートコンテナ背景 (半透明白、影付き)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 8 * scale;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 3 * scale;

  ctx.fillStyle = '#ffffff';
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(containerX, containerY, containerWidth, containerHeight, 8 * scale);
    ctx.fill();
  } else {
    ctx.fillRect(containerX, containerY, containerWidth, containerHeight);
  }

  // 影を解除
  ctx.shadowColor = 'transparent';

  // コンテナキャプション
  ctx.fillStyle = '#64748b'; // slate-500
  ctx.font = `bold ${Math.round(7.5 * scale)}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('工程進捗ステータス (PROCESS BADGES):', containerX + 8 * scale, containerY + 4 * scale);

  // 各丸文字バッジの描画
  let currentX = containerX + 8 * scale;
  const badgeY = containerY + 15 * scale;

  tasks.forEach((t, index) => {
    const shortText = t.shortName || t.title.slice(0, 3);
    const bWidth = badgeWidths[index];

    const isInProgress = t.status === 'In Progress';
    const isCompleted = t.status === 'Completed';

    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(currentX, badgeY, bWidth, badgeHeight, badgeRadius);
    } else {
      ctx.rect(currentX, badgeY, bWidth, badgeHeight);
    }

    // 背景色と枠線
    if (isInProgress) {
      ctx.fillStyle = '#fef3c7'; // amber-100
      ctx.strokeStyle = '#f59e0b'; // amber-500
      ctx.lineWidth = 1.5 * scale;
    } else if (isCompleted) {
      ctx.fillStyle = '#ecfdf5'; // emerald-50
      ctx.strokeStyle = '#10b981'; // emerald-500
      ctx.lineWidth = 1.5 * scale;
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#cbd5e1'; // slate-300
      ctx.lineWidth = 1 * scale;
    }

    ctx.fill();
    ctx.stroke();

    // 丸文字テキスト描画
    ctx.fillStyle = '#000000';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortText, currentX + bWidth / 2, badgeY + badgeHeight / 2 + 0.5 * scale);

    // 完了の場合: 赤色斜め線をオーバーレイ描画
    if (isCompleted) {
      ctx.beginPath();
      ctx.strokeStyle = '#ef4444'; // red-500
      ctx.lineWidth = 2 * scale;
      ctx.lineCap = 'round';
      ctx.moveTo(currentX + 2 * scale, badgeY + badgeHeight - 2 * scale);
      ctx.lineTo(currentX + bWidth - 2 * scale, badgeY + 2 * scale);
      ctx.stroke();
    }

    currentX += bWidth + badgeGap;
  });

  ctx.restore();
}

/**
 * PDF上に動的に請求項目や金額をオーバーレイ描画するヘルパー
 * 背景を完全透過（白マスクなし）にし、画面情報（billingItems）と同一の内容を正確に印字
 */
function drawBillingOverlayOnCanvas(
  ctx: CanvasRenderingContext2D,
  shipment: Partial<Shipment>,
  canvasWidth: number,
  canvasHeight: number,
  scale: number
) {
  let billingItems = shipment.billingItems;
  if (!billingItems && shipment.id) {
    const full = getShipments().find((s) => s.id === shipment.id);
    if (full?.billingItems) {
      billingItems = full.billingItems;
    }
  }

  // 請求明細が設定されていない、または空配列の場合はオーバーレイを描画しない
  if (!billingItems || billingItems.length === 0) {
    return;
  }

  const calc = calculateBillingTotals(billingItems);

  ctx.save();

  // PDF右側エリアの請求明細テーブル座標
  const overlayX = canvasWidth * 0.54 - 3 * scale;
  // Y位置は下から310px (項目1番目を3px上・3px左へ補正)
  const overlayY = canvasHeight - 310 * scale;
  const overlayWidth = canvasWidth * 0.42;

  // フォントサイズ 11px, 行間 1.8px
  const fontRowSize = Math.round(11 * scale);
  const lineSpacing = 1.8 * scale;
  const rowHeight = fontRowSize + lineSpacing;

  ctx.textBaseline = 'top';

  // 画面の明細項目リストを完全透過背景で印字
  for (let index = 0; index < billingItems.length; index++) {
    const item = billingItems[index];
    if (!item) continue;
    const itemY = overlayY + index * rowHeight;

    // (a) 課税フラグ 'T' (課税対象時)
    if (item.taxable) {
      ctx.fillStyle = '#d97706'; // amber-600
      ctx.font = `bold ${fontRowSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('T', overlayX + 8 * scale, itemY);
    }

    // (b) 請求項目名 (最大20文字)
    if (item.name && item.name.trim()) {
      ctx.fillStyle = '#0f172a'; // slate-900
      ctx.font = `bold ${fontRowSize}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(item.name, overlayX + 18 * scale, itemY);
    }

    // (c) 請求金額 PP (数値または空欄)
    const hasAmount = item.amount !== '' && item.amount !== null && item.amount !== undefined;
    if (hasAmount) {
      const num = Number(item.amount);
      ctx.fillStyle = '#0f172a';
      ctx.font = `bold ${fontRowSize}px monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(`${num.toLocaleString()}`, overlayX + overlayWidth - 90 * scale, itemY);
    }
  }

  // --- 3. TAX (15行目に固定配置: overlayY + 14 * rowHeight) ---
  const taxY = overlayY + 14 * rowHeight;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#475569';
  ctx.font = `bold ${fontRowSize}px sans-serif`;
  ctx.fillText('TAX (10%):', overlayX + 18 * scale, taxY);

  ctx.textAlign = 'right';
  if (calc.isCalculated && calc.tax !== null) {
    ctx.fillStyle = '#d97706';
    ctx.font = `bold ${fontRowSize}px monospace`;
    ctx.fillText(`${calc.tax.toLocaleString()}`, overlayX + overlayWidth - 90 * scale, taxY);
  }

  // --- 4. TTL (16行目に固定配置: overlayY + 15 * rowHeight) ---
  const ttlY = overlayY + 15 * rowHeight;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1e3a8a'; // blue-900
  ctx.font = `bold ${fontRowSize + 0.5}px sans-serif`;
  ctx.fillText('TTL (合計):', overlayX + 18 * scale, ttlY);

  ctx.textAlign = 'right';
  if (calc.isCalculated && calc.ttl !== null) {
    ctx.fillStyle = '#1e3a8a';
    ctx.font = `bold ${fontRowSize + 1}px monospace`;
    ctx.fillText(`${calc.ttl.toLocaleString()}`, overlayX + overlayWidth - 90 * scale, ttlY);
  }

  ctx.restore();
}

export function generatePdfDataUrlFromShipment(shipment: Partial<Shipment>): string {
  const doc = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'a4',
  });

  // Top Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, 210, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('EXPORT SHIPPING INSTRUCTION (SI)', 14, 13);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('INTERNATIONAL AIR FREIGHT MANAGEMENT SYSTEM • OFFICIAL DOCUMENT', 14, 20);

  // Management Primary Key Badge
  doc.setFillColor(37, 99, 235); // blue-600
  doc.roundedRect(145, 6, 50, 14, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('MANAGEMENT ID:', 148, 11);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`${shipment.id || 'NRT-EXPORT-001'}`, 148, 17);

  // Document Info Box
  doc.setDrawColor(203, 213, 225); // slate-300
  doc.setFillColor(248, 250, 252); // slate-50
  doc.rect(14, 32, 182, 58, 'FD');

  doc.setTextColor(30, 41, 59); // slate-800
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('1. MAWB NUMBER:', 18, 40);
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.mawbNumber || 'N/A', 60, 40);

  doc.setFont('helvetica', 'bold');
  doc.text('2. HAWB NUMBER:', 18, 47);
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.hawbNumber || '(DIRECT MASTER / NO HAWB)', 60, 47);

  doc.setFont('helvetica', 'bold');
  doc.text('3. INVOICE NO.:', 18, 54);
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.invoiceNumber || 'N/A', 60, 54);

  doc.setFont('helvetica', 'bold');
  doc.text('4. ORDER / PO NO.:', 18, 61);
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.orderNumber || 'N/A', 60, 61);

  doc.setFont('helvetica', 'bold');
  doc.text('5. PIECES & WEIGHT:', 18, 68);
  doc.setFont('helvetica', 'normal');
  doc.text(`${shipment.pieces || 'N/A'}  /  ${shipment.grossWeight || 'N/A'}`, 60, 68);

  doc.setFont('helvetica', 'bold');
  doc.text('6. FLIGHT & CLEARANCE:', 18, 75);
  doc.setFont('helvetica', 'normal');
  doc.text(`${shipment.flightRoute || 'N/A'} (通関日: ${shipment.customsClearanceDate || 'N/A'})`, 60, 75);

  if (shipment.specialNotes) {
    doc.setFont('helvetica', 'bold');
    doc.text('7. SPECIAL NOTES:', 18, 82);
    doc.setFont('helvetica', 'normal');
    doc.text(String(shipment.specialNotes).replace(/\n/g, ' / '), 60, 82);
  }

  // Shipper & Consignee Parties Box
  doc.rect(14, 92, 182, 48, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.text('7. SHIPPER (EXPORTER):', 18, 100);
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.shipper || 'N/A', 18, 107);

  doc.setFont('helvetica', 'bold');
  doc.text('8. CONSIGNEE (IMPORTER):', 18, 118);
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.consignee || 'N/A', 18, 125);

  // Operations & Tasks Table
  doc.setFillColor(30, 41, 59);
  doc.rect(14, 146, 182, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('OPERATIONAL TASKS & PROCESS CHECKLIST', 18, 151.5);

  let y = 162;
  const tasks = shipment.tasks || [];
  tasks.forEach((t, i) => {
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(255, 255, 255);
    doc.rect(14, y - 5, 182, 9, 'FD');

    doc.setTextColor(51, 65, 85);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(`[${i + 1}] ${t.title}`, 18, y);

    const statusStr =
      t.status === 'Completed' ? '[ DONE ]' : t.status === 'In Progress' ? '[ IN PROGRESS ]' : '[ TODO ]';
    doc.setFont('helvetica', t.status === 'Completed' ? 'normal' : 'bold');
    doc.text(statusStr, 158, y);

    y += 11;
  });

  // PDF 左下: 指示書工程タスク短縮文字のプロセスバッジ (別レイヤー・枠線なしフロートコンテナ)
  if (tasks && tasks.length > 0) {
    const badgeBoxY = 248;

    // 白地のフローティングバッジ領域コンテナ (枠線なし・影の表現)
    let totalBadgesWidth = 0;
    tasks.forEach((t) => {
      const shortText = t.shortName || t.title.slice(0, 2);
      const textLen = shortText.length;
      const w = textLen <= 1 ? 10 : Math.max(12, textLen * 4.5 + 5);
      totalBadgesWidth += w + 2.5;
    });
    const containerWidth = Math.max(100, totalBadgesWidth + 12);
    const containerHeight = 15;

    // フロートコンテナ背景 (枠線なし白ベース)
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(12, badgeBoxY - 2, containerWidth, containerHeight, 4, 4, 'F');

    // キャプションテキスト
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text('PROCESS BADGES / 工程進捗ステータス (ドラッグ並び替え対応):', 15, badgeBoxY + 1.5);

    let startX = 15;
    const badgeStartY = badgeBoxY + 3.5;
    tasks.forEach((t) => {
      const shortText = t.shortName || t.title.slice(0, 2);
      const textLen = shortText.length;
      // 文字数に合わせて丸・カプセル形状の横幅を自動拡張
      const badgeWidth = textLen <= 1 ? 10 : Math.max(12, textLen * 4.5 + 5);
      const badgeHeight = 7.5;
      const radius = 3.75; // カプセル/丸形状

      const isInProgress = t.status === 'In Progress';
      const isCompleted = t.status === 'Completed';

      if (isInProgress) {
        // 作業中: 丸の線を黄色表示、バックカラーを薄い黄色
        doc.setFillColor(254, 243, 199); // amber-100
        doc.setDrawColor(245, 158, 11); // amber-500
        doc.setLineWidth(0.5);
      } else if (isCompleted) {
        // 完了: 丸の線を緑色表示
        doc.setFillColor(236, 253, 245); // emerald-50
        doc.setDrawColor(16, 185, 129); // emerald-500
        doc.setLineWidth(0.5);
      } else {
        // 未着手
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(203, 213, 225); // slate-300
        doc.setLineWidth(0.3);
      }

      // バッジの描画
      doc.roundedRect(startX, badgeStartY, badgeWidth, badgeHeight, radius, radius, 'FD');

      // 短縮文字 (黒色)
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(shortText, startX + badgeWidth / 2, badgeStartY + 5.2, { align: 'center' });

      // 完了工程: 赤色の斜め線
      if (isCompleted) {
        doc.setDrawColor(239, 68, 68); // red-500
        doc.setLineWidth(0.75);
        doc.line(startX + 1.2, badgeStartY + badgeHeight - 1.2, startX + badgeWidth - 1.2, badgeStartY + 1.2);
      }

      startX += badgeWidth + 2.5; // 横一列に並べる
    });
  }

  // Document Footer Line
  doc.setDrawColor(203, 213, 225);
  doc.line(14, 275, 196, 275);
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(7);
  doc.text(`CONFIDENTIAL - AUTOMATED EXPORT MANAGEMENT • SYSTEM ID: ${shipment.id || 'N/A'}`, 14, 281);
  doc.text('PAGE 1 OF 1', 172, 281);

  return doc.output('datauristring');
}
