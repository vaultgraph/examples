import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { Octokit } from "@octokit/rest";
import { hashContext, submitSignedReceipt } from "@vaultgraph/sdk";
import { z } from "zod";

const exampleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(exampleDir, "../../.env"), quiet: true });

const AGENT_VERSION = "1.0.0";
const DEFAULT_MAX_ISSUES = 15;
const DEFAULT_MODEL = process.env["TRIAGE_MODEL"] ?? "gpt-4.1-mini";
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

type IssueCategory = "bug" | "feature" | "question" | "docs" | "noise";
type IssuePriority = "critical" | "high" | "medium" | "low";
type Resolution = "success" | "partial" | "failed";

type RepoLabel = {
  name: string;
  description: string | null;
  color: string;
};

type IssueComment = {
  author: string;
  createdAt: string;
  body: string;
};

type IssueContext = {
  owner: string;
  repo: string;
  number: number;
  issueUrl: string;
  title: string;
  body: string;
  author: string;
  createdAt: string;
  currentLabels: string[];
  commentsCount: number;
  comments: IssueComment[];
};

type ClassificationResult = {
  category: IssueCategory;
  rationale: string;
  confidence: number;
};

type PriorityResult = {
  priority: IssuePriority;
  rationale: string;
};

type LabelResult = {
  labels: string[];
  rationale: string;
};

type SummaryResult = {
  summary: string;
  nextAction: string;
  confidence: number;
};

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

type ReceiptOutput = {
  category: IssueCategory;
  priority: IssuePriority | null;
  labels: string[];
  summary: string;
  next_action: string;
  confidence: number;
};

const classificationSchema = z.object({
  category: z.enum(["bug", "feature", "question", "docs", "noise"]),
  rationale: z.string().min(1).default("Model omitted classification rationale."),
  confidence: z.coerce.number().min(0).max(1).default(0.5),
});

const prioritySchema = z.object({
  priority: z.enum(["critical", "high", "medium", "low"]),
  rationale: z.string().min(1).default("Model omitted priority rationale."),
});

const labelSchema = z.object({
  labels: z.array(z.string()).max(3),
  rationale: z.string().min(1).default("Model omitted label rationale."),
});

const summarySchema = z.object({
  summary: z.string().min(1).max(160),
  nextAction: z.string().min(1).max(200),
  confidence: z.coerce.number().min(0).max(1).default(0.5),
});

const TriageStateAnnotation = Annotation.Root({
  issue: Annotation<IssueContext>(),
  availableLabels: Annotation<RepoLabel[]>(),
  normalizedBody: Annotation<string>(),
  classification: Annotation<ClassificationResult | null>(),
  priority: Annotation<IssuePriority | null>(),
  suggestedLabels: Annotation<string[]>(),
  summary: Annotation<string>(),
  nextAction: Annotation<string>(),
  confidence: Annotation<number>(),
  tokensIn: Annotation<number>(),
  tokensOut: Annotation<number>(),
});

type TriageState = typeof TriageStateAnnotation.State;

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Set ${name} before running this example.`);
  }

  return value;
}

function parseRepoSlug(repoSlug: string | undefined): { owner: string; repo: string } {
  if (!repoSlug) {
    throw new Error("Pass a repo slug like owner/repo or set GITHUB_TRIAGE_REPO.");
  }

  const [owner, repo, ...rest] = repoSlug.split("/");

  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Invalid repo slug: ${repoSlug}`);
  }

  return { owner, repo };
}

function parseMaxIssues(rawValue: string | undefined): number {
  if (!rawValue) {
    return DEFAULT_MAX_ISSUES;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid max issue count: ${rawValue}`);
  }

  return parsed;
}

function createGitHubClient(): { octokit: Octokit; authMode: string } {
  const token = process.env["GITHUB_TOKEN"];

  if (token) {
    return {
      octokit: new Octokit({ auth: token, userAgent: "vaultgraph-github-triage" }),
      authMode: "authenticated GitHub API access (roughly 5000 requests/hour)",
    };
  }

  return {
    octokit: new Octokit({ userAgent: "vaultgraph-github-triage" }),
    authMode: "unauthenticated GitHub API access (60 requests/hour)",
  };
}

async function fetchRepoLabels(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<RepoLabel[]> {
  const labels = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, {
    owner,
    repo,
    per_page: 100,
  });

  return labels.map((label) => ({
    name: label.name,
    description: label.description,
    color: label.color,
  }));
}

async function fetchOpenIssues(
  octokit: Octokit,
  owner: string,
  repo: string,
  maxIssues: number,
) {
  const issues: Awaited<ReturnType<typeof octokit.rest.issues.listForRepo>>["data"] = [];
  let page = 1;

  while (issues.length < maxIssues) {
    const response = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "open",
      sort: "created",
      direction: "desc",
      per_page: Math.min(Math.max(maxIssues, 30), 100),
      page,
    });

    if (response.data.length === 0) {
      break;
    }

    for (const item of response.data) {
      if ("pull_request" in item && item.pull_request) {
        continue;
      }

      issues.push(item);
      if (issues.length >= maxIssues) {
        break;
      }
    }

    page += 1;
  }

  return issues.slice(0, maxIssues);
}

async function buildIssueContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  issue: {
    number: number;
    html_url: string;
    title: string;
    body?: string | null;
    created_at: string;
    comments: number;
    labels: Array<string | { name?: string | null }>;
    user: { login: string } | null;
  },
): Promise<IssueContext> {
  const comments = issue.comments > 0
    ? await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issue.number,
        sort: "created",
        direction: "asc",
        per_page: 3,
      })
    : { data: [] };

  return {
    owner,
    repo,
    number: issue.number,
    issueUrl: issue.html_url,
    title: issue.title,
    body: issue.body ?? "",
    author: issue.user?.login ?? "unknown",
    createdAt: issue.created_at,
    currentLabels: issue.labels
      .map((label) => (typeof label === "string" ? label : label.name ?? null))
      .filter((label): label is string => Boolean(label)),
    commentsCount: issue.comments,
    comments: comments.data.map((comment) => ({
      author: comment.user?.login ?? "unknown",
      createdAt: comment.created_at,
      body: truncatePreservingCodeFences(comment.body ?? "", COMMENT_CHAR_BUDGET),
    })),
  };
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

function truncatePreservingCodeFences(value: string, maxChars: number): string {
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

function normalizeIssueBody(body: string): string {
  const stripped = stripIssueTemplateHeaders(body);
  return truncatePreservingCodeFences(stripped, BODY_CHAR_BUDGET);
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part) {
          return String(part.text);
        }

        return JSON.stringify(part);
      })
      .join("\n");
  }

  return String(content ?? "");
}

function parseJsonObject(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }

    throw new Error("Model did not return valid JSON.");
  }
}

function getTokenUsage(message: { usage_metadata?: unknown; response_metadata?: unknown }): TokenUsage {
  const usageMetadata = message.usage_metadata as
    | { input_tokens?: number; output_tokens?: number }
    | undefined;
  const tokenUsage = (message.response_metadata as { tokenUsage?: { promptTokens?: number; completionTokens?: number } } | undefined)
    ?.tokenUsage;

  return {
    inputTokens: usageMetadata?.input_tokens ?? tokenUsage?.promptTokens ?? 0,
    outputTokens: usageMetadata?.output_tokens ?? tokenUsage?.completionTokens ?? 0,
  };
}

async function invokeStructuredStep<TSchema extends z.ZodTypeAny>(options: {
  model: ChatOpenAI;
  systemPrompt: string;
  userPrompt: string;
  schema: TSchema;
}): Promise<{ data: z.infer<TSchema>; usage: TokenUsage }> {
  const response = await options.model.invoke([
    new SystemMessage(options.systemPrompt),
    new HumanMessage(options.userPrompt),
  ]);
  const parsed = options.schema.parse(parseJsonObject(extractMessageText(response.content)));

  return {
    data: parsed,
    usage: getTokenUsage(response),
  };
}

function formatIssueContext(issue: IssueContext, normalizedBody: string): string {
  const comments = issue.comments.length > 0
    ? issue.comments
        .map(
          (comment, index) =>
            `Comment ${index + 1}\nAuthor: ${comment.author}\nCreated: ${comment.createdAt}\nBody:\n${comment.body}`,
        )
        .join("\n\n")
    : "No comments yet.";

  return [
    `Repository: ${issue.owner}/${issue.repo}`,
    `Issue number: ${issue.number}`,
    `Issue URL: ${issue.issueUrl}`,
    `Author: ${issue.author}`,
    `Created: ${issue.createdAt}`,
    `Current labels: ${issue.currentLabels.join(", ") || "none"}`,
    `Comments count: ${issue.commentsCount}`,
    `Title: ${issue.title}`,
    `Normalized body:\n${normalizedBody || "No body provided."}`,
    `First comments:\n${comments}`,
  ].join("\n\n");
}

function formatLabelCatalog(labels: RepoLabel[]): string {
  if (labels.length === 0) {
    return "No labels are defined on this repository.";
  }

  return labels
    .map((label) => `- ${label.name}${label.description ? `: ${label.description}` : ""}`)
    .join("\n");
}

function canonicalizeLabels(rawLabels: string[], availableLabels: RepoLabel[]): string[] {
  const labelMap = new Map(availableLabels.map((label) => [label.name.toLowerCase(), label.name]));
  const unique: string[] = [];

  for (const label of rawLabels) {
    const canonical = labelMap.get(label.toLowerCase());

    if (canonical && !unique.includes(canonical)) {
      unique.push(canonical);
    }

    if (unique.length === 3) {
      break;
    }
  }

  return unique;
}

function deriveResolution(confidence: number): Resolution {
  if (confidence >= 0.7) {
    return "success";
  }

  if (confidence >= 0.4) {
    return "partial";
  }

  return "failed";
}

function buildIssueJobId(issue: Pick<IssueContext, "owner" | "repo" | "number">): string {
  return `gh-${issue.owner}-${issue.repo}-issue-${issue.number}`;
}

function buildInputHash(issue: IssueContext): string {
  return hashContext({
    issue_url: issue.issueUrl,
    title: issue.title,
    body: issue.body,
  });
}

function buildContextHash(issue: IssueContext, normalizedBody: string, output: ReceiptOutput): string {
  return hashContext({
    issue,
    normalized_body: normalizedBody,
    output,
  });
}

function createFailureOutput(message: string): ReceiptOutput {
  return {
    category: "noise",
    priority: null,
    labels: [],
    summary: "Issue triage failed.",
    next_action: "Inspect metadata.error_reason and rerun the triage job.",
    confidence: 0,
  };
}

function createTriageGraph(model: ChatOpenAI) {
  const normalizeIssue = async (state: TriageState) => ({
    normalizedBody: normalizeIssueBody(state.issue.body),
  });

  const classifyIssue = async (state: TriageState) => {
    const result = await invokeStructuredStep({
      model,
      schema: classificationSchema,
      systemPrompt:
        "You triage GitHub issues. Return only JSON. Choose exactly one category: bug, feature, question, docs, or noise. Noise means spam, wrong repo, incomprehensible, or chatter.",
      userPrompt: [
        "Classify this issue.",
        "",
        formatIssueContext(state.issue, state.normalizedBody),
      ].join("\n"),
    });

    return {
      classification: result.data,
      tokensIn: state.tokensIn + result.usage.inputTokens,
      tokensOut: state.tokensOut + result.usage.outputTokens,
      confidence: result.data.confidence,
    };
  };

  const assessPriority = async (state: TriageState) => {
    const result = await invokeStructuredStep({
      model,
      schema: prioritySchema,
      systemPrompt:
        "You assess GitHub issue priority. Return only JSON. Consider whether the issue blocks usage, includes a reproducer, mentions a version, uses severe language, or likely affects many users.",
      userPrompt: [
        `Category: ${state.classification?.category ?? "unknown"}`,
        "Decide priority for this issue.",
        "",
        formatIssueContext(state.issue, state.normalizedBody),
      ].join("\n"),
    });

    return {
      priority: result.data.priority,
      tokensIn: state.tokensIn + result.usage.inputTokens,
      tokensOut: state.tokensOut + result.usage.outputTokens,
    };
  };

  const suggestLabels = async (state: TriageState) => {
    if (state.availableLabels.length === 0) {
      return { suggestedLabels: [] };
    }

    const result = await invokeStructuredStep({
      model,
      schema: labelSchema,
      systemPrompt:
        "You suggest GitHub labels. Return only JSON. Choose 1 to 3 labels only from the provided repository label catalog. If nothing fits, return an empty labels array.",
      userPrompt: [
        `Category: ${state.classification?.category ?? "unknown"}`,
        `Priority: ${state.priority ?? "n/a"}`,
        "Available repository labels:",
        formatLabelCatalog(state.availableLabels),
        "",
        formatIssueContext(state.issue, state.normalizedBody),
      ].join("\n"),
    });

    return {
      suggestedLabels: canonicalizeLabels(result.data.labels, state.availableLabels),
      tokensIn: state.tokensIn + result.usage.inputTokens,
      tokensOut: state.tokensOut + result.usage.outputTokens,
    };
  };

  const finalizeNoise = async (state: TriageState) => ({
    priority: null,
    suggestedLabels: [],
    summary: `Likely ${state.classification?.rationale.toLowerCase() ?? "off-topic issue"}.`,
    nextAction: "No triage action beyond manual confirmation.",
    confidence: state.classification?.confidence ?? 0.5,
  });

  const summarizeIssue = async (state: TriageState) => {
    const result = await invokeStructuredStep({
      model,
      schema: summarySchema,
      systemPrompt:
        "You write concise GitHub triage summaries. Return only JSON. The summary must be one line and skimmable. The nextAction must be a short human action, not a paragraph. Confidence must be a number from 0 to 1.",
      userPrompt: [
        `Category: ${state.classification?.category ?? "unknown"}`,
        `Priority: ${state.priority ?? "n/a"}`,
        `Suggested labels: ${state.suggestedLabels.join(", ") || "none"}`,
        `Existing labels: ${state.issue.currentLabels.join(", ") || "none"}`,
        "",
        formatIssueContext(state.issue, state.normalizedBody),
      ].join("\n"),
    });

    return {
      summary: result.data.summary,
      nextAction: result.data.nextAction,
      confidence: result.data.confidence,
      tokensIn: state.tokensIn + result.usage.inputTokens,
      tokensOut: state.tokensOut + result.usage.outputTokens,
    };
  };

  const routeByCategory = (state: TriageState) => {
    const category = state.classification?.category;

    if (category === "noise") {
      return "finalizeNoise";
    }

    if (category === "bug" || category === "feature") {
      return "assessPriority";
    }

    return "suggestLabels";
  };

  return new StateGraph(TriageStateAnnotation)
    .addNode("normalizeIssue", normalizeIssue)
    .addNode("classifyIssue", classifyIssue)
    .addNode("assessPriority", assessPriority)
    .addNode("suggestLabels", suggestLabels)
    .addNode("finalizeNoise", finalizeNoise)
    .addNode("summarizeIssue", summarizeIssue)
    .addEdge(START, "normalizeIssue")
    .addEdge("normalizeIssue", "classifyIssue")
    .addConditionalEdges("classifyIssue", routeByCategory)
    .addEdge("assessPriority", "suggestLabels")
    .addEdge("suggestLabels", "summarizeIssue")
    .addEdge("finalizeNoise", END)
    .addEdge("summarizeIssue", END)
    .compile();
}

async function submitIssueReceipt(options: {
  apiUrl: string;
  apiKey: string;
  deploymentId: string;
  privateKey: string;
  modelName: string;
  issue: IssueContext;
  normalizedBody: string;
  output: ReceiptOutput;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  errorReason?: string;
}): Promise<Resolution> {
  const resolution = deriveResolution(options.output.confidence);
  const receiptOptions: Record<string, unknown> = {
    apiUrl: options.apiUrl,
    apiKey: options.apiKey,
    deploymentId: options.deploymentId,
    privateKey: options.privateKey,
    jobId: buildIssueJobId(options.issue),
    resolution,
    contextHash: buildContextHash(options.issue, options.normalizedBody, options.output),
    metadata: {
      repo: `${options.issue.owner}/${options.issue.repo}`,
      issue_number: options.issue.number,
      issue_url: options.issue.issueUrl,
      model: options.modelName,
      latency_ms: options.latencyMs,
      tokens_in: options.tokensIn,
      tokens_out: options.tokensOut,
      agent_version: AGENT_VERSION,
      input_hash: buildInputHash(options.issue),
      output: options.output,
      ...(options.errorReason ? { error_reason: options.errorReason } : {}),
    },
  };

  await submitSignedReceipt(receiptOptions as any);

  return resolution;
}

async function main() {
  const apiKey = requireEnv("VAULTGRAPH_API_KEY");
  const deploymentId = requireEnv("VAULTGRAPH_DEPLOYMENT_ID");
  const privateKey = requireEnv("VAULTGRAPH_PRIVATE_KEY");
  const openAIApiKey = requireEnv("OPENAI_API_KEY");
  const apiUrl = process.env["VAULTGRAPH_API_URL"] ?? "https://app.vaultgraph.com";
  const repoSlug = process.argv[2] ?? process.env["GITHUB_TRIAGE_REPO"];
  const maxIssues = parseMaxIssues(process.argv[3] ?? process.env["GITHUB_TRIAGE_MAX_ISSUES"]);
  const { owner, repo } = parseRepoSlug(repoSlug);
  const { octokit, authMode } = createGitHubClient();
  const model = new ChatOpenAI({
    apiKey: openAIApiKey,
    model: DEFAULT_MODEL,
    temperature: 0,
  });
  const triageGraph = createTriageGraph(model);

  console.log(`GitHub auth mode: ${authMode}.`);
  console.log(`Fetching labels and up to ${maxIssues} open issues from ${owner}/${repo}.`);

  const availableLabels = await fetchRepoLabels(octokit, owner, repo);
  const issues = await fetchOpenIssues(octokit, owner, repo, maxIssues);

  console.log(`Loaded ${availableLabels.length} labels and ${issues.length} issues for triage.`);

  const counts: Record<Resolution, number> = {
    success: 0,
    partial: 0,
    failed: 0,
  };

  for (const issue of issues) {
    const issueContext = await buildIssueContext(octokit, owner, repo, issue);
    const startedAt = Date.now();

    try {
      const state = await triageGraph.invoke({
        issue: issueContext,
        availableLabels,
        normalizedBody: "",
        classification: null,
        priority: null,
        suggestedLabels: [],
        summary: "",
        nextAction: "",
        confidence: 0,
        tokensIn: 0,
        tokensOut: 0,
      });

      const output: ReceiptOutput = {
        category: state.classification?.category ?? "noise",
        priority: state.priority,
        labels: state.suggestedLabels,
        summary: state.summary,
        next_action: state.nextAction,
        confidence: state.confidence,
      };

      const resolution = await submitIssueReceipt({
        apiUrl,
        apiKey,
        deploymentId,
        privateKey,
        modelName: DEFAULT_MODEL,
        issue: issueContext,
        normalizedBody: state.normalizedBody,
        output,
        latencyMs: Date.now() - startedAt,
        tokensIn: state.tokensIn,
        tokensOut: state.tokensOut,
      });

      counts[resolution] += 1;
      console.log(
        `#${issueContext.number} ${resolution.toUpperCase()} ${output.category} ${output.summary}`,
      );
    } catch (error) {
      const output = createFailureOutput(
        error instanceof Error ? error.message : String(error),
      );

      const resolution = await submitIssueReceipt({
        apiUrl,
        apiKey,
        deploymentId,
        privateKey,
        modelName: DEFAULT_MODEL,
        issue: issueContext,
        normalizedBody: normalizeIssueBody(issueContext.body),
        output,
        latencyMs: Date.now() - startedAt,
        tokensIn: 0,
        tokensOut: 0,
        errorReason: error instanceof Error ? error.message : String(error),
      });

      counts[resolution] += 1;
      console.error(
        `#${issueContext.number} FAILED ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const dashboardBase = apiUrl.replace(/\/$/, "");
  console.log(
    `Processed ${issues.length} issues: ${counts.success} success, ${counts.partial} partial, ${counts.failed} failed. View dashboard: ${dashboardBase}/d/${deploymentId}`,
  );
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});