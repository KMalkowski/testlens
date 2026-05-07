import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HistoryRun, TestlensHistory } from "../../src/history/history.js";
import {
  appendRunFromJunit,
  emptyHistory,
  getRunsForTest,
  loadHistory,
  saveHistory,
} from "../../src/history/history.js";
import type { JunitTestResult } from "../../src/junit/parseJunit.js";

/**
 * testlens-history.json tests.
 *
 * Per MVP §10, each CI run appends an entry derived from JUnit XML, and the
 * tool reads back the last N runs to compute per-test failure rates. The
 * aggregator must be tolerant of missing tests in some runs (a test added
 * later won't have history in older runs).
 *
 * Per testing guidelines: prefer unit tests with explicit fixtures; only use
 * the filesystem when verifying load/save behavior.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function junit(name: string, status: JunitTestResult["status"]): JunitTestResult {
  return {
    name,
    classname: "suite",
    filePath: "src/example.test.tsx",
    status,
    durationMs: 100,
  };
}

function run(
  runId: string,
  timestamp: string,
  results: Array<{ name: string; status: HistoryRun["results"][number]["status"] }>,
): HistoryRun {
  return { runId, timestamp, results };
}

// ---------------------------------------------------------------------------
// emptyHistory
// ---------------------------------------------------------------------------

describe("emptyHistory", () => {
  it("returns a versioned, empty history", () => {
    const h = emptyHistory();

    expect(h.version).toBe(1);
    expect(h.runs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// appendRunFromJunit
// ---------------------------------------------------------------------------

describe("appendRunFromJunit", () => {
  it("adds a new run entry derived from junit results", () => {
    const history = emptyHistory();
    const results: JunitTestResult[] = [
      junit("blocks progression when cart is empty", "passed"),
      junit("displays error when payment fails", "failed"),
    ];

    const updated = appendRunFromJunit(history, {
      runId: "build-42",
      timestamp: "2026-05-07T10:00:00Z",
      junitResults: results,
      sampleSize: 20,
    });

    expect(updated.runs).toHaveLength(1);
    expect(updated.runs[0]?.runId).toBe("build-42");
    expect(updated.runs[0]?.results).toHaveLength(2);
  });

  it("does not mutate the input history", () => {
    const history = emptyHistory();
    const before = JSON.stringify(history);

    appendRunFromJunit(history, {
      runId: "build-1",
      timestamp: "2026-05-07T10:00:00Z",
      junitResults: [junit("a", "passed")],
      sampleSize: 20,
    });

    expect(JSON.stringify(history)).toBe(before);
  });

  it("trims older runs once sampleSize is exceeded", () => {
    let history: TestlensHistory = emptyHistory();

    for (let i = 1; i <= 25; i += 1) {
      history = appendRunFromJunit(history, {
        runId: `build-${i}`,
        timestamp: `2026-05-${String(i).padStart(2, "0")}T00:00:00Z`,
        junitResults: [junit("only test", i % 2 === 0 ? "passed" : "failed")],
        sampleSize: 20,
      });
    }

    expect(history.runs).toHaveLength(20);
    // Oldest five (build-1..build-5) should be trimmed
    expect(history.runs[0]?.runId).toBe("build-6");
    expect(history.runs[19]?.runId).toBe("build-25");
  });

  it("ignores skipped tests when recording status", () => {
    const history = emptyHistory();
    const results: JunitTestResult[] = [
      junit("skipped test", "skipped"),
      junit("passing test", "passed"),
    ];

    const updated = appendRunFromJunit(history, {
      runId: "build-1",
      timestamp: "2026-05-07T10:00:00Z",
      junitResults: results,
      sampleSize: 20,
    });

    // Skipped tests should not contribute to the failure rate calculation.
    // Implementation may keep them in the run record with status "skipped"
    // or may filter them out entirely — either is acceptable here as long as
    // they do not appear as "failed".
    const recordedStatuses = updated.runs[0]?.results.map((r) => r.status) ?? [];
    expect(recordedStatuses).not.toContain("failed");
  });
});

// ---------------------------------------------------------------------------
// getRunsForTest — aggregation
// ---------------------------------------------------------------------------

describe("getRunsForTest", () => {
  it("returns the per-run outcomes for a single test in chronological order", () => {
    const history: TestlensHistory = {
      version: 1,
      runs: [
        run("build-1", "2026-05-01T00:00:00Z", [
          { name: "adds item", status: "passed" },
          { name: "removes item", status: "passed" },
        ]),
        run("build-2", "2026-05-02T00:00:00Z", [
          { name: "adds item", status: "failed" },
          { name: "removes item", status: "passed" },
        ]),
      ],
    };

    const outcomes = getRunsForTest(history, "adds item");

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.status).toBe("passed");
    expect(outcomes[1]?.status).toBe("failed");
  });

  it("skips runs that did not include the test", () => {
    const history: TestlensHistory = {
      version: 1,
      runs: [
        run("build-1", "2026-05-01T00:00:00Z", [{ name: "old test", status: "passed" }]),
        run("build-2", "2026-05-02T00:00:00Z", [{ name: "new test", status: "passed" }]),
      ],
    };

    const outcomes = getRunsForTest(history, "new test");

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.runId).toBe("build-2");
  });

  it("returns an empty list for a test that has never run", () => {
    const history: TestlensHistory = {
      version: 1,
      runs: [run("build-1", "2026-05-01T00:00:00Z", [{ name: "a", status: "passed" }])],
    };

    expect(getRunsForTest(history, "never seen")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadHistory / saveHistory — filesystem round-trip
// ---------------------------------------------------------------------------

describe("loadHistory / saveHistory", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testlens-history-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty history when the file does not exist", () => {
    const history = loadHistory(join(dir, "missing.json"));

    expect(history.version).toBe(1);
    expect(history.runs).toEqual([]);
  });

  it("round-trips through JSON without losing data", () => {
    const path = join(dir, "history.json");
    const history: TestlensHistory = {
      version: 1,
      runs: [run("build-1", "2026-05-01T00:00:00Z", [{ name: "test", status: "passed" }])],
    };

    saveHistory(path, history);
    const reloaded = loadHistory(path);

    expect(existsSync(path)).toBe(true);
    expect(reloaded).toEqual(history);
  });

  it("writes the file as parseable JSON", () => {
    const path = join(dir, "history.json");
    saveHistory(path, emptyHistory());

    const raw = readFileSync(path, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("rejects a file with an unexpected schema version", () => {
    const path = join(dir, "history.json");
    writeFileSync(path, JSON.stringify({ version: 999, runs: [] }));

    expect(() => loadHistory(path)).toThrow();
  });

  it("rejects a file with malformed JSON", () => {
    const path = join(dir, "history.json");
    writeFileSync(path, "{not json");

    expect(() => loadHistory(path)).toThrow();
  });
});
