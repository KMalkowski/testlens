import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execaSync } from "execa";
import fg from "fast-glob";
import { buildAnnotations, buildReport, postCodeInsights } from "./bitbucket/codeInsights.js";
import type { Grade, TestLensConfig } from "./config/types.js";
import { computeFlakinessScore, type FlakinessSignals } from "./flakiness/score.js";
import { getAffectedFiles } from "./git/diff.js";
import { calculateGrade } from "./grading/grades.js";
import { computeUsefulnessScore } from "./grading/usefulness.js";
import { appendRunFromJunit, getRunsForTest, loadHistory, saveHistory } from "./history/history.js";
import { parseJunitFile } from "./junit/parseJunit.js";
import { generateHtmlReport } from "./output/htmlReport.js";
import {
  type DomainResult,
  formatDeltaView,
  formatDomainView,
  type GradedTest,
} from "./output/terminal.js";
import { parseTestFile } from "./parser/parseTestFile.js";
import type { ParsedTestCase } from "./parser/types.js";
import { generateSkill, shouldRegenerateSkill } from "./skill/generateSkill.js";

export interface PipelineOptions {
  domain?: string;
  all?: boolean;
  base?: string;
  ci?: boolean;
  report?: boolean;
  skill?: boolean;
}

export interface PipelineResult {
  output: string;
  gradedTests: GradedTest[];
  domainResults: DomainResult[];
}

const DEFAULT_FLAKINESS_SCORE = 5;
const HISTORY_FILE = "testlens-history.json";
const REPORT_FILE = "testlens-report.html";
const SKILL_FILE = "TESTLENS_SKILL.md";
const TEST_BODY_LINES = 20;

function bodyKey(filePath: string, name: string): string {
  return `${filePath}::${name}`;
}

export async function runPipeline(
  config: TestLensConfig,
  options: PipelineOptions,
  cwd: string,
): Promise<PipelineResult> {
  const baseBranch = options.base ?? config.baseBranch;

  // 1. Discover test files
  const absolutePaths = await fg(config.testMatch, { cwd, absolute: true });
  const testFiles = absolutePaths.map((abs) => relative(cwd, abs));

  // 2. Parse all test files and capture each test's source body for downstream
  //    consumers (HTML report expandable code blocks, skill examples).
  const testBodies = new Map<string, string>();
  const allTests = testFiles.flatMap((filePath) => {
    const source = readFileSync(`${cwd}/${filePath}`, "utf-8");
    const parsed = parseTestFile(filePath, source);
    const sourceLines = source.split("\n");
    for (const tc of parsed) {
      if (tc.line == null) continue;
      const startIdx = tc.line - 1;
      const snippet = sourceLines.slice(startIdx, startIdx + TEST_BODY_LINES).join("\n");
      testBodies.set(bodyKey(tc.filePath, tc.name), snippet);
    }
    return parsed;
  });

  // 3. Score and grade every parsed test
  const flakinessContext = options.ci ? await loadCiFlakinessContext(config, cwd) : undefined;
  const allGraded: GradedTest[] = allTests.map((t) => gradeTest(t, config, flakinessContext));

  // 4. Determine which graded tests are in scope based on the mode
  let result: PipelineResult;

  if (options.ci) {
    result = buildCiResult(allGraded, config);
    if (flakinessContext?.noHistory) {
      result.output = `${result.output}\n\n  [no history] flakiness scoring will activate after ${config.grading.flakinessSampleSize} CI runs.`;
    }
  } else if (options.domain) {
    result = buildDomainResult(options.domain, allGraded);
  } else if (options.all) {
    result = buildAllResult(allGraded, config);
  } else {
    result = await buildDiffResult(allGraded, baseBranch, cwd, config);
  }

  // 5. Side effects: report, history, Bitbucket, skill
  if (options.ci || options.report) {
    await writeReport(result, config, cwd, baseBranch, testBodies);
  }

  if (options.ci) {
    await postBitbucketAnnotation(result, config, cwd, baseBranch);
  }

  if (options.skill) {
    // Use the full graded set so the skill always sees the best examples
    // available in the suite, not just the diff-scoped subset.
    writeSkillFile(cwd, config, allGraded, testBodies);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Mode builders
// ---------------------------------------------------------------------------

function buildDomainResult(domainId: string, allGraded: GradedTest[]): PipelineResult {
  const domainTests = allGraded.filter((t) => t.domain === domainId);
  const output = domainTests.length > 0 ? formatDomainView(domainId, domainTests) : "";
  const domainResults: DomainResult[] =
    domainTests.length > 0
      ? [
          {
            domainId,
            label: domainId,
            currentGrade: averageGrade(domainTests),
            testCount: domainTests.length,
            degradedCount: 0,
          },
        ]
      : [];

  return { output, gradedTests: domainTests, domainResults };
}

function buildAllResult(allGraded: GradedTest[], config: TestLensConfig): PipelineResult {
  const byDomain = groupByDomain(allGraded);
  const domainResults: DomainResult[] = [];

  for (const [domainId, tests] of byDomain) {
    const label = config.domains.find((d) => d.id === domainId)?.label ?? domainId;
    domainResults.push({
      domainId,
      label,
      currentGrade: averageGrade(tests),
      testCount: tests.length,
      degradedCount: 0,
    });
  }

  const output = formatDeltaView(domainResults);
  return { output, gradedTests: allGraded, domainResults };
}

function buildCiResult(allGraded: GradedTest[], config: TestLensConfig): PipelineResult {
  return buildAllResult(allGraded, config);
}

async function buildDiffResult(
  allGraded: GradedTest[],
  baseBranch: string,
  cwd: string,
  config: TestLensConfig,
): Promise<PipelineResult> {
  const affectedFiles = await getAffectedFiles(baseBranch, cwd);
  const affectedSet = new Set(affectedFiles);

  const diffGraded = allGraded.filter((t) => affectedSet.has(t.filePath));
  const byDomain = groupByDomain(diffGraded);
  const domainResults: DomainResult[] = [];

  for (const [domainId, tests] of byDomain) {
    const label = config.domains.find((d) => d.id === domainId)?.label ?? domainId;
    domainResults.push({
      domainId,
      label,
      currentGrade: averageGrade(tests),
      testCount: tests.length,
      degradedCount: 0,
    });
  }

  const output = formatDeltaView(domainResults);
  return { output, gradedTests: diffGraded, domainResults };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

interface CiFlakinessContext {
  noHistory: boolean;
  threshold: number;
  outcomesFor: (testName: string) => Array<{
    runId: string;
    timestamp: string;
    status: "passed" | "failed";
  }>;
}

async function loadCiFlakinessContext(
  config: TestLensConfig,
  cwd: string,
): Promise<CiFlakinessContext> {
  const historyPath = join(cwd, HISTORY_FILE);
  let history = loadHistory(historyPath);

  // If a JUnit XML file exists, append it as the current run before scoring.
  const junitPath = resolve(cwd, config.junitOutput);
  if (existsSync(junitPath)) {
    try {
      const junitResults = await parseJunitFile(junitPath);
      history = appendRunFromJunit(history, {
        runId: detectRunId(),
        timestamp: new Date().toISOString(),
        junitResults,
        sampleSize: config.grading.flakinessSampleSize,
      });
      saveHistory(historyPath, history);
    } catch {
      // Malformed JUnit XML should not crash the pipeline; treat as no data.
    }
  }

  const noHistory = history.runs.length < config.grading.flakinessSampleSize;

  return {
    noHistory,
    threshold: config.grading.flakinessThreshold,
    outcomesFor: (testName: string) => {
      const runs = getRunsForTest(history, testName);
      // Skipped runs are not informative for flakiness — drop them.
      return runs
        .filter((r) => r.status !== "skipped")
        .map((r) => ({
          runId: r.runId,
          timestamp: r.timestamp,
          status: r.status as "passed" | "failed",
        }));
    },
  };
}

function gradeTest(
  test: ParsedTestCase,
  config: TestLensConfig,
  flakinessContext: CiFlakinessContext | undefined,
): GradedTest {
  const usefulnessScore = computeUsefulnessScore(test);
  const flakinessScore = flakinessContext
    ? computeCiFlakiness(test, flakinessContext)
    : DEFAULT_FLAKINESS_SCORE;

  const isCapped = !test.domain;
  const cap: Grade | undefined = isCapped ? config.grading.untaggedCap : undefined;
  const grade = calculateGrade(usefulnessScore, flakinessScore, cap);

  return {
    name: test.name,
    filePath: test.filePath,
    grade,
    usefulnessScore,
    flakinessScore,
    domain: test.domain,
    tags: [...test.tags],
    isCapped,
  };
}

function computeCiFlakiness(test: ParsedTestCase, ctx: CiFlakinessContext): number {
  const signals: FlakinessSignals = {
    hasTimeouts: test.signals.hasTimeouts,
    hasUnmockedNetwork: false,
    hasSharedState: false,
  };

  return computeFlakinessScore({
    signals,
    history: ctx.outcomesFor(test.name),
    threshold: ctx.threshold,
    isCritical: test.tags.includes("critical"),
  });
}

function detectRunId(): string {
  return (
    process.env.BITBUCKET_BUILD_NUMBER ??
    process.env.GITHUB_RUN_ID ??
    process.env.CI_PIPELINE_ID ??
    `local-${Date.now()}`
  );
}

// ---------------------------------------------------------------------------
// Side effects
// ---------------------------------------------------------------------------

async function writeReport(
  result: PipelineResult,
  config: TestLensConfig,
  cwd: string,
  baseBranch: string,
  testBodies: Map<string, string>,
): Promise<void> {
  const branch = currentBranch(cwd) ?? baseBranch;
  const html = await generateHtmlReport({
    branch,
    baseBranch,
    domains: config.domains,
    gradedTests: result.gradedTests,
    testBodies,
  });
  writeFileSync(join(cwd, REPORT_FILE), html);
}

export function writeSkillFile(
  cwd: string,
  config: TestLensConfig,
  gradedTests: GradedTest[],
  testBodies: Map<string, string>,
): { written: boolean; path: string } {
  const path = join(cwd, SKILL_FILE);
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : undefined;

  if (!shouldRegenerateSkill(existing, config.domains)) {
    console.log(`${SKILL_FILE} is up to date.`);
    return { written: false, path };
  }

  const content = generateSkill({
    domains: config.domains,
    gradedTests,
    testBodies,
  });
  writeFileSync(path, content);
  console.log(`wrote ${path}`);
  return { written: true, path };
}

async function postBitbucketAnnotation(
  result: PipelineResult,
  config: TestLensConfig,
  cwd: string,
  baseBranch: string,
): Promise<void> {
  if (!config.bitbucket.enabled) return;

  const branch = currentBranch(cwd) ?? baseBranch;
  const commitSha = currentCommit(cwd);
  if (!commitSha) return;

  const report = buildReport({
    domainResults: result.domainResults,
    gradedTests: result.gradedTests,
    branch,
    reportLink: undefined,
  });
  const annotations = buildAnnotations(result.gradedTests);

  const token = process.env.BITBUCKET_TOKEN;
  await postCodeInsights({
    config: config.bitbucket,
    commitSha,
    report,
    annotations,
    auth: token ? { token } : undefined,
  });
}

function currentBranch(cwd: string): string | undefined {
  try {
    const { stdout } = execaSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function currentCommit(cwd: string): string | undefined {
  try {
    const { stdout } = execaSync("git", ["rev-parse", "HEAD"], { cwd });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByDomain(tests: GradedTest[]): Map<string, GradedTest[]> {
  const map = new Map<string, GradedTest[]>();
  for (const t of tests) {
    const key = t.domain ?? "unclassified";
    const existing = map.get(key);
    if (existing) {
      existing.push(t);
    } else {
      map.set(key, [t]);
    }
  }
  return map;
}

const gradeOrder: Record<Grade, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };

function averageGrade(tests: GradedTest[]): Grade {
  if (tests.length === 0) return "F";
  const avg = tests.reduce((sum, t) => sum + gradeOrder[t.grade], 0) / tests.length;
  const rounded = Math.round(avg);
  if (rounded >= 4) return "A";
  if (rounded >= 3) return "B";
  if (rounded >= 2) return "C";
  if (rounded >= 1) return "D";
  return "F";
}
