/**
 * transfer-out, as a step: what the runner sees for each answer ForDefi can
 * give to the create, run end to end through `harness.js`.
 *
 * Run with: npm test
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startStandIn } from './harness.js'

const TO = '0x1111111111111111111111111111111111111111'
const KEY = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'
const HASH = '0x' + 'ab'.repeat(32)
const COMPLETED = { id: 'fd-uuid', state: 'completed', hash: HASH }

describe('transfer-out: the step', () => {
  let standIn

  before(async () => {
    standIn = await startStandIn()
  })

  after(() => standIn.close())

  /** Run a keyed native transfer-out, overridden by `inputs`. */
  const run = (inputs, response) =>
    standIn.run(
      {
        command: 'transfer-out',
        'vault-id': 'vault-1',
        chain: 'avalanche_chain',
        to: TO,
        asset: 'native',
        amount: '1000',
        'idempotence-id': KEY,
        ...inputs,
      },
      response,
    )

  it('names the transaction and its hash on a completed transfer', async () => {
    const r = await run({}, { status: 200, json: COMPLETED })
    assert.equal(r.code, 0)
    assert.equal(r.requests.length, 1)
    assert.equal(r.requests[0].url, '/api/v1/transactions/create-and-wait')
    assert.equal(r.requests[0].headers['x-idempotence-id'], KEY)
    assert.equal(r.outputs.transaction_id, 'fd-uuid')
    assert.equal(r.outputs.tx_hash, HASH)
    assert.equal(r.outputs.state, 'completed')
  })

  it('fails on a refused create with no transaction_id and the refusal status', async () => {
    const r = await run({}, { status: 400, json: { error_type: 'insufficient_funds' } })
    assert.equal(r.code, 1)
    assert.equal(r.requests.length, 1)
    assert.equal(r.outputs.transaction_id, undefined)
    assert.equal(r.outputs['error-code'], 'HTTP_ERROR')
    assert.equal(r.outputs['status-code'], '400')
  })

  it('retries a keyed create after an unanswered attempt, under the same key', async () => {
    const r = await run({}, (n) =>
      n === 1 ? { status: 503, json: {} } : { status: 200, json: COMPLETED },
    )
    assert.equal(r.code, 0)
    assert.equal(r.requests.length, 2)
    assert.equal(r.requests[1].headers['x-idempotence-id'], KEY)
    assert.equal(r.outputs.transaction_id, 'fd-uuid')
  })

  it('reports a refusal that follows an unanswered attempt as ambiguous, with no status', async () => {
    // The first attempt may have moved the money. A status here would be
    // read as "nothing was created".
    const r = await run({}, (n) =>
      n === 1 ? { status: 503, json: {} } : { status: 400, json: { error_type: 'x' } },
    )
    assert.equal(r.code, 1)
    assert.equal(r.requests.length, 2)
    assert.equal(r.outputs.transaction_id, undefined)
    assert.equal(r.outputs['error-code'], 'AMBIGUOUS_CREATE')
    assert.equal(r.outputs['status-code'], undefined)
  })

  it('sends an unkeyed create once: a 5xx is not retried', async () => {
    // Nothing ties a second request to the first, so a retry could transfer
    // twice.
    const r = await run({ 'idempotence-id': undefined }, { status: 503, json: {} })
    assert.equal(r.code, 1)
    assert.equal(r.requests.length, 1)
    assert.equal(r.requests[0].headers['x-idempotence-id'], undefined)
    assert.equal(r.outputs['error-code'], 'HTTP_ERROR')
    assert.equal(r.outputs['status-code'], '503')
  })

  it('still retries an unkeyed create after a 429, which processed nothing', async () => {
    const r = await run({ 'idempotence-id': undefined }, (n) =>
      n === 1 ? { status: 429, json: {} } : { status: 200, json: COMPLETED },
    )
    assert.equal(r.code, 0)
    assert.equal(r.requests.length, 2)
    assert.equal(r.outputs.transaction_id, 'fd-uuid')
  })

  it('fails on a 2xx that names no transaction, as an invalid response', async () => {
    const r = await run({}, { status: 200, json: { state: 'completed' } })
    assert.equal(r.code, 1)
    assert.equal(r.outputs.transaction_id, '')
    assert.equal(r.outputs['error-code'], 'INVALID_RESPONSE')
    assert.equal(r.outputs['status-code'], undefined)
  })

  it('fails on a definitive failure state, naming the transaction it failed on', async () => {
    const r = await run(
      {},
      { status: 200, json: { id: 'fd-uuid', state: 'mined_reverted', hash: HASH } },
    )
    assert.equal(r.code, 1)
    assert.equal(r.outputs.transaction_id, 'fd-uuid')
    assert.equal(r.outputs.tx_hash, HASH)
    assert.equal(r.outputs['error-code'], 'TRANSFER_FAILED')
  })
})
