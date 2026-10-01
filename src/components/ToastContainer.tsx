import React, { useEffect, useState } from "react";
import { ToastMessage, toastNotifier } from "../lib/toastNotifier";
import { Bell, CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const unsubscribe = toastNotifier.subscribe((updatedToasts) => {
      setToasts(updatedToasts);
    });
    return () => unsubscribe();
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[99999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-2 sm:px-0">
      {toasts.map((toast) => {
        let icon = <Info className="w-5 h-5 text-sky-400 shrink-0" />;
        let borderClass = "border-sky-500/50 bg-slate-900/95 text-slate-100";
        let titleClass = "text-sky-300";

        if (toast.type === "mention") {
          icon = <Bell className="w-5 h-5 text-amber-400 shrink-0 animate-bounce" />;
          borderClass = "border-amber-500 bg-slate-950/95 text-slate-100 shadow-amber-500/20";
          titleClass = "text-amber-300";
        } else if (toast.type === "success") {
          icon = <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />;
          borderClass = "border-emerald-500/60 bg-slate-900/95 text-slate-100";
          titleClass = "text-emerald-300";
        } else if (toast.type === "warning") {
          icon = <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />;
          borderClass = "border-amber-500/60 bg-slate-900/95 text-slate-100";
          titleClass = "text-amber-300";
        } else if (toast.type === "error") {
          icon = <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />;
          borderClass = "border-rose-500/60 bg-slate-900/95 text-slate-100";
          titleClass = "text-rose-300";
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-top-2 fade-in duration-200 ${borderClass}`}
          >
            <div className="mt-0.5">{icon}</div>
            <div className="flex-1 min-w-0">
              <h4 className={`text-xs font-black leading-tight ${titleClass}`}>{toast.title}</h4>
              <p className="text-[11px] text-slate-200 mt-1 whitespace-pre-wrap leading-relaxed break-words">
                {toast.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => toastNotifier.remove(toast.id)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
