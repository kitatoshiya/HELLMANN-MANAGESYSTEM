// Toast / Window Message Notification Engine for Mention & Email events
import { formatNotificationTimestamp, isEventAlreadyNotified, markEventAsNotified, playNotificationSound, triggerDesktopNotification } from "./notificationHelper";

export interface ToastMessage {
  id: string;
  type: "info" | "success" | "warning" | "error" | "mention";
  title: string;
  message: string;
  duration?: number; // ms
  createdAt: number;
}

type ToastListener = (toasts: ToastMessage[]) => void;

class ToastManager {
  private toasts: ToastMessage[] = [];
  private listeners: Set<ToastListener> = new Set();

  public subscribe(listener: ToastListener) {
    this.listeners.add(listener);
    listener([...this.toasts]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((listener) => listener([...this.toasts]));
  }

  public show({
    type = "info",
    title,
    message,
    duration = 6000,
  }: {
    type?: ToastMessage["type"];
    title: string;
    message: string;
    duration?: number;
  }) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const newToast: ToastMessage = {
      id,
      type,
      title,
      message,
      duration,
      createdAt: Date.now(),
    };

    this.toasts = [newToast, ...this.toasts.slice(0, 4)]; // max 5 toasts
    this.notify();

    // Play chime sound for mention or success
    if (type === "mention" || type === "info" || type === "success") {
      playNotificationSound();
    }

    if (duration > 0) {
      setTimeout(() => {
        this.remove(id);
      }, duration);
    }

    return id;
  }

  public remove(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }

  public clear() {
    this.toasts = [];
    this.notify();
  }
}

export const toastNotifier = new ToastManager();

// Helper to trigger both Window Toast Popup AND Browser Desktop Notification
export function notifyMentionReceived(senderName: string, messageSnippet: string, msgId?: string, timestampInput?: string | number | Date) {
  if (msgId) {
    if (isEventAlreadyNotified(msgId) || isEventAlreadyNotified(`mention-${msgId}`)) {
      return;
    }
    markEventAsNotified(msgId);
    markEventAsNotified(`mention-${msgId}`);
  }

  const timeStr = formatNotificationTimestamp(timestampInput);
  const title = `🔔 [メンション通知] ${senderName}さんからのメッセージ`;
  const snippet = messageSnippet || "あなた宛てにメンションが届きました。";
  const body = `${snippet}\n【発信時刻: ${timeStr}】`;

  // 1. Show Screen Window Message Popup (Toast)
  toastNotifier.show({
    type: "mention",
    title,
    message: body,
    duration: 8000,
  });

  // 2. Try Desktop Notification
  triggerDesktopNotification(title, body, `mention-${msgId || Date.now()}`);
}

export function notifyMentionSent(recipientNames: string[], emailSuccess: boolean, detailMessage?: string) {
  const namesStr = recipientNames.join(", ");
  if (emailSuccess) {
    toastNotifier.show({
      type: "success",
      title: "✉️ メンションメール送信完了",
      message: `${namesStr} 様宛てにメンション通知メールを送信しました。${detailMessage || ""}`,
      duration: 6000,
    });
  } else {
    toastNotifier.show({
      type: "warning",
      title: "⚠️ メンション送信完了 (メール未送信)",
      message: `${namesStr} 様へメンションしました。※ ${detailMessage || "SMTPパスワード未設定のためメール送信はスキップされました。"}`,
      duration: 9000,
    });
  }
}
