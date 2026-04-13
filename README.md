# W3 ForDefi Action

MPC-secured custody, multi-chain transactions, swaps, and Wallet-as-a-Service via [ForDefi](https://fordefi.com).

ForDefi (acquired by Paxos, Nov 2025) provides institutional-grade MPC custody across 10+ blockchain families — EVM, Solana, Bitcoin, Cosmos, Sui, Aptos, and more — with sub-second signing, policy-based approval workflows, transaction simulation, and AML screening.

## Quick Start

```yaml
- uses: w3-io/w3-fordefi-action@v0
  with:
    command: list-vaults
    access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
```

## Authentication

ForDefi uses two-layer auth:

1. **Access token** (all requests) — JWT from API User creation in the ForDefi web console. Required for every command.
2. **Private key** (transactional operations) — PEM-encoded P-256 key for ECDSA request signing. Required for creating transactions, contacts, vaults, etc.

```yaml
- uses: w3-io/w3-fordefi-action@v0
  with:
    command: create-transaction
    access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
    private-key: ${{ secrets.FORDEFI_PRIVATE_KEY }}
    data: |
      {
        "vault_id": "...",
        "type": "evm_transaction",
        "details": { ... }
      }
```

## Commands (71)

| Category                   | Commands                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vaults** (13)            | `list-vaults`, `create-vault`, `get-vault`, `get-vault-asset`, `list-vault-assets`, `submit-vault-proposal`, `archive-vault`, `restore-vault`, `rename-vault`, `create-vault-address`, `list-vault-addresses`, `rename-vault-address`, `export-vaults`                                      |
| **Transactions** (13)      | `list-transactions`, `get-transaction`, `create-transaction`, `create-transfer`, `create-transaction-and-wait`, `approve-transaction`, `abort-transaction`, `release-transaction`, `predict-transaction`, `push-transaction`, `update-spam-state`, `trigger-signing`, `export-transactions` |
| **Batch Transactions** (4) | `create-batch-transaction`, `predict-batch-transaction`, `abort-batch-transaction`, `approve-batch-transaction`                                                                                                                                                                             |
| **Swaps** (4)              | `get-swap-providers`, `get-swap-quotes`, `create-swap`, `predict-swap`                                                                                                                                                                                                                      |
| **Assets** (5)             | `get-owned-asset`, `list-owned-assets`, `update-asset-config`, `fetch-asset-prices`, `create-asset-info`                                                                                                                                                                                    |
| **Blockchains** (2)        | `list-blockchains`, `get-suggested-fees`                                                                                                                                                                                                                                                    |
| **Address Book** (5)       | `create-contact`, `list-contacts`, `create-batch-contacts`, `abort-contact-proposal`, `edit-contact`                                                                                                                                                                                        |
| **Users** (2)              | `list-users`, `get-user`                                                                                                                                                                                                                                                                    |
| **User Groups** (2)        | `list-user-groups`, `get-user-group`                                                                                                                                                                                                                                                        |
| **End Users / WaaS** (6)   | `list-end-users`, `create-end-user`, `get-current-end-user`, `get-end-user`, `delete-end-user`, `set-export-key-permissions`                                                                                                                                                                |
| **Auth Tokens** (3)        | `issue-auth-token`, `list-auth-tokens`, `delete-auth-token`                                                                                                                                                                                                                                 |
| **Organizations** (4)      | `import-keys`, `abort-import-keys`, `get-import-keys-status`, `list-org-keys`                                                                                                                                                                                                               |
| **Vault Groups** (1)       | `list-vault-groups`                                                                                                                                                                                                                                                                         |
| **Webhooks** (2)           | `test-webhook`, `trigger-transaction-webhook`                                                                                                                                                                                                                                               |
| **Audit Log** (2)          | `list-audit-log`, `export-audit-log`                                                                                                                                                                                                                                                        |
| **Exports** (2)            | `get-export`, `abort-export`                                                                                                                                                                                                                                                                |
| **Enclave Keys** (1)       | `list-enclave-keys`                                                                                                                                                                                                                                                                         |

## Environments

| Environment | `api-url`                           |
| ----------- | ----------------------------------- |
| Production  | `https://api.fordefi.com` (default) |
| Sandbox     | `https://api.sandbox.fordefi.com`   |

## Full documentation

See [docs/guide.md](docs/guide.md) for complete command reference with input/output schemas.
