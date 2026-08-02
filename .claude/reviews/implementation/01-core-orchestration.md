# 01 — Core orchestration (`packages/core`)

Detailed implementation plan for the 8 Critical + 22 High findings in section A of [../CODE_REVIEW.md](../CODE_REVIEW.md).

Effort legend: **S** ≤½ day · **M** ½–2 days · **L** 2–5 days · **XL** >5 days.

---

## Critical

### [CRITICAL] DAG cache invalidation — `services/DAGScheduler.ts:26-27`

**Issue.** `dagCache: Map<defId, DAG>` is populated on first `buildDAGForDefinition()` call but only cleared via manual `clearCache()`. Post-boot edits to stages/edges do not invalidate, so the scheduler runs on stale topology.

**Fix.**
1. Add a definition-hash cache: `dagCacheVersion: Map<defId, string>`.
2. On `buildDAGForDefinition(defId)`: compute a hash `sha256(stages + edges)` (or a version counter stored on `workflow_definitions`), compare against cached; rebuild on mismatch.
3. In `WorkflowDefinitionService.update*`, `addStage`, `updateStage`, `deleteStage`, `addEdge`, `deleteEdge`: call `scheduler.invalidateCache(defId)` after DB write.

**Ripple.** `WorkflowDefinitionService` gains a dep on `DAGScheduler`. Tests that edit definitions mid-run must verify DAG is rebuilt.

**Effort:** M. **Deps:** none. **Acceptance:** unit test — edit stage def mid-run; `getReadyStages()` reflects new topology. Integration test — update and verify the next run uses updated prompt.

### [CRITICAL] EventBus DB-failure swallow — `events/EventBus.ts:47`

**Issue.** `.catch(() => {})` on the per-session emit queue silently eats DB insert failures. Subscribers still receive the event via in-memory broadcast; REST replay cannot reproduce it → sequence gaps.

**Fix.**
1. Track `emitErrors: Map<sessionId, Error[]>`.
2. Replace `.catch(() => {})` with `.catch(err => { accumulate; log; emit metric; rethrow for fail-fast OR write to an `events_deadletter` table with retry policy })`.
3. In `_doEmit`: before writing, check prior errors; log the count with session id.
4. Expose `getEmitErrors(sessionId)` and `clearEmitErrors(sessionId)` for ops / health-check.
5. Monitoring alert when accumulated errors per session > N.

**Ripple.** Replay endpoints may surface "incomplete history" warning to clients. Tests need to simulate `eventRepo.insert()` throws and assert error is not silent.

**Effort:** M. **Deps:** works with or without 1.1 transactions. **Acceptance:** unit test — repo throws; error metric increments; log emitted; queued events after failure still flush in order.

### [CRITICAL] EventBus subscriber exception swallow — `events/EventBus.ts:74-86`

**Issue.** Subscriber errors are caught and logged but not tracked or attributable. An errant SSE broadcast handler masks systemic issues.

**Fix.**
1. Wrap each `emitter.emit(channel)` call in an isolated try/catch per channel; accumulate into `subscriberFailures: Map<sessionId, Array<{handler, error, timestamp}>>`.
2. Emit OTel counter `subscriber_errors_total{session_id, channel}`.
3. Expose `getSubscriberFailures(sessionId)` for ops.

**Effort:** S. **Deps:** none. **Acceptance:** unit test — register a throwing listener; emit; other listeners still fire; failure is tracked.

### [CRITICAL] SessionAllocator memory-only map — `services/SessionAllocator.ts:26`

**Issue.** `allocations: Map<runId, RunAllocation>` is in-process memory only. Crash → orphaned Copilot SDK sessions; duplicate allocation on recovery.

**Fix.**
1. Add two tables (schema + migration):
   ```
   session_allocations(id PK, workflow_run_id FK, mode, shared_session_id?, created_at)
   stage_session_maps(id PK, allocation_id FK, stage_run_id FK, session_id FK)
   ```
2. New `ISessionAllocationRepository` port; Drizzle impl in `packages/db`.
3. `SessionAllocator.allocateSession` persists allocation + stage-session map on creation.
4. `SessionAllocator.releaseSession` deletes stage-session row; when refCount=0 on single mode also delete the allocation row.
5. `StartupRecoveryService`: on boot, load all allocations + stage-session maps into the in-memory cache via `setAllocation(runId, allocation)` (new public setter).

**Ripple.** Schema migration (Phase 1). Recovery service must call allocator re-hydration before marking runs paused. Tests for crash/restart scenarios.

**Effort:** M. **Deps:** 0.4 transactions (recommended for write atomicity) + 1.1 migrations. **Acceptance:** integration — run with single-mode stages → kill server → restart → verify same shared session ID, no duplicate allocation.

### [CRITICAL] StageExecutionService unsafe cast — `StageExecutionService.ts:352`

**Issue.** `{kind: event.kind, data: enrichedData} as unknown as AgentEvent` bypasses the discriminated union. Enriched data with wrong shape is not caught.

**Fix.**
1. Add helper `createEnrichedAgentEvent(kind, data, enrichment)` in `packages/shared/src/types/AgentEvent.ts` that runtime-validates the shape and returns a typed event.
2. Optionally (preferred): extend every union member with optional enrichment fields (`stageRunId?`, `workflowRunId?`, `__isInternalTurn?`) so the cast is not needed.
3. Replace call site at line 352 with the helper.

**Effort:** M. **Deps:** coordinates with 2.17 EVENT_REGISTRY. **Acceptance:** TS strict passes without `as unknown as`; unit test — runtime rejection of bad shape.

### [CRITICAL] Orchestrator upload accumulation — `WorkflowOrchestrator.ts:137-162`

**Issue.** `copyWorkflowUploadsToRun()` full-copies every file from `workflows/{defId}/uploads/` into every run dir. 100 MB upload × 1000 runs = 100 GB.

**Fix.**
1. Replace `fs.copyFile` with `fs.link` (hardlink, same filesystem) → fall back to `fs.symlink` → fall back to `fs.copyFile` (last resort).
2. Document: run-level uploads are read-only views of workflow-level; stage writes go to `workspaceDir` / `artifactsDir` not into the linked dir.
3. GC on run delete: remove run dir but not workflow-level uploads.

**Effort:** M. **Deps:** none. **Acceptance:** integration — upload 10 MB file to workflow; create 10 runs; du -sh total ≤ 12 MB.

### [CRITICAL] Silent sandbox fallback — `SandboxLifecycleManager.ts:88-89`

**Issue.** When Docker unavailable, silently falls back to `HostProcessSandboxProvider` with an INFO log. Users get zero isolation.

**Fix.**
1. Add `requireDocker: boolean` to `SandboxLifecycleConfig`.
2. In `createForRun`: if `!dockerAvailable && requireDocker` → throw. If `!dockerAvailable && !requireDocker` → **WARN** log every run (not INFO).
3. In composition root, require explicit opt-in: fail boot when `!dockerAvailable && !process.env.GENERATORAI_ALLOW_HOST_SANDBOX`.
4. Startup banner clearly states sandbox mode.

**Effort:** S. **Deps:** none. **Acceptance:** `GENERATORAI_ALLOW_HOST_SANDBOX unset && !dockerAvailable` → server refuses to start.

### [CRITICAL] Startup recovery orphans — `StartupRecoveryService.ts:44-82, 99-109`

**Issue.** Recovery marks running/queued as paused but never cleans up Docker containers, polling intervals, or in-flight SDK calls spawned by the previous process.

**Fix.**
1. Inject `SandboxLifecycleManager` + new `IPollingManager` + `ISessionAllocationRepository` into `StartupRecoveryService`.
2. In `recover()`:
   - Call `sandboxManager.cleanupOrphans()` — list all Docker containers matching `genai-run-*`, check each against `workflow_runs.status`, destroy if terminal/paused.
   - Call `pollingManager.clearAllPollings()` — any polling registered at boot time is stale.
   - Re-hydrate `SessionAllocator` from DB (uses 1.6 persistence).
3. `recoverV2Runs` enumerates non-terminal runs and either tries to resume (stages in `queued`) or marks `failed` with an explicit error tag.

**Effort:** M. **Deps:** 1.6 SessionAllocator persistence; IPollingManager interface must exist. **Acceptance:** kill server mid-run → restart → no orphaned containers; polling map empty; runs either resume or marked failed.

---

## High

### [HIGH] DAG condition evaluator — `domain/dag/ConditionEvaluator.ts`

**Issue.** Supports only binary `== != < > <= >=`. No AND/OR/NOT, no multi-parent expressions.

**Fix.** Extend evaluator with precedence: NOT > (binary comparison) > OR > AND. Support `(…)` parens. Extend `resolveValue` for `stages[i].status` and dotted paths. Keep backward compatibility for single comparisons.

**Effort:** M. **Acceptance:** `status == 'completed' AND retryCount < 3` / `NOT (status == 'failed')` / `status == 'completed' OR status == 'skipped'` all evaluate.

### [HIGH] DAG `withLock` swallows — `DAGScheduler.ts:17-23`

**Issue.** `.catch(() => {})` hides scheduling errors; next `withLock` call runs on stale state.

**Fix.** Rewrite `withLock` as a queue-based pattern (per-run FIFO) with explicit error propagation: each queued operation rejects its own promise on failure but doesn't break the queue. Log every caught error with run id.

**Effort:** M. **Acceptance:** unit test — repo throws inside `getReadyStages`; promise rejects; subsequent locked op runs normally.

### [HIGH] Session `paused` + chat enabled — `SessionStateMachine.ts:66-68`

**Issue.** `isChatEnabled` returns true for `paused` — inconsistent UX.

**Fix.** `isChatEnabled` → only `completed` | `cancelled`. Introduce separate `canChatWhilePaused` for explicit opt-in UI flows.

**Effort:** S.

### [HIGH] WorkflowRun no retry from failed — `WorkflowRunStateMachine.ts:40-41`

**Issue.** Only `sys:recover` transitions `failed → created`; no user-driven retry.

**Fix.** Add `user:retry` transition to `failed` state. Add `WorkflowRunService.retryRun(runId)` that resets failed `stage_runs` to pending, nulls times/retry, transitions run to `created`. Expose `POST /workflow-runs/:id/retry`.

**Effort:** M.

### [HIGH] Max listeners hardcoded 1000 — `EventBus.ts:39-40`

**Fix.** Make configurable via `EventBusConfig.maxListeners` with default 10 000. Expose `getStats()` for ops. Warn at 80 % threshold via OTel gauge.

**Effort:** S.

### [HIGH] Global handlers memory leak — `EventBus.ts:21-22`

**Fix.** Replace flat `Set` with `globalHandlerScopes: Map<scopeId, Set<handler>>`. `subscribeGlobal(handler, scopeId)` returns an unsubscribe; ties request-scoped subscriptions to response lifecycle via middleware hook. OTel gauge for active scope count.

**Effort:** M. **Ripple.** Server request middleware must associate scope with response `'finish'` event.

### [HIGH] SessionAllocator ref-count off-by-one — `SessionAllocator.ts:71-84`

**Fix.** After decrement, if `sharedRefCount === 0 && sharedSessionId`: call `destroySession(sharedSessionId)` and clear `sharedSessionId`. Delete allocation row in DB (coordinates with 1.6).

**Effort:** S. **Acceptance:** allocate single-mode for 2 stages; release both; verify SDK `destroyConversation` called exactly once.

### [HIGH] Stage retry race — `StageExecutionService.ts:618-619` + `StageRunRepository`

**Fix.** Add `version` column to `stage_runs`. `IStageRunRepository.incrementRetryCount(id, expectedVersion)` uses `UPDATE … WHERE id=? AND version=?` with version bump; `result.changes === 0` → throw version-mismatch. Caller logs and bails (another process is retrying).

**Effort:** M. **Deps:** 1.1 migrations. **Acceptance:** concurrent increment attempts; only one succeeds.

### [HIGH] Path traversal in workspace writes — `StageExecutionService.ts:171-179`

**Fix.** Resolve symlinks: `fs.realpath(baseDir)` + `fs.realpath(target)` (fall back to walking to the deepest existing ancestor if target doesn't exist yet). Compare `relative(realBase, realTarget)`; reject if starts with `..` or is absolute. Additionally, `lstat` every write target and refuse if it's a symbolic link. Sandbox-level: mount workspace with `nofollow` where supported.

**Effort:** M. **Acceptance:** symlink `workspace/x -> /etc/passwd` → write attempt throws.

### [HIGH] Variable interpolation too simple — `StageExecutionService.ts:485-486`

**Fix.** Move to `packages/shared/src/utils/interpolate.ts`. Support `{{user.name}}` (dotted). Iterate with recursion depth cap (10) and max iterations cap (100). Keep `{{var}}` backward-compatible.

**Effort:** M.

### [HIGH] Preprocessor shell-injection risk — `WorkflowPreprocessor.ts:414`

**Fix.** Enforce `spawn(cmd, args, { shell: false })` in `SandboxedScriptRunner`. Allowlist binaries per `AppConfig.security.allowedCommands`. Reject args containing `;&|<>$` ` newline. Document that template scripts must not `eval` env vars. Add a lint pass over template scripts for `eval`.

**Effort:** M.

### [HIGH] ResultValidator `custom_script` silent pass — `ResultValidator.ts:127-132`

**Fix.** Inject `IScriptRunner` into `ResultValidator`. Implement `evaluateCustomScript(script, output, scriptRunner, workspaceDir)` via sandboxed `sh -c` with `STAGE_OUTPUT` env and 30 s timeout. Update `validateStageResult` signature to async and accept context object. Log-and-fail-closed when scriptRunner unavailable (not pass).

**Effort:** M.

### [HIGH] Hook timeouts don't cancel — `HookExecutor.ts:119-122`

**Fix.** Create `AbortController` per hook. Pass `signal` to script runner (`proc.kill('SIGTERM')` on abort, `SIGKILL` 3 s later) and to HTTP client (`fetch(..., {signal})`). `clearTimeout` + `abort()` in `finally`. Update `IScriptRunner.run` and `IHttpClient.request` signatures to accept `signal`.

**Effort:** M. **Ripple.** Feeds 1.24 AbortSignal-everywhere initiative.

### [HIGH] Hook retry backoff unbounded — `HookExecutor.ts:73-91`

**Fix.** `backoffMs = Math.min(1000 * 2^attempt, MAX_BACKOFF_MS)` where `MAX_BACKOFF_MS = 60 000` (configurable).

**Effort:** S.

### [HIGH] `pre_tool_use` abort semantics — `HookInterceptor.ts:63-72`

**Fix.**
1. `pendingToolIds: Set<string>` tracks denied tool callIds.
2. When denial fires → add callId to set + emit `hook.skipped` + do not forward event.
3. When later `copilot.tool_complete` / `tool_result` arrives with that callId → suppress (already denied).
4. Document that SDK may still execute the underlying tool in parallel; denial is UI-side — true cancellation requires SDK-level abort (track 2.25 / 1.24).

**Effort:** M.

### [HIGH] Function hooks unimplemented — `HookExecutor.ts:108-114`

**Fix.** Either remove the `function` case (preferred — it's a dynamic-eval vector) or implement it via sandboxed subprocess (load a Node module from the workspace path, validate path stays within workspace, execute with a context arg, reject on non-true return).

**Effort:** S.

### [HIGH] Cron re-entrancy — `AutomationService.ts:66-69`

**Fix.** Replace in-memory cron jobs with DB-backed lease pattern:
1. Schema: `automations.locked_until`, `automations.locked_by_process` columns.
2. Lease loop: every minute, `SELECT id FROM automations WHERE enabled=1 AND next_run_at <= now AND (locked_until IS NULL OR locked_until < now)`; for each, `UPDATE … SET locked_until=now+30s, locked_by_process=? WHERE id=? AND locked_until = <what we read>` (optimistic). If `changes=1`, we own it; run; update `last_run_at/next_run_at`; clear lock.
3. Gate via `ENABLE_IN_PROCESS_CRON=true`; default disabled for production; recommend external scheduler pod.

**Effort:** L. **Deps:** 1.1 migrations.

### [HIGH] Webhook token rotation — `AutomationService.ts:96-98`

**Fix.** `rotateWebhookToken(automationId)` generates new 32-byte hex, writes to row, emits `automation.webhook_token_rotated` event. New route `POST /automations/:id/rotate-webhook-token`. Add `webhookTokenRotatedAt` column.

**Effort:** S.

### [HIGH] Data-source script output unvalidated — `DataSourceResolver.ts:134-180`

**Fix.** Accept optional `config.schema: { columns: Array<{name, type, required}> }`. After `parseOutput`, loop rows × columns; collect errors; throw on any failure. Covers JSON array, CSV, JSONL.

**Effort:** M.

### [HIGH] Automation cancellation soft-flag — `AutomationService.ts:68-69`

**Fix.** Create `AbortController` per execution; store in `executionAbortControllers: Map<executionId, AbortController>`. Propagate `signal` through: data-source resolution (scriptRunner + httpClient), `executeWorkflowForItem`, and ultimately to `sendPromptAndWait`. `cancelExecution` aborts + keeps the soft flag for status reporting.

**Effort:** M. **Deps:** 1.24 AbortSignal pipeline.

### [HIGH] Sandbox creation sleeps event loop — `SandboxLifecycleManager.ts:29-31`

**Fix.** Replace `await sleep(500)` with a queue:
- `creationQueue: Array<{resolve, reject, create}>`
- Single-consumer worker drains queue; `setTimeout(r, MIN_CREATION_INTERVAL_MS)` *between* creations, not blocking the caller.
- Bound queue size (`MAX_QUEUE_SIZE = 1000`) with explicit rejection when full.

**Effort:** M. **Acceptance:** 100 concurrent calls → server responsive; all complete in ~50 s ordered.

### [HIGH] Sandbox destroy orphans — `SandboxLifecycleManager.ts:140-151`

**Fix.** Track `orphanedContainers: Map<name, {createdAt, errorCount}>` on destroy failure. Emit `sandbox.orphaned` event. Periodic cleanup every 5 min retries `provider.remove` for orphans >60 min old. Expose `getOrphanedContainers()` for `/health`.

**Effort:** M.

### [HIGH] Recovery orphans polling intervals — `StartupRecoveryService.ts:44-82`

**Fix.** Introduce `IPollingManager` port with `startPolling(sessionId, fn, intervalMs)`, `clearPollingForSession(sessionId)`, `getAllActivePollings()`. Inject into `StartupRecoveryService.recover()`; clear any polling referenced by a session being marked paused. Replace any ad-hoc `setInterval` calls in `StageExecutionService` / `WorkflowRunService` with the manager.

**Effort:** M.

---

## Cross-cutting initiative — 1.24 AbortSignal propagation

Multiple High findings above (hook timeouts, stage timeouts, automation cancel, copilot `sendPromptAndWait`) are instances of the same root cause: timeouts reject the wait but don't cancel the work. Do this once, properly:

1. `ICopilotPort.sendPromptAndWait(…, signal?: AbortSignal)` — on abort, call `session.abort()`.
2. `IScriptRunner.run(…, { signal? })` — on abort, `proc.kill('SIGTERM')` then `SIGKILL` after 3 s.
3. `IHttpClient.request({ signal? })` — already supported by native fetch.
4. `HookExecutor.executeHook` → wraps abort + timeout; cancels on both.
5. `StageExecutionService` → wraps stage-level timeout with same pattern.
6. `AutomationService.executeAutomation` → creates root abort controller; passes through all nested calls.

**Effort:** L. **Ripple.** Every adapter + caller. Land in Phase 1 before 2.6 / 2.9 / 2.25.
