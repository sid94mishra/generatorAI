# @generatorai/sdk

> **Status: INTERNAL / UNPUBLISHED / FROZEN (September 2026).**
>
> - `private: true`; there is no `publishConfig` and no release pipeline.
> - **Zero importers in this repository.** Nothing in `apps/*` or `packages/*`
>   imports `@generatorai/sdk`; the only consumer is its own smoke test.
> - **It is not a client of the running server.** `createGeneratorAI()` builds
>   the entire server dependency graph *in-process* — `createDB` + `migrateDB`
>   (SQLite via `better-sqlite3`), `createAllRepositories`, `createCoreServices`
>   and a harness provider — a second, independent wiring of the same engine
>   `apps/server/src/composition-root.ts` wires. The two can and will drift.
> - **It cannot be installed outside the monorepo.** All four runtime
>   dependencies (`@generatorai/shared`, `@generatorai/core`, `@generatorai/db`,
>   `@generatorai/agent-harness-providers`) are `private: true` workspace
>   packages whose `main` points at raw TypeScript (`./src/index.ts`), so
>   `pnpm add @generatorai/sdk` from another project has never worked.
>
> The decision recorded in `docs/APPLICATION-REVIEW-2026-09.md` (Phase 3) is:
> freeze now; later either publish properly (build step, published deps, one
> composition root shared with the server) or delete. Until then, treat this
> package as a test harness for the core engine, not as a product surface.

The rest of this file documents the API as it exists, for people working
inside the repository.

## Requirements

Node.js ≥ 20, run from inside this monorepo (workspace symlinks resolve the
private dependencies), and SQLite via `better-sqlite3` on the host.

## Quick Start (in-repo)

```typescript
import { createGeneratorAI } from '@generatorai/sdk';

const ai = await createGeneratorAI({
  harness: 'copilot',           // HarnessType — same word as the server's HARNESS_TYPE
  database: './my-app.db',      // SQLite file path
});

// Create a workflow
const definition = await ai.workflows.create({
  name: 'Code Review',
  stages: [
    { localId: 'analyze',  name: 'Analyze Code',    prompt: 'Analyze the following code for bugs...' },
    { localId: 'report',   name: 'Write Report',    prompt: 'Write a structured review report...' },
  ],
  edges: [
    { fromStageLocalId: 'analyze', toStageLocalId: 'report', edgeType: 'on_success' },
  ],
});

// Run it
const run = await ai.workflows.run(definition.id, {
  variables: { code: 'function add(a, b) { return a - b; }' },
});

// Stream events
for await (const event of ai.workflows.stream(run.id)) {
  console.log(`[${event.kind}]`, event.data);
}

await ai.shutdown();
```

## Configuration

```typescript
import { createGeneratorAI, type GeneratorAIConfig } from '@generatorai/sdk';

const ai = await createGeneratorAI({
  // Required (one of):
  harness: 'copilot',                 // HarnessType: 'copilot' | 'claude-agent' | 'codex' | 'opencode' | 'acp'
                                      //   or an IAgentHarness instance (bring-your-own-harness)
  // provider: 'copilot',             // deprecated alias for `harness`; still honoured

  // Optional
  database: './generatorai.db',       // SQLite path (default: ./generatorai.db)
  artifactsDir: './artifacts',        // Output directory (default: ./artifacts)
  scriptsDir: './workflows',          // Workflow scripts directory
  templatesDir: './templates',        // Workflow/stage templates + system artifacts
  maxConcurrentStages: 8,             // Concurrent stage executions across runs (default: 8)
  logger: { level: 'info' },          // Pino log level or false to disable
  providerOptions: { ... },           // Harness-specific config
  sandbox: { enabled: false },        // Run stages in a sandbox (Docker, or host with preferDocker: false)
});
```

The SDK wires the same workflow services as the server: durable HITL waits and
automation iterations, an execution workspace per run under
`<artifactsDir>/workspaces`, the admission controller, and commit/push/PR
post-processing through the source-control flow. Source-control accounts live in
`<artifactsDir>/source-control.json` (tokens in the encrypted secret store beside
it); `GENERATORAI_GITHUB_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN` seeds an account
when none exists.

`harness` was called `provider` before the server's `CopilotConfig → HarnessConfig`
rename; the field was renamed here so an SDK example and a server `.env` use the
same word for the same thing.

## API Reference

### Workflows — `ai.workflows.*`

```typescript
// Create a workflow definition (with stages + edges)
const def = await ai.workflows.create({ name, stages, edges, ... });

// List definitions
const defs = await ai.workflows.list();

// Get definition with stages
const full = await ai.workflows.get(definitionId);

// Start a run
const run = await ai.workflows.run(definitionId, { variables });

// Stream events (AsyncGenerator — completes on terminal state)
for await (const event of ai.workflows.stream(runId)) { ... }

// Lifecycle
await ai.workflows.pause(runId);
await ai.workflows.resume(runId);
await ai.workflows.cancel(runId);
const retried = await ai.workflows.retry(runId);

// Status
const run = await ai.workflows.status(runId);
```

### Chat — `ai.chat.*`

```typescript
// Create a chat
const chat = await ai.chat.create({ name: 'My Chat' });

// Send a message
await ai.chat.send(chat.id, 'Hello, analyze this code...');

// Subscribe to responses
const unsub = await ai.chat.onMessage(chat.id, (event) => {
  if (event.kind === 'harness.token') console.log(event.data);
});

// List & archive
const chats = await ai.chat.list();
await ai.chat.archive(chatId);
```

### Automations — `ai.automations.*`

```typescript
// Create an automation
const automation = await ai.automations.create({
  name: 'Nightly Review',
  triggerType: 'schedule',
  cronExpression: '0 0 * * *',
  workflowIds: [definitionId],
  inputMode: 'single',
});

// Trigger manually
const execution = await ai.automations.trigger(automationId);

// Lifecycle
await ai.automations.enable(automationId);
await ai.automations.disable(automationId);
const status = await ai.automations.getExecution(executionId);
```

### Events — `ai.events.*`

```typescript
// Subscribe to all events
const unsub = ai.events.onAll((event) => { ... });

// Subscribe to a specific run
const unsub = ai.events.onRun(runId, (event) => { ... });

// Replay historical events
const events = await ai.events.replay(sessionId, afterSequence);

// Emit custom events
await ai.events.emit(sessionId, { kind: 'custom.event', data: { ... } });
```

### Custom Tools — `ai.tools.*`

```typescript
import { tool } from '@generatorai/sdk';
import { z } from 'zod';

// Define a tool
const myTool = tool({
  name: 'search_docs',
  description: 'Search documentation',
  inputSchema: z.object({ query: z.string() }),
  execute: async (input) => {
    return { results: await searchDocs(input.query) };
  },
});

// Register it
ai.tools.register(myTool);

// List registered tools
const tools = ai.tools.list();
```

### Scripts — `ai.scripts.*`

```typescript
// List loaded workflow scripts
const scripts = ai.scripts.list();

// Get a specific script
const script = ai.scripts.get(scriptId);

// Reload from disk
await ai.scripts.reload();
```

### Builders

Use the fluent builder API to construct workflows programmatically:

```typescript
import { WorkflowBuilder, StageBuilder } from '@generatorai/sdk';

const workflow = new WorkflowBuilder('Code Pipeline')
  .addStage(
    new StageBuilder('analyze')
      .prompt('Analyze the code for quality issues...')
      .build()
  )
  .addStage(
    new StageBuilder('fix')
      .prompt('Fix the issues found...')
      .dependsOn('analyze', 'on_success')
      .build()
  )
  .build();
```

### Bring Your Own Harness

`harness` accepts either a built-in `HarnessType` **or** a pre-built
`IAgentHarness` instance — so you can run workflows, chats and automations on
top of any harness you implement. This is the SDK's core extension point.

```typescript
import { createGeneratorAI, type IAgentHarness } from '@generatorai/sdk';

// Implement the harness port (see the capability sub-interfaces in
// @generatorai/core: IHarnessClientLifecycle, IHarnessConversationLifecycle,
// IHarnessMessaging, IHarnessEvents, IHarnessModelDiscovery).
class MyHarness implements IAgentHarness {
  /* …initialize(), createConversation(), sendPromptAndWait(),
     onConversationEvent(), getModels(), … */
}

const ai = await createGeneratorAI({
  harness: new MyHarness(),      // ← runs entirely on your harness
  database: './my-app.db',
});
await ai.initialize();
```

Your harness is reported as `type: 'custom'` in health/telemetry. Everything
else (DAG runs, chats, automations, streaming, durability) works unchanged.

### Power User: Direct Service Access (unstable)

> ⚠️ `ai.services`, `ai.orchestrator`, `ai.streamBroker` and everything under
> `@generatorai/sdk/internal` are **not** covered by semver — they can change in
> any minor release. Prefer the facades. See [API-STABILITY.md](./API-STABILITY.md).

```typescript
// Access the raw core service graph (advanced, unstable):
const { eventBus, dagScheduler, workflowRunService } = ai.services;
import { WorkflowOrchestrator } from '@generatorai/sdk/internal';

// State machines are stable and exported from the package root:
import { WorkflowRunStateMachine, StageRunStateMachine } from '@generatorai/sdk';
```

## Architecture

```
@generatorai/sdk (facade — a SECOND composition root, not an HTTP client)
    ├── @generatorai/core (domain services, DAG scheduler, event bus)
    ├── @generatorai/db (SQLite + Drizzle ORM)
    ├── @generatorai/shared (types, errors, config, builders)
    └── @generatorai/agent-harness-providers (Copilot SDK, Claude Agent SDK, …)
```

The SDK wires all internal services via dependency injection inside the caller's
process. It does **not** connect to `apps/server`; if you want to drive a running
server programmatically, use `@generatorai/client-core` (the HTTP/WS client the
web, mobile and CLI apps share).

## License

MIT
