export type TestTag = "critical" | "edge-case" | "regression" | "happy-path";

export interface ParsedTestCase {
  name: string;
  filePath: string;
  domain?: string;
  tags: TestTag[];
  line?: number;
}
