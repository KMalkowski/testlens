import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execaSync } from "execa";
import type { DomainConfig } from "../../src/config/types.js";
import { getAffectedFiles, mapFilesToDomains } from "../../src/git/diff.js";
import type { ParsedTestCase } from "../../src/parser/types.js";

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "testlens-git-"));

  execaSync("git", ["init"], { cwd: dir });
  execaSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execaSync("git", ["config", "user.name", "Test"], { cwd: dir });

  // Create initial commit on main
  writeFileSync(join(dir, "README.md"), "# test repo");
  execaSync("git", ["add", "."], { cwd: dir });
  execaSync("git", ["commit", "-m", "initial"], { cwd: dir });

  return dir;
}

function addFileAndCommit(dir: string, filePath: string, content: string, message: string): void {
  writeFileSync(join(dir, filePath), content);
  execaSync("git", ["add", filePath], { cwd: dir });
  execaSync("git", ["commit", "-m", message], { cwd: dir });
}

describe("getAffectedFiles", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns files changed on a feature branch relative to base", async () => {
    // Add a test file on main
    addFileAndCommit(
      repoDir,
      "src/cart.test.ts",
      'it("existing test", () => {});',
      "add cart test",
    );

    // Create feature branch and add changes
    execaSync("git", ["checkout", "-b", "feature/checkout"], { cwd: repoDir });
    addFileAndCommit(
      repoDir,
      "src/checkout.test.ts",
      'it("new test", () => {});',
      "add checkout test",
    );
    addFileAndCommit(
      repoDir,
      "src/cart.test.ts",
      'it("updated test", () => {});',
      "update cart test",
    );

    const files = await getAffectedFiles("main", repoDir);

    expect(files).toContain("src/checkout.test.ts");
    expect(files).toContain("src/cart.test.ts");
    expect(files).not.toContain("README.md");
  });

  it("returns an empty list when there is no diff", async () => {
    execaSync("git", ["checkout", "-b", "feature/empty"], { cwd: repoDir });

    const files = await getAffectedFiles("main", repoDir);

    expect(files).toEqual([]);
  });

  it("includes newly added files", async () => {
    execaSync("git", ["checkout", "-b", "feature/new-file"], { cwd: repoDir });
    addFileAndCommit(repoDir, "src/new.test.tsx", 'it("brand new", () => {});', "add new test");

    const files = await getAffectedFiles("main", repoDir);

    expect(files).toContain("src/new.test.tsx");
  });

  it("includes deleted files", async () => {
    addFileAndCommit(repoDir, "src/old.test.ts", 'it("old", () => {});', "add old test");
    execaSync("git", ["checkout", "-b", "feature/delete"], { cwd: repoDir });
    execaSync("git", ["rm", "src/old.test.ts"], { cwd: repoDir });
    execaSync("git", ["commit", "-m", "remove old test"], { cwd: repoDir });

    const files = await getAffectedFiles("main", repoDir);

    expect(files).toContain("src/old.test.ts");
  });
});

describe("mapFilesToDomains", () => {
  const domains: DomainConfig[] = [
    { id: "cart", label: "Shopping Cart", color: "#4f86f7" },
    { id: "checkout", label: "Checkout", color: "#f7a44f" },
    { id: "pricing", label: "Pricing", color: "#6abf69" },
  ];

  function makeTest(name: string, filePath: string, domain?: string): ParsedTestCase {
    return {
      name,
      filePath,
      domain,
      tags: [],
      line: 1,
      signals: {
        usesAccessibleQueries: false,
        usesTestIdQueries: false,
        hasVisibleOutputAssertion: false,
        onlyToBeInTheDocument: false,
        mockCount: 0,
        hasVagueName: false,
        hasTimeouts: false,
      },
    };
  }

  it("maps affected files to their domains via parsed test cases", () => {
    const affectedFiles = ["src/checkout.test.ts", "src/cart.test.ts"];
    const allTests: ParsedTestCase[] = [
      makeTest("adds to cart", "src/cart.test.ts", "cart"),
      makeTest("removes from cart", "src/cart.test.ts", "cart"),
      makeTest("completes checkout", "src/checkout.test.ts", "checkout"),
      makeTest("applies discount", "src/pricing.test.ts", "pricing"),
    ];

    const result = mapFilesToDomains(affectedFiles, allTests, domains);

    expect(result.has("cart")).toBe(true);
    expect(result.has("checkout")).toBe(true);
    expect(result.has("pricing")).toBe(false);
    expect(result.get("cart")).toHaveLength(2);
    expect(result.get("checkout")).toHaveLength(1);
  });

  it("groups untagged tests under an 'unclassified' key", () => {
    const affectedFiles = ["src/misc.test.ts"];
    const allTests: ParsedTestCase[] = [
      makeTest("renders", "src/misc.test.ts", undefined),
      makeTest("works", "src/misc.test.ts", undefined),
    ];

    const result = mapFilesToDomains(affectedFiles, allTests, domains);

    expect(result.has("unclassified")).toBe(true);
    expect(result.get("unclassified")).toHaveLength(2);
  });

  it("returns an empty map when no affected files match any tests", () => {
    const affectedFiles = ["src/utils.ts"];
    const allTests: ParsedTestCase[] = [makeTest("adds to cart", "src/cart.test.ts", "cart")];

    const result = mapFilesToDomains(affectedFiles, allTests, domains);

    expect(result.size).toBe(0);
  });

  it("handles a test file with tests in multiple domains", () => {
    const affectedFiles = ["src/mixed.test.ts"];
    const allTests: ParsedTestCase[] = [
      makeTest("adds to cart", "src/mixed.test.ts", "cart"),
      makeTest("completes checkout", "src/mixed.test.ts", "checkout"),
    ];

    const result = mapFilesToDomains(affectedFiles, allTests, domains);

    expect(result.has("cart")).toBe(true);
    expect(result.has("checkout")).toBe(true);
    expect(result.get("cart")).toHaveLength(1);
    expect(result.get("checkout")).toHaveLength(1);
  });
});
