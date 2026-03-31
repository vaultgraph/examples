# VaultGraph Vercel AI SDK Example

This example wraps a Vercel AI SDK model with `@vaultgraph/sdk/ai` so every `generateText` call submits a signed JobReceipt to VaultGraph.

## Install

```bash
cd ai-sdk-agent
npm install
```

## Run

```bash
npm run start
```

The script loads `../.env` automatically.

If `OPENAI_API_KEY` is missing, the example falls back to a local model so you can still verify VaultGraph receipt submission.

## Notes

- `VAULTGRAPH_DEPLOYMENT_ID` must be a deployment short ID like `dep_...`.
- The matching public key must already be registered as an active signing key on that deployment.
- The example logs the stored VaultGraph receipt ID after submission.
