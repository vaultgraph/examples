import {
  VaultGraphCallbackHandler,
  type VaultGraphLangChainReceiptContext,
} from "@vaultgraph/sdk/langchain";
import { AGENT_VERSION } from "./config.js";
import type { IssueContext, ReceiptOutput, Resolution } from "./types.js";

type TriageOutputState = Partial<{
  classification: { category?: ReceiptOutput["category"] } | null;
  priority: ReceiptOutput["priority"];
  suggestedLabels: string[];
  summary: string;
  nextAction: string;
  confidence: number;
}>;

export function deriveResolution(confidence: number): Resolution {
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

function compactMetadata<T extends Record<string, unknown>>(metadata: T): T {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  ) as T;
}

function getIssueContext(context: VaultGraphLangChainReceiptContext): IssueContext | undefined {
  return context.inputs?.["issue"] as IssueContext | undefined;
}

function toReceiptOutput(output: unknown): ReceiptOutput {
  const state = (output ?? {}) as TriageOutputState;

  return {
    category: state.classification?.category ?? "noise",
    priority: state.priority ?? null,
    labels: state.suggestedLabels ?? [],
    summary: state.summary ?? "Issue triage failed.",
    next_action: state.nextAction ?? "Inspect metadata.error_reason and rerun the triage job.",
    confidence: state.confidence ?? 0,
  };
}

export function createVaultGraphHandler(options: {
  apiUrl: string;
  apiKey: string;
  deploymentId: string;
  privateKey: string;
  modelName: string;
}): VaultGraphCallbackHandler {
  return new VaultGraphCallbackHandler({
    apiUrl: options.apiUrl,
    apiKey: options.apiKey,
    deploymentId: options.deploymentId,
    privateKey: options.privateKey,
    deriveJobId: (_output, context) => {
      const issue = getIssueContext(context);
      return issue ? buildIssueJobId(issue) : `gh-unknown-issue-${context.runId ?? Date.now()}`;
    },
    deriveMetadata: (output, context) => {
      const issue = getIssueContext(context);
      const receiptOutput = toReceiptOutput(output);
      const errorReason = context.error instanceof Error
        ? context.error.message
        : typeof context.error === "string"
          ? context.error
          : context.error === undefined
            ? undefined
            : String(context.error);

      return compactMetadata({
        source: "langchain",
        workflow: "github-triage",
        event: context.event,
        runId: context.runId,
        model: options.modelName,
        agent_version: AGENT_VERSION,
        repo: issue ? `${issue.owner}/${issue.repo}` : undefined,
        issue_number: issue?.number,
        issue_url: issue?.issueUrl,
        output: receiptOutput,
        ...(errorReason ? { error_reason: errorReason } : {}),
      });
    },
    deriveResolution: (output, context) => {
      if (context.event === "chain_error") {
        return "failed";
      }

      return deriveResolution(toReceiptOutput(output).confidence);
    },
    onError: (error) => {
      console.error(`VaultGraph error: ${error.message}`);
    },
  });
}