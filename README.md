# .sct: CalHacks 2026

.sct is a macOS secret management and sharing app built with Electron, React, and TypeScript.
Each device keeps its vault and private keys locally.
The basic local app exists. Unchecked items describe planned behavior.

## Development order

1. Complete local project runtime injection in [#32](https://github.com/omavashia2005/.sct/issues/32) before relay setup.
2. Develop relay sharing and local Agent Access as independent branches.
3. Integrate remote agent requests and results in [#33](https://github.com/omavashia2005/.sct/issues/33) when both branches are ready.

The project folder must contain no .env file or equivalent secret-bearing file.
The local runner resolves the registered project and its external encrypted vault.
It injects variables into the child environment before the project command starts.
See [runtime injection and loader compatibility](docs/runtime-injection.md).

The relay branch defines SpacetimeDB setup, communication, pairing, and encrypted transfer.
It builds the sharing UI with actual delivery, then checks secure sharing in #20.
The local Agent Access branch adds local requests, approval, agent execution, MCP, and Claude integration.
It has no dependency on relay setup, pairing, delivery, or #20.
Only integration issue #33 requires both secure sharing and completed local Agent Access.

Title prefixes show a valid dependency order.
They do not require one independent branch to wait for another.
See [all issue prerequisites](docs/architecture.md#implementation-order).

## Feature checklist

Local foundation:

- [x] Check local vault operations (#6).
- [x] Inject project variables without .env or replacement project files ([1.7, #32](https://github.com/omavashia2005/.sct/issues/32)).

Relay and sharing branch:

- [ ] Hosted relay setup and communication schema (#3, #11).
- [ ] Electron relay connection, pairing, encrypted envelopes, and secure sharing IPC (#12, #15, #16, #13).
- [ ] Sharing UI and actual delivery from both app windows (#14, #17).
- [ ] Retry deadlines, grant cleanup, and secure sharing checks (#19, #20).

Independent local Agent Access branch:

- [ ] Local agent CLI, request contract, and MCP approval check (#5, #7, #4).
- [ ] Local project access, approval, and runtime injection for approved agents (#18, #8).
- [ ] Narrow MCP tools and local Claude integration (#9, #10).

Integration:

- [ ] Connect remote tasks, received grants, execution records, and encrypted results ([3.8, #33](https://github.com/omavashia2005/.sct/issues/33)).

Post-MVP:

- [x] Standalone AirDrop copies into a recipient-selected local project.
- [ ] AirDrop grant and agent integration (#22).
- [ ] Factory integration (#23).
- [ ] Access renewal, manual rotation, Fetch.ai integration, and provider import and export.

## Sharing and agent flows

Sharing starts in the desktop app.
Users verify device keys, select a secret and recipient, and submit an encrypted transfer.
SpacetimeDB persists ciphertext and routes authorized subscriptions.
The recipient checks and imports the secret locally, then returns an encrypted acknowledgment.
Receipt confirms delivery.

Local Agent Access uses the project's local vault, runtime injection, and explicit approval.
It works without relay configuration.
Claude Code's own model service may still require internet access.
Issue #33 later connects remote delivery to this local execution path.

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
Integration issue #33 adds durable execution records and local review for uncertain remote crash outcomes.

Local vault access remains available offline.
Relay messages and acknowledgments require a connection to SpacetimeDB.
Standalone AirDrop copies use the local verification and import flow below.
The UI identifies cached status and queued work during outages.
Message expiry blocks later delivery and import.
It does not revoke credentials already delivered.
Grant expiry separately blocks new local access and removes local grant material when cleanup runs.
External copies can retain credentials.
Running processes can retain injected values after grant expiry.

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
Values can be empty. Null characters are not valid environment values.

### Run a project

Build the signed app with `bun run package:mac`. Run its executable from your terminal:

```sh
bun run install:cli
cd /path/to/your/project
sct run -- bun run dev
```

The CLI selects the project from the current folder. You can also use `sct run "My project" -- bun run dev`.
The command runs in the registered source folder with that project's secrets available before startup.
Project secrets override matching inherited variables. The parent environment stays unchanged.
The launcher creates no `.env` or replacement secret files. The launched program and its descendants can read or copy their environment.
Saved key changes automatically restart the command. Keep it running instead of repeating the launch command.
See the [existing-project guide, operation details, and loader checks](docs/runtime-injection.md).

### TypeScript SDK

Build the local SDK with `bun run build:sdk`. Install `packages/env` into your application as described in the [SDK guide](packages/env/README.md).

```ts
import { loadEnv } from '@sct/env'

await loadEnv()
await import('./server.js')
```

The SDK updates `process.env` after saved changes without restarting the application.
Use `onChange` to recreate library clients that retain credentials during initialization.
The SDK has no runtime dependencies. The signed main process retains Keychain access and decryption.

### Share secrets through AirDrop

Open **Sharing** on both Macs. The first visit creates a local sharing identity in macOS Keychain.
Use the **Verify devices** sub-tab before sending to a new device.
The **Share secrets** sub-tab stays unavailable until a device is verified.
Select **Send my device card…** on each Mac, then choose AirDrop in the macOS share menu.
Device cards contain public keys only.

Ask the other person to send their device card back to you from .sct.
Select **Import .sct-device file…** to choose their received card, usually from Downloads.
This action opens the native file picker.
Compare the full pairing code on both screens through a trusted conversation.
Select **Confirm recipient** only if both codes match. Complete verification on both Macs.
Verify a new card if either device's keys change.

Select **Continue to Share secrets**, or open the **Share secrets** sub-tab.
Opening **Share secrets** from a project retains that project through verification and sub-tab changes.
Select a verified recipient and individual secrets, or select all secrets in that project.
Select **Send via AirDrop…**, then choose AirDrop in the macOS share menu.
.sct encrypts the package for the selected device before it creates a transfer file.

On the recipient Mac, accept AirDrop and open the `.sct-transfer` package in the signed .sct app.
You can also select **Open transfer…** in Sharing.
Choose a registered destination project, then select **Import secrets**.
.sct saves the imported copies in its configured `.sct/[project-name]/secrets.sct` file with fresh local Keychain keys.
The sender's project name and folder path do not determine this destination.
Existing secret names cause an error before any secret in the batch changes.
Choose another project or resolve the conflict before retrying.

Packages expire after 24 hours and cannot exceed 8 MiB or 1000 selected secrets.
The recipient checks the verified sender, signature, recipient, timestamps, and message ID before import.
Durable receipts and encrypted vault markers prevent duplicate imports after a restart or interrupted import.
An interrupted import remains bound to its original destination project.
Imports create permanent local copies. Package expiry does not revoke imported credentials.
This copy flow needs no relay, agent, or network connection beyond AirDrop.
Grant restrictions and remote execution remain separate work under #22 and #33.

AirDrop can first save the encrypted package in Downloads. Opening it in .sct selects its final vault project.
The macOS share menu exposes no delivery-completion event to Electron.
The sender therefore sees preparation status, not confirmed receipt.
The recipient confirms import locally. GSAP animates local activity and respects reduced-motion settings.

.sct keeps outbound ciphertext in its private application data until app exit.
After a crash, the next desktop startup removes expired outbound packages.
Import or dismissal removes the app's pending ciphertext copy.
The original AirDrop file remains where macOS saved it. You can delete that encrypted file after import.
Plaintext secret values and private keys never enter transfer files, logs, or renderer responses.
Secret values exist in main-process memory during encryption and import.
JavaScript strings cannot be explicitly cleared from memory.

Build with `bun run package:mac` to register `.sct-transfer` documents with macOS.
The development window does not register a file association.

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

Main-process code can use `Vault.withSecret(reference, use)` for an internal read under [#6](https://github.com/omavashia2005/.sct/issues/6).
The reference contains `projectId` and the secret `id`.
The method validates the reference and decrypts only the selected value with its existing Keychain key.
It waits for the callback, then clears the plaintext Buffer, including after a callback failure.
It also clears its copy of the value key after decryption.

A sender can encrypt the Buffer in the callback and return ciphertext. It must not retain or return plaintext.
Clearing a Buffer cannot clear copies that the callback creates, including strings.
Do not call another vault operation from the callback. Vault operations use the same serial queue.

No preload method or IPC handler exposes this read operation.
Consumers must keep plaintext out of renderer responses, logs, command arguments, and files.
The storage format stays unchanged. Local vault operations need no CLI, MCP server, or relay.

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
| `scripts/install-cli.ts` | Install the signed app's `sct` command link. |
| `packages/env/` | Dependency-free TypeScript SDK and its package documentation. |
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
| `bun run install:cli` | Install the `sct` command under `~/.local/bin`. |
| `bun run build:sdk` | Build SDK JavaScript and declarations with the pinned official compiler. |
| `bun run test:ui` | Build and test the actual Electron window on macOS. |
| `bun start` | Open the most recent build without a development server. |

The UI test blocks HTTP and WebSocket requests before the window opens.
It checks renderer isolation, folder selection, cancellation, invalid paths, duplicate folders, and persistence after restart.
It also checks secret save, update, and delete, value clearing, project rename and delete, and a vault move.
It checks metadata-only renderer responses. The vault tests check Keychain key removal after deletion.
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
- Check local agent approval and execution independently under #10.
- Check duplicate remote execution, crash recovery, and encrypted result return during integration under #33.
- Document architecture, conventions, test commands, and agent instructions in AGENTS.md.

