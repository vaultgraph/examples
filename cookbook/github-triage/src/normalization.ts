const BODY_CHAR_BUDGET = 8_000;
const COMMENT_CHAR_BUDGET = 2_000;

const templateHeaders = new Set([
  "describe the bug",
  "steps to reproduce",
  "expected behavior",
  "actual behavior",
  "current behavior",
  "screenshots",
  "environment",
  "version",
  "versions",
  "additional context",
  "checklist",
  "reproduction",
  "reproducer",
  "problem statement",
  "summary",
  "use case",
  "motivation",
  "proposal",
  "what happened",
  "what did you expect to happen",
  "how can we reproduce the bug",
  "logs",
  "stack trace",
]);

function isTemplateHeader(line: string): boolean {
  if (!line) {
    return false;
  }

  const normalized = line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.*)\*\*:?$/, "$1")
    .replace(/^[-*]\s*/, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();

  return templateHeaders.has(normalized);
}

function stripIssueTemplateHeaders(body: string): string {
  const lines = body.split(/\r?\n/);
  const output: string[] = [];
  let insideFence = false;
  let skipBlankAfterHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      insideFence = !insideFence;
      skipBlankAfterHeader = false;
      output.push(line);
      continue;
    }

    if (!insideFence && isTemplateHeader(trimmed)) {
      skipBlankAfterHeader = true;
      continue;
    }

    if (!insideFence && skipBlankAfterHeader && trimmed === "") {
      continue;
    }

    skipBlankAfterHeader = false;
    output.push(line);
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Keep fenced code blocks intact so the model sees valid repro snippets.
export function truncatePreservingCodeFences(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value.trim();
  }

  const parts: Array<{ text: string; fenced: boolean }> = [];
  const fencePattern = /```[\s\S]*?```/g;
  let cursor = 0;

  for (const match of value.matchAll(fencePattern)) {
    const index = match.index ?? 0;

    if (index > cursor) {
      parts.push({ text: value.slice(cursor, index), fenced: false });
    }

    parts.push({ text: match[0], fenced: true });
    cursor = index + match[0].length;
  }

  if (cursor < value.length) {
    parts.push({ text: value.slice(cursor), fenced: false });
  }

  let remaining = maxChars;
  let output = "";

  for (const part of parts) {
    if (part.text.length <= remaining) {
      output += part.text;
      remaining -= part.text.length;
      continue;
    }

    if (part.fenced) {
      if (!output) {
        output += part.text;
      }
      break;
    }

    output += part.text.slice(0, remaining).trimEnd();
    break;
  }

  return `${output.trimEnd()}\n\n[truncated]`;
}

export function normalizeIssueBody(body: string): string {
  const stripped = stripIssueTemplateHeaders(body);
  return truncatePreservingCodeFences(stripped, BODY_CHAR_BUDGET);
}

export function normalizeCommentBody(body: string): string {
  return truncatePreservingCodeFences(body, COMMENT_CHAR_BUDGET);
}