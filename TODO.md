# TestLens MVP — Progress

## Phase 1 — Local grader

- [x] CLI scaffolding with `npx` support
- [x] Config file loading and validation (Zod schemas)
- [x] AST parser for Jest/RTL test files
  - [x] Test name and tag extraction
  - [x] Signal detection (accessible queries, testid queries, visible output assertions, toBeInTheDocument-only, mock count, vague names, timeouts)
- [x] Usefulness scoring (0-10) from signals and tags
- [x] Grade calculation (score to letter grade, cap for untagged)
- [x] Git diff — affected files relative to base branch
- [x] Domain mapping — map affected files to domains via parsed test cases
- [x] Terminal output — delta view and domain view formatting
- [x] Wire CLI to run the full pipeline (parse, score, diff, output)

## Phase 2 — HTML report

- [x] Static HTML generator (single self-contained file)
- [x] Domain sections with grade badges (colour-coded)
- [x] Per-test rows sorted by grade (worst first)
- [x] Syntax-highlighted test body expansion (shiki)
- [x] Unclassified section for untagged tests
- [x] Tagging skill link in report

## Phase 3 — Flakiness + CI

- [ ] JUnit XML parser (jest + playwright)
  - [x] Tests written (`tests/junit/parseJunit.test.ts`)
  - [ ] Implementation (`src/junit/parseJunit.ts`)
- [ ] Flakiness scoring (0-10) from CI history
  - [x] Tests written (`tests/flakiness/score.test.ts`)
  - [ ] Implementation (`src/flakiness/score.ts`)
- [ ] `testlens-history.json` generation and aggregation
  - [x] Tests written (`tests/history/history.test.ts`)
  - [ ] Implementation (`src/history/history.ts`)
- [ ] `--ci` mode (--all + --report + Bitbucket annotation)
  - [x] Integration tests written (`tests/integration/ciMode.test.ts`)
  - [ ] Pipeline wiring for `ci: true` (report output, history append, no-history indicator)
- [ ] Bitbucket Code Insights annotation (optional, config-gated)
  - [x] Tests written (`tests/bitbucket/codeInsights.test.ts`)
  - [ ] Implementation (`src/bitbucket/codeInsights.ts`)

## Phase 4 — Skill generation

- [x] `TESTLENS_SKILL.md` auto-generation from config + top-graded examples
- [x] Regeneration when taxonomy changes (`shouldRegenerateSkill` taxonomy fingerprint)
