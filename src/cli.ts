#!/usr/bin/env node

import { Command } from "commander";
import pc from "picocolors";
import { loadConfig } from "./config/loadConfig.js";
import { runPipeline } from "./pipeline.js";

const version = "0.1.0";

export async function run(argv = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("testlens")
    .description("Grade test quality by product domain.")
    .version(version)
    .option("--report", "generate testlens-report.html")
    .option("--domain <id>", "inspect one domain regardless of diff")
    .option("--all", "grade the full test suite")
    .option("--ci", "run CI mode")
    .option("--base <branch>", "override the configured base branch")
    .option("--skill", "generate TESTLENS_SKILL.md")
    .action(async (options) => {
      const cwd = process.cwd();
      const config = await loadConfig(cwd);
      const baseBranch = options.base ?? config.baseBranch;

      console.log(`${pc.bold("testlens")}  v${version}  base: ${baseBranch}`);
      console.log("");

      const result = await runPipeline(
        config,
        {
          domain: options.domain,
          all: options.all,
          base: options.base,
          ci: options.ci,
          report: options.report,
          skill: options.skill,
        },
        cwd,
      );

      console.log(result.output);
    });

  await program.parseAsync(argv);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(`testlens failed: ${message}`));
  process.exitCode = 1;
});
