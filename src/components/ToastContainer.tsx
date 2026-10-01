import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ToastMessage, ToastType } from '../types';
import { subscribeToToasts, dismissToast, clearAllToasts } from '../lib/notificationService';
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Info,
  X,
  Clock,
  ExternalLink,
  Sparkles,
  Flame,
  Bell,
  Trash2,
} from 'lucide-react';

interface ToastContainerProps {
  onSelectShipment?: (shipmentId: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ onSelectShipment }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToToasts((updated) => {
      setToasts(updated);
    });
    return unsubscribe;
  }, []);

  if (toasts.length === 0) return null;

  const getToastStyles = (type: ToastType, isCutTimeAlert?: boolean) => {
    if (isCutTimeAlert) {
      if (type === 'error') {
        return {
          bg: 'bg-rose-950/95 border-rose-600/80 text-white shadow-rose-950/50',
          iconBg: 'bg-rose-600 text-white',
          icon: <AlertOctagon className="w-5 h-5 text-white animate-pulse" />,
          badgeBg: 'bg-rose-600 text-white border-rose-400 font-extrabold',
          badgeText: 'カット時間 超過アラート',
          progressBg: 'bg-rose-400',
        };
      }
      return {
        bg: 'bg-amber-950/95 border-amber-500/80 text-white shadow-amber-950/50',
        iconBg: 'bg-amber-500 text-amber-950',
        icon: <Flame className="w-5 h-5 text-amber-950 animate-bounce" />,
        badgeBg: 'bg-amber-400 text-amber-950 border-amber-300 font-extrabold',
        badgeText: 'カット時間 接近警告',
        progressBg: 'bg-amber-400',
      };
    }

    switch (type) {
      case 'success':
        return {
          bg: 'bg-slate-900/95 border-emerald-500/60 text-white shadow-slate-950/50',
          iconBg: 'bg-emerald-500 text-slate-950',
          icon: <CheckCircle2 className="w-5 h-5 text-slate-950" />,
          badgeBg: 'bg-emerald-900/60 text-emerald-300 border-emerald-600/50',
          badgeText: '登録完了',
          progressBg: 'bg-emerald-500',
        };
      case 'warning':
        return {
          bg: 'bg-slate-900/95 border-amber-500/60 text-white shadow-slate-950/50',
          iconBg: 'bg-amber-500 text-slate-950',
          icon: <AlertTriangle className="w-5 h-5 text-slate-950" />,
          badgeBg: 'bg-amber-900/60 text-amber-300 border-amber-600/50',
          badgeText: '注意・警告',
          progressBg: 'bg-amber-500',
        };
      case 'error':
        return {
          bg: 'bg-slate-900/95 border-rose-500/60 text-white shadow-slate-950/50',
          iconBg: 'bg-rose-500 text-white',
          icon: <AlertOctagon className="w-5 h-5 text-white" />,
          badgeBg: 'bg-rose-900/60 text-rose-300 border-rose-600/50',
          badgeText: '緊急アラート',
          progressBg: 'bg-rose-500',
        };
      case 'info':
      default:
        return {
          bg: 'bg-slate-900/95 border-blue-500/60 text-white shadow-slate-950/50',
          iconBg: 'bg-blue-500 text-white',
          icon: <Info className="w-5 h-5 text-white" />,
          badgeBg: 'bg-blue-900/60 text-blue-300 border-blue-600/50',
          badgeText: 'システム通知',
          progressBg: 'bg-blue-500',
        };
    }
  };

  return (
    <div
      aria-live="polite"
      className="fixed top-20 right-4 sm:right-6 z-50 flex flex-col space-y-3 max-w-sm sm:max-w-md w-full pointer-events-none"
    >
      {toasts.length > 1 && (
        <div className="flex justify-end pointer-events-auto pr-1">
          <button
            type="button"
            onClick={clearAllToasts}
            className="text-[11px] font-bold text-slate-400 hover:text-white bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 shadow-md cursor-pointer backdrop-blur-xs"
          >
            <Trash2 className="w-3 h-3" />
            <span>通知を全クリア ({toasts.length})</span>
          </button>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const style = getToastStyles(toast.type, toast.isCutTimeAlert);

          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, y: -10, transition: { duration: 0.15 } }}
              transition={{ duration: 0.2 }}
              className={`pointer-events-auto relative overflow-hidden rounded-2xl border backdrop-blur-md shadow-2xl p-4 transition-all ${style.bg}`}
            >
              {/* Header Bar: Badge & Close */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${style.iconBg}`}
                  >
                    {style.icon}
                  </div>
                  <div>
                    <div className="flex items-center space-x-1.5">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-mono ${style.badgeBg}`}
                      >
                        {style.badgeText}
                      </span>
                      {toast.cutTime && (
                        <span className="text-[11px] font-mono font-bold text-amber-300 flex items-center gap-0.5">
                          <Clock className="w-3 h-3" />
                          {toast.cutTime}
                        </span>
                      )}
                    </div>
                    <h4 className="text-sm font-bold tracking-tight text-white leading-tight mt-0.5">
                      {toast.title}
                    </h4>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                  title="閉じる"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Message Body */}
              <div className="pl-9 pr-1 space-y-1">
                <p className="text-xs font-semibold text-slate-200 leading-snug break-words">
                  {toast.message}
                </p>
                {toast.subMessage && (
                  <p className="text-[11px] text-slate-300/80 leading-relaxed font-mono">
                    {toast.subMessage}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              {(toast.actions || toast.shipmentId) && (
                <div className="mt-3 pl-9 flex flex-wrap gap-2">
                  {toast.actions?.map((act, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        act.onClick();
                      }}
                      className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                        act.primary
                          ? toast.isCutTimeAlert
                            ? 'bg-amber-400 hover:bg-amber-300 text-amber-950'
                            : 'bg-blue-600 hover:bg-blue-500 text-white'
                          : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
                      }`}
                    >
                      <span>{act.label}</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  ))}

                  {!toast.actions && toast.shipmentId && onSelectShipment && (
                    <button
                      type="button"
                      onClick={() => {
                        dismissToast(toast.id);
                        onSelectShipment(toast.shipmentId!);
                      }}
                      className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 border border-white/20"
                    >
                      <span>案件詳細を開く</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              {/* Auto-dismiss countdown bar */}
              {toast.duration && toast.duration > 0 && (
                <motion.div
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: toast.duration / 1000, ease: 'linear' }}
                  className={`absolute bottom-0 left-0 h-1 opacity-70 ${style.progressBg}`}
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
