# GeneratorAI — Complete Codebase Review Plan

> **Purpose:** Phase-by-phase manual code review guide ordered from innermost (most critical) to outermost layers.
> **Generated:** April 27, 2026
> **Branch:** `dev`

---

## Table of Contents

1. [Review Philosophy &amp; Architecture](#review-philosophy--architecture)
2. [Phase 1 — Foundation Types &amp; Shared](#phase-1--foundation-packagesshared)
3. [Phase 2 — Core Domain + Application Services](#phase-2--core-domain--application-services-packagescore)
4. [Phase 3 — Persistence Layer](#phase-3--persistence-layer-packagesdb)
5. [Phase 4 — Infrastructure Adapters](#phase-4--infrastructure-adapters-copilot-bridge--anthropic-bridge)
6. [Phase 5 — Server Composition &amp; Routes](#phase-5--server-composition--routes-appsserver)
7. [Phase 6 — Web Frontend](#phase-6--web-frontend-appsweb)
8. [Phase 7 — CLI Application](#phase-7--cli-application-appscli)
9. [Phase 8 — E2E Tests &amp; CI](#phase-8--e2e-tests--ci)
10. [Risk-Priority Matrix](#risk-priority-matrix)
11. [Cross-Cutting Concerns Checklist](#cross-cutting-concerns-checklist)

---

## Review Philosophy & Architecture

The codebase follows a **strict 4-layer hexagonal architecture** with dependency inversion:

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  PHASE 8: E2E Tests (agent-tests/, __tests__/)                      │
 ├─────────────────────────────────────────────────────────────────────┤
 │  PHASE 7: CLI App (apps/cli/)                                       │
 ├─────────────────────────────────────────────────────────────────────┤
 │  PHASE 6: Web Frontend (apps/web/)                                  │
 ├─────────────────────────────────────────────────────────────────────┤
 │  PHASE 5: Server Composition & Routes (apps/server/)                │
 ├─────────────────────────────────────────────────────────────────────┤
 │  PHASE 4: Infrastructure Adapters (copilot-bridge, anthropic-bridge)│
 ├─────────────────────────────────────────────────────────────────────┤
 │  PHASE 3: Persistence Layer (packages/db/)                          │
 ├─────────────────────────────────────────────────────────────────────┤
 │  PHASE 2: Core Domain + Application Services (packages/core/)       │
 ├─────────────────────────────────────────────────────────────────────┤
 │  PHASE 1: Foundation Types & Shared (packages/shared/)              │
 └─────────────────────────────────────────────────────────────────────┘
```

### Dependency Rules (Enforced)

| Layer                                              | Can Import From      | Cannot Import From                       |
| -------------------------------------------------- | -------------------- | ---------------------------------------- |
| **Presentation** (Web, CLI, Server routes)   | Application, Shared  | Domain directly, Infrastructure concrete |
| **Application** (Services)                   | Domain, Shared       | Presentation, Infrastructure concrete    |
| **Domain** (Entities, State Machines, Ports) | Shared types ONLY    | Everything else (zero external deps)     |
| **Infrastructure** (Repos, Adapters)         | Domain ports, Shared | Application, Presentation                |

### Key Data Flow

```
User Action → Presentation Layer → Application Service → Domain Logic
     ↓                                      ↓
 HTTP/SSE/CLI                        Port Interface
     ↓                                      ↓
 Response ← Infrastructure Adapter ← Repository/SDK
```

---

## Phase 1 — Foundation: `packages/shared/`

### What This Package Does

The **zero-dependency foundation library**. Every other package imports from here. It defines all types, errors, configuration schemas, constants, logging, and telemetry used across the entire monorepo. Think of it as the "language" the system speaks — if this layer has inconsistencies, they cascade everywhere.

### End-to-End Pipeline

```
Types define data shapes
    → Zod schemas validate all inputs at system boundaries
    → Errors classify and categorize failures
    → Constants parameterize runtime behavior
    → Logger instruments all operations
    → Telemetry exports metrics to OTel collector
```

### Files to Review (Ordered)

#### 1.1 — Event System (The Communication Backbone)

| File                        | Purpose                                                    | What to Verify                                                                   |
| --------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/types/AgentEvent.ts`             | Discriminated union of ~50 event kinds across 8 categories | Every `kind` string is unique; payload shapes match consumers; no orphan kinds |

**Event Categories:**

- **Copilot SDK:** `copilot.token`, `copilot.message_complete`, `copilot.reasoning_delta/complete`, `copilot.tool_start/complete`, `copilot.idle`, `copilot.error`, `copilot.session_start`, `copilot.usage`, `copilot.turn_start/end`, `copilot.session_info`, `copilot.unknown`
- **Copilot Client:** `copilot.client_started/stopped/error/restarting`
- **Chat (v2):** `chat.created`, `chat.prompt_sent/failed`, `chat.archived/deleted`
- **Workflow (v1 legacy):** `workflow.started/step_started/step_completed/completed/failed/paused/cancelled`
- **WorkflowRun (v2):** `workflow_run.created/starting/running/paused/resumed/cancelling/completed/failed/cancelled` + orchestration sub-events (cloning, preprocessing, postprocessing, git, sandbox)
- **StageRun (v2):** `stage_run.pending/queued/running/step_started/step_completed/paused/resumed/completed/failed/cancelled/skipped/retrying`
- **Durable Sleep (DUR-05):** `stage_run.sleeping/woken`
- **HITL:** `stage_run.awaiting_input/input_received`, `workflow_run.permission_mode_changed`

#### 1.2 — Domain Types (Data Model)

| File                                                 | Purpose                          | What to Verify                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/WorkflowRun.ts`                                                  | Runtime execution model          | 8 run statuses, 10 stage statuses (including sleeping, awaiting_input), permissionMode, version field for optimistic locking                 |
| `src/types/WorkflowDefinition.ts`                                           | DAG design-time model            | `WorkflowSessionMode` (single/per-stage/auto), `VariableDefinition`, `OrchestratorConfig`                                              |
| `src/types/StageDefinition.ts`                                              | DAG node + edge types            | `PromptDefinition`, `RetryPolicy`, `StageCondition`, `StageEdgeType` (on_success/on_failure/on_completion/always), `ContextFilter` |
| `src/types/Session.ts`                                                      | Copilot SDK session lifecycle    | `SessionStatusV2` (6 states), `SessionOwnerType` (chat/stage_run/workflow_run), v1→v2 status mapping                                    |
| `src/types/Chat.ts`                                                         | v2 chat entity                   | `ChatStatus`, `CreateChatParams`, git repositories (max 3)                                                                               |
| `src/types/ChatMessage.ts`                                                  | Message persistence shape        | `ChatMessageMetadata` (thinkingText, toolCalls, turnId for WEB-02 dedup)                                                                   |
| `src/types/HookDefinition.ts`                                               | Extension system contract        | 22 hook phases, 3 hook types (script/http/function),`HookFailurePolicy` (abort/skip/continue)                                              |
| `src/types/Workflow.ts`                                                     | SDK configuration                | `CopilotConfig` (model, MCP servers, tools, agents, provider, reasoningEffort, maxTurns)                                                   |
| `src/types/WorkflowOrchestrator.ts`                                         | Git + pipeline orchestration     | `GitRepositoryConfig`, preprocessing/postprocessing steps, `OrchestratorContext`                                                         |
| `src/types/Automation.ts`                                                   | Automation & batch processing    | `DataSourceType` (static/script/http/file), batch/loop modes, error policies                                                               |
| `src/types/Project.ts`                                                      | Project/codebase management      | `Project`, `ProjectCodebase`, `WorktreeInfo`, `SystemConfig`                                                                         |
| `src/types/IPlatformClient.ts`                                              | Presentation → Service contract | **48+ methods** — the API surface for web, CLI, and desktop apps                                                                      |
| `src/types/Artifact.ts`                                                     | File artifact model              | `Artifact` with direction (inbound/outbound)                                                                                               |
| `src/types/Webhook.ts`                                                      | Webhook model                    | `WebhookRegistration`, `WebhookDelivery` (idempotent via delivery_id)                                                                    |
| `src/types/ILogger.ts`                                                      | Logging abstraction              | Logger port interface (debug/info/warn/error + child)                                                                                        |
|                                                                               |                                  |                                                                                                                                              |
|                                                                               |                                  |                                                                                                                                              |

#### 1.3 — Error Hierarchy

| File                    | Purpose           | What to Verify                                                                         |
| ----------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `src/errors/index.ts` | 22+ error classes | Correct category assignment; correct HTTP status mapping;`recoverable` flag accuracy |

**Error Classes & HTTP Mapping:**

| Error Class                | Category   | HTTP Status | Recoverable |
| -------------------------- | ---------- | ----------- | ----------- |
| `CopilotConnectionError` | copilot    | 502         | ✓          |
| `CopilotSessionError`    | copilot    | 502         | ✗          |
| `CopilotTimeoutError`    | copilot    | 502         | ✓          |
| `GitError`               | process    | 502         | ✓          |
| `ScriptError`            | process    | 502         | ✗          |
| `InvalidTransitionError` | state      | 409         | ✗          |
| `ValidationError`        | validation | 400         | ✗          |
| `SecurityError`          | validation | 400         | ✗          |
| `NotFoundError`          | not_found  | 404         | ✗          |
| `ResourceLimitError`     | resource   | 429         | ✓          |
| `HookTimeoutError`       | hook       | 502         | ✓          |
| `HookAbortError`         | hook       | 502         | ✗          |
| `HookScriptError`        | hook       | 502         | ✗          |
| `HookHttpError`          | hook       | 502         | ✓          |
| `HookConfigError`        | hook       | 502         | ✗          |
| `StorageError`           | storage    | 500         | ✗          |
| `NetworkError`           | network    | 503         | ✓          |
| `DAGValidationError`     | validation | 400         | ✓          |
| `SessionAllocationError` | resource   | 429         | ✓          |
| `StageExecutionError`    | process    | 502         | ✗          |
| `UserError`              | user       | 400         | ✓          |
| `UnknownError`           | process    | 502         | ✗          |

#### 1.4 — Configuration Schemas

| File                                        | Purpose                | What to Verify                                                                                     |
| ------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `src/config/AppConfig.ts`                 | Master Zod schema      | All env vars mapped; defaults are production-safe; sensitive fields use Zod `.optional()`        |
| `src/config/WorkflowDefinitionSchemas.ts` | 10+ validation schemas | Limits enforced (50 vars, 50 stages, 200 edges); variable names match `^[a-zA-Z_][a-zA-Z0-9_]*$` |
| `src/config/AutomationSchemas.ts`         | Automation validation  | Cron format (5-field); cross-field validation (batch data + loop items by mode)                    |
| `src/config/ChatSchemas.ts`               | Chat validation        | `CreateChatSchema`, `SendChatPromptSchema`                                                     |
| `src/config/WorkflowTemplate.ts`          | Template validation    | Template schema with CopilotConfig, hooks, variables                                               |

**AppConfig Key Sections:**

- `port`, `dbPath`, `workspacesDir`, `artifactsDir`, `templatesDir`
- `copilot`: cliPath, defaultModel, useStdio, githubToken, timeouts
- `harness`: `'copilot' | 'anthropic'` with provider-specific overrides
- `streaming`: enabled, heartbeat, maxReplayEvents, bufferCleanupDelayMs
- `security`: CORS origins, allowed commands, script timeouts
- `webhooks`: enabled, GitHub/custom tokens, rate limit
- `sandbox`: Docker/host provider, image, startup timeout, auto-destroy
- `durableSleep`: sweep interval, max wakes/sweep
- `retention`: event TTL (days), sweep cadence, delete limits
- `otel`: tracing enabled, endpoint, sample rate, export intervals

#### 1.5 — Utilities & Observability

| File                       | Purpose             | What to Verify                                                  |
| -------------------------- | ------------------- | --------------------------------------------------------------- |
| `src/constants/index.ts` | Runtime constants   | Reasonable defaults                                             |
| `src/utils/index.ts`     | Utility functions   | No side effects                                                 |
| `src/logging/index.ts`   | Pino logger factory | Redacts `*.apiKey`, `*.token`, `*.secret`, `*.password` |
| `src/telemetry/index.ts` | OTel helpers        | Metrics + tracing initialization                                |
| `src/index.ts`           | Barrel re-exports   | Completeness — all sub-modules exported                        |

### Phase 1 Review Checklist

- [ ] Every `AgentEvent` kind string is unique (no collisions)
- [ ] Every `AgentEvent` payload type matches what producers emit and consumers expect
- [ ] Zod schemas and TypeScript types are in sync (no drift)
- [ ] Error categories map to correct HTTP statuses in `ERROR_STATUS_MAP`
- [ ] `IPlatformClient` methods cover all implemented features
- [ ] Config schema defaults are production-safe (no accidentally open CORS, etc.)
- [ ] Logger redaction covers ALL sensitive field patterns
- [ ] Variable name regex prevents injection via template interpolation
- [ ] Limits (50 stages, 200 edges, 50 vars) are reasonable and enforced consistently
- [ ] All sub-modules are re-exported from `src/index.ts`

---

## Phase 2 — Core Domain + Application Services: `packages/core/`

### What This Package Does

The **brain** of the system. Contains pure domain logic (state machines, DAG engine, port interfaces) plus all application services (orchestration, execution, hooks, events). Zero framework dependencies — only imports from `@generatorai/shared`.

### End-to-End Pipeline

```
WorkflowDefinition created
  → DAGValidator validates (cycle detection, topological sort)
  → User starts run
  → WorkflowRunService creates StageRuns from definition
  → DAGScheduler computes "ready" root stages via topological order
  → SessionAllocator assigns Copilot SDK sessions (single/per-stage/auto mode)
  → StageExecutionService executes each ready stage:
      1. Resolve variables via ConfigResolver (3-level merge)
      2. Interpolate {{variables}} in prompts
      3. Send to Copilot SDK via ICopilotPort
      4. HookInterceptor intercepts SDK events → triggers lifecycle hooks
      5. Extract fenced code blocks → save to workspace directory
      6. Save non-code responses as markdown artifacts
      7. Emit AgentEvents to EventBus
  → EventBus persists to SQLite + broadcasts to SSE subscribers
  → On stage completion: DAGScheduler evaluates edge conditions → next ready stages
  → Repeat until all stages complete or run fails/cancels
```

### Sub-Phase 2A — Domain Layer (Pure Logic, Zero Dependencies)

#### Port Interfaces (The Contracts)

| File                                                  | Interface                                | Purpose                                                |
| ----------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| `src/domain/ports/ICopilotPort.ts`                  | `ICopilotPort`                         | Full SDK abstraction (create/resume/send/abort/events) |
| `src/domain/ports/IAgentHarnessPort.ts`             | `IAgentHarnessPort`                    | Harness-agnostic alias (for multi-provider support)    |
| `src/domain/ports/ISessionRepository.ts`            | `ISessionRepository`                   | Session CRUD + v2 ownership queries                    |
| `src/domain/ports/IWorkflowRepository.ts`           | `IWorkflowRepository`                  | v1 workflow persistence                                |
| `src/domain/ports/IEventRepository.ts`              | `IEventRepository`                     | Event insert + replay queries                          |
| `src/domain/ports/IChatMessageRepository.ts`        | `IChatMessageRepository`               | Message CRUD + session/chat scoped queries             |
| `src/domain/ports/IArtifactRepository.ts`           | `IArtifactRepository`                  | Artifact CRUD + upsert                                 |
| `src/domain/ports/IWebhookRepository.ts`            | `IWebhookRepository`                   | Webhook registration + delivery                        |
| `src/domain/ports/IWorkflowDefinitionRepository.ts` | `IWorkflowDefinitionRepository`        | Definition CRUD                                        |
| `src/domain/ports/IWorkflowRunRepository.ts`        | `IWorkflowRunRepository`               | Run CRUD + status queries                              |
| `src/domain/ports/IStageRunRepository.ts`           | `IStageRunRepository`                  | Stage run CRUD + sleep/interrupt                       |
| `src/domain/ports/IStageDefinitionRepository.ts`    | `IStageDefinitionRepository`           | Stage definition CRUD + reorder                        |
| `src/domain/ports/IStageEdgeRepository.ts`          | `IStageEdgeRepository`                 | Edge CRUD                                              |
| `src/domain/ports/IChatRepository.ts`               | `IChatRepository`                      | v2 Chat entity CRUD                                    |
| `src/domain/ports/IServiceInterfaces.ts`            | `IDAGScheduler`, `ISessionAllocator` | Core scheduling/allocation contracts                   |
| `src/domain/ports/ISandboxProvider.ts`              | `ISandboxProvider`                     | Sandbox lifecycle                                      |
| `src/domain/ports/IScriptRunner.ts`                 | `IScriptRunner`                        | Script execution                                       |
| `src/domain/ports/IHookBridge.ts`                   | `IHookBridge`                          | Hook system bridge                                     |
| `src/domain/ports/IHttpClient.ts`                   | `IHttpClient`                          | HTTP client abstraction                                |
| `src/domain/ports/IProjectRepository.ts`            | `IProjectRepository` + related         | Project/codebase/worktree persistence                  |

#### State Machines (Lifecycle Correctness)

| File                                                     | States                                                                                                | Transitions | What to Verify                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/state-machines/WorkflowRunStateMachine.ts` | 8 (created→starting→running↔paused→cancelling→completed/failed/cancelled)                        | 10          | No unreachable states; correct terminal conditions                                                                            |
| `src/domain/state-machines/StageRunStateMachine.ts`    | 10 (pending→queued→running↔paused→completed/failed/cancelled/skipped + sleeping + awaiting_input) | 12          | DUR-05 transitions (running→sleeping, sleeping→queued); HITL transitions (running→awaiting_input, awaiting_input→running) |
| `src/domain/state-machines/SessionStateMachineV2.ts`   | 6 (created→active↔paused→closing→closed + error)                                                  | 9           | Error from any non-terminal state                                                                                             |
| `src/domain/state-machines/SessionStateMachine.ts`     | 8 (v1 legacy)                                                                                         | —          | Still referenced? Can it be removed?                                                                                          |
| `src/domain/state-machines/WorkflowStateMachine.ts`    | 7 (v1 legacy)                                                                                         | —          | Still referenced? Can it be removed?                                                                                          |

#### DAG Engine (Scheduling Correctness)

| File                                     | Purpose                                                                                                        | What to Verify                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/dag/DAGValidator.ts`       | Cycle detection (Kahn's algorithm), topological sort, disconnected node detection, execution layer computation | Algorithm correctness; handles empty DAGs; handles single-node DAGs                                                        |
| `src/domain/dag/ConditionEvaluator.ts` | Edge condition evaluation                                                                                      | `always` always passes; `on_success` only on completed; `on_failure` only on failed; `expression` safely evaluated |
| `src/domain/dag/types.ts`              | DAG, StageNode, ExecutionLayer                                                                                 | Type correctness                                                                                                           |

#### Permissions System

| File                                           | Purpose                                                                      | What to Verify                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `src/domain/permissions/Permission.ts`       | Permission kinds (shell_exec, file_write, file_read, network, mcp, other)    | Complete coverage of tool types                    |
| `src/domain/permissions/PermissionPolicy.ts` | Policy evaluation (mode: default/acceptEdits/plan/bypassPermissions + rules) | Evaluation order; bypassPermissions truly bypasses |
| `src/domain/permissions/policyHookBridge.ts` | Wire permissions into pre-tool hook decisions                                | Denied tools are suppressed                        |

### Sub-Phase 2B — Application Services (Business Logic)

#### Critical Services (Highest Impact)

| File                                      | Purpose                                   | Key Methods                                                        | Risk Areas                                                                                                        |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `src/services/EventBus.ts`              | Per-session event persistence + broadcast | `emit()`, `subscribe()`, `allocateSequence()`                | **P0**: Promise queue ordering; bare `.catch(() => {})` creates silent gaps; EVT-01 commit-then-broadcast |
| `src/services/DAGScheduler.ts`          | Computes ready stages from DAG            | `getReadyStages()`, `onStageComplete()`, `buildDAG()`        | **P1**: Hash-based cache invalidation; stale DAG if definition edited mid-run                               |
| `src/services/SessionAllocator.ts`      | Manages SDK session lifecycle             | `allocate()`, `release()`, `cleanup()`                       | **P1**: Ref counting correctness; session leaks on error paths                                              |
| `src/services/StageExecutionService.ts` | Executes stages (prompt→SDK→output)     | `execute()`, `extractCodeBlocks()`, `saveArtifacts()`        | **P0**: Path traversal via `resolveWithinBase()`; code block extraction regex                             |
| `src/services/WorkflowRunService.ts`    | Orchestrates DAG execution                | `create()`, `start()`, `pause()`, `resume()`, `cancel()` | State transition validation; cascade rules                                                                        |
| `src/services/StreamBroker.ts`          | Unified event pub/sub with DB persistence | `publish()`, `subscribe()`, `replay()`                       | **P2**: Three-phase subscribe race safety (buffering→replay→flush→live)                                  |

#### Orchestration Services

| File                                     | Purpose                                                             | What to Verify                                           |
| ---------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/services/WorkflowOrchestrator.ts` | Entry point: git clone → preprocess → DAG execute → post-process | Correct sequencing; error propagation                    |
| `src/services/WorkflowPreprocessor.ts` | Clone repos, run scripts, validate inputs, set variables            | Script execution security; variable interpolation safety |

#### Hook & Extension Services

| File                                | Purpose                            | What to Verify                                                                    |
| ----------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| `src/services/HookExecutor.ts`    | Execute script/http/function hooks | Timeout + AbortSignal handling; retry logic; failure policy (abort/skip/continue) |
| `src/services/HookInterceptor.ts` | Map SDK events → hook phases      | Event→phase mapping complete; tool-use suppression on denied permissions         |

#### Lifecycle & Recovery Services

| File                                        | Purpose                                          | What to Verify                                                       |
| ------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `src/services/DurableSleepService.ts`     | Sweeper wakes stages at deadline (DUR-05)        | Sweep interval timing; race with run deletion                        |
| `src/services/HitlService.ts`             | Human-in-the-loop interrupt/resume (HITL-01..05) | In-memory awaiter + DB durability (survives crash); approval timeout |
| `src/services/StartupRecoveryService.ts`  | Recover on boot                                  | Session recovery; run recovery; orphan sandbox cleanup               |
| `src/services/AutomationService.ts`       | Cron scheduling, webhooks, batch/loop            | Cross-process leasing; error policy enforcement                      |
| `src/services/SandboxLifecycleManager.ts` | Docker/host sandbox management                   | Rate-limited queue (500ms gap); max 50 sandboxes; orphan reaper      |

#### Data & Configuration Services

| File                                          | Purpose                                           | What to Verify                              |
| --------------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| `src/services/WorkflowDefinitionService.ts` | Definition CRUD + validation                      | DAG validation integration                  |
| `src/services/ChatManagementService.ts`     | v2 chat CRUD + messaging                          | Session creation on chat start              |
| `src/services/SessionService.ts`            | Session lifecycle (v1 still used)                 | v2 status mapping                           |
| `src/services/ConfigResolver.ts`            | 3-level config merge (definition→stage→runtime) | Deep merge correctness; override precedence |
| `src/services/DataSourceResolver.ts`        | Script/HTTP/file data source resolution           | Timeout enforcement; error handling         |
| `src/services/ResultValidator.ts`           | Stage output validation                           | Rule evaluation                             |
| `src/services/StreamLogger.ts`              | Per-run JSONL event logging                       | File rotation; disk space                   |
| `src/services/TemplateRegistry.ts`          | Workflow template library                         | Template loading; variable validation       |

### Sub-Phase 2C — Infrastructure Adapters

| File                                                 | Purpose                                 | What to Verify                                                                |
| ---------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `src/infrastructure/GitManager.ts`                 | Git clone, branch, commit, PR, worktree | Command injection prevention; credential handling                             |
| `src/infrastructure/SandboxedScriptRunner.ts`      | Secure script execution                 | **P0**: Command allowlist completeness; pattern detection for injection |
| `src/infrastructure/DockerSandboxProvider.ts`      | Docker microVM isolation                | Container escape prevention; resource limits                                  |
| `src/infrastructure/HostProcessSandboxProvider.ts` | Fallback (dev only)                     | Explicit opt-in required; no production use                                   |
| `src/infrastructure/FetchHttpClient.ts`            | Native fetch with AbortSignal           | Timeout handling; response size limits                                        |
| `src/utils/safePath.ts`                            | Path traversal defense                  | `resolveWithinBase()` + `isSymlink()` correctness                         |
| `src/bootstrap/createCoreServices.ts`              | Hand-wired DI factory                   | Complete wiring; no circular dependencies                                     |

### Phase 2 Review Checklist

- [ ] All state machine transitions are exhaustive — no unreachable/dead states
- [ ] State machines reject invalid transitions with `InvalidTransitionError`
- [ ] DAGValidator correctly detects all cycle types (direct, indirect, self-loops)
- [ ] DAGValidator handles edge cases (empty DAG, single node, disconnected nodes)
- [ ] ConditionEvaluator `expression` type is safely sandboxed (no eval injection)
- [ ] EventBus per-session promise queue ordering is preserved under all conditions
- [ ] EventBus `.catch(() => {})` — understand implications of silent DB failures
- [ ] StageExecutionService uses `resolveWithinBase()` for ALL file write paths
- [ ] StageExecutionService code block extraction regex handles edge cases
- [ ] SessionAllocator ref counting: every `allocate()` has matching `release()`
- [ ] SessionAllocator: `single` mode correctly queues requests; `auto` mode reuses sequential
- [ ] DAGScheduler hash-based cache: verify invalidation on definition update
- [ ] HookExecutor AbortSignal propagation works through script/HTTP/function hooks
- [ ] StreamBroker three-phase subscribe: buffer→replay→flush→live prevents gaps
- [ ] StreamBroker: `deliveredUpTo` watermark correctly skips replayed items from buffer
- [ ] `GEN_VAR_*` environment variables never interpolated into shell commands
- [ ] SandboxedScriptRunner allowlist covers all safe commands; blocks dangerous ones
- [ ] Path operations always use `safePath.resolveWithinBase()` before file I/O
- [ ] DurableSleepService handles race where run is deleted while stage sleeps
- [ ] HitlService in-memory awaiter survives EventBus reconnection
- [ ] AutomationService cross-process leasing prevents double-execution

---

## Phase 3 — Persistence Layer: `packages/db/`

### What This Package Does

Drizzle ORM over SQLite (WAL mode, foreign keys ON). Defines **26 tables**, **22 repository classes**, and idempotent migration logic. All data access goes through typed repositories — no raw SQL in application code.

### End-to-End Pipeline

```
App Boot
  → createDB(path) opens SQLite with WAL + FK pragma
  → migrateDB(db) runs 6-phase idempotent schema creation:
      Phase 0: Legacy tables (CREATE TABLE IF NOT EXISTS)
      Phase 1: Incremental columns (safeAddColumn)
      Phase 2: V2 tables (definitions, runs, stages)
      Phase 3: Automation tables (batch/loop/DSC)
      Phase 4: Sleep + HITL columns (DUR-05, HITL-01)
      Phase 5: Project scope columns
      Phase 6: Versioned migrations (_schema_versions)
  → migrateV1ToV2() remaps legacy session statuses
  → Repositories instantiated → Injected into services via ports
```

### Schema Overview (26 Tables)

#### V1 Legacy Tables

| Table                     | Key Fields                                                | FKs                   | Purpose                    |
| ------------------------- | --------------------------------------------------------- | --------------------- | -------------------------- |
| `sessions`              | id, status, model, conversation_id, owner_type, owner_id  | —                    | SDK session lifecycle      |
| `workflows`             | id, session_id, template_id, status, order                | → sessions (CASCADE) | v1 template execution      |
| `events`                | id, session_id, sequence_id, kind, data (JSON)            | —                    | Per-session event log      |
| `eventSequences`        | session_id, next_sequence                                 | —                    | Atomic sequence allocation |
| `chat_messages`         | id, session_id, chat_id, role, content, metadata (JSON)   | → sessions (CASCADE) | Message history            |
| `artifacts`             | id, session_id, workflow_run_id, stage_run_id, name, path | → sessions (CASCADE) | Generated files            |
| `webhook_registrations` | id, name, source, event_type, condition                   | —                    | Trigger rules              |
| `webhook_deliveries`    | id, registration_id, delivery_id (UNIQUE), status         | → registrations      | Idempotent delivery log    |

#### V2 DAG Tables

| Table                    | Key Fields                                                                                                  | FKs                                           | Purpose                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------- |
| `chats`                | id, session_id, model, copilot_config, git_repositories, projectId                                          | → sessions (CASCADE)                         | v2 conversation root              |
| `workflow_definitions` | id, name, session_mode, copilot_config, variables, orchestrator_config, scope, projectId                    | —                                            | Immutable DAG template            |
| `stage_definitions`    | id, workflow_definition_id, name, prompts, hooks, retry_policy, condition, context_filter, agent_name       | → definitions (CASCADE)                      | DAG node                          |
| `stage_edges`          | id, workflow_definition_id, from_stage_id, to_stage_id, edge_type                                           | → definitions (CASCADE), → stages (CASCADE) | DAG edge (UNIQUE from+to)         |
| `workflow_runs`        | id, workflow_definition_id, status, session_mode, master_session_id, variables, permission_mode, projectId  | → definitions                                | Runtime instance                  |
| `stage_runs`           | id, workflow_run_id, stage_definition_id, session_id, status, version, wake_at, slept_since, interrupt_data | → runs (CASCADE), → stages, → sessions     | Stage execution (optimistic lock) |

#### Streaming Tables

| Table               | Key Fields                                | Purpose                                  |
| ------------------- | ----------------------------------------- | ---------------------------------------- |
| `streamCursors`   | scope, scopeId, seq, kind, payload (JSON) | Persistent event buffer for StreamBroker |
| `streamSequences` | scope, scopeId, lastSeq                   | Per-scope monotonic sequence counter     |

#### Session Allocation Tables

| Table                  | Key Fields                                           | Purpose                |
| ---------------------- | ---------------------------------------------------- | ---------------------- |
| `sessionAllocations` | workflowRunId, mode, sharedSessionId, sharedRefCount | Session reuse tracking |
| `stageSessionMaps`   | allocationId, stageRunId, sessionId                  | Stage→session binding |

#### Automation Tables

| Table                       | Key Fields                                                                                         | Purpose                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `automations`             | id, trigger_type, cron_expression, input_mode, data_source_config, locked_until, locked_by_process | Trigger definitions + cross-process locking |
| `automationExecutions`    | id, automation_id, status, totalIterations, completedIterations, failedIterations                  | Execution context                           |
| `automationExecutionRuns` | id, execution_id, workflow_run_id, iteration_index, iteration_variables                            | Per-item run                                |

#### Project Tables

| Table                | Key Fields                                                         | Purpose                 |
| -------------------- | ------------------------------------------------------------------ | ----------------------- |
| `projects`         | id, name, settings (JSON), rootPath, status                        | Project container       |
| `projectCodebases` | id, projectId, alias (UNIQUE per project), type, url, status       | Git repos / local dirs  |
| `projectConfigs`   | id, projectId, type, name (UNIQUE per project+type)                | Agent/prompt/skill refs |
| `worktrees`        | id, projectId, codebaseId, runId, worktreePath, branchName, status | Git worktree per run    |
| `systemConfigs`    | id, type, name (UNIQUE per type)                                   | System-level catalog    |

### Key Repositories to Review

| Repository                             | Table(s)                              | Critical Methods                                                                                   | Risk                                                     |
| -------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `DrizzleSequenceAllocator`           | eventSequences                        | `allocate()`: atomic UPDATE RETURNING + INSERT retry (max 3)                                     | Race condition under concurrent inserts                  |
| `DrizzleStageRunRepository`          | stageRuns                             | `sleep()`, `wake()`, `interrupt()`, `resumeFromInterrupt()`, `findSleepersReadyToWake()` | Optimistic locking via version; double-resume prevention |
| `DrizzleStreamCursorRepository`      | streamCursors + streamSequences       | `append()`: raw better-sqlite3 transaction; `replayAfter()`: pagination                        | Atomic transaction correctness                           |
| `DrizzleEventRepository`             | events + eventSequences               | `insert()`, `getAfterSequence()` (gap-free replay)                                             | High-volume insert performance                           |
| `DrizzleSessionAllocationRepository` | sessionAllocations + stageSessionMaps | `createAllocation()`, `putStageSession()` (upsert)                                             | Unique constraint handling                               |
| `DrizzleAutomationRepository`        | automations                           | `getByWebhookToken()`, locked_until/locked_by_process                                            | Token lookup security; lease logic                       |
| `DrizzleChatMessageRepository`       | chatMessages                          | Ordering by timestamp+rowid, JSON extract on metadata                                              | Deterministic ordering guarantee                         |

### Migration Logic Review

| Function            | What to Verify                                                                          |
| ------------------- | --------------------------------------------------------------------------------------- |
| `migrateDB()`     | `CREATE TABLE IF NOT EXISTS` for all tables is truly idempotent                       |
| `safeAddColumn()` | Only swallows "duplicate column" / "already exists" errors — no other errors masked    |
| `migrateV1ToV2()` | Status mapping is correct (starting→created, running→active, completed→closed, etc.) |
| `migrateV1ToV2()` | Idempotency check (skips if sessions already have owner_type)                           |
| Phase 6 versioned   | `_schema_versions` table tracks applied migrations correctly                          |

### Phase 3 Review Checklist

- [ ] All FKs have correct ON DELETE behavior (CASCADE for owned, RESTRICT for referenced)
- [ ] `safeAddColumn()` only swallows expected SQLite errors
- [ ] `migrateV1ToV2()` status mapping matches `SESSION_STATUS_V1_TO_V2` in shared types
- [ ] Sequence allocator handles concurrent INSERT conflicts (retry logic)
- [ ] StageRun `version` field correctly prevents double-resume/retry races
- [ ] JSON columns are parsed/validated before insert (no silent corruption)
- [ ] All hot query paths have covering indexes
- [ ] StreamCursor `append()` uses raw better-sqlite3 transaction correctly
- [ ] UNIQUE constraints: `(from_stage_id, to_stage_id)`, `(projectId, alias)`, `(type, name)`
- [ ] Webhook `delivery_id` uniqueness prevents double-processing
- [ ] Automation `locked_until` + `locked_by_process` provides correct lease semantics
- [ ] `eventSequences` INSERT retry doesn't loop forever on persistent failures
- [ ] ChatMessage ordering by `timestamp + rowid` is deterministic across queries

---

## Phase 4 — Infrastructure Adapters: `copilot-bridge` + `anthropic-bridge`

### What These Packages Do

Adapt external AI SDKs to the domain port interfaces. **copilot-bridge** wraps `@github/copilot-sdk` (v0.3.0) into `ICopilotPort`. **anthropic-bridge** is an opt-in scaffold for Anthropic Messages API (not wired by default).

### End-to-End Pipeline (copilot-bridge)

```
Domain calls ICopilotPort.createConversation(params)
  → CopilotAdapter maps domain params to SDK SessionConfig:
      - Maps tools via buildSdkTools() (createSdkTool per ToolDefinition)
      - Maps systemMessage (mode: append|replace + content)
      - Handles wildcard availableTools: ['*'] → omits field from SDK
      - Maps customAgents, MCP servers, BYOK provider config
      - Maps domain hooks → SDK hooks with permission translation
  → SDK creates CopilotSession → stored in conversations Map

Domain calls sendPromptAndWait(id, prompt, attachments?, signal?)
  → Adapter sends to SDK session
  → Manual idle detection (NOT SDK's sendAndWait — avoids hard timeouts)
  → SDK emits SessionEvents:
      assistant.message_delta → copilot.token
      assistant.message → copilot.message_complete
      assistant.reasoning_delta → copilot.reasoning_delta
      tool.execution_start → copilot.tool_start
      tool.execution_complete → copilot.tool_complete
      session.idle → copilot.idle (triggers Promise resolution)
      session.error → copilot.error
  → event-mapper translates each SessionEvent → AgentEvent
  → Registered handlers (EventBus) receive domain events
```

### Files to Review

| File                                         | Purpose                        | Key Methods                                                                                            | Risk Areas                                                                         |
| -------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `copilot-bridge/src/CopilotAdapter.ts`     | Core SDK wrapper               | `createConversation()`, `sendPromptAndWait()`, `resumeConversation()`, `onConversationEvent()` | Idle detection correctness; listener leak at >50 handlers; AbortSignal propagation |
| `copilot-bridge/src/event-mapper.ts`       | SDK→domain event translation  | `mapSdkEventToAgentEvent()`                                                                          | Exhaustive mapping (15+ event types); safe object access guards                    |
| `copilot-bridge/src/tool-factory.ts`       | Domain tools→SDK tools        | `buildSdkTools()`, `createSdkTool()`                                                               | Arg normalization (null/undefined/Array→{})                                       |
| `copilot-bridge/src/permissionMap.ts`      | Permission kind mapping        | `mapPermissionKind()`                                                                                | TypeScript `satisfies` check; unknown kind fallback with console.warn            |
| `anthropic-bridge/src/AnthropicAdapter.ts` | Alternate harness scaffold     | `initialize()`, `createConversation()`                                                             | Extension points clearly marked; API key validation                                |
| `anthropic-bridge/src/permissionMap.ts`    | Anthropic tool→domain mapping | `mapToolToPermissionType()`                                                                          | Exhaustive mapping                                                                 |

### Critical Flow: `sendPromptAndWait()`

This is the most complex method — it avoids SDK's built-in `sendAndWait()` to prevent hard timeouts on long AI tasks:

```
1. Send prompt to SDK session
2. Subscribe to session events with idle listener
3. On copilot.idle → resolve Promise (turn complete)
4. On copilot.error → reject Promise
5. On AbortSignal.abort → call session.abort() + reject
6. Adapter-level timeout fallback (configurable, very long)
7. Clean up event subscription on resolve/reject
```

### OTel Instrumentation (copilot-bridge)

| Metric                                | Type          | Purpose                 |
| ------------------------------------- | ------------- | ----------------------- |
| `copilot.prompts.total`             | Counter       | Total prompts sent      |
| `copilot.prompt.duration_ms`        | Histogram     | Prompt-to-idle latency  |
| `copilot.active_sessions`           | UpDownCounter | Active session count    |
| `copilot.listeners.high_water_mark` | UpDownCounter | Listener count tracking |
| `copilot.listeners.leak_warnings`   | Counter       | Leak detection fires    |

### Phase 4 Review Checklist

- [ ] `sendPromptAndWait()` correctly detects idle without SDK's hard timeouts
- [ ] AbortSignal propagation: signal.abort → session.abort() + Promise reject
- [ ] Listener leak detection: threshold (50) appropriate; warn-once flag per conversation
- [ ] `resumeConversation()` clears old listeners before re-subscribing
- [ ] Tool wildcard `['*']` correctly omits `availableTools` from SDK SessionConfig
- [ ] `event-mapper` handles ALL current SDK event types (no silent drops)
- [ ] Unknown events emit `copilot.unknown` with raw payload (not swallowed)
- [ ] `tool-factory` arg normalization prevents crash on null/undefined/Array args
- [ ] Permission mapping is exhaustive (TypeScript `satisfies` compile-time check)
- [ ] Permission mapping runtime fallback warns on unknown kinds
- [ ] `onConversationEvent()` has per-handler try/catch (one handler crash doesn't kill others)
- [ ] OTel metrics correctly track failures (not just successes)
- [ ] anthropic-bridge is opt-in only (not in default composition root)
- [ ] anthropic-bridge API key sourced from env (not hardcoded)

---

## Phase 5 — Server Composition & Routes: `apps/server/`

### What This App Does

Express 5 REST + SSE server. The **composition root** hand-wires all 28+ services. 16 route files expose 60+ endpoints. Middleware chain handles auth, CORS, rate limiting, metrics, and error mapping. Single unified SSE endpoint replaces legacy per-route streams.

### End-to-End Pipeline

```
Boot Sequence:
  1. Load .env → parse AppConfig via Zod
  2. Expand paths, resolve defaults
  3. Create directories (mkdirSync recursive)
  4. createDB() → migrateDB() → migrateV1ToV2()
  5. createContainer(config):
     a. Infrastructure: SQLite, SDK adapter, script runners, HTTP client, Git manager
     b. Conditional Sandbox: Docker or host-process fallback
     c. 29 Repositories instantiated
     d. Core Services factory wired
     e. StreamBroker + EventBus→StreamBroker bridge
     f. Background services: retention sweeper, durable-sleep sweeper, worktree cleanup
     g. Orchestration: SystemWorkflowRegistry, Preprocessor, ResultValidator
  6. Initialize: templates, SDK, recovery, cron, sweepers, system artifacts
  7. Mount middleware → mount routes → listen on port

Request Flow:
  HTTP Request
    → requestId (assign/propagate x-request-id)
    → requestMetrics (OTel duration/total/active)
    → CORS (SEC-02: origin allowlist)
    → Body parsers (JSON 2MB, URL-encoded 1MB)
    → Auth (Bearer token or ?apiKey=, exempt /health + /webhooks)
    → Rate limit (per-key 60/min + global 600/min)
    → Route handler → service call → response
    → Error handler (category→HTTP status, requestId in response)

SSE Flow:
  GET /api/stream?scope=run&id=<runId>&filter=copilot.token,stage_run
    → Validate scope + id + filter
    → acquireSseSlot(scope, id) → 503 if cap exceeded
    → Set SSE headers (text/event-stream, no-cache, keep-alive)
    → StreamBroker.subscribe(scope, id, handler, {afterSeq, kindPrefixes})
    → Phase 1: Buffer live events
    → Phase 2: Replay from DB
    → Phase 3: Flush buffer (skip duplicates via deliveredUpTo)
    → Phase 4: Live passthrough
    → Heartbeat every 15s (SSE comment, not event)
    → Backpressure: 256-frame queue → slow_consumer_dropped → disconnect
    → On client disconnect: unsubscribe + releaseSseSlot

Graceful Shutdown (SEC-09):
  SIGTERM/SIGINT received
    → Set shuttingDown flag
    → Stop accepting new requests
    → Force-close keep-alive + SSE after timeout
    → Shutdown services in reverse order
    → Force exit if timeout (60s default) reached
```

### Files to Review

#### Composition & Boot

| File                        | Purpose                  | What to Verify                                                                |
| --------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `src/composition-root.ts` | DI wiring (28+ services) | Wiring order correct; no circular deps; all ports mapped to adapters          |
| `src/index.ts`            | Boot + graceful shutdown | Shutdown drains SSE before closing DB; force exit timeout ≥ K8s grace period |

#### Middleware (Applied in Order)

| # | File                                 | Purpose                         | Security Aspect                                                                 |
| - | ------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------- |
| 1 | `src/middleware/requestId.ts`      | UUID + x-request-id propagation | —                                                                              |
| 2 | `src/middleware/requestMetrics.ts` | OTel HTTP metrics               | —                                                                              |
| 3 | `src/middleware/cors.ts`           | Origin allowlist                | **SEC-02**: Rejects `*` + credentials; prod requires explicit allowlist |
| 4 | (express.json)                       | Body parsing                    | JSON 2MB, URL-encoded 1MB, params ≤100                                         |
| 5 | `src/middleware/auth.ts`           | Bearer/apiKey gate              | Optional (disabled by default); exempts /health + /webhooks                     |
| 6 | `src/middleware/rateLimit.ts`      | Per-key + global budgets        | **SEC-07**: Applied AFTER auth (unauth = 401 before budget impact)        |
| 7 | (routes)                             | All route handlers              | —                                                                              |
| 8 | `src/middleware/staticFiles.ts`    | React SPA (prod only)           | —                                                                              |
| 9 | `src/middleware/errorHandler.ts`   | Error normalization             | Stack only in dev; requestId in response                                        |

**Error Handler Mapping:**

- `DAGValidationError` → 422
- `SessionAllocationError` → 503
- Express body-parser errors → preserve original status (413, etc.)
- Generic → `ERROR_STATUS_MAP[category]` or 500

#### Routes (60+ Endpoints)

| File                                   | Key Endpoints                                                          | What to Verify                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/stream.ts`               | `GET /api/stream` (SSE), `GET /api/stream/replay` (REST)           | Backpressure at 256 frames (STR-05); filter max 10 prefixes (STR-06); connection cap 6/32 (SEC-04); Last-Event-ID resume (STR-08) |
| `src/routes/chats.ts`                | CRUD + prompt + history (7 endpoints)                                  | Body validation; rate limit on prompt sends                                                                                       |
| `src/routes/workflow-definitions.ts` | CRUD + stages + edges + validate + import/export (13 endpoints)        | DAG validation on save; JSON import sanitization                                                                                  |
| `src/routes/workflow-runs.ts`        | CRUD + start/pause/resume/cancel + HITL (8+ endpoints)                 | State transition validation at route level                                                                                        |
| `src/routes/orchestrator.ts`         | Run orchestration + workspace upload + system templates (8+ endpoints) | **Path traversal**: `resolveWithinBase()` on workspace upload/download                                                    |
| `src/routes/projects.ts`             | CRUD + codebases + configs + worktrees (15+ endpoints)                 | **Path traversal**: symlink rejection on file access                                                                        |
| `src/routes/automations.ts`          | CRUD + enable/disable + data-source test + trigger (12 endpoints)      | Script execution security in data-source test                                                                                     |
| `src/routes/webhooks.ts`             | GitHub + custom trigger + management (5 endpoints)                     | **SEC-12**: GitHub HMAC SHA256 pinned; constant-time comparison                                                             |
| `src/routes/sessions.ts`             | Chat messages by sessionId (1 endpoint)                                | Legacy compat                                                                                                                     |
| `src/routes/health.ts`               | Health check + public config (2 endpoints)                             | No sensitive info exposed in public config                                                                                        |
| `src/routes/templates.ts`            | List + get templates (2 endpoints)                                     | Template loading safety                                                                                                           |
| `src/routes/copilot.ts`              | Models, state, conversations (5+ endpoints)                            | No credential exposure                                                                                                            |
| `src/routes/hooks.ts`                | Hook phases, session hooks, test (3 endpoints)                         | Hook test safety                                                                                                                  |
| `src/routes/openapi.ts`              | OpenAPI spec + Swagger UI (2 endpoints)                                | Spec accuracy                                                                                                                     |

### Phase 5 Review Checklist

- [ ] Composition root wiring matches all port→adapter contracts (no mismatches)
- [ ] Composition root boot sequence: templates loaded before SDK init (dependency order)
- [ ] Graceful shutdown: SSE connections drained BEFORE DB closed
- [ ] Graceful shutdown timeout ≥ K8s/systemd grace period
- [ ] Auth middleware correctly exempts /health + /webhooks paths
- [ ] Auth middleware uses constant-time comparison for token
- [ ] CORS middleware rejects `*` + credentials combo in production
- [ ] Rate limiter applied AFTER auth (prevents unauth budget consumption)
- [ ] SSE backpressure disconnects slow consumers at 256 frames
- [ ] SSE connection cap: 6 per (scope, id) for session/run/chat; 32 for global
- [ ] SSE heartbeat uses comments (`:heartbeat\n\n`) not events (won't fire onmessage)
- [ ] Webhook HMAC: uses SHA256 only (no md5/sha1); constant-time `timingSafeEqual`
- [ ] All route body validation uses Zod middleware (no manual parsing)
- [ ] Path traversal: `resolveWithinBase()` on orchestrator workspace + project file access
- [ ] Path traversal: symlink detection blocks escape from workspace directories
- [ ] Error handler never exposes stack traces in production
- [ ] Error handler includes requestId for correlation
- [ ] Static file serving: only in production mode; doesn't override API routes

---

## Phase 6 — Web Frontend: `apps/web/`

### What This App Does

React 19 SPA with Vite 6. Features 16 route pages, 50+ components, 6 Zustand stores, TanStack Query for server state, and per-scope SSE connections via native EventSource.

### End-to-End Pipeline

```
App Bootstrap:
  App.tsx → ThemeProvider → QueryProvider → PlatformProvider → RouterProvider
  PlatformProvider creates HttpPlatformClient singleton (memoized per baseUrl)

Page Load:
  Router lazily loads page component (Suspense + PageErrorBoundary)
    → TanStack Query hooks fetch data via HttpPlatformClient
    → Query cache provides instant stale-while-revalidate UX

Real-Time Streaming (Chat or Workflow Run):
  User opens chat page or workflow run page
    → sseManager.connectChatSession(chatId, sessionId, platform)
       OR sseManager.connectWorkflowRun(runId, platform)
    → Opens EventSource at /api/stream?scope=<s>&id=<id>
    → Phase 1: Start buffering live SSE events
    → Phase 2: REST fetch /api/stream/replay for initial history
    → Phase 3: Merge replay + buffer (dedup via seenSequenceIds Set)
    → Phase 4: Live events routed to processEvent()

Event Processing (processEvent — 500+ lines, 50+ event kinds):
  For each event:
    → Dedup check (seenSequenceIds)
    → Cross-buffer flush (thinking↔token boundary) ← LOAD-BEARING
    → Route to appropriate store:
        copilot.token → streamStore.appendToken()
        copilot.reasoning_delta → streamStore.appendThinking()
        copilot.tool_start → streamStore.addToolCall()
        copilot.message_complete → flush + query invalidation
        stage_run.* → workflowRunStore.updateStageRunStatus()
        workflow_run.* → workflowRunStore state update
    → Flush timer: 100ms interval batches store updates

Workflow Builder:
  workflowBuilderStore manages React Flow nodes/edges
    → User drags/connects stages
    → Undo/redo via history stack
    → Save → HttpPlatformClient.updateDefinition()
    → Server validates DAG (cycle detection)
    → On error: validation errors displayed in UI
```

### Files to Review

#### State Management (Stores)

| File                                   | Purpose                           | What to Verify                                                                                                       |
| -------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/stores/sseManager.ts`           | Per-scope SSE with replay + dedup | Cross-buffer flush (thinking↔token) —**DO NOT REWRITE**; dedup via seenSequenceIds; three-phase replay merge |
| `src/stores/streamStore.ts`          | Real-time token streaming state   | Temporal block ordering (Thinking→Text→ToolCall→System); turnId dedup (WEB-02); optimistic user message           |
| `src/stores/workflowBuilderStore.ts` | DAG designer state                | React Flow node/edge state; undo/redo; isDirty; validation                                                           |
| `src/stores/workflowRunStore.ts`     | Run monitoring state              | Stage status tracking; stage-session mapping; timeline events                                                        |
| `src/stores/chatStore.ts`            | Chat routing state                | Chat↔session mapping; active chat tracking                                                                          |
| `src/stores/connectionStore.ts`      | SSE health tracking               | Connection state per session; global SSE state                                                                       |

#### Platform Client & API

| File                                   | Purpose                                   | What to Verify                                                                |
| -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `src/platform/HttpPlatformClient.ts` | 100+ methods implementing IPlatformClient | All server endpoints covered; error handling consistent                       |
| `src/platform/apiFetch.ts`           | Typed fetch wrapper                       | Bearer token from localStorage; ApiError class; EventSource auth via ?apiKey= |

#### Key Components

| File                                                 | Purpose                | What to Verify                                           |
| ---------------------------------------------------- | ---------------------- | -------------------------------------------------------- |
| `src/components/chat/ChatView.tsx`                 | Main chat interface    | Optimistic messages; turn dedup; SSE integration         |
| `src/components/chat/StreamingMessage.tsx`         | Live token rendering   | Temporal block ordering; thinking/text/tool boundaries   |
| `src/components/workflow/DAGCanvas.tsx`            | React Flow DAG editor  | Keyboard shortcuts; drag-and-drop; connection validation |
| `src/components/workflow/RuntimeDAGCanvas.tsx`     | Live run visualization | Stage status colors; animated edges; read-only mode      |
| `src/components/workflow/StagePropertiesPanel.tsx` | Stage configuration    | Prompt editing; hook config; retry/condition             |
| `src/components/workflow/HitlPanel.tsx`            | Human-in-the-loop UI   | Approval/rejection; pending list; reason field           |

#### Routing & Providers

| File                                   | Purpose                        | What to Verify                                         |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------ |
| `src/router.tsx`                     | Route config with lazy loading | All pages have error boundaries; correct path patterns |
| `src/providers/PlatformProvider.tsx` | HttpPlatformClient context     | Singleton per baseUrl; memoized                        |
| `src/providers/QueryProvider.tsx`    | TanStack Query config          | staleTime, gcTime, retry count                         |
| `src/providers/ThemeProvider.tsx`    | Dark/light theme               | Theme persistence                                      |
| `src/App.tsx`                        | Provider composition           | Correct nesting order                                  |

#### Query Hooks

| File                               | Purpose                         | What to Verify                                |
| ---------------------------------- | ------------------------------- | --------------------------------------------- |
| `src/hooks/queries.ts`           | Session, workflow, chat queries | Polling intervals; cache invalidation         |
| `src/hooks/workflowQueries.ts`   | Definition + run queries        | Stale time (30s); optimistic updates          |
| `src/hooks/projectQueries.ts`    | Project + codebase queries      | Branch/file listing                           |
| `src/hooks/automationQueries.ts` | Automation queries              | Conditional polling (faster during execution) |

### SSE Manager Deep-Dive

The `sseManager.ts` is the **highest-complexity frontend file** (~500+ lines). Key internal state per connection:

```typescript
interface ConnectionState {
  scope: 'chat' | 'run' | 'session' | 'global';
  scopeId: string;
  primarySessionId: string;
  refCount: number;                     // Multiple components sharing one connection
  eventSource: EventSource | null;
  replayed: boolean;                    // True after REST initial replay
  pendingSSEEvents: PersistedEvent[];   // Buffered during replay
  lastReplayedSequence: number;
  maxSeenSequence: number;
  seenSequenceIds: Set<number>;         // Dedup by sequence ID
  
  // Buffer state for temporal ordering
  tokenBuf: string;                     // Accumulated text tokens
  thinkingBuf: string;                  // Accumulated thinking tokens
  flushTimer: ReturnType<typeof setInterval> | null;  // 100ms flush
  idleTimer: ReturnType<typeof setTimeout> | null;    // 5s idle cleanup
  currentStageRunId: string | null;
}
```

**Critical Pattern — Cross-Buffer Flush:**

```
Before emitting a TOKEN event:  flush any pending THINKING buffer first
Before emitting a THINKING event:  flush any pending TOKEN buffer first
```

This ensures correct temporal ordering in the UI. **Breaking this pattern causes visual corruption.**

### Phase 6 Review Checklist

- [ ] sseManager cross-buffer flush ordering preserved (thinking↔token boundary)
- [ ] sseManager dedup via `seenSequenceIds` prevents duplicate event processing
- [ ] sseManager replay + buffer merge produces gap-free event stream
- [ ] sseManager EventSource reconnection uses Last-Event-ID automatically
- [ ] sseManager cleanup: intervals cleared on disconnect; no memory leaks
- [ ] streamStore temporal block ordering correct (new block on type change)
- [ ] streamStore turnId dedup (WEB-02) prevents duplicate messages on reconnect
- [ ] workflowBuilderStore undo/redo doesn't accumulate unbounded history
- [ ] workflowBuilderStore isDirty flag accurately tracks unsaved changes
- [ ] HttpPlatformClient covers ALL IPlatformClient methods
- [ ] API key stored in localStorage (acceptable for localhost-only trust boundary)
- [ ] ApiError properly surfaces server error codes + messages
- [ ] All pages wrapped with PageErrorBoundary (no unhandled crashes)
- [ ] Lazy loading: no circular imports between pages
- [ ] Query cache invalidation triggered correctly by SSE events
- [ ] Timer cleanup on component unmount (no stale interval/timeout references)
- [ ] React Flow: node/edge IDs are stable across renders (no unnecessary re-renders)

---

## Phase 7 — CLI Application: `apps/cli/`

### What This App Does

Commander.js CLI with **35+ commands** and Ink-based TUI (React-in-terminal). Supports two operational modes:

- **Direct:** In-process execution using its own composition root (no server needed)
- **HTTP:** Delegates to running server via fetch + EventSource

### End-to-End Pipeline

```
User runs: generatorai workflow run <defId> --var key=value --direct

  Commander.js parses → global options extracted:
    --config <path>: custom config file
    --verbose: debug logging
    --json: JSON output format
    --server <url>: force HTTP mode
    --direct: force direct mode

  createClient(mode):
    HTTP mode → HttpPlatformClient(serverUrl)
    Direct mode → load config → createContainer() → DirectPlatformClient(container)
    Auto → HTTP if --server set, else direct

  workflowRun command:
    → Parse --var options into Record<string, string>
    → client.createRun(defId, { variables })
    → client.startRun(runId)
    → If --detach: print run ID and exit
    → Else: subscribe to events → render DAGProgress in Ink
      → Real-time stage progress bars in terminal
      → On completion: print summary and exit

TUI mode: generatorai tui
  → Ink App shell renders full-screen terminal UI
  → Dashboard view with navigation (keyboard shortcuts)
  → Views: Chat, Workflow, Automation, Approvals, Settings
  → Each view uses platform client for data operations
```

### Files to Review

#### Platform Layer

| File                                     | Purpose                         | What to Verify                                                   |
| ---------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| `src/platform/createClient.ts`         | Mode detection + client factory | auto→direct fallback logic; config path resolution              |
| `src/platform/DirectPlatformClient.ts` | In-process IPlatformClient      | Mirrors server composition root; lifecycle (initialize/shutdown) |
| `src/platform/HttpPlatformClient.ts`   | HTTP mode client                | EventSource for SSE; API key from env; error mapping             |
| `src/platform/composition-root.ts`     | CLI-specific DI container       | Same services as server minus HTTP/SSE infrastructure            |

#### Commands (35+ Total)

**Chat Commands:**

| Command                        | File                        | What to Verify                          |
| ------------------------------ | --------------------------- | --------------------------------------- |
| `chat start`                 | `commands/chatStart.tsx`  | Interactive mode; SSE streaming display |
| `chat list`                  | `commands/chatList.tsx`   | Status filter; JSON output              |
| `chat resume`                | `commands/chatResume.tsx` | Session reconnection                    |
| `chat update/archive/delete` | `commands/chatManage.ts`  | Confirmation prompts                    |

**Workflow Definition Commands:**

| Command                              | File                                 | What to Verify                       |
| ------------------------------------ | ------------------------------------ | ------------------------------------ |
| `workflow list/show/create/delete` | Various                              | CRUD operations; Ink table rendering |
| `workflow validate <id>`           | `commands/workflowImportExport.ts` | DAG validation output                |
| `workflow import-json <file>`      | `commands/workflowImportExport.ts` | File reading; JSON parsing safety    |
| `workflow export <id>`             | `commands/workflowImportExport.ts` | File writing; stdout option          |

**Workflow Stage/Edge Commands:**

| Command                              | File                          | What to Verify                             |
| ------------------------------------ | ----------------------------- | ------------------------------------------ |
| `workflow stage add/update/remove` | `commands/workflowStage.ts` | Prompt reading from file; order management |
| `workflow edge add/remove`         | `commands/workflowEdge.ts`  | Edge type validation                       |

**Workflow Run Commands:**

| Command                                      | File                                 | What to Verify                                     |
| -------------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| `workflow run <defId>`                     | `commands/workflowRun.tsx`         | --var parsing; --detach mode; DAG progress display |
| `workflow watch <runId>`                   | `commands/workflowWatch.tsx`       | Real-time SSE rendering in terminal                |
| `workflow pause/resume/cancel <runId>`     | `commands/workflowControl.tsx`     | Confirmation prompts; state validation             |
| `workflow status <runId>`                  | `commands/workflowStatus.tsx`      | Detailed stage-by-stage display                    |
| `workflow permission-mode <runId>`         | `commands/workflowStageControl.ts` | HITL mode show/set                                 |
| `workflow pending <runId>`                 | `commands/workflowStageControl.ts` | List awaiting_input stages                         |
| `workflow stage-approve <runId> <stageId>` | `commands/workflowStageControl.ts` | Approve/reject with --value/--reason               |

**Automation Commands:**

| Command                         | File                                     | What to Verify                     |
| ------------------------------- | ---------------------------------------- | ---------------------------------- |
| `automation create`           | `commands/automationCreate.ts`         | 20+ options; input mode validation |
| `automation trigger <id>`     | `commands/automationControl.ts`        | --detach mode                      |
| `automation test-data-source` | `commands/automationTestDataSource.ts` | Script/HTTP/file execution safety  |

**System Commands:**

| Command              | File                      | What to Verify                                   |
| -------------------- | ------------------------- | ------------------------------------------------ |
| `init [directory]` | `commands/init.tsx`     | Config file creation; --wizard interactive setup |
| `health`           | `commands/health.ts`    | Copilot + DB status                              |
| `config show/set`  | `commands/configCmd.ts` | Safe config mutation                             |

#### TUI (Terminal UI)

| File                                       | Purpose                    | What to Verify                       |
| ------------------------------------------ | -------------------------- | ------------------------------------ |
| `src/tui/App.tsx`                        | Main TUI shell             | View routing; keyboard navigation    |
| `src/tui/views/ChatView.tsx`             | Interactive chat           | Input + streaming output in terminal |
| `src/tui/views/WorkflowRunView.tsx`      | DAG progress visualization | Stage status; progress bars          |
| `src/tui/views/PendingApprovalsView.tsx` | HITL approvals             | Approve/reject workflow              |
| `src/components/DAGProgress.tsx`         | DAG progress bars          | Stage completion percentage          |
| `src/components/ChatViewV2.tsx`          | Chat rendering in Ink      | Token streaming display              |
| `src/components/StreamingOutput.tsx`     | Streaming response         | Buffer management                    |

### Phase 7 Review Checklist

- [ ] DirectPlatformClient mirrors server composition root (functional parity)
- [ ] HttpPlatformClient handles ALL IPlatformClient methods (no missing endpoints)
- [ ] Direct mode composition root initializes and shuts down cleanly
- [ ] CLI graceful shutdown closes SDK sessions (direct mode) / HTTP connections (HTTP mode)
- [ ] All commands have consistent error handling (try/catch wrapper in index.tsx)
- [ ] `--json` output format works for all list/show commands
- [ ] `--detach` mode returns immediately with run ID (no blocking)
- [ ] Variable parsing (`--var key=value`) handles edge cases (values with =, spaces)
- [ ] TUI views correctly subscribe/unsubscribe from events on mount/unmount
- [ ] TUI doesn't leak memory on rapid view switching
- [ ] Ink components handle terminal resize gracefully
- [ ] Config file creation (init) doesn't overwrite existing files without confirmation
- [ ] `automation test-data-source` doesn't execute arbitrary scripts without user confirmation

---

## Phase 8 — E2E Tests & CI

### What This Covers

Playwright browser E2E tests (3 suites), Vitest unit tests (~50 files across all packages), and CI pipeline configuration.

### End-to-End Pipeline

```
CI Pipeline (.github/workflows/ci.yml):
  push/PR to main →
    1. pnpm install --frozen-lockfile
    2. turbo build (all packages in dependency order)
    3. turbo lint (ESLint across monorepo)
    4. turbo typecheck (tsc --noEmit)
    5. turbo test (Vitest unit tests)

E2E Tests (agent-tests/):
  Requires running server + web:
    1. Start server (port 3100)
    2. Start web (port 5173, or TARGET_URL env)
    3. npx playwright test
       → Serial execution (1 worker, for agent determinism)
       → Chromium only
       → 60s test timeout, 10s assertion timeout
       → Screenshots/traces/videos on failure
```

### Test Files to Review

#### Playwright E2E (agent-tests/)

| File                                   | Purpose                  | What to Verify                                         |
| -------------------------------------- | ------------------------ | ------------------------------------------------------ |
| `workflow-e2e.spec.ts`               | Basic workflow execution | Happy path: create→define→run→complete              |
| `workflow-comprehensive-e2e.spec.ts` | Full feature coverage    | Edge cases: parallel stages, conditions, retry, cancel |
| `error-boundary.spec.ts`             | Error handling scenarios | Error recovery; boundary UI; no crashes                |

#### Core Package Unit Tests (packages/core/__tests__/)

| File                                  | Coverage Area                     | Status    |
| ------------------------------------- | --------------------------------- | --------- |
| `DAGScheduler.test.ts`              | Topological sort, edge conditions | ✅ Strong |
| `DAGValidator.test.ts`              | Cycle detection, validation       | ✅ Strong |
| `EventBus.test.ts`                  | Persistence + broadcast           | ✅ Strong |
| `StageRunStateMachine.test.ts`      | Stage lifecycle                   | ✅ Strong |
| `WorkflowRunStateMachine.test.ts`   | Run lifecycle                     | ✅ Strong |
| `SessionStateMachine.test.ts`       | Session lifecycle                 | ✅ Strong |
| `SessionStateMachineV2.test.ts`     | v2 session lifecycle              | ✅ Strong |
| `WorkflowStateMachine.test.ts`      | v1 workflow lifecycle             | ✅        |
| `StageExecutionService.test.ts`     | Prompt→SDK→artifacts            | ✅        |
| `WorkflowRunService.test.ts`        | Run CRUD + lifecycle              | ✅        |
| `WorkflowDefinitionService.test.ts` | Definition CRUD                   | ✅        |
| `ChatManagementService.test.ts`     | Chat CRUD                         | ✅        |
| `HookExecutor.test.ts`              | Hook execution                    | ✅        |
| `HitlService.test.ts`               | HITL interrupt/resume             | ✅        |
| `DurableSleepService.test.ts`       | Sleep sweep                       | ✅        |
| `StreamBroker.test.ts`              | Event routing                     | ✅        |
| `RunLogger.test.ts`                 | JSONL logging                     | ✅        |
| `Section8Integration.test.ts`       | Custom tools + MCP                | ✅        |
| `MockCopilotPort.ts`                | Test double                       | Helper    |
| `MockRepositories.ts`               | Test doubles                      | Helper    |

#### Server Integration Tests (apps/server/__tests__/)

| File                                              | Coverage Area                       |
| ------------------------------------------------- | ----------------------------------- |
| `routes/workflowRuns-e2e.test.ts`               | Run CRUD, filtering, lifecycle      |
| `routes/workflowDefinitions-e2e.test.ts`        | Definition CRUD, validation, export |
| `routes/chats-e2e.test.ts`                      | Chat CRUD, messaging                |
| `routes/health-templates-copilot-hooks.test.ts` | Health, templates, hooks            |
| `routes/webhooks.test.ts`                       | HMAC verification, Bearer auth      |
| `middleware/auth.test.ts`                       | Token authentication                |
| `middleware/middleware.test.ts`                 | Global middleware                   |

#### Web UI Tests (apps/web/src/__tests__/)

| File                                    | Coverage Area                |
| --------------------------------------- | ---------------------------- |
| `stores/sseManager.test.ts`           | SSE reconnect, replay, dedup |
| `stores/streamStore.test.ts`          | Token blocks, thinking       |
| `stores/workflowBuilderStore.test.ts` | Builder state management     |
| `stores/workflowRunStore.test.ts`     | Run monitoring state         |
| `stores/stores.test.ts`               | Core store interactions      |
| `utils/replayEvents.test.ts`          | Event reconstruction         |
| `utils/dagLayout.test.ts`             | DAG visualization layout     |

#### Test Coverage Gaps

| Area                                        | Status                              | Risk   |
| ------------------------------------------- | ----------------------------------- | ------ |
| State machines                              | ✅ Strong                           | Low    |
| DAG engine                                  | ✅ Strong                           | Low    |
| EventBus                                    | ✅ Strong                           | Low    |
| Infrastructure (GitManager, script runners) | ⚠️ Absent                         | Medium |
| Hooks (full integration)                    | ⚠️ Partial                        | Medium |
| copilot-bridge (end-to-end)                 | ⚠️ Minimal (2 files)              | High   |
| Streaming (backpressure, filtering)         | ⚠️ Partial                        | Medium |
| Database repositories                       | ⚠️ Absent (tested via server e2e) | Medium |
| CLI commands (functional)                   | ⚠️ Partial (7 files)              | Low    |
| Security (path traversal, injection)        | ⚠️ No dedicated tests             | High   |

### Phase 8 Review Checklist

- [ ] CI pipeline runs ALL critical checks (build/lint/typecheck/test) in correct order
- [ ] CI uses `--frozen-lockfile` (no surprise dependency changes)
- [ ] E2E tests cover happy path AND error scenarios
- [ ] E2E tests use `maxFailures: 1` to fail fast
- [ ] Unit test mocks match real repository interfaces (no stale mocks)
- [ ] No flaky tests from timing-dependent assertions (timeouts, sleep, race conditions)
- [ ] Test coverage for security-critical paths (path traversal, script execution, auth)
- [ ] MockCopilotPort accurately simulates SDK behavior for service tests

---

## Risk-Priority Matrix

| Priority     | File                                             | Risk                               | Why                                                                                      | Impact if Bug                                                                |
| ------------ | ------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **P0** | `core/services/EventBus.ts`                    | Per-session promise queue ordering | Bare `.catch(() => {})` on DB insert; breaking serialization causes SSE dedup failures | Events delivered out-of-order; web UI shows corrupted messages               |
| **P0** | `web/stores/sseManager.ts`                     | Cross-buffer flush                 | Thinking↔token temporal ordering is load-bearing                                        | Visual corruption: thinking text mixed into response; tokens in wrong blocks |
| **P0** | `core/services/StageExecutionService.ts`       | Path traversal                     | Must use `resolveWithinBase()` for ALL file writes                                     | Attacker can write files anywhere on host filesystem                         |
| **P0** | `core/infrastructure/SandboxedScriptRunner.ts` | Command injection                  | Allowlist must block all dangerous commands                                              | Arbitrary code execution on host                                             |
| **P1** | `core/services/DAGScheduler.ts`                | Stale DAG cache                    | Hash-based invalidation may miss mid-run definition edits                                | Wrong stages execute; runs complete incorrectly                              |
| **P1** | `core/services/SessionAllocator.ts`            | Session leak                       | Ref counting errors leave sessions open forever                                          | SDK resource exhaustion; memory leak                                         |
| **P1** | `server/routes/stream.ts`                      | FD exhaustion                      | Backpressure + connection cap must work correctly                                        | Server runs out of file descriptors; crashes                                 |
| **P1** | `server/routes/webhooks.ts`                    | Auth bypass                        | HMAC must use SHA256 + constant-time comparison                                          | Unauthorized webhook execution                                               |
| **P1** | `copilot-bridge/CopilotAdapter.ts`             | Listener leak                      | >50 handlers per conversation causes memory + CPU leak                                   | Process slowdown; eventual OOM                                               |
| **P2** | `db/repositories/DrizzleStageRunRepository.ts` | Double-resume race                 | Optimistic locking must prevent concurrent state changes                                 | Stage executes twice; duplicated output                                      |
| **P2** | `core/services/StreamBroker.ts`                | Missed events on subscribe         | Three-phase race condition                                                               | Client misses events permanently; stale UI                                   |
| **P2** | `core/services/HitlService.ts`                 | Lost approvals on crash            | In-memory awaiter must sync with DB durability                                           | User approval lost; stage stuck                                              |
| **P2** | `db/DrizzleSequenceAllocator.ts`               | Sequence gaps under contention     | Retry logic must handle all failure modes                                                | Events permanently lost in replay                                            |
| **P3** | `shared/errors/index.ts`                       | Incorrect HTTP statuses            | Error→status mapping accuracy                                                           | Wrong status codes confuse clients                                           |
| **P3** | `db/migrate.ts`                                | Data loss on migration             | `safeAddColumn` error handling                                                         | Data corruption on schema changes                                            |
| **P3** | `core/services/AutomationService.ts`           | Double-execution                   | Cross-process lease correctness                                                          | Automation runs twice                                                        |

---

## Cross-Cutting Concerns Checklist

### Security

- [ ] **Path Traversal:** All file I/O uses `resolveWithinBase()` + symlink check
- [ ] **Command Injection:** SandboxedScriptRunner allowlist is complete
- [ ] **SQL Injection:** All queries use Drizzle ORM (parameterized by default)
- [ ] **XSS:** React auto-escapes; `dangerouslySetInnerHTML` not used without sanitization
- [ ] **CORS:** Production requires explicit origin allowlist
- [ ] **Auth:** Bearer token + API key; constant-time comparison where applicable
- [ ] **Webhook Auth:** GitHub HMAC SHA256 pinned; no weak algorithms
- [ ] **Rate Limiting:** Applied after auth; per-key + global budgets
- [ ] **Body Size:** JSON 2MB limit prevents payload bombs
- [ ] **Sensitive Data:** Logger redacts apiKey/token/secret/password patterns
- [ ] **Error Exposure:** Stack traces only in development mode
- [ ] **Connection Limits:** SSE caps prevent FD exhaustion

### Correctness

- [ ] **Event Ordering:** EventBus per-session promise chain preserves order
- [ ] **Deduplication:** SSE clients use seenSequenceIds Set
- [ ] **Idempotency:** Webhook deliveries use unique delivery_id
- [ ] **Race Conditions:** StageRun optimistic locking (version field)
- [ ] **State Machines:** All transitions validated; invalid transitions throw
- [ ] **DAG Correctness:** Cycle detection; edge condition evaluation
- [ ] **Timer Cleanup:** All setInterval/setTimeout cleaned up on unmount/disconnect

### Reliability

- [ ] **Crash Recovery:** StartupRecoveryService recovers runs + sessions
- [ ] **Reconnection:** SSE Last-Event-ID enables gap-free reconnect
- [ ] **Backpressure:** Slow SSE consumers disconnected at 256-frame buffer
- [ ] **Heartbeat:** 15s SSE heartbeat keeps connections alive through proxies
- [ ] **Graceful Shutdown:** Drain connections → stop services → close DB → exit
- [ ] **Resource Cleanup:** Sessions released; sandboxes destroyed; timers cleared

### Observability

- [ ] **Request Correlation:** x-request-id propagated through all layers
- [ ] **Structured Logging:** Pino with JSON output + field redaction
- [ ] **Metrics:** OTel HTTP duration/count + SDK prompt metrics + listener metrics
- [ ] **Tracing:** Optional OTel spans with session/run/stage context
- [ ] **Audit Trail:** All events persisted to SQLite + per-run JSONL files

---

## Recommended Review Schedule

| Phase   | Estimated Scope      | Depends On                        |
| ------- | -------------------- | --------------------------------- |
| Phase 1 | ~27 files, ~3000 LOC | Nothing (start here)              |
| Phase 2 | ~34 files, ~8000 LOC | Phase 1 (types/errors)            |
| Phase 3 | ~22 files, ~4000 LOC | Phase 1 (types), Phase 2 (ports)  |
| Phase 4 | ~6 files, ~2000 LOC  | Phase 1 (events), Phase 2 (ports) |
| Phase 5 | ~22 files, ~5000 LOC | Phases 1-4 (all packages)         |
| Phase 6 | ~50 files, ~8000 LOC | Phase 1 (types), Phase 5 (API)    |
| Phase 7 | ~35 files, ~5000 LOC | Phase 1 (types), Phase 5 (API)    |
| Phase 8 | ~50 files, ~4000 LOC | All phases (validates everything) |

**Total estimated scope:** ~250 files, ~39,000 LOC of application code.

---

## Appendix: Key Environment Variables

| Variable                            | Purpose                            | Default                          |
| ----------------------------------- | ---------------------------------- | -------------------------------- |
| `PORT`                            | Server HTTP port                   | 3100                             |
| `DB_PATH`                         | SQLite database path               | ~/.generatorai/db/generatorai.db |
| `WORKSPACES_DIR`                  | Workspace root for git clones      | —                               |
| `GENERATORAI_API_KEY`             | Optional auth token                | (disabled)                       |
| `GENERATORAI_SSE_CAP_PER_SCOPE`   | Max SSE connections per scope      | 6                                |
| `GENERATORAI_SHUTDOWN_TIMEOUT_MS` | Graceful shutdown timeout          | 60000                            |
| `GENERATORAI_RATE_LIMIT_*`        | Rate limit config                  | 60/min per-key                   |
| `GENERATORAI_ALLOW_HOST_SANDBOX`  | Enable host-process sandbox        | false                            |
| `SANDBOX_ENABLED`                 | Enable sandbox feature             | false                            |
| `SANDBOX_PROVIDER`                | docker or host                     | docker                           |
| `COPILOT_DEBUG`                   | Copilot SDK debug logging          | false                            |
| `ANTHROPIC_API_KEY`               | Anthropic API key (opt-in harness) | —                               |
| `OTEL_ENABLED`                    | Enable OpenTelemetry               | false                            |
| `NODE_ENV`                        | development or production          | development                      |

---

*Document generated by automated codebase analysis. Review findings should be validated against current source code.*
