import type { DomainConfig, Grade } from "../config/types.js";
import type { GradedTest } from "../output/terminal.js";

export interface SkillInput {
  domains: DomainConfig[];
  gradedTests: GradedTest[];
  testBodies: Map<string, string>;
}

const MAX_EXAMPLES = 3;
const TAXONOMY_MARKER_PREFIX = "<!-- testlens-taxonomy:";
const TAXONOMY_MARKER_SUFFIX = "-->";

const gradeOrder: Record<Grade, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };

function bodyKey(filePath: string, name: string): string {
  return `${filePath}::${name}`;
}

function taxonomyFingerprint(domains: DomainConfig[]): string {
  return domains.map((d) => `${d.id}|${d.label}`).join(",");
}

interface SelectedExample {
  test: GradedTest;
  body: string;
}

function selectExamples(
  gradedTests: GradedTest[],
  testBodies: Map<string, string>,
): SelectedExample[] {
  const eligible: SelectedExample[] = [];

  for (const test of gradedTests) {
    if (!test.domain) continue;
    if (test.grade !== "A" && test.grade !== "B") continue;
    const body = testBodies.get(bodyKey(test.filePath, test.name));
    if (typeof body !== "string") continue;
    eligible.push({ test, body });
  }

  eligible.sort((a, b) => {
    const gradeDiff = gradeOrder[b.test.grade] - gradeOrder[a.test.grade];
    if (gradeDiff !== 0) return gradeDiff;
    return b.test.usefulnessScore - a.test.usefulnessScore;
  });

  return eligible.slice(0, MAX_EXAMPLES);
}

export function generateSkill(input: SkillInput): string {
  const { domains, gradedTests, testBodies } = input;
  const examples = selectExamples(gradedTests, testBodies);

  const lines: string[] = [];

  lines.push("# TestLens Tagging Skill");
  lines.push("");
  lines.push("Use this prompt with any LLM to add TestLens tags to a test file.");
  lines.push("");

  lines.push("## Context");
  lines.push("");
  lines.push(
    "TestLens grades tests by usefulness and flakiness, then groups them by product domain.",
  );
  lines.push(
    "Tags live in comments above `describe` or `it` blocks — no new syntax, no custom runner.",
  );
  lines.push("");
  lines.push("Supported tags:");
  lines.push("");
  lines.push("- `@domain:<id>` — maps the test to a domain from the taxonomy below");
  lines.push("- `@critical` — revenue or core flow; flakiness penalty is doubled");
  lines.push("- `@edge-case` — narrow scenario; no usefulness penalty");
  lines.push("- `@regression` — was a real bug once; usefulness bonus");
  lines.push("- `@happy-path` — primary success flow");
  lines.push("");

  lines.push("## Taxonomy");
  lines.push("");
  if (domains.length === 0) {
    lines.push("_No domains configured yet._");
  } else {
    for (const d of domains) {
      lines.push(`- \`${d.id}\` — ${d.label}`);
    }
  }
  lines.push("");

  lines.push("## Examples");
  lines.push("");
  if (examples.length === 0) {
    lines.push("_No tagged examples available yet — add `@domain` tags to your tests._");
  } else {
    lines.push("Well-tagged tests from this codebase. Match the style and placement.");
    lines.push("");
    for (const ex of examples) {
      lines.push(`**${ex.test.filePath}** — \`${ex.test.name}\``);
      lines.push("");
      lines.push("```ts");
      lines.push(ex.body);
      lines.push("```");
      lines.push("");
    }
  }

  lines.push("## Instructions");
  lines.push("");
  lines.push("Paste the test file you want to tag along with this prompt.");
  lines.push(
    "Add tag comments above each `describe` and `it` block. Do not change any test code.",
  );
  lines.push(
    "If a test's domain is uncertain or ambiguous, attach a short confidence note explaining why.",
  );
  lines.push("");

  lines.push("## Output format");
  lines.push("");
  lines.push("Return:");
  lines.push("");
  lines.push("1. The tagged file inside a fenced code block.");
  lines.push("2. A short list of any tests you marked uncertain, with reasoning.");
  lines.push("");

  lines.push(
    `${TAXONOMY_MARKER_PREFIX} ${taxonomyFingerprint(domains)} ${TAXONOMY_MARKER_SUFFIX}`,
  );

  return lines.join("\n");
}

export function shouldRegenerateSkill(
  existingContent: string | undefined,
  domains: DomainConfig[],
): boolean {
  if (!existingContent) return true;

  const startIdx = existingContent.indexOf(TAXONOMY_MARKER_PREFIX);
  if (startIdx === -1) return true;

  const endIdx = existingContent.indexOf(
    TAXONOMY_MARKER_SUFFIX,
    startIdx + TAXONOMY_MARKER_PREFIX.length,
  );
  if (endIdx === -1) return true;

  const marker = existingContent
    .slice(startIdx + TAXONOMY_MARKER_PREFIX.length, endIdx)
    .trim();
  const current = taxonomyFingerprint(domains);

  return marker !== current;
}
