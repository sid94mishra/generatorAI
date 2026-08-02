# Requirements Analysis: Chat & Workflow Separation

> Generated: 2026-02-28  
> Scope: Architectural delta between current GeneratorAI and new user requirements

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Conceptual Mismatches](#2-conceptual-mismatches)
3. [New Domain Model](#3-new-domain-model)
4. [State Machine Changes](#4-state-machine-changes)
5. [DAG Execution Model](#5-dag-execution-model)
6. [Session Allocation Strategy](#6-session-allocation-strategy)
7. [Service Layer Changes](#7-service-layer-changes)
8. [Database / Repository Changes](#8-database--repository-changes)
9. [API Changes](#9-api-changes)
10. [UI Changes](#10-ui-changes)
11. [CLI Changes](#11-cli-changes)
12. [Event System Changes](#12-event-system-changes)
13. [Migration Strategy](#13-migration-strategy)
14. [Risk Register](#14-risk-register)

---

## 1. Executive Summary

The new requirements fundamentally **invert the Session↔Workflow relationship** and introduce **DAG-based parallel execution** of workflow stages. The changes are deep and structural — they touch every layer from the domain model to the UI.

### Key deltas at a glance

| Aspect | Current | New |
|---|---|---|
| Top-level concepts | Session (aggregate root) | **Chat** and **Workflow** (both top-level) |
| Session role | Orchestrator that contains workflows | **Copilot session wrapper** — a thin resource owned by Chat or Stage |
| Workflow role | Child of Session, sequentially ordered | **Top-level aggregate root** containing Stages |
| Execution model | Sequential workflow chain inside a session | **DAG** of stages with dependency edges; parallel where possible |
| Stage concept | Doesn't exist (prompts are the steps) | **New entity** — unit of work inside a workflow, has its own lifecycle |
| Session:Workflow | 1:N (session owns workflows) | **N:M through Stage** — a workflow spawns 1..N sessions; a session can be shared by multiple stages |
| Chat | Ad-hoc post-workflow interaction on same session | **Standalone top-level concept** — creates its own session |
| Workflow persistence | Transient (created at session start, not reusable) | **Persistent & reusable** — user configures, saves, and re-runs workflows |

---

## 2. Conceptual Mismatches

### 2.1 Session as Aggregate Root → Session as Resource

**Current:** `Session` is the aggregate root. Everything (workflows, chat messages, events, artifacts) hangs off `sessionId`. The `SessionStateMachine` drives the entire execution lifecycle and delegates down to workflows.

**New:** `Session` becomes a **lightweight Copilot conversation wrapper**. It is no longer the orchestrator; it is a resource **allocated by** either a Chat or a Stage. A Workflow may allocate multiple Sessions (one per independent stage), and multiple stages may share a single Session.

**Conflict:** Every repository, event, chat message, and artifact currently references `sessionId` as the primary context key. This FK-centric design must either:
- (a) Add a higher-level context key (`workflowRunId` or `chatId`) alongside `sessionId`, or
- (b) Reparent existing FKs.

**Recommendation:** Option (a) — add `workflowRunId` and `chatId` as optional context keys. Preserve `sessionId` as the Copilot-level grouping key but no longer treat it as the business-level aggregate key.

### 2.2 Workflow as Sequential Child → Workflow as DAG-based Aggregate

**Current:** `Workflow` has `sessionId` (parent), `order` (sequential position), and `templateId`. Execution is strictly sequential — `SessionService.onWorkflowCompleted()` picks the next `queued` workflow by `order`.

**New:** `Workflow` becomes an independent aggregate root with its own lifecycle. It contains **Stages** (not prompts — prompts live inside stages). Stages form a DAG via explicit dependency declarations. Execution is driven by a DAG scheduler, not a sequential queue.

**Conflict:** The current `Workflow` entity is overloaded — it is both the "unit of work" and the "step in a sequence." In the new model:
- **Workflow** = the saved configuration + runtime lifecycle
- **Stage** = the unit of work (replaces the current `Workflow` entity)
- **WorkflowRun** = one execution instance of a Workflow (supports re-runs)

### 2.3 Chat as Post-Workflow Feature → Chat as Standalone Concept

**Current:** Chat is gated by `SessionStateMachine.isChatEnabled` — only available when session is `completed` or `cancelled`. Chat creates a conversation prefixed `chat-{sessionId}`. `ChatService` lives under the Session context.

**New:** Chat is a **top-level concept**. Starting a chat immediately creates a Session (Copilot conversation). There is no prerequisite workflow. Chat has its own entry point, its own listing page, and its own lifecycle.

**Conflict:** `ChatService.sendPrompt()` currently checks session status and creates conversations under the session's scope. This coupling must be broken — Chat should have its own `chatId` and own a Session, not be gated by a Session's workflow status.

### 2.4 Templates: Static → Building Blocks for Stage Configuration

**Current:** Templates are JSON files loaded at startup. Each template defines prompts, variables, hooks, and copilot config. A workflow is a 1:1 mapping to a template.

**New:** Templates remain as reusable building blocks, but now each **Stage** references a template (not each Workflow). Additionally, the user must be able to **create and configure workflows** (multi-stage DAGs) through the UI and save them — this implies a **workflow definition** persistence layer that doesn't exist today.

---

## 3. New Domain Model

### 3.1 Entity Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     TOP-LEVEL CONCEPTS                       │
├──────────────────────────┬───────────────────────────────────┤
│         CHAT             │           WORKFLOW                │
│                          │                                   │
│  ┌─────────────┐         │  ┌──────────────────────┐         │
│  │   Chat      │         │  │  WorkflowDefinition  │ saved   │
│  │─────────────│         │  │──────────────────────│ config  │
│  │ id          │         │  │ id                   │         │
│  │ name        │         │  │ name                 │         │
│  │ sessionId ──┼──┐      │  │ description          │         │
│  │ createdAt   │  │      │  │ stages[]             │         │
│  │ updatedAt   │  │      │  │ edges[]              │         │
│  └─────────────┘  │      │  │ variables{}          │         │
│                   │      │  │ copilotDefaults{}     │         │
│                   │      │  │ createdAt / updatedAt │         │
│                   │      │  └──────────┬───────────┘         │
│                   │      │             │ 1                   │
│                   │      │             │                     │
│                   │      │             ▼ N                   │
│                   │      │  ┌──────────────────────┐         │
│                   │      │  │   WorkflowRun        │ runtime │
│                   │      │  │──────────────────────│ inst.   │
│                   │      │  │ id                   │         │
│                   │      │  │ workflowDefId        │         │
│                   │      │  │ status               │         │
│                   │      │  │ triggeredBy          │         │
│                   │      │  │ variables{}          │         │
│                   │      │  │ createdAt / ...       │         │
│                   │      │  └──────────┬───────────┘         │
│                   │      │             │ 1                   │
│                   │      │             │                     │
│                   │      │             ▼ N                   │
│                   │      │  ┌──────────────────────┐         │
│                   │      │  │   StageRun           │ runtime │
│                   │      │  │──────────────────────│         │
│                   │      │  │ id                   │         │
│                   │      │  │ workflowRunId        │         │
│                   │      │  │ stageDefId           │         │
│                   │      │  │ sessionId ───────────┼──┐      │
│                   │      │  │ status               │  │      │
│                   │      │  │ currentStep          │  │      │
│                   │      │  │ error                │  │      │
│                   │      │  │ startedAt / ...       │  │      │
│                   │      │  └──────────────────────┘  │      │
│                   │      │                            │      │
└───────────────────┼──────┴────────────────────────────┼──────┘
                    │                                   │
                    ▼                                   ▼
            ┌──────────────────────┐
            │     Session          │  (Copilot session wrapper)
            │──────────────────────│
            │ id                   │
            │ conversationId       │
            │ model                │
            │ status               │
            │ workspacePath        │
            │ ownerType (chat|stage)│
            │ ownerId              │
            │ createdAt / ...       │
            └──────────────────────┘
```

### 3.2 New & Changed Entities

#### NEW: `Chat`
```typescript
interface Chat {
  id: string;
  name: string;
  description?: string;
  sessionId: string;             // owns exactly one Session
  model?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}
```

#### NEW: `WorkflowDefinition`
The **saved configuration** of a workflow — reusable, editable, persistable.
```typescript
interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;
  
  // DAG structure
  stages: StageDefinition[];
  edges: StageEdge[];             // dependency graph
  
  // Global defaults (can be overridden per-stage)
  defaultVariables: Record<string, unknown>;
  defaultCopilotConfig?: Partial<CopilotConfig>;
  
  // Hooks at workflow level
  hooks: HookDefinition[];
  
  // Session allocation strategy
  sessionStrategy: 'shared' | 'per-stage' | 'custom';
  
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}
```

#### NEW: `StageDefinition`
A stage within a workflow definition — the unit of work.
```typescript
interface StageDefinition {
  id: string;                     // stable ID within the workflow
  name: string;
  description?: string;
  templateId: string;             // references a template (prompts, hooks, etc.)
  
  // Session allocation
  sessionGroup?: string;          // stages with same group share a session
                                  // null = gets own session
  
  // Overrides for the template
  variables?: Record<string, unknown>;
  hookOverrides?: Record<string, Partial<HookDefinition>>;
  copilotConfigOverrides?: Partial<CopilotConfig>;
  
  // Execution config  
  retryPolicy?: { maxRetries: number; backoffMs: number };
  timeoutMs?: number;
  continueOnFailure?: boolean;    // if true, downstream stages still run
}
```

#### NEW: `StageEdge`
```typescript
interface StageEdge {
  from: string;   // stageDefinition.id (upstream)
  to: string;     // stageDefinition.id (downstream)
  condition?: string; // optional expression — e.g. "upstream.status === 'completed'"
}
```
- Stages with **no incoming edges** are roots — they start immediately.
- Stages whose **all upstream edges are satisfied** become ready.
- This is a classic DAG topological execution model.

#### NEW: `WorkflowRun`
A runtime instance of a workflow definition — supports re-runs and history.
```typescript
interface WorkflowRun {
  id: string;
  workflowDefinitionId: string;
  status: WorkflowRunStatus;
  variables: Record<string, unknown>;     // resolved at run time
  triggeredBy?: { source: string; event: string };
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}
```

#### NEW: `StageRun`
Runtime instance of a stage within a workflow run.
```typescript
interface StageRun {
  id: string;
  workflowRunId: string;
  stageDefinitionId: string;
  sessionId?: string;             // allocated Copilot session
  status: StageRunStatus;
  conversationId?: string;
  currentStep: number;
  totalSteps: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}
```

#### CHANGED: `Session`
Session becomes a thin Copilot conversation wrapper, no longer the aggregate root.
```typescript
interface Session {
  id: string;
  conversationId?: string;
  model?: string;
  status: SessionStatus;          // simplified: created | active | closed | error
  workspacePath?: string;
  repoUrl?: string;
  repoBranch?: string;
  
  // Owner tracking
  ownerType: 'chat' | 'stage';
  ownerId: string;                // chatId or stageRunId
  
  createdAt: Date;
  updatedAt: Date;
}
```

#### DEPRECATED: Current `Workflow` entity
The current `Workflow` entity (with `sessionId`, `order`, `templateId`) is replaced by `StageRun` in the new model. A migration bridges existing data.

---

## 4. State Machine Changes

### 4.1 Current State Machines — Impact Assessment

| State Machine | Current Location | Disposition |
|---|---|---|
| `SessionStateMachine` (8 states, 12 transitions) | `packages/core/src/domain/state-machines/SessionStateMachine.ts` | **SIMPLIFY** — Session is no longer the orchestrator |
| `WorkflowStateMachine` (7 states, 10 transitions) | `packages/core/src/domain/state-machines/WorkflowStateMachine.ts` | **REPURPOSE** → becomes `StageRunStateMachine` |

### 4.2 New: `SessionStateMachine` (Simplified)

Session is now a resource, not an orchestrator. Its lifecycle is simpler:

```
  created ──→ active ──→ closed
                │            ▲
                ▼            │
              error ─────────┘
```

| State | Description |
|---|---|
| `created` | Session record exists, Copilot conversation not yet started |
| `active` | Copilot conversation is live and accepting prompts |
| `closed` | Conversation ended (stage done, chat ended, or cleanup) |
| `error` | Copilot conversation failed (can be retried → active or closed) |

Transitions:
| From | Event | To |
|---|---|---|
| `created` | `sys:activated` | `active` |
| `active` | `sys:closed` | `closed` |
| `active` | `sys:error` | `error` |
| `error` | `sys:retry` | `active` |
| `error` | `sys:closed` | `closed` |

### 4.3 New: `WorkflowRunStateMachine`

This replaces the current `SessionStateMachine` in terms of orchestration responsibility.

```
  created ──→ starting ──→ running ──→ completed
                  │           │  ▲
                  │           ▼  │
                  │         paused
                  │           │
                  ▼           ▼
               failed    cancelling ──→ cancelled
```

| Status | Description |
|---|---|
| `created` | WorkflowRun record created, not yet started |
| `starting` | Allocating sessions, validating DAG, preparing workspace |
| `running` | At least one stage is executing |
| `paused` | All active stages paused (user-initiated or failure-triggered) |
| `cancelling` | Cancel requested, waiting for stages to stop |
| `cancelled` | All stages stopped after cancel |
| `completed` | All stages reached terminal state (completed/skipped) |
| `failed` | Unrecoverable stage failure with `continueOnFailure=false` |

Transitions (12):
| From | Event | To |
|---|---|---|
| `created` | `user:start` | `starting` |
| `starting` | `sys:started` | `running` |
| `starting` | `sys:start_fail` | `failed` |
| `running` | `user:pause` | `paused` |
| `running` | `user:cancel` | `cancelling` |
| `running` | `sys:stage_failed` | `paused` or `failed` (depends on `continueOnFailure`) |
| `running` | `sys:all_stages_done` | `completed` |
| `paused` | `user:resume` | `running` |
| `paused` | `user:cancel` | `cancelling` |
| `cancelling` | `sys:all_stopped` | `cancelled` |
| `created` | `user:delete` | _(record deleted)_ |
| `completed` / `cancelled` / `failed` | `user:delete` | _(record deleted)_ |

### 4.4 New: `StageRunStateMachine`

Replaces the current `WorkflowStateMachine`. Nearly identical but adapted for DAG context.

```
  pending ──→ queued ──→ running ──→ completed
                │          │  ▲
                │          ▼  │
                │        paused
                │          │
                ▼          ▼
             cancelled   failed
                ▲          │
                │          │ (if continueOnFailure=false)
                └──────────┘
```

| Status | Description |
|---|---|
| `pending` | Created, waiting for DAG dependencies |
| `queued` | All upstream dependencies satisfied, ready to execute |
| `running` | Prompts are being sent to Copilot |
| `paused` | Paused (user or parent cascade) |
| `completed` | All prompts executed successfully |
| `failed` | Error during execution |
| `cancelled` | Cancelled (user or parent cascade) |
| `skipped` | Skipped because upstream failed and `continueOnFailure=false` |

Transitions (12):
| From | Event | To |
|---|---|---|
| `pending` | `sys:deps_satisfied` | `queued` |
| `pending` | `sys:deps_failed` | `skipped` |
| `pending` | `sys:parent_cancel` | `cancelled` |
| `queued` | `sys:turn` | `running` |
| `queued` | `sys:parent_cancel` | `cancelled` |
| `running` | `user:pause` | `paused` |
| `running` | `sys:parent_pause` | `paused` |
| `running` | `sys:done` | `completed` |
| `running` | `sys:error` | `failed` |
| `running` | `sys:parent_cancel` | `cancelled` |
| `paused` | `user:resume` | `running` |
| `paused` | `sys:parent_resume` | `running` |
| `paused` | `sys:parent_cancel` | `cancelled` |

### 4.5 Chat Lifecycle

Chat does not need a formal state machine — it is a simple CRUD entity that owns a Session. The session's lifecycle handles Copilot conversation state. Chat is "active" when its session is `active`, and "archived" when the user explicitly archives it or deletes it.

---

## 5. DAG Execution Model

### 5.1 DAG Validation (at workflow definition and before run start)

1. Parse `stages[]` and `edges[]` into a directed graph.
2. **Cycle detection**: Topological sort (Kahn's algorithm). Reject if cycles exist.
3. **Orphan detection**: All stages must be reachable from at least one root OR be a root themselves.
4. **Edge validation**: All `from`/`to` references must point to valid `stageDefinition.id` values.

### 5.2 DAG Scheduler (at runtime)

```
ALGORITHM: DAGScheduler.tick()
─────────────────────────────
1. For each stage in the WorkflowRun:
   a. If stage is PENDING:
      - Check all upstream edges
      - If ALL upstream stages are COMPLETED → transition to QUEUED
      - If ANY upstream stage is FAILED and continueOnFailure=false → transition to SKIPPED
   b. If stage is QUEUED:
      - Allocate a session (shared or new, per session strategy)
      - Start execution → transition to RUNNING
   c. If stage is COMPLETED | FAILED | CANCELLED | SKIPPED:
      - No action (terminal)
      
2. If ALL stages are terminal → WorkflowRun → COMPLETED (or FAILED if any failed)
3. If no stages are RUNNING or QUEUED and some are PENDING → deadlock detected → FAILED
```

### 5.3 Concurrency Model

- **Independent stages** (no shared edges): execute in **parallel**, each with its own session.
- **Dependent stages** (connected by edges): execute in **topological order** as dependencies resolve.
- **Shared-session stages** (`sessionGroup`): execute **sequentially** within the group even if the DAG would allow parallelism (Copilot conversations are inherently sequential).
- **Max concurrency limit**: Configurable cap on how many stages run simultaneously within a single workflow run (default: 5).

### 5.4 Example DAG

```
   ┌─────────────┐     ┌─────────────┐
   │ Stage A      │     │ Stage B      │
   │ (code-gen)   │     │ (code-gen)   │
   │ group: "g1"  │     │ group: null  │  ← own session
   └──────┬───────┘     └──────┬───────┘
          │                    │
          ▼                    ▼
   ┌─────────────┐     ┌─────────────┐
   │ Stage C      │     │ Stage D      │
   │ (test-gen)   │     │ (code-review)│
   │ group: "g1"  │     │ group: null  │  ← own session
   └──────┬───────┘     └──────┬───────┘
          │                    │
          └────────┬───────────┘
                   ▼
            ┌─────────────┐
            │ Stage E      │
            │ (refactoring)│
            │ group: null  │  ← own session
            └──────────────┘
```

- A and B are roots → start in parallel.
- A and C share `group: "g1"` → same Copilot session, C waits for A.
- B and D are independent of A/C → B starts in parallel with A.
- D depends on B.
- E depends on both C and D → waits for both.

---

## 6. Session Allocation Strategy

### 6.1 Strategies

| Strategy | Behavior | When to use |
|---|---|---|
| `shared` | All stages in the workflow share a single session | Simple sequential workflows, stages that build on each other's context |
| `per-stage` | Each stage gets its own isolated session | Fully independent stages that can run in parallel |
| `custom` | `sessionGroup` field on each stage controls grouping | Mixed — some stages share context, others are independent |

### 6.2 Session Pool / Allocator Service

New service: `SessionAllocator`

```typescript
class SessionAllocator {
  /**
   * Given a WorkflowRun and a StageRun, allocate or reuse a Session.
   * 
   * Logic:
   * 1. If strategy is 'shared': look for existing active session for this WorkflowRun.
   *    If found, return it. If not, create one.
   * 2. If strategy is 'per-stage': always create a new session.
   * 3. If strategy is 'custom': look for existing active session with matching sessionGroup.
   *    If found, return it. If not, create one tagged with the group.
   */
  async allocateSession(workflowRun: WorkflowRun, stage: StageRun, def: StageDefinition): Promise<Session>;
  
  /**
   * Release a session when its last owning stage completes.
   */
  async releaseSession(sessionId: string): Promise<void>;
}
```

### 6.3 Constraint: Shared Sessions are Serial

When multiple stages share a Copilot session (same `sessionGroup`), the DAG scheduler must **serialize** them even if the DAG would otherwise allow parallel execution. The scheduler should:

1. Identify all stages in the same `sessionGroup`.
2. Order them by DAG topological rank (tie-break by stage definition order).
3. Only queue the next stage in the group after the current one completes.

---

## 7. Service Layer Changes

### 7.1 Services — Disposition Table

| Current Service | File | Disposition | Details |
|---|---|---|---|
| `SessionService` | `core/src/services/SessionService.ts` | **MAJOR REWRITE** | No longer the orchestrator. Becomes a thin CRUD + Copilot session lifecycle manager. Remove `onWorkflowCompleted`, `onWorkflowFailed`, `startSession` (workflow orchestration), etc. |
| `WorkflowService` | `core/src/services/WorkflowService.ts` | **REPLACE** with split services | Current responsibilities split into `WorkflowDefinitionService`, `WorkflowRunService`, `StageExecutionService` |
| `ChatService` | `core/src/services/ChatService.ts` | **REWRITE** | Decoupled from Session. Gets its own `ChatService` that creates/manages Chat entities and delegates to Session for Copilot interaction. |
| `ConfigResolver` | `core/src/services/ConfigResolver.ts` | **MODIFY** | Now resolves config per Stage (not per Workflow). Input: `stageDefinition.templateId` + overrides. |
| `TemplateRegistry` | `core/src/services/TemplateRegistry.ts` | **KEEP** | No significant changes — templates are still JSON-loaded building blocks. |
| `HookExecutor` | `core/src/services/HookExecutor.ts` | **KEEP** | Minor: hook context now includes `workflowRunId` and `stageRunId` instead of `sessionId`/`workflowId`. |
| `HookInterceptor` | `core/src/services/HookInterceptor.ts` | **KEEP** | Same minor context changes as HookExecutor. |
| `ArtifactService` | `core/src/services/ArtifactService.ts` | **MODIFY** | Artifacts now linked to `stageRunId` (and optionally `workflowRunId`, `chatId`) in addition to `sessionId`. |
| `WebhookService` | `core/src/services/WebhookService.ts` | **MODIFY** | Webhooks can now trigger workflow runs (not just sessions). |
| `StartupRecoveryService` | `core/src/services/StartupRecoveryService.ts` | **REWRITE** | Must recover in-flight WorkflowRuns and their StageRuns, not Sessions. |
| `ErrorHandler` | `core/src/services/ErrorHandler.ts` | **KEEP** | Minimal changes. |

### 7.2 New Services

| Service | Responsibility |
|---|---|
| `WorkflowDefinitionService` | CRUD for workflow definitions. Validate DAG structure. Manage versioning. |
| `WorkflowRunService` | Create runs from definitions, manage run lifecycle (start/pause/cancel/delete). Orchestrates the DAG scheduler. Replaces `SessionService` as the orchestration hub. |
| `StageExecutionService` | Execute a single stage (send prompts to Copilot, handle hooks). Extracted from current `WorkflowService.startWorkflow()`. |
| `DAGScheduler` | Evaluate stage readiness, trigger transitions, detect completion/deadlock. Pure logic, no I/O — called by `WorkflowRunService`. |
| `SessionAllocator` | Allocate/reuse/release Copilot sessions per the workflow's session strategy. |
| `ChatManagementService` | CRUD for Chat entities. Create session on chat start. Delegate prompt sending to existing `ChatService` logic. |

### 7.3 Circular Dependency Resolution

Current: `SessionService ↔ WorkflowService` (mutual `setXxxService()` pattern).

New: `WorkflowRunService → StageExecutionService → SessionAllocator → SessionService`. No circular dependency — the DAG scheduler calls down, stage completion events call back up via the EventBus (not direct service references).

---

## 8. Database / Repository Changes

### 8.1 New Tables

#### `chats`
```sql
CREATE TABLE chats (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  model         TEXT,
  tags          TEXT DEFAULT '[]',   -- JSON array
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_chats_created_at ON chats(created_at);
```

#### `workflow_definitions`
```sql
CREATE TABLE workflow_definitions (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  description           TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  stages                TEXT NOT NULL,    -- JSON: StageDefinition[]
  edges                 TEXT NOT NULL,    -- JSON: StageEdge[]
  default_variables     TEXT DEFAULT '{}',
  default_copilot_config TEXT,            -- JSON: Partial<CopilotConfig>
  hooks                 TEXT DEFAULT '[]',
  session_strategy      TEXT NOT NULL DEFAULT 'per-stage',
  tags                  TEXT DEFAULT '[]',
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX idx_wfdef_name ON workflow_definitions(name);
```

#### `workflow_runs`
```sql
CREATE TABLE workflow_runs (
  id                      TEXT PRIMARY KEY,
  workflow_definition_id  TEXT NOT NULL REFERENCES workflow_definitions(id),
  status                  TEXT NOT NULL DEFAULT 'created',
  variables               TEXT DEFAULT '{}',
  triggered_by            TEXT,           -- JSON
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  started_at              INTEGER,
  completed_at            INTEGER
);
CREATE INDEX idx_wfrun_def ON workflow_runs(workflow_definition_id);
CREATE INDEX idx_wfrun_status ON workflow_runs(status);
CREATE INDEX idx_wfrun_created ON workflow_runs(created_at);
```

#### `stage_runs`
```sql
CREATE TABLE stage_runs (
  id                    TEXT PRIMARY KEY,
  workflow_run_id       TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage_definition_id   TEXT NOT NULL,
  session_id            TEXT REFERENCES sessions(id),
  status                TEXT NOT NULL DEFAULT 'pending',
  conversation_id       TEXT,
  variables             TEXT DEFAULT '{}',
  current_step          INTEGER DEFAULT 0,
  total_steps           INTEGER DEFAULT 0,
  error                 TEXT,
  started_at            INTEGER,
  completed_at          INTEGER,
  created_at            INTEGER NOT NULL
);
CREATE INDEX idx_stagerun_wfrun ON stage_runs(workflow_run_id);
CREATE INDEX idx_stagerun_status ON stage_runs(status);
CREATE INDEX idx_stagerun_session ON stage_runs(session_id);
```

### 8.2 Changed Tables

#### `sessions` — Simplify
```sql
-- Remove: name, description, tags, triggeredBy, requiresCodebase (move to Chat/WorkflowRun)
-- Add: owner_type, owner_id
ALTER TABLE sessions ADD COLUMN owner_type TEXT; -- 'chat' | 'stage'
ALTER TABLE sessions ADD COLUMN owner_id TEXT;
-- Remove or deprecate: status values 'starting', 'cancelling', 'deleted' (simplify lifecycle)
```

#### `chat_messages` — Add optional context columns
```sql
ALTER TABLE chat_messages ADD COLUMN chat_id TEXT REFERENCES chats(id);
ALTER TABLE chat_messages ADD COLUMN workflow_run_id TEXT REFERENCES workflow_runs(id);
ALTER TABLE chat_messages ADD COLUMN stage_run_id TEXT REFERENCES stage_runs(id);
-- Keep session_id for backward compat / Copilot-level grouping
```

#### `events` — Add context columns
```sql
ALTER TABLE events ADD COLUMN workflow_run_id TEXT;
ALTER TABLE events ADD COLUMN stage_run_id TEXT;
ALTER TABLE events ADD COLUMN chat_id TEXT;
-- session_id remains (events are per-Copilot-conversation)
```

#### `artifacts` — Add context columns
```sql
ALTER TABLE artifacts ADD COLUMN workflow_run_id TEXT;
ALTER TABLE artifacts ADD COLUMN stage_run_id TEXT;
ALTER TABLE artifacts ADD COLUMN chat_id TEXT;
-- Keep session_id + workflowId (renamed to stage_run_id) for backward compat
```

#### `workflows` — DEPRECATE
The current `workflows` table is replaced by `stage_runs`. Keep for migration only.

### 8.3 New Repositories

| Repository | Interface |
|---|---|
| `IChatRepository` | `create`, `getById`, `getAll`, `update`, `delete` |
| `IWorkflowDefinitionRepository` | `create`, `getById`, `getAll`, `update`, `delete`, `getByName` |
| `IWorkflowRunRepository` | `create`, `getById`, `getByDefinitionId`, `getAll`, `updateStatus`, `update`, `delete`, `countByStatus` |
| `IStageRunRepository` | `create`, `getById`, `getByWorkflowRunId`, `updateStatus`, `update`, `delete` |

### 8.4 Changed Repositories

| Repository | Change |
|---|---|
| `ISessionRepository` | Add `getByOwner(ownerType, ownerId)`. Remove orchestration-related queries. |
| `IChatMessageRepository` | Add optional `chatId`, `workflowRunId`, `stageRunId` to create/query. |
| `IEventRepository` | Add optional context fields. |
| `IArtifactRepository` | Add optional context fields. |
| `IWorkflowRepository` | **DEPRECATE** — replaced by `IStageRunRepository`. |

---

## 9. API Changes

### 9.1 New Endpoints

#### Chat Endpoints
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chats` | Create a new chat (auto-creates session) |
| `GET` | `/api/chats` | List all chats |
| `GET` | `/api/chats/:id` | Get chat detail (with session info) |
| `DELETE` | `/api/chats/:id` | Delete a chat and its session |
| `POST` | `/api/chats/:id/prompt` | Send a prompt to the chat's session |
| `GET` | `/api/chats/:id/messages` | Get chat message history |
| `GET` | `/api/chats/:id/events` | SSE stream for chat events |

#### Workflow Definition Endpoints
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/workflows` | Create a new workflow definition |
| `GET` | `/api/workflows` | List all workflow definitions |
| `GET` | `/api/workflows/:id` | Get workflow definition detail (with stages, edges) |
| `PUT` | `/api/workflows/:id` | Update a workflow definition |
| `DELETE` | `/api/workflows/:id` | Delete a workflow definition |
| `POST` | `/api/workflows/:id/validate` | Validate DAG structure |

#### Workflow Run Endpoints
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/workflows/:id/runs` | Start a new run of a workflow definition |
| `GET` | `/api/workflows/:id/runs` | List runs of a workflow definition |
| `GET` | `/api/workflow-runs/:runId` | Get run detail (with stage statuses) |
| `POST` | `/api/workflow-runs/:runId/pause` | Pause a running workflow run |
| `POST` | `/api/workflow-runs/:runId/resume` | Resume a paused workflow run |
| `POST` | `/api/workflow-runs/:runId/cancel` | Cancel a workflow run |
| `DELETE` | `/api/workflow-runs/:runId` | Delete a workflow run |
| `GET` | `/api/workflow-runs/:runId/events` | SSE stream for workflow run events |
| `GET` | `/api/workflow-runs/:runId/stages` | List stage runs with statuses |
| `GET` | `/api/workflow-runs/:runId/stages/:stageId/events` | SSE stream for a specific stage |

### 9.2 Deprecated/Changed Endpoints

| Current | Disposition |
|---|---|
| `POST /api/sessions` | **DEPRECATE** — replaced by `POST /api/chats` and `POST /api/workflows/:id/runs` |
| `POST /api/sessions/:id/start` | **REMOVE** — session start is internal (triggered by chat creation or workflow run start) |
| `POST /api/sessions/:id/pause` | **REMOVE** — pause is on workflow runs, not sessions |
| `POST /api/sessions/:id/resume` | **REMOVE** — resume is on workflow runs, not sessions |
| `POST /api/sessions/:id/cancel` | **REMOVE** — cancel is on workflow runs, not sessions |
| `DELETE /api/sessions/:id` | **REMOVE** — deletion is on chats and workflow runs |
| `GET /api/sessions/:id` | **INTERNAL** — keep for internal Copilot session inspection but remove from primary API |
| `POST /api/sessions/:id/prompt` | **MOVE** → `POST /api/chats/:id/prompt` |
| `GET /api/sessions/:id/chat` | **MOVE** → `GET /api/chats/:id/messages` |
| `GET /api/sessions/:id/workflows` | **REMOVE** — replaced by workflow run stage listing |

### 9.3 SSE / Streaming Changes

Current SSE is per-session (`/api/sessions/:id/events`). New model needs:
- **Per-chat SSE**: `/api/chats/:id/events` — maps to the chat's single session event stream.
- **Per-workflow-run SSE**: `/api/workflow-runs/:runId/events` — multiplexes events from all stages/sessions in the run.
- **Per-stage SSE**: `/api/workflow-runs/:runId/stages/:stageId/events` — events from one stage's session.
- **Global SSE**: `/api/events/multiplexed` — unchanged, but events now carry `chatId` or `workflowRunId` context.

---

## 10. UI Changes

### 10.1 Current UI Structure

```
AppLayout
├── Sidebar (SessionList)
├── EmptyState (landing)
├── SessionDetail (main view with ChatView + WorkflowTimeline)
├── TemplateExplorer
└── Settings
```

### 10.2 New UI Structure

```
AppLayout
├── Sidebar
│   ├── Chat Section
│   │   ├── ChatList (list of Chat entities)
│   │   └── "New Chat" button
│   ├── Workflow Section
│   │   ├── WorkflowList (list of WorkflowDefinitions)
│   │   └── "New Workflow" button
│   └── Settings / Templates links
│
├── Pages
│   ├── EmptyState (landing)
│   │
│   ├── ChatView (existing, repurposed)
│   │   ├── ChatMessageList
│   │   ├── ChatInput
│   │   └── No workflow timeline here
│   │
│   ├── WorkflowListPage ← NEW
│   │   ├── WorkflowDefinitionCard (name, stages count, last run status)
│   │   ├── "Create Workflow" button → WorkflowEditorPage
│   │   └── "Run" button → triggers POST /api/workflows/:id/runs
│   │
│   ├── WorkflowEditorPage ← NEW
│   │   ├── WorkflowMetadataForm (name, description, session strategy)
│   │   ├── DAGCanvas (visual stage + edge editor) ← KEY NEW COMPONENT
│   │   │   ├── StageNode (draggable, shows template, config summary)
│   │   │   ├── EdgeConnector (draw edges between stages)
│   │   │   └── StageConfigPanel (slide-out: template picker, variables, overrides)
│   │   ├── StageList (tabular alternative to canvas)
│   │   ├── Validation feedback (cycle detection, missing deps)
│   │   └── Save / Save & Run buttons
│   │
│   ├── WorkflowRunDetailPage ← NEW
│   │   ├── RunHeader (status, timing, controls: pause/resume/cancel)
│   │   ├── DAGVisualization (read-only, stages color-coded by status)
│   │   ├── StageRunTimeline (list of stages with progress)
│   │   ├── StageRunDetail (on click: prompts, events, artifacts for that stage)
│   │   └── RunEventStream (multiplexed SSE from all stages)
│   │
│   ├── TemplateExplorer (existing, unchanged)
│   └── Settings (existing, unchanged)
```

### 10.3 New Components Needed

| Component | Location | Description |
|---|---|---|
| `ChatList` | `web/src/components/chat/ChatList.tsx` | List of Chat entities in sidebar |
| `WorkflowList` | `web/src/components/workflows/WorkflowList.tsx` | List of WorkflowDefinitions in sidebar |
| `WorkflowListPage` | `web/src/pages/WorkflowList.tsx` | Main page listing workflow definitions |
| `WorkflowEditorPage` | `web/src/pages/WorkflowEditor.tsx` | DAG editor for creating/editing workflow definitions |
| `DAGCanvas` | `web/src/components/workflows/DAGCanvas.tsx` | Visual DAG editor (consider react-flow or similar library) |
| `StageNode` | `web/src/components/workflows/StageNode.tsx` | Draggable stage node in DAG canvas |
| `EdgeConnector` | `web/src/components/workflows/EdgeConnector.tsx` | Edge drawing between stage nodes |
| `StageConfigPanel` | `web/src/components/workflows/StageConfigPanel.tsx` | Slide-out panel for stage configuration |
| `WorkflowRunDetailPage` | `web/src/pages/WorkflowRunDetail.tsx` | Detailed view of a workflow run |
| `DAGVisualization` | `web/src/components/workflows/DAGVisualization.tsx` | Read-only DAG view with status coloring |
| `StageRunTimeline` | `web/src/components/workflows/StageRunTimeline.tsx` | Replaces `WorkflowTimeline` for the new model |
| `WorkflowRunList` | `web/src/components/workflows/WorkflowRunList.tsx` | Run history for a workflow definition |
| `CreateWorkflowDialog` | `web/src/components/workflows/CreateWorkflowDialog.tsx` | Quick-create dialog |

### 10.4 Changed Components

| Component | Change |
|---|---|
| `Sidebar` | Split into Chat section and Workflow section. No longer lists Sessions directly. |
| `SessionList` | **DEPRECATE** → replaced by `ChatList` and `WorkflowList` |
| `CreateSessionDialog` | **DEPRECATE** → replaced by "New Chat" (simple) and `WorkflowEditorPage` (complex) |
| `SessionDetail` | **DEPRECATE** → replaced by `ChatView` (for chats) and `WorkflowRunDetailPage` (for workflow runs) |
| `WorkflowTimeline` | **DEPRECATE** → replaced by `StageRunTimeline` + `DAGVisualization` |
| `ChatView` | **MODIFY** — decouple from Session. Now operates on a Chat entity. |

### 10.5 New Routes

```tsx
{
  path: 'chats/:id',          // Chat view
  path: 'workflows',           // Workflow list page
  path: 'workflows/new',       // Create new workflow definition
  path: 'workflows/:id/edit',  // Edit workflow definition
  path: 'workflows/:id/runs',  // Run history for a definition
  path: 'workflow-runs/:runId', // Workflow run detail
}
```

### 10.6 State Management (Stores)

New stores needed:
| Store | Data |
|---|---|
| `chatStore` | List of Chat entities, active chat selection |
| `workflowDefStore` | List of WorkflowDefinitions, CRUD mutations |
| `workflowRunStore` | Active workflow runs, status updates, stage statuses |

Existing `streamStore` and `sseManager` need updates to handle new event context keys (`chatId`, `workflowRunId`).

---

## 11. CLI Changes

### 11.1 Current CLI Commands

| Command | File | Disposition |
|---|---|---|
| `init` | `cli/src/commands/init.tsx` | **KEEP** |
| `start` | `cli/src/commands/start.tsx` | **REWRITE** — currently creates and starts a Session; must now support `--chat` (start chat) and `--workflow <id>` (run a workflow) |
| `stop` | `cli/src/commands/stop.tsx` | **REWRITE** — must target workflow runs or chats, not sessions |
| `status` | `cli/src/commands/status.tsx` | **REWRITE** — show chat or workflow run status |
| `list` | `cli/src/commands/list.tsx` | **REWRITE** — list chats, workflow definitions, or workflow runs |
| `chat` | `cli/src/commands/chat.tsx` | **MODIFY** — now creates/connects to a Chat entity directly |
| `watch` | `cli/src/commands/watch.tsx` | **MODIFY** — watch a workflow run or chat |
| `template` | `cli/src/commands/template.tsx` | **KEEP** |

### 11.2 New CLI Commands

| Command | Description |
|---|---|
| `workflow list` | List workflow definitions |
| `workflow create` | Create a workflow definition (interactive or from JSON file) |
| `workflow edit <id>` | Edit a workflow definition |
| `workflow delete <id>` | Delete a workflow definition |
| `workflow run <id>` | Start a new run of a workflow definition |
| `workflow runs [defId]` | List runs (optionally filtered by definition) |
| `workflow run-status <runId>` | Show detailed run status with stage breakdown |
| `workflow run-cancel <runId>` | Cancel a running workflow run |
| `chat list` | List chats |
| `chat new` | Start a new chat |
| `chat resume <id>` | Resume an existing chat |
| `chat delete <id>` | Delete a chat |

---

## 12. Event System Changes

### 12.1 New Event Kinds

```typescript
// ── WorkflowRun Events ──
| { kind: 'workflow_run.created'; data: { workflowRunId: string; workflowDefId: string } }
| { kind: 'workflow_run.starting'; data: { workflowRunId: string } }
| { kind: 'workflow_run.running'; data: { workflowRunId: string } }
| { kind: 'workflow_run.paused'; data: { workflowRunId: string; reason?: string } }
| { kind: 'workflow_run.completed'; data: { workflowRunId: string } }
| { kind: 'workflow_run.failed'; data: { workflowRunId: string; error: string } }
| { kind: 'workflow_run.cancelled'; data: { workflowRunId: string } }

// ── StageRun Events ──
| { kind: 'stage.queued'; data: { stageRunId: string; workflowRunId: string; stageName: string } }
| { kind: 'stage.started'; data: { stageRunId: string; workflowRunId: string; stageName: string } }
| { kind: 'stage.step_started'; data: { stageRunId: string; step: string } }
| { kind: 'stage.step_completed'; data: { stageRunId: string; step: string } }
| { kind: 'stage.completed'; data: { stageRunId: string; workflowRunId: string } }
| { kind: 'stage.failed'; data: { stageRunId: string; workflowRunId: string; error: string } }
| { kind: 'stage.paused'; data: { stageRunId: string; workflowRunId: string } }
| { kind: 'stage.cancelled'; data: { stageRunId: string; workflowRunId: string } }
| { kind: 'stage.skipped'; data: { stageRunId: string; workflowRunId: string; reason: string } }

// ── Chat Events ──
| { kind: 'chat.created'; data: { chatId: string; name: string } }
| { kind: 'chat.deleted'; data: { chatId: string } }
```

### 12.2 EventBus Changes

Currently `EventBus.emit(sessionId, event)` stores events keyed by `sessionId`. Needs to also support:
- `emit(sessionId, event, { workflowRunId?, stageRunId?, chatId? })` — additional context for multiplexed routing.
- Event routing: multiplexed SSE for a workflow run needs to aggregate events from all sessions belonging to that run.

### 12.3 Deprecated Event Kinds

| Event Kind | Replacement |
|---|---|
| `workflow.started` | `stage.started` |
| `workflow.step_started` | `stage.step_started` |
| `workflow.step_completed` | `stage.step_completed` |
| `workflow.completed` | `stage.completed` |
| `workflow.failed` | `stage.failed` |
| `workflow.paused` | `stage.paused` |
| `workflow.cancelled` | `stage.cancelled` |
| `session.starting` | _(internal, no public event)_ |
| `session.running` | _(internal, no public event)_ |
| `session.completed` | _(internal, no public event)_ |
| `session.cancelled` | _(internal, no public event)_ |

---

## 13. Migration Strategy

### 13.1 Database Migration

1. **Create new tables**: `chats`, `workflow_definitions`, `workflow_runs`, `stage_runs`.
2. **Add columns** to `sessions`, `chat_messages`, `events`, `artifacts`.
3. **Migrate existing data**:
   - Existing sessions without workflows → create a `Chat` entity pointing to the session.
   - Existing sessions with workflows → create a `WorkflowDefinition` (from the session's template config), a `WorkflowRun`, and `StageRun` records (one per old `Workflow`).
   - Set `owner_type` and `owner_id` on migrated sessions.
4. **Keep `workflows` table** as deprecated for rollback safety. Drop in a later release.

### 13.2 API Migration

- Keep old endpoints functional with deprecation warnings for 1-2 release cycles.
- Old `POST /api/sessions` → internally creates either a Chat or a single-stage WorkflowRun.
- New endpoints are additive — no breaking changes on day 1.

### 13.3 Phased Implementation

| Phase | Scope | Dependencies |
|---|---|---|
| **Phase 1** | New domain entities, types, state machines | None |
| **Phase 2** | New DB schema + repositories | Phase 1 |
| **Phase 3** | DAG scheduler, SessionAllocator, new services | Phase 1, 2 |
| **Phase 4** | New API endpoints (Chat + Workflow CRUD + Run) | Phase 3 |
| **Phase 5** | Chat UI (sidebar, ChatList, decoupled ChatView) | Phase 4 |
| **Phase 6** | Workflow UI (list, editor, DAG canvas, run detail) | Phase 4 |
| **Phase 7** | CLI commands | Phase 4 |
| **Phase 8** | Data migration + deprecation of old endpoints | Phase 5, 6, 7 |

---

## 14. Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| 1 | **DAG scheduler complexity** — deadlock detection, cycle handling, shared-session serialization | High | Medium | Extensive unit tests for DAGScheduler. Model as pure function (no I/O) for testability. |
| 2 | **Session resource leaks** — stages that fail may leave Copilot sessions unreleased | High | Medium | `SessionAllocator.releaseSession()` on stage terminal states. Periodic cleanup job. |
| 3 | **Backward compatibility** — existing API consumers break | Medium | High | Phase 8 deprecation approach. Old endpoints remain functional with internal translation layer. |
| 4 | **UI complexity** — DAG canvas editor is a significant frontend effort | Medium | High | Consider using react-flow (MIT) to avoid building DAG UI from scratch. Phase 6 is the largest UI effort. |
| 5 | **Event multiplexing performance** — aggregating SSE from N concurrent sessions | Medium | Low | EventBus already batches. Add `workflowRunId` index for efficient fan-in queries. |
| 6 | **Shared-session race conditions** — two stages try to send prompts to the same Copilot session simultaneously | High | Medium | Enforce serialization via `sessionGroup` queue in DAGScheduler. Add mutex/lock per session. |
| 7 | **Data migration** — translating old Session→Workflow hierarchy to new Chat/WorkflowDef/Run model | Medium | Medium | Write migration script with dry-run mode. Full test coverage on migration logic. |
| 8 | **Copilot SDK limits** — may not support N concurrent conversations efficiently | Medium | Low | Configurable `maxConcurrentSessions` cap on `SessionAllocator`. Monitor SDK resource usage. |

---

## Appendix A: Entity Relationship Summary (New Model)

```
Chat 1──────1 Session
                │
WorkflowDefinition 1──N WorkflowRun
                         │
                    WorkflowRun 1──N StageRun N──1 Session
                         │
                    StageRun uses StageDefinition (from WorkflowDefinition.stages[])
                    StageRun uses Template (from TemplateRegistry via StageDefinition.templateId)
```

## Appendix B: File Impact Map

| File / Directory | Change Type |
|---|---|
| `packages/shared/src/types/Session.ts` | MODIFY |
| `packages/shared/src/types/Workflow.ts` | DEPRECATE |
| `packages/shared/src/types/SessionStateMachine.ts` | SIMPLIFY |
| `packages/shared/src/types/WorkflowStateMachine.ts` | DEPRECATE → create new types |
| `packages/shared/src/types/Chat.ts` | NEW |
| `packages/shared/src/types/WorkflowDefinition.ts` | NEW |
| `packages/shared/src/types/WorkflowRun.ts` | NEW |
| `packages/shared/src/types/StageDefinition.ts` | NEW |
| `packages/shared/src/types/StageRun.ts` | NEW |
| `packages/shared/src/types/StageEdge.ts` | NEW |
| `packages/shared/src/types/DAGScheduler.ts` | NEW |
| `packages/shared/src/types/AgentEvent.ts` | MODIFY (add new event kinds) |
| `packages/shared/src/types/index.ts` | MODIFY (export new types) |
| `packages/core/src/domain/state-machines/SessionStateMachine.ts` | REWRITE (simplify) |
| `packages/core/src/domain/state-machines/WorkflowStateMachine.ts` | DEPRECATE |
| `packages/core/src/domain/state-machines/WorkflowRunStateMachine.ts` | NEW |
| `packages/core/src/domain/state-machines/StageRunStateMachine.ts` | NEW |
| `packages/core/src/domain/ports/IRepositories.ts` | MODIFY (add 4 new repos) |
| `packages/core/src/services/SessionService.ts` | MAJOR REWRITE |
| `packages/core/src/services/WorkflowService.ts` | REPLACE (split into 3) |
| `packages/core/src/services/ChatService.ts` | REWRITE |
| `packages/core/src/services/ConfigResolver.ts` | MODIFY |
| `packages/core/src/services/WorkflowDefinitionService.ts` | NEW |
| `packages/core/src/services/WorkflowRunService.ts` | NEW |
| `packages/core/src/services/StageExecutionService.ts` | NEW |
| `packages/core/src/services/DAGScheduler.ts` | NEW |
| `packages/core/src/services/SessionAllocator.ts` | NEW |
| `packages/core/src/services/ChatManagementService.ts` | NEW |
| `packages/db/src/schema.ts` | MODIFY (4 new tables, alter existing) |
| `packages/db/src/repositories/ChatRepository.ts` | NEW |
| `packages/db/src/repositories/WorkflowDefinitionRepository.ts` | NEW |
| `packages/db/src/repositories/WorkflowRunRepository.ts` | NEW |
| `packages/db/src/repositories/StageRunRepository.ts` | NEW |
| `packages/db/src/repositories/SessionRepository.ts` | MODIFY |
| `apps/server/src/routes/index.ts` | MODIFY (mount new routers) |
| `apps/server/src/routes/sessions.ts` | DEPRECATE / SIMPLIFY |
| `apps/server/src/routes/workflows.ts` | REWRITE (new endpoints) |
| `apps/server/src/routes/chat.ts` | REWRITE |
| `apps/server/src/routes/chatRoutes.ts` | NEW (top-level chat CRUD) |
| `apps/server/src/routes/workflowDefRoutes.ts` | NEW |
| `apps/server/src/routes/workflowRunRoutes.ts` | NEW |
| `apps/server/src/composition-root.ts` | MODIFY (wire new services) |
| `apps/web/src/router.tsx` | MODIFY (add new routes) |
| `apps/web/src/components/layout/Sidebar.tsx` | REWRITE |
| `apps/web/src/components/sessions/SessionList.tsx` | DEPRECATE |
| `apps/web/src/components/sessions/CreateSessionDialog.tsx` | DEPRECATE |
| `apps/web/src/pages/SessionDetail.tsx` | DEPRECATE |
| `apps/web/src/pages/WorkflowList.tsx` | NEW |
| `apps/web/src/pages/WorkflowEditor.tsx` | NEW |
| `apps/web/src/pages/WorkflowRunDetail.tsx` | NEW |
| `apps/web/src/components/workflows/DAGCanvas.tsx` | NEW |
| `apps/web/src/components/workflows/StageNode.tsx` | NEW |
| `apps/web/src/components/workflows/StageConfigPanel.tsx` | NEW |
| `apps/web/src/components/workflows/WorkflowRunList.tsx` | NEW |
| `apps/web/src/components/workflows/DAGVisualization.tsx` | NEW |
| `apps/web/src/components/workflows/StageRunTimeline.tsx` | NEW |
| `apps/web/src/components/chat/ChatList.tsx` | NEW |
| `apps/web/src/stores/chatStore.ts` | NEW |
| `apps/web/src/stores/workflowDefStore.ts` | NEW |
| `apps/web/src/stores/workflowRunStore.ts` | NEW |
| `apps/web/src/hooks/queries.ts` | MODIFY (new query hooks) |
| `apps/cli/src/commands/start.tsx` | REWRITE |
| `apps/cli/src/commands/stop.tsx` | REWRITE |
| `apps/cli/src/commands/status.tsx` | REWRITE |
| `apps/cli/src/commands/list.tsx` | REWRITE |
| `apps/cli/src/commands/chat.tsx` | MODIFY |
| `apps/cli/src/commands/workflow.tsx` | NEW (subcommand group) |
