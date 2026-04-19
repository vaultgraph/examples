# VaultGraph GitHub Triage Cookbook

This example uses LangChain and LangGraph to triage GitHub issues and submits one VaultGraph receipt per processed issue via the native `@vaultgraph/sdk/langchain` callback handler.

## What it does

- Takes a repo slug and a max issue count.
- Uses a GitHub token when available, or falls back to unauthenticated requests.
- Fetches the repo's real label set and newest open issues.
- Normalizes each issue body, keeps the first 3 comments, and runs a LangGraph triage flow.
- Classifies the issue, branches by category, optionally scores priority, suggests repo-native labels, writes a short summary, and self-scores confidence.
- Uses the native VaultGraph LangChain callback handler to submit one receipt per issue run, including failures.

## Install

```bash
cd cookbook/github-triage
npm install
```

## Required environment

The script loads `../../.env` automatically.

### Required

- `VAULTGRAPH_API_KEY`
- `VAULTGRAPH_DEPLOYMENT_ID`
- `VAULTGRAPH_PRIVATE_KEY`
- `OPENAI_API_KEY`

check [VaultGraph setup guide](https://vaultgraph.com/docs/setup) for details on how to get these.

### Optional

- `GITHUB_TOKEN` for authenticated GitHub API access.
- `TRIAGE_MODEL` to override the default model (`gpt-4.1-mini`).
- `GITHUB_TRIAGE_REPO` and `GITHUB_TRIAGE_MAX_ISSUES` if you do not want to pass CLI args.
- `GITHUB_TRIAGE_AUDIT_LOG` to override the audit log path, or set it to `off` to disable audit logging.

## Run

```bash
npm run start -- owner/repo 15
```

You can also set `GITHUB_TRIAGE_REPO` and `GITHUB_TRIAGE_MAX_ISSUES` in `.env` and run:

```bash
npm run start
```

## Output

For each issue, the script prints the derived category, resolution, and summary. At the end it prints a run summary and a deployment dashboard URL in the form `https://app.vaultgraph.com/d/dep_xxx`.

By default, the script also appends one JSON line per issue to `./logs/receipt-audit.jsonl` with:

- the stable `job_id`
- the issue reference
- the derived `context_hash`
- the exact `hashed_payload` string used to derive that hash

This is useful for internal verification demos where you want to show that a stored local log can reproduce the same hash ingested into the VaultGraph receipt.

Set `GITHUB_TRIAGE_AUDIT_LOG=off` if you want to disable this behavior.

## Structure

- `index.ts` - main flow and orchestration.
- `src/github.ts` - GitHub API access and issue shaping.
- `src/normalization.ts` - template boilerplate and code fences.
- `src/llm.ts` - structured model parsing.
- `src/graph.ts` - LangGraph state machine.
- `src/audit.ts` - a LangChain callback handler for local receipt-hash audit logs.
- `src/receipts.ts` - configures the native VaultGraph LangChain callback handler.

## Notes

- The receipt `job_id` is stable across reruns: `gh-owner-repo-issue-number`.
- Receipt submission now goes through `VaultGraphCallbackHandler`, not direct `submitSignedReceipt` calls.
- The SDK derives the receipt `context_hash` from the LangChain output; the cookbook only customizes job ID, metadata, and resolution.
- The optional audit log mirrors the handler's current hashing rule by storing `JSON.stringify(output).slice(0, 10000)` and its SHA-256 hash.
- GitHub pull requests are filtered out even though the issues API returns them.
- If any LLM step fails or returns invalid JSON, the script still submits a failed receipt for that issue.