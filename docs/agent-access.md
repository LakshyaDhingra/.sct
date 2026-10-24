# Local agent entrypoints and demo

Issue #5 adds the TypeScript entrypoints and build outputs for local Agent Access.
These entrypoints require no relay configuration, paired device, or network connection.
The existing `sct run` command remains independent of Agent Access.

## Build

From the repository root, run:

```sh
bun run package:mac
```

This command builds the desktop app, agent CLI, stdio MCP entrypoint, TypeScript SDK, and console demo.
It packages the entrypoints and demo with the existing signed Electron app.
The signing identity remains `.sct Development`. The bundle identifier remains `com.omavashia2005.sct`.
See [signing setup](macos-signing.md) for local prerequisites.

For an unsigned development build, use `bun run build`.
Both commands create `out/demo/index.cjs`. `bun run build:demo` rebuilds only the demo.
The demo source participates in both repository type checks.

Install the existing CLI link after packaging:

```sh
bun run install:cli
sct agent --help
sct mcp --help
```

## Agent CLI

`sct agent --stdin` reserves the local submission entrypoint.
It currently refuses all submissions with exit code 1, without reading stdin, accessing the vault, or launching a task.
It rejects other arguments without printing their contents.
Issue #7 adds the authenticated request channel and checks local request fields.
Issues #18 and #8 add project access checks, local approval, and execution.

Use project IDs and secret IDs as references when the request contract becomes available.
Secret IDs identify saved entries. They are not secret values.
The desktop and CLI must resolve the same registered project and secret.
Issue #7 defines that contract, including stdin input for values that do not use a saved reference.

Never place secret values in command arguments, shell substitutions, or inline shell commands.
Supply such values through a private stdin pipe from the calling process.
Do not print the pipe contents or save them in the project folder.
No submission can execute through this entrypoint before the required validation and approval exist.

## Stdio MCP

Configure an MCP client with the installed executable and a single argument:

```json
{
  "mcpServers": {
    "sct": {
      "command": "/Users/YOUR_USER/.local/bin/sct",
      "args": ["mcp"]
    }
  }
}
```

Replace the command path with your installed CLI path.
This configuration contains no credentials and needs no environment settings.
The client must connect stdin and stdout through pipes.
Stdout carries MCP messages only. Diagnostics use stderr and do not include submitted contents.
Closing stdin ends the MCP process.

The entrypoint supports protocol initialization and ping through the official TypeScript SDK.
It advertises no tools, resources, or prompts and provides no vault access.
Issue #9 adds the MCP operations after request validation, access checks, and approved execution exist.
Claude Code approval checks belong to #4 and #10.

## Run the console demo

Register an existing project folder in the desktop app.
Save a variable named `SCT_DEMO_TOKEN` in that project.
Keep the encrypted vault outside the project folder.

From the registered project folder, run the built demo through the standalone runner:

```sh
sct run -- node /absolute/path/to/.sct/out/demo/index.cjs
```

Replace the path with your repository's build output.
The command receives the saved variable through its environment before the demo runs.
The demo prints only whether the variable exists. An empty saved value also counts as present.
It prints no value, accepts no arguments, and uses no network service.
It returns exit code 1 if the variable is absent or the caller supplies arguments.

This manual command uses the existing trusted project runner. It is not an agent approval path.
The project needs no `.env` file, secret manifest, or replacement secret file.
The demo creates no project files.
See [runtime injection](runtime-injection.md) for runner behavior and trust requirements.
