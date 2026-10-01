import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import {
  X,
  Calendar,
  Play,
  FileArchive,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Copy,
  Check,
  FileText,
  FileSearch,
  Receipt,
  Download,
  FolderArchive,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Cpu,
  ShieldCheck,
  Zap,
  FolderCheck,
} from 'lucide-react';

interface EdXraySubmitModalProps {
  initialDate: string; // YYYY-MM-DD
  onClose: () => void;
}

export const EdXraySubmitModal: React.FC<EdXraySubmitModalProps> = ({
  initialDate,
  onClose,
}) => {
  const [targetDate, setTargetDate] = useState<string>(initialDate || new Date().toISOString().split('T')[0]);
  const [isCopied, setIsCopied] = useState(false);
  const [showCompletionAlert, setShowCompletionAlert] = useState(false);
  const [execStep, setExecStep] = useState<number>(0);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const okButtonRef = useRef<HTMLButtonElement>(null);

  // Convert YYYY-MM-DD to YYYYMMDD
  const formattedYmd = targetDate.replace(/-/g, '');

  // Power Automate Desktop flow configuration
  const flowName = '3SET-COPY-TOHELLMANN';
  const inputArguments = JSON.stringify({ TargetDate: formattedYmd });
  const padUrl = `ms-powerautomate:/console/flow/run?workflowName=${encodeURIComponent(flowName)}&inputArguments=${encodeURIComponent(inputArguments)}`;

  // Animated execution simulation steps
  useEffect(() => {
    if (!showCompletionAlert) {
      setExecStep(0);
      setProgressPercent(0);
      return;
    }

    // Step 1: Initializing & scanning files (0% - 25%)
    setExecStep(1);
    setProgressPercent(15);

    const timer1 = setTimeout(() => {
      // Step 2: Collecting 3 files (25% - 65%)
      setExecStep(2);
      setProgressPercent(55);
    }, 600);

    const timer2 = setTimeout(() => {
      // Step 3: Compressing into vessel named archive (65% - 90%)
      setExecStep(3);
      setProgressPercent(88);
    }, 1400);

    const timer3 = setTimeout(() => {
      // Step 4: Completed (100%) & Confetti
      setExecStep(4);
      setProgressPercent(100);

      // Trigger colorful festive celebration confetti
      try {
        confetti({
          particleCount: 50,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#3B82F6', '#10B981', '#F59E0B', '#6366F1', '#EC4899'],
        });
      } catch (e) {
        // ignore
      }

      // Auto-focus OK button
      setTimeout(() => {
        okButtonRef.current?.focus();
      }, 100);
    }, 2200);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [showCompletionAlert]);

  const handleExecute = () => {
    // Trigger Power Automate Desktop URL scheme
    try {
      window.location.href = padUrl;
    } catch (e) {
      console.error('PAD flow trigger error:', e);
    }

    // Show dynamic animated modal
    setShowCompletionAlert(true);
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(padUrl);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Simulated output archive name
  const sampleArchiveName = `${formattedYmd}_HELLMANN_EXPORT_3SET.zip`;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden text-slate-800 relative"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-700 via-blue-700 to-indigo-800 text-white px-5 py-4 flex items-center justify-between shadow-xs">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center border border-white/20 shadow-2xs">
                <FileArchive className="w-4.5 h-4.5 text-indigo-100" />
              </div>
              <div>
                <h3 className="font-bold text-sm tracking-tight text-white">ED/XRAY/請求書 提出用ファイルの圧縮ファイル生成</h3>
                <p className="text-[10.5px] text-indigo-100/90 font-medium">Power Automate Desktop (PAD) 連携フロー</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            {/* Description Box with Visual 3-File Badge */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50/60 border border-blue-200/80 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-start space-x-2.5">
                <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs shadow-2xs">
                  i
                </div>
                <p className="text-xs text-slate-700 font-medium leading-relaxed">
                  該当通関日の<strong className="text-blue-800 font-bold">許可書(ED)</strong>、<strong className="text-amber-800 font-bold">X-RAY結果</strong>、<strong className="text-emerald-800 font-bold">請求書</strong>の３つのファイルを自動収集し、本船名フォルダで圧縮してダウンロードフォルダへ出力します。
                </p>
              </div>

              {/* 3 Target Files Indicator Pills */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="bg-white/90 border border-blue-200 rounded-lg p-2 flex items-center space-x-2 shadow-2xs">
                  <FileSearch className="w-4 h-4 text-blue-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold text-slate-700 truncate">① 輸出許可書</div>
                    <div className="text-[9px] text-slate-400 font-mono truncate">ED PDF</div>
                  </div>
                </div>
                <div className="bg-white/90 border border-amber-200 rounded-lg p-2 flex items-center space-x-2 shadow-2xs">
                  <FileText className="w-4 h-4 text-amber-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold text-slate-700 truncate">② X-RAY結果</div>
                    <div className="text-[9px] text-slate-400 font-mono truncate">検査PDF</div>
                  </div>
                </div>
                <div className="bg-white/90 border border-emerald-200 rounded-lg p-2 flex items-center space-x-2 shadow-2xs">
                  <Receipt className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold text-slate-700 truncate">③ 請求書</div>
                    <div className="text-[9px] text-slate-400 font-mono truncate">Invoice PDF</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Target Date Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                <span>対象通関日 (TargetDate)</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all cursor-pointer shadow-2xs font-mono"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                <span>PAD引数形式 (yyyymmdd):</span>
                <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {formattedYmd}
                </span>
              </div>
            </div>

            {/* PAD Flow Details Preview (Full URI display) */}
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 space-y-2 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                  <span>起動フロー名:</span>
                </span>
                <span className="font-mono font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {flowName}
                </span>
              </div>
              <div className="space-y-1 pt-1 border-t border-slate-200/80">
                <div className="text-slate-500 font-medium flex items-center justify-between">
                  <span>起動スキーム (URL):</span>
                  <span className="text-[10px] text-slate-400 font-mono">ms-powerautomate</span>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200 font-mono text-[10.5px] text-slate-700 break-all select-all leading-relaxed max-h-20 overflow-y-auto">
                  {padUrl}
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="bg-slate-50 border-t border-slate-200 px-5 py-3.5 flex items-center justify-between">
            <button
              type="button"
              onClick={handleCopyUrl}
              className="text-[11px] text-slate-500 hover:text-slate-700 font-medium inline-flex items-center space-x-1 cursor-pointer transition-colors"
              title="PAD起動URLをクリップボードにコピー"
            >
              {isCopied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span className="text-emerald-600 font-bold">コピー完了</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>URLコピー</span>
                </>
              )}
            </button>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 shadow-2xs transition-colors cursor-pointer"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={handleExecute}
                disabled={!targetDate}
                className="px-5 py-2 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 group"
              >
                <Play className="w-3.5 h-3.5 fill-current text-blue-200 group-hover:text-white transition-colors" />
                <span>実行 (PAD起動)</span>
              </button>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* Post-execution Dynamic Interactive & Animated Compression Dialog Modal   */}
          {/* ========================================================================= */}
          {showCompletionAlert && (
            <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 z-30 animate-in fade-in duration-200">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 15 }}
                className="bg-white rounded-2xl p-5 shadow-2xl border border-slate-200 max-w-sm w-full text-center space-y-4 overflow-hidden relative"
              >
                {/* Background decorative soft glow */}
                <div className="absolute -top-12 -left-12 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
                <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

                {/* Top Status & Animation Hub */}
                <div className="relative pt-1">
                  {/* Dynamic 3-File to ZIP Converging Visual Animation */}
                  <div className="h-24 flex items-center justify-center relative">
                    {execStep < 4 ? (
                      <div className="relative w-full flex items-center justify-center">
                        {/* Orbiting / Inflowing file nodes */}
                        <motion.div
                          animate={{
                            x: [-35, -12, -35],
                            y: [-10, 0, -10],
                            rotate: [-8, 0, -8],
                            scale: [1, 0.85, 1],
                          }}
                          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
                          className="absolute -left-1 w-9 h-9 rounded-xl bg-blue-100 border border-blue-300 text-blue-700 flex items-center justify-center shadow-md z-10"
                        >
                          <FileSearch className="w-5 h-5" />
                        </motion.div>

                        <motion.div
                          animate={{
                            y: [-25, -5, -25],
                            scale: [1, 0.85, 1],
                          }}
                          transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut', delay: 0.2 }}
                          className="absolute -top-4 w-9 h-9 rounded-xl bg-amber-100 border border-amber-300 text-amber-700 flex items-center justify-center shadow-md z-10"
                        >
                          <FileText className="w-5 h-5" />
                        </motion.div>

                        <motion.div
                          animate={{
                            x: [35, 12, 35],
                            y: [-10, 0, -10],
                            rotate: [8, 0, 8],
                            scale: [1, 0.85, 1],
                          }}
                          transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut', delay: 0.4 }}
                          className="absolute -right-1 w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-300 text-emerald-700 flex items-center justify-center shadow-md z-10"
                        >
                          <Receipt className="w-5 h-5" />
                        </motion.div>

                        {/* Central Target ZIP Archive Machine */}
                        <motion.div
                          animate={{
                            scale: [1, 1.08, 1],
                            rotate: [0, 2, -2, 0],
                          }}
                          transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                          className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-indigo-700 text-white flex flex-col items-center justify-center shadow-xl shadow-indigo-500/30 border-2 border-white relative z-20"
                        >
                          <FileArchive className="w-7 h-7 animate-pulse text-indigo-100" />
                          <span className="text-[8.5px] font-mono font-black tracking-wider text-indigo-200 mt-0.5">ZIP</span>
                        </motion.div>
                      </div>
                    ) : (
                      /* Step 4: Completed Icon with Sparkle */
                      <motion.div
                        initial={{ scale: 0.5, rotate: -20 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', damping: 12, stiffness: 200 }}
                        className="relative"
                      >
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-600 text-white flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/30 border-2 border-white">
                          <CheckCircle2 className="w-9 h-9 text-white" />
                        </div>
                        <motion.div
                          animate={{ scale: [1, 1.25, 1], rotate: [0, 15, -15, 0] }}
                          transition={{ repeat: Infinity, duration: 2 }}
                          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-amber-400 text-amber-950 flex items-center justify-center shadow-md font-bold text-xs"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </motion.div>
                      </motion.div>
                    )}
                  </div>
                </div>

                {/* Dynamic Status Text & Stage Indicators */}
                <div className="space-y-2">
                  <div className="flex items-center justify-center space-x-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    <h4 className="font-extrabold text-sm text-slate-800">
                      {execStep === 1 && '対象日の通関ファイルを検索中...'}
                      {execStep === 2 && 'ED許可書・X線・請求書を集約中...'}
                      {execStep === 3 && 'ZIP圧縮ファイルを生成中...'}
                      {execStep >= 4 && '圧縮処理を開始しました！'}
                    </h4>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1">
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200 p-0.5">
                      <motion.div
                        className="bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-0.5">
                      <span>PAD Flow: {flowName}</span>
                      <span className="font-bold text-blue-600">{progressPercent}%</span>
                    </div>
                  </div>

                  {/* Output destination hint with badge */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-left space-y-1">
                    <div className="flex items-center space-x-1.5 text-[11px] font-bold text-slate-700">
                      <FolderCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>出力先フォルダ:</span>
                    </div>
                    <div className="text-[10.5px] text-slate-600 leading-tight pl-5 font-mono truncate">
                      📁 ダウンロード (Downloads)
                    </div>
                    <p className="text-[10.5px] text-slate-500 leading-tight pl-5 pt-0.5">
                      圧縮処理後にダウンロードフォルダを確認して下さい
                    </p>
                  </div>
                </div>

                {/* Confirmation Button */}
                <div className="pt-1">
                  <button
                    ref={okButtonRef}
                    autoFocus
                    type="button"
                    onClick={() => {
                      setShowCompletionAlert(false);
                      onClose();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                        e.preventDefault();
                        setShowCompletionAlert(false);
                        onClose();
                      }
                    }}
                    className={`w-full py-2.5 font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center justify-center space-x-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 active:scale-98 ${
                      execStep >= 4
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-500/20'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    <span>OK (ダウンロードフォルダを確認)</span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
