import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { vaultgraph } from "@vaultgraph/sdk/ai";
import { generateText, type LanguageModelV1, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";

const exampleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(exampleDir, "../.env"), quiet: true });

const apiKey = process.env["VAULTGRAPH_API_KEY"];
const apiUrl =
  process.env["VAULTGRAPH_API_URL"] ?? "https://app.vaultgraph.com";
const deploymentId = process.env["VAULTGRAPH_DEPLOYMENT_ID"];
const privateKey = process.env["VAULTGRAPH_PRIVATE_KEY"];
const openAIApiKey = process.env["OPENAI_API_KEY"];

if (!apiKey || !deploymentId || !privateKey) {
  console.error(
    "Set VAULTGRAPH_API_KEY, VAULTGRAPH_DEPLOYMENT_ID, and VAULTGRAPH_PRIVATE_KEY.",
  );
  process.exit(1);
}

const requestId = `ai-sdk-example-${Date.now()}`;
let receiptId: string | undefined;

function buildFallbackText() {
  return [
    "VaultGraph is a trust and verification platform for AI agents.",
    "This example is using a fallback AI SDK model because OPENAI_API_KEY is not set.",
    "The VaultGraph middleware still wraps the call and submits a JobReceipt.",
  ].join(" ");
}

async function loggedReceiptFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  const response = await fetch(input, init);
  const payload = await safeReadJson(response);

  if (response.ok && payload && typeof payload.id === "string") {
    receiptId = payload.id;
    console.log("VaultGraph receipt response:", JSON.stringify(payload));
  }

  return response;
}

async function safeReadJson(
  response: Response,
): Promise<{ id?: string } | null> {
  try {
    return (await response.clone().json()) as { id?: string };
  } catch {
    return null;
  }
}

const fallbackModel: LanguageModelV1 = {
  specificationVersion: "v1",
  provider: "vaultgraph-local",
  modelId: "fallback-local-model",
  defaultObjectGenerationMode: "json",
  supportsImageUrls: false,
  supportsStructuredOutputs: false,
  async doGenerate(options) {
    const text = buildFallbackText();

    return {
      text,
      finishReason: "stop",
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: {},
      },
      response: {
        id: "fallback-response",
        timestamp: new Date(),
        modelId: "fallback-local-model",
      },
      warnings: [],
    };
  },
  async doStream(options) {
    const text = buildFallbackText();

    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "response-metadata",
            id: "fallback-response",
            timestamp: new Date(),
            modelId: "fallback-local-model",
          });
          controller.enqueue({ type: "text-delta", textDelta: text });
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: {
              promptTokens: 0,
              completionTokens: 0,
            },
          });
          controller.close();
        },
      }),
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: {},
      },
      response: {
        id: "fallback-response",
        timestamp: new Date(),
        modelId: "fallback-local-model",
      },
      warnings: [],
    };
  },
};

const middleware = vaultgraph({
  apiKey,
  apiUrl,
  deploymentId,
  privateKey,
  deriveJobId: ({ type }) => `${requestId}:${type}`,
  deriveMetadata: ({ type }) => ({
    source: "ai-sdk",
    runType: type,
    workflow: "support-assistant",
    example: "public-examples",
  }),
  deriveResolution: ({ error }) => (error ? "failed" : "success"),
  fetchImpl: loggedReceiptFetch,
  onError: (err: Error) => console.error("VaultGraph error:", err.message),
});

const model = wrapLanguageModel({
  model: openAIApiKey ? openai("gpt-4o") : fallbackModel,
  middleware,
});

const { text } = await generateText({
  model,
  prompt: "What is VaultGraph?",
});

console.log("Response:", text);
console.log("Submitted job:", `${requestId}:generate`);
if (receiptId) {
  console.log("Receipt stored as:", receiptId);
}
