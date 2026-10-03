/**
 * call-contract tests.
 *
 * The payload builders are tested as pure functions. The step's contract with
 * its consumer (which outputs exist when it fails) is tested end to end
 * through `harness.js`.
 *
 * Run with: npm test
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertCallCreated,
  buildCallPayload,
  parseCalldata,
  parseIdempotenceId,
  parseNotAfter,
} from '../src/call.js'
import { createFailure } from '../src/outcome.js'
import { W3ActionError } from '@w3-io/action-core'
import { startStandIn } from './harness.js'

const VENUE = '0x061329361E0f163125225bf71a1E5AF954b46869'

/** An instant `seconds` from now (negative: in the past), as an input. */
const soon = (seconds) => new Date(Date.now() + seconds * 1000).toISOString()
const KEY = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'
// deposit(uint256 5000000, address receiver)
const CALLDATA =
  '0x6e553f65' +
  '00000000000000000000000000000000000000000000000000000000004c4b40' +
  '000000000000000000000000099703d7de5d11979fc8df5a86f006f5cd5a180e'

describe('call: parseIdempotenceId', () => {
  it('accepts a UUID and lowercases it', () => {
    assert.equal(parseIdempotenceId(KEY.toUpperCase()), KEY)
  })

  it('refuses an absent key', () => {
    for (const v of ['', '   ', undefined, null]) {
      assert.throws(
        () => parseIdempotenceId(v),
        (e) => e instanceof W3ActionError && e.code === 'MISSING_INPUT',
      )
    }
  })

  it('refuses a key that is not a UUID', () => {
    for (const v of ['allocation-1', KEY.replaceAll('-', ''), `${KEY}0`]) {
      assert.throws(
        () => parseIdempotenceId(v),
        (e) => e.code === 'INVALID_IDEMPOTENCE_ID',
      )
    }
  })
})

describe('call: parseNotAfter', () => {
  it('reads an RFC 3339 UTC instant as epoch milliseconds', () => {
    assert.equal(parseNotAfter('2026-10-02T20:15:00.000Z'), Date.UTC(2026, 9, 2, 20, 15, 0))
    assert.equal(parseNotAfter('2026-10-02T20:15:00Z'), Date.UTC(2026, 9, 2, 20, 15, 0))
    assert.equal(parseNotAfter(' 2026-10-02T20:15:00.5Z '), Date.UTC(2026, 9, 2, 20, 15, 0, 500))
  })

  it('drops fractions past the millisecond, moving the deadline earlier', () => {
    assert.equal(parseNotAfter('2026-10-02T20:15:00.123999Z'), Date.UTC(2026, 9, 2, 20, 15, 0, 123))
  })

  it('refuses an absent deadline', () => {
    for (const v of ['', '  ', undefined, null]) {
      assert.throws(
        () => parseNotAfter(v),
        (e) => e instanceof W3ActionError && e.code === 'MISSING_INPUT',
      )
    }
  })

  it('refuses a deadline that is not a UTC instant', () => {
    for (const v of [
      '2026-10-02T20:15:00+00:00',
      '2026-10-02T20:15:00',
      '2026-10-02',
      '1790972100',
      '2026-13-02T20:15:00Z',
      '2026-02-30T20:15:00Z',
      '2026-04-31T00:00:00.000Z',
      '2026-10-02T24:00:00Z',
      '2026-10-02T23:59:60Z',
      '2026-10-02T20:60:00Z',
      'soon',
    ]) {
      assert.throws(
        () => parseNotAfter(v),
        (e) => e.code === 'INVALID_NOT_AFTER',
      )
    }
  })
})

describe('call: parseCalldata', () => {
  it('accepts whole bytes from a bare selector up, and lowercases', () => {
    assert.equal(parseCalldata('0x6E553F65'), '0x6e553f65')
    assert.equal(parseCalldata(CALLDATA), CALLDATA)
  })

  it('refuses empty, short, odd-length, unprefixed and non-hex calldata', () => {
    for (const v of ['', '0x', '0x6e553f', '0x6e553f650', '6e553f65', '0x6e553g65']) {
      assert.throws(
        () => parseCalldata(v),
        (e) => e.code === 'INVALID_CALLDATA',
      )
    }
  })
})

describe('call: buildCallPayload', () => {
  const base = { vaultId: 'v', chain: 'avalanche_chain', to: VENUE, calldata: CALLDATA }

  it('is a raw EVM transaction carrying the calldata, with no wait', () => {
    const p = buildCallPayload({ ...base, note: 'Allocation 1, deposit' })
    assert.deepEqual(p, {
      vault_id: 'v',
      signer_type: 'api_signer',
      type: 'evm_transaction',
      details: {
        type: 'evm_raw_transaction',
        chain: 'avalanche_chain',
        to: VENUE.toLowerCase(),
        value: '0',
        data: { type: 'hex', hex_data: CALLDATA },
        gas: { type: 'priority', priority_level: 'medium' },
      },
      note: 'Allocation 1, deposit',
    })
  })

  it('sends the native value given, and zero when none is', () => {
    assert.equal(buildCallPayload(base).details.value, '0')
    assert.equal(buildCallPayload({ ...base, value: '1000' }).details.value, '1000')
    assert.equal(buildCallPayload(base).note, undefined)
  })

  it('is a plain transfer of the chain coin when there is no calldata', () => {
    for (const calldata of [undefined, '']) {
      const p = buildCallPayload({ ...base, calldata, value: '1000' })
      assert.equal(p.details.value, '1000')
      assert.equal('data' in p.details, false)
      assert.equal(p.details.to, VENUE.toLowerCase())
    }
  })

  it('refuses a transaction with neither calldata nor value', () => {
    for (const value of [undefined, '0']) {
      assert.throws(
        () => buildCallPayload({ ...base, calldata: undefined, value }),
        (e) => e.code === 'MISSING_INPUT',
      )
    }
  })

  it('refuses a bad target, value, or calldata, and a missing vault or chain', () => {
    const code = (o) => {
      try {
        buildCallPayload({ ...base, ...o })
      } catch (e) {
        return e.code
      }
      return null
    }
    assert.equal(code({ to: 'nope' }), 'INVALID_ADDRESS')
    assert.equal(code({ value: '1.5' }), 'INVALID_AMOUNT')
    assert.equal(code({ value: '-1' }), 'INVALID_AMOUNT')
    assert.equal(code({ value: (1n << 256n).toString() }), 'INVALID_AMOUNT')
    assert.equal(code({ calldata: '0x' }), 'INVALID_CALLDATA')
    assert.equal(code({ vaultId: '' }), 'MISSING_INPUT')
    assert.equal(code({ chain: '' }), 'MISSING_INPUT')
  })
})

describe('call: assertCallCreated', () => {
  it('passes a transaction awaiting approval, in flight, on chain, or in an unknown state', () => {
    for (const state of [
      'waiting_for_approval',
      'approved',
      'signed',
      'pushed_to_blockchain',
      'mined',
      'completed',
      'some_future_state',
    ]) {
      assert.doesNotThrow(() => assertCallCreated({ state, transaction_id: 'fd' }))
    }
  })

  it('throws on a definitive non-settlement', () => {
    for (const state of ['aborted', 'error_signing', 'mined_reverted', 'cancelled']) {
      assert.throws(
        () => assertCallCreated({ state, transaction_id: 'fd' }),
        (e) => e instanceof W3ActionError && e.code === 'CALL_FAILED',
      )
    }
  })

  it('throws on a response that names no transaction', () => {
    assert.throws(
      () => assertCallCreated({ state: 'waiting_for_approval', transaction_id: '' }),
      (e) => e.code === 'INVALID_RESPONSE',
    )
  })
})

describe('outcome: createFailure', () => {
  const http = (statusCode, unsettled) =>
    new W3ActionError('HTTP_ERROR', `${statusCode}: {}`, { statusCode, details: { unsettled } })

  it('keeps a refusal that answered the first request, with its status', () => {
    const e = createFailure(http(400, false))
    assert.equal(e.code, 'HTTP_ERROR')
    assert.equal(e.statusCode, 400)
  })

  it('strips the status from a refusal that followed an unanswered attempt', () => {
    const e = createFailure(http(400, true))
    assert.equal(e.code, 'AMBIGUOUS_CREATE')
    assert.equal(e.statusCode, undefined)
  })

  it('passes a 5xx and any other error through', () => {
    assert.equal(createFailure(http(503, true)).code, 'HTTP_ERROR')
    const timeout = new W3ActionError('TIMEOUT', 'timed out')
    assert.equal(createFailure(timeout), timeout)
    const raw = new TypeError('fetch failed')
    assert.equal(createFailure(raw), raw)
  })
})

describe('call-contract: the step', () => {
  let standIn
  let requests

  before(async () => {
    standIn = await startStandIn()
  })

  after(() => standIn.close())

  /** Run call-contract with a complete set of inputs, overridden by `inputs`. */
  async function run(inputs, response) {
    const r = await standIn.run(
      {
        command: 'call-contract',
        'vault-id': 'vault-1',
        chain: 'avalanche_chain',
        to: VENUE,
        calldata: CALLDATA,
        'idempotence-id': KEY,
        'not-after': soon(3600),
        ...inputs,
      },
      response,
    )
    requests = r.requests
    return r
  }

  it('creates once under the key, without waiting, and names the transaction', async () => {
    const tx = { id: 'fd-uuid', state: 'waiting_for_approval' }
    const r = await run({ note: 'Allocation 1, approve' }, { status: 201, json: tx })

    assert.equal(r.code, 0)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'POST')
    assert.equal(requests[0].url, '/api/v1/transactions')
    assert.equal(requests[0].headers['x-idempotence-id'], KEY)
    assert.ok(requests[0].headers['x-signature'])
    const body = JSON.parse(requests[0].body)
    assert.equal(body.wait_for_state, undefined)
    assert.equal(body.vault_id, 'vault-1')
    assert.equal(body.details.to, VENUE.toLowerCase())
    assert.equal(body.details.data.hex_data, CALLDATA)
    assert.equal(body.details.value, '0')
    assert.equal(body.note, 'Allocation 1, approve')

    assert.equal(r.outputs.transaction_id, 'fd-uuid')
    assert.equal(r.outputs.state, 'waiting_for_approval')
    assert.equal(r.outputs.tx_hash, '')
    assert.deepEqual(JSON.parse(r.outputs.result), tx)
  })

  it('surfaces the hash when ForDefi already has one', async () => {
    const hash = '0x' + 'ab'.repeat(32)
    const r = await run({}, { status: 201, json: { id: 'fd-uuid', state: 'mined', hash } })
    assert.equal(r.code, 0)
    assert.equal(r.outputs.tx_hash, hash)
  })

  it('fails on a definitive failure state, naming the transaction it failed on', async () => {
    const r = await run({}, { status: 201, json: { id: 'fd-uuid', state: 'aborted' } })
    assert.equal(r.code, 1)
    assert.equal(r.outputs.transaction_id, 'fd-uuid')
    assert.equal(r.outputs.state, 'aborted')
    assert.equal(r.outputs['error-code'], 'CALL_FAILED')
  })

  it('fails on a refused create with no transaction_id and the refusal status', async () => {
    const refusal = { title: 'Bad Request', detail: 'reverted', error_type: 'reverted_transaction' }
    const r = await run({}, { status: 400, json: refusal })
    assert.equal(r.code, 1)
    assert.equal(requests.length, 1)
    assert.equal(r.outputs.transaction_id, undefined)
    assert.equal(r.outputs.tx_hash, undefined)
    assert.equal(r.outputs['error-code'], 'HTTP_ERROR')
    assert.equal(r.outputs['status-code'], '400')
    assert.match(r.stdout, /reverted_transaction/)
  })

  it('reports a refusal that follows an unanswered attempt as ambiguous, with no status', async () => {
    const r = await run({}, (n) =>
      n === 1 ? { status: 503, json: {} } : { status: 400, json: { error_type: 'x' } },
    )
    assert.equal(r.code, 1)
    assert.equal(requests.length, 2)
    assert.equal(requests[1].headers['x-idempotence-id'], KEY)
    assert.equal(r.outputs.transaction_id, undefined)
    assert.equal(r.outputs['error-code'], 'AMBIGUOUS_CREATE')
    assert.equal(r.outputs['status-code'], undefined)
  })

  it('names the transaction a retried create returns', async () => {
    const r = await run({}, (n) =>
      n === 1
        ? { status: 503, json: {} }
        : { status: 201, json: { id: 'fd-uuid', state: 'approved' } },
    )
    assert.equal(r.code, 0)
    assert.equal(requests.length, 2)
    assert.equal(r.outputs.transaction_id, 'fd-uuid')
  })

  it('fails on a 2xx that names no transaction, as an invalid response', async () => {
    const r = await run({}, { status: 201, json: { state: 'waiting_for_approval' } })
    assert.equal(r.code, 1)
    assert.equal(r.outputs.transaction_id, '')
    assert.equal(r.outputs['error-code'], 'INVALID_RESPONSE')
    assert.equal(r.outputs['status-code'], undefined)
  })

  it('refuses a missing idempotence key before any request', async () => {
    const r = await run({ 'idempotence-id': undefined }, { status: 201, json: { id: 'x' } })
    assert.equal(r.code, 1)
    assert.equal(requests.length, 0)
    assert.equal(r.outputs.transaction_id, undefined)
    assert.equal(r.outputs['error-code'], 'MISSING_INPUT')
  })

  it('sends a plain transfer when there is no calldata', async () => {
    const r = await run(
      { calldata: undefined, value: '1000' },
      { status: 201, json: { id: 'fd-uuid', state: 'approved' } },
    )
    assert.equal(r.code, 0)
    const body = JSON.parse(requests[0].body)
    assert.equal(body.details.value, '1000')
    assert.equal('data' in body.details, false)
  })

  it('refuses a missing deadline before any request', async () => {
    const r = await run({ 'not-after': undefined }, { status: 201, json: { id: 'x' } })
    assert.equal(r.code, 1)
    assert.equal(requests.length, 0)
    assert.equal(r.outputs['error-code'], 'MISSING_INPUT')
  })

  it('refuses a malformed deadline before any request', async () => {
    const r = await run({ 'not-after': 'tomorrow' }, { status: 201, json: { id: 'x' } })
    assert.equal(r.code, 1)
    assert.equal(requests.length, 0)
    assert.equal(r.outputs['error-code'], 'INVALID_NOT_AFTER')
  })

  it('sends nothing once the deadline has passed', async () => {
    const r = await run({ 'not-after': soon(-1) }, { status: 201, json: { id: 'x' } })
    assert.equal(r.code, 1)
    assert.equal(requests.length, 0)
    assert.equal(r.outputs.transaction_id, undefined)
    assert.equal(r.outputs['error-code'], 'DEADLINE_PASSED')
    assert.equal(r.outputs['status-code'], undefined)
  })

  it('does not wait out a retry that would reach the deadline', async () => {
    // The stand-in asks for a 60 s wait and the deadline is 20 s away. The
    // step refuses at once: it neither sleeps past the deadline nor sends
    // after it, and it says the first attempt went unanswered.
    const started = Date.now()
    const r = await run(
      { 'not-after': soon(20) },
      { status: 503, json: {}, headers: { 'retry-after': '60' } },
    )
    assert.equal(r.code, 1)
    assert.equal(requests.length, 1)
    assert.ok(Date.now() - started < 10_000)
    assert.equal(r.outputs.transaction_id, undefined)
    assert.equal(r.outputs['error-code'], 'DEADLINE_PASSED')
    assert.match(r.stdout, /an earlier attempt went unanswered/)
  })

  it('does not wait out a rate limit that would reach the deadline', async () => {
    const r = await run(
      { 'not-after': soon(20) },
      { status: 429, json: {}, headers: { 'retry-after': '60' } },
    )
    assert.equal(r.code, 1)
    assert.equal(requests.length, 1)
    assert.equal(r.outputs['error-code'], 'DEADLINE_PASSED')
    assert.doesNotMatch(r.stdout, /went unanswered/)
  })

  it('abandons an attempt still in flight at the deadline', async () => {
    // The stand-in holds its answer for 30 s and the deadline is 2 s away.
    // The step stops waiting at the deadline, sends nothing more, and says
    // the attempt went unanswered.
    const started = Date.now()
    const r = await run(
      { 'not-after': soon(2) },
      { status: 201, json: { id: 'fd-uuid', state: 'approved' }, delayMs: 30_000 },
    )
    assert.equal(r.code, 1)
    assert.equal(requests.length, 1)
    assert.ok(Date.now() - started < 10_000)
    assert.equal(r.outputs.transaction_id, undefined)
    assert.equal(r.outputs['error-code'], 'DEADLINE_PASSED')
    assert.match(r.stdout, /an earlier attempt went unanswered/)
  })

  it('retries inside the deadline', async () => {
    const r = await run({ 'not-after': soon(20) }, (n) =>
      n === 1
        ? { status: 503, json: {} }
        : { status: 201, json: { id: 'fd-uuid', state: 'approved' } },
    )
    assert.equal(r.code, 0)
    assert.equal(requests.length, 2)
    assert.equal(r.outputs.transaction_id, 'fd-uuid')
  })

  it('refuses malformed calldata before any request', async () => {
    const r = await run({ calldata: '0x6e553f6' }, { status: 201, json: { id: 'x' } })
    assert.equal(r.code, 1)
    assert.equal(requests.length, 0)
    assert.equal(r.outputs['error-code'], 'INVALID_CALLDATA')
  })
})
