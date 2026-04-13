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

const DEFAULT_BASE_URL = 'https://api.fordefi.com'
const TIMEOUT_MS = 30_000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

async function fetchWithRetry(url, opts, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal })
      clearTimeout(timer)
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = res.headers.get('retry-after')
        const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : NaN
        const delay = Number.isFinite(retrySeconds)
          ? retrySeconds * 1000
          : RETRY_DELAY_MS * 2 ** attempt
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      return res
    } catch (e) {
      clearTimeout(timer)
      if (attempt < retries && (e.name === 'AbortError' || e.code === 'UND_ERR_CONNECT_TIMEOUT')) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * 2 ** attempt))
        continue
      }
      if (e.name === 'AbortError') {
        throw new W3ActionError('TIMEOUT', `Request timed out after ${TIMEOUT_MS}ms: ${url}`)
      }
      throw e
    }
  }
}

export class ForDefiClient {
  /**
   * @param {object} opts
   * @param {string} opts.accessToken — JWT from API User creation
   * @param {string} [opts.privateKey] — PEM-encoded P-256 key for request signing
   * @param {string} [opts.baseUrl]
   */
  constructor({ accessToken, privateKey, baseUrl = DEFAULT_BASE_URL } = {}) {
    if (!accessToken) {
      throw new W3ActionError('MISSING_ACCESS_TOKEN', 'ForDefi access token is required')
    }
    this.accessToken = accessToken
    this.privateKey = privateKey || null
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  async #apiCall(method, url, headers, body) {
    const res = await fetchWithRetry(url, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new W3ActionError('HTTP_ERROR', `${res.status}: ${text}`, { statusCode: res.status })
    }
    if (res.status === 204) return { success: true }
    const text = await res.text()
    if (!text) return { success: true }
    try {
      return JSON.parse(text)
    } catch (_e) {
      throw new W3ActionError(
        'INVALID_RESPONSE',
        `ForDefi returned unparseable response: ${text.slice(0, 200)}`,
      )
    }
  }

  #baseHeaders() {
    return { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' }
  }

  async get(path, query) {
    return this.#apiCall('GET', this.#buildUrl(path, query), this.#baseHeaders())
  }

  async post(path, payload, { sign = false } = {}) {
    const jsonBody = payload ? JSON.stringify(payload) : undefined
    const headers = { ...this.#baseHeaders(), 'Content-Type': 'application/json' }

    if (sign) {
      this.#requirePrivateKey()
      const timestamp = Date.now().toString()
      headers['x-signature'] = this.#sign(path, timestamp, jsonBody || '')
      headers['x-timestamp'] = timestamp
    }

    return this.#apiCall('POST', this.#buildUrl(path), headers, jsonBody)
  }

  async put(path, payload, { sign = false } = {}) {
    const jsonBody = payload ? JSON.stringify(payload) : undefined
    const headers = { ...this.#baseHeaders(), 'Content-Type': 'application/json' }

    if (sign) {
      this.#requirePrivateKey()
      const timestamp = Date.now().toString()
      headers['x-signature'] = this.#sign(path, timestamp, jsonBody || '')
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

  /** Sign `{path}|{timestamp}|{body}` with P-256/SHA-256, return base64. */
  #sign(path, timestamp, body) {
    const signer = createSign('SHA256')
    signer.update(`${path}|${timestamp}|${body}`)
    signer.end()
    return signer.sign(this.privateKey, 'base64')
  }

  #requirePrivateKey() {
    if (!this.privateKey) {
      throw new W3ActionError(
        'MISSING_PRIVATE_KEY',
        'ForDefi private key required for transactional operations. ' +
          'Set private-key input with your PEM-encoded P-256 key.',
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
  createTransaction(p) {
    return this.post('/api/v1/transactions', p, { sign: true })
  }
  createTransfer(p) {
    return this.post('/api/v1/transactions/transfer', p, { sign: true })
  }
  createTransactionAndWait(p) {
    return this.post('/api/v1/transactions/create-and-wait', p, { sign: true })
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
