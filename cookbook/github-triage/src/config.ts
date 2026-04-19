import type { TriageRunConfig } from "./types.js";

export const AGENT_VERSION = "1.0.0";

const DEFAULT_MAX_ISSUES = 15;
const DEFAULT_MODEL = "gpt-4.1-mini";

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

export function getRunConfig(argv: string[] = process.argv): TriageRunConfig {
  const repoSlug = argv[2] ?? process.env["GITHUB_TRIAGE_REPO"];
  const { owner, repo } = parseRepoSlug(repoSlug);

  return {
    apiUrl: process.env["VAULTGRAPH_API_URL"] ?? "https://app.vaultgraph.com",
    apiKey: requireEnv("VAULTGRAPH_API_KEY"),
    deploymentId: requireEnv("VAULTGRAPH_DEPLOYMENT_ID"),
    privateKey: requireEnv("VAULTGRAPH_PRIVATE_KEY"),
    openAIApiKey: requireEnv("OPENAI_API_KEY"),
    owner,
    repo,
    maxIssues: parseMaxIssues(argv[3] ?? process.env["GITHUB_TRIAGE_MAX_ISSUES"]),
    modelName: process.env["TRIAGE_MODEL"] ?? DEFAULT_MODEL,
  };
}

export function buildDashboardUrl(apiUrl: string, deploymentId: string): string {
  return `${apiUrl.replace(/\/$/, "")}/d/${deploymentId}`;
}