# ForDefi Action — Next Steps

## Blocked on sandbox access

- [ ] Test all 71 commands against sandbox API
- [ ] Verify ECDSA P-256 request signing works end-to-end
- [ ] Verify Bearer token authentication
- [ ] Document any sandbox-specific behavior differences

## After sandbox verification

- [ ] Write unit tests (`test/client.test.js`) with mocked HTTP responses
- [ ] Write integration test (`test/integration.test.js`) that hits sandbox
- [ ] Add CI workflow (`.github/workflows/ci.yml`) — lint, test, build
- [ ] Publish v0 release tag

## MCP registry

- [ ] Add `fordefi` entry to `w3-mcp/registry.yaml` under `gha-actions`
- [ ] Add `content/integrations/fordefi.md` MCP guide to `w3-mcp`
- [ ] Run `w3-mcp/scripts/sync-registry.sh` to verify

## Documentation

- [ ] Add `docs/examples/` with workflow YAML patterns:
  - Vault creation + address generation
  - Simulate → approve → execute flow
  - Multi-chain balance monitoring
  - WaaS user onboarding
- [ ] Add output schema examples to `docs/guide.md` (actual JSON from sandbox)

## API Signer

- [ ] Document API Signer Docker setup for W3 infrastructure
- [ ] Determine: does W3 run the API Signer, or does each customer?
- [ ] If W3-hosted: add Signer provisioning to infrastructure repo

## Future

- [ ] Add webhook event handling for transaction status callbacks
- [ ] Consider typed request/response interfaces from OpenAPI spec
- [ ] Policy management commands (if API exposes them beyond read-only vault groups)
