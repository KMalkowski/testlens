import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import type { CallExpression, Comment, Node, StringLiteral } from "@babel/types";
import type { ParsedTestCase, TestSignals, TestTag } from "./types.js";

const supportedTags = new Set<TestTag>(["critical", "edge-case", "regression", "happy-path"]);
const traverse = "default" in traverseModule ? traverseModule.default : traverseModule;

const accessibleQueryPattern =
  /\b(getBy|findBy|queryBy|getAllBy|findAllBy|queryAllBy)(Role|Text|LabelText|PlaceholderText|AltText|DisplayValue)\b/;
const testIdQueryPattern = /\b(getBy|findBy|queryBy|getAllBy|findAllBy|queryAllBy)TestId\b/;
const visibleOutputPattern =
  /\.(toBeVisible|toBeDisabled|toBeEnabled|toBeChecked|toHaveTextContent|toHaveValue|toHaveAttribute)\b/;
const vagueNames = new Set(["renders", "works", "test"]);
const timeoutPattern = /\bsetTimeout\b/;

export function parseTestFile(filePath: string, source: string): ParsedTestCase[] {
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: ["jsx", "typescript"],
    attachComment: true,
  });

  const fileComments = ast.comments ?? [];
  const tests: ParsedTestCase[] = [];
  let fileMockCount = 0;

  traverse(ast, {
    CallExpression(path) {
      const node = path.node;

      if (isMockCall(node)) {
        fileMockCount++;
        return;
      }

      if (!isTestCall(node)) {
        return;
      }

      const nameNode = node.arguments[0];

      if (!nameNode || nameNode.type !== "StringLiteral") {
        return;
      }

      const comments = collectNearbyComments(node, nameNode, source, fileComments);
      const { domain, tags } = parseTags(comments.join("\n"));

      const callbackNode = node.arguments[1];
      const bodySource =
        callbackNode?.start != null && callbackNode?.end != null
          ? source.slice(callbackNode.start, callbackNode.end)
          : "";

      tests.push({
        name: nameNode.value,
        filePath,
        domain,
        tags,
        line: node.loc?.start.line,
        signals: detectSignals(nameNode.value, bodySource),
      });
    },
  });

  for (const test of tests) {
    test.signals.mockCount = fileMockCount;
  }

  return tests;
}

function isTestCall(node: CallExpression): boolean {
  const callee = node.callee;

  if (callee.type === "Identifier") {
    return callee.name === "it" || callee.name === "test";
  }

  if (callee.type === "MemberExpression" && callee.object.type === "Identifier") {
    return callee.object.name === "it" || callee.object.name === "test";
  }

  return false;
}

function collectNearbyComments(
  node: Node,
  nameNode: StringLiteral,
  source: string,
  fileComments: Comment[],
): string[] {
  return [
    ...(node.leadingComments ?? []),
    ...(nameNode.leadingComments ?? []),
    ...(nameNode.trailingComments ?? []),
    ...fileComments.filter((comment) => isAdjacentLeadingComment(comment, node, source)),
  ].map((comment) => comment.value);
}

function isAdjacentLeadingComment(comment: Comment, node: Node, source: string): boolean {
  const commentEnd = comment.end;
  const nodeStart = node.start;

  if (commentEnd == null || nodeStart == null || commentEnd > nodeStart) {
    return false;
  }

  return source.slice(commentEnd, nodeStart).trim() === "";
}

function isMockCall(node: CallExpression): boolean {
  const callee = node.callee;
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "mock" &&
    (callee.object.name === "vi" || callee.object.name === "jest")
  );
}

function detectSignals(testName: string, bodySource: string): TestSignals {
  const assertionMatches = bodySource.match(/\.to\w+\(/g);
  const hasAssertions = assertionMatches != null && assertionMatches.length > 0;
  const allAreToBeInTheDocument =
    hasAssertions && assertionMatches.every((m) => m === ".toBeInTheDocument(");

  return {
    usesAccessibleQueries: accessibleQueryPattern.test(bodySource),
    usesTestIdQueries: testIdQueryPattern.test(bodySource),
    hasVisibleOutputAssertion: visibleOutputPattern.test(bodySource),
    onlyToBeInTheDocument: allAreToBeInTheDocument,
    mockCount: 0,
    hasVagueName: vagueNames.has(testName.trim().toLowerCase()),
    hasTimeouts: timeoutPattern.test(bodySource),
  };
}

function parseTags(text: string): Pick<ParsedTestCase, "domain" | "tags"> {
  const domain = /@domain:([a-z0-9-]+)/.exec(text)?.[1];
  const tags = [...text.matchAll(/@(critical|edge-case|regression|happy-path)\b/g)]
    .map((match) => match[1])
    .filter((tag): tag is TestTag => supportedTags.has(tag as TestTag));

  return { domain, tags };
}
