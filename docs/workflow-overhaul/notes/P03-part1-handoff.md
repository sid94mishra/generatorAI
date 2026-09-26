# Handoff from P03 part 1 (WP-3.1–3.4) to parts 2 and 3

**Commits:** dd00852 (v57), 7d4ecb4 (errors), 5d7b3e9 (`decide`), 527f41c (RunStore/CAS), 3c87f58 (gate).

## v57 and the v1 mapping (a deviation that part 3 removes)
The v1 engine runs on the v57 tables through a mapping in its repositories:
- `queued` is stored as `ready`;
- `retryCount` is stored in `current_attempt`;
- steps go in `usage.v1Steps`;
- the permission mode goes in `run_overrides`;
- the allocator state goes in `run_sessions`.

Delete all of this at the cutover (WP-3.7).

## RunStore (`@generatorai/db`)
- `new RunStore(db)`.
- `loadRunState(runId) → RunState | null` does one sync read. Instances carry `attemptStatus`, `failedAttempts` and `startedAt`. `unattended` means the trigger kind is not user, chat or fork.
- `apply(runId, ownerEpoch, decisions, {now, random?, message?, stateHash?})`:
  - runs one IMMEDIATE sync transaction, fenced by `owner_epoch`;
  - applies decisions in order, and a lost CAS aborts the whole batch;
  - draws timer jitter here;
  - writes the outbox `run_seq` and the journal row.
  - It returns `{ok: true, effects, timers, outbox, journalSeq}` or `{ok: false, reason: 'fenced' | 'conflict', detail}`.
  - The effects to dispatch after commit are `launch`, `abort`, `deliver_input`, `prepare`, `finalize` and `reject`.
- **CAS on the stage and workflow run repositories:**
  - `transition(id, from[], to, {expectedVersion?, patch?, lease?, runId?, now?})` returns `{ok, row}` or `{ok: false, current}`.
  - An illegal pair throws `IllegalTransitionError` in dev and test.
  - `starting`/`running` require `lease: {owner, ttlMs}`, which stamps the lease, heartbeat and progress; containers pass `'none'`. Leaving the attempt states clears the lease.
  - Also: `renewLease`, `markProgress`, `getInstance`, `claimOwnership(runId, ownerId, ttlMs) → epoch | null`, `getRunRow`.
- **Repositories (all synchronous):**
  - `StageAttemptRepository`: create, settle (a CAS that only succeeds while the attempt is running), update, incrementRepair, addUsage, get, list, listLiveByRun.
  - `RunSessionRepository`: upsert/rebind, get, release, listActive.
  - `WorkflowTimerRepository`: arm (replaces the live timer with the same run, instance and kind), cancel, fire (CAS once), listLive, listDue.
  - `WorkflowOutboxRepository`: listPending, markDispatched (idempotent).
  - `SchedulerJournalRepository`: append, list.
- Ports: `core/src/domain/ports/IRunStore.ts`.

## decide() (`@generatorai/core`, `domain/scheduler/`)
- `compile(graph) → CompiledWorkflow` applies the defaults once and pre-parses guards and conditions.
- `decide(compiled, state, msg, now) → Decision[]` is pure, with UUIDv5 ids.
- `applyDecisions` / `stateAfter` are for in-memory tests.
- **Messages:**
  - `start`, `prepared`, `prepare_failed`;
  - `attempt_settled {succeeded | failed(error, safeReplay?) | aborted}`;
  - `usage_tick`, `timer_fired {kind, stageRunId}`, `lease_expired {owner, safeReplay?}`;
  - `command {RunCommand}`, `finalized {ok, error?}`, `tick`.
- **Executor contract:**
  - The executor owns `ready → starting → running → validating`, plus the repair and awaiting-input moves. Success is accepted only from `validating`.
  - A `ready` instance whose attempt is `running` counts as admitted.
  - The next attempt's mode rides in `status_reason` (`retry:resume` | `retry:restart` | `resume`).
  - `maxAttempts` counts only failed and interrupted attempts.
  - The `queue_timeout` timer is armed at admission; the executor may cancel it when it claims the instance.
  - After a restart, recovery marks lost attempts `interrupted`. `approve` then creates a resume attempt carrying the verdict.
  - Terminal events follow RV-5: `workflow_run.completed | failed | cancelled`, with `data.workflowRunId`.

## Errors
- `classifyStageError(err) → {class, code, message, retryAfterMs?, details?, unclassified?}`. It never throws.
- `StageError(code, msg)`; also `classified()`, `errorClassOf()`, `codeForHttpStatus()`.
- The providers package has `HarnessError` and `toHarnessError(provider, raw)`. **The StageExecutor must apply `toHarnessError` at the harness boundary.**

## Deferred
- The fast-check model test over the G5 §7.2 invariants.
- The §7.3 replay fixtures. They need journal rows, so they come with the actor (part 2).
