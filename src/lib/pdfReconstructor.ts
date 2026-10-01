import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import { pdfjsLib, getPdfLoadOptions } from './pdfWorkerSetup';

export interface ReconstructedPdfResult {
  pdfBytes: Uint8Array;
  dataUri: string;
  thumbnailDataUrl: string;
  analysisImageDataUrl: string;
  width: number;
  height: number;
}

/**
 * 1ページ単位で正式なPDF構造（/Catalog, /Pages, /Page, XRef, Trailer）を
 * 完全に新規再構築し、Windowsエクスプローラーのプレビューペインや各種ビューアで
 * 100%確実に即時プレビュー・表示できるようにするリコンストラクター
 */
export async function reconstructSinglePagePdf(
  pdfDocOrBuffer: any,
  pageNumber: number,
  title?: string,
  rawArrayBuffer?: ArrayBuffer
): Promise<ReconstructedPdfResult> {
  let pdfJsDoc: any = null;
  let page: any = null;
  let sourceBuffer: ArrayBuffer | null = null;

  // 1. ArrayBuffer と pdfjs ドキュメントの準備
  if (rawArrayBuffer && rawArrayBuffer.byteLength > 0) {
    sourceBuffer = rawArrayBuffer;
  } else if (pdfDocOrBuffer instanceof ArrayBuffer) {
    sourceBuffer = pdfDocOrBuffer;
  } else if (pdfDocOrBuffer instanceof Uint8Array) {
    sourceBuffer = pdfDocOrBuffer.buffer.slice(pdfDocOrBuffer.byteOffset, pdfDocOrBuffer.byteOffset + pdfDocOrBuffer.byteLength);
  }

  if (pdfDocOrBuffer && typeof pdfDocOrBuffer.getPage === 'function') {
    pdfJsDoc = pdfDocOrBuffer;
    page = await pdfJsDoc.getPage(pageNumber);
  } else if (sourceBuffer) {
    const uint8Data = new Uint8Array(sourceBuffer.slice(0));
    const loadingTask = pdfjsLib.getDocument(getPdfLoadOptions(uint8Data));
    pdfJsDoc = await loadingTask.promise;
    page = await pdfJsDoc.getPage(pageNumber);
  } else {
    throw new Error('Valid PDF buffer or Document is required for reconstruction');
  }

  // 2. 元ページの論理寸法（pt単位: 1/72 inch）を取得
  const unscaledViewport = page.getViewport({ scale: 1.0 });
  const widthPt = unscaledViewport.width || 595.28;
  const heightPt = unscaledViewport.height || 841.89;

  // 3. 高精細キャンバスレンダリング（OCRおよび高解像度プレビュー用: scale 1.5 〜 2.0）
  const renderScale = 1.75;
  const renderViewport = page.getViewport({ scale: renderScale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(renderViewport.width);
  canvas.height = Math.floor(renderViewport.height);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context creation failed during PDF reconstruction');
  }

  // 白背景のクリア
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // PDF.js標準のレンダリングパイプラインを実行（内部で画像デコード・配置が完全同期待機される）
  const renderTask = page.render({
    canvasContext: ctx,
    viewport: renderViewport,
  });
  await renderTask.promise;

  // 高精細画像JPEG（Gemini Vision OCR用: 0.90品質）
  const highQualityImgDataUrl = canvas.toDataURL('image/jpeg', 0.90);

  // UI用サムネイル（軽量版: 幅320px程度）
  let thumbnailDataUrl = highQualityImgDataUrl;
  if (canvas.width > 360) {
    const thumbCanvas = document.createElement('canvas');
    const thumbScale = 320 / canvas.width;
    thumbCanvas.width = 320;
    thumbCanvas.height = Math.floor(canvas.height * thumbScale);
    const tCtx = thumbCanvas.getContext('2d');
    if (tCtx) {
      tCtx.fillStyle = '#FFFFFF';
      tCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
      tCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.85);
    }
  }

  // 4. pdf-libによる無劣化1ページ抽出（元のスキャン画像・ベクター・フォント・解像度を完全維持）
  let pdfBytes: Uint8Array | null = null;
  let dataUri = '';

  if (sourceBuffer) {
    try {
      const srcPdfDoc = await PDFDocument.load(sourceBuffer.slice(0), { ignoreEncryption: true });
      const singlePageDoc = await PDFDocument.create();
      const pageIndex = Math.max(0, Math.min(pageNumber - 1, srcPdfDoc.getPageCount() - 1));
      const [copiedPage] = await singlePageDoc.copyPages(srcPdfDoc, [pageIndex]);
      singlePageDoc.addPage(copiedPage);

      if (title) {
        singlePageDoc.setTitle(title);
      }
      singlePageDoc.setSubject('爆発物検査結果依頼書 (Single Page Reconstructed PDF)');
      singlePageDoc.setAuthor('International Freight Management System');
      singlePageDoc.setCreator('X-ray Analysis Reconstructor Engine');

      pdfBytes = await singlePageDoc.save();
      
      // Data URI 生成
      let binary = '';
      const len = pdfBytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(pdfBytes[i]);
      }
      const base64 = btoa(binary);
      dataUri = `data:application/pdf;base64,${base64}`;
    } catch (pdfLibErr) {
      console.warn('pdf-lib lossless extraction fallback to jsPDF:', pdfLibErr);
    }
  }

  // 5. 万一pdf-libが失敗した場合のjsPDFフォールバック（画像再構築）
  if (!pdfBytes) {
    const orientation = widthPt > heightPt ? 'landscape' : 'portrait';
    const outPdf = new jsPDF({
      orientation,
      unit: 'pt',
      format: [widthPt, heightPt],
      compress: true,
      putOnlyUsedFonts: true,
    });

    outPdf.setProperties({
      title: title || `XRAY RESULT P.${pageNumber}`,
      subject: '爆発物検査結果依頼書 (Single Page Reconstructed PDF)',
      author: 'International Freight Management System',
      creator: 'X-ray Analysis Reconstructor Engine',
    });

    outPdf.addImage(
      highQualityImgDataUrl,
      'JPEG',
      0,
      0,
      widthPt,
      heightPt,
      undefined,
      'FAST'
    );

    const arrayBuf = outPdf.output('arraybuffer');
    pdfBytes = new Uint8Array(arrayBuf);
    dataUri = outPdf.output('datauristring');
  }

  return {
    pdfBytes,
    dataUri,
    thumbnailDataUrl,
    analysisImageDataUrl: highQualityImgDataUrl,
    width: widthPt,
    height: heightPt,
  };
}
