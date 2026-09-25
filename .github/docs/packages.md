# Packages

> Every workspace package, what it owns, what it exports, and how to extend it.

Workspaces declared in [pnpm-workspace.yaml](../../pnpm-workspace.yaml):

```
packages/
  shared/                    @generatorai/shared
  core/                      @generatorai/core
  db/                        @generatorai/db
  agent-harness-providers/   @generatorai/agent-harness-providers
  sdk/                       @generatorai/sdk
  mcp-server/                @generatorai/mcp-server
```

---

## `shared`

**Path:** [packages/shared/](../../packages/shared/)

The lowest-level package. Anything anyone depends on. Contains:

- **`config/`** — Zod schemas + the resolved `AppConfig` type
  - `AppConfig.ts` (server-side resolved config + env mapping)
  - `WorkflowDefinitionSchemas.ts` (Create/Update/Import schemas for workflows + stages + edges)
  - `ChatSchemas.ts` (CreateChatSchema, SendPromptSchema)
  - `AutomationSchemas.ts` (Create/UpdateAutomationSchema + trigger/input-mode discriminators)
  - `WorkflowScriptSchema.ts` (validates `.workflow.mjs` outputs)
  - `WorkflowTemplate.ts` (template JSON shape + default models)
- **`types/`** — Pure TypeScript domain types
  - `AgentEvent.ts` (discriminated union of ~60 event kinds + factory `createAgentEvent`)
  - `Session.ts`, `Chat.ts`, `ChatMessage.ts`, `Workflow.ts`, `WorkflowDefinition.ts`, `WorkflowRun.ts`, `StageDefinition.ts`, `Automation.ts`, `Project.ts`, `Workspace.ts`, `Artifact.ts`, `Webhook.ts`, `RunProfile.ts`, `HookDefinition.ts`, `IPlatformClient.ts`, `ILogger.ts`, `CreateSessionParams.ts`
  - `*StateMachine.ts` (state enums + valid-transition tables for Session / WorkflowRun / StageRun / Workflow)
- **`builders/`** — Fluent builders re-exported through `@generatorai/sdk`
  - `WorkflowBuilder` — `id().name().description().stage().edge().variable().hook().harnessConfig().profile()`
  - `StageBuilder` — `name().prompts().condition().contextFilter().hooks().retryPolicy().resultValidation().outputFormat()`
- **`errors/`** — `GeneratorAIError` hierarchy (15+ types, see [architecture.md §8](./architecture.md#8-error-handling))
- **`logging/`** — `Logger` interface + pino factory
- **`telemetry/`** — OTel meter/tracer factories, span helpers (`withSpan`)
- **`utils/`** — `batchDataParser` (CSV / JSON array / JSONL → row array for automations)
- **`constants/`** — Defaults (`DEFAULT_MODEL`, `DEFAULT_SESSION_MODE`, etc.)

**Public exports:** Every directory exposes a barrel `index.ts`; the top-level `src/index.ts` re-exports everything. SDK consumers should import from `@generatorai/sdk` instead.

**Extension pattern:** Add a new type → put it in `shared/src/types/X.ts`, export from `types/index.ts`, then write a matching Zod schema in `shared/src/config/`. If it ends up in a DB JSON column, add a runtime validator under `packages/db/src/utils/jsonColumnSchemas.ts`.

---

## `core`

**Path:** [packages/core/](../../packages/core/)

The brain. Split into four sub-trees:

### `domain/` — pure TS, zero deps

```
domain/
├── ports/                       30+ interfaces (IAgentHarness, I*Repository, ISandboxProvider, IScriptRunner, IHttpClient,
│                                                  IBrowserBridge, ITerminalHost, …)
├── state-machines/              WorkflowRunStateMachine, StageRunStateMachine
├── dag/                         DAGValidator (Kahn), ConditionEvaluator (safe expression eval), types
└── events/                      AgentEvent factories
```

Key files:

- [domain/ports/IAgentHarness.ts](../../packages/core/src/domain/ports/IAgentHarness.ts) — the central port. 14 methods + `CreateConversationParams` config object (model, systemMessage, tools, skills, customAgents, mcpServers, BYOK provider, permission handler, hook bridge, …).
- [domain/ports/IHookBridge.ts](../../packages/core/src/domain/ports/IHookBridge.ts) — synchronous intercepts (`onPreToolUse`, `onPostToolUse`, `onUserPromptSubmitted`, `onSessionStart`) used by HKS-01.
- [domain/ports/IBrowserBridge.ts](../../packages/core/src/domain/ports/IBrowserBridge.ts) — Chromium abstraction: start / navigate / click / type / screenshot / captureRegion / screencast / inspector / dialog handling. Two adapters (`ServerPlaywrightHost`, `ElectronBridgeAdapter`).
- [domain/ports/ITerminalHost.ts](../../packages/core/src/domain/ports/ITerminalHost.ts) — PTY abstraction: `spawn(opts) → ITerminalHandle` with `write / resize / signal / kill / pause / resume / onData / onExit`. Three adapters (`NodePtyHost`, `SandboxPtyHost`, `FallbackChildProcessHost`).
- [domain/dag/DAGValidator.ts](../../packages/core/src/domain/dag/DAGValidator.ts) — `validateDAG()`, `topologicalSort()`, `buildDAG()`, `getExecutionLayers()`.
- [domain/dag/ConditionEvaluator.ts](../../packages/core/src/domain/dag/ConditionEvaluator.ts) — safe boolean expression evaluator (tokenize → shunting-yard → RPN). Supports `==`, `!=`, `<`, `>`, `<=`, `>=`, `&&` / `AND`, `||` / `OR`, `!` / `NOT`, quoted strings, and dotted variable references (`variables.foo.bar`).

### `services/` — application layer

Thirty-plus services. Most relevant:

| Service | Responsibility |
|---|---|
| `ChatManagementService` | v2 chat CRUD + send-prompt + workspace creation |
| `WorkflowDefinitionService` | CRUD on workflow definitions + stages + edges; validation |
| `WorkflowRunService` | Run lifecycle, DAG orchestration loop, retries, validation feedback |
| `StageExecutionService` | Per-stage execution (prompt interpolation, harness call, artifact extraction, predecessor context injection) |
| `DAGScheduler` | Build DAG, get root stages, evaluate edge conditions on completion, hash-based cache |
| `SessionAllocator` | Allocate sessions per mode (single / per-stage / auto), persist allocation map (1.6) |
| `ConfigResolver` | Deep-merge 3-level config |
| `HookExecutor` | Run hooks in priority order with timeout/retry/failure-policy |
| `HookInterceptor` | Map harness events → hook phases |
| `ResultValidator` | Apply `resultValidation` rules to assistant output |
| `HitlService` | Permission mode CRUD + pending interrupts + approve/reject |
| `ArtifactService` | Session-scoped artifact persistence |
| `SystemArtifactService` | Load system agents/prompts/skills on boot |
| `TemplateRegistry` | Load + serve workflow templates from `templates/system/` |
| `AutomationService` | Automation CRUD + cron scheduler + webhook trigger + execution fan-out |
| `ProjectService`, `CodebaseService`, `ProjectConfigService` | Project + codebase + config CRUD |
| `WorktreeService`, `WorktreeCleanupService` | Per-run worktree lifecycle + retention sweeper |
| `WorkspaceManager`, `PathResolver` | Execution workspaces (chat / run / automation) + path boundary enforcement |
| `BrowserService` | Workspace-scoped Chromium sessions (see [feature-integrated-browser.md](./feature-integrated-browser.md)). Owns `Map<workspaceId, SessionRecord>` behind the `IBrowserBridge` port; VSCode-parity share/attach flags; per-workspace FIFO emit queue (INV-2). |
| `TerminalService` | Workspace-scoped PTY sessions (see [feature-integrated-terminal.md](./feature-integrated-terminal.md)). Ephemeral `Map<sid, TerminalRecord>` + 4 MiB scrollback ring + idle reaper; hooks into `WorkspaceManager.registerBeforeDelete` for cleanup. |
| `ExtensionManager` | Hot-load / install / reload / uninstall for system + user + workspace extensions. Runs `loadExtension(ai)` and commits staged contributions atomically into `WidgetRegistry`, `customToolRegistry`, and `SystemArtifactService`. See [feature-extensions-widgets.md](./feature-extensions-widgets.md). |
| `WidgetService`, `WidgetRegistry` | Lifecycle for `WidgetInstance` rows (`widget_instances` table, migration v14; surface constraint tightened in v16) + in-memory descriptor catalog (incl. action catalog). Emit `harness.widget.render` / `.state` / `.action` / `.invoke` / `.closed` on the bus so the SPA Widget tab + inline widgets stay in sync. Drives agent actions via the `widget:invoke` → `widget:invoke-result` round-trip. |
| `WorkflowScriptLoader` | Scan `templates/scripts/*.workflow.mjs`, dynamic-import, validate |
| `WorkflowOrchestrator` | Higher-level system-template flows + preprocessing |
| `WorkflowPreprocessor` | Variable resolution + workspace setup before run start |
| `StartupRecoveryService` | Recover in-flight runs on server restart |
| `DurableSleepService` | Wake stage runs from `sleeping` state when `wake_at` reached |
| `StreamBroker` | Persistent SSE broker (see [feature-streaming-events.md](./feature-streaming-events.md)) |
| `SandboxLifecycleManager` | Cleanup Docker sandbox containers on shutdown |
| `ErrorHandler` | Normalize errors into wire format |

### `infrastructure/` — concrete adapters that implement domain ports

- `GitManager` — `clone`, `bareClone`, `cloneToDirectory`, `createWorktree`, `removeWorktree`, `pull`, `fetch`, `checkout`, `commit`, `push`, `createPullRequest`, `getBranches`.
- `SandboxedScriptRunner` / `SandboxScriptRunner` — wrap `IScriptRunner` with Docker. `HostProcessSandboxProvider` (host fallback) + `DockerSandboxProvider`.
- `FetchHttpClient` — `IHttpClient` adapter built on `fetch` with retry/backoff and signature.
- `browser/` — implementations of `IBrowserBridge` for the Integrated Browser:
  - `ServerPlaywrightHost` — Playwright-launched Chromium inside the server process (headless by default; head-full when `visibility: 'visible'`). MJPEG stream over WS.
  - `ElectronBridgeAdapter` — attaches over CDP to Electron's own Chromium (a `WebContentsView` in the desktop main process). Chosen when `GENERATORAI_DESKTOP_NATIVE_BROWSER=1`.
  - `InspectorScript` — the injected page script that posts DOM selections back to `POST /browser/selection`.
- `terminal/` — implementations of `ITerminalHost` for the Integrated Terminal:
  - `NodePtyHost` — real PTY via `node-pty` (`optionalDependency` on core so `pnpm` resolves the prebuild). Windows shell cascade (`pwsh 7` → `powershell` → `cmd`), env sanitisation, POSIX prompt injection.
  - `SandboxPtyHost` *(Phase 2, opt-in)* — wraps `docker exec -it <sandboxName>` in an outer host-side `node-pty`.
  - `FallbackChildProcessHost` — `child_process.spawn` fallback when `node-pty` fails to load. Renders a yellow banner in the SPA.

### `mcp/` — MCP hub abstraction (not yet a full server)

`IMcpHub` port — exposes MCP server registration & tool discovery to services that need to know about MCP-routed tools. Concrete implementation: lives inside `agent-harness-providers/` per-adapter (Claude Agent uses an in-process SDK MCP server; Copilot uses its native MCP integration).

### `permissions/`

Currently a thin module containing the SDK permission kind → domain permission type map (ORC-06) — see `packages/agent-harness-providers/src/providers/copilot/permissionMap.ts`.

### `bootstrap/`

- `createCoreServices()` — single factory that returns the `CoreServices` bundle wired together. Called by both `apps/server` and `packages/sdk`.

### Important: how core consumes the harness

```typescript
// StageExecutionService.ts — never imports any SDK type
constructor(
  private stageRunRepo: IStageRunRepository,
  private harness: IAgentHarness,            // ← port only
  private eventBus: EventBus,
  private sessionAllocator: SessionAllocator,
  private hookExecutor: HookExecutor,
  …
) {}

await this.harness.createConversation({ conversationId, model, tools, systemMessage, … });
await this.harness.sendPrompt(conversationId, interpolatedPrompt);
this.harness.onConversationEvent(conversationId, (event: AgentEvent) => {
  this.eventBus.emit(conversationId, event);
});
```

---

## `db`

**Path:** [packages/db/](../../packages/db/)

Drizzle ORM + better-sqlite3. Schema in [`src/schema.ts`](../../packages/db/src/schema.ts), 25 repositories in `src/repositories/`.

### Tables (current schema, version 8)

```
sessions                v1 + v2 conversation lifecycle metadata
workflows               v1 legacy (deprecated; kept for compat)
events                  v1 per-session AgentEvent log
event_sequences         atomic sequence counter (one per session)
chat_messages           chat message history (v1+v2)
artifacts               session-scoped file artifacts
webhook_registrations   incoming webhook triggers
webhook_deliveries      delivery audit log (unique idx for dedup)
chats                   v2 top-level chat entities (codebaseIds, gitRepositories, projectId, workspaceId, useWorktree)
workflow_definitions    v2 DAG templates (sessionMode, harnessConfig, variables, hooks, orchestratorConfig, scope, projectId, useWorktree)
stage_definitions       v2 stage nodes (prompts, condition, retryPolicy, contextFilter, agentName, resultValidation, hooks, harnessConfigOverrides, outputFormat, outputSchema, contextSources)
stage_edges             v2 DAG edges
workflow_runs           v2 run instances (status, sessionMode, masterSessionId, variables, permissionMode, projectId, workspaceId)
stage_runs              v2 stage executions (status, retryCount, version (optimistic lock), wakeAt + sleptSince (DUR-05), interruptData (HITL-02), summary)
session_allocations     SessionAllocator state (1.6) — workflowRunId → mode + sharedSessionId
stage_session_maps      Stage → SDK session mapping
projects, project_codebases, project_configs, worktrees, system_configs   Project + codebase management (Phase 6/7)
execution_workspaces    Workspaces (owner: chat | workflow_run | automation_execution) (Phase 8)
workspace_worktrees     Worktrees inside a workspace
workspace_artifacts     Per-workspace generated files (code_file | response_md | attachment | script_output | log | snapshot)
automations             Trigger config + cron lease lock (1.23 — lockedUntil + lockedByProcess)
automation_executions   Single run of an automation
automation_execution_runs   Individual iteration within an execution
stream_cursors          STR-02 unified SSE event log (scope+scope_id+seq+kind+payload+ts)
stream_sequences        per-(scope, scope_id) atomic sequence counter
stream_cursors_replay   (legacy alias used in tests)
system_configs          system-level skills/prompts/agents registry
```

### Migration ledger (`_schema_versions` table)

| Version | Migration |
|---|---|
| 1 | `phase1_schema_and_indexes` — missing indexes + webhook delivery unique constraint |
| 2 | `phase1_session_allocations` — SessionAllocator persistence |
| 3 | `phase1_cron_lease` — automation cron lock indexes |
| 4 | `phase4_stream_cursors` — unified stream broker tables |
| 5 | `dur05_stage_run_wake_at_index` — index for `wake_at` (durable sleep) |
| 6 | `project_codebase_management` — projects, codebases, configs, worktrees |
| 7 | `system_configs_and_project_scoping` — system configs + project scoping indexes |
| 8 | `workspace_management` — execution_workspaces + workspace_worktrees + workspace_artifacts |

### Repositories (25)

Drizzle implementations of the domain port interfaces. Each is paired with a port in [`packages/core/src/domain/ports/`](../../packages/core/src/domain/ports/) so application services never import Drizzle directly.

Notable patterns:

- **Atomic sequence allocation** — `SequenceAllocator` uses `INSERT … ON CONFLICT DO UPDATE … RETURNING last_seq` so two processes can never collide.
- **Optimistic locking** — `stage_runs.version` column; `update` is `WHERE version = ?`; on conflict raises `ConcurrentModificationError`.
- **Row-level lease lock for cron** — `automations.locked_until` + `locked_by_process` so multiple worker processes can elect a leader for each cron tick.
- **Transactional wrappers** — `withTransaction(db, async (tx) => { … }, { deadlineMs: 10_000 })` enforces a deadline to prevent runaway lock holds.

### Background services

- `EventRetentionService` — periodic sweeper; deletes rows older than `eventPayloadTtlDays` from `events` and `stream_cursors`. Capped per sweep so the write lock doesn't get monopolized. Supports custom sweepers via `registerSweeper()` for future blob cleanup (EVT-04).

---

## `agent-harness-providers`

**Path:** [packages/agent-harness-providers/](../../packages/agent-harness-providers/)

The only place that imports vendor SDK packages. Layout:

```
src/
├── HarnessFactory.ts          createHarnessProvider({ type, copilot?, claudeAgent? })
├── HarnessProxy.ts            Wrapper enabling runtime switchAdapter()
├── types.ts                   HarnessProviderConfig + HarnessFactoryOptions
├── index.ts                   Exports
└── providers/
    ├── copilot/
    │   ├── CopilotProvider.ts
    │   ├── event-mapper.ts    SDK SessionEvent → AgentEvent (40+ kinds)
    │   ├── tool-factory.ts    Domain ToolDefinition → SDK defineTool()
    │   ├── permissionMap.ts   SDK permission kind → domain (ORC-06, exhaustive)
    │   └── index.ts
    └── claude-agent/
        ├── ClaudeAgentProvider.ts
        ├── event-mapper.ts    SDK SDKMessage → AgentEvent[] (multi-block)
        ├── tool-factory.ts    Domain ToolDefinition → in-process MCP server
        └── index.ts
```

### Provider comparison

| | `CopilotProvider` | `ClaudeAgentProvider` |
|---|---|---|
| **SDK** | `@github/copilot-sdk@^1.0.8` (bundles `@github/copilot@1.0.75` CLI) | `@anthropic-ai/claude-agent-sdk@^0.3.220` |
| **Session model** | Long-lived `CopilotSession` per conversation | Stateless per-query subprocess |
| **Connection** | `RuntimeConnection.forStdio({ path })` or `.forUri(url)` (sandbox) | Spawned `claude` Code CLI subprocess per query |
| **Streaming** | SDK event listener (`session.on('event', …)`) | Async iterator over `claudeQuery(opts)` |
| **Tools** | Native via `defineTool()` | In-process MCP server, names become `mcp__generatorai-tools__<name>` |
| **MCP servers** | Native field `sessionConfig.mcpServers` | Merged with our generatorai-tools MCP server config |
| **Skills / disabledSkills** | Native fields | Mapped to `agents` config |
| **Custom agents** | Native field (Copilot calls them "skills") | SDK `agents` map |
| **System prompt** | `systemMessage: { mode: 'append'|'replace', content }` | Either raw string OR `{ type: 'preset', preset: 'claude_code', append: '…' }` |
| **resumeConversation** | Real — SDK can recover persistent sessions | No-op (synthetic in-memory history) |
| **getModels()** | SDK call → returns 12+ models (Claude/GPT/Gemini families) | Returns hardcoded list (claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-7, …) |
| **OTel** | Rich (`copilot.*` metrics) | Rich (`claude_agent.*` metrics) |
| **Listener leak detection (ORC-05)** | Yes — `conversationListenerCleanups` map, warns at >50 listeners | Same mechanism |
| **autoRestart** | Tracked manually (SDK 1.0 removed the option) | n/a (stateless) |
| **BYOK** | Via `params.provider = { baseUrl, apiKey }` | Reserved; not yet wired |
| **Permission handler** | `onPermissionRequest` plumbed into SDK; falls back to `approveAll` | Reserved |

### Adding a new provider

1. Create `packages/agent-harness-providers/src/providers/<name>/`:
   - `<Name>Provider.ts` implementing `IAgentHarness`
   - `event-mapper.ts` — SDK events → `AgentEvent`
   - `tool-factory.ts` — domain `ToolDefinition[]` → vendor tool shape
   - `index.ts` re-exporting the provider class
2. Extend `HarnessType` in [packages/core/src/domain/ports/IAgentHarness.ts](../../packages/core/src/domain/ports/IAgentHarness.ts).
3. Extend `HarnessProviderConfig` in [packages/agent-harness-providers/src/types.ts](../../packages/agent-harness-providers/src/types.ts).
4. Add a case + lazy loader in `HarnessFactory.ts`. The `never`-typed default forces tsc to fail until you wire it.
5. Wire in [apps/server/src/composition-root.ts](../../apps/server/src/composition-root.ts) under the new `harnessType === '<name>'` branch.
6. Add settings to `apps/web/src/pages/Settings.tsx` Provider tab.

### Gotchas

- `availableTools: ['*']` means "no restriction" — adapters must check for `*` and **omit** the field, not pass `'*'` literally to the SDK.
- `Copilot SDK 1.0` renamed `cwd` → `workingDirectory`, `githubToken` → `gitHubToken`. Removed `autoStart`, `autoRestart`, `useStdio`, `cliPath`, `cliUrl`. We bypass the broken pnpm bundled-binary resolver by passing `connection: RuntimeConnection.forStdio({ path: require.resolve('@github/copilot-<platform>-<arch>') })`.
- `Copilot GHEC tenants` — the CLI resolves the tenant from its own stored credentials (Windows Credential Manager: `copilot-cli/<host>:<user>`), so a plain `copilot` → `/login` is usually all that is needed and `COPILOT_GH_HOST` can stay unset. Set `COPILOT_GH_HOST=https://<tenant>.ghe.com/` only if the CLI picks the wrong host; when you do, *also* scrub `COPILOT_GITHUB_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN` from the spawned environment, because an ambient github.com token takes precedence over the stored tenant credential and yields 401/403.
- **Changing a Copilot session's model requires `session.setModel()`, not resume.** `client.resumeSession(id, { model })` rehydrates from the SDK's persistent store, which carries the model the session was *created* with — the `model` on `ResumeSessionConfig` does **not** override it. Passing it and hoping silently keeps every later turn on the original model. `CopilotProvider.resumeConversation` therefore calls `session.setModel(model, { reasoningEffort, contextTier })` both for an in-place switch (live handle) and immediately after a resume (post-restart). `setModel` preserves conversation history and takes effect on the next message.
- `claude-agent` reads auth from `~/.claude/.credentials.json` set up by the user's local `claude` Code CLI login. We don't pass any keys.
- Stage `harnessConfigOverrides.model` is provider-specific. Switching providers without scrubbing overrides will fail (see `gpt-5.4-mini` under `claude-agent` returning "issue with the selected model").
- **`@anthropic-ai/claude-agent-sdk` declares `zod@^4` as a peer** but the monorepo pins `zod@3`. This is a *documented, verified-safe* mismatch: the SDK **bundles its own zod v4** inside `sdk.mjs` (the only external imports are Node built-ins), and `createSdkMcpServer` accepts a zod-v3 raw shape via the `AnyZodRawShape = ZodRawShape | ZodRawShape_2` union in `sdk.d.ts`. `jsonSchemaToZodShape()` therefore keeps emitting zod v3 shapes. Do **not** "fix" the pnpm peer warning by force-upgrading the workspace to zod v4 — that would break every other package.
- **Claude SDK `canUseTool` is shadowed by bare `allowedTools` entries** (v0.3.186+ emits `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warnings at runtime). Bare tool names in `allowedTools` auto-approve before the callback runs. To gate *every* call, either use a `PreToolUse` hook or remove the bare names so they fall through to `canUseTool`.
- **`TodoWrite` is deprecated** in the Claude SDK in favour of `TaskCreate` / `TaskUpdate` / `TaskGet` / `TaskList`. We never referenced it explicitly, so nothing to migrate — but do not add it to new tool specs.
- **MCP servers now connect in the background** (Claude SDK ≥ 0.3.142). Sessions start immediately and slow servers report `status: 'pending'` in `init`, so an MCP tool may be unavailable on turn 1. Set `MCP_CONNECTION_NONBLOCKING=0` to restore blocking startup.

---

## `sdk`

**Path:** [packages/sdk/](../../packages/sdk/)

External-facing programmatic API. Wraps `core` + `db` + `agent-harness-providers` behind a thin façade pattern. **The only package external integrators should depend on.**

### Entry point

```typescript
import { createGeneratorAI, tool, type GeneratorAIConfig } from '@generatorai/sdk';

const ai = await createGeneratorAI({
  provider: 'copilot',                       // or 'claude-agent' or pre-built IAgentHarness
  providerOptions: { /* CopilotProviderOptions | ClaudeAgentProviderOptions */ },
  database: './generatorai.db',
  artifactsDir: './artifacts',
  scriptsDir: './workflows',
  maxConcurrentSessions: 10,
  logger: { level: 'info', pretty: false },   // or false to silence
  sandbox: { enabled: false, preferDocker: true },
  webhooks: { enabled: false, githubSecret, webhookToken },
});
```

### Facades (all on `ai.<facade>`)

| Facade | Methods |
|---|---|
| `ai.workflows` | `create({ id, name, description, stages, edges, variables, hooks })`, `list()`, `get(id)`, `run(id, { variables, projectId })`, `stream(runId, { fromSequence })`, `pause/resume/cancel(runId)`, `retry(runId)` |
| `ai.chat` | `create({ name, description?, model?, projectId?, tags? })`, `send(chatId, message)`, `onMessage(chatId, handler)`, `list(status?, projectId?)`, `get(chatId)`, `archive(chatId)` |
| `ai.automations` | `create(params)`, `list(projectId?)`, `get(id)`, `trigger(id)`, `update(id, params)`, `delete(id)`, `enable/disable(id)`, `getExecution(execId)` |
| `ai.events` | `onAll(handler)`, `onRun(runId, handler)`, `onSession(sessionId, handler)`, `replay(sessionId, afterSeq?)`, `emit(sessionId, event)` |
| `ai.scripts` | `list()`, `get(scriptId)`, `validate(filePath)`, `reload()`, `reloadScript(scriptId)`, `setScriptLoader(loader)` |
| `ai.tools` | `tool({ name, description, inputSchema: ZodType, execute })`, `register(toolDef)`, `unregister(name)`, `list()`, `has(name)`, `setRegistry(registry)` |

`ai.services` exposes the entire `CoreServices` bundle for power users (see [packages.md → core](#core)).

`ai.shutdown()` flushes events, closes the harness, closes the DB.

### Testing helpers

```typescript
import { createTestGeneratorAI, MockHarness } from '@generatorai/sdk/testing';

const ai = await createTestGeneratorAI();   // creates temp DB + artifacts + scripts dirs, logger silenced
```

`MockHarness` returns `[{ id: 'mock-model', name: 'Mock', provider: 'mock' }]` for `getModels()` and never actually sends prompts — useful for unit tests of services.

### Builder pattern

```typescript
import { workflow, type CreateWorkflowInput } from '@generatorai/sdk';

const wf: CreateWorkflowInput = workflow(b => b
  .id('hello-world')
  .name('Hello World')
  .variable({ name: 'topic', type: 'string', defaultValue: 'AI' })
  .stage('analyze', s => s
    .name('Analyze')
    .prompts([{ label: 'main', text: 'Tell me about {{topic}}', source: 'inline' }])
    .outputFormat('text')
    .contextFilter('full')
    .retryPolicy({ maxRetries: 2, backoffMs: 1000, backoffMultiplier: 2 })
  )
  .stage('summarize', s => s.prompts([{ text: 'Summarize the above in 3 bullets.' }]))
  .edge('analyze', 'summarize', 'on_success')
);

await ai.workflows.create(wf);
```

See [usage-sdk.md](./usage-sdk.md) for full integration recipes.

---

## `mcp-server`

**Path:** [packages/mcp-server/](../../packages/mcp-server/)

Currently a single `toolAdapter` module that exposes domain `ToolDefinition[]` to MCP-protocol consumers. Used internally by `ClaudeAgentProvider` to build the in-process generatorai-tools MCP server.

**Not yet shipped as a standalone binary.** System MCP server definitions for stages live in [templates/system/mcp-servers.json](../../templates/system/mcp-servers.json) (8 defaults: GitHub, Filesystem, PostgreSQL, SQLite, Slack, Brave Search, Puppeteer, AWS Knowledge Base).

Future: standalone `mcp-server` binary that mounts GeneratorAI tools over MCP for external MCP clients.

---

## Build & test

Each package has the same scripts:

| Script | What |
|---|---|
| `pnpm --filter <pkg> build` | `tsc -b` |
| `pnpm --filter <pkg> typecheck` | `tsc --noEmit` |
| `pnpm --filter <pkg> test` | `vitest run` |
| `pnpm --filter <pkg> lint` | `eslint src/` |
| `pnpm --filter @generatorai/db db:generate` | Drizzle Kit migration generation |
| `pnpm db:check` | Validate schema vs migrations |

Turborepo (`turbo.json`) orchestrates parallel builds. Cache hits are essential for monorepo build times.
