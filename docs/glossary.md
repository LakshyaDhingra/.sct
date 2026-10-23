# Vault technical glossary

This document defines technical terms used in the MVP issues. Terms describe the planned design, not verified security guarantees.

## Signing identity

<a id="signing-identity"></a>

A certificate and private key that identify the executable when macOS checks its code signature. Do not commit the private key.

## Keychain

<a id="keychain"></a>

The macOS service that stores passwords and cryptographic keys. Vault uses it to store credential values and device private keys.

## Stable code signature

<a id="stable-code-signature"></a>

A code signature that uses the same signing identity after each build. This can keep macOS Keychain access consistent.

## SpacetimeDB

<a id="spacetimedb"></a>

A database that runs on each Mac. Vault stores metadata and activity here, not secret values.

## MCP

<a id="mcp"></a>

Model Context Protocol. A tool interface that lets Claude Code request approved actions from Vault.

## Local approval

<a id="local-approval"></a>

A user decision made in the Vault app before a sensitive action. An agent cannot approve its own request.

## Injection

<a id="injection"></a>

The act of providing a credential to a child process at start time, usually through an environment variable. The child process can read that credential.

## Secret boundary

<a id="secret-boundary"></a>

The part of the design that limits which processes receive credential values. Redaction and an MCP tool alone do not prevent exfiltration.

## Daemon

<a id="daemon"></a>

A long-running local Rust process that manages Vault operations and database connections.

## IPC

<a id="ipc"></a>

Inter-process communication. Vault uses a local Unix socket to exchange approved requests and metadata.

## Renderer

<a id="renderer"></a>

The Electron process that displays the user interface. It must not receive secret values.

## Device identity

<a id="device-identity"></a>

A device-specific key pair used to verify which peer sent a message. The private key stays on its device.

## Pairing

<a id="pairing"></a>

The process in which two users compare a code and accept each other's public keys.

## Digital signature

<a id="digital-signature"></a>

A cryptographic value that a sender creates with its private key. The recipient checks it with the sender's public key.

## Encrypted grant

<a id="encrypted-grant"></a>

A signed package that contains an encrypted secret and access limits for one recipient. Only the intended recipient can decrypt the payload.

## Tailscale

<a id="tailscale"></a>

A private network transport used to deliver Vault packages between paired devices.

## AirDrop

<a id="airdrop"></a>

A macOS file-transfer method. Vault uses it to carry the same encrypted grant packages without a new secret format.

## Grant

<a id="grant"></a>

An authorization record that states which device can use a secret, what it can do, and when access expires.

## Injection-only grant

<a id="injection-only-grant"></a>

A Vault permission that allows approved process injection but blocks reveal, copy, and reshare through Vault. It cannot prevent the child process from reading the value.

## TTL

<a id="ttl"></a>

Time to live. The duration of a grant before Vault refuses new operations that use it.

## Access expiry

<a id="access-expiry"></a>

The time when Vault stops new access and attempts to delete a received Keychain item. It cannot revoke a value already copied or used by a running process.

## Audit event

<a id="audit-event"></a>

A metadata record of an action. It identifies the action and actor but does not store a secret value.

## Droid

<a id="droid"></a>

Factory's coding agent. Vault exposes the same narrow MCP tools to Droid and Claude Code.

## Redaction

<a id="redaction"></a>

The process of replacing recognized secret text in output. Redaction is not a security boundary against arbitrary process behavior.

## Signed acknowledgement

<a id="signed-acknowledgement"></a>

A recipient message that confirms an import. Its digital signature identifies the sender.

## Replay attack

<a id="replay-attack"></a>

A repeated delivery of a valid old message. Vault checks package IDs to reject duplicates.

## Threat model

<a id="threat-model"></a>

A description of attackers, trust boundaries, protected data, and limits of the security design.
