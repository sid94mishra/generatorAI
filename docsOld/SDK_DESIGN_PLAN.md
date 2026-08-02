# GeneratorAI SDK Design & Implementation Plan

## Executive Summary

This document presents a comprehensive plan to package GeneratorAI as a **reusable SDK** that external developers can `npm install` and use to build their own AI-agent-driven applications — complete with DAG workflows, multi-provider AI harness, streaming, automation, and programmatic workflow scripts.

---

## 1. Current State Analysis

### What Exists Today

| Layer | Package | Current State | SDK-Ready? |
|-------|---------|---------------|------------|
| Types & Schemas | `@generatorai/shared` | 70+ types, 20 Zod schemas, error hierarchy, logger | ✅ 90% ready |
| Orchestration | `@generatorai/core` | 40+ services, 20 port interfaces, state machines, DAG | ⚠️ 60% ready |
| Data Layer | `@generatorai/db` | SQLite + Drizzle, 25 repositories, migrations | ⚠️ 40% ready |
| AI Providers | `@generatorai/agent-harness-providers` | Copilot + Claude, lazy factory, HarnessProxy | ✅ 85% ready |
| MCP | `@generatorai/mcp-server` | Scaffolded, tool adapter functions | ❌ 20% ready |
| HTTP API | `apps/server` | Express REST + SSE, full CRUD | N/A (app, not SDK) |
| Web UI | `apps/web` | React SPA with all features | N/A (app, not SDK) |
| CLI | `apps/cli` | Commander + Ink TUI | N/A (app, not SDK) |

### Key Gaps for SDK Usage

| Gap | Severity | Impact |
|-----|----------|--------|
| **No high-level facade** | Critical | Users must manually wire 25+ repos + 19 services |
| **No `createGeneratorAI()` one-liner** | Critical | 80+ lines of boilerplate to get started |
| **All internals exported** | Medium | 58 exports, unclear which are public API |
| **No in-memory repositories** | Medium | Users must depend on SQLite even for testing |
| **Late-wire pattern** | Low | `setWorkspaceManager()` confusing for SDK users |
| **No published npm packages** | Critical | `"private": true` on all packages |
| **package.json "exports" broken** | Medium | Points to `.ts` source, not built `.js/.d.ts` |

---

## 2. Industry Research: How Modern Agentic SDKs Do It

### Comparison of Leading Frameworks

| Aspect | Vercel AI SDK | LangGraph.js | Mastra | OpenAI Agents | **GeneratorAI (Target)** |
|--------|--------------|-------------|--------|---------------|--------------------------|
| Entry Point | `generateText()` function | `StateGraph` builder | `new Agent()` + `new Workflow()` | `new Agent()` + `run()` | **`GeneratorAI.create()` + builders** |
| Package Style | 40+ scoped packages | Single + adapters | Monorepo, single SDK entry | Single package | **Monorepo, single SDK + adapters** |
| Provider Model | `@ai-sdk/openai`, `@ai-sdk/anthropic` | LangChain providers | Built-in model switching | OpenAI only | **`@generatorai/provider-*`** |
| Tool System | `tool()` function + Zod | Zod tools | npm packages + MCP | MCP + functions | **`tool()` + MCP + CustomToolRegistry** |
| Streaming | `streamText()` → `AsyncIterable` | Event stream | Native streaming | Native | **`EventBus` + SSE + `AsyncIterable`** |
| State Persistence | Checkpointing library | LangGraph Platform | Built-in storage | Optional | **SQLite default + pluggable** |
| Config | Runtime args > env > defaults | Programmatic | Programmatic | Programmatic | **`GeneratorAIConfig` + env + defaults** |
| DAG Support | Manual (workflow patterns) | **Native `StateGraph`** | Sequential/Branching | Handoffs only | **Native DAGScheduler (superior)** |
| HITL | Manual | **Native interrupt/resume** | Manual | Manual | **Native (stage interrupts)** |
| Multi-Agent | Subagents pattern | Subgraphs | Agents + Workflows | Agent handoffs | **DAG stages = multi-agent** |

### Key Insights from Research

1. **Vercel AI SDK** (24.5k ⭐) succeeds because of **one-liner simplicity**: `const { text } = await generateText({ model, prompt })`
2. **LangGraph.js** (2.9k ⭐) succeeds because of **explicit DAG composition**: `graph.addNode().addEdge().compile()`
3. **Mastra** (24.3k ⭐) succeeds because of **integrated studio + batteries-included**: agents, workflows, tools, eval all in one
4. **All use pnpm + Turbo monorepo** with modular exports and tree-shaking
5. **All support `AsyncIterable` streaming** as the core primitive
6. **All use Zod** for schema validation at boundaries
7. **Provider abstraction is mandatory** — lock-in = death for adoption

### GeneratorAI's Competitive Advantages

| Feature | vs. Vercel AI SDK | vs. LangGraph | vs. Mastra |
|---------|-------------------|---------------|------------|
| **True DAG orchestration** | ✅ We have it, they don't | Comparable | ✅ Ours is more flexible |
| **Built-in HITL** | ✅ They don't have it | Comparable | ✅ Ours persists to DB |
| **Streaming + replay** | Comparable | ✅ Ours has Last-Event-ID gap-fill | ✅ Ours is more robust |
| **Workflow scripts (.mjs)** | ✅ Unique feature | ❌ They use Python only | ⚠️ Mastra has similar |
| **Crash recovery** | ✅ We persist all state | ❌ They require LangGraph Platform | ⚠️ Partial |
| **Multi-provider** | Comparable | ❌ LangChain providers only | Comparable |
| **State machines** | ✅ Typed, exhaustive | ✅ Similar via annotations | ❌ They don't have formal SM |
| **Permission system** | ✅ Unique (tool-level gating) | ❌ | ❌ |
| **Automation (batch/loop)** | ✅ Unique | ❌ | ❌ |

---

## 3. Recommended Architecture: Layered SDK

### Design Philosophy

Inspired by **Vercel AI SDK** (simple entry point) + **LangGraph.js** (explicit DAG) + **Mastra** (batteries-included):

```
┌─────────────────────────────────────────────────────────────────┐
│                    @generatorai/sdk                              │
│  One-liner setup • High-level facades • Sensible defaults       │
├─────────────────────────────────────────────────────────────────┤
│  @generatorai/core         │  @generatorai/db                   │
│  Domain, services, DAG     │  SQLite + repos (default storage)  │
├────────────────────────────┼────────────────────────────────────┤
│  @generatorai/shared       │  @generatorai/harness-providers    │
│  Types, schemas, errors    │  Copilot, Claude (pluggable)       │
├────────────────────────────┼────────────────────────────────────┤
│  Optional Packages:                                             │
│  @generatorai/react  │  @generatorai/express  │  @generatorai/mcp│
└─────────────────────────────────────────────────────────────────┘
```

### Justification for This Architecture

| Decision | Justification | Alternatives Considered |
|----------|---------------|------------------------|
| **Single `@generatorai/sdk` entry point** | Minimizes friction (one install, one import). Vercel AI SDK and Mastra both prove this works at scale (24k+ stars). Users don't need to understand internal package boundaries. | Separate packages per layer (rejected: too many packages for simple use cases, discourages adoption) |
| **Keep `@generatorai/core` separate** | Power users need direct access to services/ports for custom wiring. SDK re-exports the public subset. | Merge core into SDK (rejected: would bloat SDK with internals) |
| **Keep `@generatorai/db` separate** | Users who want a different DB (Postgres, in-memory) can provide their own repository implementations via port interfaces. | Bundle SQLite always (rejected: would force 6MB native dep on everyone) |
| **Harness providers as separate package** | AI SDKs are optional peer deps (large, version-sensitive). Lazy-loading prevents bloat. | Bundle all providers (rejected: forces installing Copilot SDK + Anthropic SDK even if only using one) |
| **React hooks as separate package** | Not all consumers are React apps. Framework-specific code belongs in framework packages. | Bundle in SDK (rejected: would drag in React deps for Node.js users) |
| **`createGeneratorAI()` factory** | One-liner setup matches Mastra's `new Mastra()` and Vercel's simplicity. Hides 25+ repo instantiation. | Keep manual wiring (rejected: 80+ lines of boilerplate kills adoption) |

---

## 4. Public API Design

### 4.1 The One-Liner Entry Point

```typescript
// @generatorai/sdk — The simplest way to get started
import { createGeneratorAI } from '@generatorai/sdk';

const ai = await createGeneratorAI({
  provider: 'copilot',  // or 'claude-agent'
  database: './my-app.db',  // SQLite path (auto-migrated)
  artifactsDir: './artifacts',
});

// That's it! All 19 services wired, DB created, harness connected.
```

**Justification:** Every successful SDK (Vercel, Mastra, Prisma, Supabase) provides a one-liner. Developers decide to adopt within 30 seconds of reading the README. If setup takes 80 lines, they close the tab.

### 4.2 Core Operations API

```typescript
// ═══════════════════════════════════════════════════════════════
// WORKFLOWS — DAG-based multi-stage AI execution
// ═══════════════════════════════════════════════════════════════

// Create a workflow definition
const definition = await ai.workflows.create({
  name: 'Code Review Pipeline',
  description: 'Analyzes code, finds bugs, suggests fixes',
  stages: [
    { id: 'analyze', name: 'Code Analysis', prompt: 'Analyze this code for issues: {{code}}' },
    { id: 'suggest', name: 'Fix Suggestions', prompt: 'Suggest fixes for: {{analyze.output}}' },
  ],
  edges: [
    { from: 'analyze', to: 'suggest', type: 'on_success' },
  ],
  variables: { code: '' },
});

// Or use the fluent builder
import { WorkflowBuilder } from '@generatorai/sdk';

const definition = await ai.workflows.create(
  new WorkflowBuilder('code-review')
    .name('Code Review Pipeline')
    .stage('analyze', s => s.name('Code Analysis').prompt('Analyze: {{code}}'))
    .stage('suggest', s => s.name('Fix Suggestions').prompt('Fix: {{analyze.output}}'))
    .edge('analyze', 'suggest', 'on_success')
    .variable('code', { type: 'string', required: true })
    .build()
);

// Run a workflow
const run = await ai.workflows.run(definition.id, {
  variables: { code: 'function add(a, b) { return a - b; }' },
});

// Stream workflow events
for await (const event of ai.workflows.stream(run.id)) {
  switch (event.kind) {
    case 'stage_started': console.log(`Stage ${event.stageName} started`);  break;
    case 'text_delta':    process.stdout.write(event.content);              break;
    case 'stage_completed': console.log(`\nStage ${event.stageName} done`); break;
    case 'run_completed': console.log('Workflow complete!');                 break;
  }
}

// Pause / Resume / Cancel
await ai.workflows.pause(run.id);
await ai.workflows.resume(run.id, { userInput: 'approved' });
await ai.workflows.cancel(run.id);


// ═══════════════════════════════════════════════════════════════
// CHAT — Standalone AI conversations
// ═══════════════════════════════════════════════════════════════

const chat = await ai.chat.create({
  systemMessage: 'You are a helpful assistant.',
  model: 'gpt-4o',
  tools: [myCustomTool],
});

for await (const event of ai.chat.send(chat.id, 'Explain DAG scheduling')) {
  if (event.kind === 'text_delta') process.stdout.write(event.content);
}


// ═══════════════════════════════════════════════════════════════
// AUTOMATION — Batch/loop/scheduled workflow execution
// ═══════════════════════════════════════════════════════════════

const automation = await ai.automations.create({
  name: 'Daily Code Review',
  workflowIds: [definition.id],
  triggerType: 'schedule',
  cronExpression: '0 9 * * *',  // Every day at 9 AM
  inputMode: 'loop',
  loopVariable: 'pr_url',
  loopItems: ['https://github.com/org/repo/pull/1', '...'],
});

await ai.automations.trigger(automation.id);


// ═══════════════════════════════════════════════════════════════
// SCRIPTS — Programmatic workflow definition (.workflow.mjs)
// ═══════════════════════════════════════════════════════════════

// Load and run workflow scripts
const scripts = await ai.scripts.list();
const script = await ai.scripts.get('my-workflow');
const run = await ai.scripts.run('my-workflow', { profileName: 'production' });


// ═══════════════════════════════════════════════════════════════
// EVENTS — Real-time event system
// ═══════════════════════════════════════════════════════════════

// Subscribe to all events globally
const unsubscribe = ai.events.onAll((event) => {
  console.log(`[${event.kind}] session=${event.sessionId}`);
});

// Subscribe to a specific run
const unsubscribe2 = ai.events.onRun(run.id, (event) => {
  // Only events for this run
});

// Replay historical events (gap-fill)
for await (const event of ai.events.replay(run.id, { fromSequence: 42 })) {
  console.log(event);
}


// ═══════════════════════════════════════════════════════════════
// TOOLS — Custom tool registration
// ═══════════════════════════════════════════════════════════════

import { tool } from '@generatorai/sdk';
import { z } from 'zod';

const searchTool = tool({
  name: 'web_search',
  description: 'Search the web for information',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    const results = await fetch(`https://api.search.com?q=${encodeURIComponent(query)}`);
    return results.json();
  },
});

// Register globally
ai.tools.register(searchTool);

// Or per-chat/workflow
const chat = await ai.chat.create({ tools: [searchTool] });
```

### 4.3 Advanced: Direct Service Access (Power Users)

```typescript
// For users who need low-level control
const { workflowRunService, dagScheduler, eventBus, stageExecutionService } = ai.services;

// Direct DAG operations
const dag = await dagScheduler.buildDAG(definitionId);
const layers = dagScheduler.getExecutionLayers(dag);
const readyStages = await dagScheduler.computeReadyStages(runId);

// Direct state machine transitions
import { WorkflowRunStateMachine } from '@generatorai/sdk/state-machines';
const sm = new WorkflowRunStateMachine('running');
sm.transition('pause'); // → 'paused'
```

### 4.4 Provider Configuration

```typescript
import { createGeneratorAI } from '@generatorai/sdk';
import { copilot } from '@generatorai/provider-copilot';
import { claude } from '@generatorai/provider-claude';

// Single provider
const ai = await createGeneratorAI({
  provider: copilot({ 
    defaultModel: 'gpt-4o',
    useStdio: true,
  }),
  database: './app.db',
});

// Multiple providers (runtime switching)
const ai = await createGeneratorAI({
  providers: {
    default: copilot({ defaultModel: 'gpt-4o' }),
    heavy: claude({ defaultModel: 'claude-opus-4-5-20250620' }),
  },
  database: './app.db',
});

// Use specific provider per-operation
await ai.chat.create({ provider: 'heavy', systemMessage: '...' });
```

**Justification:** Follows Vercel AI SDK's provider pattern (`@ai-sdk/openai`, `@ai-sdk/anthropic`). Users install only the providers they need. Each provider is a peer dependency, not bundled.

### 4.5 Custom Storage Adapter

```typescript
import { createGeneratorAI } from '@generatorai/sdk';
import { createPostgresStorage } from '@generatorai/storage-postgres';  // hypothetical

const ai = await createGeneratorAI({
  provider: 'copilot',
  storage: createPostgresStorage({
    connectionString: process.env.DATABASE_URL,
  }),
});

// Or in-memory for testing
import { createInMemoryStorage } from '@generatorai/sdk/testing';

const ai = await createGeneratorAI({
  provider: 'copilot',
  storage: createInMemoryStorage(),
});
```

**Justification:** The port interfaces (`ISessionRepository`, `IWorkflowRunRepository`, etc.) already define the contract. We just need a factory that produces all 25 implementations from a single config. Default = SQLite (zero-config). Advanced = pluggable.

---

## 5. Package Structure (Detailed)

### 5.1 New Package Layout

```
packages/
  sdk/                          # NEW: @generatorai/sdk — Main entry point
    src/
      index.ts                  # createGeneratorAI, re-exports
      GeneratorAI.ts            # Main facade class
      config.ts                 # GeneratorAIConfig type + defaults
      facades/
        WorkflowFacade.ts       # ai.workflows.*
        ChatFacade.ts           # ai.chat.*
        AutomationFacade.ts     # ai.automations.*
        ScriptFacade.ts         # ai.scripts.*
        EventFacade.ts          # ai.events.*
        ToolFacade.ts           # ai.tools.*
      storage/
        StorageAdapter.ts       # Interface for pluggable storage
        SQLiteStorageAdapter.ts # Default: wraps @generatorai/db
        InMemoryStorage.ts      # For testing
      testing/
        index.ts                # Test utilities, mocks, in-memory storage
        MockHarness.ts          # Fake AI provider for tests
    package.json

  core/                         # EXISTING: @generatorai/core — Orchestration engine
    (unchanged except: mark internal vs public via JSDoc + selective re-export)

  shared/                       # EXISTING: @generatorai/shared — Types/schemas/errors
    (unchanged except: add subpath exports for granular imports)

  db/                           # EXISTING: @generatorai/db — SQLite storage impl
    (unchanged except: export createAllRepositories() factory)

  agent-harness-providers/      # EXISTING → RENAME: @generatorai/providers
    providers/
      copilot/                  # @generatorai/provider-copilot
      claude/                   # @generatorai/provider-claude
    (keep lazy-loading, keep HarnessFactory + HarnessProxy)

  react/                        # NEW: @generatorai/react — React hooks
    src/
      useWorkflow.ts            # Hook for workflow streaming
      useChat.ts                # Hook for chat
      useEvents.ts              # Hook for event subscription
      EventSourceManager.ts     # SSE connection management
    package.json

  express/                      # NEW: @generatorai/express — Express middleware
    src/
      middleware.ts             # createGeneratorAIRouter() → Express Router
      streaming.ts              # SSE endpoint helper
    package.json

  mcp-server/                   # EXISTING: @generatorai/mcp — MCP integration
    (flesh out transport layer)
```

### 5.2 Dependency Graph (After Refactor)

```
@generatorai/shared (LEAF — zero internal deps)
  ↑
@generatorai/core (depends: shared)
  ↑
@generatorai/db (depends: core, shared)
  ↑
@generatorai/sdk (depends: core, shared, db)
  ↑                 ↑
  │    @generatorai/provider-copilot (peer: @github/copilot-sdk)
  │    @generatorai/provider-claude (peer: @anthropic-ai/claude-agent-sdk)
  │
@generatorai/react (depends: sdk, shared)
@generatorai/express (depends: sdk, shared)
```

### 5.3 package.json for `@generatorai/sdk`

```json
{
  "name": "@generatorai/sdk",
  "version": "1.0.0",
  "description": "GeneratorAI — DAG-based AI agent workflow orchestration SDK",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./testing": {
      "import": "./dist/testing/index.js",
      "types": "./dist/testing/index.d.ts"
    },
    "./state-machines": {
      "import": "./dist/state-machines.js",
      "types": "./dist/state-machines.d.ts"
    },
    "./types": {
      "import": "./dist/types.js",
      "types": "./dist/types.d.ts"
    }
  },
  "dependencies": {
    "@generatorai/shared": "workspace:*",
    "@generatorai/core": "workspace:*",
    "@generatorai/db": "workspace:*"
  },
  "peerDependencies": {
    "@generatorai/provider-copilot": "workspace:*",
    "@generatorai/provider-claude": "workspace:*"
  },
  "peerDependenciesMeta": {
    "@generatorai/provider-copilot": { "optional": true },
    "@generatorai/provider-claude": { "optional": true }
  },
  "engines": { "node": ">=20" },
  "keywords": ["ai", "agents", "workflow", "dag", "orchestration", "sdk", "copilot", "claude"]
}
```

---

## 6. Implementation Plan (Phased)

### Phase 1: Foundation (Critical Path)

**Goal:** External developers can `npm install @generatorai/sdk` and run workflows.

| Task | Files | Effort | Priority |
|------|-------|--------|----------|
| 1.1 Create `packages/sdk/` package scaffold | New package | Small | P0 |
| 1.2 Build `GeneratorAI` facade class | `sdk/src/GeneratorAI.ts` | Medium | P0 |
| 1.3 Build `createGeneratorAI()` factory | `sdk/src/index.ts` | Medium | P0 |
| 1.4 Add `createAllRepositories()` to `@generatorai/db` | `db/src/factories.ts` | Small | P0 |
| 1.5 Build `StorageAdapter` interface + SQLite adapter | `sdk/src/storage/` | Medium | P0 |
| 1.6 Build `WorkflowFacade` (create, run, stream, pause/resume/cancel) | `sdk/src/facades/` | Large | P0 |
| 1.7 Build `ChatFacade` (create, send, stream) | `sdk/src/facades/` | Medium | P0 |
| 1.8 Build `EventFacade` (subscribe, replay) | `sdk/src/facades/` | Small | P0 |
| 1.9 Fix all package.json `exports` fields | All packages | Small | P0 |
| 1.10 Add proper `tsconfig` build output (`.d.ts` + `.js`) | All packages | Small | P0 |
| 1.11 Remove `"private": true` from publishable packages | All packages | Trivial | P0 |

### Phase 2: Developer Experience

**Goal:** SDK is pleasant to use with good defaults, testing support, docs.

| Task | Files | Effort | Priority |
|------|-------|--------|----------|
| 2.1 Build `InMemoryStorage` for testing | `sdk/src/testing/` | Medium | P1 |
| 2.2 Build `MockHarness` (fake AI responses) | `sdk/src/testing/` | Medium | P1 |
| 2.3 Build `tool()` helper function | `sdk/src/tool.ts` | Small | P1 |
| 2.4 Build `ScriptFacade` (list, get, run, materialize) | `sdk/src/facades/` | Medium | P1 |
| 2.5 Build `AutomationFacade` (create, trigger, status) | `sdk/src/facades/` | Medium | P1 |
| 2.6 Build `ToolFacade` (register, list) | `sdk/src/facades/` | Small | P1 |
| 2.7 Re-export `WorkflowBuilder` + `StageBuilder` from SDK | `sdk/src/index.ts` | Trivial | P1 |
| 2.8 Write SDK README with quickstart examples | `packages/sdk/README.md` | Medium | P1 |
| 2.9 Generate API reference docs (TypeDoc) | Build config | Small | P1 |
| 2.10 Create `create-generatorai` CLI scaffolding tool | New package | Large | P2 |

### Phase 3: Framework Integrations

**Goal:** First-class React, Express, and MCP support.

| Task | Files | Effort | Priority |
|------|-------|--------|----------|
| 3.1 Build `@generatorai/react` (useWorkflow, useChat, useEvents) | New package | Large | P1 |
| 3.2 Build `@generatorai/express` (createRouter, SSE helper) | New package | Medium | P1 |
| 3.3 Flesh out `@generatorai/mcp` (transport + tool bridge) | Existing package | Large | P2 |
| 3.4 Build `@generatorai/provider-copilot` (split from harness-providers) | Refactor | Medium | P2 |
| 3.5 Build `@generatorai/provider-claude` (split from harness-providers) | Refactor | Medium | P2 |

### Phase 4: Production Hardening

**Goal:** SDK is reliable for production use.

| Task | Files | Effort | Priority |
|------|-------|--------|----------|
| 4.1 Add comprehensive unit tests for all facades | `sdk/__tests__/` | Large | P1 |
| 4.2 Integration tests (SDK → real DB → mock harness) | `sdk/__tests__/` | Large | P1 |
| 4.3 Bundle size budget (< 200KB minified core) | Build config | Small | P2 |
| 4.4 Tree-shaking verification | Build test | Small | P2 |
| 4.5 Changeset + automated versioning setup | `.changeset/` | Small | P1 |
| 4.6 CI: publish to npm on release | `.github/workflows/` | Medium | P1 |
| 4.7 Security audit (OWASP Top 10 review) | All packages | Medium | P1 |

---

## 7. Technical Design Details

### 7.1 GeneratorAI Facade Class

```typescript
// packages/sdk/src/GeneratorAI.ts

import type { CoreServices, CoreServicesInputs } from '@generatorai/core';
import type { GeneratorAIConfig } from './config.js';

export class GeneratorAI {
  // Public facades
  readonly workflows: WorkflowFacade;
  readonly chat: ChatFacade;
  readonly automations: AutomationFacade;
  readonly scripts: ScriptFacade;
  readonly events: EventFacade;
  readonly tools: ToolFacade;

  // Power-user access to internal services
  readonly services: CoreServices;

  private constructor(services: CoreServices, config: ResolvedConfig) {
    this.services = services;
    this.workflows = new WorkflowFacade(services);
    this.chat = new ChatFacade(services);
    this.automations = new AutomationFacade(services);
    this.scripts = new ScriptFacade(services, config);
    this.events = new EventFacade(services);
    this.tools = new ToolFacade(services);
  }

  /** Graceful shutdown — closes DB, stops harness, flushes events */
  async shutdown(): Promise<void> { /* ... */ }

  /** Factory — the recommended way to create a GeneratorAI instance */
  static async create(config: GeneratorAIConfig): Promise<GeneratorAI> {
    // 1. Resolve config with defaults
    const resolved = resolveConfig(config);

    // 2. Create storage (SQLite default, or custom adapter)
    const storage = await createStorage(resolved);

    // 3. Create harness provider (lazy-loads SDK)
    const harness = await createHarness(resolved);

    // 4. Create infrastructure
    const infra = createInfrastructure(resolved);

    // 5. Wire everything via createCoreServices
    const services = createCoreServices({
      ...storage.repositories,
      ...infra,
      harness,
      config: resolved,
    });

    return new GeneratorAI(services, resolved);
  }
}
```

### 7.2 Configuration Schema

```typescript
// packages/sdk/src/config.ts

export interface GeneratorAIConfig {
  /** AI provider — string shorthand or provider instance */
  provider: 'copilot' | 'claude-agent' | IAgentHarness;

  /** Provider-specific options (when using string shorthand) */
  providerOptions?: CopilotProviderOptions | ClaudeAgentProviderOptions;

  /** Database path (SQLite) or custom storage adapter */
  database?: string | StorageAdapter;

  /** Directory for artifacts (code output, logs) */
  artifactsDir?: string;

  /** Directory for workflow scripts (.workflow.mjs) */
  scriptsDir?: string;

  /** Max concurrent AI sessions */
  maxConcurrentSessions?: number;

  /** Logger configuration */
  logger?: LoggerConfig | false;

  /** Observability (OpenTelemetry) */
  telemetry?: boolean | TelemetryConfig;

  /** Sandbox configuration (Docker or host) */
  sandbox?: SandboxConfig;

  /** Project root for workspace resolution */
  projectRoot?: string;
}

// Defaults (sensible for 90% of use cases)
const DEFAULTS: Required<GeneratorAIConfig> = {
  provider: 'copilot',
  providerOptions: {},
  database: './generatorai.db',
  artifactsDir: './artifacts',
  scriptsDir: './workflows',
  maxConcurrentSessions: 10,
  logger: { level: 'info' },
  telemetry: false,
  sandbox: { enabled: false },
  projectRoot: process.cwd(),
};
```

### 7.3 Storage Adapter Interface

```typescript
// packages/sdk/src/storage/StorageAdapter.ts

export interface StorageAdapter {
  /** All repository implementations, pre-wired */
  readonly repositories: AllRepositories;

  /** Transaction wrapper for atomic operations */
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;

  /** Sequence allocator for event ordering */
  readonly sequenceAllocator: ISequenceAllocator;

  /** Run migrations (idempotent) */
  migrate(): Promise<void>;

  /** Close connections */
  close(): Promise<void>;
}

export interface AllRepositories {
  sessionRepo: ISessionRepository;
  eventRepo: IEventRepository;
  chatMessageRepo: IChatMessageRepository;
  artifactRepo: IArtifactRepository;
  webhookRepo: IWebhookRepository;
  chatEntityRepo: IChatRepository;
  workflowDefinitionRepo: IWorkflowDefinitionRepository;
  stageDefinitionRepo: IStageDefinitionRepository;
  stageEdgeRepo: IStageEdgeRepository;
  workflowRunRepo: IWorkflowRunRepository;
  stageRunRepo: IStageRunRepository;
  automationRepo: IAutomationRepository;
  automationExecutionRepo: IAutomationExecutionRepository;
  sessionAllocationRepo: ISessionAllocationRepository;
  // ... project/workspace repos
}
```

**Justification:** This `StorageAdapter` collapses 25+ individual repository instantiations into a single object. The SDK provides `SQLiteStorageAdapter` as default. Power users can implement their own (e.g., Postgres) by satisfying the port interfaces that already exist in `@generatorai/core`.

### 7.4 WorkflowFacade Design

```typescript
// packages/sdk/src/facades/WorkflowFacade.ts

export class WorkflowFacade {
  constructor(private services: CoreServices) {}

  /** Create a workflow definition from builder output or config object */
  async create(input: WorkflowDefinitionInput): Promise<WorkflowDefinition> {
    return this.services.workflowDefinitionService.createDefinition(input);
  }

  /** List all workflow definitions */
  async list(): Promise<WorkflowDefinition[]> {
    return this.services.workflowDefinitionService.listDefinitions();
  }

  /** Start a workflow run */
  async run(definitionId: string, options?: RunOptions): Promise<WorkflowRun> {
    return this.services.workflowRunService.createAndStartRun({
      definitionId,
      variables: options?.variables,
      sessionMode: options?.sessionMode,
    });
  }

  /** Stream events from a running workflow (AsyncIterable) */
  async *stream(runId: string, options?: StreamOptions): AsyncGenerator<AgentEvent> {
    const fromSeq = options?.fromSequence ?? 0;
    yield* this.services.eventBus.replay(runId, fromSeq);
    // Then live events...
    const { promise, resolve } = createDeferred();
    const unsub = this.services.eventBus.subscribe(`run:${runId}`, (event) => {
      // Push to async queue
    });
    // ... yield live events until run completes
  }

  /** Pause a running workflow */
  async pause(runId: string): Promise<void> {
    return this.services.workflowRunService.pauseRun(runId);
  }

  /** Resume a paused workflow */
  async resume(runId: string, options?: { userInput?: string }): Promise<void> {
    return this.services.workflowRunService.resumeRun(runId, options?.userInput);
  }

  /** Cancel a workflow */
  async cancel(runId: string): Promise<void> {
    return this.services.workflowRunService.cancelRun(runId);
  }

  /** Get current status of a run */
  async status(runId: string): Promise<WorkflowRun> {
    return this.services.workflowRunService.getRun(runId);
  }
}
```

### 7.5 Event Streaming (AsyncIterable Pattern)

```typescript
// How streaming works for SDK users

// Pattern 1: for-await (simple)
for await (const event of ai.workflows.stream(runId)) {
  handleEvent(event);
}

// Pattern 2: callback (more control)
const unsubscribe = ai.events.onRun(runId, (event) => {
  handleEvent(event);
});
// Later: unsubscribe();

// Pattern 3: replay + live (gap-fill on reconnect)
for await (const event of ai.events.replay(runId, { fromSequence: lastSeen })) {
  // Guaranteed no gaps — reads from DB then subscribes live
}
```

**Justification:** `AsyncIterable` is the universal streaming primitive in modern JS/TS (used by Vercel AI SDK, Node.js streams, LangGraph). It composes with `for await`, destructuring, and pipeline operators. We also keep callback-style for users who prefer push-based patterns.

---

## 8. Migration Strategy for Existing Apps

### 8.1 Server App (apps/server)

The existing server continues to work unchanged. It imports from `@generatorai/core` directly and does its own composition. The SDK is an **alternative** entry point, not a replacement.

```typescript
// Before (server/composition-root.ts) — still works
import { createCoreServices } from '@generatorai/core';
import { createDB } from '@generatorai/db';
// ... 80 lines of wiring

// After (new apps can do this instead)
import { createGeneratorAI } from '@generatorai/sdk';
const ai = await createGeneratorAI({ provider: 'copilot', database: './app.db' });
```

### 8.2 CLI App (apps/cli)

The CLI's "Direct Mode" (not yet implemented) becomes trivial:

```typescript
// Before: Would need to replicate server's composition-root.ts
// After:
import { createGeneratorAI } from '@generatorai/sdk';
const ai = await createGeneratorAI({ provider: 'copilot', database: cliConfig.dbPath });

// Direct mode just uses the SDK
await ai.workflows.run(definitionId, { variables });
```

### 8.3 Third-Party Consumers

```typescript
// A third-party "code review bot" using the SDK
import { createGeneratorAI, WorkflowBuilder, tool } from '@generatorai/sdk';
import { z } from 'zod';

const ai = await createGeneratorAI({
  provider: 'copilot',
  database: ':memory:',  // In-memory for serverless
});

const githubTool = tool({
  name: 'get_pr_diff',
  description: 'Fetch PR diff from GitHub',
  inputSchema: z.object({ prUrl: z.string().url() }),
  execute: async ({ prUrl }) => { /* ... */ },
});

ai.tools.register(githubTool);

const workflow = new WorkflowBuilder('pr-review')
  .stage('fetch', s => s.name('Fetch PR').prompt('Get the diff for {{pr_url}}'))
  .stage('review', s => s.name('Review Code').prompt('Review this diff: {{fetch.output}}'))
  .edge('fetch', 'review', 'on_success')
  .build();

const def = await ai.workflows.create(workflow);
const run = await ai.workflows.run(def.id, { variables: { pr_url: process.argv[2] } });

for await (const event of ai.workflows.stream(run.id)) {
  if (event.kind === 'text_delta') process.stdout.write(event.content);
}

await ai.shutdown();
```

---

## 9. What NOT to Do (Anti-Patterns)

| Anti-Pattern | Why It's Bad | Our Approach |
|---|---|---|
| Export everything from core | Unclear API surface, breaking changes everywhere | Facade pattern with explicit public API |
| Force SQLite on everyone | Some users need Postgres, some need in-memory | StorageAdapter interface, SQLite as default |
| Bundle all AI SDKs | Bloats install size by 50MB+ | Peer dependencies, lazy loading |
| Require 80+ lines of setup | Kills adoption instantly | `createGeneratorAI()` one-liner |
| No streaming support | Modern AI UX requires it | `AsyncIterable` as first-class pattern |
| No testing utilities | Forces users to mock everything | `InMemoryStorage` + `MockHarness` included |
| Monolithic single package | Can't tree-shake, can't opt out of features | Modular packages with selective imports |
| Breaking changes without warning | Destroys trust | Changeset versioning + deprecation headers |
| No TypeScript-first support | Lose 90% of the ecosystem | `.d.ts` for everything, Zod schemas, generics |

---

## 10. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Time to first workflow** | < 5 minutes | From `npm install` to running a workflow |
| **Lines of boilerplate** | < 10 lines | To create + run a basic workflow |
| **Bundle size (core)** | < 200KB gzipped | `@generatorai/sdk` without DB/providers |
| **npm install time** | < 30 seconds | On a clean project |
| **TypeScript coverage** | 100% | All exports have full types |
| **Test coverage** | > 80% | Facades + storage adapters |
| **Zero-config works** | Yes | `createGeneratorAI({ provider: 'copilot' })` |

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| SQLite native dep blocks serverless | High | Medium | Offer `:memory:` mode + document alternatives |
| Breaking changes in core services | Medium | High | Facades isolate users from internal changes |
| Provider SDK version conflicts | Medium | Medium | Peer deps + version ranges |
| Adoption hampered by Copilot SDK access | High | High | Support Claude as equally first-class provider |
| Performance regression in facades | Low | Medium | Facades are thin wrappers, no extra allocations |
| Documentation gets stale | High | Medium | TypeDoc auto-generation from source |

---

## 12. Timeline Estimate

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1 (Foundation) | 2-3 weeks | `@generatorai/sdk` installable, workflows + chat work |
| Phase 2 (DX) | 1-2 weeks | Testing utilities, scripts/automation facades, docs |
| Phase 3 (Integrations) | 2-3 weeks | React hooks, Express middleware, provider split |
| Phase 4 (Hardening) | 1-2 weeks | Tests, CI/CD, npm publish, security review |
| **Total** | **6-10 weeks** | Production-ready SDK |

---

## 13. Decision Summary

| Decision | Choice | Key Justification |
|----------|--------|-------------------|
| Entry point style | `createGeneratorAI()` factory | Proven by Prisma, Supabase, Mastra — one-liner adoption |
| Package structure | Single SDK + optional adapters | Balance of simplicity (one install) and modularity (tree-shake) |
| Provider model | Peer dependencies, lazy-loaded | Users install only what they use; prevents SDK bloat |
| Storage abstraction | Interface + SQLite default | Port interfaces already exist; just need a factory |
| Streaming primitive | `AsyncIterable<AgentEvent>` | Universal JS pattern; composes with `for await`, destructuring |
| State exposure | Facades (simple) + `ai.services` (advanced) | Two levels of abstraction for different user sophistication |
| Event system | Keep EventBus internally, expose via facade | EventBus is complex; facade provides clean subscribe/replay API |
| Build system | Keep pnpm + Turbo + TSC | Already working, industry standard for TS monorepos |
| Versioning | Changesets | Automated changelogs, coordinated version bumps across packages |
| Documentation | TypeDoc + hand-written guides | Auto-generated API ref + human-written tutorials |
| Testing support | InMemoryStorage + MockHarness in `sdk/testing` | SDK users shouldn't need SQLite for unit tests |
| CLI scaffolding | `create-generatorai` (Phase 2) | Matches `create-next-app`, `create mastra` industry pattern |

---

## Appendix A: Full Export Map (After Refactoring)

### From `@generatorai/sdk`

```typescript
// === Main Entry ===
export { createGeneratorAI } from './GeneratorAI.js';
export type { GeneratorAIConfig } from './config.js';
export { GeneratorAI } from './GeneratorAI.js';

// === Builders ===
export { WorkflowBuilder, StageBuilder } from '@generatorai/shared';

// === Tool Definition ===
export { tool } from './tool.js';
export type { Tool, ToolConfig } from './tool.js';

// === Types (selective) ===
export type {
  WorkflowDefinition, StageDefinition, StageEdge,
  WorkflowRun, StageRun,
  Chat, ChatMessage,
  Automation, AutomationExecution,
  AgentEvent, AgentEventKind, PersistedEvent,
  HookDefinition, HookConfig,
  Session,
} from '@generatorai/shared';

// === Errors ===
export {
  GeneratorAIError,
  ValidationError,
  HarnessConnectionError,
  WorkflowExecutionError,
  // ... all error subclasses
} from '@generatorai/shared';

// === State Machines (advanced) ===
export {
  WorkflowRunStateMachine,
  StageRunStateMachine,
  SessionStateMachine,
} from '@generatorai/core';

// === Port Interfaces (for custom implementations) ===
export type {
  IAgentHarness,
  ISessionRepository,
  IWorkflowRunRepository,
  // ... all ports
} from '@generatorai/core';
```

### From `@generatorai/sdk/testing`

```typescript
export { createInMemoryStorage } from './InMemoryStorage.js';
export { MockHarness, createMockHarness } from './MockHarness.js';
export { createTestGeneratorAI } from './helpers.js'; // Pre-configured for testing
```

### From `@generatorai/react`

```typescript
export { useWorkflow } from './useWorkflow.js';
export { useChat } from './useChat.js';
export { useEvents } from './useEvents.js';
export { GeneratorAIProvider } from './GeneratorAIProvider.js'; // React context
```

---

## Appendix B: Comparison — Current vs. SDK

### Current (80+ lines to get started)

```typescript
import { createCoreServices } from '@generatorai/core';
import { createDB, migrateDB } from '@generatorai/db';
import { DrizzleSessionRepository, DrizzleEventRepository, /* ... 23 more */ } from '@generatorai/db';
import { SandboxedScriptRunner, FetchHttpClient, GitManager } from '@generatorai/core';
import { createHarnessProvider, HarnessProxy } from '@generatorai/agent-harness-providers';
import { createLogger } from '@generatorai/shared';

const logger = createLogger({ level: 'info', service: 'my-app' });
const db = createDB('./app.db');
migrateDB(db);
const harness = new HarnessProxy(await createHarnessProvider({ type: 'copilot' }), 'copilot');
const scriptRunner = new SandboxedScriptRunner(logger);
const httpClient = new FetchHttpClient();
const gitManager = new GitManager(scriptRunner, logger, { workspacesDir: './workspaces' });
const sessionRepo = new DrizzleSessionRepository(db);
const eventRepo = new DrizzleEventRepository(db);
// ... 23 more repository instantiations
const core = createCoreServices({ /* 30+ properties */ });
const { workflowRunService } = core;
// NOW you can use it...
```

### After (5 lines to get started)

```typescript
import { createGeneratorAI, WorkflowBuilder } from '@generatorai/sdk';

const ai = await createGeneratorAI({ provider: 'copilot', database: './app.db' });
const run = await ai.workflows.run(definitionId, { variables: { code: myCode } });
for await (const event of ai.workflows.stream(run.id)) { /* ... */ }
```

---

*End of SDK Design Plan*
