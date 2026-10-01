import React, { useState } from "react";
import {
  Archive,
  Trash2,
  RotateCcw,
  Search,
  X,
  Ship,
  Plane,
  Clock,
  AlertTriangle,
  UserCheck,
  FileText,
  AlertOctagon,
  CheckCircle2,
} from "lucide-react";
import { QuotationItem, QuoteMessage, StaffMember, QuoteStatus, formatCustomsDate } from "../types";
import { KANBAN_COLUMNS } from "./KanbanBoard";
import { toastNotifier } from "../lib/toastNotifier";

interface ArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  archivedQuotes: QuotationItem[];
  messages: QuoteMessage[];
  staffMembers?: StaffMember[];
  onDeleteQuote: (quoteId: string) => void;
  onDeleteAllArchived: () => void;
  onRestoreQuote: (quoteId: string) => void;
  onSelectQuote?: (quote: QuotationItem) => void;
}

export const ArchiveModal: React.FC<ArchiveModalProps> = ({
  isOpen,
  onClose,
  archivedQuotes,
  messages,
  staffMembers = [],
  onDeleteQuote,
  onDeleteAllArchived,
  onRestoreQuote,
  onSelectQuote,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingQuote, setDeletingQuote] = useState<QuotationItem | null>(null);
  const [isConfirmingDeleteAll, setIsConfirmingDeleteAll] = useState(false);

  if (!isOpen) return null;

  const filtered = archivedQuotes.filter((q) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    return (
      q.title.toLowerCase().includes(query) ||
      q.vesselName.toLowerCase().includes(query) ||
      q.createdBy.toLowerCase().includes(query) ||
      q.airportCodes.some((code) => code.toLowerCase().includes(query))
    );
  });

  const handleExecuteDeleteQuote = () => {
    if (!deletingQuote) return;
    const quoteTitle = deletingQuote.title;
    const quoteId = deletingQuote.id;
    setDeletingQuote(null);
    onDeleteQuote(quoteId);
    toastNotifier.show({
      type: "info",
      title: "🗑️ 見積案件を削除しました",
      message: `「${quoteTitle}」をアーカイブから完全に削除しました。`,
      duration: 4000,
    });
  };

  const handleExecuteDeleteAll = () => {
    const count = archivedQuotes.length;
    setIsConfirmingDeleteAll(false);
    onDeleteAllArchived();
    toastNotifier.show({
      type: "info",
      title: "🗑️ アーカイブ一括削除完了",
      message: `アーカイブ済み見積 ${count} 件をすべて完全に削除しました。`,
      duration: 4000,
    });
  };

  const handleExecuteRestoreQuote = (quote: QuotationItem) => {
    onRestoreQuote(quote.id);
    toastNotifier.show({
      type: "success",
      title: "✨ 見積案件を復元しました",
      message: `「${quote.title}」をカンバンボードに復元しました。`,
      duration: 4000,
    });
  };

  const getStatusBadge = (status: QuoteStatus) => {
    const col = KANBAN_COLUMNS.find((c) => c.id === status);
    return col ? col.title : status;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden relative">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
              <Archive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                アーカイブ済み見積一覧
                <span className="px-2 py-0.5 text-xs font-extrabold rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  {archivedQuotes.length} 件
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                保管された見積情報の参照、復元、および個別・一括削除を行えます。
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar: Search & Delete All */}
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="本船名、件名、空港コードでアーカイブ内検索..."
              className="w-full pl-9 pr-4 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Delete All Button */}
          <button
            onClick={() => setIsConfirmingDeleteAll(true)}
            disabled={archivedQuotes.length === 0}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              archivedQuotes.length === 0
                ? "bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-not-allowed"
                : "bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/80 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 active:scale-95 shadow-2xs"
            }`}
            title="アーカイブされた全見積を一括削除します"
          >
            <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <span>一括削除</span>
          </button>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
              <Archive className="w-10 h-10 mx-auto mb-2 opacity-40 text-amber-500" />
              <p className="text-sm font-bold">
                {searchQuery
                  ? "該当するアーカイブ情報が見つかりません"
                  : "アーカイブされた見積情報はありません"}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                カンバン画面の「受託」「失注・保留」列の案件カードからアーカイブできます。
              </p>
            </div>
          ) : (
            filtered.map((quote) => {
              const assignedStaff = staffMembers.find(
                (s) => s.id === quote.assignedStaffId
              );
              const msgCount = messages.filter((m) => m.quoteId === quote.id).length;

              return (
                <div
                  key={quote.id}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-2xs hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    {/* Header Badges */}
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="px-2 py-0.5 font-bold rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                        {getStatusBadge(quote.status)}
                      </span>

                      {quote.isUrgent && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          URGENT
                        </span>
                      )}

                      {quote.airportCodes.map((code) => (
                        <span
                          key={code}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono font-bold bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800"
                        >
                          <Plane className="w-2.5 h-2.5" />
                          {code}
                        </span>
                      ))}

                      {assignedStaff && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
                          <UserCheck className="w-2.5 h-2.5" />
                          {assignedStaff.name}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h3
                      onClick={() => onSelectQuote?.(quote)}
                      className="font-bold text-sm text-slate-900 dark:text-slate-100 hover:text-sky-600 cursor-pointer transition-colors line-clamp-1"
                    >
                      {quote.title}
                    </h3>

                    {/* Details: Vessel, Weight, CreatedBy */}
                    <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                        <Ship className="w-3.5 h-3.5 text-slate-400" />
                        <span>{quote.vesselName}</span>
                      </div>
                      {formatCustomsDate(quote.customsClearanceDate || quote.grossWeight) && (
                        <div className="font-mono text-slate-600 dark:text-slate-400">
                          通関日: {formatCustomsDate(quote.customsClearanceDate || quote.grossWeight)}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>作成: {new Date(quote.createdAt).toLocaleDateString("ja-JP")}</span>
                      </div>
                      <div className="text-slate-400">
                        ({msgCount} メッセージ)
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {/* Restore Button */}
                    <button
                      onClick={() => handleExecuteRestoreQuote(quote)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer"
                      title="この見積情報をカンバンボードに復元します"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>復元</span>
                    </button>

                    {/* Delete Item Button */}
                    <button
                      onClick={() => setDeletingQuote(quote)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/80 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer"
                      title="この見積情報を個別削除します"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                      <span>削除</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex items-center justify-between">
          <div className="text-xs text-slate-500 font-medium">
            全 {archivedQuotes.length} 件中 {filtered.length} 件表示
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            閉じる
          </button>
        </div>

        {/* In-app Single Item Deletion Confirmation Modal */}
        {deletingQuote && (
          <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-900/60 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
                <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/80 flex items-center justify-center shrink-0 border border-rose-300 dark:border-rose-800">
                  <Trash2 className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                    見積案件の完全削除
                  </h3>
                  <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                    この操作を実行すると元に戻すことはできません
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 dark:bg-slate-950/80 rounded-xl border border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
                <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  {deletingQuote.title}
                </div>
                <div className="flex items-center gap-2 text-slate-500 text-xs">
                  <Ship className="w-3.5 h-3.5 text-slate-400" />
                  <span>本船名: {deletingQuote.vesselName}</span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  ID: {deletingQuote.id}
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
                この見積案件および紐づくすべてのメッセージ・履歴データを完全に削除しますか？
              </p>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setDeletingQuote(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg text-xs transition-colors cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDeleteQuote}
                  className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-extrabold rounded-lg text-xs shadow-md transition-all cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>完全に削除する</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* In-app All Items Deletion Confirmation Modal */}
        {isConfirmingDeleteAll && (
          <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-900/60 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
                <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/80 flex items-center justify-center shrink-0 border border-rose-300 dark:border-rose-800">
                  <AlertOctagon className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                    アーカイブの一括全件削除
                  </h3>
                  <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                    警告: この操作は取り消せません
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-rose-50/50 dark:bg-rose-950/30 rounded-xl border border-rose-200 dark:border-rose-900/50 text-xs space-y-1">
                <div className="font-bold text-rose-800 dark:text-rose-200">
                  削除対象: アーカイブ済み {archivedQuotes.length} 件の見積データ
                </div>
                <div className="text-rose-600 dark:text-rose-400 text-[11px]">
                  ※関連するすべてのメッセージスレッドおよびチャット履歴も完全に消去されます。
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
                本当にアーカイブ内のすべての見積案件を一括削除しますか？
              </p>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmingDeleteAll(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg text-xs transition-colors cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDeleteAll}
                  className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-extrabold rounded-lg text-xs shadow-md transition-all cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>全 {archivedQuotes.length} 件を一括削除する</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

