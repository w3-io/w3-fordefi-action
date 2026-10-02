/**
 * W3 ForDefi Action — 73 commands across 17 categories.
 *
 * MPC-secured custody, multi-chain transactions, swaps, WaaS,
 * and organizational key management.
 */

import { createCommandRouter, setJsonOutput, bridge } from '@w3-io/action-core'
import * as core from '@actions/core'
import { ForDefiClient, setBridgeSigner } from './client.js'
import { assertCallCreated, buildCallPayload, parseIdempotenceId, parseNotAfter } from './call.js'
import { createFailure, extractOutcome } from './outcome.js'
import { assertNotFailed, buildTransferPayload } from './transfer.js'

// If a bridge is available, wire it up for P-256 signing
if (bridge) {
  setBridgeSigner(bridge.crypto || bridge.chain)
}

function getClient() {
  return new ForDefiClient({
    accessToken: core.getInput('access-token', { required: true }),
    privateKey: core.getInput('private-key') || undefined,
    signingKeyName: core.getInput('signing-key-name') || undefined,
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

/** The idempotency key for a money-moving create, or undefined. */
function idem() {
  return core.getInput('idempotence-id') || undefined
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
    setJsonOutput(
      'result',
      await getClient().createTransaction(jsonInput('data'), { idempotenceId: idem() }),
    ),
  'create-transfer': async () =>
    setJsonOutput(
      'result',
      await getClient().createTransfer(jsonInput('data'), { idempotenceId: idem() }),
    ),
  'create-transaction-and-wait': async () =>
    setJsonOutput(
      'result',
      await getClient().createTransactionAndWait(jsonInput('data'), { idempotenceId: idem() }),
    ),
  // Typed vault→external transfer: build the payload from primitives (no
  // hand-encoded calldata), move money at most once on the idempotence key, and
  // emit an honest, named outcome.
  'transfer-out': async () => {
    const payload = buildTransferPayload({
      vaultId: req('vault-id'),
      chain: req('chain'),
      to: req('to'),
      asset: core.getInput('asset') || undefined,
      amount: req('amount'),
      note: core.getInput('note') || undefined,
    })
    const result = await getClient()
      .createTransactionAndWait(payload, { idempotenceId: idem() })
      .catch((e) => {
        throw createFailure(e)
      })
    // Named scalar outputs bind directly (no digging into `result`); the raw
    // `result` is kept for anything unmodeled. tx_hash is the on-chain hash or
    // empty — never the ForDefi UUID.
    const outcome = extractOutcome(result)
    // Emit the outcome BEFORE asserting, so a failed transfer still surfaces its
    // hash and state for audit rather than being swallowed by the throw.
    core.setOutput('tx_hash', outcome.tx_hash)
    core.setOutput('transaction_id', outcome.transaction_id)
    core.setOutput('state', outcome.state)
    core.setOutput('explorer_url', outcome.explorer_url)
    setJsonOutput('result', result)
    // Fail on a definitive non-settlement or a response naming no transaction;
    // an in-flight or on-chain tx succeeds and the consumer confirms finality
    // (and reversion) from the chain.
    assertNotFailed(outcome)
  },
  // One raw transaction out of a vault: the caller supplies the calldata (or
  // none, for a plain transfer), the idempotence key makes the create happen
  // at most once, no create is sent at or after the deadline, and the step
  // returns on creation without waiting for approval, signing or mining.
  'call-contract': async () => {
    const idempotenceId = parseIdempotenceId(core.getInput('idempotence-id'))
    const notAfter = parseNotAfter(core.getInput('not-after'))
    const payload = buildCallPayload({
      vaultId: req('vault-id'),
      chain: req('chain'),
      to: req('to'),
      calldata: core.getInput('calldata') || undefined,
      value: core.getInput('value') || undefined,
      note: core.getInput('note') || undefined,
    })
    const result = await getClient()
      .createTransaction(payload, { idempotenceId, notAfter })
      .catch((e) => {
        throw createFailure(e)
      })
    const outcome = extractOutcome(result)
    // Emit before asserting: a transaction ForDefi named is in the step's
    // outputs whatever the step's own result.
    core.setOutput('tx_hash', outcome.tx_hash)
    core.setOutput('transaction_id', outcome.transaction_id)
    core.setOutput('state', outcome.state)
    core.setOutput('explorer_url', outcome.explorer_url)
    setJsonOutput('result', result)
    assertCallCreated(outcome)
  },
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
