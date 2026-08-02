# Usage — SDK (`@generatorai/sdk`)

> The SDK is the single dependency external integrators need. It bundles `core` + `db` + `agent-harness-providers` behind a clean facade pattern.

For package internals see [packages.md → sdk](./packages.md#sdk).

---

## 1. Install

```powershell
# Standalone (consumes a copy of the runtime — recommended for embedding)
pnpm add @generatorai/sdk

# Inside this monorepo (workspace dep)
# already wired in apps/server and apps/cli
```

Runtime requirements:
- Node.js ≥ 20
- Either `@github/copilot-sdk@^1.0.8` (and a logged-in `copilot` CLI on the host) **or** `@anthropic-ai/claude-agent-sdk@^0.3.220` (and a logged-in `claude` Code CLI).

The harness packages are *lazy-loaded*, so you only need to install whichever you'll actually use.

---

## 2. Quick start

```typescript
import { createGeneratorAI } from '@generatorai/sdk';

const ai = await createGeneratorAI({
  provider: 'copilot',
  database: './data/generatorai.db',
  artifactsDir: './data/artifacts',
  logger: { level: 'info', pretty: true },
});

const run = await ai.workflows.run('e2e-feature-coverage', {
  variables: { topic: 'AI safety' },
});

for await (const event of ai.workflows.stream(run.id)) {
  console.log(event.kind, event.data);
  if (event.kind === 'workflow_run.completed') break;
}

await ai.shutdown();
```

---

## 3. Configuration

`GeneratorAIConfig`:

```typescript
{
  provider: 'copilot' | 'claude-agent' | IAgentHarness;
  providerOptions?: CopilotProviderOptions | ClaudeAgentProviderOptions;

  database?: string;                  // SQLite path (default: ./generatorai.db)
  artifactsDir?: string;              // default: ./artifacts
  scriptsDir?: string;                // default: ./workflows (loads *.workflow.mjs)
  templatesDir?: string;              // default: ./templates (loads system templates)
  workspacesDir?: string;             // default: ./workspaces

  maxConcurrentSessions?: number;     // default: 10
  logger?: LoggerConfig | false;      // false = silent
  sandbox?: { enabled?: boolean; preferDocker?: boolean };
  projectRoot?: string;               // default: process.cwd()

  webhooks?: {
    enabled?: boolean;
    githubSecret?: string;
    webhookToken?: string;
  };
}
```

### Provider options

For Copilot:
```typescript
providerOptions: {
  defaultModel: 'claude-sonnet-4.6',
  defaultTimeoutMs: 300_000,
  defaultCwd: process.cwd(),
  verbose: false,
  gitHubToken: process.env.MY_TOKEN,    // optional override
  cliPath: '/usr/local/bin/copilot',    // optional override
  githubHost: 'https://my-tenant.ghe.com/', // optional GHEC
}
```

For Claude Agent:
```typescript
providerOptions: {
  defaultModel: 'claude-sonnet-4-6',
  defaultCwd: process.cwd(),
  defaultEffort: 'high',
  defaultPermissionMode: 'bypassPermissions',
  defaultMaxTurns: 50,
  defaultMaxBudgetUsd: 10,
  includePartialMessages: true,
  enableFileCheckpointing: false,
  env: process.env as Record<string, string>,
}
```

---

## 4. Facades

`ai.workflows`, `ai.chat`, `ai.automations`, `ai.events`, `ai.scripts`, `ai.tools`. See per-feature docs for full signatures:

- [feature-chat.md → SDK](./feature-chat.md#7-sdk)
- [feature-workflows.md → SDK](./feature-workflows.md#7-sdk)
- [feature-workflow-runs.md → SDK](./feature-workflow-runs.md#14-sdk)
- [feature-automations.md → SDK](./feature-automations.md#8-sdk)
- [feature-templates-scripts.md → SDK](./feature-templates-scripts.md#5-sdk)
- [feature-hooks.md → register handlers](./feature-hooks.md#33-function-hook)

Quick reference:

```typescript
// Workflows
await ai.workflows.create({ id, name, stages, edges, … });
await ai.workflows.list();
await ai.workflows.get(id);
const run = await ai.workflows.run(id, { variables, projectId });
for await (const ev of ai.workflows.stream(run.id, { fromSequence: 0 })) { … }
await ai.workflows.pause(runId);
await ai.workflows.resume(runId);
await ai.workflows.cancel(runId);
await ai.workflows.retry(runId);

// Chat
const chat = await ai.chat.create({ name, projectId? });
const unsub = await ai.chat.onMessage(chat.id, ev => { … });
await ai.chat.send(chat.id, 'hello');
await ai.chat.archive(chat.id);

// Automations
await ai.automations.create({ name, triggerType: 'schedule', cronExpression, workflowIds, inputMode, … });
await ai.automations.trigger(id);
await ai.automations.enable(id);

// Events
const unsubAll = ai.events.onAll(ev => { … });
const unsubRun = ai.events.onRun(runId, ev => { … });
const past = await ai.events.replay(sessionId, afterSeq);
await ai.events.emit(sessionId, createAgentEvent('custom.thing', { … }));

// Scripts
const scripts = ai.scripts.list();
await ai.scripts.reload();
await ai.scripts.validate('./workflows/new.workflow.mjs');

// Tools
ai.tools.register(ai.tools.tool({
  name: 'compute_metric',
  description: 'Compute X * Y',
  inputSchema: z.object({ x: z.number(), y: z.number() }),
  execute: async ({ x, y }) => ({ result: x * y }),
}));
```

---

## 5. Custom tools

```typescript
import { z } from 'zod';
import { tool } from '@generatorai/sdk';

const myTool = tool({
  name: 'get_user',
  description: 'Look up a user by id',
  inputSchema: z.object({
    userId: z.string(),
  }),
  execute: async ({ userId }) => {
    return await myDatabase.users.findOne({ id: userId });
  },
});

ai.tools.register(myTool);
```

The tool is now available to all subsequent stages and chats. The model sees it under its registered name (Copilot) or `mcp__generatorai-tools__<name>` (Claude Agent).

---

## 6. Bring-your-own harness

```typescript
import { createGeneratorAI, IAgentHarness } from '@generatorai/sdk';

class MyCustomHarness implements IAgentHarness {
  // … implement 14 methods
}

const ai = await createGeneratorAI({
  provider: new MyCustomHarness(),
});
```

Any class implementing the port works. Useful for stubbing in tests or wiring a fully custom LLM proxy.

---

## 7. Testing

```typescript
import { createTestGeneratorAI, MockHarness } from '@generatorai/sdk/testing';

const ai = await createTestGeneratorAI();
// → temp DB + artifacts + scripts dirs, logger silenced, MockHarness as provider
//   returns [{ id: 'mock-model', name: 'Mock', provider: 'mock' }] for getModels()
//   never actually sends prompts (sendPrompt is a no-op that emits a fake harness.message_complete)

// Override individual fields:
const ai2 = await createTestGeneratorAI({ database: ':memory:' });
```

`MockHarness` is also exported standalone; assign it to `provider` for unit tests where you want full mocking.

---

## 8. Power user — direct service access

`ai.services: CoreServices` exposes every application service. Use sparingly; the facades exist for a reason.

```typescript
const def = await ai.services.workflowDefinitionService.getById(defId);
const run = await ai.services.workflowRunService.startRun(runId);

// Register a function hook handler
ai.services.hookExecutor.registerFunctionHandler('myHandler', async (ctx) => ({
  variables: { … },
}));

// Use the workspace manager directly
const ws = await ai.services.workspaceManager.getById(workspaceId);
const files = await ai.services.workspaceManager.listFiles(ws, 'artifacts/responses');
```

---

## 9. Shutdown

```typescript
await ai.shutdown();
```

This:
1. Flushes pending events.
2. Closes harness (calls `harness.shutdown()` → graceful subprocess termination + listener cleanup).
3. Closes DB connections.

Always call this on process exit. The SDK does **not** install signal handlers automatically.

---

## 10. Provider switching at runtime

```typescript
import { createHarnessProvider, HarnessProxy } from '@generatorai/agent-harness-providers';

// You can pass a pre-built HarnessProxy:
const rawHarness = await createHarnessProvider({ type: 'copilot', copilot: { … } });
const proxy = new HarnessProxy(rawHarness, 'copilot');
const ai = await createGeneratorAI({ provider: proxy });

// Later: switch to Claude Agent without restarting services
const claudeHarness = await createHarnessProvider({ type: 'claude-agent', claudeAgent: { … } });
await proxy.switchAdapter(claudeHarness, 'claude-agent');
// All services keep using `proxy`; traffic now flows to Claude.
```

> Stage `harnessConfigOverrides.model` is provider-specific. Switching providers without scrubbing/aliasing model overrides will fail stages. Prefer model-namespace agnostic settings (e.g., omit `model` to fall back to the provider's `defaultModel`).

---

## 11. Distributing your integration

Two distribution shapes:

1. **Library** — `pnpm add @generatorai/sdk` in your own project; embed a CLI or server. You control config + lifecycle.
2. **Service** — run our `apps/server` standalone, talk to it via the unified REST/SSE API from your own UI. See [feature-streaming-events.md](./feature-streaming-events.md) for the wire format and [usage-web.md](./usage-web.md) for the API surface.

For the second pattern, our `@generatorai/shared/types/IPlatformClient.ts` defines the contract any client must implement.

---

## 12. Edge cases

1. **SQLite contention** — `better-sqlite3` is synchronous. High write concurrency from one process is fine (WAL). Multi-process writes need a single owner — run a single SDK instance per DB.
2. **`logger: false`** — silences all output but does *not* disable OTel. Set `OTEL_SDK_DISABLED=true` for full silence.
3. **`artifactsDir` writeable** — must be writable by the Node process; SDK creates per-project subdirectories on the fly.
4. **Missing harness package** — `createHarnessProvider({ type: 'claude-agent' })` throws a clear error if `@anthropic-ai/claude-agent-sdk` isn't installed. Same for Copilot.
5. **Schema drift** — `createDB(dbPath)` auto-runs migrations. If you point at an older DB it upgrades in place. Always backup before connecting a newer SDK to an older DB.
6. **Long-lived `for await` of stream** — closes automatically when the run enters a terminal status (`completed`, `failed`, `cancelled`). The SDK injects a synthetic close event to break the loop cleanly.
7. **`tools.register` after a chat has started** — only affects sessions created *after* registration. Existing sessions are bound to their original tool list.
