import type { Grade } from "../config/types.js";

export interface DomainResult {
  domainId: string;
  label: string;
  currentGrade: Grade;
  previousGrade?: Grade;
  testCount: number;
  degradedCount: number;
}

export interface GradedTest {
  name: string;
  filePath: string;
  grade: Grade;
  usefulnessScore: number;
  flakinessScore: number;
  domain?: string;
  tags: string[];
  isCapped: boolean;
}

export function formatDeltaView(_results: DomainResult[]): string {
  throw new Error("Not implemented");
}

export function formatDomainView(_domainId: string, _tests: GradedTest[]): string {
  throw new Error("Not implemented");
}
