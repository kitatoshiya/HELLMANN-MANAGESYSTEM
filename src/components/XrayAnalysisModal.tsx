import React, { useState, useRef } from 'react';
import { pdfjsLib, getPdfLoadOptions } from '../lib/pdfWorkerSetup';
import JSZip from 'jszip';
import { PdfCanvasViewer } from './PdfCanvasViewer';
import { reconstructSinglePagePdf } from '../lib/pdfReconstructor';
import {
  FileCheck,
  Upload,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  FileText,
  Search,
  CheckSquare,
  Square,
  Sparkles,
  Info,
  ShieldAlert,
  ArrowRight,
  ZoomIn,
  Bug,
  Copy,
  FileCode,
  Eye,
  Check
} from 'lucide-react';

interface XrayPageResult {
  pageNumber: number; // 1-based
  pagePdfBase64: string;
  pdfBytes?: Uint8Array;
  thumbnailDataUrl: string;
  analysisImageDataUrl?: string;
  hasExplosiveInspectionRequest: boolean;
  awbNumber: string;
  documentTitle: string;
  summaryText: string;
  extractedRawText?: string;
  pdfText?: string;
  detectedDate?: string;
  agentOrShipper?: string;
  piecesAndWeight?: string;
  inspectionResultText?: string;
  selectedForDownload: boolean;
}

interface XrayAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const XrayAnalysisModal: React.FC<XrayAnalysisModalProps> = ({ isOpen, onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [pdfArrayBuffer, setPdfArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0, statusText: '' });
  const [results, setResults] = useState<XrayPageResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadSuccessMessage, setDownloadSuccessMessage] = useState<string | null>(null);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [copiedPageIndex, setCopiedPageIndex] = useState<number | null>(null);
  const [copiedAllOcr, setCopiedAllOcr] = useState(false);
  const [selectedOcrPage, setSelectedOcrPage] = useState<XrayPageResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfDocRef = useRef<any>(null);

  const [zoomedImage, setZoomedImage] = useState<{ url: string; title: string; pageNum: number } | null>(null);

  if (!isOpen) return null;

  // Handle Drag & Drop Events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === 'application/pdf' || droppedFile.name.toLowerCase().endsWith('.pdf')) {
        handleFileChange(droppedFile);
      } else {
        setErrorMessage('PDFファイル(.pdf)を選択またはドロップしてください。');
      }
    }
  };

  // Handle PDF file selection
  const handleFileChange = async (selectedFile: File) => {
    if (!selectedFile || (!selectedFile.type.includes('pdf') && !selectedFile.name.toLowerCase().endsWith('.pdf'))) {
      setErrorMessage('PDFファイル(.pdf)を選択してください。');
      return;
    }

    setFile(selectedFile);
    setErrorMessage(null);
    setDownloadSuccessMessage(null);
    setResults([]);

    try {
      const buffer = await selectedFile.arrayBuffer();
      setPdfArrayBuffer(buffer);
      await analyzePdf(buffer, selectedFile.name);
    } catch (err: any) {
      console.error('Error reading PDF file:', err);
      setErrorMessage(`ファイル読み込みエラー: ${err.message || 'PDFの読み込みに失敗しました'}`);
    }
  };

  // Helper to extract text from a PDF page directly via pdfjs
  const extractTextFromPage = async (pdfDoc: any, pageNum: number): Promise<string> => {
    if (!pdfDoc || typeof pdfDoc.getPage !== 'function') return '';
    try {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const strings = textContent.items
        .map((item: any) => (item.str ? item.str.trim() : ''))
        .filter(Boolean);
      return strings.join(' ');
    } catch (e) {
      console.warn(`Failed to extract text content for page ${pageNum}:`, e);
      return '';
    }
  };

  // Process and Analyze PDF using formal single-page reconstruction and Gemini OCR API
  const analyzePdf = async (buffer: ArrayBuffer, fileName: string) => {
    setIsAnalyzing(true);
    setResults([]);
    setErrorMessage(null);

    try {
      setAnalysisProgress({ current: 0, total: 0, statusText: 'PDFドキュメントを読み込み中...' });

      // 1. Load PDF with pdfjs-dist
      const uint8Data = new Uint8Array(buffer.slice(0));
      const loadingTask = pdfjsLib.getDocument(getPdfLoadOptions(uint8Data));

      let pdfDoc: any = null;
      try {
        pdfDoc = await loadingTask.promise;
        pdfDocRef.current = pdfDoc;
      } catch (pdfjsErr) {
        console.warn('pdfjs-dist document load warning:', pdfjsErr);
      }

      const totalPages = pdfDoc ? pdfDoc.numPages : 1;

      setAnalysisProgress({
        current: 0,
        total: totalPages,
        statusText: `全 ${totalPages} ページを正式PDF再構築・AI OCR解析中...`,
      });

      const pageResults: XrayPageResult[] = [];

      for (let i = 1; i <= totalPages; i++) {
        setAnalysisProgress({
          current: i,
          total: totalPages,
          statusText: `ページ ${i} / ${totalPages} を正式PDF再構築およびOCR解析中...`,
        });

        // 1ページ単位で正式なPDF構造を再構築（Windowsエクスプローラープレビュー完全対応）
        let pagePdfBase64 = '';
        let thumbnailDataUrl = '';
        let analysisImageDataUrl = '';
        let pagePdfBytes: Uint8Array | undefined;

        try {
          const reconstructed = await reconstructSinglePagePdf(pdfDoc || buffer, i, undefined, buffer);
          pagePdfBase64 = reconstructed.dataUri;
          pagePdfBytes = reconstructed.pdfBytes;
          thumbnailDataUrl = reconstructed.thumbnailDataUrl;
          analysisImageDataUrl = reconstructed.analysisImageDataUrl;
        } catch (recErr) {
          console.error(`reconstructSinglePagePdf error for page ${i}:`, recErr);
        }

        // ページ内テキストを直接抽出（ローカルOCR補助）
        const localPageText = await extractTextFromPage(pdfDoc, i);
        
        // ローカル判定（万一のGemini API瞬断・エラー時のフォールバック用）
        const localHasExplosive = /爆発物検査依頼書/i.test(localPageText) || /爆発物.*検査/i.test(localPageText);
        const localAwbMatch = localPageText.match(/\b(\d{3})[-\s]?(\d{4})[-\s]?(\d{4})\b/) || localPageText.match(/\b(\d{3})[-\s]?(\d{8})\b/);
        const localAwb = localAwbMatch ? `${localAwbMatch[1]}-${localAwbMatch[2]}${localAwbMatch[3] || ''}` : '';

        // Call server API for Gemini Vision OCR Analysis with high-res crisp image & resilient payload
        let apiData: any = null;
        try {
          // Send both pdfBase64 (lossless single page) and imageBase64 for optimal Gemini AI multimodal OCR
          const apiRes = await fetch('/api/analyze-xray-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pdfBase64: pagePdfBase64 || undefined,
              imageBase64: analysisImageDataUrl || thumbnailDataUrl || undefined,
              textContent: localPageText || undefined,
              pageNumber: i,
              totalPages: totalPages,
            }),
          });

          const rawText = await apiRes.text();
          let resData: any = null;
          try {
            resData = JSON.parse(rawText);
          } catch {
            console.warn(`Non-JSON response from server for page ${i}:`, rawText.slice(0, 100));
          }

          if (resData && resData.success && resData.data) {
            apiData = resData.data;
          }
        } catch (apiErr: any) {
          console.warn(`API request issue for page ${i}, applying local OCR fallback:`, apiErr);
        }

        if (apiData) {
          const hasExplosiveReq = Boolean(apiData.hasExplosiveInspectionRequest) || localHasExplosive;
          const rawAwb = apiData.awbNumber ? String(apiData.awbNumber).trim() : localAwb;

          pageResults.push({
            pageNumber: i,
            pagePdfBase64,
            pdfBytes: pagePdfBytes,
            thumbnailDataUrl,
            analysisImageDataUrl,
            hasExplosiveInspectionRequest: hasExplosiveReq,
            awbNumber: rawAwb,
            documentTitle: apiData.documentTitle || (hasExplosiveReq ? '爆発物検査依頼書' : '検査書類'),
            summaryText: apiData.summaryText || 'AI 画像OCR解析完了',
            extractedRawText: apiData.extractedRawText || '',
            pdfText: localPageText || '',
            detectedDate: apiData.detectedDate || undefined,
            agentOrShipper: apiData.agentOrShipper || undefined,
            piecesAndWeight: apiData.piecesAndWeight || undefined,
            inspectionResultText: apiData.inspectionResultText || undefined,
            selectedForDownload: hasExplosiveReq,
          });
        } else {
          // ローカル抽出による安全なフォールバック
          pageResults.push({
            pageNumber: i,
            pagePdfBase64,
            pdfBytes: pagePdfBytes,
            thumbnailDataUrl,
            analysisImageDataUrl,
            hasExplosiveInspectionRequest: localHasExplosive,
            awbNumber: localAwb,
            documentTitle: localHasExplosive ? '爆発物検査依頼書 (テキスト解析)' : '検査書類',
            summaryText: localPageText ? localPageText.slice(0, 100) : '書類読み込み完了',
            extractedRawText: localPageText || '',
            pdfText: localPageText || '',
            selectedForDownload: localHasExplosive,
          });
        }

        // レートリミット回避のため、複数ページの場合はわずかなインターバルを設ける
        if (i < totalPages) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      setResults(pageResults);
    } catch (err: any) {
      console.error('Error during PDF analysis:', err);
      setErrorMessage(`解析中にエラーが発生しました: ${err.message || '未知のエラー'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Export all pages' OCR text as a formatted UTF-8 text file (.txt)
  const handleDownloadAllOcrText = () => {
    if (results.length === 0) return;

    let content = `=================================================================\n`;
    content += `X線検査結果 / 爆発物検査依頼書 画像解析OCR テキスト出力一覧\n`;
    content += `ファイル名: ${file ? file.name : 'X-ray_Inspection.pdf'}\n`;
    content += `出力日時: ${new Date().toLocaleString('ja-JP')}\n`;
    content += `総ページ数: ${results.length} ページ\n`;
    content += `爆発物検査依頼書 検出数: ${results.filter((r) => r.hasExplosiveInspectionRequest).length} 件\n`;
    content += `=================================================================\n\n`;

    results.forEach((r) => {
      content += `-----------------------------------------------------------------\n`;
      content += `【ページ ${r.pageNumber} / ${results.length}】\n`;
      content += `書類種別: ${r.documentTitle}\n`;
      content += `爆発物検査依頼書判定: ${r.hasExplosiveInspectionRequest ? '該当 [TRUE]' : '非該当 [FALSE]'}\n`;
      content += `AWB No (Air Waybill): ${r.awbNumber || '（未検出）'}\n`;
      if (r.detectedDate) content += `記載日付: ${r.detectedDate}\n`;
      if (r.agentOrShipper) content += `代理店/荷主: ${r.agentOrShipper}\n`;
      if (r.piecesAndWeight) content += `個数・重量: ${r.piecesAndWeight}\n`;
      if (r.inspectionResultText) content += `検査判定: ${r.inspectionResultText}\n`;
      content += `要約: ${r.summaryText}\n`;
      content += `\n[--- 高精度画像解析 OCR テキスト全文 ---]\n`;
      content += `${r.extractedRawText || '（OCRテキストなし）'}\n`;
      content += `-----------------------------------------------------------------\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `X線検査結果_高精度OCRテキスト_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Copy all pages' OCR text to clipboard
  const handleCopyAllOcrText = () => {
    if (results.length === 0) return;

    let content = `=== X線検査結果 / 爆発物検査依頼書 OCRテキスト一覧 ===\n\n`;
    results.forEach((r) => {
      content += `【P.${r.pageNumber} | ${r.documentTitle} | AWB: ${r.awbNumber || '未検出'}】\n`;
      content += `${r.extractedRawText || r.summaryText}\n\n`;
    });

    navigator.clipboard.writeText(content);
    setCopiedAllOcr(true);
    setTimeout(() => setCopiedAllOcr(false), 2500);
  };

  // Handle AWB Number edits
  const handleAwbChange = (pageIndex: number, newAwb: string) => {
    setResults((prev) =>
      prev.map((r, idx) => (idx === pageIndex ? { ...r, awbNumber: newAwb } : r))
    );
  };

  // Toggle page selection for download
  const togglePageSelection = (pageIndex: number) => {
    setResults((prev) =>
      prev.map((r, idx) =>
        idx === pageIndex ? { ...r, selectedForDownload: !r.selectedForDownload } : r
      )
    );
  };

  // Select/Deselect all helpers
  const handleSelectAll = (selectOnlyExplosive: boolean = false) => {
    setResults((prev) =>
      prev.map((r) => ({
        ...r,
        selectedForDownload: selectOnlyExplosive ? r.hasExplosiveInspectionRequest : true,
      }))
    );
  };

  const handleDeselectAll = () => {
    setResults((prev) => prev.map((r) => ({ ...r, selectedForDownload: false })));
  };

  // Download single reconstructed PDF
  const handleDownloadSinglePage = async (pageIndex: number) => {
    const pageRes = results[pageIndex];
    if (!pageRes) return;

    let bytes = pageRes.pdfBytes;
    if (!bytes || bytes.length === 0) {
      if (pdfDocRef.current || pdfArrayBuffer) {
        const reconstructed = await reconstructSinglePagePdf(
          pdfDocRef.current || pdfArrayBuffer,
          pageRes.pageNumber
        );
        bytes = reconstructed.pdfBytes;
      }
    }

    if (!bytes) {
      alert('PDFデータの生成に失敗しました。');
      return;
    }

    const cleanAwb = pageRes.awbNumber
      ? pageRes.awbNumber.trim().replace(/[/\\?%*:|"<>]/g, '_')
      : `不明_P${pageRes.pageNumber}`;
    const fileName = `XRAY RESULT(${cleanAwb}).PDF`;

    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Execute PDF Splitting & ZIP Generation Download
  const handleDownloadZip = async () => {
    const selectedPages = results.filter((r) => r.selectedForDownload);

    if (selectedPages.length === 0) {
      alert('ダウンロード対象のページが選択されていません。チェックボックスをONにしてください。');
      return;
    }

    if (!pdfArrayBuffer && !pdfDocRef.current) {
      alert('元PDFデータが見つかりません。ファイルを再ロードしてください。');
      return;
    }

    setIsDownloading(true);
    setDownloadSuccessMessage(null);

    try {
      const zip = new JSZip();
      let exportedCount = 0;

      for (const pageRes of selectedPages) {
        let bytes = pageRes.pdfBytes;

        // もし未キャッシュなら正式なPDF構造（/Catalog, /Pages, /Page, XRef, Trailer）を新規生成
        if (!bytes || bytes.length === 0) {
          const reconstructed = await reconstructSinglePagePdf(
            pdfDocRef.current || pdfArrayBuffer,
            pageRes.pageNumber
          );
          bytes = reconstructed.pdfBytes;
        }

        // Sanitize AWB number for filename
        const cleanAwb = pageRes.awbNumber
          ? pageRes.awbNumber.trim().replace(/[/\\?%*:|"<>]/g, '_')
          : `不明_P${pageRes.pageNumber}`;

        // Mandatory Filename Spec: "XRAY RESULT(＋AWB番号＋).PDF"
        const fileName = `XRAY RESULT(${cleanAwb}).PDF`;

        zip.file(fileName, bytes);
        exportedCount++;
      }

      // Generate ZIP blob
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Trigger Browser Download
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `X線検査結果_解析分割ファイル_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setDownloadSuccessMessage(
        `合計 ${exportedCount} 件の爆発物検査依頼書PDFを1ページ毎に正式PDFとして再構築し、ZIP形式でダウンロードしました。Windowsエクスプローラーのプレビューペインで正常に表示可能です。`
      );
    } catch (err: any) {
      console.error('Error creating ZIP download:', err);
      alert(`ダウンロードZIPファイルの生成に失敗しました: ${err.message || 'エラー'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const selectedCount = results.filter((r) => r.selectedForDownload).length;
  const explosiveDetectedCount = results.filter((r) => r.hasExplosiveInspectionRequest).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-5xl my-8 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in duration-200">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center text-white shadow-lg shadow-amber-500/20 shrink-0">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold tracking-tight text-white">X線検査結果解析・OCR一括分割</h2>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                  Gemini Vision AI OCR
                </span>
              </div>
              <p className="text-xs text-slate-400">
                PDFを取り込み、ページ上部の”爆発物検査依頼書”表記とAWB Noを自動検知して個別にPDF分割ZIP保存します
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body Scroll Area */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* File Select & Upload Dropzone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`p-6 rounded-2xl border-2 border-dashed transition-all text-center space-y-3 ${
              isDragging
                ? 'border-amber-500 bg-amber-50/80 ring-4 ring-amber-500/20 scale-[1.01]'
                : 'border-slate-300 bg-slate-50/80 hover:border-amber-500 hover:bg-slate-50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileChange(e.target.files[0]);
                }
              }}
              className="hidden"
            />

            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto shadow-xs">
              <Upload className="w-6 h-6" />
            </div>

            <div>
              <p className="text-sm font-bold text-slate-800">
                {file ? file.name : 'X線検査結果・爆発物検査依頼書 PDFをドロップまたは選択'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                画像型スキャンPDF対応 • AI OCRによるテキスト変換・AWB No位置解析
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isAnalyzing}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs inline-flex items-center space-x-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <FileText className="w-4 h-4 text-amber-400" />
                <span>{file ? '別のPDFファイルを選択' : 'PDFファイルを選択'}</span>
              </button>

              {/* Debug Mode Toggle Checkbox */}
              <label className="flex items-center space-x-2 px-3 py-2 bg-amber-50 hover:bg-amber-100/80 border border-amber-300 rounded-xl cursor-pointer transition-colors shadow-2xs">
                <input
                  type="checkbox"
                  checked={isDebugMode}
                  onChange={(e) => setIsDebugMode(e.target.checked)}
                  className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500 cursor-pointer accent-amber-600"
                />
                <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5 select-none">
                  <Bug className="w-3.5 h-3.5 text-amber-700" />
                  <span>デバッグモード（1ページ毎にOCR抽出テキストを表示）</span>
                </span>
              </label>
            </div>
          </div>

          {/* Analysis Error Notification */}
          {errorMessage && (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-2xl flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold block">解析エラーが発生しました</strong>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {/* Download Success Banner */}
          {downloadSuccessMessage && (
            <div className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs rounded-2xl flex items-start space-x-3 shadow-2xs">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold block">ZIPダウンロード完了</strong>
                <span>{downloadSuccessMessage}</span>
              </div>
            </div>
          )}

          {/* Processing Progress Indicator */}
          {isAnalyzing && (
            <div className="bg-amber-50/80 border border-amber-200 p-5 rounded-2xl space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-amber-900">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
                  <span>{analysisProgress.statusText}</span>
                </span>
                <span className="font-mono">
                  {analysisProgress.current} / {analysisProgress.total} ページ
                </span>
              </div>

              {analysisProgress.total > 0 && (
                <div className="w-full bg-amber-200/60 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-amber-600 h-full transition-all duration-300"
                    style={{
                      width: `${Math.round((analysisProgress.current / analysisProgress.total) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Analysis Results Display */}
          {results.length > 0 && (
            <div className="space-y-4">
              {/* Summary Controls & Legend Bar */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center space-x-3 text-xs flex-wrap gap-y-2">
                  <span className="font-bold text-slate-800">
                    全 <strong className="font-mono text-sm">{results.length}</strong> ページ高精度OCR解析完了
                  </span>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded-lg border border-emerald-300">
                    爆発物検査依頼書 検出: {explosiveDetectedCount} 件
                  </span>
                  <span className="text-slate-500 text-[11px]">
                    (分割対象: {selectedCount} ページ)
                  </span>

                  {/* Debug Mode Checkbox in Toolbar */}
                  <label className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-amber-50 hover:bg-amber-100/90 border border-amber-300 rounded-lg cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={isDebugMode}
                      onChange={(e) => setIsDebugMode(e.target.checked)}
                      className="w-3.5 h-3.5 text-amber-600 rounded focus:ring-amber-500 cursor-pointer accent-amber-600"
                    />
                    <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1 select-none">
                      <Bug className="w-3.5 h-3.5 text-amber-700" />
                      <span>デバッグモード（全ページのOCR生テキストを表示）</span>
                    </span>
                  </label>
                </div>

                <div className="flex items-center space-x-2 shrink-0 flex-wrap gap-y-1.5">
                  {/* Bulk OCR Text Export Buttons */}
                  <button
                    type="button"
                    onClick={handleDownloadAllOcrText}
                    className="px-2.5 py-1 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
                    title="全ページの画像解析OCRテキストを1つのテキストファイル(.txt)でダウンロードします"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-600" />
                    <span>OCRテキストDL (.txt)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyAllOcrText}
                    className="px-2.5 py-1 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
                    title="全ページのOCRテキストをクリップボードにコピーします"
                  >
                    {copiedAllOcr ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700">コピー完了</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-600" />
                        <span>全テキストコピー</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectAll(true)}
                    className="px-2.5 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors cursor-pointer"
                    title="爆発物検査依頼書と判定されたページのみ選択します"
                  >
                    依頼書のみ選択
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAll(false)}
                    className="px-2.5 py-1 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    全選択
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:text-slate-700 bg-white border border-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    全解除
                  </button>
                </div>
              </div>

              {/* Page Results Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                        <th className="py-3 px-3 text-center w-12">選択</th>
                        <th className="py-3 px-3 text-center w-16">ページ</th>
                        <th className="py-3 px-3 w-28">プレビュー</th>
                        <th className="py-3 px-3 w-44">判定結果</th>
                        <th className="py-3 px-3">取得 AWB No (編集可能)</th>
                        <th className="py-3 px-3">画像解析OCR結果 & 検出詳細</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {results.map((res, idx) => (
                        <React.Fragment key={res.pageNumber}>
                          <tr
                            className={`transition-colors ${
                              res.hasExplosiveInspectionRequest
                                ? 'bg-emerald-50/30 hover:bg-emerald-50/60'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            {/* Selection Checkbox */}
                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => togglePageSelection(idx)}
                                className="text-slate-600 hover:text-blue-600 cursor-pointer p-1"
                              >
                                {res.selectedForDownload ? (
                                  <CheckSquare className="w-5 h-5 text-emerald-600" />
                                ) : (
                                  <Square className="w-5 h-5 text-slate-300" />
                                )}
                              </button>
                            </td>

                            {/* Page Number */}
                            <td className="py-3 px-3 text-center font-mono font-bold text-slate-700">
                              P.{res.pageNumber}
                            </td>

                            {/* Thumbnail Image */}
                            <td className="py-3 px-3">
                              <button
                                type="button"
                                onClick={() =>
                                  (res.analysisImageDataUrl || res.pagePdfBase64 || res.thumbnailDataUrl) &&
                                  setZoomedImage({
                                    url: res.analysisImageDataUrl || res.pagePdfBase64 || res.thumbnailDataUrl,
                                    title: res.documentTitle,
                                    pageNum: res.pageNumber,
                                  })
                                }
                                className="w-20 h-28 bg-white border border-slate-200 rounded-lg overflow-hidden shadow-2xs shrink-0 flex items-center justify-center relative group cursor-pointer hover:border-amber-500 hover:ring-2 hover:ring-amber-500/30 transition-all p-0.5"
                                title="クリックして拡大プレビューを表示"
                              >
                                {res.thumbnailDataUrl ? (
                                  <>
                                    <img
                                      src={res.thumbnailDataUrl}
                                      alt={`Page ${res.pageNumber}`}
                                      className="w-full h-full object-contain bg-white rounded shadow-2xs"
                                    />
                                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                                      <ZoomIn className="w-5 h-5 drop-shadow" />
                                    </div>
                                  </>
                                ) : res.pagePdfBase64 ? (
                                  <div className="w-full h-full pointer-events-none flex items-center justify-center overflow-hidden relative">
                                    <PdfCanvasViewer pdfDataUrl={res.pagePdfBase64} isThumbnail={true} scale={0.5} />
                                    <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                                      <ZoomIn className="w-5 h-5 drop-shadow" />
                                    </div>
                                  </div>
                                ) : (
                                  <FileText className="w-6 h-6 text-slate-400" />
                                )}
                              </button>
                            </td>

                            {/* Explosive Inspection Status */}
                            <td className="py-3 px-3">
                              {res.hasExplosiveInspectionRequest ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-2xs">
                                  <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600 shrink-0" />
                                  爆発物検査依頼書
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                                  対象外書類
                                </span>
                              )}
                            </td>

                            {/* Extracted AWB Number Input */}
                            <td className="py-3 px-3">
                              <div className="space-y-1">
                                <label className="text-[10px] text-slate-500 font-bold block">
                                  保存ファイル名用 AWB No:
                                </label>
                                <input
                                  type="text"
                                  value={res.awbNumber}
                                  onChange={(e) => handleAwbChange(idx, e.target.value)}
                                  placeholder="例: 123-45678901"
                                  className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                                />
                                <span className="text-[10px] text-slate-400 block truncate">
                                  出力名: XRAY RESULT({res.awbNumber || '未設定'}).PDF
                                </span>
                              </div>
                            </td>

                            {/* AI Text Summary, Extracted Metadata Badges & OCR Inspector */}
                            <td className="py-3 px-3 text-slate-600 space-y-2">
                              <div className="font-bold text-slate-800 text-xs flex items-center justify-between flex-wrap gap-1">
                                <span className="text-slate-900">{res.documentTitle}</span>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedOcrPage(res)}
                                    className="text-[10px] font-bold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                                    title="このページの画像とOCRテキストを並べて比較・確認します"
                                  >
                                    <Eye className="w-3 h-3 text-blue-600" />
                                    <span>OCR全文確認</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsDebugMode(!isDebugMode);
                                    }}
                                    className="text-[10px] font-bold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 rounded transition-colors cursor-pointer flex items-center gap-1"
                                    title="このページのOCRテキスト詳細をインライン表示"
                                  >
                                    <Bug className="w-3 h-3 text-amber-600" />
                                    <span>詳細</span>
                                  </button>
                                </div>
                              </div>

                              {/* Structured Field Badges */}
                              <div className="flex flex-wrap gap-1 text-[10px]">
                                {res.detectedDate && (
                                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200 font-mono">
                                    日付: {res.detectedDate}
                                  </span>
                                )}
                                {res.agentOrShipper && (
                                  <span className="px-1.5 py-0.5 bg-sky-50 text-sky-800 rounded border border-sky-200">
                                    荷主/代理店: {res.agentOrShipper}
                                  </span>
                                )}
                                {res.piecesAndWeight && (
                                  <span className="px-1.5 py-0.5 bg-amber-50 text-amber-800 rounded border border-amber-200 font-mono">
                                    個数/重量: {res.piecesAndWeight}
                                  </span>
                                )}
                                {res.inspectionResultText && (
                                  <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-800 rounded border border-emerald-200">
                                    判定: {res.inspectionResultText}
                                  </span>
                                )}
                              </div>

                              <div className="text-[11px] text-slate-500 line-clamp-2">
                                {res.summaryText}
                              </div>
                            </td>
                          </tr>

                          {/* Debug Mode Collapsible / Full Text Row for Page */}
                          {isDebugMode && (
                            <tr className="bg-slate-950 text-slate-100 border-t border-b border-amber-500/40">
                              <td colSpan={6} className="p-4 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                                  <div className="flex items-center space-x-2 text-xs font-bold text-amber-400">
                                    <Bug className="w-4 h-4 text-amber-400 shrink-0" />
                                    <span>【デバッグ】ページ {res.pageNumber} OCR解析・テキスト抽出詳細</span>
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                                        res.hasExplosiveInspectionRequest
                                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50'
                                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                                      }`}
                                    >
                                      判定: {res.hasExplosiveInspectionRequest ? '爆発物検査依頼書 [TRUE]' : '対象外 [FALSE]'}
                                    </span>
                                    <span className="text-slate-400 text-[11px] font-mono">
                                      AWB: {res.awbNumber || '(未検出)'}
                                    </span>
                                  </div>

                                  <div className="flex items-center space-x-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const copyContent = `【P.${res.pageNumber} OCR解析データ】\n文書名: ${res.documentTitle}\nAWB番号: ${res.awbNumber || '未検出'}\n爆発物検査依頼書判定: ${res.hasExplosiveInspectionRequest ? '該当(TRUE)' : '非該当(FALSE)'}\n要約: ${res.summaryText}\n\n=== Gemini Vision OCR生テキスト ===\n${res.extractedRawText || '（テキストなし）'}\n\n=== PDF内蔵テキスト ===\n${res.pdfText || '（内蔵テキストレイヤーなし・画像スキャンPDF）'}`;
                                        navigator.clipboard.writeText(copyContent);
                                        setCopiedPageIndex(res.pageNumber);
                                        setTimeout(() => setCopiedPageIndex(null), 2000);
                                      }}
                                      className="px-2.5 py-1 text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 border border-amber-500/40 rounded-lg transition-colors cursor-pointer flex items-center space-x-1.5"
                                    >
                                      {copiedPageIndex === res.pageNumber ? (
                                        <>
                                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                                          <span className="text-emerald-300">コピーしました！</span>
                                        </>
                                      ) : (
                                        <>
                                          <Copy className="w-3.5 h-3.5 text-amber-400" />
                                          <span>テキストをコピー</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                                  {/* AI OCR Raw Text */}
                                  <div className="space-y-1.5 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                                    <div className="flex items-center justify-between text-[11px] font-bold text-amber-300">
                                      <span className="flex items-center gap-1.5">
                                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                        <span>AI OCR 抽出テキスト全文 (Gemini Vision)</span>
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-mono">
                                        {res.extractedRawText ? `${res.extractedRawText.length} 文字` : '0 文字'}
                                      </span>
                                    </div>
                                    <pre className="p-3 bg-slate-950 border border-slate-800/80 rounded-lg text-amber-100 font-mono text-[11px] max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text font-normal">
                                      {res.extractedRawText ? (
                                        res.extractedRawText
                                      ) : (
                                        <span className="text-slate-500 italic">（AI OCRテキストは空または検出されませんでした）</span>
                                      )}
                                    </pre>
                                  </div>

                                  {/* PDF Native Text Layer */}
                                  <div className="space-y-1.5 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                                    <div className="flex items-center justify-between text-[11px] font-bold text-sky-300">
                                      <span className="flex items-center gap-1.5">
                                        <FileCode className="w-3.5 h-3.5 text-sky-400" />
                                        <span>PDF内蔵テキストレイヤー (pdf.js抽出)</span>
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-mono">
                                        {res.pdfText ? `${res.pdfText.length} 文字` : '0 文字'}
                                      </span>
                                    </div>
                                    <pre className="p-3 bg-slate-950 border border-slate-800/80 rounded-lg text-sky-100 font-mono text-[11px] max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text font-normal">
                                      {res.pdfText ? (
                                        res.pdfText
                                      ) : (
                                        <span className="text-slate-500 italic">（PDFテキストレイヤーなし - スキャン画像型PDF）</span>
                                      )}
                                    </pre>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 flex items-center space-x-1">
            <Info className="w-4 h-4 text-blue-500 shrink-0" />
            <span>
              「ダウンロード」ボタンを押すと、選択されたページを1ページ毎に個別PDFへ分割し、ZIPで一括保存します。
            </span>
          </div>

          <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              閉じる
            </button>

            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={isDownloading || selectedCount === 0 || results.length === 0}
              className={`px-5 py-2.5 text-xs font-extrabold rounded-xl shadow-md flex items-center space-x-2 transition-all cursor-pointer ${
                selectedCount === 0 || isDownloading
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
                  : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white shadow-emerald-600/20'
              }`}
            >
              {isDownloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>PDF分割ZIP作成中...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-emerald-100" />
                  <span>ダウンロード ({selectedCount} 件のPDF分割ZIP)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Side-by-Side Full OCR Inspection Modal */}
      {selectedOcrPage && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="font-bold text-sm">
                  ページ {selectedOcrPage.pageNumber} 画像解析OCRテキスト詳細
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    selectedOcrPage.hasExplosiveInspectionRequest
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {selectedOcrPage.hasExplosiveInspectionRequest ? '爆発物検査依頼書 [TRUE]' : '対象外書類'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOcrPage(null)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body: Left Image, Right OCR Text */}
            <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50">
              {/* Left Column: Scanned Page Image */}
              <div className="space-y-2 flex flex-col">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>📄 スキャン原本画像プレビュー</span>
                  <button
                    type="button"
                    onClick={() =>
                      setZoomedImage({
                        url: selectedOcrPage.analysisImageDataUrl || selectedOcrPage.pagePdfBase64 || selectedOcrPage.thumbnailDataUrl,
                        title: selectedOcrPage.documentTitle,
                        pageNum: selectedOcrPage.pageNumber,
                      })
                    }
                    className="text-amber-700 hover:text-amber-800 flex items-center gap-1 text-[11px] font-bold"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                    <span>さらに拡大</span>
                  </button>
                </div>
                <div className="flex-1 bg-white p-2 border border-slate-200 rounded-xl overflow-hidden shadow-xs flex items-center justify-center min-h-[350px]">
                  {selectedOcrPage.analysisImageDataUrl || selectedOcrPage.thumbnailDataUrl ? (
                    <img
                      src={selectedOcrPage.analysisImageDataUrl || selectedOcrPage.thumbnailDataUrl}
                      alt={`Page ${selectedOcrPage.pageNumber}`}
                      className="max-w-full max-h-[60vh] object-contain rounded"
                    />
                  ) : selectedOcrPage.pagePdfBase64 ? (
                    <PdfCanvasViewer pdfDataUrl={selectedOcrPage.pagePdfBase64} isThumbnail={false} scale={0.9} />
                  ) : (
                    <div className="text-slate-400 text-xs">画像プレビューがありません</div>
                  )}
                </div>
              </div>

              {/* Right Column: OCR Text & Extracted Attributes */}
              <div className="space-y-4 flex flex-col">
                {/* Extracted Metadata Card */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-2">
                  <div className="text-xs font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center justify-between">
                    <span>抽出キー情報</span>
                    <span className="font-mono text-[11px] text-slate-500">
                      AWB: <strong className="text-slate-900">{selectedOcrPage.awbNumber || '（未検出）'}</strong>
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">書類種別</span>
                      <span className="font-bold text-slate-800">{selectedOcrPage.documentTitle}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">記載日付</span>
                      <span className="font-bold text-slate-800">{selectedOcrPage.detectedDate || '-'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">代理店 / 荷主</span>
                      <span className="font-bold text-slate-800">{selectedOcrPage.agentOrShipper || '-'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">個数・重量</span>
                      <span className="font-bold text-slate-800">{selectedOcrPage.piecesAndWeight || '-'}</span>
                    </div>
                  </div>
                </div>

                {/* Raw OCR Text Area */}
                <div className="flex-1 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col space-y-2 min-h-[250px]">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                    <span className="flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-amber-600" />
                      <span>OCR 抽出テキスト全文</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedOcrPage.extractedRawText || selectedOcrPage.summaryText);
                        setCopiedPageIndex(selectedOcrPage.pageNumber);
                        setTimeout(() => setCopiedPageIndex(null), 2000);
                      }}
                      className="px-2.5 py-1 text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      {copiedPageIndex === selectedOcrPage.pageNumber ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>コピーしました</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-amber-700" />
                          <span>テキストをコピー</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="flex-1 p-3 bg-slate-900 text-amber-100 rounded-lg font-mono text-xs overflow-y-auto whitespace-pre-wrap leading-relaxed select-text border border-slate-800">
                    {selectedOcrPage.extractedRawText || selectedOcrPage.summaryText || '（テキストなし）'}
                  </pre>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-100 px-6 py-3 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedOcrPage(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zoomed Image Lightbox Modal */}
      {zoomedImage && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="bg-slate-900 text-white px-5 py-3 flex items-center justify-between shrink-0">
              <span className="font-bold text-xs flex items-center gap-2">
                <ZoomIn className="w-4 h-4 text-amber-400" />
                <span>P.{zoomedImage.pageNum} 高精細レンダリング プレビュー</span>
                <span className="text-slate-400 font-normal">({zoomedImage.title})</span>
              </span>
              <button
                type="button"
                onClick={() => setZoomedImage(null)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-slate-100 overflow-auto flex items-center justify-center flex-1 max-h-[80vh]">
              {zoomedImage.url.startsWith('data:application/pdf') || zoomedImage.url.startsWith('http') ? (
                <PdfCanvasViewer pdfDataUrl={zoomedImage.url} isThumbnail={false} scale={1.0} />
              ) : (
                <img
                  src={zoomedImage.url}
                  alt={`Page ${zoomedImage.pageNum}`}
                  className="max-w-full max-h-[75vh] object-contain shadow-lg rounded-lg border border-slate-200 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
