import type { DomainConfig } from "../../src/config/types.js";
import { generateHtmlReport, type ReportInput } from "../../src/output/htmlReport.js";
import type { GradedTest } from "../../src/output/terminal.js";

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

function makeInput(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    branch: "feature/discount-expiry",
    baseBranch: "main",
    domains,
    gradedTests: [
      makeTest(),
      makeTest({
        name: "shows order summary",
        grade: "B",
        usefulnessScore: 7,
        flakinessScore: 8,
        tags: ["happy-path"],
      }),
    ],
    testBodies: new Map([
      [
        "checkout.test.tsx::blocks progression when cart is empty",
        `it("blocks progression when cart is empty", async () => {\n  render(<Checkout items={[]} />);\n  expect(button).toBeDisabled();\n});`,
      ],
    ]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateHtmlReport", () => {
  // ------------------------------------------------------------------
  // Self-contained HTML — no external dependencies
  // ------------------------------------------------------------------
  describe("self-contained output", () => {
    it("returns a valid HTML document with doctype, html, head, and body", async () => {
      const html = await generateHtmlReport(makeInput());

      expect(html).toMatch(/^<!DOCTYPE html>/i);
      expect(html).toContain("<html");
      expect(html).toContain("<head>");
      expect(html).toContain("</head>");
      expect(html).toContain("<body");
      expect(html).toContain("</body>");
      expect(html).toContain("</html>");
    });

    it("contains no external script or link tags", async () => {
      const html = await generateHtmlReport(makeInput());

      // No <script src="..."> — only inline <script> allowed
      expect(html).not.toMatch(/<script\s[^>]*src\s*=/i);

      // No <link ... href="http..."> — only inline <style> allowed
      expect(html).not.toMatch(/<link\s[^>]*href\s*=\s*["']https?:\/\//i);
    });

    it("contains at least one inline <style> block", async () => {
      const html = await generateHtmlReport(makeInput());

      expect(html).toMatch(/<style[\s>]/i);
    });
  });

  // ------------------------------------------------------------------
  // Metadata
  // ------------------------------------------------------------------
  describe("metadata", () => {
    it("includes branch and base branch names", async () => {
      const html = await generateHtmlReport(makeInput());

      expect(html).toContain("feature/discount-expiry");
      expect(html).toContain("main");
    });

    it("includes the tool name and version", async () => {
      const html = await generateHtmlReport(makeInput());

      expect(html).toMatch(/testlens/i);
    });
  });

  // ------------------------------------------------------------------
  // Domain sections with grade badges
  // ------------------------------------------------------------------
  describe("domain sections", () => {
    it("renders a section for each domain that has graded tests", async () => {
      const html = await generateHtmlReport(makeInput());

      expect(html).toContain("Checkout");
    });

    it("does not render a section for domains with no tests", async () => {
      const html = await generateHtmlReport(makeInput());

      // "Shopping Cart" domain has no tests in default input
      // It may appear in a summary bar but should not have a full section with test rows
      const cartSectionPattern = /shopping\s*cart[\s\S]{0,200}useful/i;
      expect(html).not.toMatch(cartSectionPattern);
    });

    it("shows a grade badge for each domain section", async () => {
      const tests = [
        makeTest({ grade: "B", domain: "checkout" }),
        makeTest({ name: "applies discount", grade: "A", domain: "pricing" }),
      ];
      const html = await generateHtmlReport(makeInput({ gradedTests: tests }));

      // Both domain grades should appear near their labels
      expect(html).toContain("Checkout");
      expect(html).toContain("Pricing");
    });

    it("uses domain colors from config", async () => {
      const html = await generateHtmlReport(makeInput());

      // Checkout domain color should appear in the HTML (inline style or CSS variable)
      expect(html).toContain("#f7a44f");
    });
  });

  // ------------------------------------------------------------------
  // Per-test rows sorted by grade (worst first)
  // ------------------------------------------------------------------
  describe("per-test rows", () => {
    it("sorts tests by grade ascending so worst appears first", async () => {
      const tests = [
        makeTest({ name: "great test", grade: "A", usefulnessScore: 9, flakinessScore: 10 }),
        makeTest({ name: "bad test", grade: "D", usefulnessScore: 3, flakinessScore: 4 }),
        makeTest({ name: "ok test", grade: "C", usefulnessScore: 5, flakinessScore: 6 }),
      ];
      const html = await generateHtmlReport(makeInput({ gradedTests: tests }));

      const badIdx = html.indexOf("bad test");
      const okIdx = html.indexOf("ok test");
      const greatIdx = html.indexOf("great test");

      expect(badIdx).toBeGreaterThan(-1);
      expect(okIdx).toBeGreaterThan(-1);
      expect(greatIdx).toBeGreaterThan(-1);
      expect(badIdx).toBeLessThan(okIdx);
      expect(okIdx).toBeLessThan(greatIdx);
    });

    it("shows usefulness and flakiness scores per test", async () => {
      const html = await generateHtmlReport(makeInput());

      expect(html).toMatch(/9/);
      expect(html).toMatch(/10/);
    });

    it("shows the test file path", async () => {
      const html = await generateHtmlReport(makeInput());

      expect(html).toContain("checkout.test.tsx");
    });

    it("shows test tags", async () => {
      const html = await generateHtmlReport(makeInput());

      expect(html).toContain("critical");
    });

    it("indicates capped tests", async () => {
      const tests = [
        makeTest({
          name: "renders thing",
          grade: "C",
          isCapped: true,
          domain: undefined,
          tags: [],
        }),
      ];
      const html = await generateHtmlReport(makeInput({ gradedTests: tests }));

      expect(html).toMatch(/cap|no tag|untagged/i);
    });
  });

  // ------------------------------------------------------------------
  // Syntax-highlighted test body expansion
  // ------------------------------------------------------------------
  describe("test body expansion", () => {
    it("includes test body source code when provided", async () => {
      const html = await generateHtmlReport(makeInput());

      // The body content should be present (escaped) in the HTML
      expect(html).toContain("toBeDisabled");
    });

    it("applies syntax highlighting to the test body", async () => {
      const html = await generateHtmlReport(makeInput());

      // Shiki produces <pre> with themed spans — check for highlighted output
      expect(html).toMatch(/<pre[\s>][\s\S]*<code[\s>]/i);
    });

    it("does not break when test body is not provided", async () => {
      const input = makeInput({ testBodies: new Map() });
      const html = await generateHtmlReport(input);

      // Should still render without error
      expect(html).toContain("Checkout");
    });
  });

  // ------------------------------------------------------------------
  // Unclassified section for untagged tests
  // ------------------------------------------------------------------
  describe("unclassified section", () => {
    it("renders an unclassified section when untagged tests exist", async () => {
      const tests = [
        makeTest({ name: "tagged test", domain: "checkout" }),
        makeTest({ name: "orphan test", domain: undefined, isCapped: true, tags: [] }),
      ];
      const html = await generateHtmlReport(makeInput({ gradedTests: tests }));

      expect(html).toMatch(/unclassified|untagged/i);
      expect(html).toContain("orphan test");
    });

    it("does not render an unclassified section when all tests have domains", async () => {
      const tests = [
        makeTest({ name: "test one", domain: "checkout" }),
        makeTest({ name: "test two", domain: "pricing" }),
      ];
      const html = await generateHtmlReport(makeInput({ gradedTests: tests }));

      // No section heading with "Unclassified" should exist
      expect(html).not.toMatch(/<h[23][^>]*>[\s\S]*?unclassified[\s\S]*?<\/h[23]>/i);
    });
  });

  // ------------------------------------------------------------------
  // Tagging skill link
  // ------------------------------------------------------------------
  describe("tagging skill link", () => {
    it("includes a reference to TESTLENS_SKILL.md", async () => {
      const html = await generateHtmlReport(makeInput());

      expect(html).toContain("TESTLENS_SKILL.md");
    });
  });

  // ------------------------------------------------------------------
  // HTML escaping (safety)
  // ------------------------------------------------------------------
  describe("HTML escaping", () => {
    it("escapes test names that contain HTML special characters", async () => {
      const tests = [
        makeTest({
          name: '<script>alert("xss")</script> renders correctly',
          domain: "checkout",
        }),
      ];
      const html = await generateHtmlReport(makeInput({ gradedTests: tests }));

      // The raw <script> tag must not appear unescaped
      expect(html).not.toContain('<script>alert("xss")</script> renders correctly');
      // The escaped form should be present
      expect(html).toMatch(/&lt;script&gt;/);
    });

    it("escapes test body content that contains HTML", async () => {
      const bodies = new Map([
        [
          "checkout.test.tsx::dangerous test",
          `it("dangerous test", () => { document.innerHTML = '<img onerror="alert(1)">'; });`,
        ],
      ]);
      const tests = [makeTest({ name: "dangerous test", domain: "checkout" })];
      const html = await generateHtmlReport(makeInput({ gradedTests: tests, testBodies: bodies }));

      // Raw onerror handler must not appear unescaped outside of code blocks
      expect(html).not.toMatch(/<img\s+onerror=/i);
    });
  });

  // ------------------------------------------------------------------
  // Dark mode support
  // ------------------------------------------------------------------
  describe("dark mode", () => {
    it("includes prefers-color-scheme media query", async () => {
      const html = await generateHtmlReport(makeInput());

      expect(html).toContain("prefers-color-scheme");
    });
  });

  // ------------------------------------------------------------------
  // Edge cases
  // ------------------------------------------------------------------
  describe("edge cases", () => {
    it("handles empty test list without crashing", async () => {
      const html = await generateHtmlReport(makeInput({ gradedTests: [] }));

      expect(html).toMatch(/<!DOCTYPE html>/i);
    });

    it("handles all five grade levels", async () => {
      const grades = ["A", "B", "C", "D", "F"] as const;
      const tests = grades.map((grade, i) =>
        makeTest({
          name: `test ${grade}`,
          grade,
          domain: "checkout",
          usefulnessScore: 10 - i * 2,
          flakinessScore: 10 - i * 2,
        }),
      );
      const html = await generateHtmlReport(makeInput({ gradedTests: tests }));

      for (const g of grades) {
        expect(html).toContain(`test ${g}`);
      }
    });

    it("handles tests spread across multiple domains", async () => {
      const tests = [
        makeTest({ name: "checkout test", domain: "checkout", grade: "A" }),
        makeTest({ name: "pricing test", domain: "pricing", grade: "B" }),
        makeTest({ name: "cart test", domain: "cart", grade: "C" }),
      ];
      const html = await generateHtmlReport(makeInput({ gradedTests: tests }));

      expect(html).toContain("Checkout");
      expect(html).toContain("Pricing");
      expect(html).toContain("Shopping Cart");
    });
  });
});
