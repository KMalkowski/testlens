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
  return codeToHtml(code, { lang: "typescript", theme: "github-dark" });
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
    :root {
      --bg: #f5f1ea;
      --paper: #ffffff;
      --paper-2: #faf6ee;
      --line: #e6dfd0;
      --line-2: #cfc7b3;
      --ink: #2a2a26;
      --ink-2: #5e5b50;
      --ink-3: #94907f;

      --mint: #c1e0c8; --mint-d: #4d8a5f;
      --sky: #bcd6e6;  --sky-d: #3d6b88;
      --butter: #f2dc97; --butter-d: #8e6c1c;
      --coral: #f3b9a4; --coral-d: #b85838;
      --rose: #ed9080;   --rose-d: #99291a;
      --lilac: #d9c8e6; --lilac-d: #6b4d8c;

      --serif: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, 'Apple Garamond', Baskerville, Georgia, serif;
      --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, Roboto, 'Helvetica Neue', Arial, sans-serif;
      --mono: 'SFMono-Regular', 'SF Mono', 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1c1b18;
        --paper: #25241f;
        --paper-2: #2c2b25;
        --line: #3a3830;
        --line-2: #4f4c41;
        --ink: #ece7da;
        --ink-2: #b3ad9c;
        --ink-3: #847f6f;

        --mint-d: #8fc59c;
        --sky-d: #8ab4cf;
        --butter-d: #d4b669;
        --coral-d: #e09277;
        --rose-d: #d96a5a;
        --lilac-d: #b094c9;
      }
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--ink);
      font-family: var(--sans);
      font-size: 14px;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    .page { max-width: 1180px; margin: 0 auto; padding: 36px 32px 80px; }

    /* header */
    .top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 22px; border-bottom: 1px solid var(--line); margin-bottom: 28px; flex-wrap: wrap; gap: 12px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 26px; height: 26px; border-radius: 8px; background: linear-gradient(135deg, var(--mint) 0%, var(--sky) 100%); border: 1px solid rgba(0,0,0,0.08); }
    .brand-name { font-family: var(--serif); font-weight: 500; font-size: 19px; letter-spacing: -0.01em; }
    .top-meta { font-family: var(--mono); font-size: 12px; color: var(--ink-2); display: flex; gap: 14px; flex-wrap: wrap; }
    .top-meta b { color: var(--ink); font-weight: 600; }
    .top-meta .sep { color: var(--line-2); }

    h1.title { font-family: var(--serif); font-weight: 400; font-size: 36px; line-height: 1.08; letter-spacing: -0.02em; margin: 0 0 8px; }
    h1.title em { font-style: italic; color: var(--coral-d); }
    .lede { color: var(--ink-2); font-size: 15px; max-width: 64ch; margin: 0; }

    /* summary */
    .summary { margin-top: 30px; display: grid; grid-template-columns: 280px 1fr; gap: 18px; }
    .grade-card { background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 22px 26px; display: flex; align-items: center; gap: 22px; }
    .grade-letter { font-family: var(--serif); font-weight: 400; font-size: 84px; line-height: 0.85; letter-spacing: -0.04em; }
    .grade-card .meta { font-size: 13px; color: var(--ink-2); }
    .grade-card .lbl { font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-3); margin-bottom: 4px; }
    .grade-card .meta-line { margin-top: 6px; }

    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .stat { background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
    .stat .lbl { font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-3); }
    .stat .v { font-family: var(--serif); font-weight: 400; font-size: 38px; line-height: 1; margin-top: 6px; letter-spacing: -0.025em; }
    .stat .sub { color: var(--ink-2); font-size: 12px; margin-top: 4px; }
    .stat.bad .v { color: var(--coral-d); }
    .stat.warn .v { color: var(--butter-d); }
    .stat.good .v { color: var(--mint-d); }

    /* grade colors */
    .gr-A { color: var(--mint-d); }
    .gr-B { color: var(--sky-d); }
    .gr-C { color: var(--butter-d); }
    .gr-D { color: var(--coral-d); }
    .gr-F { color: var(--rose-d); }

    /* section heads */
    .sec { margin-top: 44px; }
    .sec-h { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .sec-h h2 { font-family: var(--serif); font-weight: 500; font-size: 22px; letter-spacing: -0.01em; margin: 0; }
    .sec-h h2 em { font-style: italic; font-weight: 400; color: var(--ink-2); }
    .sec-h .hint { font-family: var(--mono); font-size: 11px; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.12em; }

    /* domain summary grid */
    .domains { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .dom { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; transition: transform .15s, box-shadow .15s; }
    .dom:hover { transform: translateY(-1px); box-shadow: 0 6px 16px -10px rgba(42,42,38,0.18); }
    .dom .row1 { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .dom .name { font-weight: 600; font-size: 14.5px; letter-spacing: -0.005em; display: inline-flex; align-items: center; gap: 8px; }
    .dom-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .dom .id { font-family: var(--mono); font-size: 10.5px; color: var(--ink-3); text-transform: lowercase; }
    .dom .row2 { display: flex; align-items: end; justify-content: space-between; margin-top: 10px; }
    .dom .gr { font-family: var(--serif); font-weight: 400; font-size: 44px; line-height: 0.85; letter-spacing: -0.03em; }
    .count-pill { font-family: var(--mono); font-size: 11px; color: var(--ink-3); padding: 3px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); }
    .dom .bar { display: flex; gap: 2px; height: 5px; margin-top: 12px; border-radius: 3px; overflow: hidden; background: var(--bg); }
    .dom .count { font-size: 11.5px; color: var(--ink-3); margin-top: 8px; font-family: var(--mono); }
    .bar-A { background: var(--mint-d); }
    .bar-B { background: var(--sky-d); }
    .bar-C { background: var(--butter-d); }
    .bar-D { background: var(--coral-d); }
    .bar-F { background: var(--rose-d); }

    /* domain detail blocks */
    .domain-block { background: var(--paper); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; margin-bottom: 14px; border-left: 3px solid var(--domain-color, var(--line-2)); }
    .db-h { padding: 14px 18px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid transparent; background: var(--paper-2); cursor: pointer; user-select: none; transition: background .15s; }
    .db-h:hover { background: var(--bg); }
    .domain-block.open .db-h { border-bottom-color: var(--line); }
    .db-h .chev { color: var(--ink-3); font-size: 10px; transition: transform .15s; width: 12px; }
    .domain-block.open .db-h .chev { transform: rotate(90deg); }
    .db-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
    .db-h .db-name { font-family: var(--serif); font-weight: 500; font-size: 18px; letter-spacing: -0.01em; flex: 1; }
    .db-h .db-count { font-family: var(--mono); font-size: 11px; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.12em; }
    .db-h .grade { font-family: var(--serif); font-weight: 400; font-size: 28px; line-height: 1; letter-spacing: -0.02em; }
    .db-body { display: none; }
    .domain-block.open .db-body { display: block; }

    /* test rows */
    .test-row { border-bottom: 1px solid var(--line); }
    .test-row:last-child { border-bottom: 0; }
    .row-test { display: grid; grid-template-columns: 30px 1fr 220px minmax(140px, auto); gap: 16px; padding: 12px 18px; align-items: center; }
    .row-test.expandable { cursor: pointer; }
    .row-test.expandable:hover { background: var(--paper-2); }
    .gbadge { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; font-family: var(--serif); font-weight: 500; font-size: 14px; line-height: 1; }
    .gbadge.A { background: var(--mint); color: #234d2e; }
    .gbadge.B { background: var(--sky); color: #1c3a4d; }
    .gbadge.C { background: var(--butter); color: #5a4316; }
    .gbadge.D { background: var(--coral); color: #5e2010; }
    .gbadge.F { background: var(--rose); color: #4d1208; }
    .row-name .nm { font-size: 14px; font-weight: 500; line-height: 1.3; }
    .row-name .fp { font-family: var(--mono); font-size: 11px; color: var(--ink-3); margin-top: 3px; }
    .scores { display: flex; gap: 14px; font-family: var(--mono); font-size: 11.5px; color: var(--ink-2); }
    .scores .s { display: flex; align-items: center; gap: 6px; }
    .scores .lbl { color: var(--ink-3); }
    .scores .v { font-weight: 600; color: var(--ink); width: 18px; text-align: right; }
    .gauge { width: 50px; height: 6px; border-radius: 3px; background: var(--bg); border: 1px solid var(--line); overflow: hidden; display: inline-block; }
    .gauge > span { display: block; height: 100%; }
    .scores .useful .gauge > span { background: var(--sky-d); }
    .scores .flaky .gauge > span { background: var(--mint-d); }
    .scores .flaky.bad .gauge > span { background: var(--coral-d); }
    .row-test .tags { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .tag { font-family: var(--mono); font-size: 10.5px; padding: 3px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); color: var(--ink-2); }
    .tag.crit { background: rgba(184,88,56,0.1); border-color: rgba(184,88,56,0.3); color: var(--coral-d); }
    .tag.reg { background: rgba(107,77,140,0.1); border-color: rgba(107,77,140,0.3); color: var(--lilac-d); }
    .tag.no { background: rgba(153,41,26,0.08); border-color: rgba(153,41,26,0.25); color: var(--rose-d); }

    /* expandable body */
    .test-body { display: none; padding: 0 18px 16px; }
    .test-body.open { display: block; }
    .code-frame { border-radius: 8px; overflow: auto; border: 1px solid var(--line); }
    .code-frame pre { margin: 0; padding: 14px 16px !important; font-family: var(--mono); font-size: 12px; line-height: 1.55; }
    .code-frame code { font-family: var(--mono); }

    /* toolbar */
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
    .chip { font-family: var(--mono); font-size: 11.5px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--paper); color: var(--ink-2); cursor: pointer; transition: all .15s; }
    .chip:hover { color: var(--ink); border-color: var(--ink-3); }
    .chip.active { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .search { margin-left: auto; padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); font: inherit; font-size: 12.5px; width: 220px; color: var(--ink); }
    .search:focus { outline: none; border-color: var(--ink-3); }

    /* unclassified */
    .unclassified { background: var(--paper); border: 1px dashed var(--line-2); border-radius: 14px; padding: 18px 20px; }
    .unclassified h3 { font-family: var(--serif); font-weight: 500; font-size: 18px; margin: 0 0 6px; letter-spacing: -0.01em; }
    .unclassified p { color: var(--ink-2); font-size: 13.5px; margin: 0 0 14px; max-width: 70ch; }
    .unclassified p code { font-family: var(--mono); font-size: 12px; background: var(--bg); padding: 1px 6px; border-radius: 4px; }
    .unclassified a { color: var(--coral-d); border-bottom: 1px solid currentColor; text-decoration: none; }
    .unclassified-list .row-test { padding-left: 0; padding-right: 0; }

    /* footer */
    footer { margin-top: 50px; padding-top: 22px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: var(--ink-3); font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; }
    footer a { color: var(--coral-d); text-decoration: none; border-bottom: 1px solid currentColor; }

    @media (max-width: 980px) {
      .summary { grid-template-columns: 1fr; }
      .stats { grid-template-columns: repeat(2, 1fr); }
      .domains { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 640px) {
      .page { padding: 24px 18px 60px; }
      .row-test { grid-template-columns: 26px 1fr; gap: 10px; }
      .row-test .scores, .row-test .tags { grid-column: 2; justify-content: flex-start; }
      h1.title { font-size: 28px; }
      .grade-letter { font-size: 64px; }
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
