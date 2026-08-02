# @generatorai/sdk

The official SDK for GeneratorAI — a local-first AI-agent workflow automation platform. Create, run, and manage multi-stage AI workflows programmatically.

## Installation

```bash
pnpm add @generatorai/sdk
```

> **Requirements:** Node.js ≥ 20, SQLite available on host (via `better-sqlite3`)

## Quick Start

```typescript
import { createGeneratorAI } from '@generatorai/sdk';

const ai = await createGeneratorAI({
  provider: 'copilot',          // 'copilot' or 'claude-agent'
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
  // Required
  provider: 'copilot',               // AI provider: 'copilot' | 'claude-agent'

  // Optional
  database: './generatorai.db',       // SQLite path (default: ./generatorai.db)
  artifactsDir: './artifacts',        // Output directory (default: ./generatorai-artifacts)
  scriptsDir: './scripts',            // Workflow scripts directory
  projectRoot: process.cwd(),         // Project root for git operations
  maxConcurrentSessions: 5,           // Concurrent AI sessions (default: 5)
  logger: { level: 'info' },          // Pino log level or false to disable
  providerOptions: { ... },           // Provider-specific config
});
```

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

The `provider` accepts either a built-in shorthand (`'copilot'` | `'claude-agent'`)
**or** a pre-built `IAgentHarness` instance — so you can run workflows, chats and
automations on top of any harness you implement. This is the SDK's core
extension point and part of the stable API.

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
  provider: new MyHarness(),     // ← runs entirely on your harness
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
@generatorai/sdk (facade)
    ├── @generatorai/core (domain services, DAG scheduler, event bus)
    ├── @generatorai/db (SQLite + Drizzle ORM)
    ├── @generatorai/shared (types, errors, config, builders)
    └── @generatorai/agent-harness-providers (Copilot SDK, Claude Agent SDK)
```

The SDK is a thin facade over the full GeneratorAI platform. It wires all internal services via dependency injection and exposes them through a clean, typed API.

## License

MIT
