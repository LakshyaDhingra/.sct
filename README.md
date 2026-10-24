# .sct

.sct is a macOS app that keeps project secrets out of project folders.
It stores secrets in an encrypted local vault and injects them into commands at runtime.
It also shares secrets between Macs and lets coding agents use them after local approval.
It uses Electron, React, and TypeScript. Each Mac keeps its own vault and private keys.

## Status

| Area | State |
|---|---|
| Local vault, projects, and secrets | Done |
| Runtime injection (`sct run`) and the TypeScript SDK | Done |
| Encrypted sharing between Macs through AirDrop | Done |
| Agent Access: CLI, MCP server, skills, and Claude Code check | Done |
| Relay connection, encrypted cache, and pairing operations | Done. The pairing has no screen yet. |
| Relay delivery, expiry, and two-device check | Open: [#14](https://github.com/omavashia2005/.sct/issues/14), [#16](https://github.com/omavashia2005/.sct/issues/16), [#17](https://github.com/omavashia2005/.sct/issues/17), [#19](https://github.com/omavashia2005/.sct/issues/19), [#20](https://github.com/omavashia2005/.sct/issues/20) |
| Remote agent tasks through the relay | Open: [#33](https://github.com/omavashia2005/.sct/issues/33) |
| Post-MVP | Open: [#22](https://github.com/omavashia2005/.sct/issues/22), [#23](https://github.com/omavashia2005/.sct/issues/23), [#40](https://github.com/omavashia2005/.sct/issues/40) |

See the [implementation order](docs/architecture.md#implementation-order).

## Quick start

Use macOS, Bun 1.4.4 or later, Node.js 22.18 or later, and the Xcode command line tools.

```sh
bun install
bun run dev
```

`bun run dev` opens the app. It needs no relay, cloud credentials, or environment variables.

For the `sct` command, file associations, and Keychain access that stays the same after rebuilds, build the signed app:

```sh
bun run package:mac   # one-time Keychain setup: docs/macos-signing.md
bun run install:cli   # installs ~/.local/bin/sct
```

## Use

**Projects and secrets.** Select **Add a project** and choose an existing folder. Select **Open secrets** to add, update, or delete secrets.
The window never shows a stored value. .sct does not read or change files in the project folder. See [vault storage](docs/storage.md).

**Run a project with its secrets.** From the project folder:

```sh
sct run -- bun run dev
```

The command receives the secrets in its environment. A saved change restarts it. No `.env` file is necessary. See [runtime injection](docs/runtime-injection.md).

**Load secrets in code.** The dependency-free [`@sct/env` SDK](packages/env/README.md) keeps `process.env` current without a restart:

```ts
import { loadEnv } from '@sct/env'

await loadEnv()
await import('./server.js')
```

**Share with another Mac.** Open **Sharing** on both Macs, verify each other's device once, then select **Send to…**.
The recipient chooses the local project that receives the secrets. See [sharing](docs/sharing.md).

**Let an agent use secrets.** `sct agent` and `sct mcp` expose nine operations. Each request opens a local approval window.
Results contain metadata only. See [Agent Access](docs/agent-access.md) and the [Claude Code demo project](examples/claude-code/README.md).

## Security model

- The Electron main process owns the vault, Keychain access, encryption, and process launch.
- The renderer is sandboxed. It receives metadata only and never a stored value, private key, or relay token.
- Each secret value has its own key in macOS Keychain. Vault files contain ciphertext only.
- Shared packages are encrypted for one verified device. The recipient checks the sender, signature, and deadline before import.
- An agent cannot approve its own request. .sct identifies the calling agent by its code signature.
- A program that receives a secret can copy it. Expiry and deletion cannot revoke copies.

See [architecture](docs/architecture.md) and the [glossary](docs/glossary.md).

## Repository layout

| Path | Contents |
|---|---|
| `src/main/` | Electron main process: vault, projects, runtime injection, sharing, relay, and Agent Access |
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
| `bun run package:mac` | Build, sign, and verify the macOS app |

GitHub Actions runs these checks on macOS. Contributors and agents follow [AGENTS.md](AGENTS.md).
