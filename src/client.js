/**
 * ForDefi API client.
 *
 * Handles Bearer token auth for all requests and ECDSA P-256 request
 * signing for transactional operations. HTTP goes through fetchWithRetry
 * with 30s timeout, retry on 429/5xx, and 204 No Content handling.
 *
 * ForDefi API docs: https://docs.fordefi.com/
 * Base URLs:
 *   Production: https://api.fordefi.com
 *   Sandbox:    https://api.sandbox.fordefi.com
 */

import { createSign } from 'node:crypto'
import { W3ActionError } from '@w3-io/action-core'

let _bridge = null

/**
 * Set a bridge function for P-256 signing via the W3 bridge.
 * When set, the client delegates signing to the bridge instead of
 * using a local PEM key — the key never enters the container.
 */
export function setBridgeSigner(bridgeFn) {
  _bridge = bridgeFn
}

const DEFAULT_BASE_URL = 'https://api.fordefi.com'
const TIMEOUT_MS = 30_000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

/**
 * Fetch with retry on 429, 5xx and timeouts. Resolves to the final response,
 * its body, and whether an earlier attempt ended without a verdict: a timeout
 * or a 5xx may have been processed, where a 429 was not. An attempt's timeout
 * covers its whole exchange, the body as well as the headers, so a server
 * that answers with headers and then stalls is cut off like one that never
 * answers.
 *
 * `retryUnsettled: false` retries a 429 and nothing else. It is for a request
 * that is not safe to repeat: a create sent without an idempotence key, where
 * a second request after an unanswered first can create a second transaction.
 *
 * `notAfter` (epoch milliseconds) is a deadline on sending. No attempt
 * begins at or after it; a wait that would end at or after it is not waited
 * out; and an attempt still in flight when it arrives is abandoned there.
 * Each of the three is reported as `DEADLINE_PASSED`. So this function sends
 * nothing at or after the deadline, whatever a `Retry-After` header asks
 * for. The clock is this process's.
 */
async function fetchWithRetry(
  url,
  opts,
  { retries = MAX_RETRIES, retryUnsettled = true, notAfter } = {},
) {
  let unsettled = false
  // Reads the clock once and returns that reading, so a caller that goes on
  // to act acts on the same instant the check passed at.
  const refuseAtDeadline = (wait = 0) => {
    const now = Date.now()
    if (notAfter === undefined || now + wait < notAfter) return now
    throw new W3ActionError(
      'DEADLINE_PASSED',
      `not sent: the deadline ${new Date(notAfter).toISOString()} ${wait ? 'would pass before the next attempt' : 'has passed'}` +
        (unsettled
          ? '; an earlier attempt went unanswered, so a transaction may exist under the idempotence key'
          : ''),
      { details: { unsettled } },
    )
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    // One reading decides whether the attempt may begin and how long it may
    // run, and nothing between it and `fetch` yields, so an attempt that
    // begins has a positive budget left before the deadline.
    const now = refuseAtDeadline()
    const budget = notAfter === undefined ? TIMEOUT_MS : Math.min(TIMEOUT_MS, notAfter - now)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), budget)
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal })
      const retryable = res.status === 429 || (res.status >= 500 && retryUnsettled)
      if (retryable && attempt < retries) {
        clearTimeout(timer)
        await res.body?.cancel().catch(() => {})
        const delay = retryAfterMs(res.headers.get('retry-after')) ?? RETRY_DELAY_MS * 2 ** attempt
        if (res.status >= 500) unsettled = true
        refuseAtDeadline(delay)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      // An error body is read for its message only, so a failure to read it is
      // tolerated; an abort is not, because it is the timer cutting the
      // exchange short.
      const text = res.ok
        ? await res.text()
        : await res.text().catch((e) => {
            if (e.name === 'AbortError') throw e
            return ''
          })
      clearTimeout(timer)
      return { res, text, unsettled }
    } catch (e) {
      clearTimeout(timer)
      const timedOut = e.name === 'AbortError' || e.code === 'UND_ERR_CONNECT_TIMEOUT'
      if (timedOut) {
        unsettled = true
        if (retryUnsettled && attempt < retries) {
          const delay = RETRY_DELAY_MS * 2 ** attempt
          refuseAtDeadline(delay)
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        // An attempt the deadline cut short reports the deadline.
        refuseAtDeadline()
      }
      if (e.name === 'AbortError') {
        throw new W3ActionError('TIMEOUT', `Request timed out after ${budget}ms: ${url}`)
      }
      throw e
    }
  }
}

/**
 * The wait a `Retry-After` header asks for, in milliseconds, or `null` when
 * the header is absent or in neither of its two forms (RFC 9110 §10.2.3):
 * whole delay-seconds, or an HTTP-date, read as the time until that date and
 * never less than zero.
 */
export function retryAfterMs(value, now = Date.now()) {
  const s = String(value ?? '').trim()
  if (/^\d+$/.test(s)) return Number(s) * 1000
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(s)) return null
  const at = Date.parse(s)
  return Number.isFinite(at) ? Math.max(0, at - now) : null
}

export class ForDefiClient {
  /**
   * @param {object} opts
   * @param {string} opts.accessToken — JWT from API User creation
   * @param {string} [opts.privateKey] — PEM-encoded P-256 key for local request signing
   * @param {string} [opts.signingKeyName] — Bridge secret name for bridge-side signing
   * @param {string} [opts.baseUrl]
   */
  constructor({ accessToken, privateKey, signingKeyName, baseUrl = DEFAULT_BASE_URL } = {}) {
    if (!accessToken) {
      throw new W3ActionError('MISSING_ACCESS_TOKEN', 'ForDefi access token is required')
    }
    this.accessToken = accessToken
    this.privateKey = privateKey || null
    this.signingKeyName = signingKeyName || null
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  async #apiCall(method, url, headers, body, retry) {
    const { res, text, unsettled } = await fetchWithRetry(
      url,
      { method, headers, ...(body !== undefined ? { body } : {}) },
      retry,
    )
    if (!res.ok) {
      throw new W3ActionError('HTTP_ERROR', `${res.status}: ${text}`, {
        statusCode: res.status,
        details: { unsettled },
      })
    }
    if (res.status === 204 || !text) return { success: true }
    try {
      return JSON.parse(text)
    } catch (_e) {
      throw new W3ActionError(
        'INVALID_RESPONSE',
        `ForDefi answered with success but its body is not JSON, so what the request did is unknown: ${text.slice(0, 200)}`,
      )
    }
  }

  #baseHeaders() {
    return { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' }
  }

  async get(path, query) {
    return this.#apiCall('GET', this.#buildUrl(path, query), this.#baseHeaders())
  }

  async post(path, payload, { sign = false, idempotenceId, retryUnsettled = true, notAfter } = {}) {
    const jsonBody = payload ? JSON.stringify(payload) : undefined
    const headers = { ...this.#baseHeaders(), 'Content-Type': 'application/json' }
    // ForDefi dedups transaction creation on the x-idempotence-id header (a
    // UUID): a repeated create/transfer maps to the existing transaction and
    // moves money at most once. It is not part of the signed
    // `path|timestamp|body`, so it is orthogonal to request signing.
    if (idempotenceId) headers['x-idempotence-id'] = idempotenceId

    if (sign) {
      this.#requireSigner()
      const signedAt = Date.now()
      // The signed timestamp is the one ForDefi's signature window is measured
      // from, on ForDefi's clock, and every attempt below reuses it. Refusing
      // here unless it is strictly earlier than the deadline bounds what
      // ForDefi can accept for this request to before the deadline plus that
      // window, whatever this process's clock says.
      if (notAfter !== undefined && signedAt >= notAfter) {
        throw new W3ActionError(
          'DEADLINE_PASSED',
          `not sent: the signed timestamp ${new Date(signedAt).toISOString()} is not earlier than the deadline ${new Date(notAfter).toISOString()}`,
          { details: { unsettled: false } },
        )
      }
      const timestamp = signedAt.toString()
      headers['x-signature'] = await this.#sign(path, timestamp, jsonBody || '')
      headers['x-timestamp'] = timestamp
    }

    return this.#apiCall('POST', this.#buildUrl(path), headers, jsonBody, {
      retryUnsettled,
      notAfter,
    })
  }

  async put(path, payload, { sign = false } = {}) {
    const jsonBody = payload ? JSON.stringify(payload) : undefined
    const headers = { ...this.#baseHeaders(), 'Content-Type': 'application/json' }

    if (sign) {
      this.#requireSigner()
      const timestamp = Date.now().toString()
      headers['x-signature'] = await this.#sign(path, timestamp, jsonBody || '')
      headers['x-timestamp'] = timestamp
    }

    return this.#apiCall('PUT', this.#buildUrl(path), headers, jsonBody)
  }

  async delete(path) {
    return this.#apiCall('DELETE', this.#buildUrl(path), this.#baseHeaders())
  }

  // ---------------------------------------------------------------------------
  // ECDSA P-256 request signing
  // ---------------------------------------------------------------------------

  /**
   * Sign `{path}|{timestamp}|{body}` with P-256/SHA-256, return base64.
   *
   * Two modes:
   *   - Bridge mode (signingKeyName set): delegates to bridge /crypto/p256-sign.
   *     The PEM key stays bridge-side; the container never sees it.
   *   - Local mode (privateKey set): signs in-process with node:crypto.
   */
  async #sign(path, timestamp, body) {
    const message = `${path}|${timestamp}|${body}`

    // Bridge mode: delegate signing to the W3 bridge
    if (this.signingKeyName && _bridge) {
      const result = await _bridge('p256-sign', {
        keyName: this.signingKeyName,
        message,
      })
      return result.signature || result.result?.signature
    }

    // Local mode: sign with the PEM key in-process
    const signer = createSign('SHA256')
    signer.update(message)
    signer.end()
    return signer.sign(this.privateKey, 'base64')
  }

  #requireSigner() {
    if (!this.privateKey && !(this.signingKeyName && _bridge)) {
      throw new W3ActionError(
        'MISSING_SIGNER',
        'ForDefi signing requires either private-key (local PEM) or ' +
          'signing-key-name (bridge-side secret). Set one of these inputs.',
      )
    }
  }

  #buildUrl(path, query) {
    const url = new URL(path, this.baseUrl)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
      }
    }
    return url.toString()
  }

  // ---------------------------------------------------------------------------
  // Vaults (13 endpoints)
  // ---------------------------------------------------------------------------

  listVaults(q) {
    return this.get('/api/v1/vaults', q)
  }
  createVault(p) {
    return this.post('/api/v1/vaults', p, { sign: true })
  }
  getVault(id) {
    return this.get(`/api/v1/vaults/${id}`)
  }
  getVaultAsset(vid, aid) {
    return this.get(`/api/v1/vaults/${vid}/assets/${aid}`)
  }
  listVaultAssets(vid, q) {
    return this.get(`/api/v1/vaults/${vid}/assets`, q)
  }
  submitVaultProposal(vid, p) {
    return this.post(`/api/v1/vaults/${vid}/proposals`, p, { sign: true })
  }
  archiveVault(id) {
    return this.post(`/api/v1/vaults/${id}/archive`, {}, { sign: true })
  }
  restoreVault(id) {
    return this.post(`/api/v1/vaults/${id}/restore`, {}, { sign: true })
  }
  renameVault(id, name) {
    return this.put(`/api/v1/vaults/${id}/name`, { name })
  }
  createVaultAddress(vid, p) {
    return this.post(`/api/v1/vaults/${vid}/addresses`, p, { sign: true })
  }
  listVaultAddresses(vid, q) {
    return this.get(`/api/v1/vaults/${vid}/addresses`, q)
  }
  renameVaultAddress(id, name) {
    return this.put(`/api/v1/vaults/addresses/${id}/name`, { name })
  }
  exportVaults(q) {
    return this.get('/api/v1/vaults/export_async', q)
  }

  // ---------------------------------------------------------------------------
  // Vault Groups (1)
  // ---------------------------------------------------------------------------

  listVaultGroups(q) {
    return this.get('/api/v1/vault-groups', q)
  }

  // ---------------------------------------------------------------------------
  // Transactions (13 endpoints)
  // ---------------------------------------------------------------------------

  listTransactions(q) {
    return this.get('/api/v1/transactions', q)
  }
  getTransaction(id) {
    return this.get(`/api/v1/transactions/${id}`)
  }
  // The three creates that take an idempotence key. With the key, a repeated
  // request names the transaction the first one made, so an unanswered
  // attempt is retried. Without it nothing ties the two requests together,
  // and the create is sent at most once past a 429.
  createTransaction(p, opts) {
    return this.#create('/api/v1/transactions', p, opts)
  }
  createTransfer(p, opts) {
    return this.#create('/api/v1/transactions/transfer', p, opts)
  }
  createTransactionAndWait(p, opts) {
    return this.#create('/api/v1/transactions/create-and-wait', p, opts)
  }
  #create(path, p, { idempotenceId, notAfter } = {}) {
    return this.post(path, p, {
      sign: true,
      idempotenceId,
      notAfter,
      retryUnsettled: Boolean(idempotenceId),
    })
  }
  approveTransaction(id) {
    return this.post(`/api/v1/transactions/${id}/approve`, {}, { sign: true })
  }
  abortTransaction(id) {
    return this.post(`/api/v1/transactions/${id}/abort`, {}, { sign: true })
  }
  releaseTransaction(id) {
    return this.post(`/api/v1/transactions/${id}/release`, {}, { sign: true })
  }
  predictTransaction(p) {
    return this.post('/api/v1/transactions/predict', p, { sign: true })
  }
  pushTransaction(id) {
    return this.post(`/api/v1/transactions/${id}/push`, {}, { sign: true })
  }
  updateSpamState(id, p) {
    return this.put(`/api/v1/transactions/${id}/update-spam-state`, p)
  }
  triggerSigning(id) {
    return this.post(`/api/v1/transactions/${id}/trigger-signing`, {}, { sign: true })
  }
  exportTransactions(q) {
    return this.get('/api/v1/transactions/export', q)
  }

  // ---------------------------------------------------------------------------
  // Batch Transactions (4)
  // ---------------------------------------------------------------------------

  createBatchTransaction(p) {
    return this.post('/api/v1/batch-transactions', p, { sign: true })
  }
  predictBatchTransaction(p) {
    return this.post('/api/v1/batch-transactions/predict', p, { sign: true })
  }
  abortBatchTransaction(id) {
    return this.post(`/api/v1/batch-transactions/${id}/abort`, {}, { sign: true })
  }
  approveBatchTransaction(id) {
    return this.post(`/api/v1/batch-transactions/${id}/approve`, {}, { sign: true })
  }

  // ---------------------------------------------------------------------------
  // Swaps (4)
  // ---------------------------------------------------------------------------

  getSwapProviders(chainType) {
    return this.get(`/api/v1/swaps/providers/${chainType}`)
  }
  getSwapQuotes(p) {
    return this.post('/api/v1/swaps/quotes', p)
  }
  createSwap(p) {
    return this.post('/api/v1/swaps', p, { sign: true })
  }
  predictSwap(p) {
    return this.post('/api/v1/swaps/predict', p, { sign: true })
  }

  // ---------------------------------------------------------------------------
  // Assets (5)
  // ---------------------------------------------------------------------------

  getOwnedAsset(id) {
    return this.get(`/api/v1/assets/owned-assets/${id}`)
  }
  listOwnedAssets(q) {
    return this.get('/api/v1/assets/owned-assets', q)
  }
  updateAssetConfig(p) {
    return this.put('/api/v1/assets', p)
  }
  fetchAssetPrices(p) {
    return this.post('/api/v1/assets/prices', p)
  }
  createAssetInfo(p) {
    return this.post('/api/v1/assets/asset-infos', p)
  }

  // ---------------------------------------------------------------------------
  // Blockchains (2)
  // ---------------------------------------------------------------------------

  listBlockchains() {
    return this.get('/api/v1/blockchains')
  }
  getSuggestedFees(q) {
    return this.get('/api/v1/blockchains/suggested-fees', q)
  }

  // ---------------------------------------------------------------------------
  // Address Book (5)
  // ---------------------------------------------------------------------------

  createContact(p) {
    return this.post('/api/v1/addressbook/contacts', p, { sign: true })
  }
  listContacts(q) {
    return this.get('/api/v1/addressbook/contacts', q)
  }
  createBatchContacts(p) {
    return this.post('/api/v1/addressbook/contacts/batch', p, { sign: true })
  }
  abortContactProposal(pid) {
    return this.post(`/api/v1/addressbook/contacts/proposals/${pid}/abort`, {}, { sign: true })
  }
  editContact(cid, p) {
    return this.post(`/api/v1/addressbook/contacts/${cid}/proposals`, p, { sign: true })
  }

  // ---------------------------------------------------------------------------
  // Users (2)
  // ---------------------------------------------------------------------------

  listUsers(q) {
    return this.get('/api/v1/users', q)
  }
  getUser(id) {
    return this.get(`/api/v1/users/${id}`)
  }

  // ---------------------------------------------------------------------------
  // User Groups (2)
  // ---------------------------------------------------------------------------

  listUserGroups(q) {
    return this.get('/api/v1/user-groups', q)
  }
  getUserGroup(id) {
    return this.get(`/api/v1/user-groups/${id}`)
  }

  // ---------------------------------------------------------------------------
  // End Users / WaaS (6)
  // ---------------------------------------------------------------------------

  listEndUsers(q) {
    return this.get('/api/v1/end-users', q)
  }
  createEndUser(p) {
    return this.post('/api/v1/end-users', p)
  }
  getCurrentEndUser() {
    return this.get('/api/v1/end-users/current')
  }
  getEndUser(id) {
    return this.get(`/api/v1/end-users/${id}`)
  }
  deleteEndUser(id) {
    return this.delete(`/api/v1/end-users/${id}`)
  }
  setExportKeyPermissions(id, p) {
    return this.put(`/api/v1/end-users/${id}/set-export-end-user-keys-permissions`, p)
  }

  // ---------------------------------------------------------------------------
  // Authorization Tokens (3)
  // ---------------------------------------------------------------------------

  issueAuthToken(p) {
    return this.post('/api/v1/authorization-tokens', p)
  }
  listAuthTokens(q) {
    return this.get('/api/v1/authorization-tokens', q)
  }
  deleteAuthToken(id) {
    return this.delete(`/api/v1/authorization-tokens/${id}`)
  }

  // ---------------------------------------------------------------------------
  // Organizations (4)
  // ---------------------------------------------------------------------------

  importKeys(p) {
    return this.post('/api/v1/organizations/import-keys', p, { sign: true })
  }
  abortImportKeys() {
    return this.post('/api/v1/organizations/abort-import-keys', {}, { sign: true })
  }
  getImportKeysStatus() {
    return this.get('/api/v1/organizations/import-keys-status')
  }
  listOrgKeys(q) {
    return this.get('/api/v1/organizations/list-keys', q)
  }

  // ---------------------------------------------------------------------------
  // Webhooks (2)
  // ---------------------------------------------------------------------------

  testWebhook(p) {
    return this.post('/api/v1/webhooks/test', p)
  }
  triggerTransactionWebhook(txId) {
    return this.post(`/api/v1/webhooks/trigger/transaction/${txId}`)
  }

  // ---------------------------------------------------------------------------
  // Audit Log (2)
  // ---------------------------------------------------------------------------

  listAuditLog(q) {
    return this.get('/api/v1/audit-log', q)
  }
  exportAuditLog(q) {
    return this.get('/api/v1/audit-log/export', q)
  }

  // ---------------------------------------------------------------------------
  // Exports (2)
  // ---------------------------------------------------------------------------

  getExport(id) {
    return this.get(`/api/v1/exports/${id}`)
  }
  abortExport(id) {
    return this.post(`/api/v1/exports/${id}/abort`)
  }

  // ---------------------------------------------------------------------------
  // Enclave Keys (1)
  // ---------------------------------------------------------------------------

  listEnclaveKeys() {
    return this.get('/api/v1/enclave-keys')
  }
}
