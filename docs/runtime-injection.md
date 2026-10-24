# Project runtime injection without .env files

## Status and order

This feature is planned in [#32](https://github.com/omavashia2005/.sct/issues/32), order 1.7.
Implement it after the local vault checks and before relay setup.
It requires no relay, sharing, MCP, or agent implementation.
Local Agent Access later reuses the same launch primitive.

## Project files and storage

The project folder needs no .env file or equivalent secret-bearing file.
Do not require a project-local .sct file, manifest, loader configuration, copied key, symlink, or FIFO.
Do not generate temporary plaintext files for compatibility.

The existing .sct project registry maps each project to its source folder.
The configured external vault root contains .sct/[project-name]/secrets.sct.
That file uses the existing encrypted binary format.
Keychain protects the keys.
Keep this vault material outside the target project's source folder.

Resolve the current registry and vault settings at launch.
Do not assume that the vault lives inside the project or always remains at its default location.
Project rename and storage moves must preserve correct resolution.

## Planned launch behavior

1. Resolve the selected registered project and its source folder.
2. Read its encrypted vault through the trusted local vault path.
3. Decrypt the selected project's values with its Keychain keys.
4. Create the child environment before application imports or package scripts execute.
5. Start the user-selected executable in the registered source folder.
6. Forward normal I/O, termination, and exit status.

Pass executable arguments directly.
Do not interpolate values into shell commands.
Preserve unrelated inherited variables and document collision precedence.
Keep the parent environment unchanged.
Preserve literal values without .env parsing or expansion.
Keep plaintext outside launcher diagnostics, command arguments, renderer responses, and persistent files.

The launched program and its descendants can read or copy their environment.
Changing the vault does not change an already-running process.
This feature does not export secrets into the user's shell.

## Loader compatibility

Compatibility comes from the process environment.
It does not come from a replacement file.
The project continues to read process.env, os.environ, or the equivalent runtime API.

| Consumer | Documented behavior | Required implementation check |
|---|---|---|
| Node.js with dotenv.config() | Default loading preserves existing variables. | Check startup without .env, including code that treats a missing file as an error. |
| Python with load_dotenv() | Default loading preserves existing variables. | Check os.environ and os.getenv without .env. |
| Bun scripts and package scripts | Bun supports process environment variables and automatic .env loading. | Check injected values and precedence without any .env files. |
| Vite | Existing environment values have priority over .env values. | Check startup and distinguish server variables from client build output. |
| File parsing APIs | dotenv.parse and dotenv_values parse file contents rather than consume inherited values. | Document that these calls require application changes. Do not generate a compatibility file. |

These conclusions follow the official documentation.
They do not establish that the planned .sct launcher works yet.
Issue #32 must record actual runtime and loader versions and their results.

Dotenv returns an error when file loading fails.
Applications that require successful file loading can therefore need changes even when environment variables already exist.
Override modes can replace injected values.
See [dotenv configuration](https://github.com/motdotla/dotenv#config) and [python-dotenv loading](https://bbc2.github.io/python-dotenv/#getting-started).

Bun's .env feature does not decrypt the .sct vault.
The planned launcher supplies the environment before Bun starts.
See [Bun environment variables](https://bun.sh/docs/runtime/environment-variables).

Vite exposes VITE_ variables in client output.
Private secrets must not use that public prefix.
Vite's client constants also use build-time replacement.
See [Vite environment variables and modes](https://vite.dev/guide/env-and-mode).

## Acceptance checks

Check offline launch, project isolation, current vault paths, literal values, variable collisions, and process termination.
Check failure before launch when project data, vault files, Keychain access, or the executable is unavailable.
Confirm that the project folder contains no secret-bearing file before, during, or after launch.
Use representative loader examples without .env files.
Follow AGENTS.md approval requirements before adding new tests.
