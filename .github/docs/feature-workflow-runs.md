# Feature: Workflow Runs

> **WorkflowRun** is a single execution of a `WorkflowDefinition`. This doc covers run lifecycle, DAG scheduling, session allocation, run profiles, HITL, retries, file management, and durability.

For definition/stage authoring, see [feature-workflows.md](./feature-workflows.md) and [feature-stages.md](./feature-stages.md).

---

## 1. Entity & DB shape

`workflow_runs`:
```
id                    text PK
workflowDefinitionId  FK
name                  text
status                enum 'created'|'starting'|'running'|'paused'|'completed'|'failed'|'cancelled'
sessionMode           enum 'single'|'per-stage'|'auto'         (snapshot at run start)
masterSessionId?      text                                     (when sessionMode=single)
variables             JSON Record<string, unknown>             (resolved variables + system vars)
error?                text
permissionMode        enum 'bypassPermissions'|'default'|'acceptEdits'|'plan'
projectId?            FK → projects.id
workspaceId?          FK → execution_workspaces.id
createdAt, updatedAt, startedAt, completedAt
```

`stage_runs`:
```
id                    text PK
workflowRunId         FK
stageDefinitionId     FK
sessionId?            FK                                       (allocated session, set on first execute)
name                  text
status                enum 'pending'|'queued'|'running'|'paused'|'completed'|'failed'|'cancelled'|'skipped'|'awaiting_input'
currentStep           int                                      (which prompt within the stage, for multi-prompt)
totalSteps            int
retryCount            int (default 0)
error?                text
summary?              text                                     (~200-400 chars, used as predecessor context)
outputData?           JSON                                     (parsed JSON when outputFormat=json)
version               int                                      (optimistic lock)
wakeAt?               int (epoch-ms)                           (DUR-05 — durable sleep deadline)
sleptSince?           int
interruptData?        JSON                                     (HITL-02 — pending approval payload)
createdAt, startedAt, completedAt
```

---

## 2. Lifecycle (state machine)

Pure state machine: [packages/core/src/domain/state-machines/WorkflowRunStateMachine.ts](../../packages/core/src/domain/state-machines/WorkflowRunStateMachine.ts).

```
created → starting → running ←→ paused
                              ↓
                              cancelled
                              ↓
                              failed
                              ↓
                              completed
```

Transitions:

| From | Event | To |
|---|---|---|
| `created` | `sys:start` | `starting` |
| `starting` | `sys:dag_ready` | `running` |
| `running` | `user:pause` | `paused` |
| `paused` | `user:resume` | `running` |
| `running`/`paused` | `user:cancel` | `cancelled` |
| `running` | `sys:dag_complete_all_success` | `completed` |
| `running` | `sys:dag_complete_with_failure` | `failed` |
| `failed` | `user:retry` | `running` (resets failed stages to `queued`) |
| `running` | `sys:error` | `failed` |

Stage run state machine similar but with the extra state `awaiting_input` (HITL-02).

---

## 3. Run creation & start

API: `POST /api/workflow-runs`
Body (`CreateWorkflowRunSchema`):
```typescript
{
  workflowDefinitionId: string;
  name?: string;
  variables?: Record<string, unknown>;
  projectId?: string;            // override the definition's projectId
  permissionMode?: 'bypassPermissions'|'default'|'acceptEdits'|'plan';
  orchestratorConfig?: {
    stageOverrides?: StageOverride[];
  };
}
```

Server-side:
1. `WorkflowRunService.createRun(params)` validates variables against definition.
2. Inserts `workflow_runs` row in `created` state.
3. Inserts N `stage_runs` rows (one per stage def), status `pending`.
4. Returns `WorkflowRun`.

`POST /api/workflow-runs/:id/start` → `WorkflowRunService.startRun(runId)`:

```
1. Read run + state machine.
2. If first start (no __workingDirectory):
     - workspaceManager.createWorkspace({ ownerType: 'workflow_run', ownerId: runId, … })
     - if projectId → worktreeService.createRunWorktrees(projectId, runId, aliases, 'workflow')
     - inject __workingDirectory, __artifactsDirectory, __workspaceId, repo_path_<alias>, repo_branch_<alias>
3. State transition: created → starting → running.
4. Build DAG (DAGScheduler.buildDAGForDefinition, hash-cached).
5. Get root stages.
6. For each root stage:
       - apply stageOverrides (if skip=true, mark stage_run as 'skipped' and emit event)
       - executeStage(stageRun, runId, sessionMode, harnessConfig, variables).catch(onStageFailed)
7. startPolling(runId) — 3s interval to detect stage completion changes
   (resilient to executeStage hangs/session release stalls)
```

`POST /api/workflow-runs/:id/start` returns `202 Accepted` immediately; progress observable via SSE.

---

## 4. DAG scheduling

`DAGScheduler` ([packages/core/src/services/DAGScheduler.ts](../../packages/core/src/services/DAGScheduler.ts)) is the runtime brain.

### `buildDAGForDefinition(defId)`
Reads stages + edges, hashes them (SHA1 of sorted serialization), caches. Re-uses cache when hash unchanged.

### `getRootStages(runId, defId)`
Returns stage IDs with no incoming edges, i.e., `dependencyIds.length === 0`. Used at run start.

### `onStageCompleted(runId, defId, completedStageDefId)`
Called by `WorkflowRunService.onStageCompleted()` after a stage transitions to terminal status.

```
1. Read all stage_runs for this run + the DAG.
2. Find outgoing edges from completed stage.
3. For each candidate target stage:
       3.1  Skip if already non-pending.
       3.2  Check ALL predecessors are terminal (completed | failed | skipped).
       3.3  Evaluate stage.condition against { parentStatus }.
       3.4  If passes → add to toSchedule.
4. Return toSchedule[].
```

### `getReadyStages(runId, defId)`
Polling-style alternative — returns all stages currently ready.

### `getSkippableStages(runId, defId)`
For cascading skips — returns stages whose predecessors are terminal but their condition can never be satisfied.

### `isDAGComplete(runId, defId)`
Returns true when all stages are in a terminal status.

### Cache invalidation
Hash-based. Any mutation to stages/edges (via `WorkflowDefinitionService.addStage()` etc.) does not actively invalidate; the next call sees a different hash and rebuilds. **Manual override:** `dagScheduler.clearCache(defId)` if needed.

### Cycle handling
`DAGValidator.validateDAG()` runs at definition save time. If a cycle slips through (e.g., direct DB write), `topologicalSort()` throws `DAGValidationError` at run start.

---

## 5. Session allocation

`SessionAllocator` ([packages/core/src/services/SessionAllocator.ts](../../packages/core/src/services/SessionAllocator.ts)).

### Modes (from `WorkflowRun.sessionMode`)

| Mode | Allocation rule |
|---|---|
| `single` | One session for the whole run. First `allocateSession()` creates it (`harness.createConversation`); subsequent calls return the same `conversationId`. Stored in `workflow_runs.masterSessionId`. |
| `per-stage` | Each `allocateSession()` returns a fresh session. Stage runs in their own conversation. |
| `auto` | Not a per-stage heuristic: `startRun` resolves it once for the whole run to `per-stage` (any parallelism in the DAG) or `single`, and persists the answer. |

### Persistence (1.6)
- `session_allocations` table — one row per (workflowRunId), records `mode`, `sharedSessionId`, `sharedRefCount`.
- `stage_session_maps` table — one row per (allocationId, stageRunId), records the `sessionId` assigned.

This survives process restarts: on recovery, `StartupRecoveryService` re-binds the allocator to the existing maps.

### Release
After a stage completes (success or failure), `sessionAllocator.releaseSession(stageRunId)`:
- If `per-stage`: `harness.deleteConversation(sessionId)`.
- If `single`: decrement `sharedRefCount`. When zero (run terminal), `harness.deleteConversation`.

> **Edge case:** if `executeStage` hangs and never releases, the stage-liveness reconciler (below) marks the stage failed once its heartbeat goes stale, but the session leak can persist. Use `run cancel` then `workspace cleanup` to recover.

### Stage liveness (heartbeat reaper)

`StageExecutionService` beats `stage_runs.heartbeat_at` roughly every 10s for as long as a stage is `queued`/`running` (an immediate beat at start, then on an interval; the interval is cleared the moment the stage leaves that state — success, failure, pause, or cancel). This is a real signal of "this stage's executor is still alive," independent of any individual prompt's own timeout (§ feature-stages.md "Timeout").

The existing 3s process-wide reconciler (`WorkflowRunService.ensureReconciler` — the same `setInterval` that drives event-driven DAG routing as a backstop) gains one more check per tick: a `queued`/`running` stage whose last beat is older than `heartbeatIntervalMs * heartbeatStaleMultiplier` (default 10s × 3 = 30s) is judged stuck. The reconciler:
1. best-effort asks `StageExecutionService.abortStage()` to cancel the wedged call (aborts the tracked `AbortSignal` for the in-flight turn, and separately asks the harness to abort the conversation) — so a relaunch never races a still-writing agent in the same working directory;
2. marks the stage `failed` with an error explaining the stale beat;
3. routes it through the normal `onStageFailed` path, so `on_failure`/`on_completion`/`always` edges and operator skip overrides apply exactly as for any other failure.

No second polling interval was added — this extends the existing one.

---

## 6. Run profiles & stage overrides

A **RunProfile** is a reusable preset bundled either inside a `.workflow.mjs` script (`.profile({...})`) or saved as JSON in `.generatorai/run-profiles/`.

Schema (`RunProfileSchema`):
```typescript
{
  name: string;
  description?: string;
  runName?: string;
  variables?: Record<string, unknown>;
  sessionMode?: 'single'|'per-stage'|'auto';
  permissionMode?: 'bypassPermissions'|'default'|'acceptEdits'|'plan';
  projectId?: string;
  selectedCodebases?: string[];                  // aliases
  stageOverrides?: StageOverride[];
  promptFiles?: string[];                         // uploaded prompts (custom content)
  skillFiles?: string[];                          // uploaded skills (custom content)
  agentFiles?: string[];                          // uploaded agents (custom content)
}

type StageOverride = {
  stageName?: string;
  stageIndex?: number;
  skip?: boolean;
  agentName?: string;
  contextFilter?: ContextFilter;
  timeoutMs?: number;
  variables?: Record<string, unknown>;            // stage-local var overrides
};
```

Resolution: `WorkflowRunService.findStageOverride(variables.__stageOverrides, stageName, stageIndex)`. Skips matched. Override fields merge into the resolved per-stage config.

`__stageOverrides` is folded into `workflow_runs.variables` at run start so the run remains self-describing.

---

## 7. Pause / Resume / Cancel / Retry

API:
- `POST /api/workflow-runs/:id/pause` — `WorkflowRunStateMachine.transition('user:pause')`. The polling loop stops scheduling new stages; running stages complete their current prompt then exit. Mid-prompt pause **waits for the in-flight SDK call** to finish (cannot abort mid-prompt without `cancel`).
- `POST /api/workflow-runs/:id/resume` — `transition('user:resume')`. Polling resumes; pending stages start.
- `POST /api/workflow-runs/:id/cancel` — `transition('user:cancel')`. `harness.abortConversation` called on every active session; subprocesses killed.
- `POST /api/workflow-runs/:id/retry` — valid from `failed` or `cancelled`. Creates and starts a **new** run carrying `ancestorRunId`; the ancestor stays terminal. Stages that were `completed` or `skipped` in the ancestor are promoted to that state in the new run, so successful work is not re-run. The response's `runId` is the NEW run.

Stage-level controls (subset of run-level):

```
POST /api/workflow-runs/:id/stages/:stageId/pause
POST /api/workflow-runs/:id/stages/:stageId/resume
POST /api/workflow-runs/:id/stages/:stageId/cancel
POST /api/workflow-runs/:id/stages/:stageId/retry
```

Stage retry resets the stage to `queued` (full restart) regardless of `retryPolicy`.

---

## 8. HITL (Human-In-The-Loop)

Permission mode determines who decides on tool calls:

| Mode | Behavior |
|---|---|
| `bypassPermissions` (default) | every tool call auto-approved |
| `default` | provider asks for unmatched requests (using harness's built-in permission UI when present) |
| `acceptEdits` | auto-approve file edits only; ask for shell exec / network |
| `plan` | every tool call requires explicit human approval (stage parks in `awaiting_input`) |

API:
- `GET /api/workflow-runs/:id/permission-mode`
- `POST /api/workflow-runs/:id/permission-mode` body `{ mode }`
- `GET /api/workflow-runs/:id/pending-interrupts` — list `awaiting_input` stages with their `interruptData`
- `POST /api/workflow-runs/:id/stages/:stageId/approve` body `{ outcome: approved | changes_requested | rejected, value?, reason?, followUpPrompt? }` (400 without an outcome)

Web `HitlPanel` (in Run Settings drawer) provides the UI: 4-mode dropdown + per-stage approve/reject buttons.

`HitlService` orchestrates via `IHookBridge` → `onPreToolUse` returns `{ decision: 'allow'|'deny'|'ask', reason }`. When `ask`, the service:
1. Sets `stage_runs.status = 'awaiting_input'` + writes `interruptData` JSON.
2. Emits `stage_run.awaiting_input` SSE event.
3. Returns the user's eventual decision back to the harness when approval arrives.

---

## 9. Result validation & retries (in-depth)

When `StageExecutionService` finishes a stage's prompts:

1. Builds concatenated `content` (all assistant message_complete texts).
2. Runs `ResultValidator.validate(content, stageDef.resultValidation)`.
3. If any rule fails → `workflowRunService.retryStageAfterValidation(runId, stageRunId, reason)`.

`retryStageAfterValidation`:

```
1. Remove stageRun.id from processedStageRuns dedup set (so we can re-emit completion).
2. Read retryPolicy = stageDef.retryPolicy ?? { maxRetries:1, backoffMs:3000, backoffMultiplier:1 }.
3. inSessionThreshold = max(1, maxRetries - 1).
4. useInSessionRetry = retryCount < inSessionThreshold.
5. Await backoffMs * backoffMultiplier^retryCount.
6. Increment stage_runs.retryCount.
7. Emit stage_run.retrying.
8. If useInSessionRetry:
     - Reset status = 'running', clear error/completedAt.
     - Enrich vars: __validationFeedback = reason, __validationRetryAttempt = count.
     - stageExecutionService.retryInSession(stage, runId, reason, config, enrichedVars)
       → sends a follow-up prompt: "The previous response failed validation: <reason>. Please fix it."
   Else (full restart):
     - Reset status = 'queued', currentStep = 0.
     - sessionAllocator.releaseSession(stageRunId).
     - executeStage(stage, runId, sessionMode, config, enrichedVars).
```

When `retryCount >= maxRetries`, the next failure is terminal → stage transitions to `failed`.

---

## 10. File management & artifacts

For the full deep-dive see [feature-workspaces-files.md](./feature-workspaces-files.md). Quick summary:

- **Per-run execution workspace** at `<workspacesDir>/<runId>/`:
  - `source/<alias>/` — worktrees of selected codebases
  - `artifacts/` — generated files + per-run JSONL log + stage response markdown files
  - `cache/` — temporary files

- **`workspace_artifacts` table** tracks every file with `artifactType ∈ { code_file | response_md | attachment | script_output | log | snapshot | browser_screenshot | browser_dom | browser_har | browser_console_log | browser_video | browser_selection }`.

- **Stage responses** persisted to `artifacts/responses/stage-<order>-<name>.md`.

- **Change tracking** — `workspace_worktrees.hasUncommittedChanges` + `commitHash` columns. `POST /api/workspaces/:id/commit` runs `git commit` per worktree and stamps the new hash.

API for browsing files mid-run:
```
GET  /api/workflow-runs/:id/workspace                       → tree view
GET  /api/workflow-runs/:id/workspace/files?path=&source=   → file content
GET  /api/workflow-runs/:id/diff                            → git diff across worktrees
```

### Right side pane on the run page

`WorkflowRunPage` shares the same `RightPane` shell used by chats. Tabs available on this page:

- **Changes** *(default)* — `RunArtifactsPanel` (per-worktree files + response markdown + code files).
- **Inspector** — per-stage prompt / output / hooks / tools drill-down (`RightInspector`).
- **Browser** — Integrated Browser panel, disabled until `runData.workspaceId` exists. See [feature-integrated-browser.md](./feature-integrated-browser.md).
- **Terminal** — Integrated Terminal panel, `allowMultiple: true`. Header includes a `[cd ▾]` dropdown listing the run's worktrees so users can jump into `source/<alias>` with one click. See [feature-integrated-terminal.md](./feature-integrated-terminal.md).

State (open tabs / active / width) is persisted in `localStorage:generatorai:rightPane:workflow-run`.

---

## 11. Durability & crash recovery

- **DB-backed event log** (`stream_cursors` + `stream_sequences`) — survives process restart. SSE clients reconnect with `Last-Event-ID`.
- **Per-run JSONL log** (`<artifacts>/run.jsonl`) — append-only audit of every event for that run.
- **State persisted** — every `stage_runs.status` transition is committed before downstream effects, so a crash mid-run leaves the DB in a recoverable state.
- **`StartupRecoveryService`** scans `workflow_runs` in `running`/`paused` on boot; resumes those within `recoveryThresholdMs` window, cancels older ones (operator can `run retry` them).
- **Optimistic locking** — `stage_runs.version` prevents concurrent updates from clobbering each other. Conflict raises `ConcurrentModificationError` → caller retries with fresh read.
- **Worktree leakage** — if the process dies mid-run, worktrees remain on disk. `WorktreeCleanupService` periodically reaps orphans based on `worktreeRetention` setting.

---

## 12. Streaming during a run

For full details see [feature-streaming-events.md](./feature-streaming-events.md).

The SSE endpoint for runs: `GET /api/stream?scope=run&id=<runId>`. Every event is also published to `scope=session, id=<sessionId>` for its underlying session, so subscribers to a single stage's session see token-level detail and run-level subscribers see lifecycle.

Common run-scope events:

```
workflow_run.starting
workflow_run.running
workflow_run.paused
workflow_run.resumed
workflow_run.cancelling
workflow_run.cancelled
workflow_run.completed
workflow_run.failed
workflow_run.retrying

stage_run.queued
stage_run.running
stage_run.completed
stage_run.failed
stage_run.cancelled
stage_run.skipped
stage_run.retrying
stage_run.awaiting_input
stage_run.approved
stage_run.rejected
stage_run.woken

permission.requested
permission.granted
permission.denied
permission.timeout

hook.started
hook.completed
hook.failed
hook.skipped

artifact.created

git.clone_start
git.clone_progress
git.clone_complete
git.commit
git.push
git.pr_created

script.stdout
script.stderr
script.exit
```

…plus every harness.* event from inside each session.

---

## 13. CLI

```powershell
# Lifecycle
generatorai run start <defId> --var topic="caching strategies" --watch
generatorai run start <defId> --profile ./profiles/fast.json --project <pid>
generatorai run list [--status running,completed,failed] [--definition <id>] [--limit 50]
generatorai run show <id>
generatorai run watch <id> [--verbosity minimal|normal|verbose]
generatorai run pause <id>
generatorai run resume <id>
generatorai run cancel <id>
generatorai run retry <id>
generatorai run delete <id>

# Stage-level
generatorai run stage list <runId>
generatorai run stage pause <runId> <stageId>
generatorai run stage resume <runId> <stageId>
generatorai run stage retry <runId> <stageId>
generatorai run stage cancel <runId> <stageId>

# HITL
generatorai run hitl mode <runId>                       # show
generatorai run hitl mode <runId> --set acceptEdits     # set
generatorai run hitl pending <runId>                    # list awaiting_input stages
generatorai run hitl resume <runId> <stageId> --approve
generatorai run hitl resume <runId> <stageId> --reject

# Run profiles
generatorai run profile generate <defId> -o ./profiles/template.json    # create template
generatorai run profile validate ./profiles/myprofile.json
generatorai run profile list

# Inspection
generatorai run messages <runId>                        # per-stage prompt+response
generatorai run workspace <runId>                       # files in workspace
generatorai run interrupt <runId> <stageId> [--approve] [--value json] [--reason "..."]
```

---

## 14. SDK

```typescript
const run = await ai.workflows.run(definitionId, {
  variables: { topic: 'AI safety' },
  projectId: 'proj-123',
});

// Stream and react
for await (const event of ai.workflows.stream(run.id)) {
  if (event.kind === 'stage_run.completed') {
    console.log(`Stage ${event.data.stageName} done`);
  }
  if (event.kind === 'workflow_run.completed' || event.kind === 'workflow_run.failed') {
    break;
  }
}

// Control
await ai.workflows.pause(run.id);
await ai.workflows.resume(run.id);
await ai.workflows.cancel(run.id);
const retried = await ai.workflows.retry(run.id);
```

---

## 15. Edge cases & invariants (run-level)

1. **`startPolling()` keeps running** until `run.status !== 'running'`. If your code transitions a stage to terminal without firing `onStageCompleted`, the poller will still pick it up within 3s.
2. **`processedStageRuns` dedup** — must be cleared by `retryStageAfterValidation` (and equivalent). Forgetting to clear it causes "stage completed but never re-evaluated".
3. **`__workingDirectory` resolution** — first worktree path (or workspace root if no worktrees). Stage harness call uses this as cwd.
4. **`permissionMode = 'plan'` runs hang forever** without approval; the test harness must approve or cancel.
5. **Pause + worktree changes** — pausing does not commit any worktree changes. If you `workspace commit` then `cancel`, the commit is preserved (worktree remains).
6. **`workflow_runs.variables` is the snapshot** — variables there persist for the run's lifetime. Stage-time changes via hooks (`HookResult.variables`) merge in but are not retroactive.
7. **Concurrent retries** — `retryStageAfterValidation` and explicit `run retry` can race. `processedStageRuns` + optimistic lock on `stage_runs.version` prevent state corruption but the user-visible behavior may double-execute one prompt. Avoid simultaneous retries from CLI + UI.
8. **DAG with no roots** — illegal at definition save; if it slips, `startRun` throws `ValidationError('Workflow has no root stages')`.
9. **Variables with `{{undefined}}` references** — interpolated as the literal `{{name}}` string. The prompt is still sent.
10. **Run cancel while a hook is in flight** — the hook's `AbortSignal` is signalled; subprocesses are SIGKILLed after `hook.timeoutMs`.
