# Workflow Execution Deep Dive

> **Reference workflow:** Code Generation Workflow V1 — Run 1776952878125
> **Run URL:** `http://localhost:5173/workflows/ad89d182-3225-48a8-b944-39b6c7839fb3/runs/e1419d93-7bcc-412c-b4b3-38c7ac6d029e`

This document traces the complete end-to-end execution of a workflow run — from the moment a user clicks "Run" in the web UI to the final "Completed" status. It uses the Code Generation Workflow V1 as a concrete running example.

---

## Table of Contents

1. [Workflow Structure](#1-workflow-structure)
2. [Phase 1 — User Clicks "Run"](#2-phase-1--user-clicks-run)
3. [Phase 2 — DAG Scheduling & Root Stage Dispatch](#3-phase-2--dag-scheduling--root-stage-dispatch)
4. [Phase 3 — Stage Execution](#4-phase-3--stage-execution)
5. [Phase 4 — DAG Advancement (Sequential)](#5-phase-4--dag-advancement-sequential)
6. [Phase 5 — DAG Advancement (Parallel)](#6-phase-5--dag-advancement-parallel)
7. [Phase 6 — Terminal State Detection & Completion](#7-phase-6--terminal-state-detection--completion)
8. [Phase 7 — Real-Time UI Updates via SSE](#8-phase-7--real-time-ui-updates-via-sse)
9. [Session Modes — All Three Scenarios](#9-session-modes--all-three-scenarios)
10. [Edge Condition Evaluation](#10-edge-condition-evaluation)
11. [Variable System](#11-variable-system)
12. [Key Files Reference](#12-key-files-reference)
13. [Visual Timeline](#13-visual-timeline)

---

## 1. Workflow Structure

The Code Generation Workflow V1 is a 4-stage DAG:

```
[Requirements Analysis] → [Code Generation] → ┬→ [Test Generation]   (parallel)
                                               └→ [Documentation]     (parallel)
```

| Stage | Duration | Tool Calls | Execution |
|-------|----------|------------|-----------|
| Requirements Analysis | 39s | 0 | Sequential (root) |
| Code Generation | 3m 30s | 3 | Sequential (depends on Requirements Analysis) |
| Test Generation | 1m 30s | 20 | Parallel (depends on Code Generation) |
| Documentation | 2m 46s | 10 | Parallel (depends on Code Generation) |

**Total run time:** 7m 1s (4/4 stages completed)

- **Stages 1–2** run sequentially — each depends on the previous one.
- **Stages 3–4** run in **parallel** — both depend only on Code Generation.

---

## 2. Phase 1 — User Clicks "Run"

### 2.1 — UI Trigger

**File:** `apps/web/src/pages/WorkflowDefinitionPage.tsx`

When the user clicks the **Run** button on a workflow definition page:

1. A `VariableInputModal` opens to collect any required variables (e.g., `__workingDirectory`, custom inputs).
2. The `executeRun()` callback fires, making **two sequential API calls**:

```typescript
// Step 1: Create the run record
const run = await createRun.mutateAsync({
  workflowDefinitionId: id,
  variables,
});

// Step 2: Upload any attached files (optional)
await uploadAllFiles(run.id);

// Step 3: Start the run (fire-and-forget on server)
await startRun.mutateAsync(run.id);

// Step 4: Navigate to the run page
navigate(`/workflows/${id}/runs/${run.id}`);
```

The web client uses `HttpPlatformClient` (`apps/web/src/platform/HttpPlatformClient.ts`) to make the underlying fetch calls:

| API Call | HTTP Method | Response |
|----------|-------------|----------|
| `/api/workflow-runs` | POST | 201 Created (returns WorkflowRun) |
| `/api/workflow-runs/:id/start` | POST | 202 Accepted (fire-and-forget) |

### 2.2 — Run Creation (Server Side)

**Route:** `apps/server/src/routes/workflowRuns.ts`
**Service:** `packages/core/src/services/WorkflowRunService.ts` → `createRun()`

The route handler validates the request body via Zod schema, then calls `WorkflowRunService.createRun()`:

1. **Load the WorkflowDefinition** (`ad89d182-...`) and its 4 StageDefinitions from the database.
2. **Generate a `masterSessionId`** (`master_<uuid>`) — used by `SessionAllocator` when running in shared-session mode.
3. **Atomically insert** (within a DB transaction):
   - 1 `WorkflowRun` row with `status: 'created'`
   - 4 `StageRun` rows, all with `status: 'pending'`, one per stage definition
4. **Emit** `workflow_run.created` event on the `EventBus`.

At this point, the run exists in the database but **nothing is executing yet**.

### 2.3 — Run Start (Fire-and-Forget)

**Route:** `POST /api/workflow-runs/:id/start`

The route handler:

1. Sets up per-run directories:
   - `__workingDirectory` → `.generatorai/artifacts/runs/<runId>/workspace/`
   - `__artifactsDirectory` → `.generatorai/artifacts/runs/<runId>/artifacts/`
2. Updates run variables with these paths.
3. Calls `workflowRunService.startRun(runId)` — this is **fire-and-forget** (the HTTP response returns `202 Accepted` immediately without waiting for the run to complete).

```typescript
// Fire and forget — run is started asynchronously
workflowRunService.startRun(runId).catch((err) => {
  logger.error(`Run start failed for ${runId}`, { error: err.message });
});

res.status(202).json({ message: 'Workflow run start initiated', runId });
```

---

## 3. Phase 2 — DAG Scheduling & Root Stage Dispatch

**Service:** `packages/core/src/services/WorkflowRunService.ts` → `startRun()`

### 3.1 — State Machine Transition

The `WorkflowRunStateMachine` governs valid state transitions. The run progresses:

```
created → starting → running → completed
```

Each transition emits an event onto the EventBus:

| Transition | Event |
|-----------|-------|
| `created → starting` | `workflow_run.starting` |
| `starting → running` | `workflow_run.running` |
| `running → completed` | `workflow_run.completed` |

### 3.2 — Build the DAG

`DAGScheduler.buildDAGForDefinition()` (`packages/core/src/services/DAGScheduler.ts`) loads all 4 `StageDefinition` rows and all 3 `StageEdge` rows from the database. It constructs an in-memory DAG:

```typescript
interface DAG {
  nodes: Map<string, StageNode>;   // stage defId → node metadata
  edges: StageEdge[];              // all edge definitions
  rootIds: string[];               // stages with zero incoming edges
  leafIds: string[];               // stages with zero outgoing edges
  topologicalOrder: string[];      // linear schedule respecting dependencies
  executionLayers: string[][];     // groups of parallel-executable stages
}
```

For our workflow:

| Property | Value |
|----------|-------|
| `rootIds` | `[Requirements Analysis]` |
| `leafIds` | `[Test Generation, Documentation]` |
| `executionLayers[0]` | `[Requirements Analysis]` |
| `executionLayers[1]` | `[Code Generation]` |
| `executionLayers[2]` | `[Test Generation, Documentation]` |
| `topologicalOrder` | `[ReqAnalysis, CodeGen, TestGen, Docs]` |

The DAG is **hash-cached** by definition ID — it's only rebuilt if the definition's stages or edges change.

### 3.3 — Identify and Dispatch Root Stages

`getRootStages()` returns `[Requirements Analysis defId]`. For each root stage:

1. Find the corresponding `StageRun` (created in Phase 1).
2. Call `stageExecutionService.executeStage(stageRun, ...)` — **fire-and-forget** (no `await`).

### 3.4 — Start Polling

A **3-second polling interval** begins. Every 3 seconds:

- Load all `StageRun` rows for this run.
- Check if any stage has transitioned to `completed` or `failed`.
- If so: call `onStageCompleted()` or `onStageFailed()` to advance the DAG.

This polling approach **decouples** the orchestration loop from the async stage execution.

---

## 4. Phase 3 — Stage Execution

**Service:** `packages/core/src/services/StageExecutionService.ts` → `executeStage()`

This section details what happens inside each stage, using Requirements Analysis as the example (being the root stage with no predecessors).

### 4.1 — Session Allocation

The `SessionAllocator` (`packages/core/src/services/SessionAllocator.ts`) decides how to create a Copilot SDK session based on the workflow's `sessionMode` property.

#### Session Modes

| Mode | Behavior |
|------|----------|
| **`single`** | One shared session (conversation) for ALL stages. Ref-counted — only destroyed when all stages release. |
| **`per-stage`** | Each stage gets its own fresh session. Destroyed when stage completes. |
| **`auto`** | Maps to `per-stage` (creates new session per stage). |

The allocation call:

```typescript
const session = await sessionAllocator.allocateSession(
  workflowRunId,
  stageRunId,
  sessionMode,    // 'single' | 'per-stage' | 'auto'
  copilotConfig,  // model, system message, tools, etc.
);
```

Under the hood:

1. `SessionAllocator` calls `copilot.createConversation()` on the `ICopilotPort` interface.
2. The `CopilotAdapter` (`packages/copilot-bridge/src/CopilotAdapter.ts`) translates this into an SDK call:
   ```typescript
   this.client.createSession(sessionConfig)
   ```
3. The `sessionConfig` includes:
   - System message (model: `'append'` or `'replace'`)
   - Available tools
   - Skill directories and MCP servers
   - Permission handler (**auto-approves all** requests so workflows don't hang)
   - Hooks bridge (pre/post tool-use handlers)
4. Returns a `conversationId` that identifies this SDK conversation.
5. Persists allocation state to DB for crash recovery.

### 4.2 — Predecessor Summary Injection (Context Handoff)

If `predecessorSummaries` are provided (not the case for root stages, but critical for all subsequent stages):

```typescript
if (predecessorSummaries && predecessorSummaries.length > 0) {
  const contextLines = predecessorSummaries.map(
    (ps) => `## Completed Stage: "${ps.stageName}"\n${ps.summary}`,
  );
  const contextMessage =
    `The following stages have already been completed in this workflow. ` +
    `Use their summaries as context for your work in this stage:\n\n` +
    contextLines.join('\n\n---\n\n');

  // Send as a user message so the agent receives the context
  await copilot.sendPromptAndWait(session.conversationId, contextMessage);
}
```

This is marked as `isInternalTurn = true` so the web UI knows not to display it as a regular user message.

### 4.3 — Variable Interpolation

Before sending each prompt to the LLM, variables are resolved via `interpolateVariables()` (`packages/shared/src/utils/index.ts`):

```typescript
const promptText = interpolateVariables(prompt.text, variables);
// "Analyze requirements for {{projectName}}" → "Analyze requirements for MyProject"
```

The interpolation system:
- Matches `{{variableName}}` patterns
- Supports dotted paths: `{{user.name}}` drills into nested objects
- Flat-key takes priority: `{ "a.b": 1 }` wins over `{ a: { b: 2 } }`
- Unresolved placeholders remain as-is: `{{unknown}}` stays literal
- Single-pass — interpolated values are NOT re-scanned (prevents recursion)

### 4.4 — File-Naming Instruction Append

A standard instruction is appended to every prompt telling the LLM to use proper filename format in code fences:

```
**IMPORTANT: File Output Format**
When generating code files, you MUST include the full file path on the code fence line.
For example:
```typescript src/controllers/userController.ts
// file contents here
```
```

This ensures the artifact extraction system can properly name and save generated files.

### 4.5 — Message Persistence & Sending to Copilot

1. **Save as user message**: The prompt text is persisted to the `chat_messages` table with metadata (`stageRunId`, etc.).
2. **Send to Copilot SDK**:
   ```typescript
   const response = await copilot.sendPromptAndWait(conversationId, promptText);
   ```

### 4.6 — How `sendPromptAndWait()` Works Inside CopilotAdapter

**File:** `packages/copilot-bridge/src/CopilotAdapter.ts`

The adapter does **not** use the SDK's built-in `sendAndWait()` (which has a hard timeout). Instead:

1. Call `session.send({ prompt })` to dispatch the message.
2. Manually listen for SDK events via `session.on((event: SessionEvent) => { ... })`.
3. **Accumulate events** until the `session.idle` event fires — this means all tool calls are complete.
4. Extract `lastAssistantMessage` and return `{ content, toolCalls }`.
5. **AbortSignal support**: If `signal.abort()` fires, reject the promise and call `abortConversation()` to stop the SDK session.
6. **Timeout guard**: `defaultTimeoutMs` as final backstop.

### 4.7 — Event Flow During Execution

As the Copilot SDK processes the prompt, it emits `SessionEvent` objects. The `event-mapper.ts` (`packages/copilot-bridge/src/event-mapper.ts`) translates each SDK event into a domain `AgentEvent`:

| SDK Event | Domain Event | What It Carries |
|-----------|-------------|-----------------|
| `assistant.message_delta` | `copilot.token` | Incremental text tokens |
| `assistant.reasoning_delta` | `copilot.reasoning_delta` | Chain-of-thought tokens |
| `assistant.message` | `copilot.message_complete` | Full message content |
| `assistant.reasoning` | `copilot.reasoning_complete` | Full reasoning content |
| `tool.execution_start` | `copilot.tool_start` | Tool name, args, callId |
| `tool.execution_complete` | `copilot.tool_complete` | Tool result, success flag |
| `session.idle` | `copilot.idle` | All work done |
| `session.error` | `copilot.error` | Error message, type |
| `user.message` | `copilot.user_message` | User content echoed |
| `assistant.usage` | `copilot.usage` | Token counts, model, cost, duration |
| `assistant.turn_start` | `copilot.turn_start` | Turn ID |
| `assistant.turn_end` | `copilot.turn_end` | Turn ID |

Each domain event is **enriched** with `stageRunId` and `workflowRunId` before being emitted onto the `EventBus`.

### 4.8 — Event Accumulation Pattern

Events are accumulated per-turn (not per-event):

- `turnThinkingText` — accumulated reasoning tokens
- `turnToolCalls` — all tool calls in this turn
- `turnContent` — accumulated response tokens

On `copilot.idle`:
- Persist the entire accumulated turn as a single assistant message to the DB
- Include full metadata: thinking text, tool calls, system messages

This ensures the database has clean, complete assistant messages rather than fragmented token streams.

### 4.9 — Stage Summary Generation

After all prompts complete successfully, the service generates a summary:

```typescript
const summaryPrompt =
  `Provide a concise summary (max 500 words) of all the work you just completed ` +
  `in this stage named "${stageRun.name}". Include: key actions taken, files created ` +
  `or modified, important decisions made, and any outputs produced. This summary will ` +
  `be provided to subsequent workflow stages as context. Be specific and factual.`;

const summaryResponse = await copilot.sendPromptAndWait(
  session.conversationId,
  summaryPrompt,
);
stageSummary = summaryResponse.content;
```

This is:
- Sent as `isInternalTurn = true` (hidden from UI)
- Non-fatal — if summary generation fails, the stage still completes
- Stored in `StageRun.summary` field in the database

### 4.10 — Artifact Extraction

The service parses all assistant messages for fenced code blocks:

**Code files** → written to the run's workspace directory with full path structure:
```
.generatorai/artifacts/runs/<runId>/workspace/
  src/
    controllers/
      userController.ts
    models/
      user.ts
```

**Markdown responses** → written to the artifacts directory:
```
.generatorai/artifacts/runs/<runId>/artifacts/
  requirements_analysis_response_1.md
  code_generation_response_1.md
```

**Filename inference** (priority order):
1. Explicit fence header: `` ```typescript src/index.ts ``
2. First-line comment: `// src/index.ts` or `# src/index.py`
3. Preceding markdown pattern: `**src/index.ts**` or `` `src/index.ts` ``

**Security protections:**
- `resolveWithinBase()` prevents path traversal attacks (`../../etc/passwd`)
- Symlinks are detected and rejected via `isSymlink()` check

### 4.11 — Stage Completion

1. Update `StageRun` to `status: 'completed'`, store `summary`, set `completedAt`.
2. Release the Copilot session (in `per-stage` mode, destroys it immediately).
3. Emit `stage_run.completed` event.

---

## 5. Phase 4 — DAG Advancement (Sequential)

### 5.1 — Polling Detects Completion

The 3-second polling loop detects that Requirements Analysis is now `completed`. It calls `onStageCompleted(runId, stageRunId)`:

1. **Deduplicate**: A `processedStageRuns` Set prevents double-processing the same completion.
2. **Ask DAGScheduler**: `dagScheduler.onStageCompleted(runId, defId, completedStageDefId)`:
   - Find outgoing edges from Requirements Analysis.
   - There's one edge: `Requirements Analysis → Code Generation` (type: `on_success`).
   - Check if ALL of Code Generation's predecessors are terminal → **yes** (only Requirements Analysis, which is `completed`).
   - Evaluate edge condition: `on_success` + parent status `completed` → **passes**.
   - Returns `[Code Generation defId]`.

### 5.2 — Predecessor Summary Gathering

Before dispatching Code Generation, `gatherPredecessorSummaries()` collects summaries:

```typescript
private gatherPredecessorSummaries(stageDefId, dag, allStageRuns) {
  const node = dag.nodes.get(stageDefId);  // Code Generation node
  const summaries = [];
  for (const predId of node.dependencyIds) {  // [Requirements Analysis]
    const predRun = allStageRuns.find(sr => sr.stageDefinitionId === predId);
    if (predRun?.summary) {
      summaries.push({ stageName: predRun.name, summary: predRun.summary });
    }
  }
  return summaries;
  // → [{ stageName: "Requirements Analysis", summary: "..." }]
}
```

### 5.3 — Context Injection into Code Generation

When `StageExecutionService.executeStage()` starts Code Generation with `predecessorSummaries`:

1. **Build context message:**
   ```
   The following stages have already been completed in this workflow.
   Use their summaries as context for your work in this stage:

   ## Completed Stage: "Requirements Analysis"
   [Requirements Analysis summary text — up to 500 words of specific,
    factual information about what was analyzed, what decisions were made,
    what artifacts were produced...]
   ```

2. **Send as a user message** to the new Copilot session (marked `isContextMessage: true`).
3. Call `copilot.sendPromptAndWait()` and wait for the LLM to acknowledge the context (this is `isInternalTurn = true`).
4. **Then** send the actual Code Generation prompts.

This ensures Code Generation's LLM session has full awareness of what Requirements Analysis produced — even though it's a **completely separate Copilot conversation** (in `per-stage` mode).

### 5.4 — Code Generation Executes

Same flow as Phase 3:
- Variable interpolation → send prompts → stream tokens → tool calls (3 tool calls as shown in UI) → generate summary → extract artifacts → mark completed.

---

## 6. Phase 5 — DAG Advancement (Parallel)

### 6.1 — Polling Detects Code Generation Complete

`onStageCompleted()` asks the DAGScheduler what's next:

- Code Generation has **two outgoing edges**:
  - `Code Generation → Test Generation` (`on_success`)
  - `Code Generation → Documentation` (`on_success`)
- Both targets have all predecessors terminal (only Code Generation, which is `completed`).
- Both edge conditions pass.
- **Returns `[Test Generation defId, Documentation defId]`** — **both stages are ready simultaneously**.

### 6.2 — Parallel Dispatch

For **each** ready stage:

1. `gatherPredecessorSummaries()` collects Code Generation's summary.
2. `stageExecutionService.executeStage()` is called **without `await`** (fire-and-forget).

Both stages start executing **concurrently**:

- Test Generation gets its own Copilot session (in `per-stage` mode).
- Documentation gets its own Copilot session.
- Both receive Code Generation's summary as context.
- They run completely independently — no shared state, no coordination.
- As shown in the UI: both started at **7:35:31 PM** (same timestamp) with the "Parallel (1)" badge.

```typescript
for (const defId of nextStageDefIds) {
  const sr = allStageRuns.find((s) => s.stageDefinitionId === defId);
  if (sr) {
    const predecessorSummaries = this.gatherPredecessorSummaries(defId, dag, allStageRuns);

    // Fire-and-forget — no await!
    this.stageExecutionService
      .executeStage(sr, runId, run.sessionMode, copilotConfig, run.variables, predecessorSummaries)
      .catch(() => {/* handled by polling */});
  }
}
```

---

## 7. Phase 6 — Terminal State Detection & Completion

### 7.1 — Stage Completions

As each parallel stage finishes (Test Generation at 1m 30s, Documentation at 2m 46s), polling detects their completion and calls `onStageCompleted()` for each.

For each:
- DAGScheduler finds **no outgoing edges** (they're leaf nodes).
- No more stages to dispatch.
- Check `isDAGComplete()`: are ALL 4 stages terminal?
  - After Test Gen completes: **No** (Documentation still running)
  - After Documentation completes: **Yes** — all 4 stages are `completed`

### 7.2 — Run Completion

`completeRun()` is called:

1. **Stop polling** — clear the 3-second interval timer.
2. **Close RunLogger** — flush and close the `stream-log.jsonl` file.
3. **Update run** — set `status: 'completed'`, `completedAt: now`.
4. **Release all sessions** — `sessionAllocator.releaseAll(runId)` destroys all remaining Copilot SDK sessions.
5. **Emit** `workflow_run.completed` event.

### 7.3 — Cascading Skips

If Requirements Analysis had **failed** instead of completing:
- Code Generation's edge condition (`on_success`) would not be met.
- Code Generation would be **skipped**.
- This cascades: Test Generation and Documentation (which depend on Code Generation) would also be skipped.
- The run would be marked `failed`.

### 7.4 — Failure Edges

If a stage has `on_failure` outgoing edges:
- `onStageFailed()` evaluates these edges.
- Successor stages with `on_failure` conditions are dispatched.
- This enables error-handling stages (e.g., a "Notify on Failure" stage).

---

## 8. Phase 7 — Real-Time UI Updates via SSE

### 8.1 — The Event Pipeline (End-to-End)

```
Copilot SDK emits SessionEvent
  ↓
CopilotAdapter.onConversationEvent() → event-mapper.ts
  ↓
Domain AgentEvent (enriched with stageRunId, workflowRunId)
  ↓
EventBus.emit(sessionId, event)
  ↓ [per-session promise queue serializes DB writes]
  ├→ INSERT INTO events table (monotonic sequenceId)
  └→ Broadcast to all EventBus subscribers
       ↓
       bridgeEvent callback (composition-root.ts)
       ↓
       StreamBroker.publish('run', runId, kind, data)
       ↓ [atomic seq allocation in stream_cursors table]
       ↓
       SSE route handler writes: "id: <seq>\ndata: {...}\n\n"
       ↓
       Browser EventSource.onmessage
       ↓
       sseManager dedup (seenSequenceIds Set, bounded 500)
       ↓
       processEvent() → Cross-buffer flush (token ↔ thinking)
       ↓
       React Zustand store update → UI re-render
```

### 8.2 — EventBus

**File:** `packages/core/src/events/EventBus.ts`

The core event emission engine:
- **Per-session emit queues** — serializes DB writes to guarantee monotonic `sequenceId`s.
- **Commit-then-broadcast ordering** — DB insert first, broadcast only on success.
- **Error containment** — handler exceptions don't break other subscribers.

Key methods:
```typescript
emit(sessionId, event)                   // Session-scoped event → DB + broadcast
emitGlobal(event)                        // Global event (no session)
subscribe(sessionId, handler)            // In-process listener
subscribeToWorkflowRun(runId, handler)   // Filtered subscribe by runId
```

### 8.3 — StreamBroker

**File:** `packages/core/src/services/StreamBroker.ts`

Unified streaming transport with four independent scopes:

| Scope | Used For |
|-------|----------|
| `session` | Direct 1:1 session subscription (v1 legacy) |
| `run` | All events for a workflow run (used by the run page) |
| `chat` | Chat-specific events |
| `global` | System-wide events |

**Three-phase subscribe:**
1. Buffer incoming events.
2. Replay persisted events from `stream_cursors` table.
3. Drain buffer and go live.

**Backpressure-safe:** If outbound queue exceeds 256, sends `slow_consumer_dropped` and disconnects.

### 8.4 — SSE Endpoint

**File:** `apps/server/src/routes/stream.ts`

Two endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/stream?scope=run&id=<runId>` | SSE connection — real-time event stream |
| `GET /api/stream/replay?scope=run&id=<runId>&afterSeq=<n>` | REST pagination for historical events |

SSE frame format:
```
id: 42
data: {"kind":"copilot.token","payload":{"text":"Hello"}}

```

- **Heartbeat** every 30s: `: heartbeat <timestamp>\n\n` (SSE comment — invisible to `onmessage`).
- **Last-Event-ID header**: Browser sets this automatically on reconnect.

### 8.5 — Web Client sseManager

**File:** `apps/web/src/stores/sseManager.ts`

**Connection lifecycle** (ref-counted, per-scope):

1. **REST Replay** (async):
   - Paginate through `GET /api/stream/replay` (PAGE_SIZE=500 until < 500 rows).
   - For run-scope: group events by `stageRunId`, replay each into per-stage stores independently.

2. **EventSource** (live stream):
   - Open: `GET /api/stream?scope=run&id=<runId>`.
   - During replay: buffer incoming SSE events in `pendingSSEEvents`.
   - After replay completes: drain buffer with dedup, then go live.

3. **Deduplication**:
   - `seenSequenceIds: Set<number>` — bounded to 500 entries.
   - Skip if `seq <= lastReplayedSequence` or already in set.
   - Periodic pruning: keep newest 300, drop older.

4. **Cross-Buffer Flush** (**load-bearing** for UI correctness):
   - When `copilot.token` arrives while thinking text is buffered → **flush thinking first**, then buffer token.
   - When `copilot.reasoning_delta` arrives while token text is buffered → **flush token first**, then buffer thinking.
   - This ensures the UI displays thinking and response text in correct temporal order.

### 8.6 — Reconnection & Gap-Free Delivery

If the browser reconnects (network blip):
1. EventSource automatically sends `Last-Event-ID: <lastSeq>` header.
2. Server's `/api/stream` route uses this as `afterSeq`.
3. `StreamBroker.subscribe()` replays missed events from `stream_cursors`, then goes live.
4. Client-side dedup set prevents showing any event twice.

---

## 9. Session Modes — All Three Scenarios

Applied to the Code Generation Workflow V1 with its parallel stages:

### 9.1 — `single` Mode

```
One Copilot conversation (C1) for all 4 stages.

ReqAnalysis → sends prompt in C1
   LLM responds with full context.
CodeGen → sends prompt in SAME C1
   LLM sees full ReqAnalysis history (no summary needed).
TestGen → waits for CodeGen to release conversation lock (!!)
   sends prompt in SAME C1 (sees ReqAnalysis + CodeGen history).
Docs → waits for TestGen (!!!)
   sends prompt in SAME C1.
```

| Aspect | Detail |
|--------|--------|
| **Parallelism** | None — stages 3-4 run **serially** because one conversation handles one prompt at a time |
| **Context** | Full conversation history shared across all stages — no summaries needed |
| **Sessions** | 1 total, ref-counted, destroyed after last stage releases |
| **Best for** | Small, simple workflows where full context sharing matters more than speed |

### 9.2 — `per-stage` Mode (Most Likely Your Workflow)

```
Four independent Copilot conversations.

ReqAnalysis → new session C1 → executes → summary → destroy C1
CodeGen → new session C2
   Receives: ReqAnalysis summary as context message
   Executes → summary → destroy C2
TestGen → new session C3          Docs → new session C4
   Receives: CodeGen summary         Receives: CodeGen summary
   TRUE PARALLEL execution           TRUE PARALLEL execution
   Destroys C3 when done             Destroys C4 when done
```

| Aspect | Detail |
|--------|--------|
| **Parallelism** | True — stages 3-4 run **concurrently** with independent sessions |
| **Context** | Each stage only sees predecessor summaries (not full history) |
| **Sessions** | 4 created and destroyed (max 2 concurrent during parallel phase) |
| **Best for** | DAGs with parallel branches — maximum throughput |

### 9.3 — `auto` Mode

```
Identical to per-stage in current implementation.
auto → per-stage → same behavior as 9.2.
```

| Aspect | Detail |
|--------|--------|
| **Parallelism** | True (same as per-stage) |
| **Context** | Summaries only (same as per-stage) |
| **Sessions** | Same as per-stage |
| **Best for** | Default choice when you're not sure which mode to use |

### 9.4 — Session Mode Comparison Matrix

| Feature | `single` | `per-stage` | `auto` |
|---------|----------|-------------|--------|
| Parallel execution | No | Yes | Yes |
| Full conversation history | Yes | No (summaries only) | No (summaries only) |
| Token efficiency | Higher (shared context) | Lower (repeated context) | Lower |
| Execution speed | Slower (serial) | Faster (parallel) | Faster |
| Context isolation | None | Complete | Complete |
| Max concurrent sessions | 1 | N (number of parallel stages) | N |
| Summary generation | Skipped (not needed) | Required | Required |
| Session lifecycle | Ref-counted | Per-stage create/destroy | Per-stage create/destroy |

---

## 10. Edge Condition Evaluation

**File:** `packages/core/src/domain/dag/ConditionEvaluator.ts`

### Edge Types

| Edge Type | When Target Runs |
|-----------|-----------------|
| `on_success` | Only if source stage `status === 'completed'` |
| `on_failure` | Only if source stage `status === 'failed'` |
| `on_completion` | Regardless of source outcome (completed OR failed) |
| `always` | Unconditionally (rare) |

### Expression-Based Conditions

Beyond simple edge types, stages can have complex conditions evaluated by a safe expression evaluator (**no `eval()`**):

- **Comparisons**: `==`, `!=`, `<`, `>`, `<=`, `>=`
- **Logical operators**: `AND`, `OR`, `NOT` (aliases: `&&`, `||`, `!`)
- **Parentheses**: `(a == 1) AND (b == 2)`
- **Dotted variable paths**: `variables.user.name == 'alice'`
- **Fail-safe**: Unparseable expressions evaluate to `false` (never crash).

### Multiple Predecessors (Convergence Points)

When a stage has **multiple incoming edges** (e.g., a "merge" stage after parallel branches):
- ALL predecessors must reach a terminal state (`completed`, `failed`, or `skipped`) before the target is scheduled.
- Edge conditions are evaluated per-edge — each incoming edge's condition must pass.

---

## 11. Variable System

### 11.1 — Variable Sources

| Source | Injected When | Examples |
|--------|--------------|----------|
| User-provided | Run creation (via VariableInputModal) | `projectName`, `language` |
| System-injected | Run start (by route handler) | `__workingDirectory`, `__artifactsDirectory`, `__workflowRunId` |
| Stage-level | Stage definition | Stage-specific overrides |

### 11.2 — Variable Interpolation

**File:** `packages/shared/src/utils/index.ts` → `interpolateVariables()`

Pattern: `{{variableName}}` in prompt text is replaced with the corresponding value from the variables map.

```
Input:  "Generate code for {{projectName}} using {{language}}"
Vars:   { projectName: "MyApp", language: "TypeScript" }
Output: "Generate code for MyApp using TypeScript"
```

**Features:**
- Dotted path support: `{{user.settings.theme}}` drills into nested objects.
- Flat-key priority: `{ "a.b": 1 }` wins over `{ a: { b: 2 } }`.
- Max depth: 10 segments (blocks pathological lookups).
- Unresolved: `{{unknown}}` stays as literal text.
- Single-pass: interpolated values are NOT re-scanned (prevents template injection).
- Type coercion: numbers/booleans → string, objects → JSON.stringify.

---

## 12. Key Files Reference

### Core Orchestration

| File | Responsibility |
|------|----------------|
| `packages/core/src/services/WorkflowRunService.ts` | Run lifecycle: create, start, poll, advance DAG, complete |
| `packages/core/src/services/DAGScheduler.ts` | DAG building, ready-stage computation, edge evaluation |
| `packages/core/src/services/StageExecutionService.ts` | Stage execution: session alloc, prompt sending, summary gen, artifact extraction |
| `packages/core/src/services/SessionAllocator.ts` | Session mode logic: single/per-stage/auto |
| `packages/core/src/services/WorkflowOrchestrator.ts` | Full lifecycle automation: git, workspace, sandbox, pre/post processing |
| `packages/core/src/domain/dag/ConditionEvaluator.ts` | Edge condition evaluation (safe expression parser) |
| `packages/core/src/domain/dag/types.ts` | DAG, StageNode, StageEdge type definitions |

### Copilot Bridge

| File | Responsibility |
|------|----------------|
| `packages/copilot-bridge/src/CopilotAdapter.ts` | ICopilotPort impl: session create/send/destroy over SDK |
| `packages/copilot-bridge/src/event-mapper.ts` | SDK SessionEvent → domain AgentEvent translation |
| `packages/copilot-bridge/src/tool-factory.ts` | Domain ToolDefinition → SDK Tool wrapping |
| `packages/copilot-bridge/src/permissionMap.ts` | SDK permission kinds → domain types |
| `packages/core/src/domain/ports/ICopilotPort.ts` | Domain interface (no SDK types leak) |

### Event System & Streaming

| File | Responsibility |
|------|----------------|
| `packages/core/src/events/EventBus.ts` | Event emission, persistence, broadcast |
| `packages/shared/src/types/AgentEvent.ts` | ~90 event kind discriminated union |
| `packages/core/src/services/StreamBroker.ts` | Multi-scope streaming with replay |
| `packages/db/src/repositories/StreamCursorRepository.ts` | Persistent event log (stream_cursors table) |
| `apps/server/src/routes/stream.ts` | SSE endpoint handlers |
| `apps/web/src/stores/sseManager.ts` | Client-side SSE manager with dedup |

### Server & Composition

| File | Responsibility |
|------|----------------|
| `apps/server/src/composition-root.ts` | DI wiring: all services hand-wired |
| `apps/server/src/routes/workflowRuns.ts` | REST routes for workflow run CRUD + start |
| `packages/core/src/bootstrap/createCoreServices.ts` | Core service factory (shared by server + CLI) |

### State Machines

| File | States | Purpose |
|------|--------|---------|
| `WorkflowRunStateMachine` | `created → starting → running → [paused] → completed/failed/cancelled` | Run lifecycle |
| `StageRunStateMachine` | `pending → queued → running → [paused/sleeping/awaiting_input] → completed/failed/skipped/cancelled` | Stage lifecycle |
| `SessionStateMachineV2` | `created → active → [paused] → closing → closed` | SDK session lifecycle |

---

## 13. Visual Timeline

### Your Workflow's Execution

```
Time ──────────────────────────────────────────────────────────────→
7:31:18 PM                                                   7:38:19 PM

│ createRun() + startRun()
│    │
│    ├── Build DAG
│    ├── Dispatch root: Requirements Analysis
│    │
│    │   ┌─────────────────────────────────┐
│    │   │ Requirements Analysis           │ (39s)
│    │   │ • Allocate session              │
│    │   │ • Send prompt(s)                │
│    │   │ • Stream tokens → UI            │
│    │   │ • Generate summary              │
│    │   │ • Extract artifacts             │
│    │   └──────────────┬──────────────────┘
│    │                  │ onStageCompleted()
│    │                  │ → gather ReqAnalysis summary
│    │                  │ → dispatch Code Generation
│    │                  │
│    │   ┌─────────────────────────────────┐
│    │   │ Code Generation                 │ (3m 30s, 3 tool calls)
│    │   │ • Allocate new session          │
│    │   │ • Inject ReqAnalysis summary    │
│    │   │   as context message            │
│    │   │ • Send prompt(s)                │
│    │   │ • Agent uses tools (3 calls)    │
│    │   │ • Generate summary              │
│    │   └──────────────┬──────────────────┘
│    │                  │ onStageCompleted()
│    │                  │ → gather CodeGen summary
│    │                  │ → dispatch BOTH Test Gen + Docs (parallel!)
│    │                  │
│    │   ┌──────────────────────┐  ┌──────────────────────┐
│    │   │ Test Generation      │  │ Documentation        │  ← PARALLEL
│    │   │ (1m 30s, 20 tools)   │  │ (2m 46s, 10 tools)   │
│    │   │ • Own session        │  │ • Own session        │
│    │   │ • CodeGen summary    │  │ • CodeGen summary    │
│    │   │   as context         │  │   as context         │
│    │   │ • 20 tool calls      │  │ • 10 tool calls      │
│    │   └─────────┬────────────┘  └─────────┬────────────┘
│    │             │                         │
│    │             └────────────┬─────────────┘
│    │                         │ isDAGComplete() → YES
│    │                         │ completeRun()
│    │                         │ → Release all sessions
│    │                         │ → Emit workflow_run.completed
│    │                         ▼
│    │                   ✅ COMPLETED (7m 1s)
```

### Data Flow Summary

```
┌──────────────┐     POST /api/workflow-runs      ┌──────────────────┐
│   Web UI     │ ──────────────────────────────→  │   Server Route   │
│   (React)    │     POST /api/.../start          │   (Express)      │
│              │ ──────────────────────────────→  │                  │
└──────┬───────┘                                  └────────┬─────────┘
       │                                                   │
       │  SSE: /api/stream?scope=run&id=...                │ calls
       │ ←─────────────────────────────────────            │
       │                                       │           ▼
       │                              ┌────────┴───────────────────┐
       │                              │  WorkflowRunService        │
       │                              │  .startRun()               │
       │                              │  → Build DAG               │
       │                              │  → Dispatch root stages    │
       │                              │  → Poll for completions    │
       │                              │  → Advance DAG             │
       │                              └────────────┬───────────────┘
       │                                           │
       │                                           │ calls per stage
       │                                           ▼
       │                              ┌────────────────────────────┐
       │                              │  StageExecutionService     │
       │                              │  → Allocate session        │
       │                              │  → Inject summaries        │
       │                              │  → Send prompts            │
       │                              │  → Generate summary        │
       │                              └────────────┬───────────────┘
       │                                           │
       │                                           │ via ICopilotPort
       │                                           ▼
       │                              ┌────────────────────────────┐
       │                              │  CopilotAdapter            │
       │                              │  → SDK session.send()      │
       │                              │  → Map SDK events          │
       │                              │  → Return response         │
       │                              └────────────┬───────────────┘
       │                                           │
       │                                           │ events
       │                                           ▼
       │                              ┌────────────────────────────┐
       │  SSE frames                  │  EventBus → StreamBroker   │
       │ ←────────────────────────────│  → DB persist              │
       │                              │  → SSE broadcast           │
       ▼                              └────────────────────────────┘

  ┌──────────────┐
  │  sseManager  │
  │  → Dedup     │
  │  → Store     │
  │  → Re-render │
  └──────────────┘
```
