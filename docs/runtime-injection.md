# CLI and TypeScript runtime injection

.sct supplies a registered project's secrets without `.env` files or project-local manifests.
The CLI and SDK work offline and need no relay, MCP server, or agent.
The signed Electron main process owns Keychain access and decryption in both paths.

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
The launcher keeps the same app location after rebuilds. Reinstall it if you move the app.
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

The dependency-free [`@sct/env` SDK](../packages/env/README.md) loads the same values inside your process and keeps `process.env` current without a restart.
Build it with `bun run build:sdk` and install it with `bun add /absolute/path/to/.sct/packages/env`.
It needs Node.js 22.18 or later or Bun on macOS, and the installed `sct` command on `PATH`.

The SDK starts a signed helper through private stdin and stdout pipes. It receives only the selected project's values.
It opens no local server and uses no network service.
See the SDK guide for the bootstrap file, `onChange`, `onError`, and stopping updates.

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
The installed `sct` launcher belongs in `~/.local/bin`, outside the project.

Programs and their descendants can copy, print, persist, or send their environment. Run code that you trust.
Updating or removing a key cannot revoke copies that a program already retained.
The renderer API returns metadata only.
