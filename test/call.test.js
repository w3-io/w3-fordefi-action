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
} from '../src/call.js'
import { createFailure } from '../src/outcome.js'
import { W3ActionError } from '@w3-io/action-core'
import { startStandIn } from './harness.js'

const VENUE = '0x061329361E0f163125225bf71a1E5AF954b46869'
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

  it('refuses malformed calldata before any request', async () => {
    const r = await run({ calldata: '0x6e553f6' }, { status: 201, json: { id: 'x' } })
    assert.equal(r.code, 1)
    assert.equal(requests.length, 0)
    assert.equal(r.outputs['error-code'], 'INVALID_CALLDATA')
  })
})
