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
- [ ] Wire CLI to run the full pipeline (parse, score, diff, output)

## Phase 2 — HTML report

- [ ] Static HTML generator (single self-contained file)
- [ ] Domain sections with grade badges (colour-coded)
- [ ] Per-test rows sorted by grade (worst first)
- [ ] Syntax-highlighted test body expansion (shiki)
- [ ] Unclassified section for untagged tests
- [ ] Tagging skill link in report

## Phase 3 — Flakiness + CI

- [ ] JUnit XML parser (jest + playwright)
- [ ] Flakiness scoring (0-10) from CI history
- [ ] `testlens-history.json` generation and aggregation
- [ ] `--ci` mode (--all + --report + Bitbucket annotation)
- [ ] Bitbucket Code Insights annotation (optional, config-gated)

## Phase 4 — Skill generation

- [ ] `TESTLENS_SKILL.md` auto-generation from config + top-graded examples
- [ ] Regeneration when taxonomy changes
