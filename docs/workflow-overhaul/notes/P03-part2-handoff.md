# Handoff from P03 part 2 (WP-3.5/3.6) to part 3 (WP-3.7–3.9, the cutover)

**Commits:** 9732b79 (WP-3.5), 08c1206 (WP-3.6). Everything below is additive: the server still runs the v1 engine, and the v2 engine runs only in tests and the testkit (`createV2Adapter`).

## What exists

### `@generatorai/core`, `services/engine/`
- **`StageExecutor`** (WP-3.5): `start(LaunchRequest, AdmissionTicket?)`, `abort(stageRunId, attemptNo, reason)`, `deliverInput(stageRunId, attemptNo, verdict)`, `hasFrame`, `shutdown()`, `kill()`. Deps are listed in `StageExecutorDeps`.
  - **State ownership (the part-1 contract, kept):**
    - The executor owns: the claim `ready → starting` (lease owner `bootId:stageRunId:attemptNo`), `starting → running`, `running → validating`, and `validating → running` (a repair, or the way into the approval gate).
    - For a human gate with a live frame it owns `running → awaiting_input → running`.
    - Everything else is the actor's.
    - It reports exactly one `attempt_settled` per claimed attempt and never writes a terminal state.
  - **Turn journal:** `a{epoch}/prompt/{i}`, `a{epoch}/repair/{n}`, `a{epoch}/summary`, `a{epoch}/review/{round}/{digest}`.
    - The epoch is the latest non-`resume` attempt (`journalEpoch`), so a resume replays settled turns and a restart starts clean.
    - The session key follows the same epoch: `instance:<path>@<epoch>`, or `group:<g>`.
  - **Output contract:** `OutputExtractor.ts` covers the strategies (native, then `submit_output`, then the final JSON block), ajv, the rules, and the repair message. The rules evaluator is shared with v1 through `outputRules.ts`.
- **`RunActor`:** a serial mailbox. It runs `load → decide → RunStore.apply(epoch) → dispatch`. A conflict is retried 3 times; when fenced, the actor retires. `onDecide` is a tap used for the replay fixtures.
- **`RunSupervisor`** (WP-3.6) takes the lock, owns the actors, and runs recovery. Its API:
  - `start()`, `stop({releaseLock})`;
  - `startRun(runId)`, `command(runId, RunCommand) → CommandResult`;
  - `post(runId, msg)`, `recover()`, `idle()`, `hostedRuns`.
  - It builds and exposes `executor`, `timers` (`TimerService`), `outbox` (`OutboxDispatcher`), `effects` (`EffectsDispatcher`), `reaper` (`LeaseReaper`) and `lifecycle` (`DefaultRunLifecycle`).
  - `start()` throws `EngineLockedError` when another live process holds `engine_lock`.
- **Ports:** `domain/ports/IEngineStore.ts` (`EngineStores`: attempts, run sessions, timers, outbox, journal, the turn journal, the lock and scans).
  - `IWorkflowRunCas.claimOwnership(..., {force})` and `renewOwnership` were added.
  - `SendPromptOptions.outputSchema` and `ConversationResponse.structuredOutput` carry native structured output; claude-agent and Codex implement it.
  - `StageGatePort` takes a `park` function; the v2 wait takes precedence over `hitl`.

### `@generatorai/db`
- `createEngineStores(db)` builds every port above over one database.
- New: `StageTurnJournal` (`registers` rows `turn/<opId>`, scope `stage_run`), `EngineLockRepository`, `EngineQueries`.
- `chat_messages.turn_role` is now mapped both ways (`ChatMessage.turnRole`).

### Testkit
- `createV2Adapter` (`src/adapters/v2.ts`) is the reference wiring, mirroring what `createCoreServices` should do.
- `v2Adapter({onDecide, timing})` exposes the fixture tap and the timing knobs.
- Scripted turns can `submit` to `submit_output`.
- The v2 scenarios live in `__tests__/v2/`:
  - T1 fan-out/fan-in;
  - T3 failure edges, retry and precedence;
  - T5 approve/reject/changes/pause/cancel;
  - T8 crash and restart, plus the lock refusal;
  - the output contract (repair, restart on exhaustion, rules);
  - the replay fixtures.

## Wiring `RunSupervisor` into `createCoreServices` (WP-3.7)
1. Construct it after `sessionComposer`, `runDefinitionReader`, `hookExecutor`, `workspaceManager`, `admissionController` and `eventBus` exist:
   ```ts
   const engineSupervisor = new RunSupervisor({
     stores: inputs.engineStores,              // NEW required input: createEngineStores(db) from the composition root
     runRepo: workflowRunRepo, definitions: runDefinitionReader, harness,
     composer: sessionComposer, sessionRepo, eventBus, workspaceManager,
     admission: admissionController,           // THE gate (W-66): no Semaphore
     hookExecutor, planService, scriptRunner,
     checkpoints: undefined,                   // late-wired, like SES.setWorkspaceCheckpointService today
     toHarnessError: inputs.toHarnessError,    // NEW required input: core must not import the providers package
     publish: inputs.publishEngineEvent,       // see step 3
     logger,
   });
   ```
   - `checkpoints` is late-wired today. Either make it a required input or add a setter on the supervisor and the executor. The composition root wires `workspaceCheckpointService` at `composition-root.ts:1482`.
   - `toHarnessError` becomes `(provider, raw) => toHarnessError(provider ?? 'faux', raw)`, from `@generatorai/agent-harness-providers`. See the testkit adapter for the provider-id guard.
2. **Boot** (`composition-root.ts:2350` today calls `recoveryService.recover()`):
   ```ts
   try { await engineSupervisor.start(); }
   catch (e) { if (e instanceof EngineLockedError) log and run without an engine; else throw; }
   ```
   `start()` takes the lock and runs `recover()`. On shutdown (`composition-root.ts:2486`), call `await engineSupervisor.stop()`. The desktop app and the SDK (`packages/sdk/src/GeneratorAI.ts`) boot through the same path, so they share the lock.
3. **The outbox publisher (G5 §5.8, B-21):**
   - The publisher must `await eventBus.emitGlobal(e)`, which the RV-5 terminal-event listeners (`WorkflowOrchestrator`, `AutomationService.waitForRunCompletion`) read.
   - It must also `await streamBroker.publish('run', e.data.workflowRunId, …)`, so the run scope is not a fire-and-forget copy.
   - The composition-root bridge that republishes global events carrying `workflowRunId` must then skip the engine's kinds, or they arrive twice.
4. **`WorkflowRunService` becomes a facade:**
   - `create` stays (P04 replaces it). It still inserts pending instances; `decide()` adopts them by stage key. Better: insert none and let `decide()` create them with deterministic ids.
   - `start` → `supervisor.startRun`.
   - `command` → `supervisor.command`.
   - `fork` is WP-3.8.
   - `get` and `list` stay.
   - Delete `pauseRun`/`resumeRun`/`cancelRun`/`retryRun` and the rest (below).
5. **The commands API:**
   - Add `POST /api/workflow-runs/:id/commands`, taking the body `RunCommandSchema` with `expectedVersion`. It calls `supervisor.command`, which maps `not_found → 404`, `version_conflict`/`invalid_state → 409` and `invalid_command → 400`. The testkit's `toHttp` in `adapters/v2.ts` is the mapping.
   - Delete the per-action routes in `apps/server/src/routes/workflowRuns.ts`: `/:id/pause`, `/:id/resume`, `/:id/retry` (it becomes fork), `/:id/cancel`, `/:runId/stages/:stageId/{pause,resume,retry,cancel,approve}` and `pending-interrupts` (it reads `interrupt_data` of `awaiting_input` instances instead).
   - Switch the clients: web, mobile, CLI, TUI, SDK and client-core.
6. **`HitlService`:** stage gates on v2 park in the executor (`StageGatePort.park`), not in `HitlService`. Approving a stage is `command approve`. `HitlService.interrupt/resume` for stages and `cancelWaiter` become dead once the v1 executor is deleted. Keep `HitlService` only if chats or automations still use it (check `AgentInteractionService`).

## v1 code that becomes dead at the cutover (exactly)
- **`packages/core/src/services/DAGScheduler.ts`:** the whole file. Its pure helpers already live in `domain/scheduler/` and `workflow-graph/compile.ts`. In `createCoreServices.ts:401`, `dagScheduler` goes from `CoreServices`.
- **`packages/core/src/services/WorkflowRunService.ts`:**
  - `subscribeRunEvents`/`unsubscribeRunEvents`, `processedStageRuns` and `pruneProcessedForRun`;
  - `startPolling`/`stopPolling` (the reconciler), `advanceRun`, `launchStage` and the stage semaphore parameter;
  - `onStageCompleted`/`onStageFailed`, `retryStageAfterValidation`, `failStaleStage`/`isHeartbeatStale` and `setHeartbeatPolicy` (the P01 test seam, DEVIATIONS);
  - `finalizeRun`/`completeRun`/`completeWorkspaceForRun` (now `DefaultRunLifecycle.finalize`), `pauseRun`/`resumeRun`/`cancelRun`/`redriveRun`/`retryRun`, `gatherPredecessorSummaries`, `setResultValidator`, `executeWorkflowHooks` (now `RunLifecycle`), `setupProjectWorktrees` (it moves to P04 prepare), `assertPermissionGating` (it moves to prepare or create) and `skipStageByOverride`/`findStageOverride` (stage overrides become `stage_overrides` read by `decide`, P04).
- **`packages/core/src/services/StageExecutionService.ts`:** the whole file. That covers:
  - `executeStage`, `retryStage`, `retryInSession`, `sendStageFollowUp`, `pauseStage`, `resumeStage`, `cancelStage` and `abortStage`;
  - the heartbeat methods, `setDefaultStageTimeoutMs`/`setHeartbeatIntervalMs`, `markFollowUpPending`, `DEFAULT_RETRY_POLICY`, `mayRetryInSession`, `persistStageArtifacts`/`extractCodeBlocks` and `updateScratchpad`;
  - the `agent-snapshot` artifact channel (now `stage_attempts.agent_snapshot`) and `STAGE_OUTPUT_ARTIFACT` (successors now read `stage_runs.output_*`).
  - Keep nothing unless the P03b stage-conversation API wants `recordSessionLineage`.
- **Other core services:**
  - `SessionAllocator.ts`, the whole file, plus `ISessionAllocationRepository` and `DrizzleSessionAllocationRepository`. That repository keeps `@v1-allocation`/`@v1-stage:` rows in `run_sessions`; purge those rows in the cutover commit.
  - `StartupRecoveryService.ts`, the whole file, and `CoreServices.recoveryService`.
  - `ResultValidator.ts`: the class (its rule evaluation already lives in `engine/outputRules.ts`), and `workflowRunService.setResultValidator` in the composition root and the testkit v1 adapter.
  - `Semaphore` as the stage gate: `config.maxConcurrentStages` in `CoreServicesInputs` and `createCoreServices.ts:436`.
  - `domain/state-machines/StageRunStateMachine.ts`/`WorkflowRunStateMachine.ts` and the shared v1 SM types (`packages/shared/src/types/*StateMachine.ts`), once no caller remains. The v2 tables live in `@generatorai/workflow-spec` `state/`.
- **The v57 v1 mapping in the repositories** (part-1 handoff):
  - `DrizzleStageRunRepository`: `queued↔ready`, `retryCount↔current_attempt`, `usage.v1Steps`, and every non-`transition` status writer (`updateStatus`, `batchUpdateStatus`, `interrupt`, `resumeFromInterrupt`, `claimForExecution`, `resetForRetry`, `incrementRetryCount`, `update({status})`).
  - `DrizzleWorkflowRunRepository`: the `run_overrides.permissionMode` mapping and `sessionMode`.
  - Then `check-workflow-invariants` MODE becomes `'fail'` and BASELINE 0.
- **Testkit:** `adapters/v1.ts` and `__tests__/current-engine/`. Flip each `KNOWN-BUG` assertion; the v2 equivalents already exist in `__tests__/v2/`:
  - T1: W-48, W-49;
  - T3: W-29, W-39, W-15;
  - T5: W-01, W-46, B-3;
  - T8: W-16, W-32.
  - T2 (conditions), T4 (validation), T6 (import/export) and T7 (context) still need v2 ports.
  - Make `createV2Adapter` the default of `createTestEngine`.
- **`DurableExecutionEngine`** stays (automations, awakeables). Only its stage-turn use goes, with SES. The `check-durability-invariants` rule `HAZ-1` points at `StageExecutionService.ts`: repoint it at `engine/StageExecutor.ts`, where the one dispatch site is `turn()`.

## Gaps and open items for part 3
1. **Commands route and clients:** step 5 above (DEVIATIONS).
2. **`forkRun`** is WP-3.8. The testkit's `retry-run` answers 501 on v2.
3. **A tool-permission gate lost to a restart** resumes by re-sending its interrupted turn after approval. G5 wants `paused(interrupted)`, which needs an `awaiting_input → paused` pair in `STAGE_RUN_TRANSITIONS` plus a `decide()` message (DEVIATIONS).
4. **Prepare and finalize** cover only the workspace, hooks, compensation, exit actions and session release. Clone, preprocessing, project worktrees and the PD-17 start check (`assertPermissionGating`) must reach `prepare` before v1's `startRun` is deleted (P04 owns the full lifecycle; at the cutover, at least move `setupProjectWorktrees` and `assertPermissionGating` into `DefaultRunLifecycle.prepare`). Commit/PR post-processing stays on the RV-5 terminal events until P04.
5. **Shared types:** `StageRunStatus`/`WorkflowRunStatus` in `@generatorai/shared` are the v1 enums. The v2 states (`ready`, `starting`, `validating`, `retry_wait`, `waiting`, `finalizing`, `awaiting_input`) must flow to the clients (P03b run page); the testkit v2 snapshot casts them today.
6. **Sessions** are released at run finalization only (every outcome). A per-instance release on completion is possible; the conversation is kept for the P03b stage conversation API.
7. **Native structured output** (claude-agent `outputFormat`/`structured_output`, Codex `outputSchema`) is implemented but unit-untested and live-untested; the testkit's faux declares `tool`. Codex `dynamicTools` on resume is unverified (DEVIATIONS).
8. **Deferred from part 1 and still open:** the fast-check model test over the ten G5 §7.2 invariants. `RunActor` over an in-memory `IRunStore` (see `core/__tests__/engine/runActor.test.ts` `ScriptedStore`) is the harness for it.
9. **Hop latency** (p95 under 300 ms) is not measured. In T1 the join's prompt starts within one admission hop of the last branch (no poll), but no timing assertion exists.
10. **`HitlService` stage paths and the StageGatePort `hitl` dependency** go dead with the v1 executor; delete them together.
11. **W-xx closure:** W-01, W-15, W-16, W-17, W-29, W-32, W-39, W-46, W-48, W-49 and W-66 are fixed in v2 and proven by the `__tests__/v2` scenarios named above. Record them in `TRACEABILITY.md` at the cutover, when v2 is the engine that runs.
