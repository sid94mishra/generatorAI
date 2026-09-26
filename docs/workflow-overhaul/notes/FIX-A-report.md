# FIX-A report — batch A (engine core)

Branch `wf/overhaul`, worktree `C:/gaiwf/repo`. Commits:

- `57017b4` scheduler: decide, loops, working, spec transitions
- `04ed0f9` executor, recovery, lifecycle and journal
- `40e8560` HitlService removal (SDK)
- `130f0b2` clients (web, mobile, client-core)
- `f8b0778` extra regression tests

The deletion of `HitlService.ts` was staged early, so it landed in `57017b4`. That means `57017b4` and `04ed0f9` do not typecheck on their own. `40e8560` fixes this, and the branch head is green.

## Findings

| Finding | Disposition | Commit | Test |
|---|---|---|---|
| ENGINE-R1 | fixed. A carried verdict records `reviewRound` and `outputHash`, and `awaitVerdict` honours it only when both match. `ITurnJournal.list` lets a resume replay settled `review/<r>/…` turns in journal order. | 04ed0f9, 57017b4 | testkit `review-replay` R1 |
| ENGINE-R2 | fixed. The waiter is set before the `awaiting_input` CAS. `deliverInput` returns false only when there is no frame. The fallback posts `frame_lost`, then re-posts the approve. | 04ed0f9 | testkit R2 |
| ENGINE-R3 | fixed. `recover()` posts `attempt_settled{aborted}` for any live attempt whose instance is not ready, not in an attempt state and not awaiting input. | 04ed0f9 | testkit R3 |
| ENGINE-R4 | fixed (same change as R3). | 04ed0f9 | testkit R4 |
| ENGINE-R5 | fixed. The pause reason keeps the retry (`run_paused:retry_wait:<mode>`). Resume puts the instance back into `retry_wait` with a fresh backoff. | 57017b4 | core `retryPauseBudget` |
| ENGINE-R6 | fixed. A verdict is carried only into `resume` attempts. `admit` clears `interrupt_data`. | 57017b4 | core `retryPauseBudget` |
| ENGINE-R7 | fixed. Operator turns get the deterministic id `a<e>/operator/<n>`. Settled ones replay in journal order; an unsettled one is dropped and reported with `operator_message_dropped`. | 04ed0f9 | testkit R7 |
| ENGINE-R8 | fixed. The output is taken from the latest output-producing turn. Operator, revision and repair turns carry the native schema. | 04ed0f9 | testkit R8 |
| ENGINE-R9 | fixed. Judge verdicts are keyed by the digest of the output, and a resume reuses verdicts from earlier attempts of the same epoch. | 04ed0f9 | testkit R9 |
| ENGINE-R10 | fixed. The summary op id includes the output digest. | 04ed0f9 | testkit R10 |
| ENGINE-R11 | fixed. Web approvals send `expectedVersion`. `StageConversationService.resolveInteraction` and `routes/review.ts` bind the approve to the version they read. | 04ed0f9, 130f0b2 | none. The engine's `expectedVersion` rejection was already tested; this fix is only in the callers. |
| ENGINE-R12 | fixed. Resume re-arms the remaining wall clock and refuses to resume when it is spent. Paused time counts toward the wall clock. | 57017b4 | core `retryPauseBudget` |
| ENGINE-R13 | fixed, option (b). Recovery re-fires `retry` for any `retry_wait` instance that has no live retry timer. | 04ed0f9 | none (minor) |
| ENGINE-R14 | fixed. `RunSupervisor.command` validates skip-as-completed output against the stage's JSON schema. | 04ed0f9 | none (minor) |
| ENGINE-R15 | fixed. `HitlService` is deleted, and `ai.hitl` now goes through `WorkflowApprovalService` (with a new `cancel`). | 40e8560 | none (minor); the SDK suite passes |
| ENGINE-R16 | fixed. After a stopped output turn, the stage waits (deadline paused) for an operator message. The `SettledTurn.stopped` flag survives a replay. | 04ed0f9 | none (minor) |
| ENGINE-R17 | regression tests only, as instructed. The model test, T10 and the E2E port were not written. | — | — |
| LOOP-R1 | fixed. `toolCalls` is added in both `addUsage` functions and in `usageView`. | 57017b4 | core `loops` R1 |
| LOOP-R2 | fixed. `abortScope` pushes `abort` for a claimed attempt. | 57017b4 | core `loops` R2 |
| LOOP-R3 | fixed. The wrap-up stops only when it goes over its allowance. A wrap-up that fails into a pause is cancelled, and `onLimit` then applies. | 57017b4 | core `loops` R3 |
| LOOP-R4 | fixed. With zero mounts (tree hashes `{}`), accepting an iteration skips the restore; this also applies to `accept_iteration`. | 57017b4 | core `loops` R4 |
| LOOP-R5 | fixed. Check stages compile with `onExhausted: 'fail'`. | 57017b4 | core `loops` R5 |
| LOOP-R7 | fixed. `workspaceChanged` is null when there are no mounts. | 57017b4 | core `loops` R4 |
| LOOP-R8 | fixed. The wrap-up's compaction generation is based on `loopState.k`. | 04ed0f9 | none (minor) |
| LOOP-R12 | not fixed (skipped per the coordinator: a minor that needs more than a small edit). `SandboxedScriptRunner` needs a keep-head mode for `parseJson`. | — | — |
| LOOP-R13 | fixed. `accept_last` and `accept` take the last completed iteration, and complete with it without a restore. | 57017b4 | core `loops` R13 |
| LOOP-R14 | fixed. The web and mobile loop decision cards send the instance version. | 130f0b2 | none (minor) |
| LOOP-R6 | regression tests for R1–R5 added (core `loops.test.ts`). | 57017b4 | yes |
| CONVINV-R2 | fixed. `prepare` checks for a cancel before each phase, and `finalize` waits for the prepare in flight. | 04ed0f9 | none (time) |
| CONVINV-R3 | fixed. `prepare_failed` goes to `finalizing{failed}`, then to `failed(setup:<phase>)`. | 57017b4 | core `decide.test` |
| CONVINV-R4 | fixed. `amend` refuses an instance inside a live container, and any frame that shares the session key, including unbound frames in the same session group. | 04ed0f9 | none (time) |
| CONVINV-R18 | fixed. `input_received` is emitted after `backToRunning`, with the version. Every outbox event carries `runVersion`, and the web run store keeps it and drops stale statuses and polls. | 57017b4, 04ed0f9, 130f0b2 | core `decide.test` (runVersion) |
| CONVINV-R20 | fixed. `resumed` maps to the status the engine reports and `retrying` maps to `ready`. The composer is shown only when `kind === 'agent'`. The permission mode is read from the run. `clearRun` runs when `runId` changes. | 130f0b2 | none (minor) |
| ECON-R5 | fixed together with ENGINE-R12. `raise_budget` does not resume while the wall clock is spent. | 57017b4 | core `retryPauseBudget` |
| MAPWAIT-R3 | fixed. The callback filter also compares `scopeIndexOf`. | 04ed0f9 | core `engine/callbackScope` |
| MAPWAIT-R8 | fixed. `recover()` re-takes the shared leases of every running map before any relaunch, and never awaits a lease. | 04ed0f9 | none (time) |
| MAPWAIT-R9 | fixed. The supervisor drops a `queue_timeout` while the launch is waiting for a worktree lease (`EffectsDispatcher.waitingOnLease`). | 04ed0f9 | none (minor) |
| MAPWAIT-R14 | fixed (duplicate of ENGINE-R15). | 40e8560 | — |

## Deviations

- **Wall-clock budget (ENGINE-R12, ECON-R5).** Paused time counts toward the run's wall clock: it bounds how long the run takes. A `resume` whose wall clock is already spent is rejected with `invalid_state`, and the run stays paused.
- **Pause during a retry (ENGINE-R5).** A new spec transition `paused → retry_wait` (`user:resume` / `run:resume`) was added. After a pause the full backoff for the failure count is re-armed, not the remaining part of it. A `retryAfterMs` minimum from before the pause is not kept.
- **Setup failure (CONVINV-R3).** A new spec transition `starting → finalizing` (`sys:setup_error`) was added. `workflow_run.failed` and `workflow_run.finalized` are now emitted by the `finalized` message, not by `prepare_failed`.
- **Check stages (LOOP-R5).** A check now defaults to `onExhausted: 'fail'` everywhere, including outside loops. An exhausted failure of a top-level check therefore fails (and routes) instead of pausing.
- **Accepting after a budget abort (LOOP-R13).** `accept_last` and `accept` after a budget abort complete with the last completed iteration without restoring its checkpoint. The workspace keeps whatever the aborted iteration left.
- **Interrupted turns on resume (ENGINE-R1, R7).** An interrupted (intent-only) revision or operator turn found on resume is discarded rather than re-sent, because its text is not journalled. A revision round asks the reviewer again; a lost operator message emits `operator_message_dropped`.
- **Stopped final answer (ENGINE-R16).** A stopped final answer makes the stage wait for an operator message (chat parity). It does not pause the stage.
- **SDK hitl API (ENGINE-R15).** `ai.hitl.pending()` now returns `PendingDecision[]` instead of `StageRun[]`. The `StageVerdict` type is replaced by `ApprovalVerdictInput`, and the SDK re-exports `WorkflowApprovalService` instead of `HitlService`.

## Gates in this worktree

- `pnpm turbo typecheck`: 51/51.
- `pnpm lint`: 0 errors.
- `check-no-legacy`: 0 hits.
- Tests:
  - core: 1692 passed and 9 skipped, plus the new callbackScope test;
  - workflow-testkit: 54 passed, then review-replay grew to 8 tests;
  - db: 155;
  - workflow-spec: 364;
  - sdk: 8;
  - client-core: 293.
- The full turbo suite was not run, as the coordinator asked.

## Merge-risk files (shared with other batches)

- `packages/core/src/domain/scheduler/decide.ts`, `working.ts`, `loops.ts`, `scope.ts`, `types.ts`
- `packages/core/src/services/engine/StageExecutor.ts`: `parkFrame` was restructured; the `frame.ticket?.pause()` line is unchanged
- `packages/core/src/services/engine/RunSupervisor.ts`: recover and the TimerService post wrapper
- `packages/core/src/services/engine/EffectsDispatcher.ts`: the `deliver_input` fallback and the `leaseWaits` launch path (batch B's admission area)
- `packages/core/src/services/engine/RunLifecycle.ts`
- `packages/core/src/services/engine/StageConversationService.ts`
- `packages/core/src/domain/workflow-graph/compile.ts`
- `packages/workflow-spec/src/state/stageRun.ts` and `workflowRun.ts` (batch C's spec area): the two transition rows
- `packages/db/src/repositories/EngineStores.ts` (`list`) and `EngineRepositories.ts` (`addUsage`)
- `apps/server/src/routes/review.ts` and `composition-root.ts`
- `packages/core/src/bootstrap/createCoreServices.ts`, `packages/core/src/services/index.ts`
- `packages/sdk/src/{index,internal}.ts`, `packages/sdk/src/facades/{index,HitlFacade}.ts`
- `apps/web/src/pages/WorkflowRunPage.tsx`: approve handlers, composer, permission, clearRun
- `apps/web/src/stores/workflowRunStore.ts`
- `packages/client-core/src/stream/eventRouter.ts` and `packages/client-core/src/api/client.ts`
- Regenerated fixtures: `packages/core/__tests__/fixtures/scheduler/*.jsonl` (`runVersion` on events). Regenerate them after the merge if another batch changes `decide`.
