# CLI and TypeScript runtime injection

.sct supplies registered project secrets without `.env` files or project-local secret manifests.
The CLI and SDK work offline. They require no relay, MCP server, or agent.
The signed Electron main process owns Keychain access and decryption in both paths.
See [local agent entrypoints and demo](agent-access.md) for the separate agent and MCP build outputs.

## Set up once

From the .sct repository, build the signed app and install its CLI launcher:

```sh
bun run package:mac
bun run install:cli
```

The installer writes `~/.local/bin/sct` as a shell script that runs the built executable with `exec`.
Electron finds its helper apps only from the real executable path, so the command is not a symbolic link.
The installer replaces an earlier .sct link to the same executable.
It preserves other existing commands and rejects launchers or links for another application.
If `~/.local/bin` is absent from `PATH`, the installer prints this line for your `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Open a new terminal after changing `PATH`.
The link continues to use the same app location after rebuilds. Reinstall it if you move the app.
Follow [local signing setup](macos-signing.md) if the build reports a missing identity.

Open `dist/sct-darwin-arm64/sct.app` in Finder. Use `sct-darwin-x64` on an Intel Mac.
Register your existing project folder and save its variables under **Open secrets**.
Keep vault storage outside the source folder. No `.sct` configuration file belongs in the project.
The desktop window can remain open or closed during injection.

## CLI: one command in your project

From the registered source folder or any subfolder:

```sh
sct run -- bun run dev
```

.sct selects the nearest registered parent folder and uses its registered source folder as the working directory.
You can also select a project by its exact name:

```sh
sct run "My project" -- npm run dev
sct run "My project" -- node server.js
```

The command receives the project's variables before imports or package scripts execute.
Project secrets override matching inherited variables. Unrelated inherited variables remain available.
The parent environment stays unchanged. Other projects' vault entries do not enter this environment.
Values preserve spaces, quotes, dollar signs, equals signs, empty strings, Unicode, and newlines.
The vault rejects null characters because process environment values cannot contain them.

Leave the command running. Saved key additions, updates, and deletions automatically restart the command with the current environment.
You do not repeat the command or copy new values into a shell.
The watcher checks encrypted file metadata every 500 milliseconds. It decrypts only when a revision changes.
Renames and storage moves resolve through the current registry and settings while retaining the selected project ID.
The launcher creates no plaintext compatibility file.

A restart interrupts the project. Its normal startup code runs again.
.sct sends `SIGTERM` to the command's process group and waits for shutdown.
It allows up to two seconds before forcing shutdown and removes remaining group members before another launch.
Use this behavior for development commands whose restart side effects you accept.
Processes that detach into another session remain under the launched program's control.

Terminal input and output remain connected to the command.
`Ctrl+C`, `SIGTERM`, and `SIGHUP` reach its process group.
A normal command exit ends the launcher with the same exit code.
An exit identified only by a signal returns `128 + signal number`.
.sct does not automatically repeat commands that exit normally or crash.

If a later vault read fails, .sct stops the command and reports a value-free diagnostic.
It keeps checking storage and launches again when the selected vault becomes readable.
Missing prerequisites at the initial launch fail immediately.
An untouched project needs at least one saved secret to create its encrypted vault file.

## TypeScript SDK: load inside your code

Build the dependency-free SDK in the .sct repository:

```sh
bun run build:sdk
```

From your application's folder, install the local package:

```sh
bun add /absolute/path/to/.sct/packages/env
```

The SDK is not published to npm yet. The package contains JavaScript and TypeScript declarations, so consumers do not compile SDK sources.
It requires Node.js 22.18 or later or Bun on macOS, and the installed `sct` command on `PATH`.

Add a bootstrap entrypoint:

```ts
import { loadEnv } from '@sct/env'

await loadEnv()
await import('./server.js')
```

The SDK selects the project from the current folder. An optional `project` selects an exact registered name.
The initial load completes before the promise resolves. Later snapshots update `process.env` without restarting the application.
Removed keys restore their original inherited values, or disappear if none existed.
Unrelated variables remain unchanged.

Call the SDK before importing code that reads credentials during initialization.
Static imports evaluate before a module body, regardless of their written position.
Libraries that cache a key in a client object need that client to be recreated after changes.
Use `onChange` for that step. Use `onError` to handle later access failures.
See the [SDK API and lifecycle guide](../packages/env/README.md) for examples.

The SDK launches a signed helper through private stdin and stdout pipes.
It receives only the selected project's values and checks each response before applying it.
It opens no local server and uses no network service.
Initial failures reject the load. Later failures restore inherited values and report an error while the helper waits for storage recovery.
The returned function stops updates and restores inherited values. Helpers stop when the application exits.
Neither the SDK nor its helper keeps an otherwise finished application alive.

## Check your existing project

After saving a variable named `API_KEY`, check presence without printing its value:

```sh
sct run -- node -e 'console.log("API_KEY present:", Object.hasOwn(process.env, "API_KEY"))'
```

The expected result is `API_KEY present: true`. An empty value also counts as present.
Then run the normal development command through the CLI, or use the SDK bootstrap with your usual command.
Change a saved value in the app. The CLI restarts the project. The SDK updates its own process environment.

.sct does not import, remove, or rewrite an existing `.env` file.
Move the required values into .sct before removing that file from your project.
Launching a program directly without the SDK or `sct run` does not inject values.

## TypeScript and loader compatibility

Existing libraries can consume inherited environment variables through `process.env`.
They do not read or decrypt `secrets.sct`.
Default dotenv loading preserves existing environment variables.
Code that requires a successful `.env` file read needs adjustment when that file is absent.
`dotenv.parse` parses supplied contents and does not return inherited variables.
Loader override modes can replace injected values when they obtain other contents.
See [dotenv configuration](https://github.com/motdotla/dotenv#config).

Bun scripts and package scripts receive the environment before execution.
Its automatic `.env` loading does not decrypt the vault.
See [Bun environment variables](https://bun.sh/docs/runtime/environment-variables).

Vite gives existing environment variables priority over `.env` values.
Its default `VITE_` prefix exposes variables in browser code, including build output.
Keep private credentials outside public prefixes and explicit client build definitions.
The CLI restarts Vite after key changes, so its initialization sees the new environment.
An SDK change in a server process does not rebuild Vite's existing browser output.
See [Vite environment variables and modes](https://vite.dev/guide/env-and-mode).

The earlier #32 loader checks used Node.js 22.23.1, dotenv 18.0.9, Bun 1.4.4, and Vite 8.3.5.
Those checks verified literal values, missing `.env` behavior, and private-value exclusion from client output.
Python compatibility checks from #32 do not cover the TypeScript SDK. This SDK adds no Python integration.

## Storage and trust

Vault files stay encrypted in the configured external `.sct/[project-name]/secrets.sct` folder.
The vault clears decrypted Buffers and copied value keys after use.
It removes temporary environment references after their consumer completes.
The launcher and SDK create no plaintext secret file, project manifest, copied key, symlink, or FIFO in the project.
The installed CLI link belongs in `~/.local/bin`, outside the project.

Programs and their descendants can copy, print, persist, or send their environment. Run code that you trust.
Updating or removing a key cannot revoke copies that a program already retained.
The renderer API continues to return metadata only.
Local runtime injection remains independent of relay sharing, Agent Access, and MCP.
