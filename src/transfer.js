/**
 * transfer-out — a typed vault→external transfer, built from primitives.
 *
 * The generic commands take an opaque ForDefi `data` payload; transfer-out
 * takes typed inputs (chain, to, asset, amount) and BUILDS the payload, so a
 * caller never hand-encodes calldata. A native transfer moves the chain coin;
 * an ERC-20 transfer encodes `transfer(address,uint256)` client-side — a fixed
 * selector plus two 32-byte words, so it needs no ABI library (per the action's
 * no-blockchain-SDK rule).
 *
 * The action does NO unit math: `amount` is base units end-to-end, because the
 * caller (which owns the asset's decimals) is the only honest source of scale.
 */

import { W3ActionError } from '@w3-io/action-core'

/** `transfer(address,uint256)` selector — keccak256 of the signature, first 4 bytes. */
const ERC20_TRANSFER_SELECTOR = 'a9059cbb'

/** uint256 ceiling; an amount at or above it cannot be encoded in one word. */
const UINT256_LIMIT = 1n << 256n

/** Normalize a 0x-prefixed 20-byte address to lowercase, or fail loud. */
function parseAddress(value, label) {
  const s = String(value ?? '')
    .trim()
    .toLowerCase()
  const m = /^0x([0-9a-f]{40})$/.exec(s)
  if (!m) {
    throw new W3ActionError('INVALID_ADDRESS', `${label} must be a 0x-prefixed 20-byte address`)
  }
  return '0x' + m[1]
}

/** Parse a base-unit amount: non-negative integer, in-range for a uint256. */
function parseBaseUnits(value) {
  const s = String(value ?? '').trim()
  if (!/^\d+$/.test(s)) {
    throw new W3ActionError('INVALID_AMOUNT', 'amount must be a base-unit integer (decimal digits)')
  }
  const amt = BigInt(s)
  if (amt >= UINT256_LIMIT) {
    throw new W3ActionError('INVALID_AMOUNT', 'amount exceeds uint256')
  }
  return amt
}

/** Left-pad hex (no `0x`) to a 32-byte EVM word. */
function word(hex) {
  return hex.replace(/^0x/, '').padStart(64, '0')
}

/**
 * `transfer(to, amount)` calldata for an ERC-20 token. `amount` may be a bigint
 * (already parsed) or a base-unit string.
 */
export function encodeErc20Transfer(to, amount) {
  const amt = typeof amount === 'bigint' ? amount : parseBaseUnits(amount)
  return '0x' + ERC20_TRANSFER_SELECTOR + word(parseAddress(to, 'to')) + word(amt.toString(16))
}

/**
 * Build the ForDefi create-transaction payload for a transfer out of `vaultId`.
 * `asset` is `native`/empty for the chain coin, else the 0x ERC-20 contract:
 * native pays `value` to `to`; ERC-20 calls `to`'s token contract with encoded
 * `transfer` calldata and zero value.
 */
export function buildTransferPayload({ vaultId, chain, to, asset, amount, note }) {
  if (!vaultId) throw new W3ActionError('MISSING_INPUT', 'vault-id is required')
  if (!chain) throw new W3ActionError('MISSING_INPUT', 'chain is required')
  const dest = parseAddress(to, 'to')
  const amt = parseBaseUnits(amount)
  const isNative = !asset || asset.trim().toLowerCase() === 'native'
  const gas = { type: 'priority', priority_level: 'medium' }
  const details = isNative
    ? { type: 'evm_raw_transaction', chain, to: dest, value: amt.toString(10), gas }
    : {
        type: 'evm_raw_transaction',
        chain,
        to: parseAddress(asset, 'asset'),
        value: '0',
        data: { type: 'hex', hex_data: encodeErc20Transfer(dest, amt) },
        gas,
      }
  return {
    vault_id: vaultId,
    signer_type: 'api_signer',
    wait_for_state: 'completed',
    type: 'evm_transaction',
    details,
    ...(note ? { note } : {}),
  }
}

/**
 * Extract the honest, named outcome from a ForDefi transaction response.
 *
 * `tx_hash` is the ON-CHAIN hash (`hash`), empty when ForDefi has not surfaced
 * one — NEVER the ForDefi UUID (`id`) standing in for it. Conflating the two is
 * exactly the bug this command exists to avoid: a UUID is not a transaction
 * hash, and a block explorer link built from it is a lie.
 */
export function extractOutcome(result) {
  const r = result && typeof result === 'object' ? result : {}
  const str = (v) => (typeof v === 'string' ? v : '')
  return {
    tx_hash: str(r.hash),
    transaction_id: str(r.id),
    state: str(r.state),
    explorer_url: str(r.explorer_url),
  }
}

/** Definitive non-settlement states: ForDefi reports the transfer will not
 *  settle — it failed to sign or broadcast, was dropped/cancelled, or reverted
 *  on-chain. Every other state is in-flight (`pushed_to_blockchain`, `stuck`, …)
 *  or on-chain (`mined`, `completed`); the consumer confirms settlement from the
 *  chain, so an unrecognized or in-flight state is NOT a failure here. */
const TERMINAL_FAILURE = new Set([
  'aborted',
  'error_pushing_to_blockchain',
  'error_signing',
  'dropped',
  'cancelled',
  'mined_reverted',
  'completed_reverted',
])

/**
 * Fail the step only when the transfer definitively did not settle. Money
 * moving is confirmed downstream from the chain (the consumer re-reads the
 * receipt for finality and reversion), so this asserts the weaker, robust
 * property: ForDefi has not reported a terminal failure. An in-flight tx or an
 * unrecognized state passes — a hiccup or delay in execution (a slow-to-mine
 * or not-yet-broadcast transfer) must not be recorded as a failure. Fail-open
 * to the chain oracle, which is the authority on settlement; fail-closed only
 * on a state ForDefi names as terminal-failed.
 */
export function assertNotFailed(outcome) {
  if (TERMINAL_FAILURE.has(outcome.state)) {
    throw new W3ActionError(
      'TRANSFER_FAILED',
      `transfer failed: state='${outcome.state || ''}', transaction_id='${outcome.transaction_id || ''}'`,
    )
  }
}
