# Architecture Review & Improvement Roadmap

> **Date:** May 11, 2026  
> **Scope:** Full server app end-to-end analysis — composition root, route layer, core services, DB/shared packages, harness providers, test coverage  
> **Method:** 6 parallel subagent deep-dives + modern best practices research

---

## Table of Contents

1. [Critical Issues (Fix Immediately — P0)](#1-critical-issues-fix-immediately--p0)
2. [High-Priority Architectural Issues (P1)](#2-high-priority-architectural-issues-p1)
3. [Medium-Priority: Separation of Concerns (P2)](#3-medium-priority-separation-of-concerns-p2)
4. [Modularity & Future Integrations (P3)](#4-modularity--future-integrations-p3)
5. [Route Layer Findings](#5-route-layer-findings)
6. [Core Services Findings](#6-core-services-findings)
7. [DB & Shared Package Findings](#7-db--shared-package-findings)
8. [Harness Provider Findings](#8-harness-provider-findings)
9. [Test Coverage Gaps](#9-test-coverage-gaps)
10. [Best Practices Comparison](#10-best-practices-comparison)
11. [Priority Action Plan](#11-priority-action-plan)

---

## 1. Critical Issues (Fix Immediately — P0)

### 1.1 Silent Harness Initialization Failure

**File:** `apps/server/src/composition-root.ts` ~line 536  
**Severity:** CRITICAL

The server catches harness init errors and logs only a `warn`, then continues in so-called "degraded mode." In reality, **every workflow and chat will fail** since the harness is broken. The application appears healthy but is completely non-functional.

```typescript
// CURRENT (BROKEN):
try {
  await harness.initialize();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.warn(`[Container] Harness initialization failed (degraded mode): ${msg}`);
  // Server continues — all workflows will fail silently
}

// RECOMMENDED:
try {
  await harness.initialize();
  logger.info('[Container] Harness provider initialized successfully');
} catch (err) {
  // Make it fatal — a broken harness means the server cannot function
  logger.error('[Container] FATAL: Harness initialization failed', err);
  throw err; // Abort startup
}
```

**Alternative (if degraded mode is intentional):** Expose `container.harnessReady: boolean` that all workflow/chat routes check before accepting requests, returning `503 Service Unavailable`.

---

### 1.2 Missing Shutdown Cleanup — Data Loss Risk

**File:** `apps/server/src/composition-root.ts` ~line 573  
**Severity:** CRITICAL

`shutdown()` cleans 8 services but misses several critical ones. On SIGTERM, in-flight events and polling loops are orphaned.

**Missing cleanup for:**
- `streamBroker` — pending publishes not flushed; SSE events lost
- `eventBus` — per-session emit queues not drained; sequence gaps on next boot
- `WorkflowRunService.pollingIntervals` Map — orphaned `setInterval()` calls
- `recoveryService` — never notified of shutdown

**Fix:**
```typescript
async shutdown(): Promise<void> {
  // Existing:
  scriptRunner.shutdown();
  automationService.shutdown();
  eventRetentionService.stop();
  durableSleepService.stop();
  worktreeCleanupService.stop();
  if (sandboxLifecycleManager) await sandboxLifecycleManager.destroyAll();

  // Add these:
  await eventBus.flush();         // Drain per-session emit queues
  await streamBroker.flush();     // Drain pending publishes
  workflowRunService.shutdown();  // Clear polling intervals

  await harness.shutdown();
  closeDB(db);
}
```

---

### 1.3 In-Memory State Not Surviving Restarts

**File:** `packages/core/src/services/WorkflowRunService.ts` ~line 49  
**Severity:** HIGH

```typescript
private processedStageRuns = new Set<string>(); // Lost on restart → duplicate execution
private pollingIntervals = new Map<string, NodeJS.Timeout>(); // Leaked on restart
```

The `processedStageRuns` Set is the dedup guard for stage execution. If the server restarts mid-run, all in-flight stages can be re-executed. Existing `stage_runs.status` in the DB already has this information — the Set is redundant AND unsafe.

**Fix:** Remove `processedStageRuns` Set and derive dedup from `stage_runs.status === 'running'` query instead.

---

## 2. High-Priority Architectural Issues (P1)

### 2.1 God-Object Container (38 Public Properties)

**File:** `apps/server/src/composition-root.ts`  
**Severity:** HIGH

The `Container` interface exposes all 38 services + repositories. Every route receives the full container, enabling access to any service without constraint.

**Problems:**
- Testing requires mocking all 38 properties
- Renaming any service propagates to 50+ files
- No compile-time enforcement that a route only uses its services
- Impossible to add per-route access control

**Current (antipattern):**
```typescript
export interface Container {
  config: AppConfig;
  logger: ILogger;
  eventBus: EventBus;
  sessionService: SessionService;
  artifactService: ArtifactService;
  webhookService: WebhookService;
  chatManagementService: ChatManagementService;
  workflowDefinitionService: WorkflowDefinitionService;
  workflowRunService: WorkflowRunService;
  dagScheduler: DAGScheduler;
  stageExecutionService: StageExecutionService;
  sessionAllocator: SessionAllocator;
  workflowOrchestrator: WorkflowOrchestrator;
  automationService: AutomationService;
  hitlService: HitlService;
  projectService: ProjectService;
  codebaseService: CodebaseService;
  worktreeService: WorktreeService;
  workspaceManager: WorkspaceManager;
  // ... 18 more
}
```

**Recommended — Domain Module Facades:**
```typescript
// Each route receives only what it needs
interface WorkflowModule {
  workflowRunService: WorkflowRunService;
  workflowDefinitionService: WorkflowDefinitionService;
  dagScheduler: DAGScheduler;
  stageExecutionService: StageExecutionService;
  hitlService: HitlService;
}

interface ChatModule {
  chatManagementService: ChatManagementService;
}

interface ProjectModule {
  projectService: ProjectService;
  codebaseService: CodebaseService;
  worktreeService: WorktreeService;
  projectConfigService: ProjectConfigService;
}

// Route factory takes only its module:
export function createWorkflowRoutes(module: WorkflowModule): Router { ... }
export function createChatRoutes(module: ChatModule): Router { ... }
```

---

### 2.2 Late-Binding / Setter Injection (Circular Dependency)

**File:** `apps/server/src/composition-root.ts` ~line 495  
**Severity:** HIGH

```typescript
// Services created inside createCoreServices() at line ~330
// WorkspaceManager not created until line ~509
// Solution: setter injection after the fact — an antipattern

workflowRunService.setWorkspaceManager(workspaceManager);                    // line 495
workflowRunService.setWorktreeService(worktreeService, projectCodebaseRepo); // line 496
stageExecutionService.setWorkspaceManager(workspaceManager);                 // line 497

// chatExtensions object mutated by reference after passing to createCoreServices
chatExtensions.worktreeService = worktreeService;  // line 511
chatExtensions.workspaceManager = workspaceManager; // line 512
```

This signals circular DI: `createCoreServices()` creates WorkflowRunService before WorkspaceManager exists.

**Recommended fix — Phase split:**
```typescript
// Phase A: Event & session services (no workspace dep)
const coreBase = createCoreBaseServices({ harness, repos, ... });

// Phase B: Workspace infrastructure
const workspaceManager = new WorkspaceManager(...);
const worktreeService = new WorktreeService(...);

// Phase C: Orchestration services (have workspace)
const coreOrchestration = createCoreOrchestrationServices({
  ...coreBase,
  workspaceManager,
  worktreeService,
});
```

---

### 2.3 Business Logic Inline in Composition Root (85 Lines)

**File:** `apps/server/src/composition-root.ts` ~lines 352–412  
**Severity:** MEDIUM-HIGH

The EventBus → StreamBroker bridge contains scope-routing logic, FK field extraction, and error handling all inline in the DI container factory. This is completely untestable without the full EventBus/StreamBroker stack.

**Extract to `EventStreamBridge` class:**
```typescript
// packages/core/src/services/EventStreamBridge.ts
export class EventStreamBridge {
  private unsubscribes: Array<() => void> = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly streamBroker: StreamBroker,
    private readonly logger: ILogger,
  ) {}

  start(): void {
    const unsubAll = this.eventBus.subscribeAll((event) => this.bridge(event));
    const unsubGlobal = this.eventBus.subscribeGlobal((event) =>
      this.bridge({ sessionId: '__global__', ...event })
    );
    this.unsubscribes.push(unsubAll, unsubGlobal);
  }

  stop(): void {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
  }

  private bridge(event: BridgeEvent): void {
    const runId = this.readString(event.data, 'workflowRunId');
    const chatId = this.readString(event.data, 'chatId');
    const scope = event.sessionId === '__global__' ? 'global' : 'session';
    const scopeId = event.sessionId === '__global__' ? 'all' : event.sessionId;

    this.publish(scope, scopeId, event.kind, event.data);
    if (runId) this.publish('run', runId, event.kind, event.data);
    if (chatId) this.publish('chat', chatId, event.kind, event.data);
  }

  private publish(scope: StreamScope, id: string, kind: string, data: unknown): void {
    this.streamBroker.publish(scope, id, kind, data).catch((err) => {
      this.logger.warn('[EventStreamBridge] publish failed', err);
    });
  }
}
```

---

### 2.4 Raw Repository Exposure (Layering Violation)

**File:** `apps/server/src/composition-root.ts` ~line 598  
**Severity:** HIGH

Five raw Drizzle repositories are exposed on the Container and accessed directly from route handlers:

```typescript
// Exposed on Container:
workflowRepo: InstanceType<typeof DrizzleWorkflowRepository>;
chatEntityRepo: InstanceType<typeof DrizzleChatRepository>;
chatMessageRepo: InstanceType<typeof DrizzleChatMessageRepository>;
workflowRunRepo: InstanceType<typeof DrizzleWorkflowRunRepository>;
stageRunRepo: InstanceType<typeof DrizzleStageRunRepository>;
```

**Routes that bypass services:**

| File | Line | Issue |
|------|------|-------|
| `health.ts` | 22–28 | `chatEntityRepo.getByStatus()`, `workflowRunRepo.getByStatus()` |
| `sessions.ts` | 13 | `chatMessageRepo.getBySessionAndStageRunId()` |
| `chats.ts` | 70 | `chatEntityRepo.getById()` |
| `workflowRuns.ts` | 66–72 | `workflowRunRepo.getById()` + `stageRunRepo.getByRunId()` |
| `workflowRuns.ts` | 198–200 | `stageRunRepo.resetForRetry()`, `incrementRetryCount()` |
| `hooks.ts` | 59 | `workflowRepo.getBySessionId()` |

**Fix:** Add service methods and remove repo exposure:
```typescript
// Add to WorkflowRunService:
async getById(id: string): Promise<WorkflowRun | null>
async getWithStages(id: string): Promise<WorkflowRunWithStages | null>
async resetStageForRetry(stageRunId: string): Promise<void>

// Add to ChatManagementService:
async getChatById(id: string): Promise<Chat | null>
```

---

## 3. Medium-Priority: Separation of Concerns (P2)

### 3.1 Fat Route Handlers

16 handler functions exceed 30 lines with embedded business logic:

| File | Approx Lines | Logic in Handler (Should Be in Service) |
|------|-------------|----------------------------------------|
| `orchestrator.ts` | 37 + 31 | Extension validation loop, path traversal defense, download logic |
| `workspaces.ts` | 49 | File content read + manual path traversal + truncation |
| `hooks.ts` | 44 | Data transformation, sorting, array building |
| `harness.ts` | 42 | Config assembly + conditional object creation |
| `workflowRuns.ts` | 24 + 28 | Async retry choreography, stage resume .then/.catch |
| `chats.ts` | 40 | File attachment loop, artifact creation |

**Pattern to enforce — thin controllers:**
```typescript
// BEFORE (fat handler):
router.post('/upload', upload.array('files'), async (req, res, next) => {
  const files = req.files as Express.Multer.File[];
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return res.status(400).json({ error: { code: 'INVALID_FILE_TYPE', ... } });
    }
    // ... 30 more lines
  }
});

// AFTER (thin controller):
router.post('/upload', upload.array('files'), validate(UploadFilesSchema), async (req, res, next) => {
  try {
    const result = await orchestratorService.uploadFiles(req.files, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
```

---

### 3.2 Missing Zod Validation (14 Endpoints)

These endpoints use inline `if (!x)` checks instead of the `validate()` middleware:

| Endpoint | File | Issue |
|----------|------|-------|
| `POST /harness/switch` | `harness.ts` | Hardcoded `validTypes` array check |
| `POST /projects` | `projects.ts` | Manual `name` check only |
| `POST /projects/:id/codebases` | `projects.ts` | Multiple `if (!x)` checks |
| `POST /projects/:id/mcp-servers` | `projects.ts` | No Zod schema |
| `GET /workflow-runs` | `workflowRuns.ts` | Inline status filter array comparison |
| `PATCH /workflow-runs/:id/permission-mode` | `workflowRuns.ts` | Inline string check |
| `POST /orchestrator/from-template` | `orchestrator.ts` | `!templateId` check |
| `POST /orchestrator/runs` | `orchestrator.ts` | `!workflowDefinitionId` check |
| `GET /stream/replay` | `stream.ts` | Inline `parseInt` validation |
| `POST /workspaces/cleanup` | `workspaces.ts` | No body schema |
| + 4 more GET filter endpoints | various | Missing filter validation |

---

### 3.3 initialize() Has 11 Unrelated Responsibilities

**File:** `apps/server/src/composition-root.ts` ~line 524

Current monolithic initialize():
1. Load workflow templates
2. Load system templates (nested if/existsSync)
3. Initialize harness provider
4. Register global lifecycle hooks
5. Restore event sequence counter
6. Recover interrupted sessions
7. Initialize automation cron jobs
8. Start event retention sweeper
9. Start durable sleep sweeper
10. Recover worktrees + start cleanup timer
11. Load system artifacts

**Recommended decomposition:**
```typescript
async initialize(): Promise<void> {
  await this.loadTemplates();           // Steps 1-2
  await this.initializeHarness();       // Step 3 (make it fatal)
  await this.recoverState();            // Steps 4-6
  this.startBackgroundWorkers();        // Steps 7-9
  await this.initializeProjectLayer();  // Step 10
  await this.loadSystemArtifacts();     // Step 11
}
```

---

### 3.4 AutomationService — Too Many Concerns

**File:** `packages/core/src/services/AutomationService.ts` ~line 59  
**Constructor params:** 10 (exceeds 7-param SRP threshold)

**Concerns mixed in one service:**
- Automation CRUD
- Cron scheduling with in-memory `Map<string, NodeJS.Timeout>`
- Batch data source processing
- Webhook trigger handling
- Execution cancellation (dual-track: `cancelledExecutions` Set + `executionAborts` Map)
- Execution history tracking

**Recommended split:**
```typescript
// 1. AutomationCrudService — pure CRUD
// 2. CronSchedulerService — owns cronJobs Map, setInterval/clearInterval
// 3. BatchExecutionService — data source → parallel run launch
// 4. (Keep) AutomationService as coordinator facade
```

---

## 4. Modularity & Future Integrations (P3)

### 4.1 No Plugin/Module System

Adding any new feature today requires touching 4+ files:
1. Add params to `createCoreServices()` inputs
2. Add initialization phase to `composition-root.ts`
3. Expose on `Container` interface
4. Mount route in `routes/index.ts`

**Modern pattern — self-contained modules:**
```typescript
// packages/core/src/modules/types.ts
interface ServerModule {
  name: string;
  services: Record<string, unknown>;
  routes?: (services: Record<string, unknown>) => Router;
  initialize?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

// apps/server/src/modules/workflow.module.ts
export const workflowModule: ServerModule = {
  name: 'workflow',
  services: { workflowRunService, dagScheduler, workflowDefinitionService },
  routes: (s) => createWorkflowRoutes(s as WorkflowModule),
  initialize: async () => dagScheduler.warmCache(),
  shutdown: async () => workflowRunService.shutdown(),
};

// apps/server/src/composition-root.ts
const modules: ServerModule[] = [
  workflowModule,
  chatModule,
  automationModule,
  projectModule,
];

await Promise.all(initialized.map(m => m.initialize?.()));
```

---

### 4.2 createCoreServices() Is a God Factory

**File:** `packages/core/src/bootstrap/createCoreServices.ts`

Accepts 24+ dependencies, returns 18 services. Every new service requires touching this single factory.

**Recommended — Domain Sub-Factories:**
```typescript
// Separate factories per domain
export function createEventServices(deps: EventDeps): EventServices {
  const eventBus = new EventBus(deps.eventRepo, deps.sequenceAllocator);
  return { eventBus };
}

export function createWorkflowServices(deps: WorkflowDeps & EventServices): WorkflowServices {
  const dagScheduler = new DAGScheduler(deps.stageDefinitionRepo, deps.stageEdgeRepo);
  const sessionAllocator = new SessionAllocator(deps.sessionAllocationRepo, deps.eventBus);
  // ...
  return { dagScheduler, sessionAllocator, workflowRunService, stageExecutionService };
}

export function createAutomationServices(deps: AutoDeps & WorkflowServices): AutoServices {
  // ...
}

// Compose in main factory:
export function createCoreServices(deps: CoreServicesDeps): CoreServices {
  const events = createEventServices(deps);
  const workflows = createWorkflowServices({ ...deps, ...events });
  const automations = createAutomationServices({ ...deps, ...workflows });
  return { ...events, ...workflows, ...automations };
}
```

---

### 4.3 Adding a New AI Provider Is Unnecessarily Hard

Currently adding a provider (OpenAI, Gemini, local LLM) requires:
- Implementing all 14 `IAgentHarness` methods from scratch
- Creating a bespoke event mapper (40+ event kind mappings)
- Creating a tool factory
- No shared base class or test harness to validate correctness

**Recommendations:**
```typescript
// 1. Abstract base class with shared utilities
abstract class AbstractAgentHarness implements IAgentHarness {
  protected readonly conversationListenerCleanups = new Map<string, Set<() => void>>();
  protected readonly metrics = new HarnessMetrics(this.providerName);

  protected trackListener(conversationId: string, cleanup: () => void): () => void {
    // Shared ORC-05 listener leak tracking
  }

  // Subclasses implement only the raw SDK calls:
  abstract _doSendPrompt(conversationId: string, prompt: string): Promise<void>;
}

// 2. Shared event mapper builder
function createEventMapper(kindMap: Record<string, AgentEventKind>): EventMapper {
  return (sdkEvent) => ({
    kind: kindMap[sdkEvent.type] ?? 'harness.unknown',
    data: mapPayload(sdkEvent),
  });
}

// 3. Provider conformance test suite
// Run the SAME test set against every provider to ensure contract compliance
export function runProviderConformanceTests(provider: IAgentHarness): void {
  it('should initialize successfully', () => provider.initialize());
  it('should create and delete a conversation', async () => { ... });
  // ...
}
```

---

### 4.4 Sandbox Provider Selection Inline (42-Line Logic Block)

**File:** `apps/server/src/composition-root.ts` ~lines 160–202

Complex Docker-detection + host-fallback + config-validation logic is inline in the composition root, making it untestable and hard to extend.

**Extract to factory:**
```typescript
// packages/core/src/sandbox/SandboxProviderFactory.ts
export class SandboxProviderFactory {
  static async create(config: SandboxConfig, logger: ILogger): Promise<ISandboxProvider | null> {
    if (!config.enabled) return null;

    if (config.provider === 'docker' || config.provider === 'auto') {
      const docker = new DockerSandboxProvider(logger);
      if (await docker.isAvailable()) return docker;
      if (config.provider === 'docker') {
        throw new SandboxConfigError('Docker required but not available');
      }
    }

    if (config.provider === 'host' || process.env['GENERATORAI_ALLOW_HOST_SANDBOX'] === 'true') {
      logger.error('[Sandbox] Using host-process sandbox — no isolation!');
      return new HostProcessSandboxProvider(logger);
    }

    throw new SandboxConfigError('No valid sandbox provider configured');
  }
}
```

---

## 5. Route Layer Findings

### Summary Statistics
- **18 route files** analyzed
- **95+ endpoints** total
- **16 fat handlers** (20–50+ lines)
- **14 endpoints** without Zod validation
- **8 direct repository accesses** bypassing services
- **0 controller abstractions** (all inline closures)
- **3+ duplicated file-handling patterns** across orchestrator + workspaces routes

### Response Format Inconsistency

Three different error response shapes found:

```typescript
// Style 1 (Preferred) — stream.ts, workflowRuns.ts
{ error: { code: 'INVALID_SCOPE', message: '...' } }

// Style 2 (Wrong) — automations.ts line 116
{ error: 'Webhook not found' }  // Plain string, no code

// Style 3 (Validation-specific) — chats.ts line 109
{ error: { code: 'VALIDATION_ERROR', message: '...', fields: {...} } }
```

**Fix:** Standardize on Style 1 everywhere. Use the error handler middleware for all error responses.

### Duplicated File-Handling Logic (Should Be Unified)

`orchestrator.ts` and `workspaces.ts` both implement:
- `resolveWithinBase()` path traversal defense (duplicated)
- File content read + truncation
- Extension filtering

Extract to a shared `FileService` or `WorkspaceFileService`.

---

## 6. Core Services Findings

### WorkflowRunService (13 Constructor Params — Over Threshold)

**File:** `packages/core/src/services/WorkflowRunService.ts`

Mixes 7+ concerns: run lifecycle + DAG orchestration + workspace initialization + worktree creation + stage dedup + retry + logging.

**Key risks:**
- `processedStageRuns` Set lost on restart → duplicate stage execution
- `pollingIntervals` Map orphaned on crash → memory leak
- Fire-and-forget `.catch()` swallows errors (line 316)
- Setter injection for WorkspaceManager (circular dep flag)

### AutomationService (10 Constructor Params)

**File:** `packages/core/src/services/AutomationService.ts`

- In-memory `cronJobs: Map` — intervals lost on restart; cron won't resume without re-initialization
- Dual cancellation paths: `cancelledExecutions Set` + `executionAborts Map` — inconsistent
- 800+ line service handling 8 concerns

### Well-Designed Services (Reference Patterns)

| Service | Params | What Makes It Good |
|---------|--------|-------------------|
| `SessionAllocator` | 4 | Focused, DB-persisted state, no setters |
| `EventBus` | 3 (all optional) | Per-session promise queue, subscriber isolation, commit-then-broadcast |
| `StreamBroker` | 2 | Two-phase subscribe, hard backpressure limits |
| `ChatManagementService` | 6 | Cohesive, optional extensions don't break core |

---

## 7. DB & Shared Package Findings

### 7.1 safeAddColumn() Silently Swallows Non-Duplicate Errors

**File:** `packages/db/src/migrations/index.ts` ~lines 169–184

```typescript
// CURRENT: Catches ALL errors but only checks "duplicate column"
try {
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
} catch (err) {
  if (!err.message.includes('duplicate column')) {
    // This path does nothing — disk-full errors silently pass
  }
}
```

**Impact:** Server boots appear successful, but columns are missing. Downstream code crashes at runtime.

**Fix:**
```typescript
} catch (err) {
  if (err instanceof Error && err.message.includes('duplicate column name')) {
    return; // Expected: column already exists
  }
  throw err; // Re-throw unexpected errors (disk full, permissions, etc.)
}
```

### 7.2 Summary of DB Package Health

| Aspect | Status | Notes |
|--------|--------|-------|
| Domain boundary | ✅ Clean | Zero domain logic leakage |
| Repository pattern | ✅ Excellent | `mapRow()` helpers return domain entities, not raw rows |
| Migration safety | ⚠️ Medium | safeAddColumn swallows non-duplicate errors |
| Event table growth | ✅ Managed | EventRetentionService with TTL, configurable sweep limits |
| Config validation | ✅ Complete | 8 nested areas fully validated + env-var overridable |
| Error hierarchy | ✅ Balanced | 20+ errors, 7 categories, `recoverable` flag |
| JSON column safety | ✅ Bulletproof | Symmetric Zod validation on read + write paths |

---

## 8. Harness Provider Findings

### 8.1 Provider Switching Is Unsafe for Active Conversations

**File:** `packages/agent-harness-providers/src/HarnessProxy.ts`

When `switchAdapter()` is called with active conversations, those conversations become silently inaccessible. The new adapter has no knowledge of them:

```typescript
// Old conversations in CopilotProvider.conversations Map
// New ClaudeAgentProvider.conversations Map starts empty
// SessionAllocator still holds those conversation IDs
// → sendPrompt(oldConversationId) will throw "No active conversation"
```

**Required pre-switch hook in composition-root.ts:**
```typescript
async function switchHarnessProvider(
  proxy: HarnessProxy,
  newType: HarnessType,
  config: AppConfig,
): Promise<void> {
  // 1. Drain active conversations
  const active = await proxy.listConversations();
  await Promise.all(active.map(id => proxy.destroyConversation(id)));

  // 2. Create and switch
  const newAdapter = await createHarnessProvider({ type: newType, ...config });
  await proxy.switchAdapter(newAdapter, newType);
}
```

### 8.2 CopilotProvider.forceStop() Memory Leak

**File:** `packages/agent-harness-providers/src/providers/copilot/CopilotProvider.ts` ~line 148

`forceStop()` stops the CLI but does NOT cleanup in-memory `CopilotSession` handles or their listener cleanups. `shutdown()` does cleanup, but if `forceStop()` is called without `shutdown()`, handles leak.

**Fix:**
```typescript
async forceStop(): Promise<void> {
  this.stopClientStatePolling();
  // Add: cleanup all conversations before force-stopping
  for (const [id] of this.conversations) {
    const cleanups = this.conversationListenerCleanups.get(id);
    cleanups?.forEach(fn => fn());
    this.conversationListenerCleanups.delete(id);
  }
  this.conversations.clear();
  await this.client.forceStop();
  this.emitClientEvent({ type: 'client.stopped', data: { message: 'Force stopped' } });
}
```

### 8.3 IAgentHarness Interface — No Changes Needed

The 14-method interface is well-decomposed into 5 logical groups (lifecycle, model discovery, conversation lifecycle, messaging, event subscription). Sub-interface splits were considered and rejected — they would break single-session semantics. HarnessProxy properly delegates all 14 methods.

---

## 9. Test Coverage Gaps

### Current State

| Category | Coverage | Notes |
|----------|----------|-------|
| Server route tests | 44% (8/18 files) | Only basic CRUD routes tested |
| Core service tests | 74% | SessionAllocator, HookInterceptor untested |
| DB repository tests | 7% (2/27) | Only EventRetentionService + migrations |
| E2E tests | Medium | Exist but NOT in CI pipeline |

### Untested Routes (High Risk)

| Route File | Endpoints | Risk |
|-----------|-----------|------|
| `automations.ts` | 12 | High — batch processing, cron |
| `projects.ts` | 25+ | Medium — complex validation |
| `workspaces.ts` | 8 | High — file ops, path traversal |
| `stream.ts` | 2 | High — backpressure, SSE replay |
| `orchestrator.ts` | 3 | High — file upload security |
| `sessions.ts` | 1 | Low |
| `harness.ts` | 2 | Medium — provider switching |
| `system.ts` | 3 | Low |
| `openapi.ts` | 2 | Low |

### Critical Testing Deficiencies

1. **No fixture factory** — `makeStageRun()`, `makeStageDef()` duplicated across test files; should be in `packages/core/__tests__/helpers/fixtures.ts`
2. **E2E tests have cascade failures** — `streaming-automation-e2e.spec.ts` test 1 creates a `definitionId` that test 2 depends on; if test 1 fails, test 2 fails too
3. **No DB constraint tests** — FK constraints, UNIQUE violations, concurrent writes never tested
4. **No contract tests** — Web client's SSE consumer never tested against the server's SSE producer format
5. **No security tests** — Path traversal protection in orchestrator.ts, webhook HMAC verification never automatically tested

### Recommended Priorities

```
1. Share fixture factory              — 30 min  (extract makeStageRun, makeStageDef, etc.)
2. Add afterEach cleanup              — 30 min  (prevent state leak between tests)
3. automation route tests             — 2 hrs   (12 endpoints, establish pattern for others)
4. projects route tests               — 90 min  (follow automation pattern)
5. stream/SSE replay test             — 2 hrs   (backpressure edge cases)
6. path traversal security tests      — 1 hr    (orchestrator, workspaces)
7. SessionAllocator unit tests        — 1 hr    (3 allocation modes)
8. Add e2e tests to CI                — 30 min  (playwright.config.ts already exists)
```

---

## 10. Best Practices Comparison

| Pattern | Current State | Industry Best Practice | Gap Level |
|---------|--------------|----------------------|-----------|
| **DI Container** | Hand-wired composition root | Module-based (NestJS) or typed container (awilix/tsyringe) | Medium — works but scales poorly |
| **Route layer** | Inline closures receiving full Container | Controller classes / typed handler functions with specific deps | High — fat handlers + repo leakage |
| **Error handling** | Global middleware only | Per-domain error mappers + Result types (`neverthrow`) | Medium — functional but loses context |
| **Background workers** | Mixed into composition root initialization | Dedicated worker abstraction (Bull/BullMQ pattern) | Medium — DurableSleep, cron, retention are all ad-hoc |
| **Config** | All env vars read in `index.ts` → single Zod object | Config module per domain, validated independently | Low — current works fine |
| **Observability** | OTel optional, Pino logging | Mandatory spans on all service calls, structured error context | Medium |
| **Testing** | 44% route coverage, no contract/property tests | 80%+ coverage, provider contracts, fixture factories | High |
| **Module system** | No plugin system; all features hardwired | Self-contained modules with lifecycle hooks | High — blocks future feature additions |

---

## 11. Priority Action Plan

### P0 — Safety Fixes (Do This Week)

| # | Action | File | Effort | Impact |
|---|--------|------|--------|--------|
| P0-1 | Make harness init failure fatal | `composition-root.ts` ~L536 | 1 line | Prevents silent broken server |
| P0-2 | Add `streamBroker.flush()` to shutdown | `composition-root.ts` ~L573 | 3 lines | Prevents SSE event loss |
| P0-3 | Add `eventBus.flush()` to shutdown | `composition-root.ts` ~L573 | 1 line | Prevents sequence gaps |
| P0-4 | Fix `safeAddColumn()` error swallowing | `packages/db/src/migrations/` | 3 lines | Prevents silent boot-time schema failures |

### P1 — High-Impact Architectural Fixes (This Sprint)

| # | Action | Files | Effort | Impact |
|---|--------|-------|--------|--------|
| P1-1 | Extract `EventStreamBridge` class | New file + composition-root | Low | Testable bridge, separates concerns |
| P1-2 | Remove raw repo exposure; add service query methods | 5 service files + routes | Medium | Clean layering, easier testing |
| P1-3 | Fix `processedStageRuns` — use DB status instead | `WorkflowRunService.ts` | Medium | Restart safety, no duplicate execution |
| P1-4 | Add pre-switch conversation cleanup to `POST /harness/switch` | `harness.ts` + composition-root | Low | Prevents orphaned conversations |
| P1-5 | Fix `CopilotProvider.forceStop()` cleanup | `CopilotProvider.ts` | Low | Prevents listener memory leak |
| P1-6 | Add Zod schemas to 14 missing endpoints | Various route files | Low | Validation consistency |

### P2 — Structural Improvements (Next Sprint)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| P2-1 | Split Container into domain module facades | Medium | Enables per-route access control, testing |
| P2-2 | Eliminate setter injection; split `createCoreServices` phases | High | Clean DI, no circular deps |
| P2-3 | Split AutomationService into 3 focused services | Medium | SRP compliance |
| P2-4 | Extract `SandboxProviderFactory` | Low | Testable, reusable |
| P2-5 | Decompose `initialize()` into named phases | Medium | SRP, phased failure recovery |
| P2-6 | Standardize response error format across all routes | Low | API consistency |
| P2-7 | Add automation + projects + stream route tests | Medium | Test coverage to ~70% |

### P3 — Future Architecture (Backlog)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| P3-1 | Implement module system for self-contained features | High | Extensibility for future integrations |
| P3-2 | Split `createCoreServices` into domain sub-factories | Medium | Maintainability |
| P3-3 | Add `AbstractAgentHarness` base class + provider conformance tests | Medium | Easy new provider addition |
| P3-4 | Unify `orchestrator.ts` + `workspaces.ts` file handling into `FileService` | Low | Eliminates duplication |
| P3-5 | Move background workers to dedicated abstraction (Bull/BullMQ pattern) | High | Durable job queues, restart-safe |
| P3-6 | Add e2e Playwright tests to CI pipeline | Low | Catch regression at integration level |

---

## Appendix: File Reference Index

| Concern | Primary File(s) |
|---------|----------------|
| DI Container / God Object | `apps/server/src/composition-root.ts` |
| Startup sequence | `apps/server/src/index.ts` |
| Middleware stack | `apps/server/src/app.ts` |
| Route mounting | `apps/server/src/routes/index.ts` |
| Event bridge | `apps/server/src/composition-root.ts` ~L352 |
| Harness init failure | `apps/server/src/composition-root.ts` ~L536 |
| Shutdown gaps | `apps/server/src/composition-root.ts` ~L573 |
| WorkflowRunService in-memory state | `packages/core/src/services/WorkflowRunService.ts` ~L49 |
| AutomationService monolith | `packages/core/src/services/AutomationService.ts` |
| Unsafe provider switch | `packages/agent-harness-providers/src/HarnessProxy.ts` |
| forceStop leak | `packages/agent-harness-providers/src/providers/copilot/CopilotProvider.ts` ~L148 |
| safeAddColumn bug | `packages/db/src/migrations/index.ts` ~L169 |
| Direct repo in routes | `apps/server/src/routes/chats.ts`, `workflowRuns.ts`, `health.ts`, `hooks.ts`, `sessions.ts` |
| Fat handlers | `apps/server/src/routes/orchestrator.ts`, `workspaces.ts`, `hooks.ts`, `harness.ts` |
| Missing validation | `apps/server/src/routes/harness.ts`, `projects.ts`, `workflowRuns.ts`, `stream.ts` |
