# VaultGraph Examples

[VaultGraph](https://vaultgraph.com) is a trust and verification platform for AI agents. Your backend hashes sensitive context locally, signs a JobReceipt, and submits it to [VaultGraph Platform](https://app.vaultgraph.com). VaultGraph verifies the signature, stores the receipt, and surfaces audit history and trust scores for the agent deployment.

This repo contains example implementations of the [VaultGraph SDK](https://vaultgraph.com/docs/sdk) in various contexts, from a minimal direct integration to more complex [LangChain](https://vaultgraph.com/docs/integrations/langchain) and [Vercel AI SDK](https://vaultgraph.com/docs/integrations/ai-sdk) agents.

## Refer to official docs for more details

- [VaultGraph introduction](https://vaultgraph.com/docs)
- [Core concepts](https://vaultgraph.com/docs/concepts)
- [Setup guide](https://vaultgraph.com/docs/setup)
- [SDK docs](https://vaultgraph.com/docs/sdk)


## Included examples

- [vendor-app](./vendor-app): Minimal direct SDK flow that signs, verifies, and submits a receipt.
- [ai-sdk-agent](./ai-sdk-agent): Vercel AI SDK integration using `@vaultgraph/sdk/ai`.
- [langchain-agent](./langchain-agent): LangChain.js integration using `@vaultgraph/sdk/langchain`.
- [mcp-server](./mcp-server): MCP server minimal test and Claude Desktop config using `@vaultgraph/mcp-server`.

## Prerequisites

1. Create an account in the [VaultGraph Platform](https://app.vaultgraph.com).
2. Create a vendor API key, an agent, and a deployment. The full flow is in the [setup guide](https://docs.vaultgraph.com/docs/setup).
3. Register the matching Ed25519 public key as an active signing key on that deployment.
4. Copy `.env.example` to `.env` and fill in real values.

## Quick start

```bash
cp .env.example .env
cd vendor-app
npm install
npm run start
```

Each example loads `../.env`, so one root environment file is enough for the whole repo.
