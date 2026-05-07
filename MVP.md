# TestLens — MVP Spec

**Codename:** `testlens`
**Format:** CLI tool distributed via `npx`
**Target repo type:** Next.js, React Testing Library + Playwright
**Version:** 0.1.0 MVP

---

## 1. Problem Statement

High coverage numbers mask low-quality test suites. Tests written against implementation
rather than behavior create false confidence, break on harmless refactors, and tell
developers nothing meaningful when they fail. This tool makes test quality visible,
actionable, and tied to the domain language of the product — not the file structure
of the codebase.

---

## 2. Core Principles

- **Scope to what you touched.** Developers see grades only for domains affected by
  their current branch diff. No noise, no obligation to fix the whole repo.
- **Penalise silence, not absence.** Untagged tests aren't blocked — they're capped
  and flagged. The tool teaches without mandating.
- **The skill is the onramp.** LLM-assisted tagging is a prompt, not a dependency.
  Any LLM the developer already uses can apply it.
- **The HTML file is the artifact.** No server, no auth, no dashboard to maintain.
  One file per run, shareable, archivable, CI-attachable.

---

## 3. User Flows

### 3.1 Daily developer flow

```
git checkout -b feature/discount-expiry
# ... writes code and tests ...
npx testlens
```

Output:

```
testlens  v0.1.0  comparing against main

  CART        B → B   no change
  CHECKOUT    B → C   ↓ 2 tests degraded
  PRICING     A       not affected by this diff

  1 domain affected. Run `npx testlens --report` for full breakdown.
```

### 3.2 Deep-dive flow

```
npx testlens --report
```

Generates `testlens-report.html` and opens it in the browser. Full domain breakdown,
per-test grades, flakiness flags, and tagging gaps.

### 3.3 Tagging flow (one-time per test file)

Developer notices untagged tests capping a domain at C. They open the
`TESTLENS_SKILL.md` prompt in their LLM of choice, paste the test file, receive
a tagged version, review and commit.

### 3.4 CI flow

```yaml
# bitbucket-pipelines.yml
- step:
    name: Test Intelligence
    script:
      - npx testlens --ci --report
    artifacts:
      - testlens-report.html
```

The HTML report is attached to the pipeline run. On PRs, a Code Insights
annotation is posted with the domain grade summary.

---

## 4. Config File

Lives at repo root as `testlens.config.js`. Committed to version control.
Introduced in a single PR when adopting the tool.

```js
// testlens.config.js
module.exports = {
  // Branch to diff against. Overridable per developer via CLI flag.
  baseBranch: "main",

  // Where your test files live
  testMatch: [
    "**/*.test.tsx",
    "**/*.test.ts",
    "**/*.spec.ts",
    "e2e/**/*.spec.ts",
  ],

  // Where Jest outputs JUnit XML (for flakiness scoring)
  junitOutput: "./test-results/junit.xml",

  // Where Playwright outputs JUnit XML
  playwrightJunitOutput: "./playwright-results/results.xml",

  // Your domain taxonomy — the source of truth for tagging
  domains: [
    { id: "cart", label: "Shopping Cart", color: "#4f86f7" },
    { id: "checkout", label: "Checkout", color: "#f7a44f" },
    { id: "pricing", label: "Pricing & Discounts", color: "#6abf69" },
    { id: "inventory", label: "Inventory", color: "#b07fef" },
    { id: "auth", label: "Authentication", color: "#ef7f7f" },
    { id: "search", label: "Search", color: "#7fd4ef" },
    { id: "pdp", label: "Product Detail", color: "#f7e24f" },
    { id: "orders", label: "Orders & History", color: "#ef7fb0" },
  ],

  // Grade penalties and caps
  grading: {
    // Tests with no @domain tag are capped at this grade
    untaggedCap: "C",

    // Number of recent CI runs to use for flakiness calculation
    flakinessSampleSize: 20,

    // Failure rate threshold to flag a test as flaky
    flakinessThreshold: 0.15, // 15% = flaky
  },

  // Bitbucket Code Insights integration (optional, CI only)
  bitbucket: {
    enabled: false,
    workspace: "",
    repoSlug: "",
  },
};
```

---

## 5. Tagging Convention

Tags live in test `describe` or `it` block names as structured comments.
No new syntax, no custom test runner — just a convention.

```ts
// @domain:checkout @critical
describe('Checkout — guest flow', () => {

  // @domain:checkout
  it('blocks progression when cart is empty', () => { ... })

  // @domain:checkout @edge-case
  it('handles expired session mid-checkout', () => { ... })

})
```

**Supported tags:**

| Tag            | Purpose                                      |
| -------------- | -------------------------------------------- |
| `@domain:<id>` | Maps test to a domain from the taxonomy      |
| `@critical`    | Revenue path — flakiness penalised harder    |
| `@edge-case`   | Expected to be narrow; no usefulness penalty |
| `@regression`  | Was a real bug once; gets a usefulness bonus |
| `@happy-path`  | Marks the primary success flow               |

---

## 6. Grading System

Each test receives two independent scores that combine into a letter grade.

### 6.1 Usefulness Score (0–10)

Measures whether the test proves something meaningful about user-facing behavior.

| Signal                                                   | Points                   |
| -------------------------------------------------------- | ------------------------ |
| Test name describes a user-facing behavior               | +2                       |
| Assertion checks visible output (text, role, visibility) | +2                       |
| Tests a business rule (pricing, inventory, auth logic)   | +2                       |
| Has a `@domain` tag                                      | +1                       |
| Uses `getByRole`, `getByText` over `getByTestId`         | +1                       |
| Has `@regression` tag                                    | +1                       |
| Test name contains only "renders", "works", "test"       | −2                       |
| Only assertion is `toBeInTheDocument` with no behavior   | −2                       |
| Mocks more than 3 dependencies                           | −1                       |
| No `@domain` tag                                         | −1 (+ grade cap applied) |

### 6.2 Flakiness Score (0–10)

Measures how trustworthy the test is over time.

| Signal                                              | Points |
| --------------------------------------------------- | ------ |
| Zero intermittent failures in last N CI runs        | +3     |
| No hardcoded timeouts or arbitrary `waitFor` delays | +2     |
| Isolated — no shared mutable state with other tests | +2     |
| No unmocked network calls                           | +2     |
| Intermittent failure rate > 15% in last N runs      | −4     |
| Uses `setTimeout` / arbitrary delays                | −2     |
| Fails on re-run after initial pass (CI evidence)    | −2     |

### 6.3 Combined Grade

```
Score 9–10  →  A   Trustworthy and meaningful
Score 7–8   →  B   Good, minor improvements possible
Score 5–6   →  C   Needs attention
Score 3–4   →  D   Rewrite candidate
Score 0–2   →  F   Coverage padding — provides false confidence
```

Untagged tests are capped at C regardless of other scores.
`@critical` tests have their flakiness penalty doubled.

---

## 7. CLI Interface

### Commands

```
npx testlens                         # grade diff against base branch, print delta
npx testlens --report                # grade diff + generate testlens-report.html
npx testlens --domain checkout       # full grade for one domain regardless of diff
npx testlens --all                   # grade entire test suite (slow, CI use)
npx testlens --ci                    # CI mode: --all + --report + Bitbucket annotation
npx testlens --base develop          # override base branch for this run
npx testlens --help
```

### Output format (default)

```
testlens  v0.1.0  base: main  branch: feature/discount-expiry

  Domains touched by this diff:

  CHECKOUT    B → C   ↓   3 tests in diff, 1 degraded
  PRICING     A → A       2 tests in diff, no change

  Run `npx testlens --report` to open the full breakdown.
  Run `npx testlens --domain checkout` to inspect checkout in detail.
```

### Output format (--domain)

```
testlens  checkout  14 tests

  A  blocks progression when cart is empty              useful: 9  flaky: 10
  A  applies discount code before tax calculation        useful: 8  flaky: 10
  B  shows order summary before payment step             useful: 7  flaky:  8
  C  renders checkout component                [no tag]  useful: 3  flaky: 10  ← cap
  D  payment step test                                   useful: 2  flaky:  7

  Domain grade: C   (2 rewrite candidates, 1 untagged)
  Run `npx testlens --report` to generate the full HTML report.
```

---

## 8. HTML Report

Generated by `--report`. Opened automatically in the browser. Saved as
`testlens-report.html` in the repo root (gitignored).

### Structure

```
Header
  Tool name, repo name, branch, base branch, run timestamp

Summary bar
  All domains with grade badges — colour-coded by taxonomy config
  Highlight: domains affected by current diff

Domain sections (one per domain)
  Domain name + overall grade
  Test list — sorted by grade ascending (worst first)
    Each row: test name | file | grade | useful score | flaky score | tags
    Expandable: full test body (syntax highlighted)
    Flagged tests: banner explaining why (no tag / flaky / bad assertion)

Unclassified section
  All untagged tests, capped grade shown, tagging skill prompt linked

Footer
  Link to TESTLENS_SKILL.md
  Config summary (base branch, sample size, thresholds)
  Run metadata
```

### Design constraints

- Single self-contained HTML file — no external dependencies
- Inline CSS and JS only
- Domain colours driven by `testlens.config.js` taxonomy
- Printable / PDF-exportable layout
- Dark mode via `prefers-color-scheme`

---

## 9. The Tagging Skill (`TESTLENS_SKILL.md`)

A structured prompt committed to the repo. Works with any LLM.

### What it contains

1. **Context block** — what testlens is, what tags mean, why tagging matters
2. **Taxonomy block** — auto-generated from `testlens.config.js` on first `npx testlens` run
3. **Convention examples** — 2–3 well-tagged tests from the actual codebase
   (pulled from highest-graded tagged tests automatically)
4. **Instruction block** — what to do with the pasted file, what to output,
   how to express uncertainty
5. **Output format** — tagged file + a confidence note per ambiguous test

### Usage

```
1. Open TESTLENS_SKILL.md in your LLM of choice
2. Paste the test file you want to tag
3. Review the output — check ambiguous cases
4. Commit the tagged version
```

The skill is regenerated (taxonomy block only) when domains change in config.

---

## 10. Flakiness Data Source (MVP)

For the MVP, flakiness scoring is derived from JUnit XML only — no Bitbucket
API calls required.

**How it works:**

- Developer runs `npx testlens --ci` in each pipeline run
- JUnit XML is parsed and a lightweight `testlens-history.json` is generated
- This file is stored as a Bitbucket pipeline artifact
- On each run, testlens fetches the last N artifact files via the Bitbucket API
  to compute failure rates per test name

**MVP fallback (no history yet):**

- Flakiness score defaults to neutral (5/10)
- Static signals only: timeouts, unmocked network, shared state
- A `[no history]` label appears in the report
- After 5+ CI runs, real flakiness data kicks in automatically

---

## 11. What's Out of Scope for MVP

| Feature                         | Why deferred                                          |
| ------------------------------- | ----------------------------------------------------- |
| Suggested test rewrites         | Requires LLM call in the tool — good v2 feature       |
| Trend charts across runs        | Needs persistent storage layer                        |
| Slack / email notifications     | Nice to have, not daily driver behaviour              |
| Auto-tagging built into CLI     | Skill approach preferred; avoids LLM dependency       |
| VS Code extension               | CLI first, validate usefulness before IDE investment  |
| Team leaderboard / gamification | Potential for negative culture effects, needs thought |

---

## 12. Build Roadmap

### Phase 1 — Local grader (2–3 days)

- CLI scaffolding with `npx` support
- Config file loading and validation
- AST parser for Jest/RTL test files (usefulness scoring)
- Tag parser
- Git diff → affected files → affected domains
- Terminal output (delta view + domain view)

### Phase 2 — HTML report (2–3 days)

- Static HTML generator
- Domain sections, test rows, grade badges
- Syntax-highlighted test body expansion
- Tagging skill link + unclassified section

### Phase 3 — Flakiness + CI (2–3 days)

- JUnit XML parser
- `testlens-history.json` generation and aggregation
- `--ci` mode
- Bitbucket Code Insights annotation (optional, config-gated)

### Phase 4 — Skill generation (1 day)

- `TESTLENS_SKILL.md` auto-generation from config + top-graded examples
- Regeneration when taxonomy changes

---

## 13. Success Criteria for MVP

The MVP is successful if:

1. A developer can run `npx testlens` on a feature branch and in under 5 seconds
   know whether their changes degraded any domain's test quality
2. A tech lead can open `testlens-report.html` and immediately identify the 5 worst
   tests in the repo without reading any code
3. A developer can use `TESTLENS_SKILL.md` with their LLM of choice and produce
   correctly tagged tests for a file in under 2 minutes
4. The tool introduces zero new required dependencies to the repo beyond
   a config file and a gitignored HTML output
