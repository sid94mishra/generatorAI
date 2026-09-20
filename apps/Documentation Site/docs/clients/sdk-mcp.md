---
title: SDK and MCP bridge
description: The private in-process SDK, the MCP stdio adapter, and how they differ from the shared server client.
---

# SDK and MCP bridge

`@generatorai/sdk` is private and intended for in-repository use. It builds a complete engine in the caller's process: database, repositories, core services, orchestrator and harness provider. It is **not** an HTTP client for an existing GeneratorAI server, and the workspace package is not a supported public npm SDK.

The SDK README records it as frozen/internal. Current code also has a consumer in `packages/mcp-server`; the README's older “zero importers” sentence therefore should not be read as a current repository-wide count. The architectural warning still applies: this is a second composition root that can drift from `apps/server`.

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

`packages/mcp-server/src/cli.ts` starts an SDK instance and attaches it to an MCP `StdioServerTransport`. The package declares the `generatorai-mcp-server` binary, but points it at TypeScript source and remains private; configure a repository-aware TypeScript runner when developing it.

Example from the repository root:

```bash
pnpm exec tsx packages/mcp-server/src/cli.ts
```

This is a long-running stdio protocol process, not a human command prompt. MCP clients own stdin/stdout; diagnostics go to stderr. Environment configuration:

| Variable | Default / purpose |
| --- | --- |
| `GENERATORAI_MCP_HARNESS` | `claude-agent`; embedded harness choice |
| `GENERATORAI_MCP_DB` | `./generatorai.db`; SQLite path |
| `GENERATORAI_MCP_ARTIFACTS` | `./artifacts`; output directory |
| `GENERATORAI_MCP_TEMPLATES` | `./templates`; template directory |

The adapter publishes `generatorai_list_chats`, `generatorai_send_prompt` and `generatorai_run_workflow`, and can publish eligible registered tools when constructed with a custom registry (the CLI entry does not supply one). Prompt execution can use an existing chat or create one; workflow execution refers to a definition in this embedded instance's database. It does not automatically see chats in a separately running server.

This outbound MCP bridge is different from **Settings → MCP Servers**, which configures external MCP tools consumed by GeneratorAI agents. It is also different from the CLI companion's NDJSON gateway.

## Integration checklist

Before relying on either package, verify which engine/data directory owns the work, how the provider authenticates, whether the caller can supply required prompts/decisions, and how shutdown releases resources. Keep secrets out of stdout, since arbitrary log text corrupts stdio protocol traffic. Inspect the package's smoke tests for the supported contract rather than copying older published-package examples.

Sources: `packages/sdk/package.json`, `packages/sdk/README.md`, `packages/sdk/src/{index,config,internal}.ts`, `packages/sdk/src/facades/`, `packages/mcp-server/package.json`, `packages/mcp-server/src/{cli,server,toolAdapter}.ts`.
