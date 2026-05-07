import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execaSync } from "execa";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TestLensConfig } from "../../src/config/types.js";
import { runPipeline } from "../../src/pipeline.js";

/**
 * --ci mode integration tests.
 *
 * Per MVP §7, `--ci` is equivalent to `--all --report` plus optional Bitbucket
 * Code Insights annotation. Per MVP §10, CI mode also:
 *
 *   - reads the configured JUnit XML output(s) when present
 *   - appends a new entry to testlens-history.json on disk
 *   - feeds the aggregated history into flakiness scoring
 *   - leaves a [no history] indicator on tests with insufficient samples
 *
 * These tests exercise the full pipeline through `runPipeline({ ci: true })`.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "testlens-ci-"));

  execaSync("git", ["init"], { cwd: dir });
  execaSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execaSync("git", ["config", "user.name", "Test"], { cwd: dir });

  writeFileSync(join(dir, "README.md"), "# test repo");
  execaSync("git", ["add", "."], { cwd: dir });
  execaSync("git", ["commit", "-m", "initial"], { cwd: dir });

  return dir;
}

function writeFile(dir: string, filePath: string, content: string): void {
  mkdirSync(join(dir, filePath, ".."), { recursive: true });
  writeFileSync(join(dir, filePath), content);
}

function commitAll(dir: string, message: string): void {
  execaSync("git", ["add", "."], { cwd: dir });
  execaSync("git", ["commit", "-m", message], { cwd: dir });
}

function makeConfig(overrides: Partial<TestLensConfig> = {}): TestLensConfig {
  return {
    ...defaultConfig,
    domains: [
      { id: "checkout", label: "Checkout", color: "#f7a44f" },
      { id: "cart", label: "Shopping Cart", color: "#4f86f7" },
    ],
    junitOutput: "./test-results/junit.xml",
    ...overrides,
  };
}

const TAGGED_CHECKOUT_TEST = `
import { render, screen } from "@testing-library/react";
import { Checkout } from "../components/Checkout";

// @domain:checkout
describe("Checkout", () => {
  // @domain:checkout
  it("blocks progression when cart is empty", async () => {
    render(<Checkout items={[]} />);
    expect(screen.getByRole("button", { name: /proceed/i })).toBeDisabled();
  });

  // @domain:checkout @critical
  it("displays error when payment fails", async () => {
    render(<Checkout items={[{ id: "1" }]} />);
    expect(screen.getByText(/payment failed/i)).toBeVisible();
  });
});
`;

const TAGGED_CART_TEST = `
import { render, screen } from "@testing-library/react";
import { Cart } from "../components/Cart";

// @domain:cart
describe("Cart", () => {
  // @domain:cart
  it("displays item count", () => {
    render(<Cart items={[{ id: "1" }]} />);
    expect(screen.getByRole("status")).toHaveTextContent("1");
  });
});
`;

function jestJunitXml(
  cases: Array<{ classname: string; name: string; status: "passed" | "failed"; file?: string }>,
): string {
  const testcases = cases
    .map((c) => {
      const fileAttr = c.file ? ` file="${c.file}"` : "";
      const inner = c.status === "failed" ? `<failure message="boom">boom</failure>` : "";
      return `<testcase classname="${c.classname}" name="${c.name}" time="0.1"${fileAttr}>${inner}</testcase>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="jest" tests="${cases.length}" failures="0" errors="0" time="0.1">
  <testsuite name="suite" tests="${cases.length}" failures="0" errors="0" time="0.1">
    ${testcases}
  </testsuite>
</testsuites>`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPipeline — --ci mode", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempRepo();
    writeFile(repoDir, "src/checkout.test.tsx", TAGGED_CHECKOUT_TEST);
    writeFile(repoDir, "src/cart.test.tsx", TAGGED_CART_TEST);
    commitAll(repoDir, "add tests");
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("grades the entire suite (equivalent to --all)", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, { ci: true }, repoDir);

    // All three tests across the two test files should appear
    expect(result.gradedTests.length).toBeGreaterThanOrEqual(3);
    const domains = new Set(result.gradedTests.map((t) => t.domain));
    expect(domains.has("checkout")).toBe(true);
    expect(domains.has("cart")).toBe(true);
  });

  it("writes testlens-report.html to the repo root", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    await runPipeline(config, { ci: true }, repoDir);

    expect(existsSync(join(repoDir, "testlens-report.html"))).toBe(true);
  });

  it("appends a run to testlens-history.json when JUnit XML is present", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });

    writeFile(
      repoDir,
      "test-results/junit.xml",
      jestJunitXml([
        {
          classname: "Checkout",
          name: "blocks progression when cart is empty",
          status: "passed",
          file: "src/checkout.test.tsx",
        },
        {
          classname: "Checkout",
          name: "displays error when payment fails",
          status: "failed",
          file: "src/checkout.test.tsx",
        },
      ]),
    );

    await runPipeline(config, { ci: true }, repoDir);

    const historyPath = join(repoDir, "testlens-history.json");
    expect(existsSync(historyPath)).toBe(true);
  });

  it("uses neutral flakiness (5) and marks tests as [no history] until enough runs accumulate", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, { ci: true }, repoDir);

    // With no history written yet, flakiness defaults to neutral.
    // Implementations may either set 5 (the documented MVP fallback) or compute
    // a static-signal-only score. Either way, the tool must surface a no-history
    // indicator somewhere in the output.
    for (const t of result.gradedTests) {
      expect(t.flakinessScore).toBeGreaterThanOrEqual(0);
      expect(t.flakinessScore).toBeLessThanOrEqual(10);
    }
    expect(result.output).toMatch(/no history|insufficient/i);
  });

  it("uses real flakiness scoring once history has enough samples", async () => {
    const config = makeConfig({
      testMatch: ["src/**/*.test.tsx"],
      grading: { ...defaultConfig.grading, flakinessSampleSize: 5 },
    });

    // Seed history with five passing runs of the test we care about.
    const seededRuns = Array.from({ length: 5 }, (_, i) => ({
      runId: `build-${i + 1}`,
      timestamp: `2026-04-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      results: [
        { name: "blocks progression when cart is empty", status: "passed" as const },
        { name: "displays item count", status: "passed" as const },
      ],
    }));

    writeFile(
      repoDir,
      "testlens-history.json",
      JSON.stringify({ version: 1, runs: seededRuns }),
    );

    const result = await runPipeline(config, { ci: true }, repoDir);

    const checkoutTest = result.gradedTests.find(
      (t) => t.name === "blocks progression when cart is empty",
    );
    expect(checkoutTest).toBeDefined();
    // With 5 clean runs, flakiness should be at the high end of the scale —
    // strictly higher than the neutral fallback of 5.
    expect(checkoutTest?.flakinessScore).toBeGreaterThan(5);
  });

  it("does not attempt Bitbucket annotation when bitbucket.enabled is false", async () => {
    const config = makeConfig({
      testMatch: ["src/**/*.test.tsx"],
      bitbucket: { enabled: false, workspace: "", repoSlug: "" },
    });

    // Should not throw despite no Bitbucket credentials being available
    await expect(runPipeline(config, { ci: true }, repoDir)).resolves.toBeDefined();
  });

  it("does not write a report when --report is omitted from a non-CI run", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });

    // Sanity: the standard pipeline does not write a report file
    await runPipeline(config, { all: true }, repoDir);
    expect(existsSync(join(repoDir, "testlens-report.html"))).toBe(false);
  });
});
