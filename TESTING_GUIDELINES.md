# Testing Guidelines

These guidelines are for humans and LLM agents working on TestLens. The goal is to keep
the CLI reliable while making test-driven development easy to follow.

## Default TDD Loop

For every behavior change:

1. Add or update the smallest failing test that describes the behavior.
2. Run the focused test with `pnpm vitest run <path>`.
3. Implement the minimum production change.
4. Rerun the focused test.
5. Run `pnpm verify` before considering the task complete.

Do not treat parser or scoring changes as complete without tests. TestLens is an analyzer,
so most regressions will look like valid code being interpreted incorrectly.

## Test Layers

Use the lightest layer that proves the behavior.

| Layer | Location | Use For |
| --- | --- | --- |
| Unit tests | `tests/**/*.test.ts` | Pure grading, scoring, tag parsing, config validation |
| Parser fixture tests | `tests/parser/**/*.test.ts` and `tests/fixtures/**` | Realistic TS/TSX test files and AST edge cases |
| Integration tests | `tests/integration/**/*.test.ts` | Git diff behavior, JUnit history, report generation |
| CLI smoke tests | `tests/cli/**/*.test.ts` | Built `dist/cli.js`, exit codes, flags, output shape |

Prefer unit tests for domain logic. Use integration tests only when the behavior depends on
real filesystem, Git, JUnit XML, or the built CLI artifact.

## Fixture Policy

Fixtures should be realistic and intentionally named.

- Put reusable fixtures under `tests/fixtures/`.
- Use `.test.ts`, `.test.tsx`, `.spec.ts`, or `.spec.tsx` when testing parser behavior.
- Keep fixture files small, but include real syntax patterns from Next.js, React Testing
  Library, Jest, Vitest, and Playwright.
- When fixing a parser bug, add a fixture or fixture snippet that would have failed before
  the fix.
- Do not hide important parser cases in inline strings if a fixture file would be clearer.

Good parser cases to cover:

- `it`, `test`, `it.skip`, `test.only`, `describe`
- nested `describe` blocks
- standalone tag comments above tests
- inline tag comments near test names
- missing `@domain` tags
- TSX syntax
- Testing Library queries such as `getByRole`, `getByText`, `getByTestId`
- mocks, timers, arbitrary waits, network calls

## Assertions

Assert behavior, not implementation details.

- For scoring and grading, use table-driven tests with explicit inputs and expected grades.
- For parser output, assert stable structured results: test name, file path, line, domain,
  tags, and detected signals.
- For terminal output, assert key lines or patterns. Avoid brittle full-output snapshots.
- For HTML reports, assert important structure and safety:
  - domain names and grades are present
  - unsafe test names and bodies are escaped
  - no external `<script src>` or `<link href>` dependencies
  - unclassified and flagged-test sections render when expected

Avoid large snapshots unless the output is intentionally stable and small.

## CLI Testing

CLI smoke tests should run against the built artifact:

```sh
pnpm build
node dist/cli.js --help
```

Use `execa` in tests for spawned CLI processes. Assert exit codes, stderr/stdout shape,
and generated files. Keep CLI tests few and high-value; most behavior should be covered
below the CLI layer.

## Git And Filesystem Tests

When behavior depends on Git, create a temporary repository inside the test. Use real
`git` commands through `execa` instead of mocking Git output.

Filesystem tests must write only inside temporary directories created by the test runner.
Clean up temporary directories after the test unless Vitest handles the lifecycle.

## Coverage Expectations

Coverage should support reliability, not replace judgment.

Aim for strong coverage on:

- parser behavior
- scoring and grade caps
- config validation
- JUnit/flakiness calculation
- report escaping

Gaps are acceptable for thin CLI wiring if the underlying behavior is tested.

## Required Verification

Before finishing a coding task, run:

```sh
pnpm verify
```

`pnpm verify` currently runs:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

If verification cannot be run, state why and list the highest-signal tests that were run
instead.
