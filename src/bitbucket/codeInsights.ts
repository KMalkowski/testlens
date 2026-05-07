import { createHash } from "node:crypto";
import type { DomainResult, GradedTest } from "../output/terminal.js";

export type CodeInsightsResult = "PASSED" | "FAILED";

export type CodeInsightsDataType =
  | "BOOLEAN"
  | "DATE"
  | "DURATION"
  | "LINK"
  | "NUMBER"
  | "PERCENTAGE"
  | "TEXT";

export interface CodeInsightsDataEntry {
  title: string;
  type: CodeInsightsDataType;
  value: string | number | boolean;
}

export interface CodeInsightsReport {
  title: string;
  details: string;
  reporter: string;
  result: CodeInsightsResult;
  link?: string;
  data: CodeInsightsDataEntry[];
}

export type AnnotationSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface CodeInsightsAnnotation {
  external_id: string;
  annotation_type: "CODE_SMELL" | "VULNERABILITY" | "BUG";
  summary: string;
  severity: AnnotationSeverity;
  path: string;
  line?: number;
  link?: string;
}

export interface BuildReportInput {
  domainResults: DomainResult[];
  gradedTests: GradedTest[];
  branch: string;
  reportLink?: string;
}

export interface BitbucketAuth {
  token: string;
}

export interface BitbucketConfigInput {
  enabled: boolean;
  workspace: string;
  repoSlug: string;
}

export interface PostCodeInsightsArgs {
  config: BitbucketConfigInput;
  commitSha: string;
  report: CodeInsightsReport;
  annotations: CodeInsightsAnnotation[];
  auth?: BitbucketAuth;
  /** Override for tests; defaults to the public Bitbucket Cloud API. */
  apiBase?: string;
}

const REPORT_ID = "testlens";

export function buildReport(input: BuildReportInput): CodeInsightsReport {
  const { domainResults, gradedTests, branch, reportLink } = input;

  const result: CodeInsightsResult = domainResults.some((d) => d.degradedCount > 0)
    ? "FAILED"
    : "PASSED";

  const data: CodeInsightsDataEntry[] = domainResults.map((d) => ({
    title: d.label,
    type: "TEXT",
    value: `${d.currentGrade} (${d.testCount} tests)`,
  }));

  data.push({
    title: "Tests graded",
    type: "NUMBER",
    value: gradedTests.length,
  });

  const report: CodeInsightsReport = {
    title: "TestLens",
    details: `Test quality grades for ${branch}`,
    reporter: "testlens",
    result,
    data,
  };

  if (reportLink !== undefined) report.link = reportLink;

  return report;
}

export function buildAnnotations(tests: GradedTest[]): CodeInsightsAnnotation[] {
  const annotations: CodeInsightsAnnotation[] = [];

  for (const t of tests) {
    if (t.grade !== "D" && t.grade !== "F") continue;
    annotations.push({
      external_id: makeExternalId(t),
      annotation_type: "CODE_SMELL",
      summary: `Grade ${t.grade}: ${t.name} (useful: ${t.usefulnessScore}, flaky: ${t.flakinessScore})`,
      severity: t.grade === "F" ? "HIGH" : "LOW",
      path: t.filePath,
    });
  }

  return annotations;
}

export async function postCodeInsights(args: PostCodeInsightsArgs): Promise<void> {
  if (!args.config.enabled) return;

  if (!args.auth?.token) {
    throw new Error(
      "Bitbucket Code Insights is enabled but no auth token was provided (set BITBUCKET_TOKEN)",
    );
  }

  const apiBase = args.apiBase ?? "https://api.bitbucket.org/2.0";
  const { workspace, repoSlug } = args.config;
  const reportUrl = `${apiBase}/repositories/${workspace}/${repoSlug}/commit/${args.commitSha}/reports/${REPORT_ID}`;

  const reportResponse = await fetch(reportUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.auth.token}`,
    },
    body: JSON.stringify(args.report),
  });

  if (!reportResponse.ok) {
    const body = await reportResponse.text();
    throw new Error(`Bitbucket Code Insights report PUT failed: ${reportResponse.status} ${body}`);
  }

  if (args.annotations.length === 0) return;

  const annotationsUrl = `${reportUrl}/annotations`;
  const annotationsResponse = await fetch(annotationsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.auth.token}`,
    },
    body: JSON.stringify(args.annotations),
  });

  if (!annotationsResponse.ok) {
    const body = await annotationsResponse.text();
    throw new Error(
      `Bitbucket Code Insights annotations POST failed: ${annotationsResponse.status} ${body}`,
    );
  }
}

function makeExternalId(test: GradedTest): string {
  return `testlens-${createHash("sha1").update(`${test.filePath}::${test.name}`).digest("hex").slice(0, 16)}`;
}
