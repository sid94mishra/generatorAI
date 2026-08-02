# GeneratorAI — Workflow System Developer Guide

> **Audience**: Developers and AI agents who need to understand, modify, or extend the workflow execution system.
> **Last updated**: March 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Package Map & Dependencies](#2-package-map--dependencies)
3. [Workflow Lifecycle (End-to-End)](#3-workflow-lifecycle-end-to-end)
4. [Key Files Reference](#4-key-files-reference)
5. [Domain Model](#5-domain-model)
6. [State Machines](#6-state-machines)
7. [DAG Engine](#7-dag-engine)
8. [Session Allocation](#8-session-allocation)
9. [Stage Execution Pipeline](#9-stage-execution-pipeline)
10. [Copilot SDK Integration](#10-copilot-sdk-integration)
11. [Streaming System (SSE)](#11-streaming-system-sse)
12. [Artifact Management](#12-artifact-management)
13. [Template System](#13-template-system)
14. [Hook System](#14-hook-system)
15. [Variable Interpolation](#15-variable-interpolation)
16. [Error Handling](#16-error-handling)
17. [API Endpoints](#17-api-endpoints)
18. [Frontend Architecture](#18-frontend-architecture)
19. [CLI Architecture](#19-cli-architecture)
20. [Custom Content Upload (Prompts/Skills/Agents)](#20-custom-content-upload)
21. [Playwright CLI Integration](#21-playwright-cli-integration)
22. [Configuration Reference](#22-configuration-reference)
23. [Development Workflows](#23-development-workflows)

---

## 1. Architecture Overview

GeneratorAI is a **DAG-based AI workflow execution engine** built as a TypeScript monorepo. It orchestrates multi-stage AI workflows where each stage sends prompts to GitHub Copilot and streams responses back in real-time.

### Layer Architecture

```
┌─────────────────────────────────────────────────┐
│  PRESENTATION LAYER                              │
│  apps/web (React SPA)                            │
│  apps/cli (Ink terminal UI)                      │
│  apps/server/routes (Express REST API)           │
├─────────────────────────────────────────────────┤
│  APPLICATION LAYER                               │
│  packages/core/services (orchestration logic)    │
├─────────────────────────────────────────────────┤
│  DOMAIN LAYER                                    │
│  packages/core/domain (entities, ports, FSMs)    │
│  packages/copilot-bridge (SDK adapter)           │
├─────────────────────────────────────────────────┤
│  INFRASTRUCTURE LAYER                            │
│  packages/db (Drizzle + SQLite)                  │
│  packages/streaming (SSE transport)              │
│  packages/shared (types, errors, config)         │
└─────────────────────────────────────────────────┘
```

### Data Flow Summary

```
User → REST API → WorkflowRunService → DAGScheduler → StageExecutionService
                                                              ↓
                                                    SessionAllocator → CopilotAdapter → Copilot SDK
                                                              ↓
                                                    EventBus → DurableStreamManager → SSE → Browser
```

---

## 2. Package Map & Dependencies

| Package | Path | Purpose | Key Exports |
|---------|------|---------|-------------|
| `@generatorai/shared` | `packages/shared` | Types, DTOs, enums, errors, config schemas | `AgentEvent`, `CopilotConfig`, `GeneratorAIError`, `AppConfig` |
| `@generatorai/core` | `packages/core` | Domain + application services | All services, state machines, ports, EventBus |
| `@generatorai/db` | `packages/db` | Drizzle ORM + SQLite repositories | All `Drizzle*Repository` classes, `createDB`, `migrateDB` |
| `@generatorai/copilot-bridge` | `packages/copilot-bridge` | Copilot SDK adapter | `CopilotAdapter`, `mapSdkEventToAgentEvent`, `buildSdkTools` |
| `@generatorai/streaming` | `packages/streaming` | SSE transport layer | `DurableStreamManager`, `SSETransport` |
| `@generatorai/ui` | `packages/ui` | Shared React components | UI primitives |
| `@generatorai/server` | `apps/server` | Express REST API server | `createApp`, `createContainer` |
| `@generatorai/web` | `apps/web` | React SPA frontend | Pages, stores, hooks |
| `@generatorai/cli` | `apps/cli` | Terminal CLI | Commands, components |
| `@generatorai/desktop` | `apps/desktop` | Electron wrapper | Main/preload/renderer |

### Dependency Graph

```
shared ← core ← copilot-bridge
  ↑       ↑          ↑
  db    streaming   server → web
                      ↑
                     cli
```

---

## 3. Workflow Lifecycle (End-to-End)

### Step-by-Step Flow

```
┌──────────── DESIGN TIME ────────────┐  ┌────────────── RUNTIME ──────────────────┐
│                                      │  │                                          │
│  1. Create WorkflowDefinition        │  │  3. Create WorkflowRun                   │
│     POST /api/workflow-definitions   │  │     POST /api/workflow-runs              │
│     → stages + DAG edges             │  │     → snapshots definition               │
│     → session mode                   │  │     → creates StageRun records (pending) │
│     → copilot config                 │  │     → emits workflow_run.created         │
│                                      │  │                                          │
│  2. Add Stages + Edges               │  │  4. Start Run                            │
│     POST .../stages                  │  │     POST /api/orchestrator/runs          │
│     PATCH .../edges                  │  │     → validates DAG (Kahn's algorithm)   │
│     → prompts per stage              │  │     → transitions: created → running     │
│     → hooks, retry policies          │  │     → schedules root stages              │
│     → conditions                     │  │     → emits workflow_run.running         │
│                                      │  │                                          │
└──────────────────────────────────────┘  │  5. Execute Stages (per stage)           │
                                          │     StageExecutionService.executeStage() │
                                          │     a) Allocate session                  │
                                          │     b) pending → queued → running        │
                                          │     c) For each prompt:                  │
                                          │        - interpolate variables            │
                                          │        - save user message               │
                                          │        - send to Copilot SDK             │
                                          │        - stream tokens via EventBus      │
                                          │        - persist assistant response       │
                                          │     d) Mark stage completed              │
                                          │                                          │
                                          │  6. DAG Progression                      │
                                          │     WorkflowRunService.onStageCompleted()│
                                          │     → DAGScheduler checks dependencies   │
                                          │     → fires next ready stages            │
                                          │                                          │
                                          │  7. Completion                           │
                                          │     → all stages terminal                │
                                          │     → running → completed                │
                                          │     → release all sessions               │
                                          │     → emits workflow_run.completed       │
                                          └──────────────────────────────────────────┘
```

---

## 4. Key Files Reference

### Server Entry & Wiring

| File | Purpose |
|------|---------|
| `apps/server/src/index.ts` | Server startup, config loading, graceful shutdown |
| `apps/server/src/composition-root.ts` | DI container — wires all services, repos, infrastructure |
| `apps/server/src/app.ts` | Express app factory — middleware + route mounting |

### Core Services (packages/core/src/services/)

| File | Class | Purpose |
|------|-------|---------|
| `WorkflowRunService.ts` | `WorkflowRunService` | Run lifecycle: create, start, pause, resume, cancel, stage progression |
| `StageExecutionService.ts` | `StageExecutionService` | Execute individual stage: prompt loop, event subscription, retry |
| `DAGScheduler.ts` | `DAGScheduler` | Build DAG, get root stages, determine next ready stages |
| `SessionAllocator.ts` | `SessionAllocator` | Allocate Copilot sessions per mode (single/per-stage/auto) |
| `WorkflowDefinitionService.ts` | `WorkflowDefinitionService` | CRUD for workflow definitions |
| `WorkflowOrchestrator.ts` | `WorkflowOrchestrator` | High-level orchestration: system templates, preprocessing |
| `WorkflowPreprocessor.ts` | `WorkflowPreprocessor` | Pre-run setup: git clone, scripts, conditions |
| `ResultValidator.ts` | `ResultValidator` | Validate stage output against rules |
| `ChatService.ts` | `ChatService` | v1 prompt-response chat loop |
| `ChatManagementService.ts` | `ChatManagementService` | v2 chat CRUD + messaging |
| `SessionService.ts` | `SessionService` | Session lifecycle (v1, still used internally) |
| `HookExecutor.ts` | `HookExecutor` | Execute hooks: scripts, HTTP, functions |
| `HookInterceptor.ts` | `HookInterceptor` | Intercept Copilot events to trigger hooks |
| `ConfigResolver.ts` | `ConfigResolver` | Merge template + runtime config with deep merge |
| `TemplateRegistry.ts` | `TemplateRegistry` | Load + serve workflow templates |
| `ArtifactService.ts` | `ArtifactService` | Manage generated file artifacts |
| `ErrorHandler.ts` | `ErrorHandler` | Centralized error normalization + recovery |

### Domain Layer (packages/core/src/domain/)

| Directory | Contents |
|-----------|----------|
| `ports/` | Interfaces: `ICopilotPort`, `ISessionRepository`, `IWorkflowRunRepository`, etc. |
| `state-machines/` | `SessionStateMachine`, `WorkflowRunStateMachine`, `StageRunStateMachine` |
| `dag/` | `DAG`, `DAGValidator` (Kahn's cycle detection) |
| `events/` | `EventBus` — persist + broadcast events with per-session ordering |

### Copilot Bridge (packages/copilot-bridge/src/)

| File | Purpose |
|------|---------|
| `CopilotAdapter.ts` | Implements `ICopilotPort` — wraps `@github/copilot-sdk` CopilotClient |
| `event-mapper.ts` | Maps SDK `SessionEvent` → domain `AgentEvent` |
| `tool-factory.ts` | Builds SDK `ToolDefinition[]` from domain tool specs |

### Database (packages/db/src/)

| File | Purpose |
|------|---------|
| `schema.ts` | Drizzle schema: sessions, workflows, events, chat_messages, artifacts, chats, workflow_definitions, stage_definitions, stage_edges, workflow_runs, stage_runs |
| `repositories/*.ts` | One `Drizzle*Repository` per table |
| `data/` | SQLite database file location |

### Streaming (packages/streaming/src/)

| File | Purpose |
|------|---------|
| `SSETransport.ts` | Single HTTP response manager with heartbeat + Last-Event-ID replay |
| `DurableStreamManager.ts` | Multi-session SSE transport manager with filtering + idle cleanup |

### Routes (apps/server/src/routes/)

| File | Base Path | Purpose |
|------|-----------|---------|
| `workflowDefinitions.ts` | `/api/workflow-definitions` | Definition CRUD |
| `workflowRuns.ts` | `/api/workflow-runs` | Run execution + lifecycle |
| `orchestrator.ts` | `/api/orchestrator` | System workflows + orchestrated runs |
| `chats.ts` | `/api/chats` | v2 chat CRUD + messaging |
| `sessions.ts` | `/api/sessions` | v1 session management |
| `streaming.ts` | `/api/sessions/:id/stream`, `/api/events/stream` | SSE endpoints |
| `artifacts.ts` | `/api/artifacts` | Artifact download |
| `templates.ts` | `/api/templates` | Template lookup |

---

## 5. Domain Model

### Core Entities

```
WorkflowDefinition (design-time)
  ├─ id, name, version, sessionMode
  ├─ copilotConfig (base)
  ├─ variables[]
  └─ StageDefinition[] (1:N)
       ├─ id, name, order
       ├─ prompts[] (PromptDefinition)
       ├─ copilotConfigOverrides
       ├─ hooks[], retryPolicy, timeoutMs
       └─ StageEdge[] (N:M)
            ├─ fromStageId → toStageId
            ├─ edgeType: data | control | conditional
            └─ condition?

WorkflowRun (runtime)
  ├─ id, workflowDefinitionId
  ├─ status (8 states)
  ├─ sessionMode, variables
  └─ StageRun[] (1:N)
       ├─ id, stageDefinitionId
       ├─ status (8 states)
       ├─ sessionId (allocated at runtime)
       ├─ currentStep / totalSteps
       └─ retryCount

Session (runtime)
  ├─ id, conversationId (Copilot SDK session)
  ├─ status, ownerType (chat|stage_run)
  └─ workspacePath

Events (event log)
  ├─ sessionId, sequenceId (monotonic)
  ├─ kind (discriminated union, ~50 types)
  └─ data (JSON payload)
```

### Entity Relationships

```
WorkflowDefinition 1──N StageDefinition
StageDefinition    N──M StageEdge
WorkflowDefinition 1──N WorkflowRun
WorkflowRun        1──N StageRun
StageRun           N──1 StageDefinition
StageRun           N──1 Session
Session            1──N Event
Session            1──N ChatMessage
Session            1──N Artifact
```

---

## 6. State Machines

### WorkflowRun States

```
created ──sys:start──→ starting ──sys:dag_ready──→ running ──sys:all_done──→ completed
                                                     │
                                                     ├──usr:pause──→ paused ──usr:resume──→ running
                                                     │
                                                     └──sys:stage_failed──→ failed
                                                     
running/paused ──usr:cancel──→ cancelling ──sys:cleanup──→ cancelled
```

### StageRun States

```
pending ──sys:enqueue──→ queued ──sys:session_ready──→ running ──sys:done──→ completed
                                                        │
                                                        ├──sys:error──→ failed
                                                        ├──usr:pause──→ paused
                                                        └──usr:cancel──→ cancelled / skipped
```

**Terminal states**: completed, failed, skipped, cancelled

### Implementation Pattern

Each state machine is a pure function:
```typescript
class StageRunStateMachine {
  constructor(private currentStatus: StageRunStatus) {}
  
  transition(event: StageRunTransition): StageRunStatus {
    const nextState = TRANSITIONS[this.currentStatus]?.[event];
    if (!nextState) throw new InvalidTransitionError(this.currentStatus, event);
    this.currentStatus = nextState;
    return nextState;
  }
  
  canTransition(event: StageRunTransition): boolean { ... }
}
```

---

## 7. DAG Engine

### Location
- `packages/core/src/services/DAGScheduler.ts`
- `packages/core/src/domain/dag/DAGValidator.ts`

### How the DAG Works

**Building**: On `startRun()`, `DAGScheduler.buildDAGForDefinition()` constructs an in-memory DAG:
1. Loads all `StageDefinition`s for the workflow definition
2. Loads all `StageEdge`s
3. Validates with `DAGValidator` (Kahn's topological sort — detects cycles, self-edges, duplicates)
4. Caches result per definition ID

**Scheduling**:
- `getRootStages()`: Returns stage IDs with in-degree 0 (no dependencies)
- `onStageCompleted()`: Given a completed stage, returns the set of next stages where ALL predecessors are in terminal state AND edge conditions pass
- Uses per-run mutex to avoid race conditions in parallel DAG traversal

**Edge Conditions**: Edges can have conditions like:
```json
{
  "edgeType": "conditional",
  "condition": {
    "type": "status",
    "expectedStatus": "completed"  // or "failed", "on_completion"
  }
}
```

### DAG Data Structure

```typescript
interface DAG {
  nodes: Map<stageDefId, StageNode>;
  edges: StageEdge[];
  rootIds: stageDefId[];        // in-degree 0
  leafIds: stageDefId[];        // out-degree 0
  topologicalOrder: stageDefId[];
  executionLayers: stageDefId[][];  // for parallel scheduling
}
```

---

## 8. Session Allocation

### Location
- `packages/core/src/services/SessionAllocator.ts`

### Three Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `single` | All stages share ONE Copilot session | Sequential workflows, context continuity |
| `per-stage` | Each stage gets its OWN session | Parallel execution, isolation |
| `auto` | New session for parallel roots, shared for serial chains | Balanced approach |

### How It Works

1. **On first stage**: Creates a new `Session` record + Copilot SDK conversation
2. **On subsequent stages (single mode)**: Returns the existing shared session; calls `resumeConversation()` if needed
3. **On stage complete (per-stage mode)**: Destroys the session + Copilot conversation
4. **On run complete**: `releaseAll()` destroys all remaining sessions

### Session → Copilot SDK Conversation Mapping

```
SessionAllocator.createSession()
  → sessionRepo.create(session)         // DB record
  → copilot.createConversation({        // SDK conversation
       conversationId,
       model, systemMessage, tools,
       customAgents, skillDirectories,
       mcpServers, workingDirectory,
       ...
     })
  → sessionRepo.updateStatus('running')
```

---

## 9. Stage Execution Pipeline

### Location
- `packages/core/src/services/StageExecutionService.ts`

### Detailed Flow (per stage)

```
executeStage(stageRun, workflowRunId, sessionMode, copilotConfig, variables)
│
├─ 1. Load stage definition from DB
│
├─ 2. Merge copilot config:
│     workflow-level config → stage-level overrides (deep merge for mcpServers)
│
├─ 3. Allocate session via SessionAllocator
│     → creates/reuses Session + Copilot SDK conversation
│
├─ 4. Update stage: sessionId, status=running, totalSteps
│     → emit stage_run.running event
│
├─ 5. Subscribe to Copilot conversation events
│     → enriches each event with stageRunId
│     → broadcasts via EventBus
│     → persists assistant message on message_complete (idempotency guard)
│
├─ 6. Prompt Loop (sequential, resume from currentStep):
│     For each prompt in stageDef.prompts:
│       a) Check if stage still running (may have been paused mid-loop)
│       b) Emit stage_run.step_started
│       c) Interpolate {{variables}} in prompt text
│       d) Save user message to chat_messages
│       e) Reset assistantPersisted flag
│       f) Send to Copilot SDK:
│          - With timeout: Promise.race([sendPromptAndWait, createTimeout])
│          - With waitForCompletion: sendPromptAndWait()
│          - Fire-and-forget: sendPrompt()
│       g) Emit stage_run.step_completed
│
├─ 7. On success:
│     → Update stage: status=completed, currentStep=totalSteps
│     → Emit stage_run.completed
│     → Release session (per-stage mode)
│
└─ 8. On failure:
      → Check retryPolicy → retry or fail
      → Emit stage_run.failed with error
      → Release session
```

### Per-Stage Stream Isolation (Single-Session Mode)

When all stages share one Copilot session, events are routed per-stage using a composite key:
- Server enriches each Copilot event with `stageRunId` in the data payload
- Frontend SSE manager extracts `stageRunId` and routes to stream key `stageRun:${stageRunId}`
- Each `StageOutput` component reads from its own stream key

---

## 10. Copilot SDK Integration

### Location
- `packages/copilot-bridge/src/CopilotAdapter.ts`

### Key Architecture

```
ICopilotPort (domain interface) ← packages/core/src/domain/ports/ICopilotPort.ts
     ↑ implemented by
CopilotAdapter ← packages/copilot-bridge/src/CopilotAdapter.ts
     ↑ wraps
CopilotClient (from @github/copilot-sdk)
```

### Conversation Creation Parameters

When creating a Copilot session, these parameters are passed through:

```typescript
CreateConversationParams {
  conversationId: string;          // unique session ID
  model?: string;                  // e.g. "gpt-4.1"
  systemMessage?: { mode, content }; // system prompt (replace or append)
  tools?: ToolDefinition[];        // custom tools
  availableTools?: string[];       // whitelist SDK-builtin tools
  excludedTools?: string[];        // blacklist tools
  customAgents?: CustomAgentConfig[]; // .agent.md-style agents
  skillDirectories?: string[];     // paths to skill SKILL.md files
  disabledSkills?: string[];       // skills to disable
  mcpServers?: Record<string, McpServerConfig>; // MCP server configs
  workingDirectory?: string;       // CWD for file operations
  configDir?: string;              // Copilot config directory
  provider?: BYOKProviderConfig;   // Bring-your-own-key provider
  streaming?: boolean;             // enable streaming (default: true)
  onPermissionRequest?: handler;   // shell/file/network permission callback
}
```

### sendPromptAndWait Implementation

Uses `session.send()` + manual idle detection (NOT `session.sendAndWait()`) to avoid SDK's hard timeout:
1. Registers event listener on the session
2. `session.send({ prompt })` — fire-and-forget
3. Waits for `session.idle` event → resolves
4. On `session.error` → rejects
5. No wall-clock timeout — only per-stage timeouts apply externally

### Event Flow

```
SDK SessionEvent → mapSdkEventToAgentEvent() → domain AgentEvent
                                                     ↓
                                              EventBus.emit(sessionId, event)
                                                     ↓
                                              ┌── Persist to SQLite
                                              ├── Broadcast to session subscribers
                                              └── Broadcast to global subscribers
                                                     ↓
                                              DurableStreamManager.pushEvent()
                                                     ↓
                                              SSETransport.send() → HTTP response
```

---

## 11. Streaming System (SSE)

### Architecture

```
Browser  ──── EventSource ────→  GET /api/events/stream (multiplexed)
                                       ↓
                              DurableStreamManager
                                       ↓
                              SSETransport (per-session)
                                       ↑
                              EventBus.subscribeAll() forwarder
```

### Key Design Decisions

1. **Single multiplexed EventSource**: One connection for all sessions (avoids HTTP/1.1 6-connection limit)
2. **Last-Event-ID replay**: Client sends header → server replays missed events from buffer (500 max)
3. **Per-session sequence IDs**: Monotonically increasing, persisted to SQLite
4. **Heartbeat**: `:heartbeat` comment every 15s keeps connection alive
5. **Reference counting**: Track add/remove session subscriptions per connection

### Frontend SSE Manager

Location: `apps/web/src/stores/sseManager.ts`

Per-session state:
```typescript
{
  refCount: number;
  tokenBuf: string;           // buffered tokens before flush
  thinkingBuf: string;        // buffered thinking tokens
  currentStageRunId: string;  // per-stage routing key
  lastReplayedSequence: number;
  seenSequenceIds: Set<number>; // deduplication
}
```

Event routing for per-stage isolation:
```typescript
const sk = conn.currentStageRunId ? `stageRun:${conn.currentStageRunId}` : sessionId;
streamStore.appendTokens(sk, tokenText);
```

---

## 12. Artifact Management

### Current Implementation

Location: `packages/core/src/services/ArtifactService.ts`

**Storage path**: `{artifactsDir}/{sessionId}/{artifactId}-{filename}`

**DB schema** (artifacts table):
- id, sessionId, workflowRunId?, stageRunId?, name, path, mimeType, size, direction

**API endpoints**:
- `GET /api/sessions/:sessionId/artifacts` — list artifacts
- `GET /api/artifacts/:id/download` — download artifact file

### Per-Workflow-Run Isolation

Artifacts for a workflow run are stored in a **per-run temp directory**:

```
{artifactsDir}/
  runs/
    {workflowRunId}/           ← unique per run
      artifacts/               ← generated files
      workspace/               ← Copilot CLI working directory
```

The `workingDirectory` for the Copilot session is set to the run's workspace dir, so any files generated by the Copilot agent (code, test files, screenshots) land there.

---

## 13. Template System

### Location
- `packages/core/src/services/TemplateRegistry.ts`
- `templates/*.json` (user templates)
- `templates/system/*.json` (system workflow templates)

### Template JSON Format

```json
{
  "id": "code-generation-v1",
  "name": "Code Generation",
  "description": "...",
  "category": "code-generation",
  "version": "1.0.0",
  "requiresCodebase": true,
  "variables": [
    { "name": "feature", "type": "text", "label": "Feature", "required": true }
  ],
  "copilotConfig": {
    "model": "gpt-4.1",
    "systemMessage": { "mode": "append", "content": "..." },
    "availableTools": ["bash", "git"],
    "mcpServers": {}
  },
  "prompts": [
    { "label": "Step 1", "text": "{{feature}} ...", "waitForCompletion": true }
  ],
  "hooks": []
}
```

### System Workflow Templates

Multi-stage DAG templates with edges:

```json
{
  "id": "e2e-testing",
  "name": "E2E Testing",
  "stages": [
    { "id": "plan", "name": "Test Planning", "prompts": [...] },
    { "id": "execute", "name": "Test Execution", "prompts": [...] },
    { "id": "debug", "name": "Debug & Analysis", "prompts": [...] },
    { "id": "report", "name": "Test Report", "prompts": [...] }
  ],
  "edges": [
    { "from": "plan", "to": "execute", "condition": "success" },
    { "from": "execute", "to": "debug", "condition": "failure" },
    { "from": "execute", "to": "report", "condition": "success" },
    { "from": "debug", "to": "report", "condition": "on_completion" }
  ],
  "configurableVariables": [
    { "name": "targetUrl", "type": "text", "label": "URL to test" }
  ]
}
```

### Loading

On server startup, `composition-root.ts`:
1. Loads `templates/*.json` via `TemplateRegistry.loadFromDirectory()`
2. Loads `templates/system/*.json` and registers each in `SystemWorkflowRegistry`

---

## 14. Hook System

### Location
- `packages/core/src/services/HookExecutor.ts`
- `packages/core/src/services/HookInterceptor.ts`

### Hook Phases

| Phase | When Triggered |
|-------|---------------|
| `pre_run` | Before workflow run starts |
| `post_run` | After workflow run completes |
| `pre_prompt` | Before each prompt is sent |
| `post_prompt` | After each prompt response |
| `pre_tool_use` | Before a tool is invoked |
| `post_tool_use` | After a tool completes |
| `on_message` | On any message event |
| `on_reasoning` | On reasoning/thinking events |

### Hook Types

| Type | Execution |
|------|-----------|
| `script` | Runs shell script via `SandboxedScriptRunner` |
| `http` | Sends HTTP request via `FetchHttpClient` |
| `function` | Calls registered JS function |

### Failure Policies

- `abort`: Stop the workflow on hook failure
- `skip`: Log and continue  
- `continue`: Ignore the error entirely

---

## 15. Variable Interpolation

### Syntax

Simple mustache-style: `{{variableName}}`

### Where It Happens

- `StageExecutionService.executeStage()` — interpolates variables into prompt text
- Regex: `/\{\{(\w+)\}\}/g`
- Replacement: `variables[key]` → `String(value)`, or keeps `{{key}}` if not found

### Example

```
Template prompt: "Review the code at {{repoUrl}} on branch {{branch}}"
Variables: { repoUrl: "https://github.com/org/repo", branch: "main" }
Result: "Review the code at https://github.com/org/repo on branch main"
```

**Limitation**: No Jinja-style filters (`{{ var | lower }}`), only simple substitution.

---

## 16. Error Handling

### Error Hierarchy

```
GeneratorAIError (abstract base)
  ├─ CopilotConnectionError   (category: copilot)
  ├─ CopilotSessionError      (category: copilot)
  ├─ CopilotTimeoutError      (category: copilot)
  ├─ GitError                  (category: git)
  ├─ ScriptError               (category: git)
  ├─ InvalidTransitionError    (category: state)
  ├─ ValidationError           (category: validation)
  ├─ ResourceLimitError        (category: resource)
  ├─ HookTimeoutError          (category: hook)
  ├─ HookAbortError            (category: hook)
  ├─ SecurityError             (category: security)
  ├─ StorageError              (category: storage)
  ├─ DAGValidationError        (category: validation)
  └─ SessionAllocationError    (category: resource)
```

### HTTP Status Mapping

| Category | HTTP Status |
|----------|-------------|
| validation | 400 |
| state | 409 |
| copilot | 502 |
| git | 424 |
| resource | 503 |
| security | 403 |
| storage | 507 |
| unknown | 500 |

### Error Flow

```
Error thrown → ErrorHandler.handle()
  → normalize() to GeneratorAIError
  → log with context
  → emit session.error event
  → attempt recovery (if recoverable)
  → Express error middleware → HTTP response
```

---

## 17. API Endpoints

### Workflow Definition CRUD

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/workflow-definitions` | Create definition |
| `GET` | `/api/workflow-definitions` | List definitions |
| `GET` | `/api/workflow-definitions/:id` | Get definition |
| `PATCH` | `/api/workflow-definitions/:id` | Update definition |
| `DELETE` | `/api/workflow-definitions/:id` | Delete definition |
| `GET` | `/api/workflow-definitions/:id/stages` | List stages |
| `POST` | `/api/workflow-definitions/:id/stages` | Add stage |
| `GET` | `/api/workflow-definitions/:id/edges` | List edges |

### Workflow Run Lifecycle

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/workflow-runs` | Create run |
| `GET` | `/api/workflow-runs` | List runs |
| `GET` | `/api/workflow-runs/:id` | Get run + stages |
| `PATCH` | `/api/workflow-runs/:id/pause` | Pause run |
| `PATCH` | `/api/workflow-runs/:id/resume` | Resume run |
| `PATCH` | `/api/workflow-runs/:id/cancel` | Cancel run |

### Orchestrator (System Workflows)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/orchestrator/system-workflows` | List system templates |
| `GET` | `/api/orchestrator/system-workflows/:id` | Get system template |
| `POST` | `/api/orchestrator/from-template` | Create definition from template |
| `POST` | `/api/orchestrator/runs` | Start orchestrated run |

### Streaming

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/events/stream` | Global multiplexed SSE stream |
| `GET` | `/api/sessions/:id/stream` | Per-session SSE stream |
| `GET` | `/api/sessions/:id/stream/events` | Replay events (REST, for page refresh) |

### Chat

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/chats` | Create chat |
| `GET` | `/api/chats` | List chats |
| `GET` | `/api/chats/:id` | Get chat |
| `POST` | `/api/chats/:id/prompt` | Send message |
| `GET` | `/api/chats/:id/history` | Get messages |

---

## 18. Frontend Architecture

### Location
- `apps/web/src/`

### Technology Stack

- React 19
- Zustand (state management)
- TanStack Query (server state)
- React Router
- @xyflow/react (DAG canvas)
- Tailwind CSS 4

### Key Pages

| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/` | Overview, recent activity |
| Workflow Builder | `/workflows/builder` | Create/edit definitions with visual DAG |
| Workflow Run | `/runs/:id` | Watch run progress, DAG status, stage streaming |
| Chat | `/chats/:id` | Interactive chat with streaming |
| Template Explorer | `/templates` | Browse system templates |

### Key Stores

| Store | File | What It Manages |
|-------|------|-----------------|
| `streamStore` | `streamStore.ts` | Per-session/stage token buffers, thinking, status |
| `workflowRunStore` | `workflowRunStore.ts` | Run progress, stage statuses, DAG layers |
| `chatStore` | `chatStore.ts` | Active chat, message cache |
| `sseManager` | `sseManager.ts` | Global EventSource, per-session routing, deduplication |

### Rendering Flow (for workflow run page)

```
1. Page loads → fetches workflow run + stage runs via TanStack Query
2. sseManager subscribes to session events
3. SSE events arrive → sseManager routes by stageRunId
4. streamStore updates token buffers per stage key
5. StageOutput component re-renders with streaming tokens
6. workflowRunStore updates DAG node statuses
7. DAG canvas re-renders with color-coded stages
```

---

## 19. CLI Architecture

### Location
- `apps/cli/src/`

### Key Commands

```bash
# Workflow Management
generatorai workflow list                    # List definitions
generatorai workflow show <id>               # Show definition + DAG
generatorai workflow create                  # Interactive creation
generatorai workflow run <id>                # Start a run
generatorai workflow status <runId>          # Get run status
generatorai workflow watch <runId>           # Live stream run events

# Chat
generatorai chat start [name]               # Start interactive chat
generatorai chat list                        # List chats
generatorai chat resume <id>                # Resume chat

# Templates
generatorai template list                    # List templates
generatorai template show <id>               # Show template details
```

### Architecture

```
Commander.js (command parsing)
  → DirectPlatformClient (direct backend access, no HTTP)
  → Ink components (React-based terminal rendering)
```

---

## 20. Custom Content Upload

### Supported Upload Types

The Copilot SDK accepts these custom content types via `CreateConversationParams`:

| Type | Parameter | Purpose |
|------|-----------|---------|
| **Custom Agents** | `customAgents` | `.agent.md` style agents with name, description, prompt, tools |
| **Skills** | `skillDirectories` | Directories containing `SKILL.md` files |
| **MCP Servers** | `mcpServers` | External tool servers (stdio or SSE) |
| **System Prompts** | `systemMessage` | Custom system prompt (replace or append) |

### How Custom Content Flows

```
User uploads content → stored in temp dir per workflow run
  → path passed in copilotConfig (skillDirectories, customAgents)
  → StageExecutionService merges into session config
  → SessionAllocator passes to CopilotAdapter.createConversation()
  → CopilotAdapter maps to SDK SessionConfig
  → Copilot CLI loads content from disk
```

### Custom Agent Format

```json
{
  "name": "security-reviewer",
  "description": "Reviews code for security vulnerabilities",
  "instructions": "You are a security expert...",
  "tools": ["bash", "git"]
}
```

### Adding Skills

Point `skillDirectories` to folders containing `SKILL.md` files:
```json
{
  "copilotConfig": {
    "skillDirectories": ["/path/to/my-skills"]
  }
}
```

---

## 21. Playwright CLI Integration

### Overview

GeneratorAI integrates Playwright CLI for browser-based E2E testing. The agent generates test scripts, executes them via `npx playwright test`, and captures results + artifacts.

### Architecture

```
E2E Testing Workflow (system template)
  ├─ Stage 1: Test Planning (reconnaissance)
  ├─ Stage 2: Test Execution (run tests)
  ├─ Stage 3: Debug & Analysis (on failure)
  └─ Stage 4: Test Report Generation

Each stage:
  → Agent generates .spec.ts files
  → Executes via shell: npx playwright test
  → Results: JSON report + screenshots + traces
  → Stored in per-run artifact directory
```

### Playwright Config for Agent Use

```typescript
// playwright.config.ts in run workspace
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './agent-tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['json', { outputFile: 'test-results/report.json' }]],
  use: {
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
});
```

### Key Commands (available to agent via shell)

| Command | Purpose |
|---------|---------|
| `npx playwright test` | Run tests |
| `npx playwright test --reporter=json` | JSON output for parsing |
| `npx playwright test --trace on` | Capture trace for debugging |
| `npx playwright show-report` | Open HTML report |
| `npx playwright codegen <url>` | Record actions → generate code |

### Template

The system template `templates/system/e2e-testing-workflow.json` provides:
- Full command reference in system message (34 playwright-cli commands)
- Best practices for element discovery via accessibility snapshots
- Multi-browser session support
- Network mocking, storage management, video/trace capture

---

## 22. Configuration Reference

### AppConfig Schema

```typescript
{
  port: 3000,                           // HTTP port
  dbPath: "packages/db/data/generatorai.db",
  workspacesDir: "~/.generatorai/workspaces",
  artifactsDir: "~/.generatorai/artifacts",
  templatesDir: "./templates",
  maxConcurrentSessions: 10,
  logLevel: "info",
  
  copilot: {
    defaultModel: "gpt-4",
    defaultTimeoutMs: 30000,
    useStdio: true,
    autoRestart: true,
    cliPath: undefined               // auto-detect
  },
  
  streaming: {
    enabled: true,
    heartbeatIntervalMs: 15000,
    maxReplayEvents: 500
  },
  
  security: {
    corsOrigins: ["http://localhost:3000"]
  }
}
```

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | HTTP server port |
| `DB_PATH` | `packages/db/data/generatorai.db` | SQLite path |
| `WORKSPACES_DIR` | `~/.generatorai/workspaces` | Workspace root |
| `ARTIFACTS_DIR` | `~/.generatorai/artifacts` | Artifacts root |
| `TEMPLATES_DIR` | `./templates` | Templates directory |
| `LOG_LEVEL` | `info` | Logging verbosity |

---

## 23. Development Workflows

### Starting the Server

```bash
pnpm install                              # Install dependencies
pnpm --filter @generatorai/server dev     # Start server (tsx, port 3100)
```

### Starting the Web App

```bash
pnpm --filter @generatorai/web dev        # Start Vite dev server (port 5173)
```

### Building Everything

```bash
pnpm run build                            # Build all packages via Turbo
```

### Running Tests

```bash
pnpm run test                             # Run all tests
pnpm --filter @generatorai/core test      # Test core package only
```

### Adding a New Service

1. Create `packages/core/src/services/MyService.ts`
2. Define port interface in `packages/core/src/domain/ports/`
3. Wire in `apps/server/src/composition-root.ts`
4. Add route in `apps/server/src/routes/`
5. Register route in `apps/server/src/routes/index.ts`
6. Export from `packages/core/src/index.ts`

### Adding a New Event Kind

1. Add to `AgentEvent` discriminated union in `packages/shared/src/types/AgentEvent.ts`
2. Add constant in event kinds
3. Handle in `sseManager.ts` (frontend)
4. Add to relevant switch/case in stores

---

## Appendix: Quick Reference — "Where is X?"

| What | Where |
|------|-------|
| Workflow run lifecycle | `packages/core/src/services/WorkflowRunService.ts` |
| Stage execution loop | `packages/core/src/services/StageExecutionService.ts` |
| DAG scheduling | `packages/core/src/services/DAGScheduler.ts` |
| Session allocation | `packages/core/src/services/SessionAllocator.ts` |
| Copilot SDK wrapper | `packages/copilot-bridge/src/CopilotAdapter.ts` |
| Event bus | `packages/core/src/events/EventBus.ts` |
| SSE streaming | `packages/streaming/src/DurableStreamManager.ts` |
| Frontend SSE routing | `apps/web/src/stores/sseManager.ts` |
| DB schema | `packages/db/src/schema.ts` |
| API routes | `apps/server/src/routes/` |
| DI container | `apps/server/src/composition-root.ts` |
| System templates | `templates/system/*.json` |
| Error types | `packages/shared/src/errors/` |
| State machines | `packages/core/src/domain/state-machines/` |
| Config schema | `packages/shared/src/config/AppConfig.ts` |
