export type Grade = "A" | "B" | "C" | "D" | "F";

export interface DomainConfig {
  id: string;
  label: string;
  color: string;
}

export interface GradingConfig {
  untaggedCap: Grade;
  flakinessSampleSize: number;
  flakinessThreshold: number;
}

export interface BitbucketConfig {
  enabled: boolean;
  workspace: string;
  repoSlug: string;
}

export interface TestLensConfig {
  baseBranch: string;
  testMatch: string[];
  junitOutput: string;
  playwrightJunitOutput: string;
  domains: DomainConfig[];
  grading: GradingConfig;
  bitbucket: BitbucketConfig;
}
