import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTestFile } from "../../src/parser/parseTestFile.js";

const fixturesDir = join(import.meta.dirname, "../fixtures");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

describe("parser signal detection", () => {
  describe("accessible query detection", () => {
    it("detects getByRole and getByText as accessible queries", () => {
      const source = readFixture("checkout-tagged.test.tsx");
      const tests = parseTestFile("checkout-tagged.test.tsx", source);

      const blocksProgression = tests.find(
        (t) => t.name === "blocks progression when cart is empty",
      );
      expect(blocksProgression?.signals.usesAccessibleQueries).toBe(true);
      expect(blocksProgression?.signals.usesTestIdQueries).toBe(false);
    });

    it("detects getByTestId usage", () => {
      const source = readFixture("poor-render-only.test.tsx");
      const tests = parseTestFile("poor-render-only.test.tsx", source);

      const renders = tests.find((t) => t.name === "renders");
      expect(renders?.signals.usesTestIdQueries).toBe(true);
      expect(renders?.signals.usesAccessibleQueries).toBe(false);
    });

    it("detects mixed query usage in the same test", () => {
      const source = readFixture("mixed-queries.test.tsx");
      const tests = parseTestFile("mixed-queries.test.tsx", source);

      const showsCount = tests.find((t) => t.name === "shows result count for matching products");
      expect(showsCount?.signals.usesAccessibleQueries).toBe(true);
      // getByRole("list") is also used, but no getByTestId
      expect(showsCount?.signals.usesTestIdQueries).toBe(false);

      const rendersEmpty = tests.find((t) => t.name === "renders empty state with testid");
      expect(rendersEmpty?.signals.usesTestIdQueries).toBe(true);
    });
  });

  describe("assertion detection", () => {
    it("detects visible output assertions (toBeVisible, toBeDisabled)", () => {
      const source = readFixture("checkout-tagged.test.tsx");
      const tests = parseTestFile("checkout-tagged.test.tsx", source);

      const blocksProgression = tests.find(
        (t) => t.name === "blocks progression when cart is empty",
      );
      expect(blocksProgression?.signals.hasVisibleOutputAssertion).toBe(true);

      const displaysError = tests.find((t) => t.name === "displays error when payment fails");
      expect(displaysError?.signals.hasVisibleOutputAssertion).toBe(true);
    });

    it("flags tests whose only assertion is toBeInTheDocument", () => {
      const source = readFixture("poor-render-only.test.tsx");
      const tests = parseTestFile("poor-render-only.test.tsx", source);

      for (const test of tests) {
        expect(test.signals.onlyToBeInTheDocument).toBe(true);
      }
    });

    it("does not flag toBeInTheDocument when other assertions are present", () => {
      const source = readFixture("mixed-queries.test.tsx");
      const tests = parseTestFile("mixed-queries.test.tsx", source);

      const showsCount = tests.find((t) => t.name === "shows result count for matching products");
      // has both toBeVisible and toBeInTheDocument
      expect(showsCount?.signals.onlyToBeInTheDocument).toBe(false);
    });
  });

  describe("mock count detection", () => {
    it("counts vi.mock and jest.mock calls in the file scope", () => {
      const source = readFixture("heavy-mocks.test.ts");
      const tests = parseTestFile("heavy-mocks.test.ts", source);

      for (const test of tests) {
        expect(test.signals.mockCount).toBe(4);
      }
    });

    it("reports zero mocks when none are present", () => {
      const source = readFixture("checkout-tagged.test.tsx");
      const tests = parseTestFile("checkout-tagged.test.tsx", source);

      for (const test of tests) {
        expect(test.signals.mockCount).toBe(0);
      }
    });
  });

  describe("vague name detection", () => {
    it("flags test names that are only 'renders', 'works', or 'test'", () => {
      const source = readFixture("poor-render-only.test.tsx");
      const tests = parseTestFile("poor-render-only.test.tsx", source);

      expect(tests.find((t) => t.name === "renders")?.signals.hasVagueName).toBe(true);
      expect(tests.find((t) => t.name === "works")?.signals.hasVagueName).toBe(true);
      expect(tests.find((t) => t.name === "test")?.signals.hasVagueName).toBe(true);
    });

    it("does not flag descriptive test names", () => {
      const source = readFixture("checkout-tagged.test.tsx");
      const tests = parseTestFile("checkout-tagged.test.tsx", source);

      for (const test of tests) {
        expect(test.signals.hasVagueName).toBe(false);
      }
    });
  });

  describe("timeout and delay detection", () => {
    it("detects setTimeout usage in test bodies", () => {
      const source = readFixture("flaky-patterns.test.ts");
      const tests = parseTestFile("flaky-patterns.test.ts", source);

      const updatesStock = tests.find((t) => t.name === "updates stock count after sync");
      expect(updatesStock?.signals.hasTimeouts).toBe(true);
    });

    it("reports no timeouts for clean tests", () => {
      const source = readFixture("checkout-tagged.test.tsx");
      const tests = parseTestFile("checkout-tagged.test.tsx", source);

      for (const test of tests) {
        expect(test.signals.hasTimeouts).toBe(false);
      }
    });
  });

  describe("fixture: nested describes", () => {
    it("extracts tests from nested describe blocks with correct domains", () => {
      const source = readFixture("nested-describes.test.ts");
      const tests = parseTestFile("nested-describes.test.ts", source);

      expect(tests).toHaveLength(4); // it.skip is still parsed
      expect(tests.find((t) => t.name === "accepts valid promo codes")?.domain).toBe("pricing");
      expect(tests.find((t) => t.name === "rejects codes with special characters")?.tags).toContain(
        "edge-case",
      );
    });
  });
});
