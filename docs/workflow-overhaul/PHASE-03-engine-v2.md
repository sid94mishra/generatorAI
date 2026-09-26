# PHASE 03: Execution engine v2 (core and cutover)

**Goal:** replace the v1 run engine with the G5 design. The v2 engine has:
- a pure `decide()`;
- a per-run serial actor with an ownership lease and fencing;
- one synchronous transaction per decision batch;
- CAS transitions against the state tables, as the **only** status writer;
- attempts as rows;
- error classes, resume-by-default retries and a separate repair budget;
- output contracts validated **before** completion, using native structured output where the provider has it;
- leases plus a progress watchdog;
- durable timers, an outbox, and recovery that never completes a stage on missing work;
- budget accounting.

When this phase ends, the engine capability gate flips to `v2`, which enables every StageSpec v2 field already stored since P01. The v1 engine is deleted.

The stage conversation API and UI and the run-page correctness work live in **PHASE-03b** (split out per RV-44).

**Estimate:** 5–6 weeks. **Depends on:** P02. **Branch:** `wf/phase-03-engine-v2`. Milestones 3A, 3B and 3C merge to the base branch as they go green (RV-38). 3A and 3B are additive; 3C is the atomic cutover.
**Closes:** W-01, W-02, W-08, W-09 (session model), W-11, W-12, W-14, W-15, W-16, W-17, W-29, W-31 (runtime), W-32, W-39, W-41 (engine sub-items), W-46, W-47 (runtime), W-48 (output retry), W-59 (fork), W-66 (single gate); RV-1, RV-5, RV-9, RV-10, RV-17, RV-20, RV-27. PD-2 and PD-13 applied.

## Read first
- `G5_scheduler_v2_loops.md`: all of it. Implement §1, §3, §4.1–4.2, §5, §6 (run side), §7, and §2.4/2.10/2.11 for agent stages. Container kinds arrive in P05 on the same machinery.
- `B_runtime.md`, `F_live_tests.md`
- `REVIEW-LOG.md` RV-1, RV-5, RV-9, RV-10, RV-17, RV-27

---

## Milestone 3A: Persistence (additive; no runtime change)

### WP-3.1 CAS repositories and RunStore
1. `StageRunRepository.transition(id, from[], to, {expectedVersion?, patch?, lease?})` is a **synchronous** CAS (G5 §5.4). Legal pairs come from `STAGE_RUN_TRANSITIONS` (P01): dev and test throw on an illegal pair; production rejects and logs. Add `renewLease` and `markProgress`. Entering `starting`/`running` stamps the lease, heartbeat and progress in the same statement (fixes B-2 by construction).
2. `WorkflowRunRepository.transition` is the run equivalent, using `WORKFLOW_RUN_TRANSITIONS`.
3. New repositories: `StageAttemptRepository`, `RunSessionRepository`, `WorkflowTimerRepository`, `WorkflowOutboxRepository`, `SchedulerJournalRepository`.
4. **`RunStore.apply(runId, ownerEpoch, decisions)`** runs `sqlite.transaction(() => …)()` in the G5 §5.5 order. **Every statement that touches the run is fenced**: `UPDATE workflow_runs SET … WHERE id=? AND owner_epoch=?`, and the batch aborts when that returns 0 rows (RV-27).

### WP-3.2 Migration v57 `workflow_engine_v2`
Run `pnpm workflow:backup` and `pnpm workflow:cleanup-runs` first. The module is `migrations/v57_workflow_engine_v2.ts`, with frozen schema copies in `migrations/v57/`.
1. **Purge dev runs created since v55.** Use the same explicit child-delete sequence as v55 step 4, with the `purge_sessions` temp table (RV-1). Do **not** rely on cascades: foreign keys are off during rebuilds.
2. Drop and recreate `workflow_runs`, `stage_runs`, `session_allocations` (dropped), `stage_session_maps` (dropped) and `automation_execution_runs`. Create `stage_attempts`, `run_sessions`, `workflow_timers`, `workflow_outbox` and `scheduler_journal` exactly per G5 §6.2, **plus** the following.

   **Columns added to G5 §6.2:**

   | Table | Column | Why |
   |---|---|---|
   | `workflow_runs` | `trigger` (JSON), `invocation_id`, `idempotency_key UNIQUE`, `parent_run_id`, `parent_stage_run_id`, `root_run_id`, `depth`, `run_overrides` (JSON), `stage_overrides` (JSON), `codebase_selection` (JSON), `system_vars` (JSON), `workspace_id`, `permission_mode TEXT NOT NULL` | P04 invocation, so no second rebuild |
   | `workflow_runs` | `owner_id`, `owner_epoch INTEGER NOT NULL DEFAULT 0`, `owner_expires_at` | RV-27 fencing |
   | `stage_runs` | `amended_at` | P03b |
   | `stage_attempts` | `agent_snapshot` (JSON), `judge` (JSON, used in P05), `structured_output` | P02 snapshot; P05 judge |
   | `chat_messages` | `turn_role TEXT` (`context\|feedback\|prompt\|repair\|summary\|approval_feedback\|operator\|iteration_input\|wrap_up\|digest`; NULL for chats), **with no CHECK constraint**, so later values need no table rebuild | A chat-table change: add the column only, never rewrite rows |

3. Create a single-engine lock: the table `engine_lock(id INTEGER PRIMARY KEY CHECK(id=1), owner_id, boot_id, heartbeat_at)`.
4. Regenerate the baseline, and update the lock file and `schema.ts`.
5. **Migration test:**
   - chats and messages are unchanged apart from the NULL `turn_role`;
   - stage-session messages are removed **exactly**;
   - `foreign_key_check` is empty;
   - an orchestrator worker chat survives;
   - definitions are untouched;
   - a fresh DB reaches head via the baseline.

---

## Milestone 3B: Engine core (additive: new modules wired only in tests)

### WP-3.3 Pure scheduler core
Location: `packages/core/src/domain/scheduler/` (`decide.ts`, `readiness.ts`, `terminal.ts`, `types.ts`) and `domain/workflow-graph/compile.ts`. P01's `RunDefinitionReader` becomes `compile(versionSpec)`.
- `decide(graph, state, msg, now) → Decision[]` (G5 §5.3). Determinism: no clock, no randomness, uuidv5 ids, `instance_path` order.
- Readiness v2: join policies, `cancelRemaining`, guards evaluated after readiness (an evaluation error → `condition_error`, never a silent skip).
- `computeScopeOutcome`: only `on: failure` or `handlesFailure` absorbs a failure (W-29).
- Skip reasons with a cause.
- **Precedence** on `attempt_settled(failed)` (G5 §3.5): repair (in the executor) → retry → route → onExhausted.
- Run states `waiting` and `finalizing`. Finalizing runs compensation and `onExit`/`onFailure`. Commit/PR stays in the P04 lifecycle; see WP-3.8.
- **Budgets:** stage and run roll-ups. An exhausted run budget refuses new launches and puts the run in `paused(budget_exhausted)`.
- **Concurrency:** per-run `maxParallel`, and `sessionGroup` exclusivity.
- **Tests first** (R-7):
  - table tests (the B probes S1–S5 and T2);
  - precedence;
  - `fast-check` model tests with the ten G5 §7.2 invariants;
  - replay fixtures (G5 §7.3).

### WP-3.4 Error taxonomy
- `domain/errors/StageError.ts`: `ErrorClass`, `StageErrorCode`, `classifyStageError` (G5 §3.1).
- `agent-harness-providers/src/errors.ts`: `HarnessError {code, retryAfterMs?}`, mapped per provider, with recorded-fixture tests.
- Errors before the attempt body are classified too.

### WP-3.5 StageExecutor (carved from SES)
File: `services/engine/StageExecutor.ts`. The P02 composer builds the session.
- **Lifecycle:** claim `ready → starting` (lease), compose, `starting → running`. Admission waits happen while the stage is still `ready`. **Delete the stage Semaphore**, leaving one gate (W-66). Checkpoint capture happens in `starting`, and is skipped for stages with no write or shell groups (F O-1).
- **Every turn:**
  - is inside the attempt deadline, **internal turns included** (B-8, F-14);
  - feeds the idle watchdog from harness events;
  - is followed by a status re-check: if the stage or run is no longer `running`, stop and write nothing (F-1, O-9).
- **Desired state first:** pause and cancel are written by the actor before `executor.abort()`. An aborted turn that **resolves** (claude-agent) is handled like one that throws.
- **Context delivery:** predecessor context goes into the first prompt turn, fenced `<generatorai:stage-context trust="untrusted">`. There is no context-ack turn (F O-3).
- **`sessionReuse`/`sessionGroup`:** `run_sessions(session_key, config_hash)`. When the config hash differs on reuse: a same-provider rebind through `resumeConversation(newParams)`, or a fresh session plus recap. This is the rebind moved here from P02 (RV-20).
- **OutputExtractor** (`services/engine/OutputExtractor.ts`, RV-9). Strategies in order, chosen by `capabilities()`:
  1. **native**, where `structuredOutput === 'native'`:
     - claude-agent: `outputFormat: {type:'json_schema', schema}` applied **only on the final prompt turn**, because it is session-scoped. `error_max_structured_output_retries` becomes repairable.
     - Codex: `turn/start.outputSchema` on the final prompt turn.
  2. **tool:** `submit_output` with ajv, where `hostTools !== 'none'`. On Codex resume (`start_only`), fall back to 3 and emit a warning. Or re-send `dynamicTools` if the app-server supports it; verify first, and record the result in DEVIATIONS.
  3. **`final_json_block`:** the last JSON block of the current attempt's **prompt-turn** messages, found via `turn_role`.

  Then the hard rules, then repair turns while `repair_count < maxRepairs`, then `attempt_settled(succeeded)`. This fixes F-5/F-6/F-7/B-11/W-17.
- **Output text** comes from prompt turns only. The under-50-characters output-retry turn is deleted (F-10). JSON stages get no summary turn. Text stages get one only when a successor needs `context.mode: summary` (the rest is P07).
- **Journal:**
  - A turn's settlement is written in the same transaction as the persisted assistant message with `complete = 1`.
  - **Recovery rule (RV-10):** a turn with no settlement is **interrupted**, whatever messages exist. A partial message (`complete = 0`) never counts as settled. Interrupted turns on a `never`-replay stage produce `paused(process_restart_unsafe)`; they are never `completed` (W-16).
  - Resume uses the provider session id (P02).
- **Approval gate:** `running → awaiting_input(completion_review)`. `changes_requested` runs through the **same** `runTurn` path, which journals, streams, persists and merges into the output (F-2, W-46). Rounds are capped. The lease is cleared while waiting, and HITL time is excluded from `attemptMs` (B-7).
- The `pre_run` hook variable leak (W-41 sub-item): hook-injected variables are scoped to the attempt, as a copy, never the shared run object.
- `StageExecutionError` carries the stage-run id, not the definition id (W-41 sub-item).

### WP-3.6 Actor, supervisor, ownership, timers, leases, outbox, recovery
Location: `services/engine/`.
- **`RunSupervisor`**
  - **Single-engine lock at boot** (RV-27). Take `engine_lock` with this boot id when its heartbeat is stale (older than 30 s); otherwise **refuse to start the engine** and log that another process owns this DB. The desktop app, server and SDK all use the same lock. The testkit uses its own in-memory DB.
  - It renews the lock every 10 s.
  - Every run it hosts gets `owner_id = bootId` and `owner_epoch += 1` on acquisition.
- **`RunActor`:** `load → decide → apply(ownerEpoch) → dispatch`. It retries up to 3 times on a CAS conflict, and never awaits I/O in `process`.
- `TimerService` and `LeaseReaper` act **only on runs owned by this boot**.
- **`OutboxDispatcher`** (awaited run-scope publish). **Compatibility of terminal events until P04** (RV-5): the v2 engine emits `workflow_run.completed|failed|cancelled` with the exact kinds and `data.workflowRunId` that `WorkflowOrchestrator`'s post-processing listener and `AutomationService.waitForRunCompletion` read today. Both are deleted in P04. This is the final event contract, not a shim: P04 adds `finalized` after them.
- **Recovery:** lock → rehydrate `run_sessions` → resolve in-flight attempts (the RV-10 rule) → re-arm timers → re-launch `ready`. `StartupRecoveryService` is **deleted**, and the supervisor owns recovery (G3 2.2.11).
- **Commands API:** `POST /api/workflow-runs/:id/commands {command, instanceId?, expectedVersion?, …}`. Commands: `pause {drain|interrupt}`, `resume`, `cancel`, `retry {mode}`, `skip {as}`, `fail`, `approve {outcome, feedback?, data?}`. The schema is a discriminated union, so later phases add commands (P05: `grant_iterations`, `raise_budget`, `continue_with_input`, `accept`, `accept_iteration`, `deliver_event`) without new routes. **Delete the old per-action routes.** Clients (web, mobile, CLI, TUI, SDK, client-core) switch in this milestone.
- **Unattended pause TTL** (PD-2): for non-user triggers, a `pause_ttl` timer (72 h) fails the run and sends a notification.

---

## Milestone 3C: Cutover (atomic)

### WP-3.7 Switch, delete, flip
- Wire `RunSupervisor` in `createCoreServices`. `WorkflowRunService` becomes a facade: `create` (until P04), `start`, `command`, `fork`, `get`, `list`.
- **Delete:**
  - `DAGScheduler.ts`;
  - `WRS.subscribeRunEvents`, `processedStageRuns`, the reconciler, `advanceRun`, `retryStageAfterValidation` and the heartbeat reaper;
  - `SES.retryStage`, `retryInSession`, `sendStageFollowUp`, `pauseStage` and `cancelStage` (SES shrinks to turn helpers or is removed);
  - `SessionAllocator` and its modes;
  - the `ResultValidator` concatenation;
  - `DEFAULT_RETRY_POLICY`;
  - `StartupRecoveryService`.
- `HitlService` works on instances: resolutions post `command approve`, and cancel calls `cancelWaiter` (B-4).
- **`ENGINE_LEVEL = 'v2'`** in the spec package. The builder enables every v2 control that P01 hid:
  - join, repair, onExhausted, all timeouts, budget;
  - sessionReuse and sessionGroup;
  - extraction;
  - compensate, onExit, onFailure, maxParallel;
  - edge `handlesFailure`.

  These use existing components (PD-19).
- `check-workflow-invariants`: the `no-direct-stage-status-write` rule becomes a **hard failure**.
- Flip the P00 characterisation tests. Every `KNOWN-BUG W-xx` for this phase's ids must now assert the correct behaviour.

### WP-3.8 forkRun
`forkRun(sourceRunId, {rerunFrom, definition: pinned|latest, variablesOverride?, workspace: restore_checkpoint|reuse|fresh, idempotencyKey?})` (G5 §3.8):
- memoized instances are copied and never re-validated (B-6);
- the permission mode, overrides, codebases and lineage are carried over (W-59).

The UI gets "Retry failed" on failed runs; "Re-run from here" arrives in P05.

### WP-3.9 Docs
Regenerate `FIELDS.md`, and rewrite `feature-workflow-runs.md` covering states, attempts, precedence, recovery, ownership, commands and fork.

---

## Tests to add
- G5 §7.1–7.5 for agent stages.
- **CAS races:**
  - a claim against a cancel;
  - a repair against a pause;
  - two supervisors on one DB (the second refuses);
  - a stale `owner_epoch` batch is rejected.
- **Chaos regressions (testkit):**
  - F-1 (pause mid-stage, then resume → output not empty);
  - F-2 (changes requested → the revision reaches the successor);
  - F-3 (a crash after a partial stream → paused and the message is incomplete; a crash after settlement → resumed without re-running);
  - F-4 (a long repair is not reaped);
  - F-5 (finalize cannot skip validation);
  - F-6/F-7 (rules see the prompt output only; a real JSON Schema);
  - F-10 (no output-retry turn);
  - B-3 (nothing dispatched after the cancel write).
- **Structured output per provider strategy:** native (claude-agent, Codex), tool (Copilot), fallback (opencode, ACP, Codex resume).
- **Event contract:** an orchestrated run with `autoCommit` still commits through the P03–P04 window (RV-5).
- **The testkit gate is hard; live is advisory:** T1, T2, T3, T4 (all rules), T4b, T5 (approve, reject, changes, pause, cancel), T7, T8 (crash), T10 (25 stages).
- **Hop latency:** p95 under 300 ms on the testkit.

## Acceptance criteria
- `grep -rn "DAGScheduler\|processedStageRuns\|retryInSession\|retryStageAfterValidation\|SessionAllocator\|StartupRecoveryService" packages apps` finds nothing outside migrations.
- `subscribeGlobal` has no callers in workflow services (P04 deletes the two remaining listeners).
- No `KNOWN-BUG` markers remain for this phase's ids.
- A backup copy of the developer DB migrates to v57. Chats are intact, and definitions run on v2.

## Handoff checklist
- [ ] 3A, 3B and 3C merged green.
- [ ] The v57 dry run on a backup copy is logged in the PR.
- [ ] `STATUS.md` and `TRACEABILITY.md` updated.
