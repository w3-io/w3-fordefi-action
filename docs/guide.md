---
title: ForDefi Integration
category: integrations
actions:
  [
    list-vaults,
    create-vault,
    get-vault,
    create-transaction,
    create-transfer,
    predict-transaction,
    approve-transaction,
    list-blockchains,
    get-swap-quotes,
    create-swap,
    list-contacts,
    list-end-users,
  ]
complexity: intermediate
---

# ForDefi Integration

[ForDefi](https://fordefi.com) is an institutional MPC custody platform (acquired by Paxos, Nov 2025) that provides sub-second transaction signing across 10+ blockchain families — EVM, Solana, Bitcoin, Cosmos, Sui, Aptos, Starknet, TON, and more — with policy-based approval workflows, transaction simulation with revert prediction, AML screening, and audit trails. Use this action for programmatic vault management, multi-chain transaction signing, token swaps, and Wallet-as-a-Service (WaaS) for end users.

## Quick Start

```yaml
- uses: w3-io/w3-fordefi-action@v0
  id: vaults
  with:
    command: list-vaults
    access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
```

## Authentication

ForDefi uses two-layer auth:

- **Access token** (required for all commands) — JWT from API User creation
- **P-256 private key** (required for transactional commands) — PEM-encoded ECDSA key for request signing

Transactional commands are marked with (signing) below. Read-only commands need only the access token.

## Command Reference

### Vaults

#### list-vaults

List all vaults in the organization.

**Inputs:** `page_size`, `page_token`, `sort_by`, `sort_order`

```yaml
- uses: w3-io/w3-fordefi-action@v0
  with:
    command: list-vaults
    access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
```

#### create-vault (signing)

Create a new vault.

**Inputs:** `data` (JSON), `private-key`

```yaml
- uses: w3-io/w3-fordefi-action@v0
  with:
    command: create-vault
    access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
    private-key: ${{ secrets.FORDEFI_PRIVATE_KEY }}
    data: |
      {
        "name": "Treasury Vault",
        "type": "end_user",
        "key_type": "ecdsa_secp256k1"
      }
```

#### get-vault

Get vault details.

**Inputs:** `vault-id`

#### get-vault-asset

Get a specific asset in a vault.

**Inputs:** `vault-id`, `asset-id`

#### list-vault-assets

List all assets in a vault.

**Inputs:** `vault-id`, `page_size`, `page_token`

#### create-vault-address (signing)

Create a new address in a vault.

**Inputs:** `vault-id`, `data`, `private-key`

#### archive-vault / restore-vault (signing)

Archive or restore a vault.

**Inputs:** `vault-id`, `private-key`

#### rename-vault / rename-vault-address

Rename a vault or vault address.

**Inputs:** `vault-id` or `address-id`, `name`

### Transactions

#### create-transaction (signing)

Create a transaction. Supports all chain types — EVM, Solana, Bitcoin, Cosmos, etc.

**Inputs:** `data` (JSON), `private-key`

```yaml
- uses: w3-io/w3-fordefi-action@v0
  with:
    command: create-transaction
    access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
    private-key: ${{ secrets.FORDEFI_PRIVATE_KEY }}
    data: |
      {
        "vault_id": "abc-123",
        "type": "evm_transaction",
        "details": {
          "type": "evm_transfer",
          "to": "0xrecipient...",
          "value": { "type": "value", "value": "1000000000000000000" },
          "chain": "evm_1"
        }
      }
```

#### create-transfer (signing)

Simplified transfer (shortcut for common transfer patterns).

**Inputs:** `data`, `private-key`

#### create-transaction-and-wait (signing)

Create a transaction and wait for it to reach a target state.

**Inputs:** `data`, `private-key`

#### predict-transaction (signing)

Simulate a transaction before execution. Returns fee estimates, effect predictions, revert detection, risk screening results, and policy matching.

**Inputs:** `data`, `private-key`

```yaml
- uses: w3-io/w3-fordefi-action@v0
  id: simulate
  with:
    command: predict-transaction
    access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
    private-key: ${{ secrets.FORDEFI_PRIVATE_KEY }}
    data: |
      {
        "vault_id": "abc-123",
        "type": "evm_transaction",
        "details": { ... }
      }
```

#### approve-transaction (signing)

Approve a pending transaction.

**Inputs:** `transaction-id`, `private-key`

#### abort-transaction (signing)

Abort a pending transaction.

**Inputs:** `transaction-id`, `private-key`

#### trigger-signing (signing)

Trigger MPC signing for a transaction.

**Inputs:** `transaction-id`, `private-key`

#### push-transaction (signing)

Push a signed transaction to the blockchain.

**Inputs:** `transaction-id`, `private-key`

#### list-transactions / get-transaction / export-transactions

Query transactions.

**Inputs:** `page_size`, `page_token`, `vault_id`, `state`, `type`, `transaction-id`

### Swaps

#### get-swap-quotes

Get swap quotes from available providers.

**Inputs:** `data` (JSON with source/destination token info)

#### create-swap (signing)

Execute a token swap.

**Inputs:** `data`, `private-key`

#### predict-swap (signing)

Simulate a swap before execution.

**Inputs:** `data`, `private-key`

#### get-swap-providers

List available swap providers for a chain.

**Inputs:** `chain-type` (e.g., `evm`, `solana`)

### End Users (WaaS)

#### create-end-user

Create an end user for Wallet-as-a-Service.

**Inputs:** `data`

#### list-end-users / get-end-user / get-current-end-user / delete-end-user

Manage WaaS end users.

#### set-export-key-permissions

Set key export permissions for an end user.

**Inputs:** `user-id`, `data`

### Blockchains

#### list-blockchains

List all supported blockchains.

#### get-suggested-fees

Get fee suggestions for a specific chain.

**Inputs:** `chain_type`, `chain_unique_id`

### Address Book

#### create-contact (signing)

Add a whitelisted contact.

**Inputs:** `data`, `private-key`

#### list-contacts

List contacts in the address book.

**Inputs:** `search`, `page_size`, `page_token`

### Organizations

#### import-keys (signing)

Import cryptographic keys into the organization.

**Inputs:** `data`, `private-key`

#### list-org-keys

List imported organization keys.

### Audit Log

#### list-audit-log / export-audit-log

Query or export audit trail.

**Inputs:** `page_size`, `page_token`, `start_date`, `end_date`, `format`

## Usage Patterns

### Simulate then execute

```yaml
steps:
  - uses: w3-io/w3-fordefi-action@v0
    id: simulate
    with:
      command: predict-transaction
      access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
      private-key: ${{ secrets.FORDEFI_PRIVATE_KEY }}
      data: ${{ inputs.tx_data }}

  - uses: w3-io/w3-fordefi-action@v0
    id: execute
    with:
      command: create-transaction-and-wait
      access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
      private-key: ${{ secrets.FORDEFI_PRIVATE_KEY }}
      data: ${{ inputs.tx_data }}
```

### Multi-chain balance check

```yaml
steps:
  - uses: w3-io/w3-fordefi-action@v0
    id: assets
    with:
      command: list-vault-assets
      access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
      vault-id: ${{ inputs.vault_id }}
```

## Error Handling

The action throws `W3ActionError` with structured codes:

| Code                   | Meaning                                      |
| ---------------------- | -------------------------------------------- |
| `MISSING_ACCESS_TOKEN` | Access token not provided                    |
| `MISSING_PRIVATE_KEY`  | Private key needed for transactional command |
| `BRIDGE_ERROR`         | ForDefi API returned an error                |

## Environments

| Environment | `api-url`                           |
| ----------- | ----------------------------------- |
| Production  | `https://api.fordefi.com` (default) |
| Sandbox     | `https://api.sandbox.fordefi.com`   |
