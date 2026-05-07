import { readFileSync } from "node:fs";
import { relative } from "node:path";
import fg from "fast-glob";
import type { Grade, TestLensConfig } from "./config/types.js";
import { getAffectedFiles } from "./git/diff.js";
import { calculateGrade } from "./grading/grades.js";
import { computeUsefulnessScore } from "./grading/usefulness.js";
import {
  type DomainResult,
  formatDeltaView,
  formatDomainView,
  type GradedTest,
} from "./output/terminal.js";
import { parseTestFile } from "./parser/parseTestFile.js";

export interface PipelineOptions {
  domain?: string;
  all?: boolean;
  base?: string;
}

export interface PipelineResult {
  output: string;
  gradedTests: GradedTest[];
  domainResults: DomainResult[];
}

const DEFAULT_FLAKINESS_SCORE = 5;

export async function runPipeline(
  config: TestLensConfig,
  options: PipelineOptions,
  cwd: string,
): Promise<PipelineResult> {
  const baseBranch = options.base ?? config.baseBranch;

  // 1. Discover test files
  const absolutePaths = await fg(config.testMatch, { cwd, absolute: true });
  const testFiles = absolutePaths.map((abs) => relative(cwd, abs));

  // 2. Parse all test files
  const allTests = testFiles.flatMap((filePath) => {
    const source = readFileSync(`${cwd}/${filePath}`, "utf-8");
    return parseTestFile(filePath, source);
  });

  // 3. Score and grade every parsed test
  const allGraded: GradedTest[] = allTests.map((t) => {
    const usefulnessScore = computeUsefulnessScore(t);
    const flakinessScore = DEFAULT_FLAKINESS_SCORE;
    const isCapped = !t.domain;
    const cap: Grade | undefined = isCapped ? config.grading.untaggedCap : undefined;
    const grade = calculateGrade(usefulnessScore, flakinessScore, cap);

    return {
      name: t.name,
      filePath: t.filePath,
      grade,
      usefulnessScore,
      flakinessScore,
      domain: t.domain,
      tags: [...t.tags],
      isCapped,
    };
  });

  // 4. Determine which graded tests are in scope based on the mode
  if (options.domain) {
    return buildDomainResult(options.domain, allGraded);
  }

  if (options.all) {
    return buildAllResult(allGraded, config);
  }

  return buildDiffResult(allGraded, baseBranch, cwd, config);
}

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
