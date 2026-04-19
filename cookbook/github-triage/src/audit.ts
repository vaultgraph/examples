import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { ChainValues } from "@langchain/core/utils/types";
import { hashContext } from "@vaultgraph/sdk";
import type { IssueContext, Resolution } from "./types.js";
import { buildIssueJobId, deriveResolution } from "./receipts.js";

const HANDLER_CONTEXT_LIMIT = 10_000;

type AuditLogEntry = {
  jobId: string;
  issue: IssueContext;
  resolution: Resolution;
  output: unknown;
};

type TriageOutputState = Partial<{
  confidence: number;
}>;

// Mirror the current native VaultGraph LangChain handler so internal audit logs
// can reproduce the same context hash that ends up in the ingested receipt.
export function serializeHandlerContext(output: unknown): string {
  return JSON.stringify(output).slice(0, HANDLER_CONTEXT_LIMIT);
}

export function deriveHandlerContextHash(output: unknown): string {
  return hashContext(serializeHandlerContext(output));
}

async function appendAuditLog(filePath: string, entry: AuditLogEntry): Promise<void> {
  const serializedContext = serializeHandlerContext(entry.output);
  const line = JSON.stringify({
    stored_at: new Date().toISOString(),
    job_id: entry.jobId,
    repo: `${entry.issue.owner}/${entry.issue.repo}`,
    issue_number: entry.issue.number,
    issue_url: entry.issue.issueUrl,
    resolution: entry.resolution,
    context_hash: deriveHandlerContextHash(entry.output),
    hashed_payload: serializedContext,
  });

  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${line}\n`, "utf8");
}

function getIssueFromInputs(inputs?: Record<string, unknown>): IssueContext | undefined {
  return inputs?.["issue"] as IssueContext | undefined;
}

function getResolutionFromOutput(output: unknown): Resolution {
  const state = (output ?? {}) as TriageOutputState;
  return deriveResolution(state.confidence ?? 0);
}

export function createAuditLogCallbackHandler(filePath?: string) {
  if (!filePath) {
    return new (class extends BaseCallbackHandler {
      name = "AuditLogCallbackHandler";

      constructor() {
        super({ _awaitHandler: true });
      }
    })();
  }

  return new (class extends BaseCallbackHandler {
    name = "AuditLogCallbackHandler";
    private issueByRunId = new Map<string, IssueContext>();

    constructor() {
      super({ _awaitHandler: true });
    }

    async handleChainStart(
      _chain: Serialized,
      inputs: ChainValues,
      runId: string,
      parentRunId?: string,
    ) {
      if (parentRunId) {
        return;
      }

      const issue = getIssueFromInputs(inputs);
      if (issue) {
        this.issueByRunId.set(runId, issue);
      }
    }

    async handleChainEnd(
      output: ChainValues,
      runId?: string,
      parentRunId?: string,
      _tags?: string[],
      kwargs?: { inputs?: Record<string, unknown> },
    ) {
      if (parentRunId) {
        return;
      }

      const issue = (runId ? this.issueByRunId.get(runId) : undefined)
        ?? getIssueFromInputs(kwargs?.inputs);
      if (!issue) {
        return;
      }

      await appendAuditLog(filePath, {
        jobId: buildIssueJobId(issue),
        issue,
        resolution: getResolutionFromOutput(output),
        output,
      });

      if (runId) {
        this.issueByRunId.delete(runId);
      }
    }

    async handleChainError(
      _error?: unknown,
      runId?: string,
      parentRunId?: string,
      _tags?: string[],
      kwargs?: { inputs?: Record<string, unknown> },
    ) {
      if (parentRunId) {
        return;
      }

      const issue = (runId ? this.issueByRunId.get(runId) : undefined)
        ?? getIssueFromInputs(kwargs?.inputs);
      if (!issue) {
        return;
      }

      await appendAuditLog(filePath, {
        jobId: buildIssueJobId(issue),
        issue,
        resolution: "failed",
        output: {},
      });

      if (runId) {
        this.issueByRunId.delete(runId);
      }
    }
  })();
}