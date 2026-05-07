import type { ParsedTestCase } from "../parser/types.js";

const businessKeywords = [
  "checkout",
  "pricing",
  "auth",
  "payment",
  "inventory",
  "order",
  "billing",
];

export function computeUsefulnessScore(testCase: ParsedTestCase): number {
  let score = 0;

  // +2 / -2: descriptive name vs vague name
  if (testCase.signals.hasVagueName) {
    score -= 2;
  } else {
    score += 2;
  }

  // +2: assertion checks visible output
  if (testCase.signals.hasVisibleOutputAssertion) {
    score += 2;
  }

  // +2: tests a business rule (domain matches business keywords)
  if (testCase.domain && businessKeywords.some((k) => testCase.domain?.includes(k))) {
    score += 2;
  }

  // +1: has @domain tag
  if (testCase.domain) {
    score += 1;
  }

  // +1: uses accessible queries
  if (testCase.signals.usesAccessibleQueries) {
    score += 1;
  }

  // +1: has @regression tag
  if (testCase.tags.includes("regression")) {
    score += 1;
  }

  // -2: only assertion is toBeInTheDocument
  if (testCase.signals.onlyToBeInTheDocument) {
    score -= 2;
  }

  // -1: mocks more than 3 dependencies
  if (testCase.signals.mockCount > 3) {
    score -= 1;
  }

  // -1: no @domain tag
  if (!testCase.domain) {
    score -= 1;
  }

  return Math.max(0, Math.min(10, score));
}
