import { parseTestFile } from "../src/parser/parseTestFile.js";

describe("parseTestFile", () => {
  it("extracts test names and TestLens tags from nearby comments", () => {
    const source = `
      // @domain:checkout @critical
      it("blocks progression when cart is empty", () => {});

      test.skip("renders checkout component", () => {});
    `;

    expect(parseTestFile("checkout.test.tsx", source)).toEqual([
      {
        name: "blocks progression when cart is empty",
        filePath: "checkout.test.tsx",
        domain: "checkout",
        tags: ["critical"],
        line: 3,
      },
      {
        name: "renders checkout component",
        filePath: "checkout.test.tsx",
        domain: undefined,
        tags: [],
        line: 5,
      },
    ]);
  });
});
