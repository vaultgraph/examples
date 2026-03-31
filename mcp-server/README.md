# VaultGraph MCP Server Example

This folder contains both a Claude Desktop configuration example and a runnable smoke test that talks to the published `@vaultgraph/mcp-server` package over stdio.

The current published `@vaultgraph/mcp-server@0.1.3` release still references `@vaultgraph/sdk` as `workspace:*`. This example includes an `npm overrides` entry so external installs resolve the published SDK correctly.

## Install

```bash
cd mcp-server
npm install
```

## Run the smoke test

```bash
npm run start
```

The demo starts the published MCP server, lists available tools, and calls `submit_receipt`.

## Claude Desktop

Use the provided `claude_desktop_config.json` as a starting point.

## Notes

- The demo loads `../.env` automatically.
- The private key must match an active deployment signing key.
- The tool response includes the stored VaultGraph receipt ID.
