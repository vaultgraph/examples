import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { resolveAuditLogPath } from "./src/config.js";

const exampleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(exampleDir, "../../.env"), quiet: true });

type AuditRow = {
  context_hash?: string;
  context_payload?: string;
};

const expectedHash = process.argv[2];
const lines = readFileSync(resolveAuditLogPath(), "utf8").trim().split("\n");
const row = lines
  .map((line) => JSON.parse(line) as AuditRow)
  .find(({ context_hash }) => context_hash === expectedHash);
const computed = row?.context_payload
  ? createHash("sha256").update(row.context_payload, "utf8").digest("hex")
  : "";
const ok = computed === expectedHash;

console.log(ok ? "✓ match" : "✗ MISMATCH");
process.exitCode = ok ? 0 : 1;