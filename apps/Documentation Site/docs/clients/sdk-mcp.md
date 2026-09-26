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

1. On the server, `generatorai device invite --platform mcp`. The default grant for an `mcp` device is `read:status`, `read:workflows`, `stream:events`, `exec:agent`, `read:chats` and `write:chats`. Add `--scopes …,write:workflows` to let it submit workflow drafts.
2. `generatorai-mcp pair <code>` redeems the invite. The device key and session go to the encrypted vault under `~/.generatorai/mcp`.
3. The MCP client spawns `generatorai-mcp serve` (see `generatorai skill install`, which prints the snippet).

The vault is sealed by `GENERATORAI_SECRET_KEY` / `GENERATORAI_SECRET_PASSPHRASE` when one is set, otherwise by a mode-0600 key file. The backend used at pairing is recorded in `mcp-connection.json`, and `serve` refuses to start under a different one: give the MCP client's server entry the same environment (its `env` block) as the shell you paired in, or pair again.

This is a long-running stdio protocol process, not a human command prompt. MCP clients own stdin/stdout; diagnostics go to stderr. Environment configuration:

| Variable | Default / purpose |
| --- | --- |
| `GENERATORAI_URL` | The paired server; a short pairing code is resolved against it |
| `GENERATORAI_MCP_CONFIG_DIR` | `~/.generatorai/mcp`; where the pairing and vault live |
| `GENERATORAI_SECRET_KEY` / `GENERATORAI_SECRET_PASSPHRASE` | Seal the vault; `serve` needs the same one `pair` had (or neither) |

The adapter publishes the server's workflow tools, `generatorai_list_chats` (needs `read:chats`) and `generatorai_send_prompt` (needs `write:chats`), and the workflow-authoring skill as `generatorai://workflow-author/…` resources.

This outbound MCP bridge is different from **Settings → MCP Servers**, which configures external MCP tools consumed by GeneratorAI agents. It is also different from the CLI companion's NDJSON gateway.

## Integration checklist

Before relying on either package, verify which engine/data directory owns the work, how the provider authenticates, whether the caller can supply required prompts/decisions, and how shutdown releases resources. Keep secrets out of stdout, since arbitrary log text corrupts stdio protocol traffic. Inspect the package's smoke tests for the supported contract rather than copying older published-package examples.

Sources: `packages/sdk/package.json`, `packages/sdk/README.md`, `packages/sdk/src/{index,config,internal}.ts`, `packages/sdk/src/facades/`, `packages/mcp-server/package.json`, `packages/mcp-server/esbuild.config.mjs`, `packages/mcp-server/src/{cli,remote,server}.ts`.
