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
import { ForDefiClient } from '../src/client.js'
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
