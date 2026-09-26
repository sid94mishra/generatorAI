# Handoff from P03 part 3 (the cutover) to P03b and P04

**Commits:** 5dad4e7 (WP-3.7 + WP-3.8), the WP-3.9 docs commit after it. The v2 engine is the only engine; `.github/docs/feature-workflow-runs.md` describes it.

## Wiring (where to change things)
- `createCoreServices` builds the engine (`CoreServices.engine`, a `RunSupervisor`) from `engineStores`, `toHarnessError` (`harnessErrorOf` from the providers package), `publishEngineEvent`, `engineOwnerLabel`, `engineTiming`, `engineOnDecide`. The composition root and the SDK call `engine.start()` after `runBootHousekeeping` and `engine.stop()` at shutdown; an `EngineLockedError` leaves the process without an engine (commands answer 503).
- Late wiring: `engine.lifecycle.setWorktrees(...)` (a `DefaultRunLifecycle`), `engine.setCheckpoints(...)`, `workflowRunService.setCheckpointService(...)`, `workflowRunService.setProviderResolver(...)` (in `createCoreServices`).
- The outbox publisher (server) publishes each engine event to `scope=run` and then `emitGlobal`, both awaited, with `data.runSeq`; `deriveStreamScopes` skips the run scope for an event carrying `runSeq`.

## Open items
1. **P03b run page.** Clients map the v2 states, but the step counter is gone (the engine emits no `stage_run.step_*`); the run page still shows v1-era wording in places. The "Re-run from this stage" button (web) forks with `rerunFrom: [instancePath]`; P05 owns re-run inside loops.
2. **Stage follow-ups.** Review threads sent to a stage (`stage_followup`) work only while the stage is parked on its completion review (they become `changes_requested`); a follow-up on a finished stage needs the P03b stage conversation API.
3. **P04 lifecycle.** Clone and preprocessing still run in `WorkflowOrchestrator` before `start` (a failure uses `WorkflowRunService.failSetup`); commit/PR post-processing still listens for the RV-5 terminal events. `createRun` is still the create path; it writes `trigger` (`user` / `automation` / `fork`), `stage_overrides`, `project_id` and the effective `permission_mode`.
4. **Not written:** the fast-check model test over the G5 §7.2 invariants; T10 (25 stages); the hop-latency p95 assertion; a live E2E (`scripts/workflow-e2e` still uses the nested definition routes P01 deleted).
5. **Native structured output** (claude-agent, Codex) and Codex `dynamicTools` on resume are still unverified live (part-2 DEVIATIONS).
6. **Testkit `TurnKind`** still lists v1 prompt kinds (`output_retry`, `validation_feedback`, `follow_up`, `context`) for its text fallback; the adapter classifies by `turn_role` first.
