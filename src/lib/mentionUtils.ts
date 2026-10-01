import { QuotationItem, StaffMember, UserProfile } from "../types";
import { isEventAlreadyNotified, markEventAsNotified } from "./notificationHelper";
import { notifyMentionReceived, notifyMentionSent } from "./toastNotifier";

export interface MentionTarget {
  staffId?: string;
  name: string;
  email: string;
}

// Extract mentioned staff members from HTML or plain text message
export function extractMentionsFromContent(
  contentHtmlOrText: string,
  staffMembers: StaffMember[]
): StaffMember[] {
  if (!contentHtmlOrText || !staffMembers || staffMembers.length === 0) {
    return [];
  }

  const textLower = contentHtmlOrText.toLowerCase();
  const mentionedSet = new Set<string>();
  const result: StaffMember[] = [];

  staffMembers.forEach((staff) => {
    const emailLower = staff.email.toLowerCase();
    const nameLower = staff.name.toLowerCase();
    const firstName = staff.name.split(" ")[0].toLowerCase();

    // Check if email or data-mention-email attribute exists with explicit @ or mention badge
    const hasAtEmail =
      textLower.includes(`data-mention-email="${emailLower}"`) ||
      textLower.includes(`@${emailLower}`);

    // Check if name is prefixed with @
    const hasAtName =
      (nameLower && textLower.includes(`@${nameLower}`)) ||
      (firstName && textLower.includes(`@${firstName}`));

    if (hasAtEmail || hasAtName) {
      if (!mentionedSet.has(staff.id)) {
        mentionedSet.add(staff.id);
        result.push(staff);
      }
    }
  });

  return result;
}

// Check if a specific user (by UserProfile) is mentioned in content
export function isUserMentioned(
  contentHtmlOrText: string,
  user: UserProfile,
  staffMembers: StaffMember[]
): boolean {
  if (!contentHtmlOrText || !user) return false;

  const textLower = contentHtmlOrText.toLowerCase();
  const userEmailLower = user.email.toLowerCase();
  const userNameLower = user.name.toLowerCase();
  const userFirstName = user.name.split(" ")[0].toLowerCase();

  if (
    textLower.includes(`data-mention-email="${userEmailLower}"`) ||
    textLower.includes(`@${userEmailLower}`)
  ) {
    return true;
  }

  if (
    (userNameLower && textLower.includes(`@${userNameLower}`)) ||
    (userFirstName && textLower.includes(`@${userFirstName}`))
  ) {
    return true;
  }

  // Also check matched staff
  const mentions = extractMentionsFromContent(contentHtmlOrText, staffMembers);
  return mentions.some((s) => s.email.toLowerCase() === userEmailLower);
}

// Format a staff member as HTML mention badge matching the specified pill style
export function formatMentionHtml(staff: StaffMember): string {
  const displayName = staff.name.split(" ")[0] || staff.name;
  return `<span class="inline-flex items-center gap-1 font-bold text-sky-400 bg-slate-900 border border-sky-600 px-2.5 py-0.5 rounded-lg text-xs shadow-2xs mx-0.5 align-middle select-none" style="color: #38bdf8 !important; background-color: #0f172a !important; border: 1px solid #0284c7; border-radius: 6px; padding: 2px 8px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; margin: 0 2px;" data-mention-email="${staff.email}" contenteditable="false">@${displayName} (${staff.email})</span>&nbsp;`;
}

// Strip HTML tags for plain text email / push notification body
export function stripHtmlToPlainText(htmlStr: string): string {
  if (!htmlStr) return "";
  const temp = document.createElement("div");
  temp.innerHTML = htmlStr;
  return temp.textContent || temp.innerText || "";
}

// Deduplication tracking to prevent duplicate email dispatches
const processedMsgIds = new Set<string>();

// Automatically trigger Desktop Notifications, Screen Window Toasts, and Background Email sending
export async function processMentionNotificationsAndEmails({
  contentHtml,
  quote,
  senderName,
  senderEmail,
  currentUser,
  staffMembers,
  msgId,
}: {
  contentHtml: string;
  quote?: QuotationItem | null;
  senderName: string;
  senderEmail: string;
  currentUser: UserProfile;
  staffMembers: StaffMember[];
  msgId: string;
}) {
  if (!contentHtml || !staffMembers || staffMembers.length === 0) return;

  // Deduplication check: guarantee each msgId is processed at most once (persistently across restarts)
  if (msgId && (processedMsgIds.has(msgId) || isEventAlreadyNotified(msgId) || isEventAlreadyNotified(`mention-${msgId}`))) {
    console.log(`[Mention Auto Email] Message ${msgId} already processed. Skipping duplicate execution.`);
    return;
  }
  if (msgId) {
    processedMsgIds.add(msgId);
    markEventAsNotified(msgId);
    markEventAsNotified(`mention-${msgId}`);
    setTimeout(() => processedMsgIds.delete(msgId), 30000);
  }

  const mentionedStaffs = extractMentionsFromContent(contentHtml, staffMembers);
  if (mentionedStaffs.length === 0) return;

  const appUrl = typeof window !== "undefined" ? window.location.origin : "";
  const msgText = stripHtmlToPlainText(contentHtml);

  // 1. Trigger Window Toast Message Popup & Desktop Notification if current logged-in user is mentioned (ignore self-mentions)
  if (
    isUserMentioned(contentHtml, currentUser, staffMembers) &&
    senderEmail?.toLowerCase() !== currentUser.email?.toLowerCase()
  ) {
    notifyMentionReceived(senderName || senderEmail, msgText.slice(0, 100), msgId, new Date());
  }

  // 2. Load User's Saved Email / SMTP Settings from localStorage
  let savedSettings: any = null;
  try {
    const rawSettings = localStorage.getItem(`app_email_settings_${senderEmail.toLowerCase()}`);
    if (rawSettings) {
      savedSettings = JSON.parse(rawSettings);
    } else {
      // Fallback to common key
      const fallbackSettings = localStorage.getItem("app_email_settings_common");
      if (fallbackSettings) savedSettings = JSON.parse(fallbackSettings);
    }
  } catch (e) {
    console.warn("Could not read local email settings:", e);
  }

  const recipientNames: string[] = [];
  let emailDispatchedCount = 0;
  let lastErrorMessage = "";

  // 3. Automatic Email Dispatch to each mentioned recipient
  for (const targetStaff of mentionedStaffs) {
    if (!targetStaff.email) continue;
    recipientNames.push(targetStaff.name || targetStaff.email);

    const titleStr = quote ? quote.title : "見積案件";
    const vesselStr = quote ? quote.vesselName : "不明";
    const airportStr = quote?.airportCodes?.join(", ") || "未設定";
    const weightStr = quote?.grossWeight || "未記載";

    const subject = `[メンション通知] 案件: ${titleStr} (本船: ${vesselStr})`;
    const bodyText = `${targetStaff.name || "担当者"} 様

お疲れ様です。${senderName}です。
ACE船用品輸出見積管理システムにて、あなた宛てのメンション/メッセージが投稿されました。

--------------------------------------------------
■ 案件名: ${titleStr}
■ 本船名: ${vesselStr}
■ 向け地(IATA): ${airportStr}
■ 概算重量: ${weightStr}
■ 投稿者: ${senderName} (${senderEmail})
--------------------------------------------------

【投稿コメント本文】
${msgText || "最新の見積更新・返信が届いています。内容をご確認ください。"}

▼ 以下のリンクよりシステムを起動して直接スレッドを確認・返信できます:
${appUrl}

よろしくお願いいたします。
--------------------------------------------------
送信元: ACE船用品輸出見積管理システム
`;

    try {
      const resp = await fetch("/api/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: targetStaff.email,
          subject,
          bodyText,
          fromName: senderName,
          quoteId: quote?.id,
          settings: savedSettings,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        lastErrorMessage = `HTTP ${resp.status}`;
        console.warn(`[Mention Auto Email Warning] HTTP ${resp.status} sending to ${targetStaff.email}:`, errText.slice(0, 150));
      } else {
        const resData = await resp.json();
        if (resData.success) {
          emailDispatchedCount++;
          console.log(`[Mention Auto Email] Background email sent to ${targetStaff.email}:`, resData);
        } else {
          lastErrorMessage = resData.message || resData.error || "SMTPパスワード未設定";
          console.warn(`[Mention Auto Email] Server returned warning:`, resData);
        }
      }
    } catch (err: any) {
      lastErrorMessage = err?.message || "通信エラー";
      console.error(`[Mention Auto Email Error] Failed sending to ${targetStaff.email}:`, err);
    }
  }

  // 4. Notify sender via Window Toast Popup
  if (senderEmail === currentUser.email && recipientNames.length > 0) {
    notifyMentionSent(
      recipientNames,
      emailDispatchedCount > 0,
      emailDispatchedCount > 0 ? undefined : lastErrorMessage
    );
  }
}


