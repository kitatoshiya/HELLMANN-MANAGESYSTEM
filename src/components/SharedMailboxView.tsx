import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Mail,
  Send,
  RefreshCw,
  Search,
  Paperclip,
  Reply,
  ReplyAll,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowLeft,
  FileText,
  FileSpreadsheet,
  FileCode,
  ShieldCheck,
  Plus,
  ExternalLink,
  Info,
  Sparkles,
  Inbox,
  SendHorizontal,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  Eye,
  MailCheck,
  Building2,
  X,
  Key,
} from "lucide-react";
import {
  AppTheme,
  SharedMailMessage,
  SharedMailboxStatus,
  UserProfile,
  StaffMember,
  QuotationItem,
  Supplier,
  SupplierInquiryTemplate,
  DEFAULT_SUPPLIER_TEMPLATES,
  INITIAL_DEFAULT_SUPPLIERS,
  ComposeAttachment,
} from "../types";
import { subscribeSuppliers, subscribeEmailTemplates } from "../lib/firebase";
import { UnifiedRichEditor } from "./UnifiedRichEditor";
import { SupplierMasterModal } from "./SupplierMasterModal";
import { EmailTemplateSettingsModal } from "./EmailTemplateSettingsModal";
import { SupplierInquiryModal } from "./SupplierInquiryModal";

export interface MailFolderNode {
  id: string;
  displayName: string;
  parentFolderId: string | null;
  childFolderCount: number;
  unreadItemCount: number;
  totalItemCount: number;
  children: MailFolderNode[];
}

interface SharedMailboxViewProps {
  currentTheme: AppTheme;
  currentUser: UserProfile;
  staffMembers: StaffMember[];
  onBackToKanban: () => void;
  onCreateQuoteFromMail?: (draft: {
    title: string;
    vesselName: string;
    customerName: string;
    airportCodes: string[];
    weightKg?: number;
    notes?: string;
    htmlBody?: string;
  }) => void;
}

// Extract clean HTML body from email (removes outer html/head/meta, comments, scripts and styles while keeping rich tables, images, and layout)
export function extractEmailBodyHtml(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();

  // If plain text (no HTML markup), format as safe paragraphs/linebreaks
  if (!trimmed.includes("<") && !trimmed.includes(">")) {
    return `<p class="my-1 leading-relaxed">${trimmed
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\r\n/g, "<br/>")
      .replace(/\n/g, "<br/>")}</p>`;
  }

  try {
    // 1. Strip all HTML comments (including MS Word conditional comments like <!--[if gte mso 9]>...<![endif]-->)
    let sanitized = raw.replace(/<!--[\s\S]*?-->/gi, "");

    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitized, "text/html");

    // 2. Remove unwanted metadata, script, style, and xml elements that cause CSS/code to leak as text
    doc.querySelectorAll("script, meta, title, link, style, xml, o\\:p").forEach((el) => el.remove());

    const body = doc.body;
    if (body) {
      // 3. Remove any remaining comment nodes in the DOM tree
      const iterator = doc.createNodeIterator(body, NodeFilter.SHOW_COMMENT);
      let commentNode;
      const commentsToRemove: Node[] = [];
      while ((commentNode = iterator.nextNode())) {
        commentsToRemove.push(commentNode);
      }
      commentsToRemove.forEach((c) => c.parentNode?.removeChild(c));

      // 4. Ensure tables have clear borders and clean collapse layout
      doc.querySelectorAll("table").forEach((tbl) => {
        if (!tbl.style.borderCollapse) {
          tbl.style.borderCollapse = "collapse";
        }
      });

      const inner = body.innerHTML.trim();
      if (inner) {
        return inner;
      }
    }
  } catch (err) {
    console.warn("HTML parse error:", err);
  }

  return raw;
}

// Robust helper to safely parse JSON responses and never throw syntax errors on HTML/proxy errors
async function safeFetchJson<T = any>(
  url: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null; errorText?: string }> {
  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        const data = await res.json();
        return {
          ok: res.ok,
          status: res.status,
          data,
          errorText: res.ok ? undefined : data?.error || data?.message || `HTTP ${res.status}`,
        };
      } catch (jsonErr: any) {
        return { ok: false, status: res.status, data: null, errorText: "JSON解析に失敗しました" };
      }
    } else {
      const text = await res.text();
      return {
        ok: false,
        status: res.status,
        data: null,
        errorText: res.status === 404 ? "APIが見つかりません (404)" : `サーバー応答 (${res.status})`,
      };
    }
  } catch (netErr: any) {
    return { ok: false, status: 0, data: null, errorText: `通信エラー: ${netErr.message}` };
  }
}

const deduplicateMessages = (msgs: SharedMailMessage[] = []): SharedMailMessage[] => {
  const seenIds = new Set<string>();
  const result: SharedMailMessage[] = [];

  for (const msg of msgs) {
    if (!msg || !msg.id) continue;
    if (seenIds.has(msg.id)) continue;
    seenIds.add(msg.id);

    const msgTime = new Date(msg.receivedDateTime || msg.sentDateTime || 0).getTime();
    const isDuplicate = result.some((existing) => {
      if (existing.subject === msg.subject && existing.bodyPreview === msg.bodyPreview) {
        const existingTime = new Date(existing.receivedDateTime || existing.sentDateTime || 0).getTime();
        return Math.abs(existingTime - msgTime) < 60000;
      }
      return false;
    });

    if (!isDuplicate) {
      result.push(msg);
    }
  }

  return result;
};

export const SharedMailboxView: React.FC<SharedMailboxViewProps> = ({
  currentTheme,
  currentUser,
  staffMembers,
  onBackToKanban,
  onCreateQuoteFromMail,
}) => {
  // State
  const [folder, setFolder] = useState<"inbox" | "sentitems">("inbox");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("inbox");
  const [selectedFolderName, setSelectedFolderName] = useState<string>("受信トレイ");
  const [folders, setFolders] = useState<MailFolderNode[]>([]);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set(["inbox", "root", "demo-folder-suppliers"]));
  const [isAccountTreeOpen, setIsAccountTreeOpen] = useState<boolean>(true);
  const [isFolderSidebarOpen, setIsFolderSidebarOpen] = useState<boolean>(true);
  const [isLoadingFolders, setIsLoadingFolders] = useState<boolean>(false);

  // Drag and Drop States
  const [draggedMessage, setDraggedMessage] = useState<SharedMailMessage | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [isMovingMessage, setIsMovingMessage] = useState<boolean>(false);

  const [messages, setMessages] = useState<SharedMailMessage[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<SharedMailMessage | null>(null);
  const [status, setStatus] = useState<SharedMailboxStatus | null>(null);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showConfigGuide, setShowConfigGuide] = useState<boolean>(false);
  const [graphError, setGraphError] = useState<{
    status?: number;
    code?: string;
    message?: string;
    isAccessDenied?: boolean;
    isMailboxNotFound?: boolean;
    raw?: string;
  } | null>(null);
  const [isUsingDemoFallback, setIsUsingDemoFallback] = useState<boolean>(false);

  // Compose Modal State
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);
  const [composeTo, setComposeTo] = useState<string>("");
  const [composeCc, setComposeCc] = useState<string>("");
  const [composeBcc, setComposeBcc] = useState<string>("");
  const [composeSubject, setComposeSubject] = useState<string>("");
  const [composeBody, setComposeBody] = useState<string>("");
  const [composeAttachments, setComposeAttachments] = useState<ComposeAttachment[]>([]);
  const [isDraggingOverCompose, setIsDraggingOverCompose] = useState<boolean>(false);
  const composeFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);

  // Attachment Helper Handler for Compose Modal
  const handleAddFilesToCompose = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    const newAttachments: ComposeAttachment[] = [];
    for (const file of fileList) {
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result as string;
            const pureBase64 = res.split(",")[1] || "";
            resolve(pureBase64);
          };
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(file);
        });

        newAttachments.push({
          id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
          contentBytes: base64,
        });
      } catch (err) {
        console.warn("Error reading attached file:", file.name, err);
      }
    }

    if (newAttachments.length > 0) {
      setComposeAttachments((prev) => [...prev, ...newAttachments]);
      showToast(`${newAttachments.length}件のファイルをアタッチしました！`, "success");
    }
  };

  const handleRemoveComposeAttachment = (attId: string) => {
    setComposeAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  // Supplier & Template Assistant States
  const [suppliers, setSuppliers] = useState<Supplier[]>(INITIAL_DEFAULT_SUPPLIERS);
  const [templates, setTemplates] = useState<SupplierInquiryTemplate[]>(DEFAULT_SUPPLIER_TEMPLATES);
  const [isSupplierMasterOpen, setIsSupplierMasterOpen] = useState<boolean>(false);
  const [isTemplateSettingsOpen, setIsTemplateSettingsOpen] = useState<boolean>(false);
  const [isInquiryModalOpen, setIsInquiryModalOpen] = useState<boolean>(false);
  const [inquiryTargetSupplierId, setInquiryTargetSupplierId] = useState<string | undefined>(undefined);
  const [inquiryTargetPattern, setInquiryTargetPattern] = useState<number | undefined>(undefined);
  const [inquirySourceEmail, setInquirySourceEmail] = useState<any | null>(null);

  // Subscribe to Suppliers & Templates Live Firestore / Local Sync
  useEffect(() => {
    const unsubSuppliers = subscribeSuppliers((list) => {
      if (list && list.length > 0) {
        setSuppliers(list);
      }
    });
    const unsubTemplates = subscribeEmailTemplates((list) => {
      if (list && list.length > 0) {
        setTemplates(list);
      }
    });

    return () => {
      unsubSuppliers();
      unsubTemplates();
    };
  }, []);

  // Open Supplier Inquiry Handler
  const handleOpenSupplierInquiry = (supplierId?: string, pattern?: number, sourceMail?: any) => {
    setInquiryTargetSupplierId(supplierId);
    setInquiryTargetPattern(pattern);
    setInquirySourceEmail(sourceMail || null);
    setIsInquiryModalOpen(true);
  };

  // Apply Inquiry Template to Compose Editor
  const handleApplyInquiryToCompose = (params: {
    to: string[];
    cc: string[];
    subject: string;
    bodyHtml: string;
    supplier?: Supplier;
  }) => {
    setComposeTo(params.to.join(", "));
    setComposeCc(params.cc.join(", "));
    setComposeBcc("");
    setComposeSubject(params.subject);
    setComposeBody(params.bodyHtml);
    setComposeAttachments([]);
    setIsComposeOpen(true);
    showToast("サプライヤー問合せひな型をメール作成画面に反映しました！", "success");
  };

  // Toast Helper
  const showToast = useCallback((text: string, type: "success" | "error" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // Fetch Microsoft 365 status
  const fetchStatus = useCallback(async (refresh = false) => {
    try {
      const res = await safeFetchJson<SharedMailboxStatus>(`/api/shared-mail/status${refresh ? "?refresh=true" : ""}`);
      if (res.ok && res.data) {
        setStatus(res.data);
      }
    } catch (e) {
      console.warn("Failed to check Microsoft 365 status:", e);
    }
  }, []);

  // Fetch Folder Tree Hierarchy (Web Outlook Style)
  const fetchFolders = useCallback(async (refresh = false) => {
    setIsLoadingFolders(true);
    try {
      const res = await safeFetchJson<{
        success?: boolean;
        mailbox?: string;
        folders?: MailFolderNode[];
        isLive?: boolean;
      }>(`/api/shared-mail/folders${refresh ? "?refresh=true" : ""}`);

      if (res.ok && res.data?.folders) {
        setFolders(res.data.folders);
        // Expand inbox and supplier folders by default
        setExpandedFolderIds((prev) => {
          const next = new Set(prev);
          next.add("root");
          const expandRecursive = (list: MailFolderNode[]) => {
            for (const f of list) {
              if (
                f.displayName === "受信トレイ" ||
                f.displayName === "サプライヤー" ||
                f.id === "inbox" ||
                f.id === "demo-folder-suppliers"
              ) {
                next.add(f.id);
              }
              if (f.children && f.children.length > 0) {
                expandRecursive(f.children);
              }
            }
          };
          expandRecursive(res.data!.folders!);
          return next;
        });
      }
    } catch (e) {
      console.warn("Failed to fetch folders:", e);
    } finally {
      setIsLoadingFolders(false);
    }
  }, []);

  // Fetch Messages list
  const fetchMessages = useCallback(
    async (
      targetFolderId = selectedFolderId,
      query = searchQuery,
      forceDemo = isUsingDemoFallback,
      refresh = false
    ) => {
      setIsLoadingList(true);
      try {
        const params = new URLSearchParams();
        if (targetFolderId === "inbox") {
          params.append("folder", "inbox");
        } else if (targetFolderId === "sentitems") {
          params.append("folder", "sentitems");
        } else {
          params.append("folderId", targetFolderId);
        }

        if (query.trim()) {
          params.append("search", query.trim());
        }
        if (forceDemo) {
          params.append("demo", "true");
        }
        if (refresh) {
          params.append("refresh", "true");
        }
        const res = await safeFetchJson<{
          success?: boolean;
          messages?: SharedMailMessage[];
          demoFallbackMessages?: SharedMailMessage[];
          mailbox?: string;
          isLive?: boolean;
          graphError?: {
            status?: number;
            code?: string;
            message?: string;
            isAccessDenied?: boolean;
            isMailboxNotFound?: boolean;
            raw?: string;
          };
          authError?: string;
          isSecretIdError?: boolean;
          note?: string;
        }>(`/api/shared-mail/messages?${params.toString()}`);

        if (res.ok && res.data) {
          const data = res.data;

          if (data.graphError) {
            setGraphError(data.graphError);
            if (forceDemo && data.demoFallbackMessages) {
              setMessages(deduplicateMessages(data.demoFallbackMessages));
            } else {
              setMessages(deduplicateMessages(data.messages || []));
            }
          } else {
            setGraphError(null);
            setMessages(deduplicateMessages(data.messages || []));
          }

          if (data.authError) {
            setStatus((prev) => ({
              configured: true,
              tenantIdConfigured: true,
              clientIdConfigured: true,
              clientSecretConfigured: true,
              connected: false,
              isSecretIdError: Boolean(data.isSecretIdError),
              error: data.authError,
              sharedMailbox: prev?.sharedMailbox,
            }));
          }

          const currentList =
            forceDemo && data.demoFallbackMessages
              ? data.demoFallbackMessages
              : data.messages || [];

          // Automatically select the first message if none selected
          setSelectedMessageId((prevId) => {
            if (currentList.length > 0) {
              if (!prevId || !currentList.some((m) => m.id === prevId)) {
                return currentList[0].id;
              }
              return prevId;
            } else {
              setSelectedMessage(null);
              return null;
            }
          });
        } else {
          showToast(res.errorText || "メール一覧の取得に失敗しました", "error");
        }
      } catch (e: any) {
        showToast(`通信エラー: ${e.message}`, "error");
      } finally {
        setIsLoadingList(false);
      }
    },
    [isUsingDemoFallback, showToast]
  );

  const handleSelectFolder = useCallback((targetFolder: MailFolderNode) => {
    setSelectedFolderId(targetFolder.id);
    setSelectedFolderName(targetFolder.displayName);
    if (targetFolder.id === "sentitems" || targetFolder.displayName === "送信済みアイテム") {
      setFolder("sentitems");
    } else {
      setFolder("inbox");
    }
    fetchMessages(targetFolder.id, searchQuery);
  }, [searchQuery, fetchMessages]);

  // Toggle folder expand/collapse
  const toggleFolderExpand = useCallback((fId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(fId)) {
        next.delete(fId);
      } else {
        next.add(fId);
      }
      return next;
    });
  }, []);

  // Drop message to move to another folder
  const handleDropOnFolder = useCallback(async (destinationFolder: MailFolderNode) => {
    if (!draggedMessage) return;
    const msgToMove = draggedMessage;
    setDraggedMessage(null);
    setDragOverFolderId(null);

    // If dropping onto currently selected folder, skip
    if (destinationFolder.id === selectedFolderId) {
      return;
    }

    // Optimistic UI update: Remove from current messages list
    setMessages((prev) => prev.filter((m) => m.id !== msgToMove.id));
    if (selectedMessageId === msgToMove.id) {
      setSelectedMessageId(null);
      setSelectedMessage(null);
    }

    showToast(
      `「${msgToMove.subject.slice(0, 16)}...」を「${destinationFolder.displayName}」へ移動中...`,
      "success"
    );

    setIsMovingMessage(true);
    try {
      const res = await safeFetchJson(
        `/api/shared-mail/messages/${encodeURIComponent(msgToMove.id)}/move`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destinationId: destinationFolder.id }),
        }
      );

      if (res.ok) {
        showToast(
          `「${msgToMove.subject.slice(0, 16)}」を「${destinationFolder.displayName}」へ移動しました`,
          "success"
        );
        fetchFolders(true);
      } else {
        showToast(`移動に失敗しました: ${res.errorText || "エラー"}`, "error");
        fetchMessages(selectedFolderId, searchQuery);
      }
    } catch (err: any) {
      showToast(`移動エラー: ${err.message}`, "error");
      fetchMessages(selectedFolderId, searchQuery);
    } finally {
      setIsMovingMessage(false);
    }
  }, [draggedMessage, selectedFolderId, selectedMessageId, searchQuery, showToast, fetchFolders, fetchMessages]);

  // Fetch single message detail
  const fetchMessageDetail = useCallback(async (msgId: string) => {
    setIsLoadingDetail(true);
    try {
      const res = await safeFetchJson<SharedMailMessage>(`/api/shared-mail/messages/${encodeURIComponent(msgId)}`);
      if (res.ok && res.data) {
        setSelectedMessage(res.data);

        // If unread, mark it as read in the local list
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, isRead: true } : m))
        );
      } else {
        showToast(res.errorText || "メール詳細の取得に失敗しました。", "error");
      }
    } catch (e: any) {
      showToast(`詳細取得エラー: ${e.message}`, "error");
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchFolders();
    fetchMessages(selectedFolderId, searchQuery, isUsingDemoFallback);
  }, [fetchStatus, fetchFolders, fetchMessages, selectedFolderId, isUsingDemoFallback]);

  useEffect(() => {
    if (selectedMessageId) {
      fetchMessageDetail(selectedMessageId);
    }
  }, [selectedMessageId, fetchMessageDetail]);

  // Toggle Read Status
  const handleToggleReadStatus = async () => {
    if (!selectedMessage) return;
    const newStatus = !selectedMessage.isRead;
    try {
      const res = await safeFetchJson(
        `/api/shared-mail/messages/${encodeURIComponent(selectedMessage.id)}/read-status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isRead: newStatus }),
        }
      );
      if (res.ok) {
        setSelectedMessage((prev) => (prev ? { ...prev, isRead: newStatus } : null));
        setMessages((prev) =>
          prev.map((m) => (m.id === selectedMessage.id ? { ...m, isRead: newStatus } : m))
        );
        showToast(newStatus ? "既読に設定しました" : "未読に設定しました");
      } else {
        showToast(res.errorText || "ステータス変更に失敗しました", "error");
      }
    } catch (e) {
      showToast("ステータス変更に失敗しました", "error");
    }
  };

  // Open Compose Modal for New Email
  const handleOpenNewCompose = () => {
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject("");
    setComposeBody(
      `<p class="my-1">お世話になっております。<br>東京エアカーゴ / 船用品手配チームの ${currentUser.name} でございます。</p><p class="my-1"><br></p><p class="my-1 text-slate-500 font-mono text-xs">--------------------<br>TOKYO AIRCARGO CO., LTD.<br>SHIPS PARTS TEAM</p>`
    );
    setComposeAttachments([]);
    setIsComposeOpen(true);
  };

  // Open Compose Modal for Reply
  const handleOpenReply = (replyAll = false) => {
    if (!selectedMessage) return;
    const fromAddr = selectedMessage.from?.address || "";
    setComposeTo(fromAddr);

    if (replyAll) {
      const otherRecipients = [
        ...selectedMessage.toRecipients.map((r) => r.address),
        ...selectedMessage.ccRecipients.map((r) => r.address),
      ].filter(
        (addr) =>
          addr.toLowerCase() !== fromAddr.toLowerCase() &&
          addr.toLowerCase() !== (status?.sharedMailbox || "").toLowerCase()
      );
      setComposeCc(otherRecipients.join(", "));
    } else {
      setComposeCc("");
    }

    setComposeBcc("");

    const origSub = selectedMessage.subject;
    setComposeSubject(origSub.toLowerCase().startsWith("re:") ? origSub : `Re: ${origSub}`);

    // Clean original message HTML body (keeps tables, borders, images, styles intact)
    const rawMail = selectedMessage.bodyHtml || selectedMessage.bodyText || selectedMessage.bodyPreview || "";
    const cleanOrigHtml = extractEmailBodyHtml(rawMail);

    const fromDisplay = selectedMessage.from?.name
      ? `${selectedMessage.from.name} &lt;${selectedMessage.from.address}&gt;`
      : selectedMessage.from?.address || "";

    const sentDisplay = selectedMessage.receivedDateTime
      ? new Date(selectedMessage.receivedDateTime).toLocaleString("ja-JP")
      : "";

    const toDisplay = (selectedMessage.toRecipients || [])
      .map((r) => (r.name ? `${r.name} &lt;${r.address}&gt;` : r.address))
      .join(", ");

    const initialReplyHtml = `
      <p class="my-1">お世話になっております。<br>ご連絡ありがとうございます。</p>
      <p class="my-1"><br></p>
      <hr style="border: none; border-top: 1px solid #cbd5e1; margin: 16px 0;" />
      <div style="font-size: 11px; color: #475569; background-color: #f1f5f9; padding: 10px 14px; border-radius: 6px; border-left: 4px solid #3b82f6; margin-bottom: 12px; line-height: 1.6;">
        <div style="font-weight: bold; margin-bottom: 4px; color: #1e293b;">----- Original Message -----</div>
        <div><strong>From:</strong> ${fromDisplay}</div>
        <div><strong>Sent:</strong> ${sentDisplay}</div>
        ${toDisplay ? `<div><strong>To:</strong> ${toDisplay}</div>` : ""}
        <div><strong>Subject:</strong> ${selectedMessage.subject || ""}</div>
      </div>
      <div class="quoted-original-mail" style="border-left: 2px solid #cbd5e1; padding-left: 12px; margin-left: 4px;">
        ${cleanOrigHtml}
      </div>
    `.trim();

    setComposeBody(initialReplyHtml);
    setComposeAttachments([]);
    setIsComposeOpen(true);
  };

  // Send Email Handler
  const handleSendMail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending) return;

    if (!composeTo.trim()) {
      showToast("宛先 (To) を入力してください。", "error");
      return;
    }
    if (!composeSubject.trim()) {
      showToast("件名を入力してください。", "error");
      return;
    }

    setIsSending(true);
    try {
      const toArray = composeTo
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const ccArray = composeCc
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const bccArray = composeBcc
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);

      // Extract plain text representation for fallback
      let plainTextFallback = "";
      try {
        const temp = document.createElement("div");
        temp.innerHTML = composeBody;
        plainTextFallback = temp.innerText || temp.textContent || "";
      } catch (e) {
        plainTextFallback = composeBody.replace(/<[^>]+>/g, "");
      }

      const res = await safeFetchJson<{ message?: string; error?: string }>("/api/shared-mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toArray,
          cc: ccArray,
          bcc: bccArray,
          subject: composeSubject,
          bodyText: plainTextFallback,
          bodyHtml: composeBody,
          attachments: composeAttachments,
        }),
      });

      if (res.ok && res.data) {
        showToast(res.data.message || "メールを送信しました！", "success");
        setIsComposeOpen(false);
        setComposeAttachments([]);
        // Refresh message list
        fetchMessages(folder, searchQuery, isUsingDemoFallback);
      } else {
        showToast(`送信エラー: ${res.errorText || "送信できませんでした"}`, "error");
      }
    } catch (e: any) {
      showToast(`送信エラー: ${e.message}`, "error");
    } finally {
      setIsSending(false);
    }
  };

  // Create Quote from this email (Smart Parse & Full Body Transfer)
  const handleCreateQuoteFromCurrentMail = async () => {
    if (!selectedMessage) return;

    let targetMsg = selectedMessage;

    // もし詳細本文（bodyText/bodyHtml）が未ロードの場合は即座にAPIから取得
    if (!targetMsg.bodyText && !targetMsg.bodyHtml) {
      try {
        const detailRes = await safeFetchJson<SharedMailMessage>(
          `/api/shared-mail/messages/${encodeURIComponent(selectedMessage.id)}`
        );
        if (detailRes.ok && detailRes.data) {
          targetMsg = detailRes.data;
          setSelectedMessage(detailRes.data);
        }
      } catch (err) {
        console.warn("Failed to fetch full message body for quote creation:", err);
      }
    }

    // メール本文のテキストを解析用に取得
    let textForParsing = targetMsg.bodyText || "";
    if (!textForParsing && targetMsg.bodyHtml) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = targetMsg.bodyHtml;
      textForParsing = tempDiv.innerText || tempDiv.textContent || "";
    }
    if (!textForParsing) {
      textForParsing = targetMsg.bodyPreview || "";
    }

    const textToAnalyze = `${targetMsg.subject} ${textForParsing}`;

    // Extract vessel name: looks for M/V [NAME] or M.V. [NAME]
    let vessel = "";
    const mvMatch = textToAnalyze.match(/M[\/.]?[Vv]\.?\s+([A-Z0-9\s\-]+?)(?=\s|,|\/|\)|\n|$)/i);
    if (mvMatch) {
      vessel = `M/V ${mvMatch[1].trim().toUpperCase()}`;
    }

    // Extract airport codes: 3-letter uppercase like SIN, RTM, DXB, KIX, NRT
    const airportMatches = textToAnalyze.match(/\b(SIN|RTM|DXB|KIX|NRT|HND|FRA|LHR|ICN|PVG|BKK|HKG|LAX|ORD|JFK)\b/gi);
    const airportCodes = airportMatches
      ? Array.from(new Set(airportMatches.map((c) => c.toUpperCase())))
      : [];

    // Extract weight
    let weightKg: number | undefined = undefined;
    const weightMatch = textToAnalyze.match(/([0-9,.]+)\s*(?:kg|kgs|キロ)/i);
    if (weightMatch) {
      const parsed = parseFloat(weightMatch[1].replace(/,/g, ""));
      if (!isNaN(parsed) && parsed > 0) {
        weightKg = parsed;
      }
    }

    const customerName = targetMsg.from?.name || targetMsg.from?.address?.split("@")[1] || "荷主・船主";

    // メール本文のHTML内容を取得（表・罫線・画像・装飾を完全保持し、不要ヘッダーは付与しない）
    const rawMailContent = targetMsg.bodyHtml || targetMsg.bodyText || targetMsg.bodyPreview || "";
    const cleanMailHtml = extractEmailBodyHtml(rawMailContent);

    if (onCreateQuoteFromMail) {
      onCreateQuoteFromMail({
        title: targetMsg.subject.replace(/^(【至急見積依頼】|【見積依頼】|Re:\s*|Fwd:\s*)/i, "").trim(),
        vesselName: vessel,
        customerName: customerName,
        airportCodes: airportCodes.length > 0 ? airportCodes : ["SIN"],
        weightKg,
        notes: cleanMailHtml,
        htmlBody: cleanMailHtml,
      });
      showToast("メール内容（表・画像・装飾）を反映した見積作成画面を開きました！", "success");
    } else {
      showToast("見積作成連携ハンドラーが接続されていません。", "error");
    }
  };

  // Render single folder node recursively (Outlook Web style tree)
  const renderFolderItem = (item: MailFolderNode, depth = 0): React.ReactNode => {
    const isSelected = selectedFolderId === item.id;
    const isExpanded = expandedFolderIds.has(item.id);
    const hasChildren = Boolean(item.children && item.children.length > 0);
    const isDragTarget = dragOverFolderId === item.id;

    // Detect folder icon type
    const isInbox = item.id === "inbox" || item.displayName === "受信トレイ";
    const isSent = item.id === "sentitems" || item.displayName === "送信済みアイテム";

    return (
      <div key={item.id} className="select-none text-xs">
        <div
          onClick={() => handleSelectFolder(item)}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOverFolderId(item.id);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            if (dragOverFolderId === item.id) {
              setDragOverFolderId(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            handleDropOnFolder(item);
          }}
          style={{ paddingLeft: `${Math.max(depth * 14 + 4, 4)}px` }}
          className={`flex items-center justify-between pr-2 py-1.5 rounded-md cursor-pointer transition-all group relative ${
            isDragTarget
              ? "bg-sky-200 dark:bg-sky-900/80 ring-2 ring-sky-500 font-bold scale-[1.01]"
              : isSelected
              ? currentTheme === "light"
                ? "bg-slate-200/90 text-slate-950 font-bold shadow-xs"
                : "bg-slate-800 text-white font-bold"
              : currentTheme === "light"
              ? "hover:bg-slate-100/90 text-slate-800"
              : "hover:bg-slate-800/50 text-slate-300"
          }`}
          title={`${item.displayName}${item.totalItemCount > 0 ? ` (${item.totalItemCount}件)` : ""}`}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {/* Expand / Collapse Chevron Button */}
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => toggleFolderExpand(item.id, e)}
                className="p-0.5 hover:bg-slate-300/60 dark:hover:bg-slate-600 rounded text-slate-500 transition-colors"
                title={isExpanded ? "折りたたむ" : "展開する"}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                )}
              </button>
            ) : (
              <span className="w-4.5 shrink-0" />
            )}

            {/* Folder Icon */}
            {isInbox ? (
              <Inbox className="w-4 h-4 text-blue-600 shrink-0" />
            ) : isSent ? (
              <SendHorizontal className="w-4 h-4 text-sky-600 shrink-0" />
            ) : isExpanded ? (
              <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-amber-500 shrink-0" />
            )}

            {/* Folder Display Name */}
            <span className="truncate leading-tight font-medium">
              {item.displayName}
            </span>
          </div>

          {/* Counts Badge */}
          {item.unreadItemCount > 0 ? (
            <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 shrink-0 ml-1.5">
              {item.unreadItemCount}
            </span>
          ) : item.totalItemCount > 0 && depth === 0 ? (
            <span className="text-[10px] text-slate-400 shrink-0 ml-1.5">
              {item.totalItemCount}
            </span>
          ) : null}
        </div>

        {/* Child Folders (if expanded) */}
        {hasChildren && isExpanded && (
          <div className="space-y-0.5 mt-0.5">
            {item.children.map((child) => renderFolderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Format date display
  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const isToday =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();

      if (isToday) {
        return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      }
      return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    } catch {
      return dateStr;
    }
  };

  // Helper for attachment icon
  const getAttachmentIcon = (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return <FileText className="w-4 h-4 text-red-500 shrink-0" />;
    if (ext === "xlsx" || ext === "xls" || ext === "csv")
      return <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />;
    return <FileCode className="w-4 h-4 text-sky-500 shrink-0" />;
  };

  // Format bytes
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const unreadCount = useMemo(() => {
    return messages.filter((m) => !m.isRead).length;
  }, [messages]);

  return (
    <div className={`flex flex-col h-[calc(100vh-65px)] w-full overflow-hidden ${
      currentTheme === "light"
        ? "bg-slate-50 text-slate-900"
        : currentTheme === "digital"
        ? "bg-[#030906] text-emerald-300 font-mono"
        : "bg-slate-950 text-slate-100"
    }`}>
      {/* Top Header & Toolbar */}
      <div className={`px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap shrink-0 ${
        currentTheme === "light"
          ? "bg-white border-slate-200"
          : currentTheme === "digital"
          ? "bg-emerald-950/40 border-emerald-900/60"
          : "bg-slate-900/90 border-slate-800"
      }`}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToKanban}
            className={`p-1.5 rounded-lg border transition-colors flex items-center gap-1 text-xs font-bold ${
              currentTheme === "light"
                ? "bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300"
                : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
            }`}
            title="カンバン画面に戻る"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">カンバンへ</span>
          </button>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-sky-500 flex items-center justify-center text-white shadow-xs">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-sm sm:text-base leading-tight">
                  共通メールボックス (Microsoft 365)
                </h1>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white animate-pulse">
                    未読 {unreadCount}件
                  </span>
                )}
              </div>
              <p className="text-[11px] opacity-70 leading-none mt-0.5">
                {status?.sharedMailbox ? (
                  <span>対象: <strong className="font-mono">{status.sharedMailbox}</strong></span>
                ) : (
                  <span>Exchange Online / 共有メールボックス連携</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Right Actions & Status Badges */}
        <div className="flex items-center gap-2">
          {/* Connection Status Indicator */}
          {graphError?.isAccessDenied || status?.needsApiPermissions ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-100 dark:bg-blue-900/60 border border-blue-300 dark:border-blue-700 text-blue-900 dark:text-blue-100 text-xs font-bold">
              <Key className="w-3.5 h-3.5 text-blue-700 dark:text-blue-300" />
              <span>Azure APIアクセス許可が必要</span>
            </div>
          ) : status?.configured && status?.connected ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>M365 接続中</span>
            </div>
          ) : status?.isSecretIdError || (status?.error && (status.error.includes("シークレット ID") || status.error.includes("AADSTS7000215"))) ? (
            <button
              type="button"
              onClick={() => setShowConfigGuide(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-950 text-xs font-bold transition-colors cursor-pointer animate-pulse"
              title="クライアントシークレットの修正が必要です。クリックして手順を確認"
            >
              <AlertCircle className="w-3.5 h-3.5 text-amber-700" />
              <span>シークレット値の設定要修正</span>
            </button>
          ) : status?.configured ? (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold cursor-pointer"
              onClick={() => setShowConfigGuide(true)}
              title={status.error || "認証確認中"}
            >
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              <span>M365 設定検証中</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowConfigGuide(!showConfigGuide)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 text-xs font-bold transition-colors cursor-pointer"
            >
              <Info className="w-3.5 h-3.5 text-blue-600" />
              <span>接続設定ガイド</span>
            </button>
          )}

          {/* Refresh button */}
          <button
            type="button"
            onClick={() => {
              fetchStatus(true);
              fetchMessages(folder, searchQuery, isUsingDemoFallback, true);
            }}
            disabled={isLoadingList}
            className={`p-2 rounded-lg border transition-all text-xs font-bold flex items-center gap-1 ${
              currentTheme === "light"
                ? "bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300"
                : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
            }`}
            title="最新メールを取得"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? "animate-spin text-sky-500" : ""}`} />
            <span className="hidden md:inline">更新</span>
          </button>

          {/* Supplier Master Button */}
          <button
            type="button"
            onClick={() => setIsSupplierMasterOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors cursor-pointer shadow-2xs ${
              currentTheme === "light"
                ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800"
                : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
            }`}
            title="サプライヤーマスタ管理（担当者最大5名・連絡先登録）"
          >
            <Building2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden sm:inline">サプライヤーマスタ</span>
          </button>

          {/* Inquiry Template Settings Button */}
          <button
            type="button"
            onClick={() => setIsTemplateSettingsOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors cursor-pointer shadow-2xs ${
              currentTheme === "light"
                ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800"
                : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
            }`}
            title="問合せひな型設定（見積・通関・出荷確定など）"
          >
            <FileCode className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span className="hidden sm:inline">ひな型設定</span>
          </button>

          {/* Supplier Inquiry Launcher Button */}
          <button
            type="button"
            onClick={() => handleOpenSupplierInquiry()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-sm transition-transform active:scale-95 cursor-pointer"
            title="サプライヤー宛ての問合せメールをひな型から簡単作成"
          >
            <Building2 className="w-4 h-4 text-indigo-200" />
            <span>サプライヤー問合せ</span>
          </button>

          {/* New Mail Compose Button */}
          <button
            type="button"
            onClick={handleOpenNewCompose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700 text-white text-xs font-bold shadow-xs transition-transform active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>新規メール作成</span>
          </button>
        </div>
      </div>

      {/* Config Guide Banner (if opened or unconfigured) */}
      {showConfigGuide && (
        <div className={`p-4 border-b text-xs transition-all ${
          currentTheme === "light"
            ? "bg-sky-50/80 border-sky-200 text-slate-800"
            : "bg-sky-950/40 border-sky-800/80 text-sky-200"
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2 max-w-4xl">
              <div className="flex items-center gap-2 font-bold text-sm text-sky-900 dark:text-sky-300">
                <ShieldCheck className="w-4 h-4 text-sky-600" />
                <span>Microsoft 365 連携設定状況（Entra ID / Azure Portal）</span>
              </div>
              <p className="leading-relaxed">
                Azure Portalで発行されたクライアントID、テナントID、シークレット値を環境変数に登録することで、本番の共通メールアドレスと完全に直通接続されます。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 pt-1 font-mono text-[11px]">
                <div className="p-2 rounded bg-white/80 dark:bg-slate-900/80 border border-sky-200 dark:border-sky-800">
                  <span className="text-[10px] text-slate-500 block">MICROSOFT_TENANT_ID</span>
                  <span className="font-bold flex items-center gap-1">
                    {status?.tenantIdConfigured ? (
                      <span className="text-emerald-600 flex items-center gap-0.5"><Check className="w-3 h-3" /> 設定済</span>
                    ) : (
                      <span className="text-rose-500">未設定</span>
                    )}
                  </span>
                </div>
                <div className="p-2 rounded bg-white/80 dark:bg-slate-900/80 border border-sky-200 dark:border-sky-800">
                  <span className="text-[10px] text-slate-500 block">MICROSOFT_CLIENT_ID</span>
                  <span className="font-bold flex items-center gap-1">
                    {status?.clientIdConfigured ? (
                      <span className="text-emerald-600 flex items-center gap-0.5"><Check className="w-3 h-3" /> 設定済</span>
                    ) : (
                      <span className="text-rose-500">未設定</span>
                    )}
                  </span>
                </div>
                <div className={`p-2 rounded bg-white/80 dark:bg-slate-900/80 border ${
                  status?.isSecretIdError ? "border-amber-400 bg-amber-50/50" : "border-sky-200 dark:border-sky-800"
                }`}>
                  <span className="text-[10px] text-slate-500 block">MICROSOFT_CLIENT_SECRET</span>
                  <span className="font-bold flex items-center gap-1">
                    {status?.isSecretIdError ? (
                      <span className="text-amber-600 text-[10px] flex items-center gap-0.5">⚠️ 値(Value)が必要</span>
                    ) : status?.clientSecretConfigured ? (
                      <span className="text-emerald-600 flex items-center gap-0.5"><Check className="w-3 h-3" /> 設定済</span>
                    ) : (
                      <span className="text-rose-500">未設定</span>
                    )}
                  </span>
                </div>
                <div className="p-2 rounded bg-white/80 dark:bg-slate-900/80 border border-sky-200 dark:border-sky-800">
                  <span className="text-[10px] text-slate-500 block">MICROSOFT_SHARED_MAILBOX</span>
                  <span className="font-bold truncate">
                    {status?.sharedMailbox ? status.sharedMailbox : <span className="text-amber-500">未指定（任意）</span>}
                  </span>
                </div>
              </div>
              {!status?.configured && (
                <div className="text-[11px] text-sky-800 dark:text-sky-300 font-sans mt-1">
                  ※現在は<strong>デモ・シミュレーションモード</strong>で動作しており、メールの閲覧・返信・見積起票などの全UIフローを今すぐお試しいただけます。
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowConfigGuide(false)}
              className="p-1 rounded hover:bg-sky-200/50 text-slate-500 hover:text-slate-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Secret ID vs Secret Value Guidance Notice */}
      {(status?.isSecretIdError || (status?.error && (status.error.includes("シークレット ID") || status.error.includes("AADSTS7000215")))) && (
        <div className="mx-4 mt-3 mb-1 p-3.5 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/50 dark:border-amber-700/80 text-amber-900 dark:text-amber-200 shadow-sm shrink-0">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-200/80 dark:bg-amber-900/60 rounded-lg text-amber-900 dark:text-amber-200 shrink-0 mt-0.5">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="flex-1 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-extrabold text-sm text-amber-950 dark:text-amber-100 flex items-center gap-1.5">
                  【設定の修正が必要です】MICROSOFT_CLIENT_SECRET に「シークレット ID」が入力されています
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                  現在はデモトレイを表示中
                </span>
              </div>
              <p className="leading-relaxed">
                Azure Portal の「証明書とシークレット」で作成された際、表の <strong>「シークレット ID」</strong> ではなく <strong>「値 (Value)」</strong> の文字列をコピーする必要があります。
              </p>
              <div className="p-3 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-amber-200 dark:border-amber-800 space-y-1.5 font-sans">
                <p className="font-bold text-slate-800 dark:text-slate-100 text-[11px]">
                  📌 修正手順（Azure Portal）:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                  <li>
                    <a
                      href="https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 dark:text-sky-400 underline font-bold inline-flex items-center gap-0.5"
                    >
                      Azure Portal (アプリの登録) <ExternalLink className="w-3 h-3 inline" />
                    </a>
                    を開き、対象のアプリを選択します。
                  </li>
                  <li>左メニューの <strong>「証明書とシークレット」</strong> をクリックします。</li>
                  <li>
                    <strong>「＋ 新しいクライアント シークレット」</strong> ボタンを押し、説明を入力して「追加」を押します。
                  </li>
                  <li>
                    表に追加された行の <strong>「値 (Value)」</strong> 列（※「シークレット ID」列ではありません）をコピーします。
                  </li>
                  <li>
                    AI Studio 画面の「Settings」→「Environment Variables」で <strong>MICROSOFT_CLIENT_SECRET</strong> をこの値に更新して保存します。
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Azure API Permissions (Mail.ReadWrite / Admin Consent) Guidance Notice */}
      {(graphError?.isAccessDenied || status?.needsApiPermissions) && (
        <div className="mx-4 mt-3 mb-1 p-4 rounded-xl border border-blue-300 bg-blue-50/95 dark:bg-slate-900 dark:border-blue-700 text-slate-800 dark:text-slate-200 shadow-sm shrink-0">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-200/80 dark:bg-blue-900/60 rounded-lg text-blue-800 dark:text-blue-300 shrink-0 mt-0.5">
              <Key className="w-5 h-5" />
            </div>
            <div className="flex-1 text-xs space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-extrabold text-sm text-blue-950 dark:text-blue-100 flex items-center gap-1.5">
                  🔑【Azure の API アクセス許可 と 管理者の同意 が必要です】
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextVal = !isUsingDemoFallback;
                      setIsUsingDemoFallback(nextVal);
                      fetchMessages(folder, searchQuery, nextVal);
                    }}
                    className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer shadow-xs"
                  >
                    {isUsingDemoFallback ? "実メール接続に戻す" : "デモメールを表示して画面を試す"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      fetchStatus();
                      fetchMessages(folder, searchQuery, false);
                    }}
                    className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                  >
                    <RefreshCw className="w-3 h-3" />
                    再確認する
                  </button>
                </div>
              </div>

              <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                テナントID・クライアントID・シークレット値の認証は<strong>正常に成功</strong>しました！
                ただし、Azure Entra ID でアプリに<strong>「メールの読み取り・送信許可 (Mail.ReadWrite)」</strong>が付与されていないか、<strong>「管理者の同意」</strong>がまだ実行されていないため、Microsoft Graph API へのアクセスが保留（403 Access Denied）となっています。
              </p>

              <div className="p-3.5 rounded-lg bg-white/95 dark:bg-slate-950/80 border border-blue-200 dark:border-blue-800/80 space-y-2 font-sans">
                <p className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-1.5">
                  <span>📌 解決手順（Azure Portal での操作・所要時間 約1分）:</span>
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                  <li>
                    <a
                      href="https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 dark:text-sky-400 font-bold underline inline-flex items-center gap-1"
                    >
                      Azure Portal (アプリの登録) <ExternalLink className="w-3 h-3 inline" />
                    </a>
                    を開き、登録したアプリ（ACE-Mail 等）をクリックします。
                  </li>
                  <li>
                    左メニューの <strong>「API のアクセス許可」</strong> をクリックします。
                  </li>
                  <li>
                    <strong>「＋ アクセス許可の追加」</strong> をクリック → <strong>「Microsoft Graph」</strong> を選択します。
                  </li>
                  <li>
                    <strong>「アプリケーションの許可」</strong> を選択します（※「委任されたアクセス許可」ではありません）。
                  </li>
                  <li>
                    検索バーに <code>Mail</code> と入力し、以下にチェックを入れて「アクセス許可の追加」をクリックします：
                    <div className="ml-5 mt-1 flex flex-wrap gap-2">
                      <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-200 font-mono font-bold text-[11px]">
                        Mail.ReadWrite
                      </span>
                      <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-200 font-mono font-bold text-[11px]">
                        Mail.Send
                      </span>
                    </div>
                  </li>
                  <li className="text-amber-800 dark:text-amber-300 font-bold bg-amber-50 dark:bg-amber-950/40 p-1.5 rounded border border-amber-200 dark:border-amber-800">
                    ⚠️【最重要】アクセス許可一覧の上にある <strong>「【テナント名】に管理者の同意を与えます」</strong> ボタンをクリックし、「はい」を選択します。（状態列に緑のチェックマーク ✅ が付けば完了です）
                  </li>
                  <li>
                    完了後、右上の <strong>「再確認する」</strong> ボタンを押すと、共通メールアドレス <strong>{status?.sharedMailbox || "osaeig1@tac-japan.co.jp"}</strong> の実メールが即座に読み込まれます。
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Mail 3-Pane Split View Container */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Leftmost Pane: Folder Tree Hierarchy (Web Outlook Style) */}
        <div
          className={`${
            isFolderSidebarOpen ? "w-[240px] xl:w-[260px]" : "w-0 p-0 border-r-0"
          } transition-all duration-200 overflow-hidden flex flex-col border-r shrink-0 select-none ${
            currentTheme === "light"
              ? "bg-slate-50/90 border-slate-200 text-slate-900"
              : currentTheme === "digital"
              ? "bg-emerald-950/40 border-emerald-900/60 text-slate-200"
              : "bg-slate-950/60 border-slate-800 text-slate-200"
          } ${selectedMessageId ? "hidden lg:flex" : "hidden sm:flex"}`}
        >
          {/* Folder Pane Header */}
          <div className="p-3 border-b flex items-center justify-between shrink-0 border-inherit">
            <span className="text-xs font-black tracking-wider uppercase opacity-70 flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-amber-500" />
              フォルダ
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fetchFolders(true)}
                disabled={isLoadingFolders}
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                title="フォルダ一覧を更新"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFolders ? "animate-spin text-sky-500" : ""}`} />
              </button>
              <button
                type="button"
                onClick={() => setIsFolderSidebarOpen(false)}
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                title="フォルダペインを閉じる"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Dragging Guide Banner */}
          {draggedMessage && (
            <div className="p-2 m-2 rounded-lg bg-sky-500/15 border border-sky-400/40 text-[11px] font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1.5 animate-pulse shrink-0">
              <FolderOpen className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <span>移動先フォルダの上にドロップ</span>
            </div>
          )}

          {/* Folder Hierarchy Tree */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {/* Account Root Node (Outlook style) */}
            <div className="mb-1">
              <button
                type="button"
                onClick={() => setIsAccountTreeOpen(!isAccountTreeOpen)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 cursor-pointer transition-colors text-left"
              >
                {isAccountTreeOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
                )}
                <Mail className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="truncate font-black tracking-tight">
                  {status?.sharedMailbox || "osaeig1@tac-japan.co.jp"}
                </span>
              </button>
            </div>

            {/* Folder Tree Items */}
            {isAccountTreeOpen && (
              <div className="space-y-0.5 pl-1">
                {isLoadingFolders && folders.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400 space-y-2">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto text-sky-500" />
                    <span>フォルダ読み込み中...</span>
                  </div>
                ) : folders.length > 0 ? (
                  folders.map((f) => renderFolderItem(f, 0))
                ) : (
                  <div className="p-3 text-xs text-slate-400 text-center">
                    フォルダが見つかりません
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center Sidebar: Email List */}
        <div className={`w-full sm:w-[350px] md:w-[390px] lg:w-[420px] flex flex-col border-r shrink-0 shared-mail-sidebar ${
          currentTheme === "light"
            ? "bg-white border-slate-200 text-slate-900"
            : currentTheme === "digital"
            ? "bg-emerald-950/20 border-emerald-900/60"
            : "bg-slate-900/50 border-slate-800"
        } ${selectedMessageId ? "hidden md:flex" : "flex"}`}>
          {/* Header with folder name, sidebar toggle & Search bar */}
          <div className="p-3 border-b space-y-2.5 shrink-0 border-inherit">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {!isFolderSidebarOpen && (
                  <button
                    type="button"
                    onClick={() => setIsFolderSidebarOpen(true)}
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    title="フォルダペインを開く"
                  >
                    <PanelLeftOpen className="w-4 h-4" />
                  </button>
                )}
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-black text-sm truncate text-slate-900 dark:text-white">
                    {selectedFolderName}
                  </span>
                  <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                    {messages.length}件
                  </span>
                </div>
              </div>

              {/* Quick Sync */}
              <button
                type="button"
                onClick={() => {
                  fetchMessages(selectedFolderId, searchQuery, isUsingDemoFallback, true);
                  fetchFolders(true);
                }}
                disabled={isLoadingList}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                title="メール一覧を最新に更新"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? "animate-spin text-sky-500" : ""}`} />
              </button>
            </div>

            {/* Search Box */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="差出人、件名、本文を検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    fetchMessages(selectedFolderId, searchQuery);
                  }
                }}
                className={`w-full pl-8 pr-8 py-1.5 rounded-lg text-xs font-medium border transition-colors shared-mail-search-input ${
                  currentTheme === "light"
                    ? "bg-slate-50 border-slate-300 text-slate-950 placeholder-slate-500 focus:bg-white focus:border-sky-600"
                    : "bg-slate-800/80 border-slate-700 text-slate-200 placeholder-slate-500 focus:border-sky-500"
                }`}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    fetchMessages(selectedFolderId, "");
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Drag & drop helper notice */}
            <div className="text-[10px] text-slate-500 flex items-center justify-between px-0.5">
              <span>💡 メールをドラッグして左のフォルダへ移動できます</span>
            </div>
          </div>

          {/* Email List Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-inherit">
            {isLoadingList ? (
              <div className="p-8 text-center text-xs text-slate-500 space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto text-sky-500" />
                <p>メールボックスを同期中...</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 space-y-3">
                {graphError?.isAccessDenied || status?.needsApiPermissions ? (
                  <div className="space-y-2 p-3 bg-blue-50 dark:bg-slate-800/80 rounded-xl border border-blue-200 dark:border-blue-800 text-slate-700 dark:text-slate-300">
                    <Key className="w-6 h-6 mx-auto text-blue-600 dark:text-blue-400" />
                    <p className="font-bold text-slate-900 dark:text-white">Azure アクセス許可が保留中</p>
                    <p className="text-[11px] leading-relaxed">
                      Azure側で Mail.ReadWrite の許可と管理者の同意が完了するまで実メールは待機状態です。
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setIsUsingDemoFallback(true);
                        fetchMessages(selectedFolderId, searchQuery, true);
                      }}
                      className="mt-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-colors cursor-pointer shadow-xs inline-flex items-center gap-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      デモメールを表示して画面を試す
                    </button>
                  </div>
                ) : (
                  <>
                    <Mail className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700 stroke-1" />
                    <p className="font-bold">メールはありません</p>
                    <p className="text-[11px] opacity-70">
                      {searchQuery ? "検索条件に一致するメールが見つかりませんでした。" : "このフォルダは空です。"}
                    </p>
                  </>
                )}
              </div>
            ) : (
              messages.map((msg) => {
                const isSelected = msg.id === selectedMessageId;
                const isBeingDragged = draggedMessage?.id === msg.id;

                return (
                  <div
                    key={msg.id}
                    draggable={true}
                    onDragStart={(e) => {
                      setDraggedMessage(msg);
                      e.dataTransfer.setData("text/plain", msg.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDraggedMessage(null);
                      setDragOverFolderId(null);
                    }}
                    onClick={() => {
                      if (selectedMessageId !== msg.id) {
                        setSelectedMessageId(msg.id);
                      }
                    }}
                    className={`p-3.5 transition-all cursor-grab active:cursor-grabbing select-none relative group shared-mail-item ${
                      isSelected ? "is-selected" : ""
                    } ${isBeingDragged ? "opacity-40 ring-2 ring-sky-500 scale-[0.98]" : ""} ${
                      isSelected
                        ? currentTheme === "light"
                          ? "bg-sky-100/90 border-l-4 border-l-sky-600 shadow-xs"
                          : "bg-sky-950/40 border-l-4 border-l-sky-500"
                        : currentTheme === "light"
                        ? "bg-white hover:bg-slate-100 border-l-4 border-l-transparent"
                        : "hover:bg-slate-800/50 border-l-4 border-l-transparent"
                    }`}
                  >
                    {/* Unread indicator dot */}
                    {!msg.isRead && (
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-600 absolute left-1 top-4 ring-2 ring-white" />
                    )}

                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`text-xs truncate mail-sender ${
                          !msg.isRead
                            ? currentTheme === "light"
                              ? "font-black text-slate-950"
                              : "font-extrabold text-white"
                            : currentTheme === "light"
                            ? "font-bold text-slate-900"
                            : "font-bold text-slate-300"
                        }`}>
                          {folder === "sentitems"
                            ? msg.toRecipients?.map((r) => r.name || r.address).join(", ") || "(宛先なし)"
                            : msg.from?.name || msg.from?.address || "(差出人不明)"}
                        </span>
                        {msg.hasAttachments && (
                          <Paperclip className="w-3 h-3 text-slate-400 shrink-0" />
                        )}
                        {msg.importance === "high" && (
                          <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 shrink-0">
                            至急
                          </span>
                        )}
                        {msg.isDemo && (
                          <span className="text-[9px] font-bold px-1 rounded bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400 shrink-0">
                            Demo
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`text-[10px] whitespace-nowrap mail-date ${
                          currentTheme === "light"
                            ? "text-slate-600 font-semibold"
                            : "text-slate-400 font-medium"
                        }`}>
                          {formatDate(msg.receivedDateTime || msg.sentDateTime || "")}
                        </span>
                        <GripVertical className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors opacity-0 group-hover:opacity-100" title="ドラッグして移動" />
                      </div>
                    </div>

                    <div className={`text-xs line-clamp-1 mb-1 mail-subject ${
                      !msg.isRead
                        ? currentTheme === "light"
                          ? "font-black text-slate-950"
                          : "font-bold text-white"
                        : currentTheme === "light"
                        ? "font-bold text-slate-900"
                        : "text-slate-200"
                    }`}>
                      {msg.subject}
                    </div>

                    <div className={`text-[11px] line-clamp-2 leading-relaxed mail-preview ${
                      currentTheme === "light"
                        ? "text-slate-700 font-normal"
                        : "text-slate-400"
                    }`}>
                      {msg.bodyPreview}
                    </div>

                    {msg.hasAttachments && (
                      <div className={`mt-1.5 flex items-center gap-1 text-[10px] font-medium ${
                        currentTheme === "light" ? "text-slate-600" : "text-slate-400"
                      }`}>
                        <Paperclip className={`w-3 h-3 ${currentTheme === "light" ? "text-slate-500" : "text-slate-400"}`} />
                        <span>添付ファイルあり</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Selected Email Reading Pane */}
        <div className={`flex-1 flex flex-col overflow-hidden ${
          !selectedMessageId ? "hidden md:flex" : "flex"
        }`}>
          {selectedMessage ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              {/* Message Header & Action Bar */}
              <div className={`p-4 border-b shrink-0 shared-mail-header ${
                currentTheme === "light"
                  ? "bg-white border-slate-200 text-slate-900"
                  : currentTheme === "digital"
                  ? "bg-emerald-950/30 border-emerald-900/60"
                  : "bg-slate-900/80 border-slate-800"
              }`}>
                {/* Mobile Back button */}
                <div className="md:hidden mb-2">
                  <button
                    type="button"
                    onClick={() => setSelectedMessageId(null)}
                    className="flex items-center gap-1 text-xs font-bold text-sky-600 hover:text-sky-700"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>一覧に戻る</span>
                  </button>
                </div>

                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1.5 flex-1 min-w-[280px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className={`text-base sm:text-lg font-black tracking-tight leading-snug mail-header-subject ${
                        currentTheme === "light" ? "text-slate-950" : ""
                      }`}>
                        {selectedMessage.subject}
                      </h2>
                      {selectedMessage.importance === "high" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white">
                          至急案件
                        </span>
                      )}
                    </div>

                    {/* Sender Info */}
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className={`font-bold mail-header-sender ${
                        currentTheme === "light" ? "text-slate-950 font-extrabold" : "text-slate-100"
                      }`}>
                        {selectedMessage.from?.name || selectedMessage.from?.address}
                      </span>
                      {selectedMessage.from?.address && (
                        <span className={`font-mono text-[11px] mail-header-email ${
                          currentTheme === "light" ? "text-slate-700 font-semibold" : "text-slate-400"
                        }`}>
                          &lt;{selectedMessage.from.address}&gt;
                        </span>
                      )}
                    </div>

                    {/* Recipients & Date */}
                    <div className="text-[11px] space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={currentTheme === "light" ? "text-slate-800 font-bold" : "text-slate-400"}>宛先:</span>
                        {selectedMessage.toRecipients.map((r, i) => (
                          <span key={i} className={`font-mono px-1.5 py-0.5 rounded text-[10px] mail-recipient-badge ${
                            currentTheme === "light"
                              ? "bg-slate-100 border border-slate-300 text-slate-950 font-bold"
                              : "bg-slate-800 text-slate-200"
                          }`}>
                            {r.name ? `${r.name} ` : ""}&lt;{r.address}&gt;
                          </span>
                        ))}
                      </div>
                      {selectedMessage.ccRecipients.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={currentTheme === "light" ? "text-slate-800 font-bold" : "text-slate-400"}>CC:</span>
                          {selectedMessage.ccRecipients.map((r, i) => (
                            <span key={i} className={`font-mono px-1.5 py-0.5 rounded text-[10px] mail-recipient-badge ${
                              currentTheme === "light"
                                ? "bg-slate-100 border border-slate-300 text-slate-950 font-bold"
                                : "bg-slate-800 text-slate-200"
                            }`}>
                              {r.name ? `${r.name} ` : ""}&lt;{r.address}&gt;
                            </span>
                          ))}
                        </div>
                      )}
                      <div className={`flex items-center gap-1.5 pt-0.5 mail-header-date ${
                        currentTheme === "light" ? "text-slate-700 font-medium" : "text-slate-400"
                      }`}>
                        <Clock className={`w-3 h-3 ${currentTheme === "light" ? "text-slate-500" : "text-slate-400"}`} />
                        <span>受信日時: {new Date(selectedMessage.receivedDateTime).toLocaleString("ja-JP")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Toolbar */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Supplier Inquiry Button (prefills with this email's vessel, order, and text) */}
                    <button
                      type="button"
                      onClick={() => handleOpenSupplierInquiry(undefined, undefined, selectedMessage)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-transform active:scale-95 cursor-pointer"
                      title="このメールの情報を元にサプライヤー宛ての問合せひな型を作成"
                    >
                      <Building2 className="w-3.5 h-3.5 text-indigo-200" />
                      <span>サプライヤー問合せ</span>
                    </button>

                    {/* Create Quote Button */}
                    <button
                      type="button"
                      onClick={handleCreateQuoteFromCurrentMail}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-transform active:scale-95 cursor-pointer"
                      title="このメールの内容から新規見積案件を自動起票"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      <span>見積案件を起票</span>
                    </button>

                    {/* Reply */}
                    <button
                      type="button"
                      onClick={() => handleOpenReply(false)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
                        currentTheme === "light"
                          ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800"
                          : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
                      }`}
                      title="差出人に返信"
                    >
                      <Reply className="w-3.5 h-3.5" />
                      <span>返信</span>
                    </button>

                    {/* Reply All */}
                    <button
                      type="button"
                      onClick={() => handleOpenReply(true)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
                        currentTheme === "light"
                          ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800"
                          : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
                      }`}
                      title="全員に返信"
                    >
                      <ReplyAll className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">全員に返信</span>
                    </button>

                    {/* Mark as Unread / Read */}
                    <button
                      type="button"
                      onClick={handleToggleReadStatus}
                      className={`p-1.5 rounded-lg border text-xs font-bold transition-colors ${
                        currentTheme === "light"
                          ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700"
                          : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300"
                      }`}
                      title={selectedMessage.isRead ? "未読にする" : "既読にする"}
                    >
                      {selectedMessage.isRead ? (
                        <Mail className="w-3.5 h-3.5" />
                      ) : (
                        <MailCheck className="w-3.5 h-3.5 text-blue-600" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Attachments list (if any normal attachment exists) */}
                {selectedMessage.attachments && selectedMessage.attachments.filter(a => !a.isInline).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-inherit">
                    <div className="text-[11px] font-bold text-slate-500 mb-1.5 flex items-center gap-1">
                      <Paperclip className="w-3 h-3" />
                      <span>添付ファイル ({selectedMessage.attachments.filter(a => !a.isInline).length}件):</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {selectedMessage.attachments.filter(a => !a.isInline).map((att) => (
                        <a
                          key={att.id}
                          href={`/api/shared-mail/messages/${encodeURIComponent(selectedMessage.id)}/attachments/${encodeURIComponent(att.id)}`}
                          target="_blank"
                          rel="noreferrer"
                          download={att.name}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-all cursor-pointer ${
                            currentTheme === "light"
                              ? "bg-slate-50 hover:bg-slate-100 border-slate-300 text-slate-900 font-bold hover:shadow-xs"
                              : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200"
                          }`}
                          title="クリックしてダウンロード"
                        >
                          {getAttachmentIcon(att.name)}
                          <span className="font-medium truncate max-w-[200px]">{att.name}</span>
                          <span className={`text-[10px] shrink-0 ${currentTheme === "light" ? "text-slate-500" : "text-slate-400"}`}>
                            ({formatBytes(att.size)})
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Message Body Content Container */}
              <div className={`flex-1 p-6 overflow-y-auto text-sm leading-relaxed shared-mail-body-container ${
                currentTheme === "light"
                  ? "bg-white text-slate-950"
                  : currentTheme === "digital"
                  ? "bg-[#020c07] text-emerald-300 font-mono"
                  : "bg-slate-950 text-slate-100"
              }`}>
                {isLoadingDetail ? (
                  <div className="flex items-center justify-center h-48 text-xs text-slate-500 gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-sky-500" />
                    <span>本文を読み込み中...</span>
                  </div>
                ) : selectedMessage.bodyHtml ? (
                  <div
                    className={`max-w-none text-xs sm:text-sm shared-mail-body ${
                      currentTheme === "light"
                        ? "text-slate-950 bg-white"
                        : "shared-mail-body-dark text-slate-100"
                    }`}
                    dangerouslySetInnerHTML={{
                      __html: currentTheme === "light"
                        ? selectedMessage.bodyHtml
                        : selectedMessage.bodyHtml
                            .replace(/bgcolor\s*=\s*["'][^"']*["']/gi, '')
                            .replace(/bgcolor\s*=\s*#?[a-f0-9]+/gi, '')
                            .replace(/background-color\s*:\s*[^;"]+/gi, 'background-color: transparent')
                            .replace(/background\s*:\s*(#ffffff|#fff|white|#f[0-9a-f]{5}|rgb\([^)]+\))/gi, 'background: transparent')
                            .replace(/color\s*:\s*(#000000|#000|black|#111111|#111|#222222|#222|#333333|#333|#444444|#444|#555555|#555|#666666|#666|#777777|#777|#888888|#888|windowtext|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|rgb\(\s*34\s*,\s*34\s*,\s*34\s*\)|rgb\(\s*51\s*,\s*51\s*,\s*51\s*\))/gi, 'color: #f8fafc !important')
                            .replace(/color="(#000000|#000|black|#111111|#111|#222222|#222|#333333|#333|#444444|#444|#555555|#555|#666666|#666|#777777|#777|#888888|#888|windowtext)"/gi, 'color="#f8fafc"')
                    }}
                  />
                ) : (
                  <pre className={`whitespace-pre-wrap font-sans text-xs sm:text-sm ${
                    currentTheme === "light" ? "text-slate-950 font-medium" : "text-slate-200"
                  }`}>
                    {selectedMessage.bodyText || selectedMessage.bodyPreview}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <Mail className="w-12 h-12 stroke-1 text-slate-300 dark:text-slate-700 mb-3" />
              <p className="font-bold text-sm text-slate-600 dark:text-slate-400">
                メールを選択してください
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                左側の一覧からメールをクリックすると、ここに詳細な内容が表示されます。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Compose / Reply Modal */}
      {isComposeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isDraggingOverCompose) setIsDraggingOverCompose(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setIsDraggingOverCompose(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingOverCompose(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              handleAddFilesToCompose(e.dataTransfer.files);
            }
          }}
        >
          <div className={`w-full max-w-4xl rounded-2xl shadow-2xl border flex flex-col overflow-hidden max-h-[92vh] shared-mail-compose-modal relative ${
            currentTheme === "light"
              ? "bg-white border-slate-300 text-slate-900"
              : currentTheme === "digital"
              ? "bg-[#04170e] border-emerald-900 text-emerald-300"
              : "bg-slate-900 border-slate-800 text-slate-100"
          }`}>
            {/* Drag & Drop Visual Overlay */}
            {isDraggingOverCompose && !isSending && (
              <div className="absolute inset-0 z-50 bg-blue-600/90 text-white backdrop-blur-xs flex flex-col items-center justify-center p-6 border-4 border-dashed border-white rounded-2xl animate-in fade-in duration-150 pointer-events-none">
                <Paperclip className="w-12 h-12 mb-2 animate-bounce" />
                <p className="font-extrabold text-lg">ドロップしてファイルをアタッチ</p>
                <p className="text-xs text-blue-100 mt-1">複数のファイル（PDF, Excel, Word, 画像等）をアタッチできます</p>
              </div>
            )}

            {/* Sending Progress Overlay */}
            {isSending && (
              <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-white text-center animate-in fade-in duration-150 select-none">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 flex items-center justify-center mb-4 shadow-2xl animate-pulse">
                  <RefreshCw className="w-8 h-8 text-white animate-spin" />
                </div>
                <h4 className="text-lg font-extrabold text-sky-300">メールを送信処理中です...</h4>
                <p className="text-xs text-slate-300 mt-2 max-w-md leading-relaxed">
                  送信者・宛先・メール本文および添付データを安全に処理しています。<br />
                  誤操作防止のため入力および編集はロックされています。そのままお待ちください。
                </p>
                <div className="mt-4 px-4 py-1.5 bg-blue-900/80 border border-blue-500/60 rounded-full text-xs font-mono font-extrabold text-sky-200 animate-pulse flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                  <span>🔒 送信処理中：本文・宛先編集ロック有効</span>
                </div>
              </div>
            )}

            {/* Modal Header */}
            <div className={`px-5 py-3.5 border-b flex items-center justify-between shrink-0 ${
              currentTheme === "light" ? "bg-slate-100 border-slate-200 text-slate-900" : "bg-slate-800/80 border-slate-700 text-slate-100"
            }`}>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center text-white">
                  <Send className="w-3.5 h-3.5" />
                </div>
                <h3 className={`font-bold text-sm ${currentTheme === "light" ? "text-slate-950" : "text-white"}`}>
                  {composeSubject.toLowerCase().startsWith("re:") ? "共通メール返信" : "共通メール新規作成"}
                </h3>
              </div>
              <button
                type="button"
                disabled={isSending}
                onClick={() => setIsComposeOpen(false)}
                className={`p-1 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  currentTheme === "light" ? "hover:bg-slate-200 text-slate-600" : "hover:bg-slate-700 text-slate-400"
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleSendMail} className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 sm:p-5 space-y-3 overflow-y-auto flex-1 text-xs custom-scrollbar">
                {/* From Field */}
                <div className="flex items-center gap-2">
                  <label className={`w-16 font-bold shrink-0 ${currentTheme === "light" ? "text-slate-800" : "text-slate-400"}`}>送信元:</label>
                  <div className={`flex-1 font-mono font-bold px-3 py-2 rounded-lg border ${
                    currentTheme === "light"
                      ? "bg-slate-100 border-slate-300 text-slate-950 font-bold"
                      : "bg-blue-950/50 border-blue-900 text-blue-400"
                  }`}>
                    SHIPS TEAM (osaeig1@tac-japan.co.jp)
                  </div>
                </div>

                {/* To Field */}
                <div className="flex items-center gap-2">
                  <label className={`w-16 font-bold shrink-0 ${currentTheme === "light" ? "text-slate-800" : "text-slate-400"}`}>宛先 (To):</label>
                  <input
                    type="text"
                    required
                    disabled={isSending}
                    placeholder="example@partner.com (カンマ区切りで複数指定可)"
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                    className={`flex-1 px-3 py-2 rounded-lg border font-mono disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-200/50 dark:disabled:bg-slate-800/50 ${
                      currentTheme === "light"
                        ? "bg-white border-slate-300 text-slate-950 font-bold placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        : "bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    }`}
                  />
                </div>

                {/* CC Field */}
                <div className="flex items-center gap-2">
                  <label className={`w-16 font-bold shrink-0 ${currentTheme === "light" ? "text-slate-800" : "text-slate-400"}`}>CC:</label>
                  <input
                    type="text"
                    disabled={isSending}
                    placeholder="cc@company.com (任意)"
                    value={composeCc}
                    onChange={(e) => setComposeCc(e.target.value)}
                    className={`flex-1 px-3 py-2 rounded-lg border font-mono disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-200/50 dark:disabled:bg-slate-800/50 ${
                      currentTheme === "light"
                        ? "bg-white border-slate-300 text-slate-950 font-bold placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        : "bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    }`}
                  />
                </div>

                {/* Subject Field */}
                <div className="flex items-center gap-2">
                  <label className={`w-16 font-bold shrink-0 ${currentTheme === "light" ? "text-slate-800" : "text-slate-400"}`}>件名:</label>
                  <input
                    type="text"
                    required
                    disabled={isSending}
                    placeholder="メールの件名を入力"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    className={`flex-1 px-3 py-2 rounded-lg border disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-200/50 dark:disabled:bg-slate-800/50 ${
                      currentTheme === "light"
                        ? "bg-white border-slate-300 text-slate-950 font-bold placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        : "bg-slate-800 border-slate-700 text-slate-100 font-bold placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    }`}
                  />
                </div>

                {/* Attachments Section */}
                <div className={`p-3 rounded-xl border flex flex-col gap-2 ${
                  currentTheme === "light"
                    ? "bg-slate-50 border-slate-200"
                    : "bg-slate-800/60 border-slate-700"
                }`}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-blue-500" />
                      <span className={`font-bold ${currentTheme === "light" ? "text-slate-800" : "text-slate-200"}`}>
                        添付ファイル ({composeAttachments.length}件)
                      </span>
                      {composeAttachments.length > 0 && (
                        <span className="text-[11px] text-slate-500 font-mono">
                          合計: {formatBytes(composeAttachments.reduce((sum, a) => sum + a.size, 0))}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        ref={composeFileInputRef}
                        type="file"
                        multiple
                        disabled={isSending}
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) {
                            handleAddFilesToCompose(e.target.files);
                          }
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        disabled={isSending}
                        onClick={() => composeFileInputRef.current?.click()}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          currentTheme === "light"
                            ? "bg-white border-slate-300 text-slate-800 hover:bg-slate-100 shadow-2xs"
                            : "bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700"
                        }`}
                      >
                        <Paperclip className="w-3.5 h-3.5 text-blue-500" />
                        <span>ファイルを選択・アタッチ</span>
                      </button>
                    </div>
                  </div>

                  {/* Drop Area / Attached File List */}
                  {composeAttachments.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                      {composeAttachments.map((att) => (
                        <div
                          key={att.id}
                          className={`flex items-center justify-between p-2 rounded-lg border text-xs gap-2 ${
                            currentTheme === "light"
                              ? "bg-white border-slate-300 text-slate-900"
                              : "bg-slate-900 border-slate-700 text-slate-100"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {getAttachmentIcon(att.name)}
                            <div className="truncate min-w-0">
                              <p className="font-bold truncate text-[11.5px] leading-tight" title={att.name}>
                                {att.name}
                              </p>
                              <p className="text-[10px] opacity-60 font-mono leading-none mt-0.5">
                                {formatBytes(att.size)}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={isSending}
                            onClick={() => handleRemoveComposeAttachment(att.id)}
                            className="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors shrink-0 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            title="削除"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      onClick={() => !isSending && composeFileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-lg p-3 text-center transition-colors ${
                        isSending ? "cursor-not-allowed opacity-50 border-slate-400 text-slate-400" : "cursor-pointer"
                      } ${
                        currentTheme === "light"
                          ? "border-slate-300 hover:bg-slate-100/80 text-slate-500"
                          : "border-slate-700 hover:bg-slate-800/80 text-slate-400"
                      }`}
                    >
                      <p className="text-xs font-medium">
                        ファイルをここにドラッグ＆ドロップ、またはクリックしてダイアログからファイルを選択
                      </p>
                      <p className="text-[10px] opacity-60 mt-0.5">複数ファイルのまとめて添付に対応しています</p>
                    </div>
                  )}
                </div>

                {/* Rich Unified Editor Body */}
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={`font-bold ${currentTheme === "light" ? "text-slate-800" : "text-slate-300"}`}>
                      メール本文 (リッチエディタ / 表・画像・罫線・書式を完全保持):
                    </label>
                  </div>
                  <UnifiedRichEditor
                    value={composeBody}
                    onChange={setComposeBody}
                    placeholder="返信内容を入力してください..."
                    minHeight="280px"
                    staffMembers={staffMembers}
                    disabled={isSending}
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className={`px-5 py-3 border-t flex items-center justify-between shrink-0 ${
                currentTheme === "light" ? "bg-slate-100 border-slate-200" : "bg-slate-800/80 border-slate-700"
              }`}>
                <div className={`text-[11px] font-bold ${currentTheme === "light" ? "text-slate-900" : "text-slate-300"}`}>
                  <span>送信者名: SHIPS TEAM(osaeig1@tac-japan.co.jp)</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSending}
                    onClick={() => setIsComposeOpen(false)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      currentTheme === "light"
                        ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
                        : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={isSending}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className={`w-3.5 h-3.5 ${isSending ? "animate-pulse" : ""}`} />
                    <span>{isSending ? "送信中..." : "メールを送信"}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl shadow-xl border flex items-center gap-2 text-xs font-bold animate-in slide-in-from-bottom-3 duration-200 ${
          toastMessage.type === "success"
            ? "bg-emerald-600 text-white border-emerald-500"
            : "bg-rose-600 text-white border-rose-500"
        }`}>
          {toastMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Supplier Master Management Modal */}
      <SupplierMasterModal
        isOpen={isSupplierMasterOpen}
        onClose={() => setIsSupplierMasterOpen(false)}
        suppliers={suppliers}
        currentTheme={currentTheme}
        onSelectSupplierForInquiry={(sup) => {
          handleOpenSupplierInquiry(sup.id);
        }}
      />

      {/* Inquiry Email Template Settings Modal */}
      <EmailTemplateSettingsModal
        isOpen={isTemplateSettingsOpen}
        onClose={() => setIsTemplateSettingsOpen(false)}
        templates={templates}
        currentTheme={currentTheme}
        staffMembers={staffMembers}
      />

      {/* Supplier Inquiry Assistant Launcher Modal */}
      <SupplierInquiryModal
        isOpen={isInquiryModalOpen}
        onClose={() => setIsInquiryModalOpen(false)}
        suppliers={suppliers}
        templates={templates}
        currentTheme={currentTheme}
        initialSupplierId={inquiryTargetSupplierId}
        initialPattern={inquiryTargetPattern}
        initialSourceEmail={inquirySourceEmail}
        onOpenSupplierMaster={() => {
          setIsInquiryModalOpen(false);
          setIsSupplierMasterOpen(true);
        }}
        onOpenTemplateSettings={() => {
          setIsInquiryModalOpen(false);
          setIsTemplateSettingsOpen(true);
        }}
        onApplyToCompose={handleApplyInquiryToCompose}
      />
    </div>
  );
};
