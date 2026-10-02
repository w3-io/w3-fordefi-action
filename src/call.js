/**
 * call-contract — one raw EVM contract call out of a vault, from primitives.
 *
 * The caller owns the calldata: this command neither encodes nor decodes it,
 * so it carries any function of any contract. It builds the ForDefi payload
 * around the bytes, creates the transaction, and returns. It does not wait:
 * a transaction may sit in `waiting_for_approval` for as long as a human
 * takes, and the consumer reads what became of it from ForDefi by the
 * transaction id and from the chain by the receipt.
 *
 * The idempotence key is required. The client retries a create on a timeout
 * or a 5xx, and only the key makes the retried request name the transaction
 * the first one created.
 */

import { W3ActionError } from '@w3-io/action-core'
import { assertNamed, failedDefinitively } from './outcome.js'
import { parseAddress, parseBaseUnits } from './transfer.js'

/** The canonical textual UUID, any version. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Whole bytes, at least the four of a function selector. */
const CALLDATA = /^0x(?:[0-9a-f]{2}){4,}$/

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
 * Build the ForDefi create-transaction payload for a call from `vaultId` to
 * the contract at `to`. `value` is the native coin sent with the call, in
 * base units; a call that pays nothing sends "0".
 */
export function buildCallPayload({ vaultId, chain, to, calldata, value, note }) {
  if (!vaultId) throw new W3ActionError('MISSING_INPUT', 'vault-id is required')
  if (!chain) throw new W3ActionError('MISSING_INPUT', 'chain is required')
  return {
    vault_id: vaultId,
    signer_type: 'api_signer',
    type: 'evm_transaction',
    details: {
      type: 'evm_raw_transaction',
      chain,
      to: parseAddress(to, 'to'),
      value: parseBaseUnits(value ?? '0', 'value').toString(10),
      data: { type: 'hex', hex_data: parseCalldata(calldata) },
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
