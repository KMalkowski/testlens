import {
  type DomainResult,
  formatDeltaView,
  formatDomainView,
  type GradedTest,
} from "../src/output/terminal.js";

describe("formatDeltaView", () => {
  it("shows domain grades with change arrows for affected domains", () => {
    const results: DomainResult[] = [
      {
        domainId: "checkout",
        label: "Checkout",
        currentGrade: "C",
        previousGrade: "B",
        testCount: 3,
        degradedCount: 1,
      },
      {
        domainId: "pricing",
        label: "Pricing & Discounts",
        currentGrade: "A",
        previousGrade: "A",
        testCount: 2,
        degradedCount: 0,
      },
    ];

    const output = formatDeltaView(results);

    // Should show domain labels
    expect(output).toContain("CHECKOUT");
    expect(output).toContain("PRICING");

    // Should show grade transition for degraded domain
    expect(output).toMatch(/B\s*→\s*C/);

    // Should indicate degradation
    expect(output).toMatch(/↓|degraded/i);

    // Should show no-change for stable domains
    expect(output).toMatch(/A\s*→?\s*A/);
  });

  it("shows a hint to run --report for full breakdown", () => {
    const results: DomainResult[] = [
      {
        domainId: "cart",
        label: "Shopping Cart",
        currentGrade: "B",
        previousGrade: "B",
        testCount: 5,
        degradedCount: 0,
      },
    ];

    const output = formatDeltaView(results);

    expect(output).toContain("--report");
  });

  it("handles domains with no previous grade (new domain in diff)", () => {
    const results: DomainResult[] = [
      {
        domainId: "auth",
        label: "Authentication",
        currentGrade: "B",
        previousGrade: undefined,
        testCount: 4,
        degradedCount: 0,
      },
    ];

    const output = formatDeltaView(results);

    expect(output).toContain("AUTH");
    expect(output).toContain("B");
  });

  it("returns a message when no domains are affected", () => {
    const output = formatDeltaView([]);

    expect(output).toMatch(/no domains affected|no change/i);
  });
});

describe("formatDomainView", () => {
  it("lists tests sorted by grade ascending (worst first)", () => {
    const tests: GradedTest[] = [
      {
        name: "blocks progression when cart is empty",
        filePath: "checkout.test.tsx",
        grade: "A",
        usefulnessScore: 9,
        flakinessScore: 10,
        domain: "checkout",
        tags: ["critical"],
        isCapped: false,
      },
      {
        name: "renders checkout component",
        filePath: "checkout.test.tsx",
        grade: "D",
        usefulnessScore: 2,
        flakinessScore: 7,
        domain: undefined,
        tags: [],
        isCapped: true,
      },
      {
        name: "shows order summary",
        filePath: "checkout.test.tsx",
        grade: "B",
        usefulnessScore: 7,
        flakinessScore: 8,
        domain: "checkout",
        tags: [],
        isCapped: false,
      },
    ];

    const output = formatDomainView("checkout", tests);
    const lines = output.split("\n");

    // Worst grade (D or F) should appear before best grade (A)
    const dIndex = lines.findIndex((l: string) => l.includes("renders checkout component"));
    const aIndex = lines.findIndex((l: string) => l.includes("blocks progression"));
    expect(dIndex).toBeLessThan(aIndex);
    expect(dIndex).toBeGreaterThanOrEqual(0);
  });

  it("shows usefulness and flakiness scores per test", () => {
    const tests: GradedTest[] = [
      {
        name: "applies discount code",
        filePath: "pricing.test.ts",
        grade: "A",
        usefulnessScore: 8,
        flakinessScore: 10,
        domain: "pricing",
        tags: [],
        isCapped: false,
      },
    ];

    const output = formatDomainView("pricing", tests);

    expect(output).toMatch(/useful.*8/i);
    expect(output).toMatch(/flaky.*10/i);
  });

  it("marks capped tests with a cap indicator", () => {
    const tests: GradedTest[] = [
      {
        name: "renders",
        filePath: "misc.test.ts",
        grade: "C",
        usefulnessScore: 3,
        flakinessScore: 10,
        domain: undefined,
        tags: [],
        isCapped: true,
      },
    ];

    const output = formatDomainView("misc", tests);

    expect(output).toMatch(/cap|no tag/i);
  });

  it("shows an overall domain grade", () => {
    const tests: GradedTest[] = [
      {
        name: "test one",
        filePath: "cart.test.ts",
        grade: "B",
        usefulnessScore: 7,
        flakinessScore: 8,
        domain: "cart",
        tags: [],
        isCapped: false,
      },
      {
        name: "test two",
        filePath: "cart.test.ts",
        grade: "C",
        usefulnessScore: 5,
        flakinessScore: 6,
        domain: "cart",
        tags: [],
        isCapped: false,
      },
    ];

    const output = formatDomainView("cart", tests);

    expect(output).toMatch(/domain grade/i);
  });

  it("shows test count in the header", () => {
    const tests: GradedTest[] = [
      {
        name: "test one",
        filePath: "cart.test.ts",
        grade: "B",
        usefulnessScore: 7,
        flakinessScore: 8,
        domain: "cart",
        tags: [],
        isCapped: false,
      },
    ];

    const output = formatDomainView("cart", tests);

    expect(output).toMatch(/1\s*test/i);
  });
});
