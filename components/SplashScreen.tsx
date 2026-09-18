import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Activity,
  Layers,
  ListChecks,
  Flame,
  ArrowRight,
  Sparkles,
  X,
  Plane,
  Truck,
  Box,
  Globe,
  Radio,
  Timer,
  Play,
  Check,
} from 'lucide-react';
import { Shipment, Task } from '../types';

interface SplashScreenProps {
  onComplete: () => void;
  shipments?: Shipment[];
  minDuration?: number; // 最小表示時間 (ms)
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

const LOADING_STEPS = [
  { percent: 20, text: 'システムカーネル・セキュリティ初期化中...' },
  { percent: 45, text: '本日通関タスク & カット時間監視エンジン接続...' },
  { percent: 75, text: 'AI自動解析モジュール (Gemini) 待機完了...' },
  { percent: 100, text: 'システム準備完了！今日も一日よろしくお願いします。' },
];

function normalizeDateStr(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/\//g, '-').trim();
  const parts = cleaned.split('-');
  if (parts.length === 3) {
    const year = parts[0].padStart(4, '20');
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onComplete,
  shipments = [],
  minDuration = 2800,
}) => {
  const [progress, setProgress] = useState(0);
  const [currentStepText, setCurrentStepText] = useState(LOADING_STEPS[0].text);
  const [isClosing, setIsClosing] = useState(false);
  const [currentTimeStr, setCurrentTimeStr] = useState('');

  // Current Date & Time
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const dayName = WEEKDAYS_JA[now.getDay()];
  const todayKey = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;

  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setCurrentTimeStr(
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Today's customs clearance statistics calculation
  const stats = useMemo(() => {
    const todayShipments = shipments.filter(
      (s) => normalizeDateStr(s.customsClearanceDate) === todayKey
    );

    const allTodayTasks: Task[] = [];
    todayShipments.forEach((s) => {
      if (s.tasks && s.tasks.length > 0) {
        allTodayTasks.push(...s.tasks);
      }
    });

    const totalTasks = allTodayTasks.length;
    const completedTasks = allTodayTasks.filter((t) => t.status === 'Completed').length;
    const inProgressTasks = allTodayTasks.filter((t) => t.status === 'In Progress').length;
    const notStartedTasks = allTodayTasks.filter(
      (t) => t.status === 'Todo' || !t.status
    ).length;
    const uncompletedTasks = totalTasks - completedTasks;

    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return {
      todayShipmentsCount: todayShipments.length,
      totalTasks,
      uncompletedTasks,
      notStartedTasks,
      inProgressTasks,
      completedTasks,
      completionRate,
    };
  }, [shipments, todayKey]);

  // Loading animation simulation
  useEffect(() => {
    const startTime = Date.now();
    const duration = minDuration;

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const calculated = Math.min(100, Math.floor((elapsed / duration) * 100));

      setProgress(calculated);

      const matched = LOADING_STEPS.slice()
        .reverse()
        .find((s) => calculated >= s.percent);
      if (matched) {
        setCurrentStepText(matched.text);
      }

      if (elapsed >= duration) {
        clearInterval(interval);
        setProgress(100);
        // Automatically close shortly after reaching 100% if user doesn't interact
        setTimeout(() => {
          handleClose();
        }, 1200);
      }
    }, 35);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        clearInterval(interval);
        setProgress(100);
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [minDuration]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onComplete();
    }, 300);
  };

  return (
    <AnimatePresence>
      {!isClosing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-md overflow-y-auto">
          {/* Backdrop Click Close */}
          <div className="fixed inset-0 -z-10" onClick={handleClose} />

          {/* Modal Dialog Card */}
          <motion.div
            key="splash-popup-card"
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15, transition: { duration: 0.25 } }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-2xl bg-gradient-to-b from-[#1b2631] via-[#141d27] to-[#0c1219] border border-slate-700/80 rounded-3xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] text-white overflow-hidden my-auto select-none"
          >
            {/* Ambient Background Glows */}
            <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-red-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Subtle Grid Pattern Overlay */}
            <div
              className="absolute inset-0 opacity-[0.035] pointer-events-none"
              style={{
                backgroundImage: `linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)`,
                backgroundSize: '32px 32px',
              }}
            />

            {/* Top Modal Header */}
            <div className="relative px-6 pt-5 pb-3 flex items-center justify-between border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-xs">
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-1.5">
                  <span className="text-xl font-black tracking-tight text-white font-sans">
                    hellmann
                  </span>
                  <div className="w-5 h-5 rounded-full border border-white/80 flex items-center justify-center shrink-0">
                    <svg className="w-3 h-3 text-white fill-current" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5c-2.48 0-4.5-2.02-4.5-4.5S10.52 7.5 13 7.5c1.47 0 2.78.71 3.6 1.8l-1.42 1.42c-.52-.64-1.32-1.05-2.18-1.05-1.57 0-2.83 1.26-2.83 2.83s1.26 2.83 2.83 2.83c1.07 0 1.99-.6 2.47-1.47h-2.47v-1.92h4.5v4.54c-.95 1.25-2.43 2.02-4.08 2.02z" />
                    </svg>
                  </div>
                </div>
                <div className="h-4 w-px bg-slate-700" />
                <span className="text-[11px] font-mono tracking-widest text-slate-400 font-bold uppercase">
                  WORLDWIDE LOGISTICS
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="text-xs text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 px-3 py-1 rounded-full transition-all flex items-center space-x-1 cursor-pointer"
                >
                  <span>スキップ</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition-colors cursor-pointer"
                  title="閉じる (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              {/* Brand Centerpiece & Dynamic Artwork */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/60 border border-slate-800/90 rounded-2xl p-4 relative overflow-hidden">
                {/* Visual Graphics: Globe, Arrow, Icons */}
                <div className="relative w-36 h-28 sm:w-40 sm:h-32 shrink-0 flex items-center justify-center">
                  {/* Rotating Globe Wireframe */}
                  <svg className="absolute inset-0 w-full h-full text-slate-600/50" viewBox="0 0 160 160">
                    <circle cx="80" cy="80" r="60" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" />
                    <ellipse cx="80" cy="80" rx="60" ry="24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
                    <ellipse cx="80" cy="80" rx="28" ry="60" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
                    <line x1="20" y1="80" x2="140" y2="80" stroke="currentColor" strokeWidth="1" opacity="0.6" />
                  </svg>

                  {/* Ocean Freight Container */}
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="absolute top-2 left-1 bg-[#17253b] border border-blue-400/80 p-1 rounded shadow-md w-14 h-9 flex flex-col justify-between"
                  >
                    <div className="flex justify-around items-center h-full px-0.5">
                      <div className="w-0.5 h-full bg-blue-300/80" />
                      <div className="w-0.5 h-full bg-blue-300/80" />
                      <div className="w-0.5 h-full bg-blue-300/80" />
                      <div className="w-0.5 h-full bg-blue-300/80" />
                    </div>
                  </motion.div>

                  {/* Air Freight Plane */}
                  <motion.div
                    animate={{ y: [0, -3, 0], rotate: [18, 22, 18] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute top-1 right-2 text-white drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]"
                  >
                    <Plane className="w-8 h-8 fill-white/20 stroke-white" />
                  </motion.div>

                  {/* Land Truck */}
                  <div className="absolute bottom-2 right-3 flex flex-col items-center">
                    <div className="bg-[#1e293b] border border-white/80 rounded p-0.5 w-12 h-6 flex items-center justify-center relative shadow-sm">
                      <div
                        className="absolute inset-y-0 left-0 w-5 bg-red-600/80 rounded-l-xs"
                        style={{ clipPath: 'polygon(0 0, 100% 0, 40% 100%, 0% 100%)' }}
                      />
                      <Truck className="w-4 h-4 text-white z-10" />
                    </div>
                  </div>

                  {/* Dynamic Blue-to-Red Bent Flow Arrow */}
                  <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 160 160">
                    <defs>
                      <linearGradient id="popArrowGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#2563eb" />
                        <stop offset="60%" stopColor="#38bdf8" />
                        <stop offset="85%" stopColor="#ef4444" />
                        <stop offset="100%" stopColor="#dc2626" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M 35 110 L 62 76 Q 72 65 85 65 L 125 65"
                      fill="none"
                      stroke="url(#popArrowGrad)"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <polygon points="120,55 140,65 120,75" fill="#dc2626" stroke="#ffffff" strokeWidth="1" />
                  </svg>
                </div>

                {/* System Title & TAC Metallic Logo */}
                <div className="flex-1 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start space-x-2">
                    <div className="text-2xl font-black tracking-tighter text-blue-500 font-sans drop-shadow-[0_2px_8px_rgba(37,99,235,0.6)]">
                      T<span className="relative inline-block text-blue-500">A<span className="absolute inset-x-0 bottom-0 text-red-500 font-bold text-xs text-center">▲</span></span>C
                    </div>
                    <span className="text-xs bg-blue-900/60 text-blue-300 border border-blue-700/60 px-2 py-0.5 rounded-full font-mono font-bold">
                      Enterprise v2.5
                    </span>
                  </div>

                  <h1 className="text-xl sm:text-2xl font-extrabold tracking-wide text-white mt-1 leading-tight">
                    <span>ヘルマン</span>
                    <span className="text-[#38bdf8] drop-shadow-[0_0_10px_rgba(56,189,248,0.7)] ml-1">
                      輸出進捗管理
                    </span>
                    <span className="block sm:inline sm:ml-1">システム</span>
                  </h1>

                  <p className="text-xs text-slate-400 mt-1">
                    本日通関案件の全自動ステータス監視 & AIタスク同期エンジン
                  </p>
                </div>
              </div>

              {/* Big Today's Date Banner */}
              <div className="bg-gradient-to-r from-blue-950/80 via-slate-900/90 to-slate-950/80 border border-blue-500/40 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-full bg-blue-500/5 blur-xl pointer-events-none" />

                <div className="flex items-center space-x-3 text-center sm:text-left">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-400/50 flex flex-col items-center justify-center text-blue-400 shadow-inner shrink-0">
                    <Calendar className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-[11px] font-mono text-blue-300 uppercase tracking-wider flex items-center gap-1.5 justify-center sm:justify-start">
                      <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                      <span>TODAY'S CUSTOMS DATE</span>
                    </div>
                    <div className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-baseline gap-2 justify-center sm:justify-start mt-0.5">
                      <span>{year}年 {month}月 {date}日</span>
                      <span className="text-base font-bold text-amber-400">({dayName})</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 bg-slate-950/70 border border-slate-800 px-3.5 py-2 rounded-xl text-right">
                  <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <div className="text-[10px] text-slate-400 font-mono leading-none">現在時刻 (JST)</div>
                    <div className="text-sm font-mono font-bold text-slate-200 mt-0.5">
                      {currentTimeStr || '--:--:--'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Grid: Today's Customs Clearance Tasks */}
              <div>
                <div className="flex items-center justify-between mb-2.5 px-1">
                  <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <span>本日通関予定タスクの進行状況</span>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700">
                      案件数: {stats.todayShipmentsCount}件
                    </span>
                  </div>

                  {stats.totalTasks > 0 && (
                    <div className="text-xs font-mono font-bold text-emerald-400 flex items-center gap-1">
                      <span>完了率: {stats.completionRate}%</span>
                    </div>
                  )}
                </div>

                {/* 5 Status Cards Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {/* 1. Total Tasks (全件数) */}
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    className="bg-slate-900/80 border border-slate-700/80 rounded-2xl p-3 flex flex-col justify-between shadow-sm relative overflow-hidden"
                  >
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="text-[11px] font-bold">全件数</span>
                      <ListChecks className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="text-2xl font-black text-white font-mono">
                        {stats.totalTasks}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">件</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1 rounded-full mt-2 overflow-hidden">
                      <div className="bg-blue-500 h-full w-full" />
                    </div>
                  </motion.div>

                  {/* 2. Uncompleted (未完了) */}
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    className={`border rounded-2xl p-3 flex flex-col justify-between shadow-sm relative overflow-hidden ${
                      stats.uncompletedTasks > 0
                        ? 'bg-amber-950/40 border-amber-500/60 shadow-amber-950/30'
                        : 'bg-slate-900/80 border-slate-700/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] font-bold ${stats.uncompletedTasks > 0 ? 'text-amber-300' : 'text-slate-400'}`}>
                        未完了
                      </span>
                      <Flame className={`w-4 h-4 ${stats.uncompletedTasks > 0 ? 'text-amber-400 animate-pulse' : 'text-slate-500'}`} />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className={`text-2xl font-black font-mono ${stats.uncompletedTasks > 0 ? 'text-amber-300' : 'text-slate-400'}`}>
                        {stats.uncompletedTasks}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">件</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1 rounded-full mt-2 overflow-hidden">
                      <div
                        className="bg-amber-400 h-full transition-all"
                        style={{
                          width: stats.totalTasks > 0 ? `${(stats.uncompletedTasks / stats.totalTasks) * 100}%` : '0%',
                        }}
                      />
                    </div>
                  </motion.div>

                  {/* 3. Not Started (未着手) */}
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    className="bg-slate-900/80 border border-slate-700/80 rounded-2xl p-3 flex flex-col justify-between shadow-sm relative overflow-hidden"
                  >
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="text-[11px] font-bold">未着手</span>
                      <AlertCircle className="w-4 h-4 text-slate-400" />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="text-2xl font-black text-slate-300 font-mono">
                        {stats.notStartedTasks}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">件</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1 rounded-full mt-2 overflow-hidden">
                      <div
                        className="bg-slate-400 h-full transition-all"
                        style={{
                          width: stats.totalTasks > 0 ? `${(stats.notStartedTasks / stats.totalTasks) * 100}%` : '0%',
                        }}
                      />
                    </div>
                  </motion.div>

                  {/* 4. In Progress (進行中) */}
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    className={`border rounded-2xl p-3 flex flex-col justify-between shadow-sm relative overflow-hidden ${
                      stats.inProgressTasks > 0
                        ? 'bg-blue-950/50 border-cyan-500/60 shadow-cyan-950/30'
                        : 'bg-slate-900/80 border-slate-700/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] font-bold ${stats.inProgressTasks > 0 ? 'text-cyan-300' : 'text-slate-400'}`}>
                        進行中
                      </span>
                      <Activity className={`w-4 h-4 ${stats.inProgressTasks > 0 ? 'text-cyan-400 animate-spin' : 'text-slate-500'}`} />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className={`text-2xl font-black font-mono ${stats.inProgressTasks > 0 ? 'text-cyan-300' : 'text-slate-400'}`}>
                        {stats.inProgressTasks}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">件</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1 rounded-full mt-2 overflow-hidden">
                      <div
                        className="bg-cyan-400 h-full transition-all"
                        style={{
                          width: stats.totalTasks > 0 ? `${(stats.inProgressTasks / stats.totalTasks) * 100}%` : '0%',
                        }}
                      />
                    </div>
                  </motion.div>

                  {/* 5. Completed (完了) */}
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    className="col-span-2 sm:col-span-1 bg-slate-900/80 border border-emerald-500/50 rounded-2xl p-3 flex flex-col justify-between shadow-sm relative overflow-hidden"
                  >
                    <div className="flex items-center justify-between text-emerald-400">
                      <span className="text-[11px] font-bold">完了</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="text-2xl font-black text-emerald-400 font-mono">
                        {stats.completedTasks}
                      </span>
                      <span className="text-[10px] text-emerald-400/80 font-mono">件</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1 rounded-full mt-2 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full transition-all"
                        style={{
                          width: stats.totalTasks > 0 ? `${(stats.completedTasks / stats.totalTasks) * 100}%` : '0%',
                        }}
                      />
                    </div>
                  </motion.div>
                </div>

                {stats.totalTasks === 0 && (
                  <div className="mt-2 text-center text-xs text-slate-400 bg-slate-900/40 rounded-xl py-1.5 border border-slate-800/60 font-mono">
                    ※ 本日が通関予定日となっている登録タスクはありません（全件順調です）
                  </div>
                )}
              </div>

              {/* Progress Bar & Dynamic Status Log */}
              <div className="space-y-2 pt-1">
                {/* Progress Capsule */}
                <div className="w-full h-3.5 bg-slate-950 border border-slate-700/90 rounded-full p-0.5 overflow-hidden shadow-inner">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 via-cyan-400 to-red-500 relative"
                    style={{ width: `${progress}%` }}
                    transition={{ ease: 'linear' }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-pulse" />
                  </motion.div>
                </div>

                {/* Log Line and Percent */}
                <div className="flex items-center justify-between text-xs font-mono">
                  <div className="text-slate-300 flex items-center gap-1.5 truncate pr-2">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
                    <span className="truncate">{currentStepText}</span>
                  </div>
                  <span className="text-cyan-400 font-bold tracking-wider shrink-0 font-mono">
                    {progress}%
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 bg-slate-950/80 border-t border-slate-800/90 flex items-center justify-between">
              <div className="text-[11px] text-slate-500 font-mono">
                Press <kbd className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700 text-[10px]">Esc</kbd> or <kbd className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700 text-[10px]">Enter</kbd> to enter
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 shadow-md shadow-blue-900/30 transition-all flex items-center space-x-1.5 active:scale-95 cursor-pointer"
              >
                <span>業務ダッシュボードを開く</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
