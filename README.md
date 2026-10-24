# Vault: CalHacks 2026

Vault is a macOS credential and task handoff app built with Electron, React, and TypeScript.
Each device keeps its vault and private keys locally. Cloud-hosted SpacetimeDB relays encrypted messages between verified devices.
Unchecked items describe planned behavior.

## MVP flow

1. A local agent submits a secret or task through the Vault CLI.
2. The Electron app encrypts the payload for a verified, paired recipient device.
3. SpacetimeDB persists the encrypted message and routes it through authorized subscriptions over TLS.
4. The recipient decrypts locally and notifies its user. Agent execution requires local approval.
5. Encrypted delivery acknowledgments and execution results return through the relay to the sender.

## MVP feature checklist

- [ ] Desktop app: Electron, React, and TypeScript ([#24](https://github.com/omavashia2005/calhacks-vault/issues/24), [#13](https://github.com/omavashia2005/calhacks-vault/issues/13)).
- [ ] Local vault: Keychain-backed secret storage and local private keys ([#6](https://github.com/omavashia2005/calhacks-vault/issues/6), [#26](https://github.com/omavashia2005/calhacks-vault/issues/26)).
- [ ] Project scope: One demo project and the `dev` environment ([#7](https://github.com/omavashia2005/calhacks-vault/issues/7)).
- [ ] Secret management: Create, list, and delete local secrets ([#25](https://github.com/omavashia2005/calhacks-vault/issues/25), [#26](https://github.com/omavashia2005/calhacks-vault/issues/26), [#6](https://github.com/omavashia2005/calhacks-vault/issues/6)).
- [ ] CLI submission: Accept a secret or task from a local agent ([#5](https://github.com/omavashia2005/calhacks-vault/issues/5), [#7](https://github.com/omavashia2005/calhacks-vault/issues/7)).
- [ ] Verified pairing: Confirm device keys before sharing ([#15](https://github.com/omavashia2005/calhacks-vault/issues/15)).
- [ ] Encrypted relay: Persist and route handoffs through cloud-hosted SpacetimeDB ([#3](https://github.com/omavashia2005/calhacks-vault/issues/3), [#11](https://github.com/omavashia2005/calhacks-vault/issues/11), [#16](https://github.com/omavashia2005/calhacks-vault/issues/16), [#17](https://github.com/omavashia2005/calhacks-vault/issues/17)).
- [ ] Recipient execution: Notify the user and launch an approved agent task ([#8](https://github.com/omavashia2005/calhacks-vault/issues/8), [#17](https://github.com/omavashia2005/calhacks-vault/issues/17), [#18](https://github.com/omavashia2005/calhacks-vault/issues/18)).
- [ ] Delivery status: Return acknowledgments and execution results ([#11](https://github.com/omavashia2005/calhacks-vault/issues/11), [#14](https://github.com/omavashia2005/calhacks-vault/issues/14), [#17](https://github.com/omavashia2005/calhacks-vault/issues/17)).
- [ ] Reliable delivery: Handle offline recipients, retries, expiry, and duplicate execution ([#16](https://github.com/omavashia2005/calhacks-vault/issues/16), [#17](https://github.com/omavashia2005/calhacks-vault/issues/17), [#19](https://github.com/omavashia2005/calhacks-vault/issues/19)).
- [ ] Access control: Enforce injection-only grants and local approval ([#18](https://github.com/omavashia2005/calhacks-vault/issues/18)).
- [ ] Local expiry: Block expired grants and remove their local secret material ([#19](https://github.com/omavashia2005/calhacks-vault/issues/19)).
- [ ] Activity ledger: Show recipients, deadlines, delivery status, and execution outcomes ([#11](https://github.com/omavashia2005/calhacks-vault/issues/11), [#14](https://github.com/omavashia2005/calhacks-vault/issues/14)).
- [ ] Claude integration: Expose the narrow MCP interface ([#4](https://github.com/omavashia2005/calhacks-vault/issues/4), [#9](https://github.com/omavashia2005/calhacks-vault/issues/9), [#10](https://github.com/omavashia2005/calhacks-vault/issues/10)).
- [ ] Offline local access: Keep the vault usable during relay outages ([#12](https://github.com/omavashia2005/calhacks-vault/issues/12), [#20](https://github.com/omavashia2005/calhacks-vault/issues/20)).

Deferred from the MVP:

- [ ] AirDrop sharing ([#22](https://github.com/omavashia2005/calhacks-vault/issues/22)).
- [ ] Factory integration ([#23](https://github.com/omavashia2005/calhacks-vault/issues/23)).
- [ ] Access renewal.
- [ ] Manual rotation.
- [ ] Fetch.ai integration.
- [ ] Provider import and export.

Core stack: Electron + React + TypeScript + macOS Keychain + cloud-hosted SpacetimeDB + MCP.

## Storage and security

The Electron main process owns vault access, encryption, relay connections, and process launch.
The React renderer uses a narrow preload bridge. It clears entered secret values after submission and never receives stored values.
Vault has no separate application daemon.

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

## Development requirements

These checks apply when implementation begins:

- Run [React Doctor](https://www.react.doctor) in GitHub Actions.
- Run TypeScript checks (`tsc --noEmit`) and ESLint before merging.
- Check that the React frontend and Electron application compile.
- Add automated UI tests after the foundation screens work. Ask Claude to independently run UI tests before merging or the final push.
- Test encryption, storage, relay authorization, retries, expiry, duplicate execution, and offline behavior in CI.
- Document architecture, conventions, test commands, and agent instructions in AGENTS.md.

