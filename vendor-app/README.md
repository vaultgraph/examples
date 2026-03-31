# VaultGraph SDK Vendor App Example

This is the smallest direct integration example for `@vaultgraph/sdk`.

It creates a signed receipt, verifies that signature locally, and then submits the receipt to VaultGraph.

## Install

```bash
cd vendor-app
npm install
```

## Run

```bash
npm run start
```

The script loads `../.env` automatically.

## Notes

- `VAULTGRAPH_JOB_ID` is optional. If omitted, the example generates one.
- The example logs the verified flag and the persisted VaultGraph receipt ID.
- The private key must correspond to an active deployment signing key.
