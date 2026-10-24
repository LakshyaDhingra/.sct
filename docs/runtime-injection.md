# Run a project with .sct environment variables

.sct supplies a registered project's secrets to its development command without creating a `.env` file.
This implements [#32](https://github.com/omavashia2005/.sct/issues/32).
The launch path works locally without a relay, MCP server, or agent.

## Try an existing project

1. Build the signed app from the .sct repository:

   ```sh
   bun run package:mac
   ```

2. Open `dist/sct-darwin-arm64/sct.app` in Finder. Use `sct-darwin-x64` on an Intel Mac.
3. Add your existing project folder in **Projects**, unless it is already registered.
4. Select **Open secrets** for that project. Save the variable names and values that your application needs.
5. Keep vault storage outside the project folder. Use **Storage** to move it if necessary.
6. Stop any development command that is already running. The new environment applies only to new launches.
7. Launch the project's command from a terminal. Use the exact registered project name:

   ```sh
   /absolute/path/to/.sct/dist/sct-darwin-arm64/sct.app/Contents/MacOS/sct run "My project" -- bun run dev
   ```

The terminal can be in any folder. .sct uses the project's registered source folder as the working directory.
The app window can remain open or closed.
The signed executable uses the same registry, storage settings, and Keychain identity as the signed desktop app.
Follow [local signing setup](macos-signing.md) if the packaging command reports a missing identity.

For a shorter command, define this function in your current terminal. Replace the absolute path first:

```sh
sct() {
  "/absolute/path/to/.sct/dist/sct-darwin-arm64/sct.app/Contents/MacOS/sct" "$@"
}
```

Then use your normal executable and arguments:

```sh
sct run "My project" -- bun run dev
sct run "My project" -- npm run dev
sct run "My project" -- node server.js
sct run "My project" -- .venv/bin/python app.py
```

The command after `--` names an executable and its arguments. .sct does not interpret shell operators.
Put command sequences in an existing package script when you need them.
Do not put secret values in command arguments.

## Check presence without printing values

Replace `API_KEY` with one of your saved variable names:

```sh
sct run "My project" -- node -e 'console.log("API_KEY present:", Object.hasOwn(process.env, "API_KEY"))'
```

The result should be `API_KEY present: true`. An intentionally empty value also counts as present.
Then launch the normal development command through `sct run`.

An existing `.env` file is not required. Move its needed values into .sct before you remove it.
.sct does not import, remove, or rewrite existing `.env` files.

## How injection works

1. The Electron main process resolves the project name through the existing registry.
2. It reads the current vault setting and resolves `.sct/[project-name]/secrets.sct` outside the source folder.
3. The vault decrypts that project's values with its existing macOS Keychain keys.
4. It copies the inherited environment and applies the selected project's variables.
5. `launchProject` launches the executable with that environment and the registered working directory.
6. The launcher forwards terminal input, output, interruption, termination, and the command's exit status.

The child receives variables before application imports or package scripts execute.
Project secrets override inherited variables with the same name. Unrelated inherited variables remain available.
The parent process environment stays unchanged. Other projects' vault entries do not enter this environment.
Values retain spaces, quotes, dollar signs, equals signs, empty strings, Unicode, and newlines without expansion.
Null characters cannot occur in process environment values. .sct rejects them when saving or launching.

The vault clears decrypted Buffers and its copies of value keys after use.
It removes its environment references after process creation.
Environment strings and copies inside the child remain available to that program and its descendants.
The program can read, print, persist, or transmit them. Run commands that you trust.
The launcher does not log values or return them to the renderer.

The launch path creates no `.env`, replacement secret file, project manifest, copied key, symlink, or FIFO.
It creates no plaintext compatibility file, including outside the project.
The program can still create its normal files, logs, caches, and build output.
Changing the vault does not update an already-running process. Restart the command to apply new values.
Running a command directly, without `sct run`, bypasses injection.

`src/main/launch.ts` exports `launchProject` for later approved agent execution.
The primitive accepts a registered project ID, executable, arguments, and standard I/O options.
It uses `Vault.withProjectEnvironment` and has no relay or agent dependencies.
It releases the vault queue after process creation, so a running server does not block vault edits.

## Loader compatibility

Compatibility comes from the inherited process environment.
Libraries continue to read `process.env`, `os.environ`, or their runtime equivalent.
They do not read or decrypt `secrets.sct`.

These checks passed on macOS 26.5.1 arm64 on 2026-10-24 through the actual `launchProject` primitive:

| Runtime or loader | Version checked | Result without `.env` |
|---|---|---|
| Node.js | 22.23.1 | Values exist before application code executes. Literal values and empty strings survive. |
| dotenv | 18.0.9 on Node.js 22.23.1 | `dotenv.config()` leaves injected variables available and returns an `ENOENT` file error. |
| Python | 3.11.7 | `os.environ` and `os.getenv` receive the injected values. |
| python-dotenv | 1.2.4 on Python 3.11.7 | `load_dotenv()` returns `False` when no file exists and leaves injected values available. |
| Bun | 1.4.4 | Direct scripts and `bun run` package scripts receive values without `.env` files. |
| Vite | 8.3.5 on Node.js 22.23.1 | The server and `loadEnv` use inherited values. A client build exposes the public test variable and excludes the private test value. |

The checks used separate Keychain items and removed them afterward.
They checked arguments, output, project files, and Vite's normal cache for the private fixture value.
The Vite build used `write: false` to inspect client output without writing it to disk.

Default dotenv and python-dotenv loading preserves existing environment variables.
Override settings can replace injected values when the loader obtains replacement contents.
The checks also exercised overrides in memory, without a compatibility file.
See [dotenv configuration](https://github.com/motdotla/dotenv#config) and [python-dotenv loading](https://bbc2.github.io/python-dotenv/).

Code that throws whenever `dotenv.config()` returns an error needs adjustment for a missing `.env` file.
Check the required environment variables rather than requiring successful file loading.
Other loaders or flags that require an existing file can also reject a launch.
.sct does not create a file to satisfy those requirements.

`dotenv.parse` and `dotenv_values` parse supplied contents or files. They do not return the inherited environment.
Use the runtime's environment API when the application needs injected values.
Parsing empty or missing contents returned no injected values in these checks.

Bun's automatic `.env` loading does not decrypt a vault. Injection occurs before Bun launches.
See [Bun environment variables](https://bun.sh/docs/runtime/environment-variables).

Vite gives variables that exist at launch priority over `.env` values.
Its default `VITE_` prefix exposes values in browser code, including build output.
Use that prefix only for public configuration. Keep private credentials in server-side environment variables.
Custom public prefixes and explicit build definitions can also expose values.
See [Vite environment variables and modes](https://vite.dev/guide/env-and-mode).

## Failures and process control

- A missing project or an incorrect project name stops the launch.
- A missing or invalid vault file stops the launch. An untouched project needs one saved secret to create its vault file.
- Missing keys, rejected Keychain access, or failed authentication stop the launch before the command executes.
- Missing source folders or executables stop the launch. Executable names use the child's `PATH`.
- A vault inside the source folder stops the launch. Move it through **Storage** and try again.

Use `Ctrl+C` to interrupt a running command.
The launcher forwards `SIGINT`, `SIGTERM`, and `SIGHUP` to the command and waits for it to exit.
It returns the command's numeric exit code. A signal-only exit returns `128 + signal number`.
Commands retain responsibility for child processes that they detach or manage separately.

The Electron checks cover the terminal entrypoint offline, storage after a move and rename, and metadata-only renderer responses.
The vault checks cover project isolation, literal values, missing prerequisites, parent-environment preservation, I/O, signals, and exit status.
The signed executable also passed a launch check in Node mode with the vault source and isolated Keychain items.
These checks ran on one Mac. They do not establish compatibility with every loader or application.
