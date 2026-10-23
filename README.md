## CalHacks 2026 Project: Local-first secure P2P credential sharing app

### MVP Flow
- Store a secret locally in Keychain.
- Let Claude Code start an application through controlled credential injection at runtime
- Share the credential securely with another device.
- Apply access restrictions and automatic expiry.
- Show the corresponding activity in local SpacetimeDB.


### MVP Feature Checklist

- [ ] Desktop app: macOS application built with Tauri, Rust, and TypeScript ([#24](https://github.com/omavashia2005/calhacks-vault/issues/24), [#13](https://github.com/omavashia2005/calhacks-vault/issues/13)).
- [ ] Encrypted storage: Store secrets in macOS Keychain ([#6](https://github.com/omavashia2005/calhacks-vault/issues/6), [#26](https://github.com/omavashia2005/calhacks-vault/issues/26)).
- [ ] Project isolation: Use one demo project and the `dev` environment ([#7](https://github.com/omavashia2005/calhacks-vault/issues/7)).
- [ ] Secret management: Create, list, and delete the demo secret ([#6](https://github.com/omavashia2005/calhacks-vault/issues/6), [#7](https://github.com/omavashia2005/calhacks-vault/issues/7), [#25](https://github.com/omavashia2005/calhacks-vault/issues/25)).
- [ ] Runtime injection: Inject secrets into an approved application without a `.env` file ([#8](https://github.com/omavashia2005/calhacks-vault/issues/8)).
- [ ] P2P sharing: Transfer encrypted grants through Tailscale ([#15](https://github.com/omavashia2005/calhacks-vault/issues/15), [#16](https://github.com/omavashia2005/calhacks-vault/issues/16), [#17](https://github.com/omavashia2005/calhacks-vault/issues/17)).
- [ ] Access control: Give recipients injection-only access ([#18](https://github.com/omavashia2005/calhacks-vault/issues/18)).
- [ ] Automatic expiry: Delete expired recipient Keychain items and block new use ([#19](https://github.com/omavashia2005/calhacks-vault/issues/19)).
- [ ] Recipient tracking: Record recipients, devices, transfer status, and timestamps ([#11](https://github.com/omavashia2005/calhacks-vault/issues/11), [#14](https://github.com/omavashia2005/calhacks-vault/issues/14), [#17](https://github.com/omavashia2005/calhacks-vault/issues/17)).
- [ ] Audit logs: Record local metadata events for secret creation, sharing, injection, and expiry ([#11](https://github.com/omavashia2005/calhacks-vault/issues/11), [#14](https://github.com/omavashia2005/calhacks-vault/issues/14), [#20](https://github.com/omavashia2005/calhacks-vault/issues/20)).
- [ ] CLI: Manage the demo secret and launch the approved application ([#5](https://github.com/omavashia2005/calhacks-vault/issues/5), [#8](https://github.com/omavashia2005/calhacks-vault/issues/8)).
- [ ] MCP integration: Allow Claude Code to request approved Vault operations ([#4](https://github.com/omavashia2005/calhacks-vault/issues/4), [#9](https://github.com/omavashia2005/calhacks-vault/issues/9), [#10](https://github.com/omavashia2005/calhacks-vault/issues/10)).
- [ ] Local-first architecture: Keep secret values and metadata on the local devices ([#3](https://github.com/omavashia2005/calhacks-vault/issues/3), [#11](https://github.com/omavashia2005/calhacks-vault/issues/11), [#20](https://github.com/omavashia2005/calhacks-vault/issues/20)).

Deferred from the MVP:

- [ ] AirDrop sharing ([#22](https://github.com/omavashia2005/calhacks-vault/issues/22)).
- [ ] Factory integration ([#23](https://github.com/omavashia2005/calhacks-vault/issues/23)).
- [ ] Access renewal.
- [ ] Manual rotation.
- [ ] Fetch.ai integration.
- [ ] Provider import and export.

Core stack: Tauri + Rust + macOS Keychain + SQLite metadata + Tailscale + AirDrop + MCP + Fetch.ai uAgents.

Security boundary: Expiration prevents future injection through the manager. It does not invalidate plaintext secrets previously copied or injected into running processes.
