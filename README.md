# .sct

.sct is a macOS app that keeps project secrets out of project folders.
Your project needs no `.env` file.

- **Vault.** .sct keeps secrets in an encrypted local vault. Each value has its own key in macOS Keychain.
- **Runtime injection.** `sct run -- <command>` gives the command its secrets as environment variables.
- **Sharing.** .sct sends encrypted secrets to a verified Mac through AirDrop or a relay.
- **Agent Access.** Coding agents use secrets through a CLI and an MCP server. Each request opens a local approval window. Agents never receive secret values.

## Quick setup

Use macOS, Bun 1.4.4 or later, Node.js 22.18 or later, and the Xcode command line tools.

```sh
git clone https://github.com/omavashia2005/.sct.git
cd .sct
bun install
bun run dev
```

`bun run dev` opens the app. It needs no relay, cloud credentials, or environment variables.

To get the `sct` command, build the signed app. First, do the one-time Keychain setup in [macOS signing](docs/macos-signing.md).

```sh
bun run package:mac
bun run install:cli   # Installs ~/.local/bin/sct
```

Then, in the app, add a project folder and its secrets. Run the project from its folder:

```sh
sct run -- bun run dev
```

## Agent setup prompt

Paste this prompt into your coding agent:

```text
Set up .sct on this Mac. Follow these steps in sequence:

1. Clone https://github.com/omavashia2005/.sct.git and open the cloned folder.
2. Read AGENTS.md and README.md.
3. Run `bun install`.
4. Run `security find-identity -v -p codesigning`.
   If the output does not show exactly one valid ".sct Development" identity, stop.
   Tell me to follow docs/macos-signing.md. Do not create, export, or change certificates.
5. Run `bun run package:mac`, then run `bun run install:cli`.
6. Add the MCP server "sct" with the command `~/.local/bin/sct` and the argument `mcp`.
7. Open the signed app from dist/. Tell me to choose a vault location outside every project folder.

Rules:
- Never read, print, or write a secret value.
- Never create a .env file or another secret file.
- Each .sct request opens an approval window. Wait for my decision. Do not retry a refused or expired request without my instruction.
```

## Docs

- [Runtime injection](docs/runtime-injection.md) and the [`@sct/env` SDK](packages/env/README.md)
- [Sharing](docs/sharing.md) and [relay setup](docs/relay.md)
- [Agent Access](docs/agent-access.md) and the [Claude Code demo project](examples/claude-code/README.md)
- [Architecture](docs/architecture.md), [vault storage](docs/storage.md), and the [glossary](docs/glossary.md)

Contributors and agents follow [AGENTS.md](AGENTS.md).
