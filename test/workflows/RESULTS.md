# E2E Test Results

> Last verified: UNVERIFIED — workflow added in polish pass.

## Prerequisites

Secret names shown below are illustrative — consumers can name
their secrets however they like. The fixed contract is the action
input names (`access-token`, `private-key`, `vault-id`).

| Credential               | Env var               | Source                                                 |
| ------------------------ | --------------------- | ------------------------------------------------------ |
| ForDefi JWT access token | `FORDEFI_API_TOKEN`   | ForDefi console — Settings -> API Users -> create user |
| PEM P-256 signing key    | `FORDEFI_PRIVATE_KEY` | Generated locally and registered on the API user       |

The private key is only required for transactional commands
(`create-vault`, `create-vault-address`, `create-transaction`,
`create-transfer`, `create-swap`, `approve-transaction`,
`abort-transaction`). Read-only commands (`list-vaults`,
`get-vault`, `list-vault-assets`, `list-blockchains`,
`get-suggested-fees`, `predict-transaction`, `get-transaction`,
`list-transactions`, `get-swap-quotes`) only need the access
token.

The E2E workflow assumes the API user has at least one existing
vault. Provision a vault in the ForDefi console before running.

## Results

| #   | Step                          | Command               | Status     | Notes                              |
| --- | ----------------------------- | --------------------- | ---------- | ---------------------------------- |
| 1   | List vaults                   | `list-vaults`         | UNVERIFIED |                                    |
| 2   | Get the vault                 | `get-vault`           | UNVERIFIED |                                    |
| 3   | List vault assets             | `list-vault-assets`   | UNVERIFIED |                                    |
| 4   | List supported blockchains    | `list-blockchains`    | UNVERIFIED |                                    |
| 5   | Get suggested fees            | `get-suggested-fees`  | UNVERIFIED |                                    |
| 6   | Predict a transaction         | `predict-transaction` | UNVERIFIED | Zero-value EVM tx as a probe       |
| 7   | Create a transaction          | `create-transaction`  | UNVERIFIED | Requires signing key               |
| 8   | Get the transaction           | `get-transaction`     | UNVERIFIED |                                    |
| 9   | List transactions for vault   | `list-transactions`   | UNVERIFIED |                                    |
| 10  | Abort the pending transaction | `abort-transaction`   | UNVERIFIED | Cleanup — leaves vault state clean |

**Summary: 0/10 verified (newly added).**

## Skipped Commands

| Command                           | Reason                                         |
| --------------------------------- | ---------------------------------------------- |
| `create-vault`                    | Requires elevated org permission to provision  |
| `create-vault-address`            | Requires a fresh vault to avoid address sprawl |
| `create-transfer`                 | Funded vault required; covered conceptually by |
|                                   | create-transaction                             |
| `approve-transaction`             | Requires multi-approver policy setup           |
| `get-swap-quotes` / `create-swap` | Requires funded vault and swap-enabled chain   |

## How to run

```bash
# Export credentials
export FORDEFI_API_TOKEN="your-jwt-here"
export FORDEFI_PRIVATE_KEY="$(cat path/to/fordefi-private.pem)"

# Run
w3 workflow test --execute test/workflows/e2e.yaml
```
