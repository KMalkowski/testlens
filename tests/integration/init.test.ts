import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  proposeDomainsFromFilesystem,
  renderConfigFile,
  renderInitPrompt,
  runInit,
  toDomainId,
  toDomainLabel,
} from "../../src/init/runInit.js";

// --- helpers ----------------------------------------------------------------

function makeTempRepo(): string {
  return mkdtempSync(join(tmpdir(), "testlens-init-"));
}

function mkFeatureDirs(repoDir: string, root: string, names: string[]): void {
  for (const name of names) {
    mkdirSync(join(repoDir, root, name), { recursive: true });
  }
}

// ---------------------------------------------------------------------------

describe("toDomainId", () => {
  it("kebab-cases CamelCase", () => {
    expect(toDomainId("CheckoutFlow")).toBe("checkout-flow");
  });

  it("collapses underscores and spaces to single dashes", () => {
    expect(toDomainId("user_account name")).toBe("user-account-name");
  });

  it("strips non [a-z0-9-] characters", () => {
    expect(toDomainId("auth/v2!")).toBe("authv2");
  });

  it("trims leading and trailing dashes", () => {
    expect(toDomainId("--cart--")).toBe("cart");
  });
});

describe("toDomainLabel", () => {
  it("title-cases kebab-case", () => {
    expect(toDomainLabel("user-account")).toBe("User Account");
  });

  it("splits CamelCase into words", () => {
    expect(toDomainLabel("CheckoutFlow")).toBe("Checkout Flow");
  });
});

describe("proposeDomainsFromFilesystem", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("proposes a domain per subdirectory of src/features", () => {
    mkFeatureDirs(repoDir, "src/features", ["checkout", "cart", "pricing"]);

    const { domains } = proposeDomainsFromFilesystem(repoDir);
    const ids = domains.map((d) => d.id);

    expect(ids).toContain("checkout");
    expect(ids).toContain("cart");
    expect(ids).toContain("pricing");
  });

  it("filters out denylisted directory names", () => {
    mkFeatureDirs(repoDir, "src/features", ["checkout", "components", "utils", "hooks"]);

    const { domains } = proposeDomainsFromFilesystem(repoDir);
    const ids = domains.map((d) => d.id);

    expect(ids).toContain("checkout");
    expect(ids).not.toContain("components");
    expect(ids).not.toContain("utils");
    expect(ids).not.toContain("hooks");
  });

  it("skips dotfile and underscore-prefixed directories", () => {
    mkFeatureDirs(repoDir, "src/features", ["cart", ".cache", "_internal"]);

    const { domains } = proposeDomainsFromFilesystem(repoDir);
    const ids = domains.map((d) => d.id);

    expect(ids).toEqual(["cart"]);
  });

  it("prefers explicit feature roots over the bare src/ fallback", () => {
    // src/features/ has clean candidates; src/ has noise that would be filtered anyway.
    mkFeatureDirs(repoDir, "src/features", ["checkout"]);
    mkFeatureDirs(repoDir, "src", ["features", "components", "utils"]);

    const { domains, scannedRoots } = proposeDomainsFromFilesystem(repoDir);

    expect(domains.map((d) => d.id)).toEqual(["checkout"]);
    expect(scannedRoots).toContain("src/features");
  });

  it("assigns each domain a hex colour", () => {
    mkFeatureDirs(repoDir, "src/features", ["checkout", "cart"]);

    const { domains } = proposeDomainsFromFilesystem(repoDir);

    for (const d of domains) {
      expect(d.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("produces ids that satisfy the testlens config schema", () => {
    mkFeatureDirs(repoDir, "src/features", ["CheckoutFlow", "user_account"]);

    const { domains } = proposeDomainsFromFilesystem(repoDir);

    for (const d of domains) {
      expect(d.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("returns an empty proposal when no feature roots exist", () => {
    const { domains, scannedRoots } = proposeDomainsFromFilesystem(repoDir);

    expect(domains).toHaveLength(0);
    expect(scannedRoots).toHaveLength(0);
  });
});

describe("renderConfigFile", () => {
  it("emits valid-looking ESM exporting a domains array", () => {
    const out = renderConfigFile([{ id: "checkout", label: "Checkout", color: "#f7a44f" }]);

    expect(out).toContain("export default {");
    expect(out).toContain("domains:");
    expect(out).toContain('id: "checkout"');
    expect(out).toContain('label: "Checkout"');
    expect(out).toContain('color: "#f7a44f"');
  });

  it("includes a pointer to the LLM prompt for refinement", () => {
    const out = renderConfigFile([]);

    expect(out).toContain("TESTLENS_INIT.md");
  });
});

describe("renderInitPrompt", () => {
  it("includes the directory snapshot when candidates were found", () => {
    const candidates = new Map<string, string[]>([["src/features", ["checkout", "cart"]]]);
    const out = renderInitPrompt(candidates, [
      { id: "checkout", label: "Checkout", color: "#f7a44f" },
      { id: "cart", label: "Cart", color: "#4f86f7" },
    ]);

    expect(out).toContain("src/features/");
    expect(out).toContain("- checkout");
    expect(out).toContain("- cart");
  });

  it("describes the required output format with the id schema", () => {
    const out = renderInitPrompt(new Map(), []);

    expect(out).toContain("[a-z0-9-]+");
    expect(out).toMatch(/```js/);
  });
});

describe("runInit", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("writes both testlens.config.js and TESTLENS_INIT.md at the cwd", () => {
    mkFeatureDirs(repoDir, "src/features", ["checkout", "cart"]);

    const result = runInit(repoDir);

    expect(existsSync(join(repoDir, "testlens.config.js"))).toBe(true);
    expect(existsSync(join(repoDir, "TESTLENS_INIT.md"))).toBe(true);
    expect(result.configWritten).toBe(true);
    expect(result.domains.map((d) => d.id).sort()).toEqual(["cart", "checkout"]);
  });

  it("does not overwrite an existing testlens.config.js", () => {
    mkFeatureDirs(repoDir, "src/features", ["checkout"]);
    const existing = "// hand-written config\nexport default { domains: [] };\n";
    writeFileSync(join(repoDir, "testlens.config.js"), existing);

    const result = runInit(repoDir);

    const after = readFileSync(join(repoDir, "testlens.config.js"), "utf-8");
    expect(after).toBe(existing);
    expect(result.configWritten).toBe(false);
  });

  it("still writes TESTLENS_INIT.md even when the config already exists", () => {
    writeFileSync(join(repoDir, "testlens.config.js"), "export default {};\n");

    runInit(repoDir);

    expect(existsSync(join(repoDir, "TESTLENS_INIT.md"))).toBe(true);
  });

  it("writes a config with an empty domains array when nothing is detected", () => {
    const result = runInit(repoDir);

    expect(result.configWritten).toBe(true);
    expect(result.domains).toHaveLength(0);

    const content = readFileSync(join(repoDir, "testlens.config.js"), "utf-8");
    expect(content).toContain("domains: [");
  });
});
