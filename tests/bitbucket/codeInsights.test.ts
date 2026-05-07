import {
  buildAnnotations,
  buildReport,
  postCodeInsights,
} from "../../src/bitbucket/codeInsights.js";
import type { DomainResult, GradedTest } from "../../src/output/terminal.js";

/**
 * Bitbucket Code Insights tests.
 *
 * Per MVP §7 and §10, the tool may post a single Code Insights report
 * summarizing per-domain grades and an annotation per low-graded or flaky
 * test. The HTTP integration is config-gated (`bitbucket.enabled`).
 *
 * The Bitbucket Code Insights schema requires:
 *   - report: { title, details, reporter, result, link?, data: [...] }
 *   - annotations: array of { external_id, annotation_type, summary, severity,
 *     path, line, link? }
 *
 * Reference: https://developer.atlassian.com/cloud/bitbucket/rest/api-group-reports/
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTest(overrides: Partial<GradedTest> = {}): GradedTest {
  return {
    name: "blocks progression when cart is empty",
    filePath: "src/checkout.test.tsx",
    grade: "A",
    usefulnessScore: 9,
    flakinessScore: 10,
    domain: "checkout",
    tags: [],
    isCapped: false,
    ...overrides,
  };
}

function makeDomainResult(overrides: Partial<DomainResult> = {}): DomainResult {
  return {
    domainId: "checkout",
    label: "Checkout",
    currentGrade: "B",
    testCount: 4,
    degradedCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildReport
// ---------------------------------------------------------------------------

describe("buildReport", () => {
  it("produces a Code Insights-shaped report with all required fields", () => {
    const report = buildReport({
      domainResults: [makeDomainResult()],
      gradedTests: [makeTest()],
      branch: "feature/discount-expiry",
      reportLink: "https://example.com/report.html",
    });

    expect(report.title).toMatch(/testlens/i);
    expect(report.reporter).toMatch(/testlens/i);
    expect(report.result).toMatch(/^(PASSED|FAILED)$/);
    expect(typeof report.details).toBe("string");
    expect(report.link).toBe("https://example.com/report.html");
    expect(Array.isArray(report.data)).toBe(true);
  });

  it("marks the report as PASSED when no domain has a degraded grade", () => {
    const report = buildReport({
      domainResults: [
        makeDomainResult({ domainId: "checkout", currentGrade: "A", degradedCount: 0 }),
        makeDomainResult({ domainId: "cart", currentGrade: "B", degradedCount: 0 }),
      ],
      gradedTests: [makeTest({ grade: "A" }), makeTest({ name: "cart test", grade: "B" })],
      branch: "feature/x",
    });

    expect(report.result).toBe("PASSED");
  });

  it("marks the report as FAILED when at least one domain degraded", () => {
    const report = buildReport({
      domainResults: [makeDomainResult({ degradedCount: 2 })],
      gradedTests: [makeTest({ grade: "D" })],
      branch: "feature/x",
    });

    expect(report.result).toBe("FAILED");
  });

  it("includes per-domain grade entries in data", () => {
    const report = buildReport({
      domainResults: [
        makeDomainResult({ domainId: "checkout", label: "Checkout", currentGrade: "C" }),
        makeDomainResult({ domainId: "cart", label: "Shopping Cart", currentGrade: "A" }),
      ],
      gradedTests: [],
      branch: "feature/x",
    });

    const titles = report.data.map((d) => d.title);
    expect(titles.some((t) => /checkout/i.test(t))).toBe(true);
    expect(titles.some((t) => /shopping cart|cart/i.test(t))).toBe(true);
  });

  it("uses only allowed Code Insights data types", () => {
    const report = buildReport({
      domainResults: [makeDomainResult()],
      gradedTests: [makeTest()],
      branch: "feature/x",
    });

    const allowed = new Set([
      "BOOLEAN",
      "DATE",
      "DURATION",
      "LINK",
      "NUMBER",
      "PERCENTAGE",
      "TEXT",
    ]);
    for (const d of report.data) {
      expect(allowed.has(d.type)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// buildAnnotations
// ---------------------------------------------------------------------------

describe("buildAnnotations", () => {
  it("emits one annotation per low-graded (D or F) test", () => {
    const tests: GradedTest[] = [
      makeTest({ name: "ok", grade: "B" }),
      makeTest({ name: "rewrite candidate", grade: "D", filePath: "src/x.test.tsx" }),
      makeTest({ name: "coverage padding", grade: "F", filePath: "src/y.test.tsx" }),
    ];

    const annotations = buildAnnotations(tests);

    expect(annotations).toHaveLength(2);
    expect(annotations.map((a) => a.summary).join(" ")).toMatch(/rewrite candidate/);
    expect(annotations.map((a) => a.summary).join(" ")).toMatch(/coverage padding/);
  });

  it("does not emit annotations for A/B/C-graded tests", () => {
    const tests: GradedTest[] = [
      makeTest({ name: "great", grade: "A" }),
      makeTest({ name: "good", grade: "B" }),
      makeTest({ name: "passable", grade: "C" }),
    ];

    expect(buildAnnotations(tests)).toEqual([]);
  });

  it("sets severity LOW for D and HIGH for F tests", () => {
    const tests: GradedTest[] = [
      makeTest({ name: "d test", grade: "D" }),
      makeTest({ name: "f test", grade: "F" }),
    ];

    const annotations = buildAnnotations(tests);
    const dAnnotation = annotations.find((a) => a.summary.includes("d test"));
    const fAnnotation = annotations.find((a) => a.summary.includes("f test"));

    expect(dAnnotation?.severity).toBe("LOW");
    expect(fAnnotation?.severity).toBe("HIGH");
  });

  it("uses unique external_ids per annotation", () => {
    const tests: GradedTest[] = [
      makeTest({ name: "one", grade: "F", filePath: "src/a.test.tsx" }),
      makeTest({ name: "two", grade: "F", filePath: "src/b.test.tsx" }),
      makeTest({ name: "three", grade: "F", filePath: "src/c.test.tsx" }),
    ];

    const ids = buildAnnotations(tests).map((a) => a.external_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses annotation_type CODE_SMELL", () => {
    const tests: GradedTest[] = [makeTest({ name: "low", grade: "F" })];
    const annotations = buildAnnotations(tests);

    expect(annotations[0]?.annotation_type).toBe("CODE_SMELL");
  });

  it("references the test file path for each annotation", () => {
    const tests: GradedTest[] = [
      makeTest({ name: "low", grade: "F", filePath: "src/checkout.test.tsx" }),
    ];

    const annotations = buildAnnotations(tests);
    expect(annotations[0]?.path).toBe("src/checkout.test.tsx");
  });
});

// ---------------------------------------------------------------------------
// postCodeInsights — config-gated network behavior
// ---------------------------------------------------------------------------

describe("postCodeInsights", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does nothing when bitbucket.enabled is false", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await postCodeInsights({
      config: { enabled: false, workspace: "ws", repoSlug: "repo" },
      commitSha: "abc123",
      report: buildReport({
        domainResults: [makeDomainResult()],
        gradedTests: [makeTest()],
        branch: "main",
      }),
      annotations: [],
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the report and annotations when enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await postCodeInsights({
      config: { enabled: true, workspace: "ws", repoSlug: "repo" },
      commitSha: "abc123",
      report: buildReport({
        domainResults: [makeDomainResult()],
        gradedTests: [makeTest({ grade: "F" })],
        branch: "main",
      }),
      annotations: buildAnnotations([makeTest({ grade: "F" })]),
      auth: { token: "test-token" },
    });

    expect(fetchMock).toHaveBeenCalled();

    // First call should be the report PUT, addressed to the repo + commit
    const firstCallUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(firstCallUrl).toContain("ws");
    expect(firstCallUrl).toContain("repo");
    expect(firstCallUrl).toContain("abc123");
  });

  it("throws a clear error when enabled but credentials are missing", async () => {
    await expect(
      postCodeInsights({
        config: { enabled: true, workspace: "ws", repoSlug: "repo" },
        commitSha: "abc123",
        report: buildReport({
          domainResults: [makeDomainResult()],
          gradedTests: [makeTest()],
          branch: "main",
        }),
        annotations: [],
      }),
    ).rejects.toThrow(/auth|credential|token/i);
  });

  it("throws when Bitbucket returns a non-OK response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }) as unknown as typeof fetch;

    await expect(
      postCodeInsights({
        config: { enabled: true, workspace: "ws", repoSlug: "repo" },
        commitSha: "abc123",
        report: buildReport({
          domainResults: [makeDomainResult()],
          gradedTests: [makeTest()],
          branch: "main",
        }),
        annotations: [],
        auth: { token: "test-token" },
      }),
    ).rejects.toThrow(/401|unauth/i);
  });
});
