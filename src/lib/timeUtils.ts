export type StaleWarningLevel = "normal" | "caution" | "warning" | "danger";

export interface ElapsedStats {
  elapsedMs: number;
  elapsedHours: number;
  elapsedDays: number;
  formattedElapsed: string;
  warningLevel: StaleWarningLevel;
  isStale: boolean;
}

/**
 * Calculates the elapsed time from an ISO timestamp to now.
 * Returns structured metrics for hidden state tracking and UI visual warning thresholds.
 */
export function getElapsedStats(isoTimestamp: string, isOpenStatus: boolean = true): ElapsedStats {
  if (!isoTimestamp) {
    return {
      elapsedMs: 0,
      elapsedHours: 0,
      elapsedDays: 0,
      formattedElapsed: "直近更新",
      warningLevel: "normal",
      isStale: false,
    };
  }

  const now = Date.now();
  const targetTime = new Date(isoTimestamp).getTime();
  const elapsedMs = Math.max(0, now - targetTime);

  const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
  const elapsedDays = Math.floor(elapsedHours / 24);
  const remainingHours = elapsedHours % 24;

  let formattedElapsed = "";
  if (elapsedDays > 0) {
    formattedElapsed = remainingHours > 0 ? `${elapsedDays}日${remainingHours}時間前` : `${elapsedDays}日前`;
  } else if (elapsedHours > 0) {
    formattedElapsed = `${elapsedHours}時間前`;
  } else {
    const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));
    formattedElapsed = elapsedMinutes > 0 ? `${elapsedMinutes}分前` : "たった今";
  }

  // Closed or accepted status items do not trigger active stale warnings
  if (!isOpenStatus) {
    return {
      elapsedMs,
      elapsedHours,
      elapsedDays,
      formattedElapsed,
      warningLevel: "normal",
      isStale: false,
    };
  }

  // Warning thresholds:
  // - normal: < 24 hours
  // - caution (注意): 24h ~ 48h (1日以上経過)
  // - warning (警告): 48h ~ 72h (2日以上経過)
  // - danger (深刻滞留): >= 72h (3日以上経過)
  let warningLevel: StaleWarningLevel = "normal";
  if (elapsedHours >= 72) {
    warningLevel = "danger";
  } else if (elapsedHours >= 48) {
    warningLevel = "warning";
  } else if (elapsedHours >= 24) {
    warningLevel = "caution";
  }

  return {
    elapsedMs,
    elapsedHours,
    elapsedDays,
    formattedElapsed,
    warningLevel,
    isStale: warningLevel !== "normal",
  };
}
