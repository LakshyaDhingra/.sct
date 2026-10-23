## CalHacks 2026 Project: Local-first secure P2P credential sharing app

### MVP Flow
- Store a secret locally in Keychain.
- Let Claude Code start an application through controlled credential injection at runtime
- Share the credential securely with another device.
- Apply access restrictions and automatic expiry.
- Show the corresponding activity in local SpacetimeDB.


### MVP Feature List

1. Desktop App: macOS application built with Tauri, Rust, and TypeScript.
2. Encrypted Storage: Store secrets in macOS Keychain.
3. Project Isolation: Organize secrets by project and group.
4. Secret Management: Create, read, update, and delete secrets.
5. Runtime Injection: Inject secrets into applications without `.env` files.
6. P2P Sharing: Securely transfer secrets through Tailscale or encrypted AirDrop packages.
7. Access Control: Owners manage permissions. Recipients have injection-only access.
8. Automatic Expiry: Delete shared secrets after a configurable time limit.
9. Access Renewal: Request fresh secrets from the owner after expiration.
10. Manual Rotation: Replace secrets and distribute updated values.
11. Recipient Tracking: Record recipients, devices, and transfer timestamps.
12. Audit Logs: Track access, sharing, rotation, and expiration locally.
13. CLI: Manage secrets and launch applications from the terminal.
14. MCP Integration: Allow Claude Code, Codex, and other agents to use authorized operations.
15. Fetch.ai Integration: Enable local agent-to-agent communication using uAgents and direct local endpoints, without Agentverse.
16. Secure Import: Import secrets from `.env` files, 1Password, AWS Secrets Manager, Infisical, Doppler, Vault, and Keychain.
17. Secure Export: Export secrets to supported providers through authenticated APIs or CLIs.
18. Local-First Architecture: No central secrets database, mandatory cloud storage, or application-managed server.

Core stack: Tauri + Rust + macOS Keychain + SQLite metadata + Tailscale + AirDrop + MCP + Fetch.ai uAgents.

Security boundary: Expiration prevents future injection through the manager. It does not invalidate plaintext secrets previously copied or injected into running processes.
