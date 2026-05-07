import type { TestLensConfig } from "./types.js";

export const defaultConfig: TestLensConfig = {
  baseBranch: "main",
  testMatch: ["**/*.test.tsx", "**/*.test.ts", "**/*.spec.ts", "e2e/**/*.spec.ts"],
  junitOutput: "./test-results/junit.xml",
  playwrightJunitOutput: "./playwright-results/results.xml",
  domains: [],
  grading: {
    untaggedCap: "C",
    flakinessSampleSize: 20,
    flakinessThreshold: 0.15,
  },
  bitbucket: {
    enabled: false,
    workspace: "",
    repoSlug: "",
  },
};
