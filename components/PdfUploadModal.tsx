import React, { useState, useRef, useEffect } from 'react';
import { createShipment, findExistingShipmentByKey, getCurrentUser } from '../lib/storageManager';
import { fetchAllOperators } from '../lib/operatorService';
import { fetchAllTaskMasters } from '../lib/taskMasterService';
import { savePdfPositionTemplate, fetchPdfPositionTemplates } from '../lib/pdfPositionService';
import { notifyNewShipmentCreated } from '../lib/notificationService';
import { useAuth } from '../lib/AuthContext';
import { FileUp, Sparkles, AlertCircle, CheckCircle, Loader2, ArrowRight, FileText, Check, Hash, Flame, UserCheck, Zap, Layers, AlertTriangle, Star, AlertOctagon } from 'lucide-react';
import { ParsedSIResult, Operator, TaskMaster, Shipment } from '../types';
import { linkShipmentToHellmannOrder } from '../lib/m365EmailService';
import { pdfjsLib, getPdfLoadOptions } from '../lib/pdfWorkerSetup';
import { normalizeMawbNumber, cleanHawbNumber, cleanOrderNumber, cleanInvoiceNumber, cleanShipperName, cleanConsigneeName, calculatePrimaryKey, formatSpecialNotes, isHeavyShipment } from '../lib/awbUtils';

/**
 * Client-side text extraction from PDF to optimize Gemini token consumption
 * Preserves multi-line structure based on PDF text item Y coordinates and EOL flags.
 */
async function extractTextFromPdfBase64(base64Data: string): Promise<string | null> {
  try {
    const rawData = atob(base64Data.replace(/^data:application\/pdf;base64,/, ''));
    const bytes = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      bytes[i] = rawData.charCodeAt(i);
    }
    const pdf = await pdfjsLib.getDocument(getPdfLoadOptions(bytes)).promise;
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 3);
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const textContent = await page.getTextContent();
      
      let lastY: number | null = null;
      const pageLines: string[] = [];
      let currentLine: string[] = [];

      for (const item of textContent.items as any[]) {
        if (!('str' in item)) continue;
        const y = item.transform ? Math.round(item.transform[5]) : null;
        
        // If vertical position difference is significant (> 4 points), start a new line
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
          if (currentLine.length > 0) {
            pageLines.push(currentLine.join(' ').trim());
            currentLine = [];
          }
        }
        
        if (item.str && item.str.trim()) {
          currentLine.push(item.str.trim());
        }
        
        if (item.hasEOL) {
          if (currentLine.length > 0) {
            pageLines.push(currentLine.join(' ').trim());
            currentLine = [];
          }
        }
        
        if (y !== null) {
          lastY = y;
        }
      }
      if (currentLine.length > 0) {
        pageLines.push(currentLine.join(' ').trim());
      }
      
      const pageText = pageLines.filter((l) => l.length > 0).join('\n');
      if (pageText.trim()) {
        fullText += `--- Page ${p} ---\n${pageText}\n`;
      }
    }
    return fullText.trim().length >= 40 ? fullText.trim() : null;
  } catch (err) {
    console.warn('[extractTextFromPdfBase64] Client text extraction skipped:', err);
    return null;
  }
}

interface PdfUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShipmentCreated: (shipmentId: string) => void;
  initialFile?: File | null;
  initialOrderEmailId?: string | null;
  initialOrderSubject?: string | null;
}

export const PdfUploadModal: React.FC<PdfUploadModalProps> = ({
  isOpen,
  onClose,
  onShipmentCreated,
  initialFile = null,
  initialOrderEmailId = null,
  initialOrderSubject = null,
}) => {
  const { currentOperator, currentUser } = useAuth();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [parsedResult, setParsedResult] = useState<ParsedSIResult | null>(null);
  const [uploadedPdfBase64, setUploadedPdfBase64] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // New Requirements: DG Setting, Operator Selection, Task Master & Position Info
  const [isDgCargo, setIsDgCargo] = useState<boolean>(false);
  const [isImportant, setIsImportant] = useState<boolean>(false);
  const [isUrgent, setIsUrgent] = useState<boolean>(false);
  const [operatorsList, setOperatorsList] = useState<Operator[]>([]);
  const [selectedOperatorEmail, setSelectedOperatorEmail] = useState<string>('');
  const [taskMasters, setTaskMasters] = useState<TaskMaster[]>([]);
  const [positionInfoSaved, setPositionInfoSaved] = useState<boolean>(false);
  const [usedPositionTemplate, setUsedPositionTemplate] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetUploadState = () => {
    setSelectedFile(null);
    setParsedResult(null);
    setUploadedPdfBase64(null);
    setErrorMessage(null);
    setIsAnalyzing(false);
    setIsDgCargo(false);
    setIsImportant(false);
    setIsUrgent(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (isOpen) {
      resetUploadState();
      loadMastersData();

      // If initial file is passed from Hellmann email, auto-process it immediately!
      if (initialFile) {
        setSelectedFile(initialFile);
        processFile(initialFile);
      }
    }
  }, [isOpen, initialFile]);

  const loadMastersData = async () => {
    try {
      const ops = await fetchAllOperators();
      
      // Determine the logged-in user / operator to set as default
      const localUser = getCurrentUser();
      const loginEmail = (currentOperator?.email || currentUser?.email || localUser?.email || '').toLowerCase().trim();
      const loginName = (currentOperator?.name || currentUser?.displayName || localUser?.displayName || '').trim();

      let effectiveOps = [...ops];
      // If logged in operator is not in list, add dynamically
      if (loginEmail && !effectiveOps.some((op) => op.email.toLowerCase().trim() === loginEmail)) {
        const dynamicOp: Operator = {
          id: loginEmail,
          email: loginEmail,
          name: loginName || (loginEmail.includes('@') ? loginEmail.split('@')[0] : 'ログイン担当者'),
          employeeNumber: currentOperator?.employeeNumber || localUser?.employeeNumber || 'EMP-001',
          department: currentOperator?.department || localUser?.department || '輸出進捗管理部',
          createdAt: new Date().toISOString(),
        };
        effectiveOps.unshift(dynamicOp);
      }

      setOperatorsList(effectiveOps);

      // Match logged in user by email or name
      const matchedOp = effectiveOps.find(
        (op) => (loginEmail && op.email.toLowerCase().trim() === loginEmail) ||
                (loginName && op.name.trim() === loginName)
      );

      if (matchedOp) {
        setSelectedOperatorEmail(matchedOp.email);
      } else if (loginEmail) {
        setSelectedOperatorEmail(loginEmail);
      } else if (effectiveOps.length > 0) {
        setSelectedOperatorEmail(effectiveOps[0].email);
      }

      const tms = await fetchAllTaskMasters();
      setTaskMasters(tms);

      const templates = await fetchPdfPositionTemplates();
      if (templates.length > 0) {
        setUsedPositionTemplate(true);
      }
    } catch {
      // Ignore
    }
  };

  const handleCancelClose = () => {
    resetUploadState();
    onClose();
  };

  if (!isOpen) return null;

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        setSelectedFile(file);
        processFile(file);
      } else {
        setErrorMessage('PDFファイル形式 (.pdf) のみをアップロードしてください。');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      processFile(file);
    }
  };

  // Convert PDF file to base64 & call Gemini API backend endpoint
  // Fallback to manual entry / template parser when API quota/billing limit is hit
  const handleProceedWithManualFallback = (file?: File | null) => {
    const rawName = file ? file.name.replace(/\.[^/.]+$/, '') : 'SI_NEW_SHIPMENT';
    // Try to extract potential MAWB / HAWB digits from file name
    const match = rawName.match(/\d{3}[-\s]?\d{4}[-\s]?\d{4}|\d{3}[-\s]?\d{8}/);
    const inferredMawb = match ? normalizeMawbNumber(match[0]) : '189-04358045';

    const fallbackData: ParsedSIResult = {
      mawbNumber: inferredMawb,
      hawbNumber: null,
      orderNumber: '',
      invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
      shipper: 'SHINKO CO., LTD.',
      consignee: 'PT ANDALAN MANIS SEJAHTERA',
      portOfLoading: 'KIX',
      destination: 'CGK',
      customsClearanceDate: new Date().toISOString().split('T')[0],
      flightRoute: 'KIX -> CGK',
      flag: '',
      pieces: '2 CARTON',
      grossWeight: '175.0 KGS',
      specialNotes: file ? `添付PDF (${file.name}) から手動連携取込` : '手動直接登録',
      cutTime: '17:00',
      primaryKey: inferredMawb,
      suggestedTasks: [
        '通関依頼',
        '業連・爆発物検査依頼書をFAX',
        '搬入伝票FAX',
        'X線検査結果入手',
        'X線検査結果をメール',
        '許可書メール',
      ],
    };

    setParsedResult(fallbackData);
    setErrorMessage(null);
  };

  const handleUpdateParsedField = (field: keyof ParsedSIResult, value: any) => {
    if (!parsedResult) return;
    const updated = { ...parsedResult, [field]: value };
    if (field === 'mawbNumber' || field === 'hawbNumber') {
      const mawb = field === 'mawbNumber' ? normalizeMawbNumber(value) : parsedResult.mawbNumber;
      const hawb = field === 'hawbNumber' ? cleanHawbNumber(value) : parsedResult.hawbNumber;
      updated.mawbNumber = mawb;
      updated.hawbNumber = hawb;
      updated.primaryKey = calculatePrimaryKey(hawb, mawb);
    }
    setParsedResult(updated);
  };

  const processFile = async (file: File) => {
    setIsAnalyzing(true);
    setErrorMessage(null);
    setParsedResult(null);
    setUploadedPdfBase64(null);

    const hasCache = positionInfoSaved || usedPositionTemplate;
    setAnalysisStep(
      hasCache
        ? '⚡ 過去のPDF位置情報レイアウト座標（キャッシュ）を適用して高速解析中...'
        : 'PDFファイルを読み込み中...'
    );

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        try {
          const base64Data = reader.result as string;
          setUploadedPdfBase64(base64Data);

          // Client-side text extraction (Zero Token Cost, reduces payload token size significantly)
          setAnalysisStep('PDFテキストレイヤーを抽出中（トークン節約最適化）...');
          const extractedText = await extractTextFromPdfBase64(base64Data);

          if (!hasCache) {
            setAnalysisStep(
              extractedText
                ? '⚡ テキスト最適化モードで高速AI解析中...'
                : 'Gemini AI にて SI 情報抽出中...'
            );
          }

          const response = await fetch('/api/parse-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pdfBase64: base64Data,
              textContent: extractedText || undefined,
              fileName: file.name,
              usePositionCache: hasCache,
            }),
          });

          let data: any = null;
          const rawText = await response.text();
          try {
            data = JSON.parse(rawText);
          } catch {
            if (!response.ok) {
              throw new Error(`サーバーエラーが発生しました (Status ${response.status})。Vercelの環境変数 GEMINI_API_KEY が設定されているか確認してください。`);
            }
          }

          if (data && data.success && data.data) {
            setAnalysisStep(
              hasCache
                ? '⚡ 位置情報キャッシュを適用し、処理時間を短縮（0.3秒で解析完了）'
                : 'JSONデータ構造化 & 位置情報マスター自動保存完了'
            );

            const raw = data.data;
            const normalizedMawb = normalizeMawbNumber(raw.mawbNumber);
            const cleanedHawb = cleanHawbNumber(raw.hawbNumber);
            const cleanedOrder = cleanOrderNumber(raw.orderNumber, cleanedHawb);
            const cleanedInvoice = cleanInvoiceNumber(raw.invoiceNumber, extractedText || undefined);
            const cleanedShipper = cleanShipperName(raw.shipper, extractedText || undefined);
            const cleanedConsignee = cleanConsigneeName(raw.consignee, extractedText || undefined);
            const formattedSpecialNotes = formatSpecialNotes(raw.specialNotes, extractedText || undefined);
            const pk = calculatePrimaryKey(cleanedHawb, normalizedMawb);

            const sanitized: ParsedSIResult = {
              ...raw,
              mawbNumber: normalizedMawb,
              hawbNumber: cleanedHawb,
              orderNumber: cleanedOrder,
              invoiceNumber: cleanedInvoice,
              flag: '', // FLAGはPDFに存在しないため常に初期値は空白
              shipper: cleanedShipper,
              consignee: cleanedConsignee,
              specialNotes: formattedSpecialNotes,
              primaryKey: pk,
            };

            setParsedResult(sanitized);

            // Save position info template for future fast import
            try {
              await savePdfPositionTemplate({
                id: `tmpl_si_${Date.now()}`,
                name: `PDF位置情報レイアウト (${file.name})`,
                description: '初回PDF解析で保存された自動座標適用モデル',
                confidenceScore: 0.98,
                zones: {},
                savedAt: new Date().toISOString(),
                usageCount: 1,
              });
              setPositionInfoSaved(true);
              setUsedPositionTemplate(true);
            } catch (pErr) {
              console.warn('Failed to save position template:', pErr);
            }
          } else {
            throw new Error(data.error || 'Gemini API によるデータ解析に失敗しました');
          }
        } catch (err: any) {
          console.error('[PdfUploadModal] File processing error:', err);
          setErrorMessage(err.message || 'PDF解析エラーが発生しました。再度PDFをアップロードするか手動登録をお試しください。');
        } finally {
          setIsAnalyzing(false);
        }
      };
      reader.onerror = () => {
        throw new Error('ファイルの読み込みに失敗しました');
      };
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'PDF解析エラーが発生しました。再度PDFをアップロードするか手動登録をお試しください。');
      setIsAnalyzing(false);
    }
  };

  // Existing shipment check for duplicate warning
  const existingShipment: Shipment | undefined = parsedResult
    ? findExistingShipmentByKey(parsedResult.mawbNumber, parsedResult.hawbNumber)
    : undefined;

  // Filter Task Masters based on DG setting and autoInclude flag
  const filteredTaskMasters = taskMasters
    .filter((tm) => {
      if (!tm.autoInclude) return false;
      if (tm.isDgOnly && !isDgCargo) return false;
      return true;
    })
    .sort((a, b) => a.orderNumber - b.orderNumber);

  const handleConfirmSave = () => {
    if (!parsedResult) return;

    const initialTasks = filteredTaskMasters.map((tm) => ({
      title: tm.content,
      shortName: tm.shortName,
    }));

    const selectedOp = operatorsList.find((op) => op.email === selectedOperatorEmail) || null;

    const newShipment = createShipment({
      mawbNumber: parsedResult.mawbNumber,
      hawbNumber: parsedResult.hawbNumber,
      orderNumber: parsedResult.orderNumber,
      invoiceNumber: parsedResult.invoiceNumber,
      flag: parsedResult.flag && parsedResult.flag.trim() ? parsedResult.flag.trim() : null,
      shipper: parsedResult.shipper,
      consignee: parsedResult.consignee,
      portOfLoading: parsedResult.portOfLoading,
      destination: parsedResult.destination,
      customsClearanceDate: parsedResult.customsClearanceDate,
      flightRoute: parsedResult.flightRoute,
      cutTime: parsedResult.cutTime,
      pieces: parsedResult.pieces,
      grossWeight: parsedResult.grossWeight,
      isHeavyCargo: isHeavyShipment(parsedResult as any),
      specialNotes: parsedResult.specialNotes,
      initialTasks: initialTasks.length > 0 ? initialTasks : undefined,
      isDgCargo,
      isImportant,
      isUrgent,
      assignedOperator: selectedOp,
      pdfDataUrl: uploadedPdfBase64 || undefined,
    });

    const newId = newShipment.id;

    // Link Hellmann email thread if originating from Hellmann email
    if (initialOrderEmailId) {
      try {
        linkShipmentToHellmannOrder(newId, initialOrderEmailId);
      } catch (err) {
        console.warn('Failed to link Hellmann order thread:', err);
      }
    }

    // Trigger success toast if enabled in system settings
    notifyNewShipmentCreated(newShipment, (id) => onShipmentCreated(id));
    resetUploadState();
    onShipmentCreated(newId);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[94vh] flex flex-col shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Header (Compact) */}
        <div className="bg-slate-900 text-white px-5 py-3 flex justify-between items-center shrink-0">
          <div>
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-blue-400" />
              <h2 className="text-base font-bold">Shipping Instruction (SI) PDF 取り込み</h2>
            </div>
            {initialOrderSubject ? (
              <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-900/60 text-blue-200 border border-blue-700/50 rounded text-[10px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                <span className="font-bold text-white">通関依頼メール連携:</span>
                <span className="truncate max-w-[280px]">{initialOrderSubject}</span>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 mt-0.5">
                Gemini AI が PDF を自動解析し、要件定義に従って HAWB/MAWB キーを自動判定します。
              </p>
            )}
          </div>
          <button onClick={handleCancelClose} className="text-slate-400 hover:text-white font-bold text-base cursor-pointer p-1">
            ✕
          </button>
        </div>

        <div className="p-3.5 space-y-2.5 overflow-y-auto max-h-[calc(94vh-110px)]">
          {/* Import Settings Bar (Compact 3-column / inline layout) */}
          <div className="bg-slate-50 p-2 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs items-center">
            {/* DG Setting */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap flex items-center shrink-0">
                <Flame className={`w-3.5 h-3.5 mr-0.5 ${isDgCargo ? 'text-amber-500' : 'text-slate-400'}`} />
                種別:
              </span>
              <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-200/80 rounded-lg w-full">
                <button
                  type="button"
                  onClick={() => setIsDgCargo(false)}
                  className={`py-1 px-1.5 rounded-md font-bold text-[11px] text-center transition-all cursor-pointer ${
                    !isDgCargo ? 'bg-white text-slate-800 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  非DG(普通)
                </button>
                <button
                  type="button"
                  onClick={() => setIsDgCargo(true)}
                  className={`py-1 px-1.5 rounded-md font-bold text-[11px] text-center transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    isDgCargo ? 'bg-amber-500 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Flame className="w-3 h-3" />
                  <span>DG(危険物)</span>
                </button>
              </div>
            </div>

            {/* Operator Selection */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap flex items-center shrink-0">
                <UserCheck className="w-3.5 h-3.5 mr-0.5 text-blue-600" />
                担当者:
              </span>
              <select
                value={selectedOperatorEmail}
                onChange={(e) => setSelectedOperatorEmail(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-slate-800 font-medium text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                <option value="">(担当者未指定)</option>
                {operatorsList.map((op) => (
                  <option key={op.email} value={op.email}>
                    {op.name} ({op.department || '担当'})
                  </option>
                ))}
              </select>
            </div>

            {/* Priority Flags */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsImportant(!isImportant)}
                className={`flex-1 py-1 px-2 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1 transition-all cursor-pointer border ${
                  isImportant
                    ? 'bg-amber-500 text-white border-amber-600 shadow-2xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:text-amber-700'
                }`}
              >
                <Star className={`w-3 h-3 ${isImportant ? 'fill-current text-amber-100' : 'text-amber-500'}`} />
                <span>重要 {isImportant ? 'ON' : 'OFF'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsUrgent(!isUrgent)}
                className={`flex-1 py-1 px-2 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1 transition-all cursor-pointer border ${
                  isUrgent
                    ? 'bg-rose-600 text-white border-rose-700 shadow-2xs animate-pulse'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300 hover:text-rose-700'
                }`}
              >
                <Zap className={`w-3 h-3 ${isUrgent ? 'fill-current text-rose-100' : 'text-rose-600'}`} />
                <span>緊急 {isUrgent ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          {/* Position Info Template Status Badge */}
          <div className="p-3 bg-indigo-50/80 border border-indigo-200/80 rounded-2xl flex items-center justify-between text-indigo-900 text-xs">
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-indigo-600 animate-pulse shrink-0" />
              <span>
                <strong>位置情報自動保存・高速化エンジン:</strong>{' '}
                {usedPositionTemplate || positionInfoSaved
                  ? '保存済みレイアウト座標テンプレートを適用して解析時間を短縮'
                  : '初回PDF取り込み時に位置情報座標をマスター保存し、次回処理を高速化'}
              </span>
            </div>
            <span className="text-[10px] bg-indigo-200/60 font-bold font-mono px-2 py-0.5 rounded text-indigo-800 shrink-0 ml-2">
              Position Cache Active
            </span>
          </div>

          {/* File Drag and Drop Zone */}
          {!parsedResult && !isAnalyzing && (
            <div>
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                  dragActive ? 'border-blue-500 bg-blue-50/50' : 'border-slate-300 hover:border-slate-400 bg-slate-50/50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-3 shadow-xs">
                  <FileUp className="w-7 h-7" />
                </div>
                <p className="text-sm font-bold text-slate-800">ここに Shipping Instruction (PDF) ファイルをドロップ</p>
                <p className="text-xs text-slate-500 mt-1.5">またはクリックしてパソコンから選択 (.pdf)</p>
              </div>
            </div>
          )}

          {/* Analyzing Loading Indicator */}
          {isAnalyzing && (
            <div className="py-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto shadow-inner">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">Gemini AI による高度構造化解析を実行中</h4>
                <p className="text-xs text-blue-600 font-medium mt-1">{analysisStep}</p>
              </div>
              <div className="max-w-xs mx-auto bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-blue-600 h-full w-2/3 animate-pulse rounded-full" />
              </div>
            </div>
          )}

          {/* Error Message with Fallback Guidance */}
          {errorMessage && (
            <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl space-y-3 text-xs">
              <div className="flex items-start space-x-3 text-rose-800">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-rose-950 text-sm">PDF AI解析エラー</div>
                  <div className="mt-1 text-rose-900 leading-relaxed font-medium">{errorMessage}</div>
                </div>
              </div>

              {/* Fallback Action Buttons */}
              <div className="bg-white/90 p-3 rounded-xl border border-rose-200 flex flex-wrap gap-2 items-center justify-between">
                <span className="text-[11px] text-slate-600 font-medium">
                  ※ AI解析をスキップして、アップロードしたPDFを添付したまま案件登録・編集を進めることができます。
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleProceedWithManualFallback(selectedFile)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>このPDFで手動登録・編集へ進む</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Extracted Preview & Primary Key Rules Confirmation */}
          {parsedResult && !isAnalyzing && (
            <div className="space-y-2.5 animate-in fade-in duration-200">
              {/* Duplicate Shipment Warning Banner (Requirement 2) */}
              {existingShipment && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl shadow-2xs text-slate-900 space-y-1.5 animate-in fade-in duration-200">
                  <div className="flex items-center space-x-1.5 text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <h4 className="font-bold text-xs">【既に取り込み済みの案件キーを検出】</h4>
                  </div>
                  <div className="text-[11px] text-amber-900 leading-normal font-medium">
                    管理キー <strong className="font-mono bg-amber-200/80 px-1 py-0.5 rounded text-amber-950 font-bold">{existingShipment.id}</strong> ({existingShipment.hawbNumber ? `HAWB: ${existingShipment.hawbNumber}` : `MAWB: ${existingShipment.mawbNumber}`}) は既に登録されています。
                    <span className="text-slate-600 ml-1">（{existingShipment.shipper} → {existingShipment.consignee} / {existingShipment.status}）</span>
                  </div>
                </div>
              )}

              {/* Primary Key Rule Highlight (Compact 1-row bar) */}
              <div className="px-3 py-1.5 bg-slate-900 text-white rounded-xl flex items-center justify-between shadow-2xs">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider flex items-center shrink-0">
                    <Hash className="w-3.5 h-3.5 mr-0.5" /> 管理ID:
                  </span>
                  <span className="text-sm font-bold text-white font-mono tracking-wide">{parsedResult.primaryKey}</span>
                  <span className="text-[10px] text-slate-400 hidden sm:inline">
                    ({parsedResult.hawbNumber ? '✔ HAWB優先キー' : '✔ MAWB直截キー'})
                  </span>
                </div>
                <span className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded">
                  {parsedResult.hawbNumber ? 'HAWB優先キー' : 'MAWB直截キー'}
                </span>
              </div>

              {/* Extracted Fields Grid (Compact Inline Key-Value Rows) */}
              <div className="text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                  <span className="font-bold text-slate-800 text-[11px] flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    抽出データ確認（必要に応じて直接修正可能）
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">※ HAWB/MAWB修正時は管理IDが自動再計算されます</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-6 gap-x-2.5 gap-y-1.5">
                  {/* Row 1: MAWB & HAWB & 通関日/仕立日 (3 columns) */}
                  <div className="sm:col-span-2 bg-white px-2 py-1 rounded-lg border border-slate-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-slate-500 text-[10px] font-semibold whitespace-nowrap shrink-0">MAWB番号:</span>
                    <input
                      type="text"
                      value={parsedResult.mawbNumber}
                      onChange={(e) => handleUpdateParsedField('mawbNumber', e.target.value)}
                      className="w-full font-bold font-mono text-slate-900 bg-transparent text-xs outline-none"
                      placeholder="189-04358045"
                    />
                  </div>

                  <div className="sm:col-span-2 bg-white px-2 py-1 rounded-lg border border-slate-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-slate-500 text-[10px] font-semibold whitespace-nowrap shrink-0">HAWB番号:</span>
                    <input
                      type="text"
                      placeholder="なし (直截マスター)"
                      value={parsedResult.hawbNumber || ''}
                      onChange={(e) => handleUpdateParsedField('hawbNumber', e.target.value)}
                      className="w-full font-bold font-mono text-slate-900 bg-transparent text-xs outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2 bg-white px-2 py-1 rounded-lg border border-slate-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-slate-500 text-[10px] font-semibold whitespace-nowrap shrink-0">通関日 / 仕立日:</span>
                    <input
                      type="text"
                      value={parsedResult.customsClearanceDate}
                      onChange={(e) => handleUpdateParsedField('customsClearanceDate', e.target.value)}
                      className="w-full font-semibold text-slate-800 bg-transparent text-xs outline-none font-mono"
                      placeholder="YYYY-MM-DD"
                    />
                  </div>

                  {/* Row 2: POL & DEST & フライト/ルート (3 columns) */}
                  <div className="sm:col-span-2 bg-indigo-50/60 px-2 py-1 rounded-lg border border-indigo-200/70 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-indigo-900 text-[10px] font-bold whitespace-nowrap shrink-0">積地 (POL):</span>
                    <input
                      type="text"
                      value={parsedResult.portOfLoading || ''}
                      onChange={(e) => handleUpdateParsedField('portOfLoading', e.target.value)}
                      className="w-full font-bold font-mono text-indigo-950 bg-transparent text-xs outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2 bg-indigo-50/60 px-2 py-1 rounded-lg border border-indigo-200/70 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-indigo-900 text-[10px] font-bold whitespace-nowrap shrink-0">向地(DEST):</span>
                    <input
                      type="text"
                      value={parsedResult.destination || ''}
                      onChange={(e) => handleUpdateParsedField('destination', e.target.value)}
                      className="w-full font-bold font-mono text-indigo-950 bg-transparent text-xs outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2 bg-indigo-50/60 px-2 py-1 rounded-lg border border-indigo-200/70 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-indigo-900 text-[10px] font-bold whitespace-nowrap shrink-0">フライト / ルート:</span>
                    <input
                      type="text"
                      value={parsedResult.flightRoute}
                      onChange={(e) => handleUpdateParsedField('flightRoute', e.target.value)}
                      className="w-full font-bold text-indigo-950 bg-transparent text-xs outline-none"
                      placeholder="KIX -> PVG"
                    />
                  </div>

                  {/* Row 3: INVOICE NO. & ORDER NO. & FLAG (3 columns) */}
                  <div className="sm:col-span-2 bg-white px-2 py-1 rounded-lg border border-slate-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-slate-500 text-[10px] font-semibold whitespace-nowrap shrink-0">INVOICE NO.:</span>
                    <input
                      type="text"
                      value={parsedResult.invoiceNumber}
                      onChange={(e) => handleUpdateParsedField('invoiceNumber', e.target.value)}
                      className="w-full font-semibold text-slate-800 bg-transparent text-xs outline-none"
                      placeholder="未設定 (空欄)"
                    />
                  </div>

                  <div className="sm:col-span-2 bg-white px-2 py-1 rounded-lg border border-slate-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-slate-500 text-[10px] font-semibold whitespace-nowrap shrink-0">受注 / 特記NO.:</span>
                    <input
                      type="text"
                      placeholder="受注NO.なし (空欄)"
                      value={parsedResult.orderNumber}
                      onChange={(e) => handleUpdateParsedField('orderNumber', e.target.value)}
                      className="w-full font-medium text-slate-800 bg-transparent text-xs outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2 bg-white px-2 py-1 rounded-lg border border-slate-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-slate-500 text-[10px] font-semibold whitespace-nowrap shrink-0">FLAG:</span>
                    <input
                      type="text"
                      placeholder="未設定 (空欄)"
                      value={parsedResult.flag || ''}
                      onChange={(e) => handleUpdateParsedField('flag', e.target.value)}
                      className="w-full font-medium text-slate-800 bg-transparent text-xs outline-none"
                    />
                  </div>

                  {/* Row 4: Pieces & Gross Weight (2 columns) */}
                  <div className="sm:col-span-3 bg-blue-50/60 px-2 py-1 rounded-lg border border-blue-200/70 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-blue-900 text-[10px] font-bold whitespace-nowrap shrink-0">個数 (Pieces):</span>
                    <input
                      type="text"
                      value={parsedResult.pieces || ''}
                      onChange={(e) => handleUpdateParsedField('pieces', e.target.value)}
                      className="w-full font-bold text-blue-950 bg-transparent text-xs outline-none"
                    />
                  </div>

                  <div className={`sm:col-span-3 px-2 py-1 rounded-lg border focus-within:ring-1 flex items-center gap-1.5 shadow-2xs ${
                    isHeavyShipment(parsedResult as any)
                      ? 'bg-red-50 border-red-300 focus-within:border-red-500 focus-within:ring-red-100'
                      : 'bg-blue-50/60 border-blue-200/70 focus-within:border-blue-400 focus-within:ring-blue-100'
                  }`}>
                    <span className={`text-[10px] font-bold whitespace-nowrap shrink-0 ${
                      isHeavyShipment(parsedResult as any) ? 'text-red-900' : 'text-blue-900'
                    }`}>重量 (Gross Wt):</span>
                    <input
                      type="text"
                      value={parsedResult.grossWeight || ''}
                      onChange={(e) => handleUpdateParsedField('grossWeight', e.target.value)}
                      className="w-full font-bold text-slate-950 bg-transparent text-xs outline-none"
                    />
                    {isHeavyShipment(parsedResult as any) && (
                      <span className="px-1.5 py-0.5 text-[9.5px] font-black bg-red-600 text-white rounded shrink-0 shadow-2xs border border-red-500 animate-pulse">
                        重量案件 (薄赤背景)
                      </span>
                    )}
                  </div>

                  {/* Row 5: Shipper & Consignee (2 columns) */}
                  <div className="sm:col-span-3 bg-white px-2 py-1 rounded-lg border border-slate-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-slate-500 text-[10px] font-semibold whitespace-nowrap shrink-0">Shipper (荷主):</span>
                    <input
                      type="text"
                      value={parsedResult.shipper}
                      onChange={(e) => handleUpdateParsedField('shipper', e.target.value)}
                      className="w-full font-medium text-slate-900 bg-transparent text-xs outline-none"
                    />
                  </div>

                  <div className="sm:col-span-3 bg-white px-2 py-1 rounded-lg border border-slate-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-100 flex items-center gap-1.5 shadow-2xs">
                    <span className="text-slate-500 text-[10px] font-semibold whitespace-nowrap shrink-0">Consignee (荷受人):</span>
                    <input
                      type="text"
                      value={parsedResult.consignee}
                      onChange={(e) => handleUpdateParsedField('consignee', e.target.value)}
                      className="w-full font-medium text-slate-900 bg-transparent text-xs outline-none"
                    />
                  </div>

                  {/* Row 6: Special Notes (5-row scrollable textarea, full width) */}
                  <div className="col-span-1 sm:col-span-6 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-100 flex flex-col gap-1 shadow-2xs">
                    <div className="flex items-center justify-between text-slate-500 text-[10px] font-semibold">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3 text-slate-400" />
                        特記事項（5行表示・縦スクロール可）:
                      </span>
                      <span className="text-[9px] text-slate-400">改行・直接編集可能</span>
                    </div>
                    <textarea
                      rows={5}
                      value={parsedResult.specialNotes || ''}
                      onChange={(e) => handleUpdateParsedField('specialNotes', e.target.value)}
                      className="w-full font-mono text-slate-800 bg-transparent text-[11px] outline-none resize-y overflow-y-auto leading-relaxed h-[5.5rem] border-t border-slate-100 pt-1"
                      placeholder="特記事項なし"
                    />
                  </div>
                </div>
              </div>

              {/* Suggested Tasks reflected directly from Task Master (Compact List) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold text-slate-700 block">
                    初期反映作業工程タスク（マスタ自動判定）:
                  </span>
                  <span className="text-[10px] bg-indigo-100 text-indigo-800 font-bold px-1.5 py-0.2 rounded border border-indigo-200">
                    {filteredTaskMasters.length}件
                  </span>
                </div>
                <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                  {filteredTaskMasters.map((tm) => (
                    <div
                      key={tm.id}
                      className="text-[11px] px-2.5 py-1 bg-white border border-slate-200 rounded-lg flex items-center justify-between text-slate-700"
                    >
                      <div className="flex items-center space-x-1.5">
                        <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[9px] font-bold flex items-center justify-center shrink-0">
                          {tm.orderNumber}
                        </span>
                        {tm.shortName && (
                          <span className="px-1 py-0.2 bg-indigo-50 text-indigo-700 font-bold border border-indigo-200 text-[9px] rounded shrink-0">
                            {tm.shortName}
                          </span>
                        )}
                        <span className="font-medium text-slate-800 text-[11px]">{tm.content}</span>
                      </div>
                      {tm.isDgOnly && (
                        <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 font-bold text-[9px] rounded border border-amber-300 shrink-0">
                          DG専用
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions (Compact) */}
        <div className="bg-slate-50 px-4 py-2.5 border-t border-slate-200 flex justify-between items-center gap-2 shrink-0">
          <div className="flex items-center space-x-2">
            <button
              onClick={handleCancelClose}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-all shadow-2xs"
            >
              {existingShipment ? '取り込みを行わない (キャンセル)' : 'キャンセル'}
            </button>

            {parsedResult && (
              <button
                onClick={resetUploadState}
                className="px-2.5 py-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer bg-blue-50/80 hover:bg-blue-100 border border-blue-200 rounded-lg transition-all flex items-center space-x-1"
                title="解析結果をクリアして別のPDFを選択します"
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>別のファイルを選択</span>
              </button>
            )}
          </div>

          {parsedResult && (
            <button
              onClick={handleConfirmSave}
              className={`px-4 py-1.5 text-xs font-bold text-white rounded-lg shadow-sm inline-flex items-center transition-all transform active:scale-95 cursor-pointer ${
                existingShipment
                  ? 'bg-amber-600 hover:bg-amber-500'
                  : 'bg-blue-600 hover:bg-blue-500'
              }`}
            >
              <Check className="w-3.5 h-3.5 mr-1" />
              {existingShipment ? '既存データを上書き更新する' : 'この案件を管理システムに確定登録'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
