import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  classificationSchema,
  invokeStructuredStep,
  labelSchema,
  prioritySchema,
  summarySchema,
} from "./llm.js";
import { normalizeIssueBody } from "./normalization.js";
import type {
  ClassificationResult,
  IssueContext,
  IssuePriority,
  ReceiptOutput,
  RepoLabel,
} from "./types.js";

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

export type TriageState = typeof TriageStateAnnotation.State;

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

function deriveConfidence(state: TriageState): number {
  const issueText = `${state.issue.title}\n${state.normalizedBody}`.toLowerCase();
  const commentText = state.issue.comments.map((comment) => comment.body.toLowerCase()).join("\n");
  const currentLabels = new Set(state.issue.currentLabels.map((label) => label.toLowerCase()));
  const labelMatches = state.suggestedLabels.filter((label) => currentLabels.has(label.toLowerCase())).length;
  const hasReproducer = /steps to reproduce|repro|reproduction|minimal|example code|stack trace|traceback|```/.test(issueText);
  const hasVersion = /\bversion\b|langgraph-api==|langgraph\s+\d|python\s+\d|node\s+\d|macos|windows|linux/.test(issueText);
  const commentsAgree = /same issue|same problem|also seeing|also happens|confirmed|can reproduce|reproduced/.test(commentText);
  const score = 0.35
    + (hasReproducer ? 0.2 : 0)
    + (hasVersion ? 0.15 : 0)
    + (commentsAgree ? 0.1 : 0)
    + Math.min(labelMatches, 2) * 0.1;

  return Math.max(0.1, Math.min(0.95, Math.round(score * 100) / 100));
}

export function createInitialTriageState(
  issue: IssueContext,
  availableLabels: RepoLabel[],
): TriageState {
  return {
    issue,
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
  };
}

export function buildReceiptOutput(state: TriageState): ReceiptOutput {
  return {
    category: state.classification?.category ?? "noise",
    priority: state.priority,
    labels: state.suggestedLabels,
    summary: state.summary,
    next_action: state.nextAction,
    confidence: state.confidence,
  };
}

export function createFailureOutput(): ReceiptOutput {
  return {
    category: "noise",
    priority: null,
    labels: [],
    summary: "Issue triage failed.",
    next_action: "Inspect metadata.error_reason and rerun the triage job.",
    confidence: 0,
  };
}

export function createTriageGraph(model: ChatOpenAI) {
  const normalizeIssue = async (state: TriageState) => ({
    normalizedBody: normalizeIssueBody(state.issue.body),
  });

  const classifyIssue = async (state: TriageState) => {
    const result = await invokeStructuredStep({
      model,
      schema: classificationSchema,
      systemPrompt:
        "You triage GitHub issues. Return only JSON. Choose exactly one category: bug, feature, question, docs, or noise. Noise means spam, wrong repo, incomprehensible, or chatter. Keep the rationale qualitative and grounded in the issue text.",
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
    confidence: deriveConfidence(state),
  });

  const summarizeIssue = async (state: TriageState) => {
    const result = await invokeStructuredStep({
      model,
      schema: summarySchema,
      systemPrompt:
        "You write concise GitHub triage summaries. Return only JSON. The summary must be one line and skimmable. The nextAction must be a short human action, not a paragraph.",
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
      confidence: deriveConfidence(state),
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