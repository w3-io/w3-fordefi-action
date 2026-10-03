/**
 * What a create told the step, and what the step may claim from it.
 *
 * A step that creates a custody transaction is read by a consumer that
 * cannot see ForDefi: it has the step's outputs and the step's result. These
 * helpers keep three facts apart for it. A transaction ForDefi named is in
 * the outputs. A refusal ForDefi gave to the only request it could have
 * processed is reported with its status. Everything else (a timeout, a 5xx,
 * a 2xx that names nothing, a refusal after an unanswered attempt) is
 * reported as the unknown it is, because a transaction may exist that the
 * step cannot name.
 */

import { W3ActionError } from '@w3-io/action-core'

/**
 * The named outputs of a ForDefi transaction response. `tx_hash` is the
 * on-chain hash (`hash`), empty while ForDefi has none; it is never the
 * ForDefi id (`id`), which names no on-chain transaction.
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

/** The states ForDefi names as failed, on which a step fails while still
 *  naming the transaction. They are ForDefi's verdict, not settlement: a
 *  transaction that was signed before it reached one can still be broadcast,
 *  so the consumer decides settlement from the chain. Every other state,
 *  including one this set does not know, passes. */
const TERMINAL_FAILURE = new Set([
  'aborted',
  'error_pushing_to_blockchain',
  'error_signing',
  'dropped',
  'cancelled',
  'mined_reverted',
  'completed_reverted',
])

/** Whether `state` is one ForDefi names as a definitive non-settlement. */
export function failedDefinitively(state) {
  return TERMINAL_FAILURE.has(state)
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
 * Fail the step on a 2xx response that names no transaction. The custodian
 * answered, so a transaction may exist, and the step has no id to report it
 * by. It fails with no status code: a consumer must not read it as a
 * refusal.
 */
export function assertNamed(outcome) {
  if (!outcome.transaction_id) {
    throw new W3ActionError('INVALID_RESPONSE', 'ForDefi created a transaction and returned no id')
  }
}
