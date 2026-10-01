import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  FileText,
  Calculator,
  Send,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  ArrowRight,
  X,
  Database,
  Plane,
  Ship,
  Layers,
} from "lucide-react";
import splashBgImage from "../assets/images/splash_ace_cargo_1787370455239.jpg";

export interface StatusCounts {
  requested: number;
  estimated: number;
  re_estimating: number;
  accepted: number;
  closed_or_on_hold?: number;
  totalActive?: number;
}

interface SplashScreenProps {
  onFinish: () => void;
  statusCounts: StatusCounts;
}

const LOADING_STEPS = [
  { progress: 15, text: "ACE 船用品エアー輸出システム起動中...", sub: "Core Engine Initializing" },
  { progress: 45, text: "Firestore クラウドリアルタイム同期接続中...", sub: "Connecting to Cloud Database" },
  { progress: 75, text: "各ステータス案件データ & 航空貨物集計中...", sub: "Loading Air Cargo & Spares Manifests" },
  { progress: 95, text: "セキュリティ & 権限プロファイル検証中...", sub: "Securing Workspace" },
  { progress: 100, text: "システム準備完了", sub: "Ready to Launch" },
];

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onFinish,
  statusCounts,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [progress, setProgress] = useState(12);

  const {
    requested = 0,
    estimated = 0,
    re_estimating = 0,
    accepted = 0,
    totalActive = requested + estimated + re_estimating + accepted,
  } = statusCounts;

  useEffect(() => {
    // Progress increment timer
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        const increment = Math.floor(Math.random() * 14) + 12;
        return Math.min(prev + increment, 100);
      });
    }, 260);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (progress < 30) {
      setCurrentStepIndex(0);
    } else if (progress < 60) {
      setCurrentStepIndex(1);
    } else if (progress < 85) {
      setCurrentStepIndex(2);
    } else if (progress < 100) {
      setCurrentStepIndex(3);
    } else {
      setCurrentStepIndex(4);
      const timer = setTimeout(() => {
        onFinish();
      }, 750);
      return () => clearTimeout(timer);
    }
  }, [progress, onFinish]);

  return (
    <div
      id="ace-splash-modal-overlay"
      className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md select-none overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 10, filter: "blur(6px)" }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative w-full max-w-4xl bg-slate-950 border border-cyan-500/40 rounded-2xl sm:rounded-3xl shadow-2xl shadow-cyan-950/90 overflow-hidden text-white flex flex-col my-auto"
      >
        {/* Background Visual Graphic with Cyber Overlays */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.img
            src={splashBgImage}
            alt="ACE Trans Air Cargo"
            referrerPolicy="no-referrer"
            initial={{ scale: 1.06 }}
            animate={{ scale: 1.0 }}
            transition={{ duration: 4, ease: "easeOut" }}
            className="w-full h-full object-cover object-center filter brightness-[0.5] contrast-[1.15]"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/85 via-slate-950/75 to-slate-950/95" />
          <div className="absolute inset-0 bg-gradient-to-r from-blue-950/70 via-transparent to-indigo-950/70" />

          {/* Futuristic Scan Line Effect */}
          <motion.div
            animate={{ y: ["-10%", "110%"] }}
            transition={{ repeat: Infinity, duration: 2.5, ease: "linear" }}
            className="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-cyan-400/20 to-transparent border-b border-cyan-400/30 blur-sm pointer-events-none"
          />

          {/* Ambient Glows */}
          <div className="absolute top-0 right-1/4 w-72 h-72 bg-cyan-500/15 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-1/4 w-72 h-72 bg-blue-600/15 rounded-full blur-3xl" />
        </div>

        {/* Modal Header */}
        <div className="relative z-10 px-5 pt-5 sm:px-8 sm:pt-7 flex items-center justify-between border-b border-cyan-500/20 pb-4">
          {/* Brand Identity */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-cyan-500/40 backdrop-blur-md shadow-md">
              <div className="w-6 h-6 rounded bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center font-black text-[11px] text-slate-950 tracking-tighter shadow">
                ACE
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-black tracking-widest text-cyan-300 font-mono leading-none">
                  ACE TRANS
                </span>
                <span className="text-[9px] text-slate-400 tracking-tight leading-none mt-0.5">
                  AIR EXPORT & VESSEL LOGISTICS
                </span>
              </div>
            </div>

            <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              SYSTEM ACTIVE
            </div>
          </div>

          {/* Header Actions: Skip and Close Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onFinish}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white text-xs font-medium backdrop-blur-md transition-all cursor-pointer shadow-sm"
              title="スプラッシュを閉じてメイン画面へ"
            >
              <span>スキップ</span>
              <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
            </button>
            <button
              type="button"
              onClick={onFinish}
              className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="閉じる"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body: Main Title & Status Counts Grid */}
        <div className="relative z-10 px-5 py-6 sm:px-8 sm:py-7 flex flex-col items-center">
          {/* Main Title Heading */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-400/30 text-cyan-300 text-[11px] font-semibold tracking-wider uppercase mb-2.5">
              <Sparkles className="w-3 h-3 text-cyan-400 animate-spin" style={{ animationDuration: "6s" }} />
              AIR EXPORT STATUS DASHBOARD
            </div>

            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white leading-tight">
              <span className="bg-gradient-to-r from-white via-cyan-100 to-sky-300 bg-clip-text text-transparent">
                ACE船用品エアー輸出
              </span>
              <span className="bg-gradient-to-r from-cyan-300 via-blue-400 to-indigo-300 bg-clip-text text-transparent ml-2">
                見積管理・共有ボード
              </span>
            </h2>

            <p className="text-xs sm:text-sm text-slate-300 mt-1.5 flex items-center justify-center gap-2">
              <span>進行中案件の最新ステータス件数</span>
              <span className="text-slate-500">•</span>
              <span className="text-cyan-300 font-mono font-medium">合計: {totalActive} 件</span>
            </p>
          </div>

          {/* 4 Status State Count Cards: 見積依頼, 見積済み, 見積連絡済, 受託 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full">
            {/* 1. 見積依頼 (requested) */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="relative overflow-hidden rounded-xl bg-slate-900/85 border border-sky-500/40 p-3.5 sm:p-4 backdrop-blur-md shadow-lg shadow-sky-950/40 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-300">
                  <FileText className="w-3.5 h-3.5 text-sky-400" />
                  見積依頼
                </span>
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-500/30">
                  STEP 1
                </span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight">
                  {requested}
                </span>
                <span className="text-xs text-slate-400 font-medium">件</span>
              </div>
              <div className="mt-2.5 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-400 rounded-full"
                  style={{
                    width: totalActive > 0 ? `${Math.max((requested / totalActive) * 100, 10)}%` : "20%",
                  }}
                />
              </div>
            </motion.div>

            {/* 2. 見積済み (estimated) */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.18 }}
              className="relative overflow-hidden rounded-xl bg-slate-900/85 border border-indigo-500/40 p-3.5 sm:p-4 backdrop-blur-md shadow-lg shadow-indigo-950/40 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-300">
                  <Calculator className="w-3.5 h-3.5 text-indigo-400" />
                  見積済み
                </span>
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-500/30">
                  STEP 2
                </span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight">
                  {estimated}
                </span>
                <span className="text-xs text-slate-400 font-medium">件</span>
              </div>
              <div className="mt-2.5 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-400 rounded-full"
                  style={{
                    width: totalActive > 0 ? `${Math.max((estimated / totalActive) * 100, 10)}%` : "20%",
                  }}
                />
              </div>
            </motion.div>

            {/* 3. 見積連絡済 (re_estimating) */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.26 }}
              className="relative overflow-hidden rounded-xl bg-slate-900/85 border border-amber-500/40 p-3.5 sm:p-4 backdrop-blur-md shadow-lg shadow-amber-950/40 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300">
                  <Send className="w-3.5 h-3.5 text-amber-400" />
                  見積連絡済
                </span>
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/30">
                  STEP 3
                </span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight">
                  {re_estimating}
                </span>
                <span className="text-xs text-slate-400 font-medium">件</span>
              </div>
              <div className="mt-2.5 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full"
                  style={{
                    width: totalActive > 0 ? `${Math.max((re_estimating / totalActive) * 100, 10)}%` : "20%",
                  }}
                />
              </div>
            </motion.div>

            {/* 4. 受託 (accepted) */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.34 }}
              className="relative overflow-hidden rounded-xl bg-slate-900/85 border border-emerald-500/40 p-3.5 sm:p-4 backdrop-blur-md shadow-lg shadow-emerald-950/40 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  受託
                </span>
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
                  STEP 4
                </span>
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight">
                  {accepted}
                </span>
                <span className="text-xs text-slate-400 font-medium">件</span>
              </div>
              <div className="mt-2.5 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full"
                  style={{
                    width: totalActive > 0 ? `${Math.max((accepted / totalActive) * 100, 10)}%` : "20%",
                  }}
                />
              </div>
            </motion.div>
          </div>

          {/* Sub-info summary bar */}
          <div className="mt-4 flex flex-wrap items-center justify-between w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-300 font-mono gap-2">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-cyan-400">
                <Plane className="w-3 h-3" />
                エアー輸出
              </span>
              <span className="text-slate-600">•</span>
              <span className="flex items-center gap-1 text-blue-400">
                <Ship className="w-3 h-3" />
                船用品スペアパーツ輸送
              </span>
            </div>
            <div className="flex items-center gap-1 text-slate-400">
              <Layers className="w-3 h-3 text-cyan-400" />
              <span>TAC LOGISTICS NETWORK</span>
            </div>
          </div>
        </div>

        {/* Modal Footer: High-tech Progress Bar & Loading Status */}
        <div className="relative z-10 px-5 pb-5 pt-1 sm:px-8 sm:pb-7 border-t border-cyan-500/20">
          <div className="w-full flex items-center justify-between text-xs mb-2 font-mono">
            <div className="flex items-center gap-2 text-cyan-300">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
              >
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
              </motion.div>
              <span className="font-semibold text-white truncate max-w-[240px] sm:max-w-none">
                {LOADING_STEPS[currentStepIndex].text}
              </span>
            </div>
            <span className="text-cyan-400 font-bold tracking-wider">
              {progress}%
            </span>
          </div>

          {/* Progress Neon Bar with Light Sweep Effect */}
          <div className="relative w-full h-2.5 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-700/80 shadow-inner">
            <motion.div
              className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 rounded-full relative"
              style={{ width: `${progress}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            >
              <motion.div
                animate={{ x: ["-100%", "200%"] }}
                transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
                className="absolute inset-0 w-20 bg-gradient-to-r from-transparent via-white/60 to-transparent skew-x-12"
              />
            </motion.div>
          </div>

          <div className="w-full flex items-center justify-between text-[11px] text-slate-400 mt-2 font-mono">
            <span className="flex items-center gap-1.5 text-slate-400">
              <Database className="w-3 h-3 text-cyan-400" />
              {LOADING_STEPS[currentStepIndex].sub}
            </span>
            <span className="text-[10px] text-slate-500">
              CLICK OUTSIDE OR 'SKIP' TO OPEN
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
