# Architecture

> Read this after [AGENTS.md](../AGENTS.md). This file is the deep-dive on the layered architecture, dependency rules, persistence model, and runtime topology.

---

## 1. Layered architecture

GeneratorAI follows **Hexagonal / Ports-and-Adapters with a DDD core**. Four strict layers:

```
┌─────────────────────────────────────────────────────────────┐
│ PRESENTATION                                                │
│   apps/web   apps/cli   apps/server/src/routes              │
│       │                                                     │
│       ▼ HTTP / SSE / IPC                                    │
├─────────────────────────────────────────────────────────────┤
│ APPLICATION                                                 │
│   packages/core/src/services                                │
│     ChatManagementService,                                  │
│     WorkflowDefinitionService, WorkflowRunService,          │
│     StageExecutionService, DAGScheduler,                    │
│     SessionAllocator, HookExecutor,                         │
│     HookInterceptor, ArtifactService, AutomationService,    │
│     HitlService, ResultValidator,                           │
│     ProjectService, CodebaseService, ProjectConfigService,  │
│     WorktreeService, WorktreeCleanupService,                │
│     WorkspaceManager, PathResolver, TemplateRegistry,       │
│     StartupRecoveryService, ErrorHandler,                   │
│     SandboxLifecycleManager, StreamBroker,                  │
│     SystemArtifactService, WorkflowScriptLoader,            │
│     WorkflowPreprocessor,                                   │
│     WorkflowOrchestrator,                                   │
│     BrowserService, TerminalService,                        │
│     ExtensionManager, WidgetService, WidgetRegistry         │
│       │                                                     │
│       ▼ depends on ports                                    │
├─────────────────────────────────────────────────────────────┤
│ DOMAIN                  (pure TypeScript, zero deps)        │
│   packages/core/src/domain                                  │
│     ports/   — IAgentHarness, IXxxRepository, …             │
│     state-machines/  — Session, WorkflowRun, StageRun       │
│     dag/    — DAGValidator, ConditionEvaluator, types       │
│     events  — AgentEvent factories                          │
│       │                                                     │
│       ▼ implemented by                                      │
├─────────────────────────────────────────────────────────────┤
│ INFRASTRUCTURE                                              │
│   packages/db                — Drizzle repos + SQLite       │
│   packages/agent-harness-providers — Copilot/ClaudeAgent    │
│   packages/core/src/infrastructure — Git, Sandbox, Fetch,   │
│                                       Browser (Playwright + │
│                                       Electron bridges),    │
│                                       Terminal (node-pty,   │
│                                       sandbox, fallback)    │
│   packages/mcp-server        — MCP tool adapter             │
└─────────────────────────────────────────────────────────────┘
```

### Dependency rules (enforced via ESLint boundaries + `tsconfig` references)

| Layer | May import | May **NOT** import |
|---|---|---|
| Presentation | Application, Shared | Domain entities directly, Infrastructure concrete classes, SDK types |
| Application | Domain ports, Shared | Presentation, Infrastructure concrete classes, vendor SDKs |
| Domain | Shared types only | Anything else (zero runtime deps) |
| Infrastructure | Domain ports, Shared | Application services, Presentation |

The **Application layer never imports a vendor SDK**. Vendor types (`@github/copilot-sdk`, `@anthropic-ai/claude-agent-sdk`, `drizzle-orm`, `better-sqlite3`, `node-cron`) are confined to their adapter package.

---

## 2. Composition root

Single source of dependency wiring: [apps/server/src/composition-root.ts](../../apps/server/src/composition-root.ts).

Boot order (simplified):

```
1.  Load AppConfig (Zod-validated; env + file + defaults)
2.  Create logger + OTel meter/tracer
3.  createDB(dbPath)   → SQLite + WAL + FK ON + migrations to current version
4.  Instantiate 25 Drizzle repositories
5.  Instantiate infra adapters: GitManager, ScriptRunner (sandboxed if enabled),
    FetchHttpClient, SequenceAllocator
6.  createHarnessProvider({ type: 'copilot' | 'claude-agent', … })
    → wrap in HarnessProxy for hot-swap
7.  createCoreServices({ harness, repos, infra, … })
    → returns all application services
8.  Wire built-in function hooks into hookExecutor
9.  Build StreamBroker + EventBus bridge (auto-route to scope=session/run/chat/global)
10. Late-wire WorkspaceManager into ChatManagementService extensions
11. Mount Express routes; install OpenAPI doc generator
12. StartupRecoveryService.recoverInFlightRuns() — resume any 'running' workflow runs
13. Listen on $PORT
```

The CLI app does **not** run this factory: it is an HTTP + WebSocket client of a running server only (no `--mode=direct` / `--local` in-process mode exists). Behaviour matches the server because there is exactly one composition root — this one.

---

## 3. Persistence model (Drizzle + SQLite)

**Database location:** `~/.generatorai/data.db` by default.

**Engine:** `better-sqlite3` synchronous bindings, WAL mode, foreign keys ON, busy timeout 5s.

Migrations are append-only with an internal `_schema_versions` ledger. Adding new tables/columns goes through one of:

- `migrateDB()` idempotent `CREATE TABLE IF NOT EXISTS` block (preferred for new tables);
- `safeAddColumn()` helper (for new columns on existing tables — swallows "already exists");
- A new versioned migration in `packages/db/src/migrations/` recorded in `_schema_versions`.

JSON columns use a *symmetric* validation pattern:
- **Read** — `safeJsonColumn(value, schema, fallback)` returns `fallback` on validation failure and logs (lenient).
- **Write** — `validateJsonColumn(value, schema)` throws `JsonColumnValidationError` (strict).

Shared Zod helpers in [packages/db/src/utils/jsonColumnSchemas.ts](../../packages/db/src/utils/jsonColumnSchemas.ts): `jsonRecord`, `jsonArray`, `stringArray`, `jsonUnknown`, `objectArray`.

Background pruning: `EventRetentionService` periodically deletes rows older than `eventPayloadTtlDays` from `events` + `stream_cursors`. Capped per sweep so the write lock is not monopolized.

For the full table inventory and per-table indexes, see [packages.md → db](./packages.md#db).

---

## 4. Runtime topology

### 4.1 In-process services

Inside a single Node process you have:

```
HTTP/SSE listener (Express)
   │
   ├── /api/stream          → SSE handler → StreamBroker.subscribe()
   ├── /api/chats/*         → ChatManagementService
   ├── /api/workflow-*      → Workflow{Definition,Run}Service
   ├── /api/automations/*   → AutomationService
   ├── /api/projects/*      → ProjectService + Codebase/Config services
   ├── /api/workspaces/*    → WorkspaceManager
   ├── /api/hooks/*         → HookExecutor introspection
   ├── /api/copilot/*       → harness.getModels(), .ping(), .listConversations()
   └── /api/health          → server + db + harness ping

Background timers (unref'd):
   ├── DAGScheduler         → per-run polling loop (3s) for stage completion detection
   ├── WorktreeCleanupService → retention sweep (default hourly)
   ├── EventRetentionService → DB pruning sweep
   └── AutomationService    → cron evaluator + lease lock (1.23) for scheduled triggers

Per-run loggers:
   └── RunLogger            → per-runId JSONL stream attached to EventBus
```

### 4.2 Harness sub-process

Per harness type, one external CLI is spawned and kept alive:

- **`copilot`** — spawns the GitHub Copilot CLI via `RuntimeConnection.forStdio({ path })`. Single client process; N persistent sessions multiplexed over its stdio channel. Supports `autoRestart` (deprecated in SDK 1.0; we now track state manually).
- **`claude-agent`** — *stateless per-query*. Each `sendPrompt()` invokes `claudeQuery({ messages, options })` which spawns a fresh `claude` Code CLI subprocess. The provider keeps `Map<conversationId, StoredConversationConfig>` + `Map<conversationId, ConversationMessage[]>` for synthetic history.

Provider feature comparison: see [packages.md → agent-harness-providers](./packages.md#agent-harness-providers).

### 4.3 Sandbox sub-processes (optional)

If `SANDBOX_ENABLED=true`, `script` hooks and external custom-script commands run inside a Docker container built from [docker/sandbox-template/](../../docker/sandbox-template/). Falls back to `HostProcessSandboxProvider` if Docker isn't available.

---

## 5. Real-time eventing

```
Source of truth ──> EventBus ──> StreamBroker ──> stream_cursors table
                       │              │
                       │              └─> in-memory subscribers (SSE handlers)
                       │
                       └─> per-session promise queue (sequential)
                            so seq IDs are monotonic
```

- **EventBus** (in-process EventEmitter, per-session serialization to guarantee order).
- **StreamBroker** (commit-then-broadcast — DB insert before in-memory broadcast).
- **Unified SSE endpoint** (`GET /api/stream?scope=…&id=…&afterSeq=…`) with `Last-Event-ID` resume, REST replay fallback (`GET /api/stream/replay`), backpressure (HIGH_WATER=256 frames), heartbeat (15s), and per-(scope,id) connection cap (`acquireSseSlot`).

Every event is automatically *multi-scope routed*: a single `harness.token` emitted for `sessionId=sess-42` with `data.workflowRunId=run-99` is published to *three* scopes: `session/sess-42`, `run/run-99`, and (if it has `chatId`) `chat/<chatId>`. Each scope has its own monotonic sequence counter so clients can resume independently.

**Two dedicated WebSocket transports** live alongside the SSE endpoint on the same HTTP server (via `WebSocketServer({ noServer: true })` + path regex + `server.on('upgrade')`). They exist because binary / high-frequency payloads don't fit the SSE contract:

- `/api/workspaces/:id/browser/stream` — Chromium screencast JPEG frames + user input events (Integrated Browser).
- `/api/workspaces/:id/terminals/:sid/stream` — raw PTY bytes + input / resize / ACK / signal frames (Integrated Terminal).

Both perform auth + Origin gating **before** `wss.handleUpgrade`. Lifecycle events for these features (`browser.session_created`, `terminal.session_closed`, …) still flow through the standard SSE bus so the SPA can auto-focus tabs, replay after reconnect, etc. See [feature-streaming-events.md](./feature-streaming-events.md) for the full pipeline.

---

## 6. Configuration resolution (3-level hierarchy)

```
WorkflowDefinition.harnessConfig          (template defaults)
   ↓ deep-merged with
StageDefinition.harnessConfigOverrides    (per-stage overrides)
   ↓ deep-merged with
RunProfile / Runtime variables            (per-run overrides)
   │
   ▼
Final resolved config → passed to harness.createConversation()
```

Service: [packages/core/src/services/ConfigResolver.ts](../../packages/core/src/services/ConfigResolver.ts).

Variables in prompts are interpolated with mustache-style `{{varName}}` after the resolver runs. The set of variables passed in is the union of:

- Workflow-level `variables` defaults
- Runtime/Profile `variables` (override defaults)
- Stage-local `variables` (override both)
- System variables: `__workingDirectory`, `__artifactsDirectory`, `__workflowRunId`, `__workspaceId`, `__validationFeedback`, `__validationRetryAttempt`, `__stageOverrides`, `repo_path_<alias>`, `repo_branch_<alias>`, `repo_path_target`.

---

## 7. State machines (pure DDD)

All state transitions are encoded as guard tables in pure TypeScript. They have no IO dependencies and are unit-testable in isolation.

- `WorkflowRunStateMachine` — 7 states.
- `StageRunStateMachine` — 9 states (includes `awaiting_input`, `skipped`).

The state machines fire **only on legal transitions**; illegal transitions throw `InvalidTransitionError`. All `*Repository.updateStatus()` calls go through these machines so the DB never holds an impossible state.

---

## 8. Error handling

All errors descend from `GeneratorAIError` (defined in [packages/shared/src/errors/](../../packages/shared/src/errors/)):

- `ValidationError` (HTTP 400)
- `NotFoundError` (HTTP 404)
- `ResourceLimitError` (HTTP 429)
- `InvalidTransitionError` (HTTP 409)
- `HarnessConnectionError` (HTTP 503)
- `GitError`, `ScriptExecutionError`, `WorkflowError`, `StageError`, `HookError`, `ArtifactError`, `WebhookError`, `ConfigurationError`, `TimeoutError`, `SessionError`

Routes use `ErrorHandler.normalize(err)` to map all errors to a stable wire format:

```json
{
  "code": "NOT_FOUND",
  "category": "not_found",
  "message": "Workflow definition <id> not found",
  "details": { … }
}
```

---

## 9. Observability

- **Structured logging** — pino (`@generatorai/shared/logging/Logger.ts`). JSON in prod, pretty in dev. Per-run `RunLogger` attaches to `EventBus` and writes JSONL files into the run's `artifacts/` directory.
- **OpenTelemetry** — metrics + traces. Initialized in `apps/server/src/instrumentation.ts` and `apps/cli/src/instrumentation.ts`. Default OTLP-compatible. Collector compose file: [docker/observability/](../../docker/observability/).
- **Metrics shipped:**
  - `copilot.prompts.total`, `copilot.prompt.duration_ms`, `copilot.active_sessions`
  - `claude_agent.queries.total`, `claude_agent.query.duration_ms`
  - `db.queries.total`, `db.query.duration_ms`
  - `stream.events.published`, `stream.events.dropped` (slow consumer)
  - `hook.executions.total`, `hook.executions.duration_ms`

---

## 10. Security model

- **Path traversal protection** — `PathResolver` enforces that all file paths used in artifacts/configs stay within their configured root. `ProjectConfigService.uploadConfig` validates `path.resolve(target).startsWith(configDir)`.
- **Script hook allowlist** — `script` hooks may only invoke commands on a hard-coded allowlist (`node`, `python`, `bash`, `git`, `echo`, `pwsh`, `pip`, `pnpm`, `npm`). Anything else throws `ScriptExecutionError`.
- **Webhook HMAC verification** — incoming GitHub webhooks verify the `X-Hub-Signature-256` header against the configured shared secret. Replay-attack protected via `delivery_id` unique index in `webhook_deliveries`.
- **SSE connection cap** — `acquireSseSlot(scope, id)` enforces per-(scope,id) connection caps so a single client cannot exhaust file descriptors.
- **Sandbox isolation** — when enabled, all custom scripts run inside a Docker container with no network access by default, no host filesystem mounts except the run's workspace, and a CPU/memory cap.
- **No secrets in DB** — GitHub tokens (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`) are read from env only. Webhook tokens for automations are stored hashed in the DB (`webhookToken` column).
- **HITL gating** — `permissionMode = 'plan'` requires explicit user approval for every tool call; integrates with the SDK's `onPermissionRequest` callback. See [feature-hooks.md](./feature-hooks.md#hookbridge-hks-01).

---

## 11. Versioning & breaking-change policy

- Wire format (DB JSON columns, SSE event payloads, REST request/response bodies) — backwards compatible within a major version. New fields are optional + tolerated by `safeJsonColumn`.
- DB schema — append-only. Removing a column requires a new versioned migration.
- DAG semantics — adding a new edge type (`StageEdgeType`) is breaking; you must update `DAGScheduler.onStageCompleted` + `ConditionEvaluator`.
- Adding a new `HarnessType` is non-breaking (lazy-loaded; `TypeScript` exhaustiveness check forces the factory + composition root to be updated).
