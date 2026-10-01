import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { TaskMaster } from '../types';

export const DEFAULT_TASK_MASTERS: TaskMaster[] = [
  {
    id: 'task_m_1',
    orderNumber: 1,
    shortName: '通関',
    content: '通関依頼',
    isDgOnly: false,
    autoInclude: true,
  },
    {
    id: 'task_m_2',
    orderNumber: 2,
    shortName: '通WT',
    content: '通関へ重量連絡',
    isDgOnly: false,
    autoInclude: true,
  },{
    id: 'task_m_3',
    orderNumber: 3,
    shortName: '業バ',
    content: '業連・爆発物検査依頼',
    isDgOnly: false,
    autoInclude: true,
  },
  {
    id: 'task_m_4',
    orderNumber: 4,
    shortName: '搬',
    content: '搬入伝票作成依頼',
    isDgOnly: true,
    autoInclude: true,
  },
  {
    id: 'task_m_5',
    orderNumber: 5,
    shortName: 'X結果',
    content: 'X線検査結果の連絡',
    isDgOnly: false,
    autoInclude: true,
  },
  {
    id: 'task_m_6',
    orderNumber: 6,
    shortName: '搬入手配',
    content: '保税倉庫搬入手配・確認',
    isDgOnly: false,
    autoInclude: false,
  },
  {
    id: 'task_m_7',
    orderNumber: 7,
    shortName: 'AWB発行',
    content: 'HAWB/MAWB確定発行',
    isDgOnly: false,
    autoInclude: false,
  },
  {
    id: 'task_m_8',
    orderNumber: 8,
    shortName: '送状送付',
    content: '荷主宛送状・確定通知送付',
    isDgOnly: false,
    autoInclude: false,
  },
  {
    id: 'task_m_9',
    orderNumber: 9,
    shortName: '予備確認',
    content: '原産地証明書チェック',
    isDgOnly: false,
    autoInclude: false,
  },
];

const TASK_MASTERS_COLLECTION = 'task_masters';
const LOCAL_TASK_MASTERS_KEY = 'export_mgmt_task_masters_v1';

export function getLocalTaskMasters(): TaskMaster[] {
  try {
    const saved = localStorage.getItem(LOCAL_TASK_MASTERS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.sort((a, b) => a.orderNumber - b.orderNumber);
      }
    }
  } catch (e) {
    // Ignore error
  }
  return DEFAULT_TASK_MASTERS;
}

function saveLocalTaskMasters(items: TaskMaster[]): void {
  try {
    const sorted = [...items].sort((a, b) => a.orderNumber - b.orderNumber);
    localStorage.setItem(LOCAL_TASK_MASTERS_KEY, JSON.stringify(sorted));
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

export async function fetchAllTaskMasters(): Promise<TaskMaster[]> {
  const localList = getLocalTaskMasters();

  try {
    const colRef = collection(db, TASK_MASTERS_COLLECTION);
    const querySnap = await withTimeout(getDocs(colRef), 2000);
    if (!querySnap.empty) {
      const results: TaskMaster[] = [];
      querySnap.forEach((d) => {
        results.push(d.data() as TaskMaster);
      });
      if (results.length > 0) {
        saveLocalTaskMasters(results);
        return results.sort((a, b) => a.orderNumber - b.orderNumber);
      }
    }
  } catch (err) {
    // Silent fallback to local cache
  }

  return localList;
}

export async function saveTaskMaster(item: TaskMaster): Promise<void> {
  const now = new Date().toISOString();
  const cleanItem: TaskMaster = {
    ...item,
    id: item.id || `task_m_${Date.now()}`,
    shortName: item.shortName.slice(0, 5), // Ensure max 5 chars
    content: item.content.slice(0, 20), // Ensure max 20 chars
    updatedAt: now,
    createdAt: item.createdAt || now,
  };

  // 1. Instantly update local cache
  const localList = getLocalTaskMasters();
  const updatedList = [cleanItem, ...localList.filter((m) => m.id !== cleanItem.id)];
  saveLocalTaskMasters(updatedList);

  // 2. Async sync to Firestore in background
  try {
    const docRef = doc(db, TASK_MASTERS_COLLECTION, cleanItem.id);
    await withTimeout(setDoc(docRef, cleanItem, { merge: true }), 3000);
  } catch (err) {
    // Local cache already updated
  }
}

export async function deleteTaskMaster(id: string): Promise<void> {
  // 1. Instantly update local cache
  const localList = getLocalTaskMasters();
  const updatedList = localList.filter((m) => m.id !== id);
  saveLocalTaskMasters(updatedList);

  // 2. Async delete in Firestore
  try {
    const docRef = doc(db, TASK_MASTERS_COLLECTION, id);
    await withTimeout(deleteDoc(docRef), 3000);
  } catch (err) {
    // Ignore error
  }
}

export async function seedInitialTaskMastersIfNeeded(): Promise<void> {
  if (!localStorage.getItem(LOCAL_TASK_MASTERS_KEY)) {
    saveLocalTaskMasters(DEFAULT_TASK_MASTERS);
  }

  try {
    for (const item of DEFAULT_TASK_MASTERS) {
      const docRef = doc(db, TASK_MASTERS_COLLECTION, item.id);
      const snap = await withTimeout(getDoc(docRef), 1500).catch(() => null);
      if (snap && !snap.exists()) {
        await withTimeout(setDoc(docRef, item), 1500).catch(() => null);
      }
    }
  } catch (err) {
    // Ignore
  }
}
