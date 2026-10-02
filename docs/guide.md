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

#### call-contract (signing)

Make one raw EVM contract call out of a vault. The caller supplies the calldata; the command builds the ForDefi payload around it and creates the transaction.

**Inputs:** `vault-id`, `chain`, `to`, `calldata`, `idempotence-id` (all required), `value` (default `0`), `note`

**Outputs:** `transaction_id`, `state`, `tx_hash`, `explorer_url`, `result`

```yaml
- uses: w3-io/w3-fordefi-action@v0
  id: call
  with:
    command: call-contract
    access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
    private-key: ${{ secrets.FORDEFI_PRIVATE_KEY }}
    vault-id: ${{ inputs.vault_id }}
    chain: avalanche_chain
    to: '0x061329361E0f163125225bf71a1E5AF954b46869'
    calldata: ${{ inputs.calldata }}
    idempotence-id: ${{ inputs.call_id }}
```

The step returns when ForDefi has created the transaction. It does not wait for approval, signing or mining: under an approval policy a transaction stays in `waiting_for_approval` until a person acts, so `state` is the state at creation and `tx_hash` is empty unless ForDefi already has a hash. Read what became of the transaction with `get-transaction`, and confirm settlement from the chain.

`idempotence-id` is a UUID and is required. The client retries a create that times out or answers 5xx, and the key is what makes the retry name the transaction the first attempt created.

ForDefi simulates the call at create. A call that would revert (a deposit with no allowance, for example) is refused with HTTP 400 and `error_type: reverted_transaction`, and no transaction exists.

What a failed step says about the custodian:

| Step outputs                                                                                                                                                                    | Meaning                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transaction_id` set, `error-code: CALL_FAILED`                                                                                                                                 | The transaction exists and is in a state ForDefi names as definitive failure (`aborted`, `error_signing`, `error_pushing_to_blockchain`, `dropped`, `cancelled`, `mined_reverted`, `completed_reverted`). |
| no `transaction_id`, `error-code: HTTP_ERROR`, `status-code` 4xx                                                                                                                | ForDefi refused the request, and no earlier attempt in this step went unanswered. The step created nothing.                                                                                               |
| no `transaction_id`, `error-code` one of `AMBIGUOUS_CREATE`, `TIMEOUT`, `INVALID_RESPONSE`, or `HTTP_ERROR` with `status-code` 5xx, or no `error-code` at all (a network error) | Unknown. A request may have reached ForDefi, so a transaction may exist under the idempotence key. `AMBIGUOUS_CREATE` is a 4xx that followed a timeout or a 5xx.                                          |
| no `transaction_id`, an input error (`MISSING_INPUT`, `INVALID_ADDRESS`, `INVALID_AMOUNT`, `INVALID_CALLDATA`, `INVALID_IDEMPOTENCE_ID`, `MISSING_SIGNER`)                      | No request was sent.                                                                                                                                                                                      |

#### transfer-out (signing)

Transfer the chain coin or an ERC-20 out of a vault to an external address. The command builds the payload from primitives, so no calldata is hand-encoded, and waits for ForDefi to report the transaction completed.

**Inputs:** `vault-id`, `chain`, `to`, `amount` (required, base units), `asset` (`native` or the ERC-20 contract; default `native`), `idempotence-id`, `note`

**Outputs:** `transaction_id`, `state`, `tx_hash`, `explorer_url`, `result`

```yaml
- uses: w3-io/w3-fordefi-action@v0
  id: transfer
  with:
    command: transfer-out
    access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
    private-key: ${{ secrets.FORDEFI_PRIVATE_KEY }}
    vault-id: ${{ inputs.vault_id }}
    chain: ethereum_mainnet
    to: ${{ inputs.to }}
    asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    amount: ${{ inputs.amount }}
    idempotence-id: ${{ inputs.withdrawal_id }}
```

The step fails only on a state ForDefi names as definitive failure or on a response that names no transaction. A transfer still in flight when the wait ends succeeds, and the consumer confirms settlement from the chain. A failed step reads as the table under [call-contract](#call-contract-signing) says, with `TRANSFER_FAILED` in place of `CALL_FAILED`.

#### Retries and the idempotence key

`create-transaction`, `create-transfer`, `create-transaction-and-wait`, `transfer-out` and `call-contract` create a transaction, and a create that times out or answers 5xx may have been processed. With `idempotence-id` set, the client retries it under the same key and ForDefi answers with the transaction the first attempt made. Without it nothing ties a second request to the first, so the client does not retry: the step fails after one attempt, and whether a transaction exists is unknown. A 429 processed nothing and is retried either way.

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
