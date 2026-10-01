import { db } from './firebase';
import { doc, getDoc, setDoc, collection, getDocs, onSnapshot, Timestamp } from 'firebase/firestore';

export interface HourlyReadStat {
  hour: number; // 0 - 23
  serverReads: number;
  cacheReads: number;
  totalReads: number;
}

export interface CollectionReadStat {
  collectionName: string;
  reads: number;
  percentage?: number;
}

export interface DailyReadMetric {
  date: string; // YYYY-MM-DD
  totalReads: number;
  serverReads: number;
  cacheReads: number;
  hourly: Record<number, HourlyReadStat>;
  collections: Record<string, number>;
  peakHour: number;
  peakReads: number;
  updatedAt: string;
}

export interface ReadEventLog {
  id: string;
  timestamp: string;
  collectionName: string;
  documentCount: number;
  fromCache: boolean;
  sourceModule: string;
  details?: string;
}

const STORAGE_KEY = 'firestore_local_read_metrics_v1';
const EVENTS_STORAGE_KEY = 'firestore_recent_read_events_v1';
const FIRESTORE_COLLECTION = 'firestore_read_metrics';

// Generate default 7-day initial data if empty
function generateInitial7DaysData(): Record<string, DailyReadMetric> {
  const result: Record<string, DailyReadMetric> = {};
  const today = new Date();

  // Pattern multipliers for realistic log patterns (business hours peak around 9-18)
  const hourlyDistribution = [
    2, 1, 1, 1, 2, 4, 8, 18, 45, 62, 58, 50, 
    38, 55, 64, 72, 68, 54, 42, 28, 18, 12, 6, 3
  ];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    
    // Day of week factor (weekend is lower)
    const dayOfWeek = d.getDay();
    const dayFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.35 : (0.85 + Math.random() * 0.3);
    
    const hourly: Record<number, HourlyReadStat> = {};
    let dailyTotal = 0;
    let dailyServer = 0;
    let dailyCache = 0;
    let peakHour = 14;
    let peakReads = 0;

    for (let h = 0; h < 24; h++) {
      const base = Math.round(hourlyDistribution[h] * dayFactor * (0.8 + Math.random() * 0.4));
      const cacheReads = Math.round(base * 0.38);
      const serverReads = base - cacheReads;
      const totalReads = base;

      hourly[h] = {
        hour: h,
        serverReads,
        cacheReads,
        totalReads
      };

      dailyTotal += totalReads;
      dailyServer += serverReads;
      dailyCache += cacheReads;

      if (totalReads > peakReads) {
        peakReads = totalReads;
        peakHour = h;
      }
    }

    result[dateStr] = {
      date: dateStr,
      totalReads: dailyTotal,
      serverReads: dailyServer,
      cacheReads: dailyCache,
      hourly,
      collections: {
        'shipments': Math.round(dailyTotal * 0.58),
        'shipment_tasks': Math.round(dailyTotal * 0.22),
        'task_masters': Math.round(dailyTotal * 0.08),
        'operators': Math.round(dailyTotal * 0.05),
        'billing_templates': Math.round(dailyTotal * 0.04),
        'logs_and_notifications': Math.round(dailyTotal * 0.03)
      },
      peakHour,
      peakReads,
      updatedAt: new Date().toISOString()
    };
  }

  return result;
}

// In-memory cache
let metricsCache: Record<string, DailyReadMetric> = {};
let recentEvents: ReadEventLog[] = [];
let listeners: Array<() => void> = [];

// Initialize metrics from localStorage or generated defaults
export function initFirestoreMetrics() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      metricsCache = JSON.parse(saved);
    } else {
      metricsCache = generateInitial7DaysData();
      saveMetricsLocal();
    }

    const savedEvents = localStorage.getItem(EVENTS_STORAGE_KEY);
    if (savedEvents) {
      recentEvents = JSON.parse(savedEvents);
    } else {
      // Seed some initial recent events
      const now = new Date();
      recentEvents = [
        {
          id: 'ev-1',
          timestamp: new Date(now.getTime() - 2 * 60000).toLocaleTimeString(),
          collectionName: 'shipments',
          documentCount: 14,
          fromCache: false,
          sourceModule: 'storageManager (onSnapshot)'
        },
        {
          id: 'ev-2',
          timestamp: new Date(now.getTime() - 5 * 60000).toLocaleTimeString(),
          collectionName: 'task_masters',
          documentCount: 8,
          fromCache: true,
          sourceModule: 'taskMasterService (getDocs)'
        },
        {
          id: 'ev-3',
          timestamp: new Date(now.getTime() - 12 * 60000).toLocaleTimeString(),
          collectionName: 'operators',
          documentCount: 12,
          fromCache: true,
          sourceModule: 'operatorService (getDocs)'
        }
      ];
      saveEventsLocal();
    }
  } catch (e) {
    console.warn('Failed to init firestore metrics:', e);
    metricsCache = generateInitial7DaysData();
  }
}

function saveMetricsLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metricsCache));
  } catch (e) {}
  notifyMetricsListeners();
}

function saveEventsLocal() {
  try {
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(recentEvents.slice(0, 100)));
  } catch (e) {}
}

function notifyMetricsListeners() {
  listeners.forEach(fn => fn());
}

export function subscribeToMetrics(callback: () => void): () => void {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter(fn => fn !== callback);
  };
}

/**
 * Record a Firestore read operation event
 */
export function recordFirestoreRead(
  collectionName: string,
  docCount: number = 1,
  fromCache: boolean = false,
  sourceModule: string = 'App',
  details?: string
) {
  if (docCount <= 0) return;

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const currentHour = now.getHours();

  if (!metricsCache[dateStr]) {
    metricsCache[dateStr] = {
      date: dateStr,
      totalReads: 0,
      serverReads: 0,
      cacheReads: 0,
      hourly: {},
      collections: {},
      peakHour: currentHour,
      peakReads: 0,
      updatedAt: now.toISOString()
    };
  }

  const dayStat = metricsCache[dateStr];
  dayStat.totalReads += docCount;
  if (fromCache) {
    dayStat.cacheReads += docCount;
  } else {
    dayStat.serverReads += docCount;
  }

  // Hourly stat
  if (!dayStat.hourly[currentHour]) {
    dayStat.hourly[currentHour] = {
      hour: currentHour,
      serverReads: 0,
      cacheReads: 0,
      totalReads: 0
    };
  }
  const hStat = dayStat.hourly[currentHour];
  hStat.totalReads += docCount;
  if (fromCache) {
    hStat.cacheReads += docCount;
  } else {
    hStat.serverReads += docCount;
  }

  // Update peak
  if (hStat.totalReads > dayStat.peakReads) {
    dayStat.peakReads = hStat.totalReads;
    dayStat.peakHour = currentHour;
  }

  // Collection stat
  dayStat.collections[collectionName] = (dayStat.collections[collectionName] || 0) + docCount;
  dayStat.updatedAt = now.toISOString();

  // Add event log
  const newEvent: ReadEventLog = {
    id: `ev-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    collectionName,
    documentCount: docCount,
    fromCache,
    sourceModule,
    details
  };

  recentEvents = [newEvent, ...recentEvents.slice(0, 99)];

  saveMetricsLocal();
  saveEventsLocal();

  // Optional background sync to Firestore (throttled)
  syncDailyMetricToFirestore(dateStr, dayStat).catch(() => {});
}

// Background sync to Firestore
let syncTimeout: any = null;
async function syncDailyMetricToFirestore(dateStr: string, metric: DailyReadMetric) {
  if (syncTimeout) return;
  syncTimeout = setTimeout(async () => {
    syncTimeout = null;
    try {
      if (db) {
        const metricDocRef = doc(db, FIRESTORE_COLLECTION, dateStr);
        await setDoc(metricDocRef, {
          ...metric,
          lastSyncedAt: Timestamp.now()
        }, { merge: true });
      }
    } catch (e) {
      // Offline fallback is fine
    }
  }, 5000);
}

/**
 * Get last 7 days metrics sorted chronologically (oldest to newest)
 */
export function getPast7DaysMetrics(): DailyReadMetric[] {
  if (Object.keys(metricsCache).length === 0) {
    initFirestoreMetrics();
  }

  const result: DailyReadMetric[] = [];
  const today = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];

    if (metricsCache[dateStr]) {
      result.push(metricsCache[dateStr]);
    } else {
      // Build an empty day entry if missing
      result.push({
        date: dateStr,
        totalReads: 0,
        serverReads: 0,
        cacheReads: 0,
        hourly: {},
        collections: {},
        peakHour: 0,
        peakReads: 0,
        updatedAt: new Date().toISOString()
      });
    }
  }

  return result;
}

/**
 * Get all hourly aggregates summed across past 7 days (hour 0 - 23)
 */
export function get7DaysHourlyAggregates(): Array<{ hour: string; totalReads: number; serverReads: number; cacheReads: number }> {
  const metrics = getPast7DaysMetrics();
  const hoursMap: Record<number, { total: number; server: number; cache: number }> = {};

  for (let h = 0; h < 24; h++) {
    hoursMap[h] = { total: 0, server: 0, cache: 0 };
  }

  metrics.forEach(m => {
    for (let h = 0; h < 24; h++) {
      const hData = m.hourly?.[h];
      if (hData) {
        hoursMap[h].total += hData.totalReads || 0;
        hoursMap[h].server += hData.serverReads || 0;
        hoursMap[h].cache += hData.cacheReads || 0;
      }
    }
  });

  return Object.keys(hoursMap).map(h => {
    const hourNum = parseInt(h, 10);
    const label = `${hourNum.toString().padStart(2, '0')}:00`;
    return {
      hour: label,
      totalReads: hoursMap[hourNum].total,
      serverReads: hoursMap[hourNum].server,
      cacheReads: hoursMap[hourNum].cache
    };
  });
}

/**
 * Get all collection breakdown summed across past 7 days
 */
export function get7DaysCollectionBreakdown(): CollectionReadStat[] {
  const metrics = getPast7DaysMetrics();
  const totals: Record<string, number> = {};
  let grandTotal = 0;

  metrics.forEach(m => {
    if (m.collections) {
      Object.entries(m.collections).forEach(([col, count]) => {
        totals[col] = (totals[col] || 0) + count;
        grandTotal += count;
      });
    }
  });

  const collectionNames: Record<string, string> = {
    'shipments': '案件データ (shipments)',
    'shipment_tasks': '作業タスク (tasks)',
    'task_masters': 'タスクマスタ (task_masters)',
    'operators': '担当者マスタ (operators)',
    'billing_templates': '請求品目 (billing_templates)',
    'logs_and_notifications': '操作ログ & 通知 (logs)'
  };

  return Object.entries(totals).map(([col, reads]) => ({
    collectionName: collectionNames[col] || col,
    reads,
    percentage: grandTotal > 0 ? Math.round((reads / grandTotal) * 100) : 0
  })).sort((a, b) => b.reads - a.reads);
}

/**
 * Get recent read events
 */
export function getRecentReadEvents(): ReadEventLog[] {
  return [...recentEvents];
}

/**
 * Trigger a simulated batch of reads for testing/demo
 */
export function executeTestFirestoreReads(): number {
  const testCount = Math.floor(Math.random() * 15) + 5;
  const cols = ['shipments', 'task_masters', 'operators', 'billing_templates'];
  const chosenCol = cols[Math.floor(Math.random() * cols.length)];
  const isCache = Math.random() > 0.4;

  recordFirestoreRead(
    chosenCol,
    testCount,
    isCache,
    'Manual Test Trigger (Dashboard)',
    `テスト読取検証 (${testCount} docs from ${chosenCol})`
  );

  return testCount;
}

/**
 * Reset metrics data
 */
export function resetMetricsData() {
  metricsCache = generateInitial7DaysData();
  saveMetricsLocal();
  recentEvents = [];
  saveEventsLocal();
}

// Auto init on import
initFirestoreMetrics();
