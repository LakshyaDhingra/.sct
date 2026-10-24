# .sct technical glossary

These terms describe the development plan. Implementation tests must establish the stated behavior.

## .sct

The Electron, React, and TypeScript app in this repository. It manages local credentials and encrypted device handoffs.

## App signing identity

<a id="signing-identity"></a>

A certificate and private key that identify the macOS app. Keep the signing private key outside Git.

## Stable code signature

The app uses the same development signing identity after rebuilds. Test Keychain access after a signed rebuild.

## Keychain

The macOS service that protects credentials, device private keys, and keys for encrypted local files.

## Local vault

The device's Keychain-backed credential storage. Any secret files contain ciphertext. Local access remains available during relay outages.

## SpacetimeDB

The cloud-hosted relay for persisted ciphertext, routing metadata, grants, and delivery status. Device subscriptions receive authorized rows.

## Relay

A service that persists and routes encrypted messages. It does not receive the keys needed to decrypt payloads.

## Subscription

A connection that receives database updates. Server-side authorization limits which messages a device can receive.

## TLS

Transport Layer Security protects the relay connection. Payload encryption separately protects message contents from the relay.

## Server-side authorization

Relay checks that bind operations to an authenticated device identity. These checks restrict reads, subscriptions, writes, and status changes.

## Electron main process

The trusted TypeScript process for vault access, encryption, relay connections, expiry checks, and approved process launch.
.sct uses no separate application daemon.

## IPC

Inter-process communication. A narrow preload bridge connects the renderer to approved main-process operations.
CLI requests also require a restricted local channel to the Electron app.

## Renderer

The Electron process that displays the React UI. It clears entered secret values after submission and never receives stored values.

## CLI

Command-line interface. Local agents submit tasks, secrets through stdin, or local vault references.

## MCP

Model Context Protocol. Claude Code uses narrow tools to request authorized .sct actions.

## Local approval

The recipient user's decision before agent execution. A relay message or agent cannot approve its own launch.

## Injection

Passing a local credential to an approved process through its environment. The process can read the value.

## Secret boundary

The rules that limit which processes receive secret values. An approved process can copy a credential it receives.

## Device identity

A device's signing and encryption keys, bound to its authenticated relay identity. Private keys remain in the local vault.

## Pairing

Both users compare a code derived from their device keys. Each device pins the verified peer keys before sharing.

## Digital signature

A value that authenticates the sender and signed envelope fields. The recipient checks it using the pinned sender key.

## Encrypted handoff

A signed envelope for one recipient. Its ciphertext contains a secret, task, grant, acknowledgment, or result.

## Encrypted grant

A handoff payload that contains a credential and local access restrictions. Only the intended recipient decrypts it.

## Message ID

A stable identifier reused across retries. Duplicate IDs cannot trigger another automatic execution.

## Correlation ID

The original handoff ID included in acknowledgments and results. It connects replies to the sender's request.

## Delivery acknowledgment

<a id="signed-acknowledgement"></a>

An encrypted, authenticated reply confirming durable receipt. It does not confirm execution success.

## Execution result

An encrypted, correlated reply containing an approved outcome or redacted result. It excludes credentials and unrestricted logs.

## Execution claim

A durable local record written before launch. A claim without a known outcome requires local review after a crash.

## Duplicate-execution protection

Durable message IDs, execution claims, and outcomes that prevent retries from automatically starting the same task again.

## Grant

An authorization record for a recipient, credential, permitted operation, and absolute access deadline.

## Injection-only grant

A permission that allows approved process injection. .sct denies reveal, copy, and reshare for received grants.

## TTL

Time to live. Convert it to an absolute deadline. Distinguish message delivery deadlines from grant access deadlines.

## Message expiry

The deadline after which a message cannot be delivered or executed. It does not revoke a credential already delivered.

## Access expiry

The grant deadline that blocks new vault use. Local cleanup removes grant material and queues a notification for the sender.
Cleanup resumes at startup or wake. It cannot remove external copies or a running process's environment.

## Audit event

A metadata record of submission, receipt, approval, execution, or expiry. It contains no secret value or plaintext task output.

## Replay attack

Repeated delivery of an old message. Deadline checks and durable duplicate records prevent automatic execution of the repeated request.

## Redaction

Removing recognized secret values from output before display or transmission. It does not make arbitrary agent output safe.

## AirDrop

A deferred transport for the same encrypted handoff format. Issue #22 is outside MVP scope.

## Droid

Factory's coding agent. Its integration remains post-MVP in issue #23.

## Threat model

The protected data, trusted processes, possible attackers, and limits of the design. Message expiry cannot revoke delivered credentials.
