import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { defaultConfig } from "./defaultConfig.js";
import type { TestLensConfig } from "./types.js";

const gradeSchema = z.enum(["A", "B", "C", "D", "F"]);

export const testlensConfigSchema = z.object({
  baseBranch: z.string().min(1).default(defaultConfig.baseBranch),
  testMatch: z.array(z.string().min(1)).min(1).default(defaultConfig.testMatch),
  junitOutput: z.string().min(1).default(defaultConfig.junitOutput),
  playwrightJunitOutput: z.string().min(1).default(defaultConfig.playwrightJunitOutput),
  domains: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        label: z.string().min(1),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    )
    .default(defaultConfig.domains),
  grading: z
    .object({
      untaggedCap: gradeSchema.default(defaultConfig.grading.untaggedCap),
      flakinessSampleSize: z
        .number()
        .int()
        .positive()
        .default(defaultConfig.grading.flakinessSampleSize),
      flakinessThreshold: z
        .number()
        .min(0)
        .max(1)
        .default(defaultConfig.grading.flakinessThreshold),
    })
    .default(defaultConfig.grading),
  bitbucket: z
    .object({
      enabled: z.boolean().default(defaultConfig.bitbucket.enabled),
      workspace: z.string().default(defaultConfig.bitbucket.workspace),
      repoSlug: z.string().default(defaultConfig.bitbucket.repoSlug),
    })
    .default(defaultConfig.bitbucket),
});

export async function loadConfig(cwd: string): Promise<TestLensConfig> {
  const configPath = findUp("testlens.config.js", cwd);

  if (!configPath) {
    return testlensConfigSchema.parse(defaultConfig);
  }

  const loaded = await import(pathToFileURL(configPath).href);
  const userConfig = loaded.default ?? loaded;

  return testlensConfigSchema.parse({
    ...defaultConfig,
    ...userConfig,
    grading: {
      ...defaultConfig.grading,
      ...userConfig.grading,
    },
    bitbucket: {
      ...defaultConfig.bitbucket,
      ...userConfig.bitbucket,
    },
  });
}

function findUp(fileName: string, startDir: string): string | undefined {
  let current = startDir;
  const root = parse(startDir).root;

  while (true) {
    const candidate = join(current, fileName);

    if (existsSync(candidate)) {
      return candidate;
    }

    if (current === root) {
      return undefined;
    }

    current = dirname(current);
  }
}
