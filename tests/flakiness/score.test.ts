import { computeFlakinessScore, failureRate } from "../../src/flakiness/score.js";
import type { FlakinessSignals, RunOutcome } from "../../src/flakiness/score.js";

/**
 * Flakiness scoring tests.
 *
 * Scoring rules (from MVP §6.2):
 *
 *   +3   Zero intermittent failures in last N CI runs
 *   +2   No hardcoded timeouts or arbitrary `waitFor` delays
 *   +2   Isolated — no shared mutable state with other tests
 *   +2   No unmocked network calls
 *   -4   Intermittent failure rate > threshold in last N runs
 *   -2   Uses `setTimeout` / arbitrary delays
 *   -2   Fails on re-run after initial pass (CI evidence of a flake)
 *
 * Score is clamped to [0, 10].
 * `@critical` doubles flakiness penalties.
 *
 * Per testing guidelines: table-driven tests with explicit inputs and outcomes.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanSignals: FlakinessSignals = {
  hasTimeouts: false,
  hasUnmockedNetwork: false,
  hasSharedState: false,
};

function passes(count: number, fromRun = 1): RunOutcome[] {
  return Array.from({ length: count }, (_, i) => ({
    runId: `r${fromRun + i}`,
    timestamp: `2026-05-${String(fromRun + i).padStart(2, "0")}T00:00:00Z`,
    status: "passed",
  }));
}

function failures(count: number, fromRun = 1): RunOutcome[] {
  return Array.from({ length: count }, (_, i) => ({
    runId: `r${fromRun + i}`,
    timestamp: `2026-05-${String(fromRun + i).padStart(2, "0")}T00:00:00Z`,
    status: "failed",
  }));
}

// ---------------------------------------------------------------------------
// failureRate (helper used by the score function and the report)
// ---------------------------------------------------------------------------

describe("failureRate", () => {
  it("returns 0 when there is no history", () => {
    expect(failureRate([])).toBe(0);
  });

  it("returns 0 when every run passed", () => {
    expect(failureRate(passes(10))).toBe(0);
  });

  it("returns 1 when every run failed", () => {
    expect(failureRate(failures(10))).toBe(1);
  });

  it("returns the proportion of failed runs", () => {
    const history = [...passes(8), ...failures(2, 9)];
    expect(failureRate(history)).toBeCloseTo(0.2, 5);
  });
});

// ---------------------------------------------------------------------------
// Static signals only (no history)
// ---------------------------------------------------------------------------

describe("computeFlakinessScore — static signals only", () => {
  it("returns the maximum score for a clean test with no history", () => {
    // No history: no +3 history bonus and no failure-rate penalty.
    // Clean static signals → +2 (no timeouts) +2 (isolated) +2 (no network) = 6
    const score = computeFlakinessScore({
      signals: cleanSignals,
      history: [],
      threshold: 0.15,
    });

    expect(score).toBe(6);
  });

  it("penalizes timeouts and arbitrary delays", () => {
    const baseline = computeFlakinessScore({
      signals: cleanSignals,
      history: [],
      threshold: 0.15,
    });

    const withTimeouts = computeFlakinessScore({
      signals: { ...cleanSignals, hasTimeouts: true },
      history: [],
      threshold: 0.15,
    });

    // Loses +2 (no-timeouts bonus) AND -2 (timeout penalty) = -4 vs baseline
    expect(withTimeouts).toBeLessThan(baseline);
    expect(baseline - withTimeouts).toBe(4);
  });

  it("penalizes unmocked network calls", () => {
    const baseline = computeFlakinessScore({
      signals: cleanSignals,
      history: [],
      threshold: 0.15,
    });

    const withNetwork = computeFlakinessScore({
      signals: { ...cleanSignals, hasUnmockedNetwork: true },
      history: [],
      threshold: 0.15,
    });

    // Loses +2 (no-network bonus) = -2 vs baseline
    expect(baseline - withNetwork).toBe(2);
  });

  it("penalizes shared mutable state", () => {
    const baseline = computeFlakinessScore({
      signals: cleanSignals,
      history: [],
      threshold: 0.15,
    });

    const withShared = computeFlakinessScore({
      signals: { ...cleanSignals, hasSharedState: true },
      history: [],
      threshold: 0.15,
    });

    // Loses +2 (isolated bonus) = -2 vs baseline
    expect(baseline - withShared).toBe(2);
  });

  it("clamps the score to a minimum of 0", () => {
    const score = computeFlakinessScore({
      signals: { hasTimeouts: true, hasUnmockedNetwork: true, hasSharedState: true },
      history: failures(20),
      threshold: 0.15,
    });

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// History-based scoring
// ---------------------------------------------------------------------------

describe("computeFlakinessScore — history-driven scoring", () => {
  it("awards +3 when there are no failures in the sample", () => {
    const withoutHistory = computeFlakinessScore({
      signals: cleanSignals,
      history: [],
      threshold: 0.15,
    });

    const withCleanHistory = computeFlakinessScore({
      signals: cleanSignals,
      history: passes(10),
      threshold: 0.15,
    });

    // Bonus of +3 for zero failures
    expect(withCleanHistory - withoutHistory).toBe(3);
  });

  it("applies -4 penalty when failure rate exceeds threshold", () => {
    // 3 of 10 = 30% > 15% → triggers penalty
    const flaky = computeFlakinessScore({
      signals: cleanSignals,
      history: [...passes(7), ...failures(3, 8)],
      threshold: 0.15,
    });

    const nonFlakyButHasFailures = computeFlakinessScore({
      signals: cleanSignals,
      history: [...passes(9), ...failures(1, 10)], // 10% < 15% → no penalty
      threshold: 0.15,
    });

    expect(flaky).toBeLessThan(nonFlakyButHasFailures);
  });

  it("does not award the zero-failures bonus when at least one failure exists", () => {
    const oneFailure = computeFlakinessScore({
      signals: cleanSignals,
      history: [...passes(9), ...failures(1, 10)],
      threshold: 0.5,
    });

    const allPasses = computeFlakinessScore({
      signals: cleanSignals,
      history: passes(10),
      threshold: 0.5,
    });

    // The clean run keeps +3; the one-failure run does not
    expect(allPasses - oneFailure).toBeGreaterThanOrEqual(3);
  });

  it("penalizes a test that failed and then passed on rerun", () => {
    const flake: RunOutcome = {
      runId: "r1",
      timestamp: "2026-05-01T00:00:00Z",
      status: "passed",
      rerunPassed: true, // initial run failed; passed on retry
    };

    const flakyScore = computeFlakinessScore({
      signals: cleanSignals,
      history: [flake, ...passes(9, 2)],
      threshold: 0.15,
    });

    const cleanScore = computeFlakinessScore({
      signals: cleanSignals,
      history: passes(10),
      threshold: 0.15,
    });

    // The rerun-flake should cost 2 points
    expect(cleanScore - flakyScore).toBeGreaterThanOrEqual(2);
  });

  it("respects a custom flakiness threshold", () => {
    // 2 of 10 = 20% — fails at threshold 0.15 but not at 0.25
    const strict = computeFlakinessScore({
      signals: cleanSignals,
      history: [...passes(8), ...failures(2, 9)],
      threshold: 0.15,
    });

    const lenient = computeFlakinessScore({
      signals: cleanSignals,
      history: [...passes(8), ...failures(2, 9)],
      threshold: 0.25,
    });

    expect(strict).toBeLessThan(lenient);
  });
});

// ---------------------------------------------------------------------------
// @critical penalty doubling
// ---------------------------------------------------------------------------

describe("computeFlakinessScore — @critical doubles penalties", () => {
  it("doubles the failure-rate penalty for critical tests", () => {
    const history = [...passes(7), ...failures(3, 8)]; // 30%

    const normal = computeFlakinessScore({
      signals: cleanSignals,
      history,
      threshold: 0.15,
    });

    const critical = computeFlakinessScore({
      signals: cleanSignals,
      history,
      threshold: 0.15,
      isCritical: true,
    });

    // Doubled -4 → -8 means critical loses 4 more points than normal
    expect(normal - critical).toBe(4);
  });

  it("doubles the timeout penalty for critical tests", () => {
    const signals: FlakinessSignals = { ...cleanSignals, hasTimeouts: true };

    const normal = computeFlakinessScore({
      signals,
      history: [],
      threshold: 0.15,
    });

    const critical = computeFlakinessScore({
      signals,
      history: [],
      threshold: 0.15,
      isCritical: true,
    });

    // Timeout penalty -2 doubled → -4: critical loses 2 more points
    expect(normal - critical).toBe(2);
  });

  it("does not double bonuses (only penalties)", () => {
    const normal = computeFlakinessScore({
      signals: cleanSignals,
      history: passes(10),
      threshold: 0.15,
    });

    const critical = computeFlakinessScore({
      signals: cleanSignals,
      history: passes(10),
      threshold: 0.15,
      isCritical: true,
    });

    // No penalties triggered → score must match
    expect(critical).toBe(normal);
  });
});

// ---------------------------------------------------------------------------
// Score range
// ---------------------------------------------------------------------------

describe("computeFlakinessScore — score range", () => {
  it.each([
    {
      label: "perfectly clean test",
      signals: cleanSignals,
      history: passes(20),
      threshold: 0.15,
    },
    {
      label: "completely broken test",
      signals: { hasTimeouts: true, hasUnmockedNetwork: true, hasSharedState: true },
      history: failures(20),
      threshold: 0.15,
    },
  ])("$label score is within [0, 10]", ({ signals, history, threshold }) => {
    const score = computeFlakinessScore({ signals, history, threshold });

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });
});
