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
- **Request-signing key** (required for transactional commands) — a PEM-encoded P-256 ECDSA key, supplied as either:
  - `private-key`: the PEM itself, which then enters the action's container; or
  - `signing-key-name`: the name of a W3 bridge secret holding the PEM. The W3 bridge signs each request and the key never enters the container. Reference the secret in the step's `env` so the bridge receives it, and pass its name as a bare literal:

```yaml
- uses: w3-io/w3-fordefi-action@v0
  env:
    FORDEFI_SIGNING_KEY: ${{ secrets.FORDEFI_SIGNING_KEY }}
  with:
    command: call-contract
    access-token: ${{ secrets.FORDEFI_ACCESS_TOKEN }}
    signing-key-name: FORDEFI_SIGNING_KEY
    # ...
```

Transactional commands are marked with (signing) below, and each accepts either input wherever `private-key` is listed. Read-only commands need only the access token. A transactional command given neither fails with `MISSING_SIGNER`.

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

**Inputs:** `data` (JSON), `private-key` or `signing-key-name`

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

**Inputs:** `vault-id`, `data`, `private-key` or `signing-key-name`

#### archive-vault / restore-vault (signing)

Archive or restore a vault.

**Inputs:** `vault-id`, `private-key` or `signing-key-name`

#### rename-vault / rename-vault-address

Rename a vault or vault address.

**Inputs:** `vault-id` or `address-id`, `name`

### Transactions

#### create-transaction (signing)

Create a transaction. Supports all chain types — EVM, Solana, Bitcoin, Cosmos, etc.

**Inputs:** `data` (JSON), `private-key` or `signing-key-name`

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

**Inputs:** `data`, `private-key` or `signing-key-name`

#### create-transaction-and-wait (signing)

Create a transaction and wait for it to reach a target state.

**Inputs:** `data`, `private-key` or `signing-key-name`

#### call-contract (signing)

Send one raw EVM transaction out of a vault. The caller supplies the calldata; the command builds the ForDefi payload around it and creates the transaction. With no calldata it is a plain transfer of the chain coin.

**Inputs:** `vault-id`, `chain`, `to`, `idempotence-id`, `not-after` (all required), `calldata`, `value` (default `0`), `note`, and `private-key` or `signing-key-name`

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
    not-after: ${{ inputs.not_after }}
```

The step returns when ForDefi has created the transaction. It does not wait for approval, signing or mining: under an approval policy a transaction stays in `waiting_for_approval` until a person acts, so `state` is the state at creation and `tx_hash` is empty unless ForDefi already has a hash. Read what became of the transaction with `get-transaction`, and confirm settlement from the chain.

`calldata` is 0x-prefixed hex of whole bytes, at least the 4-byte function selector. Left empty, the transaction carries no data and transfers `value` of the chain coin to `to`; `value` must then be positive. A transaction with neither calldata nor value is refused before any request.

`idempotence-id` is a UUID and is required. The client retries a create that times out or answers 5xx, and the key is what makes the retry name the transaction the first attempt created.

ForDefi simulates the call at create. A call that would revert (a deposit with no allowance, for example) is refused with HTTP 400 and `error_type: reverted_transaction`, and no transaction exists.

##### The deadline

`not-after` is an RFC 3339 UTC instant (`2026-10-02T20:15:00.000Z`) and is required.

**Guarantee: every request the step sends is signed with a timestamp strictly earlier than `not-after`, and the step sends nothing at or after `not-after` by its own clock.**

Four rules give it:

1. The request is signed once, before the first attempt, and is refused unless its signed timestamp (`x-timestamp`) is strictly earlier than the deadline. Every retry reuses that signature and timestamp.
2. No attempt begins at or after the deadline. The check runs immediately before every attempt, the first and each retry alike, and the one clock reading it takes also sets the attempt's time limit, with nothing between it and the send.
3. A retry wait that would end at or after the deadline is not waited out, whether it is the client's backoff or a `Retry-After` the server asked for.
4. An attempt still in flight at the deadline is abandoned there, whether it is waiting for the response or for the rest of its body: the client closes the request rather than wait out its 30-second timeout.

Each ends the step with `DEADLINE_PASSED`.

Rule 1 is the one that binds ForDefi. ForDefi refuses a request whose signed timestamp is older than its signature window, on ForDefi's own clock: a timestamp 180 seconds old was refused (`expired_signed_request_timestamp`, observed 2026-10-02), and the documentation states 120 seconds. So ForDefi accepts a request from this step only before `not-after` plus that window, measured on ForDefi's clock, however wrong the runner's clock is. Rules 2 to 4 bound only what the step itself does, on the runner's clock.

What remains outside the step: a request ForDefi accepted is ForDefi's to finish, and under rule 4 the step may never learn what it made; and a created transaction takes a moment to appear in ForDefi's listing (about two seconds, one sample).

A consumer uses the deadline to make an absence conclusive. A step can run long after it was triggered, and more than one run can carry one key, so finding no transaction under a key proves nothing while a request could still be accepted. Once `not-after` plus ForDefi's signature window plus the listing delay has passed, none can be.

Tests that pin it, in `test/call.test.js` and `test/fordefi.test.js`:

| Test                                                                       | What it pins                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `signs no request whose timestamp is not earlier than the deadline`        | Rule 1: a request whose signed timestamp equals the deadline is neither signed nor sent. |
| `sends every attempt under one signed timestamp earlier than the deadline` | Rule 1: a retry reuses the one signature, whose timestamp is before the deadline.        |
| `sends nothing at or after the deadline`                                   | Rule 2: the comparison is strict: a deadline equal to the present instant sends nothing. |
| `sends nothing once the deadline has passed`                               | Rule 2: the step makes no request and fails with `DEADLINE_PASSED`.                      |
| `decides each attempt on the clock reading it was started under`           | Rule 2: the deadline cannot pass between the check and the send.                         |
| `does not wait out a retry that would reach the deadline`                  | Rule 3: a `Retry-After` longer than the time left is refused, not slept, after a 5xx.    |
| `does not wait out a date-form Retry-After that would reach the deadline`  | Rule 3: a `Retry-After` given as an HTTP-date is read as the time until that date.       |
| `does not wait out a rate limit that would reach the deadline`             | Rule 3: the same after a 429.                                                            |
| `abandons an attempt still in flight at the deadline`                      | Rule 4: the client stops waiting at the deadline instead of at its 30-second timeout.    |
| `abandons a response whose body stalls at the deadline`                    | Rule 4: a body still arriving at the deadline is cut off with the request.               |
| `retries inside the deadline`                                              | Rules 2 and 3: a retry that fits before the deadline is still sent.                      |

##### What a failed step says

Each row is a statement about this run alone. Another run under the same idempotence key may have created a transaction, so a consumer that needs to know whether one exists lists the vault's transactions and matches `managed_transaction_data.idempotence_id`.

| Step outputs                                                                                                                                                                    | Meaning                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transaction_id` set, `error-code: CALL_FAILED`                                                                                                                                 | The transaction exists and is in a state ForDefi names as definitive failure (`aborted`, `error_signing`, `error_pushing_to_blockchain`, `dropped`, `cancelled`, `mined_reverted`, `completed_reverted`). |
| no `transaction_id`, `error-code: HTTP_ERROR`, `status-code` 4xx                                                                                                                | ForDefi refused the request, and no earlier attempt in this step went unanswered. This run created nothing.                                                                                               |
| no `transaction_id`, `error-code: DEADLINE_PASSED`                                                                                                                              | The deadline stopped the step. If the message says an earlier attempt went unanswered, that attempt may have been processed; otherwise this run sent nothing ForDefi could have processed.                |
| no `transaction_id`, `error-code` one of `AMBIGUOUS_CREATE`, `TIMEOUT`, `INVALID_RESPONSE`, or `HTTP_ERROR` with `status-code` 5xx, or no `error-code` at all (a network error) | Unknown. A request may have reached ForDefi, so a transaction may exist under the idempotence key. `AMBIGUOUS_CREATE` is a 4xx that followed a timeout or a 5xx.                                          |
| no `transaction_id`, an input error (`MISSING_INPUT`, `INVALID_ADDRESS`, `INVALID_AMOUNT`, `INVALID_CALLDATA`, `INVALID_IDEMPOTENCE_ID`, `INVALID_NOT_AFTER`, `MISSING_SIGNER`) | No request was sent.                                                                                                                                                                                      |

#### transfer-out (signing)

Transfer the chain coin or an ERC-20 out of a vault to an external address. The command builds the payload from primitives, so no calldata is hand-encoded, and waits for ForDefi to report the transaction completed.

**Inputs:** `vault-id`, `chain`, `to`, `amount` (required, base units), `asset` (`native` or the ERC-20 contract; default `native`), `idempotence-id`, `note`, and `private-key` or `signing-key-name`

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

The step fails only on a state ForDefi names as definitive failure or on a response that names no transaction. A transfer still in flight when the wait ends succeeds, and the consumer confirms settlement from the chain. A failed step reads as the table under [What a failed step says](#what-a-failed-step-says) has it, with `TRANSFER_FAILED` in place of `CALL_FAILED`; `transfer-out` takes no deadline.

#### Retries and the idempotence key

`create-transaction`, `create-transfer`, `create-transaction-and-wait`, `transfer-out` and `call-contract` create a transaction, and a create that times out or answers 5xx may have been processed. With `idempotence-id` set, the client retries it under the same key and ForDefi answers with the transaction the first attempt made. Without it nothing ties a second request to the first, so the client does not retry: the step fails after one attempt, and whether a transaction exists is unknown. A 429 processed nothing and is retried either way.

#### predict-transaction (signing)

Simulate a transaction before execution. Returns fee estimates, effect predictions, revert detection, risk screening results, and policy matching.

**Inputs:** `data`, `private-key` or `signing-key-name`

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

**Inputs:** `transaction-id`, `private-key` or `signing-key-name`

#### abort-transaction (signing)

Abort a pending transaction.

**Inputs:** `transaction-id`, `private-key` or `signing-key-name`

#### trigger-signing (signing)

Trigger MPC signing for a transaction.

**Inputs:** `transaction-id`, `private-key` or `signing-key-name`

#### push-transaction (signing)

Push a signed transaction to the blockchain.

**Inputs:** `transaction-id`, `private-key` or `signing-key-name`

#### list-transactions / get-transaction / export-transactions

Query transactions.

**Inputs:** `page_size`, `page_token`, `vault_id`, `state`, `type`, `transaction-id`

### Swaps

#### get-swap-quotes

Get swap quotes from available providers.

**Inputs:** `data` (JSON with source/destination token info)

#### create-swap (signing)

Execute a token swap.

**Inputs:** `data`, `private-key` or `signing-key-name`

#### predict-swap (signing)

Simulate a swap before execution.

**Inputs:** `data`, `private-key` or `signing-key-name`

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

**Inputs:** `data`, `private-key` or `signing-key-name`

#### list-contacts

List contacts in the address book.

**Inputs:** `search`, `page_size`, `page_token`

### Organizations

#### import-keys (signing)

Import cryptographic keys into the organization.

**Inputs:** `data`, `private-key` or `signing-key-name`

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

| Code                   | Meaning                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `MISSING_ACCESS_TOKEN` | Access token not provided                                                |
| `MISSING_SIGNER`       | Transactional command given neither `private-key` nor `signing-key-name` |
| `BRIDGE_ERROR`         | ForDefi API returned an error                                            |

## Environments

| Environment | `api-url`                           |
| ----------- | ----------------------------------- |
| Production  | `https://api.fordefi.com` (default) |
| Sandbox     | `https://api.sandbox.fordefi.com`   |
