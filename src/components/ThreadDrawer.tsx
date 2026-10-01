import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  Ship,
  Plane,
  Scale,
  Search,
  Clock,
  AlertTriangle,
  Link2,
  Copy,
  Send,
  User,
  Plus,
  Trash2,
  Check,
  ChevronRight,
  Info,
  Table,
  Upload,
  Paperclip,
  FileText,
  File as FileIcon,
  Eye,
  ExternalLink as ExtIcon,
  MessageSquare,
  Pencil,
  FileSpreadsheet,
  UserCheck,
  Archive,
  Download,
  Mail,
  AtSign,
  CheckCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  ExternalLink,
  QuotationItem,
  QuoteMessage,
  QuoteStatus,
  StaffMember,
  UserProfile,
  WeightBreak,
  WEIGHT_BREAK_OPTIONS,
  formatCustomsDate,
} from "../types";
import { convertTsvToHtmlTable, copyToClipboard } from "../lib/excelParser";
import { processMentionNotificationsAndEmails } from "../lib/mentionUtils";
import { getCleanFilename, triggerFileDownload } from "../lib/fileUtils";
import { KANBAN_COLUMNS } from "./KanbanBoard";
import { UnifiedRichEditor } from "./UnifiedRichEditor";
import { FilePreviewModal, PreviewFile } from "./FilePreviewModal";
import { EmailModal } from "./EmailModal";
import { QuickMemoCard } from "./QuickMemoCard";
import { triggerDesktopNotification } from "../lib/notificationHelper";
import { extractMentionsFromContent, stripHtmlToPlainText } from "../lib/mentionUtils";
import { checkExcelFilesForWarnings, ExcelWarningDetail } from "../lib/excelChecker";

interface ThreadDrawerProps {
  quote: QuotationItem | null;
  allQuotes?: QuotationItem[];
  messages: QuoteMessage[];
  currentUser: UserProfile;
  staffMembers?: StaffMember[];
  onClose: () => void;
  onStatusChange: (quoteId: string, newStatus: QuoteStatus) => void;
  onArchiveQuote?: (quoteId: string) => void;
  onAddReply: (
    quoteId: string,
    contentHtml: string,
    externalLinks?: ExternalLink[]
  ) => void;
  onMarkAsRead: (quoteId: string) => void;
  onUpdateQuote?: (quote: QuotationItem) => void;
  onUpdateMessage?: (
    messageId: string,
    contentHtml: string,
    links?: ExternalLink[]
  ) => void;
  onDeleteMessage?: (messageId: string) => void;
  onSelectQuote?: (quote: QuotationItem) => void;
}

interface AttachedFileItem {
  id: string;
  name: string;
  size: string;
  type: string;
  url: string;
  rawFile?: File;
}

export const ThreadDrawer: React.FC<ThreadDrawerProps> = ({
  quote,
  allQuotes = [],
  messages,
  currentUser,
  staffMembers = [],
  onClose,
  onStatusChange,
  onArchiveQuote,
  onAddReply,
  onMarkAsRead,
  onUpdateQuote,
  onUpdateMessage,
  onDeleteMessage,
  onSelectQuote,
}) => {
  const [replyText, setReplyText] = useState("");
  const [replyLinks, setReplyLinks] = useState<ExternalLink[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileItem[]>([]);
  const [linkTitleInput, setLinkTitleInput] = useState("");
  const [linkUrlInput, setLinkUrlInput] = useState("");
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Similar Past Quotes Panel Toggle
  const [showSimilarQuotes, setShowSimilarQuotes] = useState(false);
  const [copiedFareQuoteId, setCopiedFareQuoteId] = useState<string | null>(null);

  // Excel File Content Warning Modal State
  const [showExcelWarningModal, setShowExcelWarningModal] = useState(false);
  const [pendingExcelWarnings, setPendingExcelWarnings] = useState<ExcelWarningDetail[]>([]);

  // File Preview Modal State
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);

  // Email Notification & Preview Modal State
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailModalMode, setEmailModalMode] = useState<"staff_mention" | "customer_quote">("staff_mention");
  const [targetEmailStaff, setTargetEmailStaff] = useState<StaffMember | null>(null);

  // Original Quote Header Editing States
  const [isEditingQuote, setIsEditingQuote] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editVessel, setEditVessel] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editAirports, setEditAirports] = useState("");
  const [editWeightBreak, setEditWeightBreak] = useState<WeightBreak | "">("");
  const [editUrgent, setEditUrgent] = useState(false);
  const [editAssignedStaffId, setEditAssignedStaffId] = useState<string>("");

  // Message Editing & Zoom & Deletion Confirmation States
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null);
  const [isDraggingEditFile, setIsDraggingEditFile] = useState<boolean>(false);
  const [editMsgHtml, setEditMsgHtml] = useState("");
  const [editMsgLinks, setEditMsgLinks] = useState<ExternalLink[]>([]);
  const [editAttachedFiles, setEditAttachedFiles] = useState<AttachedFileItem[]>([]);
  const [editLinkTitleInput, setEditLinkTitleInput] = useState("");
  const [editLinkUrlInput, setEditLinkUrlInput] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  // Auto-mark as read when opened & sync edit form state
  useEffect(() => {
    if (quote) {
      if (!quote.readBy?.includes(currentUser.email)) {
        onMarkAsRead(quote.id);
      }
      setEditTitle(quote.title);
      setEditVessel(quote.vesselName);
      setEditWeight(quote.customsClearanceDate || quote.grossWeight || "");
      setEditAirports(quote.airportCodes.join(", "));
      setEditWeightBreak((quote.weightBreak as WeightBreak) || "");
      setEditUrgent(quote.isUrgent);
      setEditAssignedStaffId(quote.assignedStaffId || "");
    }
  }, [quote, currentUser.email]);

  // Compute similar past quotes (strictly matching BOTH destination airport AND weight break)
  const similarQuotes = useMemo(() => {
    if (!quote || !allQuotes) return [];
    const hasCurrentAirports = quote.airportCodes && quote.airportCodes.length > 0;
    const hasCurrentWeightBreak = Boolean(quote.weightBreak);

    // Both destination airport and weight break must be present
    if (!hasCurrentAirports || !hasCurrentWeightBreak) {
      return [];
    }

    return allQuotes
      .filter((q) => q.id !== quote.id)
      .filter((q) => {
        const matchAirport = quote.airportCodes.some((code) =>
          q.airportCodes?.some((c) => c.toUpperCase() === code.toUpperCase())
        );
        const matchWeight =
          Boolean(q.weightBreak) && q.weightBreak === quote.weightBreak;
        return matchAirport && matchWeight;
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt || b.updatedAt).getTime() -
          new Date(a.createdAt || a.updatedAt).getTime()
      );
  }, [quote, allQuotes]);

  if (!quote) return null;

  const quoteMessages = messages.filter((m) => m.quoteId === quote.id);

  // Save Quote Modifications
  const handleSaveQuoteEdit = () => {
    if (!onUpdateQuote) return;
    const airports = editAirports
      .split(",")
      .map((a) => a.trim().toUpperCase())
      .filter(Boolean);

    onUpdateQuote({
      ...quote,
      title: editTitle.trim() || quote.title,
      vesselName: editVessel.trim() || quote.vesselName,
      customsClearanceDate: editWeight.trim() || undefined,
      grossWeight: editWeight.trim() || quote.grossWeight,
      airportCodes: airports.length > 0 ? airports : quote.airportCodes,
      weightBreak: editWeightBreak || undefined,
      isUrgent: editUrgent,
      assignedStaffId: editAssignedStaffId || undefined,
      updatedAt: new Date().toISOString(),
    });
    setIsEditingQuote(false);
  };

  // Process files attached during message edit
  const processEditFiles = (files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      const isTextOrTable =
        file.type.includes("text") ||
        file.name.endsWith(".txt") ||
        file.name.endsWith(".csv") ||
        file.name.endsWith(".tsv");

      if (isTextOrTable) {
        const reader = new FileReader();
        reader.onload = (e) => {
          let content = e.target?.result as string;
          if (content) {
            if (content.includes("\t") || file.name.endsWith(".tsv") || file.name.endsWith(".csv")) {
              const tableHtml = convertTsvToHtmlTable(content);
              setEditMsgHtml((prev) => prev + (prev ? "\n\n" : "") + tableHtml);
            } else {
              setEditMsgHtml((prev) => prev + (prev ? "\n\n" : "") + content);
            }
          }
        };
        reader.readAsText(file);
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          const newItem: AttachedFileItem = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
            name: file.name,
            size: formatFileSize(file.size),
            type: file.type,
            url: dataUrl,
          };
          setEditAttachedFiles((prev) => [...prev, newItem]);
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const handleEditFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processEditFiles(e.target.files);
    }
  };

  // Drag and Drop handlers for Edit Mode
  const handleEditDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingEditFile(true);
  };

  const handleEditDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingEditFile(false);
  };

  const handleEditDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingEditFile(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processEditFiles(e.dataTransfer.files);
    }
  };

  // Helper to trigger download with original filename
  const downloadAttachment = (title: string, url?: string) => {
    if (!url) return;
    triggerFileDownload(title, url);
  };

  const handleAddEditLink = () => {
    if (!editLinkUrlInput) return;
    setEditMsgLinks((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        title: editLinkTitleInput || editLinkUrlInput,
        url: editLinkUrlInput.startsWith("http") ? editLinkUrlInput : `https://${editLinkUrlInput}`,
      },
    ]);
    setEditLinkTitleInput("");
    setEditLinkUrlInput("");
  };

  const handleRemoveEditLink = (id: string) => {
    setEditMsgLinks((prev) => prev.filter((l) => l.id !== id));
  };

  const handleRemoveEditAttachedFile = (id: string) => {
    setEditAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Save Message Modification
  const handleSaveMessageEdit = (msgId: string) => {
    if (!onUpdateMessage) return;

    let finalHtml = editMsgHtml;
    const finalLinks: ExternalLink[] = [...editMsgLinks];

    editAttachedFiles.forEach((file) => {
      if (file.type.startsWith("image/")) {
        finalHtml += `<div class="my-2"><img src="${file.url}" alt="${file.name}" class="max-w-xs rounded-lg border border-slate-300 dark:border-slate-700 shadow-xs" /></div>`;
      } else {
        finalLinks.push({
          id: file.id,
          title: file.name,
          url: file.url,
        });
      }
    });

    onUpdateMessage(msgId, finalHtml, finalLinks);
    setEditingMsgId(null);
    setEditAttachedFiles([]);
    setEditMsgLinks([]);
  };

  // Trigger File Preview
  const handleOpenPreview = (title: string, url?: string) => {
    const titleLower = title.toLowerCase();
    const urlLower = (url || "").toLowerCase();

    let type: PreviewFile["type"] = "pdf";
    if (
      titleLower.includes("excel") ||
      titleLower.includes("表") ||
      titleLower.includes("シート") ||
      titleLower.endsWith(".xlsx") ||
      titleLower.endsWith(".xls") ||
      titleLower.endsWith(".csv") ||
      titleLower.endsWith(".tsv")
    ) {
      type = "excel";
    } else if (titleLower.includes("pdf") || titleLower.endsWith(".pdf")) {
      type = "pdf";
    } else if (
      urlLower.match(/\.(jpeg|jpg|png|webp|gif|svg)$/) ||
      titleLower.match(/\.(jpeg|jpg|png|webp|gif|svg)$/) ||
      urlLower.startsWith("data:image/")
    ) {
      type = "image";
    } else if (
      titleLower.endsWith(".txt") ||
      titleLower.endsWith(".log") ||
      titleLower.endsWith(".json")
    ) {
      type = "text";
    } else {
      type = "doc";
    }

    setPreviewFile({
      id: Date.now().toString(),
      name: title,
      type,
      url,
    });
  };

  // Format File Size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  // Process uploaded / dropped files
  const processFiles = (files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      const isTextOrTable =
        file.type.includes("text") ||
        file.name.endsWith(".txt") ||
        file.name.endsWith(".csv") ||
        file.name.endsWith(".tsv");

      if (isTextOrTable) {
        const reader = new FileReader();
        reader.onload = (e) => {
          let content = e.target?.result as string;
          if (content) {
            if (content.includes("\t") || file.name.endsWith(".tsv") || file.name.endsWith(".csv")) {
              const tableHtml = convertTsvToHtmlTable(content);
              setReplyText((prev) => prev + (prev ? "\n\n" : "") + tableHtml);
            } else {
              setReplyText((prev) => prev + (prev ? "\n\n" : "") + content);
            }
          }
        };
        reader.readAsText(file);
      } else {
        // Process images or documents as Data URL attached file items
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          const newItem: AttachedFileItem = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
            name: file.name,
            size: formatFileSize(file.size),
            type: file.type,
            url: dataUrl,
            rawFile: file,
          };
          setAttachedFiles((prev) => [...prev, newItem]);
        };
        reader.readAsDataURL(file);
      }
    });
  };

  // Drag and Drop handlers for reply form
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  const handleRemoveAttachedFile = (id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Handle Excel TSV Paste in reply
  const handleReplyPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData("text");
    if (pastedText && pastedText.includes("\t")) {
      const convert = window.confirm(
        "Excelの表データ（タブ区切り）が検出されました。HTMLテーブル（罫線付き表）に自動変換して返信に挿入しますか？"
      );
      if (convert) {
        e.preventDefault();
        const htmlTable = convertTsvToHtmlTable(pastedText);
        setReplyText((prev) => prev + (prev ? "\n\n" : "") + htmlTable);
      }
    }
  };

  // Add link in reply
  const handleAddReplyLink = () => {
    if (!linkUrlInput) return;
    setReplyLinks((prev) => [
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

  // One-click Copy Handler
  const handleCopyContent = async (msgId: string, contentHtml: string) => {
    const success = await copyToClipboard(contentHtml);
    if (success) {
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 2500);
    }
  };

  // Execute actual reply submission after validation
  const executeSendReply = () => {
    let formattedContent = replyText.startsWith("<")
      ? replyText
      : `<p class="my-1">${replyText.replace(/\n/g, "<br/>")}</p>`;

    // Merge attached files as ExternalLinks or HTML image tags
    const allLinks: ExternalLink[] = [...replyLinks];

    attachedFiles.forEach((file) => {
      if (file.type.startsWith("image/")) {
        formattedContent += `<div class="my-2"><img src="${file.url}" alt="${file.name}" class="max-w-xs rounded-lg border border-slate-300 dark:border-slate-700 shadow-xs" /></div>`;
      } else {
        allLinks.push({
          id: file.id,
          title: file.name,
          url: file.url,
        });
      }
    });

    onAddReply(quote.id, formattedContent, allLinks);
    setReplyText("");
    setReplyLinks([]);
    setAttachedFiles([]);
    setShowExcelWarningModal(false);
    setPendingExcelWarnings([]);
  };

  // Submit Reply with Excel Content Inspection
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() && replyLinks.length === 0 && attachedFiles.length === 0) return;

    // Check attached Excel files for "Detection" / "X-RAY" near "1500"
    if (attachedFiles.length > 0) {
      const warnings = await checkExcelFilesForWarnings(attachedFiles);
      if (warnings.length > 0) {
        setPendingExcelWarnings(warnings);
        setShowExcelWarningModal(true);
        return;
      }
    }

    executeSendReply();
  };

  // Format date
  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return `${d.getFullYear()}/${(d.getMonth() + 1)
        .toString()
        .padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${d
        .getHours()
        .toString()
        .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    } catch {
      return isoString;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-7xl bg-slate-900 border border-slate-800 h-[92vh] max-h-[900px] flex flex-col rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Modal Header - Ultra Compact 1-Row Layout */}
        <div className="px-4 py-3 bg-slate-950 text-white border-b border-slate-800 shrink-0 flex items-center justify-between gap-3">
          {/* Main info row: Airport, Title, Vessel, Weight, CreatedBy */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar min-w-0 flex-1 py-0.5">
            {/* Urgent Flag */}
            {quote.isUrgent && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-black bg-rose-600 text-white shrink-0 shadow-xs">
                <AlertTriangle className="w-3.5 h-3.5" />
                URGENT
              </span>
            )}

            {/* Airport Codes */}
            {quote.airportCodes.map((code) => (
              <span
                key={code}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-black bg-sky-950 text-sky-400 border border-sky-600 shrink-0 shadow-2xs"
              >
                <Plane className="w-3.5 h-3.5 text-sky-400" />
                {code}
              </span>
            ))}

            {/* Weight Break (重量帯) */}
            {quote.weightBreak && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-black bg-indigo-950 text-indigo-300 border border-indigo-500 shrink-0 shadow-2xs"
                title={`重量帯: ${quote.weightBreak}`}
              >
                <Scale className="w-3.5 h-3.5 text-indigo-400" />
                {quote.weightBreak}
              </span>
            )}

            {/* Title */}
            <h2 className="font-extrabold text-sm sm:text-base text-sky-300 truncate shrink-0 max-w-[200px] sm:max-w-[320px]">
              {quote.title}
            </h2>

            <span className="text-slate-600 text-xs shrink-0 font-bold">|</span>

            {/* Vessel Name */}
            <div className="inline-flex items-center gap-1 text-xs sm:text-sm font-bold text-amber-300 shrink-0">
              <Ship className="w-4 h-4 text-sky-400" />
              <span>{quote.vesselName}</span>
            </div>

            <span className="text-slate-600 text-xs shrink-0 font-bold">|</span>

            {/* Customs Clearance Date */}
            {formatCustomsDate(quote.customsClearanceDate || quote.grossWeight) && (
              <>
                <div className="inline-flex items-center gap-1 text-xs sm:text-sm font-mono font-bold text-yellow-400 shrink-0">
                  <span className="text-sky-300 font-sans font-medium text-xs">通関日:</span>
                  <span>{formatCustomsDate(quote.customsClearanceDate || quote.grossWeight)}</span>
                </div>
                <span className="text-slate-600 text-xs shrink-0 font-bold">|</span>
              </>
            )}

            {/* Creator */}
            <div className="inline-flex items-center gap-1 text-xs text-sky-200 font-medium shrink-0">
              <User className="w-3.5 h-3.5 text-sky-400" />
              <span>{quote.createdBy.split("@")[0]}</span>
            </div>

            <span className="text-slate-600 text-xs shrink-0 font-bold">|</span>

            {/* Assigned Staff */}
            <div className="inline-flex items-center gap-1 text-xs font-bold text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded-md border border-indigo-700/60 shrink-0">
              <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
              <span>
                {staffMembers?.find((s) => s.id === quote.assignedStaffId)?.name
                  ? `担当: ${staffMembers.find((s) => s.id === quote.assignedStaffId)?.name}`
                  : "担当: 未割り当て"}
              </span>
            </div>
          </div>

          {/* Right Controls: Edit Quote Info, Email Button, Status Dropdown & Close */}
          <div className="flex items-center gap-2 shrink-0 pl-2 border-l border-slate-800">
            {quote.status === "requested" && (
              <button
                type="button"
                onClick={() => onStatusChange(quote.id, "estimated")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all border bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400/60 shadow-md cursor-pointer active:scale-95"
                title="ワンクリックでステータスを見積済みに更新"
              >
                <CheckCircle className="w-3.5 h-3.5 text-emerald-100" />
                <span>見積完了</span>
              </button>
            )}

            {quote.status === "estimated" && (
              <button
                type="button"
                onClick={() => onStatusChange(quote.id, "re_estimating")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all border bg-purple-600 hover:bg-purple-500 text-white border-purple-400/60 shadow-md cursor-pointer active:scale-95"
                title="ワンクリックでステータスを見積連絡済みに更新"
              >
                <Send className="w-3.5 h-3.5 text-purple-100" />
                <span>見積連絡済</span>
              </button>
            )}

            {quote.status === "re_estimating" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onStatusChange(quote.id, "accepted");
                    onClose();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all border bg-teal-600 hover:bg-teal-500 text-white border-teal-400/60 shadow-md cursor-pointer active:scale-95"
                  title="受託ステータスに移動してメイン画面に戻る"
                >
                  <CheckCircle className="w-3.5 h-3.5 text-teal-100" />
                  <span>受託</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onStatusChange(quote.id, "closed_or_on_hold");
                    onClose();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition-all border bg-rose-700 hover:bg-rose-600 text-white border-rose-400/60 shadow-md cursor-pointer active:scale-95"
                  title="失注・保留ステータスに移動してメイン画面に戻る"
                >
                  <Clock className="w-3.5 h-3.5 text-rose-100" />
                  <span>失注・保留</span>
                </button>
              </>
            )}

            {/* Similar Past Quotes Button */}
            <button
              type="button"
              onClick={() => setShowSimilarQuotes((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                showSimilarQuotes
                  ? "bg-cyan-600 text-white border-cyan-400 font-extrabold shadow-md ring-2 ring-cyan-400/40"
                  : "bg-slate-900 hover:bg-cyan-950 text-cyan-300 border-cyan-500/40"
              }`}
              title="同一向地・重量帯の過去見積をワンクリックで検索・引用"
            >
              <Search className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">類似過去見積</span>
              <span className="px-1.5 py-0.2 bg-cyan-950 text-cyan-300 rounded-full text-[10px] font-mono border border-cyan-500/50">
                {similarQuotes.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setEmailModalMode("staff_mention");
                setIsEmailModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border bg-slate-900 hover:bg-sky-950 text-sky-300 border-sky-500/40 cursor-pointer"
              title="担当者通知メールを作成・送信"
            >
              <Mail className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">通知メール</span>
            </button>

            {onUpdateQuote && (
              <button
                onClick={() => setIsEditingQuote(!isEditingQuote)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                  isEditingQuote
                    ? "bg-amber-500 text-slate-950 border-amber-400 font-extrabold"
                    : "bg-slate-900 hover:bg-slate-800 text-amber-300 border-amber-500/40"
                }`}
                title="元の投稿案件情報を修正"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">投稿情報修正</span>
              </button>
            )}

            {onArchiveQuote && ["accepted", "closed_or_on_hold"].includes(quote.status) && (
              <button
                onClick={() => {
                  onArchiveQuote(quote.id);
                  onClose();
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border bg-slate-900 hover:bg-amber-950 text-amber-300 border-amber-500/40"
                title="この見積案件をアーカイブに移動"
              >
                <Archive className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">アーカイブ</span>
              </button>
            )}

            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-400 hidden sm:inline font-bold">ステータス:</span>
              <select
                value={quote.status}
                onChange={(e) =>
                  onStatusChange(quote.id, e.target.value as QuoteStatus)
                }
                className="bg-slate-900 hover:bg-slate-800 text-amber-300 text-xs font-extrabold py-1.5 px-2.5 rounded-lg border border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer shadow-2xs"
              >
                {KANBAN_COLUMNS.map((col) => (
                  <option key={col.id} value={col.id} className="bg-slate-900 text-amber-300 font-bold">
                    【{col.title}】
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-sky-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title="閉じる"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Inline Quote Info Edit Drawer */}
        {isEditingQuote && (
          <div className="p-4 bg-amber-950/90 text-amber-100 border-b border-amber-600/60 flex flex-col gap-3 animate-in slide-in-from-top-2 duration-150">
            <div className="flex items-center justify-between text-xs font-bold text-amber-300 border-b border-amber-800/80 pb-1.5">
              <span className="flex items-center gap-1.5 font-extrabold text-sm">
                <Pencil className="w-4 h-4 text-amber-400" />
                元の投稿（案件ヘッダー情報）の修正・編集
              </span>
              <button
                onClick={() => setIsEditingQuote(false)}
                className="text-amber-400 hover:text-white"
              >
                ✕ 閉じる
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-amber-300 mb-1">
                  案件タイトル:
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-amber-500/60 rounded text-amber-100 font-bold focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-amber-300 mb-1">
                  船名 (Vessel Name):
                </label>
                <input
                  type="text"
                  value={editVessel}
                  onChange={(e) => setEditVessel(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-amber-500/60 rounded text-amber-100 font-bold focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-amber-300 mb-1">
                  通関日 (任意):
                </label>
                <input
                  type="date"
                  value={editWeight}
                  onChange={(e) => setEditWeight(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-amber-500/60 rounded text-amber-100 font-bold focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-amber-300 mb-1">
                  向け地 (カンマ区切り):
                </label>
                <input
                  type="text"
                  value={editAirports}
                  onChange={(e) => setEditAirports(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-amber-500/60 rounded text-amber-100 font-mono font-bold focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder="SIN, DXB, BKK"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-amber-300 mb-1">
                  重量帯 (Weight Break):
                </label>
                <select
                  value={editWeightBreak}
                  onChange={(e) => setEditWeightBreak(e.target.value as WeightBreak | "")}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-amber-500/60 rounded text-amber-100 font-bold focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
                >
                  {WEIGHT_BREAK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-amber-300 mb-1">
                  担当者割り当て:
                </label>
                <select
                  value={editAssignedStaffId}
                  onChange={(e) => setEditAssignedStaffId(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-amber-500/60 rounded text-amber-200 font-bold focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  <option value="">-- 未割り当て --</option>
                  {(staffMembers || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-extrabold text-rose-300">
                <input
                  type="checkbox"
                  checked={editUrgent}
                  onChange={(e) => setEditUrgent(e.target.checked)}
                  className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500"
                />
                <span>🚨 URGENT (緊急案件フラグ)</span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditingQuote(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-200 rounded text-xs font-bold"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleSaveQuoteEdit}
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded text-xs font-black shadow-md"
                >
                  ✓ 修正内容を保存
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Global External Links Bar for this quote */}
        {quote.externalLinks && quote.externalLinks.length > 0 && (
          <div className="px-5 py-2 bg-sky-950/60 border-b border-sky-900/60 flex items-center gap-2 overflow-x-auto shrink-0">
            <span className="text-xs font-bold text-sky-300 flex items-center gap-1 shrink-0">
              <Link2 className="w-3.5 h-3.5" /> 案件全体の補足資料:
            </span>
            {quote.externalLinks.map((link, i) => (
              <div key={i} className="inline-flex items-center gap-1">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-900 hover:bg-slate-800 text-sky-300 border border-sky-800 rounded-md text-xs font-medium shadow-2xs shrink-0"
                >
                  <span>{link.title}</span>
                  <ExtIcon className="w-3 h-3 text-sky-400" />
                </a>
                <button
                  onClick={() => handleOpenPreview(link.title, link.url)}
                  className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs"
                  title="PDF / Excel プレビュー表示"
                >
                  <Eye className="w-3 h-3" />
                  <span>プレビュー</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 簡易メモ (1案件に1つ、現在の状況の表示・変更・削除) */}
        {onUpdateQuote && (
          <div className="px-5 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0">
            <QuickMemoCard
              quote={quote}
              currentUser={currentUser}
              onUpdateQuote={onUpdateQuote}
              variant="drawer"
            />
          </div>
        )}

        {/* Similar Past Quotes Collapsible Panel */}
        {showSimilarQuotes && (
          <div className="bg-slate-950 border-b-4 border-cyan-500 shadow-2xl p-4 max-h-[360px] overflow-y-auto animate-in slide-in-from-top-2 duration-150 shrink-0 relative z-10">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1.5 text-xs font-extrabold text-cyan-300">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  同一条件の過去見積 (向地: {quote.airportCodes.join(", ") || "未設定"} ＆ 重量帯: {quote.weightBreak || "未設定"})
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-600/50 font-bold">
                  {similarQuotes.length} 件合致
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowSimilarQuotes(false)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 cursor-pointer"
              >
                ✕ パネルを閉じる
              </button>
            </div>

            {similarQuotes.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs bg-slate-900/60 rounded-xl border border-slate-800">
                <Search className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                <p className="font-bold text-slate-300">一致する過去見積は見つかりませんでした</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  {!quote.airportCodes?.length || !quote.weightBreak ? (
                    <span>※現在の案件に「向け地」と「重量帯」の両方が設定されている必要があります（現在: 向け地={quote.airportCodes.join(", ") || "未設定"} / 重量帯={quote.weightBreak || "未設定"}）。</span>
                  ) : (
                    <span>向け地（{quote.airportCodes.join(", ")}）と重量帯（{quote.weightBreak}）の両方が一致する過去案件はありません。</span>
                  )}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {similarQuotes.map((sq) => {
                  const sqMessages = messages.filter((m) => m.quoteId === sq.id);
                  const sqLinks: { title: string; url: string; msgDate?: string }[] = [];
                  (sq.externalLinks || []).forEach((l) => sqLinks.push(l));
                  sqMessages.forEach((m) => {
                    (m.externalLinks || []).forEach((l) =>
                      sqLinks.push({ ...l, msgDate: m.createdAt })
                    );
                  });

                  // Find latest quote message text (exclude system logs / operation history)
                  const userMessages = sqMessages.filter(
                    (m) =>
                      !m.isSystemLog &&
                      !m.contentHtml?.includes("ステータスを") &&
                      !m.contentHtml?.includes("がステータスを")
                  );
                  const latestMsg = userMessages[userMessages.length - 1];
                  const plainText = latestMsg
                    ? stripHtmlToPlainText(latestMsg.contentHtml).trim()
                    : "";

                  return (
                    <div
                      key={sq.id}
                      className="bg-slate-900 border border-slate-800 hover:border-cyan-500/60 rounded-xl p-3 flex flex-col justify-between gap-2.5 transition-all text-xs shadow-md"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {sq.airportCodes.map((code) => (
                              <span
                                key={code}
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-950 text-sky-300 border border-sky-700"
                              >
                                {code}
                              </span>
                            ))}
                            {sq.weightBreak && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-600">
                                {sq.weightBreak}
                              </span>
                            )}
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                              {KANBAN_COLUMNS.find((c) => c.id === sq.status)?.title || sq.status}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400">
                            {formatDate(sq.createdAt || sq.updatedAt)}
                          </span>
                        </div>

                        <div className="font-bold text-slate-100 truncate text-sm">
                          {sq.title}
                        </div>
                        <div className="text-[11px] text-amber-300 flex items-center gap-1">
                          <Ship className="w-3 h-3 text-amber-400" />
                          <span>{sq.vesselName}</span>
                          <span className="text-slate-600">|</span>
                          <span className="text-slate-400">作成: {sq.createdBy.split("@")[0]}</span>
                        </div>

                        {/* Message Preview Snippet */}
                        {plainText && (
                          <div className="bg-slate-950/80 p-2 rounded border border-slate-800 text-[11px] text-slate-300 line-clamp-2 font-mono">
                            {plainText}
                          </div>
                        )}

                        {/* Attached Files - Full Width Layout */}
                        {sqLinks.length > 0 && (
                          <div className="space-y-1.5 pt-1 w-full">
                            <span className="text-[10px] text-slate-400 font-bold block">
                              添付ファイル ({sqLinks.length}件):
                            </span>
                            <div className="flex flex-col gap-1.5 w-full">
                              {sqLinks.map((file, fIdx) => {
                                const cleanName = getCleanFilename(file.title, file.url);
                                const isExcel = cleanName.match(/\.(xlsx|xls|csv|tsv)$/i);
                                const isPdf = cleanName.match(/\.pdf$/i);

                                return (
                                  <div
                                    key={fIdx}
                                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-950/90 border border-slate-700 hover:border-cyan-500/50 rounded-lg text-xs text-cyan-300 w-full transition-colors group"
                                  >
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      {isExcel ? (
                                        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                      ) : isPdf ? (
                                        <FileText className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                      ) : (
                                        <FileIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                      )}
                                      <span
                                        className="font-medium text-slate-200 truncate flex-1 min-w-0"
                                        title={cleanName}
                                      >
                                        {cleanName}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => handleOpenPreview(cleanName, file.url)}
                                        className="px-1.5 py-0.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
                                        title="プレビュー表示"
                                      >
                                        <Eye className="w-3 h-3 text-sky-400" />
                                        <span className="text-[10px] hidden sm:inline">プレビュー</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => downloadAttachment(cleanName, file.url)}
                                        className="px-1.5 py-0.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
                                        title={`「${cleanName}」をダウンロード`}
                                      >
                                        <Download className="w-3 h-3 text-emerald-400" />
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

                      {/* Action buttons */}
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                        {plainText && (
                          <button
                            type="button"
                            onClick={() => {
                              const fareSnippet = `【過去見積参照 (${sq.airportCodes.join("/")} ${sq.weightBreak || ""})】\n${plainText}`;
                              setReplyText((prev) =>
                                prev ? `${prev}\n\n${fareSnippet}` : fareSnippet
                              );
                              setCopiedFareQuoteId(sq.id);
                              setTimeout(() => setCopiedFareQuoteId(null), 2500);
                            }}
                            className="px-2.5 py-1 bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-600/60 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                            title="この過去見積の本文内容を返信欄に入力"
                          >
                            {copiedFareQuoteId === sq.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-300">返信欄に引用完了</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>本文を返信欄に引用</span>
                              </>
                            )}
                          </button>
                        )}

                        {onSelectQuote && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectQuote(sq);
                              setShowSimilarQuotes(false);
                            }}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                            title="この案件の詳細を開く"
                          >
                            <span>案件を開く</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Main Content Body: 2 Columns Grid (Left: Thread History, Right: Reply Composer) */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden divide-y md:divide-y-0 md:divide-x-2 divide-slate-800 border-t-2 border-slate-700">
          
          {/* LEFT COLUMN: Messages / Thread Timeline */}
          <div className="flex flex-col h-full overflow-hidden bg-white text-slate-900 thread-messages-column">
            <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between shrink-0 thread-messages-header">
              <span className="font-extrabold text-xs text-slate-800 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-sky-600" />
                元の投稿・やり取り履歴 ({quoteMessages.length}件)
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white text-slate-900 thread-messages-list">
              {quoteMessages.length === 0 ? (
                <div className="text-center py-16 text-slate-500 text-xs font-bold">
                  まだ返信・メッセージはありません。右側のフォームから投稿してください。
                </div>
              ) : (
                quoteMessages.map((msg) => {
                  if (msg.isSystemLog) {
                    return (
                      <div
                        key={msg.id}
                        className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-slate-100 border border-slate-200 text-[11px] text-slate-700 font-bold my-2"
                      >
                        <Info className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                        <div
                          dangerouslySetInnerHTML={{ __html: msg.contentHtml }}
                        />
                        <span className="text-[10px] text-slate-500 font-mono">
                          ({formatDate(msg.createdAt)})
                        </span>
                      </div>
                    );
                  }

                  const isMe = msg.authorEmail === currentUser.email;

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        isMe ? "items-end" : "items-start"
                      }`}
                    >
                      {/* Author Header */}
                      <div className="flex items-center gap-2 mb-1 px-1 text-[11px] text-slate-600 font-bold">
                        <span className="font-black text-slate-900">
                          {msg.authorName || msg.authorEmail.split("@")[0]}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">
                          ({msg.authorEmail})
                        </span>
                        <span className="text-slate-400">•</span>
                        <span className="font-mono text-[10px] text-slate-500">
                          {formatDate(msg.createdAt)}
                        </span>
                      </div>

                      {/* Message Bubble Card */}
                      <div
                        className={`relative w-full p-4 rounded-2xl shadow-xs border ${
                          isMe
                            ? "bg-sky-50/90 border-sky-200 text-slate-900"
                            : "bg-slate-50 border-slate-200 text-slate-900"
                        }`}
                      >
                        {/* Inline Message Content Edit Form vs Static HTML */}
                        {editingMsgId === msg.id ? (
                          <div
                            onDragOver={handleEditDragOver}
                            onDragLeave={handleEditDragLeave}
                            onDrop={handleEditDrop}
                            className={`relative space-y-3 p-2.5 bg-slate-900/90 border border-amber-500/50 rounded-xl transition-all ${
                              isDraggingEditFile
                                ? "ring-2 ring-amber-400 bg-amber-950/50"
                                : ""
                            }`}
                          >
                            {isDraggingEditFile && (
                              <div className="absolute inset-0 z-20 bg-amber-950/90 backdrop-blur-2xs border-2 border-dashed border-amber-400 rounded-xl flex items-center justify-center text-amber-200 font-bold text-xs gap-2 pointer-events-none">
                                <Upload className="w-5 h-5 animate-bounce text-amber-300" />
                                <span>ここにファイルをドロップして修正投稿に添付</span>
                              </div>
                            )}

                            <div className="flex items-center justify-between text-xs font-bold text-amber-300">
                              <span className="flex items-center gap-1.5 font-extrabold">
                                <Pencil className="w-4 h-4 text-amber-400" />
                                ✏️ 投稿メッセージ本文・ファイルの修正・ドラッグ＆ドロップ追加添付
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMsgId(null);
                                  setEditAttachedFiles([]);
                                  setEditMsgLinks([]);
                                }}
                                className="text-slate-400 hover:text-white text-xs cursor-pointer"
                              >
                                ✕ キャンセル
                              </button>
                            </div>

                            <UnifiedRichEditor
                              value={editMsgHtml}
                              onChange={setEditMsgHtml}
                              placeholder="メッセージ内容を修正..."
                              minHeight="160px"
                            />

                            {/* Hidden File Input for Edit Mode */}
                            <input
                              ref={editFileInputRef}
                              type="file"
                              multiple
                              onChange={handleEditFileInputChange}
                              className="hidden"
                            />

                            {/* File & Link Attachment Tools during edit */}
                            <div className="space-y-2 pt-2 border-t border-slate-800">
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => editFileInputRef.current?.click()}
                                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors shadow-2xs cursor-pointer"
                                >
                                  <Paperclip className="w-3.5 h-3.5 text-sky-400" />
                                  <span>ファイル選択 (またはドロップ)</span>
                                </button>

                                <input
                                  type="text"
                                  placeholder="参考リンク名"
                                  value={editLinkTitleInput}
                                  onChange={(e) => setEditLinkTitleInput(e.target.value)}
                                  className="w-28 sm:w-36 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-white placeholder-slate-400"
                                />
                                <input
                                  type="url"
                                  placeholder="https://..."
                                  value={editLinkUrlInput}
                                  onChange={(e) => setEditLinkUrlInput(e.target.value)}
                                  className="flex-1 min-w-[120px] px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-white placeholder-slate-400"
                                />
                                <button
                                  type="button"
                                  onClick={handleAddEditLink}
                                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg text-xs shrink-0 cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" /> リンク
                                </button>
                              </div>

                              {/* Currently attached/edited files */}
                              {editAttachedFiles.length > 0 && (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-amber-300 font-extrabold">
                                    新規追加するファイル ({editAttachedFiles.length} 件):
                                  </div>
                                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                                    {editAttachedFiles.map((file) => (
                                      <span
                                        key={file.id}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-sky-950 text-sky-200 border border-sky-800 rounded-lg font-bold shadow-2xs max-w-full"
                                      >
                                        <FileIcon className="w-3 h-3 text-sky-400 shrink-0" />
                                        <span className="max-w-[280px] truncate" title={file.name}>{file.name}</span>
                                        <span className="text-[10px] text-slate-400 shrink-0">({file.size})</span>
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveEditAttachedFile(file.id)}
                                          className="text-slate-400 hover:text-rose-400 ml-0.5 cursor-pointer shrink-0"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Existing & newly added links */}
                              {editMsgLinks.length > 0 && (
                                <div className="space-y-1">
                                  <div className="text-[10px] text-slate-300 font-extrabold">
                                    添付リンク一覧 ({editMsgLinks.length} 件):
                                  </div>
                                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                                    {editMsgLinks.map((l, i) => (
                                      <span
                                        key={l.id || i}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 text-sky-300 border border-slate-700 rounded-lg font-bold"
                                      >
                                        <Link2 className="w-3 h-3 text-sky-400" />
                                        <span className="max-w-[150px] truncate">{l.title}</span>
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveEditLink(l.id || i.toString())}
                                          className="text-slate-400 hover:text-rose-400 ml-1 cursor-pointer"
                                          title="このリンクを削除"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMsgId(null);
                                  setEditAttachedFiles([]);
                                  setEditMsgLinks([]);
                                }}
                                className="px-3 py-1.5 bg-slate-800 text-slate-300 hover:bg-slate-700 rounded text-xs font-bold cursor-pointer"
                              >
                                キャンセル
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveMessageEdit(msg.id)}
                                className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-extrabold shadow-xs cursor-pointer flex items-center gap-1"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>✓ 修正内容を保存</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* In-app Deletion Confirmation Alert Bar */}
                            {confirmDeleteMsgId === msg.id && (
                              <div className="mb-3 p-3 bg-amber-950/90 border border-amber-500/80 rounded-xl text-amber-100 flex flex-col sm:flex-row items-center justify-between gap-3 animate-fadeIn shadow-lg">
                                <div className="flex items-center gap-2 text-xs font-extrabold text-amber-200">
                                  <RotateCcw className="w-4.5 h-4.5 text-amber-400 shrink-0" />
                                  <span>このメッセージの送信を取り消しますか？</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteMsgId(null)}
                                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold cursor-pointer"
                                  >
                                    キャンセル
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (onDeleteMessage) {
                                        onDeleteMessage(msg.id);
                                      }
                                      setConfirmDeleteMsgId(null);
                                    }}
                                    className="px-3.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-black cursor-pointer shadow-xs flex items-center gap-1 active:scale-95 transition-all"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    <span>送信取り消しを実行</span>
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Message Content HTML */}
                            <div
                              className="text-xs leading-relaxed space-y-2 overflow-x-auto font-medium"
                              dangerouslySetInnerHTML={{ __html: msg.contentHtml }}
                            />

                            {/* Attached Links inside message with Download & Preview Buttons */}
                            {msg.externalLinks && msg.externalLinks.length > 0 && (
                              <div className="mt-3 pt-2.5 border-t border-slate-200 flex flex-col gap-1.5 w-full">
                                {msg.externalLinks.map((l, idx) => {
                                  const fileName = getCleanFilename(l.title, l.url);
                                  const isExcel = fileName.match(/\.(xlsx|xls|csv|tsv)$/i);
                                  const isPdf = fileName.match(/\.pdf$/i);

                                  return (
                                    <div
                                      key={idx}
                                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100/90 border border-slate-300 rounded-lg text-xs w-full transition-colors"
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        {isExcel ? (
                                          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                        ) : isPdf ? (
                                          <FileText className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                        ) : (
                                          <Link2 className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                                        )}
                                        <span
                                          className="font-bold text-slate-800 truncate flex-1 min-w-0"
                                          title={fileName}
                                        >
                                          {fileName}
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => handleOpenPreview(fileName, l.url)}
                                          className="px-2 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[10px] font-extrabold flex items-center gap-1 cursor-pointer shadow-2xs transition-colors"
                                          title="ファイル(Excel/PDF)プレビュー"
                                        >
                                          <Eye className="w-3 h-3" />
                                          <span>プレビュー</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => downloadAttachment(fileName, l.url)}
                                          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-extrabold flex items-center gap-1 cursor-pointer shadow-2xs transition-colors"
                                          title={`元のファイル名 (${fileName}) でダウンロード保存`}
                                        >
                                          <Download className="w-3 h-3" />
                                          <span>保存</span>
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Card Footer: Edit Message, Delete Message & One-click Copy Button */}
                            <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2">
                                {onUpdateMessage && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMsgId(msg.id);
                                      setEditMsgHtml(msg.contentHtml);
                                      setEditMsgLinks(msg.externalLinks ? [...msg.externalLinks] : []);
                                      setEditAttachedFiles([]);
                                      setEditLinkTitleInput("");
                                      setEditLinkUrlInput("");
                                    }}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-300 hover:border-amber-400 rounded-md text-[11px] font-bold transition-colors cursor-pointer"
                                    title="このメッセージ投稿を編集・修正（ファイルの再添付可能）"
                                  >
                                    <Pencil className="w-3 h-3 text-amber-600" />
                                    <span>修正・ファイル追加</span>
                                  </button>
                                )}

                                {onDeleteMessage && isMe && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmDeleteMsgId(msg.id);
                                    }}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-300 hover:border-amber-400 rounded-md text-[11px] font-bold transition-colors cursor-pointer"
                                    title="この投稿書き込みの送信を取り消す"
                                  >
                                    <RotateCcw className="w-3 h-3 text-amber-600" />
                                    <span>送信取り消し</span>
                                  </button>
                                )}
                              </div>

                              <button
                                onClick={() => handleCopyContent(msg.id, msg.contentHtml)}
                                className="flex items-center gap-1.5 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-md text-[11px] font-extrabold transition-all shadow-2xs ml-auto"
                                title="クリップボードに一発複製"
                              >
                                {copiedMsgId === msg.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    <span className="text-emerald-700 font-bold">
                                      コピー完了！
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-sky-600" />
                                    <span>📋 コピペ用複製</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Reply Input Form & Rich Editor */}
          <div className="flex flex-col h-full overflow-y-auto p-4 sm:p-5 bg-slate-900 space-y-4">
            <form
              onSubmit={handleSendReply}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`flex flex-col flex-1 space-y-3 relative transition-all ${
                isDraggingFile
                  ? "bg-sky-950/80 ring-2 ring-sky-500 ring-inset rounded-xl p-2"
                  : ""
              }`}
            >
              {isDraggingFile && (
                <div className="absolute inset-0 z-20 bg-sky-500/10 backdrop-blur-2xs border-2 border-dashed border-sky-500 rounded-xl flex items-center justify-center text-sky-300 font-bold text-xs gap-2 pointer-events-none">
                  <Upload className="w-5 h-5 animate-bounce" />
                  <span>ここにファイルをドロップして添付</span>
                </div>
              )}

              <div className="flex items-center justify-between text-xs pb-1 border-b border-slate-800">
                <span className="font-extrabold text-slate-200 flex items-center gap-1.5 text-sm">
                  <Paperclip className="w-4 h-4 text-sky-400" />
                  返信メッセージ投稿・追加見積入力
                </span>
                <span className="text-[11px] text-sky-400 font-bold flex items-center gap-1 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800">
                  <Table className="w-3 h-3 text-sky-400" />
                  Excelコピペ / ドロップ対応
                </span>
              </div>

              {/* Unified Rich Editor for Reply with spacious height */}
              <div className="flex-1 min-h-[260px]">
                <UnifiedRichEditor
                  value={replyText}
                  onChange={setReplyText}
                  placeholder="返信内容、見積金額表、フライトスケジュールを記載... (@担当者メンション・Excel表コピペ対応)"
                  minHeight="260px"
                  staffMembers={staffMembers}
                />
              </div>

              {/* Hidden File Input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileInputChange}
                className="hidden"
              />

              {/* File Upload Trigger & Link Attachment */}
              <div className="space-y-2 pt-1 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors shadow-2xs"
                  >
                    <Paperclip className="w-3.5 h-3.5 text-sky-400" />
                    <span>ファイル選択</span>
                  </button>

                  <input
                    type="text"
                    placeholder="参考リンク名"
                    value={linkTitleInput}
                    onChange={(e) => setLinkTitleInput(e.target.value)}
                    className="w-1/3 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-white placeholder-slate-400"
                  />
                  <input
                    type="url"
                    placeholder="https://..."
                    value={linkUrlInput}
                    onChange={(e) => setLinkUrlInput(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-white placeholder-slate-400"
                  />
                  <button
                    type="button"
                    onClick={handleAddReplyLink}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg text-xs shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" /> リンク
                  </button>
                </div>

                {/* Attached Files List */}
                {attachedFiles.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] text-slate-400 font-extrabold">
                      添付ファイル ({attachedFiles.length} 件):
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {attachedFiles.map((file) => (
                        <span
                          key={file.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-sky-950 text-sky-200 border border-sky-800 rounded-lg font-bold shadow-2xs max-w-full"
                        >
                          <FileIcon className="w-3 h-3 text-sky-400 shrink-0" />
                          <span className="max-w-[280px] truncate" title={file.name}>{file.name}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">({file.size})</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachedFile(file.id)}
                            className="text-slate-400 hover:text-rose-400 ml-0.5 cursor-pointer shrink-0"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Links list */}
                {replyLinks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {replyLinks.map((l, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-800 text-slate-200 border border-slate-700 rounded-md font-bold"
                      >
                        <Link2 className="w-3 h-3 text-sky-400" />
                        {l.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit Button & User attribution */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800 flex-wrap gap-2">
                <span className="text-[11px] text-slate-400 font-bold">
                  投稿者: <span className="font-black text-slate-200">{currentUser.email}</span>
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEmailModalMode("staff_mention");
                      setIsEmailModalOpen(true);
                    }}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 hover:border-sky-500 rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                    title="担当者に直接メール通知を生成・送信"
                  >
                    <Mail className="w-3.5 h-3.5 text-sky-400" />
                    <span>担当者にメール通知</span>
                  </button>

                  <button
                    type="submit"
                    disabled={!replyText.trim() && replyLinks.length === 0 && attachedFiles.length === 0}
                    className="px-6 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-black rounded-xl text-xs shadow-md disabled:opacity-40 transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>返信送信</span>
                  </button>
                </div>
              </div>
            </form>
          </div>

        </div>
      </div>

      {/* Interactive File Preview Modal */}
      <FilePreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />

      {/* Email Notification & Quote Modal */}
      <EmailModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        quote={quote}
        messages={messages}
        staffMembers={staffMembers}
        currentUser={currentUser}
        targetStaff={targetEmailStaff}
        mode={emailModalMode}
      />

      {/* Excel File Content Inspection Warning Modal */}
      {showExcelWarningModal && pendingExcelWarnings.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-amber-500/70 rounded-2xl max-w-lg w-full p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-3 bg-amber-500/20 text-amber-400 rounded-xl shrink-0 border border-amber-500/40 shadow-xs">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-amber-200">
                  添付Excelファイルの内容確認警告
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  添付されたExcelファイルのシート1を精査したところ、送信前に注意が必要なデータが見つかりました。
                </p>
              </div>
            </div>

            <div className="bg-amber-950/50 border border-amber-800/80 rounded-xl p-3.5 space-y-2.5 text-xs">
              <div className="font-bold text-amber-300 flex items-center gap-1.5">
                <span>⚠️ Detection / X-RAY の近くのセルに「1500」が格納されています</span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                {pendingExcelWarnings.map((warn, idx) => (
                  <div key={idx} className="bg-slate-900/90 p-2.5 rounded-lg border border-amber-900/70 text-[11px] space-y-1 shadow-2xs">
                    <div className="font-bold text-slate-200 flex items-center gap-1">
                      <span>ファイル名:</span>
                      <span className="text-sky-300">{warn.fileName}</span>
                      <span className="text-slate-400 text-[10px]">(シート: {warn.sheetName})</span>
                    </div>
                    <div className="text-slate-300">
                      ・キーワード: セル <span className="font-extrabold text-amber-300 bg-amber-950 px-1 py-0.5 rounded border border-amber-800/60">{warn.keywordCell}</span> 「{warn.keywordText}」
                    </div>
                    <div className="text-slate-300">
                      ・検出数値: 近接セル <span className="font-extrabold text-amber-300 bg-amber-950 px-1 py-0.5 rounded border border-amber-800/60">{warn.valueCell}</span> 「{warn.valueText}」
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-slate-300 font-medium leading-relaxed">
              添付内容に誤りがないかご確認ください。このまま送信を継続しますか？ それとも送信を取り消して修正しますか？
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setShowExcelWarningModal(false);
                  setPendingExcelWarnings([]);
                }}
                className="px-4.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-95"
              >
                送信取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExcelWarningModal(false);
                  executeSendReply();
                }}
                className="px-5 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-black rounded-xl text-xs shadow-md transition-all active:scale-95 cursor-pointer"
              >
                送信する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
