import React, { useState } from "react";
import { X, Download, Upload, CheckCircle2, AlertTriangle, FileJson, Activity } from "lucide-react";
import { BackupData, QuotationItem, QuoteMessage, StaffMember } from "../types";

interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  quotes: QuotationItem[];
  messages: QuoteMessage[];
  staffMembers?: StaffMember[];
  onRestoreData: (
    quotes: QuotationItem[],
    messages: QuoteMessage[],
    staffMembers?: StaffMember[]
  ) => void;
  onOpenFirestoreMonitor?: () => void;
}

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({
  isOpen,
  onClose,
  quotes,
  messages,
  staffMembers,
  onRestoreData,
  onOpenFirestoreMonitor,
}) => {
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  // Export JSON file download
  const handleExportJSON = () => {
    const backupData: BackupData = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      quotations: quotes,
      messages: messages,
      staffMembers: staffMembers,
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `marine_quotes_backup_${dateStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Import JSON file restore
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const parsed = JSON.parse(text) as BackupData;

        if (Array.isArray(parsed.quotations) && Array.isArray(parsed.messages)) {
          const confirmRestore = window.confirm(
            `バックアップデータから ${parsed.quotations.length} 件の見積データと ${parsed.messages.length} 件のメッセージ` +
              (parsed.staffMembers ? `、${parsed.staffMembers.length} 名の担当者` : "") +
              ` を復元（一括更新）しますか？`
          );

          if (confirmRestore) {
            onRestoreData(parsed.quotations, parsed.messages, parsed.staffMembers);
            setImportStatus(`${parsed.quotations.length} 件の見積案件と ${parsed.messages.length} 件のスレッドを正常に復元しました！`);
            setErrorStatus(null);
          }
        } else {
          setErrorStatus("バックアップファイルの構造（quotations / messages）が不正です。");
        }
      } catch (err: any) {
        console.error("Failed to parse backup JSON:", err);
        setErrorStatus("JSONファイルの読み込みエラー: " + err.message);
      }
    };

    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white border-b border-slate-800">
          <div className="flex items-center gap-2">
            <FileJson className="w-5 h-5 text-sky-400" />
            <h2 className="font-bold text-base text-slate-100">データバックアップ ＆ リストア</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 text-xs text-slate-700 dark:text-slate-300">
          {/* Section 1: Backup Download */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                  全データのJSONエクスポート
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  現在の見積案件 ({quotes.length}件) とスレッドをJSON保存
                </p>
              </div>
              <button
                onClick={handleExportJSON}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-lg shadow-xs flex items-center gap-1.5 transition-all"
              >
                <Download className="w-4 h-4" />
                JSON保存
              </button>
            </div>
          </div>

          {/* Section 2: Import Restore */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                JSONデータインポート（復元）
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                バックアップJSONファイルを選択またはドロップして書き込み復元
              </p>
            </div>

            <div className="relative border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4 text-center bg-white dark:bg-slate-900 hover:border-sky-500 transition-colors">
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <Upload className="w-6 h-6 text-slate-400 mx-auto mb-1" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                バックアップJSONファイルを選択 / ドロップ
              </p>
            </div>
          </div>

          {importStatus && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
              <span>{importStatus}</span>
            </div>
          )}

          {errorStatus && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorStatus}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          <div>
            {onOpenFirestoreMonitor && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFirestoreMonitor();
                }}
                className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-sky-500 transition-colors font-mono cursor-pointer"
                title="Firestore 読み取りメトリクス & クォータ監視を開く"
              >
                <Activity className="w-3.5 h-3.5 text-amber-500" />
                <span>DB Telemetry (Quota)</span>
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-700 dark:text-slate-300 font-medium rounded-lg text-xs"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
