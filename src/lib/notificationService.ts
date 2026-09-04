import { NotificationSettings, ToastMessage, ToastType, Shipment } from '../types';

const STORAGE_SETTINGS_KEY = 'export_customs_notification_settings_v1';
const STORAGE_DISMISSED_ALERTS_KEY = 'export_customs_notified_cutoffs_v1';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true, // システムトースト通知 全体有効
  notifyOnNewShipment: true, // 新規案件登録完了時通知
  notifyOnApproachingCutTime: true, // 当日カット時間接近通知 (完了済は非対象)
  cutTimeWarningMinutes: 60, // カット時間60分前に事前警告
  soundEnabled: true, // 通知音 (Web Audio)
  checkIntervalSeconds: 30, // 30秒ごとにカット時間を監視
  autoDismissSeconds: 7, // 7秒で自動フェードアウト
};

// Listeners
type SettingsListener = (settings: NotificationSettings) => void;
type ToastListener = (toasts: ToastMessage[]) => void;

let settingsListeners: SettingsListener[] = [];
let toastListeners: ToastListener[] = [];
let activeToasts: ToastMessage[] = [];

// Session-level throttle for cut-off alerts to prevent repetitive spam
// Map of shipmentId -> { lastNotifiedAt: number, level: 'approaching' | 'overdue' }
const notifiedCutoffMap: Record<string, { lastNotifiedAt: number; level: 'approaching' | 'overdue' }> = {};

// Web Audio synthesizer for clean sound effects
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function playNotificationChime(type: ToastType = 'info'): void {
  const settings = getNotificationSettings();
  if (!settings.enabled || !settings.soundEnabled) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    if (type === 'success') {
      // Pleasant two-tone chime (C5 -> E5)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.12); // E5
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'warning' || type === 'error') {
      // Urgent attention chime (F#5 -> A5 double pulse)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.connect(gain1);
      gain1.connect(ctx.destination);

      osc1.frequency.setValueAtTime(740, now); // F#5
      osc1.frequency.setValueAtTime(880, now + 0.1); // A5
      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc1.start(now);
      osc1.stop(now + 0.22);

      // Second pulse
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc2.frequency.setValueAtTime(880, now + 0.25);
      osc2.frequency.setValueAtTime(1108.73, now + 0.35); // C#6
      gain2.gain.setValueAtTime(0.15, now + 0.25);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc2.start(now + 0.25);
      osc2.stop(now + 0.5);
    } else {
      // Gentle info bell
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.frequency.setValueAtTime(587.33, now); // D5
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (err) {
    console.debug('Web Audio notification error:', err);
  }
}

/**
 * Retrieve system notification settings
 */
export function getNotificationSettings(): NotificationSettings {
  if (typeof window === 'undefined') return DEFAULT_NOTIFICATION_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to parse notification settings:', e);
  }
  return DEFAULT_NOTIFICATION_SETTINGS;
}

/**
 * Save notification settings and notify subscribers
 */
export function saveNotificationSettings(newSettings: Partial<NotificationSettings>): NotificationSettings {
  const current = getNotificationSettings();
  const merged: NotificationSettings = { ...current, ...newSettings };

  try {
    localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(merged));
  } catch (e) {
    console.warn('Failed to save notification settings:', e);
  }

  // Notify listeners
  settingsListeners.forEach((fn) => fn(merged));
  return merged;
}

/**
 * Subscribe to notification settings updates
 */
export function subscribeToNotificationSettings(listener: SettingsListener): () => void {
  settingsListeners.push(listener);
  return () => {
    settingsListeners = settingsListeners.filter((l) => l !== listener);
  };
}

/**
 * Subscribe to active toast list
 */
export function subscribeToToasts(listener: ToastListener): () => void {
  toastListeners.push(listener);
  // Send initial state
  listener([...activeToasts]);
  return () => {
    toastListeners = toastListeners.filter((l) => l !== listener);
  };
}

function notifyToastListeners() {
  toastListeners.forEach((fn) => fn([...activeToasts]));
}

/**
 * Show a toast notification
 */
export function showToast(
  toast: Omit<ToastMessage, 'id' | 'timestamp'> & { id?: string; duration?: number }
): string {
  const settings = getNotificationSettings();
  if (!settings.enabled) return '';

  const id = toast.id || `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const duration = toast.duration !== undefined ? toast.duration : settings.autoDismissSeconds * 1000;

  const newToast: ToastMessage = {
    ...toast,
    id,
    duration,
    timestamp: Date.now(),
  };

  // Sound
  if (settings.soundEnabled) {
    playNotificationChime(newToast.type);
  }

  // Deduplicate by ID if already exists
  const existingIdx = activeToasts.findIndex((t) => t.id === id);
  if (existingIdx >= 0) {
    activeToasts[existingIdx] = newToast;
  } else {
    // Keep max 5 active toasts
    activeToasts = [newToast, ...activeToasts].slice(0, 5);
  }

  notifyToastListeners();

  // Auto dismiss if duration > 0
  if (duration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, duration);
  }

  return id;
}

/**
 * Dismiss a toast notification
 */
export function dismissToast(id: string): void {
  activeToasts = activeToasts.filter((t) => t.id !== id);
  notifyToastListeners();
}

/**
 * Clear all active toasts
 */
export function clearAllToasts(): void {
  activeToasts = [];
  notifyToastListeners();
}

/**
 * Helper to trigger "New Shipment Successfully Processed" Toast
 */
export function notifyNewShipmentCreated(
  shipment: Shipment,
  onOpenShipment?: (shipmentId: string) => void
): void {
  const settings = getNotificationSettings();
  if (!settings.enabled || !settings.notifyOnNewShipment) return;

  const displayId = shipment.hawbNumber || shipment.mawbNumber || shipment.id;
  const shipperName = shipment.shipper || '荷主未定';
  const dest = shipment.destination ? ` (向地: ${shipment.destination})` : '';

  showToast({
    id: `new_shipment_${shipment.id}_${Date.now()}`,
    type: 'success',
    title: '新規案件 登録完了',
    message: `[${displayId}] ${shipperName}${dest}`,
    subMessage: `タスク ${shipment.tasks?.length || 0} 件を自動生成・進捗追跡を開始しました`,
    shipmentId: shipment.id,
    actions: onOpenShipment
      ? [
          {
            label: '案件詳細を開く',
            primary: true,
            onClick: () => {
              dismissToast(`new_shipment_${shipment.id}`);
              onOpenShipment(shipment.id);
            },
          },
        ]
      : undefined,
  });
}

/**
 * Date / Cut-Off time normalization helpers
 */
function normalizeDateStr(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/\//g, '-').trim();
  const parts = cleaned.split('-');
  if (parts.length === 3) {
    const year = parts[0].padStart(4, '20');
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

function formatDateToKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseCutTime(cutTimeStr: string | null | undefined): { hours: number; minutes: number } | null {
  if (!cutTimeStr) return null;
  const cleaned = cutTimeStr.trim();
  
  // Format: "17:00", "15:30", "9:00"
  const colonMatch = cleaned.match(/^(\d{1,2}):(\d{2})/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1], 10);
    const m = parseInt(colonMatch[2], 10);
    if (h >= 0 && h <= 24 && m >= 0 && m < 60) return { hours: h, minutes: m };
  }

  // Format: "1700", "0900"
  const digitsMatch = cleaned.match(/^(\d{2})(\d{2})$/);
  if (digitsMatch) {
    const h = parseInt(digitsMatch[1], 10);
    const m = parseInt(digitsMatch[2], 10);
    if (h >= 0 && h <= 24 && m >= 0 && m < 60) return { hours: h, minutes: m };
  }

  // Format: "17時30分", "17時"
  const jpMatch = cleaned.match(/(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分?)?/);
  if (jpMatch) {
    const h = parseInt(jpMatch[1], 10);
    const m = jpMatch[2] ? parseInt(jpMatch[2], 10) : 0;
    if (h >= 0 && h <= 24 && m >= 0 && m < 60) return { hours: h, minutes: m };
  }

  return null;
}

/**
 * Checks all current shipments for today's approaching cut-off deadlines.
 * CRITICAL RULE: "完了済のものは非対象とする" (Completed tasks/shipments are EXCLUDED)
 */
export function checkApproachingCutTimes(
  shipments: Shipment[],
  onOpenShipment?: (shipmentId: string) => void
): { checkedCount: number; alertedCount: number } {
  const settings = getNotificationSettings();
  if (!settings.enabled || !settings.notifyOnApproachingCutTime) {
    return { checkedCount: 0, alertedCount: 0 };
  }

  const now = new Date();
  const todayKey = formatDateToKey(now);
  const currentMinutesToday = now.getHours() * 60 + now.getMinutes();

  let checkedCount = 0;
  let alertedCount = 0;

  for (const s of shipments) {
    // 1. STRICT EXCLUSION: If shipment status is Completed -> Skip
    if (s.status === 'Completed') {
      continue;
    }

    // 2. STRICT EXCLUSION: If all tasks are completed -> Skip
    const tasks = s.tasks || [];
    const uncompletedTasks = tasks.filter((t) => t.status !== 'Completed');
    if (tasks.length > 0 && uncompletedTasks.length === 0) {
      continue;
    }

    // 3. Date check: Is this shipment scheduled for today?
    const cDate = normalizeDateStr(s.customsClearanceDate);
    const isTodayShipment = cDate === todayKey || (!cDate && Boolean(s.cutTime));
    if (!isTodayShipment) {
      continue;
    }

    // 4. Cut-off time check
    const parsedCut = parseCutTime(s.cutTime);
    if (!parsedCut) {
      continue;
    }

    checkedCount++;

    const cutMinutesToday = parsedCut.hours * 60 + parsedCut.minutes;
    const diffMinutes = cutMinutesToday - currentMinutesToday; // > 0 means in the future, <= 0 means past
    const warningThreshold = settings.cutTimeWarningMinutes || 60;

    const displayKey = s.hawbNumber || s.mawbNumber || s.id;
    const cutTimeFormatted = `${String(parsedCut.hours).padStart(2, '0')}:${String(parsedCut.minutes).padStart(2, '0')}`;
    const uncompletedCount = uncompletedTasks.length;

    // CASE A: Approaching deadline (0 <= diffMinutes <= warningThreshold)
    if (diffMinutes > 0 && diffMinutes <= warningThreshold) {
      const cache = notifiedCutoffMap[s.id];
      const timeSinceLast = cache ? now.getTime() - cache.lastNotifiedAt : Infinity;
      // Re-notify at most once every 15 minutes while still approaching
      if (!cache || cache.level !== 'approaching' || timeSinceLast > 15 * 60 * 1000) {
        notifiedCutoffMap[s.id] = { lastNotifiedAt: now.getTime(), level: 'approaching' };
        alertedCount++;

        showToast({
          id: `cut_alert_${s.id}_approaching`,
          type: diffMinutes <= 20 ? 'error' : 'warning',
          title: `【カット時間警告】残り ${diffMinutes} 分`,
          message: `[${displayKey}] 締切時刻: ${cutTimeFormatted} (${s.shipper || '荷主'})`,
          subMessage: `未完了作業工程: ${uncompletedCount}件 残っています。至急ご対応ください。`,
          shipmentId: s.id,
          isCutTimeAlert: true,
          cutTime: cutTimeFormatted,
          remainingMinutes: diffMinutes,
          duration: 9000, // 9 seconds for urgent warning
          actions: onOpenShipment
            ? [
                {
                  label: '案件を確認する',
                  primary: true,
                  onClick: () => {
                    dismissToast(`cut_alert_${s.id}_approaching`);
                    onOpenShipment(s.id);
                  },
                },
              ]
            : undefined,
        });
      }
    }
    // CASE B: Already passed cut-off time today (0 >= diffMinutes >= -180 mins) and still uncompleted
    else if (diffMinutes <= 0 && diffMinutes >= -180) {
      const cache = notifiedCutoffMap[s.id];
      const timeSinceLast = cache ? now.getTime() - cache.lastNotifiedAt : Infinity;
      // Re-notify at most once every 20 minutes if overdue
      if (!cache || cache.level !== 'overdue' || timeSinceLast > 20 * 60 * 1000) {
        notifiedCutoffMap[s.id] = { lastNotifiedAt: now.getTime(), level: 'overdue' };
        alertedCount++;

        showToast({
          id: `cut_alert_${s.id}_overdue`,
          type: 'error',
          title: '【カット時間超過】未完了案件',
          message: `[${displayKey}] カット時刻 ${cutTimeFormatted} を超過しています！`,
          subMessage: `未完了工程 ${uncompletedCount}件 (荷主: ${s.shipper || '-'})`,
          shipmentId: s.id,
          isCutTimeAlert: true,
          cutTime: cutTimeFormatted,
          remainingMinutes: diffMinutes,
          duration: 10000,
          actions: onOpenShipment
            ? [
                {
                  label: '未完了タスクを確認',
                  primary: true,
                  onClick: () => {
                    dismissToast(`cut_alert_${s.id}_overdue`);
                    onOpenShipment(s.id);
                  },
                },
              ]
            : undefined,
        });
      }
    }
  }

  return { checkedCount, alertedCount };
}

/**
 * Initializes continuous background cut-off time monitor
 */
export function initCutTimeMonitor(
  getShipmentsFn: () => Shipment[],
  onOpenShipment?: (shipmentId: string) => void
): () => void {
  // Initial check after 3 seconds on startup
  const initialTimer = setTimeout(() => {
    try {
      checkApproachingCutTimes(getShipmentsFn(), onOpenShipment);
    } catch (e) {
      console.warn('Initial cut-time check error:', e);
    }
  }, 3000);

  // Interval check
  const intervalId = setInterval(() => {
    try {
      checkApproachingCutTimes(getShipmentsFn(), onOpenShipment);
    } catch (e) {
      console.warn('Periodic cut-time check error:', e);
    }
  }, 30000); // Check every 30 seconds

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalId);
  };
}
