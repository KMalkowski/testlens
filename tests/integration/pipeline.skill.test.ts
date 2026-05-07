import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execaSync } from "execa";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import type { TestLensConfig } from "../../src/config/types.js";
import { runPipeline } from "../../src/pipeline.js";

// --- helpers ----------------------------------------------------------------

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "testlens-skill-"));

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
});
`;

// --- tests ------------------------------------------------------------------

describe("runPipeline — --skill flag", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempRepo();
    addFileAndCommit(repoDir, "src/checkout.test.tsx", TAGGED_CHECKOUT_TEST, "add checkout test");
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("writes TESTLENS_SKILL.md at the cwd when no file exists", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const skillPath = join(repoDir, "TESTLENS_SKILL.md");

    expect(existsSync(skillPath)).toBe(false);

    await runPipeline(config, { all: true, skill: true }, repoDir);

    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("includes the configured domain ids in the generated file", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    await runPipeline(config, { all: true, skill: true }, repoDir);

    const content = readFileSync(join(repoDir, "TESTLENS_SKILL.md"), "utf-8");
    expect(content).toContain("checkout");
    expect(content).toContain("cart");
    expect(content).toContain("Checkout");
    expect(content).toContain("Shopping Cart");
  });

  it("does not write the file when --skill is not set", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    await runPipeline(config, { all: true }, repoDir);

    expect(existsSync(join(repoDir, "TESTLENS_SKILL.md"))).toBe(false);
  });

  it("skips writing when an existing file's taxonomy matches the current config", async () => {
    const config = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    const skillPath = join(repoDir, "TESTLENS_SKILL.md");

    await runPipeline(config, { all: true, skill: true }, repoDir);
    const firstContent = readFileSync(skillPath, "utf-8");

    // Mutate the file: if regenerated, mtime/content changes; if skipped, our marker survives.
    const sentinel = "<!-- sentinel-do-not-overwrite -->\n";
    writeFileSync(skillPath, `${sentinel}${firstContent}`);

    await runPipeline(config, { all: true, skill: true }, repoDir);

    const secondContent = readFileSync(skillPath, "utf-8");
    expect(secondContent.startsWith(sentinel)).toBe(true);
  });

  it("rewrites the file when the taxonomy has changed", async () => {
    const skillPath = join(repoDir, "TESTLENS_SKILL.md");

    const configA = makeConfig({ testMatch: ["src/**/*.test.tsx"] });
    await runPipeline(configA, { all: true, skill: true }, repoDir);

    const configB = makeConfig({
      testMatch: ["src/**/*.test.tsx"],
      domains: [
        { id: "checkout", label: "Checkout", color: "#f7a44f" },
        { id: "cart", label: "Shopping Cart", color: "#4f86f7" },
        { id: "auth", label: "Authentication", color: "#ef7f7f" },
      ],
    });
    await runPipeline(configB, { all: true, skill: true }, repoDir);

    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("auth");
    expect(content).toContain("Authentication");
  });
});
