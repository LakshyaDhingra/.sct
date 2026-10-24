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
Issue #12 adds this connection to the Electron main process.

The app never uses the deployment login.
Device private keys and secret values never go to the relay.
