# VaultGraph LangChain.js Example

This example uses `@vaultgraph/sdk/langchain` to submit a receipt automatically when a LangChain run completes.

## Install

```bash
cd langchain-agent
npm install
```

## Run

```bash
npm run start
```

The script loads `../.env` automatically.

If `OPENAI_API_KEY` is missing, the example falls back to a local runnable so you can still validate VaultGraph ingestion.

## Notes

- The handler submits only for the top-level run by default.
- The example logs both the derived VaultGraph job ID and the stored receipt ID.
- `VAULTGRAPH_DEPLOYMENT_ID` must point at a deployment with an active matching signing key.
