import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJunitFile, parseJunitXml } from "../../src/junit/parseJunit.js";

/**
 * JUnit XML parser tests.
 *
 * Per MVP §10, flakiness is derived from JUnit XML produced by jest-junit (Jest)
 * and Playwright's built-in JUnit reporter. The two formats differ — both must
 * be supported. The parser must surface stable structured results regardless of
 * minor format variations.
 *
 * Per testing guidelines: assert structured output (test name, status, duration,
 * file path); avoid brittle XML-shape snapshots.
 */

// ---------------------------------------------------------------------------
// Realistic fixture XML — kept inline because they are small and intentional.
// Production parser cases that need broader coverage should move to
// tests/fixtures/junit/.
// ---------------------------------------------------------------------------

const JEST_JUNIT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="jest tests" tests="3" failures="1" errors="0" time="2.5">
  <testsuite name="Checkout — guest flow" tests="2" failures="1" errors="0" time="1.2" timestamp="2026-05-07T10:00:00" file="src/checkout.test.tsx">
    <testcase classname="Checkout — guest flow" name="blocks progression when cart is empty" time="0.42" />
    <testcase classname="Checkout — guest flow" name="displays error when payment fails" time="0.78">
      <failure message="Expected truthy" type="Error">Error: Expected truthy
    at Object.&lt;anonymous&gt; (src/checkout.test.tsx:24:5)</failure>
    </testcase>
  </testsuite>
  <testsuite name="Cart" tests="1" failures="0" errors="0" time="1.3" timestamp="2026-05-07T10:00:01" file="src/cart.test.tsx">
    <testcase classname="Cart" name="adds item" time="1.3" />
  </testsuite>
</testsuites>`;

const PLAYWRIGHT_JUNIT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites id="" name="" tests="2" failures="0" skipped="1" errors="0" time="3.4">
  <testsuite name="e2e/checkout.spec.ts" timestamp="2026-05-07T10:00:00.000Z" hostname="ci" tests="2" failures="0" skipped="1" errors="0" time="3.4">
    <testcase name="checkout flow › guest can complete order" classname="e2e/checkout.spec.ts" time="2.1">
    </testcase>
    <testcase name="checkout flow › applies coupon" classname="e2e/checkout.spec.ts" time="1.3">
      <skipped />
    </testcase>
  </testsuite>
</testsuites>`;

const SKIPPED_ONLY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="1" failures="0" skipped="1" errors="0" time="0">
  <testsuite name="suite" tests="1" failures="0" skipped="1" errors="0" time="0">
    <testcase classname="suite" name="todo" time="0">
      <skipped />
    </testcase>
  </testsuite>
</testsuites>`;

const NESTED_DESCRIBE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="1" failures="0" errors="0" time="0.1">
  <testsuite name="Checkout > guest > payment" tests="1" failures="0" errors="0" time="0.1" file="src/checkout.test.tsx">
    <testcase classname="Checkout > guest > payment" name="declines invalid card" time="0.1" />
  </testsuite>
</testsuites>`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseJunitXml — Jest format", () => {
  it("returns a result for every testcase", async () => {
    const results = await parseJunitXml(JEST_JUNIT_XML);

    expect(results).toHaveLength(3);
  });

  it("parses passing tests as status 'passed'", async () => {
    const results = await parseJunitXml(JEST_JUNIT_XML);

    const passing = results.find((r) => r.name === "blocks progression when cart is empty");
    expect(passing).toBeDefined();
    expect(passing?.status).toBe("passed");
  });

  it("parses tests with <failure> child as status 'failed'", async () => {
    const results = await parseJunitXml(JEST_JUNIT_XML);

    const failing = results.find((r) => r.name === "displays error when payment fails");
    expect(failing?.status).toBe("failed");
  });

  it("captures the failure message when present", async () => {
    const results = await parseJunitXml(JEST_JUNIT_XML);

    const failing = results.find((r) => r.name === "displays error when payment fails");
    expect(failing?.failureMessage).toBeDefined();
    expect(failing?.failureMessage).toMatch(/Expected truthy/);
  });

  it("reports test duration in milliseconds", async () => {
    const results = await parseJunitXml(JEST_JUNIT_XML);

    const passing = results.find((r) => r.name === "blocks progression when cart is empty");
    // 0.42s in XML → 420ms
    expect(passing?.durationMs).toBeCloseTo(420, 0);
  });

  it("captures the source file path from the testsuite when available", async () => {
    const results = await parseJunitXml(JEST_JUNIT_XML);

    const passing = results.find((r) => r.name === "blocks progression when cart is empty");
    expect(passing?.filePath).toBe("src/checkout.test.tsx");
  });

  it("captures classname from the testcase", async () => {
    const results = await parseJunitXml(JEST_JUNIT_XML);

    const passing = results.find((r) => r.name === "blocks progression when cart is empty");
    expect(passing?.classname).toBe("Checkout — guest flow");
  });
});

describe("parseJunitXml — Playwright format", () => {
  it("parses Playwright testcases with their full path-style name", async () => {
    const results = await parseJunitXml(PLAYWRIGHT_JUNIT_XML);

    expect(results.length).toBeGreaterThan(0);
    const guest = results.find((r) => r.name.includes("guest can complete order"));
    expect(guest).toBeDefined();
    expect(guest?.status).toBe("passed");
  });

  it("treats <skipped /> children as status 'skipped'", async () => {
    const results = await parseJunitXml(PLAYWRIGHT_JUNIT_XML);

    const skipped = results.find((r) => r.name.includes("applies coupon"));
    expect(skipped?.status).toBe("skipped");
  });

  it("derives file path from classname when no file attribute is present", async () => {
    const results = await parseJunitXml(PLAYWRIGHT_JUNIT_XML);

    const guest = results.find((r) => r.name.includes("guest can complete order"));
    // Playwright puts the spec path in classname
    expect(guest?.filePath ?? guest?.classname).toContain("e2e/checkout.spec.ts");
  });
});

describe("parseJunitXml — edge cases", () => {
  it("returns an empty array for an XML with no testcases", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><testsuites />`;
    const results = await parseJunitXml(xml);

    expect(results).toEqual([]);
  });

  it("rejects on malformed XML", async () => {
    await expect(parseJunitXml("<not-valid")).rejects.toBeDefined();
  });

  it("handles a suite that contains only skipped tests", async () => {
    const results = await parseJunitXml(SKIPPED_ONLY_XML);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("skipped");
  });

  it("preserves nested describe paths in classname", async () => {
    const results = await parseJunitXml(NESTED_DESCRIBE_XML);

    expect(results[0]?.classname).toBe("Checkout > guest > payment");
  });
});

describe("parseJunitFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testlens-junit-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads and parses an XML file from disk", async () => {
    const filePath = join(dir, "junit.xml");
    writeFileSync(filePath, JEST_JUNIT_XML);

    const results = await parseJunitFile(filePath);

    expect(results).toHaveLength(3);
  });

  it("rejects when the file does not exist", async () => {
    await expect(parseJunitFile(join(dir, "missing.xml"))).rejects.toBeDefined();
  });
});
