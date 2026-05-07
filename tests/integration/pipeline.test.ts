import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execaSync } from "execa";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TestLensConfig } from "../../src/config/types.js";
import { runPipeline } from "../../src/pipeline.js";

// --- helpers ----------------------------------------------------------------

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "testlens-pipeline-"));

  execaSync("git", ["init"], { cwd: dir });
  execaSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execaSync("git", ["config", "user.name", "Test"], { cwd: dir });

  writeFileSync(join(dir, "README.md"), "# test repo");
  execaSync("git", ["add", "."], { cwd: dir });
  execaSync("git", ["commit", "-m", "initial"], { cwd: dir });

  return dir;
}

function addFileAndCommit(dir: string, filePath: string, content: string, message: string): void {
  mkdirSync(join(dir, filePath, ".."), { recursive: true });
  writeFileSync(join(dir, filePath), content);
  execaSync("git", ["add", filePath], { cwd: dir });
  execaSync("git", ["commit", "-m", message], { cwd: dir });
}

function makeConfig(overrides: Partial<TestLensConfig> = {}): TestLensConfig {
  return {
    ...defaultConfig,
    domains: [
      { id: "checkout", label: "Checkout", color: "#f7a44f" },
      { id: "cart", label: "Shopping Cart", color: "#4f86f7" },
    ],
    ...overrides,
  };
}

// -- fixtures (realistic TSX/TS source consumed by the parser) ---------------

const TAGGED_CHECKOUT_TEST = `
import { render, screen } from "@testing-library/react";
import { Checkout } from "../components/Checkout";

// @domain:checkout @critical
describe("Checkout — guest flow", () => {
  // @domain:checkout
  it("blocks progression when cart is empty", async () => {
    render(<Checkout items={[]} />);
    const button = screen.getByRole("button", { name: /proceed/i });
    expect(button).toBeDisabled();
  });

  // @domain:checkout @regression
  it("displays error when payment fails", async () => {
    render(<Checkout items={[{ id: "1", price: 10 }]} />);
    expect(screen.getByText(/payment failed/i)).toBeVisible();
  });
});
`;

const UNTAGGED_CART_TEST = `
import { render, screen } from "@testing-library/react";
import { Cart } from "../components/Cart";

it("renders", () => {
  render(<Cart />);
  expect(screen.getByTestId("cart-wrapper")).toBeInTheDocument();
});

test("works", () => {
  render(<Cart items={[]} />);
  expect(screen.getByTestId("cart-container")).toBeInTheDocument();
});
`;

const TAGGED_CART_TEST = `
import { render, screen } from "@testing-library/react";
import { Cart } from "../components/Cart";

// @domain:cart
describe("Shopping Cart", () => {
  // @domain:cart
  it("displays item count badge", () => {
    render(<Cart items={[{ id: "1", price: 10 }]} />);
    expect(screen.getByRole("status")).toHaveTextContent("1");
  });
});
`;

// --- tests ------------------------------------------------------------------

describe("runPipeline — diff mode (default)", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("grades only tests in files affected by the diff", async () => {
    // main has a cart test
    addFileAndCommit(repoDir, "src/cart.test.tsx", TAGGED_CART_TEST, "add cart test");

    // feature branch changes checkout only
    execaSync("git", ["checkout", "-b", "feature/checkout"], { cwd: repoDir });
    addFileAndCommit(repoDir, "src/checkout.test.tsx", TAGGED_CHECKOUT_TEST, "add checkout test");

    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, {}, repoDir);

    // checkout domain is affected, cart is not
    expect(result.domainResults.some((d) => d.domainId === "checkout")).toBe(true);
    expect(result.domainResults.some((d) => d.domainId === "cart")).toBe(false);
  });

  it("returns graded tests with usefulness scores and grades", async () => {
    execaSync("git", ["checkout", "-b", "feature/scored"], { cwd: repoDir });
    addFileAndCommit(repoDir, "src/checkout.test.tsx", TAGGED_CHECKOUT_TEST, "add checkout test");

    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, {}, repoDir);

    expect(result.gradedTests.length).toBeGreaterThan(0);
    for (const t of result.gradedTests) {
      expect(t.usefulnessScore).toBeGreaterThanOrEqual(0);
      expect(t.usefulnessScore).toBeLessThanOrEqual(10);
      expect(["A", "B", "C", "D", "F"]).toContain(t.grade);
    }
  });

  it("produces terminal output containing affected domain names", async () => {
    execaSync("git", ["checkout", "-b", "feature/output"], { cwd: repoDir });
    addFileAndCommit(repoDir, "src/checkout.test.tsx", TAGGED_CHECKOUT_TEST, "add checkout test");

    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, {}, repoDir);

    expect(result.output).toContain("CHECKOUT");
  });

  it("returns empty results when the diff has no test files", async () => {
    execaSync("git", ["checkout", "-b", "feature/no-tests"], { cwd: repoDir });
    addFileAndCommit(repoDir, "src/utils.ts", "export const x = 1;", "add util");

    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, {}, repoDir);

    expect(result.domainResults).toHaveLength(0);
    expect(result.gradedTests).toHaveLength(0);
  });

  it("caps untagged tests at the configured grade", async () => {
    execaSync("git", ["checkout", "-b", "feature/untagged"], { cwd: repoDir });
    addFileAndCommit(repoDir, "src/cart.test.tsx", UNTAGGED_CART_TEST, "add untagged cart tests");

    const config = makeConfig({
      testMatch: ["src/**/*.test.tsx"],
      grading: { ...defaultConfig.grading, untaggedCap: "C" },
    });
    const result = await runPipeline(config, {}, repoDir);

    const cappedTests = result.gradedTests.filter((t) => t.isCapped);
    expect(cappedTests.length).toBeGreaterThan(0);

    const gradeOrder = { A: 4, B: 3, C: 2, D: 1, F: 0 };
    for (const t of cappedTests) {
      expect(gradeOrder[t.grade]).toBeLessThanOrEqual(gradeOrder.C);
    }
  });
});

describe("runPipeline — domain mode", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempRepo();
    // Add test files on main so they exist outside of any diff
    addFileAndCommit(repoDir, "src/checkout.test.tsx", TAGGED_CHECKOUT_TEST, "add checkout");
    addFileAndCommit(repoDir, "src/cart.test.tsx", TAGGED_CART_TEST, "add cart");
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("grades all tests for the specified domain regardless of diff", async () => {
    // On main, no diff — but domain mode should still return results
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, { domain: "checkout" }, repoDir);

    expect(result.gradedTests.length).toBeGreaterThan(0);
    for (const t of result.gradedTests) {
      expect(t.domain).toBe("checkout");
    }
  });

  it("produces domain view output with test count", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, { domain: "checkout" }, repoDir);

    expect(result.output).toMatch(/checkout/i);
    expect(result.output).toMatch(/\d+\s*test/i);
  });

  it("returns empty results for a domain with no tests", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, { domain: "pricing" }, repoDir);

    expect(result.gradedTests).toHaveLength(0);
  });
});

describe("runPipeline — all mode", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempRepo();
    addFileAndCommit(repoDir, "src/checkout.test.tsx", TAGGED_CHECKOUT_TEST, "add checkout");
    addFileAndCommit(repoDir, "src/cart.test.tsx", TAGGED_CART_TEST, "add cart");
    addFileAndCommit(repoDir, "src/misc.test.tsx", UNTAGGED_CART_TEST, "add misc");
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("grades every test file matching testMatch regardless of diff", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, { all: true }, repoDir);

    // Should include tests from all three files
    expect(result.gradedTests.length).toBeGreaterThanOrEqual(5);

    const domains = new Set(result.gradedTests.map((t) => t.domain ?? "unclassified"));
    expect(domains.has("checkout")).toBe(true);
    expect(domains.has("cart")).toBe(true);
    expect(domains.has("unclassified")).toBe(true);
  });

  it("includes domain results for all domains with tests", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, { all: true }, repoDir);

    const domainIds = result.domainResults.map((d) => d.domainId);
    expect(domainIds).toContain("checkout");
    expect(domainIds).toContain("cart");
  });
});

describe("runPipeline — flakiness defaults", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempRepo();
    execaSync("git", ["checkout", "-b", "feature/flaky"], { cwd: repoDir });
    addFileAndCommit(repoDir, "src/checkout.test.tsx", TAGGED_CHECKOUT_TEST, "add checkout test");
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("uses neutral flakiness score (5) when no CI history exists", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, {}, repoDir);

    for (const t of result.gradedTests) {
      expect(t.flakinessScore).toBe(5);
    }
  });
});

describe("runPipeline — base branch override", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempRepo();
    // Create a develop branch with a test file
    execaSync("git", ["checkout", "-b", "develop"], { cwd: repoDir });
    addFileAndCommit(repoDir, "src/cart.test.tsx", TAGGED_CART_TEST, "add cart on develop");

    // Create feature branch from develop
    execaSync("git", ["checkout", "-b", "feature/from-develop"], { cwd: repoDir });
    addFileAndCommit(
      repoDir,
      "src/checkout.test.tsx",
      TAGGED_CHECKOUT_TEST,
      "add checkout from develop",
    );
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("diffs against the overridden base branch", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const result = await runPipeline(config, { base: "develop" }, repoDir);

    // Only checkout.test.tsx was added after develop — cart should not be in diff
    expect(result.domainResults.some((d) => d.domainId === "checkout")).toBe(true);
    expect(result.domainResults.some((d) => d.domainId === "cart")).toBe(false);
  });
});
