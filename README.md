# .sct: CalHacks 2026

.sct is a macOS secret management and sharing app built with Electron, React, and TypeScript.
Each device keeps its vault and private keys locally.
Cloud-hosted SpacetimeDB will relay encrypted secrets between verified devices.
The basic local app exists. Phase 2 now adds sharing.
Unchecked items describe planned behavior.

## Development order

1. **Phase 2.1: SpacetimeDB setup and contracts.** Define the schema, communication, device pairing, and encrypted transfer format.
2. **Phase 2.2: Sharing UI, delivery, and security checks.** Build app controls with delivery so users can test sharing directly.
3. **Phase 3: Agent Access.** Add CLI, MCP, approval, execution, and result return only after secure sharing passes.

Phase 2 requires no CLI, MCP server, installed agent, task execution, or agent approval.
Issue [#20](https://github.com/omavashia2005/.sct/issues/20) is the acceptance checkpoint before any Agent Access issue starts.
GitHub title prefixes define the order. Issue IDs stay unchanged.
See the complete [issue order and prerequisites](docs/architecture.md#implementation-order).

## Phase 2 sharing flow

1. Both users verify their device keys through pairing in the app.
2. The sender selects a local secret, a verified recipient, and deadlines in the sharing UI.
3. The sender app encrypts and signs the transfer in its Electron main process.
4. SpacetimeDB persists ciphertext and routes it through authorized subscriptions over TLS.
5. The recipient checks the transfer and protects the received secret in its local vault.
6. An encrypted acknowledgment returns through the relay, and both apps show delivery status.

Receipt confirms delivery.
Agent execution and results belong to Phase 3.

## Feature checklist

The local app already provides project management, local secret operations, encrypted files, Keychain keys, and configurable vault storage.
Issues #24, #1, #25, #26, and #2 are closed.
Issue [#6](https://github.com/omavashia2005/.sct/issues/6) remains an open check of the vault operations before sharing.

Phase 2.1:

- [ ] Hosted relay setup ([2.1.1, #3](https://github.com/omavashia2005/.sct/issues/3)).
- [ ] Authorized schema and communication contract ([2.1.2, #11](https://github.com/omavashia2005/.sct/issues/11)).
- [ ] Electron relay connection and durable queue ([2.1.3, #12](https://github.com/omavashia2005/.sct/issues/12)).
- [ ] Verified device pairing ([2.1.4, #15](https://github.com/omavashia2005/.sct/issues/15)).
- [ ] Encrypted transfer and acknowledgment format ([2.1.5, #16](https://github.com/omavashia2005/.sct/issues/16)).
- [ ] Secure sharing IPC ([2.1.6, #13](https://github.com/omavashia2005/.sct/issues/13)).

Phase 2.2:

- [ ] Sharing controls and delivery activity ([2.2.1, #14](https://github.com/omavashia2005/.sct/issues/14)).
- [ ] Actual delivery and acknowledgments from both app windows ([2.2.2, #17](https://github.com/omavashia2005/.sct/issues/17)).
- [ ] Retry deadlines, grant expiry, and local cleanup ([2.2.3, #19](https://github.com/omavashia2005/.sct/issues/19)).
- [ ] Two-device security and offline checks ([2.2.4, #20](https://github.com/omavashia2005/.sct/issues/20)).

Phase 3, after #20 passes:

- [ ] CLI, MCP entrypoint, and demo build commands ([3.1, #5](https://github.com/omavashia2005/.sct/issues/5)).
- [ ] Local agent request API and CLI transport ([3.2, #7](https://github.com/omavashia2005/.sct/issues/7)).
- [ ] Claude Code MCP approval check ([3.3, #4](https://github.com/omavashia2005/.sct/issues/4)).
- [ ] Local grant access and agent approval ([3.4, #18](https://github.com/omavashia2005/.sct/issues/18)).
- [ ] Approved execution, activity states, and encrypted results ([3.5, #8](https://github.com/omavashia2005/.sct/issues/8)).
- [ ] Narrow MCP tools ([3.6, #9](https://github.com/omavashia2005/.sct/issues/9)).
- [ ] Claude integration and Agent Access checks ([3.7, #10](https://github.com/omavashia2005/.sct/issues/10)).

Post-MVP:

- [ ] AirDrop sharing ([4.1, #22](https://github.com/omavashia2005/.sct/issues/22)).
- [ ] Factory integration ([4.2, #23](https://github.com/omavashia2005/.sct/issues/23)).
- [ ] Access renewal.
- [ ] Manual rotation.
- [ ] Fetch.ai integration.
- [ ] Provider import and export.

Core stack: Electron, React, TypeScript, macOS Keychain, and cloud-hosted SpacetimeDB.
Phase 3 adds CLI and MCP access.

## Storage and security

The Electron main process owns vault access, encryption, relay connections, and local cleanup.
Phase 3 adds approved process launch.
The React renderer uses a narrow preload bridge.
It clears entered values after submission and never receives stored values.

The planned relay stores ciphertext and minimal routing metadata.
Plaintext secrets and private keys stay outside relay rows and logs.
TLS protects connections.
Server-side authorization restricts reads, subscriptions, and writes to authenticated message participants.
Users verify device keys during pairing.
A relay identity alone does not establish trust in a device key.

Persisted ciphertext supports offline delivery until its deadline.
Retries reuse the same message ID.
Durable receipt records prevent duplicate secret imports.
Phase 3 adds durable execution records and local review for uncertain crash outcomes.

Local vault access remains available offline.
Cross-device delivery and acknowledgments require the relay.
The UI identifies cached status and queued work during outages.
Message expiry blocks later delivery and import.
It does not revoke credentials already delivered.
Grant expiry separately blocks new local access and removes local grant material when cleanup runs.
External copies can retain credentials.
Phase 3 processes can retain injected values after grant expiry.

See [architecture and implementation order](docs/architecture.md) and the [technical glossary](docs/glossary.md).

## Run the desktop app

Use macOS, Bun 1.4.4 or later, and Node.js 22.18 or later.
Install the dependencies once:

```sh
bun install
```

Start the app with one command:

```sh
bun run dev
```

The command builds the main process and preload script, starts the local renderer server, and opens the Electron window.
The window opens without a relay connection, cloud credentials, or environment variables.

To create a locally signed macOS application, follow [local macOS signing](docs/macos-signing.md).
After the one-time Keychain setup, run `bun run package:mac`.

Select **Add a project**. Select **Choose folder…** to open the macOS folder picker, or enter an absolute folder path.
Enter a project name. Select **Add project** to save it.
.sct requires an existing folder and rejects duplicate folders, including symbolic links to a saved folder.
.sct saves project names and paths in `projects.json` under Electron's local `userData` directory.
On macOS, this directory normally is `~/Library/Application Support/.sct`.
.sct does not move, read, or change the selected folder's contents.
Project names must be unique. .sct ignores letter case when it compares names.
Project names and paths remain available after restart.
Each project row has **Open secrets**, **Rename**, and **Delete**. To delete a project, type its name.

### Manage secrets

Select **Open secrets** on a project. Enter a name and a value, then select **Save secret**.
Names use letters, digits, and underscores, and cannot start with a digit. A project cannot have two secrets with the same name.
.sct clears the value field after each request. The window never shows a stored value.
Select **Update value** to replace a value. Select **Delete** to remove a secret.
Select **All secrets** to see the secret names of all projects.

### Vault storage

At startup, .sct creates the `.sct/` vault folder in your home folder (`~/.sct`).
Each project has its own `.sct/[project-name]/` folder with one `secrets.sct` file.
The file contains encrypted secret names and encrypted values. Each value has a different key.
macOS Keychain keeps the file key and the value keys under the `.sct` service.
To read a value, .sct needs the file and the Keychain keys.
Select **Storage**, then **Change location…**, to move the vault folder to a different folder.
.sct saves the location in `settings.json` in the `userData` directory. The Keychain keys stay in Keychain.
Deleting a project removes its vault folder and its Keychain keys. Relay delivery is not implemented yet.

If Keychain rejects a secret deletion, .sct restores the encrypted entry so you can retry.
A failed project deletion keeps the project and its remaining secret entries for another attempt.
The local secret workflow implements [#26](https://github.com/omavashia2005/.sct/issues/26) and does not require a relay connection.

## Project structure

| Path | Purpose |
|---|---|
| `src/main/` | Electron lifecycle, native folder picker, validated requests, local project storage, and the encrypted vault. |
| `src/preload/` | Explicit project, secret, and storage operations exposed through `contextBridge`. |
| `src/renderer/` | React window, project and secret views, storage settings, and styles. |
| `src/shared/` | TypeScript contracts for the preload API, projects, and secret metadata. |
| `tests/` | Storage and vault tests, and an Electron UI test with network requests blocked. |
| `electron.vite.config.ts` | Main, preload, and renderer build configuration. |
| `scripts/package-macos.ts` | Local macOS packaging, signing, and signature checks. |
| `.github/workflows/checks.yml` | macOS checks and React Doctor. |
| `out/` | Generated application files. Git ignores this directory. |

The renderer uses context isolation and process sandboxing. It has no Node.js access.
The main process checks each request's sender and validates project and secret input before storage.
The preload exposes only the operations in `src/shared/api.ts`. Responses contain secret metadata only, never a secret value.
The main process selects the vault location through the native folder picker. The renderer does not send a storage path.
Local startup does not import a relay client.

## Check the implementation

| Command | Check |
|---|---|
| `bun run check` | Canonical lint and local type check. |
| `bun run typecheck` | TypeScript checks for Electron, React, shared contracts, and tests. |
| `bun run typecheck:tsc` | Pinned official TypeScript compiler checks. |
| `bun run lint` | ESLint checks. |
| `bun run react-doctor` | React Doctor checks. |
| `bun run test` | Persistence, input validation, duplicate folders, concurrent saves, invalid saved data, vault encryption, Keychain keys, and vault moves. |
| `bun run build` | TypeScript checks and builds for main, preload, and renderer. |
| `bun run package:mac` | Build and sign a local macOS application with the persistent Keychain identity. |
| `bun run test:ui` | Build and test the actual Electron window on macOS. |
| `bun start` | Open the most recent build without a development server. |

The UI test blocks HTTP and WebSocket requests before the window opens.
It checks renderer isolation, folder selection, cancellation, invalid paths, duplicate folders, and persistence after restart.
It also checks secret save, update, and delete, value clearing, project rename and delete, and a vault move.
It checks metadata-only renderer responses and Keychain key removal after deletion.
The vault tests and the UI test use real macOS Keychain. They remove their Keychain items when they pass.
The vault tests also check deletion retries after a rejected Keychain operation.
The test supplies folder-picker results automatically. It does not operate the native macOS dialog.
GitHub Actions runs these checks and React Doctor on macOS.

## Development requirements

These checks apply to implementation:

- Run [React Doctor](https://www.react.doctor) in GitHub Actions.
- Run `bun run check` and `bun run typecheck:tsc` before merging.
- Check that the React frontend and Electron application compile.
- Run existing Playwright UI checks and React Doctor after each UI change.
- Obtain approval before adding new tests, as required by AGENTS.md.
- Check encryption, storage, relay authorization, retries, expiry, duplicate imports, and offline behavior during Phase 2.
- Check agent approval, duplicate execution, crash recovery, and result return during Phase 3 after #20 passes.
- Document architecture, conventions, test commands, and agent instructions in AGENTS.md.

