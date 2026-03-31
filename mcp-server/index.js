import dotenv from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "module";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDir, "../.env"), quiet: true });

const apiKey = process.env.VAULTGRAPH_API_KEY;
const deploymentId = process.env.VAULTGRAPH_DEPLOYMENT_ID;
const privateKey = process.env.VAULTGRAPH_PRIVATE_KEY;
const apiUrl = process.env.VAULTGRAPH_API_URL ?? "https://app.vaultgraph.com";

if (!apiKey || !deploymentId || !privateKey) {
  console.error(
    "Set VAULTGRAPH_API_KEY, VAULTGRAPH_DEPLOYMENT_ID, and VAULTGRAPH_PRIVATE_KEY.",
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve("@vaultgraph/mcp-server/package.json");
const serverEntry = join(dirname(packageJsonPath), "dist", "index.js");
const jobId = `mcp-server-example-${Date.now()}`;

function toStringEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined),
  );
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: {
    ...toStringEnv(process.env),
    VAULTGRAPH_API_URL: apiUrl,
    VAULTGRAPH_API_KEY: apiKey,
    VAULTGRAPH_DEPLOYMENT_ID: deploymentId,
    VAULTGRAPH_PRIVATE_KEY: privateKey,
  },
  stderr: "pipe",
});

if (transport.stderr) {
  transport.stderr.on("data", (chunk) => {
    const line = String(chunk).trim();
    if (line) {
      console.error("[mcp-server]", line);
    }
  });
}

const client = new Client({ name: "vaultgraph-mcp-example", version: "1.0.0" });

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log("Available tools:", tools.map((tool) => tool.name).join(", "));

  const result = await client.callTool({
    name: "submit_receipt",
    arguments: {
      job_id: jobId,
      resolution: "success",
      context: "Smoke test receipt submitted from the public MCP example.",
    },
  });

  const text = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

  console.log("Job ID:", jobId);
  console.log("Tool response:", text);
} catch (error) {
  console.error(
    "demo failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
