import { codeToHtml } from "shiki";
import type { DomainConfig, Grade } from "../config/types.js";
import type { GradedTest } from "./terminal.js";

export interface ReportInput {
  branch: string;
  baseBranch: string;
  domains: DomainConfig[];
  gradedTests: GradedTest[];
  testBodies: Map<string, string>;
}

const gradeOrder: Record<Grade, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gradeColorClass(grade: Grade): string {
  const map: Record<Grade, string> = {
    A: "grade-a",
    B: "grade-b",
    C: "grade-c",
    D: "grade-d",
    F: "grade-f",
  };
  return map[grade];
}

async function highlightCode(code: string): Promise<string> {
  return codeToHtml(code, { lang: "typescript", theme: "github-dark" });
}

function bodyKey(filePath: string, testName: string): string {
  return `${filePath}::${testName}`;
}

function domainGrade(tests: GradedTest[]): Grade {
  if (tests.length === 0) return "F";
  const avg = tests.reduce((sum, t) => sum + gradeOrder[t.grade], 0) / tests.length;
  const rounded = Math.round(avg);
  if (rounded >= 4) return "A";
  if (rounded >= 3) return "B";
  if (rounded >= 2) return "C";
  if (rounded >= 1) return "D";
  return "F";
}

function renderTestRow(test: GradedTest, body: string | undefined, index: number): string {
  const cap = test.isCapped ? `<span class="cap-badge">no tag</span>` : "";
  const tags =
    test.tags.length > 0
      ? test.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ")
      : "";

  const bodyHtml = body ? `<div class="test-body" id="body-${index}">${body}</div>` : "";

  const toggleAttr = body ? `onclick="toggleBody(${index})"` : "";
  const expandable = body ? " expandable" : "";

  return `<div class="test-row">
  <div class="test-header${expandable}" ${toggleAttr}>
    <span class="grade-badge ${gradeColorClass(test.grade)}">${test.grade}</span>
    <span class="test-name">${escapeHtml(test.name)}</span>
    <span class="test-file">${escapeHtml(test.filePath)}</span>
    <span class="test-scores">useful: ${test.usefulnessScore} &middot; flaky: ${test.flakinessScore}</span>
    ${tags}${cap}
  </div>
  ${bodyHtml}
</div>`;
}

async function renderDomainSection(
  domain: DomainConfig,
  tests: GradedTest[],
  testBodies: Map<string, string>,
  indexOffset: number,
): Promise<string> {
  const sorted = [...tests].sort((a, b) => gradeOrder[a.grade] - gradeOrder[b.grade]);
  const grade = domainGrade(tests);

  const rows: string[] = [];
  for (const [i, t] of sorted.entries()) {
    const rawBody = testBodies.get(bodyKey(t.filePath, t.name));
    const highlighted = rawBody ? await highlightCode(rawBody) : undefined;
    rows.push(renderTestRow(t, highlighted, indexOffset + i));
  }

  return `<section class="domain-section" style="border-left: 4px solid ${domain.color}">
  <h2 class="domain-heading">
    <span class="domain-label" style="color:${domain.color}">${escapeHtml(domain.label)}</span>
    <span class="grade-badge ${gradeColorClass(grade)}">${grade}</span>
    <span class="test-count">${tests.length} ${tests.length === 1 ? "test" : "tests"}</span>
  </h2>
  ${rows.join("\n")}
</section>`;
}

async function renderUnclassifiedSection(
  tests: GradedTest[],
  testBodies: Map<string, string>,
  indexOffset: number,
): Promise<string> {
  const sorted = [...tests].sort((a, b) => gradeOrder[a.grade] - gradeOrder[b.grade]);

  const rows: string[] = [];
  for (const [i, t] of sorted.entries()) {
    const rawBody = testBodies.get(bodyKey(t.filePath, t.name));
    const highlighted = rawBody ? await highlightCode(rawBody) : undefined;
    rows.push(renderTestRow(t, highlighted, indexOffset + i));
  }

  return `<section class="domain-section unclassified-section">
  <h2 class="domain-heading">
    <span class="domain-label">Unclassified</span>
    <span class="test-count">${tests.length} untagged ${tests.length === 1 ? "test" : "tests"}</span>
  </h2>
  <p class="unclassified-hint">These tests have no <code>@domain</code> tag and are capped at their configured maximum grade.
  Use <a href="TESTLENS_SKILL.md">TESTLENS_SKILL.md</a> with your LLM of choice to tag them.</p>
  ${rows.join("\n")}
</section>`;
}

export async function generateHtmlReport(input: ReportInput): Promise<string> {
  const { branch, baseBranch, domains, gradedTests, testBodies } = input;

  // Group tests by domain
  const domainMap = new Map<string, GradedTest[]>();
  const untagged: GradedTest[] = [];

  for (const test of gradedTests) {
    if (test.domain) {
      const list = domainMap.get(test.domain) ?? [];
      list.push(test);
      domainMap.set(test.domain, list);
    } else {
      untagged.push(test);
    }
  }

  // Render domain sections (only for domains that have tests)
  const domainSections: string[] = [];
  let indexOffset = 0;
  for (const domain of domains) {
    const tests = domainMap.get(domain.id);
    if (!tests || tests.length === 0) continue;
    domainSections.push(await renderDomainSection(domain, tests, testBodies, indexOffset));
    indexOffset += tests.length;
  }

  // Render unclassified section
  const unclassifiedHtml =
    untagged.length > 0 ? await renderUnclassifiedSection(untagged, testBodies, indexOffset) : "";

  // Summary bar — all domains with grade badges
  const summaryBadges = domains
    .filter((d) => domainMap.has(d.id))
    .map((d) => {
      const tests = domainMap.get(d.id) ?? [];
      const grade = domainGrade(tests);
      return `<span class="summary-badge" style="background:${d.color}20;border:1px solid ${d.color}">
      <span class="domain-label" style="color:${d.color}">${escapeHtml(d.label)}</span>
      <span class="grade-badge ${gradeColorClass(grade)}">${grade}</span>
    </span>`;
    })
    .join("\n      ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TestLens Report</title>
  <style>
    :root {
      --bg: #ffffff;
      --fg: #1a1a1a;
      --bg-secondary: #f5f5f5;
      --border: #e0e0e0;
      --fg-muted: #666666;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1a2e;
        --fg: #e0e0e0;
        --bg-secondary: #16213e;
        --border: #333355;
        --fg-muted: #999999;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
      padding: 2rem;
      max-width: 1100px;
      margin: 0 auto;
    }
    header { margin-bottom: 2rem; }
    header h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .meta { color: var(--fg-muted); font-size: 0.875rem; }
    .summary-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 2rem;
      padding: 1rem;
      background: var(--bg-secondary);
      border-radius: 8px;
    }
    .summary-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.25rem 0.75rem;
      border-radius: 6px;
      font-size: 0.875rem;
    }
    .domain-section {
      margin-bottom: 2rem;
      padding: 1rem 1rem 1rem 1.5rem;
      background: var(--bg-secondary);
      border-radius: 8px;
    }
    .domain-heading {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
      font-size: 1.125rem;
    }
    .test-count { color: var(--fg-muted); font-size: 0.875rem; font-weight: normal; }
    .test-row { border-top: 1px solid var(--border); padding: 0.5rem 0; }
    .test-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    .test-header.expandable { cursor: pointer; }
    .test-name { font-weight: 500; }
    .test-file { color: var(--fg-muted); font-size: 0.8rem; }
    .test-scores { color: var(--fg-muted); font-size: 0.8rem; }
    .grade-badge {
      display: inline-block;
      padding: 0.1rem 0.5rem;
      border-radius: 4px;
      font-weight: 700;
      font-size: 0.8rem;
    }
    .grade-a { background: #d4edda; color: #155724; }
    .grade-b { background: #cce5ff; color: #004085; }
    .grade-c { background: #fff3cd; color: #856404; }
    .grade-d { background: #ffe0cc; color: #803300; }
    .grade-f { background: #f8d7da; color: #721c24; }
    @media (prefers-color-scheme: dark) {
      .grade-a { background: #1b3a26; color: #7dcea0; }
      .grade-b { background: #1a2e4a; color: #7fb3e0; }
      .grade-c { background: #3a3520; color: #d4b84f; }
      .grade-d { background: #3a2510; color: #d4956a; }
      .grade-f { background: #3a1a1e; color: #e07a84; }
    }
    .tag {
      display: inline-block;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      font-size: 0.75rem;
      background: var(--border);
      color: var(--fg-muted);
    }
    .cap-badge {
      display: inline-block;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      font-size: 0.75rem;
      background: #f8d7da;
      color: #721c24;
    }
    .test-body {
      display: none;
      margin-top: 0.5rem;
      border-radius: 6px;
      overflow-x: auto;
    }
    .test-body.open { display: block; }
    .test-body pre { border-radius: 6px; padding: 1rem !important; font-size: 0.8rem; }
    .unclassified-hint {
      color: var(--fg-muted);
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }
    .unclassified-hint a { color: inherit; }
    footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      color: var(--fg-muted);
      font-size: 0.8rem;
    }
    footer a { color: inherit; }
  </style>
</head>
<body>
  <header>
    <h1>TestLens Report</h1>
    <p class="meta">branch: <strong>${escapeHtml(branch)}</strong> &middot; base: <strong>${escapeHtml(baseBranch)}</strong></p>
  </header>

  <div class="summary-bar">
    ${summaryBadges}
  </div>

  ${domainSections.join("\n")}
  ${unclassifiedHtml}

  <footer>
    <p>Generated by <strong>testlens</strong> &middot; base: ${escapeHtml(baseBranch)}</p>
    <p>Tag your tests with <a href="TESTLENS_SKILL.md">TESTLENS_SKILL.md</a></p>
  </footer>

  <script>
    function toggleBody(index) {
      var el = document.getElementById("body-" + index);
      if (el) el.classList.toggle("open");
    }
  </script>
</body>
</html>`;
}
