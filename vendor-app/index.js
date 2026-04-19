import dotenv from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  derivePublicKeyPem,
  prepareReceiptContext,
  submitSignedReceipt,
  verifyReceipt,
} from "@vaultgraph/sdk";

const scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDir, "../.env"), quiet: true });

const config = {
  apiUrl: process.env.VAULTGRAPH_API_URL ?? "https://app.vaultgraph.com",
  apiKey: process.env.VAULTGRAPH_API_KEY,
  privateKey: process.env.VAULTGRAPH_PRIVATE_KEY,
  deploymentId: process.env.VAULTGRAPH_DEPLOYMENT_ID,
  jobId: process.env.VAULTGRAPH_JOB_ID ?? `vendor-app-example-${Date.now()}`,
};

async function main() {
  if (!config.apiKey || !config.privateKey || !config.deploymentId) {
    throw new Error(
      "Set VAULTGRAPH_API_KEY, VAULTGRAPH_DEPLOYMENT_ID, and VAULTGRAPH_PRIVATE_KEY.",
    );
  }

  const preparedContext = prepareReceiptContext({ transcript: "vendor-app demo" });

  const { receipt, signature, response } = await submitSignedReceipt({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    deploymentId: config.deploymentId,
    jobId: config.jobId,
    resolution: "success",
    contextHash: preparedContext.contextHash,
    metadata: {
      source: "vendor-app",
      workflow: "support-ticket-demo",
      example: "public-examples",
    },
    privateKey: config.privateKey,
  });

  const isVerified = verifyReceipt({
    receipt,
    signature,
    publicKey: derivePublicKeyPem(config.privateKey),
  });

  console.log("Job ID:", config.jobId);
  console.log("Receipt verified locally:", isVerified);
  console.log("Receipt stored as:", response.id);
}

await main().catch((error) => {
  console.error(
    "demo failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
