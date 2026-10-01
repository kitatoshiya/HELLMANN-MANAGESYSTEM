/**
 * Firestore Read Operations Monitor & Telemetry Logger
 * 過去7日間の時間別・日別Firestore読み取り回数を記録・集計・管理するユーティリティ
 */

export interface FirestoreReadLogEntry {
  id: string;
  timestamp: string; // ISO 8601
  date: string; // YYYY-MM-DD
  hour: number; // 0 - 23
  collectionName: string;
  count: number;
  operationType: "snapshot_initial" | "snapshot_update" | "get_doc" | "get_docs" | "quota_error";
  details?: string;
  userEmail?: string;
}

export interface DailyUsageSummary {
  date: string; // YYYY-MM-DD
  totalReads: number;
  quotaPercent: number; // Against 50,000 Spark free tier limit
  byCollection: Record<string, number>;
  hourlyReads: number[]; // Array of 24 numbers (0-23)
  quotaErrors: number;
}

export interface HourlyUsageSummary {
  hour: number; // 0 - 23
  totalReads: number;
  byCollection: Record<string, number>;
}

const STORAGE_KEY = "firestore_read_telemetry_logs_v1";
const FREE_TIER_DAILY_LIMIT = 50000;

// サンプルの過去7日間ログ（初回起動時やシミュレーション用）
export function generateDefaultPast7DaysLogs(): FirestoreReadLogEntry[] {
  const logs: FirestoreReadLogEntry[] = [];
  const now = new Date();
  const collections = ["quotations", "messages", "staffMembers", "user_active_views", "user_notification_prefs", "chatMessages"];

  // 過去7日間のデータを生成
  for (let d = 6; d >= 0; d--) {
    const targetDate = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
    const dateStr = targetDate.toISOString().split("T")[0];

    // 営業時間（9:00〜19:00）に集中させる
    for (let h = 0; h < 24; h++) {
      let baseReads = 0;
      if (h >= 9 && h <= 18) {
        // 業務時間帯: 1時間あたり100〜1,200 reads
        baseReads = Math.floor(Math.random() * 400 + 150);
        if (h === 10 || h === 14 || h === 16) {
          // ピーク時間帯
          baseReads += Math.floor(Math.random() * 600 + 300);
        }
      } else if (h >= 19 && h <= 22) {
        // 残業・夜間: 20〜150 reads
        baseReads = Math.floor(Math.random() * 80 + 10);
      } else {
        // 深夜・早朝: 0〜10 reads
        baseReads = Math.floor(Math.random() * 8);
      }

      if (d === 0) {
        // 今日の現在時刻以降は生成しない
        if (h > now.getHours()) continue;
      }

      // コレクションごとに配分
      const col = collections[h % collections.length];
      const count = Math.max(1, baseReads);

      const hourTimestamp = new Date(targetDate);
      hourTimestamp.setHours(h, Math.floor(Math.random() * 59), Math.floor(Math.random() * 59));

      logs.push({
        id: `gen-${dateStr}-${h}-${col}`,
        timestamp: hourTimestamp.toISOString(),
        date: dateStr,
        hour: h,
        collectionName: col,
        count: count,
        operationType: h % 3 === 0 ? "snapshot_initial" : "snapshot_update",
        details: `${col} コレクションの同期 (${count}件読み取り)`,
        userEmail: "kita@tac-japan.co.jp",
      });
    }
  }

  return logs;
}

// ログの読み込み
export function getFirestoreReadLogs(): FirestoreReadLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initialLogs = generateDefaultPast7DaysLogs();
      saveFirestoreReadLogs(initialLogs);
      return initialLogs;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // 7日以上前のログを自動パージ
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const validLogs = parsed.filter((entry) => new Date(entry.timestamp) >= sevenDaysAgo);

    if (validLogs.length !== parsed.length) {
      saveFirestoreReadLogs(validLogs);
    }
    return validLogs;
  } catch (e) {
    console.error("Failed to load Firestore telemetry logs", e);
    return [];
  }
}

// ログの保存
export function saveFirestoreReadLogs(logs: FirestoreReadLogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch (e) {
    console.warn("Failed to persist Firestore telemetry logs (localStorage quota):", e);
  }
}

// 単一読み取りイベントの記録
export function recordFirestoreRead(
  collectionName: string,
  count: number = 1,
  operationType: FirestoreReadLogEntry["operationType"] = "snapshot_update",
  details?: string,
  userEmail?: string
): void {
  if (count <= 0) return;

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const hour = now.getHours();

  const newEntry: FirestoreReadLogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: now.toISOString(),
    date: dateStr,
    hour: hour,
    collectionName,
    count,
    operationType,
    details: details || `${collectionName} 読み取り (${count}件)`,
    userEmail: userEmail || "current_user",
  };

  const currentLogs = getFirestoreReadLogs();
  currentLogs.push(newEntry);

  // 上限 3,000件で古い順にスライス
  const trimmed = currentLogs.slice(-3000);
  saveFirestoreReadLogs(trimmed);
}

// クォータエラーイベントの記録
export function recordFirestoreQuotaError(
  path: string | null,
  errorMsg: string,
  userEmail?: string
): void {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const hour = now.getHours();

  const newEntry: FirestoreReadLogEntry = {
    id: `err-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: now.toISOString(),
    date: dateStr,
    hour: hour,
    collectionName: path || "quota_limit",
    count: 1,
    operationType: "quota_error",
    details: `Quota Exceeded: ${errorMsg}`,
    userEmail: userEmail || "current_user",
  };

  const currentLogs = getFirestoreReadLogs();
  currentLogs.push(newEntry);
  saveFirestoreReadLogs(currentLogs.slice(-3000));
}

// 過去7日間の日付一覧（YYYY-MM-DD）を取得
export function getPast7DaysList(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    days.push(d.toISOString().split("T")[0]);
  }
  return days;
}

// 過去7日間の集計サマリーを計算
export function calculate7DaysSummary(logs: FirestoreReadLogEntry[]): {
  dailySummaries: DailyUsageSummary[];
  hourlyAggregated: HourlyUsageSummary[];
  collectionTotals: Record<string, number>;
  total7DaysReads: number;
  todayReads: number;
  todayQuotaPercent: number;
  averageDailyReads: number;
  peakHour: { hour: number; totalReads: number };
  totalQuotaErrors: number;
} {
  const daysList = getPast7DaysList();
  const dailyMap: Record<string, DailyUsageSummary> = {};

  // 日別枠を初期化
  daysList.forEach((d) => {
    dailyMap[d] = {
      date: d,
      totalReads: 0,
      quotaPercent: 0,
      byCollection: {},
      hourlyReads: new Array(24).fill(0),
      quotaErrors: 0,
    };
  });

  // 時間別枠 (0-23) を初期化
  const hourlyAggregated: HourlyUsageSummary[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    totalReads: 0,
    byCollection: {},
  }));

  const collectionTotals: Record<string, number> = {};
  let total7DaysReads = 0;
  let totalQuotaErrors = 0;

  logs.forEach((entry) => {
    // 過去7日範囲内かチェック
    if (!dailyMap[entry.date]) return;

    if (entry.operationType === "quota_error") {
      dailyMap[entry.date].quotaErrors += 1;
      totalQuotaErrors += 1;
      return;
    }

    const count = entry.count;
    total7DaysReads += count;

    // 日別
    const dSummary = dailyMap[entry.date];
    dSummary.totalReads += count;
    dSummary.hourlyReads[entry.hour] += count;
    dSummary.byCollection[entry.collectionName] = (dSummary.byCollection[entry.collectionName] || 0) + count;

    // 時間別集計
    if (entry.hour >= 0 && entry.hour < 24) {
      hourlyAggregated[entry.hour].totalReads += count;
      hourlyAggregated[entry.hour].byCollection[entry.collectionName] =
        (hourlyAggregated[entry.hour].byCollection[entry.collectionName] || 0) + count;
    }

    // コレクション別合計
    collectionTotals[entry.collectionName] = (collectionTotals[entry.collectionName] || 0) + count;
  });

  // Quota Percent を計算
  daysList.forEach((d) => {
    dailyMap[d].quotaPercent = Math.min(100, Math.round((dailyMap[d].totalReads / FREE_TIER_DAILY_LIMIT) * 100));
  });

  const dailySummaries = daysList.map((d) => dailyMap[d]);
  const todayStr = daysList[daysList.length - 1];
  const todaySummary = dailyMap[todayStr] || { totalReads: 0, quotaPercent: 0 };

  // ピーク時間の特定
  let peakHour = { hour: 0, totalReads: 0 };
  hourlyAggregated.forEach((h) => {
    if (h.totalReads > peakHour.totalReads) {
      peakHour = { hour: h.hour, totalReads: h.totalReads };
    }
  });

  return {
    dailySummaries,
    hourlyAggregated,
    collectionTotals,
    total7DaysReads,
    todayReads: todaySummary.totalReads,
    todayQuotaPercent: todaySummary.quotaPercent,
    averageDailyReads: Math.round(total7DaysReads / 7),
    peakHour,
    totalQuotaErrors,
  };
}
