import React, { useState, useMemo } from "react";
import {
  X,
  Ship,
  Plane,
  Scale,
  AlertTriangle,
  Link2,
  Plus,
  Trash2,
  CheckCircle2,
  UserCheck,
} from "lucide-react";
import { ExternalLink, QuotationItem, QuoteStatus, StaffMember, UserProfile, WeightBreak, WEIGHT_BREAK_OPTIONS } from "../types";
import { convertTsvToHtmlTable } from "../lib/excelParser";
import { isValidIataCode } from "../lib/iataAirports";
import { processMentionNotificationsAndEmails } from "../lib/mentionUtils";
import { UnifiedRichEditor } from "./UnifiedRichEditor";

interface NewQuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  staffMembers: StaffMember[];
  quotes?: QuotationItem[];
  onCreateQuote: (
    newQuote: Omit<QuotationItem, "id" | "createdAt" | "updatedAt" | "lastRepliedAt" | "readBy">,
    initialMessageHtml: string
  ) => void;
  initialStatus?: QuoteStatus;
  initialDraft?: {
    title?: string;
    vesselName?: string;
    airportCodes?: string[];
    notes?: string;
    htmlBody?: string;
  };
}

export const NewQuoteModal: React.FC<NewQuoteModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  staffMembers,
  quotes = [],
  onCreateQuote,
  initialStatus = "requested",
  initialDraft,
}) => {
  // Form states
  const [title, setTitle] = useState("");
  const [vesselName, setVesselName] = useState("");
  const [airportCodesInput, setAirportCodesInput] = useState("");
  const [weightBreak, setWeightBreak] = useState<WeightBreak | "">("");
  const [customsClearanceDate, setCustomsClearanceDate] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [status, setStatus] = useState<QuoteStatus>(initialStatus);
  const [assignedStaffId, setAssignedStaffId] = useState<string>("");
  const [messageContent, setMessageContent] = useState("");
  const [externalLinks, setExternalLinks] = useState<ExternalLink[]>([]);
  const [linkTitleInput, setLinkTitleInput] = useState("");
  const [linkUrlInput, setLinkUrlInput] = useState("");

  // Sync initial draft if opened with pre-filled content (e.g. from Shared Mailbox)
  React.useEffect(() => {
    if (isOpen) {
      if (initialDraft) {
        if (initialDraft.title) setTitle(initialDraft.title);
        if (initialDraft.vesselName) setVesselName(initialDraft.vesselName);
        if (initialDraft.airportCodes && initialDraft.airportCodes.length > 0) {
          setAirportCodesInput(initialDraft.airportCodes.join(", "));
        }
        const draftContent = initialDraft.htmlBody || initialDraft.notes || "";
        if (draftContent) {
          const trimmed = draftContent.trim();
          const isHtml =
            trimmed.startsWith("<") &&
            (trimmed.includes("</") ||
              trimmed.includes("/>") ||
              trimmed.includes("<br") ||
              trimmed.includes("<table") ||
              trimmed.includes("<img") ||
              trimmed.includes("<div") ||
              trimmed.includes("<p"));

          if (isHtml) {
            // HTMLメール本文はそのままリッチHTML（表・罫線・画像・装飾）として渡す
            setMessageContent(draftContent);
          } else {
            // プレーンテキストの場合は改行を整形
            const htmlFormatted = draftContent
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/\r\n/g, "<br/>")
              .replace(/\n/g, "<br/>");
            setMessageContent(`<p class="my-1 leading-relaxed">${htmlFormatted}</p>`);
          }
        }
      }
    } else {
      // 閉じた際にフォームをリセット
      setTitle("");
      setVesselName("");
      setAirportCodesInput("");
      setWeightBreak("");
      setCustomsClearanceDate("");
      setIsUrgent(false);
      setStatus(initialStatus);
      setAssignedStaffId("");
      setMessageContent("");
      setExternalLinks([]);
      setLinkTitleInput("");
      setLinkUrlInput("");
    }
  }, [isOpen, initialDraft, initialStatus]);

  // Validate airport codes format
  const getParsedAirportCodes = () => {
    if (!airportCodesInput) return [];
    return airportCodesInput
      .split(/[,/\s]+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c.length > 0);
  };

  const parsedAirports = getParsedAirportCodes();
  const invalidAirports = parsedAirports.filter((c) => !isValidIataCode(c));

  // Compute top destinations from past 1 month quotes
  const recentDestinations = useMemo(() => {
    const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const countMap: Record<string, number> = {};
    let recentCount = 0;

    // 1. Count airport codes in quotes created within past 30 days
    quotes.forEach((q) => {
      const time = q.createdAt ? new Date(q.createdAt).getTime() : 0;
      if (time >= oneMonthAgo && Array.isArray(q.airportCodes)) {
        q.airportCodes.forEach((code) => {
          const clean = code?.trim().toUpperCase();
          if (clean && isValidIataCode(clean)) {
            countMap[clean] = (countMap[clean] || 0) + 1;
            recentCount++;
          }
        });
      }
    });

    // If no recent quotes found (e.g. initial demo/test state), fallback to all-time quotes
    if (recentCount === 0 && quotes.length > 0) {
      quotes.forEach((q) => {
        if (Array.isArray(q.airportCodes)) {
          q.airportCodes.forEach((code) => {
            const clean = code?.trim().toUpperCase();
            if (clean && isValidIataCode(clean)) {
              countMap[clean] = (countMap[clean] || 0) + 1;
            }
          });
        }
      });
    }

    // Always ensure major maritime hub airports are present
    const standardHubs = ["SIN", "BKK", "HKG", "RTM", "DXB", "HND", "KIX"];
    standardHubs.forEach((hub) => {
      if (countMap[hub] === undefined) {
        countMap[hub] = 0;
      }
    });

    return Object.entries(countMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code]) => ({ code }));
  }, [quotes]);

  // Handle clicking on destination tag (toggle or set)
  const handleToggleAirportTag = (code: string) => {
    const current = getParsedAirportCodes();
    if (current.includes(code)) {
      // If already present, remove it
      const next = current.filter((c) => c !== code);
      setAirportCodesInput(next.join(", "));
    } else {
      // If not present, add it (or set if empty)
      const next = [...current, code];
      setAirportCodesInput(next.join(", "));
    }
  };

  if (!isOpen) return null;

  // Add external link
  const handleAddLink = () => {
    if (!linkUrlInput) return;
    setExternalLinks((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        title: linkTitleInput || linkUrlInput,
        url: linkUrlInput.startsWith("http") ? linkUrlInput : `https://${linkUrlInput}`,
      },
    ]);
    setLinkTitleInput("");
    setLinkUrlInput("");
  };

  const handleRemoveLink = (index: number) => {
    setExternalLinks((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit quote creation
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      alert("案件タイトルは必須入力項目です。");
      return;
    }

    if (invalidAirports.length > 0) {
      alert(
        `不正な空港コード形式が含まれています: ${invalidAirports.join(
          ", "
        )}\n3レターのIATA英大文字（例: SIN, BKK, HND）を入力してください。`
      );
      return;
    }

    const cleanAirports = parsedAirports.filter((c) => isValidIataCode(c));

    // Ensure tab separated text in messageContent is converted to HTML Table if needed
    let finalContent = messageContent.trim();
    if (finalContent.includes("\t") && !finalContent.includes("<table")) {
      finalContent = convertTsvToHtmlTable(finalContent);
    }

    const initialContent = finalContent
      ? finalContent.startsWith("<")
        ? finalContent
        : `<p class="my-1">${finalContent.replace(/\n/g, "<br/>")}</p>`
      : `<p>新規見積依頼が作成されました。</p>`;

    onCreateQuote(
      {
        title: title.trim(),
        vesselName: vesselName.trim() || "未指定",
        airportCodes: cleanAirports.length > 0 ? cleanAirports : ["SIN"],
        weightBreak: weightBreak || undefined,
        customsClearanceDate: customsClearanceDate.trim() || undefined,
        grossWeight: customsClearanceDate.trim() || undefined,
        isUrgent,
        status,
        createdBy: currentUser.email,
        externalLinks,
        assignedStaffId: assignedStaffId || undefined,
      },
      initialContent
    );

    // Reset form
    setTitle("");
    setVesselName("");
    setAirportCodesInput("");
    setWeightBreak("");
    setCustomsClearanceDate("");
    setIsUrgent(false);
    setAssignedStaffId("");
    setMessageContent("");
    setExternalLinks([]);

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <Ship className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">新規見積投稿作成</h2>
              <p className="text-xs text-slate-300">
                船用品エアー手配 見積依頼新規登録
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-100 bg-slate-900">
          <form id="new-quote-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-start">
              {/* Vessel Name (5 cols) */}
              <div className="sm:col-span-5">
                <label className="block text-slate-100 font-bold mb-1">
                  船名 (Vessel Name) <span className="text-slate-400 font-normal text-[11px] ml-1">(任意)</span>
                </label>
                <div className="relative">
                  <Ship className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="例: M/V OCEAN GLORY (任意)"
                    value={vesselName}
                    onChange={(e) => setVesselName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* Destination Airport Codes (4 cols) */}
              <div className="sm:col-span-4">
                <label className="block text-slate-100 font-bold mb-1">
                  向け地空港コード <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Plane className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="例: SIN, BKK"
                    value={airportCodesInput}
                    onChange={(e) => setAirportCodesInput(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-mono font-semibold uppercase text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                {invalidAirports.length > 0 && (
                  <p className="mt-1 text-[10px] text-amber-400 font-medium">
                    ⚠️ 英大文字3桁で入力してください。
                  </p>
                )}

                {/* Past 1 Month Destination Tags (3-letter codes only, single horizontal row) */}
                {recentDestinations.length > 0 && (
                  <div className="mt-1 flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
                    <span className="text-[10px] text-slate-400 font-semibold shrink-0 select-none">
                      実績:
                    </span>
                    <div className="flex items-center gap-1 shrink-0 flex-nowrap">
                      {recentDestinations.map(({ code }) => {
                        const isSelected = parsedAirports.includes(code);
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() => handleToggleAirportTag(code)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all active:scale-95 cursor-pointer shrink-0 leading-tight ${
                              isSelected
                                ? "bg-sky-500 text-white shadow-xs ring-1 ring-sky-300"
                                : "bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 hover:border-slate-600"
                            }`}
                            title={`${code} - クリックで反映 / 解除`}
                          >
                            {code}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Weight Break (重量帯) - Placed directly to the right of destination (3 cols) */}
              <div className="sm:col-span-3">
                <label className="block text-slate-100 font-bold mb-1">
                  重量帯 <span className="text-slate-400 font-normal text-[11px] ml-1">(任意)</span>
                </label>
                <div className="relative">
                  <Scale className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <select
                    value={weightBreak}
                    onChange={(e) => setWeightBreak(e.target.value as WeightBreak | "")}
                    className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer"
                  >
                    {WEIGHT_BREAK_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-slate-800 text-white">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Case Title */}
            <div>
              <label className="block text-slate-100 font-bold mb-1">
                案件タイトル <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="例: M/V OCEAN GLORY 主機関NO.1シリンダライナエアー手配"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
              {/* Customs Clearance Date (通関日) */}
              <div>
                <label className="block text-slate-100 font-bold mb-1">
                  通関日 <span className="text-slate-400 font-normal">(任意)</span>
                </label>
                <input
                  type="date"
                  value={customsClearanceDate}
                  onChange={(e) => setCustomsClearanceDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* Status Selector */}
              <div>
                <label className="block text-slate-100 font-bold mb-1">
                  初期ステータス
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as QuoteStatus)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="requested" className="bg-slate-800 text-white">見積依頼</option>
                  <option value="estimated" className="bg-slate-800 text-white">見積済み</option>
                  <option value="re_estimating" className="bg-slate-800 text-white">見積連絡済</option>
                  <option value="accepted" className="bg-slate-800 text-white">受託</option>
                  <option value="closed_or_on_hold" className="bg-slate-800 text-white">失注・保留</option>
                </select>
              </div>

              {/* Assigned Staff Member (Optional) */}
              <div>
                <label className="block text-slate-100 font-bold mb-1 flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5 text-sky-400" />
                  担当者 <span className="text-slate-400 font-normal">(任意)</span>
                </label>
                <select
                  value={assignedStaffId}
                  onChange={(e) => setAssignedStaffId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="" className="bg-slate-800 text-white">-- 未割り当て --</option>
                  {staffMembers.map((staff) => (
                    <option key={staff.id} value={staff.id} className="bg-slate-800 text-white">
                      {staff.name} ({staff.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Urgent Checkbox */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/80 text-amber-200 font-bold">
                <input
                  type="checkbox"
                  checked={isUrgent}
                  onChange={(e) => setIsUrgent(e.target.checked)}
                  className="w-4 h-4 text-amber-500 rounded focus:ring-amber-500"
                />
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>🚨 緊急案件 (URGENT) フラグ</span>
              </label>
            </div>

            {/* Initial Message Content */}
            <div className="space-y-1.5">
              <label className="block text-slate-200 font-bold text-xs">
                依頼詳細・投稿本文 (Excel表コピペ・罫線自動整形対応)
              </label>

              <UnifiedRichEditor
                value={messageContent}
                onChange={setMessageContent}
                placeholder="品目リスト、サイズ、手配注意事項、Excelからコピーした価格表など..."
                minHeight="180px"
              />
            </div>

            {/* External Documents Links Area */}
            <div className="p-3 bg-slate-800/80 border border-slate-700 rounded-xl space-y-2">
              <label className="block text-slate-200 font-bold text-xs flex items-center gap-1.5">
                <Link2 className="w-4 h-4 text-sky-400" />
                外部資料・Google Drive リンクの登録
              </label>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="タイトル (例: 見積計算シート)"
                  value={linkTitleInput}
                  onChange={(e) => setLinkTitleInput(e.target.value)}
                  className="w-1/3 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400"
                />
                <input
                  type="url"
                  placeholder="URL (https://drive.google.com/...)"
                  value={linkUrlInput}
                  onChange={(e) => setLinkUrlInput(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400"
                />
                <button
                  type="button"
                  onClick={handleAddLink}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg text-xs flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> 追加
                </button>
              </div>

              {externalLinks.length > 0 && (
                <ul className="space-y-1.5 pt-1">
                  {externalLinks.map((link, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-700 text-xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Link2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span className="font-semibold text-slate-200">
                          {link.title}
                        </span>
                        <span className="text-slate-400 text-[10px] truncate max-w-[200px]">
                          {link.url}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveLink(idx)}
                        className="text-rose-400 hover:text-rose-300 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </form>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 border-t border-slate-800 shrink-0">
          <div className="text-xs text-slate-400">
            投稿者 ID: <span className="font-mono text-slate-200 font-semibold">{currentUser.email}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-lg text-xs transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              form="new-quote-form"
              className="px-5 py-2 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-lg text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              新規見積として投稿
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
