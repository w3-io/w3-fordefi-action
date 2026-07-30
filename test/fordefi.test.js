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
import { ForDefiClient } from '../src/client.js'
import { buildTransferPayload, encodeErc20Transfer, extractOutcome } from '../src/transfer.js'
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
