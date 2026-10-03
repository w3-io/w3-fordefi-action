/**
 * ForDefiClient unit tests.
 *
 * Mocks `fetch` globally so we can test the client without hitting
 * the real ForDefi API.
 *
 * Run with: npm test
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { ForDefiClient, retryAfterMs } from '../src/client.js'
import { extractOutcome } from '../src/outcome.js'
import { assertNotFailed, buildTransferPayload, encodeErc20Transfer } from '../src/transfer.js'
import { W3ActionError } from '@w3-io/action-core'

const VAULTS_RESPONSE = {
  vaults: [
    { id: 'vault-1', name: 'Main Vault', type: 'default' },
    { id: 'vault-2', name: 'Trading Vault', type: 'default' },
  ],
}

let originalFetch
let calls

beforeEach(() => {
  originalFetch = global.fetch
  calls = []
})

afterEach(() => {
  global.fetch = originalFetch
})

function mockFetch(responses) {
  let index = 0
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    const response = responses[index++]
    if (!response) {
      throw new Error(`Unexpected fetch call ${index}: ${url}`)
    }
    const status = response.status ?? 200
    const ok = status >= 200 && status < 300
    return {
      ok,
      status,
      headers: new Map([['content-type', 'application/json']]),
      text: async () =>
        typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {}),
      json: async () => response.body ?? {},
    }
  }
}

describe('ForDefiClient: constructor', () => {
  it('requires access token', () => {
    assert.throws(
      () => new ForDefiClient({}),
      (err) => err instanceof W3ActionError && err.code === 'MISSING_ACCESS_TOKEN',
    )
  })

  it('accepts valid config', () => {
    const client = new ForDefiClient({ accessToken: 'test-token' })
    assert.ok(client)
  })

  it('strips trailing slashes from base URL', () => {
    const client = new ForDefiClient({
      accessToken: 'test-token',
      baseUrl: 'https://api.fordefi.com///',
    })
    assert.ok(client)
  })
})

describe('ForDefiClient: listVaults', () => {
  it('returns vaults from API', async () => {
    mockFetch([{ body: VAULTS_RESPONSE }])
    const client = new ForDefiClient({ accessToken: 'test-token' })

    const result = await client.listVaults()

    assert.deepEqual(result, VAULTS_RESPONSE)
    assert.ok(calls[0].url.includes('/api/v1/vaults'))
  })

  it('passes query parameters', async () => {
    mockFetch([{ body: VAULTS_RESPONSE }])
    const client = new ForDefiClient({ accessToken: 'test-token' })

    await client.listVaults({ page_size: '10' })

    assert.ok(calls[0].url.includes('page_size=10'))
  })

  it('sends Authorization header', async () => {
    mockFetch([{ body: VAULTS_RESPONSE }])
    const client = new ForDefiClient({ accessToken: 'my-jwt' })

    await client.listVaults()

    assert.equal(calls[0].options.headers.Authorization, 'Bearer my-jwt')
  })
})

describe('ForDefiClient: error handling', () => {
  it('throws W3ActionError on 4xx error', async () => {
    mockFetch([{ status: 403, body: 'Forbidden' }])
    const client = new ForDefiClient({ accessToken: 'test-token' })

    await assert.rejects(
      () => client.listVaults(),
      (err) => err instanceof W3ActionError && err.code === 'HTTP_ERROR' && err.statusCode === 403,
    )
  })
})

const TO = '0x1111111111111111111111111111111111111111'
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

describe('transfer: encodeErc20Transfer', () => {
  it('is selector + 32-byte address word + 32-byte amount word', () => {
    const data = encodeErc20Transfer(TO, '256') // 256 = 0x100
    assert.ok(data.startsWith('0xa9059cbb'))
    assert.equal(data.length, 2 + 8 + 64 + 64)
    assert.equal(data.slice(10, 74), '0'.repeat(24) + '1'.repeat(40))
    assert.equal(data.slice(74), (256).toString(16).padStart(64, '0'))
  })
})

describe('transfer: buildTransferPayload', () => {
  it('native transfer pays value to the destination, no calldata', () => {
    const p = buildTransferPayload({
      vaultId: 'v',
      chain: 'avalanche_chain',
      to: TO,
      amount: '1000',
      asset: 'native',
    })
    assert.equal(p.vault_id, 'v')
    assert.equal(p.signer_type, 'api_signer')
    assert.equal(p.wait_for_state, 'completed')
    assert.equal(p.details.type, 'evm_raw_transaction')
    assert.equal(p.details.to, TO)
    assert.equal(p.details.value, '1000')
    assert.equal(p.details.data, undefined)
  })

  it('ERC-20 transfer calls the token contract with encoded calldata and zero value', () => {
    const p = buildTransferPayload({
      vaultId: 'v',
      chain: 'ethereum_mainnet',
      to: TO,
      amount: '5',
      asset: USDC_ETH,
    })
    assert.equal(p.details.to, USDC_ETH.toLowerCase())
    assert.equal(p.details.value, '0')
    assert.equal(p.details.data.type, 'hex')
    assert.equal(p.details.data.hex_data, encodeErc20Transfer(TO, '5'))
  })

  it('rejects a bad destination, non-integer amount, and negative amount', () => {
    const bad = (o) => buildTransferPayload({ vaultId: 'v', chain: 'c', to: TO, amount: '1', ...o })
    assert.throws(
      () => bad({ to: 'nope' }),
      (e) => e.code === 'INVALID_ADDRESS',
    )
    assert.throws(
      () => bad({ amount: '1.5' }),
      (e) => e.code === 'INVALID_AMOUNT',
    )
    assert.throws(
      () => bad({ amount: '-1' }),
      (e) => e.code === 'INVALID_AMOUNT',
    )
  })
})

describe('transfer: extractOutcome', () => {
  it('maps the honest named outcome', () => {
    assert.deepEqual(
      extractOutcome({
        id: 'fd-uuid',
        hash: '0xabc',
        state: 'completed',
        explorer_url: 'https://x/tx/0xabc',
      }),
      {
        tx_hash: '0xabc',
        transaction_id: 'fd-uuid',
        state: 'completed',
        explorer_url: 'https://x/tx/0xabc',
      },
    )
  })

  it('leaves tx_hash empty when unmined — never the ForDefi UUID', () => {
    const o = extractOutcome({ id: 'fd-uuid', hash: null, state: 'mining' })
    assert.equal(o.tx_hash, '')
    assert.notEqual(o.tx_hash, 'fd-uuid')
    assert.equal(o.transaction_id, 'fd-uuid')
  })
})

describe('transfer: assertNotFailed', () => {
  it('passes an on-chain or in-flight transfer', () => {
    for (const state of ['pushed_to_blockchain', 'mined', 'completed', 'stuck', 'queued']) {
      assert.doesNotThrow(() => assertNotFailed({ state, transaction_id: 'fd', tx_hash: '0xabc' }))
    }
  })

  it('passes an unrecognized state — defers to the chain oracle, not a failure', () => {
    assert.doesNotThrow(() => assertNotFailed({ state: 'some_future_state', transaction_id: 'fd' }))
  })

  it('passes a not-yet-broadcast transfer with no hash — a delay is not a failure', () => {
    assert.doesNotThrow(() =>
      assertNotFailed({ state: 'signed', transaction_id: 'fd', tx_hash: '' }),
    )
  })

  it('throws on a response that names no transaction', () => {
    assert.throws(
      () => assertNotFailed({ state: 'completed', transaction_id: '', tx_hash: '' }),
      (e) => e instanceof W3ActionError && e.code === 'INVALID_RESPONSE',
    )
  })

  it('throws on a definitive non-settlement', () => {
    for (const state of [
      'mined_reverted',
      'completed_reverted',
      'aborted',
      'error_pushing_to_blockchain',
      'error_signing',
      'dropped',
      'cancelled',
    ]) {
      assert.throws(
        () => assertNotFailed({ state, transaction_id: 'fd', tx_hash: '0xabc' }),
        (e) => e instanceof W3ActionError && e.code === 'TRANSFER_FAILED',
      )
    }
  })
})

describe('ForDefiClient: send deadline', () => {
  const signer = () =>
    generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    })

  it('sends nothing at or after the deadline', async () => {
    mockFetch([{ body: { id: 'fd' } }])
    const client = new ForDefiClient({ accessToken: 'test-token', privateKey: signer() })
    for (const notAfter of [Date.now() - 1, Date.now()]) {
      await assert.rejects(
        () => client.createTransaction({ vault_id: 'v' }, { idempotenceId: 'k', notAfter }),
        (err) =>
          err instanceof W3ActionError &&
          err.code === 'DEADLINE_PASSED' &&
          err.statusCode === undefined &&
          err.details.unsettled === false,
      )
    }
    assert.equal(calls.length, 0)
  })

  it('signs no request whose timestamp is not earlier than the deadline', async () => {
    // The clock reads exactly the deadline when the request is signed. The
    // refusal names the signed timestamp, and nothing is signed or sent.
    mockFetch([{ body: { id: 'fd' } }])
    const client = new ForDefiClient({ accessToken: 'test-token', privateKey: signer() })
    const notAfter = Date.now() + 60_000
    const realNow = Date.now
    Date.now = () => notAfter
    try {
      await assert.rejects(
        () => client.createTransaction({ vault_id: 'v' }, { idempotenceId: 'k', notAfter }),
        (err) =>
          err instanceof W3ActionError &&
          err.code === 'DEADLINE_PASSED' &&
          /signed timestamp/.test(err.message),
      )
    } finally {
      Date.now = realNow
    }
    assert.equal(calls.length, 0)
  })

  it('sends every attempt under one signed timestamp earlier than the deadline', async () => {
    // A retry reuses the request signed once, so ForDefi's signature window
    // runs from a timestamp before the deadline on every attempt.
    mockFetch([{ status: 503, body: {} }, { body: { id: 'fd' } }])
    const client = new ForDefiClient({ accessToken: 'test-token', privateKey: signer() })
    const notAfter = Date.now() + 60_000
    const result = await client.createTransaction(
      { vault_id: 'v' },
      { idempotenceId: 'k', notAfter },
    )
    assert.equal(result.id, 'fd')
    assert.equal(calls.length, 2)
    const stamps = calls.map((c) => Number(c.options.headers['x-timestamp']))
    assert.equal(stamps[0], stamps[1])
    assert.ok(stamps[0] < notAfter)
    assert.equal(calls[0].options.headers['x-signature'], calls[1].options.headers['x-signature'])
  })

  it('decides each attempt on the clock reading it was started under', async () => {
    // The clock reads one millisecond before the deadline when the attempt is
    // checked, and the deadline itself on every later reading. The attempt
    // was allowed on the earlier reading, so no reading taken between that
    // check and the send may say the deadline has passed.
    const notAfter = Date.UTC(2026, 9, 3, 1, 0, 0)
    const readings = [notAfter - 5_000, notAfter - 1]
    const seen = []
    const realNow = Date.now
    Date.now = () => {
      const t = readings.length ? readings.shift() : notAfter
      seen.push(t)
      return t
    }
    let readingsAtSend
    global.fetch = async () => {
      readingsAtSend = seen.length
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ id: 'fd' }),
      }
    }
    try {
      const client = new ForDefiClient({ accessToken: 'test-token', privateKey: signer() })
      await client.createTransaction({ vault_id: 'v' }, { idempotenceId: 'k', notAfter })
    } finally {
      Date.now = realNow
    }
    assert.ok(readingsAtSend > 0)
    assert.ok(seen.slice(0, readingsAtSend).every((t) => t < notAfter))
  })

  it('sends before the deadline', async () => {
    mockFetch([{ body: { id: 'fd' } }])
    const client = new ForDefiClient({ accessToken: 'test-token', privateKey: signer() })
    const result = await client.createTransaction(
      { vault_id: 'v' },
      { idempotenceId: 'k', notAfter: Date.now() + 60_000 },
    )
    assert.equal(result.id, 'fd')
    assert.equal(calls.length, 1)
  })
})

describe('ForDefiClient: retryAfterMs', () => {
  const now = Date.UTC(2026, 9, 3, 1, 0, 0)

  it('reads delay-seconds', () => {
    assert.equal(retryAfterMs('0', now), 0)
    assert.equal(retryAfterMs('120', now), 120_000)
  })

  it('reads an HTTP-date as the time until it, never negative', () => {
    assert.equal(retryAfterMs('Sat, 03 Oct 2026 01:02:00 GMT', now), 120_000)
    assert.equal(retryAfterMs('Sat, 03 Oct 2026 00:59:00 GMT', now), 0)
  })

  it('reads anything else as no request', () => {
    for (const v of [null, undefined, '', '1.5', '-1', '12abc', '2026-10-03T01:02:00Z', 'soon']) {
      assert.equal(retryAfterMs(v, now), null)
    }
  })
})

describe('ForDefiClient: idempotency', () => {
  it('sets x-idempotence-id when a key is given', async () => {
    mockFetch([{ body: { ok: true } }])
    const client = new ForDefiClient({ accessToken: 'test-token' })

    await client.post('/api/v1/x', { a: 1 }, { idempotenceId: 'idem-123' })

    assert.equal(calls[0].options.headers['x-idempotence-id'], 'idem-123')
  })

  it('omits the header when no key is given', async () => {
    mockFetch([{ body: { ok: true } }])
    const client = new ForDefiClient({ accessToken: 'test-token' })

    await client.post('/api/v1/x', { a: 1 })

    assert.equal(calls[0].options.headers['x-idempotence-id'], undefined)
  })

  it('createTransactionAndWait forwards the key alongside the signature', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
    mockFetch([{ body: { id: 'fd', hash: '0xabc', state: 'completed' } }])
    const client = new ForDefiClient({ accessToken: 'test-token', privateKey: pem })

    await client.createTransactionAndWait({ vault_id: 'v' }, { idempotenceId: 'w-1' })

    assert.equal(calls[0].options.headers['x-idempotence-id'], 'w-1')
    assert.ok(calls[0].options.headers['x-signature'])
  })
})
