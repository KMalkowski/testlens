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

const GRADES: Grade[] = ["A", "B", "C", "D", "F"];
const gradeOrder: Record<Grade, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function highlightCode(code: string): Promise<string> {
  return codeToHtml(code, { lang: "typescript", theme: "github-light" });
}

function bodyKey(filePath: string, testName: string): string {
  return `${filePath}::${testName}`;
}

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

function gradeDistribution(tests: GradedTest[]): Record<Grade, number> {
  const counts: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const t of tests) counts[t.grade]++;
  return counts;
}

function distributionBar(counts: Record<Grade, number>, total: number): string {
  if (total === 0) return "";
  const segs = GRADES.filter((g) => counts[g] > 0)
    .map((g) => {
      const pct = (counts[g] / total) * 100;
      return `<span class="bar-${g}" style="width:${pct.toFixed(2)}%"></span>`;
    })
    .join("");
  return `<div class="bar">${segs}</div>`;
}

function gauge(score: number): string {
  const clamped = Math.max(0, Math.min(10, score));
  const pct = clamped * 10;
  return `<span class="gauge"><span style="width:${pct}%"></span></span>`;
}

function renderTags(test: GradedTest): string {
  const parts: string[] = [];
  for (const t of test.tags) {
    const cls =
      t === "critical"
        ? "tag crit"
        : t === "regression"
          ? "tag reg"
          : t === "flaky"
            ? "tag crit"
            : "tag";
    parts.push(`<span class="${cls}">${escapeHtml(t)}</span>`);
  }
  if (test.isCapped) parts.push(`<span class="tag no">no tag</span>`);
  return parts.join(" ");
}

function renderTestRow(test: GradedTest, body: string | undefined, index: number): string {
  const expandable = body ? " expandable" : "";
  const toggleAttr = body ? `onclick="toggleBody(${index})"` : "";
  const flakyBad = test.flakinessScore <= 4 ? " bad" : "";

  const bodyHtml = body
    ? `<div class="test-body" id="body-${index}"><div class="code-frame">${body}</div></div>`
    : "";

  return `<div class="test-row">
  <div class="row-test${expandable}" ${toggleAttr}>
    <span class="gbadge ${test.grade}">${test.grade}</span>
    <div class="row-name">
      <div class="nm">${escapeHtml(test.name)}</div>
      <div class="fp">${escapeHtml(test.filePath)}</div>
    </div>
    <div class="scores">
      <div class="s useful"><span class="lbl">use</span>${gauge(test.usefulnessScore)}<span class="v">${test.usefulnessScore}</span></div>
      <div class="s flaky${flakyBad}"><span class="lbl">flk</span>${gauge(test.flakinessScore)}<span class="v">${test.flakinessScore}</span></div>
    </div>
    <div class="tags">${renderTags(test)}</div>
  </div>
  ${bodyHtml}
</div>`;
}

async function renderTestRows(
  tests: GradedTest[],
  testBodies: Map<string, string>,
  indexOffset: number,
): Promise<{ html: string; consumed: number }> {
  const sorted = [...tests].sort((a, b) => gradeOrder[a.grade] - gradeOrder[b.grade]);
  const rows: string[] = [];
  for (const [i, t] of sorted.entries()) {
    const rawBody = testBodies.get(bodyKey(t.filePath, t.name));
    const highlighted = rawBody ? await highlightCode(rawBody) : undefined;
    rows.push(renderTestRow(t, highlighted, indexOffset + i));
  }
  return { html: rows.join("\n"), consumed: sorted.length };
}

async function renderDomainBlock(
  domain: DomainConfig,
  tests: GradedTest[],
  testBodies: Map<string, string>,
  indexOffset: number,
  isOpen: boolean,
): Promise<{ html: string; consumed: number }> {
  const grade = averageGrade(tests);
  const { html: rowsHtml, consumed } = await renderTestRows(tests, testBodies, indexOffset);
  const open = isOpen ? " open" : "";

  return {
    html: `<div class="domain-block${open}" data-domain="${escapeHtml(domain.id)}" style="--domain-color:${domain.color}">
  <div class="db-h" onclick="this.parentElement.classList.toggle('open')">
    <span class="chev">&#9654;</span>
    <span class="db-dot" style="background:${domain.color}"></span>
    <span class="db-name">${escapeHtml(domain.label)}</span>
    <span class="db-count">${tests.length} ${tests.length === 1 ? "test" : "tests"}</span>
    <span class="grade gr-${grade}">${grade}</span>
  </div>
  <div class="db-body">
    ${rowsHtml}
  </div>
</div>`,
    consumed,
  };
}

async function renderUnclassified(
  tests: GradedTest[],
  testBodies: Map<string, string>,
  indexOffset: number,
): Promise<string> {
  const { html: rowsHtml } = await renderTestRows(tests, testBodies, indexOffset);
  return `<section class="sec">
  <div class="sec-eyebrow">Untagged</div>
  <div class="sec-h">
    <h2>Unclassified <em>· ${tests.length} untagged ${tests.length === 1 ? "test" : "tests"}</em></h2>
    <span class="hint">capped at configured grade</span>
  </div>
  <div class="unclassified">
    <h3>These tests have no <code>@domain</code> tag.</h3>
    <p>Untagged tests are capped regardless of how good the assertions are. Open <a href="TESTLENS_SKILL.md">TESTLENS_SKILL.md</a> with your LLM of choice and paste the file — about a minute per file.</p>
    <div class="unclassified-list">
      ${rowsHtml}
    </div>
  </div>
</section>`;
}

function renderDomainCards(domains: DomainConfig[], domainMap: Map<string, GradedTest[]>): string {
  const cards: string[] = [];
  for (const d of domains) {
    const tests = domainMap.get(d.id);
    if (!tests || tests.length === 0) continue;
    const grade = averageGrade(tests);
    const counts = gradeDistribution(tests);
    const lowCount = counts.D + counts.F;
    const lowSuffix = lowCount > 0 ? ` · ${lowCount} below C` : "";
    cards.push(
      `<div class="dom" style="--domain-color:${d.color}">
  <div class="row1">
    <span class="name"><span class="dom-dot" style="background:${d.color}"></span>${escapeHtml(d.label)}</span>
    <span class="id">${escapeHtml(d.id)}</span>
  </div>
  <div class="row2">
    <span class="gr gr-${grade}">${grade}</span>
    <span class="count-pill">${tests.length} ${tests.length === 1 ? "test" : "tests"}</span>
  </div>
  ${distributionBar(counts, tests.length)}
  <div class="count">${gradeBreakdownLabel(counts)}${lowSuffix}</div>
</div>`,
    );
  }
  return cards.join("\n      ");
}

function gradeBreakdownLabel(counts: Record<Grade, number>): string {
  const parts: string[] = [];
  for (const g of GRADES) if (counts[g] > 0) parts.push(`${counts[g]}${g}`);
  return parts.join(" · ");
}

export async function generateHtmlReport(input: ReportInput): Promise<string> {
  const { branch, baseBranch, domains, gradedTests, testBodies } = input;

  // Group tests by domain.
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

  // Render the domain detail blocks (sorted worst → best by domain grade).
  const presentDomains = domains
    .filter((d) => domainMap.has(d.id))
    .map((d) => ({
      domain: d,
      tests: domainMap.get(d.id) ?? [],
      grade: averageGrade(domainMap.get(d.id) ?? []),
    }))
    .sort((a, b) => gradeOrder[a.grade] - gradeOrder[b.grade]);

  const domainBlocks: string[] = [];
  let indexOffset = 0;
  for (const [i, entry] of presentDomains.entries()) {
    const { html, consumed } = await renderDomainBlock(
      entry.domain,
      entry.tests,
      testBodies,
      indexOffset,
      i === 0, // first (worst) domain auto-opens
    );
    domainBlocks.push(html);
    indexOffset += consumed;
  }

  const unclassifiedHtml =
    untagged.length > 0 ? await renderUnclassified(untagged, testBodies, indexOffset) : "";

  // Suite-level summary.
  const suiteGrade = averageGrade(gradedTests);
  const total = gradedTests.length;
  const domainsTouched = presentDomains.length;
  const untaggedCount = untagged.length;
  const distCounts = gradeDistribution(gradedTests);
  const concerningCount = distCounts.D + distCounts.F;

  // Domain summary cards.
  const domainCardsHtml = renderDomainCards(domains, domainMap);

  // Filter chips: All / per-domain (only those present).
  const chipParts: string[] = [
    `<button class="chip active" data-filter="all">All domains</button>`,
  ];
  for (const entry of presentDomains) {
    chipParts.push(
      `<button class="chip" data-filter="${escapeHtml(entry.domain.id)}">${escapeHtml(entry.domain.label)}</button>`,
    );
  }
  const chipsHtml = chipParts.join("\n      ");

  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);

  const titleAccent =
    concerningCount > 0
      ? `<em>${concerningCount} test${concerningCount === 1 ? "" : "s"} below C</em>`
      : `<em>holding at ${suiteGrade}</em>`;
  const lede =
    total === 0
      ? `No graded tests in this run.`
      : `${total} test${total === 1 ? "" : "s"} across ${domainsTouched} domain${domainsTouched === 1 ? "" : "s"}${untaggedCount > 0 ? `, plus ${untaggedCount} untagged` : ""}.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TestLens Report — ${escapeHtml(branch)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,700&family=JetBrains+Mono:wght@400;500;700&display=swap');

    /* ──────────────────────────────────────────────────────────────────
       SWM Structured — Brutalist + Tactile Modernism
       Light-default with dark fallback via prefers-color-scheme.
       Cards = foreground plate + solid offset shadow plate.
       ────────────────────────────────────────────────────────────────── */
    :root {
      /* Page & paper */
      --bg:        #f5f1ea;            /* warm cream canvas */
      --paper:     #ffffff;            /* card foreground */
      --paper-2:   #fbf6e9;            /* tinted secondary surface */
      --section-1: #dde1ff;            /* tertiary-fixed lavender wash */
      --section-2: #fce27d;            /* secondary-fixed yellow wash */

      /* Ink */
      --ink:       #131313;            /* primary text — near black */
      --ink-2:     #45464f;            /* outline-variant */
      --ink-3:     #90909a;            /* outline */

      /* Brand accents (per DESIGN.md prose) */
      --navy:        #010f3b;          /* primary-container */
      --navy-2:      #212e59;          /* on-primary */
      --navy-on:     #ffffff;
      --navy-on-2:   #c7cef5;          /* lavender text on navy */
      --lavender:    #b8c4f9;          /* primary */
      --lavender-2:  #707cac;          /* on-primary-container */
      --yellow:      #ffe580;          /* prose accent yellow */
      --yellow-2:    #dec664;          /* secondary */
      --yellow-on:   #3a3000;
      --tertiary:    #bec5eb;
      --tertiary-2:  #757ca0;

      /* Grade swatches */
      --grade-a-bg:   #c7e8b8;  --grade-a-on: #1f4318;
      --grade-b-bg:   #b8c4f9;  --grade-b-on: #212e59;
      --grade-c-bg:   #ffe580;  --grade-c-on: #3a3000;
      --grade-d-bg:   #ffc6a8;  --grade-d-on: #5a2300;
      --grade-f-bg:   #ffb4ab;  --grade-f-on: #5e0008;
      --grade-a-fg:   #2e6b1c;
      --grade-b-fg:   #2a3c7e;
      --grade-c-fg:   #6b5300;
      --grade-d-fg:   #94400e;
      --grade-f-fg:   #93000a;

      /* Hard offset shadow */
      --shadow:    #131313;
      --shadow-2:  #010f3b;            /* navy shadow on coloured surfaces */

      /* Borders — brutalist 2px */
      --border-w:  2px;
      --border:    var(--border-w) solid var(--ink);

      /* Type */
      --font-sans: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, Roboto, 'Helvetica Neue', Arial, sans-serif;
      --font-mono: 'JetBrains Mono', 'SF Mono', 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace;

      /* Spacing (8px base) */
      --r-sm: 4px;
      --r-md: 6px;
      --r-lg: 8px;

      /* Force light brutalist look regardless of OS preference. */
      color-scheme: light;
    }

    /* The brutalist palette is hard-coded light by design; the
       prefers-color-scheme query below is intentionally a no-op so
       form controls / scrollbars stay light on dark-mode systems. */
    @media (prefers-color-scheme: dark) {
      :root { color-scheme: light; }
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--ink);
      font-family: var(--font-sans);
      font-size: 16px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .page { max-width: 1280px; margin: 0 auto; padding: 32px 32px 80px; }

    /* ── Header ───────────────────────────────────────────────────── */
    .top {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 0 24px;
      border-bottom: var(--border);
      margin-bottom: 48px;
      flex-wrap: wrap; gap: 16px;
    }
    .brand { display: flex; align-items: center; gap: 14px; }
    .brand-mark {
      width: 36px; height: 36px;
      background: var(--yellow);
      border: var(--border);
      border-radius: var(--r-sm);
      box-shadow: 4px 4px 0 0 var(--shadow);
      position: relative;
    }
    .brand-mark::after {
      content: ''; position: absolute; inset: 6px;
      background: var(--navy);
      border-radius: 1px;
    }
    .brand-name {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 22px;
      letter-spacing: -0.01em;
      color: var(--ink);
    }
    .top-meta {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--ink-2);
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
    }
    .top-meta b { color: var(--ink); font-weight: 700; }
    .top-meta .sep { color: var(--ink-3); }

    /* ── Title ────────────────────────────────────────────────────── */
    h1.title {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 48px;
      line-height: 1.1;
      letter-spacing: -0.02em;
      margin: 0 0 12px;
      color: var(--ink);
    }
    h1.title em {
      font-style: italic;
      color: var(--ink);
      background: var(--yellow);
      padding: 0 8px;
      border: var(--border);
      border-radius: var(--r-sm);
      box-shadow: 4px 4px 0 0 var(--shadow);
      display: inline-block;
      line-height: 1.05;
    }
    .lede {
      color: var(--ink-2);
      font-size: 18px;
      line-height: 1.6;
      max-width: 64ch;
      margin: 0;
    }

    /* ── Eyebrow labels ───────────────────────────────────────────── */
    .sec-eyebrow {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--ink-2);
      margin-bottom: 8px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .sec-eyebrow::before {
      content: '';
      width: 12px; height: 12px;
      background: var(--navy);
      display: inline-block;
      border-radius: var(--r-sm);
    }

    /* ── Summary section (hero) ───────────────────────────────────── */
    .summary {
      margin-top: 48px;
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 32px;
    }
    .grade-card {
      background: var(--navy);
      color: var(--navy-on);
      border: var(--border);
      border-radius: var(--r-lg);
      padding: 32px;
      display: flex; align-items: center; gap: 24px;
      box-shadow: 10px 10px 0 0 var(--yellow);
      position: relative;
    }
    .grade-card .lbl {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--lavender);
      margin-bottom: 6px;
    }
    .grade-letter {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 112px;
      line-height: 0.85;
      letter-spacing: -0.04em;
    }
    .grade-card .meta { line-height: 1.3; }
    .grade-card .meta-line {
      margin-top: 6px;
      color: var(--navy-on-2);
      font-size: 14px;
    }
    .grade-letter.gr-A { color: #c7e8b8; }
    .grade-letter.gr-B { color: var(--lavender); }
    .grade-letter.gr-C { color: var(--yellow); }
    .grade-letter.gr-D { color: #ffc6a8; }
    .grade-letter.gr-F { color: var(--grade-f-bg); }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
    }
    .stat {
      background: var(--paper);
      border: var(--border);
      border-radius: var(--r-lg);
      padding: 20px;
      box-shadow: 6px 6px 0 0 var(--shadow);
      transition: transform 0.12s, box-shadow 0.12s;
    }
    .stat .lbl {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--ink-2);
    }
    .stat .v {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 48px;
      line-height: 1;
      letter-spacing: -0.025em;
      margin-top: 12px;
      color: var(--ink);
    }
    .stat .sub {
      font-size: 12px;
      color: var(--ink-2);
      margin-top: 8px;
      font-family: var(--font-mono);
    }
    .stat.bad  { background: var(--grade-d-bg); color: var(--grade-d-on); }
    .stat.bad .v, .stat.bad .lbl, .stat.bad .sub { color: var(--grade-d-on); }
    .stat.warn { background: var(--yellow); color: var(--yellow-on); }
    .stat.warn .v, .stat.warn .lbl, .stat.warn .sub { color: var(--yellow-on); }
    .stat.good { background: var(--grade-a-bg); color: var(--grade-a-on); }
    .stat.good .v, .stat.good .lbl, .stat.good .sub { color: var(--grade-a-on); }

    /* ── Grade text colors ────────────────────────────────────────── */
    .gr-A { color: var(--grade-a-fg); }
    .gr-B { color: var(--grade-b-fg); }
    .gr-C { color: var(--grade-c-fg); }
    .gr-D { color: var(--grade-d-fg); }
    .gr-F { color: var(--grade-f-fg); }

    /* ── Sections ─────────────────────────────────────────────────── */
    .sec { margin-top: 80px; }
    .sec-h {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .sec-h h2 {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 32px;
      letter-spacing: -0.01em;
      margin: 0;
      color: var(--ink);
    }
    .sec-h h2 em {
      font-style: italic;
      font-weight: 400;
      color: var(--ink-2);
      font-size: 0.7em;
    }
    .sec-h .hint {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--ink-2);
      background: var(--paper);
      border: var(--border);
      border-radius: var(--r-sm);
      padding: 6px 10px;
      box-shadow: 3px 3px 0 0 var(--shadow);
    }

    /* ── Domain summary cards ─────────────────────────────────────── */
    .domains {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
    }
    .dom {
      background: var(--paper);
      border: var(--border);
      border-top: 6px solid var(--domain-color, var(--ink));
      border-radius: var(--r-md);
      padding: 18px 20px;
      box-shadow: 6px 6px 0 0 var(--shadow);
      transition: transform 0.12s, box-shadow 0.12s;
    }
    .dom:hover {
      transform: translate(-2px, -2px);
      box-shadow: 8px 8px 0 0 var(--shadow);
    }
    .dom .row1 {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
    .dom .name {
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.005em;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--ink);
    }
    .dom-dot {
      width: 10px; height: 10px;
      border-radius: 2px;
      border: 1.5px solid var(--ink);
      display: inline-block;
    }
    .dom .id {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--ink-3);
      text-transform: lowercase;
    }
    .dom .row2 {
      display: flex;
      align-items: end;
      justify-content: space-between;
      margin-top: 12px;
    }
    .dom .gr {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 56px;
      line-height: 0.85;
      letter-spacing: -0.03em;
    }
    .count-pill {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      color: var(--ink);
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--bg);
      border: 1.5px solid var(--ink);
    }
    .dom .bar {
      display: flex;
      gap: 0;
      height: 8px;
      margin-top: 14px;
      border-radius: 2px;
      overflow: hidden;
      border: 1.5px solid var(--ink);
      background: var(--bg);
    }
    .dom .count {
      font-size: 11px;
      color: var(--ink-2);
      margin-top: 8px;
      font-family: var(--font-mono);
      font-weight: 500;
    }
    .bar-A { background: var(--grade-a-bg); }
    .bar-B { background: var(--grade-b-bg); }
    .bar-C { background: var(--grade-c-bg); }
    .bar-D { background: var(--grade-d-bg); }
    .bar-F { background: var(--grade-f-bg); }

    /* ── Toolbar (chips + search) ─────────────────────────────────── */
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 24px;
    }
    .chip {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 8px 14px;
      border-radius: var(--r-sm);
      border: var(--border);
      background: var(--paper);
      color: var(--ink);
      cursor: pointer;
      transition: transform 0.1s, box-shadow 0.1s, background 0.1s;
      box-shadow: 3px 3px 0 0 var(--shadow);
    }
    .chip:hover {
      transform: translate(-1px, -1px);
      box-shadow: 4px 4px 0 0 var(--shadow);
    }
    .chip:active {
      transform: translate(2px, 2px);
      box-shadow: 1px 1px 0 0 var(--shadow);
    }
    .chip.active {
      background: var(--yellow);
      color: var(--yellow-on);
    }
    .search {
      margin-left: auto;
      padding: 8px 14px;
      border: var(--border);
      border-radius: var(--r-sm);
      background: var(--paper);
      color: var(--ink);
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 500;
      width: 240px;
      box-shadow: 3px 3px 0 0 var(--shadow);
    }
    .search::placeholder { color: var(--ink-3); }
    .search:focus {
      outline: none;
      background: var(--yellow);
      color: var(--yellow-on);
    }

    /* ── Domain accordion blocks ──────────────────────────────────── */
    .domain-block {
      background: var(--paper);
      border: var(--border);
      border-left: 8px solid var(--domain-color, var(--ink));
      border-radius: var(--r-md);
      overflow: hidden;
      margin-bottom: 24px;
      box-shadow: 6px 6px 0 0 var(--shadow);
    }
    .db-h {
      padding: 18px 22px;
      display: flex;
      align-items: center;
      gap: 14px;
      border-bottom: 0;
      background: var(--paper);
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    .db-h:hover { background: var(--paper-2); }
    .domain-block.open .db-h {
      border-bottom: var(--border);
      background: var(--paper-2);
    }
    .db-h .chev {
      color: var(--ink);
      font-size: 12px;
      transition: transform 0.15s;
      width: 12px;
    }
    .domain-block.open .db-h .chev { transform: rotate(90deg); }
    .db-dot {
      width: 12px; height: 12px;
      border-radius: 2px;
      border: 1.5px solid var(--ink);
      display: inline-block;
    }
    .db-h .db-name {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 20px;
      letter-spacing: -0.01em;
      flex: 1;
      color: var(--ink);
    }
    .db-h .db-count {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 11px;
      color: var(--ink-2);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: var(--bg);
      padding: 5px 10px;
      border: 1.5px solid var(--ink);
      border-radius: 999px;
    }
    .db-h .grade {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 36px;
      line-height: 1;
      letter-spacing: -0.02em;
    }
    .db-body { display: none; }
    .domain-block.open .db-body { display: block; }

    /* ── Test rows ────────────────────────────────────────────────── */
    .test-row { border-bottom: 1px solid var(--ink-3); }
    .test-row:last-child { border-bottom: 0; }
    .row-test {
      display: grid;
      grid-template-columns: 40px 1fr 240px minmax(160px, auto);
      gap: 16px;
      padding: 14px 22px;
      align-items: center;
    }
    .row-test.expandable { cursor: pointer; }
    .row-test.expandable:hover { background: var(--paper-2); }

    .gbadge {
      width: 32px; height: 32px;
      border-radius: var(--r-sm);
      display: grid; place-items: center;
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 16px;
      line-height: 1;
      border: 1.5px solid var(--ink);
      box-shadow: 2px 2px 0 0 var(--ink);
    }
    .gbadge.A { background: var(--grade-a-bg); color: var(--grade-a-on); }
    .gbadge.B { background: var(--grade-b-bg); color: var(--grade-b-on); }
    .gbadge.C { background: var(--grade-c-bg); color: var(--grade-c-on); }
    .gbadge.D { background: var(--grade-d-bg); color: var(--grade-d-on); }
    .gbadge.F { background: var(--grade-f-bg); color: var(--grade-f-on); }

    .row-name .nm {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.3;
      color: var(--ink);
    }
    .row-name .fp {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--ink-2);
      margin-top: 4px;
    }

    .scores {
      display: flex;
      gap: 16px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--ink-2);
    }
    .scores .s {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .scores .lbl {
      color: var(--ink-3);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .scores .v {
      font-weight: 700;
      color: var(--ink);
      width: 18px;
      text-align: right;
    }
    .gauge {
      width: 56px; height: 8px;
      border-radius: 2px;
      background: var(--bg);
      border: 1.5px solid var(--ink);
      overflow: hidden;
      display: inline-block;
    }
    .gauge > span { display: block; height: 100%; }
    .scores .useful .gauge > span { background: var(--lavender); }
    .scores .flaky .gauge > span { background: var(--grade-a-bg); }
    .scores .flaky.bad .gauge > span { background: var(--grade-d-bg); }

    .row-test .tags {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .tag {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 10px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 4px 8px;
      border-radius: var(--r-sm);
      background: var(--bg);
      border: 1.5px solid var(--ink);
      color: var(--ink);
    }
    .tag.crit { background: var(--grade-f-bg); color: var(--grade-f-on); }
    .tag.reg  { background: var(--tertiary); color: var(--navy-2); }
    .tag.no   { background: var(--yellow); color: var(--yellow-on); }

    /* ── Expandable test body (Shiki) ─────────────────────────────── */
    .test-body { display: none; padding: 0 22px 18px; }
    .test-body.open { display: block; }
    .code-frame {
      border-radius: var(--r-md);
      overflow: auto;
      border: var(--border);
      box-shadow: 4px 4px 0 0 var(--shadow);
    }
    .code-frame pre {
      margin: 0;
      padding: 16px 18px !important;
      font-family: var(--font-mono);
      font-size: 12.5px;
      line-height: 1.6;
    }
    .code-frame code { font-family: var(--font-mono); }

    /* ── Unclassified / newsletter card ───────────────────────────── */
    .unclassified {
      background: var(--yellow);
      border: var(--border);
      border-radius: var(--r-lg);
      padding: 32px;
      color: var(--yellow-on);
      box-shadow: 8px 8px 0 0 var(--shadow);
    }
    .unclassified h3 {
      font-family: var(--font-sans);
      font-weight: 700;
      font-size: 24px;
      margin: 0 0 12px;
      letter-spacing: -0.01em;
      color: var(--yellow-on);
    }
    .unclassified p {
      color: var(--yellow-on);
      font-size: 16px;
      line-height: 1.6;
      margin: 0 0 20px;
      max-width: 70ch;
    }
    .unclassified p code {
      font-family: var(--font-mono);
      font-size: 13px;
      background: var(--ink);
      color: var(--yellow);
      padding: 2px 8px;
      border-radius: var(--r-sm);
      font-weight: 500;
    }
    .unclassified a {
      color: var(--ink);
      font-weight: 700;
      border-bottom: 2px solid var(--ink);
      text-decoration: none;
    }
    .unclassified-list {
      background: var(--paper);
      border: var(--border);
      border-radius: var(--r-md);
      box-shadow: 4px 4px 0 0 var(--shadow);
      margin-top: 16px;
      overflow: hidden;
    }
    .unclassified-list .row-test {
      padding-left: 18px;
      padding-right: 18px;
    }

    /* ── Footer ───────────────────────────────────────────────────── */
    footer {
      margin-top: 80px;
      padding-top: 24px;
      border-top: var(--border);
      display: flex;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      color: var(--ink-2);
      font-family: var(--font-sans);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    footer a {
      color: var(--ink);
      text-decoration: none;
      border-bottom: 2px solid var(--ink);
    }

    /* ── Responsive ───────────────────────────────────────────────── */
    @media (max-width: 1024px) {
      .summary { grid-template-columns: 1fr; }
      .stats { grid-template-columns: repeat(2, 1fr); }
      .domains { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 640px) {
      .page { padding: 24px 16px 60px; }
      h1.title { font-size: 28px; }
      .grade-letter { font-size: 80px; }
      .stat .v { font-size: 36px; }
      .sec-h h2 { font-size: 24px; }
      .sec { margin-top: 48px; }
      .summary { gap: 24px; }
      .row-test { grid-template-columns: 32px 1fr; gap: 12px; padding: 12px 16px; }
      .row-test .scores, .row-test .tags { grid-column: 2; justify-content: flex-start; }
      .grade-card { padding: 24px; box-shadow: 6px 6px 0 0 var(--yellow); }
      .stat, .dom, .domain-block { box-shadow: 4px 4px 0 0 var(--shadow); }
      .unclassified { padding: 24px; box-shadow: 6px 6px 0 0 var(--shadow); }
      .search { width: 100%; margin-left: 0; }
      .toolbar { gap: 6px; }
    }
  </style>
</head>
<body>
<div class="page">

  <div class="top">
    <div class="brand">
      <div class="brand-mark"></div>
      <div class="brand-name">testlens</div>
    </div>
    <div class="top-meta">
      <span>branch <b>${escapeHtml(branch)}</b></span><span class="sep">·</span>
      <span>base <b>${escapeHtml(baseBranch)}</b></span><span class="sep">·</span>
      <span>${escapeHtml(timestamp)}</span>
    </div>
  </div>

  <div class="sec-eyebrow">Suite report</div>
  <h1 class="title">Suite report — ${titleAccent}.</h1>
  <p class="lede">${lede}</p>

  <div class="summary">
    <div class="grade-card">
      <div class="grade-letter gr-${suiteGrade}">${suiteGrade}</div>
      <div class="meta">
        <div class="lbl">Suite grade</div>
        <div class="meta-line">${total} ${total === 1 ? "test" : "tests"} · ${domainsTouched} ${domainsTouched === 1 ? "domain" : "domains"}</div>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="lbl">Tests</div><div class="v">${total}</div><div class="sub">graded this run</div></div>
      <div class="stat${concerningCount > 0 ? " bad" : ""}"><div class="lbl">Below C</div><div class="v">${concerningCount}</div><div class="sub">D and F combined</div></div>
      <div class="stat good"><div class="lbl">A grade</div><div class="v">${distCounts.A}</div><div class="sub">strong assertions</div></div>
      <div class="stat${untaggedCount > 0 ? " warn" : ""}"><div class="lbl">Untagged</div><div class="v">${untaggedCount}</div><div class="sub">capped by config</div></div>
    </div>
  </div>

  ${
    presentDomains.length > 0
      ? `<div class="sec">
    <div class="sec-eyebrow">Domain breakdown</div>
    <div class="sec-h">
      <h2>Domains <em>· ${presentDomains.length} in this run</em></h2>
      <span class="hint">grade is the mean of tests in domain</span>
    </div>
    <div class="domains">
      ${domainCardsHtml}
    </div>
  </div>`
      : ""
  }

  ${
    presentDomains.length > 0
      ? `<div class="sec">
    <div class="sec-eyebrow">Test detail</div>
    <div class="sec-h">
      <h2>Tests <em>· sorted worst → best</em></h2>
      <span class="hint">click a domain to expand</span>
    </div>
    <div class="toolbar">
      ${chipsHtml}
      <input class="search" placeholder="filter tests…" id="tl-search" />
    </div>
    ${domainBlocks.join("\n")}
  </div>`
      : ""
  }

  ${unclassifiedHtml}

  <footer>
    <span>generated by testlens · self-contained html</span>
    <span><a href="TESTLENS_SKILL.md">TESTLENS_SKILL.md</a></span>
  </footer>

</div>

<script>
  function toggleBody(index) {
    var el = document.getElementById("body-" + index);
    if (el) el.classList.toggle("open");
  }
  (function () {
    var chips = document.querySelectorAll('.chip[data-filter]');
    var blocks = document.querySelectorAll('.domain-block');
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        chips.forEach(function (x) { x.classList.remove('active'); });
        c.classList.add('active');
        var f = c.dataset.filter;
        blocks.forEach(function (b) {
          var dom = b.dataset.domain;
          b.style.display = (f === 'all' || dom === f) ? '' : 'none';
        });
      });
    });
    var search = document.getElementById('tl-search');
    if (search) {
      search.addEventListener('input', function (e) {
        var q = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.test-row').forEach(function (r) {
          var t = r.textContent.toLowerCase();
          r.style.display = (!q || t.indexOf(q) !== -1) ? '' : 'none';
        });
      });
    }
  })();
</script>
</body>
</html>`;
}
