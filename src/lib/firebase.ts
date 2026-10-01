import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  Firestore,
} from "firebase/firestore";
import { getAuth, Auth, onAuthStateChanged } from "firebase/auth";
import firebaseConfigJson from "../../firebase-applet-config.json";
import {
  StaffMember,
  QuotationItem,
  QuoteMessage,
  QuoteStatus,
  StickyNote,
  ChatMessage,
  Supplier,
  SupplierInquiryTemplate,
  INITIAL_DEFAULT_SUPPLIERS,
  DEFAULT_SUPPLIER_TEMPLATES,
} from "../types";
import { recordFirestoreQuotaError } from "./firestoreMonitor";
import { toastNotifier } from "./toastNotifier";

let app: FirebaseApp;
let db: Firestore | null = null;
let auth: Auth | null = null;

try {
  app = getApps().length === 0 ? initializeApp(firebaseConfigJson) : getApps()[0];
  db = getFirestore(app, firebaseConfigJson.firestoreDatabaseId || undefined);
  auth = getAuth(app);
} catch (e) {
  console.warn("Firebase initialization warning (using local persistent store):", e);
}

export { db, auth };

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

let lastQuotaToastTime = 0;

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  if (errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("limit exceeded")) {
    recordFirestoreQuotaError(path, errMsg, auth?.currentUser?.email || undefined);
    const now = Date.now();
    if (now - lastQuotaToastTime > 60000) {
      lastQuotaToastTime = now;
      toastNotifier.show({
        type: "warning",
        title: "Firestore Free Quota 到達（ローカルキャッシュ稼働中）",
        message: "本日のFirestore無料枠（50,000回）の上限に達しました。ローカル保存データにて操作を継続します。翌日0時に自動リセットされます。",
        duration: 10000,
      });
    }
  }
}

// Helper to recursively remove `undefined` properties before sending to Firestore
export function cleanForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => (typeof item === "object" && item !== null ? cleanForFirestore(item) : item)) as unknown as T;
  }
  if (typeof data === "object") {
    if (data instanceof Date) {
      return data;
    }
    const cleaned: Record<string, any> = {};
    Object.keys(data as Record<string, any>).forEach((key) => {
      const val = (data as Record<string, any>)[key];
      if (val !== undefined) {
        cleaned[key] = typeof val === "object" && val !== null ? cleanForFirestore(val) : val;
      }
    });
    return cleaned as T;
  }
  return data;
}

// Sample initial staff members
export const INITIAL_SAMPLE_STAFF: StaffMember[] = [
  {
    id: "staff-1",
    name: "喜多 健二",
    email: "kita@tac-japan.co.jp",
    employeeNumber: "EMP-001",
  },
  {
    id: "staff-2",
    name: "山田 太郎",
    email: "yamada.sales@marinetrade.co.jp",
    employeeNumber: "EMP-002",
  },
  {
    id: "staff-3",
    name: "斉藤 操",
    email: "saito.op@marinetrade.co.jp",
    employeeNumber: "EMP-003",
  },
];

// Sample initial data for marine spare parts quotations
export const INITIAL_SAMPLE_QUOTES: QuotationItem[] = [
  {
    id: "quote-101",
    title: "M/V OCEAN GLORY 主機関NO.1シリンダライナ＆ピストンエアー手配",
    vesselName: "M/V OCEAN GLORY",
    airportCodes: ["SIN"],
    customsClearanceDate: "2026-08-10",
    isUrgent: true,
    status: "requested",
    createdBy: "yamada.sales@marinetrade.co.jp",
    assignedStaffId: "staff-1",
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    lastRepliedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    readBy: ["yamada.sales@marinetrade.co.jp"], // Unread for other users!
    quickMemo: {
      text: "シンガポール向けエアー見積回答待ち。現地代理店へ確認中。",
      updatedAt: new Date(Date.now() - 3600000 * 3).toISOString(),
      updatedBy: "yamada.sales@marinetrade.co.jp",
      updatedByName: "山田 太郎",
    },
    externalLinks: [
      {
        title: "見積原価計算シート(Drive)",
        url: "https://drive.google.com/file/d/sample-cost-sheet-ocean-glory",
      },
    ],
  },
  {
    id: "quote-102",
    title: "M/V PACIFIC WAVE ターボチャージャーロータアセンブリ急送見積",
    vesselName: "M/V PACIFIC WAVE",
    airportCodes: ["BKK"],
    customsClearanceDate: "2026-08-12",
    isUrgent: false,
    status: "estimated",
    createdBy: "saito.op@marinetrade.co.jp",
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    lastRepliedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    readBy: ["saito.op@marinetrade.co.jp", "yamada.sales@marinetrade.co.jp"],
    externalLinks: [
      {
        title: "航空輸送費用比較表(Excel)",
        url: "https://docs.google.com/spreadsheets/d/sample-air-freight-bkk",
      },
    ],
  },
  {
    id: "quote-103",
    title: "M/V NIPPON MARU 発電機エンジン冷却水ポンプ予備品",
    vesselName: "M/V NIPPON MARU",
    airportCodes: ["HND", "NRT"],
    customsClearanceDate: "2026-08-08",
    isUrgent: false,
    status: "requested",
    createdBy: "yamada.sales@marinetrade.co.jp",
    createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
    lastRepliedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
    readBy: ["yamada.sales@marinetrade.co.jp"],
  },
  {
    id: "quote-104",
    title: "M/V ASIAN EXPRESS 燃料噴射弁ノズル＆弁箱セット急行手配",
    vesselName: "M/V ASIAN EXPRESS",
    airportCodes: ["SIN"],
    customsClearanceDate: "2026-08-06",
    isUrgent: true,
    status: "re_estimating",
    createdBy: "tanaka.air@marinetrade.co.jp",
    createdAt: new Date(Date.now() - 3600000 * 30).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    lastRepliedAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    readBy: ["tanaka.air@marinetrade.co.jp"],
  },
  {
    id: "quote-105",
    title: "OCEAN HARVEST 主機シリンダーライナー＆ピストンリング緊急手配",
    vesselName: "OCEAN HARVEST",
    airportCodes: ["LAX", "OSA"],
    weightBreak: "+500kg",
    customsClearanceDate: new Date().toISOString().split("T")[0],
    shipperName: "GHI Inc",
    etdDate: new Date().toISOString().split("T")[0],
    etaDate: new Date(Date.now() + 86400000 * 6).toISOString().split("T")[0],
    isUrgent: true,
    status: "accepted",
    arrangementUrgency: "risk",
    assignedStaffId: "staff-1",
    createdBy: "yamada.sales@marinetrade.co.jp",
    quickMemo: {
      text: "インボイス・Packing List確認済。シッパー出荷前確認待ち（午後連絡予定）",
      updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      updatedBy: "kita@tac-japan.co.jp",
      updatedByName: "喜多 健二",
    },
    arrangementMemo: "インボイス・Packing List確認済。シッパー出荷前確認待ち（午後連絡予定）",
    arrangementTasks: {
      1: { completed: true, completedBy: "喜多 健二", completedAt: new Date(Date.now() - 3600000 * 24).toISOString() },
      2: { completed: true, completedBy: "喜多 健二", completedAt: new Date(Date.now() - 3600000 * 18).toISOString() },
      3: { completed: true, completedBy: "喜多 健二", completedAt: new Date(Date.now() - 3600000 * 12).toISOString() },
      4: { completed: false }, // Risk step 4 uncompleted
      5: { completed: false },
      6: { completed: false },
      7: { completed: false },
    },
    createdAt: new Date(Date.now() - 3600000 * 72).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    lastRepliedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    readBy: ["saito.op@marinetrade.co.jp", "yamada.sales@marinetrade.co.jp", "kita@tac-japan.co.jp"],
  },
  {
    id: "quote-107",
    title: "CLEAN VISION 発電機エンジン冷却海水ポンプASSY急送",
    vesselName: "CLEAN VISION",
    airportCodes: ["ICN", "KIX"],
    weightBreak: "+100kg",
    customsClearanceDate: new Date(Date.now() + 86400000).toISOString().split("T")[0],
    shipperName: "XYZ Trading",
    etdDate: new Date(Date.now() + 86400000).toISOString().split("T")[0],
    etaDate: new Date(Date.now() + 86400000 * 4).toISOString().split("T")[0],
    isUrgent: false,
    status: "accepted",
    arrangementUrgency: "in_progress",
    assignedStaffId: "staff-1",
    createdBy: "tanaka.air@marinetrade.co.jp",
    arrangementTasks: {
      1: { completed: true, completedBy: "喜多 健二", completedAt: new Date(Date.now() - 3600000 * 12).toISOString() },
      2: { completed: true, completedBy: "喜多 健二", completedAt: new Date(Date.now() - 3600000 * 6).toISOString() },
      3: { completed: false },
      4: { completed: false },
      5: { completed: false },
      6: { completed: false },
      7: { completed: false },
    },
    createdAt: new Date(Date.now() - 3600000 * 36).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 6).toISOString(),
    lastRepliedAt: new Date(Date.now() - 3600000 * 6).toISOString(),
    readBy: ["tanaka.air@marinetrade.co.jp"],
  },
  {
    id: "quote-108",
    title: "ALEXANDER ボイラー制御基板＆電磁弁スペアキット",
    vesselName: "ALEXANDER",
    airportCodes: ["HAM", "TYO"],
    weightBreak: "-45kg",
    customsClearanceDate: new Date(Date.now() + 86400000 * 2).toISOString().split("T")[0],
    shipperName: "Nordic Parts AS",
    etdDate: new Date(Date.now() + 86400000 * 2).toISOString().split("T")[0],
    etaDate: new Date(Date.now() + 86400000 * 7).toISOString().split("T")[0],
    isUrgent: false,
    status: "accepted",
    arrangementUrgency: "smooth",
    assignedStaffId: "staff-2",
    createdBy: "saito.op@marinetrade.co.jp",
    arrangementTasks: {
      1: { completed: true, completedBy: "山田 太郎", completedAt: new Date(Date.now() - 3600000 * 20).toISOString() },
      2: { completed: true, completedBy: "山田 太郎", completedAt: new Date(Date.now() - 3600000 * 15).toISOString() },
      3: { completed: true, completedBy: "山田 太郎", completedAt: new Date(Date.now() - 3600000 * 10).toISOString() },
      4: { completed: true, completedBy: "山田 太郎", completedAt: new Date(Date.now() - 3600000 * 5).toISOString() },
      5: { completed: false },
      6: { completed: false },
      7: { completed: false },
    },
    createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    lastRepliedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    readBy: ["saito.op@marinetrade.co.jp", "yamada.sales@marinetrade.co.jp"],
  },
  {
    id: "quote-109",
    title: "MSC LORETTO 冷凍コンテナ用コンプレッサーバルブ急送",
    vesselName: "MSC LORETTO",
    airportCodes: ["NYC", "YOK"],
    weightBreak: "+300kg",
    customsClearanceDate: new Date(Date.now() + 86400000 * 4).toISOString().split("T")[0],
    shipperName: "Global Marine Logistics",
    etdDate: new Date(Date.now() + 86400000 * 4).toISOString().split("T")[0],
    etaDate: new Date(Date.now() + 86400000 * 10).toISOString().split("T")[0],
    isUrgent: false,
    status: "accepted",
    arrangementUrgency: "arranging",
    assignedStaffId: "staff-1",
    createdBy: "yamada.sales@marinetrade.co.jp",
    arrangementTasks: {
      1: { completed: true, completedBy: "喜多 健二", completedAt: new Date(Date.now() - 3600000 * 8).toISOString() },
      2: { completed: true, completedBy: "喜多 健二", completedAt: new Date(Date.now() - 3600000 * 4).toISOString() },
      3: { completed: false },
      4: { completed: false },
      5: { completed: false },
      6: { completed: false },
      7: { completed: false },
    },
    createdAt: new Date(Date.now() - 3600000 * 18).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    lastRepliedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    readBy: ["yamada.sales@marinetrade.co.jp"],
  },
  {
    id: "quote-106",
    title: "M/V ORIENT SPIRIT 油水分離器用スペアフィルターカートン",
    vesselName: "M/V ORIENT SPIRIT",
    airportCodes: ["DXB"],
    customsClearanceDate: "",
    isUrgent: false,
    status: "closed_or_on_hold",
    createdBy: "yamada.sales@marinetrade.co.jp",
    createdAt: new Date(Date.now() - 3600000 * 120).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 90).toISOString(),
    lastRepliedAt: new Date(Date.now() - 3600000 * 90).toISOString(),
    readBy: ["yamada.sales@marinetrade.co.jp"],
  },
];

export const INITIAL_SAMPLE_MESSAGES: QuoteMessage[] = [
  {
    id: "msg-101-1",
    quoteId: "quote-101",
    authorEmail: "yamada.sales@marinetrade.co.jp",
    authorName: "山田 太郎 (営業)",
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    contentHtml: `<p>本船 M/V OCEAN GLORY のシリンダライナ（320kg）およびピストンリングセット（60kg）のシンガポール（SIN）向け航空輸送見積の依頼を受信しました。</p>
    <p>ETA SIN: 2026年7月30日。本船入港後即時納入が必要な緊急案件です。航空会社枠の確保と概算概算運賃の算出をお願いします。</p>`,
    externalLinks: [
      {
        title: "本船動静・代理店連絡先(PDF)",
        url: "https://drive.google.com/file/d/vessel-schedule-ocean-glory",
      },
    ],
  },
  {
    id: "msg-101-2",
    quoteId: "quote-101",
    authorEmail: "tanaka.air@marinetrade.co.jp",
    authorName: "田中 健一 (航空業務)",
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    contentHtml: `<p>シンガポール航空 (SQ) 直行便のスペース確認が取れました。以下が概算見積金額となります。</p>
    <div class="overflow-x-auto my-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"><table class="w-full text-xs text-left border-collapse">
      <tr class="bg-slate-100 dark:bg-slate-800 font-semibold border-b"><th class="px-3 py-2 border-r">項目</th><th class="px-3 py-2 border-r">重量/数量</th><th class="px-3 py-2 border-r">単価 (JPY)</th><th class="px-3 py-2">金額 (JPY)</th></tr>
      <tr class="border-b"><td class="px-3 py-2 border-r">Air Freight (SQ Direct)</td><td class="px-3 py-2 border-r">380 kg</td><td class="px-3 py-2 border-r">¥850 /kg</td><td class="px-3 py-2">¥323,000</td></tr>
      <tr class="border-b"><td class="px-3 py-2 border-r">Fuel & FSC / SSC</td><td class="px-3 py-2 border-r">380 kg</td><td class="px-3 py-2 border-r">¥180 /kg</td><td class="px-3 py-2">¥68,400</td></tr>
      <tr class="border-b"><td class="px-3 py-2 border-r">Handling & Customs</td><td class="px-3 py-2 border-r">1 Lot</td><td class="px-3 py-2 border-r">¥35,000</td><td class="px-3 py-2">¥35,000</td></tr>
      <tr class="bg-amber-50 dark:bg-amber-950 font-bold"><td class="px-3 py-2 border-r" colspan="3">合計概算費用 (TAX Excluded)</td><td class="px-3 py-2 text-amber-700 dark:text-amber-300">¥426,400</td></tr>
    </table></div>
    <p>💡 フライト手配はカットオフ前日15時までに確定をお願いいたします。</p>`,
  },
  {
    id: "msg-102-1",
    quoteId: "quote-102",
    authorEmail: "saito.op@marinetrade.co.jp",
    authorName: "斎藤 華 (オペレーション)",
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    contentHtml: `<p>M/V PACIFIC WAVE バンコク（BKK）向けターボチャージャーロータ（145kg）の見積回答を顧客へ提出完了しました。</p>`,
  },
];

// LocalStorage Persistence Keys
const STORAGE_KEY_QUOTES = "marine_quotes_data_v1";
const STORAGE_KEY_MESSAGES = "marine_messages_data_v1";
const STORAGE_KEY_STAFF = "marine_staff_data_v1";
const STORAGE_KEY_CHAT_MESSAGES = "marine_chat_messages_data_v1";

/**
 * Safe local storage setter with quota protection and fallback trimming
 */
function safeSetLocalStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err: any) {
    const isQuota =
      err?.name === "QuotaExceededError" ||
      err?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      (typeof err?.message === "string" && err.message.toLowerCase().includes("quota"));

    if (isQuota) {
      console.warn(`LocalStorage quota reached for key "${key}". Attempting cleanup...`);
      try {
        // Remove legacy or large redundant storage items if present
        const redundantKeys = [
          "app_background",
          "marine_messages_data_backup",
          "marine_quotes_data_backup",
        ];
        redundantKeys.forEach((k) => localStorage.removeItem(k));

        // Try setting again
        localStorage.setItem(key, value);
        return true;
      } catch (retryErr) {
        console.warn(`LocalStorage fallback cleanup could not store full key "${key}". Skipping offline cache write safely.`);
        return false;
      }
    }
    console.warn(`Failed to set localStorage key "${key}":`, err);
    return false;
  }
}

export function loadLocalStaff(): StaffMember[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STAFF);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse local staff:", e);
  }
  saveLocalStaff(INITIAL_SAMPLE_STAFF);
  return INITIAL_SAMPLE_STAFF;
}

export function saveLocalStaff(staff: StaffMember[]) {
  try {
    safeSetLocalStorage(STORAGE_KEY_STAFF, JSON.stringify(staff));
  } catch (e) {
    console.warn("Could not save staff to localStorage:", e);
  }
}

export function loadLocalQuotes(): QuotationItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_QUOTES);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse local quotes:", e);
  }
  saveLocalQuotes(INITIAL_SAMPLE_QUOTES);
  return INITIAL_SAMPLE_QUOTES;
}

export function saveLocalQuotes(quotes: QuotationItem[]) {
  try {
    // Keep most recent 100 quotes in local storage cache to keep storage footprint small
    const trimmed = quotes.slice(0, 100);
    const success = safeSetLocalStorage(STORAGE_KEY_QUOTES, JSON.stringify(trimmed));
    if (!success && trimmed.length > 30) {
      // Further trim if quota is tight
      safeSetLocalStorage(STORAGE_KEY_QUOTES, JSON.stringify(trimmed.slice(0, 30)));
    }
  } catch (e) {
    console.warn("Could not save quotes to localStorage:", e);
  }
}

/**
 * Sanitize message items for offline local cache (strips oversized inline base64/attachments)
 */
function sanitizeMessageForLocalCache(msg: QuoteMessage): QuoteMessage {
  let content = msg.contentHtml || "";
  // Strip large inline base64 images from HTML (> 10KB data URI) to prevent LocalStorage quota exhaustion
  if (content.includes("data:image/") && content.length > 10240) {
    content = content.replace(/src="data:image\/[^;]+;base64,[^"]{10240,}"/g, 'src="" data-cached-image="stripped"');
  }

  const sanitizedLinks = msg.externalLinks?.map((link) => {
    if (link.url && link.url.startsWith("data:") && link.url.length > 10240) {
      return {
        ...link,
        url: "",
      };
    }
    return link;
  });

  return {
    ...msg,
    contentHtml: content,
    externalLinks: sanitizedLinks,
  };
}

export function loadLocalMessages(): QuoteMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MESSAGES);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse local messages:", e);
  }
  saveLocalMessages(INITIAL_SAMPLE_MESSAGES);
  return INITIAL_SAMPLE_MESSAGES;
}

export function saveLocalMessages(messages: QuoteMessage[]) {
  try {
    // 1. Keep only the most recent 80 messages for offline/initial boot cache
    const recentMessages = messages.slice(-80);
    // 2. Strip large base64 attachments from local cache (Firestore retains the full originals)
    const sanitized = recentMessages.map(sanitizeMessageForLocalCache);
    
    const success = safeSetLocalStorage(STORAGE_KEY_MESSAGES, JSON.stringify(sanitized));
    if (!success && sanitized.length > 25) {
      // If quota still exceeded, trim to latest 25 messages
      const emergencyTrimmed = sanitized.slice(-25);
      safeSetLocalStorage(STORAGE_KEY_MESSAGES, JSON.stringify(emergencyTrimmed));
    }
  } catch (e) {
    console.warn("Could not save messages to localStorage:", e);
  }
}

// Sample initial Kanban Chat Messages
export const INITIAL_SAMPLE_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: "chat-msg-1",
    authorEmail: "yamada.sales@marinetrade.co.jp",
    authorName: "山田 太郎 (営業)",
    content: "みなさんお疲れ様です。本日の羽田・成田向けエア便手配の件、進捗いかがでしょうか？ @喜多 健二 @斉藤 操",
    createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    mentions: ["kita@tac-japan.co.jp", "saito.op@marinetrade.co.jp"],
    readBy: ["yamada.sales@marinetrade.co.jp"],
  },
  {
    id: "chat-msg-2",
    authorEmail: "saito.op@marinetrade.co.jp",
    authorName: "斉藤 操 (オペレーション)",
    content: "山田さん、BKK行きのバンコク便スペース確保完了しました！通関書類準備中です。",
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    mentions: [],
    readBy: ["saito.op@marinetrade.co.jp", "yamada.sales@marinetrade.co.jp"],
  },
  {
    id: "chat-msg-3",
    authorEmail: "kita@tac-japan.co.jp",
    authorName: "喜多 健二",
    content: "@山田 太郎 (営業) SIN行きの緊急パーツ件、シンガポール航空直行便で最終調整中です。16時までに回答します。",
    createdAt: new Date(Date.now() - 3600000 * 1).toISOString(),
    mentions: ["yamada.sales@marinetrade.co.jp"],
    readBy: ["kita@tac-japan.co.jp"],
  },
];

export function loadLocalChatMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHAT_MESSAGES);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse local chat messages:", e);
  }
  saveLocalChatMessages(INITIAL_SAMPLE_CHAT_MESSAGES);
  return INITIAL_SAMPLE_CHAT_MESSAGES;
}

export function saveLocalChatMessages(messages: ChatMessage[]) {
  try {
    const recent = messages.slice(-60);
    const success = safeSetLocalStorage(STORAGE_KEY_CHAT_MESSAGES, JSON.stringify(recent));
    if (!success && recent.length > 20) {
      safeSetLocalStorage(STORAGE_KEY_CHAT_MESSAGES, JSON.stringify(recent.slice(-20)));
    }
  } catch (e) {
    console.warn("Could not save chat messages to localStorage:", e);
  }
}

// Sample initial sticky notes for Backstage canvas (裏画面 付箋ボード)
export const INITIAL_SAMPLE_STICKY_NOTES: StickyNote[] = [
  {
    id: "note-101",
    title: "⚓ 全体共有：緊急船用品航空便の注意事項",
    content: "【連絡事項】\nシンガポール (SIN) 及びバンコク (BKK) 向けの危急品手配時、関税関係書類（Proforma Invoice / Packing List）の送付漏れにご注意ください。\n直近のフライト枠確保は前日15時カットオフとなります。",
    color: "yellow",
    x: 40,
    y: 30,
    width: 320,
    links: [
      {
        id: "link-1",
        title: "成田/羽田 航空貨物取扱手順ガイド",
        url: "https://www.japan-air-cargo.example.com/guide",
      },
    ],
    createdBy: "yamada.sales@marinetrade.co.jp",
    createdByName: "山田 太郎 (営業)",
    createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    zIndex: 1,
  },
  {
    id: "note-102",
    title: "✈️ 主要代理店・空港担当連絡先リンク集",
    content: "各主要港・空港における本船船用品デリバリー担当代理店のポータルサイト及び社内共通フォルダ一覧。",
    color: "blue",
    x: 390,
    y: 30,
    width: 320,
    links: [
      {
        id: "link-2",
        title: "SIN代理店 OceanPort Logistics",
        url: "https://oceanport-singapore.example.com",
      },
      {
        id: "link-3",
        title: "BKK代理店 ThaiMarine Freight",
        url: "https://thaimarine-bkk.example.com",
      },
    ],
    createdBy: "saito.op@marinetrade.co.jp",
    createdByName: "斉藤 操 (オペレーション)",
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 6).toISOString(),
    zIndex: 2,
  },
  {
    id: "note-103",
    title: "📸 主機関スペアパーツ識別写真メモ",
    content: "シリンダライナ・ピストンリング・ターボチャージャーロータの標準梱包仕様です。木枠梱包時はVCI防錆紙の同封を徹底してください。",
    color: "green",
    x: 740,
    y: 30,
    width: 340,
    imageUrl: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
    links: [
      {
        id: "link-4",
        title: "梱包ガイドライン仕様書 (PDF)",
        url: "https://drive.google.com/file/d/packing-guidelines",
      },
    ],
    createdBy: "kita@tac-japan.co.jp",
    createdByName: "喜多 健二",
    createdAt: new Date(Date.now() - 3600000 * 10).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    zIndex: 3,
  },
];

const STORAGE_KEY_STICKY_NOTES = "marine_sticky_notes_data_v1";

export function loadLocalStickyNotes(): StickyNote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STICKY_NOTES);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse local sticky notes:", e);
  }
  saveLocalStickyNotes(INITIAL_SAMPLE_STICKY_NOTES);
  return INITIAL_SAMPLE_STICKY_NOTES;
}

export function saveLocalStickyNotes(notes: StickyNote[]) {
  try {
    localStorage.setItem(STORAGE_KEY_STICKY_NOTES, JSON.stringify(notes));
  } catch (e) {
    console.error("Failed to save local sticky notes:", e);
  }
}

// ========================================================
// サプライヤーマスタ (Suppliers Master) Persistence & Sync
// ========================================================

const STORAGE_KEY_SUPPLIERS = "marine_suppliers_master_v1";

export function loadLocalSuppliers(): Supplier[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SUPPLIERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error("Failed to parse local suppliers:", e);
  }
  saveLocalSuppliers(INITIAL_DEFAULT_SUPPLIERS);
  return INITIAL_DEFAULT_SUPPLIERS;
}

export function saveLocalSuppliers(suppliers: Supplier[]) {
  try {
    localStorage.setItem(STORAGE_KEY_SUPPLIERS, JSON.stringify(suppliers));
  } catch (e) {
    console.error("Failed to save local suppliers:", e);
  }
}

export function subscribeSuppliers(
  onUpdate: (suppliers: Supplier[]) => void,
  onError?: (err: any) => void
): () => void {
  // Always emit local state immediately for instant UI render
  const initialLocal = loadLocalSuppliers();
  onUpdate(initialLocal);

  if (!db) {
    return () => {};
  }

  const suppliersRef = collection(db, "suppliers");
  const unsub = onSnapshot(
    suppliersRef,
    (snapshot) => {
      if (snapshot.empty) {
        // If Firestore collection is empty, seed with default initial suppliers
        INITIAL_DEFAULT_SUPPLIERS.forEach((sup) => {
          setDoc(doc(db!, "suppliers", sup.id), cleanForFirestore(sup)).catch((e) =>
            console.warn("Failed to seed initial supplier to firestore:", e)
          );
        });
        onUpdate(INITIAL_DEFAULT_SUPPLIERS);
        saveLocalSuppliers(INITIAL_DEFAULT_SUPPLIERS);
      } else {
        const list: Supplier[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as Supplier);
        });
        list.sort((a, b) => a.name.localeCompare(b.name, "ja"));
        saveLocalSuppliers(list);
        onUpdate(list);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, "suppliers");
      if (onError) onError(error);
      // Fallback to local
      onUpdate(loadLocalSuppliers());
    }
  );

  return unsub;
}

export async function saveSupplier(supplier: Supplier): Promise<void> {
  const current = loadLocalSuppliers();
  const idx = current.findIndex((s) => s.id === supplier.id);
  let nextList: Supplier[];
  if (idx >= 0) {
    nextList = [...current];
    nextList[idx] = { ...supplier, updatedAt: new Date().toISOString() };
  } else {
    nextList = [
      ...current,
      {
        ...supplier,
        id: supplier.id || `sup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        createdAt: supplier.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }
  saveLocalSuppliers(nextList);

  if (!db) return;
  const targetId = supplier.id || `sup_${Date.now()}`;
  const targetDoc = { ...supplier, id: targetId, updatedAt: new Date().toISOString() };
  try {
    await setDoc(doc(db, "suppliers", targetId), cleanForFirestore(targetDoc));
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `suppliers/${targetId}`);
  }
}

export async function deleteSupplier(supplierId: string): Promise<void> {
  const current = loadLocalSuppliers();
  const nextList = current.filter((s) => s.id !== supplierId);
  saveLocalSuppliers(nextList);

  if (!db) return;
  try {
    await deleteDoc(doc(db, "suppliers", supplierId));
  } catch (e) {
    handleFirestoreError(e, OperationType.DELETE, `suppliers/${supplierId}`);
  }
}

// ========================================================
// 問合せメールひな型 (Email Inquiry Templates) Sync
// ========================================================

const STORAGE_KEY_TEMPLATES = "marine_inquiry_templates_v1";

export function loadLocalEmailTemplates(): SupplierInquiryTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TEMPLATES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error("Failed to parse local templates:", e);
  }
  saveLocalEmailTemplates(DEFAULT_SUPPLIER_TEMPLATES);
  return DEFAULT_SUPPLIER_TEMPLATES;
}

export function saveLocalEmailTemplates(templates: SupplierInquiryTemplate[]) {
  try {
    localStorage.setItem(STORAGE_KEY_TEMPLATES, JSON.stringify(templates));
  } catch (e) {
    console.error("Failed to save local templates:", e);
  }
}

export function subscribeEmailTemplates(
  onUpdate: (templates: SupplierInquiryTemplate[]) => void,
  onError?: (err: any) => void
): () => void {
  // Always emit local state immediately for instant UI render
  const initialLocal = loadLocalEmailTemplates();
  onUpdate(initialLocal);

  if (!db) {
    return () => {};
  }

  const templatesRef = collection(db, "email_templates");
  const unsub = onSnapshot(
    templatesRef,
    (snapshot) => {
      if (snapshot.empty) {
        // Seed default templates
        DEFAULT_SUPPLIER_TEMPLATES.forEach((tpl) => {
          setDoc(doc(db!, "email_templates", tpl.id), cleanForFirestore(tpl)).catch((e) =>
            console.warn("Failed to seed initial template to firestore:", e)
          );
        });
        onUpdate(DEFAULT_SUPPLIER_TEMPLATES);
        saveLocalEmailTemplates(DEFAULT_SUPPLIER_TEMPLATES);
      } else {
        const list: SupplierInquiryTemplate[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as SupplierInquiryTemplate);
        });
        list.sort((a, b) => a.patternNumber - b.patternNumber);
        saveLocalEmailTemplates(list);
        onUpdate(list);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, "email_templates");
      if (onError) onError(error);
      onUpdate(loadLocalEmailTemplates());
    }
  );

  return unsub;
}

export async function saveEmailTemplate(template: SupplierInquiryTemplate): Promise<void> {
  const current = loadLocalEmailTemplates();
  const idx = current.findIndex((t) => t.id === template.id);
  let nextList: SupplierInquiryTemplate[];
  if (idx >= 0) {
    nextList = [...current];
    nextList[idx] = { ...template, updatedAt: new Date().toISOString() };
  } else {
    nextList = [
      ...current,
      {
        ...template,
        id: template.id || `tpl_${Date.now()}`,
        updatedAt: new Date().toISOString(),
      },
    ];
  }
  saveLocalEmailTemplates(nextList);

  if (!db) return;
  const targetId = template.id || `tpl_${Date.now()}`;
  const targetDoc = { ...template, id: targetId, updatedAt: new Date().toISOString() };
  try {
    await setDoc(doc(db, "email_templates", targetId), cleanForFirestore(targetDoc));
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `email_templates/${targetId}`);
  }
}

export async function deleteEmailTemplate(templateId: string): Promise<void> {
  const current = loadLocalEmailTemplates();
  const nextList = current.filter((t) => t.id !== templateId);
  saveLocalEmailTemplates(nextList);

  if (!db) return;
  try {
    await deleteDoc(doc(db, "email_templates", templateId));
  } catch (e) {
    handleFirestoreError(e, OperationType.DELETE, `email_templates/${templateId}`);
  }
}

export async function resetDefaultEmailTemplates(): Promise<void> {
  saveLocalEmailTemplates(DEFAULT_SUPPLIER_TEMPLATES);
  if (!db) return;
  for (const tpl of DEFAULT_SUPPLIER_TEMPLATES) {
    try {
      await setDoc(doc(db, "email_templates", tpl.id), cleanForFirestore(tpl));
    } catch (e) {
      console.warn("Failed to reset template:", e);
    }
  }
}

