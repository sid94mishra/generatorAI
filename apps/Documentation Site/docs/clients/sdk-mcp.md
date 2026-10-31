---
title: SDK and MCP bridge
description: The private in-process SDK, the MCP stdio adapter, and how they differ from the shared server client.
---

# SDK and MCP bridge

`@generatorai/sdk` is private and intended for in-repository use. It builds a complete engine in the caller's process: database, repositories, core services, orchestrator and harness provider. It is **not** an HTTP client for an existing GeneratorAI server, and the workspace package is not a supported public npm SDK.

The SDK README records it as frozen/internal. `packages/mcp-server` no longer uses it (the MCP adapter is a client of a running server, below). The architectural warning still applies: this is a second composition root that can drift from `apps/server`.

## In-process embedding

An in-repository integration can construct an instance and use the facades:

```ts
import { createGeneratorAI } from '@generatorai/sdk'

const ai = await createGeneratorAI({
  harness: 'codex',
  database: './experiment.db',
  artifactsDir: './experiment-artifacts',
})

try {
  const definitions = await ai.workflows.list()
  console.log(definitions)
} finally {
  await ai.shutdown()
}
```

This creates/opens the configured database and initializes services/provider state. Use a dedicated data path for an experiment. Do not point an unrelated embedded engine at a live server's data merely to obtain a remote client.

The public instance exposes workflow, chat, automation, project, workspace, agent, script, tool, hook, browser, event and human-in-the-loop facades. Workflow builders and state machines are exported. Advanced raw-service access and `@generatorai/sdk/internal` are unstable internals. Provider setup, native SQLite and workspace dependency resolution are still required.

For a client of the running server, examine `@generatorai/client-core` and its platform API instead. Those contracts are used by the application clients and preserve the server's authorization and stream behavior.

## MCP stdio adapter

`generatorai-mcp` (`packages/mcp-server`) serves a **running** GeneratorAI server to an MCP client over stdio. It is a paired device of platform `mcp`, not an embedded engine: every tool call goes to the server's API with the device's scoped, revocable credential.

Build it once from the repository root. The workspace packages it imports export TypeScript source, so the package's `bin` is an esbuild bundle rather than `src/cli.ts`:

```bash
pnpm --filter @generatorai/mcp-server bundle   # → packages/mcp-server/dist-bundle/generatorai-mcp.mjs
node packages/mcp-server/dist-bundle/generatorai-mcp.mjs --help
```

Link it (`pnpm link --global` in `packages/mcp-server`) to get `generatorai-mcp` on your `PATH`, or name the `.mjs` file with `node` in the MCP client's configuration.

1. Create an invite: **Settings → Security & devices → Pair a new device**, platform **MCP server (external agent)**, or `generatorai device invite --platform mcp` on the server. The default grant for an `mcp` device is `read:status`, `read:workflows`, `read:chats`, `write:chats`, `stream:events`, `exec:agent`, `read:projects`, `read:activity` and `read:files`. Add `--scopes …,write:workflows` to let it submit workflow drafts. Administration and the terminal are never granted to an MCP device.
2. `generatorai-mcp pair "<pairing link or code>"` redeems the invite (a short code also needs `GENERATORAI_URL`). The device key and session go to the encrypted vault under `~/.generatorai/mcp`.
3. Add the server to the agent. **Settings → Security & devices → Connect an external agent** shows each snippet with a copy button:

| Client | Configuration |
| --- | --- |
| Claude Code | `claude mcp add --scope user generatorai -- generatorai-mcp serve` |
| Codex | `~/.codex/config.toml`: `[mcp_servers.generatorai]` with `command = "generatorai-mcp"` and `args = ["serve"]` |
| Cursor | `.cursor/mcp.json` (or `~/.cursor/mcp.json`): `{"mcpServers": {"generatorai": {"command": "generatorai-mcp", "args": ["serve"]}}}` |

`generatorai skill install --target claude|codex` prints the same configuration.

The vault is sealed by `GENERATORAI_SECRET_KEY` / `GENERATORAI_SECRET_PASSPHRASE` when one is set, otherwise by a mode-0600 key file. The backend used at pairing is recorded in `mcp-connection.json`, and `serve` refuses to start under a different one: give the MCP client's server entry the same environment (its `env` block) as the shell you paired in, or pair again.

This is a long-running stdio protocol process, not a human command prompt. MCP clients own stdin/stdout; diagnostics go to stderr. Environment configuration:

| Variable | Default / purpose |
| --- | --- |
| `GENERATORAI_URL` | The paired server; a short pairing code is resolved against it |
| `GENERATORAI_MCP_CONFIG_DIR` | `~/.generatorai/mcp`; where the pairing and vault live |
| `GENERATORAI_SECRET_KEY` / `GENERATORAI_SECRET_PASSPHRASE` | Seal the vault; `serve` needs the same one `pair` had (or neither) |

### Tools

Every tool is named `generatorai_<name>`. The server runs the same handlers an in-app agent gets (see [platform tools](../features/workflows-from-agents.md#platform-tools-chats-projects-automations-and-files)), so descriptions, limits and refusals match:

| Toolset | Tools |
| --- | --- |
| `chats` | `send_prompt`, `list_chats`, `read_chat`, `create_chat`, `send_to_chat`, `wait_for_chat` |
| `projects` | `list_projects`, `get_project` |
| `agents` | `list_agents` |
| `automations` | `list_automations`, `trigger_automation` |
| `activity` | `list_needs_you` |
| `files` | `list_chat_files`, `read_chat_file` |
| `workflows` | the workflow tools: `list_workflows`, `describe_workflow`, `run_workflow`, `check_workflow_run`, `respond_workflow_approval`, `cancel_workflow_run`, and the authoring tools |

The platform and workflow tools are fetched from `GET /api/platform-tools` and `GET /api/workflow-tools` and cached for 30 seconds. Each carries MCP annotations derived from its flags: `readOnlyHint`, `destructiveHint`, `idempotentHint`. Tools that create or start something (`create_chat`, `send_to_chat`, `trigger_automation`, `run_workflow`, `create_workflow_draft`) take an `idempotencyKey`, so a retried call returns the first result.

`generatorai_send_prompt {message, chatId?, name?, projectId?, wait?}` creates a chat when `chatId` is omitted, then sends. With `wait` (seconds, at most 600) it waits for the turn to finish, or for the chat to wait on a person, and returns the status and the reply. Without it, it returns at once; follow up with `generatorai_wait_for_chat`.

Chats an external agent starts never bypass approvals: they are capped at *Accept edits*, and a chat whose mode is higher cannot be prompted from outside. Risky actions and questions are answered by a person in GeneratorAI (they show in **Needs you**), never through these tools.

### Narrowing the tool list

| Flag | Effect |
| --- | --- |
| `--toolsets <list>` | Serve only these toolsets, comma separated: `chats`, `projects`, `agents`, `automations`, `activity`, `files`, `workflows` |
| `--read-only` | Serve only the tools that change nothing (drops `send_prompt`, `create_chat`, `send_to_chat`, `trigger_automation` and the workflow tools that run or write) |

Example: `generatorai-mcp serve --toolsets chats,files --read-only`. Put the flags in the client's `args`. The server's MCP `instructions` describe the toolsets it serves and the rules above.

The adapter also publishes the workflow-authoring skill as `generatorai://workflow-author/…` resources.

This outbound MCP bridge is different from **Settings → MCP Servers**, which configures external MCP tools consumed by GeneratorAI agents. It is also different from the CLI companion's NDJSON gateway.

## Integration checklist

Before relying on either package, verify which engine/data directory owns the work, how the provider authenticates, whether the caller can supply required prompts/decisions, and how shutdown releases resources. Keep secrets out of stdout, since arbitrary log text corrupts stdio protocol traffic. Inspect the package's smoke tests for the supported contract rather than copying older published-package examples.

Sources: `packages/core/src/tools/platform/`, `apps/server/src/routes/platformTools.ts`, `packages/sdk/package.json`, `packages/sdk/README.md`, `packages/sdk/src/{index,config,internal}.ts`, `packages/sdk/src/facades/`, `packages/mcp-server/package.json`, `packages/mcp-server/esbuild.config.mjs`, `packages/mcp-server/src/{cli,remote,server}.ts`.
