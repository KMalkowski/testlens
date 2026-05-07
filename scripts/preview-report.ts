/**
 * Quick script to generate an HTML report from the fixture test files.
 * Usage: pnpm tsx scripts/preview-report.ts
 * Opens testlens-report.html in the browser.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultConfig } from "../src/config/defaultConfig.js";
import { calculateGrade } from "../src/grading/grades.js";
import { computeUsefulnessScore } from "../src/grading/usefulness.js";
import { generateHtmlReport, type ReportInput } from "../src/output/htmlReport.js";
import type { GradedTest } from "../src/output/terminal.js";
import { parseTestFile } from "../src/parser/parseTestFile.js";

const fixtures = [
  "tests/fixtures/checkout-tagged.test.tsx",
  "tests/fixtures/mixed-queries.test.tsx",
  "tests/fixtures/poor-render-only.test.tsx",
  "tests/fixtures/heavy-mocks.test.ts",
  "tests/fixtures/flaky-patterns.test.ts",
  "tests/fixtures/nested-describes.test.ts",
];

const root = resolve(import.meta.dirname, "..");

const gradedTests: GradedTest[] = [];
const testBodies = new Map<string, string>();

for (const rel of fixtures) {
  const abs = resolve(root, rel);
  const source = readFileSync(abs, "utf-8");
  const parsed = parseTestFile(rel, source);

  for (const tc of parsed) {
    const usefulness = computeUsefulnessScore(tc);
    const flakiness = 5; // neutral — no CI history
    const cap = tc.domain ? undefined : defaultConfig.grading.untaggedCap;
    const grade = calculateGrade(usefulness, flakiness, cap);

    gradedTests.push({
      name: tc.name,
      filePath: tc.filePath,
      grade,
      usefulnessScore: usefulness,
      flakinessScore: flakiness,
      domain: tc.domain,
      tags: [...tc.tags],
      isCapped: cap != null,
    });

    // Extract the test body from source for the expandable section
    if (tc.line != null) {
      const lines = source.split("\n");
      const startIdx = tc.line - 1;
      // Grab up to 20 lines as an approximation of the test body
      const snippet = lines.slice(startIdx, startIdx + 20).join("\n");
      testBodies.set(`${tc.filePath}::${tc.name}`, snippet);
    }
  }
}

const input: ReportInput = {
  branch: "feature/preview-demo",
  baseBranch: "main",
  domains: defaultConfig.domains,
  gradedTests,
  testBodies,
};

const html = await generateHtmlReport(input);
const outPath = resolve(root, "testlens-report.html");
writeFileSync(outPath, html, "utf-8");

console.log(`Report written to ${outPath}`);
console.log(`Open it with: open ${outPath}`);
