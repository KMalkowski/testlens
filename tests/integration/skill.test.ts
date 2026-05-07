import type { DomainConfig } from "../../src/config/types.js";
import type { GradedTest } from "../../src/output/terminal.js";
import {
  generateSkill,
  type SkillInput,
  shouldRegenerateSkill,
} from "../../src/skill/generateSkill.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const domains: DomainConfig[] = [
  { id: "checkout", label: "Checkout", color: "#f7a44f" },
  { id: "pricing", label: "Pricing & Discounts", color: "#6abf69" },
  { id: "cart", label: "Shopping Cart", color: "#4f86f7" },
];

function makeTest(overrides: Partial<GradedTest> = {}): GradedTest {
  return {
    name: "blocks progression when cart is empty",
    filePath: "checkout.test.tsx",
    grade: "A",
    usefulnessScore: 9,
    flakinessScore: 10,
    domain: "checkout",
    tags: ["critical"],
    isCapped: false,
    ...overrides,
  };
}

function bodyKey(filePath: string, name: string): string {
  return `${filePath}::${name}`;
}

function makeInput(overrides: Partial<SkillInput> = {}): SkillInput {
  const t1 = makeTest();
  const t2 = makeTest({
    name: "applies discount code before tax",
    filePath: "pricing.test.tsx",
    grade: "A",
    usefulnessScore: 9,
    domain: "pricing",
    tags: ["happy-path"],
  });
  return {
    domains,
    gradedTests: [t1, t2],
    testBodies: new Map([
      [
        bodyKey(t1.filePath, t1.name),
        `// @domain:checkout @critical\nit("blocks progression when cart is empty", async () => {\n  render(<Checkout items={[]} />);\n  expect(screen.getByRole("button", { name: /pay/i })).toBeDisabled();\n});`,
      ],
      [
        bodyKey(t2.filePath, t2.name),
        `// @domain:pricing @happy-path\nit("applies discount code before tax", () => {\n  const total = applyDiscount({ subtotal: 100, code: "SAVE10" });\n  expect(total).toBe(90);\n});`,
      ],
    ]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateSkill
// ---------------------------------------------------------------------------

describe("generateSkill", () => {
  // ------------------------------------------------------------------
  // Markdown shape
  // ------------------------------------------------------------------
  describe("document shape", () => {
    it("produces a non-empty markdown string", () => {
      const md = generateSkill(makeInput());

      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(0);
    });

    it("starts with a top-level markdown heading", () => {
      const md = generateSkill(makeInput());

      expect(md).toMatch(/^#\s+\S+/m);
    });

    it("references TestLens by name", () => {
      const md = generateSkill(makeInput());

      expect(md).toMatch(/testlens/i);
    });
  });

  // ------------------------------------------------------------------
  // Context block — what testlens is, what tags mean
  // ------------------------------------------------------------------
  describe("context block", () => {
    it("explains the @domain tag convention", () => {
      const md = generateSkill(makeInput());

      expect(md).toMatch(/@domain:/);
    });

    it("lists the supported tags from the MVP", () => {
      const md = generateSkill(makeInput());

      // All MVP-defined tags must appear so the LLM knows the vocabulary
      expect(md).toMatch(/@critical/);
      expect(md).toMatch(/@edge-case/);
      expect(md).toMatch(/@regression/);
      expect(md).toMatch(/@happy-path/);
    });
  });

  // ------------------------------------------------------------------
  // Taxonomy block — auto-generated from config domains
  // ------------------------------------------------------------------
  describe("taxonomy block", () => {
    it("lists every configured domain id", () => {
      const md = generateSkill(makeInput());

      for (const d of domains) {
        expect(md).toContain(d.id);
      }
    });

    it("lists every configured domain label", () => {
      const md = generateSkill(makeInput());

      for (const d of domains) {
        expect(md).toContain(d.label);
      }
    });

    it("renders domains in the order they appear in config", () => {
      const md = generateSkill(makeInput());

      const checkoutIdx = md.indexOf("checkout");
      const pricingIdx = md.indexOf("pricing");
      const cartIdx = md.indexOf("cart");

      expect(checkoutIdx).toBeGreaterThan(-1);
      expect(pricingIdx).toBeGreaterThan(-1);
      expect(cartIdx).toBeGreaterThan(-1);
      expect(checkoutIdx).toBeLessThan(pricingIdx);
      expect(pricingIdx).toBeLessThan(cartIdx);
    });

    it("omits the color field — the LLM does not need it", () => {
      const md = generateSkill(makeInput());

      // Hex codes from the taxonomy must not leak into the prompt
      expect(md).not.toContain("#f7a44f");
      expect(md).not.toContain("#6abf69");
      expect(md).not.toContain("#4f86f7");
    });

    it("handles an empty taxonomy without crashing", () => {
      const md = generateSkill(makeInput({ domains: [], gradedTests: [], testBodies: new Map() }));

      expect(md.length).toBeGreaterThan(0);
      expect(md).toMatch(/testlens/i);
    });
  });

  // ------------------------------------------------------------------
  // Convention examples — pulled from highest-graded tagged tests
  // ------------------------------------------------------------------
  describe("convention examples", () => {
    it("includes test bodies from top-graded tagged tests as examples", () => {
      const md = generateSkill(makeInput());

      // The actual code from the seeded bodies should be present
      expect(md).toContain("blocks progression when cart is empty");
      expect(md).toContain("toBeDisabled");
    });

    it("includes between 1 and 3 examples", () => {
      // Many graded tests, all with bodies — generator should still cap at 3
      const tests: GradedTest[] = Array.from({ length: 10 }, (_, i) =>
        makeTest({
          name: `useful test ${i}`,
          filePath: `t${i}.test.tsx`,
          grade: "A",
          usefulnessScore: 10,
          domain: "checkout",
        }),
      );
      const bodies = new Map(
        tests.map((t) => [
          bodyKey(t.filePath, t.name),
          `// @domain:checkout\nit("${t.name}", () => { expect(true).toBe(true); });`,
        ]),
      );

      const md = generateSkill(makeInput({ gradedTests: tests, testBodies: bodies }));

      const includedNames = tests.filter((t) => md.includes(t.name));
      expect(includedNames.length).toBeGreaterThanOrEqual(1);
      expect(includedNames.length).toBeLessThanOrEqual(3);
    });

    it("prefers higher-graded tests over lower-graded ones", () => {
      const aTest = makeTest({
        name: "a-grade example",
        filePath: "a.test.tsx",
        grade: "A",
        usefulnessScore: 10,
        domain: "checkout",
      });
      const dTest = makeTest({
        name: "d-grade example",
        filePath: "d.test.tsx",
        grade: "D",
        usefulnessScore: 3,
        domain: "checkout",
      });
      const bodies = new Map([
        [bodyKey(aTest.filePath, aTest.name), `// @domain:checkout\nit("a-grade example", () => {});`],
        [bodyKey(dTest.filePath, dTest.name), `// @domain:checkout\nit("d-grade example", () => {});`],
      ]);

      const md = generateSkill(
        makeInput({ gradedTests: [dTest, aTest], testBodies: bodies }),
      );

      expect(md).toContain("a-grade example");
      // The D-grade test is a poor example and should not be shown when an A exists
      expect(md).not.toContain("d-grade example");
    });

    it("excludes untagged tests from examples", () => {
      const tagged = makeTest({
        name: "tagged exemplar",
        filePath: "tagged.test.tsx",
        domain: "checkout",
        grade: "A",
        usefulnessScore: 9,
      });
      const untagged = makeTest({
        name: "untagged candidate",
        filePath: "untagged.test.tsx",
        domain: undefined,
        isCapped: true,
        tags: [],
        grade: "A",
        usefulnessScore: 10,
      });
      const bodies = new Map([
        [bodyKey(tagged.filePath, tagged.name), `// @domain:checkout\nit("tagged exemplar", () => {});`],
        [bodyKey(untagged.filePath, untagged.name), `it("untagged candidate", () => {});`],
      ]);

      const md = generateSkill(makeInput({ gradedTests: [untagged, tagged], testBodies: bodies }));

      expect(md).toContain("tagged exemplar");
      expect(md).not.toContain("untagged candidate");
    });

    it("excludes tests whose body is unavailable", () => {
      const withBody = makeTest({
        name: "has a body",
        filePath: "with.test.tsx",
        domain: "checkout",
        grade: "A",
        usefulnessScore: 9,
      });
      const withoutBody = makeTest({
        name: "no body available",
        filePath: "without.test.tsx",
        domain: "pricing",
        grade: "A",
        usefulnessScore: 10,
      });
      const bodies = new Map([
        [bodyKey(withBody.filePath, withBody.name), `// @domain:checkout\nit("has a body", () => {});`],
      ]);

      const md = generateSkill(
        makeInput({ gradedTests: [withoutBody, withBody], testBodies: bodies }),
      );

      expect(md).toContain("has a body");
      expect(md).not.toContain("no body available");
    });

    it("renders examples inside fenced code blocks", () => {
      const md = generateSkill(makeInput());

      // Each example body must live in a fenced code block (```...```)
      // so the LLM can clearly distinguish examples from prose.
      expect(md).toMatch(/```/);
    });

    it("handles having no eligible examples without crashing", () => {
      // No tagged tests with bodies at all
      const onlyUntagged = makeTest({
        name: "no domain test",
        domain: undefined,
        isCapped: true,
        tags: [],
      });
      const md = generateSkill(
        makeInput({ gradedTests: [onlyUntagged], testBodies: new Map() }),
      );

      expect(md.length).toBeGreaterThan(0);
      expect(md).toMatch(/testlens/i);
    });
  });

  // ------------------------------------------------------------------
  // Instruction block + output format
  // ------------------------------------------------------------------
  describe("instruction block", () => {
    it("instructs the LLM to add tags as comments", () => {
      const md = generateSkill(makeInput());

      // Must mention comments (the tagging mechanism per MVP §5)
      expect(md).toMatch(/comment/i);
    });

    it("describes how the LLM should express uncertainty", () => {
      const md = generateSkill(makeInput());

      expect(md).toMatch(/uncertain|confidence|unsure|ambig/i);
    });
  });
});

// ---------------------------------------------------------------------------
// shouldRegenerateSkill
// ---------------------------------------------------------------------------

describe("shouldRegenerateSkill", () => {
  it("returns true when there is no existing skill content", () => {
    expect(shouldRegenerateSkill(undefined, domains)).toBe(true);
  });

  it("returns true when existing content is empty", () => {
    expect(shouldRegenerateSkill("", domains)).toBe(true);
  });

  it("returns false when every configured domain id and label appears in the existing content", () => {
    const existing = generateSkill(makeInput());

    expect(shouldRegenerateSkill(existing, domains)).toBe(false);
  });

  it("returns true when a new domain has been added to the taxonomy", () => {
    const existing = generateSkill(makeInput());
    const updatedDomains: DomainConfig[] = [
      ...domains,
      { id: "auth", label: "Authentication", color: "#ef7f7f" },
    ];

    expect(shouldRegenerateSkill(existing, updatedDomains)).toBe(true);
  });

  it("returns true when a domain label has changed", () => {
    const existing = generateSkill(makeInput());
    const updatedDomains: DomainConfig[] = [
      { id: "checkout", label: "Checkout v2", color: "#f7a44f" },
      { id: "pricing", label: "Pricing & Discounts", color: "#6abf69" },
      { id: "cart", label: "Shopping Cart", color: "#4f86f7" },
    ];

    expect(shouldRegenerateSkill(existing, updatedDomains)).toBe(true);
  });

  it("returns true when a domain id has been renamed", () => {
    const existing = generateSkill(makeInput());
    const updatedDomains: DomainConfig[] = [
      { id: "checkout-v2", label: "Checkout", color: "#f7a44f" },
      { id: "pricing", label: "Pricing & Discounts", color: "#6abf69" },
      { id: "cart", label: "Shopping Cart", color: "#4f86f7" },
    ];

    expect(shouldRegenerateSkill(existing, updatedDomains)).toBe(true);
  });

  it("returns true when a domain has been removed from the taxonomy", () => {
    const existing = generateSkill(makeInput());
    const updatedDomains: DomainConfig[] = [
      { id: "checkout", label: "Checkout", color: "#f7a44f" },
      { id: "pricing", label: "Pricing & Discounts", color: "#6abf69" },
      // cart removed
    ];

    // Removed domains leave dangling references in the prompt — must regenerate
    expect(shouldRegenerateSkill(existing, updatedDomains)).toBe(true);
  });
});
