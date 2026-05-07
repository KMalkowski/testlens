export interface FlakinessSignals {
  hasTimeouts: boolean;
  hasUnmockedNetwork: boolean;
  hasSharedState: boolean;
}

export interface RunOutcome {
  runId: string;
  timestamp: string;
  status: "passed" | "failed";
  /** True when the initial run failed but the test passed on retry. */
  rerunPassed?: boolean;
}

export interface ComputeFlakinessOpts {
  signals: FlakinessSignals;
  history: RunOutcome[];
  threshold: number;
  isCritical?: boolean;
}

export function failureRate(history: RunOutcome[]): number {
  if (history.length === 0) return 0;
  const failed = history.filter((r) => r.status === "failed").length;
  return failed / history.length;
}

export function computeFlakinessScore(opts: ComputeFlakinessOpts): number {
  const { signals, history, threshold, isCritical = false } = opts;
  const penaltyMultiplier = isCritical ? 2 : 1;

  let score = 0;

  // Static signals (bonuses, not doubled)
  if (!signals.hasTimeouts) score += 2;
  if (!signals.hasSharedState) score += 2;
  if (!signals.hasUnmockedNetwork) score += 2;

  // Static signal penalty (doubled for @critical)
  if (signals.hasTimeouts) score -= 2 * penaltyMultiplier;

  // History-based signals — only when we actually have history
  if (history.length > 0) {
    const failed = history.filter((r) => r.status === "failed").length;
    if (failed === 0) score += 3;

    if (failureRate(history) > threshold) {
      score -= 4 * penaltyMultiplier;
    }

    const reruns = history.filter((r) => r.rerunPassed).length;
    if (reruns > 0) score -= 2 * penaltyMultiplier;
  }

  return Math.max(0, Math.min(10, score));
}
