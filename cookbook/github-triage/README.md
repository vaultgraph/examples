# VaultGraph GitHub Triage Cookbook

This example uses LangChain and LangGraph to triage GitHub issues and submits one VaultGraph receipt per processed issue via the native `@vaultgraph/sdk/langchain` callback handler.

## What it does

- Takes a repo slug, a max issue count, and an optional skip count.
- Uses a GitHub token when available, or falls back to unauthenticated requests.
- Fetches the repo's real label set and newest open issues.
- Normalizes each issue body, keeps the first 3 comments, and runs a LangGraph triage flow.
- Classifies the issue, branches by category, optionally scores priority, suggests repo-native labels, writes a short summary, and derives confidence from observable issue signals in code.
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

See [VaultGraph setup guide](https://vaultgraph.com/docs/setup) for details on how to get these.

### Optional

- `GITHUB_TOKEN` for authenticated GitHub API access.
- `TRIAGE_MODEL` to override the default model (`gpt-4.1-mini`).
- `GITHUB_TRIAGE_REPO`, `GITHUB_TRIAGE_MAX_ISSUES`, and `GITHUB_TRIAGE_SKIP_ISSUES` if you do not want to pass CLI args.
- `GITHUB_TRIAGE_AUDIT_LOG` to override the audit log path, or set it to `off` to disable audit logging.

## Run

```bash
npm run start -- owner/repo 15
```

To skip the newest issues and run against a later subset:

```bash
npm run start -- owner/repo 15 30
```

You can also set `GITHUB_TRIAGE_REPO`, `GITHUB_TRIAGE_MAX_ISSUES`, and optionally `GITHUB_TRIAGE_SKIP_ISSUES` in `.env` and run:

```bash
npm run start
```

## Output

For each issue, the script prints a compact status line such as `✓ issue #7548: bug/medium (confidence 0.70)`, showing the derived receipt resolution, category, priority, and confidence. At the end it prints a run summary with success, partial, and failed counts plus the configured deployment ID and API URL.

By default, the script also appends one JSON line per issue to `./logs/receipt-audit.jsonl` with:

- the stable `job_id`
- the issue reference
- the derived `context_hash`
- the exact `hashed_payload` string emitted by VaultGraph when the receipt is signed

This is useful for internal verification demos where you want to persist the exact normalized payload that VaultGraph hashed locally before the receipt was submitted.

Set `GITHUB_TRIAGE_AUDIT_LOG=off` if you want to disable this behavior.

## Structure

- `index.ts` - main flow and orchestration.
- `src/github.ts` - GitHub API access and issue shaping.
- `src/normalization.ts` - template boilerplate and code fences.
- `src/llm.ts` - structured model parsing.
- `src/graph.ts` - LangGraph state machine.
- `src/audit.ts` - local logging for signed receipt context payloads.
- `src/receipts.ts` - configures the native VaultGraph LangChain callback handler.

## Notes

- The receipt `job_id` is stable across reruns: `gh-owner-repo-issue-number`.
- Receipt submission now goes through `VaultGraphCallbackHandler`, not direct `submitSignedReceipt` calls.
- The SDK derives the receipt `context_hash` from the LangChain execution context via `prepareReceiptContext`; the cookbook only customizes job ID, metadata, resolution, and optional audit persistence.
- The optional audit log is written from `onReceiptSigned(...)` and stores the exact `contextPayload` and `contextHash` emitted by the SDK.
- Confidence is derived in code from observable signals such as repro detail, version or environment detail, corroborating comments, and overlap with existing labels.
- GitHub pull requests are filtered out even though the issues API returns them.
- If any LLM step fails or returns invalid JSON, the script still submits a failed receipt for that issue.