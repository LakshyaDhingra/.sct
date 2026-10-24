# Relay setup

.sct uses SpacetimeDB Maincloud as the cloud-hosted relay.
The relay stores ciphertext and routing metadata only. See the [architecture](architecture.md#phase-2-architecture).

## Hosted database

| Item | Value |
|---|---|
| Server | Maincloud |
| Endpoint | `https://maincloud.spacetimedb.com` |
| Database | `sct-relay` |
| Module folder | `packages/relay` |
| SpacetimeDB version | 2.13.0 for the CLI and the `spacetimedb` package |

Every connection to the endpoint uses TLS.
Neither demo device runs a local SpacetimeDB server.
On the free plan, Maincloud pauses an inactive database. The next connection starts it again.

## Module layout

`packages/relay/src/index.ts` contains the TypeScript module. Issue #11 adds the tables, reducers, and views.

`packages/relay/package.json` contains no dependencies.
The SpacetimeDB CLI requires this file to detect a TypeScript module.
The `spacetimedb` package is in the root `package.json`, so `bun install` from the repository root installs it.

`packages/relay/tsconfig.json` contains the compiler options that SpacetimeDB requires.
`bun run typecheck` and `bun run typecheck:tsc` check the module.

## Install the CLI

1. Install the CLI:

   ```sh
   curl -sSf https://install.spacetimedb.com | sh
   ```

2. Add `~/.local/bin` to your `PATH` if the `spacetime` command is not available.
3. Use the same version as the `spacetimedb` package:

   ```sh
   spacetime version install 2.13.0
   spacetime version use 2.13.0
   ```

## Deploy the module

1. Log in to Maincloud. A browser window opens for the GitHub or Google sign-in:

   ```sh
   spacetime login
   ```

2. Install the dependencies from the repository root:

   ```sh
   bun install
   ```

3. Publish the module from the repository root:

   ```sh
   spacetime publish sct-relay --module-path packages/relay --server maincloud
   ```

Use the same command to publish an update.
Do not use `--delete-data` unless you intend to delete all relay data.

The build prints `tsc not found in node_modules`.
This warning is expected, because `packages/relay` has no `node_modules` folder. The repository type checks replace this check.

## Deployment credentials

`spacetime login` saves the login token in `~/.config/spacetime/cli.toml`.
This token can publish and delete the database.

- Do not put this token in Git, in desktop builds, or in CI.
- Only the database owner publishes the module.
- CI checks the module types but does not publish.

## Check each demo device

Run this command on each demo device:

```sh
spacetime describe sct-relay --server maincloud --anonymous
```

The command connects to the endpoint over TLS with a temporary anonymous identity.
It shows the module schema when the device can reach the relay.
It does not use the deployment login and does not send secrets or private keys.

## Client identities

Each demo device uses its own relay identity.
When the app connects for the first time without a token, SpacetimeDB creates an identity and returns a token.
The app keeps this token in the macOS Keychain and uses it again for later connections.

The app never uses the deployment login.
Device private keys and secret values never go to the relay.

## App connection

The Electron main process connects to the relay when the app starts. Command-line launches do not connect.

- The Keychain service `.sct-relay` holds the relay token in `token/<server>/<database>`.
- After each connection, the app registers the public keys of its AirDrop device card with `registerDevice`.
  The same device keys serve AirDrop and the relay.
- The app subscribes to `my_inbox`, `my_sent`, and `my_peers`.
- After a lost connection, the client reconnects and restores the subscriptions.
  If the client stops, the app makes a new connection after 1 s, then up to 30 s between attempts.
- The app saves the view rows in `relay/cache-<server hash>.sct` in the app data folder.
  The file is encrypted with AES-256-GCM. Its key is in `.sct-relay` under `cache/<server>/<database>`.
  Each relay server has its own files, so a test relay cannot replace the files of the live relay.
  Received ciphertext and delivery status stay available after a restart without the relay.
- Local vault operations do not depend on the relay.

The renderer reads the relay state with `getRelayState` and `onRelayChanged`.
The state contains the connection status, the device identity, and metadata only.
It never contains payloads, wrapped keys, public keys, or the relay token.

The `SCT_RELAY` environment variable selects the relay:

| Value | Relay |
|---|---|
| Not set | Maincloud, `sct-relay` |
| `off` | No relay connection. The UI tests use this value. |
| `<server URL>/<database>` | Another relay, for example `http://127.0.0.1:3000/sct-relay-test` |

## Pairing

Two devices must pair before they share secrets. Pairing uses the same device keys as AirDrop.
A device verified through AirDrop still needs a relay pairing, and the reverse is also true.

1. Device B shows its relay ID: 64 hexadecimal characters. The user sends it to device A by any channel.
2. Device A enters the relay ID. The app calls `requestPair`.
3. Both apps show the pending pair and the same pairing code.
   The code comes from both relay identities and both device public keys.
4. The users compare the codes, for example in person or on a call.
5. If the codes match, each user confirms. Each app saves the public keys of the other device.
   The app of device B also calls `confirmPair`. Only the device that did not send the request can confirm on the relay.
6. If the codes differ, a user removes the pair. The app calls `removePair` and saves nothing.

The app saves the confirmed keys in `relay/peers-<server hash>.sct`.
The file is encrypted with AES-256-GCM. Its key is in `.sct-relay` under `peers/<server>/<database>`.
If the app cannot read the file, every peer needs a new code comparison.

Each peer in `getRelayState` has a trust state:

| State | Meaning |
|---|---|
| `unverified` | The users did not compare the code. |
| `verified` | The saved keys match the keys on the relay. |
| `changed` | The keys on the relay differ from the saved keys. The users must compare the new code. |
| `invalid` | The keys on the relay are not X25519 and Ed25519 public keys. |

Before a device sends a secret, the relay pair must be `Verified` and the peer trust state must be `verified`.
Issue #17 applies this rule to sending.

The renderer uses `requestRelayPair`, `confirmRelayPair`, and `removeRelayPair`.
`confirmRelayPair` takes the code on the screen. It fails if the current code is different, for example after a key change.

## Client bindings

`src/main/relay` contains the TypeScript client code that SpacetimeDB generates from `packages/relay`.
After a change to the relay module, generate the code again and commit it:

```sh
bun run relay:generate
```

The script needs the `spacetime` command in your `PATH`. Do not edit the generated files.
