# Local Agent Access

.sct exposes its core operations through a TypeScript CLI and a stdio MCP server.
Both interfaces use the same request checks and local approval window.
Responses contain metadata and fixed outcomes, without secret values or process logs.
Local project operations require no relay configuration, paired device, or network connection.

## Build and install

From the repository root, run:

```sh
bun run package:mac
bun run install:cli
```

The first command builds the desktop app, CLI, MCP server, TypeScript SDK, console demo, and bundled skills.
It uses the existing `.sct Development` signing identity and `com.omavashia2005.sct` bundle identifier.
See [signing setup](macos-signing.md) for local prerequisites.
The second command installs `~/.local/bin/sct` as a launcher for the signed executable.

Use `bun run build` for an unsigned development build.
Use `bun run build:demo` to rebuild only `out/demo/index.cjs`.
The demo source participates in both repository type checks.

## CLI

Inspect the available operations and input schemas:

```sh
sct agent --help
sct agent --schema
```

Supply a JSON object through stdin:

```sh
printf '%s' '{}' | sct agent list_secrets --stdin
```

The example selects the nearest registered parent of the caller's working directory.
Supply `projectId` to select a specific registered project.
`project_setup` returns that ID when it finds or registers a folder.
Use secret IDs from `list_secrets`. IDs are references, not credential values.

The CLI also accepts an envelope through `sct agent --stdin`:

```json
{
  "operation": "list_secrets",
  "input": {}
}
```

The result contains `requestId`, `status`, and an operation result or a fixed error.
The status is `completed`, `refused`, `expired`, or `failed`.
The CLI returns exit code 0 only for a completed request.
Stop after refusal or expiry. A retry requires a new request and local approval.

## Operations

Each operation has the same name in MCP and the CLI.
The `projectId` field is optional where the table lists it.
All operations also accept an optional ISO 8601 `expiresAt` deadline.

| Operation | Input fields | Result |
|---|---|---|
| `project_setup` | `directory`, optional `name` | Existing or newly registered project metadata |
| `list_secrets` | `projectId` | Secret IDs and environment names in one project |
| `describe_secret` | `projectId`, `secretId` | One secret's metadata |
| `delete_secret` | `projectId`, `secretId` | The deleted secret ID |
| `run_demo` | `projectId`, `secretId` | `exitCode` and `secretPresent` for the fixed demo |
| `sharing_state` | None | This device, verified AirDrop recipients, and pending transfer metadata |
| `pair_device` | `action: "export"`, or `action: "verify"` with `path` | A public device card path or verified device metadata |
| `send_secrets_to` | `projectId`, `secretIds`, `recipientId` | An encrypted transfer path and `awaiting-transport` status |
| `relay_status` | None | Relay connection and cached peer, inbox, and sent metadata |

Unknown fields and arbitrary commands fail request checks.
Keep vault storage outside source folders. No operation creates an `.env` file or replacement secret file in the project.

## Caller authentication

.sct identifies the calling program before it checks the request.
It reads the parent processes up to the first process with a listed agent name.
Then `codesign` checks that running process against the agent's signing requirement.

| Agent | Executable name | Signing requirement |
|---|---|---|
| Claude Code | `claude` | Identifier `com.anthropic.claude-code`, Apple Developer ID, Team ID `Q6L2SF6YDW` |

`src/main/caller.ts` contains this list.
The MCP client is usually the direct parent of `sct mcp`.
A shell tool usually starts `sct agent`, so the agent is a more distant ancestor.

- A listed agent that passes its check becomes a verified caller. The approval window shows its name.
- A process with a listed agent name that fails the check is an impostor. .sct rejects each request before local approval.
  The result has status `failed` and names the failed signature check.
- A caller with no listed agent among its ancestors is unverified. The approval window labels it as unverified.
  Approval also requires the user to select **I started this request myself**.

Caller authentication identifies the program. It does not replace local approval.
A verified agent can still request an operation that the user must refuse.
Another program that the verified agent starts also passes this check.

## Local approval

Each request requires explicit approval in the local .sct window.
The window shows the operation, project, selected secret names, request ID, and deadline where applicable.
The default deadline is two minutes. A caller can request up to five minutes from submission.
Refusal, expiry, or disconnection prevents a pending request from receiving approval.
Approval applies to one request only. It cannot authorize another task or secret selection.

The agent cannot approve through CLI input, MCP, or a tool response.
Host approval in an MCP client does not replace the local .sct decision.
`run_demo` accepts only the fixed environment demo, without arbitrary commands or unrestricted process logs.
The child and its descendants can read or copy injected values.

## Stdio MCP

Configure an MCP client with the installed executable:

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
This configuration contains no credentials and needs no environment settings for local operations.
The client must connect stdin and stdout through private pipes.
Stdout carries MCP messages only. Fixed diagnostics use stderr without submitted contents.
Closing stdin ends the MCP process and cancels pending requests.

The server exposes the operations above as tools.
It also exposes each workflow as a prompt with the operation name and a Markdown resource at `sct://skills/<operation>`.
MCP `run_demo` requires a saved `secretId`. MCP does not accept a plaintext credential value.
See [the Claude Code demo project](../examples/claude-code/README.md) for a configuration that allows only the `sct` server.
Claude Code permission decisions apply first. Each allowed call still requires the local .sct decision.

## Skills

The repository contains one skill for each operation under `skills/sct-<operation-name>/SKILL.md`.
Skill folder names replace underscores with hyphens.
Inspect the installed bundle:

```sh
sct skills
```

The result contains the bundled directory and skill names.
For offline installation, copy the desired skill folders into your agent's skill directory.
Common locations are `~/.agents/skills` for Codex and `~/.claude/skills` for Claude Code.
After this PR merges, install through the standard skills CLI if available:

```sh
npx skills add omavashia2005/.sct
```

Select the workflows you need. A skill does not grant access or bypass local approval.
MCP clients can also read the bundled prompts and resources without copying files.

## Private stdin input

Use saved references when possible. Never place secret values in arguments, shell substitutions, inline shell text, logs, or MCP calls.
The private CLI channel supports an unsaved value for the fixed demo.
The calling process writes an envelope with `operation: "run_demo"`, `input`, and a top-level `stdinValue`.
Omit `input.secretId` when supplying `stdinValue`. Supply exactly one source.
Do not save the envelope in the project folder or print its contents.

The selected value enters the fixed demo as `SCT_DEMO_TOKEN` in the child environment.
The result reports presence and the exit code. It does not return the value or process output.
An empty value counts as present.

## Pairing, sending, and relay scope

`pair_device` uses the existing public AirDrop device cards.
The user compares the code on both Macs before local approval of pairing.
Exchange cards and complete local pairing on both Macs for sharing in both directions.
`sharing_state` returns the verified recipient IDs for `send_secrets_to`.

Sending encrypts the selected secrets for one verified recipient and opens the AirDrop picker.
The user must choose that same recipient in macOS.
`awaiting-transport` does not prove delivery, receipt, or import.
The recipient accepts the file and imports it through the desktop app.

PR #43 provides relay connection and encrypted cache support.
`relay_status` starts that connection only when requested by an approved agent operation.
It returns metadata without tokens, payloads, wrapped keys, or private keys.
Identify rows as cached when `connection` is not `connected`. Use `updatedAt` to report their age.
This interface does not provide relay pairing, publication, or delivery acknowledgments.
See [relay configuration](relay.md) for `SCT_RELAY` and the cache behavior.

## Standalone runtime

The existing `sct run` command remains independent of Agent Access and local approval requests.
For a manual demo, save `SCT_DEMO_TOKEN` in a registered project and run from that project:

```sh
sct run -- node /absolute/path/to/.sct/out/demo/index.cjs
```

Replace the path with your repository's build output.
The demo prints presence only. It creates no project files and uses no network service.
See [runtime injection](runtime-injection.md) for standalone runner behavior and trust requirements.
