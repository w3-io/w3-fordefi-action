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
import { failedDefinitively, parseAddress, parseBaseUnits } from './transfer.js'

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
 * The error a failed create is reported by. A 4xx is ForDefi refusing the
 * request, and the step reports it with its status so a consumer can read
 * "nothing was created" from it. That reading holds only when the refusal
 * answers the first request that could have been processed: after a timeout
 * or a 5xx the retried request carries a key ForDefi may already hold a
 * transaction under, and what it answers to a repeated key is not something
 * a refusal can be told apart from. Such a refusal is reported with no
 * status, as the unknown it is.
 */
export function createFailure(err) {
  const refused =
    err instanceof W3ActionError &&
    err.code === 'HTTP_ERROR' &&
    err.statusCode >= 400 &&
    err.statusCode < 500
  if (refused && err.details?.unsettled) {
    return new W3ActionError(
      'AMBIGUOUS_CREATE',
      `create was refused after an earlier attempt went unanswered, so a transaction may exist under the idempotence key: ${err.message}`,
    )
  }
  return err
}

/**
 * Fail the step on the two outcomes of a create that answered: a response
 * that names no transaction, and a transaction already in a state ForDefi
 * names as a definitive non-settlement. Every other state passes, the same
 * boundary `assertNotFailed` draws for a transfer.
 *
 * A response with no id is a failure of a different kind than a refused
 * request: the custodian answered 2xx, so a transaction may exist that this
 * step cannot name.
 */
export function assertCallCreated(outcome) {
  if (!outcome.transaction_id) {
    throw new W3ActionError('INVALID_RESPONSE', 'ForDefi created a transaction and returned no id')
  }
  if (failedDefinitively(outcome.state)) {
    throw new W3ActionError(
      'CALL_FAILED',
      `contract call failed: state='${outcome.state}', transaction_id='${outcome.transaction_id}'`,
    )
  }
}
