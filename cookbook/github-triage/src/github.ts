import { Octokit } from "@octokit/rest";
import { normalizeCommentBody } from "./normalization.js";
import type { IssueContext, RepoLabel } from "./types.js";

type GitHubIssueListItem = {
  number: number;
  html_url: string;
  title: string;
  body?: string | null;
  created_at: string;
  comments: number;
  labels: Array<string | { name?: string | null }>;
  user: { login: string } | null;
  pull_request?: unknown;
};

export function createGitHubClient(): { octokit: Octokit; authMode: string } {
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

export async function fetchRepoLabels(
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

export async function fetchOpenIssues(
  octokit: Octokit,
  owner: string,
  repo: string,
  maxIssues: number,
): Promise<GitHubIssueListItem[]> {
  const issues: GitHubIssueListItem[] = [];
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

    for (const issue of response.data) {
      if (issue.pull_request) {
        continue;
      }

      issues.push(issue);

      if (issues.length >= maxIssues) {
        break;
      }
    }

    page += 1;
  }

  return issues.slice(0, maxIssues);
}

// Build one normalized payload per issue so the graph receives a stable input shape.
export async function buildIssueContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  issue: GitHubIssueListItem,
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
      body: normalizeCommentBody(comment.body ?? ""),
    })),
  };
}