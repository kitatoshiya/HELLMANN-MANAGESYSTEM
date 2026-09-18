import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Mail,
  MailCheck,
  MailOpen,
  Inbox,
  Send,
  FileText,
  Star,
  Trash2,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronRight,
  ChevronDown,
  Paperclip,
  ArrowLeft,
  Settings,
  Plus,
  X,
  User,
  Building,
  HelpCircle,
  FileCheck,
  SendHorizontal,
  Forward,
  Reply,
  ReplyAll,
  Copy,
  ExternalLink,
  ShieldCheck,
  Check,
  Filter,
  Eye,
  Download,
  AlertCircle,
  Sparkles,
  Edit3,
  Tag,
  Calendar,
  Folder,
} from 'lucide-react';
import {
  UnifiedMailItem,
  MailFolderCategory,
  MailDecisionStatus,
  EmailAttachment,
  M365Settings,
  ReplyTemplate,
} from '../types';
import {
  fetchAllReplyTemplates,
  formatReplyTemplate,
} from '../lib/replyTemplateService';
import { ReplyTemplateSettingsModal } from './ReplyTemplateSettingsModal';
import { SignatureSettingsModal } from './SignatureSettingsModal';
import { sanitizeEmailHtml } from '../lib/htmlSanitizer';
import { useAuth } from '../lib/AuthContext';
import {
  getUnifiedMailMessages,
  toggleMailStarred,
  setMailReadState,
  setMailTrashState,
  applyMailDecision,
  sendOutgoingMailFromClient,
  buildReplyBodies,
  getUserSignature,
  getM365Settings,
  subscribeM365Store,
  linkShipmentToHellmannOrder,
  extractLogisticsInfoFromEmailText,
  extractRecipientsFromEmailContent,
  isVercelEnvironment,
  syncM365EmailsFromGraphAPI,
  sendMailViaGraphBackend,
  updateMailSourceType,
  updateMailAwbNumbers,
  excludeFromHellmannOrder,
  subscribeM365SyncTimerState,
  M365SyncTimerState,
  fetchAttachmentOnDemand,
  fetchMessageAttachmentsFromGraphAPI,
  updateMailAttachmentsInStore,
  saveEmailPayloadToIndexedDB,
} from '../lib/m365EmailService';
import { createShipment, getShipments } from '../lib/storageManager';
import { cleanHawbNumber, normalizeMawbNumber } from '../lib/awbUtils';
import { M365SettingsModal } from './M365SettingsModal';

interface M365MailClientProps {
  onClose: () => void;
  onSelectShipment?: (shipmentId: string) => void;
}

export const M365MailClient: React.FC<M365MailClientProps> = ({
  onClose,
  onSelectShipment,
}) => {
  const { currentUser, currentOperator, firebaseUser } = useAuth();
  const [settings, setSettings] = useState<M365Settings>(getM365Settings());
  const operatorName = currentUser?.displayName || currentOperator?.name || firebaseUser?.displayName || settings.brokerDefaultName || '喜多';

  // Store states
  const [messages, setMessages] = useState<UnifiedMailItem[]>([]);
  const [selectedMailId, setSelectedMailId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Navigation & filter states
  const [currentFolder, setCurrentFolder] = useState<MailFolderCategory>('INBOX');
  const [selectedAwbFilter, setSelectedAwbFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNREAD' | 'PENDING' | 'DECIDED'>('ALL');

  // UI state for tree collapse
  const [isInboxTreeOpen, setIsInboxTreeOpen] = useState(true);
  const [isAwbTreeOpen, setIsAwbTreeOpen] = useState(true);
  const [isDecisionTreeOpen, setIsDecisionTreeOpen] = useState(true);
  const [expandedDateKeys, setExpandedDateKeys] = useState<Record<string, boolean>>({});

  const toggleDateExpand = (dateKey: string) => {
    setExpandedDateKeys((prev) => ({
      ...prev,
      [dateKey]: !prev[dateKey],
    }));
  };

  // Compose modal state
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeTemplate, setComposeTemplate] = useState<string>('');

  // Inline Reply state
  const [isReplying, setIsReplying] = useState(false);
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll'>('reply');
  const [replyTo, setReplyTo] = useState<string[]>([]);
  const [replyCc, setReplyCc] = useState<string[]>([]);
  const [replySubject, setReplySubject] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyTemplates, setReplyTemplates] = useState<ReplyTemplate[]>([]);
  const [isTemplateSettingsOpen, setIsTemplateSettingsOpen] = useState(false);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [showQuotedPreview, setShowQuotedPreview] = useState(false);
  const replyBoxRef = useRef<HTMLDivElement>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Decision Modal / Prompt state
  const [decisionModal, setDecisionModal] = useState<{
    isOpen: boolean;
    mail: UnifiedMailItem | null;
    actionType: 'IMPORT_SHIPMENT' | 'EXTERNAL_REG' | 'FORWARD_BROKER' | 'INQUIRY_HELLMANN' | 'RESOLVE' | 'DISMISS';
    title: string;
    note: string;
  }>({
    isOpen: false,
    mail: null,
    actionType: 'IMPORT_SHIPMENT',
    title: '',
    note: '',
  });

  // PDF Preview modal state
  const [previewPdfAttachment, setPreviewPdfAttachment] = useState<EmailAttachment | null>(null);
  const [downloadingAttId, setDownloadingAttId] = useState<string | null>(null);
  const [isFetchingAttachments, setIsFetchingAttachments] = useState(false);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [timerState, setTimerState] = useState<M365SyncTimerState>({
    lastSyncTime: null,
    lastInboxSyncTime: null,
    lastSentSyncTime: null,
    isInboxSyncing: false,
    isSentSyncing: false,
    nextInboxSyncRemainingSec: 120,
    nextSentSyncRemainingSec: 300,
  });
  const [syncNotice, setSyncNotice] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
    canOpenSettings?: boolean;
  } | null>(null);

  // Manual AWB editing state
  const [editingAwbMailId, setEditingAwbMailId] = useState<string | null>(null);
  const [editMawbInput, setEditMawbInput] = useState('');
  const [editHawbInput, setEditHawbInput] = useState('');

  const startEditingAwb = (mail: UnifiedMailItem) => {
    setEditingAwbMailId(mail.id);
    setEditMawbInput(mail.mawbNumber || '');
    setEditHawbInput(mail.hawbNumber || '');
  };

  const cancelEditingAwb = () => {
    setEditingAwbMailId(null);
    setEditMawbInput('');
    setEditHawbInput('');
  };

  const handleSaveAwb = (mailId: string) => {
    updateMailAwbNumbers(mailId, editMawbInput, editHawbInput);
    setEditingAwbMailId(null);
    reloadMessages();
  };

  const handleAutoExtractAwb = (mail: UnifiedMailItem) => {
    const extracted = extractLogisticsInfoFromEmailText(mail.body || '', mail.subject || '');
    if (extracted.mawb) {
      setEditMawbInput(extracted.mawb);
    }
    if (extracted.hawb) {
      setEditHawbInput(extracted.hawb);
    }
  };

  const handleDownloadAttachment = async (mail: UnifiedMailItem, att: EmailAttachment) => {
    // If dataUrl already present, trigger immediate download
    if (att.dataUrl) {
      const link = document.createElement('a');
      link.href = att.dataUrl;
      link.download = att.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // Otherwise fetch on-demand from Microsoft Graph API
    setDownloadingAttId(att.id);
    try {
      const res = await fetchAttachmentOnDemand(mail.graphMessageId || mail.id, att.id);
      if (res.success && res.attachment?.dataUrl) {
        // Cache dataUrl in memory for this attachment
        att.dataUrl = res.attachment.dataUrl;
        if (mail.attachments) {
          saveEmailPayloadToIndexedDB(mail.id, {
            attachments: mail.attachments,
            bodyText: mail.body,
            bodyHtml: mail.bodyHtml,
          });
        }
        const link = document.createElement('a');
        link.href = res.attachment.dataUrl;
        link.download = att.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // Fallback to text download
        const fallbackText = `[添付ファイル情報]\nファイル名: ${att.fileName}\nサイズ: ${att.sizeBytes} bytes\n種類: ${att.contentType}\n\n※このファイル実体はMicrosoft 365のメールボックス（ID: ${mail.id}）に保存されています。`;
        const blob = new Blob([fallbackText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${att.fileName}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.warn('Download attachment error:', err);
    } finally {
      setDownloadingAttId(null);
    }
  };

  const handlePreviewAttachment = async (mail: UnifiedMailItem, att: EmailAttachment) => {
    if (att.dataUrl) {
      setPreviewPdfAttachment(att);
      return;
    }

    setDownloadingAttId(att.id);
    try {
      const res = await fetchAttachmentOnDemand(mail.graphMessageId || mail.id, att.id);
      if (res.success && res.attachment?.dataUrl) {
        att.dataUrl = res.attachment.dataUrl;
        setPreviewPdfAttachment({
          ...att,
          dataUrl: res.attachment.dataUrl,
        });
      }
    } catch (err) {
      console.warn('Preview attachment error:', err);
    } finally {
      setDownloadingAttId(null);
    }
  };


  const handleFetchAttachmentsForMail = async (mail: UnifiedMailItem) => {
    if (isFetchingAttachments) return;
    setIsFetchingAttachments(true);
    try {
      const graphId = mail.graphMessageId || mail.id.replace(/^graph_/, '').replace(/_\d+$/, '');
      const res = await fetchMessageAttachmentsFromGraphAPI(graphId);
      if (res.success && res.attachments.length > 0) {
        mail.attachments = res.attachments;

        // 1. Save to IndexedDB so getEmailPayload retains them permanently
        await saveEmailPayloadToIndexedDB(mail.id, {
          attachments: res.attachments,
          bodyText: mail.body,
          bodyHtml: mail.bodyHtml,
        });
        if (graphId && graphId !== mail.id) {
          await saveEmailPayloadToIndexedDB(graphId, {
            attachments: res.attachments,
            bodyText: mail.body,
            bodyHtml: mail.bodyHtml,
          });
        }
        if (mail.id.startsWith('graph_')) {
          await saveEmailPayloadToIndexedDB(mail.id.replace(/^graph_/, ''), {
            attachments: res.attachments,
            bodyText: mail.body,
            bodyHtml: mail.bodyHtml,
          });
        }

        // 2. Persist in localStorage stores
        updateMailAttachmentsInStore(mail.id, res.attachments);

        // 3. Update hydratedSelectedMail directly so UI renders immediately
        setHydratedSelectedMail((prev) => {
          if (prev && (prev.id === mail.id || prev.graphMessageId === graphId)) {
            return {
              ...prev,
              attachments: res.attachments,
            };
          }
          return prev;
        });

        // 4. Update messages list state
        setMessages((prev) =>
          prev.map((m) =>
            m.id === mail.id || (mail.graphMessageId && m.graphMessageId === mail.graphMessageId)
              ? { ...m, attachments: res.attachments }
              : m
          )
        );
      }
    } catch (err) {
      console.warn('Failed to fetch message attachments:', err);
    } finally {
      setIsFetchingAttachments(false);
    }
  };

  // Automatically fetch attachments if email is opened and has no attachments loaded yet
  useEffect(() => {
    if (!selectedMailId) return;
    const target = messages.find((m) => m.id === selectedMailId);
    if (
      target &&
      (!target.attachments || target.attachments.length === 0) &&
      (target.id.startsWith('graph_') || target.graphMessageId || (target as any).hasAttachments)
    ) {
      handleFetchAttachmentsForMail(target);
    }
  }, [selectedMailId]);

  // Load and subscribe to updates
  const reloadMessages = () => {
    const list = getUnifiedMailMessages();
    setMessages(list);
    setSettings(getM365Settings());
    if (!selectedMailId && list.length > 0) {
      setSelectedMailId(list[0].id);
    }
  };

  useEffect(() => {
    reloadMessages();
    const unsubscribeStore = subscribeM365Store(() => {
      reloadMessages();
    });

    const unsubscribeTimerState = subscribeM365SyncTimerState((state) => {
      setTimerState(state);
    });

    // If production mode is configured, automatically perform an initial sync
    const currentSettings = getM365Settings();
    if (!currentSettings.isDemoMode && currentSettings.tenantId && currentSettings.clientId) {
      handleSyncRefresh();
    }

    return () => {
      unsubscribeStore();
      unsubscribeTimerState();
    };
  }, []);

  // Date-grouped AWBs for tree
  const { dateAwbGroups, totalAwbCount, unassignedAwbCount } = useMemo(() => {
    const allShipments = getShipments();
    const awbMap = new Map<string, { count: number; dateKey: string }>();
    let unassigned = 0;

    const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

    const normalizeDateToKey = (dateStr?: string | null): string | null => {
      if (!dateStr) return null;
      const cleaned = dateStr.replace(/\//g, '-').trim();
      const parts = cleaned.split('-');
      if (parts.length === 3) {
        const y = parts[0].length === 2 ? `20${parts[0]}` : parts[0].padStart(4, '20');
        const m = parts[1].padStart(2, '0');
        const d = parts[2].padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      if (parts.length === 2) {
        const currentYear = new Date().getFullYear();
        const m = parts[0].padStart(2, '0');
        const d = parts[1].padStart(2, '0');
        return `${currentYear}-${m}-${d}`;
      }
      return null;
    };

    const formatDateGroupLabel = (dateKey: string): string => {
      if (dateKey === '__NO_DATE__') return '通関日未設定';
      const parts = dateKey.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const dateObj = new Date(y, m - 1, d);
        if (!isNaN(dateObj.getTime())) {
          const w = WEEKDAY_NAMES[dateObj.getDay()];
          return `${parts[0]}/${parts[1]}/${parts[2]} (${w})`;
        }
        return `${parts[0]}/${parts[1]}/${parts[2]}`;
      }
      return dateKey;
    };

    messages.forEach((m) => {
      if (m.folder === 'TRASH') return;
      const awb = m.mawbNumber || m.hawbNumber;
      if (awb) {
        if (!awbMap.has(awb)) {
          let determinedDateKey: string | null = null;

          // 1. Shipment から特定
          const cleanAwb = awb.replace(/[-\s]/g, '').toLowerCase();
          const matchedShipment = allShipments.find((s) => {
            if (m.shipmentId && s.id === m.shipmentId) return true;
            const sMawb = (s.mawbNumber || '').replace(/[-\s]/g, '').toLowerCase();
            const sHawb = (s.hawbNumber || '').replace(/[-\s]/g, '').toLowerCase();
            const sId = (s.id || '').replace(/[-\s]/g, '').toLowerCase();
            return (
              (sMawb && (sMawb === cleanAwb || cleanAwb.includes(sMawb))) ||
              (sHawb && (sHawb === cleanAwb || cleanAwb.includes(sHawb))) ||
              (sId && (sId === cleanAwb || cleanAwb.includes(sId)))
            );
          });

          if (matchedShipment?.customsClearanceDate) {
            determinedDateKey = normalizeDateToKey(matchedShipment.customsClearanceDate);
          }

          // 2. メールの件名などから特定 (例: "09/17 輸出通関依頼 ...")
          if (!determinedDateKey && m.subject) {
            const dateMatch = m.subject.match(/(?:^|\s)(20\d{2}[-/])?(\d{1,2})[-/](\d{1,2})/);
            if (dateMatch) {
              const y = dateMatch[1] ? dateMatch[1].replace(/[-/]/g, '') : String(new Date().getFullYear());
              const mon = dateMatch[2].padStart(2, '0');
              const d = dateMatch[3].padStart(2, '0');
              determinedDateKey = `${y}-${mon}-${d}`;
            }
          }

          awbMap.set(awb, {
            count: 1,
            dateKey: determinedDateKey || '__NO_DATE__',
          });
        } else {
          const item = awbMap.get(awb)!;
          item.count += 1;
        }
      } else {
        unassigned += 1;
      }
    });

    // 日付ごとにグループ化
    const groupMap = new Map<
      string,
      {
        dateKey: string;
        dateLabel: string;
        isUnknownDate: boolean;
        awbList: { awb: string; count: number }[];
        totalMailCount: number;
      }
    >();

    awbMap.forEach(({ count, dateKey }, awb) => {
      if (!groupMap.has(dateKey)) {
        groupMap.set(dateKey, {
          dateKey,
          dateLabel: formatDateGroupLabel(dateKey),
          isUnknownDate: dateKey === '__NO_DATE__',
          awbList: [{ awb, count }],
          totalMailCount: count,
        });
      } else {
        const g = groupMap.get(dateKey)!;
        g.awbList.push({ awb, count });
        g.totalMailCount += count;
      }
    });

    // 日付順ソート (未来含む最新日 -> 過去日, 未設定は末尾)
    const sortedGroups = Array.from(groupMap.values()).sort((a, b) => {
      if (a.isUnknownDate) return 1;
      if (b.isUnknownDate) return -1;
      return b.dateKey.localeCompare(a.dateKey);
    });

    // 各日付配下の AWB を件数降順/名前順でソート
    sortedGroups.forEach((g) => {
      g.awbList.sort((a, b) => b.count - a.count || a.awb.localeCompare(b.awb));
    });

    return {
      dateAwbGroups: sortedGroups,
      totalAwbCount: awbMap.size,
      unassignedAwbCount: unassigned,
    };
  }, [messages]);

  // Counters for tree badges
  const counts = useMemo(() => {
    const totalInbox = messages.filter(
      (m) => (m.folder === 'INBOX' || m.direction === 'INCOMING') && m.folder !== 'TRASH'
    ).length;
    const unreadInbox = messages.filter(
      (m) => (m.folder === 'INBOX' || m.direction === 'INCOMING') && m.folder !== 'TRASH' && !m.isRead
    ).length;
    const totalUnread = messages.filter(
      (m) => !m.isRead && m.folder !== 'TRASH'
    ).length;
    const hellmannPending = messages.filter(
      (m) =>
        m.sourceType === 'HELLMANN_ORDER' &&
        (m.folder === 'INBOX' || m.direction === 'INCOMING') &&
        m.folder !== 'TRASH' &&
        m.decisionStatus === 'PENDING_DECISION'
    ).length;
    const brokerPending = messages.filter(
      (m) =>
        m.sourceType === 'BROKER_QUESTION' &&
        (m.folder === 'INBOX' || m.direction === 'INCOMING') &&
        m.folder !== 'TRASH' &&
        m.decisionStatus === 'PENDING_DECISION'
    ).length;
    const generalCount = messages.filter(
      (m) =>
        m.sourceType === 'GENERAL' &&
        (m.folder === 'INBOX' || m.direction === 'INCOMING') &&
        m.folder !== 'TRASH'
    ).length;
    const allPendingDecisions = messages.filter(
      (m) => m.decisionStatus === 'PENDING_DECISION' && m.folder !== 'TRASH'
    ).length;
    const allDecided = messages.filter(
      (m) => m.decisionStatus !== 'PENDING_DECISION' && m.folder !== 'TRASH'
    ).length;
    const starred = messages.filter((m) => m.isStarred && m.folder !== 'TRASH').length;
    const sent = messages.filter((m) => (m.folder === 'SENT' || m.direction === 'OUTGOING') && m.folder !== 'TRASH').length;
    const trash = messages.filter((m) => m.folder === 'TRASH').length;

    return {
      totalInbox,
      unreadInbox,
      totalUnread,
      hellmannPending,
      brokerPending,
      generalCount,
      allPendingDecisions,
      allDecided,
      starred,
      sent,
      trash,
    };
  }, [messages]);

  // Filter messages based on active folder, awb filter, and search
  const filteredMessages = useMemo(() => {
    return messages.filter((m) => {
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesSubject = m.subject.toLowerCase().includes(q);
        const matchesBody = (m.body || '').toLowerCase().includes(q);
        const matchesSender = (m.sender?.name || '').toLowerCase().includes(q) || (m.sender?.email || '').toLowerCase().includes(q);
        const matchesRecipients = (m.toRecipients || []).some((r) => r.toLowerCase().includes(q)) || (m.ccRecipients || []).some((c) => c.toLowerCase().includes(q));
        const matchesAwb = (m.mawbNumber || '').toLowerCase().includes(q) || (m.hawbNumber || '').toLowerCase().includes(q);
        if (!matchesSubject && !matchesBody && !matchesSender && !matchesRecipients && !matchesAwb) {
          return false;
        }
      }

      // Status filter
      if (statusFilter === 'UNREAD') {
        if (m.isRead) return false;
      } else if (statusFilter === 'PENDING') {
        // When in SENT or DECIDED folders, do not block sent messages
        if (currentFolder !== 'SENT' && currentFolder !== 'DECIDED' && m.decisionStatus !== 'PENDING_DECISION') {
          return false;
        }
      } else if (statusFilter === 'DECIDED') {
        if (m.decisionStatus === 'PENDING_DECISION') return false;
      }

      // AWB folder selection
      if (currentFolder === 'AWB_THREAD') {
        if (!selectedAwbFilter) return true;
        if (selectedAwbFilter === '__UNASSIGNED__') {
          return !m.mawbNumber && !m.hawbNumber && m.folder !== 'TRASH';
        }
        return (m.mawbNumber === selectedAwbFilter || m.hawbNumber === selectedAwbFilter) && m.folder !== 'TRASH';
      }

      // Folders
      switch (currentFolder) {
        case 'INBOX':
          return (m.folder === 'INBOX' || m.direction === 'INCOMING') && m.folder !== 'TRASH';
        case 'INBOX_HELLMANN':
          return (m.folder === 'INBOX' || m.direction === 'INCOMING') && m.sourceType === 'HELLMANN_ORDER' && m.folder !== 'TRASH';
        case 'INBOX_BROKER':
          return (m.folder === 'INBOX' || m.direction === 'INCOMING') && m.sourceType === 'BROKER_QUESTION' && m.folder !== 'TRASH';
        case 'INBOX_GENERAL':
          return (m.folder === 'INBOX' || m.direction === 'INCOMING') && m.sourceType === 'GENERAL' && m.folder !== 'TRASH';
        case 'INBOX_ANSWERS':
          return (m.folder === 'INBOX' || m.direction === 'INCOMING') && (m.sourceType === 'HELLMANN_ANSWER' || m.sourceType === 'BROKER_REPLY') && m.folder !== 'TRASH';
        case 'SENT':
          return (m.folder === 'SENT' || m.direction === 'OUTGOING') && m.folder !== 'TRASH';
        case 'STARRED':
          return m.isStarred && m.folder !== 'TRASH';
        case 'PENDING_DECISION':
          return m.decisionStatus === 'PENDING_DECISION' && m.folder !== 'TRASH';
        case 'DECIDED':
          return m.decisionStatus !== 'PENDING_DECISION' && m.folder !== 'TRASH';
        case 'TRASH':
          return m.folder === 'TRASH';
        default:
          return true;
      }
    });
  }, [messages, currentFolder, selectedAwbFilter, searchQuery, statusFilter]);

  // Derived currently active selected mail ID
  const activeSelectedMailId = useMemo(() => {
    if (selectedMailId && filteredMessages.some((m) => m.id === selectedMailId)) {
      return selectedMailId;
    }
    return filteredMessages[0]?.id || null;
  }, [selectedMailId, filteredMessages]);

  const rawSelectedMail = useMemo(() => {
    if (!activeSelectedMailId) return null;
    return filteredMessages.find((m) => m.id === activeSelectedMailId) || messages.find((m) => m.id === activeSelectedMailId) || null;
  }, [activeSelectedMailId, filteredMessages, messages]);

  const [hydratedSelectedMail, setHydratedSelectedMail] = useState<UnifiedMailItem | null>(null);

  useEffect(() => {
    if (!rawSelectedMail) {
      setHydratedSelectedMail(null);
      return;
    }
    // Set initially
    setHydratedSelectedMail(rawSelectedMail);

    let active = true;
    import('../lib/m365EmailService').then(({ getEmailPayload }) => {
      getEmailPayload(rawSelectedMail.id).then((payload) => {
        if (active && payload) {
          setHydratedSelectedMail((prev) => {
            if (prev && prev.id === rawSelectedMail.id) {
              const effectiveAttachments =
                payload.attachments && payload.attachments.length > 0
                  ? payload.attachments
                  : prev.attachments && prev.attachments.length > 0
                  ? prev.attachments
                  : rawSelectedMail.attachments && rawSelectedMail.attachments.length > 0
                  ? rawSelectedMail.attachments
                  : [];
              return {
                ...prev,
                bodyHtml: payload.bodyHtml || prev.bodyHtml,
                body: payload.bodyText || prev.body,
                attachments: effectiveAttachments,
              };
            }
            return prev;
          });
        }
      });
    });

    return () => {
      active = false;
    };
  }, [rawSelectedMail]);

  const selectedMail = hydratedSelectedMail || rawSelectedMail;

  // Check if selected email belongs to an already registered shipment in DB
  const matchedRegisteredShipment = useMemo(() => {
    if (!selectedMail) return null;
    const allShipments = getShipments();

    if (selectedMail.shipmentId) {
      const found = allShipments.find((s) => s.id === selectedMail.shipmentId);
      if (found) return found;
    }

    const mawb = selectedMail.mawbNumber?.trim().toLowerCase();
    const hawb = selectedMail.hawbNumber?.trim().toLowerCase();

    if (!mawb && !hawb) return null;

    return (
      allShipments.find((s) => {
        const sMawb = s.mawbNumber?.trim().toLowerCase();
        const sHawb = s.hawbNumber?.trim().toLowerCase();
        const cleanMawb = mawb?.replace(/[-\s]/g, '');
        const cleanSMawb = sMawb?.replace(/[-\s]/g, '');
        if (cleanMawb && cleanSMawb && cleanMawb === cleanSMawb) return true;

        const cleanHawb = hawb?.replace(/[-\s]/g, '');
        const cleanSHawb = sHawb?.replace(/[-\s]/g, '');
        if (cleanHawb && cleanSHawb && cleanHawb === cleanSHawb) return true;

        return false;
      }) || null
    );
  }, [selectedMail]);

  // Normalized Recipients lists (preserving actual recipients and extracting embedded headers if needed)
  const normalizedToRecipients = useMemo(() => {
    if (!selectedMail) return [];
    const rawList = Array.isArray(selectedMail.toRecipients)
      ? selectedMail.toRecipients
      : typeof selectedMail.toRecipients === 'string'
      ? [selectedMail.toRecipients]
      : [];
    const flattened = rawList.flatMap((item) =>
      typeof item === 'string' ? item.split(/[,;]/) : []
    );
    const cleaned = flattened.map((s) => s.trim()).filter((s) => s.length > 0);
    const set = new Set<string>(cleaned);

    // Also check for embedded To: header in email body/html if present
    const headerRecipients = extractRecipientsFromEmailContent(selectedMail.body, selectedMail.bodyHtml);
    for (const t of headerRecipients.to) {
      if (t && t.toLowerCase() !== selectedMail.sender?.email?.toLowerCase()) {
        set.add(t);
      }
    }

    return Array.from(set);
  }, [selectedMail]);

  const normalizedCcRecipients = useMemo(() => {
    if (!selectedMail) return [];
    const rawList = Array.isArray(selectedMail.ccRecipients)
      ? selectedMail.ccRecipients
      : typeof selectedMail.ccRecipients === 'string'
      ? [selectedMail.ccRecipients]
      : [];
    const flattened = rawList.flatMap((item) =>
      typeof item === 'string' ? item.split(/[,;]/) : []
    );
    const cleaned = flattened.map((s) => s.trim()).filter((s) => s.length > 0);
    const set = new Set<string>(cleaned);

    // Also check for embedded CC: header in email body/html
    const headerRecipients = extractRecipientsFromEmailContent(selectedMail.body, selectedMail.bodyHtml);
    for (const c of headerRecipients.cc) {
      if (c && !normalizedToRecipients.includes(c) && c.toLowerCase() !== selectedMail.sender?.email?.toLowerCase()) {
        set.add(c);
      }
    }

    return Array.from(set);
  }, [selectedMail, normalizedToRecipients]);

  // When selected mail changes, auto-mark as read if unread
  useEffect(() => {
    if (activeSelectedMailId) {
      const target = messages.find((m) => m.id === activeSelectedMailId);
      if (target && !target.isRead) {
        setMailReadState(activeSelectedMailId, true);
      }
    }
  }, [activeSelectedMailId, messages]);

  // Vercel Environment detection
  const isVercel = isVercelEnvironment();
  const [bodyViewMode, setBodyViewMode] = useState<'html' | 'text'>('html');

  // Handle Sync / Simulate
  const handleSyncRefresh = async () => {
    setSyncing(true);
    setSyncNotice(null);

    try {
      const res = await syncM365EmailsFromGraphAPI();
      reloadMessages();
      if (res.success) {
        setSyncNotice({
          type: 'success',
          message: res.message,
        });
      } else {
        setSyncNotice({
          type: 'warning',
          message: res.message,
          canOpenSettings: true,
        });
      }
      setTimeout(() => {
        setSyncNotice(null);
      }, 7000);
    } catch (err: any) {
      console.warn('Mail sync notice:', err?.message || err);
      setSyncNotice({
        type: 'warning',
        message: `同期通知: ${err.message || '通信状況をご確認ください'}`,
        canOpenSettings: true,
      });
      setTimeout(() => {
        setSyncNotice(null);
      }, 7000);
    } finally {
      setSyncing(false);
    }
  };

  // Star toggle
  const handleToggleStar = (e: React.MouseEvent, mailId: string) => {
    e.stopPropagation();
    toggleMailStarred(mailId);
    reloadMessages();
  };

  // Trash toggle
  const handleDeleteMail = (mailId: string) => {
    setMailTrashState(mailId, true);
    reloadMessages();
  };

  // Copy helper
  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // -------------------------------------------------------------
  // Decision Executions (決定機能の実装)
  // -------------------------------------------------------------

  const openDecisionModal = (
    mail: UnifiedMailItem,
    actionType: 'IMPORT_SHIPMENT' | 'EXTERNAL_REG' | 'FORWARD_BROKER' | 'INQUIRY_HELLMANN' | 'RESOLVE' | 'DISMISS'
  ) => {
    let title = '';
    let defaultNote = '';

    switch (actionType) {
      case 'IMPORT_SHIPMENT':
        title = '【決定】通関案件としてシステム自動取り込み・登録';
        defaultNote = '添付のSI指示書およびインボイスに基づき、輸出通関案件として取り込み決定・登録完了';
        break;
      case 'EXTERNAL_REG':
        title = '【決定】社内別システム（基幹DB）登録完了';
        defaultNote = '社内基幹システム側への貨物登録・通関手配ステータス反映を決定・完了';
        break;
      case 'FORWARD_BROKER':
        title = '【決定】担当通関士へ輸出通関手配を依頼・メール送信';
        defaultNote = '社内通関士へSI指示書およびインボイスを回送し、通関申告手配を決定';
        break;
      case 'INQUIRY_HELLMANN':
        title = '【決定】ヘルマン社へ通関確認・書類照会を送信';
        defaultNote = '通関士からの質疑（該非判定・SDS等）についてヘルマン社宛てに正式照会決定';
        break;
      case 'RESOLVE':
        title = '【決定】社内解決・回答完了としてクローズ';
        defaultNote = '社内確認により疑義解消、回答完了としてクローズ決定';
        break;
      case 'DISMISS':
        title = '【決定】書類不備による差戻し・却下';
        defaultNote = 'SI指示書またはインボイスの必須項目欠落のため差戻し決定';
        break;
    }

    setDecisionModal({
      isOpen: true,
      mail,
      actionType,
      title,
      note: defaultNote,
    });
  };

  const handleExecuteDecision = () => {
    if (!decisionModal.mail) return;
    const mail = decisionModal.mail;
    const action = decisionModal.actionType;
    const note = decisionModal.note;

    if (action === 'IMPORT_SHIPMENT') {
      // 案件として自動作成（Gemini AIトークン消費ゼロ：高速ローカル抽出）
      const order = mail.rawHellmannOrder;
      const localExtracted = extractLogisticsInfoFromEmailText(mail.body || '', mail.subject || '');
      const mawb = mail.mawbNumber || localExtracted.mawb || order?.mawbCandidate || `131-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;
      const hawb = mail.hawbNumber || localExtracted.hawb || order?.hawbCandidate || `HLM-${Math.floor(10000 + Math.random() * 90000)}`;
      const shipper = localExtracted.shipper || order?.shipperCandidate || 'NIPPON ADVANCED TECHNOLOGY CO., LTD.';
      const consignee = localExtracted.consignee || order?.consigneeCandidate || 'PACIFIC ROBOTICS USA INC.';
      const flight = localExtracted.flightRoute || order?.flightCandidate || 'NH006 / NRT -> LAX';
      const pieces = localExtracted.pieces || order?.piecesCandidate || '8 PKGS';
      const grossWeight = localExtracted.grossWeight || order?.weightCandidate || '320.5 KG';
      const pol = localExtracted.portOfLoading || 'NRT';
      const dest = localExtracted.destination || 'LAX';

      // Extract PDF data URL if present
      const pdfAttachment = mail.attachments?.find((a) => a.isPdf && a.dataUrl);

      const todayIso = new Date().toISOString().split('T')[0];
      const newShipment = createShipment({
        mawbNumber: mawb,
        hawbNumber: hawb,
        orderNumber: localExtracted.orderNumber || `HLM-${Date.now().toString().slice(-6)}`,
        invoiceNumber: localExtracted.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`,
        customsClearanceDate: todayIso,
        shipper,
        consignee,
        portOfLoading: pol,
        destination: dest,
        flightRoute: flight,
        pieces,
        grossWeight,
        specialNotes: `【M365メール決定取込】${mail.subject}\n決定メモ: ${note}`,
        pdfDataUrl: pdfAttachment?.dataUrl,
      });

      // Link thread
      linkShipmentToHellmannOrder(newShipment.id, mail.id);

      // Record decision
      applyMailDecision(mail.id, 'DECIDED_IMPORTED', {
        note,
        decidedBy: '通関オペレーション責任者',
      });

      // Auto-create outgoing customs request to broker
      sendOutgoingMailFromClient({
        toRecipients: [settings.brokerDefaultEmail || 'customs-brokerage@yourcompany.com'],
        subject: `【通関依頼】${mawb} / ${hawb} 輸出通関申告のお願い`,
        body: `通関士各位\n\nお疲れ様です。標記案件のSI指示書・インボイスをメール決定により取り込みました。\n通関申告の手配をお願いいたします。\n\n・MAWB: ${mawb}\n・HAWB: ${hawb}\n・便名: ${flight}\n・決定メモ: ${note}`,
        attachments: mail.attachments,
        mawbNumber: mawb,
        hawbNumber: hawb,
        shipmentId: newShipment.id,
        decisionStatus: 'DECIDED_FORWARDED_BROKER',
      });
    } else if (action === 'EXTERNAL_REG') {
      applyMailDecision(mail.id, 'DECIDED_EXTERNAL_REGISTERED', {
        note,
        decidedBy: '基幹システム連携担当',
      });
    } else if (action === 'FORWARD_BROKER') {
      applyMailDecision(mail.id, 'DECIDED_FORWARDED_BROKER', {
        note,
        decidedBy: '通関オペレーター',
      });
      // Outgoing email
      sendOutgoingMailFromClient({
        toRecipients: [settings.brokerDefaultEmail || 'customs-brokerage@yourcompany.com'],
        subject: `【通関依頼】${mail.subject || '（件名なし）'}`,
        body: `通関士各位\n\nお疲れ様です。本件通関手配の依頼を決定いたしました。\n\n決定メモ: ${note}\n\n--- 元メール本文 ---\n${mail.body || (mail as any).bodyText || ''}`,
        attachments: mail.attachments,
        mawbNumber: mail.mawbNumber,
        hawbNumber: mail.hawbNumber,
      });
    } else if (action === 'INQUIRY_HELLMANN') {
      applyMailDecision(mail.id, 'DECIDED_INQUIRY_SENT', {
        note,
        decidedBy: '輸出CS担当',
      });
      sendOutgoingMailFromClient({
        toRecipients: ['export-ops.tyo@hellmann.com'],
        ccRecipients: [settings.brokerDefaultEmail || 'customs-brokerage@yourcompany.com'],
        subject: `【至急確認照会】${mail.subject}`,
        body: `ヘルマンご担当者様\n\nいつもお世話になっております。標記案件について社内通関士より確認依頼が届いております。\n\n【照会内容】\n${note}\n\nお忙しいところ恐縮ですが、至急ご確認の上ご返信いただけますようお願い申し上げます。`,
        mawbNumber: mail.mawbNumber,
        hawbNumber: mail.hawbNumber,
        decisionStatus: 'DECIDED_INQUIRY_SENT',
      });
    } else if (action === 'RESOLVE') {
      applyMailDecision(mail.id, 'DECIDED_RESOLVED', {
        note,
        decidedBy: '通関審査官',
      });
      if (mail.sourceType === 'BROKER_QUESTION') {
        sendOutgoingMailFromClient({
          toRecipients: [mail.sender.email],
          subject: `Re: ${mail.subject} 【回答完了】`,
          body: `担当通関士様\n\nお疲れ様です。ご質問の件、回答いたします。\n\n【回答・決定メモ】\n${note}\n\nご確認のほどよろしくお願い申し上げます。`,
          mawbNumber: mail.mawbNumber,
          hawbNumber: mail.hawbNumber,
        });
      }
    } else if (action === 'DISMISS') {
      applyMailDecision(mail.id, 'DECIDED_DISMISSED', {
        note,
        decidedBy: '通関オペレーター',
      });
    }

    setDecisionModal({ isOpen: false, mail: null, actionType: 'IMPORT_SHIPMENT', title: '', note: '' });
    reloadMessages();
  };

  // -------------------------------------------------------------
  // Reply Templates Management & Formatting
  // -------------------------------------------------------------
  const loadReplyTemplates = async () => {
    try {
      const list = await fetchAllReplyTemplates();
      setReplyTemplates(list);
    } catch (e) {
      console.warn('Failed to load reply templates:', e);
    }
  };

  useEffect(() => {
    loadReplyTemplates();
  }, []);

  const handleApplyReplyTemplate = (tmpl: ReplyTemplate) => {
    if (!selectedMail) return;

    const extracted = extractLogisticsInfoFromEmailText(selectedMail.body || '', selectedMail.subject || '');

    const awb =
      selectedMail.hawbNumber ||
      selectedMail.mawbNumber ||
      selectedMail.rawHellmannOrder?.hawbCandidate ||
      selectedMail.rawHellmannOrder?.mawbCandidate ||
      extracted.hawb ||
      extracted.mawb ||
      '';

    const grossWeight =
      selectedMail.rawHellmannOrder?.weightCandidate ||
      extracted.grossWeight ||
      null;

    const pieces =
      selectedMail.rawHellmannOrder?.piecesCandidate ||
      extracted.pieces ||
      null;

    const destination =
      selectedMail.rawHellmannOrder?.flightCandidate ||
      extracted.destination ||
      extracted.flightRoute ||
      null;

    const shipper =
      selectedMail.rawHellmannOrder?.shipperCandidate ||
      extracted.shipper ||
      null;

    const consignee =
      selectedMail.rawHellmannOrder?.consigneeCandidate ||
      extracted.consignee ||
      null;

    const formatted = formatReplyTemplate(tmpl.body, {
      awb,
      grossWeight,
      pieces,
      destination,
      shipper,
      consignee,
      operatorName: settings.brokerDefaultName || '輸出オペレーター',
    });

    setReplyText(formatted);
    if (replyTextareaRef.current) {
      replyTextareaRef.current.focus();
    }
  };

  // -------------------------------------------------------------
  // Reply & Reply-All Handlers with Auto-Scroll
  // -------------------------------------------------------------
  const handleStartReply = (mode: 'reply' | 'replyAll') => {
    if (!selectedMail) return;

    setReplyMode(mode);
    setIsReplying(true);

    // 宛先 (To): 常に差出人のアドレス
    const to = selectedMail.sender?.email ? [selectedMail.sender.email] : [];
    setReplyTo(to);

    // CC: 全員返信の場合は元のTo・CCから差出人と自分/共有アドレスを除いた全員
    if (mode === 'replyAll') {
      const myEmails = [
        (settings.groupEmail || '').toLowerCase().trim(),
        (settings.userPrincipalName || '').toLowerCase().trim(),
      ].filter(Boolean);

      const senderEmailLower = (selectedMail.sender?.email || '').toLowerCase().trim();
      const allRecipients = [...normalizedToRecipients, ...normalizedCcRecipients];
      const ccSet = new Set<string>();

      allRecipients.forEach((email) => {
        const clean = email.trim();
        const cleanLower = clean.toLowerCase();
        if (
          clean &&
          cleanLower !== senderEmailLower &&
          !myEmails.includes(cleanLower)
        ) {
          ccSet.add(clean);
        }
      });

      setReplyCc(Array.from(ccSet));
    } else {
      // 通常返信: CCなし
      setReplyCc([]);
    }

    const baseSubject = selectedMail.subject || '';
    const subject = baseSubject.startsWith('Re:') ? baseSubject : `Re: ${baseSubject}`;
    setReplySubject(subject);

    // メール作成画面まで自動でスムーズスクロールし、入力欄にフォーカス
    setTimeout(() => {
      if (replyBoxRef.current) {
        replyBoxRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      if (replyTextareaRef.current) {
        replyTextareaRef.current.focus();
      }
    }, 100);
  };

  const handleSendInlineReply = () => {
    if (!selectedMail || !replyText.trim()) return;

    const toRecipients = replyTo.length > 0 ? replyTo : [selectedMail.sender.email];
    const ccRecipients = replyCc;
    const subject = replySubject || (selectedMail.subject.startsWith('Re:') ? selectedMail.subject : `Re: ${selectedMail.subject}`);

    // Build rich reply bodies (Plain text and rich HTML with signature and full quoted original mail preserving fonts, colors, borders, tables)
    const { plainBody, htmlBody } = buildReplyBodies({
      replyText,
      originalMail: selectedMail,
      operatorName,
    });

    sendOutgoingMailFromClient({
      toRecipients,
      ccRecipients,
      subject,
      body: plainBody,
      bodyHtml: htmlBody,
      senderName: operatorName,
      mawbNumber: selectedMail.mawbNumber,
      hawbNumber: selectedMail.hawbNumber,
      shipmentId: selectedMail.shipmentId,
      decisionStatus: 'DECIDED_RESOLVED',
    });

    // Send via real Graph API if production mode configured
    if (!settings.isDemoMode && settings.tenantId && settings.clientId) {
      sendMailViaGraphBackend({
        toRecipients,
        ccRecipients,
        subject,
        body: htmlBody,
        isHtml: true,
      }).catch((e) => console.warn('Graph API send failed:', e));
    }

    // Mark current mail as resolved
    applyMailDecision(selectedMail.id, 'DECIDED_RESOLVED', {
      note: replyMode === 'replyAll' ? '全員返信送信完了' : '返信送信完了',
      decidedBy: operatorName || 'オペレーター',
    });

    setReplyText('');
    setIsReplying(false);
    setShowQuotedPreview(false);
    reloadMessages();
  };

  const handleUpdateSourceType = (
    mailId: string,
    newType: 'HELLMANN_ORDER' | 'BROKER_QUESTION' | 'CUSTOMS_REQUEST' | 'CUSTOMS_INQUIRY' | 'HELLMANN_ANSWER' | 'BROKER_REPLY' | 'GENERAL'
  ) => {
    updateMailSourceType(mailId, newType);
    if (currentFolder === 'INBOX_HELLMANN' && newType === 'BROKER_QUESTION') {
      setCurrentFolder('INBOX_BROKER');
    } else if (currentFolder === 'INBOX_BROKER' && newType === 'HELLMANN_ORDER') {
      setCurrentFolder('INBOX_HELLMANN');
    }
    setSelectedMailId(mailId);
    reloadMessages();
  };

  const handleExcludeFromHellmann = (mailId: string) => {
    excludeFromHellmannOrder(mailId);
    reloadMessages();
  };

  // -------------------------------------------------------------
  // Send Compose Modal
  // -------------------------------------------------------------
  const handleSendCompose = (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) return;

    const toList = composeTo.split(',').map((s) => s.trim()).filter(Boolean);
    const ccList = composeCc.split(',').map((s) => s.trim()).filter(Boolean);

    sendOutgoingMailFromClient({
      toRecipients: toList,
      ccRecipients: ccList,
      subject: composeSubject,
      body: composeBody,
      decisionStatus: 'DECIDED_FORWARDED_BROKER',
    });

    // Send via real Graph API if production mode configured
    if (!settings.isDemoMode && settings.tenantId && settings.clientId) {
      sendMailViaGraphBackend({
        toRecipients: toList,
        ccRecipients: ccList,
        subject: composeSubject,
        body: composeBody,
      }).catch((e) => console.warn('Graph API send failed:', e));
    }

    setIsComposeOpen(false);
    setComposeTo('');
    setComposeCc('');
    setComposeSubject('');
    setComposeBody('');
    setComposeTemplate('');
    reloadMessages();
  };

  const handleApplyComposeTemplate = (tpl: string) => {
    setComposeTemplate(tpl);
    if (tpl === 'BROKER_REQUEST') {
      setComposeTo(settings.brokerDefaultEmail || 'customs-brokerage@yourcompany.com');
      setComposeSubject('【輸出通関依頼】新規航空貨物 申告手配の件');
      setComposeBody(`通関課各位\n\nお疲れ様です。輸出オペレーション担当です。\n下記航空貨物の輸出通関申告をお願いいたします。\n\n・MAWB: \n・HAWB: \n・便名/CUT: \n・品名: \n\n添付書類をご確認いただき、申告準備をお願いいたします。`);
    } else if (tpl === 'HELLMANN_INQUIRY') {
      setComposeTo('export-ops.tyo@hellmann.com');
      setComposeCc(settings.brokerDefaultEmail || 'customs-brokerage@yourcompany.com');
      setComposeSubject('【至急・通関確認】SDSおよび該非判定書の送付依頼');
      setComposeBody(`ヘルマン航空輸出チーム各位\n\nいつも大変お世話になっております。\n標記案件について、税関申告の事前確認のため下記書類の提出が必要となっております。\n\n【確認事項】\n1. 最新の安全データシート (SDS / MSDS)\n2. 外為法該非判定書（非該当証明書）\n\n恐れ入りますが、至急ご確認の上ご送付いただけますと幸いです。`);
    } else if (tpl === 'PERMIT_REPORT') {
      setComposeTo('export-ops.tyo@hellmann.com');
      setComposeSubject('【通関許可報告】輸出許可書送付の件');
      setComposeBody(`ヘルマン各位\n\nお疲れ様です。輸出通関が完了（許可）いたしましたのでご連絡いたします。\n保税蔵置場からの搬出・航空会社への引き渡しを進めております。\n\n何卒よろしくお願い申し上げます。`);
    }
  };

  // Helper formatting
  const parseValidDate = (input?: string | number | Date | null): Date | null => {
    if (!input) return null;
    if (input instanceof Date) {
      return isNaN(input.getTime()) ? null : input;
    }
    if (typeof input === 'number') {
      const d = new Date(input);
      return isNaN(d.getTime()) ? null : d;
    }
    const str = String(input).trim();
    if (!str || str === 'Invalid Date' || str.includes('NaN')) return null;

    let d = new Date(str);
    if (!isNaN(d.getTime())) return d;

    // Try parsing YYYY/MM/DD HH:mm:ss or YYYY-MM-DD HH:mm:ss
    const normalized = str.replace(/\//g, '-').replace(' ', 'T');
    d = new Date(normalized);
    if (!isNaN(d.getTime())) return d;

    return null;
  };

  const formatTime = (isoString?: string | null) => {
    const d = parseValidDate(isoString);
    if (!d) {
      return (isoString && typeof isoString === 'string' && !isoString.includes('NaN') && isoString !== 'Invalid Date')
        ? isoString
        : '-';
    }
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs >= 0) {
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 60) return `${Math.max(1, diffMin)}分前`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}時間前`;
    }

    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  };

  const formatFullDate = (isoString?: string | null) => {
    const d = parseValidDate(isoString);
    if (!d) {
      return (isoString && typeof isoString === 'string' && !isoString.includes('NaN') && isoString !== 'Invalid Date')
        ? isoString
        : '-';
    }
    return d.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDecisionBadge = (status: MailDecisionStatus) => {
    switch (status) {
      case 'PENDING_DECISION':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">
            <Clock className="w-3 h-3 mr-1 text-amber-600" />
            決定待ち
          </span>
        );
      case 'DECIDED_IMPORTED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
            案件取込 決定済
          </span>
        );
      case 'DECIDED_EXTERNAL_REGISTERED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <Building className="w-3 h-3 mr-1 text-blue-600" />
            基幹登録 決定済
          </span>
        );
      case 'DECIDED_FORWARDED_BROKER':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">
            <Send className="w-3 h-3 mr-1 text-indigo-600" />
            通関手配 決定済
          </span>
        );
      case 'DECIDED_INQUIRY_SENT':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-300">
            <HelpCircle className="w-3 h-3 mr-1 text-purple-600" />
            照会送信 決定済
          </span>
        );
      case 'DECIDED_RESOLVED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-teal-100 text-teal-800 border border-teal-300">
            <Check className="w-3 h-3 mr-1 text-teal-600" />
            回答・解決済
          </span>
        );
      case 'DECIDED_DISMISSED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <AlertTriangle className="w-3 h-3 mr-1 text-rose-600" />
            差戻し/却下
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col h-screen w-screen overflow-hidden text-slate-800 font-sans antialiased">
      {/* ========================================================================= */}
      {/* 1. Top Header Bar (Gmail-style Top Nav) */}
      {/* ========================================================================= */}
      <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between shrink-0 shadow-sm z-20">
        {/* Left: Brand / Service Info & Back Button */}
        <div className="flex items-center space-x-3">
          {/* Main Return Button */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-md shadow-slate-900/10 transition-all active:scale-95 cursor-pointer"
            title="輸出進捗管理ダッシュボードに戻る"
          >
            <ArrowLeft className="w-4 h-4 text-slate-300" />
            <span>輸出進捗管理に戻る</span>
          </button>

          <div className="h-5 w-px bg-slate-200" />

          {/* Logo & Shared Mailbox Label */}
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-sm font-bold text-slate-900 tracking-tight">共通メールハブ</h1>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  共有メールボックス
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono leading-none mt-0.5">
                {settings.groupEmail}
              </p>
            </div>
          </div>
        </div>

        {/* Center: Search Box */}
        <div className="flex-1 max-w-xl mx-4 hidden md:block">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="メール検索 (件名、差出人、AWB番号、本文...)"
              className="w-full pl-10 pr-10 py-2 bg-slate-100 hover:bg-slate-100/80 focus:bg-white text-xs text-slate-800 placeholder-slate-400 rounded-full border border-slate-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-all shadow-inner"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Right: Actions & Settings */}
        <div className="flex items-center space-x-2">
          {/* Sync Intervals Indicator */}
          <div className="hidden md:flex items-center gap-2 text-[11px] font-mono text-slate-500 bg-slate-100/90 px-2.5 py-1 rounded-lg border border-slate-200">
            <div className="flex items-center gap-1" title="受信チェック周期">
              <span className={`w-2 h-2 rounded-full ${timerState.isInboxSyncing ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'}`} />
              <span className="font-sans font-bold text-slate-700">受信:</span>
              <span>{settings.inboxSyncIntervalSeconds ?? 120}秒</span>
            </div>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1" title="送信チェック周期">
              <span className={`w-2 h-2 rounded-full ${timerState.isSentSyncing ? 'bg-amber-500 animate-ping' : 'bg-blue-500'}`} />
              <span className="font-sans font-bold text-slate-700">送信:</span>
              <span>{settings.sentSyncIntervalSeconds ?? 300}秒</span>
            </div>
          </div>

          {/* Sync Status Badge */}
          {syncNotice && (
            <div
              className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium border animate-in fade-in ${
                syncNotice.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-amber-50 text-amber-900 border-amber-300'
              }`}
            >
              {syncNotice.type === 'success' ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              )}
              <span className="truncate max-w-[200px] sm:max-w-xs">{syncNotice.message}</span>
              {syncNotice.canOpenSettings && (
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="underline font-bold text-blue-700 hover:text-blue-900 shrink-0 cursor-pointer ml-1"
                >
                  設定変更
                </button>
              )}
            </div>
          )}

          {/* Sync Refresh Button */}
          <button
            type="button"
            onClick={handleSyncRefresh}
            disabled={syncing}
            className={`p-2 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 transition-all cursor-pointer ${
              syncing ? 'animate-spin text-blue-600 bg-blue-50' : ''
            }`}
            title="最新メールを受信・同期 (Microsoft Graph API / デモ)"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* Settings Modal Trigger */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer relative"
            title="Microsoft Graph API 接続設定"
          >
            <Settings className="w-4 h-4" />
            {!settings.isDemoMode && (!settings.tenantId || !settings.clientId) && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full ring-2 ring-white" />
            )}
          </button>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. Main 3-Pane Body Layout */}
      {/* ========================================================================= */}
      <div className="flex-1 flex overflow-hidden">
        {/* ------------------------------------------------------------- */}
        {/* Left Pane: Tree Structure Navigation (Gmail Left Sidebar)     */}
        {/* ------------------------------------------------------------- */}
        <aside className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col justify-between shrink-0 overflow-y-auto">
          <div className="p-3 space-y-3">
            {/* Compose Button */}
            <button
              type="button"
              onClick={() => setIsComposeOpen(true)}
              className="w-full flex items-center justify-center space-x-2 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl shadow-md shadow-blue-500/20 text-xs font-bold tracking-wide transition-all transform active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-white stroke-[2.5]" />
              <span>メール新規作成</span>
            </button>

            {/* Tree Section: Inbox & Categories */}
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setIsInboxTreeOpen(!isInboxTreeOpen)}
                className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-600 cursor-pointer"
              >
                <span>受信トレイ</span>
                {isInboxTreeOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>

              {isInboxTreeOpen && (
                <div className="space-y-0.5 pl-1">
                  {/* All Inbox */}
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentFolder('INBOX');
                      setSelectedAwbFilter(null);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      currentFolder === 'INBOX'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <Inbox className="w-4 h-4" />
                      <span>すべての受信</span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      {counts.unreadInbox > 0 && (
                        <span
                          className={`text-[10px] px-1.5 py-0.2 font-extrabold rounded-full ${
                            currentFolder === 'INBOX'
                              ? 'bg-white text-blue-700 shadow-xs'
                              : 'bg-blue-600 text-white shadow-xs'
                          }`}
                        >
                          未読 {counts.unreadInbox}
                        </span>
                      )}
                      {counts.totalInbox > 0 && (
                        <span
                          className={`text-[10px] px-1.5 py-0.2 font-mono ${
                            currentFolder === 'INBOX'
                              ? 'text-blue-100'
                              : 'text-slate-400'
                          }`}
                        >
                          {counts.totalInbox}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Hellmann Orders */}
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentFolder('INBOX_HELLMANN');
                      setSelectedAwbFilter(null);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      currentFolder === 'INBOX_HELLMANN'
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      <span>ヘルマン通関依頼</span>
                    </div>
                    {counts.hellmannPending > 0 && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 font-bold rounded-full ${
                          currentFolder === 'INBOX_HELLMANN'
                            ? 'bg-white text-amber-700'
                            : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}
                      >
                        {counts.hellmannPending}
                      </span>
                    )}
                  </button>

                  {/* Broker Questions */}
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentFolder('INBOX_BROKER');
                      setSelectedAwbFilter(null);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      currentFolder === 'INBOX_BROKER'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <HelpCircle className="w-4 h-4 text-indigo-500" />
                      <span>通関士質疑メール</span>
                    </div>
                    {counts.brokerPending > 0 && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 font-bold rounded-full ${
                          currentFolder === 'INBOX_BROKER'
                            ? 'bg-white text-indigo-700'
                            : 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                        }`}
                      >
                        {counts.brokerPending}
                      </span>
                    )}
                  </button>

                  {/* General / Other Emails */}
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentFolder('INBOX_GENERAL');
                      setSelectedAwbFilter(null);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      currentFolder === 'INBOX_GENERAL'
                        ? 'bg-slate-700 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <FileText className="w-4 h-4 text-slate-500" />
                      <span>その他メール</span>
                    </div>
                    {counts.generalCount > 0 && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 font-bold rounded-full ${
                          currentFolder === 'INBOX_GENERAL'
                            ? 'bg-white text-slate-800'
                            : 'bg-slate-200 text-slate-700 border border-slate-300'
                        }`}
                      >
                        {counts.generalCount}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Tree Section: Decision Status View (決定状態別ツリー) */}
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setIsDecisionTreeOpen(!isDecisionTreeOpen)}
                className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-600 cursor-pointer"
              >
                <span>決定ステータス</span>
                {isDecisionTreeOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>

              {isDecisionTreeOpen && (
                <div className="space-y-0.5 pl-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentFolder('PENDING_DECISION');
                      setSelectedAwbFilter(null);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      currentFolder === 'PENDING_DECISION'
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <Clock className="w-4 h-4 text-amber-500" />
                      <span>未決定・アクション待ち</span>
                    </div>
                    {counts.allPendingDecisions > 0 && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 font-bold rounded-full ${
                          currentFolder === 'PENDING_DECISION'
                            ? 'bg-white text-amber-700'
                            : 'bg-amber-200 text-amber-900'
                        }`}
                      >
                        {counts.allPendingDecisions}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCurrentFolder('DECIDED');
                      setSelectedAwbFilter(null);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      currentFolder === 'DECIDED'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span>決定済み・処理完了</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {counts.allDecided}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {/* Tree Section: Standard Mail Folders */}
            <div className="space-y-0.5 pt-1 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setCurrentFolder('SENT');
                  setSelectedAwbFilter(null);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  currentFolder === 'SENT'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Send className="w-4 h-4" />
                  <span>送信済みトレイ</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  {counts.sent}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCurrentFolder('STARRED');
                  setSelectedAwbFilter(null);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  currentFolder === 'STARRED'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                  <span>スター付き</span>
                </div>
                {counts.starred > 0 && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    {counts.starred}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setCurrentFolder('TRASH');
                  setSelectedAwbFilter(null);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  currentFolder === 'TRASH'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Trash2 className="w-4 h-4" />
                  <span>ゴミ箱</span>
                </div>
                {counts.trash > 0 && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    {counts.trash}
                  </span>
                )}
              </button>
            </div>

            {/* Tree Section: AWB / HAWB Threads (AWB案件別ツリー - 通関日集約) */}
            <div className="space-y-1 pt-1 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsAwbTreeOpen(!isAwbTreeOpen)}
                className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-600 cursor-pointer"
              >
                <div className="flex items-center space-x-1.5">
                  <span>AWB 案件別ツリー</span>
                  <span className="text-[10px] text-slate-400 font-normal">({totalAwbCount})</span>
                </div>
                {isAwbTreeOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>

              {isAwbTreeOpen && (
                <div className="space-y-1 pl-0.5 max-h-64 overflow-y-auto">
                  {/* Unassigned AWBs Button (★最上部固定) */}
                  {unassignedAwbCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentFolder('AWB_THREAD');
                        setSelectedAwbFilter('__UNASSIGNED__');
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                        currentFolder === 'AWB_THREAD' && selectedAwbFilter === '__UNASSIGNED__'
                          ? 'bg-amber-100 text-amber-900 font-bold border border-amber-300 shadow-2xs'
                          : 'text-amber-800 hover:bg-amber-50/80 bg-amber-50/40 border border-amber-200/60'
                      }`}
                      title="AWB/HAWB番号が未抽出・未紐付けのメール"
                    >
                      <span className="truncate flex items-center">
                        <AlertCircle className="w-3.5 h-3.5 mr-1 text-amber-600 shrink-0" />
                        <span className="font-medium">AWB未確定・要確認</span>
                      </span>
                      <span className="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded-full font-mono font-bold ml-1">
                        {unassignedAwbCount}
                      </span>
                    </button>
                  )}

                  {dateAwbGroups.length === 0 && unassignedAwbCount === 0 && (
                    <div className="px-2.5 py-2 text-[11px] text-slate-400 italic">
                      該当するAWBはありません
                    </div>
                  )}

                  {/* 通関日グループ一覧 (最新・未来日 -> 過去日) */}
                  {dateAwbGroups.map((group) => {
                    const isDateOpen = !!expandedDateKeys[group.dateKey];
                    return (
                      <div key={group.dateKey} className="space-y-0.5">
                        {/* 通関日ヘッダー行 (クリックで配下AWBを開閉) */}
                        <button
                          type="button"
                          onClick={() => toggleDateExpand(group.dateKey)}
                          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-200/70 cursor-pointer transition-colors"
                          title={`${group.dateLabel} (${group.awbList.length}件のAWB)`}
                        >
                          <div className="flex items-center space-x-1.5 truncate">
                            {isDateOpen ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            )}
                            <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span className="truncate text-[11.5px]">{group.dateLabel}</span>
                          </div>
                          <span className="text-[10px] bg-slate-200/80 text-slate-600 px-1.5 py-0.5 rounded-full font-mono font-bold ml-1 shrink-0">
                            {group.awbList.length}
                          </span>
                        </button>

                        {/* 配下の AWB番号ツリー (展開時のみ表示) */}
                        {isDateOpen && (
                          <div className="space-y-0.5 pl-4 border-l-2 border-indigo-100 ml-3 py-0.5">
                            {group.awbList.map(({ awb, count }, idx) => (
                              <button
                                key={`${group.dateKey}-${awb}-${idx}`}
                                type="button"
                                onClick={() => {
                                  setCurrentFolder('AWB_THREAD');
                                  setSelectedAwbFilter(awb);
                                }}
                                className={`w-full flex items-center justify-between px-2 py-1.2 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                                  currentFolder === 'AWB_THREAD' && selectedAwbFilter === awb
                                    ? 'bg-blue-100 text-blue-900 font-bold border border-blue-300'
                                    : 'text-slate-600 hover:bg-slate-200/60'
                                }`}
                              >
                                <span className="truncate text-[11px]">{awb}</span>
                                <span className="text-[10px] text-slate-400 font-bold ml-1">
                                  ({count})
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar Footer Info */}
          <div className="p-3 border-t border-slate-200 bg-white/60 text-[11px] text-slate-500 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">M365 接続状態</span>
              <span className="inline-flex items-center text-emerald-600 font-bold text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />
                オンライン
              </span>
            </div>
            <div className="text-[10px] text-slate-400">
              共通グループ宛ての着信と通関士宛て送信を一元同期
            </div>
          </div>
        </aside>

        {/* ------------------------------------------------------------- */}
        {/* Center Pane: Mail List (メール一覧)                            */}
        {/* ------------------------------------------------------------- */}
        <section className="w-[380px] sm:w-[420px] bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden">
          {/* Filter / Status Bar */}
          <div className="p-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                  statusFilter === 'ALL'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-300'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                すべて
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('UNREAD')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors flex items-center gap-1.5 ${
                  statusFilter === 'UNREAD'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-blue-700 bg-blue-50/90 hover:bg-blue-100 border border-blue-200/80'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${statusFilter === 'UNREAD' ? 'bg-white animate-pulse' : 'bg-blue-600'}`} />
                未読 ({counts.totalUnread})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('PENDING')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                  statusFilter === 'PENDING'
                    ? 'bg-amber-50 text-amber-900 shadow-xs border border-amber-300'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                未決定
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('DECIDED')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                  statusFilter === 'DECIDED'
                    ? 'bg-emerald-50 text-emerald-900 shadow-xs border border-emerald-300'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                決定済
              </button>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-1">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 cursor-pointer transition-colors"
                title="メール表示・同期期間の設定を変更"
              >
                <span>📅</span>
                <span>
                  {settings.syncRetentionMode === 'date' && settings.syncRetentionStartDate
                    ? `${settings.syncRetentionStartDate.slice(5)}〜`
                    : (settings.syncRetentionDays ?? 7) === 0
                    ? '全期間'
                    : `直近${settings.syncRetentionDays ?? 7}日`}
                </span>
              </button>
              <div className="text-[11px] text-slate-400 font-mono">
                {filteredMessages.length} 件
              </div>
            </div>
          </div>

          {/* Active AWB / Category Tree Filter Indicator */}
          {currentFolder === 'AWB_THREAD' && (
            <div className="px-3 py-2 bg-blue-50/90 border-b border-blue-200 flex items-center justify-between text-xs shrink-0 select-none">
              <div className="flex items-center space-x-1.5 truncate">
                <span className="font-semibold text-blue-900">ツリー絞り込み:</span>
                {selectedAwbFilter === '__UNASSIGNED__' ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px] font-bold border border-amber-300">
                    <AlertCircle className="w-3 h-3 mr-1 text-amber-600" />
                    AWB未確定・要確認 ({filteredMessages.length}件)
                  </span>
                ) : (
                  <span className="font-mono font-bold text-blue-900 bg-white px-2 py-0.5 rounded border border-blue-300">
                    {selectedAwbFilter || 'すべて'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setCurrentFolder('INBOX');
                  setSelectedAwbFilter(null);
                }}
                className="text-[11px] text-blue-700 hover:text-blue-900 hover:underline shrink-0 ml-2 cursor-pointer font-medium"
              >
                解除 ✕
              </button>
            </div>
          )}

          {/* Mail Items Scrollable List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredMessages.length === 0 ? (
              <div className="p-8 text-center text-slate-400 space-y-2">
                <Mail className="w-10 h-10 mx-auto text-slate-300 stroke-1" />
                <p className="text-xs font-semibold text-slate-600">メッセージはありません</p>
                <p className="text-[11px] text-slate-400 max-w-xs mx-auto leading-relaxed">
                  設定グループメール（{settings.groupEmail || '未設定'}）に送受信されたメッセージが表示されます。
                </p>
              </div>
            ) : (
              filteredMessages.map((mail, idx) => {
                const isSelected = selectedMail?.id === mail.id;
                const isUnread = !mail.isRead;

                return (
                  <div
                    key={`${mail.id}-${idx}`}
                    onClick={() => {
                      setSelectedMailId(mail.id);
                      if (!mail.isRead) {
                        setMailReadState(mail.id, true);
                      }
                    }}
                    className={`p-3.5 transition-all cursor-pointer relative group ${
                      isSelected
                        ? 'bg-blue-100/90 border-l-4 border-blue-600 shadow-xs ring-1 ring-blue-300/80 z-10'
                        : isUnread
                        ? 'bg-blue-50/60 hover:bg-blue-50/90 border-l-4 border-blue-500 font-medium'
                        : 'bg-white hover:bg-slate-50 border-l-4 border-transparent'
                    }`}
                  >
                    {/* Top line: Unread indicator, Sender, Star & Date */}
                    <div className="flex items-center justify-between mb-1.5 gap-2">
                      <div className="flex items-center space-x-1.5 min-w-0 pr-1 flex-1">
                        {/* Unread Glow Dot or Star */}
                        <button
                          type="button"
                          onClick={(e) => handleToggleStar(e, mail.id)}
                          className="text-slate-300 hover:text-amber-500 cursor-pointer shrink-0"
                          title={mail.isStarred ? 'スターを解除' : 'スターを付ける'}
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              mail.isStarred ? 'text-amber-500 fill-amber-500' : ''
                            }`}
                          />
                        </button>

                        {/* Unread Badge Tag */}
                        {isUnread && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-600 text-white text-[9px] font-black shadow-2xs shrink-0 tracking-wide">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                            未読
                          </span>
                        )}

                        <span
                          className={`text-xs truncate ${
                            isSelected
                              ? 'font-extrabold text-blue-950'
                              : isUnread
                              ? 'font-black text-slate-950'
                              : 'text-slate-700'
                          }`}
                        >
                          {mail.sender.name}
                        </span>
                      </div>

                      <div className="flex items-center space-x-1 shrink-0">
                        {/* Mark Read/Unread quick button on hover */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMailReadState(mail.id, !mail.isRead);
                          }}
                          className={`p-1 rounded-md transition-colors ${
                            isUnread
                              ? 'text-blue-600 hover:bg-blue-100 opacity-90'
                              : 'text-slate-300 hover:text-slate-600 hover:bg-slate-100 opacity-0 group-hover:opacity-100'
                          }`}
                          title={mail.isRead ? '未読にする' : '既読にする'}
                        >
                          {mail.isRead ? (
                            <MailOpen className="w-3.5 h-3.5" />
                          ) : (
                            <Mail className="w-3.5 h-3.5 text-blue-600" />
                          )}
                        </button>

                        {isSelected && (
                          <span className="text-[9px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full shadow-2xs">
                            選択中
                          </span>
                        )}
                        <span className={`text-[10px] font-mono ${isSelected ? 'text-blue-900 font-bold' : isUnread ? 'text-blue-900 font-bold' : 'text-slate-400'}`}>
                          {formatTime(mail.receivedOrSentAt)}
                        </span>
                      </div>
                    </div>

                    {/* Subject */}
                    <h4
                      className={`text-xs mb-1 line-clamp-1 ${
                        isSelected
                          ? 'font-bold text-blue-950'
                          : isUnread
                          ? 'font-extrabold text-slate-950'
                          : 'text-slate-800'
                      }`}
                    >
                      {mail.subject}
                    </h4>

                    {/* Body Snippet */}
                    <p className={`text-[11px] line-clamp-2 leading-relaxed mb-2 ${
                      isSelected ? 'text-blue-900/80 font-medium' : isUnread ? 'text-slate-700 font-medium' : 'text-slate-500'
                    }`}>
                      {(mail.body || (mail as any).bodyText || '').replace(/\n+/g, ' ')}
                    </p>

                    {/* Badges & Meta Tags */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                        {/* Source Type Tag */}
                        {mail.sourceType === 'HELLMANN_ORDER' && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                            ヘルマン依頼
                          </span>
                        )}
                        {mail.sourceType === 'BROKER_QUESTION' && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-300">
                            通関士質疑
                          </span>
                        )}
                        {mail.sourceType === 'GENERAL' && (() => {
                          const sEmail = (mail.sender?.email || '').toLowerCase();
                          const sName = (mail.sender?.name || '').toLowerCase();
                          if (sEmail.includes('hellmann.com') || sEmail.includes('hellmann') || sName.includes('ヘルマン')) {
                            return (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-300">
                                ヘルマンから受信
                              </span>
                            );
                          }
                          if (sEmail.includes('tac-japan.co.jp') || sEmail.includes('@tac-') || sEmail.includes('osasales') || sEmail.includes('kita')) {
                            return (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 border border-teal-300">
                                社内より受信
                              </span>
                            );
                          }
                          return (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              その他
                            </span>
                          );
                        })()}
                        {mail.sourceType === 'CUSTOMS_REQUEST' && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">
                            通関依頼(送)
                          </span>
                        )}
                        {mail.sourceType === 'CUSTOMS_INQUIRY' && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200">
                            通関照会(送)
                          </span>
                        )}

                        {/* Decision Status Badge */}
                        {getDecisionBadge(mail.decisionStatus)}

                        {/* AWB Tag if present */}
                        {(mail.mawbNumber || mail.hawbNumber) && (
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                            isSelected ? 'bg-blue-200/80 text-blue-950 border-blue-300 font-semibold' : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {mail.mawbNumber || mail.hawbNumber}
                          </span>
                        )}
                      </div>

                      {/* Attachment indicator */}
                      {mail.attachments && mail.attachments.length > 0 && (
                        <div
                          className={`flex items-center text-[10px] font-mono shrink-0 ml-1 ${
                            isSelected ? 'text-blue-700 font-bold' : 'text-slate-400'
                          }`}
                          title={`${mail.attachments.length} 件の添付書類`}
                        >
                          <Paperclip className={`w-3 h-3 mr-0.5 ${isSelected ? 'text-blue-700' : 'text-slate-500'}`} />
                          <span>{mail.attachments.length}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ------------------------------------------------------------- */}
        {/* Right Pane: Mail Content & Decision Actions (決定機能保有)   */}
        {/* ------------------------------------------------------------- */}
        <main className="flex-1 bg-white flex flex-col overflow-hidden">
          {selectedMail ? (
            <div className="flex-1 flex flex-col h-full overflow-y-auto">
              {/* Top Action Toolbar for Selected Mail */}
              <div className="sticky top-0 z-20 p-2.5 sm:p-3 border-b border-slate-200 bg-white/95 backdrop-blur-xs flex flex-wrap items-center justify-between gap-2 shrink-0 shadow-2xs">
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => handleStartReply('reply')}
                    className="inline-flex items-center px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                    title="差出人のみに返信"
                  >
                    <Reply className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                    返信
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartReply('replyAll')}
                    className="inline-flex items-center px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                    title="差出人およびCC関係者全員に返信"
                  >
                    <ReplyAll className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
                    全員返信
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsComposeOpen(true);
                      setComposeSubject(`Fwd: ${selectedMail.subject}`);
                      setComposeBody(`\n\n---------- 転送メッセージ ----------\n差出人: ${selectedMail.sender.name} <${selectedMail.sender.email}>\n日時: ${selectedMail.receivedOrSentAt}\n件名: ${selectedMail.subject}\n\n${selectedMail.body}`);
                    }}
                    className="inline-flex items-center px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    <Forward className="w-3.5 h-3.5 mr-1.5 text-slate-600" />
                    転送
                  </button>
                  <button
                    type="button"
                    onClick={() => setMailReadState(selectedMail.id, !selectedMail.isRead)}
                    className="inline-flex items-center px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                    title={selectedMail.isRead ? '未読状態に変更' : '既読状態に変更'}
                  >
                    {selectedMail.isRead ? (
                      <>
                        <Mail className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                        未読に戻す
                      </>
                    ) : (
                      <>
                        <MailCheck className="w-3.5 h-3.5 mr-1.5 text-blue-600 font-bold" />
                        既読にする
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteMail(selectedMail.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                    title="メールをゴミ箱に移動"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center space-x-2">
                  <div className="flex items-center space-x-1.5 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1 shadow-2xs">
                    <span className="text-[11px] text-indigo-900 font-bold">属性:</span>
                    <select
                      value={selectedMail.sourceType}
                      onChange={(e) => handleUpdateSourceType(selectedMail.id, e.target.value as any)}
                      className="bg-transparent text-indigo-950 text-xs font-bold focus:outline-hidden cursor-pointer"
                      title="メール属性の手動切り替え"
                    >
                      <option value="HELLMANN_ORDER">📦 ヘルマン通関依頼</option>
                      <option value="BROKER_QUESTION">❓ 通関士質疑メール</option>
                      <option value="GENERAL">📄 その他メール</option>
                      <option value="CUSTOMS_REQUEST">📤 通関依頼 (送信)</option>
                      <option value="CUSTOMS_INQUIRY">📩 通関照会 (送信)</option>
                      <option value="HELLMANN_ANSWER">✅ ヘルマン回答</option>
                      <option value="BROKER_REPLY">📋 通関士回答</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyText(selectedMail.subject, 'subject')}
                    className="inline-flex items-center px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                    title="件名をクリップボードにコピー"
                  >
                    {copiedId === 'subject' ? (
                      <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 mr-1 text-slate-500" />
                    )}
                    <span>{copiedId === 'subject' ? '件名コピー完了' : '件名をコピー'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyText(selectedMail.body, 'body')}
                    className="inline-flex items-center px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                    title="メール本文をクリップボードにコピー"
                  >
                    {copiedId === 'body' ? (
                      <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 mr-1 text-slate-500" />
                    )}
                    <span>{copiedId === 'body' ? '本文コピー完了' : '本文をコピー'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const toStr = normalizedToRecipients.join(', ') || (Array.isArray(selectedMail.toRecipients) ? selectedMail.toRecipients.join(', ') : '');
                      const ccStr = normalizedCcRecipients.join(', ') || (Array.isArray(selectedMail.ccRecipients) ? selectedMail.ccRecipients.join(', ') : '');
                      const fullText = `件名: ${selectedMail.subject}\n差出人: ${selectedMail.sender.name} <${selectedMail.sender.email}>\n受信日時: ${formatFullDate(selectedMail.receivedOrSentAt)}\n宛先: ${toStr}\n${ccStr ? `CC: ${ccStr}\n` : ''}\n----------------------------------------\n\n${selectedMail.body}`;
                      handleCopyText(fullText, 'full_mail');
                    }}
                    className="inline-flex items-center px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                    title="ヘッダーおよび本文すべてをコピー"
                  >
                    {copiedId === 'full_mail' ? (
                      <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 mr-1 text-slate-500" />
                    )}
                    <span>{copiedId === 'full_mail' ? '全文コピー完了' : '全文をコピー'}</span>
                  </button>
                </div>
              </div>

              {/* ========================================================= */}
              {/* ★ DECISION ACTION BANNER (決定機能エリア) ★              */}
              {/* ========================================================= */}
              <div className="p-4 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white shrink-0 shadow-md">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-blue-300 flex items-center">
                        <ShieldCheck className="w-4 h-4 mr-1 text-blue-400" />
                        通関オペレーション決定ステータス:
                      </span>
                      {getDecisionBadge(selectedMail.decisionStatus)}
                    </div>
                    {selectedMail.decisionNote && (
                      <p className="text-xs text-slate-300 font-mono select-text">
                        決定メモ: {selectedMail.decisionNote}
                        {selectedMail.decidedBy && ` (${selectedMail.decidedBy})`}
                      </p>
                    )}
                  </div>

                  {/* Decision Action Buttons based on source type */}
                  <div className="flex items-center space-x-2 flex-wrap gap-y-2">
                    {/* If shipment is ALREADY registered in DB (matched MAWB/HAWB), display appropriate actions */}
                    {matchedRegisteredShipment ? (
                      <>
                        <span className="inline-flex items-center px-3 py-1.5 bg-emerald-950/90 text-emerald-300 border border-emerald-500/60 rounded-xl text-xs font-bold shadow-2xs">
                          <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-400" />
                          <span>
                            登録済み案件 ({matchedRegisteredShipment.mawbNumber ? `MAWB: ${matchedRegisteredShipment.mawbNumber}` : ''} {matchedRegisteredShipment.hawbNumber ? `HAWB: ${matchedRegisteredShipment.hawbNumber}` : ''})
                          </span>
                        </span>

                        {onSelectShipment && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectShipment(matchedRegisteredShipment.id);
                              onClose();
                            }}
                            className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md active:scale-95 transition-all cursor-pointer"
                          >
                            <ExternalLink className="w-4 h-4 mr-1.5 text-blue-200" />
                            <span>該当案件（通関・質疑）を開く ➔</span>
                          </button>
                        )}

                        {selectedMail.sourceType === 'BROKER_QUESTION' ? (
                          <>
                            <span className="inline-flex items-center px-3 py-1.5 bg-indigo-950/90 text-indigo-300 border border-indigo-500/60 rounded-xl text-xs font-bold shadow-2xs">
                              <HelpCircle className="w-4 h-4 mr-1.5 text-indigo-400" />
                              <span>通関士質疑メール設定済</span>
                            </span>

                            <button
                              type="button"
                              onClick={() => openDecisionModal(selectedMail, 'INQUIRY_HELLMANN')}
                              className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-extrabold shadow-md shadow-purple-500/20 active:scale-95 transition-all cursor-pointer"
                            >
                              <HelpCircle className="w-4 h-4 mr-1.5" />
                              <span>【決定】ヘルマン社へ照会送信</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openDecisionModal(selectedMail, 'RESOLVE')}
                              className="inline-flex items-center px-3 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer"
                            >
                              <Check className="w-4 h-4 mr-1.5" />
                              <span>【決定】社内解決・回答完了</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleUpdateSourceType(selectedMail.id, 'HELLMANN_ORDER')}
                              className="inline-flex items-center px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded-xl text-xs font-medium active:scale-95 transition-all cursor-pointer"
                              title="このメールの属性を通関依頼メールに変更します"
                            >
                              <span>通関依頼へ戻す</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleExcludeFromHellmann(selectedMail.id)}
                              className="inline-flex items-center px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded-xl text-xs font-medium active:scale-95 transition-all cursor-pointer"
                              title="このメールをその他メールに変更します"
                            >
                              <span>その他へ変更</span>
                            </button>
                          </>
                        ) : selectedMail.sourceType === 'HELLMANN_ORDER' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleUpdateSourceType(selectedMail.id, 'BROKER_QUESTION')}
                              className="inline-flex items-center px-3 py-1.5 bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/60 rounded-xl text-xs font-bold active:scale-95 transition-all cursor-pointer shadow-xs"
                              title="このメールの属性を通関士質疑メールに変更します"
                            >
                              <HelpCircle className="w-3.5 h-3.5 mr-1 text-indigo-300" />
                              <span>通関士質疑へ変更</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleExcludeFromHellmann(selectedMail.id)}
                              className="inline-flex items-center px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-xl text-xs font-semibold active:scale-95 transition-all cursor-pointer"
                              title="このメールを通関依頼から除外し、「その他メール」に変更します"
                            >
                              <X className="w-3.5 h-3.5 mr-1 text-slate-400" />
                              <span>その他へ変更</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleUpdateSourceType(selectedMail.id, 'BROKER_QUESTION')}
                              className="inline-flex items-center px-3 py-1.5 bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/60 rounded-xl text-xs font-bold active:scale-95 transition-all cursor-pointer shadow-xs"
                              title="このメールの属性を通関士質疑メールに変更します"
                            >
                              <HelpCircle className="w-3.5 h-3.5 mr-1 text-indigo-300" />
                              <span>通関士質疑へ変更</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleUpdateSourceType(selectedMail.id, 'HELLMANN_ORDER')}
                              className="inline-flex items-center px-2.5 py-1.5 bg-amber-900/80 hover:bg-amber-800 text-amber-200 border border-amber-500/60 rounded-xl text-xs font-semibold active:scale-95 transition-all cursor-pointer"
                              title="このメールを通関依頼に変更します"
                            >
                              <span>通関依頼へ変更</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openDecisionModal(selectedMail, 'RESOLVE')}
                              className="inline-flex items-center px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer"
                            >
                              <CheckCircle2 className="w-4 h-4 mr-1.5" />
                              <span>処理完了・アーカイブ</span>
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {/* A. Hellmann Order Decisions for NEW unregistered shipments */}
                        {selectedMail.sourceType === 'HELLMANN_ORDER' && (
                          <>
                            <button
                              type="button"
                              onClick={() => openDecisionModal(selectedMail, 'IMPORT_SHIPMENT')}
                              className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white rounded-xl text-xs font-extrabold shadow-md shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer"
                              title="SI指示書PDF・インボイスを解析して案件を自動登録・通関手配を決定"
                            >
                              <FileCheck className="w-4 h-4 mr-1.5" />
                              <span>【決定】案件取込・通関手配</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openDecisionModal(selectedMail, 'EXTERNAL_REG')}
                              className="inline-flex items-center px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer"
                            >
                              <Building className="w-4 h-4 mr-1.5" />
                              <span>【決定】基幹DB登録完了</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleUpdateSourceType(selectedMail.id, 'BROKER_QUESTION')}
                              className="inline-flex items-center px-2.5 py-2 bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/60 rounded-xl text-xs font-bold active:scale-95 transition-all cursor-pointer"
                              title="このメールの属性を通関士質疑メールに変更します"
                            >
                              <HelpCircle className="w-3.5 h-3.5 mr-1 text-indigo-300" />
                              <span>通関士質疑へ変更</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleExcludeFromHellmann(selectedMail.id)}
                              className="inline-flex items-center px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-xl text-xs font-semibold active:scale-95 transition-all cursor-pointer"
                              title="このメールをその他フォルダー・分類に変更します"
                            >
                              <X className="w-3.5 h-3.5 mr-1 text-slate-400" />
                              <span>その他へ</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openDecisionModal(selectedMail, 'DISMISS')}
                              className="inline-flex items-center px-2.5 py-2 bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-700/60 rounded-xl text-xs font-semibold active:scale-95 transition-all cursor-pointer"
                            >
                              <AlertTriangle className="w-3.5 h-3.5 mr-1 text-rose-400" />
                              <span>差戻し/却下</span>
                            </button>
                          </>
                        )}

                        {/* B. Broker Question Decisions */}
                        {selectedMail.sourceType === 'BROKER_QUESTION' && (
                          <>
                            <button
                              type="button"
                              onClick={() => openDecisionModal(selectedMail, 'INQUIRY_HELLMANN')}
                              className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-extrabold shadow-md shadow-purple-500/20 active:scale-95 transition-all cursor-pointer"
                            >
                              <HelpCircle className="w-4 h-4 mr-1.5" />
                              <span>【決定】ヘルマン社へ照会送信</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openDecisionModal(selectedMail, 'RESOLVE')}
                              className="inline-flex items-center px-3 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer"
                            >
                              <Check className="w-4 h-4 mr-1.5" />
                              <span>【決定】社内解決・回答完了</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleUpdateSourceType(selectedMail.id, 'HELLMANN_ORDER')}
                              className="inline-flex items-center px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded-xl text-xs font-semibold active:scale-95 transition-all cursor-pointer"
                            >
                              <span>通関依頼へ戻す</span>
                            </button>
                          </>
                        )}

                        {/* C. General / Other Decisions */}
                        {selectedMail.sourceType === 'GENERAL' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleUpdateSourceType(selectedMail.id, 'HELLMANN_ORDER')}
                              className="inline-flex items-center px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer"
                              title="このメールをヘルマン通関依頼に変更します"
                            >
                              <AlertCircle className="w-4 h-4 mr-1.5" />
                              <span>ヘルマン通関依頼に変更</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleUpdateSourceType(selectedMail.id, 'BROKER_QUESTION')}
                              className="inline-flex items-center px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer"
                              title="このメールを通関士質疑メールに変更します"
                            >
                              <HelpCircle className="w-4 h-4 mr-1.5" />
                              <span>通関士質疑に変更</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openDecisionModal(selectedMail, 'RESOLVE')}
                              className="inline-flex items-center px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer"
                            >
                              <CheckCircle2 className="w-4 h-4 mr-1.5" />
                              <span>処理完了・アーカイブ</span>
                            </button>
                          </>
                        )}

                        {/* D. Other / Outgoing Decisions */}
                        {selectedMail.sourceType !== 'HELLMANN_ORDER' &&
                          selectedMail.sourceType !== 'BROKER_QUESTION' &&
                          selectedMail.sourceType !== 'GENERAL' && (
                            <button
                              type="button"
                              onClick={() => openDecisionModal(selectedMail, 'RESOLVE')}
                              className="inline-flex items-center px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer"
                            >
                              <CheckCircle2 className="w-4 h-4 mr-1.5" />
                              <span>【決定】処理完了・アーカイブ</span>
                            </button>
                          )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Email Content Header */}
              <div className="p-6 border-b border-slate-200 bg-white shrink-0 select-text">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight select-text leading-snug cursor-text selection:bg-blue-200 selection:text-blue-900 flex-1">
                    {selectedMail.subject}
                  </h2>
                  <button
                    type="button"
                    onClick={() => handleCopyText(selectedMail.subject, 'subject_title')}
                    className="shrink-0 p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                    title="タイトル（件名）をコピー"
                  >
                    {copiedId === 'subject_title' ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3 select-text">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-slate-700 to-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-sm select-none shrink-0">
                      {selectedMail.sender.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 select-text">
                        <span className="text-sm font-bold text-slate-900 select-text">
                          {selectedMail.sender.name}
                        </span>
                        <span className="text-xs text-slate-400 font-mono select-text">
                          &lt;{selectedMail.sender.email}&gt;
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 mt-1 space-y-1 select-text">
                        <div className="flex flex-wrap items-center gap-1 select-text">
                          <span className="font-bold text-slate-700 select-text">宛先:</span>
                          {normalizedToRecipients.length > 0 ? (
                            normalizedToRecipients.map((toAddr, idx) => (
                              <span
                                key={idx}
                                className="bg-indigo-50/80 text-indigo-950 font-semibold px-2 py-0.5 rounded font-mono text-[11px] border border-indigo-200/80 select-text inline-block shadow-2xs"
                              >
                                {toAddr}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-400 font-mono text-[11px] select-text">（宛先指定なし）</span>
                          )}
                        </div>
                        {normalizedCcRecipients.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 pt-0.5 select-text">
                            <span className="font-bold text-slate-700 select-text">CC:</span>
                            {normalizedCcRecipients.map((ccAddr, idx) => (
                              <span
                                key={idx}
                                className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-mono text-[11px] border border-slate-200 select-text inline-block"
                              >
                                {ccAddr}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right select-text shrink-0">
                    <div className="text-xs text-slate-700 font-mono font-bold select-text">
                      {formatFullDate(selectedMail.receivedOrSentAt)}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 font-mono select-text">
                      {formatTime(selectedMail.receivedOrSentAt)}
                    </div>
                  </div>
                </div>

                {/* Top Quick Attachments Bar */}
                {selectedMail.attachments && selectedMail.attachments.length > 0 ? (
                  <div className="mt-4 pt-3.5 border-t border-slate-100">
                    <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-blue-50/50 rounded-xl border border-blue-200/80">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-blue-900 flex items-center">
                          <Paperclip className="w-3.5 h-3.5 mr-1 text-blue-600" />
                          添付ファイル ({selectedMail.attachments.length}件):
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedMail.attachments.map((att) => {
                          const isDownloading = downloadingAttId === att.id;
                          return (
                            <div
                              key={att.id}
                              className="inline-flex items-center space-x-1.5 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs hover:border-blue-300 transition-colors"
                            >
                              <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              <span className="text-xs font-semibold text-slate-800 max-w-[160px] sm:max-w-[220px] truncate" title={att.fileName}>
                                {att.fileName}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                ({att.sizeBytes > 0 ? (att.sizeBytes / 1024).toFixed(0) : 0}KB)
                              </span>
                              {(att.dataUrl || att.isPdf || att.fileName.toLowerCase().endsWith('.pdf')) && (
                                <button
                                  type="button"
                                  onClick={() => handlePreviewAttachment(selectedMail, att)}
                                  disabled={isDownloading}
                                  className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer disabled:opacity-50"
                                  title="プレビュー"
                                >
                                  {isDownloading ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDownloadAttachment(selectedMail, att)}
                                disabled={isDownloading}
                                className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer disabled:opacity-50"
                                title={`${att.fileName} をダウンロード`}
                              >
                                {isDownloading ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" /> : <Download className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => handleFetchAttachmentsForMail(selectedMail)}
                          disabled={isFetchingAttachments}
                          className="p-1.5 text-xs text-blue-700 hover:bg-blue-100 rounded-lg border border-blue-200 bg-white transition-colors cursor-pointer flex items-center space-x-1 disabled:opacity-50"
                          title="Graph APIから最新の添付ファイル情報を再確認"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isFetchingAttachments ? 'animate-spin' : ''}`} />
                          <span>再取得</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  (selectedMail.id.startsWith('graph_') || selectedMail.graphMessageId || (selectedMail as any).hasAttachments) && (
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 bg-slate-50 p-2 rounded-xl border border-dashed border-slate-200">
                      <span className="flex items-center text-slate-600 font-medium">
                        <Paperclip className="w-3.5 h-3.5 mr-1 text-slate-400" />
                        添付ファイルが未同期または0件です
                      </span>
                      <button
                        type="button"
                        onClick={() => handleFetchAttachmentsForMail(selectedMail)}
                        disabled={isFetchingAttachments}
                        className="inline-flex items-center px-2.5 py-1 text-xs font-semibold text-blue-700 bg-white hover:bg-blue-50 rounded-lg border border-blue-200 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 mr-1 text-blue-600 ${isFetchingAttachments ? 'animate-spin' : ''}`} />
                        <span>{isFetchingAttachments ? '添付ファイル確認中...' : '添付ファイルを取得・確認'}</span>
                      </button>
                    </div>
                  )
                )}

                {/* AWB & HAWB Management & Quick Assignment Bar */}
                <div className="mt-4 pt-3.5 border-t border-slate-100 flex flex-col gap-2">
                  {editingAwbMailId === selectedMail.id ? (
                    <div className="p-3.5 bg-blue-50/70 rounded-xl border border-blue-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-blue-950 flex items-center">
                          <Tag className="w-3.5 h-3.5 mr-1 text-blue-700" />
                          AWB / HAWB 番号の直接登録・修正
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAutoExtractAwb(selectedMail)}
                          className="inline-flex items-center px-2 py-1 text-[11px] font-semibold text-blue-700 bg-white hover:bg-blue-100 rounded-lg border border-blue-300 shadow-2xs transition-colors cursor-pointer"
                          title="メール本文・件名から正規表現で再抽出"
                        >
                          <Sparkles className="w-3 h-3 mr-1 text-blue-600" />
                          本文から自動再抽出
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            MAWB / AWB番号 (3桁-8桁形式など)
                          </label>
                          <input
                            type="text"
                            value={editMawbInput}
                            onChange={(e) => setEditMawbInput(e.target.value)}
                            placeholder="例: 205-8841-2900"
                            className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            HAWB番号 (混載ハウス番号)
                          </label>
                          <input
                            type="text"
                            value={editHawbInput}
                            onChange={(e) => setEditHawbInput(e.target.value)}
                            placeholder="例: HLM-TYO-99420 (直截は空欄)"
                            className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-slate-500">
                          ※ 保存すると即座に「AWB案件別ツリー」に反映されます
                        </span>
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={cancelEditingAwb}
                            className="px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                          >
                            キャンセル
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveAwb(selectedMail.id)}
                            className="px-3.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center space-x-1"
                          >
                            <Check className="w-3.5 h-3.5 mr-1" />
                            保存して反映
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200/80">
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">MAWB:</span>
                          {selectedMail.mawbNumber ? (
                            <div className="inline-flex items-center space-x-1 font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded-md border border-slate-200 shadow-2xs">
                              <span>{selectedMail.mawbNumber}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyText(selectedMail.mawbNumber!, `mawb_${selectedMail.id}`)}
                                className="text-slate-400 hover:text-blue-600 ml-1 p-0.5"
                                title="MAWBをコピー"
                              >
                                {copiedId === `mawb_${selectedMail.id}` ? (
                                  <Check className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">未設定</span>
                          )}
                        </div>

                        <div className="flex items-center space-x-1.5">
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">HAWB:</span>
                          {cleanHawbNumber(selectedMail.hawbNumber) ? (
                            <div className="inline-flex items-center space-x-1 font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded-md border border-slate-200 shadow-2xs">
                              <span>{cleanHawbNumber(selectedMail.hawbNumber)}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyText(cleanHawbNumber(selectedMail.hawbNumber)!, `hawb_${selectedMail.id}`)}
                                className="text-slate-400 hover:text-blue-600 ml-1 p-0.5"
                                title="HAWBをコピー"
                              >
                                {copiedId === `hawb_${selectedMail.id}` ? (
                                  <Check className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">未設定 (直截等)</span>
                          )}
                        </div>

                        {!selectedMail.mawbNumber && !selectedMail.hawbNumber && (
                          <span className="inline-flex items-center text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 font-medium">
                            <AlertCircle className="w-3 h-3 mr-1 text-amber-600" />
                            AWB未紐付け（ツリー「未確定」に分類中）
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => startEditingAwb(selectedMail)}
                          className="inline-flex items-center px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 hover:text-blue-600 rounded-lg border border-slate-300 shadow-2xs transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3 mr-1.5 text-slate-500" />
                          <span>AWB番号を設定・編集</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Email Body Text & Attachments Area (Scrollable without cutoff) */}
              <div className="p-6 flex-1 min-h-0 select-text space-y-6 pb-20">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center">
                        <Mail className="w-3.5 h-3.5 mr-1 text-slate-400" />
                        メール本文
                      </span>
                      {selectedMail.bodyHtml && (
                        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px]">
                          <button
                            type="button"
                            onClick={() => setBodyViewMode('html')}
                            className={`px-2 py-0.5 rounded-md font-semibold cursor-pointer transition-colors ${
                              bodyViewMode === 'html'
                                ? 'bg-white text-blue-700 shadow-2xs font-bold'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            書式・装飾 (HTML)
                          </button>
                          <button
                            type="button"
                            onClick={() => setBodyViewMode('text')}
                            className={`px-2 py-0.5 rounded-md font-semibold cursor-pointer transition-colors ${
                              bodyViewMode === 'text'
                                ? 'bg-white text-blue-700 shadow-2xs font-bold'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            プレーンテキスト
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => handleCopyText(selectedMail.body, 'body_inline')}
                        className="inline-flex items-center px-2.5 py-1 text-xs text-slate-600 hover:text-blue-700 bg-slate-100 hover:bg-blue-50 rounded-lg border border-slate-200 transition-colors cursor-pointer shadow-2xs"
                        title="本文の全テキストをクリップボードにコピー"
                      >
                        {copiedId === 'body_inline' ? (
                          <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 mr-1 text-slate-500" />
                        )}
                        <span>{copiedId === 'body_inline' ? '本文コピー完了' : '本文をコピー'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Render HTML or Plain text */}
                  {selectedMail.bodyHtml && bodyViewMode === 'html' ? (
                    <div
                      className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs select-text cursor-text selection:bg-blue-200 selection:text-blue-900 overflow-x-auto [&_p]:mb-2 [&_div]:mb-0.5 [&_table]:border-collapse [&_table]:w-full [&_td]:p-1.5 [&_td]:border [&_td]:border-slate-200 [&_th]:p-1.5 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_img]:max-w-full [&_img]:h-auto [&_a]:text-blue-600 [&_a]:underline"
                      style={{
                        fontFamily:
                          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif',
                        fontSize: '14px',
                        lineHeight: 1.65,
                        color: '#1e293b',
                        wordBreak: 'break-word',
                      }}
                      dangerouslySetInnerHTML={{
                        __html: sanitizeEmailHtml(selectedMail.bodyHtml, selectedMail.attachments),
                      }}
                    />
                  ) : (
                    <div
                      className="bg-white border border-slate-200 rounded-2xl p-6 select-text cursor-text selection:bg-blue-200 selection:text-blue-900 shadow-2xs whitespace-pre-wrap break-words"
                      style={{
                        fontFamily:
                          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, monospace, sans-serif',
                        fontSize: '13.5px',
                        lineHeight: 1.65,
                        color: '#1e293b',
                      }}
                    >
                      {selectedMail.body || (selectedMail.bodyHtml ? selectedMail.bodyHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').trim() : '（本文なし）')}
                    </div>
                  )}
                </div>

                {/* Attachments Section */}
                {selectedMail.attachments && selectedMail.attachments.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-slate-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center">
                        <Paperclip className="w-4 h-4 mr-1.5 text-slate-500" />
                        添付書類 ({selectedMail.attachments.length} 件)
                      </h3>
                      <button
                        type="button"
                        onClick={() => handleFetchAttachmentsForMail(selectedMail)}
                        disabled={isFetchingAttachments}
                        className="p-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                        title="添付ファイル一覧を再読み込み"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isFetchingAttachments ? 'animate-spin' : ''}`} />
                        <span>再確認</span>
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {selectedMail.attachments.map((att) => (
                        <div
                          key={att.id}
                          className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-white hover:border-blue-300 shadow-xs transition-all group"
                        >
                          <div className="flex items-center space-x-3 min-w-0 pr-2">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                              att.fileName.toLowerCase().endsWith('.xlsx') || att.fileName.toLowerCase().endsWith('.xls')
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                                : att.fileName.toLowerCase().endsWith('.zip')
                                ? 'bg-amber-50 border-amber-200 text-amber-600'
                                : 'bg-rose-50 border-rose-200 text-rose-600'
                            }`}>
                              <FileText className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-800 truncate" title={att.fileName}>
                                {att.fileName}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                {(att.sizeBytes / 1024).toFixed(1)} KB (
                                {att.fileName.toLowerCase().endsWith('.xlsx') || att.fileName.toLowerCase().endsWith('.xls')
                                  ? 'Excel'
                                  : att.fileName.toLowerCase().endsWith('.zip')
                                  ? 'ZIP'
                                  : 'PDF書類'}
                                )
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            {(att.dataUrl || att.isPdf || att.fileName.toLowerCase().endsWith('.pdf')) && (
                              <button
                                type="button"
                                onClick={() => handlePreviewAttachment(selectedMail, att)}
                                disabled={downloadingAttId === att.id}
                                className="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                                title="ブラウザ上でPDFプレビュー"
                              >
                                {downloadingAttId === att.id ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDownloadAttachment(selectedMail, att)}
                              disabled={downloadingAttId === att.id}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                              title={`${att.fileName} をダウンロード`}
                            >
                              {downloadingAttId === att.id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inline Reply Box */}
                {isReplying && (
                  <div
                    ref={replyBoxRef}
                    className="mt-6 p-4 rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 shadow-md animate-in fade-in duration-150 scroll-mt-6"
                  >
                    {/* Header & Mode Switcher */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-indigo-100">
                      <div className="flex items-center space-x-2">
                        {replyMode === 'replyAll' ? (
                          <div className="flex items-center space-x-1.5 bg-indigo-600 text-white px-2.5 py-1 rounded-lg text-xs font-bold shadow-xs">
                            <ReplyAll className="w-3.5 h-3.5" />
                            <span>全員返信モード</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1.5 bg-blue-600 text-white px-2.5 py-1 rounded-lg text-xs font-bold shadow-xs">
                            <Reply className="w-3.5 h-3.5" />
                            <span>差出人のみ返信モード</span>
                          </div>
                        )}
                        <span className="text-xs text-slate-500 font-medium hidden sm:inline">
                          ({replyMode === 'replyAll' ? '差出人＋元の宛先・CC関係者全員へ送信' : '差出人のみに返信'})
                        </span>
                      </div>

                      {/* Mode Toggle & Close */}
                      <div className="flex items-center space-x-2">
                        <div className="inline-flex rounded-lg border border-indigo-200 bg-white p-0.5 shadow-2xs">
                          <button
                            type="button"
                            onClick={() => handleStartReply('reply')}
                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                              replyMode === 'reply'
                                ? 'bg-blue-600 text-white shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            返信
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStartReply('replyAll')}
                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                              replyMode === 'replyAll'
                                ? 'bg-indigo-600 text-white shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            全員返信
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsReplying(false)}
                          className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white transition-colors cursor-pointer"
                          title="返信作成を閉じる"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Recipients & Subject Info */}
                    <div className="space-y-1.5 mb-3 text-xs bg-white/80 p-2.5 rounded-xl border border-indigo-100 font-mono">
                      <div className="flex items-start gap-2">
                        <span className="font-bold text-slate-600 shrink-0 w-12 font-sans">宛先(To):</span>
                        <div className="flex flex-wrap gap-1 items-center flex-1">
                          {replyTo.map((addr, idx) => (
                            <span
                              key={idx}
                              className="bg-indigo-50 text-indigo-900 font-bold px-2 py-0.5 rounded border border-indigo-200 text-[11px]"
                            >
                              {addr}
                            </span>
                          ))}
                        </div>
                      </div>

                      {replyMode === 'replyAll' && (
                        <div className="flex items-start gap-2 pt-1 border-t border-slate-100">
                          <span className="font-bold text-slate-600 shrink-0 w-12 font-sans">CC:</span>
                          <div className="flex flex-wrap gap-1 items-center flex-1">
                            {replyCc.length > 0 ? (
                              replyCc.map((addr, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200 text-[11px]"
                                >
                                  <span>{addr}</span>
                                  <button
                                    type="button"
                                    onClick={() => setReplyCc(replyCc.filter((_, i) => i !== idx))}
                                    className="ml-1 text-slate-400 hover:text-rose-600"
                                    title="このCC宛先を削除"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-400 text-[11px] font-sans">（追加CC対象なし）</span>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-1 border-t border-slate-100 text-slate-700">
                        <span className="font-bold text-slate-600 shrink-0 w-12 font-sans">件名:</span>
                        <span className="font-semibold truncate text-[11px]">{replySubject}</span>
                      </div>
                    </div>

                    {/* Textarea */}
                    <textarea
                      ref={replyTextareaRef}
                      rows={6}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="返信本文を入力してください..."
                      className="w-full p-3 bg-white text-xs border border-slate-300 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-mono text-slate-900 shadow-inner"
                    />

                    {/* Signature & Quoted Mail Info and Toggle Preview */}
                    <div className="mt-2.5 pt-2 border-t border-indigo-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                      <div className="flex items-center gap-1.5 text-indigo-950 font-medium">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>
                          送信時、本文末尾に<b>署名（{operatorName}）</b>および<b>元メール（フォント・色・罫線を完全保持）</b>が自動引用挿入されます
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setIsSignatureModalOpen(true)}
                          className="text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                          title="自分のメール署名を確認・編集"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>署名設定</span>
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={() => setShowQuotedPreview(!showQuotedPreview)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                            showQuotedPreview
                              ? 'bg-indigo-600 text-white shadow-2xs'
                              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                          title="署名と元メール引用を含む最終送信イメージをプレビュー"
                        >
                          <Eye className="w-3 h-3" />
                          <span>{showQuotedPreview ? 'プレビューを隠す' : '署名・引用プレビュー'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Expanded Live Preview */}
                    {showQuotedPreview && (
                      <div className="mt-3 p-4 bg-white rounded-xl border-2 border-indigo-300 shadow-inner max-h-80 overflow-y-auto">
                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center justify-between pb-2 border-b border-slate-100">
                          <span className="flex items-center gap-1.5 text-indigo-900 font-bold">
                            <Eye className="w-3.5 h-3.5 text-indigo-600" />
                            送信メール完成イメージ (署名 ＆ 元メール引用プレビュー)
                          </span>
                          <span className="text-[10px] text-slate-400 font-normal">
                            ※文字サイズ・フォント・色・罫線（テーブル）を完全反映
                          </span>
                        </div>
                        <div
                          className="text-xs leading-relaxed text-slate-800 select-text bg-slate-50/50 p-3 rounded-lg border border-slate-100"
                          dangerouslySetInnerHTML={{
                            __html: buildReplyBodies({
                              replyText: replyText.trim() || '（ここに上記で入力した返信本文が入ります）',
                              originalMail: selectedMail,
                              operatorName,
                            }).htmlBody,
                          }}
                        />
                      </div>
                    )}

                    {/* Quick Templates & Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-0.5">定型文:</span>
                        {replyTemplates.map((tmpl) => (
                          <button
                            key={tmpl.id}
                            type="button"
                            onClick={() => handleApplyReplyTemplate(tmpl)}
                            className="px-2.5 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-950 hover:border-indigo-300 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-700 shadow-2xs cursor-pointer transition-colors"
                            title={`クリックで「${tmpl.title}」の定型本文を挿入`}
                          >
                            {tmpl.title}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setIsTemplateSettingsOpen(true)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-dashed border-slate-300 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                          title="全ユーザー共通の定型文を設定・カスタマイズ"
                        >
                          <Settings className="w-3 h-3 text-slate-500" />
                          <span>定型文設定</span>
                        </button>
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setIsReplying(false)}
                          className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200/80 rounded-lg cursor-pointer transition-colors"
                        >
                          キャンセル
                        </button>
                        <button
                          type="button"
                          onClick={handleSendInlineReply}
                          disabled={!replyText.trim()}
                          className={`inline-flex items-center px-4 py-1.5 text-white rounded-lg text-xs font-bold shadow-sm disabled:opacity-50 cursor-pointer transition-all ${
                            replyMode === 'replyAll'
                              ? 'bg-indigo-600 hover:bg-indigo-500'
                              : 'bg-blue-600 hover:bg-blue-500'
                          }`}
                        >
                          {replyMode === 'replyAll' ? (
                            <ReplyAll className="w-3.5 h-3.5 mr-1.5" />
                          ) : (
                            <Send className="w-3.5 h-3.5 mr-1.5" />
                          )}
                          <span>{replyMode === 'replyAll' ? '全員返信を送信・決定' : '返信を送信・決定'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 space-y-3">
              <Mail className="w-16 h-16 text-slate-200 stroke-1" />
              <div className="text-center">
                <h3 className="text-sm font-bold text-slate-700">メールが選択されていません</h3>
                <p className="text-xs text-slate-400 mt-1">
                  左の一覧からメールを選択して、送受信内容の閲覧および通関オペレーションの決定を実行してください。
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ========================================================================= */}
      {/* 3. Decision Confirmation Modal (決定ダイアログ)                            */}
      {/* ========================================================================= */}
      {decisionModal.isOpen && decisionModal.mail && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-60 p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <ShieldCheck className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-bold">{decisionModal.title}</h3>
              </div>
              <button
                type="button"
                onClick={() =>
                  setDecisionModal({ isOpen: false, mail: null, actionType: 'IMPORT_SHIPMENT', title: '', note: '' })
                }
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1 font-mono">
                <div>
                  <span className="text-slate-400">対象メール: </span>
                  <span className="font-bold text-slate-800">{decisionModal.mail.subject}</span>
                </div>
                <div>
                  <span className="text-slate-400">差出人: </span>
                  <span>{decisionModal.mail.sender.name}</span>
                </div>
                {(decisionModal.mail.mawbNumber || decisionModal.mail.hawbNumber) && (
                  <div>
                    <span className="text-slate-400">AWB番号: </span>
                    <span className="text-blue-700 font-bold">
                      {decisionModal.mail.mawbNumber || decisionModal.mail.hawbNumber}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  決定メモ / 処理記録 (監査ログに保存されます)
                </label>
                <textarea
                  rows={3}
                  value={decisionModal.note}
                  onChange={(e) =>
                    setDecisionModal({ ...decisionModal, note: e.target.value })
                  }
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-blue-500 font-mono"
                  placeholder="決定内容や担当者指示を入力..."
                />
              </div>

              <div className="text-[11px] text-slate-500 leading-relaxed bg-amber-50/70 p-3 rounded-xl border border-amber-200 text-amber-900">
                💡 決定を確定すると、ステータスが即座に更新され、関係者への依頼メール送信や案件データベースへの反映が行われます。
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() =>
                    setDecisionModal({ isOpen: false, mail: null, actionType: 'IMPORT_SHIPMENT', title: '', note: '' })
                  }
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDecision}
                  className="px-5 py-2 text-xs font-extrabold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-md shadow-blue-500/20 active:scale-95 transition-all cursor-pointer"
                >
                  決定を確定する
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. Compose Modal (新規メール作成モーダル)                                  */}
      {/* ========================================================================= */}
      {isComposeOpen && (
        <div className="fixed bottom-0 right-4 sm:right-10 z-50 w-full max-w-xl bg-white rounded-t-2xl shadow-2xl border border-slate-300 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-200">
          {/* Header */}
          <div className="p-3 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold">
              <Mail className="w-4 h-4 text-blue-400" />
              <span>新規メッセージ作成</span>
            </div>
            <button
              type="button"
              onClick={() => setIsComposeOpen(false)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSendCompose} className="p-4 space-y-3">
            {/* Quick Templates */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-[11px]">
              <span className="text-slate-400 shrink-0">定型文:</span>
              <button
                type="button"
                onClick={() => handleApplyComposeTemplate('BROKER_REQUEST')}
                className={`px-2 py-0.5 rounded-full border cursor-pointer ${
                  composeTemplate === 'BROKER_REQUEST'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                }`}
              >
                通関士宛て依頼
              </button>
              <button
                type="button"
                onClick={() => handleApplyComposeTemplate('HELLMANN_INQUIRY')}
                className={`px-2 py-0.5 rounded-full border cursor-pointer ${
                  composeTemplate === 'HELLMANN_INQUIRY'
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                }`}
              >
                ヘルマンSDS照会
              </button>
              <button
                type="button"
                onClick={() => handleApplyComposeTemplate('PERMIT_REPORT')}
                className={`px-2 py-0.5 rounded-full border cursor-pointer ${
                  composeTemplate === 'PERMIT_REPORT'
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                }`}
              >
                通関許可報告
              </button>
            </div>

            <div>
              <input
                type="text"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                placeholder="宛先 (To): 例 customs-brokerage@yourcompany.com"
                required
                className="w-full px-3 py-1.5 text-xs bg-slate-50 border-b border-slate-200 focus:bg-white focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>

            <div>
              <input
                type="text"
                value={composeCc}
                onChange={(e) => setComposeCc(e.target.value)}
                placeholder="CC: (カンマ区切り)"
                className="w-full px-3 py-1.5 text-xs bg-slate-50 border-b border-slate-200 focus:bg-white focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>

            <div>
              <input
                type="text"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                placeholder="件名"
                required
                className="w-full px-3 py-1.5 text-xs font-bold text-slate-900 border-b border-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <textarea
                rows={8}
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                placeholder="メール本文を入力..."
                required
                className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-blue-500 font-mono leading-relaxed"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="text-[11px] text-slate-400">
                差出人: {settings.groupEmail} (M365 Group)
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setIsComposeOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  破棄
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                  <span>送信決定</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. PDF Preview Modal (添付書類ビューア)                                  */}
      {/* ========================================================================= */}
      {previewPdfAttachment && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center z-70 p-4">
          <div className="bg-slate-900 text-white rounded-3xl max-w-4xl w-full h-[85vh] flex flex-col overflow-hidden shadow-2xl border border-slate-700 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <FileText className="w-5 h-5 text-rose-400" />
                <span className="text-sm font-bold truncate">{previewPdfAttachment.fileName}</span>
              </div>
              <div className="flex items-center space-x-2">
                {previewPdfAttachment.dataUrl && (
                  <a
                    href={previewPdfAttachment.dataUrl}
                    download={previewPdfAttachment.fileName}
                    className="inline-flex items-center px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    ダウンロード
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewPdfAttachment(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-950 p-2">
              {previewPdfAttachment.dataUrl &&
              (previewPdfAttachment.dataUrl.startsWith('data:') ||
                previewPdfAttachment.dataUrl.startsWith('blob:') ||
                previewPdfAttachment.dataUrl.startsWith('http://') ||
                previewPdfAttachment.dataUrl.startsWith('https://') ||
                previewPdfAttachment.dataUrl.startsWith('/pdfs/')) ? (
                <iframe
                  src={previewPdfAttachment.dataUrl}
                  title={previewPdfAttachment.fileName}
                  className="w-full h-full rounded-xl border border-slate-800 bg-white"
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 text-xs p-6 text-center">
                  <p className="font-semibold text-slate-300 mb-1">PDFプレビューを読み込めませんでした</p>
                  <p className="text-slate-500">添付ファイルのPDFデータが存在しないか、不正な形式です。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. Settings Modal (M365 Settings)                                        */}
      {/* ========================================================================= */}
      <M365SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false);
          setSettings(getM365Settings());
          reloadMessages();
        }}
        onSaveAndSync={() => {
          handleSyncRefresh();
        }}
      />

      {/* ========================================================================= */}
      {/* 7. Reply Template Settings Modal (全ユーザー共通定型文マスタ)            */}
      {/* ========================================================================= */}
      <ReplyTemplateSettingsModal
        isOpen={isTemplateSettingsOpen}
        onClose={() => setIsTemplateSettingsOpen(false)}
        onTemplatesUpdated={() => {
          loadReplyTemplates();
        }}
      />

      {/* ========================================================================= */}
      {/* 8. Signature Settings Modal (担当者個別署名カスタマイズ)                   */}
      {/* ========================================================================= */}
      <SignatureSettingsModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        defaultOperatorName={operatorName}
      />
    </div>
  );
};
