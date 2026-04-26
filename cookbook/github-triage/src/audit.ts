import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { VaultGraphCallbackHandlerOptions, VaultGraphLangChainReceiptContext } from "@vaultgraph/sdk/langchain";
import type { IssueContext } from "./types.js";

type AuditLogCallback = NonNullable<VaultGraphCallbackHandlerOptions["onReceiptSigned"]>;

function getIssueFromExecutionContext(
  context: VaultGraphLangChainReceiptContext,
): IssueContext | undefined {
  return context.inputs?.["issue"] as IssueContext | undefined;
}

function getErrorReason(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error === undefined) {
    return undefined;
  }

  return String(error);
}

async function appendAuditLog(
  filePath: string,
  event: Parameters<AuditLogCallback>[0],
): Promise<void> {
  const issue = getIssueFromExecutionContext(event.executionContext);
  const errorReason = getErrorReason(event.executionContext.error);
  const line = JSON.stringify({
    stored_at: new Date().toISOString(),
    job_id: event.receipt.job_id,
    repo: issue ? `${issue.owner}/${issue.repo}` : undefined,
    issue_number: issue?.number,
    issue_url: issue?.issueUrl,
    resolution: event.receipt.resolution,
    event: event.executionContext.event,
    run_id: event.executionContext.runId,
    context_hash: event.contextHash,
    context_payload: event.contextPayload,
    ...(errorReason ? { error_reason: errorReason } : {}),
  });

  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${line}\n`, "utf8");
}

export function createAuditLogCallback(filePath?: string): AuditLogCallback | undefined {
  if (!filePath) {
    return undefined;
  }

  return async (event: Parameters<AuditLogCallback>[0]) => appendAuditLog(filePath, event);
}