import { readFile } from "node:fs/promises";
import { parse, type TestCase, type TestSuite, type TestSuites } from "junit2json";

export interface JunitTestResult {
  name: string;
  classname?: string;
  filePath?: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  failureMessage?: string;
}

interface SuiteWithFile extends TestSuite {
  file?: string;
}

export async function parseJunitXml(xml: string): Promise<JunitTestResult[]> {
  const parsed = await parse(xml);

  if (!parsed) {
    return [];
  }

  const suites = collectSuites(parsed);
  const results: JunitTestResult[] = [];

  for (const suite of suites) {
    if (!suite.testcase) continue;
    for (const testcase of suite.testcase) {
      results.push(toResult(testcase, suite));
    }
  }

  return results;
}

export async function parseJunitFile(absPath: string): Promise<JunitTestResult[]> {
  const xml = await readFile(absPath, "utf-8");
  return parseJunitXml(xml);
}

function collectSuites(parsed: TestSuites | TestSuite): SuiteWithFile[] {
  if ("testsuite" in parsed && Array.isArray(parsed.testsuite)) {
    return parsed.testsuite as SuiteWithFile[];
  }

  if ("testcase" in parsed) {
    return [parsed as SuiteWithFile];
  }

  return [];
}

function toResult(testcase: TestCase, suite: SuiteWithFile): JunitTestResult {
  const name = testcase.name ?? "(unnamed)";
  const classname = testcase.classname;
  const filePath = suite.file ?? classname;
  const durationMs = (testcase.time ?? 0) * 1000;

  const status = deriveStatus(testcase);
  const failureMessage = extractFailureMessage(testcase);

  const result: JunitTestResult = {
    name,
    status,
    durationMs,
  };

  if (classname !== undefined) result.classname = classname;
  if (filePath !== undefined) result.filePath = filePath;
  if (failureMessage !== undefined) result.failureMessage = failureMessage;

  return result;
}

function deriveStatus(testcase: TestCase): JunitTestResult["status"] {
  if (testcase.failure && testcase.failure.length > 0) return "failed";
  if (testcase.error && testcase.error.length > 0) return "failed";
  if (testcase.skipped && testcase.skipped.length > 0) return "skipped";
  return "passed";
}

function extractFailureMessage(testcase: TestCase): string | undefined {
  const detail = testcase.failure?.[0] ?? testcase.error?.[0];
  if (!detail) return undefined;
  return detail.inner ?? detail.message;
}
