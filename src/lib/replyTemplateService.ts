import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { ReplyTemplate } from '../types';

export const DEFAULT_REPLY_TEMPLATES: ReplyTemplate[] = [
  {
    id: 'tmpl_confirm',
    orderNumber: 1,
    title: '確認受領',
    category: '一般',
    body: `お世話になっております。輸出オペレーション担当です。
標記の件、確認いたしました。

よろしくお願い申し上げます。`,
  },
  {
    id: 'tmpl_weight',
    orderNumber: 2,
    title: '重量確定',
    category: '重量',
    body: `通関士各位

お疲れ様です。本件、最終計量によりグロス重量が確定いたしましたのでご連絡いたします。
【確定重量】: {重量}
【個数】: {個数}
【AWB番号】: {AWB}

申告内容への反映および通関手続きの進行をよろしくお願いいたします。`,
  },
  {
    id: 'tmpl_doc_replace',
    orderNumber: 3,
    title: '書類差し替え',
    category: '書類',
    body: `通関士各位

お疲れ様です。本件、Shipperより差し替えインボイスおよびパッキングリストを受領いたしましたので回送いたします。
【AWB番号】: {AWB}
【荷主】: {荷主}

ご確認および差し替え申告のご対応をお願い申し上げます。`,
  },
  {
    id: 'tmpl_doc_forward',
    orderNumber: 4,
    title: '書類回送',
    category: '書類',
    body: `通関士各位

お疲れ様です。本件、Shipperより該非判定書およびSDSを受領いたしましたので回送いたします。
【AWB番号】: {AWB}

ご確認のほどよろしくお願いいたします。`,
  },
  {
    id: 'tmpl_xray_ok',
    orderNumber: 5,
    title: 'X線検査OK',
    category: '通関・検査',
    body: `通関士各位

お疲れ様です。本件、X線検査が完了し異常なし（OK）の結果となりましたのでご連絡いたします。
【AWB番号】: {AWB}

引き続き許可手続きのほどよろしくお願いいたします。`,
  },
  {
    id: 'tmpl_cargo_in',
    orderNumber: 6,
    title: '搬入完了',
    category: '保税・搬入',
    body: `通関士各位

お疲れ様です。本件、保税倉庫への貨物搬入が完了いたしました。
【AWB番号】: {AWB}
【個数 / 重量】: {個数} / {重量}

ご確認のほどよろしくお願いいたします。`,
  },
];

const REPLY_TEMPLATES_COLLECTION = 'reply_templates';
const LOCAL_REPLY_TEMPLATES_KEY = 'export_mgmt_reply_templates_v1';

/**
 * LocalStorageから定型文一覧を取得
 */
export function getLocalReplyTemplates(): ReplyTemplate[] {
  try {
    const saved = localStorage.getItem(LOCAL_REPLY_TEMPLATES_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.sort((a, b) => a.orderNumber - b.orderNumber);
      }
    }
  } catch (e) {
    // Ignore error
  }
  return DEFAULT_REPLY_TEMPLATES;
}

/**
 * LocalStorageへ定型文一覧を保存
 */
export function saveLocalReplyTemplates(items: ReplyTemplate[]): void {
  try {
    const sorted = [...items].sort((a, b) => a.orderNumber - b.orderNumber);
    localStorage.setItem(LOCAL_REPLY_TEMPLATES_KEY, JSON.stringify(sorted));
  } catch (e) {
    // Ignore error
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number = 2500): Promise<T> {
  let timer: any = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Firestore timeout'));
    }, ms);
  });
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeoutPromise,
  ]);
}

/**
 * 全ユーザー共通の定型文一覧をFirestoreから取得（同期）
 */
export async function fetchAllReplyTemplates(): Promise<ReplyTemplate[]> {
  const localList = getLocalReplyTemplates();

  try {
    const colRef = collection(db, REPLY_TEMPLATES_COLLECTION);
    const querySnap = await withTimeout(getDocs(colRef), 2500);
    if (!querySnap.empty) {
      const results: ReplyTemplate[] = [];
      querySnap.forEach((d) => {
        results.push(d.data() as ReplyTemplate);
      });
      if (results.length > 0) {
        saveLocalReplyTemplates(results);
        return results.sort((a, b) => a.orderNumber - b.orderNumber);
      }
    } else {
      // 初期データが存在しない場合はデフォルトをFirestoreに初回シード
      await initializeDefaultTemplatesInFirestore(DEFAULT_REPLY_TEMPLATES);
      return DEFAULT_REPLY_TEMPLATES;
    }
  } catch (err) {
    // オフライン・エラー時はローカルキャッシュを返却
    console.warn('[ReplyTemplates] Falling back to local templates due to network/firestore condition:', err);
  }

  return localList;
}

/**
 * Firestoreへ初期データをシード
 */
async function initializeDefaultTemplatesInFirestore(templates: ReplyTemplate[]): Promise<void> {
  try {
    const batch = writeBatch(db);
    templates.forEach((t) => {
      const docRef = doc(db, REPLY_TEMPLATES_COLLECTION, t.id);
      batch.set(docRef, {
        ...t,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
    await withTimeout(batch.commit(), 3000);
  } catch (e) {
    console.warn('[ReplyTemplates] Could not seed default templates to Firestore:', e);
  }
}

/**
 * 1件の定型文を保存・更新（Firestore & LocalStorage）
 */
export async function saveReplyTemplate(item: ReplyTemplate): Promise<void> {
  const now = new Date().toISOString();
  const cleanItem: ReplyTemplate = {
    ...item,
    id: item.id || `tmpl_${Date.now()}`,
    title: item.title.trim() || '無題定型文',
    body: item.body || '',
    updatedAt: now,
    createdAt: item.createdAt || now,
  };

  // LocalStorage更新
  const current = getLocalReplyTemplates();
  const index = current.findIndex((t) => t.id === cleanItem.id);
  let updated: ReplyTemplate[];
  if (index >= 0) {
    updated = [...current];
    updated[index] = cleanItem;
  } else {
    updated = [...current, cleanItem];
  }
  saveLocalReplyTemplates(updated);

  // Firestore更新
  try {
    const docRef = doc(db, REPLY_TEMPLATES_COLLECTION, cleanItem.id);
    await withTimeout(setDoc(docRef, cleanItem, { merge: true }), 3000);
  } catch (err) {
    console.warn('[ReplyTemplates] Failed to save template to Firestore:', err);
  }
}

/**
 * 複数の定型文を一括保存（並び順変更や一括編集用）
 */
export async function saveAllReplyTemplates(items: ReplyTemplate[]): Promise<void> {
  const now = new Date().toISOString();
  const cleanItems = items.map((item, idx) => ({
    ...item,
    orderNumber: idx + 1,
    updatedAt: now,
    createdAt: item.createdAt || now,
  }));

  saveLocalReplyTemplates(cleanItems);

  try {
    const batch = writeBatch(db);
    cleanItems.forEach((t) => {
      const docRef = doc(db, REPLY_TEMPLATES_COLLECTION, t.id);
      batch.set(docRef, t, { merge: true });
    });
    await withTimeout(batch.commit(), 3000);
  } catch (err) {
    console.warn('[ReplyTemplates] Failed to save all templates to Firestore batch:', err);
  }
}

/**
 * 定型文を削除
 */
export async function deleteReplyTemplate(id: string): Promise<void> {
  // LocalStorageから削除
  const current = getLocalReplyTemplates();
  const updated = current.filter((t) => t.id !== id);
  saveLocalReplyTemplates(updated);

  // Firestoreから削除
  try {
    const docRef = doc(db, REPLY_TEMPLATES_COLLECTION, id);
    await withTimeout(deleteDoc(docRef), 3000);
  } catch (err) {
    console.warn('[ReplyTemplates] Failed to delete template from Firestore:', err);
  }
}

/**
 * デフォルト定型文にリセット
 */
export async function resetToDefaultReplyTemplates(): Promise<ReplyTemplate[]> {
  saveLocalReplyTemplates(DEFAULT_REPLY_TEMPLATES);

  try {
    // 既存のFirestoreドキュメントを取得して削除後、再設定
    const colRef = collection(db, REPLY_TEMPLATES_COLLECTION);
    const querySnap = await withTimeout(getDocs(colRef), 2500);
    const batch = writeBatch(db);
    querySnap.forEach((d) => {
      batch.delete(d.ref);
    });
    DEFAULT_REPLY_TEMPLATES.forEach((t) => {
      const docRef = doc(db, REPLY_TEMPLATES_COLLECTION, t.id);
      batch.set(docRef, {
        ...t,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
    await withTimeout(batch.commit(), 3500);
  } catch (err) {
    console.warn('[ReplyTemplates] Failed to reset templates in Firestore:', err);
  }

  return DEFAULT_REPLY_TEMPLATES;
}

/**
 * プレースホルダー変数の置換処理
 * {AWB}, {重量}, {個数}, {仕向地}, {荷主}, {CNEE}, {担当者}
 */
export function formatReplyTemplate(
  body: string,
  variables: {
    awb?: string;
    grossWeight?: string | null;
    pieces?: string | null;
    destination?: string | null;
    shipper?: string | null;
    consignee?: string | null;
    operatorName?: string | null;
  }
): string {
  let result = body;

  const replaceMap: Record<string, string> = {
    '{AWB}': variables.awb || '○○',
    '{MAWB}': variables.awb || '○○',
    '{HAWB}': variables.awb || '○○',
    '{重量}': variables.grossWeight ? `${variables.grossWeight} kg` : '○○ kg',
    '{GROSS_WEIGHT}': variables.grossWeight ? `${variables.grossWeight} kg` : '○○ kg',
    '{個数}': variables.pieces ? `${variables.pieces} 個` : '○○ 個',
    '{PIECES}': variables.pieces ? `${variables.pieces} 個` : '○○ 個',
    '{仕向地}': variables.destination || '○○',
    '{DESTINATION}': variables.destination || '○○',
    '{荷主}': variables.shipper || '○○',
    '{SHIPPER}': variables.shipper || '○○',
    '{CNEE}': variables.consignee || '○○',
    '{CONSIGNEE}': variables.consignee || '○○',
    '{担当者}': variables.operatorName || '担当者',
    '{OPERATOR}': variables.operatorName || '担当者',
  };

  Object.entries(replaceMap).forEach(([placeholder, val]) => {
    // 全ての一致箇所を置換 (大文字小文字区別しないパターンも含む)
    result = result.split(placeholder).join(val);
  });

  return result;
}
