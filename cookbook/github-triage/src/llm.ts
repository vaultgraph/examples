import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import type { TokenUsage } from "./types.js";

export const classificationSchema = z.object({
  category: z.enum(["bug", "feature", "question", "docs", "noise"]),
  rationale: z.string().min(1).default("Model omitted classification rationale."),
  confidence: z.coerce.number().min(0).max(1).default(0.5),
});

export const prioritySchema = z.object({
  priority: z.enum(["critical", "high", "medium", "low"]),
  rationale: z.string().min(1).default("Model omitted priority rationale."),
});

export const labelSchema = z.object({
  labels: z.array(z.string()).max(3),
  rationale: z.string().min(1).default("Model omitted label rationale."),
});

export const summarySchema = z.object({
  summary: z.string().min(1).max(160),
  nextAction: z.string().min(1).max(200),
  confidence: z.coerce.number().min(0).max(1).default(0.5),
});

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

// Models occasionally wrap JSON in fences or surrounding prose, so strip that first.
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
  const tokenUsage = (message.response_metadata as {
    tokenUsage?: { promptTokens?: number; completionTokens?: number };
  } | undefined)?.tokenUsage;

  return {
    inputTokens: usageMetadata?.input_tokens ?? tokenUsage?.promptTokens ?? 0,
    outputTokens: usageMetadata?.output_tokens ?? tokenUsage?.completionTokens ?? 0,
  };
}

// Invoke a model with a system and user prompt, expecting a structured JSON response that conforms to the provided Zod schema.
// Returns the parsed data and token usage.
export async function invokeStructuredStep<TSchema extends z.ZodTypeAny>(options: {
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