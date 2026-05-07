import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa, execaSync } from "execa";

/**
 * CLI smoke tests run against the built artifact (dist/cli.js).
 * Per testing guidelines: keep these few and high-value — most behavior
 * is covered by the pipeline integration tests.
 */

const CLI_PATH = resolve(__dirname, "../../dist/cli.js");

// --- helpers ----------------------------------------------------------------

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "testlens-cli-"));

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

const CHECKOUT_TEST = `
import { render, screen } from "@testing-library/react";

// @domain:checkout
describe("Checkout", () => {
  // @domain:checkout
  it("blocks progression when cart is empty", async () => {
    render(<div />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
`;

const CONFIG_FILE = `
module.exports = {
  baseBranch: "main",
  testMatch: ["src/**/*.test.tsx"],
  domains: [
    { id: "checkout", label: "Checkout", color: "#f7a44f" },
    { id: "cart", label: "Shopping Cart", color: "#4f86f7" },
  ],
};
`;

// --- tests ------------------------------------------------------------------

describe("CLI smoke tests", () => {
  it("--help exits with code 0 and shows usage", async () => {
    const result = await execa("node", [CLI_PATH, "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("testlens");
    expect(result.stdout).toMatch(/--report/);
    expect(result.stdout).toMatch(/--domain/);
    expect(result.stdout).toMatch(/--all/);
    expect(result.stdout).toMatch(/--base/);
  });

  it("--version prints the version number", async () => {
    const result = await execa("node", [CLI_PATH, "--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  describe("in a repo with test files", () => {
    let repoDir: string;

    beforeEach(() => {
      repoDir = createTempRepo();
      writeFileSync(join(repoDir, "testlens.config.js"), CONFIG_FILE);
      execaSync("git", ["add", "."], { cwd: repoDir });
      execaSync("git", ["commit", "-m", "add config"], { cwd: repoDir });
    });

    afterEach(() => {
      rmSync(repoDir, { recursive: true, force: true });
    });

    it("exits 0 and prints output for a diff with test files", async () => {
      execaSync("git", ["checkout", "-b", "feature/smoke"], { cwd: repoDir });
      addFileAndCommit(repoDir, "src/checkout.test.tsx", CHECKOUT_TEST, "add checkout test");

      const result = await execa("node", [CLI_PATH], { cwd: repoDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("testlens");
      expect(result.stdout).toMatch(/checkout/i);
    });

    it("exits 0 when there are no changes in the diff", async () => {
      execaSync("git", ["checkout", "-b", "feature/empty-smoke"], { cwd: repoDir });

      const result = await execa("node", [CLI_PATH], { cwd: repoDir });

      expect(result.exitCode).toBe(0);
    });

    it("--domain flag produces domain-specific output", async () => {
      addFileAndCommit(repoDir, "src/checkout.test.tsx", CHECKOUT_TEST, "add checkout test");

      const result = await execa("node", [CLI_PATH, "--domain", "checkout"], {
        cwd: repoDir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/checkout/i);
      expect(result.stdout).toMatch(/\d+\s*test/i);
    });

    it("--base flag overrides the base branch for diff", async () => {
      execaSync("git", ["checkout", "-b", "develop"], { cwd: repoDir });
      execaSync("git", ["checkout", "-b", "feature/base-flag"], { cwd: repoDir });
      addFileAndCommit(repoDir, "src/checkout.test.tsx", CHECKOUT_TEST, "add checkout test");

      const result = await execa("node", [CLI_PATH, "--base", "develop"], {
        cwd: repoDir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("testlens");
    });
  });
});
