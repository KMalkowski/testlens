import type { DomainConfig } from "../config/types.js";
import type { ParsedTestCase } from "../parser/types.js";

export async function getAffectedFiles(_baseBranch: string, _cwd: string): Promise<string[]> {
  throw new Error("Not implemented");
}

export function mapFilesToDomains(
  _affectedFiles: string[],
  _allTests: ParsedTestCase[],
  _domains: DomainConfig[],
): Map<string, ParsedTestCase[]> {
  throw new Error("Not implemented");
}
