import {
  HellmannNewOrderEmail,
  BrokerIncomingEmail,
  M365Settings,
  CustomsQaItem,
  EmailAttachment,
  Shipment,
  UnifiedMailItem,
  MailDecisionStatus,
} from '../types';
import { getShipments, updateShipment, getEmailLogs, addCustomsEmailLog } from './storageManager';
import { normalizeMawbNumber, cleanHawbNumber } from './awbUtils';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { sanitizeEmailHtml } from './htmlSanitizer';
import jsPDF from 'jspdf';
import {
  saveBatchEmailPayloadsToIndexedDB,
  saveEmailPayloadToIndexedDB,
  getEmailPayload,
  getEmailPayloadSync,
  getAttachmentDataUrl,
} from './emailPayloadStorageService';

export {
  saveBatchEmailPayloadsToIndexedDB,
  saveEmailPayloadToIndexedDB,
  getEmailPayload,
  getEmailPayloadSync,
  getAttachmentDataUrl,
};

const M365_SETTINGS_KEY = 'export_mgmt_m365_settings';
const HELLMANN_ORDERS_KEY = 'export_mgmt_hellmann_new_orders';
const BROKER_INCOMING_EMAILS_KEY = 'export_mgmt_broker_incoming_emails_v1';
const GRAPH_INBOX_MAILS_KEY = 'export_mgmt_graph_inbox_mails_v1';
const GRAPH_SENT_MAILS_KEY = 'export_mgmt_graph_sent_mails_v1';
const SYSTEM_SETTINGS_COLLECTION = 'system_settings';
const M365_CONFIG_DOC = 'm365_config';

// Event listeners for reactive store updates
const listeners = new Set<() => void>();

export function isVercelEnvironment(): boolean {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || '';
    if (host.includes('vercel.app') || host.includes('vercel.')) {
      return true;
    }
  }
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.VERCEL === '1' || process.env.NEXT_PUBLIC_VERCEL_ENV !== undefined) {
      return true;
    }
  }
  return false;
}

export function subscribeM365Store(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notifyListeners() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.error('Error in M365 listener:', e);
    }
  });
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('m365-mail-updated'));
    } catch {
      // Ignore if CustomEvent not supported
    }
  }
}

/**
 * Strip heavy HTML and large attachment binary data from Hellmann orders before writing to localStorage.
 * Full content is safely preserved in IndexedDB.
 */
export function sanitizeHellmannOrdersForLocalStorage(orders: HellmannNewOrderEmail[]): HellmannNewOrderEmail[] {
  if (!Array.isArray(orders)) return [];

  // Asynchronously offload full bodies and attachments to IndexedDB
  const payloads = orders.map((o) => ({
    mailId: o.id,
    bodyHtml: o.bodyHtml,
    bodyText: o.bodyText,
    attachments: o.attachments,
  }));
  saveBatchEmailPayloadsToIndexedDB(payloads).catch((err) => {
    console.warn('[Storage] Error offloading orders to IndexedDB:', err);
  });

  // Limit to recent 35 items and strip heavy fields for localStorage
  return orders.slice(-35).map((o) => {
    const copy = { ...o };
    delete copy.bodyHtml;
    if (typeof copy.bodyText === 'string' && copy.bodyText.length > 800) {
      copy.bodyText = copy.bodyText.substring(0, 800) + '...';
    }
    if (Array.isArray(copy.attachments)) {
      copy.attachments = copy.attachments.map((att) => {
        if (!att) return att;
        const { dataUrl, ...rest } = att;
        return rest;
      });
    }
    return copy;
  });
}

/**
 * Strip heavy HTML and attachment binary data from UnifiedMailItem list before writing to localStorage.
 */
export function sanitizeUnifiedMailsForLocalStorage(mails: UnifiedMailItem[]): UnifiedMailItem[] {
  if (!Array.isArray(mails)) return [];

  const payloads = mails.map((m) => ({
    mailId: m.id,
    bodyHtml: m.bodyHtml,
    bodyText: m.body,
    attachments: m.attachments,
  }));
  saveBatchEmailPayloadsToIndexedDB(payloads).catch((err) => {
    console.warn('[Storage] Error offloading unified mails to IndexedDB:', err);
  });

  return mails.slice(0, 100).map((m) => {
    const copy = { ...m };
    delete copy.bodyHtml;
    if (typeof copy.body === 'string' && copy.body.length > 800) {
      copy.body = copy.body.substring(0, 800) + '...';
    }
    if (Array.isArray(copy.attachments)) {
      copy.attachments = copy.attachments.map((att) => {
        if (!att) return att;
        const { dataUrl, ...rest } = att;
        return rest;
      });
    }
    return copy;
  });
}

/**
 * Aggressively scans and vacuums localStorage to free up space (removing legacy large blobs,
 * PDF base64 entries, bloated logs, and truncating email body payloads).
 */
export function vacuumLocalStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    // 1. Remove obsolete metric & cache keys
    const obsoleteKeys = [
      'firestore_metrics_events',
      'firestore_read_metrics',
      'export_mgmt_customs_email_logs_v1',
      'pdf_cache_v1',
      'gemini_cache_v1',
      'm365_sync_debug_logs',
    ];
    obsoleteKeys.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });

    // 2. Remove all legacy PDF base64 keys from localStorage (PDFs belong in IndexedDB / Memory)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('pdf_store_') || k.startsWith('pdf_blob_') || k.startsWith('pdf_temp_'))) {
        try {
          localStorage.removeItem(k);
        } catch {}
      }
    }

    // 3. Compact large JSON arrays in localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      try {
        const val = localStorage.getItem(k);
        if (val && val.length > 25000) {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) {
            const compacted = parsed.slice(-20).map((item: any) => {
              if (item && typeof item === 'object') {
                const c = { ...item };
                delete c.bodyHtml;
                delete c.htmlBody;
                delete c.pdfDataUrl;
                delete c.originalPdfUrl;
                if (typeof c.bodyText === 'string' && c.bodyText.length > 200) {
                  c.bodyText = c.bodyText.substring(0, 200);
                }
                if (typeof c.body === 'string' && c.body.length > 200) {
                  c.body = c.body.substring(0, 200);
                }
                if (Array.isArray(c.attachments)) {
                  c.attachments = c.attachments.map((a: any) => {
                    const { dataUrl, contentBytes, ...rest } = a || {};
                    return rest;
                  });
                }
                return c;
              }
              return item;
            });
            localStorage.setItem(k, JSON.stringify(compacted));
          }
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[Storage] Vacuum warning:', err);
  }
}

/**
 * Safely sets an item in localStorage, handling QuotaExceededError automatically
 * by pruning legacy caches, stripping huge attachments/bodies, and vacuuming obsolete items.
 */
export function safeLocalStorageSetItem(key: string, value: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;

  const trySet = (val: string): boolean => {
    try {
      localStorage.setItem(key, val);
      return true;
    } catch {
      return false;
    }
  };

  // 1. Direct attempt
  if (trySet(value)) return true;

  // 2. If it failed due to Quota, perform aggressive cleanup & vacuum
  console.warn(`[localStorage] Quota reached while setting '${key}'. Executing automated storage vacuum...`);
  vacuumLocalStorage();

  // Try again with the original value
  if (trySet(value)) return true;

  // 3. If still failing, aggressively trim the target value itself if it's an array
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const cleanItem = (item: any) => {
        if (item && typeof item === 'object') {
          const copy = { ...item };
          delete copy.bodyHtml;
          delete copy.htmlBody;
          delete copy.htmlContent;
          delete copy.rawHtml;
          delete copy.pdfDataUrl;
          delete copy.originalPdfUrl;
          delete copy.pdfBase64;
          delete copy.rawPayload;
          delete copy.payload;
          delete copy.attachmentData;
          if (typeof copy.bodyText === 'string') copy.bodyText = copy.bodyText.substring(0, 150);
          if (typeof copy.body === 'string') copy.body = copy.body.substring(0, 150);
          if (typeof copy.details === 'string') copy.details = copy.details.substring(0, 150);
          if (Array.isArray(copy.attachments)) {
            copy.attachments = copy.attachments.map((att: any) => {
              if (att && typeof att === 'object') {
                const { dataUrl, content, contentBytes, ...rest } = att;
                return rest;
              }
              return att;
            });
          }
          return copy;
        }
        return item;
      };

      for (const count of [20, 10, 5, 2]) {
        const trimmed = parsed.slice(-count).map(cleanItem);
        if (trySet(JSON.stringify(trimmed))) {
          console.log(`[localStorage] Successfully saved aggressively trimmed array (${count} items) for '${key}'.`);
          return true;
        }
      }
    }
  } catch (_) {}

  return false;
}

/**
 * Safely parses any date input (ISO, Japanese format "YYYY/MM/DD HH:mm:ss", timestamp, etc.)
 * Returns a valid Date object or null if invalid.
 */
export function parseDateString(dateStr?: string | number | Date | null): Date | null {
  if (!dateStr) return null;
  if (dateStr instanceof Date) {
    return isNaN(dateStr.getTime()) ? null : dateStr;
  }
  if (typeof dateStr === 'number') {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }
  const str = String(dateStr).trim();
  if (!str || str === 'Invalid Date' || str.includes('NaN')) return null;

  let d = new Date(str);
  if (!isNaN(d.getTime())) return d;

  // Try replacing slashes and spaces for standard ISO parsing
  const normalized = str.replace(/\//g, '-').replace(' ', 'T');
  d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;

  return null;
}

/**
 * Default M365 Integration Settings
 */
export const DEFAULT_M365_SETTINGS: M365Settings = {
  enabled: true,
  tenantId: '',
  clientId: '',
  clientSecret: '',
  groupEmail: 'hellmann-air-ops@yourcompany.com',
  brokerDefaultEmail: 'customs-brokerage@yourcompany.com',
  brokerDefaultName: '白名',
  autoSyncIntervalMinutes: 5,
  inboxSyncIntervalSeconds: 120, // デフォルト: 2分 (120秒)
  sentSyncIntervalSeconds: 300, // デフォルト: 5分 (300秒)
  syncRetentionDays: 7, // デフォルト: 直近7日間 (0 = 全期間)
  isDemoMode: false,
};

let cachedM365Settings: M365Settings | null = null;

export function getM365Settings(): M365Settings {
  if (cachedM365Settings) return cachedM365Settings;
  if (typeof window === 'undefined') return DEFAULT_M365_SETTINGS;
  const raw = localStorage.getItem(M365_SETTINGS_KEY);
  if (!raw) {
    cachedM365Settings = DEFAULT_M365_SETTINGS;
    return DEFAULT_M365_SETTINGS;
  }
  try {
    cachedM365Settings = { ...DEFAULT_M365_SETTINGS, ...JSON.parse(raw) };
    return cachedM365Settings;
  } catch {
    cachedM365Settings = DEFAULT_M365_SETTINGS;
    return DEFAULT_M365_SETTINGS;
  }
}

/**
 * Save M365 Settings locally and automatically sync to Firestore cloud collection
 * so all PC terminals and team members are synchronized in real-time.
 */
export function saveM365Settings(settings: Partial<M365Settings>): M365Settings {
  const current = getM365Settings();
  const updated: M365Settings = { ...current, ...settings };
  cachedM365Settings = updated;
  if (typeof window !== 'undefined') {
    safeLocalStorageSetItem(M365_SETTINGS_KEY, JSON.stringify(updated));
  }

  // Cloud Firestore synchronization (Method 1: Shared System Settings)
  try {
    const docRef = doc(db, SYSTEM_SETTINGS_COLLECTION, M365_CONFIG_DOC);
    setDoc(docRef, { ...updated, updatedAt: new Date().toISOString() }, { merge: true }).catch((err) => {
      console.warn('[M365 Cloud Sync] Firestore setDoc error (will use local fallback):', err);
    });
  } catch (err) {
    console.warn('[M365 Cloud Sync] Cloud sync init error:', err);
  }

  notifyListeners();
  return updated;
}

/**
 * Format question text by handling HTML line breaks (&nbsp;, <br>, <p>) properly into plain text line breaks.
 * Also intelligently inserts line breaks for plain text formatted without \n.
 */
export function formatQuestionText(rawText?: string): string {
  if (!rawText) return '';
  
  // HTMLタグ・特殊文字の正規化およびHTMLエンティティの完全デコード
  let text = rawText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<div[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;gt;/gi, '>')
    .replace(/&amp;lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/g, '');

  // もしテキストに \n が含まれていない場合、または1行に固まっている場合
  // 句読点(。？?)や全角スペース(　)、文末キーワードでインテリジェントに改行を入れる
  const lineCount = (text.match(/\n/g) || []).length;
  if (lineCount < 2 && text.length > 15) {
    text = text
      .replace(/([。！!？?])\s*/g, '$1\n')
      .replace(/(お疲れ様です[。！!\s　]*)/gi, '$1\n\n')
      .replace(/(お世話になっております[。！!\s　]*)/gi, '$1\n\n')
      .replace(/(ご確認ください[。！!\s　]*)/gi, '$1\n')
      .replace(/(ご教示ください[。！!\s　]*)/gi, '$1\n')
      .replace(/(お送りいたします[。！!\s　]*)/gi, '$1\n')
      .replace(/(となりそうです[。！!\s　]*)/gi, '$1\n')
      .replace(/(申し訳ございません[。！!\s　]*)/gi, '$1\n')
      .replace(/(ご対応をお願いいたします[。！!\s　]*)/gi, '$1\n')
      .replace(/(ご連絡致?します[。！!\s　]*)/gi, '$1\n\n')
      .replace(/(よろしくお願いいたします[。！!\s　]*)/gi, '$1\n\n')
      .replace(/(お願いします[。！!\s　]*)/gi, '$1\n')
      .replace(/　+/g, '\n');

    text = text
      .split('\n')
      .map((s) => s.trim())
      .filter((s, idx, arr) => !(s === '' && arr[idx - 1] === ''))
      .join('\n');
  }

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n');
}

/**
 * Get user mail signature for a specific operator
 */
export function getUserSignature(operatorName?: string): string {
  const name = operatorName || '担当者';
  const key = `user_signature_${name}`;
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(key);
    if (saved !== null) return saved;
  }
  return `--\nTAC Japan 株式会社 通関オペレーションチーム\n担当: ${name}\nEmail: tac-hellmann@tac-japan.co.jp`;
}

/**
 * Save user mail signature for a specific operator
 */
export function saveUserSignature(signature: string, operatorName?: string): void {
  const name = operatorName || '担当者';
  const key = `user_signature_${name}`;
  if (typeof window !== 'undefined') {
    safeLocalStorageSetItem(key, signature);
  }
}

/**
 * Get aggregated Customs QA status badge information for header display
 */
export function getCustomsQaStatusBadgeInfo(qas?: CustomsQaItem[]): {
  label: string;
  badgeClass: string;
  statusType: 'NONE' | 'UNSENT' | 'PENDING' | 'ANSWERED' | 'RESOLVED';
} {
  if (!qas || qas.length === 0) {
    return {
      label: '現在保留中の質問なし',
      badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
      statusType: 'NONE',
    };
  }

  const hasAnswerNotReplied = qas.some((q) => q.status === 'HELLMANN_ANSWERED');
  const hasPendingInquiry = qas.some((q) => q.status === 'PENDING_HELLMANN');
  const hasUnsentInquiry = qas.some((q) => !q.status);
  const allResolved = qas.every((q) => q.status === 'RESOLVED_TO_BROKER');

  if (hasAnswerNotReplied) {
    return {
      label: 'ヘルマン回答あり (通関士未返信)',
      badgeClass: 'bg-blue-500/30 text-blue-200 border-blue-400/50 shadow-xs animate-pulse',
      statusType: 'ANSWERED',
    };
  }

  if (hasPendingInquiry) {
    return {
      label: 'ヘルマン照会中 (回答待ち)',
      badgeClass: 'bg-amber-500/30 text-amber-200 border-amber-400/50 shadow-xs',
      statusType: 'PENDING',
    };
  }

  if (hasUnsentInquiry) {
    return {
      label: 'ヘルマン未照会',
      badgeClass: 'bg-purple-500/30 text-purple-200 border-purple-400/50 shadow-xs',
      statusType: 'UNSENT',
    };
  }

  if (allResolved) {
    return {
      label: '現在保留中の質問なし (解決済み)',
      badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
      statusType: 'RESOLVED',
    };
  }

  return {
    label: '現在保留中の質問なし',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
    statusType: 'NONE',
  };
}

/**
 * Get quick dashboard badge for Customs QA status (ヘルマン照会中, 回答あり, 未照会)
 */
export function getCustomsQaDashboardBadge(qas?: CustomsQaItem[]): {
  showBadge: boolean;
  shortLabel: string;
  fullLabel: string;
  badgeClass: string;
  dotClass: string;
  statusType: 'PENDING' | 'ANSWERED' | 'UNSENT' | 'NONE';
  count: number;
} | null {
  if (!qas || qas.length === 0) return null;

  const activeQas = qas.filter((q) => q.status !== 'RESOLVED_TO_BROKER');
  if (activeQas.length === 0) return null;

  const answeredQas = qas.filter((q) => q.status === 'HELLMANN_ANSWERED');
  const pendingQas = qas.filter((q) => q.status === 'PENDING_HELLMANN');
  const unsentQas = qas.filter((q) => !q.status);

  if (answeredQas.length > 0) {
    return {
      showBadge: true,
      shortLabel: 'ヘルマン回答あり',
      fullLabel: `ヘルマン回答受領済み (通関士への返信待ち: ${answeredQas.length}件)`,
      badgeClass: 'bg-blue-600 hover:bg-blue-700 text-white border-blue-700 shadow-xs ring-1 ring-blue-300 font-extrabold animate-pulse',
      dotClass: 'bg-white',
      statusType: 'ANSWERED',
      count: answeredQas.length,
    };
  }

  if (pendingQas.length > 0) {
    return {
      showBadge: true,
      shortLabel: 'ヘルマン照会中',
      fullLabel: `ヘルマン照会中 (回答待ち: ${pendingQas.length}件)`,
      badgeClass: 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-xs ring-1 ring-amber-300 font-extrabold',
      dotClass: 'bg-amber-100',
      statusType: 'PENDING',
      count: pendingQas.length,
    };
  }

  if (unsentQas.length > 0) {
    return {
      showBadge: true,
      shortLabel: 'ヘルマン未照会',
      fullLabel: `通関士からの質疑あり (ヘルマン未照会: ${unsentQas.length}件)`,
      badgeClass: 'bg-purple-600 hover:bg-purple-700 text-white border-purple-700 shadow-xs ring-1 ring-purple-300 font-extrabold',
      dotClass: 'bg-purple-200',
      statusType: 'UNSENT',
      count: unsentQas.length,
    };
  }

  return null;
}

/**
 * Fetch M365 settings from Firestore cloud on startup
 */
export async function fetchM365SettingsFromCloud(): Promise<M365Settings> {
  try {
    const docRef = doc(db, SYSTEM_SETTINGS_COLLECTION, M365_CONFIG_DOC);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const cloudData = snap.data() as Partial<M365Settings>;
      const merged: M365Settings = {
        ...DEFAULT_M365_SETTINGS,
        ...getM365Settings(),
        ...cloudData,
      };
      cachedM365Settings = merged;
      safeLocalStorageSetItem(M365_SETTINGS_KEY, JSON.stringify(merged));
      notifyListeners();
      return merged;
    }
  } catch (err) {
    console.warn('[M365 Cloud Sync] fetchM365SettingsFromCloud fallback:', err);
  }
  return getM365Settings();
}

/**
 * Real-time subscription to cloud M365 settings updates across all team members
 */
export function initM365SettingsCloudSync(): () => void {
  try {
    const docRef = doc(db, SYSTEM_SETTINGS_COLLECTION, M365_CONFIG_DOC);
    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const cloudData = snap.data() as Partial<M365Settings>;
          const current = getM365Settings();
          const merged: M365Settings = {
            ...DEFAULT_M365_SETTINGS,
            ...current,
            ...cloudData,
          };
          // Only update if changed
          if (JSON.stringify(merged) !== JSON.stringify(current)) {
            cachedM365Settings = merged;
            safeLocalStorageSetItem(M365_SETTINGS_KEY, JSON.stringify(merged));
            notifyListeners();
          }
        }
      },
      (error) => {
        console.warn('[M365 Cloud Sync] Realtime onSnapshot warning:', error);
      }
    );
    return unsubscribe;
  } catch (err) {
    console.warn('[M365 Cloud Sync] initM365SettingsCloudSync error:', err);
    return () => {};
  }
}

/**
 * High-accuracy local regex logistics field extractor
 * Extracts core cargo fields directly from Japanese & English logistics email text/subjects
 * Consumes ZERO Gemini AI tokens (100% client-side local execution).
 */
export interface ExtractedLogisticsFromText {
  mawb?: string;
  hawb?: string;
  shipper?: string;
  consignee?: string;
  portOfLoading?: string;
  destination?: string;
  flightRoute?: string;
  pieces?: string;
  grossWeight?: string;
  cutTime?: string;
  invoiceNumber?: string;
  orderNumber?: string;
  confidence: number;
}

/**
 * Checks if a candidate number string is actually a Japanese phone/fax/mobile number
 */
export function isLikelyJapanesePhoneNumber(candidate: string): boolean {
  if (!candidate) return false;
  const trimmed = candidate.trim();

  // If formatted as standard IATA MAWB 3-digits hyphen 8-digits (e.g. "074-71650891", "205-88412900"),
  // this is a Master Air Waybill (MAWB), NOT a phone number.
  if (/^\d{3}-\d{8}$/.test(trimmed)) {
    // Only 090 and 070 with 3-8 are mobile prefixes
    if (/^(090|070)/.test(trimmed)) {
      return true;
    }
    return false;
  }

  const digits = trimmed.replace(/\D/g, '');

  // 1. Mobile & IP phone numbers: 090, 070, 050, 060 (11 digits e.g. 090-1234-5678, 070-1234-5678)
  if (/^(090|070|050|060)\d{8}$/.test(digits)) {
    return true;
  }

  // Toll-free / Navidial numbers (0120: 10 digits, 0800: 11 digits, 0570: 10 digits)
  if (/^(0120\d{6}|0800\d{7}|0570\d{6})$/.test(digits)) {
    return true;
  }

  // 2. Standard Japanese Landline Phone format (2-4-4, 3-3-4, 4-2-4, 5-1-4: exactly 10 digits with 2 hyphens/spaces)
  // e.g. 03-1234-5678, 06-1234-5678, 045-123-4567, 0742-12-3456, 0476-34-1234
  if (/^0\d{1,4}[-\s]\d{1,4}[-\s]\d{3,4}$/.test(trimmed)) {
    return true;
  }

  // 3. Mobile 080, 020: If 11 digits and formatted with 3-4-4 (e.g. 080-1234-5678 or 020-1234-5678)
  if (/^(080|020)[-\s]\d{4}[-\s]\d{4}$/.test(trimmed)) {
    return true;
  }

  // 4. 10-digit landline without hyphens starting with 0 (Japanese landlines are strictly 10 digits)
  // 11-digit numbers starting with 0 (like 074-71650891) are MAWB, not landline.
  if (/^0[1-9]\d{8}$/.test(digits)) {
    return true;
  }

  return false;
}

export function extractLogisticsInfoFromEmailText(bodyText: string, subjectText: string = ''): ExtractedLogisticsFromText {
  const combined = `${subjectText}\n${bodyText}`;
  const result: ExtractedLogisticsFromText = { confidence: 0 };
  let matchCount = 0;

  // 1. MAWB Number
  // A. Check subject line first (High confidence)
  const subjectMawbPrefix = subjectText.match(/(?:MAWB|M-AWB|M\/AWB|MBL|M-BL|AWB|A\.W\.B|AIR\s*WAYBILL|AIRWAYBILL|WAYBILL|BL\s*NO|B\/L\s*NO|BILL\s*OF\s*LADING|DOC\s*(?:NO|NUMBER)?|REF\s*(?:NO|NUMBER)?|SHIPMENT\s*(?:NO|NUMBER)?|TRACKING\s*(?:NO|NUMBER)?|送り状番号|荷受番号|運送状番号|申告番号|マスター番号|マスターAWB|マスター)[:\s#]*([0-9]{3}[-\s]?[0-9]{4}[-\s]?[0-9]{4}|[0-9]{3}[-\s]?[0-9]{7,8})/i);
  if (subjectMawbPrefix && !isLikelyJapanesePhoneNumber(subjectMawbPrefix[1])) {
    result.mawb = normalizeMawbNumber(subjectMawbPrefix[1]);
    matchCount += 3;
  } else {
    // Subject without prefix: look for 3-8, 3-4-4, or 11 digits in subject
    const subjectMawbPattern = subjectText.match(/\b([0-9]{3}[-\s]?[0-9]{7,8}|[0-9]{3}[-\s][0-9]{4}[-\s][0-9]{4})\b/);
    if (subjectMawbPattern && !isLikelyJapanesePhoneNumber(subjectMawbPattern[1])) {
      result.mawb = normalizeMawbNumber(subjectMawbPattern[1]);
      matchCount += 3;
    }
  }

  // B. If not found in subject, check explicit prefixes in combined text (subject + body)
  if (!result.mawb) {
    const mawbExplicit = combined.match(/(?:MAWB|M-AWB|M\/AWB|MBL|M-BL|AWB|A\.W\.B|AIR\s*WAYBILL|AIRWAYBILL|WAYBILL|BL\s*NO|B\/L\s*NO|BILL\s*OF\s*LADING|DOC\s*(?:NO|NUMBER)?|REF\s*(?:NO|NUMBER)?|SHIPMENT\s*(?:NO|NUMBER)?|TRACKING\s*(?:NO|NUMBER)?|送り状番号|荷受番号|運送状番号|申告番号|マスター番号|マスターAWB|マスター)[:\s#]*([0-9]{3}[-\s]?[0-9]{4}[-\s]?[0-9]{4}|[0-9]{3}[-\s]?[0-9]{7,8})/i);
    if (mawbExplicit && !isLikelyJapanesePhoneNumber(mawbExplicit[1])) {
      result.mawb = normalizeMawbNumber(mawbExplicit[1]);
      matchCount += 2;
    }
  }

  // C. Fallback: Search all 3-8 (e.g. 205-88412900) or 3-4-4 (e.g. 205-8841-2900) patterns in text
  if (!result.mawb) {
    const patterns = Array.from(combined.matchAll(/\b([0-9]{3}[-\s][0-9]{7,8}|[0-9]{3}[-\s][0-9]{4}[-\s][0-9]{4})\b/g));
    for (const p of patterns) {
      const candidate = p[1];
      if (!isLikelyJapanesePhoneNumber(candidate)) {
        // Ensure not preceded immediately by TEL, FAX, Mobile, 携帯, 電話, M:, T:, etc.
        const idx = p.index ?? -1;
        const prefix = idx > 25 ? combined.slice(idx - 25, idx) : combined.slice(0, idx);
        if (!/(?:tel|fax|phone|mobile|cell|cel|携帯|電話|連絡先|ph|m|t)[:\s#]*$/i.test(prefix)) {
          result.mawb = normalizeMawbNumber(candidate);
          matchCount += 2;
          break;
        }
      }
    }
  }

  // 2. HAWB Number (House Air Waybill)
  // A. Check explicit HAWB prefixes in subject + body
  const hawbExplicit = combined.match(/(?:HAWB|H-AWB|H\/AWB|HBL|H-BL|HOUSE\s*AWB|HOUSE\s*BL|HOUSE\s*AIR\s*WAYBILL|ハウス番号|ハウスAWB|ハウス)[:\s#]*([A-Za-z0-9\-_/]{3,24})/i);
  if (hawbExplicit) {
    const cleaned = cleanHawbNumber(hawbExplicit[1]);
    if (cleaned) {
      result.hawb = cleaned;
      matchCount += 2;
    }
  } else {
    // B. Check standard freight forwarder house formats (e.g. HLM-XXXX, TYO-XXXX, NRT-XXXX, KIX-XXXX)
    // Require hyphen, space, or numeric sequence after prefix to prevent matching email handles/words (e.g. osasales2, osakajapan)
    const hawbGeneral = combined.match(/\b((?:HLM|HBL|HAWB|H-)[-\s]?[A-Za-z0-9\-]{3,18}|(?:TYO|NRT|KIX|OSA|NGO|HKG|SIN|BKK|PVG)[-\s][A-Za-z0-9\-]{3,18}|(?:TYO|NRT|KIX|OSA|NGO|HKG|SIN|BKK|PVG)\d{4,12})\b/i);
    if (hawbGeneral) {
      const cleaned = cleanHawbNumber(hawbGeneral[1]);
      if (cleaned) {
        result.hawb = cleaned;
        matchCount += 1;
      }
    }
  }

  // 3. Shipper (荷主)
  const shipperMatch = combined.match(/(?:SHIPPER|荷主|荷送人|荷主名)[:\s]*([^\n\r]+)/i);
  if (shipperMatch) {
    const clean = shipperMatch[1].replace(/^[・\s*]+/, '').trim();
    if (clean.length > 2) {
      result.shipper = clean;
      matchCount += 1;
    }
  }

  // 4. Consignee (荷受人)
  const consigneeMatch = combined.match(/(?:CONSIGNEE|荷受人|宛先|受取人)[:\s]*([^\n\r]+)/i);
  if (consigneeMatch) {
    const clean = consigneeMatch[1].replace(/^[・\s*]+/, '').trim();
    if (clean.length > 2) {
      result.consignee = clean;
      matchCount += 1;
    }
  }

  // 5. Flight & Route (e.g. NH006, LH717, JL010)
  const flightExplicit = combined.match(/(?:FLIGHT|便名|便|FLT)[:\s]*([^\n\r]+)/i);
  if (flightExplicit) {
    result.flightRoute = flightExplicit[1].replace(/^[・\s*]+/, '').trim();
    matchCount += 1;
  } else {
    const flightCode = combined.match(/\b((?:NH|JL|KZ|LH|PO|SQ|CX|KE|OZ|TG|CI|UA|DL|AA|5X|FX)\s*[0-9]{3,4})\b/i);
    if (flightCode) {
      result.flightRoute = flightCode[1].trim();
      matchCount += 1;
    }
  }

  // 6. Destination (向け地 / 行先)
  const destMatch = combined.match(/(?:DEST(?:INATION)?|向け地|行先|仕向地)[:\s]*([^\n\r]+)/i);
  if (destMatch) {
    result.destination = destMatch[1].replace(/^[・\s*]+/, '').trim();
    matchCount += 1;
  } else {
    const iataCity = combined.match(/\b(LAX|FRA|ORD|JFK|SIN|HKG|LHR|CDG|BKK|TPE|ICN|SFO|DFW|SYD|AMS)\b/i);
    if (iataCity) {
      result.destination = iataCity[1].toUpperCase();
      matchCount += 1;
    }
  }

  // 7. Port of Loading (積地)
  const polMatch = combined.match(/(?:積地|出発地|DEPARTURE|POL)[:\s]*([^\n\r]+)/i);
  if (polMatch) {
    result.portOfLoading = polMatch[1].replace(/^[・\s*]+/, '').trim();
  } else if (/成田|NRT/i.test(combined)) {
    result.portOfLoading = 'NRT';
  } else if (/羽田|HND/i.test(combined)) {
    result.portOfLoading = 'HND';
  } else if (/関空|関西|KIX/i.test(combined)) {
    result.portOfLoading = 'KIX';
  }

  // 8. Pieces (個数)
  const piecesMatch = combined.match(/(?:個数|PIECES?|PKGS?|PCS?)[:\s]*([0-9,]+(?:\s*(?:PKG|PKGS|PCS|CRATES|PLT|CTN|個|個口))?)/i);
  if (piecesMatch) {
    result.pieces = piecesMatch[1].trim();
    matchCount += 1;
  }

  // 9. Gross Weight (重量)
  const weightMatch = combined.match(/(?:重量|WEIGHT|G\.?W\.?)[:\s]*([0-9,.]+(?:\s*(?:KGS?|KG|キロ))?)/i);
  if (weightMatch) {
    result.grossWeight = weightMatch[1].trim();
    matchCount += 1;
  }

  // 10. Cut Time (カット時間)
  const cutMatch = combined.match(/(?:CUT(?:時間)?|カット(?:時間)?)[:\s]*([0-2]?[0-9]:[0-5][0-9])/i);
  if (cutMatch) {
    result.cutTime = cutMatch[1].trim();
    matchCount += 1;
  }

  // 11. Invoice No / Order No
  const invMatch = combined.match(/(?:INV(?:OICE)?(?:\s*NO\.?|番号)?|インボイスNO\.?)[:\s]*([A-Za-z0-9\-_]+)/i);
  if (invMatch) {
    result.invoiceNumber = invMatch[1].trim();
  }
  const orderMatch = combined.match(/(?:ORDER(?:\s*NO\.?|番号)?|受注NO\.?)[:\s]*([A-Za-z0-9\-_]+)/i);
  if (orderMatch) {
    result.orderNumber = orderMatch[1].trim();
  }

  result.confidence = Math.min(1.0, matchCount / 5);
  return result;
}

/**
 * Extract recipient email addresses (To and CC) from email body / HTML headers
 */
export function extractRecipientsFromEmailContent(bodyText?: string, bodyHtml?: string): { to: string[]; cc: string[] } {
  const toList: string[] = [];
  const ccList: string[] = [];
  const combined = `${bodyText || ''}\n${bodyHtml ? bodyHtml.replace(/<br\s*[\/]?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ') : ''}`;
  if (!combined.trim()) return { to: toList, cc: ccList };

  const lines = combined.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^(?:To|宛先|送信先|To Recipients|宛先アドレス)[:：]/i.test(line)) {
      const matches = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (matches) {
        toList.push(...matches.map((m) => m.toLowerCase()));
      }
    } else if (/^(?:Cc|CC|カーボンコピー)[:：]/i.test(line)) {
      const matches = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (matches) {
        ccList.push(...matches.map((m) => m.toLowerCase()));
      }
    }
  }

  return {
    to: Array.from(new Set(toList)),
    cc: Array.from(new Set(ccList)),
  };
}

/**
 * Automatically determines the sourceType for an email item based on sender, recipients, subject, body, and M365 settings
 */
export function determineEmailSourceType(
  email: {
    sender?: { email?: string; name?: string };
    toRecipients?: any[];
    ccRecipients?: any[];
    subject?: string;
    body?: string;
    bodyText?: string;
    sourceType?: string;
    direction?: 'INCOMING' | 'OUTGOING' | string;
    folder?: string;
  },
  settings?: M365Settings
): 'HELLMANN_ORDER' | 'BROKER_QUESTION' | 'CUSTOMS_REQUEST' | 'CUSTOMS_INQUIRY' | 'HELLMANN_ANSWER' | 'BROKER_REPLY' | 'GENERAL' {
  if (email.sourceType && email.sourceType !== 'GENERAL') {
    return email.sourceType as any;
  }

  const s = settings || getM365Settings();
  const senderEmail = (email.sender?.email || '').toLowerCase().trim();
  const senderName = (email.sender?.name || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();
  const body = (email.body || email.bodyText || '').toLowerCase();

  // Parse configured broker emails (support comma/space separated addresses)
  const configuredBrokerEmails = (s.brokerDefaultEmail || 'shirana@tac-japan.co.jp')
    .toLowerCase()
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);

  if (!configuredBrokerEmails.includes('shirana@tac-japan.co.jp')) {
    configuredBrokerEmails.push('shirana@tac-japan.co.jp');
  }

  // 1. 設定している通関士のメールアドレス（例: shirana@tac-japan.co.jp または s.brokerDefaultEmail）から送信（＝受信）されたメールか判定
  const isDirectBrokerSender = configuredBrokerEmails.some((bEmail) => {
    if (!bEmail) return false;
    return (
      senderEmail === bEmail ||
      senderEmail.startsWith(bEmail + '<') ||
      senderEmail.includes(`<${bEmail}>`) ||
      senderEmail.split('<')[0].trim() === bEmail
    );
  });

  const isOutgoing = email.direction === 'OUTGOING' || email.folder === 'SENT';

  // 差出人が「設定している通関士のアドレス」かつ受信メールである場合のみ「通関士からのメール」とする
  if (isDirectBrokerSender && !isOutgoing) {
    if (subject.includes('回答') || subject.includes('完了') || body.includes('許可になり') || body.includes('手配完了')) {
      return 'BROKER_REPLY';
    }
    return 'BROKER_QUESTION';
  }

  // 2. Sender is Hellmann
  const isHellmannSender =
    senderEmail.includes('hellmann.com') ||
    senderEmail.includes('hellmann') ||
    senderName.includes('hellmann') ||
    senderName.includes('ヘルマン');

  if (isHellmannSender) {
    if (subject.includes('回答') || body.includes('回答') || body.includes('返答')) {
      return 'HELLMANN_ANSWER';
    }
    return 'HELLMANN_ORDER';
  }

  // 3. 通関依頼キーワード（ヘルマン以外の送信者、特に社内送信者の場合は「ヘルマン依頼」にせず GENERAL「社内より受信」に分類）
  // ヘルマン社から送信されたメールのみを「ヘルマン依頼」とし、社内やその他からのメールは GENERAL（社内より受信等）とします。
  return 'GENERAL';
}

/**
 * Generate a realistic sample PDF data URL for mock SI attachments
 */
function createSampleSiPdfDataUrl(mawb: string, hawb: string, shipper: string, consignee: string): string {
  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('SHIPPING INSTRUCTION (EXPORT AIR CARGO)', 20, 25);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`ISSUED BY: HELLMANN WORLDWIDE LOGISTICS CO., LTD.`, 20, 33);
    doc.text(`DATE: ${new Date().toISOString().split('T')[0]}`, 150, 33);
    
    doc.setDrawColor(50, 80, 150);
    doc.setLineWidth(0.8);
    doc.line(20, 36, 190, 36);
    
    doc.setFont('helvetica', 'bold');
    doc.text('MAWB NO:', 20, 46);
    doc.setFont('helvetica', 'normal');
    doc.text(mawb, 60, 46);
    
    doc.setFont('helvetica', 'bold');
    doc.text('HAWB NO:', 20, 54);
    doc.setFont('helvetica', 'normal');
    doc.text(hawb, 60, 54);
    
    doc.setFont('helvetica', 'bold');
    doc.text('SHIPPER:', 20, 64);
    doc.setFont('helvetica', 'normal');
    doc.text(shipper, 60, 64);
    
    doc.setFont('helvetica', 'bold');
    doc.text('CONSIGNEE:', 20, 74);
    doc.setFont('helvetica', 'normal');
    doc.text(consignee, 60, 74);
    
    doc.setFont('helvetica', 'bold');
    doc.text('AIRPORT OF LOADING:', 20, 84);
    doc.setFont('helvetica', 'normal');
    doc.text('NRT (NARITA, TOKYO)', 60, 84);
    
    doc.setFont('helvetica', 'bold');
    doc.text('AIRPORT OF DESTINATION:', 20, 92);
    doc.setFont('helvetica', 'normal');
    doc.text('LAX (LOS ANGELES, USA)', 60, 92);
    
    doc.setFont('helvetica', 'bold');
    doc.text('FLIGHT / ETD:', 20, 100);
    doc.setFont('helvetica', 'normal');
    doc.text('NH006 / 2026-09-12 17:00 CUT', 60, 100);
    
    doc.setFont('helvetica', 'bold');
    doc.text('PIECES / GROSS WEIGHT:', 20, 108);
    doc.setFont('helvetica', 'normal');
    doc.text('8 PACKAGES / 320.5 KGS', 60, 108);
    
    doc.setFont('helvetica', 'bold');
    doc.text('SPECIAL INSTRUCTIONS:', 20, 118);
    doc.setFont('helvetica', 'normal');
    doc.text('PLEASE PROCEED WITH CUSTOMS CLEARANCE UPON ARRIVAL AT BONDED WAREHOUSE.', 20, 126);
    doc.text('X-RAY INSPECTION REQUIRED PRIOR TO TENDER.', 20, 132);

    return doc.output('datauristring');
  } catch (err) {
    return 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrCg==';
  }
}

/**
 * Generate a sample SDS / Technical Spec document PDF
 */
export function createSampleTechSpecPdfDataUrl(fileName: string, title: string): string {
  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(`TECHNICAL DATA SHEET & SDS (MSDS)`, 20, 25);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Document Reference: ${fileName}`, 20, 33);
    doc.text(`Subject: ${title}`, 20, 40);
    doc.line(20, 44, 190, 44);
    doc.text('Classification: NON-HAZARDOUS INDUSTRIAL COMPONENT (Non-DG)', 20, 52);
    doc.text('Non-flammable, Non-toxic solid polymers.', 20, 60);
    doc.text('HS Code reference provided: 8479.90 / 3926.90', 20, 68);
    return doc.output('datauristring');
  } catch {
    return 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrCg==';
  }
}

/**
 * Initial Realistic Incoming Hellmann Orders
 */
const INITIAL_HELLMANN_ORDERS: HellmannNewOrderEmail[] = [
  {
    id: 'hlm_msg_pvg_804_22772573',
    messageId: '<20260911-173800-Rio.Tsutsui@hellmann.com>',
    conversationId: 'conv_pvg_804_22772573',
    receivedDateTime: '2026-09-11T17:38:00+09:00',
    subject: '9/14 輸出通関依頼 PVG向け 804-22772573 MV ANL GIPPSLAND, CMA CGM ALMAVIVA,CMA CGM DALILA,CMA CGM MEKONG,CMA CGM SORBONNE',
    senderName: 'Rio Tsutsui',
    senderEmail: 'Rio.Tsutsui@hellmann.com',
    toRecipients: ['tac-hellmann@tac-japan.co.jp'],
    ccRecipients: ['HMS-JP@hellmann.com', 'kita@tac-japan.co.jp'],
    bodyText: `喜多様、浪口様

いつもお世話になっております。

表題の件につきまして輸出通関をお願いいたします。
下記EDに記載願います。

ANL GIPPSLAND
2386-26-0296

CMA CGM MEKONG
2679-26-0271

何卒宜しくお願いいたします。

B.Regards,

Rio Tsutsui　筒井 里央
Customer Service of Marine Solutions & Cruise Logistics
hellmann WORLDWIDE LOGISTICS
Hellmann Worldwide Logistics Inc.
3-6-14 Minamihonmachi Chuo-ku, Osaka, 541-0054, Japan
Phone: +81 6 6241 1234
E-Mail: Rio.Tsutsui@hellmann.com
Internet: www.hellmann.com`,
    bodyHtml: `<div style="font-family: 'Segoe UI', Meiryo, -apple-system, BlinkMacSystemFont, Roboto, sans-serif; font-size: 13.5px; line-height: 1.65; color: #1e293b; background-color: #ffffff; padding: 4px;">
  <p style="margin: 0 0 16px 0;">喜多様、浪口様</p>
  <p style="margin: 0 0 16px 0;">いつもお世話になっております。</p>
  <p style="margin: 0 0 16px 0;">
    表題の件につきまして輸出通関をお願いいたします。<br>
    下記EDに記載願います。
  </p>
  <div style="margin: 0 0 16px 0; padding: 12px 16px; background-color: #f8fafc; border-left: 4px solid #0284c7; border-radius: 4px;">
    <div style="margin-bottom: 8px;">
      <span style="font-size: 13px; font-weight: bold; color: #0f172a;">ANL GIPPSLAND</span><br>
      <span style="font-size: 14.5px; font-weight: bold; color: #dc2626; text-decoration: underline; font-family: Consolas, monospace;">2386-26-0296</span>
    </div>
    <div>
      <span style="font-size: 13px; font-weight: bold; color: #0f172a;">CMA CGM MEKONG</span><br>
      <span style="font-size: 14.5px; font-weight: bold; color: #0f172a; font-family: Consolas, monospace;">2679-26-0271</span>
    </div>
  </div>
  <p style="margin: 0 0 20px 0;">何卒宜しくお願いいたします。</p>
  <p style="margin: 0 0 14px 0; color: #475569;">B.Regards,</p>
  <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid #e2e8f0;">
    <p style="margin: 0 0 2px 0; font-size: 14px; font-weight: bold; color: #0f172a;">Rio Tsutsui　筒井 里央</p>
    <p style="margin: 0 0 12px 0; font-size: 12px; color: #64748b;">Customer Service of Marine Solutions & Cruise Logistics</p>
    <div style="display: flex; align-items: center; margin: 12px 0 14px 0; gap: 8px;">
      <svg width="220" height="38" viewBox="0 0 220 38" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
        <rect width="36" height="36" rx="6" fill="#FACC15"/>
        <circle cx="18" cy="18" r="10" stroke="#003580" stroke-width="2.5" fill="none"/>
        <path d="M12 18h12M18 12c2.5 3 2.5 9 0 12M18 12c-2.5 3-2.5 9 0 12" stroke="#003580" stroke-width="1.8"/>
        <text x="44" y="22" font-family="'Segoe UI', Arial, sans-serif" font-weight="900" font-size="17" fill="#003580" letter-spacing="-0.5">hellmann</text>
        <text x="45" y="32" font-family="'Segoe UI', Arial, sans-serif" font-weight="700" font-size="7.5" fill="#475569" letter-spacing="1.5">WORLDWIDE LOGISTICS</text>
      </svg>
    </div>
    <div style="font-size: 12px; line-height: 1.55; color: #334155;">
      <strong>Hellmann Worldwide Logistics Inc.</strong><br>
      3-6-14 Minamihonmachi Chuo-ku, Osaka, 541-0054, Japan<br>
      Phone: +81 6 6241 1234<br>
      E-Mail: <a href="mailto:Rio.Tsutsui@hellmann.com" style="color: #0284c7; text-decoration: underline;">Rio.Tsutsui@hellmann.com</a><br>
      Internet: <a href="https://www.hellmann.com" target="_blank" rel="noreferrer" style="color: #0284c7; text-decoration: underline;">www.hellmann.com</a>
    </div>
  </div>
</div>`,
    mawbCandidate: '804-22772573',
    hawbCandidate: '2386-26-0296',
    shipperCandidate: 'KB Trans',
    consigneeCandidate: 'ANL GIPPSLAND / CMA CGM',
    flightCandidate: 'KIX -> PVG (MV ANL GIPPSLAND)',
    piecesCandidate: '1 PKG',
    weightCandidate: '21.2 KGS',
    status: 'NEW_PENDING_EXTERNAL_REG',
    attachments: [
      {
        id: 'att_ref_zip',
        fileName: 'REF.zip',
        contentType: 'application/zip',
        sizeBytes: 698000,
        isPdf: false,
      },
      {
        id: 'att_cma_almaviva',
        fileName: 'CMA CGM ALMAVIVA.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 17408,
        isPdf: false,
      },
      {
        id: 'att_cma_dalila',
        fileName: 'CMA CGM DALILA.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 17408,
        isPdf: false,
      },
      {
        id: 'att_cma_mekong',
        fileName: 'CMA CGM MEKONG.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 17408,
        isPdf: false,
      },
      {
        id: 'att_cma_sorbonne',
        fileName: 'CMA CGM SORBONNE.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 17408,
        isPdf: false,
      },
      {
        id: 'att_anl_gippsland',
        fileName: 'ANL GIPPSLAND.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 17408,
        isPdf: false,
      },
      {
        id: 'att_si_pdf',
        fileName: 'SI_804-22772573_PVG.pdf',
        contentType: 'application/pdf',
        sizeBytes: 92160,
        isPdf: true,
        dataUrl: createSampleSiPdfDataUrl('804-22772573', '2386-26-0296', 'KB Trans', 'ANL GIPPSLAND'),
      },
    ],
    notes: '新着：社内別システムへの登録待ち (ED記載: 2386-26-0296)',
  },
];

/**
 * Helper to identify demo / mock email IDs
 */
export function isDemoMailOrOrderId(id: string): boolean {
  if (!id) return false;
  if (
    id.startsWith('hlm_msg_') ||
    id.startsWith('mock_') ||
    id.startsWith('sent_mock_') ||
    id.startsWith('init_') ||
    id.startsWith('sample_') ||
    id.startsWith('demo_') ||
    id.startsWith('brk_mail_')
  ) {
    return true;
  }
  if (INITIAL_HELLMANN_ORDERS.some((o) => o.id === id)) return true;
  if (INITIAL_SENT_MAILS.some((s) => s.id === id)) return true;
  return false;
}

/**
 * Convert a real Microsoft Graph API unified mail item to a HellmannNewOrderEmail
 */
export function convertGraphMailToHellmannOrder(
  g: UnifiedMailItem,
  metaStore?: Record<string, any>
): HellmannNewOrderEmail {
  const meta = metaStore ? metaStore[g.id] || {} : getMailMetaStore()[g.id] || {};
  const bodyStr = (g as any).bodyText || g.body || '';
  const logistics = extractLogisticsInfoFromEmailText(bodyStr, g.subject || '');

  let status: HellmannNewOrderEmail['status'] = 'NEW_PENDING_EXTERNAL_REG';
  if (meta.decisionStatus === 'DECIDED_IMPORTED' || g.decisionStatus === 'DECIDED_IMPORTED' || g.shipmentId) {
    status = 'PROCESSED_TO_SHIPMENT';
  } else if (
    meta.decisionStatus === 'DECIDED_EXTERNAL_REGISTERED' ||
    g.decisionStatus === 'DECIDED_EXTERNAL_REGISTERED'
  ) {
    status = 'EXTERNAL_REGISTERED';
  } else if (meta.decisionStatus === 'DECIDED_DISMISSED' || g.decisionStatus === 'DECIDED_DISMISSED') {
    status = 'DISMISSED';
  }

  const { mawb: resolvedMawb, hawb: resolvedHawb } = resolveAwbCandidates(
    meta,
    g.mawbNumber || logistics.mawb,
    g.hawbNumber || logistics.hawb
  );

  const payload = getEmailPayloadSync(g.id);
  const resolvedBodyHtml = g.bodyHtml || payload?.bodyHtml;
  const resolvedBodyText = bodyStr || payload?.bodyText || '';
  const resolvedAttachments = (g.attachments && g.attachments.length > 0) ? g.attachments : (payload?.attachments || []);

  return {
    id: g.id,
    messageId: (g as any).messageId || g.id,
    conversationId: (g as any).conversationId,
    receivedDateTime: g.receivedOrSentAt || (g as any).receivedDateTime || new Date().toISOString(),
    subject: g.subject || '(件名なし)',
    senderName: g.sender?.name || 'Hellmann 担当者',
    senderEmail: g.sender?.email || '',
    toRecipients: g.toRecipients || [],
    ccRecipients: g.ccRecipients || [],
    bodyText: resolvedBodyText,
    bodyHtml: resolvedBodyHtml,
    status,
    mawbCandidate: resolvedMawb,
    hawbCandidate: resolvedHawb,
    shipperCandidate: logistics.shipper,
    consigneeCandidate: logistics.consignee,
    attachments: resolvedAttachments,
    processedShipmentId: g.shipmentId,
    notes: meta.decisionNote || g.decisionNote,
  };
}

export function getHellmannNewOrders(): HellmannNewOrderEmail[] {
  const settings = getM365Settings();
  const isProduction = !settings.isDemoMode;

  if (isProduction) {
    // -------------------------------------------------------------
    // 本番 (Graph API) モード: デモメール・初期モックは完全排除
    // Graph APIから受信した実メール(graphInbox)のうち、通関依頼メールを案件化
    // -------------------------------------------------------------
    const graphInbox = getGraphInboxMails();
    const metaStore = getMailMetaStore();
    const realOrders: HellmannNewOrderEmail[] = [];

    // Local storage overrides for real orders
    let savedOrders: HellmannNewOrderEmail[] = [];
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(HELLMANN_ORDERS_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            savedOrders = parsed.filter((o) => !isDemoMailOrOrderId(o.id));
          }
        } catch {}
      }
    }

    const savedOrderMap = new Map<string, HellmannNewOrderEmail>();
    for (const so of savedOrders) {
      if (!so || !so.id) continue;
      const baseId = so.id.replace(/_\d+$/, '').replace(/^graph_/, '');
      savedOrderMap.set(so.id, so);
      savedOrderMap.set(baseId, so);
      savedOrderMap.set(`graph_${baseId}`, so);
      savedOrderMap.set(`${so.id}_0`, so);
    }

    for (const g of graphInbox) {
      if (isDemoMailOrOrderId(g.id)) continue;
      const meta = metaStore[g.id] || {};
      const autoSourceType = determineEmailSourceType(g, settings);
      const sourceType = meta.isManualSourceType && meta.sourceType ? meta.sourceType : autoSourceType;

      if (sourceType === 'HELLMANN_ORDER') {
        const converted = convertGraphMailToHellmannOrder(g, metaStore);
        const baseGId = g.id.replace(/_\d+$/, '').replace(/^graph_/, '');
        const existingSaved =
          savedOrderMap.get(g.id) ||
          savedOrderMap.get(baseGId) ||
          savedOrderMap.get(`graph_${baseGId}`) ||
          savedOrderMap.get(`${g.id}_0`);
        if (existingSaved) {
          realOrders.push({
            ...converted,
            status: existingSaved.status || converted.status,
            notes: existingSaved.notes || converted.notes,
            processedShipmentId: existingSaved.processedShipmentId || converted.processedShipmentId,
          });
        } else {
          realOrders.push(converted);
        }
      }
    }

    // Add any saved orders that are not in graphInbox but are real
    for (const so of savedOrders) {
      if (!realOrders.some((ro) => ro.id === so.id) && !isDemoMailOrOrderId(so.id)) {
        const meta =
          metaStore[so.id] ||
          metaStore[so.id.replace(/_\d+$/, '')] ||
          metaStore[so.id.replace(/^graph_/, '')];
        if (!meta?.sourceType || meta.sourceType === 'HELLMANN_ORDER') {
          realOrders.push(so);
        }
      }
    }

    return realOrders;
  }

  // -------------------------------------------------------------
  // デモモード: 動作確認用サンプルメールを返却
  // -------------------------------------------------------------
  if (typeof window === 'undefined') return INITIAL_HELLMANN_ORDERS;
  const raw = localStorage.getItem(HELLMANN_ORDERS_KEY);
  if (!raw) {
    safeLocalStorageSetItem(HELLMANN_ORDERS_KEY, JSON.stringify(INITIAL_HELLMANN_ORDERS));
    return INITIAL_HELLMANN_ORDERS;
  }
  try {
    const metaStore = getMailMetaStore();
    const list: HellmannNewOrderEmail[] = JSON.parse(raw);
    const filtered = list.filter((o) => {
      if (o.id === 'hlm_msg_901' || o.id === 'hlm_msg_902') return false;
      const meta =
        metaStore[o.id] ||
        metaStore[o.id.replace(/_\d+$/, '')] ||
        metaStore[o.id.replace(/^graph_/, '')];
      if (meta?.sourceType && meta.sourceType !== 'HELLMANN_ORDER') {
        return false;
      }
      return true;
    });

    const pvgIdx = filtered.findIndex((o) => o.mawbCandidate === '804-22772573' || o.id === 'hlm_msg_pvg_804_22772573');
    if (pvgIdx >= 0) {
      if (!filtered[pvgIdx].bodyHtml || filtered[pvgIdx].bodyText.length < 150) {
        filtered[pvgIdx] = {
          ...filtered[pvgIdx],
          bodyText: INITIAL_HELLMANN_ORDERS[0].bodyText,
          bodyHtml: INITIAL_HELLMANN_ORDERS[0].bodyHtml,
        };
        safeLocalStorageSetItem(HELLMANN_ORDERS_KEY, JSON.stringify(filtered));
      }
    } else if (INITIAL_HELLMANN_ORDERS.length > 0) {
      filtered.unshift(...INITIAL_HELLMANN_ORDERS);
      safeLocalStorageSetItem(HELLMANN_ORDERS_KEY, JSON.stringify(filtered));
    }
    return filtered;
  } catch {
    return INITIAL_HELLMANN_ORDERS;
  }
}

export function saveHellmannNewOrders(orders: HellmannNewOrderEmail[]): void {
  if (typeof window === 'undefined') return;
  const settings = getM365Settings();
  const isProduction = !settings.isDemoMode;

  // In production mode, ensure demo orders are purged from storage
  const cleanOrders = isProduction ? orders.filter((o) => !isDemoMailOrOrderId(o.id)) : orders;
  safeLocalStorageSetItem(HELLMANN_ORDERS_KEY, JSON.stringify(cleanOrders));
  notifyListeners();
}

/**
 * Check if an incoming order corresponds to an AWB already registered in the shipment list.
 */
export function isOrderAlreadyRegisteredInShipments(
  order: HellmannNewOrderEmail,
  shipments: { id: string; mawbNumber?: string; hawbNumber?: string | null }[]
): boolean {
  if (!order || !Array.isArray(shipments)) return false;

  if (order.processedShipmentId) {
    const found = shipments.find((s) => s && s.id === order.processedShipmentId);
    if (found) return true;
  }

  const mawb = typeof order.mawbCandidate === 'string' ? order.mawbCandidate.trim().toLowerCase() : '';
  const hawb = typeof order.hawbCandidate === 'string' ? order.hawbCandidate.trim().toLowerCase() : '';
  const cleanMawb = mawb ? mawb.replace(/[-\s]/g, '') : '';
  const cleanHawb = hawb ? hawb.replace(/[-\s]/g, '') : '';

  const textToSearch = `${order.subject || ''} ${order.bodyText || ''}`.toLowerCase();
  const cleanTextToSearch = textToSearch.replace(/[-\s]/g, '');

  return shipments.some((s) => {
    if (!s) return false;
    const sId = typeof s.id === 'string' ? s.id.trim().toLowerCase() : '';
    const sCleanId = sId ? sId.replace(/[-\s]/g, '') : '';
    const sMawb = typeof s.mawbNumber === 'string' ? s.mawbNumber.trim().toLowerCase() : '';
    const sHawb = typeof s.hawbNumber === 'string' ? s.hawbNumber.trim().toLowerCase() : '';
    const sCleanMawb = sMawb ? sMawb.replace(/[-\s]/g, '') : '';
    const sCleanHawb = sHawb ? sHawb.replace(/[-\s]/g, '') : '';

    // 1. Direct MAWB/HAWB match
    if (cleanMawb) {
      if (sCleanMawb && cleanMawb === sCleanMawb) return true;
      if (sCleanId && cleanMawb === sCleanId) return true;
    }
    if (cleanHawb) {
      if (sCleanHawb && cleanHawb === sCleanHawb) return true;
      if (sCleanId && cleanHawb === sCleanId) return true;
    }

    // 2. ID exact / cleaned match (if valid AWB length)
    if (sCleanId && sCleanId.length >= 7) {
      if (cleanMawb && cleanMawb === sCleanId) return true;
      if (cleanHawb && cleanHawb === sCleanId) return true;
      if (cleanTextToSearch.includes(sCleanId)) return true;
    }

    // 3. Subject/Body text contains registered MAWB or HAWB
    if (sCleanMawb && sCleanMawb.length >= 7 && cleanTextToSearch.includes(sCleanMawb)) {
      return true;
    }
    if (sCleanHawb && sCleanHawb.length >= 7 && cleanTextToSearch.includes(sCleanHawb)) {
      return true;
    }

    return false;
  });
}

/**
 * Get active pending orders (waiting for external system registration or SI import)
 * Orders whose AWB numbers are already registered in the system are excluded from pending new orders.
 */
export function getPendingHellmannOrders(): HellmannNewOrderEmail[] {
  try {
    const all = getHellmannNewOrders() || [];
    const metaStore = getMailMetaStore() || {};
    const shipments = getShipments() || [];
    let hasChanges = false;

    const pending = all.filter((o) => {
      if (!o) return false;
      const idStr = String(o.id || '');
      if (!idStr) return false;

      // If the email's source type was changed away from HELLMANN_ORDER (e.g. to BROKER_QUESTION or GENERAL), exclude it from the pending banner!
      const meta =
        metaStore[idStr] ||
        metaStore[idStr.replace(/_\d+$/, '')] ||
        metaStore[idStr.replace(/^graph_/, '')] ||
        metaStore[`graph_${idStr}`];
      if (meta?.sourceType && meta.sourceType !== 'HELLMANN_ORDER') {
        return false;
      }
      if (o.status !== 'NEW_PENDING_EXTERNAL_REG' && o.status !== 'EXTERNAL_REGISTERED') {
        return false;
      }
      const alreadyRegistered = isOrderAlreadyRegisteredInShipments(o, shipments);
      if (alreadyRegistered) {
        o.status = 'PROCESSED_TO_SHIPMENT';
        if (!o.notes || !o.notes.includes('システム登録済み')) {
          o.notes = `システム登録済み (自動除外)`;
        }
        hasChanges = true;
        return false;
      }
      return true;
    });

    if (hasChanges && typeof window !== 'undefined') {
      safeLocalStorageSetItem(HELLMANN_ORDERS_KEY, JSON.stringify(all));
    }

    return pending;
  } catch (err) {
    console.warn('Error in getPendingHellmannOrders:', err);
    return [];
  }
}

/**
 * Step 1-A: Mark order as registered in external company system
 */
export function markHellmannOrderRegistered(orderId: string): HellmannNewOrderEmail | null {
  if (!orderId) return null;
  try {
    applyMailDecision(orderId, 'DECIDED_EXTERNAL_REGISTERED', { note: '社内別システム登録完了' });
  } catch (err) {
    console.warn('Error applying decision in markHellmannOrderRegistered:', err);
  }

  const orders = getHellmannNewOrders();
  const baseTarget = (orderId || '').replace(/_\d+$/, '').replace(/^graph_/, '');
  const index = orders.findIndex((o) => {
    if (!o || !o.id) return false;
    if (o.id === orderId) return true;
    const baseO = o.id.replace(/_\d+$/, '').replace(/^graph_/, '');
    return baseO === baseTarget;
  });
  if (index === -1) return null;

  orders[index] = {
    ...orders[index],
    status: 'EXTERNAL_REGISTERED',
    notes: `社内別システム登録完了 (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}) - 本システムSI取り込み待ち`,
  };
  saveHellmannNewOrders(orders);
  return orders[index];
}

/**
 * Dismiss or skip a Hellmann order email
 */
export function dismissHellmannOrder(orderId: string): void {
  if (!orderId) return;

  // 1. Update mail meta store decision & source type across ID variants
  try {
    applyMailDecision(orderId, 'DECIDED_DISMISSED', { note: '一覧から非表示' });
    updateMailSourceType(orderId, 'GENERAL');
  } catch (err) {
    console.warn('Error updating mail meta in dismissHellmannOrder:', err);
  }

  // 2. Also explicitly set DISMISSED in Hellmann new orders store
  const orders = getHellmannNewOrders();
  const baseTarget = (orderId || '').replace(/_\d+$/, '').replace(/^graph_/, '');
  const updated = orders.map((o) => {
    if (!o || !o.id) return o;
    const baseO = o.id.replace(/_\d+$/, '').replace(/^graph_/, '');
    if (o.id === orderId || baseO === baseTarget) {
      return { ...o, status: 'DISMISSED' as const };
    }
    return o;
  });
  saveHellmannNewOrders(updated);
}

/**
 * Mark a Hellmann order email as processed / imported without doing manual SI parsing
 */
export function markHellmannOrderProcessed(orderId: string): HellmannNewOrderEmail | null {
  if (!orderId) return null;
  try {
    applyMailDecision(orderId, 'DECIDED_IMPORTED', { note: '本システムへ取り込み完了' });
  } catch (err) {
    console.warn('Error applying decision in markHellmannOrderProcessed:', err);
  }

  const orders = getHellmannNewOrders();
  const baseTarget = (orderId || '').replace(/_\d+$/, '').replace(/^graph_/, '');
  const index = orders.findIndex((o) => {
    if (!o || !o.id) return false;
    if (o.id === orderId) return true;
    const baseO = o.id.replace(/_\d+$/, '').replace(/^graph_/, '');
    return baseO === baseTarget;
  });
  if (index === -1) return null;

  orders[index] = {
    ...orders[index],
    status: 'PROCESSED_TO_SHIPMENT',
    notes: `取り込み完了（手動） (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
  };
  saveHellmannNewOrders(orders);
  return orders[index];
}

/**
 * Convert an email attachment (base64 data URL) into a native browser File object
 * so it can be passed directly into PdfUploadModal for Gemini AI parsing!
 */
export async function createBrowserFileFromAttachment(attachment: EmailAttachment): Promise<File> {
  const fileName = attachment?.fileName || 'attachment.pdf';
  try {
    const dataUrl = attachment?.dataUrl || createSampleSiPdfDataUrl('999-0000-0000', 'SAMPLE', 'SHIPPER', 'CONSIGNEE');

    if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      return new File([blob], fileName, { type: blob.type || 'application/pdf' });
    }

    // Extract mime & binary
    const parts = dataUrl.split(',');
    if (parts.length >= 2 && parts[1]) {
      const mimeMatch = parts[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'application/pdf';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], fileName, { type: mime });
    }
  } catch (err) {
    console.warn('[m365EmailService] createBrowserFileFromAttachment fallback:', err);
  }

  // Graceful fallback sample PDF
  try {
    const sampleUrl = createSampleSiPdfDataUrl('999-0000-0000', 'SAMPLE', 'SHIPPER', 'CONSIGNEE');
    const parts = sampleUrl.split(',');
    const bstr = atob(parts[1] || '');
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], fileName, { type: 'application/pdf' });
  } catch {
    return new File([new Uint8Array([37, 80, 68, 70])], fileName, { type: 'application/pdf' });
  }
}

/**
 * Link an existing or newly created shipment to the Hellmann Order Email
 */
export function linkShipmentToHellmannOrder(shipmentId: string, orderId: string): void {
  const orders = getHellmannNewOrders();
  const order = orders.find((o) => o.id === orderId);
  if (order) {
    order.status = 'PROCESSED_TO_SHIPMENT';
    order.processedShipmentId = shipmentId;
    saveHellmannNewOrders(orders);
  }

  // Also update Shipment with thread ID
  const shipments = getShipments();
  const target = shipments.find((s) => s.id === shipmentId);
  if (target) {
    updateShipment(shipmentId, {
      linkedEmailThreadId: order?.messageId || `thread_${Date.now()}`,
      hellmannEmailSubject: order?.subject || '通関依頼',
    });
  }
}

/**
 * Simulate receiving a brand new Hellmann Order Email (for testing / demo)
 */
export function simulateIncomingHellmannOrder(): HellmannNewOrderEmail | null {
  if (isVercelEnvironment()) {
    console.info('[Vercel Env] Mail simulation is disabled.');
    return null;
  }
  const randomMawb = `131-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;
  const randomHawb = `HLM-${Math.floor(10000 + Math.random() * 90000)}`;
  const now = new Date();

  const newOrder: HellmannNewOrderEmail = {
    id: `hlm_msg_${Date.now()}`,
    messageId: `<${now.toISOString().slice(0, 10)}-HLM-${Math.floor(1000 + Math.random() * 9000)}@hellmann.com>`,
    conversationId: `conv_hlm_${Date.now()}`,
    receivedDateTime: now.toISOString(),
    subject: `【通関依頼】成田発 新規航空輸出SI送付 (MAWB: ${randomMawb} / HAWB: ${randomHawb})`,
    senderName: 'Hellmann Worldwide Logistics (CS Desk)',
    senderEmail: 'export-cs@hellmann.com',
    bodyText: `お世話になっております。ヘルマンCS担当です。
新規の輸出通関案件の指示書を添付にて送付いたします。

社内登録の上、通関士手配のほどよろしくお願い申し上げます。
・MAWB: ${randomMawb}
・HAWB: ${randomHawb}
・向け地: ORD (シカゴ)
・個数: 4 パレット (850kg)`,
    mawbCandidate: randomMawb,
    hawbCandidate: randomHawb,
    shipperCandidate: 'TOKYO SEIMITSU KOGYO CO., LTD.',
    consigneeCandidate: 'MIDWEST MANUFACTURING INC.',
    flightCandidate: 'JL010 / NRT -> ORD',
    piecesCandidate: '4 PLT',
    weightCandidate: '850.0 KGS',
    status: 'NEW_PENDING_EXTERNAL_REG',
    attachments: [
      {
        id: `att_si_${Date.now()}`,
        fileName: `SI_${randomHawb}_ORD.pdf`,
        contentType: 'application/pdf',
        sizeBytes: 198000,
        isPdf: true,
        dataUrl: createSampleSiPdfDataUrl(randomMawb, randomHawb, 'TOKYO SEIMITSU KOGYO CO., LTD.', 'MIDWEST MANUFACTURING INC.'),
      },
    ],
    notes: '新着：社内別システムへの登録待ち',
  };

  const orders = getHellmannNewOrders();
  orders.unshift(newOrder);
  saveHellmannNewOrders(orders);
  return newOrder;
}

// -------------------------------------------------------------
// 共通グループメール宛てに届く社内通関士からの質問メール管理
// ※ ヘルマン社とのやり取りと同じグループメールで送受信
// -------------------------------------------------------------

/**
 * Initial Demo Broker Emails (Disabled for production data isolation)
 */
const INITIAL_BROKER_INCOMING_EMAILS: BrokerIncomingEmail[] = [];

export function getBrokerIncomingEmails(): BrokerIncomingEmail[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(BROKER_INCOMING_EMAILS_KEY);
  if (!raw) {
    safeLocalStorageSetItem(BROKER_INCOMING_EMAILS_KEY, JSON.stringify([]));
    return [];
  }
  try {
    const list: BrokerIncomingEmail[] = JSON.parse(raw);
    const filtered = list.filter((b) => {
      if (b.id?.startsWith('brk_mail_') || b.id === 'brk_mail_8801' || b.id === 'brk_mail_8802') {
        const text = `${b.subject || ''} ${b.bodyText || ''}`;
        if (
          text.includes('成田通関の高橋です') ||
          text.includes('外為法に基づく該非判定書') ||
          text.includes('渡辺です') ||
          text.includes('小林です') ||
          text.includes('精密測定機器が含まれております') ||
          text.includes('HSコード分類・原料構成比率の確認')
        ) {
          return false;
        }
      }
      return true;
    });
    if (filtered.length !== list.length) {
      safeLocalStorageSetItem(BROKER_INCOMING_EMAILS_KEY, JSON.stringify(filtered));
    }
    return filtered;
  } catch {
    return [];
  }
}

export function saveBrokerIncomingEmails(emails: BrokerIncomingEmail[]): void {
  if (typeof window === 'undefined') return;
  safeLocalStorageSetItem(BROKER_INCOMING_EMAILS_KEY, JSON.stringify(emails));
  notifyListeners();
}

/**
 * Get all actual received and sent emails relevant to a specific shipment from Microsoft 365.
 * When a shipment has a HAWB number, HAWB is strictly used as the primary key.
 */
export function getActualEmailsForShipment(shipment: Shipment): UnifiedMailItem[] {
  const allMails = getUnifiedMailMessages();
  const cleanedHawb = cleanHawbNumber(shipment.hawbNumber);
  const rawHawb = (cleanedHawb || shipment.hawbNumber || '').trim();
  const rawMawb = normalizeMawbNumber(shipment.mawbNumber) || (shipment.mawbNumber || '').trim();
  const shipId = (shipment.id || '').trim().toLowerCase();

  const hasHawb = !!rawHawb && rawHawb.length > 0;
  const hawbLower = rawHawb.toLowerCase();
  const hawbAlnum = hawbLower.replace(/[^a-z0-9]/g, '');

  const mawbLower = rawMawb.toLowerCase();
  const mawbAlnum = mawbLower.replace(/[^0-9]/g, '');

  const settings = getM365Settings();
  const configuredBrokerEmails = (settings.brokerDefaultEmail || 'shirana@tac-japan.co.jp')
    .toLowerCase()
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);

  if (!configuredBrokerEmails.includes('shirana@tac-japan.co.jp')) {
    configuredBrokerEmails.push('shirana@tac-japan.co.jp');
  }

  const matched = allMails.filter((m) => {
    // Exclude trashed emails
    if (m.folder === 'TRASH') return false;

    // Direct match by shipment ID (explicitly linked)
    if (m.shipmentId && m.shipmentId.toLowerCase() === shipId) return true;

    // 1. If HAWB number exists for this shipment, strictly match by HAWB:
    if (hasHawb) {
      // Direct metadata match
      if (m.hawbNumber) {
        const mHawbLower = (cleanHawbNumber(m.hawbNumber) || m.hawbNumber).trim().toLowerCase();
        const mHawbAlnum = mHawbLower.replace(/[^a-z0-9]/g, '');
        if (mHawbLower === hawbLower || (hawbAlnum.length >= 3 && mHawbAlnum === hawbAlnum)) {
          return true;
        }
      }

      // Subject or body text match for HAWB
      const subject = (m.subject || '').toLowerCase();
      const body = (m.body || '').toLowerCase();
      const attachmentsText = (m.attachments || []).map((a) => (a.fileName || (a as any).name || '').toLowerCase()).join(' ');
      const searchTarget = `${subject} ${body} ${attachmentsText}`;
      const searchAlnum = searchTarget.replace(/[^a-z0-9]/g, '');

      if (searchTarget.includes(hawbLower)) return true;
      if (hawbAlnum.length >= 4 && searchAlnum.includes(hawbAlnum)) return true;

      // When HAWB exists on this shipment, do NOT match emails that only have MAWB (prevents cross-matching other HAWBs under same master AWB)
      return false;
    }

    // 2. If NO HAWB exists on this shipment (Direct MAWB shipment):
    if (mawbLower) {
      // Direct metadata match
      if (m.mawbNumber) {
        const mMawbLower = (normalizeMawbNumber(m.mawbNumber) || m.mawbNumber).trim().toLowerCase();
        const mMawbAlnum = mMawbLower.replace(/[^0-9]/g, '');
        if (mMawbLower === mawbLower || (mawbAlnum.length >= 6 && mMawbAlnum === mawbAlnum)) {
          return true;
        }
      }

      // Subject or body text match for MAWB
      const subject = (m.subject || '').toLowerCase();
      const body = (m.body || '').toLowerCase();
      const searchTarget = `${subject} ${body}`;
      const searchAlnum = searchTarget.replace(/[^0-9]/g, '');

      if (searchTarget.includes(mawbLower)) return true;
      if (mawbAlnum.length >= 7 && searchAlnum.includes(mawbAlnum)) return true;
    }

    return false;
  });

  // --- Normalization for Shipment View ---
  // 1. Identify Hellmann incoming emails for this shipment
  const hellmannEmails: UnifiedMailItem[] = [];
  for (const item of matched) {
    const sEmail = (item.sender?.email || '').toLowerCase().trim();
    const sName = (item.sender?.name || '').toLowerCase();
    const body = item.body || item.bodyHtml || '';

    // Check if sender belongs to Hellmann
    const isHellmannDomain =
      sEmail.includes('hellmann.com') ||
      sEmail.includes('hellmann') ||
      sName.includes('hellmann') ||
      sName.includes('ヘルマン');

    const isBrokerSender = configuredBrokerEmails.some(
      (b) => b && (sEmail === b || sEmail.startsWith(b + '<') || sEmail.includes(`<${b}>`))
    );

    // Check if this is an inquiry sent to Hellmann from our system
    // IMPORTANT: If sender is from Hellmann domain, it is an incoming reply/email from Hellmann, NOT an outgoing inquiry
    const isHellmannInquirySent =
      !isHellmannDomain &&
      !isBrokerSender &&
      (item.sourceType === 'CUSTOMS_INQUIRY' ||
        item.folder === 'SENT' ||
        item.direction === 'OUTGOING' ||
        sEmail.includes('tac-japan.co.jp') ||
        sEmail.includes('tac-hellmann') ||
        sEmail.includes('kita@')) &&
      (body.includes('社内通関士より以下の照会が届いております') ||
        body.includes('照会内容】') ||
        body.includes('【通関照会】') ||
        item.sourceType === 'CUSTOMS_INQUIRY');

    if (isHellmannInquirySent) {
      item.direction = 'OUTGOING';
      item.folder = 'SENT';
      item.sourceType = 'CUSTOMS_INQUIRY';
    }

    const isOutgoing = (item.folder === 'SENT' || item.direction === 'OUTGOING' || isHellmannInquirySent) && !isHellmannDomain;

    const isHellmannSender =
      !isOutgoing &&
      !isBrokerSender &&
      isHellmannDomain;

    if (!isBrokerSender && (item.sourceType === 'BROKER_QUESTION' || item.sourceType === 'BROKER_REPLY')) {
      item.sourceType = 'GENERAL';
    }

    if (!isHellmannSender && item.sourceType === 'HELLMANN_ORDER') {
      item.sourceType = 'GENERAL';
    }

    if (isHellmannSender && !isOutgoing) {
      hellmannEmails.push(item);
    }
  }

  // 2. Sort Hellmann emails by time ascending (oldest first)
  if (hellmannEmails.length > 0) {
    hellmannEmails.sort((a, b) => {
      const timeA = new Date(a.receivedOrSentAt || 0).getTime();
      const timeB = new Date(b.receivedOrSentAt || 0).getTime();
      return timeA - timeB;
    });

    // Mark ONLY the oldest Hellmann email as HELLMANN_ORDER
    const oldestId = hellmannEmails[0].id;
    for (const hItem of hellmannEmails) {
      if (hItem.id === oldestId) {
        hItem.sourceType = 'HELLMANN_ORDER';
      } else if (hItem.sourceType === 'HELLMANN_ORDER') {
        hItem.sourceType = 'GENERAL';
      }
    }
  }

  return matched;
}

/**
 * Get broker emails arriving at the common group mailbox relevant to a specific shipment
 */
export function getBrokerEmailsForShipment(shipment: Shipment): BrokerIncomingEmail[] {
  const all = getBrokerIncomingEmails();
  const cleanedHawb = cleanHawbNumber(shipment.hawbNumber);
  const rawHawb = (cleanedHawb || shipment.hawbNumber || '').trim();
  const rawMawb = normalizeMawbNumber(shipment.mawbNumber) || (shipment.mawbNumber || '').trim();

  const hasHawb = !!rawHawb && rawHawb.length > 0;
  const hawbLower = rawHawb.toLowerCase();
  const hawbAlnum = hawbLower.replace(/[^a-z0-9]/g, '');

  const mawbLower = rawMawb.toLowerCase();
  const mawbAlnum = mawbLower.replace(/[^0-9]/g, '');

  return all.filter((m) => {
    if (m.shipmentId === shipment.id) return true;
    const textToSearch = `${m.subject} ${m.bodyText}`.toLowerCase();
    const textAlnum = textToSearch.replace(/[^a-z0-9]/g, '');

    if (hasHawb) {
      if (textToSearch.includes(hawbLower)) return true;
      if (hawbAlnum.length >= 4 && textAlnum.includes(hawbAlnum)) return true;
      return false;
    }

    if (mawbLower && textToSearch.includes(mawbLower)) return true;
    if (mawbAlnum.length >= 7 && textAlnum.includes(mawbAlnum)) return true;
    return false;
  });
}

/**
 * Simulate receiving a question from a customs broker sent to the common group mailbox
 */
export function simulateIncomingBrokerQuestionEmail(shipment: Shipment): BrokerIncomingEmail | null {
  if (isVercelEnvironment()) {
    console.info('[Vercel Env] Mail simulation is disabled.');
    return null;
  }
  const m365Settings = getM365Settings();
  const hawb = shipment.hawbNumber || 'HLM-DEMO';
  const mawb = shipment.mawbNumber || '000-0000-0000';
  const now = new Date();

  const sampleQuestions = [
    {
      subject: `【通関照会】HAWB: ${hawb} / HSコード分類及び構成比率の確認依頼`,
      title: 'HSコード分類・原料構成比率の確認',
      bodyText: `通関チーム各位

お疲れ様です。通関担当の渡辺です。
本件 (HAWB: ${hawb} / MAWB: ${mawb}) の輸出申告書類を確認しております。
インボイス記載の部品について、税番分類（HS Code）の確定のため、主原料の構成比率または仕様書を取り寄せていただけますでしょうか。

お手数ですがヘルマン社へご確認のほどよろしくお願いいたします。`,
    },
    {
      subject: `【至急・通関確認】HAWB: ${hawb} / 該非判定書（非該当証明書）の送付依頼`,
      title: '該非判定書（外為法該非判定）の提出依頼',
      bodyText: `通関担当者様

成田通関の高橋です。
本件 (HAWB: ${hawb})、精密測定機器が含まれております。
外為法に基づく該非判定書（パラメータシートまたは項目別対比表）が必要となりますので、
至急荷主（ヘルマン社経由）よりご手配願えますでしょうか。`,
    },
    {
      subject: `【通関質疑】HAWB: ${hawb} / 危険物該非(Non-DG証明)およびインボイス単価確認`,
      title: '非危険物証明・単価記載確認',
      bodyText: `通関チーム御中

通関士の小林です。
HAWB: ${hawb} の件、リチウム電池内蔵の有無、およびNon-DG該非について確認が必要です。
また、インボイス上のFOB/FCA条件の整合性をヘルマン社へご確認いただけますと助かります。`,
    },
  ];

  const picked = sampleQuestions[Math.floor(Math.random() * sampleQuestions.length)];

  const newEmail: BrokerIncomingEmail = {
    id: `brk_mail_${Date.now()}`,
    messageId: `<${now.toISOString().slice(0, 10)}-BRK-${Math.floor(1000 + Math.random() * 9000)}@yourcompany.com>`,
    conversationId: `conv_${shipment.id}_${Date.now()}`,
    shipmentId: shipment.id,
    receivedDateTime: now.toISOString(),
    subject: picked.subject,
    brokerName: '社内通関士 (担当)',
    brokerEmail: m365Settings.brokerDefaultEmail || 'customs-brokerage@yourcompany.com',
    receivedAtGroupEmail: m365Settings.groupEmail || 'hellmann-air-ops@yourcompany.com',
    bodyText: picked.bodyText,
    suggestedTitle: picked.title,
    isProcessedToQa: false,
  };

  const all = getBrokerIncomingEmails();
  all.unshift(newEmail);
  saveBrokerIncomingEmails(all);
  return newEmail;
}

/**
 * Create a new Customs QA directly from an incoming broker email in the common group mailbox
 */
export function createQaFromBrokerEmail(shipmentId: string, emailId: string): CustomsQaItem | null {
  const emails = getBrokerIncomingEmails();
  const email = emails.find((e) => e.id === emailId);
  if (!email) return null;

  const m365Settings = getM365Settings();
  const created = addCustomsQuestion(shipmentId, {
    questionText: email.bodyHtml || email.bodyText,
    brokerName: email.brokerName,
    brokerEmail: email.brokerEmail,
    title: email.suggestedTitle || email.subject,
    originalEmailId: email.id,
    subject: email.subject,
    receivedAtGroupEmail: email.receivedAtGroupEmail || m365Settings.groupEmail,
  });

  if (created) {
    email.isProcessedToQa = true;
    saveBrokerIncomingEmails(emails);
  }

  return created;
}

// -------------------------------------------------------------
// 通関士質疑（Q&A）＆ ヘルマン照会リレー (Customs QA Relay)
// -------------------------------------------------------------

/**
 * Create a new broker question on a shipment
 * ※ 通関士とのやり取りもヘルマン社と同じ共通グループメールで送受信
 */
export function addCustomsQuestion(
  shipmentId: string,
  data: {
    questionText: string;
    brokerName: string;
    brokerEmail?: string;
    title?: string;
    originalEmailId?: string;
    subject?: string;
    receivedAtGroupEmail?: string;
  }
): CustomsQaItem | null {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return null;

  const m365Settings = getM365Settings();
  const groupEmail = data.receivedAtGroupEmail || m365Settings.groupEmail || 'hellmann-air-ops@yourcompany.com';

  const newQa: CustomsQaItem = {
    id: `qa_${Date.now()}`,
    shipmentId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'PENDING_HELLMANN',
    title: data.title || (data.questionText.slice(0, 24) + (data.questionText.length > 24 ? '...' : '')),
    brokerQuestion: {
      questionText: data.questionText,
      askedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      brokerName: data.brokerName || '社内通関士',
      brokerEmail: data.brokerEmail || m365Settings.brokerDefaultEmail || 'customs-brokerage@yourcompany.com',
      receivedAtGroupEmail: groupEmail,
      subject: data.subject || `【通関照会】HAWB: ${shipment.hawbNumber || shipment.id} 質問の件`,
      originalEmailId: data.originalEmailId || `broker_mail_${Date.now()}`,
    },
  };

  const currentQas = shipment.customsQas || [];
  const updatedQas = [newQa, ...currentQas];

  updateShipment(shipmentId, {
    customsQas: updatedQas,
  });

  notifyListeners();
  return newQa;
}

/**
 * Step 2: Send inquiry email to Hellmann (from the common group mailbox)
 */
export function sendInquiryToHellmann(
  shipmentId: string,
  qaId: string,
  data: {
    sentContent: string;
    senderName: string;
    subject?: string;
  }
): CustomsQaItem | null {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return null;

  const currentQas = shipment.customsQas || [];
  const qaIndex = currentQas.findIndex((q) => q.id === qaId);
  if (qaIndex === -1) return null;

  const m365Settings = getM365Settings();
  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const updatedQa: CustomsQaItem = {
    ...currentQas[qaIndex],
    updatedAt: new Date().toISOString(),
    status: 'PENDING_HELLMANN',
    hellmannInquiry: {
      sentAt: nowStr,
      senderName: data.senderName,
      sentFromGroupEmail: m365Settings.groupEmail,
      inquiryEmailId: `hlm_inquiry_${Date.now()}`,
      subject: data.subject || `[Re: 通関照会] HAWB: ${shipment.hawbNumber || shipment.id} - ${currentQas[qaIndex].title}`,
      sentContent: data.sentContent,
    },
  };

  currentQas[qaIndex] = updatedQa;
  updateShipment(shipmentId, { customsQas: [...currentQas] });
  notifyListeners();
  return updatedQa;
}

/**
 * Step 3: Receive answer from Hellmann (at the common group mailbox)
 */
export function receiveHellmannAnswer(
  shipmentId: string,
  qaId: string,
  data: {
    answerText: string;
    answerHtml?: string;
    attachments?: EmailAttachment[];
  }
): CustomsQaItem | null {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return null;

  const currentQas = shipment.customsQas || [];
  const qaIndex = currentQas.findIndex((q) => q.id === qaId);
  if (qaIndex === -1) return null;

  const m365Settings = getM365Settings();
  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const updatedQa: CustomsQaItem = {
    ...currentQas[qaIndex],
    updatedAt: new Date().toISOString(),
    status: 'HELLMANN_ANSWERED',
    hellmannAnswer: {
      receivedAt: nowStr,
      answerText: data.answerText,
      answerHtml: data.answerHtml,
      receivedAtGroupEmail: m365Settings.groupEmail,
      answerEmailId: `hlm_ans_${Date.now()}`,
      attachments: data.attachments || [],
    },
  };

  currentQas[qaIndex] = updatedQa;
  updateShipment(shipmentId, { customsQas: [...currentQas] });
  notifyListeners();
  return updatedQa;
}

/**
 * Step 4: Send reply back to customs broker (from the same common group mailbox)
 */
export function replyToBroker(
  shipmentId: string,
  qaId: string,
  data: {
    replyText: string;
    forwardedAttachments?: EmailAttachment[];
  }
): CustomsQaItem | null {
  const shipments = getShipments();
  const shipment = shipments.find((s) => s.id === shipmentId);
  if (!shipment) return null;

  const currentQas = shipment.customsQas || [];
  const qaIndex = currentQas.findIndex((q) => q.id === qaId);
  if (qaIndex === -1) return null;

  const m365Settings = getM365Settings();
  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const updatedQa: CustomsQaItem = {
    ...currentQas[qaIndex],
    updatedAt: new Date().toISOString(),
    status: 'RESOLVED_TO_BROKER',
    brokerReply: {
      sentAt: nowStr,
      replyText: data.replyText,
      sentFromGroupEmail: m365Settings.groupEmail,
      forwardedAttachments: data.forwardedAttachments || [],
    },
  };

  currentQas[qaIndex] = updatedQa;
  updateShipment(shipmentId, { customsQas: [...currentQas] });
  notifyListeners();
  return updatedQa;
}

/**
 * Simulate Hellmann replying to an inquiry with an SDS / Spec PDF attachment
 */
export function simulateHellmannAnswerReply(shipmentId: string, qaId: string): CustomsQaItem | null {
  const mockSdsPdf = createSampleTechSpecPdfDataUrl(
    'SDS_Chemical_Polymer_Compound_Rev2.pdf',
    'SDS (Safety Data Sheet) - Non-DG Verification Certificate'
  );

  return receiveHellmannAnswer(shipmentId, qaId, {
    answerText: `お世話になっております。ヘルマン輸出担当です。
ご照会の件、Shipper（荷主）よりSDSおよび該非判定書を受領いたしました。

該非判定：非該当（木製梱包なし・プラスチックパレット使用）。
危険物判定：非危険物（Non-DG）となります。

添付のSDS（安全データシート）をご確認のほどよろしくお願いいたします。`,
    attachments: [
      {
        id: `att_sds_${Date.now()}`,
        fileName: 'SDS_Chemical_Polymer_Rev2.pdf',
        contentType: 'application/pdf',
        sizeBytes: 215000,
        isPdf: true,
        dataUrl: mockSdsPdf,
      },
      {
        id: `att_cert_${Date.now()}`,
        fileName: 'Non_Wooden_Packaging_Declaration.pdf',
        contentType: 'application/pdf',
        sizeBytes: 85000,
        isPdf: true,
        dataUrl: mockSdsPdf,
      },
    ],
  });
}

// -------------------------------------------------------------
// Unified Mail Client Data & Decision Layer
// -------------------------------------------------------------

interface MailMetaState {
  isRead?: boolean;
  isStarred?: boolean;
  isTrash?: boolean;
  isManualSourceType?: boolean;
  sourceType?: 'HELLMANN_ORDER' | 'BROKER_QUESTION' | 'CUSTOMS_REQUEST' | 'CUSTOMS_INQUIRY' | 'HELLMANN_ANSWER' | 'BROKER_REPLY' | 'GENERAL';
  mawbNumber?: string;
  hawbNumber?: string;
  decisionStatus?: MailDecisionStatus;
  decisionNote?: string;
  decidedAt?: string;
  decidedBy?: string;
}

const MAIL_META_STORE_KEY = 'export_mgmt_unified_mail_meta_v1';
const SENT_MAILS_STORE_KEY = 'export_mgmt_unified_sent_mails_v1';

function getMailMetaStore(): Record<string, MailMetaState> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(MAIL_META_STORE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveMailMetaStore(store: Record<string, MailMetaState>): void {
  if (typeof window === 'undefined') return;
  safeLocalStorageSetItem(MAIL_META_STORE_KEY, JSON.stringify(store));
  notifyListeners();
}

/**
 * Update the attribute / category (sourceType) of any mail item
 */
export function updateMailSourceType(
  mailId: string,
  newSourceType: 'HELLMANN_ORDER' | 'BROKER_QUESTION' | 'CUSTOMS_REQUEST' | 'CUSTOMS_INQUIRY' | 'HELLMANN_ANSWER' | 'BROKER_REPLY' | 'GENERAL'
): void {
  const store = getMailMetaStore();
  const baseId = mailId.replace(/_\d+$/, '');
  const strippedGraph = baseId.replace(/^graph_/, '');

  store[mailId] = {
    ...(store[mailId] || {}),
    sourceType: newSourceType,
    isManualSourceType: true,
  };
  if (baseId !== mailId) {
    store[baseId] = {
      ...(store[baseId] || {}),
      sourceType: newSourceType,
      isManualSourceType: true,
    };
  }
  store[strippedGraph] = {
    ...(store[strippedGraph] || {}),
    sourceType: newSourceType,
    isManualSourceType: true,
  };
  store[`graph_${strippedGraph}`] = {
    ...(store[`graph_${strippedGraph}`] || {}),
    sourceType: newSourceType,
    isManualSourceType: true,
  };
  saveMailMetaStore(store);

  // 1. Update in Graph Inbox / Sent caches if present
  try {
    const inbox = getGraphInboxMails();
    let inboxChanged = false;
    for (const m of inbox) {
      if (
        m.id === mailId ||
        m.id === baseId ||
        m.id === strippedGraph ||
        m.id === `graph_${strippedGraph}` ||
        m.graphMessageId === strippedGraph
      ) {
        m.sourceType = newSourceType;
        inboxChanged = true;
      }
    }
    if (inboxChanged) {
      safeLocalStorageSetItem(GRAPH_INBOX_MAILS_KEY, JSON.stringify(inbox));
    }

    const sent = getGraphSentMails();
    let sentChanged = false;
    for (const m of sent) {
      if (
        m.id === mailId ||
        m.id === baseId ||
        m.id === strippedGraph ||
        m.id === `graph_${strippedGraph}` ||
        m.graphMessageId === strippedGraph
      ) {
        m.sourceType = newSourceType;
        sentChanged = true;
      }
    }
    if (sentChanged) {
      safeLocalStorageSetItem(GRAPH_SENT_MAILS_KEY, JSON.stringify(sent));
    }
  } catch (err) {
    console.warn('Could not update sourceType in graph caches:', err);
  }

  // 2. Update in Hellmann Orders cache if present
  try {
    const rawOrders = localStorage.getItem(HELLMANN_ORDERS_KEY);
    if (rawOrders) {
      const orders = JSON.parse(rawOrders);
      if (Array.isArray(orders)) {
        let changed = false;
        for (const o of orders) {
          if (
            o.id === mailId ||
            o.id === baseId ||
            o.id === strippedGraph ||
            o.id === `graph_${strippedGraph}` ||
            o.messageId === strippedGraph
          ) {
            if (newSourceType !== 'HELLMANN_ORDER') {
              o.status = 'DISMISSED';
              o.notes = o.notes ? `${o.notes} (通関士質疑へ変更)` : '通関士質疑へ変更';
            } else {
              o.status = 'NEW_PENDING_EXTERNAL_REG';
            }
            changed = true;
          }
        }
        if (changed) {
          safeLocalStorageSetItem(HELLMANN_ORDERS_KEY, JSON.stringify(orders));
        }
      }
    }
  } catch (err) {
    console.warn('Could not update sourceType in hellmann orders cache:', err);
  }

  // 3. Update in Broker Incoming Emails cache
  try {
    const rawBroker = localStorage.getItem(BROKER_INCOMING_EMAILS_KEY);
    const brokerList = rawBroker ? JSON.parse(rawBroker) : [];
    if (Array.isArray(brokerList)) {
      let bChanged = false;
      const existingIdx = brokerList.findIndex(
        (b) =>
          b.id === mailId ||
          b.id === baseId ||
          b.id === strippedGraph ||
          b.id === `graph_${strippedGraph}`
      );

      if (newSourceType === 'BROKER_QUESTION' && existingIdx === -1) {
        const allMails = getUnifiedMailMessages();
        const found = allMails.find(
          (m) =>
            m.id === mailId ||
            m.id === baseId ||
            m.id === strippedGraph ||
            m.id === `graph_${strippedGraph}`
        );
        if (found) {
          brokerList.unshift({
            id: found.id,
            subject: found.subject,
            brokerName: found.sender?.name || '通関士',
            brokerEmail: found.sender?.email || 'customs-brokerage@yourcompany.com',
            receivedDateTime: found.receivedOrSentAt || new Date().toISOString(),
            receivedAtGroupEmail: found.toRecipients?.[0],
            toRecipients: found.toRecipients,
            ccRecipients: found.ccRecipients,
            bodyText: found.body || '',
            bodyHtml: found.bodyHtml,
            mawbCandidate: found.mawbNumber,
            hawbCandidate: found.hawbNumber,
            shipmentId: found.shipmentId,
            isProcessedToQa: false,
            notes: 'メール一覧より通関士質疑へ変更',
          });
          bChanged = true;
        }
      } else if (newSourceType !== 'BROKER_QUESTION' && existingIdx !== -1) {
        brokerList.splice(existingIdx, 1);
        bChanged = true;
      }

      if (bChanged) {
        safeLocalStorageSetItem(BROKER_INCOMING_EMAILS_KEY, JSON.stringify(brokerList));
      }
    }
  } catch (err) {
    console.warn('Could not update sourceType in broker emails cache:', err);
  }

  // 4. Update in Customs Email Logs cache
  try {
    const rawLogs = localStorage.getItem('export_mgmt_customs_email_logs_v1');
    if (rawLogs) {
      const logs = JSON.parse(rawLogs);
      if (Array.isArray(logs)) {
        let lChanged = false;
        for (const l of logs) {
          if (
            l.id === mailId ||
            l.id === baseId ||
            l.id === strippedGraph ||
            l.id === `graph_${strippedGraph}`
          ) {
            l.sourceType = newSourceType;
            lChanged = true;
          }
        }
        if (lChanged) {
          safeLocalStorageSetItem('export_mgmt_customs_email_logs_v1', JSON.stringify(logs));
        }
      }
    }
  } catch (err) {
    console.warn('Could not update sourceType in customs logs cache:', err);
  }

  notifyListeners();
}

/**
 * Update or manually set MAWB / HAWB numbers for a mail item
 * When hawbNumber is explicitly empty string (""), it stores as blank without falling back to auto-extracted text
 */
export function updateMailAwbNumbers(
  mailId: string,
  mawbNumber?: string,
  hawbNumber?: string
): void {
  const store = getMailMetaStore();
  const existing = store[mailId] || {};
  const cleanedMawb = mawbNumber !== undefined ? (mawbNumber.trim() ? normalizeMawbNumber(mawbNumber.trim()) : '') : existing.mawbNumber;
  const cleanedHawb = hawbNumber !== undefined ? (hawbNumber.trim() ? cleanHawbNumber(hawbNumber.trim()) || '' : '') : existing.hawbNumber;

  store[mailId] = {
    ...existing,
    mawbNumber: cleanedMawb,
    hawbNumber: cleanedHawb,
  };
  saveMailMetaStore(store);
}

/**
 * Resolve final MAWB / HAWB considering manual overrides and clean fallbacks.
 * If user explicitly saved an empty string (""), hawb is treated as explicitly blank (undefined).
 */
export function resolveAwbCandidates(
  meta: MailMetaState,
  fallbackMawb?: string | null,
  fallbackHawb?: string | null
): { mawb?: string; hawb?: string } {
  // If user explicitly set mawbNumber in meta (even if set to empty string ""), respect user's explicit decision
  const mawb = meta.mawbNumber !== undefined
    ? (meta.mawbNumber.trim() ? normalizeMawbNumber(meta.mawbNumber) : undefined)
    : (fallbackMawb ? normalizeMawbNumber(fallbackMawb) : undefined);

  // If user explicitly set hawbNumber in meta (even if set to empty string ""), respect user's explicit decision
  const hawb = meta.hawbNumber !== undefined
    ? (meta.hawbNumber.trim() ? cleanHawbNumber(meta.hawbNumber) || undefined : undefined)
    : (fallbackHawb ? cleanHawbNumber(fallbackHawb) || undefined : undefined);

  return { mawb: mawb || undefined, hawb: hawb || undefined };
}

/**
 * Exclude a mail from Hellmann Customs Order and set its attribute to "その他メール" (GENERAL)
 */
export function excludeFromHellmannOrder(mailId: string): void {
  updateMailSourceType(mailId, 'GENERAL');
}

export const INITIAL_SENT_MAILS: UnifiedMailItem[] = [
  {
    id: 'sent_mail_init_1',
    sourceType: 'CUSTOMS_REQUEST',
    direction: 'OUTGOING',
    folder: 'SENT',
    isRead: true,
    isStarred: false,
    sender: {
      name: 'TAC 輸出通関窓口',
      email: 'hellmann-air-ops@yourcompany.com',
    },
    toRecipients: ['customs-brokerage@yourcompany.com'],
    ccRecipients: ['export-ops.tyo@hellmann.com'],
    subject: '【通関依頼】輸出通関申告およびSI手配のお願い (MAWB: 205-8841-2900)',
    body: `通関課 輸出通関担当者様\n\nお疲れ様です。TAC輸出オペレーションです。\n下記航空貨物の輸出通関申告手配をお願いいたします。\n\n・MAWB: 205-8841-2900\n・HAWB: HLM-TYO-99420\n・便名/CUT: JL006 / 本日16:30\n・品名: Electronic Inspection Machine & Sensors\n・個数/重量: 12 PKGS / 480.0 KG\n\n添付のSI（出荷指示書）およびインボイスをご確認の上、申告手続きをお願いいたします。`,
    receivedOrSentAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    mawbNumber: '205-8841-2900',
    hawbNumber: 'HLM-TYO-99420',
    decisionStatus: 'DECIDED_FORWARDED_BROKER',
    decidedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: 'sent_mail_init_2',
    sourceType: 'CUSTOMS_INQUIRY',
    direction: 'OUTGOING',
    folder: 'SENT',
    isRead: true,
    isStarred: false,
    sender: {
      name: 'TAC 輸出通関窓口',
      email: 'hellmann-air-ops@yourcompany.com',
    },
    toRecipients: ['export-ops.tyo@hellmann.com'],
    ccRecipients: ['customs-brokerage@yourcompany.com'],
    subject: '【通関確認】SDSおよび該非判定書の送付依頼 (HAWB: HLM-TYO-99421)',
    body: `ヘルマン航空輸出チーム各位\n\nいつも大変お世話になっております。\n標記案件（HAWB: HLM-TYO-99421）について、税関申告の事前確認のため最新のSDS（化学品安全データシート）および該非判定書の提出が必要となっております。\n\n恐れ入りますが、ご確認の上ご送付いただけますと幸いです。`,
    receivedOrSentAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    mawbNumber: '205-8841-2901',
    hawbNumber: 'HLM-TYO-99421',
    decisionStatus: 'DECIDED_INQUIRY_SENT',
    decidedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
];

export function getCustomSentMails(): UnifiedMailItem[] {
  const settings = getM365Settings();
  const isProduction = !settings.isDemoMode;

  if (typeof window === 'undefined') return isProduction ? [] : INITIAL_SENT_MAILS;
  const raw = localStorage.getItem(SENT_MAILS_STORE_KEY);
  if (!raw) {
    if (!isProduction) {
      safeLocalStorageSetItem(SENT_MAILS_STORE_KEY, JSON.stringify(INITIAL_SENT_MAILS));
      return INITIAL_SENT_MAILS;
    }
    return [];
  }
  try {
    const parsed: UnifiedMailItem[] = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (isProduction) {
        return parsed.filter((m) => !isDemoMailOrOrderId(m.id));
      }
      return parsed.length > 0 ? parsed : INITIAL_SENT_MAILS;
    }
    return isProduction ? [] : INITIAL_SENT_MAILS;
  } catch {
    return isProduction ? [] : INITIAL_SENT_MAILS;
  }
}

export function saveCustomSentMail(mail: UnifiedMailItem): void {
  const current = getCustomSentMails();
  const standardizedMail: UnifiedMailItem = {
    ...mail,
    direction: 'OUTGOING',
    folder: 'SENT',
  };
  const updated = [standardizedMail, ...current.filter((m) => m.id !== mail.id)];
  safeLocalStorageSetItem(SENT_MAILS_STORE_KEY, JSON.stringify(updated));
  notifyListeners();
}

// -------------------------------------------------------------
// Real Microsoft Graph API Email Cache & Persistence
// -------------------------------------------------------------

export function getGraphInboxMails(): UnifiedMailItem[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(GRAPH_INBOX_MAILS_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveGraphInboxMails(mails: UnifiedMailItem[]): void {
  if (typeof window === 'undefined') return;
  const sanitized = sanitizeUnifiedMailsForLocalStorage(mails);
  safeLocalStorageSetItem(GRAPH_INBOX_MAILS_KEY, JSON.stringify(sanitized));
  notifyListeners();
}

export function getGraphSentMails(): UnifiedMailItem[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(GRAPH_SENT_MAILS_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveGraphSentMails(mails: UnifiedMailItem[]): void {
  if (typeof window === 'undefined') return;
  const sanitized = sanitizeUnifiedMailsForLocalStorage(mails);
  safeLocalStorageSetItem(GRAPH_SENT_MAILS_KEY, JSON.stringify(sanitized));
  notifyListeners();
}

/**
 * Persist updated attachments for a mail across stores
 */
export function updateMailAttachmentsInStore(mailId: string, attachments: EmailAttachment[]): void {
  if (typeof window === 'undefined' || !mailId || !Array.isArray(attachments)) return;
  const cleanId = mailId.replace(/^graph_/, '').replace(/_\d+$/, '');

  const inbox = getGraphInboxMails();
  let updatedInbox = false;
  const newInbox = inbox.map((m) => {
    if (m.id === mailId || m.id === `graph_${cleanId}` || m.id.replace(/^graph_/, '').replace(/_\d+$/, '') === cleanId) {
      updatedInbox = true;
      return { ...m, attachments };
    }
    return m;
  });
  if (updatedInbox) {
    saveGraphInboxMails(newInbox);
  }

  const sent = getGraphSentMails();
  let updatedSent = false;
  const newSent = sent.map((m) => {
    if (m.id === mailId || m.id === `graph_${cleanId}` || m.id.replace(/^graph_/, '').replace(/_\d+$/, '') === cleanId) {
      updatedSent = true;
      return { ...m, attachments };
    }
    return m;
  });
  if (updatedSent) {
    saveGraphSentMails(newSent);
  }

  const orders = getHellmannNewOrders();
  let updatedOrders = false;
  const newOrders = orders.map((o) => {
    if (o.id === mailId || o.id.replace(/^graph_/, '').replace(/_\d+$/, '') === cleanId) {
      updatedOrders = true;
      return { ...o, attachments };
    }
    return o;
  });
  if (updatedOrders) {
    saveHellmannNewOrders(newOrders);
  }

  const brokerMails = getBrokerIncomingEmails();
  let updatedBroker = false;
  const newBroker = brokerMails.map((b) => {
    if (b.id === mailId || b.id.replace(/^graph_/, '').replace(/_\d+$/, '') === cleanId) {
      updatedBroker = true;
      return { ...b, attachments };
    }
    return b;
  });
  if (updatedBroker) {
    saveBrokerIncomingEmails(newBroker);
  }
}

/**
 * Retrieve all unified mail items combining Hellmann Orders, Broker Questions, Customs Email Logs, Shipment QAs, Sent Mails, and Real Graph API Mails
 */
export function getUnifiedMailMessages(): UnifiedMailItem[] {
  const metaStore = getMailMetaStore();
  const settings = getM365Settings();
  const graphInbox = getGraphInboxMails();
  const graphSent = getGraphSentMails();
  const hellmannOrders = getHellmannNewOrders();
  const brokerEmails = getBrokerIncomingEmails();
  const customsLogs = getEmailLogs();
  const sentMails = getCustomSentMails();
  const shipments = getShipments();

  const rawItems: UnifiedMailItem[] = [];

  // 0. Real Microsoft Graph API Mails (Both Inbox & Sent)
  for (const g of graphInbox) {
    const meta = metaStore[g.id] || {};
    const bodyStr = (g as any).bodyText || g.body || '';
    const logistics = extractLogisticsInfoFromEmailText(bodyStr, g.subject || '');
    const autoSourceType = determineEmailSourceType(
      {
        ...g,
        body: bodyStr,
      },
      settings
    );
    const sourceType = meta.isManualSourceType && meta.sourceType ? meta.sourceType : autoSourceType;
    const isGeneral = sourceType === 'GENERAL';

    const { mawb: resolvedMawb, hawb: resolvedHawb } = resolveAwbCandidates(
      meta,
      g.mawbNumber || logistics.mawb,
      g.hawbNumber || logistics.hawb
    );

    const originalServerTime = g.receivedOrSentAt || (g as any).receivedDateTime || (g as any).sentDateTime;

    const embeddedRecipients = extractRecipientsFromEmailContent(bodyStr, g.bodyHtml);
    const existingTo = Array.isArray(g.toRecipients)
      ? g.toRecipients
      : typeof g.toRecipients === 'string'
      ? [g.toRecipients]
      : [];
    const existingCc = Array.isArray(g.ccRecipients)
      ? g.ccRecipients
      : typeof g.ccRecipients === 'string'
      ? [g.ccRecipients]
      : [];

    const mergedToSet = new Set<string>(existingTo.filter(Boolean));
    for (const t of embeddedRecipients.to) {
      if (t && t.toLowerCase() !== g.sender?.email?.toLowerCase()) {
        mergedToSet.add(t);
      }
    }
    if (mergedToSet.size === 0 && settings.groupEmail) {
      mergedToSet.add(settings.groupEmail);
    }

    const mergedCcSet = new Set<string>(existingCc.filter(Boolean));
    for (const c of embeddedRecipients.cc) {
      if (c && !mergedToSet.has(c) && c.toLowerCase() !== g.sender?.email?.toLowerCase()) {
        mergedCcSet.add(c);
      }
    }

    rawItems.push({
      ...g,
      body: bodyStr,
      sourceType,
      toRecipients: Array.from(mergedToSet),
      ccRecipients: Array.from(mergedCcSet),
      receivedOrSentAt: originalServerTime,
      mawbNumber: resolvedMawb,
      hawbNumber: resolvedHawb,
      direction: 'INCOMING',
      folder: meta.isTrash ? 'TRASH' : 'INBOX',
      isRead: meta.isRead !== undefined ? meta.isRead : g.isRead,
      isStarred: meta.isStarred !== undefined ? meta.isStarred : g.isStarred,
      decisionStatus: meta.decisionStatus || g.decisionStatus || (isGeneral ? 'DECIDED_RESOLVED' : 'PENDING_DECISION'),
      decisionNote: meta.decisionNote || g.decisionNote,
      decidedAt: meta.decidedAt || g.decidedAt,
      decidedBy: meta.decidedBy || g.decidedBy,
    });
  }

  for (const g of graphSent) {
    const meta = metaStore[g.id] || {};
    const bodyStr = (g as any).bodyText || g.body || '';
    const logistics = extractLogisticsInfoFromEmailText(bodyStr, g.subject || '');
    const defaultSentType = g.subject?.includes('通関依頼')
      ? 'CUSTOMS_REQUEST'
      : g.subject?.includes('照会') || g.subject?.includes('質問')
      ? 'CUSTOMS_INQUIRY'
      : 'CUSTOMS_REQUEST';
    const sourceType = meta.sourceType || g.sourceType || defaultSentType;
    const isGeneral = sourceType === 'GENERAL';

    const { mawb: resolvedMawb, hawb: resolvedHawb } = resolveAwbCandidates(
      meta,
      g.mawbNumber || logistics.mawb,
      g.hawbNumber || logistics.hawb
    );

    const originalServerTime = g.receivedOrSentAt || (g as any).sentDateTime || (g as any).receivedDateTime;

    const embeddedRecipients = extractRecipientsFromEmailContent(bodyStr, g.bodyHtml);
    const existingTo = Array.isArray(g.toRecipients)
      ? g.toRecipients
      : typeof g.toRecipients === 'string'
      ? [g.toRecipients]
      : [];
    const existingCc = Array.isArray(g.ccRecipients)
      ? g.ccRecipients
      : typeof g.ccRecipients === 'string'
      ? [g.ccRecipients]
      : [];

    const mergedToSet = new Set<string>(existingTo.filter(Boolean));
    for (const t of embeddedRecipients.to) {
      if (t) mergedToSet.add(t);
    }
    const mergedCcSet = new Set<string>(existingCc.filter(Boolean));
    for (const c of embeddedRecipients.cc) {
      if (c && !mergedToSet.has(c)) {
        mergedCcSet.add(c);
      }
    }

    rawItems.push({
      ...g,
      body: bodyStr,
      sourceType,
      toRecipients: Array.from(mergedToSet),
      ccRecipients: Array.from(mergedCcSet),
      receivedOrSentAt: originalServerTime,
      mawbNumber: resolvedMawb,
      hawbNumber: resolvedHawb,
      direction: 'OUTGOING',
      folder: meta.isTrash ? 'TRASH' : 'SENT',
      isRead: meta.isRead !== undefined ? meta.isRead : true,
      isStarred: meta.isStarred !== undefined ? meta.isStarred : g.isStarred,
      decisionStatus: meta.decisionStatus || g.decisionStatus || 'DECIDED_FORWARDED_BROKER',
      decisionNote: meta.decisionNote || g.decisionNote,
      decidedAt: meta.decidedAt || g.decidedAt,
      decidedBy: meta.decidedBy || g.decidedBy,
    });
  }

  // In production mode (when isDemoMode is false), we strictly exclude all demo/mock/simulated email placeholders
  const isProductionWithGraph = !settings.isDemoMode;

  // 1. Hellmann Order Incoming Emails
  for (const o of hellmannOrders) {
    if (isProductionWithGraph) {
      continue;
    }
    const meta = metaStore[o.id] || {};
    const autoSourceType = determineEmailSourceType(
      {
        sender: { name: o.senderName, email: o.senderEmail },
        toRecipients: o.toRecipients,
        ccRecipients: o.ccRecipients,
        subject: o.subject,
        body: o.bodyText,
        bodyText: o.bodyText,
      },
      settings
    );
    const sourceType = meta.sourceType || (autoSourceType !== 'GENERAL' ? autoSourceType : 'HELLMANN_ORDER');
    let decStatus: MailDecisionStatus = 'PENDING_DECISION';
    if (meta.decisionStatus) {
      decStatus = meta.decisionStatus;
    } else if (o.status === 'PROCESSED_TO_SHIPMENT') {
      decStatus = 'DECIDED_IMPORTED';
    } else if (o.status === 'EXTERNAL_REGISTERED') {
      decStatus = 'DECIDED_EXTERNAL_REGISTERED';
    } else if (o.status === 'DISMISSED') {
      decStatus = 'DECIDED_DISMISSED';
    }
    const { mawb: resolvedMawb, hawb: resolvedHawb } = resolveAwbCandidates(
      meta,
      o.mawbCandidate,
      o.hawbCandidate
    );

    rawItems.push({
      id: o.id,
      sourceType,
      direction: 'INCOMING',
      folder: meta.isTrash ? 'TRASH' : 'INBOX',
      isRead: meta.isRead !== undefined ? meta.isRead : o.status !== 'NEW_PENDING_EXTERNAL_REG',
      isStarred: !!meta.isStarred,
      sender: {
        name: o.senderName || 'Hellmann Worldwide Logistics',
        email: o.senderEmail || 'export-ops.tyo@hellmann.com',
      },
      toRecipients: o.toRecipients && o.toRecipients.length > 0
        ? o.toRecipients
        : [settings.groupEmail || 'tac-hellmann@tac-japan.co.jp'],
      ccRecipients: o.ccRecipients && o.ccRecipients.length > 0
        ? o.ccRecipients
        : ['HMS-JP@hellmann.com', 'kita@tac-japan.co.jp'],
      subject: o.subject,
      body: o.bodyText,
      bodyHtml: o.bodyHtml,
      receivedOrSentAt: o.receivedDateTime,
      mawbNumber: resolvedMawb,
      hawbNumber: resolvedHawb,
      shipmentId: o.processedShipmentId,
      attachments: o.attachments || [],
      decisionStatus: decStatus,
      decisionNote: meta.decisionNote || o.notes,
      decidedAt: meta.decidedAt,
      decidedBy: meta.decidedBy,
      rawHellmannOrder: o,
    });
  }

  // 2. Broker Incoming Emails (Customs Broker Questions to Group Mail)
  for (const b of brokerEmails) {
    if (isProductionWithGraph) {
      continue;
    }
    const meta = metaStore[b.id] || {};
    let decStatus: MailDecisionStatus = 'PENDING_DECISION';
    if (meta.decisionStatus) {
      decStatus = meta.decisionStatus;
    } else if (b.isProcessedToQa) {
      decStatus = 'DECIDED_INQUIRY_SENT';
    }
    const logistics = extractLogisticsInfoFromEmailText(b.bodyText || '', b.subject || '');
    const { mawb: resolvedMawb, hawb: resolvedHawb } = resolveAwbCandidates(
      meta,
      (b as any).mawbCandidate || (b as any).mawbNumber || logistics.mawb,
      (b as any).hawbCandidate || (b as any).hawbNumber || logistics.hawb
    );

    rawItems.push({
      id: b.id,
      sourceType: meta.sourceType || 'BROKER_QUESTION',
      direction: 'INCOMING',
      folder: meta.isTrash ? 'TRASH' : 'INBOX',
      isRead: meta.isRead !== undefined ? meta.isRead : b.isProcessedToQa,
      isStarred: !!meta.isStarred,
      sender: {
        name: b.brokerName || '社内通関士',
        email: b.brokerEmail || 'customs-brokerage@yourcompany.com',
      },
      toRecipients: b.toRecipients && b.toRecipients.length > 0
        ? b.toRecipients
        : [b.receivedAtGroupEmail || settings.groupEmail || 'tac-hellmann@tac-japan.co.jp'],
      ccRecipients: b.ccRecipients || [],
      subject: b.subject,
      body: b.bodyText,
      bodyHtml: b.bodyHtml,
      receivedOrSentAt: b.receivedDateTime,
      mawbNumber: resolvedMawb,
      hawbNumber: resolvedHawb,
      shipmentId: b.shipmentId,
      decisionStatus: decStatus,
      decisionNote: meta.decisionNote,
      decidedAt: meta.decidedAt,
      decidedBy: meta.decidedBy,
      rawBrokerEmail: b,
    });
  }

  // 3. Customs Email Logs (Outgoing to brokers, inquiries to Hellmann, etc.)
  for (const c of customsLogs) {
    if (isProductionWithGraph && (c.id.startsWith('log_fwd_') || c.id.startsWith('mock_') || c.id.startsWith('email_hlm_') || c.id.startsWith('init_'))) {
      continue;
    }
    const meta = metaStore[c.id] || {};
    const isOut = c.direction === 'OUTGOING';
    rawItems.push({
      id: c.id,
      sourceType: meta.sourceType || c.type || (isOut ? 'CUSTOMS_REQUEST' : 'HELLMANN_ANSWER'),
      direction: isOut ? 'OUTGOING' : 'INCOMING',
      folder: meta.isTrash ? 'TRASH' : isOut ? 'SENT' : 'INBOX',
      isRead: meta.isRead !== undefined ? meta.isRead : true,
      isStarred: !!meta.isStarred,
      sender: c.sender,
      toRecipients: c.toRecipients,
      ccRecipients: c.ccRecipients,
      subject: c.subject,
      body: c.body,
      bodyHtml: c.bodyHtml,
      receivedOrSentAt: c.sentOrReceivedAt,
      mawbNumber: c.mawbNumber,
      hawbNumber: c.hawbNumber,
      shipmentId: c.shipmentId,
      attachments: c.attachments,
      decisionStatus: meta.decisionStatus || (isOut ? 'DECIDED_FORWARDED_BROKER' : 'DECIDED_RESOLVED'),
      decisionNote: meta.decisionNote,
      decidedAt: meta.decidedAt || c.sentOrReceivedAt,
    });
  }

  // 4. Custom Sent Mails from Compose modal
  for (const s of sentMails) {
    if (isProductionWithGraph && (s.id.startsWith('sent_mail_init_') || s.id.startsWith('mock_') || s.id.startsWith('init_'))) {
      continue;
    }
    const meta = metaStore[s.id] || {};
    rawItems.push({
      ...s,
      sourceType: meta.sourceType || s.sourceType || 'CUSTOMS_REQUEST',
      direction: 'OUTGOING',
      folder: meta.isTrash ? 'TRASH' : 'SENT',
      isStarred: meta.isStarred !== undefined ? meta.isStarred : s.isStarred,
    });
  }

  // 5. Automatic Integration of Shipment Customs QA Items (Inquiries & Answers)
  for (const s of shipments) {
    if (isProductionWithGraph) {
      continue;
    }
    if (s.customsQas && s.customsQas.length > 0) {
      for (const qa of s.customsQas) {
        // (a) Inquiry sent to Hellmann
        if (qa.hellmannInquiry && qa.hellmannInquiry.sentContent) {
          const inqId = qa.hellmannInquiry.inquiryEmailId || `qa_inq_${qa.id}`;
          const meta = metaStore[inqId] || {};
          rawItems.push({
            id: inqId,
            sourceType: 'CUSTOMS_INQUIRY',
            direction: 'OUTGOING',
            folder: meta.isTrash ? 'TRASH' : 'SENT',
            isRead: true,
            isStarred: !!meta.isStarred,
            sender: {
              name: qa.hellmannInquiry.senderName || 'TAC 輸出通関窓口',
              email: qa.hellmannInquiry.sentFromGroupEmail || 'hellmann-air-ops@yourcompany.com',
            },
            toRecipients: ['export-ops.tyo@hellmann.com'],
            ccRecipients: ['TAC Hellmann TEAM; HMS JP <HMS-JP@hellmann.com>'],
            subject: qa.hellmannInquiry.subject || `[Re: 通関照会] HAWB: ${s.hawbNumber || s.id} - ${qa.title}`,
            body: qa.hellmannInquiry.sentContent,
            receivedOrSentAt: qa.hellmannInquiry.sentAt || s.createdAt || new Date().toISOString(),
            mawbNumber: s.mawbNumber,
            hawbNumber: s.hawbNumber,
            shipmentId: s.id,
            decisionStatus: 'DECIDED_INQUIRY_SENT',
            decidedAt: qa.hellmannInquiry.sentAt,
          });
        }

        // (b) Answer received from Hellmann
        if (qa.hellmannAnswer && qa.hellmannAnswer.answerText) {
          const ansId = qa.hellmannAnswer.answerEmailId || `qa_ans_${qa.id}`;
          const meta = metaStore[ansId] || {};
          rawItems.push({
            id: ansId,
            sourceType: 'HELLMANN_ANSWER',
            direction: 'INCOMING',
            folder: meta.isTrash ? 'TRASH' : 'INBOX',
            isRead: meta.isRead !== undefined ? meta.isRead : true,
            isStarred: !!meta.isStarred,
            sender: {
              name: 'Hellmann Worldwide Logistics',
              email: 'export-ops.tyo@hellmann.com',
            },
            toRecipients: [qa.hellmannAnswer.receivedAtGroupEmail || 'hellmann-air-ops@yourcompany.com'],
            ccRecipients: ['TAC Hellmann TEAM; HMS JP <HMS-JP@hellmann.com>'],
            subject: `[Re: 回答完了] HAWB: ${s.hawbNumber || s.id} - ${qa.title}`,
            body: qa.hellmannAnswer.answerText,
            receivedOrSentAt: qa.hellmannAnswer.receivedAt || s.createdAt || new Date().toISOString(),
            mawbNumber: s.mawbNumber,
            hawbNumber: s.hawbNumber,
            shipmentId: s.id,
            attachments: qa.hellmannAnswer.attachments || [],
            decisionStatus: qa.status === 'RESOLVED_TO_BROKER' ? 'DECIDED_FORWARDED_BROKER' : 'PENDING_DECISION',
            decidedAt: qa.hellmannAnswer.receivedAt,
          });
        }

        // (c) Reply sent to Broker
        if (qa.brokerReply && qa.brokerReply.replyText) {
          const repId = `qa_rep_${qa.id}`;
          const meta = metaStore[repId] || {};
          rawItems.push({
            id: repId,
            sourceType: 'BROKER_REPLY',
            direction: 'OUTGOING',
            folder: meta.isTrash ? 'TRASH' : 'SENT',
            isRead: true,
            isStarred: !!meta.isStarred,
            sender: {
              name: 'TAC 輸出通関担当',
              email: qa.brokerReply.sentFromGroupEmail || 'hellmann-air-ops@yourcompany.com',
            },
            toRecipients: ['customs-brokerage@yourcompany.com'],
            subject: `[回答連絡] HAWB: ${s.hawbNumber || s.id} - ${qa.title}`,
            body: qa.brokerReply.replyText,
            receivedOrSentAt: qa.brokerReply.sentAt || s.createdAt || new Date().toISOString(),
            mawbNumber: s.mawbNumber,
            hawbNumber: s.hawbNumber,
            shipmentId: s.id,
            attachments: qa.brokerReply.forwardedAttachments || [],
            decisionStatus: 'DECIDED_FORWARDED_BROKER',
            decidedAt: qa.brokerReply.sentAt,
          });
        }
      }
    }
  }

  // Deduplicate emails by graphMessageId and message content fingerprint (e.g.同一メールがInboxとSentItems両方に存在する場合の重複除去)
  const finalItems: UnifiedMailItem[] = [];
  const seenGraphIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  const uniqueIdSet = new Set<string>();

  for (const item of rawItems) {
    // Check graphMessageId
    const gId = item.graphMessageId || (item.id && item.id.startsWith('graph_') ? item.id.replace(/^graph_/, '') : undefined);
    if (gId && seenGraphIds.has(gId)) {
      continue; // Skip duplicate Graph message ID
    }

    // Check content fingerprint (Subject + Sender + Timestamp + Body preview)
    const normSubject = (item.subject || '').trim().toLowerCase().replace(/^(re|fwd|回答|照会):\s*/gi, '');
    const normSender = (item.sender?.email || '').trim().toLowerCase();
    const normTime = item.receivedOrSentAt ? (parseDateString(item.receivedOrSentAt)?.toISOString() || item.receivedOrSentAt) : '';
    const normBody = (item.body || '').trim().slice(0, 100).replace(/\s+/g, ' ');
    const fingerprint = `${normSubject}|${normSender}|${normTime}|${normBody}`;

    if (fingerprint.length > 20 && seenFingerprints.has(fingerprint)) {
      continue; // Skip duplicate message with identical content & timestamp
    }

    // Register seen markers
    if (gId) seenGraphIds.add(gId);
    if (fingerprint.length > 20) seenFingerprints.add(fingerprint);

    let uniqueId = item.id;
    let counter = 1;
    while (uniqueIdSet.has(uniqueId)) {
      uniqueId = `${item.id}_${counter++}`;
    }
    uniqueIdSet.add(uniqueId);

    // Keep original server timestamp string if present, fallback only if empty/null
    let validDate = item.receivedOrSentAt || (item as any).receivedDateTime || (item as any).sentDateTime;
    const parsedDate = parseDateString(validDate);
    if (!validDate || (!parsedDate && typeof validDate !== 'string')) {
      validDate = new Date().toISOString();
    }

    // Retention Period filter (by specified start date or days window)
    const mode = settings.syncRetentionMode || 'days';
    let cutoffTimestamp = 0;

    if (mode === 'date' && settings.syncRetentionStartDate) {
      const parsedStart = parseDateString(settings.syncRetentionStartDate) || new Date(`${settings.syncRetentionStartDate}T00:00:00`);
      if (parsedStart && !isNaN(parsedStart.getTime())) {
        cutoffTimestamp = parsedStart.getTime();
      }
    } else {
      const retentionDays = Number(settings.syncRetentionDays !== undefined ? settings.syncRetentionDays : 7);
      if (retentionDays > 0) {
        cutoffTimestamp = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      }
    }

    if (cutoffTimestamp > 0) {
      const itemTimestamp = parsedDate ? parsedDate.getTime() : new Date(validDate).getTime();
      if (itemTimestamp > 0 && itemTimestamp < cutoffTimestamp) {
        // Skip older items outside retention window
        continue;
      }
    }

    finalItems.push({ ...item, id: uniqueId, receivedOrSentAt: validDate });
  }

  // Sort by receivedOrSentAt descending (newest first)
  return finalItems.sort((a, b) => {
    const da = parseDateString(a.receivedOrSentAt)?.getTime() || 0;
    const db = parseDateString(b.receivedOrSentAt)?.getTime() || 0;
    return db - da;
  });
}

/**
 * Toggle Starred status
 */
export function toggleMailStarred(mailId: string): boolean {
  const store = getMailMetaStore();
  const current = store[mailId] || {};
  const nextStarred = !current.isStarred;
  store[mailId] = { ...current, isStarred: nextStarred };
  saveMailMetaStore(store);
  return nextStarred;
}

/**
 * Mark mail as read or unread
 */
export function setMailReadState(mailId: string, isRead: boolean): void {
  const store = getMailMetaStore();
  const current = store[mailId] || {};
  if (current.isRead === isRead) return;
  store[mailId] = { ...current, isRead };
  saveMailMetaStore(store);
}

/**
 * Move mail to Trash / Restore
 */
export function setMailTrashState(mailId: string, isTrash: boolean): void {
  const store = getMailMetaStore();
  const current = store[mailId] || {};
  if (current.isTrash === isTrash) return;
  store[mailId] = { ...current, isTrash };
  saveMailMetaStore(store);
}

/**
 * Record a decision on a mail item
 */
export function applyMailDecision(
  mailId: string,
  decision: MailDecisionStatus,
  options?: { note?: string; decidedBy?: string }
): void {
  const store = getMailMetaStore();
  const current = store[mailId] || {};
  const now = new Date().toISOString();

  store[mailId] = {
    ...current,
    decisionStatus: decision,
    decisionNote: options?.note || current.decisionNote,
    decidedAt: now,
    decidedBy: options?.decidedBy || '通関オペレーター',
    isRead: true,
  };
  saveMailMetaStore(store);

  // Sync with HellmannNewOrder if this is an order
  const orders = getHellmannNewOrders();
  const targetOrder = orders.find((o) => o.id === mailId);
  if (targetOrder) {
    if (decision === 'DECIDED_IMPORTED') {
      targetOrder.status = 'PROCESSED_TO_SHIPMENT';
    } else if (decision === 'DECIDED_EXTERNAL_REGISTERED') {
      targetOrder.status = 'EXTERNAL_REGISTERED';
    } else if (decision === 'DECIDED_DISMISSED') {
      targetOrder.status = 'DISMISSED';
    }
    if (options?.note) targetOrder.notes = options.note;
    saveHellmannNewOrders(orders);
  }

  // Sync with BrokerIncomingEmail if this is a broker question
  const brokerMails = getBrokerIncomingEmails();
  const targetBrokerMail = brokerMails.find((b) => b.id === mailId);
  if (targetBrokerMail) {
    if (decision === 'DECIDED_INQUIRY_SENT' || decision === 'DECIDED_RESOLVED') {
      targetBrokerMail.isProcessedToQa = true;
    }
    saveBrokerIncomingEmails(brokerMails);
  }

  notifyListeners();
}

/**
 * Build rich reply bodies (both Plain Text and Rich HTML with Signature and Full Quoted Original Mail).
 * Reflects exact fonts, text sizes, colors, borders, tables, and images from the original email.
 */
export function buildReplyBodies(options: {
  replyText: string;
  originalMail: UnifiedMailItem;
  operatorName?: string;
}): { plainBody: string; htmlBody: string } {
  const { replyText, originalMail, operatorName } = options;
  const signature = getUserSignature(operatorName);

  // 1. Format date for quotation header
  const sentDateStr = originalMail.receivedOrSentAt
    ? new Date(originalMail.receivedOrSentAt).toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const senderName = originalMail.sender?.name || '';
  const senderEmail = originalMail.sender?.email || '';
  const fromDisplay = senderEmail ? (senderName ? `${senderName} <${senderEmail}>` : senderEmail) : senderName;
  const toDisplay = Array.isArray(originalMail.toRecipients)
    ? originalMail.toRecipients.join('; ')
    : String(originalMail.toRecipients || '');
  const ccDisplay = Array.isArray(originalMail.ccRecipients) && originalMail.ccRecipients.length > 0
    ? originalMail.ccRecipients.join('; ')
    : '';
  const subjectDisplay = originalMail.subject || '';

  // 2. Plain text construction
  const originalPlainContent = (originalMail.body || '').trim();
  const plainBody = `${replyText.trim()}

${signature}

----- 元のメッセージ / Original Message -----
差出人: ${fromDisplay}
送信日時: ${sentDateStr}
宛先: ${toDisplay}${ccDisplay ? `\nCC: ${ccDisplay}` : ''}
件名: ${subjectDisplay}

${originalPlainContent}`.trim();

  // 3. Rich HTML construction
  const escapeHtml = (str: string) =>
    (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const escapedReplyHtml = escapeHtml(replyText).replace(/\n/g, '<br/>');
  const escapedSignatureHtml = escapeHtml(signature).replace(/\n/g, '<br/>');

  let originalHtmlContent = '';
  if (originalMail.bodyHtml && originalMail.bodyHtml.trim()) {
    originalHtmlContent = sanitizeEmailHtml(originalMail.bodyHtml, originalMail.attachments);
  } else {
    // If no HTML, wrap plain text in clean pre-wrap
    const escapedPlain = escapeHtml(originalMail.body || '').replace(/\n/g, '<br/>');
    originalHtmlContent = `<div style="white-space: pre-wrap; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Hiragino Sans', 'Meiryo', monospace, sans-serif; font-size: 13.5px; line-height: 1.6; color: #1e293b;">${escapedPlain}</div>`;
  }

  const htmlBody = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Hiragino Sans', 'Meiryo', sans-serif; font-size: 11pt; color: #1e293b; line-height: 1.65;">
  <div style="margin-bottom: 20px;">
    ${escapedReplyHtml}
  </div>

  <div style="margin-top: 24px; margin-bottom: 24px; padding-top: 14px; border-top: 1px dashed #cbd5e1; font-size: 10.5pt; color: #334155; line-height: 1.6;">
    ${escapedSignatureHtml}
  </div>

  <hr style="display:inline-block; width:100%; border:none; border-top:1px solid #cbd5e1; margin: 28px 0 16px 0;" />
  <div style="background-color: #f8fafc; border-left: 4px solid #6366f1; padding: 12px 16px; margin-bottom: 20px; font-size: 10pt; line-height: 1.6; color: #334155; border-radius: 0 8px 8px 0;">
    <div style="margin-bottom: 3px;"><b>差出人:</b> ${escapeHtml(fromDisplay)}</div>
    <div style="margin-bottom: 3px;"><b>送信日時:</b> ${escapeHtml(sentDateStr)}</div>
    <div style="margin-bottom: 3px;"><b>宛先:</b> ${escapeHtml(toDisplay)}</div>
    ${ccDisplay ? `<div style="margin-bottom: 3px;"><b>CC:</b> ${escapeHtml(ccDisplay)}</div>` : ''}
    <div style="margin-bottom: 0;"><b>件名:</b> ${escapeHtml(subjectDisplay)}</div>
  </div>

  <div class="quoted-original-email-content" style="color: inherit; word-break: break-word;">
    ${originalHtmlContent}
  </div>
</div>`;

  return { plainBody, htmlBody };
}

/**
 * Send a newly composed email and record it to the sent folder
 */
export function sendOutgoingMailFromClient(data: {
  toRecipients: string[];
  ccRecipients?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  attachments?: EmailAttachment[];
  senderName?: string;
  senderEmail?: string;
  decisionStatus?: MailDecisionStatus;
  mawbNumber?: string;
  hawbNumber?: string;
  shipmentId?: string;
}): UnifiedMailItem {
  const m365Settings = getM365Settings();
  const now = new Date().toISOString();
  const id = `sent_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  const newMail: UnifiedMailItem = {
    id,
    sourceType: 'CUSTOMS_REQUEST',
    direction: 'OUTGOING',
    folder: 'SENT',
    isRead: true,
    isStarred: false,
    sender: {
      name: data.senderName || '輸出オペレーションチーム (M365 Group)',
      email: data.senderEmail || m365Settings.groupEmail,
    },
    toRecipients: data.toRecipients,
    ccRecipients: data.ccRecipients || [],
    subject: data.subject,
    body: data.body,
    bodyHtml: data.bodyHtml,
    receivedOrSentAt: now,
    attachments: data.attachments || [],
    decisionStatus: data.decisionStatus || 'DECIDED_FORWARDED_BROKER',
    decidedAt: now,
    decidedBy: data.senderName || 'オペレーター',
    mawbNumber: data.mawbNumber,
    hawbNumber: data.hawbNumber,
    shipmentId: data.shipmentId,
  };

  saveCustomSentMail(newMail);

  // Also log to CustomsEmailLog in storageManager for cross-component thread visibility
  addCustomsEmailLog({
    id,
    shipmentId: data.shipmentId,
    mawbNumber: data.mawbNumber,
    hawbNumber: data.hawbNumber,
    direction: 'OUTGOING',
    type: 'CUSTOMS_REQUEST',
    status: 'SENT',
    sentOrReceivedAt: now,
    sender: newMail.sender,
    toRecipients: newMail.toRecipients,
    ccRecipients: newMail.ccRecipients,
    subject: newMail.subject,
    body: newMail.body,
    bodyHtml: newMail.bodyHtml,
    attachments: newMail.attachments,
  });

  return newMail;
}

/**
 * Helper to safely parse JSON response and prevent "Unexpected token '<', <!doctype..." syntax errors
 */
async function safeFetchJson<T = any>(res: Response): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const status = res.status;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    if (text.includes('<!DOCTYPE') || text.includes('<!doctype') || text.includes('<html')) {
      return {
        ok: false,
        status,
        error: `バックエンドAPIエンドポイント未応答 (HTTP ${status})`,
      };
    }
    try {
      const parsed = JSON.parse(text);
      return { ok: res.ok, status, data: parsed };
    } catch {
      return { ok: false, status, error: text || `HTTP ${status}` };
    }
  }

  try {
    const data = (await res.json()) as T;
    return { ok: res.ok, status, data };
  } catch (err: any) {
    return { ok: false, status, error: err.message || 'JSON解析エラー' };
  }
}

/**
 * Perform real Microsoft Graph API connection test via backend proxy
 */
export async function testM365ConnectionViaBackend(settings?: Partial<M365Settings>): Promise<{
  success: boolean;
  message: string;
  mailbox?: {
    id?: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  };
}> {
  const current = settings ? { ...getM365Settings(), ...settings } : getM365Settings();

  if (current.isDemoMode) {
    return {
      success: true,
      message: `接続成功 (デモモード): Microsoft 365 共通グループメール [${current.groupEmail}] との通信シミュレーションが確立されました。`,
    };
  }

  if (!current.tenantId || !current.clientId) {
    return {
      success: false,
      message: 'テナントID (Tenant ID) および クライアントID (Client ID) を入力してください。',
    };
  }

  try {
    const res = await fetch('/api/m365/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: current.tenantId,
        clientId: current.clientId,
        clientSecret: current.clientSecret,
        groupEmail: current.groupEmail,
        userPrincipalName: current.userPrincipalName,
      }),
    });

    const { ok, status, data, error } = await safeFetchJson<any>(res);
    if (!ok || !data || !data.success) {
      return {
        success: false,
        message: data?.error || data?.message || error || `接続テストに失敗しました (HTTP ${status})。`,
      };
    }

    return {
      success: true,
      message: data.message || `Microsoft Graph API 接続成功: 共有メールボックス [${current.groupEmail}] にアクセス可能です。`,
      mailbox: data.mailbox,
    };
  } catch (err: any) {
    console.warn('Backend Graph API test connection warning:', err?.message || err);
    return {
      success: false,
      message: `サーバー通信エラー: ${err.message || '接続に失敗しました'}`,
    };
  }
}

/**
 * Fetch list of users/shared mailboxes in the connected Entra ID tenant
 */
export async function fetchTenantUsersFromBackend(settings?: Partial<M365Settings>): Promise<{
  success: boolean;
  users: Array<{ id: string; displayName: string; mail: string; userPrincipalName: string }>;
  error?: string;
}> {
  const current = settings ? { ...getM365Settings(), ...settings } : getM365Settings();
  if (current.isDemoMode) {
    return { success: true, users: [] };
  }
  if (!current.tenantId || !current.clientId) {
    return { success: false, users: [], error: 'テナントIDとクライアントIDが必要です。' };
  }

  try {
    const res = await fetch('/api/m365/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: current.tenantId,
        clientId: current.clientId,
        clientSecret: current.clientSecret,
      }),
    });

    const { ok, data, error } = await safeFetchJson<any>(res);
    if (!ok || !data || !data.success) {
      return { success: false, users: [], error: data?.error || error || 'ユーザー一覧の取得に失敗しました。' };
    }
    return { success: true, users: data.users || [] };
  } catch (err: any) {
    return { success: false, users: [], error: err.message || '通信エラーが発生しました。' };
  }
}

/**
 * Synchronize real incoming and/or outgoing emails from Microsoft Graph API via backend proxy
 */
export async function syncM365EmailsFromGraphAPI(folder: 'inbox' | 'sent' | 'both' = 'both'): Promise<{
  success: boolean;
  inboxCount: number;
  sentCount: number;
  totalSynced: number;
  userNotFound?: boolean;
  availableUsers?: Array<{ id: string; displayName: string; mail: string; userPrincipalName: string }>;
  message: string;
}> {
  const settings = getM365Settings();

  if (settings.isDemoMode) {
    notifyListeners();
    return {
      success: true,
      inboxCount: getHellmannNewOrders().length + getBrokerIncomingEmails().length,
      sentCount: getCustomSentMails().length,
      totalSynced: getUnifiedMailMessages().length,
      message: 'デモモード同期が完了しました。',
    };
  }

  // If M365 integration is disabled, quietly return without firing unnecessary API calls
  if (settings.enabled === false) {
    return {
      success: false,
      inboxCount: 0,
      sentCount: 0,
      totalSynced: 0,
      message: 'M365連携は無効に設定されています。',
    };
  }

  try {
    const res = await fetch('/api/m365/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: settings.tenantId,
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        groupEmail: settings.groupEmail,
        userPrincipalName: settings.userPrincipalName,
        limit: 50,
        folder,
        retentionDays: settings.syncRetentionDays !== undefined ? settings.syncRetentionDays : 7,
        retentionStartDate: settings.syncRetentionMode === 'date' ? settings.syncRetentionStartDate : undefined,
      }),
    });

    const { ok, status, data, error } = await safeFetchJson<any>(res);
    if (!ok || !data || !data.success) {
      const noticeMsg = data?.error || error || `HTTP ${status} 同期に失敗しました`;
      console.warn('M365 sync response notice:', noticeMsg);
      return {
        success: false,
        inboxCount: 0,
        sentCount: 0,
        totalSynced: 0,
        userNotFound: !!data?.userNotFound,
        availableUsers: data?.availableUsers,
        message: noticeMsg,
      };
    }

    const { inbox = [], sent = [] } = data;

    const nowIso = new Date().toISOString();
    syncTimerState.lastSyncTime = nowIso;
    if (folder === 'both' || folder === 'inbox') {
      syncTimerState.lastInboxSyncTime = nowIso;
    }
    if (folder === 'both' || folder === 'sent') {
      syncTimerState.lastSentSyncTime = nowIso;
    }
    notifyTimerListeners();

    // Save synced Graph API emails to local cache based on requested folder
    if (folder === 'both' || folder === 'inbox') {
      saveGraphInboxMails(inbox);
    }
    if (folder === 'both' || folder === 'sent') {
      saveGraphSentMails(sent);
    }
    notifyListeners();

    const folderDesc =
      folder === 'inbox'
        ? `受信トレイ (${inbox.length}件)`
        : folder === 'sent'
        ? `送信済みトレイ (${sent.length}件)`
        : `受信: ${inbox.length}件, 送信: ${sent.length}件`;

    return {
      success: true,
      inboxCount: inbox.length,
      sentCount: sent.length,
      totalSynced: inbox.length + sent.length,
      message: `Microsoft Graph API から同期完了 (${folderDesc})`,
    };
  } catch (err: any) {
    console.warn('M365 Graph API sync warning:', err?.message || err);
    return {
      success: false,
      inboxCount: 0,
      sentCount: 0,
      totalSynced: 0,
      message: `同期エラー: ${err.message || 'Microsoft Graph API との通信に失敗しました'}`,
    };
  }
}

/**
 * Send email asynchronously via Microsoft Graph API if in production mode
 */
export async function sendMailViaGraphBackend(data: {
  toRecipients: string[];
  ccRecipients?: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  attachments?: EmailAttachment[];
}): Promise<{ success: boolean; isSkipped?: boolean; error?: string; message?: string }> {
  const settings = getM365Settings();
  if (settings.isDemoMode) {
    return {
      success: false,
      isSkipped: true,
      error: 'M365連携が「デモモード」になっているため、実際の外部メール送信は行われませんでした。',
    };
  }
  if (!settings.tenantId || !settings.clientId) {
    return {
      success: false,
      isSkipped: true,
      error: 'M365 (Azure AD) の Tenant ID または Client ID が設定されていないため、外部送信はスキップされました。',
    };
  }

  try {
    const res = await fetch('/api/m365/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: settings.tenantId,
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        groupEmail: settings.groupEmail,
        userPrincipalName: settings.userPrincipalName,
        toRecipients: data.toRecipients,
        ccRecipients: data.ccRecipients,
        subject: data.subject,
        body: data.body,
        isHtml: data.isHtml ?? true,
        attachments: data.attachments,
      }),
    });

    const { ok, data: result, error } = await safeFetchJson<any>(res);
    return {
      success: ok && !!result?.success,
      error: result?.error || error,
      message: result?.message,
    };
  } catch (err: any) {
    console.warn('Failed to send mail via Graph API proxy:', err?.message || err);
    return {
      success: false,
      error: err.message || 'メール送信サービスとの通信中にエラーが発生しました。',
    };
  }
}

/**
 * Sync status tracker for background timer listeners
 */
export interface M365SyncTimerState {
  lastSyncTime: string | null;
  lastInboxSyncTime: string | null;
  lastSentSyncTime: string | null;
  isInboxSyncing: boolean;
  isSentSyncing: boolean;
  nextInboxSyncRemainingSec: number;
  nextSentSyncRemainingSec: number;
}

let syncTimerState: M365SyncTimerState = {
  lastSyncTime: null,
  lastInboxSyncTime: null,
  lastSentSyncTime: null,
  isInboxSyncing: false,
  isSentSyncing: false,
  nextInboxSyncRemainingSec: 120,
  nextSentSyncRemainingSec: 300,
};

const timerListeners = new Set<(state: M365SyncTimerState) => void>();

export function getM365SyncTimerState(): M365SyncTimerState {
  return { ...syncTimerState };
}

export function subscribeM365SyncTimerState(listener: (state: M365SyncTimerState) => void): () => void {
  timerListeners.add(listener);
  listener(getM365SyncTimerState());
  return () => {
    timerListeners.delete(listener);
  };
}

function notifyTimerListeners() {
  const current = getM365SyncTimerState();
  timerListeners.forEach((l) => {
    try {
      l(current);
    } catch (_) {}
  });
}

/**
 * Independent auto-sync timers for Inbox (e.g. 120s) and SentItems (e.g. 300s).
 * Listens to Firestore real-time settings changes so when any user updates the seconds,
 * all open tabs adapt immediately without page reload.
 * Also decrements remaining seconds in 10-second steps to keep the UI timer updated smoothly.
 */
export function initM365AutoSyncTimers(): () => void {
  if (typeof window === 'undefined') return () => {};

  const initSettings = getM365Settings();
  if (!initSettings.enabled || initSettings.isDemoMode) {
    return () => {};
  }

  let tickTimerId: any = null;
  let isUnmounted = false;

  let remainingInboxSec = 120;
  let remainingSentSec = 300;

  const runInboxSync = async () => {
    if (isUnmounted || syncTimerState.isInboxSyncing) return;
    const settings = getM365Settings();
    if (!settings.enabled || settings.isDemoMode) return;

    syncTimerState.isInboxSyncing = true;
    notifyTimerListeners();
    try {
      await syncM365EmailsFromGraphAPI('inbox');
      const nowIso = new Date().toISOString();
      syncTimerState.lastInboxSyncTime = nowIso;
      syncTimerState.lastSyncTime = nowIso;
    } catch (err) {
      console.warn('[AutoSync Inbox] Error:', err);
    } finally {
      syncTimerState.isInboxSyncing = false;
      const settings = getM365Settings();
      remainingInboxSec = Math.max(10, Number(settings.inboxSyncIntervalSeconds) || 120);
      syncTimerState.nextInboxSyncRemainingSec = remainingInboxSec;
      notifyTimerListeners();
    }
  };

  const runSentSync = async () => {
    if (isUnmounted || syncTimerState.isSentSyncing) return;
    const settings = getM365Settings();
    if (!settings.enabled || settings.isDemoMode) return;

    syncTimerState.isSentSyncing = true;
    notifyTimerListeners();
    try {
      await syncM365EmailsFromGraphAPI('sent');
      const nowIso = new Date().toISOString();
      syncTimerState.lastSentSyncTime = nowIso;
      syncTimerState.lastSyncTime = nowIso;
    } catch (err) {
      console.warn('[AutoSync Sent] Error:', err);
    } finally {
      syncTimerState.isSentSyncing = false;
      const settings = getM365Settings();
      remainingSentSec = Math.max(10, Number(settings.sentSyncIntervalSeconds) || 300);
      syncTimerState.nextSentSyncRemainingSec = remainingSentSec;
      notifyTimerListeners();
    }
  };

  const resetIntervals = () => {
    const settings = getM365Settings();
    remainingInboxSec = Math.max(10, Number(settings.inboxSyncIntervalSeconds) || 120);
    remainingSentSec = Math.max(10, Number(settings.sentSyncIntervalSeconds) || 300);
    syncTimerState.nextInboxSyncRemainingSec = remainingInboxSec;
    syncTimerState.nextSentSyncRemainingSec = remainingSentSec;
    notifyTimerListeners();
  };

  resetIntervals();

  // 10-second tick timer
  tickTimerId = setInterval(() => {
    if (isUnmounted) return;
    const settings = getM365Settings();
    if (!settings.enabled || settings.isDemoMode) return;

    remainingInboxSec -= 10;
    remainingSentSec -= 10;

    if (remainingInboxSec <= 0) {
      remainingInboxSec = Math.max(10, Number(settings.inboxSyncIntervalSeconds) || 120);
      runInboxSync();
    }
    if (remainingSentSec <= 0) {
      remainingSentSec = Math.max(10, Number(settings.sentSyncIntervalSeconds) || 300);
      runSentSync();
    }

    syncTimerState.nextInboxSyncRemainingSec = Math.max(0, remainingInboxSec);
    syncTimerState.nextSentSyncRemainingSec = Math.max(0, remainingSentSec);
    notifyTimerListeners();
  }, 10000);

  // Run initial check after 5s if never synced
  const initialDelay = setTimeout(() => {
    if (!isUnmounted && !syncTimerState.lastSyncTime) {
      runInboxSync();
    }
  }, 5000);

  // Subscribe to settings changes (local & Firestore cloud) to dynamically adjust interval
  const unsubSettings = subscribeM365Store(() => {
    if (!isUnmounted) {
      resetIntervals();
    }
  });

  return () => {
    isUnmounted = true;
    clearTimeout(initialDelay);
    if (tickTimerId) clearInterval(tickTimerId);
    unsubSettings();
  };
}

/**
 * Fetch a specific email attachment on-demand from Microsoft Graph API via server proxy
 */
export async function fetchAttachmentOnDemand(
  messageId: string,
  attachmentId: string
): Promise<{ success: boolean; attachment?: EmailAttachment; error?: string }> {
  const settings = getM365Settings();
  if (settings.isDemoMode) {
    return {
      success: false,
      error: 'デモモード中はこの操作は利用できません。',
    };
  }

  try {
    const res = await fetch('/api/m365/attachment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: settings.tenantId,
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        groupEmail: settings.groupEmail,
        userPrincipalName: settings.userPrincipalName,
        messageId,
        attachmentId,
      }),
    });

    const { ok, data, error } = await safeFetchJson<any>(res);
    if (!ok || !data?.success || !data?.attachment) {
      return {
        success: false,
        error: data?.error || error || '添付ファイルの取得に失敗しました。',
      };
    }

    return {
      success: true,
      attachment: data.attachment,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || '添付ファイルの通信に失敗しました。',
    };
  }
}

/**
 * Fetch all attachments for a specific message from Microsoft Graph API via server proxy
 */
export async function fetchMessageAttachmentsFromGraphAPI(
  messageId: string
): Promise<{ success: boolean; attachments: EmailAttachment[]; error?: string }> {
  const settings = getM365Settings();
  if (settings.isDemoMode) {
    return {
      success: false,
      attachments: [],
      error: 'デモモード中はこの操作は利用できません。',
    };
  }

  try {
    const res = await fetch('/api/m365/message-attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: settings.tenantId,
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        groupEmail: settings.groupEmail,
        userPrincipalName: settings.userPrincipalName,
        messageId,
      }),
    });

    const { ok, data, error } = await safeFetchJson<any>(res);
    if (!ok || !data?.success) {
      return {
        success: false,
        attachments: [],
        error: data?.error || error || '添付ファイル一覧の取得に失敗しました。',
      };
    }

    return {
      success: true,
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
    };
  } catch (err: any) {
    return {
      success: false,
      attachments: [],
      error: err.message || '添付ファイル一覧の通信に失敗しました。',
    };
  }
}

