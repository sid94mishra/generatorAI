# Core + Packages — Test Inventory (core, db, shared, copilot-bridge, agent-harness-providers)

## Subsystems & key testable behaviors (file refs)

- **DAGScheduler** (`packages/core/src/services/DAGScheduler.ts`): buildDAGForDefinition + cache by definition hash (68-170), getRootStages/getReadyStages, edge-type evaluation (on_success/on_failure/on_completion/always), per-run FIFO op queue (22-63), cache invalidation on hash change.
- **ConditionEvaluator** (`domain/dag/ConditionEvaluator.ts`): on_success/on_failure/always (35-42), safe tokenizer+postfix expr eval (70-200, no eval()), dotted-var resolution (`variables.count < 5`).
- **DAGValidator** (`domain/dag/DAGValidator.ts`): cycle detection (74-88), self-edge (68-72), duplicate-edge (90-96), reference validation (98-100), topo sort, empty-DAG warning.
- **State machines** (`domain/state-machines/*`): SessionStateMachine (6 states/7 transitions: created→active→paused/closing/error→closed; canTransition/isTerminal/canAcceptPrompts), StageRun + WorkflowRun machines.
- **WorkflowRunService** (`services/WorkflowRunService.ts`): createRun (snapshot, atomic 144-180), startRun, pause/resume/cancel/retry, __workingDirectory inject (128), event-driven DAG routing, withTransaction (74-79).
- **StageExecutionService** (`services/StageExecutionService.ts`): prompt interpolation, **file output via tools vs fence fallback**, extractCodeBlocks classification, ResultValidator rules, retry policy (backoffMs*multiplier^attempt), timeout (AbortSignal), context filters summary-only/full/none, pause/resume/cancel.
- **SessionAllocator** (`services/SessionAllocator.ts`): single (refcount, idempotent), per-stage, auto; DB rehydrate.
- **EventBus** (`events/EventBus.ts`): per-session monotonic seq, commit-then-broadcast (99), per-session emit queue (serialize), persistFailures gap tracking, subscriber-error isolation, max listeners.
- **StreamBroker** (`services/StreamBroker.ts`): per-(scope,id) monotonic seq, synchronous replay on subscribe (118-125), attach-window dedup, kind-prefix filter (≤10), fire-and-forget handlers.
- **HookExecutor** (`services/HookExecutor.ts`): phases, script/http/function (in-proc + subprocess), per-hook timeout (AbortController), failure policy abort/continue/skip; resolveStageHooks merge (file['*']+[name]+inline).
- **interpolateVariables** (`shared/src/utils/index.ts:104-125`): dotted paths, flat-key priority, undefined→literal+collect, whitespace trim, single-pass, depth cap 16.
- **providers** (`agent-harness-providers`): event-mapper SDK→AgentEvent (tool_start/complete, reasoning_delta/complete, unknown fallback); permissionMap; **availableTools resolution (empty/['*']→all, list→subset)**.
- **db** (`packages/db`): EventRetentionService (TTL/sweep caps), validateJsonColumn, migrations idempotency, repositories CRUD.

## Existing coverage
GOOD: DAGScheduler, DAGValidator, EventBus, StreamBroker, SessionAllocator, SessionStateMachine, StageRun/WorkflowRun machines, HookExecutor, resolveStageHooks, WorkflowRunLifecycle.e2e, Section8Integration, EventRetentionService, validateJsonColumn, copilot-event-mapper.
PARTIAL: StageExecutionService, WorkflowRunService, HitlService, DurableSleep, HostProcessSandbox, ChatManagement, RunLogger, WorktreeCleanup, WorkflowDefinitionService.
NONE: ConditionEvaluator (own file), interpolation (own file), ResultValidator (own file), WorkflowScriptLoader, ProjectConfigService, WebhookService.

## Prioritized gaps
HIGH: ConditionEvaluator expr edge cases; interpolation edge cases; ResultValidator all rule types + routing; StageExecution retry/backoff/timeout + extractCodeBlocks classification + agent-wrote-files→skip-scrape; providers availableTools resolution; WorkflowRunService pause/resume/cancel/retry + tx; EventBus concurrency/persist-failure/subscriber-throw; DAGScheduler diamond join + cache invalidation.
MED: complex DAGs, file-extraction filename inference, event-driven routing, hook resolution/merge, db migrations idempotency, WorkflowScriptLoader, ProjectConfigService.
LOW: WebhookService, sandbox isolation, ChatManagement lifecycle, telemetry.

## Harness notes
- Mocks: `packages/core/__tests__/MockRepositories.ts` (in-memory Map repos), `MockAgentHarness.ts`.
- In-memory DB: `drizzle(new Database(':memory:'))` + `migrateDB(db)`; `pragma foreign_keys=ON`; clear in beforeEach.
- Service ctors accept ports → inject mocks. EventBus() in-memory or with repo.
- Utilities: generateId, deepMerge (cycle-safe), interpolateVariables, sleep (`shared/src/utils`).
