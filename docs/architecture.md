# Vault MVP: Architecture, sequence, and dependency order

## Architecture

```mermaid
flowchart LR
  subgraph A[Om's Mac]
    Agent[Claude Code / Factory Droid] -->|MCP request| M[vault MCP]
    UI[Electron UI] -->|local IPC| D[vault daemon]
    M --> D
    D --> KC[(macOS Keychain: secrets)]
    D --> SD[(Local SpacetimeDB: metadata and audit)]
    D -->|approved launch| App[Demo process]
    D -->|sign and encrypt| P[Encrypted grant]
  end
  P --> T[Tailscale or AirDrop]
  T --> R[Recipient verifies package]
  subgraph B[Lakshya's Mac]
    R --> RD[vault daemon]
    RD --> RK[(macOS Keychain)]
    RD --> RS[(Local SpacetimeDB)]
  end
```

## Sequence

```mermaid
sequenceDiagram
 autonumber
 actor Om
 participant V as vault daemon
 participant K as Keychain
 participant S as SpacetimeDB
 participant C as Claude Code
 participant T as Tailscale / AirDrop
 participant L as Lakshya's Vault
 Om->>V: Set secret
 V->>K: Store value
 V->>S: Record metadata
 Om->>C: Start application
 C->>V: Request run_demo via MCP
 V->>Om: Request local approval
 Om-->>V: Approve
 V->>K: Read value
 V->>V: Start approved process with environment value
 V->>S: Record injection event
 Om->>V: Share secret with expiry
 V->>V: Encrypt and sign grant for recipient
 V->>T: Send package
 T->>L: Deliver package
 L->>L: Verify signature, recipient, and replay ID
 L->>L: Store secret in Keychain
 L-->>V: Signed acknowledgement when connected
 V->>S: Record share event
 Note over L: Grant expires
 L->>L: Block future access and delete local Keychain item
 L->>L: Record expiry event
```

## Topological order

Issues can run in parallel only after all dependencies are met.

| Phase | @omavashia2005 | @LakshyaDhingra |
|---|---|---|
| Setup | #1 signing identity, #4 MCP approval | #3 local SpacetimeDB |
| Core | #2 Keychain rebuild, #5 workspace, #6 Keychain, #7 core API | #11 database schema, #12 daemon |
| Runtime | #8 injection, #9 MCP, #10 Claude | #13 Electron, #14 UI |
| Sharing | #16 encrypted grants, #18 access controls | #15 pairing, #17 Tailscale |
| Completion | #24 Droid, #22 submission | #19 expiry, #23 AirDrop, #20 security, #21 demo |

### Dependency edges

- #1 → #2 → #5 → #6 → #7 → #8 → #9 → #10.
- #4 → #9 → #24.
- #3 → #11 → #12 → #13 → #14 → #15 → #16 → #17.
- #6 → #12 and #15. #7 also needs #11.
- #8 and #16 → #18.
- #12 and #16 → #17.
- #17 and #18 → #19.
- #15 and #16 → #23.
- #10 and #19 → #20.
- #10, #14, #17, and #19 → #21 → #22.

Treat these edges as authoritative when phases overlap. Do not start an issue until its predecessors pass their acceptance checks.

## Security constraints

Only Keychain stores plaintext secret values at rest. SpacetimeDB and the UI store metadata only. Approved child processes receive credentials and can read them. Vault cannot prevent arbitrary child processes from copying credentials. Expiry prevents new Vault access but cannot revoke copied credentials at an external service.

All issues with `priority:mvp` are required before post-MVP work. Other sponsor tracks remain deferred. See [Technical glossary](https://github.com/omavashia2005/calhacks-kuber/blob/main/docs/glossary.md).
