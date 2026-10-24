# .sct: CalHacks 2026

.sct is a macOS credential and task handoff app built with Electron, React, and TypeScript.
Each device keeps its vault and private keys locally. Cloud-hosted SpacetimeDB relays encrypted messages between verified devices.
Unchecked items describe planned behavior.

## MVP flow

1. A local agent submits a secret or task through the .sct CLI.
2. The Electron app encrypts the payload for a verified, paired recipient device.
3. SpacetimeDB persists the encrypted message and routes it through authorized subscriptions over TLS.
4. The recipient decrypts locally and notifies its user. Agent execution requires local approval.
5. Encrypted delivery acknowledgments and execution results return through the relay to the sender.

## MVP feature checklist

- [ ] Desktop app: Electron, React, and TypeScript ([#24](https://github.com/omavashia2005/.sct/issues/24), [#13](https://github.com/omavashia2005/.sct/issues/13)).
- [ ] Local vault: Keychain-backed secret storage and local private keys ([#6](https://github.com/omavashia2005/.sct/issues/6), [#26](https://github.com/omavashia2005/.sct/issues/26)).
- [ ] Project scope: One demo project and the `dev` environment ([#7](https://github.com/omavashia2005/.sct/issues/7)).
- [ ] Secret management: Create, list, and delete local secrets ([#25](https://github.com/omavashia2005/.sct/issues/25), [#26](https://github.com/omavashia2005/.sct/issues/26), [#6](https://github.com/omavashia2005/.sct/issues/6)).
- [ ] CLI submission: Accept a secret or task from a local agent ([#5](https://github.com/omavashia2005/.sct/issues/5), [#7](https://github.com/omavashia2005/.sct/issues/7)).
- [ ] Verified pairing: Confirm device keys before sharing ([#15](https://github.com/omavashia2005/.sct/issues/15)).
- [ ] Encrypted relay: Persist and route handoffs through cloud-hosted SpacetimeDB ([#3](https://github.com/omavashia2005/.sct/issues/3), [#11](https://github.com/omavashia2005/.sct/issues/11), [#16](https://github.com/omavashia2005/.sct/issues/16), [#17](https://github.com/omavashia2005/.sct/issues/17)).
- [ ] Recipient execution: Notify the user and launch an approved agent task ([#8](https://github.com/omavashia2005/.sct/issues/8), [#17](https://github.com/omavashia2005/.sct/issues/17), [#18](https://github.com/omavashia2005/.sct/issues/18)).
- [ ] Delivery status: Return acknowledgments and execution results ([#11](https://github.com/omavashia2005/.sct/issues/11), [#14](https://github.com/omavashia2005/.sct/issues/14), [#17](https://github.com/omavashia2005/.sct/issues/17)).
- [ ] Reliable delivery: Handle offline recipients, retries, expiry, and duplicate execution ([#16](https://github.com/omavashia2005/.sct/issues/16), [#17](https://github.com/omavashia2005/.sct/issues/17), [#19](https://github.com/omavashia2005/.sct/issues/19)).
- [ ] Access control: Enforce injection-only grants and local approval ([#18](https://github.com/omavashia2005/.sct/issues/18)).
- [ ] Local expiry: Block expired grants and remove their local secret material ([#19](https://github.com/omavashia2005/.sct/issues/19)).
- [ ] Activity ledger: Show recipients, deadlines, delivery status, and execution outcomes ([#11](https://github.com/omavashia2005/.sct/issues/11), [#14](https://github.com/omavashia2005/.sct/issues/14)).
- [ ] Claude integration: Expose the narrow MCP interface ([#4](https://github.com/omavashia2005/.sct/issues/4), [#9](https://github.com/omavashia2005/.sct/issues/9), [#10](https://github.com/omavashia2005/.sct/issues/10)).
- [ ] Offline local access: Keep the vault usable during relay outages ([#12](https://github.com/omavashia2005/.sct/issues/12), [#20](https://github.com/omavashia2005/.sct/issues/20)).

Deferred from the MVP:

- [ ] AirDrop sharing ([#22](https://github.com/omavashia2005/.sct/issues/22)).
- [ ] Factory integration ([#23](https://github.com/omavashia2005/.sct/issues/23)).
- [ ] Access renewal.
- [ ] Manual rotation.
- [ ] Fetch.ai integration.
- [ ] Provider import and export.

Core stack: Electron + React + TypeScript + macOS Keychain + cloud-hosted SpacetimeDB + MCP.

## Storage and security

The Electron main process owns vault access, encryption, relay connections, and process launch.
The React renderer uses a narrow preload bridge. It clears entered secret values after submission and never receives stored values.
.sct has no separate application daemon.

The relay stores ciphertext and minimal routing metadata.
Plaintext secrets, tasks, execution output, and private keys stay off the relay.
TLS protects connections. Server-side authorization restricts reads, subscriptions, and writes to authenticated message participants.
Users verify device keys during pairing. A relay identity alone does not establish trust in a device key.

Persisted messages support offline delivery until their delivery deadline. Retries reuse the same message ID.
Durable execution records prevent duplicate deliveries from automatically launching a task again.
An uncertain outcome after a crash requires local review.

Local vault access remains available offline. Cross-device delivery, acknowledgments, and results require the relay.
The UI shows cached status and queued work during outages.
Message expiry prevents later delivery or execution of that message. It does not revoke credentials already delivered.
Grant expiry separately blocks future local use and removes local grant material when cleanup runs.
Copied credentials and running processes can retain secret values.

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
The vault tests and the UI test use real macOS Keychain. They remove their Keychain items when they pass.
The test supplies folder-picker results automatically. It does not operate the native macOS dialog.
GitHub Actions runs these checks and React Doctor on macOS.

## Development requirements

These checks apply to implementation:

- Run [React Doctor](https://www.react.doctor) in GitHub Actions.
- Run `bun run check` and `bun run typecheck:tsc` before merging.
- Check that the React frontend and Electron application compile.
- Add automated UI tests after the foundation screens work. Ask Claude to independently run UI tests before merging or the final push.
- Test encryption, storage, relay authorization, retries, expiry, duplicate execution, and offline behavior in CI.
- Document architecture, conventions, test commands, and agent instructions in AGENTS.md.

