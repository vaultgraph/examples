import { hashContext, submitSignedReceipt } from "@vaultgraph/sdk";
import { AGENT_VERSION } from "./config.js";
import type { IssueContext, ReceiptOutput, Resolution } from "./types.js";

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

export async function submitIssueReceipt(options: {
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

  // The current SDK runtime accepts these fields even though the bundled d.ts is narrower.
  await submitSignedReceipt(receiptOptions as any);

  return resolution;
}