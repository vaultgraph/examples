export type IssueCategory = "bug" | "feature" | "question" | "docs" | "noise";
export type IssuePriority = "critical" | "high" | "medium" | "low";
export type Resolution = "success" | "partial" | "failed";

export type RepoLabel = {
  name: string;
  description: string | null;
  color: string;
};

export type IssueComment = {
  author: string;
  createdAt: string;
  body: string;
};

export type IssueContext = {
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

export type ClassificationResult = {
  category: IssueCategory;
  rationale: string;
  confidence: number;
};

export type PriorityResult = {
  priority: IssuePriority;
  rationale: string;
};

export type LabelResult = {
  labels: string[];
  rationale: string;
};

export type SummaryResult = {
  summary: string;
  nextAction: string;
  confidence: number;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ReceiptOutput = {
  category: IssueCategory;
  priority: IssuePriority | null;
  labels: string[];
  summary: string;
  next_action: string;
  confidence: number;
};

export type TriageRunConfig = {
  apiUrl: string;
  apiKey: string;
  deploymentId: string;
  privateKey: string;
  openAIApiKey: string;
  owner: string;
  repo: string;
  maxIssues: number;
  modelName: string;
};