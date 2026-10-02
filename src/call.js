/**
 * call-contract — one raw EVM transaction out of a vault, from primitives.
 *
 * The caller owns the calldata: this command neither encodes nor decodes it,
 * so it carries any function of any contract, and with no calldata it is a
 * plain transfer of the chain coin. It builds the ForDefi payload around the
 * bytes, creates the transaction, and returns. It does not wait: a
 * transaction may sit in `waiting_for_approval` for as long as a human takes,
 * and the consumer reads what became of it from ForDefi and from the chain.
 *
 * The idempotence key is required. The client retries a create on a timeout
 * or a 5xx, and only the key makes the retried request name the transaction
 * the first one created.
 *
 * The deadline is required. A step can run long after it was triggered, and
 * more than one run can carry one key, so a consumer that finds no
 * transaction under the key learns nothing unless it also knows no create can
 * still be sent. `not-after` is that bound: no create leaves at or after it.
 */

import { W3ActionError } from '@w3-io/action-core'
import { assertNamed, failedDefinitively } from './outcome.js'
import { parseAddress, parseBaseUnits } from './transfer.js'

/** The canonical textual UUID, any version. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Whole bytes, at least the four of a function selector. */
const CALLDATA = /^0x(?:[0-9a-f]{2}){4,}$/

/** An RFC 3339 instant in UTC, with up to nanosecond fractions. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/

/** Parse the idempotence key: ForDefi takes a UUID and nothing else. */
export function parseIdempotenceId(value) {
  const s = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!s) {
    throw new W3ActionError('MISSING_INPUT', 'idempotence-id is required for call-contract')
  }
  if (!UUID.test(s)) {
    throw new W3ActionError('INVALID_IDEMPOTENCE_ID', 'idempotence-id must be a UUID')
  }
  return s
}

/**
 * Parse the deadline to epoch milliseconds. Fractions past the millisecond
 * are dropped, which moves the deadline earlier and never later.
 */
export function parseNotAfter(value) {
  const s = String(value ?? '').trim()
  if (!s) {
    throw new W3ActionError('MISSING_INPUT', 'not-after is required for call-contract')
  }
  const ms = INSTANT.test(s) ? Date.parse(s.replace(/(\.\d{3})\d+Z$/, '$1Z')) : NaN
  if (!Number.isFinite(ms)) {
    throw new W3ActionError(
      'INVALID_NOT_AFTER',
      'not-after must be an RFC 3339 UTC instant, e.g. 2026-10-02T20:15:00.000Z',
    )
  }
  return ms
}

/** Normalize calldata to lowercase hex, or fail loud. */
export function parseCalldata(value) {
  const s = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!CALLDATA.test(s)) {
    throw new W3ActionError(
      'INVALID_CALLDATA',
      'calldata must be 0x-prefixed hex of whole bytes, at least a 4-byte selector',
    )
  }
  return s
}

/**
 * Build the ForDefi create-transaction payload for a transaction from
 * `vaultId` to `to`. `value` is the native coin sent, in base units; a call
 * that pays nothing sends "0". With no `calldata` the transaction is a plain
 * transfer of `value`, and it must then send something: a transaction with
 * neither calldata nor value does nothing but spend gas.
 */
export function buildCallPayload({ vaultId, chain, to, calldata, value, note }) {
  if (!vaultId) throw new W3ActionError('MISSING_INPUT', 'vault-id is required')
  if (!chain) throw new W3ActionError('MISSING_INPUT', 'chain is required')
  const units = parseBaseUnits(value ?? '0', 'value')
  const hex = calldata ? parseCalldata(calldata) : null
  if (hex === null && units === 0n) {
    throw new W3ActionError('MISSING_INPUT', 'calldata or a positive value is required')
  }
  return {
    vault_id: vaultId,
    signer_type: 'api_signer',
    type: 'evm_transaction',
    details: {
      type: 'evm_raw_transaction',
      chain,
      to: parseAddress(to, 'to'),
      value: units.toString(10),
      ...(hex === null ? {} : { data: { type: 'hex', hex_data: hex } }),
      gas: { type: 'priority', priority_level: 'medium' },
    },
    ...(note ? { note } : {}),
  }
}

/**
 * Fail the step on the two outcomes of a create that answered: a response
 * that names no transaction (`assertNamed`), and a transaction already in a
 * state ForDefi names as a definitive non-settlement. Every other state
 * passes, the same boundary `assertNotFailed` draws for a transfer.
 */
export function assertCallCreated(outcome) {
  assertNamed(outcome)
  if (failedDefinitively(outcome.state)) {
    throw new W3ActionError(
      'CALL_FAILED',
      `contract call failed: state='${outcome.state}', transaction_id='${outcome.transaction_id}'`,
    )
  }
}
