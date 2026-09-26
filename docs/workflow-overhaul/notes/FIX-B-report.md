# Fix batch B report: maps, leases, admission, callbacks, automations

Branch `wf/fix-fb`, worktree `C:/gaiwf/fb`. Findings: `C:/gaiwf/review-probes/findings/MAPWAIT.md` and `ECON.md`.

## MAPWAIT

| id | disposition | commit | test |
|---|---|---|---|
| R1 | fixed. An exclusive merge coexists with another map's shared lease (the merge is 3-way against the mount as it is now) and skips the per-key FIFO, so writers queued ahead of it no longer deadlock it. Leases, snapshots, forks and merges key on the mounts the map forks from: a nested map uses its enclosing item's mounts. | 6685736 | `core/__tests__/engine/worktreeLeases.test.ts` (aee12f7) |
| R2 | fixed. Branches carry the map instance id (`generatorai/<run8>-<stage>-<map8>-<i>`). `map_release` frees the item worktrees nobody reads (`itemKept`); a winner's settle pushes `map_release`; snapshot refs are deleted when no merge can come. The run's finalize (`releaseRunMapItems`) frees the kept items and every snapshot ref of the run. | 6685736 | `worktreeLeases.test.ts` (`itemKept`, winner release; aee12f7) |
| R4 | fixed. The default delivery key is `callback:<instanceId>:<sha256(data)>`. | 4b7ceab, f32e59c | `apps/server/src/__tests__/workflowCallbacks.test.ts` |
| R5 | fixed. An `inherit` child gets the enclosing item's workspace (SubworkflowEffects) and codebases (prepare `worktrees` reads the parent stage's placement). The stage holds the `write` lease of those mounts for the child's whole run; it is released when the child settles or fails to start, and re-taken on recovery. | 6685736 | `core/__tests__/engine/inheritAndToolWaits.test.ts` (f32e59c) |
| R6 | fixed. `WorktreeLeases.release` withdraws the owner's queued requests (they reject). `onMapSnapshotTaken` for a map that is no longer snapshotting pushes `map_release`. Queued writer launches are withdrawn by the dispatcher's abort. | 6685736 | `worktreeLeases.test.ts` (lease and decide level) |
| R7 | fixed. `map_release` releases only the shared lease. A merge checks for a cancel before it applies, and rolls back if the cancel lands while it applies (`code: cancelled`). | 6685736 | `worktreeLeases.test.ts` |
| R10 | fixed for batch B's findings: regressions for R1, R2, R4, R5, R6 and R7 (R3 and R8 belong to batch A). | aee12f7, f32e59c | see rows above |
| R11 | fixed. The validator lets a stage beside an event wait read that wait's `callbackUrl` and `callbackToken` (nullable; nothing else of a stage that has not run). The CI-gated deploy template gains `notify_ci` (after `push`, beside `wait_ci`), which hands CI the URL. Templates and the workflow skill are regenerated. | c572c17, 18149d1 | none (minor) |
| R12 | partly fixed. When an event is delivered while its wait already waits, `output.by` is the sender (`deliver_event` actor, `callback` for the callback route). An event stored before its wait armed still records `by: null`; recording it needs a sender column in `workflow_run_events`. Not added, because no migration goes in now; do it with the R18 migration. | 6685736 | none (minor) |
| R13 | fixed. Callback tokens (run, stages and pending-decisions routes) are returned only to a principal with `exec:agent`, or to unauthenticated loopback. The callback route's per-address limit keys on the forwarded client of a loopback peer (a local reverse proxy), else on the peer. Remaining gap: paired devices through the relay bridge still share one bucket, because the relay forwards no client identity. | 4b7ceab | none (minor) |
| R15 | fixed. `pin_at_run_start` versions are resolved in the prepare `workspace` phase and stored in `systemVars.subworkflowPins`. A child that was not resolvable at run start is resolved when the stage starts. | 6685736 | none (minor) |
| R16 | fixed. A numeric reference that is one item's index and another item's key is refused as ambiguous. Otherwise the key match wins over the index. | c832bdc | none (minor) |
| R17 | fixed. `restore_checkpoint` compensation restores in the instance's placement workspace (its map item's, else the run's). | 6685736 | none (minor) |
| R18 | not migrated, per instruction. The `expansion` column is dropped from the Drizzle `schema.ts` (the physical column stays until the next migration drops it), and `text('expansion'` is banned in `packages/db/src/`. | 883831f | none |

## ECON

| id | disposition | commit | test |
|---|---|---|---|
| R1 (blocker) | fixed. Only a full key holds a waiter back, so a waiter blocked on `global` no longer reserves `provider:*`. `tryAcquire` and the fast path check room only. | 6685736 | `core/__tests__/AdmissionController.test.ts` |
| R2 | fixed. `flowGate().acquire` (per-turn permits, i.e. chats) queues as priority, ahead of every stage launch. | 6685736 | `AdmissionController.test.ts` |
| R3 | fixed. The engine resolves the provider through the PD-17 resolver (shared with `WorkflowRunService`, handles `agentRef`). `admitted` is sent only when the ticket holds `providerFlowKey(<actual provider>)`: `composed.provider` for turns, and the judge conversation's resolved provider for judges. `AgentHostClient` implements `resolveProvider` (harness type, else the gateway's model catalog) and gates each turn on that provider. | 6685736 | `core/src/services/__tests__/AgentHostClient.test.ts` (f32e59c) |
| R4 | fixed. For in-turn gates (permission, question, plan), `parkFrame(…, inTurn=true)` pauses the ticket but keeps the provider key; a completion review gives back every key. | 6685736 | `AdmissionController.test.ts` (pause with `keep`) |
| R5 | batch A | – | – |
| R6 | fixed. `acquireFlows` and `admitFlows` take `{signal}` (withdraw and reject). `ticket.resume(signal)` does the same (the executor ends the attempt on abort). The dispatcher's abort withdraws a queued launch from the admission queue and the lease queue. `AgentHostClient.abortConversation` withdraws a turn queued for its permit and ends it as `harness.cancelled`. The in-process claude path does the same. | 6685736, a2accd6 | `AdmissionController.test.ts`, `AgentHostClient.test.ts`, `agent-harness-providers/__tests__/claude-stop-settles-turn.test.ts` |
| R7 | fixed. A workflow tool blocking on a run (`run_workflow` wait, `check_workflow_run wait=true`) calls `turn.yieldKeys()` for the wait. For a stage, that pauses the whole ticket. For a chat, it calls `harness.yieldTurnPermit` (agent host client, claude provider, MultiHarness). The keys are taken back after the wait. | 6685736, d489400 | `inheritAndToolWaits.test.ts`, `claude-stop-settles-turn.test.ts` |
| R8 | fixed. The debounce key is the sha256 of content type plus the full payload. | 1754651 | `core/__tests__/AutomationTriggerPropagation.test.ts` |
| R9 | fixed. The lanes are deleted (`admit`, `acquireSlot`, `acquireWithTimeout`, `laneFor`, `AdmissionTimeoutError`, `sizeLane`, lane sizing). `global` is sized by `sizeGlobalFlowLimit`. The lane env vars are logged as ignored and banned in no-legacy. `/api/health` drops `admission` (it keeps `flows`), and the CLI status shows flow keys. The docs (`environment.md`, the relay doc, the agent-host comment, the `createCoreServices` comment, the doc-drift claim) are fixed. | 6685736, 883831f, 18149d1 | existing tests updated |
| R10 | fixed. The `chat` span ends when the turn settles. | a2accd6 | none (minor) |
| R11 | fixed. `costUsd` is carried end to end, and the UI shows dollars only from `costUsd`. | 9437249 | UsageChip test updated |
| R12 | fixed. The SDK config has `flowLimits`, and `flowLimits.global` wins over `maxConcurrentStages`. | 7c7c238 | none (minor) |
| R13 | fixed. "Raise budget 50%" rounds cost up to the cent. | c71af16 | none (minor) |

## Deviations

- **Admission queueing.** FIFO holds per full key only, so a multi-key waiter can be passed on a key that has room; under sustained load on its other key it can wait longer. Attended per-turn permits (every `flowGate` wait) go ahead of stage launches.
- **Admission lanes.** `/api/health` no longer returns `admission` (the lanes); `flows` replaces it. `AdmissionTimeoutError` is gone: `queue_timeout` comes only from the engine's timer.
- **Gates and tool waits.** An in-turn gate keeps its provider key, while a blocking workflow-tool wait gives back every key, the provider's included (ECON-R7 asked for this explicitly). A stage's turns are `admitted` only when the ticket holds the resolved provider's key; otherwise they take the provider's per-turn permit.
- **Agent host provider.** `AgentHostClient` now implements `resolveProvider`, so the session composer sees a provider in agent-host mode.
- **Map leases.** A map's merge no longer waits for another map's shared lease. A stage inside a `mount_per_item` item takes `write` on its item's mounts (a nested map's writer exclusion).
- **Kept map items.** These worktrees stay until finalize: completed `merge: none` items, conflicting items, a failed winner, and every candidate until its winner settles. `pr_per_item` keeps its branches (even at finalize); everything else goes with its branch.
- **Pins.** `pin_at_run_start` falls back to the version current at stage start for a child that was not resolvable at run start.
- **Validator.** It now allows reading `stages.<eventWait>.callbackUrl|callbackToken` from a stage that is not downstream of the wait (MAPWAIT-R11).
- **Fork redrive.** A key match now wins over an index match; an ambiguous reference is refused (MAPWAIT-R16).
- **Event sender.** MAPWAIT-R12 is partial (see its row).

## Gates (in `C:/gaiwf/fb`)

- `pnpm turbo typecheck`: 51/51 pass.
- `pnpm lint`: passes (turbo lint, then every check). It needed the doc-drift claim updated and the workflow skill regenerated, both done.
- `node scripts/check-no-legacy.mjs`: 0 hits (125 patterns).
- Package tests:

  | package | result | notes |
  |---|---|---|
  | core | 132/133 files pass | The one failure, `KokoroTtsEngine` (real-library integration), is environmental. `PtyHostAdapter` failed once as "host exited unexpectedly" and passed on the next run. |
  | workflow-spec | 11/11 | |
  | cli-core | 35/35 | |
  | shared | 17/17 | |
  | db | 25/26 | `BaselineFreshDb` fails to import `scripts/check-migrations-lock.mjs`, whose shebang line has a CRLF in this checkout. This comes from the worktree's line endings and was not changed by batch B. |
  | server | 53/54 | Known CSP-hash baseline. |
  | sdk | passes | |
  | agent-harness-providers | 742/742, then 740/743 | 742/742 before R7. After R7, three load timeouts passed when re-run alone (helper agent). |
  | web | 636/636 | Helper agent. |

- The full turbo suite was not run, per the coordinator's instruction.

## Merge-risk files (shared with other batches)

- `packages/core/src/domain/scheduler/decide.ts`: one line in `onCommand` (`deliver_event` records the sender).
- `packages/core/src/domain/scheduler/working.ts`: the `eventSenders` field.
- `packages/core/src/domain/scheduler/waits.ts`: `consumeEvent`.
- `packages/core/src/services/engine/StageExecutor.ts`:
  - import of `providerFlowKey`;
  - `admittedOn` helper before `interface Frame`;
  - `beginTurn` call (`yieldKeys`);
  - judge `admitted`;
  - `awaitVerdict` / `parkFrame(…, inTurn)` / `resumeTicket` / `park`.
- `packages/core/src/services/engine/RunSupervisor.ts`:
  - the scope import line (dropped `mapStateOf`, `StateIndex`);
  - `setProviderResolver` and its field;
  - the lifecycle `subworkflowPins`;
  - the `SubworkflowEffects` deps;
  - the `writerLeaseKeys` body;
  - one line in `recover` (inherit child lease);
  - `flowKeysOf`.
- `packages/core/src/services/engine/EffectsDispatcher.ts`: `abort`, `launch`, `map_release`.
- `packages/core/src/bootstrap/createCoreServices.ts`: shared stage provider resolver.
- `apps/server/src/composition-root.ts`: admission construction, `useTurnGates`.
- Batch C areas:
  - `packages/core/src/tools/workflows/WorkflowToolHost.ts`: `wait` and `WorkflowToolTurn.yieldKeys`;
  - `packages/workflow-spec/src/validate/scope.ts`;
  - `packages/workflow-spec/src/presets/index.ts`;
  - `templates/system/ci-gated-deploy-workflow.json` and the regenerated `skills/` and `templates/system/skills/`;
  - `apps/web/src/utils/replayEvents.ts` (two `setUsage` lines; batch C CONVINV-R10).
- `packages/core/src/domain/ports/IAgentHarness.ts`, `packages/core/src/services/session/SessionComposer.ts`, `packages/core/src/services/session/types.ts`.
- `packages/shared/src/types/RunLifecycle.ts` (`subworkflowPins`).
- `packages/db/src/schema.ts`.
- `scripts/no-legacy.json`, `scripts/check-doc-drift.mjs`.
- `apps/web/src/pages/ChatPage.tsx`, `apps/web/src/components/chat/StreamingMessage.tsx`, `packages/client-core/src/stream/types.ts`.
