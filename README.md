# .sct

.sct is a macOS app that keeps project secrets out of project folders.
It stores secrets in an encrypted local vault and injects them into commands at runtime.
It also shares secrets between Macs through AirDrop or a relay, and lets coding agents use them after local approval.
It uses Electron, React, and TypeScript. Each Mac keeps its own vault and private keys.

## Status

| Area | State |
|---|---|
| Local vault, projects, and secrets | Done |
| Runtime injection (`sct run`) and the TypeScript SDK | Done |
| Encrypted sharing between Macs through AirDrop | Done |
| Agent Access: CLI, MCP server, skills, and Claude Code check | Done |
| Relay connection, encrypted cache, pairing, and sharing UI | Done |
| Relay delivery | Done |
| Relay expiry and two-device security check | Done |
| Remote agent tasks through the relay | Done |
| Mock Wallet cards through AirDrop | Built. |

See the [implementation order](docs/architecture.md#implementation-order).

## Quick start

Use macOS, Bun 1.4.4 or later, Node.js 22.18 or later, and the Xcode command line tools.

```sh
bun install
bun run dev
```

`bun run dev` opens the app. It needs no relay, cloud credentials, or environment variables.

Build the signed app to get the `sct` command and the file associations. The signed app also keeps its Keychain access after a rebuild.

```sh
bun run package:mac   # Do the one-time Keychain setup in docs/macos-signing.md first.
bun run install:cli   # This installs ~/.local/bin/sct.
```

## Use

**Projects and secrets.** Select **Add a project**. Choose an existing folder. Select **Open secrets** to add, update, or delete secrets.
The window never shows a stored value. .sct does not read or change files in the project folder. See [vault storage](docs/storage.md).

**Run a project with its secrets.** From the project folder:

```sh
sct run -- bun run dev
```

The command receives the secrets in its environment. A saved change restarts the command. The project needs no `.env` file. See [runtime injection](docs/runtime-injection.md).

**Load secrets in code.** The dependency-free [`@sct/env` SDK](packages/env/README.md) keeps `process.env` current without a restart:

```ts
import { loadEnv } from '@sct/env'

await loadEnv()
await import('./server.js')
```

**Share with another Mac.** Open **Sharing** on both Macs. Verify the other Mac one time. Then select **Send to…**.
The recipient chooses the local project that receives the secrets. See [sharing](docs/sharing.md).
To send through the relay, pair the Macs on the **Relay** tab. Then select **Queue encrypted transfer**.
See [relay setup](docs/relay.md) and the [two-device security check](docs/secure-sharing-check.md).

**Let an agent use secrets.** `sct agent` and `sct mcp` expose nine operations. Each request opens a local approval window.
Results contain metadata only. See [Agent Access](docs/agent-access.md) and the [Claude Code demo project](examples/claude-code/README.md).

**Send a mock Wallet card.** Open **Cards**. Type fake details. Select **Create and send to…**. Choose an iPhone in the picker.
walletmcppass.com signs the pass. See [mock Wallet cards](docs/wallet-cards.md).

## Security model

- The Electron main process owns the vault, Keychain access, encryption, and the start of child processes.
- Electron runs the renderer in a sandbox. The renderer receives metadata only. It never receives a stored value, a private key, or a relay token.
- Each secret value has its own key in macOS Keychain. Vault files contain ciphertext only.
- The sender's app encrypts each shared package for one verified device. Before import, the recipient's app checks the sender, the signature, and the deadline.
- An agent cannot approve its own request. .sct identifies the calling agent by its code signature.
- A program that receives a secret can copy it. Expiry and deletion cannot revoke copies.

See [architecture](docs/architecture.md) and the [glossary](docs/glossary.md).

## Repository layout

| Path | Contents |
|---|---|
| `src/main/` | Electron main process: vault, projects, runtime injection, sharing, relay, Agent Access, and Wallet cards |
| `src/preload/` | The operations that the renderer can call |
| `src/renderer/` | React screens and styles |
| `src/shared/` | Shared TypeScript contracts |
| `native/airdrop.swift` | Helper that opens only the AirDrop picker |
| `packages/env/` | The `@sct/env` SDK |
| `packages/relay/` | SpacetimeDB relay module |
| `skills/` | One agent skill for each Agent Access operation |
| `examples/claude-code/` | Demo-only Claude Code project |
| `demo/` | Fixed demo program for `run_demo` |
| `scripts/` | Packaging, signing, and CLI installation |
| `tests/` | Unit tests and Electron UI tests |

## Checks

| Command | Purpose |
|---|---|
| `bun run check` | Lint and type checks |
| `bun run typecheck:tsc` | Type checks with the pinned official TypeScript compiler |
| `bun run test` | Unit tests with real macOS Keychain |
| `bun run test:ui` | Build and test the Electron windows with network requests blocked |
| `bun run react-doctor` | React Doctor |
| `bun run build:sdk` | Build the SDK and check its declarations |
| `bun run package:mac` | Build and sign the macOS app, then check its signature |

GitHub Actions runs the lint, both type checks, the unit tests, `bun run build`, the UI tests, and React Doctor on macOS.
`bun run build` includes `bun run build:sdk`. CI does not run `bun run package:mac`. Contributors and agents follow [AGENTS.md](AGENTS.md).
