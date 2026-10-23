## CalHacks 2026 Project: Local-first secure P2P credential sharing app

### MVP Flow
- Store a secret locally in Keychain.
- Let Claude Code start an application through controlled credential injection at runtime
- Share the credential securely with another device.
- Apply access restrictions and automatic expiry.
- Show the corresponding activity in local SpacetimeDB.


### MVP Feature Checklist

- [ ] Desktop app: macOS application built with Tauri, Rust, and TypeScript.
- [ ] Encrypted storage: Store secrets in macOS Keychain.
- [ ] Project isolation: Use one demo project and the `dev` environment.
- [ ] Secret management: Create, list, and delete the demo secret.
- [ ] Runtime injection: Inject secrets into an approved application without a `.env` file.
- [ ] P2P sharing: Transfer encrypted grants through Tailscale.
- [ ] Access control: Give recipients injection-only access.
- [ ] Automatic expiry: Delete expired recipient Keychain items and block new use.
- [ ] Recipient tracking: Record recipients, devices, transfer status, and timestamps.
- [ ] Audit logs: Record local metadata events for secret creation, sharing, injection, and expiry.
- [ ] CLI: Manage the demo secret and launch the approved application.
- [ ] MCP integration: Allow Claude Code to request approved Vault operations.
- [ ] Local-first architecture: Keep secret values and metadata on the local devices.

Deferred from the MVP:

- [ ] AirDrop sharing.
- [ ] Factory integration.
- [ ] Access renewal.
- [ ] Manual rotation.
- [ ] Fetch.ai integration.
- [ ] Provider import and export.

Core stack: Tauri + Rust + macOS Keychain + SQLite metadata + Tailscale + AirDrop + MCP + Fetch.ai uAgents.

Security boundary: Expiration prevents future injection through the manager. It does not invalidate plaintext secrets previously copied or injected into running processes.
