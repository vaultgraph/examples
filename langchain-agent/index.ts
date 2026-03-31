import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { VaultGraphCallbackHandler } from "@vaultgraph/sdk/langchain";
import { ChatOpenAI } from "@langchain/openai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableLambda } from "@langchain/core/runnables";

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

const exampleRunPrefix = `langchain-example-${Date.now()}`;
let lastSubmittedJobId: string | undefined;
let receiptId: string | undefined;

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

const handler = new VaultGraphCallbackHandler({
  apiKey,
  apiUrl,
  deploymentId,
  privateKey,
  deriveJobId: (_output, context) => {
    const suffix = context.runId ?? `${Date.now()}`;
    const jobId = `${exampleRunPrefix}:${suffix}`;
    lastSubmittedJobId = jobId;
    return jobId;
  },
  deriveMetadata: (output, context) => ({
    source: "langchain",
    workflow: "support-bot",
    event: context.event,
    runId: context.runId,
    preview: JSON.stringify(output).slice(0, 64),
    example: "public-examples",
  }),
  deriveResolution: (output) => {
    const serializedOutput = JSON.stringify(output).toLowerCase();

    if (serializedOutput.includes("partial")) return "partial";
    if (
      serializedOutput.includes("fail") ||
      serializedOutput.includes("error")
    ) {
      return "failed";
    }

    return "success";
  },
  fetchImpl: loggedReceiptFetch,
  onError: (err: Error) => console.error("VaultGraph error:", err.message),
});

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{question}"],
]);

const result = openAIApiKey
  ? await prompt
      .pipe(new ChatOpenAI({ model: "gpt-4o", apiKey: openAIApiKey }))
      .pipe(new StringOutputParser())
      .invoke({ question: "What is VaultGraph?" }, { callbacks: [handler] })
  : await prompt
      .pipe(
        RunnableLambda.from(async (input) => {
          const serializedInput = JSON.stringify(input);

          return [
            "VaultGraph is a trust and verification platform for AI agents.",
            "This example is using a fallback LangChain runnable because OPENAI_API_KEY is not set.",
            `Prompt preview: ${serializedInput.slice(0, 120)}`,
          ].join(" ");
        }),
      )
      .invoke({ question: "What is VaultGraph?" }, { callbacks: [handler] });

console.log("Response:", result);
if (lastSubmittedJobId) {
  console.log("Submitted job:", lastSubmittedJobId);
}
if (receiptId) {
  console.log("Receipt stored as:", receiptId);
}
