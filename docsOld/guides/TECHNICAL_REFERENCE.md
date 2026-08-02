# GeneratorAI — Technical Developer Reference

> **Version:** 2.0 | **Last Updated:** March 2026  
> **Audience:** Contributors, maintainers, and developers of GeneratorAI  
> **Purpose:** Complete technical architecture, codebase guide, and development reference

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Package Dependency Graph](#3-package-dependency-graph)
4. [Core Engine — Domain Layer](#4-core-engine--domain-layer)
5. [Core Engine — Service Layer](#5-core-engine--service-layer)
6. [Workflow Execution Engine (Deep Dive)](#6-workflow-execution-engine-deep-dive)
7. [DAG Engine — Scheduling & Validation](#7-dag-engine--scheduling--validation)
8. [Stage Execution Pipeline](#8-stage-execution-pipeline)
9. [Session Allocation Strategy](#9-session-allocation-strategy)
10. [Event System & Real-Time Streaming](#10-event-system--real-time-streaming)
11. [Database Layer](#11-database-layer)
12. [Server & API Layer](#12-server--api-layer)
13. [Web Frontend Architecture](#13-web-frontend-architecture)
14. [CLI Application](#14-cli-application)
15. [Copilot SDK Integration](#15-copilot-sdk-integration)
16. [Template System](#16-template-system)
17. [Hooks System](#17-hooks-system)
18. [Git Integration](#18-git-integration)
19. [Configuration Resolution](#19-configuration-resolution)
20. [Error Handling](#20-error-handling)
21. [Testing Strategy](#21-testing-strategy)
22. [Development Workflow](#22-development-workflow)
23. [Adding a New Feature — Step by Step](#23-adding-a-new-feature--step-by-step)
24. [Key Files Quick Reference](#24-key-files-quick-reference)

---

## 1. Architecture Overview

GeneratorAI follows a **layered hexagonal architecture** with clean separation of concerns:

```
┌──────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │  Web UI  │  │   CLI    │  │ Desktop  │  │  REST API  │  │
│  │ (React)  │  │  (Ink)   │  │(Electron)│  │ (Express)  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
└───────┼──────────────┼─────────────┼──────────────┼──────────┘
        │              │             │              │
┌───────┼──────────────┼─────────────┼──────────────┼──────────┐
│       ▼              ▼             ▼              ▼          │
│           APPLICATION / SERVICE LAYER                        │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ WorkflowOrchestrator │ WorkflowRunService │         │     │
│  │ StageExecutionService │ DAGScheduler │               │     │
│  │ ChatManagementService │ SessionAllocator │           │     │
│  │ ConfigResolver │ HookExecutor │ ResultValidator │    │     │
│  └─────────────────────────────────────────────────────┘     │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────┐
│       DOMAIN LAYER       ▼                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │ State Machines │  │ DAG Validator  │  │ Condition     │  │
│  │ (5 machines)   │  │ (Kahn's algo) │  │ Evaluator     │  │
│  └────────────────┘  └────────────────┘  └───────────────┘  │
│  ┌────────────────┐  ┌────────────────┐                     │
│  │ Port Interfaces│  │ Entity Types   │                     │
│  │ (ICopilotPort) │  │ (15+ entities) │                     │
│  └────────────────┘  └────────────────┘                     │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────┐
│     INFRASTRUCTURE LAYER ▼                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │ SQLite + ORM   │  │ CopilotAdapter │  │ GitManager    │  │
│  │ (Drizzle)      │  │ (SDK Bridge)   │  │ (git ops)     │  │
│  └────────────────┘  └────────────────┘  └───────────────┘  │
│  ┌────────────────┐  ┌────────────────┐                     │
│  │ ScriptRunner   │  │ HttpClient     │                     │
│  │ (sandboxed)    │  │ (fetch)        │                     │
│  └────────────────┘  └────────────────┘                     │
└──────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Hexagonal Architecture** — Core logic has no infrastructure dependencies; all external systems accessed via port interfaces
2. **Event-Driven** — All state changes emit events; UI updates via SSE streaming
3. **DAG-Based Execution** — Workflows execute as directed acyclic graphs with topological ordering
4. **State Machine Enforcement** — All entity state transitions validated by explicit state machines
5. **3-Level Configuration** — Workflow → Stage → Runtime config merge hierarchy
6. **Durable Streaming** — SSE with event replay via `Last-Event-ID` for reconnection

---

## 2. Monorepo Structure

```
GeneratorAI/
├── apps/
│   ├── web/                    # React SPA (Vite + React + TanStack Query)
│   │   └── src/
│   │       ├── pages/          # Route pages (11 routes)
│   │       ├── components/     # React components by domain
│   │       ├── stores/         # Zustand state stores (6 stores)
│   │       ├── hooks/          # Custom React hooks
│   │       ├── platform/       # HttpPlatformClient (API client)
│   │       └── lib/            # Utilities
│   ├── server/                 # Express API server
│   │   └── src/
│   │       ├── routes/         # API route handlers (12 route files)
│   │       ├── middleware/     # Express middleware
│   │       ├── composition-root.ts  # DI container
│   │       ├── app.ts          # Express app factory
│   │       └── index.ts        # Server entry point
│   ├── cli/                    # Commander.js + Ink (React) CLI
│   │   └── src/
│   │       ├── commands/       # CLI command handlers (20+ commands)
│   │       ├── components/     # Ink UI components
│   │       └── platform/       # DirectPlatformClient (in-process)
│   └── desktop/                # Electron (placeholder)
├── packages/
│   ├── core/                   # Business logic engine
│   │   └── src/
│   │       ├── domain/         # Entities, state machines, ports, DAG
│   │       ├── services/       # Application services
│   │       ├── events/         # EventBus
│   │       └── infrastructure/ # GitManager
│   ├── db/                     # Database layer (SQLite + Drizzle ORM)
│   │   └── src/
│   │       ├── schema.ts       # Table definitions (13 tables)
│   │       ├── repositories/   # Repository implementations (12 repos)
│   │       └── migrations/     # v1→v2 migration
│   ├── shared/                 # Shared types, errors, constants
│   │   └── src/
│   │       ├── types/          # Domain types (20+ files)
│   │       ├── errors/         # Error hierarchy (15 types)
│   │       └── constants/      # Constants
│   ├── streaming/              # SSE transport infrastructure
│   │   └── src/
│   │       ├── SSETransport.ts
│   │       └── DurableStreamManager.ts
│   ├── copilot-bridge/         # Copilot SDK adapter
│   │   └── src/
│   │       ├── CopilotAdapter.ts
│   │       ├── event-mapper.ts
│   │       └── tool-factory.ts
│   └── ui/                     # Shared UI components (placeholder)
├── templates/                  # Workflow templates
│   ├── *.json                  # v1 simple templates (5)
│   └── system/                 # v2 system workflow templates (5)
├── docs/                       # Documentation
├── agent-tests/                # E2E tests (Playwright)
└── test-results/               # Test output
```

### Build System

- **Monorepo Manager:** pnpm workspaces
- **Build Orchestrator:** Turborepo (`turbo.json`)
- **Frontend Bundler:** Vite
- **Test Runner:** Vitest + Playwright (E2E)
- **TypeScript:** Shared `tsconfig.base.json` with project references

---

## 3. Package Dependency Graph

```
                  ┌──────────┐
                  │  shared  │ ← Types, errors, constants
                  └────┬─────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
    ┌─────▼─────┐ ┌───▼────┐ ┌────▼──────┐
    │    db     │ │ stream │ │  copilot  │
    │ (Drizzle) │ │ (SSE)  │ │  bridge   │
    └─────┬─────┘ └───┬────┘ └────┬──────┘
          │            │           │
          └────────────┼───────────┘
                       │
                 ┌─────▼─────┐
                 │   core    │ ← Business logic
                 └─────┬─────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
    ┌─────▼─────┐ ┌───▼────┐ ┌────▼──────┐
    │  server   │ │  cli   │ │  desktop  │
    │ (Express) │ │ (Ink)  │ │ (Electron)│
    └───────────┘ └────────┘ └───────────┘
    
    ┌───────────┐
    │   web     │ ← React SPA (talks to server via HTTP)
    └───────────┘
```

---

## 4. Core Engine — Domain Layer

**Location:** `packages/core/src/domain/`

### State Machines

Five state machines enforce legal state transitions:

#### WorkflowRunStateMachine (`domain/state-machines/WorkflowRunStateMachine.ts`)
```
created → starting → running ↔ paused
                   ↘ cancelling → cancelled
                   → completed
                   → failed
```
- **8 states:** created, starting, running, paused, cancelling, completed, failed, cancelled
- **Terminal states:** completed, failed, cancelled

#### StageRunStateMachine (`domain/state-machines/StageRunStateMachine.ts`)
```
pending → queued → running ↔ paused
                 ↘ completed
                 → failed
                 → skipped
                 → cancelled
```
- **8 states:** pending, queued, running, paused, completed, failed, skipped, cancelled
- **12 transitions** including retry, skip, parent cascades

#### SessionStateMachineV2 (`domain/state-machines/SessionStateMachineV2.ts`)
```
created → active ↔ paused → closing → closed
                 → error
```
- **6 states:** created, active, paused, closing, closed, error

### DAG Validator (`domain/dag/DAGValidator.ts`)

Validates workflow graph structure using:
- **Kahn's algorithm** for cycle detection (topological sort with in-degree tracking)
- **BFS reachability** from root nodes for disconnected component detection
- Self-edge, duplicate edge, and invalid reference checks

Key methods:
```typescript
validateDAG(stages, edges): { valid: boolean, errors: string[], warnings: string[] }
topologicalSort(stages, edges): string[]
getExecutionLayers(stages, edges): string[][]  // Parallel execution groups
buildDAG(stages, edges): DAG  // Full graph with nodes, roots, leaves, layers
```

### Condition Evaluator (`domain/dag/ConditionEvaluator.ts`)

Safe expression evaluation without `eval()`:
```typescript
evaluateCondition(condition, context): boolean
// Supports: always, on_success, on_failure, expression
// Expression operators: ==, !=, <, >, <=, >=
// Context vars: status, retryCount, variables.key
```

### Port Interfaces (`domain/ports/`)

| Port | Purpose | Implementation |
|---|---|---|
| `ICopilotPort` | Copilot SDK abstraction | `CopilotAdapter` (copilot-bridge) |
| `IScriptRunner` | Shell script execution | `SandboxedScriptRunner` (server) |
| `IHttpClient` | HTTP requests | `FetchHttpClient` (server) |

Repository ports defined across `domain/ports/` as individual interface files:
- **v1 ports:** `IRepositories.ts` (6 interfaces: Session, Workflow, Event, ChatMessage, Artifact, Webhook)
- **v2 ports:** `IWorkflowDefinitionRepository.ts`, `IStageDefinitionRepository.ts`, `IStageEdgeRepository.ts`, `IWorkflowRunRepository.ts`, `IStageRunRepository.ts`, `IChatRepository.ts`
- **Total:** 12 repository port interfaces

---

## 5. Core Engine — Service Layer

**Location:** `packages/core/src/services/`

### Service Map

| Service | Responsibility | Key Methods |
|---|---|---|
| **WorkflowOrchestrator** | Top-level orchestration pipeline | `startOrchestratedRun()`, `cancelOrchestratedRun()` |
| **WorkflowDefinitionService** | Definition CRUD + DAG management | `createDefinition()`, `addStage()`, `addEdge()`, `validateDefinition()`, `importFromJSON()`, `importFromTemplate()`, `exportAsTemplate()` |
| **WorkflowRunService** | Run lifecycle management | `createRun()`, `startRun()`, `pauseRun()`, `resumeRun()`, `cancelRun()`, `deleteRun()` |
| **StageExecutionService** | Individual stage execution | `executeStage()`, `pauseStage()`, `resumeStage()`, `cancelStage()` |
| **DAGScheduler** | DAG scheduling and dependency tracking | `buildDAGForDefinition()`, `getRootStages()`, `getReadyStages()`, `onStageCompleted()`, `onStageFailed()` |
| **SessionAllocator** | Copilot session management | `allocateSession()`, `releaseSession()`, `releaseAll()` |
| **ChatManagementService** | Chat entity lifecycle | `createChat()`, `sendPrompt()`, `archiveChat()`, `deleteChat()` |
| **ChatService** | v1 chat in sessions | `sendPrompt()`, `getChatHistory()` |
| **ConfigResolver** | 3-level config merge | `resolveStageConfig()` |
| **HookExecutor** | Hook lifecycle execution | `executePhase()` |
| **ResultValidator** | Output validation | `validateStageResult()` |
| **WorkflowPreprocessor** | Pre-execution steps | `execute()`, `cloneRepositories()` |
| **TemplateRegistry** | Template management | `loadFromDirectory()`, `register()`, `get()` |
| **SystemWorkflowRegistry** | System template registry | `register()`, `getAll()`, `createDefinitionFromTemplate()` |
| **ArtifactService** | File artifact management | `createArtifact()`, `readArtifactContent()` |

---

## 6. Workflow Execution Engine (Deep Dive)

### Full Execution Flow

```
WorkflowOrchestrator.startOrchestratedRun(params)
│
├─ 1. Validate inputs (required variables, git repos)
├─ 2. WorkflowRunService.createRun()
│   ├─ Create WorkflowRun (status: created)
│   └─ Create StageRun for each stage (status: pending)
│
├─ 3. Return OrchestratorContext immediately (non-blocking)
│
└─ 4. executeOrchestration() [ASYNC - runs in background]
    │
    ├─ 4a. Create per-run directories
    │   ├─ workspace/   → generated files
    │   ├─ artifacts/   → response docs
    │   └─ uploads/     → user files
    │
    ├─ 4b. GitManager.clone() for each repository
    │   └─ Sets variables: repo_path_{alias}, repo_subdir_{alias}
    │
    ├─ 4c. WorkflowPreprocessor.execute(steps)
    │   ├─ clone_repo → shallow git clone
    │   ├─ validate_input → regex/length/required checks
    │   ├─ set_variable → variable interpolation
    │   ├─ run_script → shell command with env vars
    │   └─ conditional → branch logic
    │
    ├─ 4d. Copy workflow uploads → run uploads
    ├─ 4e. Scan uploads → wire into variables
    │
    ├─ 4f. WorkflowRunService.startRun(runId)
    │   ├─ Transition: created → starting → running
    │   ├─ DAGScheduler.buildDAGForDefinition(defId)
    │   ├─ Get root stages (no incoming edges)
    │   ├─ For each root:
    │   │   └─ StageExecutionService.executeStage() [fire-and-forget]
    │   └─ Start polling (3-second interval)
    │
    ├─ 4g. Polling Loop (every 3 seconds):
    │   ├─ Check for completed stages → onStageCompleted()
    │   │   ├─ DAGScheduler evaluates outgoing edges
    │   │   ├─ Schedule ready dependent stages
    │   │   ├─ Mark unreachable stages as skipped
    │   │   └─ If DAG complete → completeRun()
    │   ├─ Check for failed stages → onStageFailed()
    │   │   ├─ Evaluate failure edges
    │   │   ├─ Check for cascading failures
    │   │   └─ If unrecoverable → failRun()
    │   └─ Skip unreachable stages
    │
    └─ 4h. On completion: result validation (if configured)
```

### Concurrency Model

- **Stage-level parallelism**: Independent stages execute concurrently
- **Prompt-level serialization**: Within a stage, prompts execute sequentially
- **DAG scheduling lock**: `withLock()` prevents concurrent scheduling races
- **Session reference counting**: Shared sessions track active users

### Error Recovery

1. **Stage retry**: Configurable `retryPolicy` with exponential backoff
2. **Failure edges**: `on_failure` edges route to error-handling stages
3. **Cascading skip**: Unreachable stages after failure are automatically skipped
4. **Manual retry**: API endpoint to retry individual failed stages
5. **Polling resilience**: 3-second polling catches missed completion events

---

## 7. DAG Engine — Scheduling & Validation

**Location:** `packages/core/src/domain/dag/` and `packages/core/src/services/DAGScheduler.ts`

### DAG Data Structure

```typescript
interface DAG {
  nodes: Map<string, StageNode>;    // stageDefId → node
  edges: StageEdge[];
  rootIds: string[];                // No incoming edges
  leafIds: string[];                // No outgoing edges
  topologicalOrder: string[];       // Kahn's algorithm result
  executionLayers: string[][];      // Parallel execution groups
}

interface StageNode {
  stage: StageDefinition;
  dependencyIds: string[];          // Stages this depends on
  dependentIds: string[];           // Stages that depend on this
  incomingEdges: StageEdge[];
  outgoingEdges: StageEdge[];
}
```

### Scheduling Algorithm

```
function scheduleNextStages(runId, completedStageDefId):
  1. Lock scheduling mutex for this run
  2. Get outgoing edges from completed stage
  3. For each edge:
     a. Evaluate condition (on_success, on_failure, expression)
     b. Check if ALL dependencies of target are in terminal state
     c. If ready → queue for execution
  4. Get skippable stages (pending with all preds terminal but condition never met)
  5. Mark skippable as 'skipped' (recursive cascade)
  6. Check if DAG is complete (all stages terminal)
  7. If complete → transition run to 'completed'
  8. Release scheduling lock
```

### Execution Layers

Stages are grouped into layers for parallel execution:
```
Layer 0: [A]              ← Root stages (no dependencies)
Layer 1: [B, C]           ← Depend only on Layer 0
Layer 2: [D]              ← Depends on Layer 1
Layer 3: [E, F]           ← Depends on Layer 2
```

Stages in the same layer CAN execute in parallel.

### Cycle Detection

Uses **Kahn's algorithm** (BFS topological sort):
1. Compute in-degree for all nodes
2. Initialize queue with zero in-degree nodes
3. Process queue: remove node, decrement dependents' in-degree
4. If processed count < total nodes → cycle exists

---

## 8. Stage Execution Pipeline

**Location:** `packages/core/src/services/StageExecutionService.ts`

### Execution Steps

```typescript
async executeStage(workflowRunId, stageRunId, stageDefinition, workflowRun):
  // 1. State transition: pending → queued → running
  stageRunRepo.updateStatus(stageRunId, 'queued')
  stageRunRepo.updateStatus(stageRunId, 'running')
  
  // 2. Allocate session
  const session = await sessionAllocator.allocateSession(
    workflowRunId, stageRunId, workflowRun.sessionMode, config
  )
  
  // 3. Resolve config (3-level merge)
  const resolvedConfig = configResolver.resolveStageConfig(
    definition, stageDefinition, runtimeOverrides
  )
  
  // 4. Inject predecessor summaries as context
  const predecessorSummaries = await getPredecessorSummaries(stageRunId)
  // Prepended to first prompt as additional context
  
  // 5. Execute prompts sequentially
  for (let i = stageRun.currentStep; i < prompts.length; i++) {
    // a. Interpolate variables: {{var}} → value
    const text = interpolateVariables(prompt.text, variables)
    
    // b. Send to Copilot SDK
    const response = await copilot.sendPromptAndWait(
      session.conversationId, text, { attachments: prompt.attachments }
    )
    
    // c. Collect metadata
    //    - thinkingText (reasoning_delta events)
    //    - toolCalls (tool_start/complete events)
    //    - systemMessages (system_message events)
    
    // d. Persist assistant message with metadata
    chatMessageRepo.create({
      sessionId: session.id,
      stageRunId,
      role: 'assistant',
      content: response.text,
      metadata: { thinkingText, toolCalls, systemMessages }
    })
    
    // e. Update progress: currentStep = i + 1
    stageRunRepo.update(stageRunId, { currentStep: i + 1 })
  }
  
  // 6. Generate stage summary
  const summary = await generateSummary(session, stageDefinition)
  stageRunRepo.update(stageRunId, { summary })
  
  // 7. Persist artifacts
  await persistStageArtifacts(session.id, stageRunId, stageName, artifactsDir, workspaceDir)
  //    - Extract code blocks from responses (regex: ```lang[filename]\n...\n```)
  //    - Infer filenames (fence header → first-line comment → preceding text)
  //    - Write code files to workspace directory
  //    - Write responses as markdown to artifacts directory
  
  // 8. Release session
  await sessionAllocator.releaseSession(stageRunId)
  
  // 9. Mark completed
  stageRunRepo.updateStatus(stageRunId, 'completed')
  eventBus.emit({ kind: 'stage_run.completed', ... })
```

### Code Block Extraction

```typescript
extractCodeBlocks(text: string): CodeBlock[] {
  // Regex: ```lang[optional-filename]\ncontent\n```
  // Returns: [{ lang, filename?, content }]
}

inferFilename(fenceFilename, content, precedingText): string {
  // Priority:
  // 1. Explicit fence filename: ```typescript src/index.ts
  // 2. First-line comment: // src/index.ts or # src/index.ts
  // 3. Preceding text patterns: **src/index.ts**, `src/index.ts`, ### src/index.ts
  // 4. Auto-generate from language extension
}
```

### Path Sanitization

File paths are sanitized to prevent directory traversal:
- `../` sequences are stripped
- Absolute paths are rejected
- Paths are resolved relative to workspace directory

---

## 9. Session Allocation Strategy

**Location:** `packages/core/src/services/SessionAllocator.ts`

### Modes

| Mode | Behavior | Use Case |
|---|---|---|
| `single` | All stages share ONE session (shared Copilot conversation) | When stages need to see previous context (e.g., E2E testing with shared browser) |
| `per-stage` | Each stage gets a NEW session (isolated conversation) | Maximum parallelism, no cross-stage context bleed |
| `auto` | Treated as per-stage (system decides) | Default; let the system optimize |

### Allocation Flow

```typescript
allocateSession(workflowRunId, stageRunId, mode, config?):
  if mode === 'single':
    // Check if shared session exists for this run
    if sharedSessions.has(workflowRunId):
      refCount++
      return existing session
    else:
      session = createSession()
      conversation = copilot.createConversation(config)
      sharedSessions.set(workflowRunId, { session, refCount: 1 })
      return session
      
  if mode === 'per-stage' or mode === 'auto':
    session = createSession()
    conversation = copilot.createConversation(config)
    return session
```

### Release Flow

```typescript
releaseSession(stageRunId):
  if mode === 'per-stage':
    copilot.destroyConversation(conversationId)
    sessionRepo.updateStatus(sessionId, 'closed')
    
  if mode === 'single':
    refCount--
    // Session stays alive for next stage
```

---

## 10. Event System & Real-Time Streaming

### Event Bus (`packages/core/src/events/EventBus.ts`)

```typescript
class EventBus {
  // Session-scoped subscriptions
  subscribe(sessionId: string, handler: (event) => void): () => void
  subscribeAll(handler: (event) => void): () => void  // All sessions
  
  // Global subscriptions (workflow_run.*, stage_run.*)
  subscribeGlobal(handler: (event) => void): () => void
  
  // Emission
  emit(event: AgentEvent): Promise<void>        // Session-scoped
  emitGlobal(event: AgentEvent): Promise<void>  // Global
}
```

**Key behaviors:**
- Per-session emit queues guarantee in-order DB persistence + broadcast
- Monotonic `sequenceId` per session for deduplication
- `message_complete` idempotency handling (SDK may fire multiple times)
- Global events use reserved `__global__` sessionId

### SSE Architecture

Three SSE endpoints serve different needs:

```
Client (Browser/Agent)
    │
    ├── GET /api/events/stream          ← MULTIPLEXED (all sessions + global)
    │   Ring buffer: 2000 events
    │   Event enrichment: context.type + context.id
    │   Solves HTTP/1.1 6-connection limit
    │
    ├── GET /api/events/global          ← GLOBAL (lifecycle events only)
    │   Ring buffer: 500 events
    │   workflow_run.*, stage_run.* events
    │
    └── GET /api/sessions/:id/stream    ← PER-SESSION (single session)
        DurableStreamManager
        Database-backed replay
        Event kind filtering
```

### Client-Side SSE Management (`apps/web/src/stores/sseManager.ts`)

The web client uses a **single multiplexed EventSource**:

```typescript
sseManager:
  - ONE EventSource connection for ALL sessions
  - Per-session ref counting
  - REST event replay on session connect (/api/sessions/:id/stream/events)
  - Buffer SSE events during replay, deduplicate by sequenceId
  - Flush buffered tokens every 100ms (batched for performance)
  - Routes events to appropriate stores (streamStore, workflowRunStore, etc.)
```

### Event Types (~50 discriminated union members)

```typescript
type AgentEventKind = 
  // Copilot SDK
  | 'copilot.token' | 'copilot.message_complete' | 'copilot.reasoning_delta'
  | 'copilot.tool_start' | 'copilot.tool_complete' | 'copilot.error'
  | 'copilot.idle' | 'copilot.session_start'
  
  // Chat v2
  | 'chat.created' | 'chat.prompt_sent' | 'chat.archived' | 'chat.deleted'
  
  // Workflow Run v2
  | 'workflow_run.created' | 'workflow_run.starting' | 'workflow_run.running'
  | 'workflow_run.paused' | 'workflow_run.completed' | 'workflow_run.failed'
  | 'workflow_run.cancelled'
  
  // Orchestration
  | 'workflow_run.orchestration_started' | 'workflow_run.cloning_repositories'
  | 'workflow_run.preprocessing_started' | 'workflow_run.preprocessing_step_completed'
  | 'workflow_run.stage_validation'
  
  // Stage Run v2
  | 'stage_run.pending' | 'stage_run.queued' | 'stage_run.running'
  | 'stage_run.step_started' | 'stage_run.completed' | 'stage_run.failed'
  | 'stage_run.skipped' | 'stage_run.retrying'
  
  // Git, Script, Hook, Artifact, Permission, Session...
```

---

## 11. Database Layer

**Location:** `packages/db/src/`

### Technology Stack
- **SQLite** with WAL mode for concurrent reads
- **Drizzle ORM** for type-safe queries
- **better-sqlite3** driver

### Schema (13 Tables)

**v1 Tables:**
| Table | Purpose | Key Columns |
|---|---|---|
| `sessions` | Copilot conversation wrapper | id, name, status, ownerType, ownerId, conversationId |
| `workflows` | v1 workflow execution | id, sessionId, templateId, status, variables |
| `events` | Event log (per session) | id, sessionId, kind, data, sequenceId |
| `chat_messages` | Message history | id, sessionId, chatId, role, content, metadata |
| `artifacts` | File artifacts | id, sessionId, name, path, mimeType, size |
| `webhook_registrations` | Webhook config | id, name, source, eventType, templateId |
| `webhook_deliveries` | Webhook logs | id, registrationId, payload, status |

**v2 Tables:**
| Table | Purpose | Key Columns |
|---|---|---|
| `chats` | Chat entity | id, sessionId, name, status (active/archived) |
| `workflow_definitions` | Reusable blueprints | id, name, version, sessionMode, copilotConfig, variables, tags |
| `stage_definitions` | DAG nodes | id, workflowDefinitionId, name, order, prompts, condition |
| `stage_edges` | DAG edges | id, workflowDefinitionId, fromStageId, toStageId, edgeType |
| `workflow_runs` | Execution instances | id, workflowDefinitionId, status, sessionMode, variables |
| `stage_runs` | Stage instances | id, workflowRunId, stageDefinitionId, status, sessionId, retryCount, summary |

### Repository Pattern

Each table has a repository class implementing a port interface:

```typescript
// Port interface (in packages/core/src/domain/ports/)
interface IWorkflowRunRepository {
  create(params: CreateWorkflowRunParams): Promise<WorkflowRun>
  getById(id: string): Promise<WorkflowRun | null>
  getAll(): Promise<WorkflowRun[]>
  getByDefinitionId(defId: string): Promise<WorkflowRun[]>
  getByStatus(status: string): Promise<WorkflowRun[]>
  update(id: string, updates: Partial<WorkflowRun>): Promise<WorkflowRun>
  updateStatus(id: string, status: string): Promise<WorkflowRun>
  delete(id: string): Promise<void>
}

// Implementation (in packages/db/src/repositories/)
class WorkflowRunRepository implements IWorkflowRunRepository {
  // Uses Drizzle ORM with SQLite
}
```

### Migrations

v1→v2 migration (`packages/db/src/migrations/migrate-v1-to-v2.ts`):
- Maps v1 statuses → v2 (e.g., "running" → "active")
- Backfills timestamps
- Sets ownerType null for legacy sessions

---

## 12. Server & API Layer

**Location:** `apps/server/src/`

### Dependency Injection

The composition root (`composition-root.ts`) wires all dependencies:

```typescript
function createContainer(config: AppConfig): Container {
  // Infrastructure
  const db = createDatabase(config.dbPath)
  const copilot = new CopilotAdapter(config)
  const scriptRunner = new SandboxedScriptRunner()
  const httpClient = new FetchHttpClient()
  const gitManager = new GitManager()
  
  // Repositories (12 implementations)
  const sessionRepo = new SessionRepository(db)
  // ... all other repositories
  
  // Core services
  const eventBus = new EventBus(eventRepo)
  const workflowDefinitionService = new WorkflowDefinitionService(...)
  const dagScheduler = new DAGScheduler(...)
  const stageExecutionService = new StageExecutionService(...)
  const workflowRunService = new WorkflowRunService(...)
  const workflowOrchestrator = new WorkflowOrchestrator(...)
  // ... etc
  
  return { all services and repos }
}
```

### Route Structure (17 route files)

| Route File | Prefix | Purpose |
|---|---|---|
| `health.ts` | `/health` | Health check + config |
| `sessions.ts` | `/sessions` | v1 sessions (deprecated) |
| `workflows.ts` | `/sessions/:id/workflows` | v1 workflows |
| `chat.ts` | `/sessions/:id/prompt`, `/sessions/:id/chat` | v1 chat |
| `chats.ts` | `/chats` | v2 chat entity CRUD |
| `workflowDefinitions.ts` | `/workflow-definitions` | v2 definitions |
| `workflowRuns.ts` | `/workflow-runs` | v2 run lifecycle |
| `orchestrator.ts` | `/orchestrator` | Orchestration + system templates |
| `stream.ts` | `/sessions/:id/stream` | Per-session SSE |
| `globalEvents.ts` | `/events/global` | Global SSE |
| `multiplexedStream.ts` | `/events/stream` | Multiplexed SSE |
| `artifacts.ts` | `/artifacts`, `/sessions/:id/artifacts` | File artifacts |
| `templates.ts` | `/templates` | Template browsing |
| `webhooks.ts` | `/webhooks` | Webhook handlers |
| `copilot.ts` | `/copilot` | Copilot SDK status |
| `hooks.ts` | `/hooks` | Hook management |

### Middleware Stack

```
Request → requestId → CORS → bodyParser → routes → errorHandler → Response
```

1. **requestId** — UUID generation/propagation
2. **cors** — Configurable allowed origins
3. **bodyParser** — JSON + URL-encoded (10MB limit), captures rawBody for webhooks
4. **validate** — Zod schema validation (body, query, params)
5. **webhookAuth** — HMAC-SHA256 / Bearer token verification
6. **errorHandler** — Normalizes all errors to HTTP responses

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "category": "validation",
    "message": "Human-readable description",
    "recoverable": true,
    "stack": "..." // Development only
  }
}
```

---

## 13. Web Frontend Architecture

**Location:** `apps/web/src/`

### Tech Stack
- **React 18** with functional components
- **Vite** for bundling and HMR
- **TanStack Query** (React Query v5) for server state
- **Zustand** for client state (6 stores)
- **React Flow** for DAG visualization
- **React Router** for client-side routing

### Store Architecture (6 Zustand Stores)

| Store | Purpose | Key State |
|---|---|---|
| `workflowBuilderStore` | DAG editor (design-time) | nodes, edges, selectedNodeId, isDirty, undoHistory |
| `workflowRunStore` | Run monitoring (runtime) | run, stageSessionMap, selectedStageRunId, timelineEvents |
| `streamStore` | SSE token streaming | per-session streams with text/thinking/toolCall blocks |
| `chatStore` | Chat context | activeChatId, chatSessionMap, chatCache |
| `connectionStore` | SSE connection state | per-session connection status |
| `sseManager` | Global SSE connection | single EventSource, per-session routing |

### Component Hierarchy

```
App
├── Layout (sidebar + content)
│   ├── Sidebar
│   │   ├── Navigation tabs (Chats, Sessions, Workflows)
│   │   ├── Chat list / Workflow list
│   │   └── Quick actions (New Chat, New Workflow)
│   └── Content
│       ├── DashboardPage
│       ├── ChatsListPage → ChatPage
│       ├── WorkflowListPage → WorkflowDefinitionPage
│       ├── WorkflowBuilderPage
│       │   ├── DAGCanvas (React Flow)
│       │   ├── StagePropertiesPanel (right sidebar)
│       │   │   ├── PromptEditor
│       │   │   ├── VariableEditor
│       │   │   └── AdvancedSettings
│       │   └── WorkflowConfigPanel (modal)
│       ├── WorkflowRunPage
│       │   ├── RuntimeDAGCanvas (read-only)
│       │   ├── StageOutput (streaming messages)
│       │   ├── RunArtifactsPanel (file browser)
│       │   ├── RunTimeline (event timeline)
│       │   └── RunControls (pause/resume/cancel)
│       └── TemplateExplorerPage
```

### Data Flow

```
API Server ──SSE──→ sseManager ──→ streamStore ──→ StreamingMessage (component)
                               ──→ workflowRunStore ──→ RuntimeDAGCanvas
                               ──→ connectionStore

API Server ←──REST──→ TanStack Query (hooks) ──→ Page components
```

### Key Hooks

| Hook | Purpose |
|---|---|
| `useDefinition(id)` | Fetch workflow definition |
| `useWorkflowRun(id)` | Fetch run with stage runs |
| `useCreateDefinition()` | Mutation: create definition |
| `useCreateRun()` | Mutation: create + start run |
| `useChatMessages(id)` | Fetch chat history |

---

## 14. CLI Application

**Location:** `apps/cli/src/`

### Architecture

- **Commander.js** for command parsing
- **Ink (React)** for terminal UI components
- **DirectPlatformClient** for in-process service calls (no HTTP)

The CLI creates its own DI container and calls core services directly:

```typescript
// DirectPlatformClient calls services in-process
class DirectPlatformClient implements IPlatformClient {
  constructor(private container: Container) {}
  
  async createRun(params) {
    return this.container.workflowRunService.createRun(params)
  }
  // ... all other methods delegate to core services
}
```

### Adding a CLI Command

1. Create command file in `apps/cli/src/commands/`
2. Register in `apps/cli/src/index.tsx`:
```typescript
program
  .command('my-command <arg>')
  .description('What it does')
  .option('--flag', 'Flag description')
  .action(async (arg, options) => {
    // Command logic
  })
```

---

## 15. Copilot SDK Integration

**Location:** `packages/copilot-bridge/src/`

### CopilotAdapter

Wraps the `@github/copilot-sdk` with domain abstractions:

```typescript
class CopilotAdapter implements ICopilotPort {
  // Maps domain CopilotConfig → SDK SessionConfig
  createConversation(params): {
    model: params.model,
    tools: buildSdkTools(params.tools),
    systemMessage: params.systemMessage,
    skillDirectories: params.skillDirectories,
    customAgents: params.customAgents,
    provider: params.provider
  }
  
  // Event mapping: SDK SessionEvent → AgentEvent
  subscribeToEvents(convId, handler): {
    'assistant.message_delta' → 'copilot.token'
    'assistant.message' → 'copilot.message_complete'
    'assistant.reasoning_delta' → 'copilot.reasoning_delta'
    'tool.execution_start' → 'copilot.tool_start'
    'tool.execution_complete' → 'copilot.tool_complete'
    'session.idle' → 'copilot.idle'
    'session.error' → 'copilot.error'
  }
}
```

### Tool Factory

Converts domain tool definitions to SDK tools:

```typescript
function buildSdkTools(tools: ToolDefinition[]): SdkTool[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    handler: async (args) => {
      // Guard against null/undefined args
      const safeArgs = args ?? {}
      return tool.handler(safeArgs)
    }
  }))
}
```

---

## 16. Template System

### Template Types

1. **Simple Templates** (v1) — Single-stage prompt templates
2. **System Workflow Templates** (v2) — Full multi-stage DAG workflows with locked stages

### File Structure

```
templates/
├── code-generation.json          # v1: simple prompt
├── code-review.json              # v1: simple prompt
├── refactoring.json              # v1: simple prompt
├── test-generation.json          # v1: simple prompt
├── workflow-upload-template.json  # v1: upload shell
└── system/
    ├── code-generation-workflow.json   # v2: 4-stage DAG
    ├── code-review-workflow.json       # v2: 4-stage DAG
    ├── e2e-testing-workflow.json       # v2: 4-stage DAG
    ├── test-generation-workflow.json   # v2: 4-stage DAG
    └── refactoring-workflow.json       # v2: 4-stage DAG
```

### System Template Schema

```json
{
  "id": "system-code-generation",
  "name": "Code Generation Workflow",
  "description": "...",
  "category": "code-generation",
  "version": "1.0.0",
  "tags": ["code-generation", "development"],
  "sessionMode": "per-stage",
  "copilotConfig": {
    "model": "gpt-4.1",
    "systemMessage": "...",
    "tools": ["..."]
  },
  "configurableVariables": [
    {
      "name": "requirements",
      "type": "text",
      "label": "Requirements",
      "required": true,
      "description": "What to generate"
    }
  ],
  "stages": [
    {
      "name": "Requirements Analysis",
      "locked": true,
      "prompts": [{ "label": "...", "text": "...", "waitForCompletion": true }],
      "copilotConfigOverrides": {}
    }
  ],
  "edges": [
    { "fromStageIndex": 0, "toStageIndex": 1, "edgeType": "on_success" }
  ],
  "preprocessingSteps": [
    { "type": "clone_repo", "config": { "repoAlias": "source" } }
  ],
  "resultValidations": [
    { "stageIndex": 1, "rules": [{ "type": "min_length", "value": 100 }] }
  ]
}
```

### Adding a New System Template

1. Create JSON file in `templates/system/`
2. Follow the schema above
3. Templates are automatically loaded at server startup by `SystemWorkflowRegistry`
4. `SystemWorkflowRegistry` (in `packages/core/src/services/SystemWorkflowRegistry.ts`) scans the templates directory, validates against schema, and registers valid templates
5. Templates loaded from `TEMPLATES_DIR` environment variable path

---

## 17. Hooks System

**Location:** `packages/core/src/services/HookExecutor.ts`

### Hook Definition

```typescript
interface HookDefinition {
  id: string;
  name: string;
  phase: HookPhase;           // pre_run, post_run, pre_prompt, etc.
  type: 'script' | 'http' | 'function';
  enabled: boolean;
  priority: number;            // Lower = higher priority
  retries: number;             // Retry count
  failurePolicy: 'abort' | 'skip' | 'continue';
  config: ScriptConfig | HttpConfig | FunctionConfig;
}
```

### Hook Types

1. **script** — Execute shell command:
   ```json
   { "command": "npm test", "timeout": 30000 }
   ```
   Environment variables: `SESSION_ID`, `WORKFLOW_ID` + all `GEN_VAR_*`

2. **http** — Call HTTP endpoint:
   ```json
   { "url": "https://api.example.com/hook", "method": "POST", "headers": {}, "body": {} }
   ```
   Template interpolation in URL, headers, and body.

3. **function** — Import and call Node.js module:
   ```json
   { "module": "./hooks/validator.js" }
   ```
   Module must export a default function.

### 22 Hook Phases

| Category | Phases |
|---|---|
| Workflow | pre_run, post_run |
| Git | pre_clone, post_clone, pre_commit, post_commit |
| Prompt | pre_prompt, post_prompt |
| Error | on_error, on_cancel |
| Tool | pre_tool_use, post_tool_use |
| Message | on_message, on_reasoning |
| Session | on_session_start, on_session_idle, on_session_error |
| Client | on_client_start, on_client_stop, on_client_error, on_client_restart |
| Permission | on_permission |

---

## 18. Git Integration

**Location:** `packages/core/src/infrastructure/GitManager.ts`

```typescript
class GitManager {
  clone(repoUrl, branch?): string     // Shallow clone, returns path
  pull(repoDir, branch?): void        // Fetch latest
  checkoutNewBranch(repoDir, name): void
  commitAndPush(repoDir, message, branch?): void   // Stage all + commit + push
  createPullRequest(repoDir, title, body, base?): string  // Uses `gh pr create`
  getStatus(repoDir): string          // git status --porcelain
  getDiff(repoDir, staged?): string   // git diff
  cleanup(repoDir): void              // rm -rf
  extractRepoName(url): string        // Parse name from URL
}
```

Git integration is used in:
- **Orchestrated runs** — Clone repos before DAG execution
- **Preprocessing steps** — `clone_repo` step type
- **Hooks** — `pre_clone`, `post_clone`, `pre_commit`, `post_commit`

---

## 19. Configuration Resolution

**Location:** `packages/core/src/services/ConfigResolver.ts`

### 3-Level Config Merge

```
Level 1: WorkflowDefinition.copilotConfig     ← Base defaults
Level 2: StageDefinition.copilotConfigOverrides ← Stage overrides
Level 3: Runtime variable overrides             ← User-provided at run time
```

Resolution algorithm:
```typescript
function resolveStageConfig(definition, stage, runtimeOverrides): ResolvedStageConfig {
  // 1. Start with workflow-level config
  let config = deepClone(definition.copilotConfig)
  
  // 2. Deep merge stage overrides
  config = deepMerge(config, stage.copilotConfigOverrides)
  
  // 3. Resolve variables (workflow vars + stage vars + runtime overrides)
  const variables = {
    ...definition.variables.reduce(toMap, {}),
    ...stage.variables,
    ...runtimeOverrides
  }
  
  // 4. Validate required variables
  validateRequiredVariables(definition.variables, variables)
  
  // 5. Interpolate prompts: {{var}} → value
  const prompts = stage.prompts.map(p => ({
    ...p,
    text: interpolate(p.text, variables)
  }))
  
  return { copilotConfig: config, variables, prompts, hooks: stage.hooks, 
           timeoutMs: stage.timeoutMs, retryPolicy: stage.retryPolicy }
}
```

---

## 20. Error Handling

### Error Hierarchy

```
GeneratorAIError (base)
├── CopilotConnectionError     → connection_error
├── CopilotSessionError        → copilot_session_error
├── CopilotTimeoutError        → timeout_error
├── GitError                   → git_error
├── ScriptError                → script_error
├── ProcessNotFoundError       → process_not_found
├── InvalidTransitionError     → invalid_transition (→ 409)
├── ValidationError            → validation (→ 400)
├── SecurityError              → security_error
├── NotFoundError              → not_found (→ 404)
├── ResourceLimitError         → resource_limit (→ 429)
├── HookError                  → hook_error
├── HookTimeoutError           → hook_timeout
├── UserError                  → user_error
└── DAGValidationError         → dag_validation (→ 422)
    SessionAllocationError     → session_allocation (→ 503)
```

### HTTP Status Mapping

```typescript
const ERROR_STATUS_MAP = {
  validation: 400,
  not_found: 404,
  invalid_transition: 409,
  dag_validation: 422,
  resource_limit: 429,
  session_allocation: 503,
  connection_error: 502,
  // default: 502
}
```

---

## 21. Testing Strategy

### Test Runner: Vitest

Each package has its own `vitest.config.ts`:
```bash
pnpm test              # Run all tests
pnpm test:unit         # Unit tests only
pnpm test:e2e          # E2E tests (Playwright)
```

### Test Structure

| Package | Test Location | Focus |
|---|---|---|
| core | `packages/core/__tests__/` | Service logic, DAG validation, state machines, event bus |
| db | via core tests | Repository operations (in-memory mocks) |
| server | `apps/server/__tests__/` | API routes (supertest), middleware |
| web | `apps/web/vitest.config.ts` | Component tests |
| cli | `apps/cli/__tests__/` | Command output, component rendering |
| E2E | `agent-tests/` | Full workflow E2E via Playwright |

### Mock Strategy

```typescript
// In-memory mock repositories (packages/core/__tests__/MockRepositories.ts)
class MockWorkflowDefinitionRepository implements IWorkflowDefinitionRepository {
  private store: Map<string, WorkflowDefinition> = new Map()
  
  async create(params) { /* in-memory storage */ }
  async getById(id) { return this.store.get(id) }
  // ... all methods implemented with Map
}
```

### E2E Tests (Playwright)

```typescript
// agent-tests/workflow-e2e.spec.ts
test('complete workflow lifecycle', async ({ page }) => {
  // Create definition → Add stages → Validate → Run → Monitor → Check results
})
```

---

## 22. Development Workflow

### Local Development

```bash
# Start development (auto-reload)
pnpm dev

# Run specific package
pnpm --filter @generatorai/core dev

# Run tests in watch mode
pnpm test -- --watch

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

### Build

```bash
# Build all packages (respects dependency order via Turborepo)
pnpm build

# Build specific package
pnpm --filter @generatorai/server build
```

### Key Configuration Files

| File | Purpose |
|---|---|
| `pnpm-workspace.yaml` | Workspace package discovery |
| `turbo.json` | Build pipeline (dependencies, caching) |
| `tsconfig.base.json` | Shared TypeScript config |
| `vitest.config.ts` | Root Vitest config |
| `eslint.config.mjs` | Linting rules |
| `playwright.config.ts` | E2E test config |

---

## 23. Adding a New Feature — Step by Step

### Example: Adding a New Stage Type

1. **Domain Layer** (packages/shared):
   - Add type to `StageDefinition` in `packages/shared/src/types/`
   - Add new event kinds if needed

2. **Database Layer** (packages/db):
   - Update schema if new columns needed
   - Update repository if new queries needed

3. **Core Service** (packages/core):
   - Update `StageExecutionService` to handle new type
   - Update `WorkflowDefinitionService` for validation
   - Update `ConfigResolver` for any new config options
   - Add tests in `packages/core/__tests__/`

4. **Server API** (apps/server):
   - Update route validation schemas if new fields
   - Update route handlers if new behavior
   - Add API tests

5. **Web UI** (apps/web):
   - Update `StagePropertiesPanel` for new configuration options
   - Update `RuntimeDAGCanvas` for new visual indicators
   - Update stores if new state needed

6. **CLI** (apps/cli):
   - Update relevant commands
   - Update components

7. **Templates** (templates/system):
   - Update system templates if they use the new feature

### Example: Adding a New API Endpoint

1. Create route handler in `apps/server/src/routes/`:
```typescript
import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import { z } from 'zod'

const requestSchema = z.object({ /* ... */ })

export function createMyRoutes(container: Container): Router {
  const router = Router()
  
  router.post('/my-endpoint', validate(requestSchema), async (req, res, next) => {
    try {
      const result = await container.myService.doSomething(req.body)
      res.status(201).json(result)
    } catch (error) {
      next(error)
    }
  })
  
  return router
}
```

2. Register in `apps/server/src/app.ts`:
```typescript
app.use('/api', createMyRoutes(container))
```

3. Add client method in `apps/web/src/platform/HttpPlatformClient.ts`
4. Add TanStack Query hook in `apps/web/src/hooks/`

---

## 24. Key Files Quick Reference

### Core Business Logic

| File | Role |
|---|---|
| `packages/core/src/services/WorkflowOrchestrator.ts` | Top-level orchestration |
| `packages/core/src/services/WorkflowRunService.ts` | Run lifecycle management |
| `packages/core/src/services/StageExecutionService.ts` | Stage execution (prompts → code) |
| `packages/core/src/services/DAGScheduler.ts` | DAG scheduling & dependency tracking |
| `packages/core/src/services/SessionAllocator.ts` | Copilot session management |
| `packages/core/src/services/ConfigResolver.ts` | 3-level config merge |
| `packages/core/src/services/ChatManagementService.ts` | Chat CRUD |
| `packages/core/src/services/WorkflowDefinitionService.ts` | Definition CRUD + import/export |
| `packages/core/src/events/EventBus.ts` | Event emit/subscribe system |
| `packages/core/src/domain/dag/DAGValidator.ts` | Cycle detection, topological sort |
| `packages/core/src/domain/dag/ConditionEvaluator.ts` | Safe expression evaluation |

### State Machines

| File | Entity |
|---|---|
| `packages/core/src/domain/state-machines/WorkflowRunStateMachine.ts` | WorkflowRun |
| `packages/core/src/domain/state-machines/StageRunStateMachine.ts` | StageRun |
| `packages/core/src/domain/state-machines/SessionStateMachineV2.ts` | Session (v2) |

### Database

| File | Role |
|---|---|
| `packages/db/src/schema.ts` | All table definitions |
| `packages/db/src/repositories/*.ts` | Repository implementations |

### Server

| File | Role |
|---|---|
| `apps/server/src/index.ts` | Entry point, startup |
| `apps/server/src/app.ts` | Express app factory |
| `apps/server/src/composition-root.ts` | DI container |
| `apps/server/src/routes/*.ts` | API routes |
| `apps/server/src/middleware/*.ts` | Middleware |

### Web UI

| File | Role |
|---|---|
| `apps/web/src/App.tsx` | Root component + routing |
| `apps/web/src/pages/*.tsx` | Page components |
| `apps/web/src/stores/*.ts` | Zustand stores |
| `apps/web/src/platform/HttpPlatformClient.ts` | API client |
| `apps/web/src/components/workflow/DAGCanvas.tsx` | Workflow builder canvas |
| `apps/web/src/components/workflow/RuntimeDAGCanvas.tsx` | Run monitoring canvas |
| `apps/web/src/components/workflow/StagePropertiesPanel.tsx` | Stage editor |

### Templates

| File | Role |
|---|---|
| `templates/system/code-generation-workflow.json` | Code Generation |
| `templates/system/code-review-workflow.json` | Code Review |
| `templates/system/e2e-testing-workflow.json` | E2E Testing |
| `templates/system/test-generation-workflow.json` | Test Generation |
| `templates/system/refactoring-workflow.json` | Refactoring |

---

*This guide covers the complete technical architecture of GeneratorAI v2. For user-facing documentation, see [USER_GUIDE.md](USER_GUIDE.md). For the AI/LLM-optimized reference, see [AI_AGENT_REFERENCE.md](AI_AGENT_REFERENCE.md).*
