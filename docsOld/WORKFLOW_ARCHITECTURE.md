# GeneratorAI — Workflow & Chat Architecture (v2)

> **Date**: February 28, 2026  
> **Status**: Draft — Pending Review  
> **Scope**: Architectural redesign to support first-class Workflows (multi-stage DAG) and Chats as independent top-level concepts.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Requirements Summary](#2-requirements-summary)
3. [Conceptual Model — Before vs After](#3-conceptual-model--before-vs-after)
4. [Domain Model](#4-domain-model)
5. [Database Schema Changes](#5-database-schema-changes)
6. [State Machines](#6-state-machines)
7. [DAG Scheduler Design](#7-dag-scheduler-design)
8. [Session Allocation Strategy](#8-session-allocation-strategy)
9. [Service Layer Changes](#9-service-layer-changes)
10. [Event System Changes](#10-event-system-changes)
11. [API Changes (Server)](#11-api-changes-server)
12. [Web UI Architecture](#12-web-ui-architecture)
13. [CLI Changes](#13-cli-changes)
14. [Backward Compatibility & Migration](#14-backward-compatibility--migration)
15. [Risk Register](#15-risk-register)

---

## 1. Executive Summary

The current architecture treats **Session** as the aggregate root, with Workflows as sequential children and Chat as an afterthought attached to completed sessions. The new design inverts this model:

- **Chat** becomes a first-class top-level entity (1 Chat → 1 Session → 1 Copilot conversation)
- **Workflow** becomes a first-class top-level entity with a full lifecycle, composed of **Stages** arranged as a DAG (directed acyclic graph)
- **Session** is demoted to a thin wrapper around a Copilot SDK conversation — shared by Chats or allocated to Stages
- **WorkflowDefinition** (design-time) is separated from **WorkflowRun** (runtime) to enable reusable, configurable workflow templates

This design draws inspiration from:
- **GitHub Actions**: DAG-based job dependencies via `needs`, parallel execution of independent jobs, `if` conditions, matrix strategies
- **n8n**: Visual node-based workflow building, connections between nodes, execution tracking, sub-workflows

---

## 2. Requirements Summary

### 2.1 Chat Requirements
| ID | Requirement | Priority |
|----|------------|----------|
| C1 | User can create and start a Chat | P0 |
| C2 | Each Chat creates exactly one Session (Copilot conversation) | P0 |
| C3 | Chat provides full interactive conversation with streaming | P0 |
| C4 | Chat list shown in sidebar | P0 |
| C5 | Chat supports model selection and configuration | P1 |

### 2.2 Workflow Requirements
| ID | Requirement | Priority |
|----|------------|----------|
| W1 | User can view a list of configured WorkflowDefinitions | P0 |
| W2 | User can create a new WorkflowDefinition with multiple stages | P0 |
| W3 | User can configure stage dependencies (DAG) | P0 |
| W4 | User can save and edit WorkflowDefinitions | P0 |
| W5 | User can start a WorkflowRun from a WorkflowDefinition | P0 |
| W6 | WorkflowRun has full lifecycle (start/pause/resume/cancel) | P0 |
| W7 | Workflow can have single-session or multi-session mode | P0 |
| W8 | Independent stages run in parallel with separate sessions | P0 |
| W9 | Dependent stages can share sessions (serial execution) | P1 |
| W10 | Stage execution completes before dependents start | P0 |
| W11 | Workflow progress shown in real-time (DAG visualization) | P0 |
| W12 | Stage-level pause/cancel/retry support | P1 |

---

## 3. Conceptual Model — Before vs After

### 3.1 Current Model (v1)
```
Session (aggregate root)
├── Workflow 1 (sequential, child) ─── Copilot Conversation 1
├── Workflow 2 (sequential, child) ─── Copilot Conversation 2
└── Chat (ad-hoc, post-completion) ─── Copilot Conversation "chat-{sessionId}"
```

### 3.2 New Model (v2)
```
Top-level Concepts:
├── Chat ─────────────────── Session ─── Copilot Conversation
│
└── WorkflowDefinition ──── WorkflowRun
                              ├── StageRun A ──── Session 1 ─── Copilot Conv
                              ├── StageRun B ──── Session 1 ─── (shared, sequential)
                              ├── StageRun C ──── Session 2 ─── Copilot Conv (parallel)
                              └── StageRun D ──── Session 3 ─── Copilot Conv (parallel)
```

### 3.3 Key Differences

| Aspect | v1 | v2 |
|--------|----|----|
| Aggregate root | Session | Chat / WorkflowRun |
| Workflow structure | Sequential list | DAG (stages + edges) |
| Parallelism | None | Independent stages run in parallel |
| Session ownership | Session owns Workflows | Sessions allocated to Stages/Chats |
| Chat model | Post-workflow add-on | Independent first-class entity |
| Template reuse | Template → Session | WorkflowDefinition (saveable, editable, sharable) |
| Design vs Runtime | Mixed (template + execution in Workflow) | Separated (WorkflowDefinition vs WorkflowRun) |

---

## 4. Domain Model

### 4.1 Entity Relationship Diagram
```
WorkflowDefinition 1───* StageDefinition
StageDefinition    *───* StageEdge (from → to)
WorkflowDefinition 1───* WorkflowRun
WorkflowRun        1───* StageRun
StageRun           *───1 Session (allocated)
Chat               1───1 Session
Session            1───1 Copilot Conversation
```

### 4.2 Chat Entity (NEW)
```typescript
interface Chat {
  id: string;                    // UUID v7
  name: string;                  // User-given name or auto-generated
  description?: string;
  sessionId: string;             // FK → sessions
  model?: string;                // AI model selection
  copilotConfig?: Partial<CopilotConfig>;  // Model, system prompt, tools, etc.
  repoUrl?: string;              // Optional repo context
  repoBranch?: string;
  workspacePath?: string;
  tags: string[];
  status: ChatStatus;            // 'active' | 'archived'
  createdAt: Date;
  updatedAt: Date;
}

type ChatStatus = 'active' | 'archived';
```

### 4.3 WorkflowDefinition Entity (NEW)
```typescript
interface WorkflowDefinition {
  id: string;                           // UUID v7
  name: string;
  description?: string;
  version: number;                      // Auto-incrementing on save
  sessionMode: WorkflowSessionMode;     // 'single' | 'per-stage' | 'auto'
  copilotConfig?: Partial<CopilotConfig>; // Default config for all stages
  variables: VariableDefinition[];      // User-configurable variables
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface VariableDefinition {
  name: string;                         // Variable name (used in {{name}} interpolation)
  type: 'string' | 'number' | 'boolean' | 'choice' | 'text';
  label: string;                        // Display label for UI
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  options?: string[];                   // For 'choice' type
}

// Compound types for API responses
interface WorkflowDefinitionWithStages extends WorkflowDefinition {
  stages: StageDefinition[];
  edges: StageEdge[];
}

interface WorkflowRunWithStages extends WorkflowRun {
  stageRuns: StageRun[];
}

type WorkflowSessionMode = 'single' | 'per-stage' | 'auto';
// single   — all stages share one session (sequential only)
// per-stage — every stage gets its own session
// auto     — independent stages get own sessions, dependent chains share
```

### 4.4 StageDefinition Entity (NEW)
```typescript
interface StageDefinition {
  id: string;                           // UUID v7
  workflowDefinitionId: string;         // FK
  name: string;
  description?: string;
  templateId?: string;                  // Links to existing WorkflowTemplate (optional)
  order: number;                        // Display order / fallback execution order
  prompts: PromptDefinition[];          // Prompts to execute in this stage
  copilotConfigOverrides?: Partial<CopilotConfig>; // Stage-level overrides
  variables: Record<string, unknown>;   // Stage-specific variable values
  hooks: HookDefinition[];              // Stage-level hooks
  retryPolicy?: RetryPolicy;           // Retry on failure
  timeoutMs?: number;                   // Stage execution timeout
  condition?: StageCondition;           // Optional condition to run or skip
  createdAt: Date;
}

interface PromptDefinition {
  label: string;
  text: string;                         // Supports {{variable}} interpolation
  attachments?: string[];
  waitForCompletion: boolean;           // Wait for idle before next prompt
}

interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
}

interface StageCondition {
  type: 'always' | 'on_success' | 'on_failure' | 'expression';
  expression?: string;                  // e.g., "stages.build.status === 'completed'"
}
```

### 4.5 StageEdge Entity (NEW)
```typescript
interface StageEdge {
  id: string;                     // UUID v7
  workflowDefinitionId: string;   // FK
  fromStageId: string;            // FK → stage_definitions
  toStageId: string;              // FK → stage_definitions
  edgeType: StageEdgeType;        // Dependency semantics
}

type StageEdgeType = 'on_success' | 'on_failure' | 'on_completion' | 'always';
// on_success   — run target only if source succeeded
// on_failure   — run target only if source failed
// on_completion — run target once source finishes (regardless of outcome)
// always       — run target unconditionally (parallel start)
```

### 4.6 Session Entity (REVISED)
```typescript
interface Session {
  id: string;                    // UUID v7
  conversationId?: string;       // Copilot SDK conversation ID (set on creation)
  status: SessionStatus;         // 6-state lifecycle (see §6.1)
  model?: string;
  copilotConfig?: Partial<CopilotConfig>;
  repoUrl?: string;
  repoBranch?: string;
  workspacePath?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  closedAt?: Date;
}

type SessionStatus = 'created' | 'active' | 'paused' | 'closing' | 'closed' | 'error';
// created  — Session record exists, no Copilot conversation yet
// active   — Copilot conversation created, prompts can be sent
// paused   — In-flight turn aborted via SDK, conversation preserved for resume
// closing  — Transitional: abort/destroy calls in progress, no new prompts accepted
// closed   — SDK conversation destroyed, session is done
// error    — SDK error, session unusable

// v1 → v2 status mapping for migration:
// 'starting'   → 'created'
// 'running'    → 'active'
// 'completed'  → 'closed'
// 'cancelled'  → 'closed'
// 'cancelling' → 'closing'
// 'deleted'    → 'closed'
```

### 4.7 WorkflowRun Entity (NEW)
```typescript
interface WorkflowRun {
  id: string;                           // UUID v7
  workflowDefinitionId: string;         // FK
  name: string;                         // Snapshot of workflow name at run time
  status: WorkflowRunStatus;
  sessionMode: WorkflowSessionMode;     // Resolved from definition
  variables: Record<string, unknown>;   // Resolved variable values for this run
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

type WorkflowRunStatus = 
  | 'created'      // Run record created, not started
  | 'starting'     // Initializing sessions, cloning repos
  | 'running'      // At least one stage is running
  | 'paused'       // User paused or stage paused
  | 'cancelling'   // User requested cancel, stopping stages
  | 'completed'    // All stages completed successfully
  | 'failed'       // One or more stages failed (based on failure policy)
  | 'cancelled';   // Successfully cancelled
```

### 4.8 StageRun Entity (NEW)
```typescript
interface StageRun {
  id: string;                           // UUID v7
  workflowRunId: string;                // FK
  stageDefinitionId: string;            // FK
  sessionId?: string;                   // FK → sessions (allocated at runtime)
  name: string;                         // Snapshot of stage name
  status: StageRunStatus;
  currentStep: number;                  // Current prompt index
  totalSteps: number;                   // Total prompts
  retryCount: number;                   // Number of retries so far
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

type StageRunStatus =
  | 'pending'       // Waiting for dependencies
  | 'queued'        // Dependencies met, waiting for session/resources
  | 'running'       // Actively executing prompts
  | 'paused'        // Paused by user or parent
  | 'completed'     // All prompts executed successfully
  | 'failed'        // Execution failed
  | 'cancelled'     // Cancelled by user or parent
  | 'skipped';      // Skipped due to condition not met
```

---

## 5. Database Schema Changes

### 5.1 New Tables

```sql
-- ==========================================
-- Table: chats
-- ==========================================
CREATE TABLE chats (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  model         TEXT,
  copilot_config TEXT,              -- JSON
  repo_url      TEXT,
  repo_branch   TEXT,
  workspace_path TEXT,
  tags          TEXT DEFAULT '[]',   -- JSON array
  status        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_chats_status ON chats(status);
CREATE INDEX idx_chats_session_id ON chats(session_id);
CREATE INDEX idx_chats_created_at ON chats(created_at);

-- ==========================================
-- Table: workflow_definitions
-- ==========================================
CREATE TABLE workflow_definitions (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  session_mode   TEXT NOT NULL DEFAULT 'auto',  -- 'single' | 'per-stage' | 'auto'
  copilot_config TEXT,                          -- JSON
  variables      TEXT DEFAULT '[]',             -- JSON array of VariableDefinition
  tags           TEXT DEFAULT '[]',             -- JSON array
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_workflow_defs_created_at ON workflow_definitions(created_at);

-- ==========================================
-- Table: stage_definitions
-- ==========================================
CREATE TABLE stage_definitions (
  id                       TEXT PRIMARY KEY,
  workflow_definition_id   TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  description              TEXT,
  template_id              TEXT,                -- Optional link to workflow_templates
  "order"                  INTEGER NOT NULL DEFAULT 0,
  prompts                  TEXT DEFAULT '[]',   -- JSON array of PromptDefinition
  copilot_config_overrides TEXT,                -- JSON
  variables                TEXT DEFAULT '{}',   -- JSON object
  hooks                    TEXT DEFAULT '[]',   -- JSON array of HookDefinition
  retry_policy             TEXT,                -- JSON RetryPolicy
  timeout_ms               INTEGER,
  condition                TEXT,                -- JSON StageCondition
  created_at               INTEGER NOT NULL
);
CREATE INDEX idx_stage_defs_workflow ON stage_definitions(workflow_definition_id);
CREATE INDEX idx_stage_defs_order ON stage_definitions(workflow_definition_id, "order");

-- ==========================================
-- Table: stage_edges
-- ==========================================
CREATE TABLE stage_edges (
  id                       TEXT PRIMARY KEY,
  workflow_definition_id   TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  from_stage_id            TEXT NOT NULL REFERENCES stage_definitions(id) ON DELETE CASCADE,
  to_stage_id              TEXT NOT NULL REFERENCES stage_definitions(id) ON DELETE CASCADE,
  edge_type                TEXT NOT NULL DEFAULT 'on_success'  -- 'on_success' | 'on_failure' | 'on_completion' | 'always'
);
CREATE INDEX idx_stage_edges_workflow ON stage_edges(workflow_definition_id);
CREATE INDEX idx_stage_edges_from ON stage_edges(from_stage_id);
CREATE INDEX idx_stage_edges_to ON stage_edges(to_stage_id);
CREATE UNIQUE INDEX idx_stage_edges_unique ON stage_edges(from_stage_id, to_stage_id);

-- ==========================================
-- Table: workflow_runs
-- ==========================================
CREATE TABLE workflow_runs (
  id                       TEXT PRIMARY KEY,
  workflow_definition_id   TEXT NOT NULL REFERENCES workflow_definitions(id),
  name                     TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'created',
  session_mode             TEXT NOT NULL DEFAULT 'auto',
  variables                TEXT DEFAULT '{}',   -- JSON resolved variables
  error                    TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  started_at               INTEGER,
  completed_at             INTEGER
);
CREATE INDEX idx_workflow_runs_definition ON workflow_runs(workflow_definition_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX idx_workflow_runs_created_at ON workflow_runs(created_at);

-- ==========================================
-- Table: stage_runs
-- ==========================================
CREATE TABLE stage_runs (
  id                       TEXT PRIMARY KEY,
  workflow_run_id          TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage_definition_id      TEXT NOT NULL REFERENCES stage_definitions(id),
  session_id               TEXT REFERENCES sessions(id),
  name                     TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending',
  current_step             INTEGER NOT NULL DEFAULT 0,
  total_steps              INTEGER NOT NULL DEFAULT 0,
  retry_count              INTEGER NOT NULL DEFAULT 0,
  error                    TEXT,
  created_at               INTEGER NOT NULL,
  started_at               INTEGER,
  completed_at             INTEGER
);
CREATE INDEX idx_stage_runs_workflow_run ON stage_runs(workflow_run_id);
CREATE INDEX idx_stage_runs_session ON stage_runs(session_id);
CREATE INDEX idx_stage_runs_status ON stage_runs(status);
```

### 5.2 Modified Tables

```sql
-- Sessions table: Simplified (no longer aggregate root)
-- Remove: name, description, tags, triggered_by, requires_codebase (move to Chat/WorkflowRun)
-- Keep: id, status, model, repo_url, repo_branch, workspace_path, conversation_id, timestamps
-- Add: owner_type ('chat' | 'stage_run'), owner_id (polymorphic FK)

ALTER TABLE sessions ADD COLUMN owner_type TEXT;          -- 'chat' | 'stage_run'
ALTER TABLE sessions ADD COLUMN owner_id TEXT;             -- FK to chats or stage_runs
ALTER TABLE sessions ADD COLUMN conversation_id TEXT;      -- Copilot SDK conversation ID

-- Events table: Add workflow_run_id and stage_run_id for richer context
ALTER TABLE events ADD COLUMN workflow_run_id TEXT;
ALTER TABLE events ADD COLUMN stage_run_id TEXT;

-- Chat messages: Add chat_id column 
ALTER TABLE chat_messages ADD COLUMN chat_id TEXT;

-- Artifacts: Add workflow_run_id and stage_run_id
ALTER TABLE artifacts ADD COLUMN workflow_run_id TEXT;
ALTER TABLE artifacts ADD COLUMN stage_run_id TEXT;
```

### 5.3 Migration Strategy
- **Phase 1**: Add new tables with `CREATE TABLE IF NOT EXISTS`
- **Phase 2**: Add new columns to existing tables with `ALTER TABLE ... ADD COLUMN`
- **Phase 3**: Migrate existing Session+Workflow data into new schema (data migration script)
- **Phase 4**: Mark old `workflows` table as deprecated (keep for backward compat reads)

---

## 6. State Machines

### 6.1 Session State Machine (Simplified)

```
                ┌────────────┐
                │  created   │
                └─────┬──────┘
                      │ activate
                      ▼
                ┌────────────┐
          ┌────▶│   active   │◀────┐
          │     └──┬──────┬──┘     │
          │        │      │        │
     resume│  pause│ close│   error│recover
          │        ▼      ▼        │
          │  ┌─────────┐ ┌──────┐  │
          └──│ paused  │ │closed│  │
             └─────────┘ └──────┘  │
                          ┌────────┘
                          │
                     ┌────────┐
                     │ error  │
                     └────────┘
```

> **Updated**: The Session state machine now includes a `closing` transitional state
> to track in-progress Copilot SDK cleanup (abort/destroy calls).

```
                ┌────────────┐
                │  created   │
                └─────┬──────┘
                      │ activate
                      ▼
                ┌────────────┐
          ┌────▶│   active   │◀────┐
          │     └──┬──┬───┬──┘     │
          │        │  │   │        │
     resume│  pause│  │close error│recover
          │        │  │   │        │
          │        ▼  │   ▼        │
          │  ┌───────┐│ ┌───────┐  │
          └──│paused ││ │closing│  │
             └───────┘│ └──┬────┘  │
                      │    │       │
                      ▼    ▼       │
                    ┌────────┐     │
                    │ closed │     │
                    └────────┘     │
                          ┌────────┘
                          │
                     ┌────────┐
                     │ error  │
                     └────────┘
```

**States**: `created`, `active`, `paused`, `closing`, `closed`, `error` (6 states)  
**Transitions**: 9

| From | Trigger | To | Copilot SDK Action |
|------|---------|-----|--------------------|
| created | `sys:activate` | active | `copilot.createConversation()` |
| active | `user:pause` | paused | `copilot.abortConversation()` — abort in-flight turn |
| active | `user:close` | closing | `copilot.abortConversation()` + begin `destroyConversation()` |
| active | `sys:error` | error | (none — SDK already errored) |
| paused | `user:resume` | active | `copilot.resumeConversation()` if handle lost, then `sendPrompt()` |
| paused | `user:close` | closing | `copilot.destroyConversation()` |
| closing | `sys:cleanup_done` | closed | (cleanup complete) |
| error | `sys:recover` | active | `copilot.resumeConversation()` |
| error | `user:close` | closed | best-effort `copilot.destroyConversation()` |

> **Key**: The `closing` state ensures no new prompts are accepted while SDK abort/destroy
> calls are in progress. This replaces v1's `cancelling` concept but at the session level.

### 6.2 WorkflowRun State Machine

```
          ┌──────────┐
          │ created  │
          └────┬─────┘
               │ start
               ▼
          ┌──────────┐
          │ starting │──── fail ───▶ ┌────────┐
          └────┬─────┘               │ failed │
               │ ready               └────────┘
               ▼                          ▲
          ┌──────────┐                    │
    ┌────▶│ running  │── stage_fail ──────┘
    │     └──┬────┬──┘
    │        │    │
  resume   pause cancel
    │        │    │
    │        ▼    ▼
    │  ┌────────┐ ┌────────────┐
    └──│ paused │ │ cancelling │
       └────────┘ └──────┬─────┘
                         │ all_stopped
                         ▼
                   ┌───────────┐
                   │ cancelled │
                   └───────────┘

  running ── all_done ──▶ ┌───────────┐
                          │ completed │
                          └───────────┘
```

**States**: 8 (`created`, `starting`, `running`, `paused`, `cancelling`, `completed`, `failed`, `cancelled`)  
**Transitions**: 10

| From | Trigger | To |
|------|---------|-----|
| created | `user:start` | starting |
| starting | `sys:ready` | running |
| starting | `sys:fail` | failed |
| running | `user:pause` | paused |
| running | `user:cancel` | cancelling |
| running | `sys:all_done` | completed |
| running | `sys:stage_fail` | failed |
| paused | `user:resume` | running |
| paused | `user:cancel` | cancelling |
| cancelling | `sys:all_stopped` | cancelled |

### 6.3 StageRun State Machine

```
          ┌──────────┐
          │ pending  │─── skip ──▶ ┌─────────┐
          └────┬─────┘             │ skipped │
               │ queue             └─────────┘
               ▼
          ┌──────────┐
          │ queued   │
          └────┬─────┘
               │ start
               ▼
          ┌──────────┐
    ┌────▶│ running  │
    │     └──┬──┬──┬─┘
    │        │  │  │
  resume  pause│ fail/cancel
    │        │  │  │
    │        ▼  │  ▼
    │  ┌───────┐│ ┌───────────┐
    └──│paused ││ │ failed    │
       └───────┘│ │ cancelled │
                │ └───────────┘
                ▼
          ┌───────────┐
          │ completed │
          └───────────┘
```

**States**: 8 (`pending`, `queued`, `running`, `paused`, `completed`, `failed`, `cancelled`, `skipped`)  
**Transitions**: 10

---

## 7. DAG Scheduler Design

The DAG Scheduler is the core orchestration engine for workflow execution. It replaces the sequential workflow advancement in the current `SessionService.onWorkflowCompleted()`.

### 7.1 DAG Representation

```typescript
interface DAG {
  stages: Map<string, StageNode>;
  edges: StageEdge[];
}

interface StageNode {
  stageDefinitionId: string;
  stageRunId: string;
  dependencies: string[];    // IDs of stages this stage depends on
  dependents: string[];      // IDs of stages that depend on this stage
}
```

### 7.2 Scheduling Algorithm

```
function scheduleNextStages(workflowRun, completedStageId?):
  1. Build in-memory DAG from workflow definition + edges
  2. Query current StageRun statuses for this WorkflowRun
  3. Identify "ready" stages:
     - Status is 'pending'
     - ALL dependencies are in terminal state (completed/skipped/failed)
     - Dependency edge conditions are met:
       - on_success → dependency completed
       - on_failure → dependency failed
       - on_completion → dependency completed OR failed
       - always → unconditional
     - Stage's own condition evaluates to true
  4. For each ready stage:
     a. Evaluate stage condition → skip if false
     b. Allocate session (see §8)
     c. Transition pending → queued → running
     d. Start stage execution (fire-and-forget)
  5. If no stages running AND no stages pending/queued:
     - If all stages completed/skipped → WorkflowRun → completed
     - If any stage failed → WorkflowRun → failed
```

### 7.3 DAG Validation (Design-Time)

```typescript
function validateDAG(stages: StageDefinition[], edges: StageEdge[]): ValidationResult {
  // 1. Check for cycles using topological sort (Kahn's algorithm)
  // 2. Check all edge references point to valid stages
  // 3. Check no self-edges
  // 4. Check no duplicate edges
  // 5. Check at least one "root" stage (no incoming edges)
  // 6. Check all stages are reachable from at least one root
  return { valid: boolean; errors: string[] };
}
```

### 7.4 Topological Sort for Execution Order

```typescript
function topologicalSort(stages: StageNode[], edges: StageEdge[]): string[] {
  // Kahn's algorithm:
  // 1. Find all nodes with in-degree 0 (root stages)
  // 2. BFS: remove node, decrement in-degree of dependents
  // 3. If result length < total stages → cycle detected
  // Returns execution order array of stage IDs
}
```

### 7.5 Parallel Execution Example

```
Workflow Definition:
  Stage A (code-generation) ───▶ Stage C (test-generation)
  Stage B (code-review)     ───▶ Stage C (test-generation)
  Stage C ───▶ Stage D (deploy)

Execution:
  t=0: A starts (session 1), B starts (session 2)  [parallel]
  t=5: A completes
  t=8: B completes
  t=8: C starts (session 3)                         [both deps met]
  t=15: C completes
  t=15: D starts (session 3 or new)                  [dep met]
```

---

## 8. Session Allocation Strategy

### 8.1 Session Modes

| Mode | Behavior | When to Use |
|------|----------|-------------|
| `single` | All stages share one session, execute sequentially | Simple linear workflows, stages need shared context |
| `per-stage` | Every stage gets its own session | Full isolation between stages |
| `auto` (default) | Independent stages → own session; serial chains → shared session | Best balance of parallelism and resource efficiency |

### 8.2 SessionAllocator Service

```typescript
class SessionAllocator {
  /**
   * Determines session allocation for stages based on workflow session mode
   * and DAG structure.
   *
   * SDK calls: createConversation() for new sessions, resumeConversation()
   * for reused sessions that lost their in-memory handle.
   */
  allocateSession(
    workflowRun: WorkflowRun,
    stageRun: StageRun,
    dag: DAG,
    existingSessions: Map<string, Session>
  ): Session {
    switch (workflowRun.sessionMode) {
      case 'single':
        // Return the shared workflow session (create if first stage)
        return getOrCreateSharedSession(workflowRun);
        
      case 'per-stage':
        // Always create a new session
        return createNewSession(stageRun);
        
      case 'auto':
        // Check if stage has exactly one dependency and is the only dependent
        // If so, reuse parent's session (chain sharing)
        // If stage has 0 dependencies (root) or multiple deps → new session
        // If stage has parallel siblings → new session
        if (canShareSession(stageRun, dag)) {
          return reuseParentSession(stageRun, dag, existingSessions);
        }
        return createNewSession(stageRun);
    }
  }
  
  private canShareSession(stageRun: StageRun, dag: DAG): boolean {
    const node = dag.stages.get(stageRun.stageDefinitionId);
    // Can share if: exactly one dependency AND that dependency has exactly one dependent
    // This forms a linear chain that can safely share context
    return (
      node.dependencies.length === 1 &&
      dag.stages.get(node.dependencies[0]).dependents.length === 1
    );
  }
}
```

### 8.3 Session Lifecycle per Owner

```
Chat Session:
  created → active (on first prompt) → paused (if needed) → closing → closed (on archive)

Stage Session (per-stage mode):
  created → active (on stage start) → closing → closed (on stage complete/fail)

Shared Session (single/auto chain):
  created → active (on first stage) → stays active through chain → closing → closed (on last stage complete)
```

### 8.4 Copilot SDK Lifecycle Mapping

This section defines the **exact Copilot SDK method calls** triggered by each domain operation.
This is critical for correctness — every state transition that touches a Copilot conversation
must map to the correct SDK methods.

#### 8.4.1 ICopilotPort Methods Reference

| Method | SDK Call | Effect |
|--------|----------|--------|
| `createConversation(params)` | `client.createSession(config)` | Starts a new Copilot conversation, stores `CopilotSession` handle in memory |
| `resumeConversation(id)` | `client.resumeSession(id)` | Re-hydrates an existing conversation into memory (needed after abort, restart, or handle loss) |
| `sendPrompt(id, text)` | `session.send({prompt})` | Sends a prompt, events arrive via subscription (fire-and-forget) |
| `abortConversation(id)` | `session.abort()` | **Aborts the in-flight turn only** — stops token streaming mid-response. The conversation is preserved and can resume. |
| `destroyConversation(id)` | `session.destroy()` | Tears down the in-memory SDK session handle. The conversation may still exist server-side. |
| `deleteConversation(id)` | `session.destroy()` + `client.deleteSession(id)` | Full cleanup — destroys in-memory handle AND deletes server-side conversation data. |

> **Critical distinction**: `abortConversation()` ≠ `destroyConversation()`.
> Abort stops the current turn but **preserves** the conversation for later `resumeConversation()` + `sendPrompt()`.
> Destroy **tears down** the conversation entirely.

#### 8.4.2 Chat → Session → SDK Mapping

```
ChatManagementService.createChat(params):
  1. Create Chat record (status: 'active')
  2. SessionAllocator.allocateSession() → creates Session (status: 'created')
  3. copilot.createConversation({ conversationId, model, ... })
  4. Session: created → active
  5. Store conversationId on Session

ChatManagementService.sendPrompt(chatId, prompt):
  1. Verify Chat status === 'active'
  2. Get session → verify session status === 'active'
  3. If session.conversationId not in copilot memory (after restart):
     → copilot.resumeConversation(session.conversationId)
  4. copilot.sendPrompt(session.conversationId, prompt)
  5. Subscribe to events via copilot.onConversationEvent()

ChatManagementService.archiveChat(chatId):
  1. Chat: active → archived
  2. If session is 'active':
     → Session: active → closing
     → copilot.abortConversation(session.conversationId)  // stop in-flight turn
     → copilot.destroyConversation(session.conversationId) // tear down handle
     → Session: closing → closed
  3. If session is 'paused':
     → Session: paused → closing
     → copilot.destroyConversation(session.conversationId)
     → Session: closing → closed

Chat deletion (full cleanup):
  1. archiveChat() (above)
  2. copilot.deleteConversation(session.conversationId) // delete server-side data
  3. Delete Session record, Chat record, ChatMessages
```

#### 8.4.3 StageExecution → Session → SDK Mapping

```
StageExecutionService.executeStage(stageRun):
  1. StageRun: queued → running
  2. SessionAllocator.allocateSession(stageRun) → Session
  3. If session is new (status: 'created'):
     → copilot.createConversation({ conversationId, model, workingDirectory, ... })
     → Session: created → active
  4. If session is reused (status: 'active', shared mode):
     → Conversation already in memory, skip creation
  5. If session handle lost (restart scenario):
     → copilot.resumeConversation(session.conversationId)
  6. Subscribe to events: copilot.onConversationEvent(conversationId, handler)
  7. For each prompt in stage:
     → Check stageRun status is still 'running' (may have been paused/cancelled)
     → copilot.sendPrompt(conversationId, prompt.text, attachments)
     → If prompt.waitForCompletion: wait for 'copilot.idle' event
  8. Unsubscribe from events
  9. StageRun: running → completed
  10. If per-stage mode: Session: active → closing → closed
      → copilot.destroyConversation(conversationId)
  11. If shared mode: session stays active for next stage in chain

StageExecutionService.pauseStage(stageRunId):
  1. StageRun: running → paused
  2. Get session allocated to this stageRun
  3. copilot.abortConversation(session.conversationId)  // abort in-flight turn
  4. Session: active → paused
  5. Store stageRun.currentStep (so resume knows where to continue)
  6. Emit 'stage_run.paused' event

StageExecutionService.resumeStage(stageRunId):
  1. StageRun: paused → running
  2. Get session allocated to this stageRun
  3. copilot.resumeConversation(session.conversationId)  // re-hydrate SDK handle
  4. Session: paused → active
  5. Re-enter executeStage() from stageRun.currentStep
  6. Emit 'stage_run.resumed' event

StageExecutionService.cancelStage(stageRunId):
  1. StageRun: running|paused → cancelled
  2. Get session allocated to this stageRun
  3. If session is 'active':
     → copilot.abortConversation(session.conversationId)  // abort in-flight
  4. Session: active|paused → closing
  5. copilot.destroyConversation(session.conversationId)   // tear down
  6. Session: closing → closed
  7. Emit 'stage_run.cancelled' event

StageExecutionService.retryStage(stageRunId):
  1. StageRun: failed → queued (increment retryCount)
  2. Session from failed attempt may be in 'error' state
  3. Create new session (or reuse if recoverable):
     → copilot.createConversation(...) with fresh conversationId
  4. Re-enter executeStage() from step 0
```

#### 8.4.4 WorkflowRun Cascade → Sessions

```
WorkflowRunService.pauseRun(runId):
  1. WorkflowRun: running → paused
  2. For each StageRun with status 'running':
     → StageExecutionService.pauseStage(stageRunId)
       → copilot.abortConversation(session.conversationId)
       → Session: active → paused
     → StageRun: running → paused
  3. Queue stages remain 'queued' (will be scheduled on resume)
  4. Emit 'workflow_run.paused'

WorkflowRunService.resumeRun(runId):
  1. WorkflowRun: paused → running
  2. For each StageRun with status 'paused':
     → StageExecutionService.resumeStage(stageRunId)
       → copilot.resumeConversation(session.conversationId)
       → Session: paused → active
     → StageRun: paused → running
  3. DAGScheduler.scheduleNext() — may start new queued stages
  4. Emit 'workflow_run.resumed'

WorkflowRunService.cancelRun(runId):
  1. WorkflowRun: running → cancelling
  2. For each non-terminal StageRun:
     a. If 'running': StageExecutionService.cancelStage(stageRunId)
        → copilot.abortConversation() + destroyConversation()
        → Session: → closing → closed
     b. If 'paused': StageExecutionService.cancelStage(stageRunId)
        → copilot.destroyConversation()
        → Session: → closing → closed
     c. If 'queued'|'pending': StageRun → cancelled (no session to clean up)
  3. WorkflowRun: cancelling → cancelled (after all stages stopped)
  4. SessionAllocator.releaseAll(runId) — final cleanup
  5. Emit 'workflow_run.cancelled'

WorkflowRunService (on all stages complete):
  1. WorkflowRun: running → completed
  2. For shared sessions (single/auto mode):
     → copilot.destroyConversation(session.conversationId)
     → Session: active → closing → closed
  3. (per-stage sessions already closed individually)
  4. Emit 'workflow_run.completed'
```

#### 8.4.5 Server Restart Recovery

```
StartupRecoveryService.recover():
  1. Find all Sessions with status 'active' or 'paused'
  2. For each session:
     → Call copilot.resumeConversation(session.conversationId)
     → If SDK reports conversation not found: Session → error
     → If SDK reports conversation alive: re-subscribe to events
  3. Find all WorkflowRuns with status 'running':
     → Mark as 'paused' (conservative — let user resume manually)
     → All running StageRuns → 'paused'
  4. Find all Sessions with status 'closing':
     → Complete the cleanup: destroyConversation() → Session → closed
```

---

## 9. Service Layer Changes

### 9.1 New Services

| Service | Responsibility |
|---------|---------------|
| `ChatManagementService` | Chat CRUD, session creation, chat prompt handling — calls `createConversation`, `sendPrompt`, `abortConversation`, `destroyConversation` |
| `WorkflowDefinitionService` | WorkflowDefinition + StageDefinition + StageEdge CRUD, DAG validation |
| `WorkflowRunService` | Create runs from definitions, lifecycle management (start/pause/resume/cancel) — cascades SDK abort/destroy to stage sessions |
| `StageExecutionService` | Execute a single stage (prompts, hooks, copilot interaction) — calls `sendPrompt`, `abortConversation` for pause, `resumeConversation` for resume |
| `DAGScheduler` | Orchestrate stage execution order based on DAG + dependencies |
| `SessionAllocator` | Allocate/reuse/release Copilot sessions for stages — calls `createConversation`, `resumeConversation`, `destroyConversation` |

### 9.2 Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Presentation Layer                          │
│  (Server Routes / CLI Commands / Web Components)               │
└───────────────┬─────────────────────────────────┬──────────────┘
                │                                 │
    ┌───────────▼──────────┐         ┌────────────▼────────────┐
    │ ChatManagementService│         │ WorkflowDefinitionService│
    │                      │         │                          │
    │ • createChat()       │         │ • createDefinition()    │
    │ • archiveChat()      │         │ • updateDefinition()    │
    │ • sendPrompt()       │         │ • deleteDefinition()    │
    │ • getChatHistory()   │         │ • addStage()            │
    │                      │         │ • removeStage()         │
    └───────────┬──────────┘         │ • addEdge()             │
                │                     │ • removeEdge()          │
                │                     │ • validateDAG()         │
  ┌─────────────▼──────────┐         └──────────┬──────────────┘
  │    SessionAllocator    │                     │
  │                        │◀────────────────────┤
  │ • allocateSession()   │         ┌────────────▼────────────┐
  │ • releaseSession()    │         │   WorkflowRunService    │
  │ • getOrCreate()       │         │                          │
  └────────────────────────┘         │ • createRun()           │
                ▲                     │ • startRun()            │
                │                     │ • pauseRun()            │
                │                     │ • resumeRun()           │
                │                     │ • cancelRun()           │
                │                     └──────────┬──────────────┘
                │                                │
                │                     ┌──────────▼──────────────┐
                │                     │     DAGScheduler        │
                └─────────────────────│                          │
                                      │ • buildDAG()            │
                                      │ • scheduleNext()        │
                                      │ • onStageCompleted()    │
                                      │ • onStageFailed()       │
                                      └──────────┬──────────────┘
                                                 │
                                      ┌──────────▼──────────────┐
                                      │  StageExecutionService  │
                                      │                          │
                                      │ • executeStage()        │  ← copilot.createConversation + sendPrompt
                                      │ • pauseStage()          │  ← copilot.abortConversation
                                      │ • resumeStage()         │
                                      │ • cancelStage()         │
                                      └─────────────────────────┘
```

### 9.3 Service Details

#### ChatManagementService
```typescript
class ChatManagementService {
  constructor(
    chatRepo: IChatRepository,
    sessionAllocator: SessionAllocator,
    chatService: ChatService,  // Existing, for Copilot interaction
    eventBus: EventBus
  );

  async createChat(params: CreateChatParams): Promise<Chat>;
  async archiveChat(chatId: string): Promise<void>;  // Calls abort + destroy on SDK session
  async sendPrompt(chatId: string, prompt: string, attachments?: File[]): Promise<void>; // Calls resumeConversation if needed + sendPrompt
  async getChatHistory(chatId: string, limit?: number, offset?: number): Promise<ChatMessage[]>;
  async listChats(filter?: { status?: ChatStatus }): Promise<Chat[]>;
  async getChat(chatId: string): Promise<Chat>;
}
```

#### WorkflowDefinitionService
```typescript
class WorkflowDefinitionService {
  constructor(
    defRepo: IWorkflowDefinitionRepository,
    stageDefRepo: IStageDefinitionRepository,
    edgeRepo: IStageEdgeRepository
  );

  async createDefinition(params: CreateWorkflowDefinitionParams): Promise<WorkflowDefinition>;
  async updateDefinition(id: string, updates: Partial<WorkflowDefinition>): Promise<WorkflowDefinition>;
  async deleteDefinition(id: string): Promise<void>;
  async getDefinition(id: string): Promise<WorkflowDefinitionWithStages>;
  async listDefinitions(): Promise<WorkflowDefinition[]>;
  
  // Stage operations
  async addStage(defId: string, stage: CreateStageParams): Promise<StageDefinition>;
  async updateStage(stageId: string, updates: Partial<StageDefinition>): Promise<StageDefinition>;
  async removeStage(stageId: string): Promise<void>;
  async reorderStages(defId: string, stageIds: string[]): Promise<void>;
  
  // Edge operations  
  async addEdge(defId: string, edge: CreateEdgeParams): Promise<StageEdge>;
  async removeEdge(edgeId: string): Promise<void>;
  
  // Validation
  async validateDAG(defId: string): Promise<DAGValidationResult>;
  
  // Import/Export
  async importFromTemplate(templateId: string): Promise<WorkflowDefinition>;
  async exportAsTemplate(defId: string): Promise<WorkflowTemplate>;
}
```

#### WorkflowRunService
```typescript
class WorkflowRunService {
  constructor(
    runRepo: IWorkflowRunRepository,
    stageRunRepo: IStageRunRepository,
    defService: WorkflowDefinitionService,
    dagScheduler: DAGScheduler,
    eventBus: EventBus,
    errorHandler: ErrorHandler
  );

  async createRun(defId: string, variables?: Record<string, unknown>): Promise<WorkflowRun>;
  async startRun(runId: string): Promise<void>;
  async pauseRun(runId: string): Promise<void>;
  async resumeRun(runId: string): Promise<void>;
  async cancelRun(runId: string): Promise<void>;  // Cascades abort+destroy to all stage sessions
  async deleteRun(runId: string): Promise<void>;   // Calls deleteConversation for full cleanup
  
  async getRun(runId: string): Promise<WorkflowRunWithStages>;
  async listRuns(filter?: { defId?: string; status?: string }): Promise<WorkflowRun[]>;
  
  // Callbacks from DAGScheduler
  async onStageCompleted(runId: string, stageRunId: string): Promise<void>;
  async onStageFailed(runId: string, stageRunId: string, error: string): Promise<void>;
}
```

#### DAGScheduler
```typescript
class DAGScheduler {
  constructor(
    stageExecService: StageExecutionService,
    sessionAllocator: SessionAllocator,
    stageRunRepo: IStageRunRepository,
    edgeRepo: IStageEdgeRepository,
    eventBus: EventBus
  );

  async buildDAG(workflowDefinitionId: string): Promise<DAG>;
  async scheduleNext(workflowRunId: string, completedStageRunId?: string): Promise<void>;
  async onStageCompleted(workflowRunId: string, stageRunId: string): Promise<void>;
  async onStageFailed(workflowRunId: string, stageRunId: string): Promise<void>;
  
  // DAG analysis utilities
  getRootStages(dag: DAG): string[];
  getReadyStages(dag: DAG, stageStatuses: Map<string, StageRunStatus>): string[];
  isDAGComplete(dag: DAG, stageStatuses: Map<string, StageRunStatus>): boolean;
}
```

### 9.4 Existing Service Changes

| Service | Changes |
|---------|---------|
| `SessionService` | Simplified to pure session lifecycle (create/activate/pause/close), removes workflow orchestration |
| `WorkflowService` | **Deprecated** — replaced by `StageExecutionService` (prompt execution logic extracted) |
| `ChatService` | Remains largely unchanged, used by `ChatManagementService` internally |
| `ConfigResolver` | Extended to merge WorkflowDefinition config → StageDefinition overrides |
| `HookExecutor` | Unchanged — still executes hooks per stage |
| `HookInterceptor` | Updated to work with StageRun context instead of Workflow context |
| `StartupRecoveryService` | Updated to recover WorkflowRuns + StageRuns instead of Sessions + Workflows |
| `ErrorHandler` | Extended with new error types for DAG validation, session allocation |
| `ArtifactService` | Updated to associate artifacts with StageRuns |

---

## 10. Event System Changes

### 10.1 New Event Kinds

```typescript
// Chat events
| 'chat.created'
| 'chat.archived'
| 'chat.prompt_sent'
| 'chat.message_received'

// Workflow definition events (design-time, not persisted to events table)
| 'workflow_def.created'
| 'workflow_def.updated'
| 'workflow_def.deleted'
| 'workflow_def.stage_added'
| 'workflow_def.stage_removed'
| 'workflow_def.edge_added'
| 'workflow_def.edge_removed'

// Workflow run events
| 'workflow_run.created'
| 'workflow_run.starting'
| 'workflow_run.running'
| 'workflow_run.paused'
| 'workflow_run.resumed'
| 'workflow_run.completed'
| 'workflow_run.failed'
| 'workflow_run.cancelled'

// Stage run events
| 'stage_run.pending'
| 'stage_run.queued'
| 'stage_run.started'
| 'stage_run.step_started'
| 'stage_run.step_completed'
| 'stage_run.completed'
| 'stage_run.failed'
| 'stage_run.paused'
| 'stage_run.resumed'
| 'stage_run.cancelled'
| 'stage_run.skipped'
| 'stage_run.retrying'
```

### 10.2 Event Scoping

Events are scoped by **owner context**:
- **Chat events**: scoped by `chatId` (sessionId for Copilot events)
- **WorkflowRun events**: scoped by `workflowRunId`
- **StageRun events**: scoped by `workflowRunId` + `stageRunId`
- **Session-level events** (copilot.*): scoped by `sessionId`

The `EventBus` subscription model is extended:
```typescript
eventBus.subscribe(sessionId, handler);           // Existing
eventBus.subscribeToWorkflowRun(runId, handler);  // New
eventBus.subscribeToChat(chatId, handler);         // New
```

### 10.3 SSE Streaming Changes

The multiplexed SSE stream (`/api/events/stream`) is extended:
- Each SSE event includes `context: { type: 'chat' | 'workflow_run' | 'stage_run', id: string }`
- Web app dispatches to correct store based on context type
- New `sseManager` handlers for workflow_run and stage_run events

---

## 11. API Changes (Server)

### 11.1 New Routes

```
API Routes — New Endpoints

Chat Management:
  POST   /api/chats                          Create chat
  GET    /api/chats                          List chats (?status)
  GET    /api/chats/:id                      Get chat details
  DELETE /api/chats/:id                      Archive/delete chat
  POST   /api/chats/:id/prompt               Send prompt to chat
  GET    /api/chats/:id/messages              Get chat message history
  GET    /api/chats/:id/stream                SSE stream for chat

Workflow Definitions:
  POST   /api/workflow-definitions            Create workflow definition
  GET    /api/workflow-definitions            List definitions (?tags)
  GET    /api/workflow-definitions/:id        Get definition with stages & edges
  PUT    /api/workflow-definitions/:id        Update definition
  DELETE /api/workflow-definitions/:id        Delete definition
  POST   /api/workflow-definitions/:id/validate  Validate DAG
  POST   /api/workflow-definitions/:id/import-template  Import from template
  POST   /api/workflow-definitions/:id/export-template  Export as template

Stage Definitions (nested under workflow definition):
  POST   /api/workflow-definitions/:id/stages           Add stage
  PUT    /api/workflow-definitions/:id/stages/:stageId   Update stage
  DELETE /api/workflow-definitions/:id/stages/:stageId   Remove stage
  POST   /api/workflow-definitions/:id/stages/reorder    Reorder stages

Stage Edges:
  POST   /api/workflow-definitions/:id/edges             Add edge
  DELETE /api/workflow-definitions/:id/edges/:edgeId   Remove edge

Workflow Runs:
  POST   /api/workflow-runs                   Create run from definition
  GET    /api/workflow-runs                   List runs (?definitionId, ?status)
  GET    /api/workflow-runs/:id               Get run with stage runs
  POST   /api/workflow-runs/:id/start         Start run
  POST   /api/workflow-runs/:id/pause         Pause run
  POST   /api/workflow-runs/:id/resume        Resume run
  POST   /api/workflow-runs/:id/cancel        Cancel run
  DELETE /api/workflow-runs/:id               Delete run
  GET    /api/workflow-runs/:id/stream        SSE stream for run

Stage Runs (nested under workflow run):
  GET    /api/workflow-runs/:id/stages        List stage runs
  POST   /api/workflow-runs/:runId/stages/:stageId/pause   Pause stage
  POST   /api/workflow-runs/:runId/stages/:stageId/resume  Resume stage
  POST   /api/workflow-runs/:runId/stages/:stageId/retry   Retry failed stage
  POST   /api/workflow-runs/:runId/stages/:stageId/cancel  Cancel stage
```

### 11.2 Deprecated Routes

The following existing routes are deprecated but maintained for backward compatibility:

```
DEPRECATED (map to new endpoints internally):
  POST   /api/sessions                 → Use /api/chats or /api/workflow-runs
  GET    /api/sessions                 → Use /api/chats + /api/workflow-runs
  POST   /api/sessions/:id/start       → Use /api/workflow-runs/:id/start
  POST   /api/sessions/:id/prompt      → Use /api/chats/:id/prompt
```

### 11.3 Composition Root Changes

```typescript
// New services to wire in composition-root.ts:
const chatRepo = new DrizzleChatRepository(db);
const workflowDefRepo = new DrizzleWorkflowDefinitionRepository(db);
const stageDefRepo = new DrizzleStageDefinitionRepository(db);
const stageEdgeRepo = new DrizzleStageEdgeRepository(db);
const workflowRunRepo = new DrizzleWorkflowRunRepository(db);
const stageRunRepo = new DrizzleStageRunRepository(db);

const sessionAllocator = new SessionAllocator(sessionRepo, copilotAdapter, gitManager);
const workflowDefService = new WorkflowDefinitionService(workflowDefRepo, stageDefRepo, stageEdgeRepo);
const stageExecService = new StageExecutionService(stageRunRepo, sessionAllocator, copilotAdapter, eventBus, hookExecutor, hookInterceptor, configResolver, gitManager);
const dagScheduler = new DAGScheduler(stageExecService, sessionAllocator, stageRunRepo, stageEdgeRepo, eventBus);
const workflowRunService = new WorkflowRunService(workflowRunRepo, stageRunRepo, workflowDefService, dagScheduler, eventBus, errorHandler);
const chatManagementService = new ChatManagementService(chatRepo, sessionAllocator, chatService, eventBus);
```

---

## 12. Web UI Architecture

### 12.1 Navigation & Layout Changes

```
App Layout (Revised)
├── Sidebar
│   ├── Navigation Tabs: [Chats] [Workflows]
│   ├── Tab: Chats
│   │   ├── "New Chat" button
│   │   └── ChatList (sorted by updatedAt, status indicators)
│   └── Tab: Workflows
│       ├── "New Workflow" button  
│       └── WorkflowDefinitionList (saved workflow definitions)
├── Header
│   ├── Breadcrumb (context-aware: Chat > name / Workflow > name > Run #N)
│   ├── Action buttons (context-dependent)
│   └── Connection status / Theme toggle
└── <Outlet>
    ├── EmptyState (welcome screen)
    ├── ChatPage (replaces SessionDetailPage for chats)
    ├── WorkflowDefinitionPage (view/edit definition)
    │   ├── WorkflowBuilder (DAG editor)
    │   └── WorkflowConfigPanel (settings, variables)
    ├── WorkflowRunPage (runtime monitoring)
    │   ├── DAGVisualization (real-time stage status)
    │   ├── StageDetail (selected stage's output/logs)
    │   └── RunControls (start/pause/resume/cancel)
    ├── WorkflowListPage (all definitions + recent runs)
    ├── TemplateExplorerPage (unchanged)
    └── SettingsPage (unchanged)
```

### 12.2 Routes (Updated)

```typescript
// router.tsx (revised)
const routes = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <EmptyState /> },
      
      // Chats
      { path: 'chats/:id', element: <ChatPage />, lazy: true },
      
      // Workflow Definitions
      { path: 'workflows', element: <WorkflowListPage />, lazy: true },
      { path: 'workflows/new', element: <WorkflowBuilderPage />, lazy: true },
      { path: 'workflows/:id', element: <WorkflowDefinitionPage />, lazy: true },
      { path: 'workflows/:id/edit', element: <WorkflowBuilderPage />, lazy: true },
      
      // Workflow Runs
      { path: 'workflows/:defId/runs/:runId', element: <WorkflowRunPage />, lazy: true },
      
      // Existing
      { path: 'templates', element: <TemplateExplorerPage />, lazy: true },
      { path: 'settings', element: <SettingsPage />, lazy: true },
      // Backward compat — redirect old session URLs
      { path: 'sessions/:id', element: <SessionRedirect /> },
      
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
```

### 12.3 Workflow Builder UI (Key Component)

The Workflow Builder is the most complex new UI component. It draws heavily from n8n's visual editor and GitHub Actions' DAG model.

#### Visual DAG Editor

```
┌─────────────────────────────────────────────────────────────────┐
│ Workflow Builder                                    [Save] [Run]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Canvas Area (pannable, zoomable)                              │
│                                                                 │
│    ┌──────────┐         ┌──────────┐                           │
│    │  Stage A  │────────▶│  Stage C  │                          │
│    │ Code Gen  │         │ Testing   │────▶ ┌──────────┐       │
│    └──────────┘    ┌────▶│           │      │  Stage D  │       │
│                    │     └──────────┘      │  Deploy   │       │
│    ┌──────────┐    │                       └──────────┘       │
│    │  Stage B  │───┘                                           │
│    │ Review    │                                                │
│    └──────────┘                                                │
│                                                                 │
│    [+ Add Stage]                                    Zoom: 100% │
├─────────────────────────────────────────────────────────────────┤
│ Properties Panel (right sidebar, shown when stage selected)     │
│                                                                 │
│  Stage: Code Generation                                        │
│  ┌───────────────────────────────────────────────────┐         │
│  │ Name: [Code Generation        ]                   │         │
│  │ Template: [code-generation-v1  ▼]                 │         │
│  │ Model: [gpt-4.1              ▼]                   │         │
│  │ Prompts:                                          │         │
│  │   1. [Generate the API endpoint...  ]  [✎] [✕]   │         │
│  │   2. [Add error handling...         ]  [✎] [✕]   │         │
│  │   [+ Add Prompt]                                  │         │
│  │ Timeout: [300000] ms                              │         │
│  │ Retry: [2] times, backoff [1000] ms               │         │
│  │ Condition: [always ▼]                             │         │
│  └───────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

#### Technical Implementation

- **Canvas**: React Flow (https://reactflow.dev/) — battle-tested DAG visualization library
  - Custom node component for stages (shows name, status icon, template type)
  - Custom edge component with edge type labels
  - Drag-and-drop stage placement
  - Click-to-connect edges between stages
  - Canvas controls (zoom, pan, fit-to-view, minimap)
- **Properties Panel**: Slide-out panel on stage selection
  - Form fields for all `StageDefinition` properties
  - Prompt editor with reordering (drag-and-drop)
  - Template selector dropdown (auto-populates prompts/config from template)
  - Variable interpolation preview
- **Toolbar**: Save, Run (with variable inputs modal), Validate DAG, Import/Export
- **Validation**: Real-time DAG validation (cycle detection, reachability) with visual error indicators on invalid edges

#### Stage Node Component States

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ ○ Code Gen      │     │ ● Code Gen      │     │ ✓ Code Gen      │
│   Not started   │     │   Running 2/5   │     │   Completed     │
│   ─────── 0%    │     │   ███████░ 40%  │     │   ───────100%   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
   (design-time)           (runtime: running)     (runtime: done)

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ ✕ Code Gen      │     │ ⏸ Code Gen      │     │ ⊘ Code Gen      │
│   Failed        │     │   Paused 2/5    │     │   Skipped       │
│   Error: ...    │     │   ███████░ 40%  │     │   Condition F   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
   (runtime: failed)     (runtime: paused)      (runtime: skipped)
```

### 12.4 New Components

| Component | Purpose |
|-----------|---------|
| `ChatPage` | Full chat interface (replaces parts of SessionDetail) |
| `ChatList` | Sidebar chat list with status indicators |
| `CreateChatDialog` | Modal for creating a new chat |
| `WorkflowListPage` | Grid/list of workflow definitions + recent runs |
| `WorkflowBuilderPage` | Full-page DAG editor with React Flow |
| `WorkflowDefinitionPage` | Read-only view of definition + list of runs |
| `WorkflowRunPage` | Runtime monitoring with live DAG visualization |
| `DAGCanvas` | React Flow canvas for DAG editing |
| `StageNode` | Custom React Flow node for stages |
| `StageEdge` | Custom React Flow edge with type labels |
| `StagePropertiesPanel` | Right-panel form for stage configuration |
| `PromptEditor` | Editable prompt list with reordering |
| `VariableInputModal` | Modal for entering variable values before run |
| `RunTimeline` | Vertical timeline showing run progress |
| `StageOutput` | Panel showing a stage's chat output/events |
| `DAGMinimap` | React Flow minimap for large workflows |

### 12.5 State Management Changes

#### New Zustand Stores

```typescript
// workflowBuilderStore.ts — Design-time state for the DAG editor
interface WorkflowBuilderStore {
  definition: WorkflowDefinition | null;
  stages: StageDefinition[];
  edges: StageEdge[];
  selectedStageId: string | null;
  isDirty: boolean;
  validationErrors: string[];
  
  // Actions
  setDefinition(def: WorkflowDefinition): void;
  addStage(stage: StageDefinition): void;
  updateStage(id: string, updates: Partial<StageDefinition>): void;
  removeStage(id: string): void;
  addEdge(edge: StageEdge): void;
  removeEdge(id: string): void;
  selectStage(id: string | null): void;
  validate(): void;
  save(): Promise<void>;
}

// workflowRunStore.ts — Runtime state for run monitoring
interface WorkflowRunStore {
  runs: Map<string, WorkflowRunState>;
  
  // Per-run state
  interface WorkflowRunState {
    run: WorkflowRun;
    stageRuns: StageRun[];
    stageStreams: Map<string, StreamState>;  // Per-stage streaming state
  }
}
```

#### New TanStack Query Hooks

```typescript
// New query hooks
useChats(filter?)                          // List chats
useChat(chatId)                            // Single chat
useChatMessages(chatId, limit?, offset?)   // Chat history
useWorkflowDefinitions(filter?)            // List definitions
useWorkflowDefinition(defId)               // Single definition with stages/edges
useWorkflowRuns(defId?, filter?)           // List runs
useWorkflowRun(runId)                      // Single run with stage runs
useStageRuns(runId)                        // Stage runs for a workflow run

// New mutation hooks
useCreateChat()
useArchiveChat()
useSendChatPrompt()
useCreateWorkflowDefinition()
useUpdateWorkflowDefinition()
useDeleteWorkflowDefinition()
useCreateWorkflowRun()
useStartWorkflowRun()
usePauseWorkflowRun()
useResumeWorkflowRun()
useCancelWorkflowRun()
useAddStage()
useUpdateStage()
useRemoveStage()
useAddEdge()
useRemoveEdge()
```

### 12.6 SSE Manager Updates

The `sseManager` is extended to handle new event types:

```typescript
// Extended event processing in sseManager
switch (event.kind) {
  // Existing Copilot events — dispatch by sessionId, resolve to chat/stage
  case 'copilot.token':
  case 'copilot.message_complete':
    // Look up owner (chat or stage_run) by sessionId
    // Dispatch to chatStore or workflowRunStore accordingly
    break;
    
  // New workflow run events
  case 'workflow_run.running':
  case 'workflow_run.completed':
    queryClient.invalidateQueries(['workflow-run', event.data.runId]);
    break;
    
  // New stage run events
  case 'stage_run.started':
  case 'stage_run.completed':
  case 'stage_run.failed':
    queryClient.invalidateQueries(['stage-runs', event.data.runId]);
    workflowRunStore.updateStageRun(event.data.runId, event.data.stageRunId, event.data);
    break;
}
```

---

## 13. CLI Changes

### 13.1 New Commands

```
generatorai chat start [--model <model>] [--repo <url>] [--name <name>]
    Start an interactive chat session

generatorai chat list [--status <status>] [--json]
    List all chats

generatorai chat resume <chatId>
    Resume an existing chat

generatorai workflow list [--json]
    List all workflow definitions

generatorai workflow show <definitionId>
    Show workflow definition with stages and edges

generatorai workflow create --name <name> [--session-mode <mode>]
    Create a new workflow definition (interactive stage builder)

generatorai workflow edit <definitionId>
    Edit a workflow definition (interactive)

generatorai workflow delete <definitionId>
    Delete a workflow definition

generatorai workflow run <definitionId> [--var key=value ...] [--detach]
    Create and start a workflow run

generatorai workflow runs [--definition <defId>] [--status <status>] [--json]
    List workflow runs

generatorai workflow status <runId>
    Show detailed run status with stage progress

generatorai workflow watch <runId>
    Watch run progress in real-time (live DAG in terminal)

generatorai workflow pause <runId>
    Pause a running workflow

generatorai workflow resume <runId>
    Resume a paused workflow

generatorai workflow cancel <runId> [--force]
    Cancel a workflow run
```

### 13.2 Changed Commands

```
DEPRECATED (aliased to new commands):
  generatorai start <template>   → generatorai workflow run <template>
  generatorai stop <sessionId>   → generatorai workflow pause/cancel <runId>
  generatorai list               → generatorai chat list + generatorai workflow runs
  generatorai status <sessionId> → generatorai workflow status <runId>
  generatorai chat <sessionId>   → generatorai chat resume <chatId>
  generatorai watch <sessionId>  → generatorai workflow watch <runId>
```

### 13.3 Terminal DAG Visualization

For `generatorai workflow watch <runId>` and `generatorai workflow status <runId>`:

```
Workflow Run: Feature Implementation (#run-abc123)
Status: Running ● 

Stage DAG:
  ┌──────────────┐     ┌──────────────┐
  │ ✓ Code Gen   ├────▶│ ● Testing    ├────▶ ┌──────────────┐
  │   3/3 done   │     │   1/5 running│      │ ○ Deploy     │
  │   2m 15s     │     │   45s...     │      │   pending    │
  └──────────────┘     └──────────────┘      └──────────────┘
  ┌──────────────┐          │
  │ ✓ Review     ├──────────┘
  │   2/2 done   │
  │   1m 30s     │
  └──────────────┘

Events:
  [12:00:05] ● Stage "Code Gen" started
  [12:02:20] ✓ Stage "Code Gen" completed (2m 15s)
  [12:00:05] ● Stage "Review" started  
  [12:01:35] ✓ Stage "Review" completed (1m 30s)
  [12:02:20] ● Stage "Testing" started
  [12:02:45] → Step 1/5: "Generate unit tests for API..."
```

---

## 14. Backward Compatibility & Migration

### 14.1 Data Migration

```typescript
async function migrateV1ToV2(db: Database): Promise<void> {
  // 1. For each existing Session that has Workflows:
  //    - Create a WorkflowDefinition from template references
  //    - Create StageDefinitions from existing Workflow records
  //    - Create StageEdges for sequential ordering
  //    - Create a WorkflowRun from the session execution data
  //    - Create StageRuns from workflow execution data
  //    - Reparent session to stage_runs
  
  // 2. For each existing Session used for Chat (status completed/cancelled with chat messages):
  //    - Create a Chat record
  //    - Reparent session to chat
  //    - Migrate chat_messages to associate with chat_id
  
  // 3. Keep old tables readable but mark as deprecated
}
```

### 14.2 API Compatibility Layer

- Old `/api/sessions` endpoints continue to work via thin adapter
- Old CLI commands aliased to new equivalents with deprecation warnings
- Old event kinds still emitted alongside new ones during transition period

### 14.3 Template Compatibility

- Existing `templates/*.json` files remain valid
- `WorkflowDefinitionService.importFromTemplate()` converts templates to definitions
- Templates can be used directly when creating single-stage workflow runs

---

## 15. Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| DAG scheduler concurrency bugs | High | Medium | Extensive unit tests with race condition scenarios; mutex on per-run scheduling |
| Session resource leaks | High | Medium | Session finalizer that auto-closes orphaned sessions; periodic cleanup job |
| React Flow performance with large DAGs | Medium | Low | Virtualization; limit to 50 stages per workflow; lazy rendering |
| Shared session race conditions | High | Medium | Sequential execution guarantee for shared-session stages; mutex per session |
| Migration data loss | High | Low | Backup before migration; dry-run mode; rollback script |
| Backward compatibility breaks | Medium | Medium | Adapter layer for old APIs; deprecation warnings; phased rollout |
| Complex state machine interactions | Medium | Medium | Comprehensive state machine tests; formal verification of transition tables |
| EventBus contention with parallel stages | Medium | Low | Per-session event queues (already exists); separate queues per stage_run |
| UI complexity overwhelming users | Medium | Medium | Progressive disclosure; simple mode (sequential) vs advanced mode (DAG) |

---

## Appendix A: Technology Choices for New Components

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| DAG Visual Editor | React Flow | Most popular React DAG library, MIT license, excellent customization, 20k+ GitHub stars |
| DAG Canvas Persistence | React Flow's `toObject()`/`fromObject()` | Native serialization of node positions/viewport |
| DAG Validation (cycles) | Kahn's algorithm | O(V+E), well-understood, deterministic |
| Session allocation | Custom `SessionAllocator` service | Domain-specific logic, no off-the-shelf solution fits |
| Terminal DAG rendering | Custom box-drawing with `blessed` or `Ink` boxes | CLI-native, no external dependencies |

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Chat** | A standalone interactive conversation with one AI session |
| **WorkflowDefinition** | A reusable, saveable blueprint defining stages and their DAG relationships |
| **StageDefinition** | A unit of work within a workflow definition (prompts, config, hooks) |
| **StageEdge** | A dependency link between two stage definitions |
| **WorkflowRun** | A runtime instance of executing a workflow definition |
| **StageRun** | A runtime instance of executing a stage within a workflow run |
| **Session** | A thin wrapper around a Copilot SDK conversation |
| **DAG** | Directed Acyclic Graph — describes stage dependency ordering |
| **SessionMode** | Strategy for allocating sessions to stages (single/per-stage/auto) |
