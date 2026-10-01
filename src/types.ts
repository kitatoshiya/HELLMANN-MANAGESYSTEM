export type QuoteStatus =
  | "requested"
  | "estimated"
  | "re_estimating"
  | "accepted"
  | "closed_or_on_hold";

export type AppTheme = "light" | "dark" | "cute" | "digital";
export type ActiveView =
  | "kanban"
  | "sticky_board"
  | "history_search"
  | "arrangement_progress"
  | "stock_extractor"
  | "shared_mail"
  | "firestore_monitor";

export interface SharedMailRecipient {
  name?: string;
  address: string;
}

export interface SharedMailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline?: boolean;
}

export interface SharedMailMessage {
  id: string;
  conversationId?: string;
  subject: string;
  bodyPreview: string;
  bodyHtml?: string;
  bodyText?: string;
  from?: SharedMailRecipient;
  toRecipients: SharedMailRecipient[];
  ccRecipients: SharedMailRecipient[];
  receivedDateTime: string;
  sentDateTime?: string;
  hasAttachments: boolean;
  attachments?: SharedMailAttachment[];
  isRead: boolean;
  importance?: "low" | "normal" | "high";
  isDemo?: boolean;
}

export interface SharedMailboxStatus {
  configured: boolean;
  sharedMailbox?: string;
  tenantIdConfigured: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  connected?: boolean;
  isSecretIdError?: boolean;
  error?: string;
  tokenRoles?: string[];
  hasMailRead?: boolean;
  hasMailSend?: boolean;
  needsApiPermissions?: boolean;
}

export interface SendSharedMailPayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  replyToMessageId?: string;
  mailbox?: string;
  attachments?: ComposeAttachment[];
}

export interface ComposeAttachment {
  id: string;
  name: string;
  size: number;
  contentType: string;
  contentBytes: string; // pure Base64 string without data: URL prefix
}

export interface ArrangementTaskItem {
  id: number; // 1 to 7
  key: string;
  label: string; // e.g. "受託・手配開始"
  subLabel: string; // e.g. "Booking確定"
  shortName: string; // e.g. "Booking確定"
}

export const ARRANGEMENT_TASKS: ArrangementTaskItem[] = [
  { id: 1, key: "booking", label: "受託・手配開始", subLabel: "Booking確定", shortName: "Booking確定" },
  { id: 2, key: "invoice", label: "書類作成＆事前確認", subLabel: "輸出用インボイス・Packing List作成＆シッパー事前確認", shortName: "書類作成＆事前確認" },
  { id: 3, key: "warehouse", label: "倉庫へ依頼", subLabel: "業連・爆発物検査・搬入伝票FAX", shortName: "倉庫FAX" },
  { id: 4, key: "customs", label: "通関手配", subLabel: "通関依頼", shortName: "通関依頼" },
  { id: 5, key: "awb", label: "AWB発行", subLabel: "発行、KIXへ送る", shortName: "AWB発行" },
  { id: 6, key: "ccsj", label: "CCSJ", subLabel: "データ送信", shortName: "CCSJ送信" },
  { id: 7, key: "stock", label: "ストックリスト更新", subLabel: "在庫更新", shortName: "在庫更新" },
];

export interface ArrangementTaskStatus {
  completed: boolean;
  completedAt?: string;
  completedBy?: string;
  note?: string;
}

export interface QuickMemo {
  text: string;
  updatedAt: string; // ISO string
  updatedBy: string; // email of the user who last updated this memo
  updatedByName?: string; // name of the user who last updated this memo
}

export type WeightBreak =
  | "MIN"
  | "-45kg"
  | "+45kg"
  | "+100kg"
  | "+300kg"
  | "+500kg"
  | "+1000kg";

export const WEIGHT_BREAK_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "未選択" },
  { value: "MIN", label: "MIN" },
  { value: "-45kg", label: "-45kg" },
  { value: "+45kg", label: "+45kg" },
  { value: "+100kg", label: "+100kg" },
  { value: "+300kg", label: "+300kg" },
  { value: "+500kg", label: "+500kg" },
  { value: "+1000kg", label: "+1000kg" },
];



export type StickyNoteColor = "yellow" | "blue" | "green" | "pink" | "purple" | "slate";

export interface StickyNoteLink {
  id: string;
  title: string;
  url: string;
}

export interface StickyNote {
  id: string;
  title: string;
  content: string;
  color: StickyNoteColor;
  x: number;
  y: number;
  width?: number;
  height?: number;
  links?: StickyNoteLink[];
  imageUrl?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  zIndex?: number;
}

export interface StatusColumnConfig {
  id: QuoteStatus;
  title: string;
  badgeBg: string;
  badgeText: string;
  description: string;
}

export interface ExternalLink {
  id?: string;
  title: string;
  url: string;
}

export interface StaffMember {
  id: string;
  name: string; // 担当者名（必須）
  email: string; // ログインメールアドレス（必須）
  employeeNumber?: string; // 社員番号（任意）
}

export interface QuoteMessage {
  id: string;
  quoteId: string;
  authorEmail: string;
  authorName?: string;
  createdAt: string; // ISO string
  contentHtml: string;
  isSystemLog?: boolean;
  externalLinks?: ExternalLink[];
}

export interface AppBackground {
  type: "image" | "color" | "default";
  value: string;
}

export interface NotificationPreferences {
  desktopEnabled: boolean;
  emailEnabled: boolean;
  notifyOnStatusChanges: {
    requested: boolean; // 1. ”見積依頼”にタスクが追加された
    estimated: boolean; // 2. ”見積済み”にタスクが追加された
    re_estimating: boolean; // 3. ”見積連絡済”にタスクが追加された
    accepted: boolean; // 4. ”受託”にタスクが追加された
    closed_or_on_hold: boolean; // 5. ”失注・保留”にタスクが追加された
    archived: boolean; // 6. タスクがアーカイブされた
  };
  statusChangeScope: "all" | "mentioned_only"; // 対象範囲：「すべてのタスク」または「メンションで自分が指定されたタスクのみ」
  notifyOnMentions: boolean;
  notifyOnAssignedTasks: boolean;
  notifyOnUrgent: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  desktopEnabled: true,
  emailEnabled: true,
  notifyOnStatusChanges: {
    requested: true,
    estimated: true,
    re_estimating: true,
    accepted: true,
    closed_or_on_hold: true,
    archived: true,
  },
  statusChangeScope: "all",
  notifyOnMentions: true,
  notifyOnAssignedTasks: true,
  notifyOnUrgent: true,
};

export function normalizeNotificationPreferences(raw?: Partial<NotificationPreferences>): NotificationPreferences {
  if (!raw) return DEFAULT_NOTIFICATION_PREFERENCES;
  const statusChanges = (raw.notifyOnStatusChanges || {}) as Record<string, boolean | undefined>;
  return {
    desktopEnabled: raw.desktopEnabled ?? true,
    emailEnabled: raw.emailEnabled ?? true,
    notifyOnStatusChanges: {
      requested: statusChanges.requested ?? statusChanges.received ?? true,
      estimated: statusChanges.estimated ?? statusChanges.pricing ?? true,
      re_estimating: statusChanges.re_estimating ?? statusChanges.sent ?? true,
      accepted: statusChanges.accepted ?? true,
      closed_or_on_hold: statusChanges.closed_or_on_hold ?? statusChanges.declined ?? statusChanges.completed ?? true,
      archived: statusChanges.archived ?? true,
    },
    statusChangeScope: raw.statusChangeScope === "mentioned_only" ? "mentioned_only" : "all",
    notifyOnMentions: raw.notifyOnMentions ?? true,
    notifyOnAssignedTasks: raw.notifyOnAssignedTasks ?? true,
    notifyOnUrgent: raw.notifyOnUrgent ?? true,
  };
}

export interface QuotationItem {
  id: string;
  title: string;
  vesselName: string;
  airportCodes: string[]; // 3-letter IATA codes
  weightBreak?: WeightBreak | string; // 重量帯 (MIN, -45kg, +45kg, +100kg, +300kg, +500kg, +1000kg)
  grossWeight?: string; // Legacy/fallback
  customsClearanceDate?: string; // 通関日 (YYYY-MM-DD or date string, 任意)
  isUrgent: boolean;
  status: QuoteStatus;
  createdBy: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  updatedBy?: string; // メールアドレス/ユーザー識別子
  lastRepliedAt: string; // ISO string
  readBy: string[]; // List of user emails who have read the latest update
  externalLinks?: ExternalLink[];
  assignedStaffId?: string; // 担当者ID (任意)
  isArchived?: boolean; // アーカイブフラグ
  archivedAt?: string; // アーカイブ日時 (ISO string)

  // 受託案件 手配進捗管理フィールド
  shipperName?: string; // 荷主名 (e.g., "GHI Inc", "XYZ Trading")
  etdDate?: string; // ETD 出発日 (YYYY-MM-DD or MM/DD)
  etaDate?: string; // ETA 到着予定日 (YYYY-MM-DD or MM/DD)
  flightOrVesselCode?: string; // 便名・船番 (e.g., "SQ619", "KE552")
  arrangementTasks?: Record<number, ArrangementTaskStatus>; // 7つのタスク進行状況 (1..7)
  arrangementMemo?: string; // 手配特記事項・社内メモ (互換用)
  arrangementUrgency?: "normal" | "risk" | "urgent" | "smooth" | "in_progress" | "arranging" | "completed"; // 手配状態手動指定
  isArrangementCompleted?: boolean; // 全手配完了フラグ

  // 簡易メモ (1案件に1つのみ、チーム全員が変更・削除可能)
  quickMemo?: QuickMemo;
}

export function getQuickMemo(quote: QuotationItem): QuickMemo | null {
  if (quote.quickMemo && quote.quickMemo.text && quote.quickMemo.text.trim()) {
    return quote.quickMemo;
  }
  if (quote.arrangementMemo && quote.arrangementMemo.trim()) {
    return {
      text: quote.arrangementMemo.trim(),
      updatedAt: quote.updatedAt || quote.createdAt,
      updatedBy: quote.updatedBy || quote.createdBy,
      updatedByName: quote.updatedBy?.split("@")[0] || quote.createdBy?.split("@")[0] || "担当",
    };
  }
  return null;
}

export function formatMemoTimestamp(isoString?: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    const m = (d.getMonth() + 1).toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    const h = d.getHours().toString().padStart(2, "0");
    const min = d.getMinutes().toString().padStart(2, "0");
    return `${m}/${day} ${h}:${min}`;
  } catch {
    return "";
  }
}

export interface FilterOptions {
  searchQuery: string;
  airportCode: string;
  urgentOnly: boolean;
  statusFilter: string; // "all" or specific QuoteStatus
  assignedStaffId: string; // "ALL", "UNASSIGNED", or specific staff member ID
}

export interface BackupData {
  version: string;
  exportedAt: string;
  quotations: QuotationItem[];
  messages: QuoteMessage[];
  staffMembers?: StaffMember[];
}

export interface UserProfile {
  email: string;
  name: string;
  employeeNumber?: string;
}



export interface ChatMessage {
  id: string;
  authorEmail: string;
  authorName: string;
  content: string;
  createdAt: string; // ISO date string
  mentions?: string[]; // List of mentioned emails or staff names
  readBy: string[]; // List of user emails who have read this message
}

export interface ChatWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
}

export interface ChatTypingStatus {
  email: string;
  name: string;
  lastTypedAt: number; // timestamp in milliseconds
}

export function formatCustomsDate(dateStr?: string): string | null {
  if (!dateStr || !dateStr.trim()) return null;
  const str = dateStr.trim();
  if (str === "未設定" || str === "未記載") return null;

  const match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    return `${month}月${day}日`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${m}月${day}日`;
  }

  return str;
}

export function parseCustomsDateToTime(dateStr?: string): number {
  if (!dateStr || !dateStr.trim()) return Infinity;
  const str = dateStr.trim();
  if (str === "未設定" || str === "未記載") return Infinity;

  const match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    return new Date(year, month, day).getTime();
  }

  const shortMatch = str.match(/^(\d{1,2})[-/](\d{1,2})/);
  if (shortMatch) {
    const month = parseInt(shortMatch[1], 10) - 1;
    const day = parseInt(shortMatch[2], 10);
    const year = new Date().getFullYear();
    return new Date(year, month, day).getTime();
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.getTime();
  }

  return Infinity;
}

export function isQuoteAssignedToUser(
  quote: QuotationItem,
  currentUser: UserProfile,
  staffMembers: StaffMember[] = []
): boolean {
  const assignedStaff = staffMembers.find((s) => s.id === quote.assignedStaffId);
  const currentStaffMember = staffMembers.find(
    (s) =>
      (s.email && s.email.toLowerCase() === currentUser.email.toLowerCase()) ||
      (s.name && s.name === currentUser.name)
  );

  return Boolean(
    (assignedStaff &&
      ((assignedStaff.email && assignedStaff.email.toLowerCase() === currentUser.email.toLowerCase()) ||
        assignedStaff.name === currentUser.name)) ||
    (currentStaffMember && quote.assignedStaffId === currentStaffMember.id) ||
    (!quote.assignedStaffId && quote.createdBy && quote.createdBy.toLowerCase() === currentUser.email.toLowerCase())
  );
}

// ==========================================
// サプライヤーマスタ & 問合せテンプレート定義
// ==========================================

export interface SupplierContact {
  id: string;
  name: string; // 担当者名 (例: 山田 太郎 様)
  email: string; // メールアドレス (例: yamada@supplier.co.jp)
  phone?: string; // 電話番号・内線
  department?: string; // 部署・役職 (例: 営業部 舶用チーム)
  isPrimary?: boolean; // 主担当フラグ
}

export interface Supplier {
  id: string;
  name: string; // サプライヤー社名 (必須)
  code?: string; // サプライヤー略称/コード (例: YANMAR, MHI, DAIHATSU)
  contacts: SupplierContact[]; // 最大5名までの担当者一覧
  defaultCcEmails?: string[]; // デフォルトCCアドレス (カンマ区切りまたは配列)
  defaultPattern?: number; // デフォルト問い合わせパターン (1: 見積, 2: 通関, 3: 出荷確定)
  defaultLanguage?: "ja" | "en"; // デフォルト言語
  notes?: string; // 特記事項・定休日・問合せ時の注意メモ
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInquiryTemplate {
  id: string;
  patternNumber: number; // 1: 見積・納期問合せ, 2: 通関・技術問合せ, 3: 出荷確定連絡, 4~: カスタム
  category: "quote" | "customs" | "shipment" | "custom";
  title: string; // テンプレート名称
  description: string; // 用途・対象
  subjectTemplate: string; // 件名ひな型
  bodyHtmlTemplate: string; // 本文HTMLひな型
  isDefault?: boolean;
  updatedAt: string;
}

// 初期デフォルトひな型 3パターン
export const DEFAULT_SUPPLIER_TEMPLATES: SupplierInquiryTemplate[] = [
  {
    id: "tpl_pattern_1_quote",
    patternNumber: 1,
    category: "quote",
    title: "① 見積・納期問合せ（海外代理店依頼時）",
    description: "海外顧客・代理店からの見積依頼に基づき、サプライヤーへ価格と納期を確認するひな型です。",
    subjectTemplate: "【見積依頼】本船: {vesselName} / オーダーNo: {orderNo}",
    bodyHtmlTemplate: `
<p>{supplierName}<br><strong>{contactName} 様</strong></p>
<p><br></p>
<p>いつも大変お世話になっております。<br>株式会社タクト・ジャパン シップスチームでございます。</p>
<p><br></p>
<p>下記の本船向けオーダーにつきまして、出荷見積および納期のご確認をお願い申し上げます。</p>
<p><br></p>
<table style="border-collapse: collapse; width: 100%; border: 1px solid #cbd5e1; margin: 10px 0; font-size: 13px;">
  <tbody>
    <tr style="background-color: #f8fafc;">
      <th style="border: 1px solid #cbd5e1; padding: 7px 12px; width: 28%; text-align: left; color: #334155;">本船名 (Vessel)</th>
      <td style="border: 1px solid #cbd5e1; padding: 7px 12px; font-weight: bold; color: #0f172a;">{vesselName}</td>
    </tr>
    <tr>
      <th style="border: 1px solid #cbd5e1; padding: 7px 12px; text-align: left; color: #334155;">オーダーNo (Order No)</th>
      <td style="border: 1px solid #cbd5e1; padding: 7px 12px; font-weight: bold; color: #0f172a;">{orderNo}</td>
    </tr>
    <tr style="background-color: #f8fafc;">
      <th style="border: 1px solid #cbd5e1; padding: 7px 12px; text-align: left; color: #334155;">希望納期 (Target Date)</th>
      <td style="border: 1px solid #cbd5e1; padding: 7px 12px; color: #0f172a;">{deliveryDate}</td>
    </tr>
    <tr>
      <th style="border: 1px solid #cbd5e1; padding: 7px 12px; text-align: left; color: #334155;">納入場所 / 向け地</th>
      <td style="border: 1px solid #cbd5e1; padding: 7px 12px; color: #2563eb; font-weight: bold;">{destination}</td>
    </tr>
  </tbody>
</table>
<p><br></p>
<div style="background-color: #f1f5f9; padding: 12px 16px; border-radius: 8px; border-left: 4px solid #3b82f6; margin: 12px 0;">
  <div style="font-weight: bold; color: #1e293b; margin-bottom: 6px;">【対象品目・数量・図番 / お問い合わせ内容】</div>
  <p style="color: #64748b; font-size: 12px; margin: 0 0 8px 0;">※下記に品名・パーツNo・図番・数量、または顧客からの依頼テキストを貼り付けてください：</p>
  <div style="border: 1px dashed #94a3b8; background-color: #ffffff; padding: 10px; border-radius: 4px; min-height: 60px; color: #0f172a;">
    {inquiryDetails}
  </div>
</div>
<p><br></p>
<p>ご多忙中お手数をお掛けいたしますが、お見積書および納期のご回答を賜りますよう何卒よろしくお願い申し上げます。</p>
    `.trim(),
    isDefault: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "tpl_pattern_2_customs",
    patternNumber: 2,
    category: "customs",
    title: "② 通関・技術問合せ（通関士質疑時）",
    description: "通関士や乙仲からの質疑（HSコード・該非判定・材質仕様等）をサプライヤーへ確認するひな型です。",
    subjectTemplate: "【通関確認依頼】本船: {vesselName} / オーダーNo: {orderNo}",
    bodyHtmlTemplate: `
<p>{supplierName}<br><strong>{contactName} 様</strong></p>
<p><br></p>
<p>いつも大変お世話になっております。<br>株式会社タクト・ジャパン シップスチームでございます。</p>
<p><br></p>
<p>本船「<strong>{vesselName}</strong>」（Order No: <strong>{orderNo}</strong>）の輸出通関手続きにあたり、通関士より下記の確認事項が発生いたしました。<br>お忙しいところ誠に恐縮ですが、ご教示いただけますようお願い申し上げます。</p>
<p><br></p>
<div style="background-color: #fef3c7; padding: 12px 16px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 12px 0;">
  <div style="font-weight: bold; color: #92400e; margin-bottom: 6px;">【通関士・乙仲からの質問事項 / 技術確認内容】</div>
  <p style="color: #78350f; font-size: 12px; margin: 0 0 8px 0;">※下記に通関士からの質問内容（HSコード、該非判定、材質・成分、用途等）を貼り付けてください：</p>
  <div style="border: 1px dashed #d97706; background-color: #ffffff; padding: 10px; border-radius: 4px; min-height: 60px; color: #0f172a;">
    {inquiryDetails}
  </div>
</div>
<p><br></p>
<table style="border-collapse: collapse; width: 100%; border: 1px solid #cbd5e1; margin: 10px 0; font-size: 13px;">
  <tbody>
    <tr style="background-color: #f8fafc;">
      <th style="border: 1px solid #cbd5e1; padding: 7px 12px; width: 28%; text-align: left; color: #334155;">通関予定日</th>
      <td style="border: 1px solid #cbd5e1; padding: 7px 12px; font-weight: bold; color: #dc2626;">{customsDate}</td>
    </tr>
    <tr>
      <th style="border: 1px solid #cbd5e1; padding: 7px 12px; text-align: left; color: #334155;">回答希望期限</th>
      <td style="border: 1px solid #cbd5e1; padding: 7px 12px; font-weight: bold; color: #dc2626;">至急（通関申告手配のため）</td>
    </tr>
  </tbody>
</table>
<p><br></p>
<p>通関申告に影響がございますため、ご確認のほど何卒よろしくお願い申し上げます。</p>
    `.trim(),
    isDefault: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "tpl_pattern_3_shipment",
    patternNumber: 3,
    category: "shipment",
    title: "③ 出荷確定連絡（向け地・通関予定日・船籍FLAG）",
    description: "出荷が確定した際に、輸出インボイス情報を元に向け地・通関予定日・船籍情報をサプライヤーへ連絡するひな型です。",
    subjectTemplate: "【出荷案内】本船: {vesselName} / オーダーNo: {orderNo} / 出荷確定連絡",
    bodyHtmlTemplate: `
<p>{supplierName}<br><strong>{contactName} 様</strong></p>
<p><br></p>
<p>いつも大変お世話になっております。<br>株式会社タクト・ジャパン シップスチームでございます。</p>
<p><br></p>
<p>標記オーダーにつきまして、出荷および通関日程が確定いたしましたので、輸出用インボイス情報を元に下記のとおりご連絡申し上げます。</p>
<p><br></p>
<table style="border-collapse: collapse; width: 100%; border: 1px solid #cbd5e1; margin: 12px 0; font-size: 13px;">
  <tbody>
    <tr style="background-color: #f8fafc;">
      <th style="border: 1px solid #cbd5e1; padding: 8px 12px; width: 30%; text-align: left; color: #334155;">本船名 (Vessel Name)</th>
      <td style="border: 1px solid #cbd5e1; padding: 8px 12px; font-weight: bold; color: #0f172a;">{vesselName}</td>
    </tr>
    <tr>
      <th style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; color: #334155;">オーダーNo (Order No)</th>
      <td style="border: 1px solid #cbd5e1; padding: 8px 12px; font-weight: bold; color: #0f172a;">{orderNo}</td>
    </tr>
    <tr style="background-color: #f8fafc;">
      <th style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; color: #334155;">インボイスNo (Invoice No)</th>
      <td style="border: 1px solid #cbd5e1; padding: 8px 12px; font-weight: bold; color: #0f172a;">{invoiceNo}</td>
    </tr>
    <tr>
      <th style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; color: #334155;">向け地 (Destination)</th>
      <td style="border: 1px solid #cbd5e1; padding: 8px 12px; font-weight: bold; color: #2563eb;">{destination}</td>
    </tr>
    <tr style="background-color: #f8fafc;">
      <th style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; color: #334155;">通関予定日 (Customs Date)</th>
      <td style="border: 1px solid #cbd5e1; padding: 8px 12px; font-weight: bold; color: #d97706;">{customsDate}</td>
    </tr>
    <tr>
      <th style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; color: #334155;">船籍 (FLAG)</th>
      <td style="border: 1px solid #cbd5e1; padding: 8px 12px; font-weight: bold; color: #059669;">{flag}</td>
    </tr>
  </tbody>
</table>
<p><br></p>
<div style="background-color: #f1f5f9; padding: 12px 16px; border-radius: 8px; border-left: 4px solid #10b981; margin: 12px 0;">
  <div style="font-weight: bold; color: #1e293b; margin-bottom: 6px;">【出荷詳細・特記事項】</div>
  <p style="color: #64748b; font-size: 12px; margin: 0 0 8px 0;">※シッピングマーク、搬入先、配送便の特記事項等があればご入力ください：</p>
  <div style="border: 1px dashed #94a3b8; background-color: #ffffff; padding: 10px; border-radius: 4px; min-height: 40px; color: #0f172a;">
    {inquiryDetails}
  </div>
</div>
<p><br></p>
<p>ご確認のほどよろしくお願い申し上げます。<br>引き続きよろしくお願いいたします。</p>
    `.trim(),
    isDefault: true,
    updatedAt: new Date().toISOString(),
  },
];

// 初期サプライヤーマスタサンプルデータ
export const INITIAL_DEFAULT_SUPPLIERS: Supplier[] = [
  {
    id: "sup_yanmar",
    name: "ヤンマーエンジニアリング株式会社",
    code: "YANMAR",
    contacts: [
      { id: "c1", name: "田中 健一", email: "tanaka.k@yanmar-sample.co.jp", phone: "06-6376-6000", department: "舶用営業部", isPrimary: true },
      { id: "c2", name: "佐藤 誠", email: "sato.m@yanmar-sample.co.jp", phone: "06-6376-6001", department: "部品手配課", isPrimary: false },
      { id: "c3", name: "海外営業窓口", email: "marine-overseas@yanmar-sample.co.jp", department: "グローバル推進部", isPrimary: false },
    ],
    defaultCcEmails: ["marine-desk@tac-japan.co.jp"],
    defaultPattern: 1,
    defaultLanguage: "ja",
    notes: "主機・発電機部品。通常リードタイム2〜3営業日。緊急時は電話連絡併用。",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "sup_mhi",
    name: "三菱重工マリンマシナリ株式会社",
    code: "MHI-M",
    contacts: [
      { id: "c1", name: "鈴木 一郎", email: "suzuki_i@mhi-marine-sample.co.jp", phone: "03-6716-3111", department: "アフターセールス部", isPrimary: true },
      { id: "c2", name: "高橋 裕子", email: "takahashi_y@mhi-marine-sample.co.jp", phone: "03-6716-3112", department: "技術サービス課", isPrimary: false },
    ],
    defaultCcEmails: [],
    defaultPattern: 1,
    defaultLanguage: "ja",
    notes: "過給機（MET）・ボイラー部品。通関用該非判定書の発行依頼に対応。",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "sup_daihatsu",
    name: "ダイハツディーゼル株式会社",
    code: "DAIHATSU",
    contacts: [
      { id: "c1", name: "伊藤 健二", email: "ito.k@daihatsu-diesel-sample.co.jp", phone: "06-6454-2331", department: "舶用部品課", isPrimary: true },
      { id: "c2", name: "渡辺 剛", email: "watanabe.t@daihatsu-diesel-sample.co.jp", department: "パーツフロント", isPrimary: false },
    ],
    defaultCcEmails: [],
    defaultPattern: 3,
    defaultLanguage: "ja",
    notes: "ディーゼル発電機関パーツ。出荷連絡時にインボイスNo必須。",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

