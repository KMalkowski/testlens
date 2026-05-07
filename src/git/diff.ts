import { execa } from "execa";
import type { DomainConfig } from "../config/types.js";
import type { ParsedTestCase } from "../parser/types.js";

export async function getAffectedFiles(baseBranch: string, cwd: string): Promise<string[]> {
  const { stdout } = await execa("git", ["diff", "--name-only", `${baseBranch}...HEAD`], { cwd });
  if (!stdout.trim()) {
    return [];
  }
  return stdout.trim().split("\n");
}

export function mapFilesToDomains(
  affectedFiles: string[],
  allTests: ParsedTestCase[],
  _domains: DomainConfig[],
): Map<string, ParsedTestCase[]> {
  const result = new Map<string, ParsedTestCase[]>();
  const affectedSet = new Set(affectedFiles);

  for (const test of allTests) {
    if (!affectedSet.has(test.filePath)) {
      continue;
    }

    const key = test.domain ?? "unclassified";

    const existing = result.get(key);
    if (existing) {
      existing.push(test);
    } else {
      result.set(key, [test]);
    }
  }

  return result;
}
