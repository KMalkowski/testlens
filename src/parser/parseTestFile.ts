import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import type { CallExpression, Comment, Node, StringLiteral } from "@babel/types";
import type { ParsedTestCase, TestTag } from "./types.js";

const supportedTags = new Set<TestTag>(["critical", "edge-case", "regression", "happy-path"]);
const traverse = "default" in traverseModule ? traverseModule.default : traverseModule;

export function parseTestFile(filePath: string, source: string): ParsedTestCase[] {
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: ["jsx", "typescript"],
    attachComment: true,
  });

  const fileComments = ast.comments ?? [];
  const tests: ParsedTestCase[] = [];

  traverse(ast, {
    CallExpression(path) {
      const node = path.node;

      if (!isTestCall(node)) {
        return;
      }

      const nameNode = node.arguments[0];

      if (!nameNode || nameNode.type !== "StringLiteral") {
        return;
      }

      const comments = collectNearbyComments(node, nameNode, source, fileComments);
      const { domain, tags } = parseTags(comments.join("\n"));

      tests.push({
        name: nameNode.value,
        filePath,
        domain,
        tags,
        line: node.loc?.start.line,
      });
    },
  });

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

function parseTags(text: string): Pick<ParsedTestCase, "domain" | "tags"> {
  const domain = /@domain:([a-z0-9-]+)/.exec(text)?.[1];
  const tags = [...text.matchAll(/@(critical|edge-case|regression|happy-path)\b/g)]
    .map((match) => match[1])
    .filter((tag): tag is TestTag => supportedTags.has(tag as TestTag));

  return { domain, tags };
}
