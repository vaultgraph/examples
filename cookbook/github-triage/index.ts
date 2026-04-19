import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import { createAuditLogCallbackHandler } from "./src/audit.js";
import { buildDashboardUrl, getRunConfig } from "./src/config.js";
import {
  buildIssueContext,
  createGitHubClient,
  fetchOpenIssues,
  fetchRepoLabels,
} from "./src/github.js";
import {
  buildReceiptOutput,
  createInitialTriageState,
  createTriageGraph,
} from "./src/graph.js";
import {
  createVaultGraphHandler,
  deriveResolution,
} from "./src/receipts.js";
import type { Resolution } from "./src/types.js";

const exampleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(exampleDir, "../../.env"), quiet: true });

async function main() {
  const config = getRunConfig();
  const { octokit, authMode } = createGitHubClient();
  const model = new ChatOpenAI({
    apiKey: config.openAIApiKey,
    model: config.modelName,
    temperature: 0,
  });
  const triageGraph = createTriageGraph(model);
  const auditLogHandler = createAuditLogCallbackHandler(config.auditLogPath);
  const vaultGraphHandler = createVaultGraphHandler({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    deploymentId: config.deploymentId,
    privateKey: config.privateKey,
    modelName: config.modelName,
  });

  console.log(`GitHub auth mode: ${authMode}.`);
  console.log(
    `Fetching labels and up to ${config.maxIssues} open issues from ${config.owner}/${config.repo}.`,
  );

  // Load repo-level context first so every issue can reuse the same label catalog.
  const availableLabels = await fetchRepoLabels(octokit, config.owner, config.repo);
  const issues = await fetchOpenIssues(octokit, config.owner, config.repo, config.maxIssues);

  console.log(`Loaded ${availableLabels.length} labels and ${issues.length} issues for triage.`);

  const counts: Record<Resolution, number> = {
    success: 0,
    partial: 0,
    failed: 0,
  };

  for (const issue of issues) {
    const issueContext = await buildIssueContext(octokit, config.owner, config.repo, issue);

    try {
      // Each issue gets its own graph run so the resulting VaultGraph receipt stays idempotent.
      const state = await triageGraph.invoke(
        createInitialTriageState(issueContext, availableLabels),
        { callbacks: [vaultGraphHandler, auditLogHandler] },
      );
      const output = buildReceiptOutput(state);
      const resolution = deriveResolution(output.confidence);

      counts[resolution] += 1;
      console.log(
        `#${issueContext.number} ${resolution.toUpperCase()} ${output.category} ${output.summary}`,
      );
    } catch (error) {
      const errorReason = error instanceof Error ? error.message : String(error);

      counts.failed += 1;
      console.error(`#${issueContext.number} FAILED ${errorReason}`);
    }
  }

  console.log(
    `Processed ${issues.length} issues: ${counts.success} success, ${counts.partial} partial, ${counts.failed} failed. View dashboard: ${buildDashboardUrl(config.apiUrl, config.deploymentId)}`,
  );
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});