export type TestTag = "critical" | "edge-case" | "regression" | "happy-path";

export interface TestSignals {
  usesAccessibleQueries: boolean;
  usesTestIdQueries: boolean;
  hasVisibleOutputAssertion: boolean;
  onlyToBeInTheDocument: boolean;
  mockCount: number;
  hasVagueName: boolean;
  hasTimeouts: boolean;
}

export interface ParsedTestCase {
  name: string;
  filePath: string;
  domain?: string;
  tags: TestTag[];
  line?: number;
  signals: TestSignals;
}
