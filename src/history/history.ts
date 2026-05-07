import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { JunitTestResult } from "../junit/parseJunit.js";

const SCHEMA_VERSION = 1;

export interface HistoryRunResult {
  name: string;
  status: "passed" | "failed" | "skipped";
}

export interface HistoryRun {
  runId: string;
  timestamp: string;
  results: HistoryRunResult[];
}

export interface TestlensHistory {
  version: number;
  runs: HistoryRun[];
}

export function emptyHistory(): TestlensHistory {
  return { version: SCHEMA_VERSION, runs: [] };
}

export interface AppendRunOptions {
  runId: string;
  timestamp: string;
  junitResults: JunitTestResult[];
  sampleSize: number;
}

export function appendRunFromJunit(
  history: TestlensHistory,
  options: AppendRunOptions,
): TestlensHistory {
  const newRun: HistoryRun = {
    runId: options.runId,
    timestamp: options.timestamp,
    results: options.junitResults.map((r) => ({ name: r.name, status: r.status })),
  };

  const runs = [...history.runs, newRun];
  const trimmed = runs.length > options.sampleSize ? runs.slice(-options.sampleSize) : runs;

  return { version: history.version, runs: trimmed };
}

export function getRunsForTest(
  history: TestlensHistory,
  testName: string,
): Array<{ runId: string; timestamp: string; status: HistoryRunResult["status"] }> {
  const outcomes: Array<{ runId: string; timestamp: string; status: HistoryRunResult["status"] }> =
    [];

  for (const run of history.runs) {
    const match = run.results.find((r) => r.name === testName);
    if (!match) continue;
    outcomes.push({ runId: run.runId, timestamp: run.timestamp, status: match.status });
  }

  return outcomes;
}

export function loadHistory(path: string): TestlensHistory {
  if (!existsSync(path)) {
    return emptyHistory();
  }

  const raw = readFileSync(path, "utf-8");
  const parsed: unknown = JSON.parse(raw);

  if (!isHistoryShape(parsed)) {
    throw new Error(`testlens-history.json at ${path} has an unexpected shape`);
  }

  if (parsed.version !== SCHEMA_VERSION) {
    throw new Error(
      `testlens-history.json schema version ${parsed.version} is not supported (expected ${SCHEMA_VERSION})`,
    );
  }

  return parsed;
}

export function saveHistory(path: string, history: TestlensHistory): void {
  writeFileSync(path, `${JSON.stringify(history, null, 2)}\n`);
}

function isHistoryShape(value: unknown): value is TestlensHistory {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.version === "number" && Array.isArray(obj.runs);
}
