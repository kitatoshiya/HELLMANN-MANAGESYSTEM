import React, { useState, useMemo } from "react";
import {
  Search,
  RotateCcw,
  Plane,
  Ship,
  Scale,
  Calendar,
  FileSpreadsheet,
  FileText,
  File as FileIcon,
  Download,
  Eye,
  MessageSquare,
  ExternalLink as ExtIcon,
  Filter,
  CheckCircle,
  Clock,
  Send,
  UserCheck,
  ChevronRight,
  Sparkles,
  Paperclip,
  Copy,
  Check,
} from "lucide-react";
import {
  QuotationItem,
  QuoteMessage,
  QuoteStatus,
  StaffMember,
  UserProfile,
  WeightBreak,
  WEIGHT_BREAK_OPTIONS,
  formatCustomsDate,
} from "../types";
import { getAirportLabel, POPULAR_IATA_AIRPORTS } from "../lib/iataAirports";
import { stripHtmlToPlainText } from "../lib/mentionUtils";
import { getCleanFilename, triggerFileDownload } from "../lib/fileUtils";
import { FilePreviewModal, PreviewFile } from "./FilePreviewModal";

interface QuoteHistorySearchProps {
  quotes: QuotationItem[];
  messages: QuoteMessage[];
  currentUser: UserProfile;
  staffMembers: StaffMember[];
  onSelectQuote: (quote: QuotationItem) => void;
  currentTheme?: string;
}

interface ExtractedFile {
  id: string;
  name: string;
  url: string;
  size?: string;
  type?: string;
  quoteId: string;
  vesselName: string;
  createdAt: string;
}

export const QuoteHistorySearch: React.FC<QuoteHistorySearchProps> = ({
  quotes,
  messages,
  currentUser,
  staffMembers,
  onSelectQuote,
  currentTheme = "dark",
}) => {
  // Search filter states
  const [airportInput, setAirportInput] = useState("");
  const [selectedWeightBreak, setSelectedWeightBreak] = useState<string>("");
  const [vesselOrKeyword, setVesselOrKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [hasAttachmentOnly, setHasAttachmentOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"createdAt" | "updatedAt" | "customsDate">("createdAt");

  // Preview modal state
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [copiedQuoteId, setCopiedQuoteId] = useState<string | null>(null);

  // Extract all files attached to messages or quotes
  const quoteFilesMap = useMemo(() => {
    const map = new Map<string, ExtractedFile[]>();

    // 1. From quote's direct attachments
    quotes.forEach((q) => {
      if (q.externalLinks && q.externalLinks.length > 0) {
        const list = map.get(q.id) || [];
        q.externalLinks.forEach((fl) => {
          const clean = getCleanFilename(fl.title, fl.url);
          list.push({
            id: fl.id || `${q.id}-${fl.title}`,
            name: clean,
            url: fl.url,
            quoteId: q.id,
            vesselName: q.vesselName || "",
            createdAt: q.createdAt,
          });
        });
        map.set(q.id, list);
      }
    });

    // 2. From messages' attachments
    messages.forEach((msg) => {
      if (msg.externalLinks && msg.externalLinks.length > 0) {
        const fileLinks = msg.externalLinks.filter(
          (l) =>
            l.url?.startsWith("blob:") ||
            l.url?.startsWith("data:") ||
            l.title?.match(/\.(xlsx|xls|pdf|csv|docx|doc|png|jpg|jpeg|zip)$/i)
        );

        if (fileLinks.length > 0) {
          const list = map.get(msg.quoteId) || [];
          fileLinks.forEach((fl) => {
            const clean = getCleanFilename(fl.title, fl.url);
            list.push({
              id: fl.id || `${msg.id}-${fl.title}`,
              name: clean,
              url: fl.url,
              quoteId: msg.quoteId,
              vesselName: "",
              createdAt: msg.createdAt,
            });
          });
          map.set(msg.quoteId, list);
        }
      }
    });

    return map;
  }, [quotes, messages]);

  // Handle Search Filtering
  const filteredQuotes = useMemo(() => {
    return quotes
      .filter((q) => {
        // Destination Airport Filter (Case insensitive matching)
        if (airportInput.trim()) {
          const targetCode = airportInput.trim().toUpperCase();
          const hasMatch = q.airportCodes.some((code) =>
            code.toUpperCase().includes(targetCode)
          );
          if (!hasMatch) return false;
        }

        // Weight Break Filter
        if (selectedWeightBreak) {
          if (q.weightBreak !== selectedWeightBreak) {
            return false;
          }
        }

        // Keyword Filter (vessel name, title, createdBy)
        if (vesselOrKeyword.trim()) {
          const kw = vesselOrKeyword.trim().toLowerCase();
          const matchVessel = q.vesselName?.toLowerCase().includes(kw);
          const matchTitle = q.title?.toLowerCase().includes(kw);
          const matchCreatedBy = q.createdBy?.toLowerCase().includes(kw);
          const matchLinks = q.externalLinks?.some((l) =>
            l.title.toLowerCase().includes(kw)
          );
          if (!matchVessel && !matchTitle && !matchCreatedBy && !matchLinks) {
            return false;
          }
        }

        // Status Filter
        if (statusFilter !== "all") {
          if (q.status !== statusFilter) {
            return false;
          }
        }

        // Has Attachment Only Filter
        if (hasAttachmentOnly) {
          const hasFiles =
            (quoteFilesMap.get(q.id)?.length || 0) > 0 ||
            (q.externalLinks && q.externalLinks.length > 0);
          if (!hasFiles) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Always sort from newest to oldest by default
        if (sortBy === "updatedAt") {
          return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
        }
        if (sortBy === "customsDate") {
          const dateA = a.customsClearanceDate || "";
          const dateB = b.customsClearanceDate || "";
          return dateB.localeCompare(dateA);
        }
        // Default: createdAt newest first
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [quotes, airportInput, selectedWeightBreak, vesselOrKeyword, statusFilter, hasAttachmentOnly, sortBy, quoteFilesMap]);

  // Reset filters
  const handleReset = () => {
    setAirportInput("");
    setSelectedWeightBreak("");
    setVesselOrKeyword("");
    setStatusFilter("all");
    setHasAttachmentOnly(false);
  };

  // Direct download file handler
  const handleDownloadFile = (file: ExtractedFile, e: React.MouseEvent) => {
    e.stopPropagation();
    triggerFileDownload(file.name, file.url);
  };

  // Preview file handler
  const handlePreviewFile = (file: ExtractedFile, e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewFile({
      name: file.name,
      url: file.url,
      type: file.name.endsWith(".xlsx") || file.name.endsWith(".xls")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : file.name.endsWith(".pdf")
        ? "application/pdf"
        : file.name.endsWith(".csv")
        ? "text/csv"
        : "application/octet-stream",
    });
  };

  // Copy quote snippet
  const handleCopyQuoteSnippet = (quote: QuotationItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const relatedMsgs = messages.filter((m) => m.quoteId === quote.id);
    const lastMsg = relatedMsgs[relatedMsgs.length - 1];
    const msgText = lastMsg ? stripHtmlToPlainText(lastMsg.contentHtml) : "";
    const textToCopy = `【過去見積参考】\n船名: ${quote.vesselName}\n向地: ${quote.airportCodes.join(", ")}\n重量帯: ${quote.weightBreak || "未指定"}\n通関日: ${quote.customsClearanceDate || "-"}\n${msgText ? `最新メッセージ:\n${msgText}` : ""}`;

    navigator.clipboard.writeText(textToCopy);
    setCopiedQuoteId(quote.id);
    setTimeout(() => setCopiedQuoteId(null), 2000);
  };

  const getStatusBadge = (status: QuoteStatus) => {
    switch (status) {
      case "requested":
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">見積依頼</span>;
      case "estimated":
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">見積済み</span>;
      case "re_estimating":
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">見積連絡済</span>;
      case "accepted":
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40">受託</span>;
      case "closed_or_on_hold":
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-700/60 text-slate-300 border border-slate-600">失注・保留</span>;
      default:
        return null;
    }
  };

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-sky-950/60 to-slate-900 border-b border-slate-800 px-4 sm:px-8 py-5 shrink-0">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
                <Search className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
                  見積履歴検索
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-500/40 font-mono">
                    Air Freight Knowledge Base
                  </span>
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  向け地空港・重量帯から過去の見積案件・運賃・添付ファイルを即座に検索し、新しい見積書作成に再活用できます。
                </p>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="flex items-center gap-2">
              <div className="bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs">
                <span className="text-slate-400 font-medium">全登録案件数:</span>
                <span className="font-mono font-bold text-sky-400">{quotes.length} 件</span>
              </div>
              <div className="bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs">
                <span className="text-slate-400 font-medium">検索該当:</span>
                <span className="font-mono font-bold text-cyan-400">{filteredQuotes.length} 件</span>
              </div>
            </div>
          </div>

          {/* Search Box Card */}
          <div className="mt-5 bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5 items-end">
              {/* 1. Destination Airport (向地) */}
              <div className="lg:col-span-3">
                <label className="block text-xs font-bold text-sky-300 mb-1.5 flex items-center gap-1">
                  <Plane className="w-3.5 h-3.5 text-sky-400" />
                  向け地空港 (Airport Code)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="例: SIN, DXB, BKK, PUS..."
                    value={airportInput}
                    onChange={(e) => setAirportInput(e.target.value.toUpperCase())}
                    className="w-full pl-3 pr-8 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono font-bold text-white placeholder-slate-500 uppercase focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  {airportInput && (
                    <button
                      onClick={() => setAirportInput("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* 2. Weight Break (重量帯) */}
              <div className="lg:col-span-3">
                <label className="block text-xs font-bold text-indigo-300 mb-1.5 flex items-center gap-1">
                  <Scale className="w-3.5 h-3.5 text-indigo-400" />
                  重量帯 (Weight Break)
                </label>
                <select
                  value={selectedWeightBreak}
                  onChange={(e) => setSelectedWeightBreak(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="">すべて（指定なし）</option>
                  {WEIGHT_BREAK_OPTIONS.filter((o) => o.value).map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-slate-900 text-white font-mono">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Vessel Name / Keyword */}
              <div className="lg:col-span-3">
                <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1">
                  <Ship className="w-3.5 h-3.5 text-slate-400" />
                  船名 / 案件キーワード
                </label>
                <input
                  type="text"
                  placeholder="船名、案件名、荷主名など..."
                  value={vesselOrKeyword}
                  onChange={(e) => setVesselOrKeyword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-semibold text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* 4. Action Buttons */}
              <div className="lg:col-span-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {}}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white text-xs font-black rounded-lg shadow-md transition-all active:scale-95 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>検索を実行</span>
                </button>

                <button
                  type="button"
                  onClick={handleReset}
                  className="flex items-center justify-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg border border-slate-700 transition-colors"
                  title="検索条件を初期化"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">リセット</span>
                </button>
              </div>
            </div>

            {/* Quick Filter Chips (Airports & Weight Breaks) */}
            <div className="mt-3.5 pt-3 border-t border-slate-800 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400 text-[11px] font-medium flex items-center gap-1">
                <Filter className="w-3 h-3 text-slate-500" />
                クイック向地:
              </span>
              {["SIN", "DXB", "BKK", "PUS", "HKG", "RTM", "LAX", "MNL"].map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setAirportInput(airportInput === code ? "" : code)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-colors ${
                    airportInput === code
                      ? "bg-sky-600 text-white border border-sky-400"
                      : "bg-slate-800 text-sky-300 border border-slate-700 hover:bg-slate-700"
                  }`}
                >
                  {code}
                </button>
              ))}

              <span className="text-slate-600 font-bold mx-1">|</span>

              <span className="text-slate-400 text-[11px] font-medium">重量帯:</span>
              {["MIN", "-45kg", "+45kg", "+100kg", "+300kg", "+500kg", "+1000kg"].map((wb) => (
                <button
                  key={wb}
                  type="button"
                  onClick={() => setSelectedWeightBreak(selectedWeightBreak === wb ? "" : wb)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-colors ${
                    selectedWeightBreak === wb
                      ? "bg-indigo-600 text-white border border-indigo-400"
                      : "bg-slate-800 text-indigo-300 border border-slate-700 hover:bg-slate-700"
                  }`}
                >
                  {wb}
                </button>
              ))}

              <div className="ml-auto flex items-center gap-3">
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-300 font-medium select-none">
                  <input
                    type="checkbox"
                    checked={hasAttachmentOnly}
                    onChange={(e) => setHasAttachmentOnly(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-sky-500 focus:ring-sky-400 bg-slate-950 border-slate-700"
                  />
                  <span>📎 見積添付ファイルありのみ</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Results Section */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6">
        {/* Results Header / Sorting */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-extrabold text-white">
              検索結果 ({filteredQuotes.length} 件)
            </span>
            {(airportInput || selectedWeightBreak || vesselOrKeyword) && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {airportInput && (
                  <span className="px-2 py-0.5 bg-sky-950 text-sky-300 text-xs font-mono rounded border border-sky-600 font-bold">
                    向地: {airportInput}
                  </span>
                )}
                {selectedWeightBreak && (
                  <span className="px-2 py-0.5 bg-indigo-950 text-indigo-300 text-xs font-mono rounded border border-indigo-500 font-bold">
                    重量帯: {selectedWeightBreak}
                  </span>
                )}
                {vesselOrKeyword && (
                  <span className="px-2 py-0.5 bg-slate-800 text-slate-300 text-xs rounded border border-slate-700 font-medium">
                    キーワード: "{vesselOrKeyword}"
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Sort Controls */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 text-xs hidden sm:inline">並び替え:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 font-bold focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
            >
              <option value="createdAt">登録日時（新しい順）</option>
              <option value="updatedAt">最終更新日（新しい順）</option>
              <option value="customsDate">通関日順</option>
            </select>
          </div>
        </div>

        {/* Quotes List */}
        {filteredQuotes.length === 0 ? (
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-12 text-center my-8">
            <div className="w-14 h-14 mx-auto rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500 mb-3">
              <Search className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-slate-200 mb-1">
              条件に一致する過去の見積が見つかりませんでした
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mb-4">
              検索条件（向け地空港コードや重量帯）を変更するか、リセットして全履歴を表示してください。
            </p>
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold text-xs rounded-lg border border-slate-700 transition-colors"
            >
              検索条件をリセット
            </button>
          </div>
        ) : (
          <div className="space-y-3.5">
            {filteredQuotes.map((quote) => {
              const files = quoteFilesMap.get(quote.id) || [];
              const relatedMsgs = messages.filter((m) => m.quoteId === quote.id);
              const userMsgs = relatedMsgs.filter(
                (m) =>
                  !m.isSystemLog &&
                  !m.contentHtml?.includes("ステータスを") &&
                  !m.contentHtml?.includes("がステータスを")
              );
              const latestMsg = userMsgs[userMsgs.length - 1];
              const assignedStaff = staffMembers.find((s) => s.id === quote.assignedStaffId);

              return (
                <div
                  key={quote.id}
                  onClick={() => onSelectQuote(quote)}
                  className="group bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/70 rounded-xl p-4 sm:p-5 transition-all shadow-md hover:shadow-xl hover:shadow-sky-950/30 cursor-pointer relative"
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    {/* Left: Main Quote Details */}
                    <div className="flex-1 min-w-0">
                      {/* Top Badges Row */}
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        {/* Destination Airport Codes */}
                        {quote.airportCodes.map((code) => (
                          <span
                            key={code}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-mono font-black bg-sky-950 text-sky-300 border border-sky-600 shadow-2xs"
                          >
                            <Plane className="w-3 h-3 text-sky-400" />
                            {code} {getAirportLabel(code) && `(${getAirportLabel(code)})`}
                          </span>
                        ))}

                        {/* Weight Break (重量帯) */}
                        {quote.weightBreak ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-mono font-black bg-indigo-950 text-indigo-300 border border-indigo-500 shadow-2xs">
                            <Scale className="w-3 h-3 text-indigo-400" />
                            重量帯: {quote.weightBreak}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-slate-400 bg-slate-800/80 border border-slate-700">
                            重量帯: 未選択
                          </span>
                        )}

                        {/* Status Badge */}
                        {getStatusBadge(quote.status)}

                        {/* Customs Date */}
                        {quote.customsClearanceDate && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono text-yellow-300 bg-yellow-950/60 border border-yellow-700/60">
                            <Calendar className="w-3 h-3 text-yellow-400" />
                            通関日: {formatCustomsDate(quote.customsClearanceDate)}
                          </span>
                        )}

                        {/* Assigned Staff */}
                        {assignedStaff && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-slate-300 bg-slate-800 border border-slate-700">
                            <UserCheck className="w-3 h-3 text-sky-400" />
                            担当: {assignedStaff.name}
                          </span>
                        )}
                      </div>

                      {/* Vessel & Title */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <Ship className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="font-extrabold text-sm sm:text-base text-amber-300 truncate">
                          {quote.vesselName || "船名未指定"}
                        </span>
                        <span className="text-slate-600 font-bold">|</span>
                        <h3 className="font-bold text-sm sm:text-base text-white group-hover:text-sky-300 transition-colors truncate">
                          {quote.title}
                        </h3>
                      </div>

                      {/* Latest Message / Fare Memo Preview */}
                      {latestMsg && stripHtmlToPlainText(latestMsg.contentHtml) && (
                        <div className="mt-2 text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 flex items-start gap-2">
                          <MessageSquare className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                          <div className="flex-1 line-clamp-2 text-slate-300 leading-relaxed font-sans">
                            {stripHtmlToPlainText(latestMsg.contentHtml)}
                          </div>
                        </div>
                      )}

                      {/* Direct Attached Quote Files Section */}
                      {files.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-slate-800/80">
                          <div className="flex items-center gap-2 mb-1.5">
                            <Paperclip className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-xs font-bold text-emerald-300">
                              添付見積ファイル ({files.length} 件):
                            </span>
                            <span className="text-[10px] text-slate-400">
                              ※クリックで即座にダウンロードして新しい見積書に活用できます
                            </span>
                          </div>
                          <div className="flex flex-col gap-1.5 w-full">
                            {files.map((file) => {
                              const isExcel = file.name.match(/\.(xlsx|xls|csv)$/i);
                              const isPdf = file.name.match(/\.pdf$/i);

                              return (
                                <div
                                  key={file.id}
                                  className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 hover:border-emerald-500 text-xs text-slate-200 transition-all shadow-xs w-full"
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    {isExcel ? (
                                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                    ) : isPdf ? (
                                      <FileText className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                    ) : (
                                      <FileIcon className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                    )}
                                    <span className="font-medium truncate flex-1 min-w-0" title={file.name}>
                                      {file.name}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {/* Preview button */}
                                    <button
                                      onClick={(e) => handlePreviewFile(file, e)}
                                      className="px-2 py-1 text-slate-300 hover:text-sky-300 rounded hover:bg-sky-950/60 transition-colors flex items-center gap-1 text-[11px]"
                                      title="プレビュー表示"
                                    >
                                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                                      <span className="text-[10px] hidden sm:inline">プレビュー</span>
                                    </button>

                                    {/* Download button */}
                                    <button
                                      onClick={(e) => handleDownloadFile(file, e)}
                                      className="px-2 py-1 text-slate-300 hover:text-emerald-300 rounded hover:bg-emerald-950/60 transition-colors flex items-center gap-1 text-[11px]"
                                      title={`「${file.name}」をダウンロード`}
                                    >
                                      <Download className="w-3.5 h-3.5 text-emerald-400" />
                                      <span className="text-[10px] hidden sm:inline">ダウンロード</span>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right: Actions & Timestamp */}
                    <div className="flex flex-row md:flex-col items-end justify-between gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
                      <div className="text-right text-[11px] font-mono text-slate-400">
                        <div className="flex items-center gap-1 justify-end">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <span>登録: {formatDate(quote.createdAt)}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          更新: {formatDate(quote.updatedAt || quote.createdAt)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Copy Info Button */}
                        <button
                          type="button"
                          onClick={(e) => handleCopyQuoteSnippet(quote, e)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                          title="この見積情報をクリップボードにコピー"
                        >
                          {copiedQuoteId === quote.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-300">コピー完了</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-slate-400" />
                              <span className="hidden sm:inline">情報コピー</span>
                            </>
                          )}
                        </button>

                        {/* Open Thread Button */}
                        <button
                          type="button"
                          onClick={() => onSelectQuote(quote)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-black bg-sky-600 group-hover:bg-sky-500 text-white shadow-md transition-all active:scale-95"
                        >
                          <span>詳細スレッド</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};
