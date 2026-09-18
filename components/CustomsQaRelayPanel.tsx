import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  MessageSquare,
  Send,
  Download,
  Paperclip,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  Building2,
  User,
  ChevronDown,
  ChevronUp,
  FileText,
  AlertCircle,
  ShieldCheck,
  Check,
  RefreshCw,
  Mail,
  Inbox,
  Trash2,
  CornerDownRight,
  HelpCircle,
  X,
} from 'lucide-react';
import { Shipment, CustomsQaItem, EmailAttachment, UnifiedMailItem } from '../types';
import { sanitizeEmailHtml } from '../lib/htmlSanitizer';
import {
  addCustomsQuestion,
  sendInquiryToHellmann,
  receiveHellmannAnswer,
  replyToBroker,
  getM365Settings,
  getActualEmailsForShipment,
  subscribeM365Store,
  syncM365EmailsFromGraphAPI,
  parseDateString,
  getUserSignature,
  formatQuestionText,
  sendMailViaGraphBackend,
  getCustomsQaStatusBadgeInfo,
  setMailReadState,
  updateMailSourceType,
  getHellmannNewOrders,
} from '../lib/m365EmailService';
import { updateShipment, cleanCustomsQas } from '../lib/storageManager';
import { HtmlMailEditor } from './HtmlMailEditor';

interface CustomsQaRelayPanelProps {
  shipment: Shipment;
  onShipmentUpdated?: () => void;
}

const formatDateTime = (dateStr?: string | null): string => {
  if (!dateStr) return '-';
  const d = parseDateString(dateStr);
  if (d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
  }
  return dateStr && dateStr !== 'Invalid Date' && !dateStr.includes('NaN') ? dateStr : '-';
};

export const CustomsQaRelayPanel: React.FC<CustomsQaRelayPanelProps> = ({
  shipment,
  onShipmentUpdated,
}) => {
  const [isAddingQuestion, setIsAddingQuestion] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [questionTitle, setQuestionTitle] = useState('');
  const [brokerName, setBrokerName] = useState('社内通関士 (担当)');
  const [brokerEmail, setBrokerEmail] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  // Active QA reply forms state
  const [inquiryDrafts, setInquiryDrafts] = useState<Record<string, string>>({});
  const [brokerReplyDrafts, setBrokerReplyDrafts] = useState<Record<string, string>>({});
  const [forwardAttachmentsSelected, setForwardAttachmentsSelected] = useState<Record<string, boolean>>({});
  const [expandedMailIds, setExpandedMailIds] = useState<Record<string, boolean>>({});
  const [hydratedEmails, setHydratedEmails] = useState<Record<string, { bodyHtml?: string; body?: string; attachments?: any[] }>>({});

  const getFullMailPayload = async (mail: UnifiedMailItem): Promise<UnifiedMailItem> => {
    try {
      const { getEmailPayload } = await import('../lib/m365EmailService');
      const payload = await getEmailPayload(mail.id);
      if (payload) {
        return {
          ...mail,
          bodyHtml: payload.bodyHtml || mail.bodyHtml,
          body: payload.bodyText || mail.body,
          attachments: payload.attachments || mail.attachments,
        };
      }
    } catch (err) {
      console.warn('Failed to get full mail payload from IndexedDB:', err);
    }
    return mail;
  };

  // Email sending confirmation modals state (外部送信前の最終確認・編集画面)
  const [inquiryModal, setInquiryModal] = useState<{
    isOpen: boolean;
    qa: CustomsQaItem | null;
    toRecipients: string;
    ccRecipients: string;
    subject: string;
    sentContent: string;
  }>({
    isOpen: false,
    qa: null,
    toRecipients: '',
    ccRecipients: '',
    subject: '',
    sentContent: '',
  });

  const [brokerReplyModal, setBrokerReplyModal] = useState<{
    isOpen: boolean;
    qa: CustomsQaItem | null;
    toRecipients: string;
    ccRecipients: string;
    subject: string;
    replyText: string;
  }>({
    isOpen: false,
    qa: null,
    toRecipients: '',
    ccRecipients: '',
    subject: '',
    replyText: '',
  });

  // Real received emails from Microsoft 365
  const [actualEmails, setActualEmails] = useState<UnifiedMailItem[]>([]);

  // Manual Answer Feature State
  const [manualInputQaId, setManualInputQaId] = useState<string | null>(null);
  const [manualInputText, setManualInputText] = useState<string>('');
  const [selectMailModalQa, setSelectMailModalQa] = useState<CustomsQaItem | null>(null);
  const [selectQaModalMail, setSelectQaModalMail] = useState<UnifiedMailItem | null>(null);
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const [highlightedQaId, setHighlightedQaId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const m365Settings = getM365Settings();

  const showToast = (msg: string) => {
    setToastNotice(msg);
    setTimeout(() => setToastNotice(null), 5000);
  };

  const scrollToQa = (qaId: string) => {
    setHighlightedQaId(qaId);
    setTimeout(() => {
      // Look within this panel instance first (vital for modal popups vs background page)
      const root = panelRef.current;
      const el = (root?.querySelector(`[data-qa-card-id="${qaId}"]`) ||
        document.getElementById(`qa-card-${qaId}`)) as HTMLElement | null;

      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Ensure any scrollable ancestor (like Modal body overflow-y-auto) scrolls smoothly
        let parent = el.parentElement;
        while (parent && parent !== document.body) {
          const style = window.getComputedStyle(parent);
          if (
            (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            parent.scrollHeight > parent.clientHeight
          ) {
            const parentRect = parent.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const relativeTop = elRect.top - parentRect.top;
            const targetScrollTop =
              parent.scrollTop + relativeTop - parentRect.height / 2 + elRect.height / 2;

            parent.scrollTo({
              top: Math.max(0, targetScrollTop),
              behavior: 'smooth',
            });
            break;
          }
          parent = parent.parentElement;
        }
      } else {
        const container = (root?.querySelector('[data-qa-threads-list]') ||
          document.getElementById('qa-relay-threads-list')) as HTMLElement | null;
        if (container) {
          container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, 150);

    setTimeout(() => {
      setHighlightedQaId(null);
    }, 3500);
  };

  // Helper: Save direct manual text input as Hellmann answer
  const handleSaveManualAnswer = (qaId: string) => {
    if (!manualInputText.trim()) return;
    receiveHellmannAnswer(shipment.id, qaId, {
      answerText: manualInputText.trim(),
    });
    setManualInputQaId(null);
    setManualInputText('');
    showToast('ヘルマン社からの回答を手動で直接反映しました。');
    onShipmentUpdated?.();
  };

  // Helper: Apply a selected mail as Hellmann answer to a QA ticket
  const handleApplyMailToQa = async (qaId: string, mail: UnifiedMailItem) => {
    const fullMail = await getFullMailPayload(mail);
    receiveHellmannAnswer(shipment.id, qaId, {
      answerText: fullMail.body,
      answerHtml: fullMail.bodyHtml,
      attachments: fullMail.attachments,
    });
    updateMailSourceType(fullMail.id, 'HELLMANN_ANSWER');
    setSelectMailModalQa(null);
    setSelectQaModalMail(null);
    showToast('メール本文と添付ファイルを「ヘルマン社からの回答」として反映しました。');
    onShipmentUpdated?.();
  };

  // Helper: Handle clicking "回答として反映" on a mail card in history list
  const handleApplyMailAsAnswerFromCard = async (mail: UnifiedMailItem) => {
    const fullMail = await getFullMailPayload(mail);
    if (qas.length === 0) {
      // Auto-create a QA ticket if none exists
      const newQa = addCustomsQuestion(shipment.id, {
        title: fullMail.subject || 'ヘルマン社回答',
        questionText: '（受信メールからの直接回答受付）',
        brokerName: brokerName.trim() || '社内通関士',
        brokerEmail: brokerEmail.trim() || m365Settings.brokerDefaultEmail || 'customs-brokerage@yourcompany.com',
        receivedAtGroupEmail: m365Settings.groupEmail,
      });
      if (newQa) {
        receiveHellmannAnswer(shipment.id, newQa.id, {
          answerText: fullMail.body,
          answerHtml: fullMail.bodyHtml,
          attachments: fullMail.attachments,
        });
        updateMailSourceType(fullMail.id, 'HELLMANN_ANSWER');
        showToast('新しい照会票を起票し、メール回答をセットしました。');
        onShipmentUpdated?.();
        scrollToQa(newQa.id);
      }
    } else if (qas.length === 1) {
      // Exactly 1 QA ticket -> apply directly
      handleApplyMailToQa(qas[0].id, fullMail);
      scrollToQa(qas[0].id);
    } else {
      // Multiple QAs -> open target QA selection modal
      setSelectQaModalMail(fullMail);
    }
  };

  // Clean any mock/demo Q&As that might be saved on this shipment
  const qas: CustomsQaItem[] = useMemo(() => {
    return cleanCustomsQas(shipment.customsQas);
  }, [shipment.customsQas]);

  // If shipment had mock QAs, auto-clean them in storage
  useEffect(() => {
    if (shipment.customsQas && shipment.customsQas.length !== qas.length) {
      updateShipment(shipment.id, { customsQas: qas });
      onShipmentUpdated?.();
    }
  }, [shipment.id, shipment.customsQas, qas.length]);

  const loadActualEmails = () => {
    setActualEmails(getActualEmailsForShipment(shipment));
  };

  useEffect(() => {
    loadActualEmails();
    const unsub = subscribeM365Store(() => {
      loadActualEmails();
    });
    return unsub;
  }, [shipment.id, shipment.hawbNumber, shipment.mawbNumber]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await syncM365EmailsFromGraphAPI();
      loadActualEmails();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!questionText.trim()) return;

    const created = addCustomsQuestion(shipment.id, {
      questionText: questionText.trim(),
      title: questionTitle.trim() || undefined,
      subject: questionTitle.trim() || undefined,
      brokerName: brokerName.trim() || '社内通関士',
      brokerEmail: brokerEmail.trim() || m365Settings.brokerDefaultEmail || 'customs-brokerage@yourcompany.com',
      receivedAtGroupEmail: m365Settings.groupEmail,
    });

    setQuestionText('');
    setQuestionTitle('');
    setIsAddingQuestion(false);
    onShipmentUpdated?.();
    if (created) {
      showToast('通関士の質疑を手動起票しました');
      scrollToQa(created.id);
    }
  };

  const handleCreateQaFromRealEmail = (mail: UnifiedMailItem) => {
    const created = addCustomsQuestion(shipment.id, {
      questionText: mail.bodyHtml || mail.body,
      title: mail.subject.slice(0, 30),
      brokerName: mail.sender.name || '社内通関士',
      brokerEmail: mail.sender.email,
      originalEmailId: mail.id,
      subject: mail.subject,
      receivedAtGroupEmail: m365Settings.groupEmail,
    });
    onShipmentUpdated?.();
    if (created) {
      showToast(`「${mail.subject.slice(0, 20)}...」を照会ハブへ起票しました`);
      scrollToQa(created.id);
    }
  };

  const handleDeleteQa = (qaId: string) => {
    const updated = (shipment.customsQas || []).filter((q) => q.id !== qaId);
    updateShipment(shipment.id, { customsQas: updated });
    onShipmentUpdated?.();
  };

  const openInquiryConfirmModal = (qa: CustomsQaItem) => {
    const rawQuestion = qa.brokerQuestion.questionText || '';
    const isQuestionHtml =
      /<[a-z][\s\S]*>/i.test(rawQuestion) ||
      rawQuestion.includes('<table') ||
      rawQuestion.includes('<br') ||
      rawQuestion.includes('<div');

    const formattedQuestion = isQuestionHtml
      ? rawQuestion
      : formatQuestionText(rawQuestion).replace(/\n/g, '<br>');

    const currentUser = typeof window !== 'undefined' ? localStorage.getItem('current_user_name') || '喜多' : '喜多';
    const signature = getUserSignature(currentUser).replace(/\n/g, '<br>');

    // ヘルマン関連のメールを検索して、返信・送信用データを取得
    // この案件に紐づく同期メール一覧（画面上の履歴）から優先して探します。
    const actualMails = getActualEmailsForShipment(shipment) || [];
    
    const sortedMails = [...actualMails].sort((a, b) => {
      if (a.direction === 'INCOMING' && b.direction !== 'INCOMING') return -1;
      if (a.direction !== 'INCOMING' && b.direction === 'INCOMING') return 1;
      return 0;
    });

    const originalMail = sortedMails.find(
      (m) =>
        m.sourceType === 'HELLMANN_ORDER' ||
        m.sender?.email?.toLowerCase().includes('hellmann.com') ||
        m.toRecipients?.some((r) => r.toLowerCase().includes('hellmann.com'))
    );

    // メールタイトルは受信した元のメールの先頭に"Re:"を追加
    let defaultSubject = '';
    if (originalMail && originalMail.subject) {
      defaultSubject = originalMail.subject.startsWith('Re:')
        ? originalMail.subject
        : `Re: ${originalMail.subject}`;
    } else if (shipment.hellmannEmailSubject) {
      defaultSubject = shipment.hellmannEmailSubject.startsWith('Re:')
        ? shipment.hellmannEmailSubject
        : `Re: ${shipment.hellmannEmailSubject}`;
    } else {
      defaultSubject = `Re: 通関照会 HAWB: ${shipment.hawbNumber || shipment.id}`;
    }

    // 宛先 (To) および CC 宛先の動的・高精度特定
    // ヘルマン社宛ての照会メールであるため、宛先(To)は必ず「hellmann.com」を含むアドレスにします。
    let defaultTo = 'HMS-JP@hellmann.com';
    let candidateCcList: string[] = [];

    if (originalMail) {
      // 元のメールに関連するすべてのアドレスを抽出
      const allInvolved: string[] = [];
      if (originalMail.sender?.email) {
        allInvolved.push(originalMail.sender.email);
      }
      if (Array.isArray(originalMail.toRecipients)) {
        allInvolved.push(...originalMail.toRecipients);
      }
      if (Array.isArray(originalMail.ccRecipients)) {
        allInvolved.push(...originalMail.ccRecipients);
      }

      // 重複排除
      const uniqueInvolved = Array.from(new Set(allInvolved.map((e) => e.trim()).filter(Boolean)));

      // 1. 個人のヘルマン担当者アドレス (例: Rio.Tsutsui@hellmann.com 等で、hms-jp 以外のもの) を最優先で To に選定
      const personalHellmann = uniqueInvolved.find(
        (e) => e.toLowerCase().includes('hellmann.com') && !e.toLowerCase().includes('hms-jp')
      );

      if (personalHellmann) {
        defaultTo = personalHellmann;
      } else {
        // 2. なければ HMS-JP@hellmann.com を含む最初の hellmann.com
        const anyHellmann = uniqueInvolved.find((e) => e.toLowerCase().includes('hellmann.com'));
        if (anyHellmann) {
          defaultTo = anyHellmann;
        }
      }

      // Toアドレス以外の、関与している残りの全アドレスをCCの候補とする
      candidateCcList = uniqueInvolved.filter(
        (e) => e.toLowerCase() !== defaultTo.toLowerCase()
      );
    } else {
      // 予備で従来の getHellmannNewOrders からもCCをマージ
      const allOrders = getHellmannNewOrders() || [];
      const originalOrder = allOrders.find(
        (o) =>
          o.processedShipmentId === shipment.id ||
          (shipment.linkedEmailThreadId && (o.messageId === shipment.linkedEmailThreadId || o.id === shipment.linkedEmailThreadId))
      );
      if (originalOrder) {
        const orderInvolved = [
          ...(originalOrder.senderEmail ? [originalOrder.senderEmail] : []),
          ...(originalOrder.toRecipients || []),
          ...(originalOrder.ccRecipients || [])
        ].map((e) => e.trim()).filter(Boolean);

        candidateCcList = Array.from(new Set(orderInvolved)).filter(
          (e) => e.toLowerCase() !== defaultTo.toLowerCase()
        );
      }
    }

    // 共有グループアドレスをCCに追加（まだ無ければ）
    const groupMail = m365Settings.groupEmail || 'tac-hellmann@tac-japan.co.jp';
    let ccList = [...candidateCcList];
    if (groupMail && !ccList.some((email) => email.toLowerCase() === groupMail.toLowerCase())) {
      ccList.push(groupMail);
    }

    // Toアドレスと完全に一致するアドレス、および空文字はCCから除外
    const cleanCcList = ccList
      .map((c) => c.trim())
      .filter((c) => !!c && c.toLowerCase() !== defaultTo.toLowerCase());

    // プロフェショナルな配置のためにCCリストを並び替え
    // 1. グループ共有アドレス (tac-hellmann@tac-japan.co.jp)
    // 2. その他のヘルマンアドレス (HMS-JP@hellmann.com 等)
    // 3. 自社・担当者アドレス (kita@tac-japan.co.jp 等)
    const sortedCcList = Array.from(new Set(cleanCcList)).sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const groupMailLower = groupMail.toLowerCase();

      if (aLower === groupMailLower) return -1;
      if (bLower === groupMailLower) return 1;

      const aIsHellmann = aLower.includes('hellmann.com');
      const bIsHellmann = bLower.includes('hellmann.com');
      if (aIsHellmann && !bIsHellmann) return -1;
      if (!aIsHellmann && bIsHellmann) return 1;

      return 0;
    });

    const defaultCc = sortedCcList.join('; ') || groupMail;

    // HAWB/MAWB表示の重複を排除
    let keyDisplay = '';
    if (shipment.hawbNumber) {
      keyDisplay = `HAWB: ${shipment.hawbNumber}`;
    } else if (shipment.mawbNumber) {
      keyDisplay = `MAWB: ${shipment.mawbNumber}`;
    } else {
      keyDisplay = `管理ID: ${shipment.id}`;
    }

    // 元の通関依頼メール（ヘルマン社から受信したINCOMINGメール）を特定
    const allOrders = getHellmannNewOrders() || [];
    const originalOrder = allOrders.find(
      (o) =>
        o.processedShipmentId === shipment.id ||
        (shipment.linkedEmailThreadId && (o.messageId === shipment.linkedEmailThreadId || o.id === shipment.linkedEmailThreadId))
    );

    // 万が一見つからない場合は、同期メール一覧から受信メール(INCOMING)を探す
    const fallbackIncomingMail = actualMails.find(
      (m) =>
        m.direction === 'INCOMING' &&
        (m.sourceType === 'HELLMANN_ORDER' || m.sender?.email?.toLowerCase().includes('hellmann.com'))
    );

    let quoteHtml = '';

    if (originalOrder) {
      const fromStr = `${originalOrder.senderName || ''} &lt;${originalOrder.senderEmail || ''}&gt;`;
      const toStr = Array.isArray(originalOrder.toRecipients) ? originalOrder.toRecipients.join('; ') : '';
      const ccStr = Array.isArray(originalOrder.ccRecipients) ? originalOrder.ccRecipients.join('; ') : '';
      const receivedDate = originalOrder.receivedDateTime ? new Date(originalOrder.receivedDateTime).toLocaleString('ja-JP') : '';
      
      let mailBodyStr = '';
      if (originalOrder.bodyHtml && originalOrder.bodyHtml.trim()) {
        const hasHtmlTags = /<[a-z][\s\S]*>/i.test(originalOrder.bodyHtml);
        if (hasHtmlTags) {
          mailBodyStr = originalOrder.bodyHtml;
        } else {
          mailBodyStr = originalOrder.bodyHtml.replace(/\r?\n/g, '<br>');
        }
      } else if (originalOrder.bodyText) {
        mailBodyStr = originalOrder.bodyText.replace(/\r?\n/g, '<br>');
      }

      quoteHtml = `<br><br><div style="border-left: 3px solid #0284c7; padding-left: 16px; margin-left: 4px; color: #1e293b; font-size: 13.5px; line-height: 1.6;">
<p style="margin: 0 0 8px 0; color: #0284c7; font-weight: bold; font-size: 13px;">-----Original Message-----</p>
<div style="background-color: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 12px; color: #475569; font-size: 12.5px; line-height: 1.5;">
<p style="margin: 0 0 4px 0;"><b>From:</b> ${fromStr}</p>
<p style="margin: 0 0 4px 0;"><b>Sent:</b> ${receivedDate}</p>
<p style="margin: 0 0 4px 0;"><b>To:</b> ${toStr}</p>
${ccStr ? `<p style="margin: 0 0 4px 0;"><b>Cc:</b> ${ccStr}</p>` : ''}
<p style="margin: 0 0 0 0;"><b>Subject:</b> ${originalOrder.subject || ''}</p>
</div>
<div style="font-family: 'Segoe UI', Meiryo, sans-serif; color: #1e293b; line-height: 1.6;">${mailBodyStr}</div>
</div>`;

    } else if (fallbackIncomingMail) {
      const fromStr = fallbackIncomingMail.sender ? `${fallbackIncomingMail.sender.name || ''} &lt;${fallbackIncomingMail.sender.email || ''}&gt;` : '';
      const toStr = Array.isArray(fallbackIncomingMail.toRecipients) ? fallbackIncomingMail.toRecipients.join('; ') : (fallbackIncomingMail.toRecipients || '');
      const ccStr = Array.isArray(fallbackIncomingMail.ccRecipients) ? fallbackIncomingMail.ccRecipients.join('; ') : (fallbackIncomingMail.ccRecipients || '');
      const receivedDate = fallbackIncomingMail.receivedOrSentAt ? new Date(fallbackIncomingMail.receivedOrSentAt).toLocaleString('ja-JP') : '';
      
      let mailBodyStr = '';
      if (fallbackIncomingMail.bodyHtml && fallbackIncomingMail.bodyHtml.trim()) {
        const hasHtmlTags = /<[a-z][\s\S]*>/i.test(fallbackIncomingMail.bodyHtml);
        if (hasHtmlTags) {
          mailBodyStr = fallbackIncomingMail.bodyHtml;
        } else {
          mailBodyStr = fallbackIncomingMail.bodyHtml.replace(/\r?\n/g, '<br>');
        }
      } else if (fallbackIncomingMail.body) {
        mailBodyStr = fallbackIncomingMail.body.replace(/\r?\n/g, '<br>');
      }

      quoteHtml = `<br><br><div style="border-left: 3px solid #0284c7; padding-left: 16px; margin-left: 4px; color: #1e293b; font-size: 13.5px; line-height: 1.6;">
<p style="margin: 0 0 8px 0; color: #0284c7; font-weight: bold; font-size: 13px;">-----Original Message-----</p>
<div style="background-color: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 12px; color: #475569; font-size: 12.5px; line-height: 1.5;">
<p style="margin: 0 0 4px 0;"><b>From:</b> ${fromStr}</p>
<p style="margin: 0 0 4px 0;"><b>Sent:</b> ${receivedDate}</p>
<p style="margin: 0 0 4px 0;"><b>To:</b> ${toStr}</p>
${ccStr ? `<p style="margin: 0 0 4px 0;"><b>Cc:</b> ${ccStr}</p>` : ''}
<p style="margin: 0 0 0 0;"><b>Subject:</b> ${fallbackIncomingMail.subject || ''}</p>
</div>
<div style="font-family: 'Segoe UI', Meiryo, sans-serif; color: #1e293b; line-height: 1.6;">${mailBodyStr}</div>
</div>`;
    }

    // メール本文の修正
    // ”ヘルマン社 担当者様”→”ヘルマンワールドワイドロジスティクス株式会社　ご担当者様”
    // ”お疲れ様です。”→”いつもお世話になっております。”＋改行
    const defaultBody =
      inquiryDrafts[qa.id] ||
      `ヘルマンワールドワイドロジスティクス株式会社　ご担当者様<br><br>いつもお世話になっております。<br><br>本件 (${keyDisplay}) の通関手配につきまして、<br>社内通関士より以下の照会が届いております。<br><br>【通関士からの照会内容】<br>${formattedQuestion}<br><br>お手数ですが、荷主（Shipper）様にご確認の上、ご回答いただけますようお願い申し上げます。<br><br>${signature}${quoteHtml}`;

    setInquiryModal({
      isOpen: true,
      qa,
      toRecipients: defaultTo,
      ccRecipients: defaultCc,
      subject: defaultSubject,
      sentContent: defaultBody,
    });
  };

  const confirmAndSendInquiry = async () => {
    if (!inquiryModal.qa) return;
    const qa = inquiryModal.qa;
    const currentUser = typeof window !== 'undefined' ? localStorage.getItem('current_user_name') || '喜多' : '喜多';

    sendInquiryToHellmann(shipment.id, qa.id, {
      sentContent: inquiryModal.sentContent,
      senderName: currentUser,
      subject: inquiryModal.subject,
    });

    // Send actual email via M365 Graph API backend proxy if active
    const toList = inquiryModal.toRecipients.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const ccList = inquiryModal.ccRecipients.split(/[,;]/).map((s) => s.trim()).filter(Boolean);

    if (toList.length > 0) {
      const sendResult = await sendMailViaGraphBackend({
        toRecipients: toList,
        ccRecipients: ccList,
        subject: inquiryModal.subject,
        body: inquiryModal.sentContent,
      });

      if (!sendResult.success) {
        alert(
          `【外部メール未送信のアラート】\n本システムの管理ステータスは「ヘルマン照会中」に更新されましたが、実際のM365外部メール送信は実行されませんでした。\n\n理由: ${sendResult.error || '通信エラー'}`
        );
      } else {
        alert(`【送信完了】\nMicrosoft 365 共有メールボックス経由で実メールを送信しました。\n宛先: ${toList.join(', ')}`);
      }
    }

    setInquiryModal({ isOpen: false, qa: null, toRecipients: '', ccRecipients: '', subject: '', sentContent: '' });
    onShipmentUpdated?.();
  };

  const handleSetPendingWithoutSending = (qa: CustomsQaItem) => {
    const currentUser = typeof window !== 'undefined' ? localStorage.getItem('current_user_name') || '喜多' : '喜多';
    sendInquiryToHellmann(shipment.id, qa.id, {
      sentContent: '（※自社メーラー等で直接ヘルマン社へ照会メールを送信済み）',
      senderName: currentUser,
      subject: `[Re: 通関照会] HAWB: ${shipment.hawbNumber || shipment.id} - ${qa.title}`,
    });
    onShipmentUpdated?.();
  };

  const handleSetBrokerResolvedWithoutSending = (qa: CustomsQaItem) => {
    replyToBroker(shipment.id, qa.id, {
      replyText: '（※自社メーラー等で直接通関士へ回答連絡・送信済み）',
      forwardedAttachments: [],
    });
    showToast('通関士への返信を「送信済（回答済・解決）」として記録しました。');
    onShipmentUpdated?.();
  };

  const handleRevertBrokerReply = (qa: CustomsQaItem) => {
    const currentQas = shipment.customsQas || [];
    const qaIndex = currentQas.findIndex((q) => q.id === qa.id);
    if (qaIndex === -1) return;
    const updated = [...currentQas];
    updated[qaIndex] = {
      ...updated[qaIndex],
      status: 'HELLMANN_ANSWERED',
      brokerReply: undefined,
      updatedAt: new Date().toISOString(),
    };
    updateShipment(shipment.id, { customsQas: updated });
    showToast('通関士への返信ステータスを「回答待ち・未返信」に戻しました。');
    onShipmentUpdated?.();
  };

  const openBrokerReplyConfirmModal = (qa: CustomsQaItem) => {
    // 1. 通関士からの元のメールを特定
    const actualMails = getActualEmailsForShipment(shipment) || [];
    const brokerMail = actualMails.find((m) =>
      (qa.brokerQuestion.originalEmailId && m.id === qa.brokerQuestion.originalEmailId) ||
      (m.direction === 'INCOMING' && (
        m.sourceType === 'BROKER_QUESTION' ||
        (qa.brokerQuestion.brokerEmail && m.sender?.email?.toLowerCase() === qa.brokerQuestion.brokerEmail.toLowerCase())
      ))
    ) || actualMails.find((m) => m.sourceType === 'BROKER_QUESTION');

    // 2. メール表題は通関士からのメールタイトルを使用し、先頭に「Re: 」を付与
    let baseSubject = '';
    if (qa.brokerQuestion.subject && qa.brokerQuestion.subject.trim()) {
      baseSubject = qa.brokerQuestion.subject.trim();
    } else if (brokerMail?.subject && brokerMail.subject.trim()) {
      baseSubject = brokerMail.subject.trim();
    } else if (qa.title && qa.title.trim()) {
      baseSubject = qa.title.trim();
    } else {
      baseSubject = `HAWB: ${shipment.hawbNumber || shipment.id} 輸出通関依頼`;
    }

    const defaultSubject = /^re:\s*/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;

    const defaultTo = qa.brokerQuestion.brokerEmail || brokerMail?.sender?.email || m365Settings.brokerDefaultEmail || 'customs-brokerage@yourcompany.com';
    const defaultCc = m365Settings.groupEmail || 'tac-hellmann@tac-japan.co.jp';

    // 3. 自分のシグニチャーを取得
    const currentUser = typeof window !== 'undefined' ? localStorage.getItem('current_user_name') || '喜多' : '喜多';
    const signature = getUserSignature(currentUser).replace(/\n/g, '<br>');

    // 4. 通関士からのメールをそのまま（罫線、文字フォント、テーブルなど）引用作成
    const fromStr = brokerMail?.sender
      ? `${brokerMail.sender.name || ''} &lt;${brokerMail.sender.email || ''}&gt;`
      : `${qa.brokerQuestion.brokerName || '社内通関士'} &lt;${qa.brokerQuestion.brokerEmail || m365Settings.brokerDefaultEmail || ''}&gt;`;

    const toStr = brokerMail?.toRecipients
      ? (Array.isArray(brokerMail.toRecipients) ? brokerMail.toRecipients.join('; ') : String(brokerMail.toRecipients))
      : (qa.brokerQuestion.receivedAtGroupEmail || m365Settings.groupEmail || '');

    const ccStr = brokerMail?.ccRecipients
      ? (Array.isArray(brokerMail.ccRecipients) ? brokerMail.ccRecipients.join('; ') : String(brokerMail.ccRecipients))
      : '';

    const sentDate = qa.brokerQuestion.askedAt
      ? new Date(qa.brokerQuestion.askedAt).toLocaleString('ja-JP')
      : (brokerMail?.receivedOrSentAt ? new Date(brokerMail.receivedOrSentAt).toLocaleString('ja-JP') : '');

    let brokerBodyHtml = '';
    if (brokerMail?.bodyHtml && brokerMail.bodyHtml.trim()) {
      const hasHtml = /<[a-z][\s\S]*>/i.test(brokerMail.bodyHtml);
      brokerBodyHtml = hasHtml ? brokerMail.bodyHtml : brokerMail.bodyHtml.replace(/\r?\n/g, '<br>');
    } else if (qa.brokerQuestion.questionText) {
      const rawQ = qa.brokerQuestion.questionText;
      const hasHtml = /<[a-z][\s\S]*>/i.test(rawQ);
      brokerBodyHtml = hasHtml ? rawQ : formatQuestionText(rawQ).replace(/\n/g, '<br>');
    } else if (brokerMail?.body) {
      brokerBodyHtml = brokerMail.body.replace(/\r?\n/g, '<br>');
    }

    const quoteHtml = `<br><br><div style="border-left: 3px solid #6366f1; padding-left: 16px; margin-left: 4px; color: #1e293b; font-size: 13.5px; line-height: 1.6;">
<p style="margin: 0 0 8px 0; color: #6366f1; font-weight: bold; font-size: 13px;">-----Original Message-----</p>
<div style="background-color: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 12px; color: #475569; font-size: 12.5px; line-height: 1.5;">
<p style="margin: 0 0 4px 0;"><b>From:</b> ${fromStr}</p>
${sentDate ? `<p style="margin: 0 0 4px 0;"><b>Sent:</b> ${sentDate}</p>` : ''}
${toStr ? `<p style="margin: 0 0 4px 0;"><b>To:</b> ${toStr}</p>` : ''}
${ccStr ? `<p style="margin: 0 0 4px 0;"><b>Cc:</b> ${ccStr}</p>` : ''}
<p style="margin: 0 0 0 0;"><b>Subject:</b> ${defaultSubject}</p>
</div>
<div style="font-family: 'Segoe UI', Meiryo, sans-serif; color: #1e293b; line-height: 1.6;">${brokerBodyHtml}</div>
</div>`;

    // 5. 回答内容のフォーマット
    let answerHtml = '';
    if (qa.hellmannAnswer?.answerHtml && qa.hellmannAnswer.answerHtml.trim()) {
      const hasHtml = /<[a-z][\s\S]*>/i.test(qa.hellmannAnswer.answerHtml);
      answerHtml = hasHtml ? qa.hellmannAnswer.answerHtml : qa.hellmannAnswer.answerHtml.replace(/\r?\n/g, '<br>');
    } else if (qa.hellmannAnswer?.answerText) {
      const rawAns = qa.hellmannAnswer.answerText;
      const hasHtml = /<[a-z][\s\S]*>/i.test(rawAns);
      answerHtml = hasHtml ? rawAns : rawAns.replace(/\r?\n/g, '<br>');
    } else {
      answerHtml = '荷主より回答を受領しました。';
    }

    const rawBrokerName = m365Settings.brokerDefaultName?.trim() || qa.brokerQuestion.brokerName?.trim() || '通関士';
    let brokerSalutation = rawBrokerName;
    if (!brokerSalutation.endsWith('様') && !brokerSalutation.endsWith('殿') && !brokerSalutation.endsWith('さん')) {
      brokerSalutation = `${brokerSalutation}様`;
    }

    const defaultBody =
      brokerReplyDrafts[qa.id] ||
      `${brokerSalutation}<br><br>お疲れ様です。照会いただいておりました件、ヘルマン社および荷主様より回答および関連資料を受領いたしました。<br><br>【回答内容】<br>${answerHtml}<br><br>ご確認の上、申告手続きを進めていただけますと幸いです。<br><br>${signature}${quoteHtml}`;

    setBrokerReplyModal({
      isOpen: true,
      qa,
      toRecipients: defaultTo,
      ccRecipients: defaultCc,
      subject: defaultSubject,
      replyText: defaultBody,
    });
  };

  const confirmAndSendBrokerReply = async () => {
    if (!brokerReplyModal.qa) return;
    const qa = brokerReplyModal.qa;

    const forwardAtts =
      forwardAttachmentsSelected[qa.id] !== false ? qa.hellmannAnswer?.attachments || [] : [];

    replyToBroker(shipment.id, qa.id, {
      replyText: brokerReplyModal.replyText,
      forwardedAttachments: forwardAtts,
    });

    const toList = brokerReplyModal.toRecipients.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const ccList = brokerReplyModal.ccRecipients.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (toList.length > 0) {
      const sendResult = await sendMailViaGraphBackend({
        toRecipients: toList,
        ccRecipients: ccList,
        subject: brokerReplyModal.subject,
        body: brokerReplyModal.replyText,
        attachments: forwardAtts,
      });

      if (!sendResult.success) {
        console.warn('Backend email sending notification:', sendResult.error);
      }
    }

    setBrokerReplyModal({ isOpen: false, qa: null, toRecipients: '', ccRecipients: '', subject: '', replyText: '' });
    onShipmentUpdated?.();
  };

  const handleDownloadAttachment = (att: EmailAttachment) => {
    if (!att.dataUrl && !att.downloadUrl) return;
    const link = document.createElement('a');
    link.href = att.dataUrl || att.downloadUrl || '';
    link.download = att.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenInOutlook = (qa: CustomsQaItem) => {
    const actualMails = getActualEmailsForShipment(shipment) || [];
    const brokerMail = actualMails.find((m) =>
      (qa.brokerQuestion.originalEmailId && m.id === qa.brokerQuestion.originalEmailId) ||
      (m.direction === 'INCOMING' && (
        m.sourceType === 'BROKER_QUESTION' ||
        (qa.brokerQuestion.brokerEmail && m.sender?.email?.toLowerCase() === qa.brokerQuestion.brokerEmail.toLowerCase())
      ))
    ) || actualMails.find((m) => m.sourceType === 'BROKER_QUESTION');

    let rawBrokerSubject = qa.brokerQuestion.subject || brokerMail?.subject || qa.title || `HAWB: ${shipment.hawbNumber || shipment.id} 輸出通関依頼`;
    let brokerSubject = rawBrokerSubject.trim();
    if (!/^re:\s*/i.test(brokerSubject)) {
      brokerSubject = `Re: ${brokerSubject}`;
    }
    const recipient = qa.brokerQuestion.brokerEmail || brokerMail?.sender?.email || m365Settings.brokerDefaultEmail || 'customs-brokerage@yourcompany.com';
    const defaultCc = m365Settings.groupEmail || 'tac-hellmann@tac-japan.co.jp';
    const currentUser = typeof window !== 'undefined' ? localStorage.getItem('current_user_name') || '喜多' : '喜多';
    const signature = getUserSignature(currentUser);

    const rawBrokerName = m365Settings.brokerDefaultName?.trim() || qa.brokerQuestion.brokerName?.trim() || '通関士';
    let brokerSalutation = rawBrokerName;
    if (!brokerSalutation.endsWith('様') && !brokerSalutation.endsWith('殿') && !brokerSalutation.endsWith('さん')) {
      brokerSalutation = `${brokerSalutation}様`;
    }

    const brokerQuestionBody = brokerMail?.body || qa.brokerQuestion.questionText || '';
    const answerText = qa.hellmannAnswer?.answerText || '荷主より回答を受領しました。';

    const plainBody = `${brokerSalutation}\nお疲れ様です。照会いただいておりました件、ヘルマン社および荷主様より回答および関連資料を受領いたしました。\n\n【回答内容】\n${answerText}\n\nご確認の上、申告手続きを進めていただけますと幸いです。\n\n${signature}\n\n-----Original Message-----\nFrom: ${qa.brokerQuestion.brokerName || '社内通関士'} <${recipient}>\nSent: ${qa.brokerQuestion.askedAt ? new Date(qa.brokerQuestion.askedAt).toLocaleString('ja-JP') : ''}\nSubject: ${brokerSubject}\n\n${brokerQuestionBody}`;

    const subject = encodeURIComponent(brokerSubject);
    const body = encodeURIComponent(brokerReplyDrafts[qa.id] ? brokerReplyDrafts[qa.id].replace(/<br>/g, '\n').replace(/<[^>]+>/g, '') : plainBody);
    const ccParam = defaultCc ? `&cc=${encodeURIComponent(defaultCc)}` : '';
    window.location.href = `mailto:${recipient}?subject=${subject}${ccParam}&body=${body}`;
  };

  const toggleExpandMail = (mailId: string) => {
    setExpandedMailIds((prev) => {
      const nextState = !prev[mailId];
      if (nextState) {
        setMailReadState(mailId, true);
        if (!hydratedEmails[mailId]) {
          import('../lib/m365EmailService').then(({ getEmailPayload }) => {
            getEmailPayload(mailId).then((payload) => {
              if (payload) {
                setHydratedEmails(h => ({
                  ...h,
                  [mailId]: {
                    bodyHtml: payload.bodyHtml,
                    body: payload.bodyText,
                    attachments: payload.attachments,
                  }
                }));
              }
            });
          });
        }
      }
      return {
        ...prev,
        [mailId]: nextState,
      };
    });
  };

  const handleToggleMailType = (mailId: string, currentIsBroker: boolean) => {
    const newType = currentIsBroker ? 'HELLMANN_ORDER' : 'BROKER_QUESTION';
    updateMailSourceType(mailId, newType);
    loadActualEmails();
  };

  // Real emails filtered for broker inquiries
  const brokerInquiryEmails = actualEmails.filter(
    (m) =>
      m.sourceType === 'BROKER_QUESTION' ||
      (m.sourceType as any) === 'CUSTOMS_QUESTION'
  );

  const statusBadge = getCustomsQaStatusBadgeInfo(qas);

  return (
    <div ref={panelRef} className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Panel Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center text-blue-400 shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-sm sm:text-base text-white">
                通関質疑 ＆ ヘルマン照会ハブ
              </h3>
              <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${statusBadge.badgeClass}`}>
                <span className="text-[9px]">●</span>
                <span>{statusBadge.label}</span>
              </span>
              <span className="text-[11px] bg-blue-500/20 text-blue-300 font-mono px-2 py-0.5 rounded-md border border-blue-400/20">
                {qas.length}件の記録中
              </span>
              <span className="text-[11px] bg-emerald-500/20 text-emerald-300 font-mono px-2 py-0.5 rounded-md border border-emerald-400/20">
                実メール {actualEmails.length}件連携
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-blue-300">送受信グループメール:</span>
              <span className="bg-slate-800/80 px-2 py-0.5 rounded text-[11px] font-mono border border-slate-700 text-slate-200">
                {m365Settings.groupEmail}
              </span>
              <span className="text-slate-400">（通関士との質疑もヘルマン社とのやり取りも同一アドレスで集約管理）</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs active:scale-95"
            title="Microsoft 365の最新受信メールを再取得・同期します"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-blue-400' : 'text-slate-300'}`} />
            <span>{isSyncing ? 'メール同期中...' : 'メール最新同期'}</span>
          </button>

          {!isAddingQuestion && (
            <button
              type="button"
              onClick={() => setIsAddingQuestion(true)}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>通関士の質疑を手動起票</span>
            </button>
          )}
        </div>
      </div>

      {/* Group Mailbox Hub Info Bar */}
      <div className="bg-blue-50/60 border-b border-blue-200 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center space-x-2 text-slate-700 flex-wrap">
          <Mail className="w-4 h-4 text-blue-600 shrink-0" />
          <span>
            <strong>送受信ハブ（共通グループメール）:</strong>{' '}
            <code className="bg-white px-2 py-0.5 rounded border border-blue-200 font-mono text-blue-900 font-bold">
              {m365Settings.groupEmail}
            </code>
          </span>
          <span className="text-slate-600 font-mono text-[11px] flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-300">|</span>
            {shipment.hawbNumber ? (
              <span className="bg-blue-100 text-blue-900 px-2 py-0.5 rounded font-bold border border-blue-300 flex items-center gap-1">
                <span>🔑 メール照合キー: HAWB:</span>
                <span className="font-mono text-blue-950">{shipment.hawbNumber}</span>
              </span>
            ) : (
              <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-bold border border-slate-300 flex items-center gap-1">
                <span>🔑 メール照合キー: MAWB:</span>
                <span className="font-mono text-slate-900">{shipment.mawbNumber || shipment.id}</span>
              </span>
            )}
            {shipment.hawbNumber && shipment.mawbNumber && (
              <span className="text-slate-500 font-mono text-[11px]">
                (親MAWB: {shipment.mawbNumber})
              </span>
            )}
          </span>
        </div>
        <span className="text-[11px] text-blue-800 font-bold bg-white border border-blue-200 px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-2xs">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
          <span>{shipment.hawbNumber ? 'HAWBキーで個別案件メールを完全抽出' : 'MAWBキーで案件メールを集約'}</span>
        </span>
      </div>

      {/* Toast Notice Banner */}
      {toastNotice && (
        <div className="mx-4 sm:mx-6 mt-3 p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-950 text-xs font-bold flex items-center justify-between shadow-xs animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
            <span>{toastNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastNotice(null)}
            className="text-emerald-700 hover:text-emerald-950 p-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Actual Incoming Emails for this AWB/HAWB from Mailbox */}
      <div className="p-4 sm:px-6 bg-slate-50/80 border-b border-slate-200">
        <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
            <Inbox className="w-4 h-4 text-blue-600" />
            <span>
              本件（{shipment.hawbNumber ? `HAWB: ${shipment.hawbNumber}` : `MAWB: ${shipment.mawbNumber || shipment.id}`}）に関する実際の受信・送信メール履歴 ({actualEmails.length}件):
            </span>
            {shipment.hawbNumber && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-md border border-blue-200">
                HAWB完全照合
              </span>
            )}
          </span>
          <span className="text-[11px] text-slate-500">
            {actualEmails.length > 0 ? '受信メールからワンクリックで照会起票可能' : '受信トレイに本案件のメールはありません'}
          </span>
        </div>

        {actualEmails.length === 0 ? (
          <div className="p-4 bg-white rounded-xl border border-slate-200 text-center text-xs text-slate-500 space-y-1">
            <p className="font-semibold text-slate-700">
              現在、メールボックスに本案件{shipment.hawbNumber ? `（HAWB: ${shipment.hawbNumber}）` : `（MAWB: ${shipment.mawbNumber || shipment.id}）`}が記載された受信・送信メールはありません。
            </p>
            <p className="text-[11px] text-slate-400">
              共通グループメール（{m365Settings.groupEmail}）宛てに{shipment.hawbNumber ? `「${shipment.hawbNumber}」` : '本AWB'}が記載されたメールが届くと自動的にここに表示されます。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {actualEmails.map((mail) => {
              const isExpanded = !!expandedMailIds[mail.id];
              const isUnread = !mail.isRead;

              const sEmail = (mail.sender?.email || '').toLowerCase().trim();
              const sName = (mail.sender?.name || '').toLowerCase();

              const isHellmannDomain =
                sEmail.includes('hellmann.com') ||
                sEmail.includes('hellmann') ||
                sName.includes('hellmann') ||
                sName.includes('ヘルマン');

              const configuredBrokerEmails = (m365Settings.brokerDefaultEmail || 'shirana@tac-japan.co.jp')
                .toLowerCase()
                .split(/[,;\s]+/)
                .map((e) => e.trim())
                .filter(Boolean);
              if (!configuredBrokerEmails.includes('shirana@tac-japan.co.jp')) {
                configuredBrokerEmails.push('shirana@tac-japan.co.jp');
              }

              const isBrokerSender = configuredBrokerEmails.some(
                (b) => b && (sEmail === b || sEmail.startsWith(b + '<') || sEmail.includes(`<${b}>`))
              );

              const isHellmannInquiry =
                !isHellmannDomain &&
                !isBrokerSender &&
                (mail.sourceType === 'CUSTOMS_INQUIRY' ||
                  ((mail.folder === 'SENT' ||
                    mail.direction === 'OUTGOING' ||
                    sEmail.includes('tac-japan.co.jp') ||
                    sEmail.includes('tac-hellmann') ||
                    sEmail.includes('kita@')) &&
                    (mail.body &&
                      (mail.body.includes('社内通関士より以下の照会が届いております') ||
                        mail.body.includes('照会内容】') ||
                        mail.body.includes('【通関照会】')))));

              const isOutgoing =
                (mail.folder === 'SENT' || mail.direction === 'OUTGOING' || isHellmannInquiry) &&
                !isHellmannDomain;

              const isBrokerQuestion = !isOutgoing && isBrokerSender;
              const isHellmannSender = !isOutgoing && !isBrokerSender && isHellmannDomain;
              const isInternalSender =
                !isOutgoing &&
                !isBrokerSender &&
                !isHellmannSender &&
                (sEmail.includes('tac-japan.co.jp') ||
                  sEmail.includes('@tac-') ||
                  sEmail.includes('osasales') ||
                  sEmail.includes('kita'));

              return (
                <div
                  key={mail.id}
                  className={`rounded-xl border transition-all shadow-2xs overflow-hidden ${
                    isUnread
                      ? 'border-blue-400 bg-gradient-to-r from-blue-50/70 via-indigo-50/30 to-white ring-2 ring-blue-300/40 border-l-4 border-l-blue-600 shadow-sm'
                      : isBrokerQuestion
                      ? 'border-indigo-300 ring-1 ring-indigo-200/50 bg-white'
                      : 'border-slate-200 hover:border-blue-300 bg-white'
                  }`}
                >
                  <div className="p-3.5 space-y-2 text-xs">
                    {/* メール表題行: 左側に種別・表題・差出人、右端に受送信の日付と時刻 */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                        {/* Unread Badge Tag */}
                        {isUnread && (
                          <span className="px-2 py-0.5 bg-blue-600 text-white rounded font-extrabold text-[10px] shadow-xs flex items-center gap-1 shrink-0 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                            新着・未読
                          </span>
                        )}

                        {isHellmannInquiry ? (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded font-bold text-[10px] border border-purple-300 shrink-0 flex items-center gap-1">
                            <Send className="w-3 h-3 text-purple-600" />
                            <span>ヘルマンへ送信</span>
                          </span>
                        ) : isOutgoing ? (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-medium text-[10px] border border-slate-200 shrink-0">
                            送信済み
                          </span>
                        ) : isBrokerQuestion ? (
                          <button
                            type="button"
                            onClick={() => handleToggleMailType(mail.id, true)}
                            title="クリックして種別を変更"
                            className="px-2 py-0.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 rounded font-bold text-[10px] border border-indigo-300 shrink-0 flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <HelpCircle className="w-3 h-3 text-indigo-600" />
                            <span>通関士からのメール</span>
                            <RefreshCw className="w-2.5 h-2.5 text-indigo-500 opacity-60 hover:opacity-100 ml-0.5" />
                          </button>
                        ) : isHellmannSender && mail.sourceType === 'HELLMANN_ORDER' ? (
                          <button
                            type="button"
                            onClick={() => handleToggleMailType(mail.id, false)}
                            title="クリックして種別を変更"
                            className="px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded font-bold text-[10px] border border-amber-300 shrink-0 flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <span>ヘルマン通関依頼</span>
                            <RefreshCw className="w-2.5 h-2.5 text-amber-600 opacity-60 hover:opacity-100 ml-0.5" />
                          </button>
                        ) : isHellmannSender ? (
                          <span className="px-2 py-0.5 bg-sky-100 text-sky-800 rounded font-bold text-[10px] border border-sky-300 shrink-0 flex items-center gap-1">
                            <span>ヘルマンから受信</span>
                          </span>
                        ) : isInternalSender ? (
                          <span className="px-2 py-0.5 bg-teal-100 text-teal-800 rounded font-bold text-[10px] border border-teal-300 shrink-0 flex items-center gap-1">
                            <span>社内より受信</span>
                          </span>
                        ) : mail.sourceType === 'HELLMANN_ANSWER' ? (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[10px] border border-emerald-300 shrink-0">
                            ヘルマン回答
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-medium text-[10px] border border-slate-200 shrink-0">
                            受信メール
                          </span>
                        )}
                        {(mail.hawbNumber || (shipment.hawbNumber && (mail.subject?.includes(shipment.hawbNumber) || mail.body?.includes(shipment.hawbNumber)))) && (
                          <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded font-mono text-[10px] border border-blue-200 font-bold shrink-0">
                            HAWB: {mail.hawbNumber || shipment.hawbNumber}
                          </span>
                        )}
                        <span className={`text-sm truncate max-w-[320px] sm:max-w-[480px] ${isUnread ? 'font-black text-slate-950' : 'font-bold text-slate-900'}`} title={mail.subject}>
                          {mail.subject || '(件名なし)'}
                        </span>
                        <span className="text-[11px] text-slate-500 truncate">
                          {mail.sender?.name} &lt;{mail.sender?.email}&gt;
                        </span>
                      </div>

                      {/* 表題の右端: 受送信の日付と時刻 & 既読切替 */}
                      <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                        <button
                          type="button"
                          onClick={() => setMailReadState(mail.id, !mail.isRead)}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded transition-colors cursor-pointer border ${
                            isUnread
                              ? 'bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                          }`}
                          title={isUnread ? 'クリックして既読にする' : 'クリックして未読に戻す'}
                        >
                          {isUnread ? '未読' : '既読'}
                        </button>

                        <div className="flex items-center gap-1.5 bg-slate-100 text-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 font-mono text-[11px] font-bold shadow-2xs">
                          <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          <span className="text-slate-600 font-semibold">{isOutgoing ? '送信日時:' : '受信日時:'}</span>
                          <span className="text-slate-900">{formatDateTime(mail.receivedOrSentAt)}</span>
                        </div>
                      </div>
                    </div>

                    {/* 本文プレビューおよびアクションボタン */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5">
                      <div className="flex-1 min-w-0">
                        {!isExpanded && (
                          <p className={`text-xs truncate leading-relaxed ${isUnread ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
                            {formatQuestionText(mail.body || mail.bodyHtml)?.slice(0, 160)}...
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                        <button
                          type="button"
                          onClick={() => toggleExpandMail(mail.id)}
                          className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                            isUnread
                              ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-xs'
                              : 'text-slate-600 bg-slate-100 hover:bg-slate-200'
                          }`}
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          <span>{isExpanded ? '本文を閉じる' : '本文確認'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCreateQaFromRealEmail(mail)}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[11px] font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer active:scale-95"
                          title="この受信メールの内容をもとにヘルマン照会・通関質疑ハブに起票します"
                        >
                          <Send className="w-3 h-3" />
                          <span>照会ハブへ起票</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleApplyMailAsAnswerFromCard(mail)}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer active:scale-95"
                          title="このメール本文・添付ファイルをヘルマン社からの回答として反映します"
                        >
                          <Inbox className="w-3.5 h-3.5" />
                          <span>回答として反映</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Mail Body & Attachments */}
                  {isExpanded && (() => {
                    const hData = hydratedEmails[mail.id];
                    const bodyHtml = hData?.bodyHtml !== undefined ? hData.bodyHtml : mail.bodyHtml;
                    const bodyText = hData?.body !== undefined ? hData.body : mail.body;
                    const attachments = hData?.attachments !== undefined ? hData.attachments : mail.attachments;
                    const hasComplexHtml = bodyHtml && (/<[a-z/][\s\S]*>/i.test(bodyHtml) && (bodyHtml.includes('<p') || bodyHtml.includes('<br') || bodyHtml.includes('<div') || bodyHtml.includes('<table')));

                    return (
                      <div className="p-3.5 bg-slate-50/80 border-t border-slate-200 text-xs space-y-2.5">
                        {hasComplexHtml ? (
                          <div
                            className="bg-white p-4 rounded-xl border border-slate-200 text-slate-800 text-[13px] leading-relaxed overflow-x-auto select-text cursor-text selection:bg-blue-200 selection:text-blue-900 [&_p]:mb-2 [&_div]:mb-1"
                            style={{ fontFamily: "'Segoe UI', Meiryo, sans-serif" }}
                            dangerouslySetInnerHTML={{
                              __html: sanitizeEmailHtml(
                                bodyHtml
                                  .replace(/&amp;gt;/g, '>')
                                  .replace(/&gt;/g, '>')
                                  .replace(/&amp;lt;/g, '<')
                                  .replace(/&lt;/g, '<'),
                                attachments
                              ),
                            }}
                          />
                        ) : (
                          <div
                            className="bg-white p-3.5 rounded-xl border border-slate-200 text-slate-800 font-sans whitespace-pre-wrap leading-relaxed text-[13px]"
                            style={{ fontFamily: "'Segoe UI', Meiryo, sans-serif" }}
                          >
                            {formatQuestionText(bodyText || bodyHtml)}
                          </div>
                        )}

                        {attachments && attachments.length > 0 && (
                          <div className="flex items-center gap-2 flex-wrap pt-1">
                            <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                              <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                              <span>添付ファイル ({attachments.length}件):</span>
                            </span>
                            {attachments.map((att) => (
                              <div
                                key={att.id}
                                className="inline-flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-xs"
                              >
                                <FileText className="w-3.5 h-3.5 text-blue-600" />
                                <span className="font-medium text-slate-800">{att.fileName}</span>
                                {(att.dataUrl || att.downloadUrl) && (
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadAttachment(att)}
                                    className="p-0.5 text-slate-500 hover:text-blue-600 cursor-pointer"
                                    title="ダウンロード"
                                  >
                                    <Download className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Question Input Form (Manual) */}
      {isAddingQuestion && (
        <form onSubmit={handleCreateQuestion} className="p-4 sm:p-6 bg-blue-50/50 border-b border-blue-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
              <User className="w-4 h-4 text-blue-600" />
              <span>通関士からの質疑内容を直接記録・起票</span>
            </span>
            <button
              type="button"
              onClick={() => setIsAddingQuestion(false)}
              className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              キャンセル
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">質疑タイトル (要約):</label>
              <input
                type="text"
                value={questionTitle}
                onChange={(e) => setQuestionTitle(e.target.value)}
                placeholder="例: SDSおよび品名仕様の確認"
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">差出通関士 氏名:</label>
              <input
                type="text"
                value={brokerName}
                onChange={(e) => setBrokerName(e.target.value)}
                placeholder="例: 白名 通関士"
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">通関士メールアドレス:</label>
              <input
                type="email"
                value={brokerEmail}
                onChange={(e) => setBrokerEmail(e.target.value)}
                placeholder={m365Settings.brokerDefaultEmail || 'shirana@tac-japan.co.jp'}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-bold text-slate-600">
                質問事項（通関照会内容 / 表・フォント・カラー対応）: <span className="text-red-500">*</span>
              </label>
              <span className="text-[11px] text-blue-600 font-medium">
                ※メールやExcel等から表（罫線）や文字サイズ・色の装飾をそのままコピペ可能です
              </span>
            </div>
            <HtmlMailEditor
              value={questionText}
              onChange={(html) => setQuestionText(html)}
              rows={6}
              placeholder="質問内容を入力、またはメール等の文面（表や装飾含む）をそのままコピペしてください..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsAddingQuestion(false)}
              className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 cursor-pointer"
            >
              閉じる
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>質問を登録する</span>
            </button>
          </div>
        </form>
      )}

      {/* QA Relay Threads List */}
      <div id="qa-relay-threads-list" data-qa-threads-list="true" className="p-4 sm:p-6 space-y-6">
        {qas.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
            <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-700">現在、通関士からの質疑・保留スレッドはありません。</p>
            <p className="text-[11px] text-slate-400 mt-1 max-w-lg mx-auto">
              上の「実際の受信メール」から該当メールを選択して起票するか、「通関士の質疑を手動起票」から直接記録できます。
            </p>
          </div>
        ) : (
          qas.map((qa, index) => {
            const hasInquiry = !!qa.hellmannInquiry;
            const hasAnswer = !!qa.hellmannAnswer;
            const isResolved = qa.status === 'RESOLVED_TO_BROKER';
            const isHighlighted = highlightedQaId === qa.id;

            return (
              <div
                key={`${qa.id}-${index}`}
                id={`qa-card-${qa.id}`}
                data-qa-card-id={qa.id}
                className={`rounded-2xl border bg-white shadow-xs overflow-hidden transition-all duration-500 ${
                  isHighlighted
                    ? 'border-blue-500 ring-4 ring-blue-500/30 shadow-xl scale-[1.01]'
                    : 'border-slate-200'
                }`}
              >
                {/* QA Header / Status Ribbon */}
                <div className="p-3 px-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center">
                      Q{index + 1}
                    </span>
                    <span className="font-bold text-slate-800 text-sm">{qa.title}</span>
                  </div>

                  {/* 表題の右端: 受信/起票日時 ＆ ステータスバッジ ＆ 削除 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 bg-white text-slate-700 px-2.5 py-1 rounded-md border border-slate-200 font-mono text-[11px] font-semibold">
                      <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span>起票/受付:</span>
                      <span className="text-slate-900 font-bold">{formatDateTime(qa.createdAt || qa.brokerQuestion.askedAt)}</span>
                    </div>

                    {isResolved ? (
                      <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-bold rounded-full text-xs flex items-center gap-1 border border-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>通関士へ回答送信完了 (解決)</span>
                      </span>
                    ) : hasAnswer ? (
                      <span className="px-2.5 py-1 bg-blue-100 text-blue-800 font-bold rounded-full text-xs flex items-center gap-1 border border-blue-300">
                        <Check className="w-3.5 h-3.5 text-blue-600" />
                        <span>ヘルマン回答あり (通関士へ未返信)</span>
                      </span>
                    ) : hasInquiry ? (
                      <span className="px-2.5 py-1 bg-amber-100 text-amber-900 font-bold rounded-full text-xs flex items-center gap-1 border border-amber-300">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        <span>ヘルマン照会中 (回答待ち)</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-800 font-bold rounded-full text-xs flex items-center gap-1 border border-slate-300">
                        <AlertCircle className="w-3.5 h-3.5 text-slate-600" />
                        <span>ヘルマン未照会</span>
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDeleteQa(qa.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                      title="この質疑スレッドを削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Workflow Relay Sequence (Vertical Timeline) */}
                <div className="p-4 sm:p-5 space-y-4 text-xs">
                  {/* Step 1: Broker Question (Arrived at Common Group Email) */}
                  <div className="relative pl-6 border-l-2 border-indigo-400">
                    <div className="absolute -left-2.5 top-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                      1
                    </div>
                    <div className="flex items-center justify-between text-indigo-950 font-bold mb-1 flex-wrap gap-1">
                      <span className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-indigo-600" />
                        <span>社内通関士 ({qa.brokerQuestion.brokerName}) からの質問:</span>
                      </span>
                      <div className="flex items-center gap-2 text-[11px] font-normal text-slate-500">
                        <span className="bg-indigo-100/70 text-indigo-800 px-2 py-0.5 rounded font-mono text-[10px]">
                          受信先: {qa.brokerQuestion.receivedAtGroupEmail || m365Settings.groupEmail}
                        </span>
                        <span className="font-mono bg-indigo-50 text-indigo-900 px-2 py-0.5 rounded border border-indigo-200/60 font-semibold flex items-center gap-1">
                          <Clock className="w-3 h-3 text-indigo-600" />
                          <span>受信日時: {formatDateTime(qa.brokerQuestion.askedAt)}</span>
                        </span>
                      </div>
                    </div>
                    <div className="bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-200/80 text-indigo-950 font-normal leading-relaxed overflow-x-auto text-[13px]">
                      {(() => {
                        const raw = qa.brokerQuestion.questionText || '';
                        const hasComplexHtml = raw.includes('<table') || raw.includes('<ul') || raw.includes('<ol');
                        
                        if (hasComplexHtml) {
                          return (
                            <div
                              className="prose prose-xs max-w-none text-indigo-950 leading-relaxed font-normal [&_p]:mb-2 [&_p]:block [&_div]:mb-1 [&_table]:border-collapse [&_table]:w-full [&_table]:my-2 [&_table]:border [&_table]:border-slate-300 [&_th]:border [&_th]:border-slate-300 [&_th]:p-1.5 [&_th]:bg-slate-100 [&_td]:border [&_td]:border-slate-300 [&_td]:p-1.5"
                              style={{ color: 'inherit', fontFamily: 'inherit' }}
                              dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(raw, qa.brokerQuestion?.attachments) }}
                            />
                          );
                        }

                        // formatQuestionText で段落・改行を補完し、whitespace-pre-wrap で確実に改行描画
                        const formatted = formatQuestionText(raw);
                        return (
                          <div className="whitespace-pre-wrap leading-relaxed font-normal space-y-1">
                            {formatted}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                      <span>差出通関士: {qa.brokerQuestion.brokerEmail || m365Settings.brokerDefaultEmail}</span>
                      {qa.brokerQuestion.subject && (
                        <span>| 件名: {qa.brokerQuestion.subject}</span>
                      )}
                    </div>
                  </div>

                  {/* Step 2: Inquiry to Hellmann (Sent from Common Group Email) */}
                  <div className="relative pl-6 border-l-2 border-blue-400">
                    <div className="absolute -left-2.5 top-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                      2
                    </div>
                    <div className="flex items-center justify-between font-bold mb-1 flex-wrap gap-1">
                      <span className="flex items-center gap-1.5 text-blue-950">
                        <Building2 className="w-3.5 h-3.5 text-blue-600" />
                        <span>ヘルマン社への照会 (グループメールより照会メール作成):</span>
                      </span>
                      {hasInquiry && (
                        <div className="flex items-center gap-2 text-[11px] font-normal text-slate-500">
                          <span className="bg-blue-100/70 text-blue-800 px-2 py-0.5 rounded font-mono text-[10px]">
                            送信元: {qa.hellmannInquiry?.sentFromGroupEmail || m365Settings.groupEmail}
                          </span>
                          <span className="font-mono bg-blue-50 text-blue-900 px-2 py-0.5 rounded border border-blue-200/60 font-semibold flex items-center gap-1">
                            <Clock className="w-3 h-3 text-blue-600" />
                            <span>送信日時: {formatDateTime(qa.hellmannInquiry?.sentAt)}</span>
                          </span>
                        </div>
                      )}
                    </div>

                    {hasInquiry ? (
                      <div className="bg-blue-50/60 p-3 rounded-xl border border-blue-200/80 text-blue-950 font-medium leading-relaxed overflow-x-auto">
                        {/<[a-z/][\s\S]*>/i.test(qa.hellmannInquiry?.sentContent || '') || qa.hellmannInquiry?.sentContent?.includes('<br') || qa.hellmannInquiry?.sentContent?.includes('</') ? (
                          <div
                            className="prose prose-xs max-w-none text-blue-950 leading-relaxed font-normal"
                            style={{ color: 'inherit', fontFamily: 'inherit' }}
                            dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(qa.hellmannInquiry?.sentContent || '') }}
                          />
                        ) : (
                          <div className="whitespace-pre-wrap font-normal">
                            {qa.hellmannInquiry?.sentContent}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                        <p className="text-[11px] text-slate-600">
                          通関士からの質問内容を引用し、ヘルマン社宛てに照会メールを作成・送信します。
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => openInquiryConfirmModal(qa)}
                            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5 active:scale-95 text-xs"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>ヘルマン社へ照会メールを送信</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetPendingWithoutSending(qa)}
                            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-xl font-semibold transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 text-xs"
                            title="別メーラーで直接質問を送信済みの場合に使用します"
                          >
                            <Check className="w-3.5 h-3.5 text-amber-600" />
                            <span>送信せず「照会中」ステータスに変更</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Step 3: Hellmann Answer & Attachments */}
                  <div className="relative pl-6 border-l-2 border-emerald-400">
                    <div className="absolute -left-2.5 top-0 w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">
                      3
                    </div>
                    <div className="flex items-center justify-between font-bold mb-1 flex-wrap gap-1">
                      <span className="flex items-center gap-1.5 text-emerald-950">
                        <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>ヘルマン社からの回答:</span>
                      </span>
                      {hasAnswer && (
                        <div className="flex items-center gap-2 text-[11px] font-normal text-slate-500">
                          <span className="bg-emerald-100/70 text-emerald-800 px-2 py-0.5 rounded font-mono text-[10px]">
                            受信先: {qa.hellmannAnswer?.receivedAtGroupEmail || m365Settings.groupEmail}
                          </span>
                          <span className="font-mono bg-emerald-50 text-emerald-900 px-2 py-0.5 rounded border border-emerald-200/60 font-semibold flex items-center gap-1">
                            <Clock className="w-3 h-3 text-emerald-600" />
                            <span>受信日時: {formatDateTime(qa.hellmannAnswer?.receivedAt)}</span>
                          </span>
                        </div>
                      )}
                    </div>

                    {manualInputQaId === qa.id ? (
                      <div className="bg-emerald-50/70 p-3.5 rounded-xl border border-emerald-300 text-xs space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                            <FileText className="w-4 h-4 text-emerald-600" />
                            <span>ヘルマン社からの回答内容を直接入力</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setManualInputQaId(null)}
                            className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div>
                          <textarea
                            value={manualInputText}
                            onChange={(e) => setManualInputText(e.target.value)}
                            rows={4}
                            placeholder="ヘルマン社からの回答本文、または電話・チャットで確認したメモを入力してください&#10;例: 荷主確認完了。該非判定：非該当（木枠梱包なし・プラスチックパレット使用）。Non-DG判定。"
                            className="w-full p-2.5 bg-white rounded-lg border border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 text-xs font-mono leading-relaxed"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setManualInputQaId(null)}
                            className="px-3 py-1.5 bg-white text-slate-600 border border-slate-300 rounded-lg font-bold text-xs hover:bg-slate-100 cursor-pointer"
                          >
                            キャンセル
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveManualAnswer(qa.id)}
                            disabled={!manualInputText.trim()}
                            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-bold text-xs shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
                          >
                            <Check className="w-4 h-4" />
                            <span>回答を確定・反映</span>
                          </button>
                        </div>
                      </div>
                    ) : hasAnswer ? (
                      <div className="bg-emerald-50/60 p-3 rounded-xl border border-emerald-200/80 text-emerald-950 space-y-2">
                        {qa.hellmannAnswer?.answerHtml ? (
                          <div
                            className="bg-white p-4 rounded-xl border border-slate-200 text-slate-800 text-[13px] leading-relaxed overflow-x-auto select-text cursor-text"
                            dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(qa.hellmannAnswer.answerHtml, qa.hellmannAnswer.attachments) }}
                          />
                        ) : (
                          <div className="font-medium leading-relaxed whitespace-pre-wrap">
                            {qa.hellmannAnswer?.answerText}
                          </div>
                        )}

                        {/* Attachments from Hellmann */}
                        {qa.hellmannAnswer?.attachments && qa.hellmannAnswer.attachments.length > 0 && (
                          <div className="pt-2 border-t border-emerald-200/60">
                            <span className="text-[11px] font-bold text-emerald-900 block mb-1 flex items-center gap-1">
                              <Paperclip className="w-3 h-3 text-emerald-700" />
                              <span>受領添付ファイル ({qa.hellmannAnswer.attachments.length}件):</span>
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {qa.hellmannAnswer.attachments.map((att) => (
                                <div
                                  key={att.id}
                                  className="inline-flex items-center gap-2 bg-white border border-emerald-300 p-2 px-3 rounded-xl shadow-2xs text-xs text-slate-800"
                                >
                                  <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                                  <span className="font-medium truncate max-w-[200px]">{att.fileName}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadAttachment(att)}
                                    className="p-1 text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer transition-colors"
                                    title="ファイルをダウンロード"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-end pt-1 border-t border-emerald-200/40 gap-3">
                          <button
                            type="button"
                            onClick={() => setSelectMailModalQa(qa)}
                            className="text-[11px] text-emerald-800 hover:text-emerald-950 font-bold cursor-pointer flex items-center gap-1"
                          >
                            <Mail className="w-3 h-3 text-emerald-600" />
                            <span>別のメールを回答として再選択</span>
                          </button>
                          <span className="text-emerald-300">|</span>
                          <button
                            type="button"
                            onClick={() => {
                              setManualInputQaId(qa.id);
                              setManualInputText(qa.hellmannAnswer?.answerText || '');
                            }}
                            className="text-[11px] text-emerald-800 hover:text-emerald-950 font-bold cursor-pointer flex items-center gap-1"
                          >
                            <FileText className="w-3 h-3 text-emerald-600" />
                            <span>回答内容を手動修正</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-600 text-[11px] space-y-2.5">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="text-slate-500 italic">
                            ヘルマン社からの返信メールを着信待機中... （自動判定中）
                          </span>
                          <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded border border-amber-200 font-medium">
                            自動反映されない場合は手動反映が可能です
                          </span>
                        </div>

                        <div className="flex items-center gap-2 pt-1 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setSelectMailModalQa(qa)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            <span>✉️ 受信メールから選択して反映</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setManualInputQaId(qa.id);
                              setManualInputText('');
                            }}
                            className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg font-bold text-xs shadow-2xs flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                          >
                            <FileText className="w-3.5 h-3.5 text-emerald-600" />
                            <span>✏️ 回答を手動直接入力 (電話・チャット等)</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Step 4: Reply to Broker (Sent from Common Group Email) */}
                  <div className="relative pl-6">
                    <div className="absolute -left-2.5 top-0 w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center">
                      4
                    </div>
                    <div className="flex items-center justify-between font-bold mb-1 flex-wrap gap-1">
                      <span className="flex items-center gap-1.5 text-slate-900">
                        <User className="w-3.5 h-3.5 text-slate-700" />
                        <span>社内通関士へ回答返信:</span>
                      </span>
                      {isResolved && (
                        <div className="flex items-center gap-2 text-[11px] flex-wrap">
                          <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono text-[10px]">
                            送信元: {qa.brokerReply?.sentFromGroupEmail || m365Settings.groupEmail}
                          </span>
                          <span className="font-mono bg-emerald-50 text-emerald-900 px-2 py-0.5 rounded border border-emerald-200/60 font-semibold flex items-center gap-1">
                            <Clock className="w-3 h-3 text-emerald-600" />
                            <span>送信完了: {formatDateTime(qa.brokerReply?.sentAt)}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRevertBrokerReply(qa)}
                            className="text-[10px] text-slate-400 hover:text-rose-600 hover:underline cursor-pointer ml-1"
                            title="返信ステータスを取り消して未返信に戻します"
                          >
                            未送信に戻す
                          </button>
                        </div>
                      )}
                    </div>

                    {isResolved ? (
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-slate-800 space-y-2">
                        {/<[a-z/][\s\S]*>/i.test(qa.brokerReply?.replyText || '') || qa.brokerReply?.replyText?.includes('<br') || qa.brokerReply?.replyText?.includes('</') ? (
                          <div
                            className="bg-white p-4 rounded-xl border border-slate-200 text-slate-800 text-[13px] leading-relaxed overflow-x-auto select-text cursor-text [&_p]:mb-2 [&_div]:mb-1 [&_table]:border-collapse [&_table]:w-full [&_table]:my-2 [&_table]:border [&_table]:border-slate-300 [&_th]:border [&_th]:border-slate-300 [&_th]:p-1.5 [&_th]:bg-slate-100 [&_td]:border [&_td]:border-slate-300 [&_td]:p-1.5"
                            style={{ fontFamily: "'Segoe UI', Meiryo, -apple-system, BlinkMacSystemFont, sans-serif" }}
                            dangerouslySetInnerHTML={{
                              __html: sanitizeEmailHtml(
                                (qa.brokerReply?.replyText || '')
                                  .replace(/&amp;gt;/g, '>')
                                  .replace(/&gt;/g, '>')
                                  .replace(/&amp;lt;/g, '<')
                                  .replace(/&lt;/g, '<'),
                                qa.brokerReply?.forwardedAttachments
                              ),
                            }}
                          />
                        ) : (
                          <div className="bg-white p-4 rounded-xl border border-slate-200 font-medium leading-relaxed whitespace-pre-wrap text-[13px]">
                            {qa.brokerReply?.replyText}
                          </div>
                        )}
                        {qa.brokerReply?.forwardedAttachments && qa.brokerReply.forwardedAttachments.length > 0 && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 pt-1">
                            <Paperclip className="w-3 h-3" />
                            <span>添付して送信したファイル: {qa.brokerReply.forwardedAttachments.map((a) => a.fileName).join(', ')}</span>
                          </div>
                        )}
                      </div>
                    ) : hasAnswer ? (
                      <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-200 space-y-3">
                        <p className="text-[11px] text-blue-900 font-medium">
                          通関士（{qa.brokerQuestion.brokerEmail || m365Settings.brokerDefaultEmail}）宛てに回答を返信します。
                        </p>

                        {/* Forward attachments checkbox */}
                        {qa.hellmannAnswer?.attachments && qa.hellmannAnswer.attachments.length > 0 && (
                          <div className="bg-white p-2.5 rounded-xl border border-blue-200 flex items-center justify-between">
                            <label className="flex items-center space-x-2 cursor-pointer text-xs">
                              <input
                                type="checkbox"
                                checked={forwardAttachmentsSelected[qa.id] !== false}
                                onChange={(e) =>
                                  setForwardAttachmentsSelected((prev) => ({
                                    ...prev,
                                    [qa.id]: e.target.checked,
                                  }))
                                }
                                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                              />
                              <span className="font-bold text-slate-800">
                                ☑️ 添付ファイル ({qa.hellmannAnswer.attachments.length}件) を転送添付
                              </span>
                            </label>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => openBrokerReplyConfirmModal(qa)}
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all shadow-md cursor-pointer flex items-center gap-2 active:scale-95 text-xs"
                            >
                              <Send className="w-4 h-4" />
                              <span>通関士へ送信</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleSetBrokerResolvedWithoutSending(qa)}
                              className="px-3.5 py-2 bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-300 hover:border-emerald-300 rounded-xl font-bold transition-all text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs active:scale-95"
                              title="自社メーラー等で直接通関士へ返信済みの場合は、メール送信を行わずに「通関士に回答済」として完了にします"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>通関士へ送信済</span>
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleOpenInOutlook(qa)}
                            className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl font-bold transition-all text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                            title="Outlookでメール下書きを開いて編集・送信します"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
                            <span>Outlookで開いて送信 ↗️</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400 italic">
                        ヘルマン社からの回答が届くと、通関士宛てへの返信アクションが有効になります。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 照会メール外部送信前の最終確認・編集モーダル */}
      {inquiryModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="bg-slate-900 text-white p-4 px-6 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Mail className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-base text-white">
                  【送信前確認】ヘルマン社宛て 照会メール
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInquiryModal({ isOpen: false, qa: null, toRecipients: '', ccRecipients: '', subject: '', sentContent: '' })}
                className="text-slate-400 hover:text-white p-1 rounded-lg text-lg leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Warning Banner */}
            <div className="bg-amber-50 border-b border-amber-200 p-3 px-6 text-amber-900 text-xs flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                外部（ヘルマン社）宛てに実際のメールが送信されます。送信宛先（To / CC）・件名・本文をご確認・追記のうえ「送信を実行」してください。
              </span>
            </div>

            {/* Form Fields */}
            <div className="p-6 overflow-y-auto space-y-4 text-sm text-slate-800">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    送信宛先 (To): <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={inquiryModal.toRecipients}
                    onChange={(e) => setInquiryModal((prev) => ({ ...prev, toRecipients: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs font-mono"
                    placeholder="例: HMS-JP@hellmann.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    CC宛先:
                  </label>
                  <input
                    type="text"
                    value={inquiryModal.ccRecipients}
                    onChange={(e) => setInquiryModal((prev) => ({ ...prev, ccRecipients: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs font-mono"
                    placeholder="例: tac-hellmann@tac-japan.co.jp"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  件名 (Subject): <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={inquiryModal.subject}
                  onChange={(e) => setInquiryModal((prev) => ({ ...prev, subject: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-xs font-medium"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    メール本文 (Body / 英文・和文・HTML表対応):
                  </label>
                  <span className="text-[11px] text-blue-600 font-medium">
                    ※表やフォント装飾付きのコピー＆ペーストに対応
                  </span>
                </div>
                <HtmlMailEditor
                  value={inquiryModal.sentContent}
                  onChange={(html) => setInquiryModal((prev) => ({ ...prev, sentContent: html }))}
                  rows={9}
                  placeholder="メール本文を入力、または表（HTML）やテキストをコピペしてください..."
                />
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 border-t border-slate-200 p-4 px-6 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setInquiryModal({ isOpen: false, qa: null, toRecipients: '', ccRecipients: '', subject: '', sentContent: '' })}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmAndSendInquiry}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Send className="w-3.5 h-3.5" />
                <span>内容を確認してヘルマン社へ送信</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 通関士宛て回答返信前の最終確認・編集モーダル */}
      {brokerReplyModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="bg-slate-900 text-white p-4 px-6 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <User className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base text-white">
                  【送信前確認】社内通関士宛て 回答返信メール
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setBrokerReplyModal({ isOpen: false, qa: null, toRecipients: '', ccRecipients: '', subject: '', replyText: '' })}
                className="text-slate-400 hover:text-white p-1 rounded-lg text-lg leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Form Fields */}
            <div className="p-6 overflow-y-auto space-y-4 text-sm text-slate-800">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    送信宛先 (通関士 To): <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={brokerReplyModal.toRecipients}
                    onChange={(e) => setBrokerReplyModal((prev) => ({ ...prev, toRecipients: e.target.value }))}
                    placeholder="shirana@tac-japan.co.jp"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                    <span>CC宛先 (Cc):</span>
                    <span className="text-[10px] text-slate-500 font-normal">※複数指定時はカンマ(,)区切り</span>
                  </label>
                  <input
                    type="text"
                    value={brokerReplyModal.ccRecipients}
                    onChange={(e) => setBrokerReplyModal((prev) => ({ ...prev, ccRecipients: e.target.value }))}
                    placeholder="tac-hellmann@tac-japan.co.jp"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  件名 (Subject): <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={brokerReplyModal.subject}
                  onChange={(e) => setBrokerReplyModal((prev) => ({ ...prev, subject: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 text-xs font-medium"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    返信本文 (Body / HTML表対応):
                  </label>
                  <span className="text-[11px] text-emerald-600 font-medium">
                    ※表やフォント装飾付きのコピー＆ペーストに対応
                  </span>
                </div>
                <HtmlMailEditor
                  value={brokerReplyModal.replyText}
                  onChange={(html) => setBrokerReplyModal((prev) => ({ ...prev, replyText: html }))}
                  rows={12}
                  placeholder="返信本文を入力、または表（HTML）やテキストをコピペしてください..."
                />
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 border-t border-slate-200 p-4 px-6 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setBrokerReplyModal({ isOpen: false, qa: null, toRecipients: '', ccRecipients: '', subject: '', replyText: '' })}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmAndSendBrokerReply}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Send className="w-3.5 h-3.5" />
                <span>内容を確認して通関士へ送信</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* モーダル1: 受信メール一覧から「ヘルマン社回答」を選択するモーダル */}
      {selectMailModalQa && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-emerald-950 text-white p-4 px-6 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Mail className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="font-bold text-base text-white">受信メールから「ヘルマン社回答」を選択</h3>
                  <p className="text-xs text-emerald-200 font-mono">対象照会: {selectMailModalQa.title}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectMailModalQa(null)}
                className="text-emerald-300 hover:text-white p-1 rounded-lg text-lg leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 flex-1 bg-slate-50">
              <p className="text-xs text-slate-700 bg-emerald-50/80 p-3 rounded-xl border border-emerald-200 leading-relaxed">
                💡 本案件（HAWB: {shipment.hawbNumber || shipment.id}）に関する受信メール一覧です。選択したメールの本文・添付ファイルが本照会の「ヘルマン社からの回答」として設定されます。
              </p>

              {actualEmails.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
                  受信メール履歴がありません。「メール最新同期」を実行するか、手動入力をお試しください。
                </div>
              ) : (
                actualEmails.map((m) => (
                  <div
                    key={m.id}
                    className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:border-emerald-500 hover:shadow-xs transition-all space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`px-2 py-0.5 font-bold text-[10px] rounded border ${
                          m.folder === 'SENT'
                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                            : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                        }`}>
                          {m.folder === 'SENT' ? '送信済み' : '受信メール'}
                        </span>
                        <span className="font-bold text-xs text-slate-900 truncate">{m.subject || '(件名なし)'}</span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 shrink-0">
                        {formatDateTime(m.receivedOrSentAt)}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500">
                      差出人: <span className="font-medium text-slate-700">{m.sender?.name}</span> &lt;{m.sender?.email}&gt;
                    </div>

                    {m.bodyHtml ? (
                      <div className="p-3 bg-white rounded-lg text-xs text-slate-800 max-h-48 overflow-y-auto leading-relaxed border border-slate-200" dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(m.bodyHtml, m.attachments) }} />
                    ) : (
                      <div className="p-2.5 bg-slate-50 rounded-lg text-xs font-mono text-slate-700 whitespace-pre-wrap max-h-28 overflow-y-auto leading-relaxed border border-slate-100">
                        {m.body}
                      </div>
                    )}

                    {m.attachments && m.attachments.length > 0 && (
                      <div className="text-[11px] text-emerald-800 font-medium flex items-center gap-1.5 pt-1">
                        <Paperclip className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>添付ファイル ({m.attachments.length}件): {m.attachments.map((a) => a.fileName).join(', ')}</span>
                      </div>
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => handleApplyMailToQa(selectMailModalQa.id, m)}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>このメールを回答として確定</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="bg-white border-t border-slate-200 p-3 px-6 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setSelectMailModalQa(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* モーダル2: メールカードから反映ボタン押下時、複数QAがある場合に選択するモーダル */}
      {selectQaModalMail && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-slate-900 text-white p-4 px-6 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <HelpCircle className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base text-white">対象の通関照会チケットを選択</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectQaModalMail(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg text-lg leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs text-slate-800 bg-slate-50">
              <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1 shadow-2xs">
                <span className="font-bold text-slate-400 block text-[10px] uppercase tracking-wider">選択した受信メール</span>
                <div className="font-bold text-sm text-slate-900">{selectQaModalMail.subject || '(件名なし)'}</div>
                <div className="text-slate-500">差出人: {selectQaModalMail.sender?.name} &lt;{selectQaModalMail.sender?.email}&gt;</div>
              </div>

              <p className="font-bold text-slate-700">どの照会チケットに対する「ヘルマン社回答」として反映しますか？</p>

              <div className="space-y-2">
                {qas.map((q) => (
                  <div
                    key={q.id}
                    className="p-3.5 bg-white rounded-xl border border-slate-200 hover:border-emerald-500 hover:shadow-md transition-all flex items-center justify-between gap-3 cursor-pointer group"
                    onClick={() => handleApplyMailToQa(q.id, selectQaModalMail)}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">{q.title}</div>
                      <div className="text-[11px] text-slate-500 truncate">{q.brokerQuestion.questionText}</div>
                      <div className="text-[10px] text-slate-400">作成日時: {formatDateTime(q.createdAt)}</div>
                    </div>
                    <button
                      type="button"
                      className="px-3 py-1.5 bg-emerald-600 group-hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>反映</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border-t border-slate-200 p-3 px-6 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setSelectQaModalMail(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
