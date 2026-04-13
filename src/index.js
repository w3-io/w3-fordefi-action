/**
 * W3 ForDefi Action — 71 commands across 17 categories.
 *
 * MPC-secured custody, multi-chain transactions, swaps, WaaS,
 * and organizational key management.
 */

import { createCommandRouter, setJsonOutput } from '@w3-io/action-core'
import * as core from '@actions/core'
import { ForDefiClient } from './client.js'

function getClient() {
  return new ForDefiClient({
    accessToken: core.getInput('access-token', { required: true }),
    privateKey: core.getInput('private-key') || undefined,
    baseUrl: core.getInput('api-url') || undefined,
  })
}

function jsonInput(name) {
  const raw = core.getInput(name)
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function req(name) {
  return core.getInput(name, { required: true })
}

function query(...names) {
  const q = {}
  for (const name of names) {
    const v = core.getInput(name)
    if (v) q[name] = v
  }
  return Object.keys(q).length ? q : undefined
}

const router = createCommandRouter({
  // ── Vaults ──────────────────────────────────────────────────────────
  'list-vaults': async () =>
    setJsonOutput(
      'result',
      await getClient().listVaults(query('page_size', 'page_token', 'sort_by', 'sort_order')),
    ),
  'create-vault': async () =>
    setJsonOutput('result', await getClient().createVault(jsonInput('data'))),
  'get-vault': async () => setJsonOutput('result', await getClient().getVault(req('vault-id'))),
  'get-vault-asset': async () =>
    setJsonOutput('result', await getClient().getVaultAsset(req('vault-id'), req('asset-id'))),
  'list-vault-assets': async () =>
    setJsonOutput(
      'result',
      await getClient().listVaultAssets(req('vault-id'), query('page_size', 'page_token')),
    ),
  'submit-vault-proposal': async () =>
    setJsonOutput(
      'result',
      await getClient().submitVaultProposal(req('vault-id'), jsonInput('data')),
    ),
  'archive-vault': async () =>
    setJsonOutput('result', await getClient().archiveVault(req('vault-id'))),
  'restore-vault': async () =>
    setJsonOutput('result', await getClient().restoreVault(req('vault-id'))),
  'rename-vault': async () =>
    setJsonOutput('result', await getClient().renameVault(req('vault-id'), req('name'))),
  'create-vault-address': async () =>
    setJsonOutput(
      'result',
      await getClient().createVaultAddress(req('vault-id'), jsonInput('data')),
    ),
  'list-vault-addresses': async () =>
    setJsonOutput(
      'result',
      await getClient().listVaultAddresses(req('vault-id'), query('page_size', 'page_token')),
    ),
  'rename-vault-address': async () =>
    setJsonOutput('result', await getClient().renameVaultAddress(req('address-id'), req('name'))),
  'export-vaults': async () =>
    setJsonOutput('result', await getClient().exportVaults(query('format'))),

  // ── Vault Groups ────────────────────────────────────────────────────
  'list-vault-groups': async () =>
    setJsonOutput('result', await getClient().listVaultGroups(query('page_size', 'page_token'))),

  // ── Transactions ────────────────────────────────────────────────────
  'list-transactions': async () =>
    setJsonOutput(
      'result',
      await getClient().listTransactions(
        query('page_size', 'page_token', 'sort_by', 'sort_order', 'vault_id', 'state', 'type'),
      ),
    ),
  'get-transaction': async () =>
    setJsonOutput('result', await getClient().getTransaction(req('transaction-id'))),
  'create-transaction': async () =>
    setJsonOutput('result', await getClient().createTransaction(jsonInput('data'))),
  'create-transfer': async () =>
    setJsonOutput('result', await getClient().createTransfer(jsonInput('data'))),
  'create-transaction-and-wait': async () =>
    setJsonOutput('result', await getClient().createTransactionAndWait(jsonInput('data'))),
  'approve-transaction': async () =>
    setJsonOutput('result', await getClient().approveTransaction(req('transaction-id'))),
  'abort-transaction': async () =>
    setJsonOutput('result', await getClient().abortTransaction(req('transaction-id'))),
  'release-transaction': async () =>
    setJsonOutput('result', await getClient().releaseTransaction(req('transaction-id'))),
  'predict-transaction': async () =>
    setJsonOutput('result', await getClient().predictTransaction(jsonInput('data'))),
  'push-transaction': async () =>
    setJsonOutput('result', await getClient().pushTransaction(req('transaction-id'))),
  'update-spam-state': async () =>
    setJsonOutput(
      'result',
      await getClient().updateSpamState(req('transaction-id'), jsonInput('data')),
    ),
  'trigger-signing': async () =>
    setJsonOutput('result', await getClient().triggerSigning(req('transaction-id'))),
  'export-transactions': async () =>
    setJsonOutput(
      'result',
      await getClient().exportTransactions(query('format', 'start_date', 'end_date')),
    ),

  // ── Batch Transactions ──────────────────────────────────────────────
  'create-batch-transaction': async () =>
    setJsonOutput('result', await getClient().createBatchTransaction(jsonInput('data'))),
  'predict-batch-transaction': async () =>
    setJsonOutput('result', await getClient().predictBatchTransaction(jsonInput('data'))),
  'abort-batch-transaction': async () =>
    setJsonOutput('result', await getClient().abortBatchTransaction(req('batch-id'))),
  'approve-batch-transaction': async () =>
    setJsonOutput('result', await getClient().approveBatchTransaction(req('batch-id'))),

  // ── Swaps ───────────────────────────────────────────────────────────
  'get-swap-providers': async () =>
    setJsonOutput('result', await getClient().getSwapProviders(req('chain-type'))),
  'get-swap-quotes': async () =>
    setJsonOutput('result', await getClient().getSwapQuotes(jsonInput('data'))),
  'create-swap': async () =>
    setJsonOutput('result', await getClient().createSwap(jsonInput('data'))),
  'predict-swap': async () =>
    setJsonOutput('result', await getClient().predictSwap(jsonInput('data'))),

  // ── Assets ──────────────────────────────────────────────────────────
  'get-owned-asset': async () =>
    setJsonOutput('result', await getClient().getOwnedAsset(req('asset-id'))),
  'list-owned-assets': async () =>
    setJsonOutput('result', await getClient().listOwnedAssets(query('page_size', 'page_token'))),
  'update-asset-config': async () =>
    setJsonOutput('result', await getClient().updateAssetConfig(jsonInput('data'))),
  'fetch-asset-prices': async () =>
    setJsonOutput('result', await getClient().fetchAssetPrices(jsonInput('data'))),
  'create-asset-info': async () =>
    setJsonOutput('result', await getClient().createAssetInfo(jsonInput('data'))),

  // ── Blockchains ─────────────────────────────────────────────────────
  'list-blockchains': async () => setJsonOutput('result', await getClient().listBlockchains()),
  'get-suggested-fees': async () =>
    setJsonOutput(
      'result',
      await getClient().getSuggestedFees(query('chain_type', 'chain_unique_id')),
    ),

  // ── Address Book ────────────────────────────────────────────────────
  'create-contact': async () =>
    setJsonOutput('result', await getClient().createContact(jsonInput('data'))),
  'list-contacts': async () =>
    setJsonOutput(
      'result',
      await getClient().listContacts(query('page_size', 'page_token', 'search')),
    ),
  'create-batch-contacts': async () =>
    setJsonOutput('result', await getClient().createBatchContacts(jsonInput('data'))),
  'abort-contact-proposal': async () =>
    setJsonOutput('result', await getClient().abortContactProposal(req('proposal-id'))),
  'edit-contact': async () =>
    setJsonOutput('result', await getClient().editContact(req('contact-id'), jsonInput('data'))),

  // ── Users ───────────────────────────────────────────────────────────
  'list-users': async () =>
    setJsonOutput('result', await getClient().listUsers(query('page_size', 'page_token'))),
  'get-user': async () => setJsonOutput('result', await getClient().getUser(req('user-id'))),

  // ── User Groups ─────────────────────────────────────────────────────
  'list-user-groups': async () =>
    setJsonOutput('result', await getClient().listUserGroups(query('page_size', 'page_token'))),
  'get-user-group': async () =>
    setJsonOutput('result', await getClient().getUserGroup(req('group-id'))),

  // ── End Users (WaaS) ───────────────────────────────────────────────
  'list-end-users': async () =>
    setJsonOutput('result', await getClient().listEndUsers(query('page_size', 'page_token'))),
  'create-end-user': async () =>
    setJsonOutput('result', await getClient().createEndUser(jsonInput('data'))),
  'get-current-end-user': async () =>
    setJsonOutput('result', await getClient().getCurrentEndUser()),
  'get-end-user': async () => setJsonOutput('result', await getClient().getEndUser(req('user-id'))),
  'delete-end-user': async () =>
    setJsonOutput('result', await getClient().deleteEndUser(req('user-id'))),
  'set-export-key-permissions': async () =>
    setJsonOutput(
      'result',
      await getClient().setExportKeyPermissions(req('user-id'), jsonInput('data')),
    ),

  // ── Authorization Tokens ───────────────────────────────────────────
  'issue-auth-token': async () =>
    setJsonOutput('result', await getClient().issueAuthToken(jsonInput('data'))),
  'list-auth-tokens': async () =>
    setJsonOutput('result', await getClient().listAuthTokens(query('page_size', 'page_token'))),
  'delete-auth-token': async () =>
    setJsonOutput('result', await getClient().deleteAuthToken(req('token-id'))),

  // ── Organizations ──────────────────────────────────────────────────
  'import-keys': async () =>
    setJsonOutput('result', await getClient().importKeys(jsonInput('data'))),
  'abort-import-keys': async () => setJsonOutput('result', await getClient().abortImportKeys()),
  'get-import-keys-status': async () =>
    setJsonOutput('result', await getClient().getImportKeysStatus()),
  'list-org-keys': async () =>
    setJsonOutput('result', await getClient().listOrgKeys(query('page_size', 'page_token'))),

  // ── Webhooks ───────────────────────────────────────────────────────
  'test-webhook': async () =>
    setJsonOutput('result', await getClient().testWebhook(jsonInput('data'))),
  'trigger-transaction-webhook': async () =>
    setJsonOutput('result', await getClient().triggerTransactionWebhook(req('transaction-id'))),

  // ── Audit Log ──────────────────────────────────────────────────────
  'list-audit-log': async () =>
    setJsonOutput(
      'result',
      await getClient().listAuditLog(query('page_size', 'page_token', 'start_date', 'end_date')),
    ),
  'export-audit-log': async () =>
    setJsonOutput(
      'result',
      await getClient().exportAuditLog(query('format', 'start_date', 'end_date')),
    ),

  // ── Exports ────────────────────────────────────────────────────────
  'get-export': async () => setJsonOutput('result', await getClient().getExport(req('export-id'))),
  'abort-export': async () =>
    setJsonOutput('result', await getClient().abortExport(req('export-id'))),

  // ── Enclave Keys ───────────────────────────────────────────────────
  'list-enclave-keys': async () => setJsonOutput('result', await getClient().listEnclaveKeys()),
})

router()
