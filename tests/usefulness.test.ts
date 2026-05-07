import { computeUsefulnessScore } from "../src/grading/usefulness.js";
import type { ParsedTestCase } from "../src/parser/types.js";

function makeTestCase(overrides: Partial<ParsedTestCase> = {}): ParsedTestCase {
  return {
    name: "adds item to cart when user clicks add button",
    filePath: "cart.test.tsx",
    domain: "cart",
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
    ...overrides,
  };
}

describe("computeUsefulnessScore", () => {
  describe("positive signals", () => {
    it.each([
      {
        description: "test with @domain tag gets +1",
        overrides: { domain: "checkout" },
        expectedMin: 1,
      },
      {
        description: "test with @regression tag gets +1",
        overrides: { tags: ["regression" as const] },
        expectedMin: 1,
      },
      {
        description: "test using accessible queries gets +1",
        overrides: {
          signals: {
            usesAccessibleQueries: true,
            usesTestIdQueries: false,
            hasVisibleOutputAssertion: false,
            onlyToBeInTheDocument: false,
            mockCount: 0,
            hasVagueName: false,
            hasTimeouts: false,
          },
        },
        expectedMin: 1,
      },
      {
        description: "test with visible output assertion gets +2",
        overrides: {
          signals: {
            usesAccessibleQueries: false,
            usesTestIdQueries: false,
            hasVisibleOutputAssertion: true,
            onlyToBeInTheDocument: false,
            mockCount: 0,
            hasVagueName: false,
            hasTimeouts: false,
          },
        },
        expectedMin: 2,
      },
    ])("$description", ({ overrides, expectedMin }) => {
      const base = computeUsefulnessScore(makeTestCase());
      const withSignal = computeUsefulnessScore(makeTestCase(overrides));
      expect(withSignal).toBeGreaterThanOrEqual(base + expectedMin);
    });
  });

  describe("negative signals", () => {
    it.each([
      {
        description: "vague name ('renders') penalises by 2",
        overrides: {
          name: "renders",
          signals: {
            usesAccessibleQueries: false,
            usesTestIdQueries: false,
            hasVisibleOutputAssertion: false,
            onlyToBeInTheDocument: false,
            mockCount: 0,
            hasVagueName: true,
            hasTimeouts: false,
          },
        },
        expectedPenalty: 2,
      },
      {
        description: "only toBeInTheDocument assertion penalises by 2",
        overrides: {
          signals: {
            usesAccessibleQueries: false,
            usesTestIdQueries: false,
            hasVisibleOutputAssertion: false,
            onlyToBeInTheDocument: true,
            mockCount: 0,
            hasVagueName: false,
            hasTimeouts: false,
          },
        },
        expectedPenalty: 2,
      },
      {
        description: "more than 3 mocks penalises by 1",
        overrides: {
          signals: {
            usesAccessibleQueries: false,
            usesTestIdQueries: false,
            hasVisibleOutputAssertion: false,
            onlyToBeInTheDocument: false,
            mockCount: 4,
            hasVagueName: false,
            hasTimeouts: false,
          },
        },
        expectedPenalty: 1,
      },
      {
        description: "missing @domain tag penalises by 1",
        overrides: { domain: undefined },
        expectedPenalty: 1,
      },
    ])("$description", ({ overrides, expectedPenalty }) => {
      const base = computeUsefulnessScore(makeTestCase());
      const withPenalty = computeUsefulnessScore(makeTestCase(overrides));
      expect(base - withPenalty).toBeGreaterThanOrEqual(expectedPenalty);
    });
  });

  describe("score boundaries", () => {
    it("never returns below 0", () => {
      const worstCase = makeTestCase({
        name: "renders",
        domain: undefined,
        tags: [],
        signals: {
          usesAccessibleQueries: false,
          usesTestIdQueries: true,
          hasVisibleOutputAssertion: false,
          onlyToBeInTheDocument: true,
          mockCount: 5,
          hasVagueName: true,
          hasTimeouts: false,
        },
      });

      expect(computeUsefulnessScore(worstCase)).toBeGreaterThanOrEqual(0);
    });

    it("never returns above 10", () => {
      const bestCase = makeTestCase({
        name: "blocks progression when cart is empty",
        domain: "checkout",
        tags: ["regression"],
        signals: {
          usesAccessibleQueries: true,
          usesTestIdQueries: false,
          hasVisibleOutputAssertion: true,
          onlyToBeInTheDocument: false,
          mockCount: 0,
          hasVagueName: false,
          hasTimeouts: false,
        },
      });

      expect(computeUsefulnessScore(bestCase)).toBeLessThanOrEqual(10);
    });
  });

  describe("realistic scenarios", () => {
    it("scores a well-tagged behavioral test highly", () => {
      const good = makeTestCase({
        name: "blocks progression when cart is empty",
        domain: "checkout",
        tags: ["regression"],
        signals: {
          usesAccessibleQueries: true,
          usesTestIdQueries: false,
          hasVisibleOutputAssertion: true,
          onlyToBeInTheDocument: false,
          mockCount: 0,
          hasVagueName: false,
          hasTimeouts: false,
        },
      });

      expect(computeUsefulnessScore(good)).toBeGreaterThanOrEqual(7);
    });

    it("scores a vague render-only test poorly", () => {
      const bad = makeTestCase({
        name: "renders",
        domain: undefined,
        tags: [],
        signals: {
          usesAccessibleQueries: false,
          usesTestIdQueries: true,
          hasVisibleOutputAssertion: false,
          onlyToBeInTheDocument: true,
          mockCount: 0,
          hasVagueName: true,
          hasTimeouts: false,
        },
      });

      expect(computeUsefulnessScore(bad)).toBeLessThanOrEqual(3);
    });

    it("scores a heavily-mocked test lower than the same test without mocks", () => {
      const withoutMocks = makeTestCase({ domain: "pricing" });
      const withMocks = makeTestCase({
        domain: "pricing",
        signals: {
          usesAccessibleQueries: false,
          usesTestIdQueries: false,
          hasVisibleOutputAssertion: false,
          onlyToBeInTheDocument: false,
          mockCount: 4,
          hasVagueName: false,
          hasTimeouts: false,
        },
      });

      expect(computeUsefulnessScore(withMocks)).toBeLessThan(computeUsefulnessScore(withoutMocks));
    });
  });
});
