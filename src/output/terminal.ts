import type { Grade } from "../config/types.js";

export interface DomainResult {
  domainId: string;
  label: string;
  currentGrade: Grade;
  previousGrade?: Grade;
  testCount: number;
  degradedCount: number;
}

export interface GradedTest {
  name: string;
  filePath: string;
  grade: Grade;
  usefulnessScore: number;
  flakinessScore: number;
  domain?: string;
  tags: string[];
  isCapped: boolean;
}

const gradeOrder: Record<Grade, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };

export function formatDeltaView(results: DomainResult[]): string {
  if (results.length === 0) {
    return "  No domains affected — no change detected.\n";
  }

  const lines: string[] = [];
  lines.push("  Domains touched by this diff:\n");

  for (const r of results) {
    const label = r.domainId.toUpperCase().padEnd(14);
    const gradeTransition =
      r.previousGrade != null ? `${r.previousGrade} → ${r.currentGrade}` : `${r.currentGrade}`;

    let status = "";
    if (r.degradedCount > 0) {
      status = `  ↓  ${r.testCount} tests in diff, ${r.degradedCount} degraded`;
    } else {
      status = `     ${r.testCount} tests in diff, no change`;
    }

    lines.push(`  ${label}${gradeTransition}${status}`);
  }

  lines.push("");
  lines.push("  Run `npx testlens --report` to open the full breakdown.");
  return lines.join("\n");
}

export function formatDomainView(domainId: string, tests: GradedTest[]): string {
  const sorted = [...tests].sort((a, b) => gradeOrder[a.grade] - gradeOrder[b.grade]);

  const lines: string[] = [];
  const testWord = tests.length === 1 ? "test" : "tests";
  lines.push(`  testlens  ${domainId}  ${tests.length} ${testWord}\n`);

  for (const t of sorted) {
    const cap = t.isCapped ? "  [no tag] ← cap" : "";
    lines.push(
      `  ${t.grade}  ${t.name}    useful: ${t.usefulnessScore}  flaky: ${t.flakinessScore}${cap}`,
    );
  }

  const avgScore = tests.reduce((sum, t) => sum + gradeOrder[t.grade], 0) / tests.length;
  const domainGrade = scoreToGrade(Math.round(avgScore));

  lines.push("");
  lines.push(`  Domain grade: ${domainGrade}`);

  return lines.join("\n");
}

function scoreToGrade(score: number): Grade {
  if (score >= 4) return "A";
  if (score >= 3) return "B";
  if (score >= 2) return "C";
  if (score >= 1) return "D";
  return "F";
}
