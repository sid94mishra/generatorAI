# Feature: Workflow Runs

> A **WorkflowRun** is one execution of one pinned version of a workflow definition (a v2 `WorkflowGraph`). The run is driven by the workflow engine (engine v2, P03): a pure scheduler (`decide()`), one serial actor per run, a stage executor, durable timers, an outbox and crash recovery. This doc covers the run and instance states, attempts, failure precedence, recovery, ownership, the commands API and fork.

For definition/stage authoring, see [feature-workflows.md](./feature-workflows.md) and [feature-stages.md](./feature-stages.md). The design is G5 (`docs/workflow-audit/evidence/G5_scheduler_v2_loops.md`); the field reference is `docs/workflow-overhaul/generated/FIELDS.md`.

---

## 1. Tables (v57)

| Table | What a row is |
|---|---|
| `workflow_runs` | A run: `status`, `status_reason`, `outcome`, `version` (CAS), pinned `definition_version_id`, `variables`, `permission_mode` (the effective run-level mode), `run_overrides.permissionMode` (the operator's explicit run-level mode, optional), `stage_overrides`, `trigger`, `ancestor_run_id` + `fork_spec` (a fork), `idempotency_key`, `owner_id` / `owner_epoch` (who hosts it), `usage`, `budget`. |
| `stage_runs` | An **instance** of a stage: `instance_path` (the stage key at the top level; `loop#2/fix` inside containers from P05), `status`, `status_reason`, `version`, `current_attempt`, `skip_reason`, `interrupt_data` (a parked gate's request), `output_text` / `output_data` / `summary`, `error_class` / `error_code`, the executor lease (`lease_owner`, `lease_expires_at`, `heartbeat_at`, `last_progress_at`), `copied_from_stage_run_id` (a memoized fork copy). Ids are UUIDv5 of (run, instance path). |
| `stage_attempts` | One execution try of an instance: `attempt_no`, `mode` (`fresh` / `resume` / `restart`), `epoch`, `status` (`running` / `succeeded` / `failed` / `aborted` / `interrupted`), `repair_count`, `error_*`, `overrides` (a carried verdict), `checkpoint_before_id`, `usage`. |
| `run_sessions` | The conversations a run uses, keyed by session key (`instance:<path>@<epoch>`, or `group:<g>`) and config hash. |
| `workflow_timers` | Durable timers: `retry`, `queue_timeout`, `pause_ttl`, `run_budget_wall_clock`, … |
| `workflow_outbox` | Engine events, written in the same transaction as the state change they describe. |
| `scheduler_journal` | One row per committed decision batch (`{message, decisions, stateHash}`). |
| `engine_lock` | The single-engine lock: one process drives a database's runs. |

---

## 2. States

The state tables are data in `@generatorai/workflow-spec` (`state/stageRun.ts`, `state/workflowRun.ts`). Every status write is a compare-and-set against them (`transition(id, from[], to)`): development and test builds throw on an illegal pair, and `pnpm lint` fails on any other status writer (`check-workflow-invariants`).

**Run:** `created → starting → running ⇄ waiting → finalizing → completed | failed`, plus `paused` and `cancelling → cancelled`.
- `starting` runs the prepare phases (PD-17 permission check, workspace and project worktrees, `on_run_start` hooks); a failed phase fails the run with `status_reason = setup:<phase>`.
- `waiting`: nothing is launchable or in flight, but something is awaiting input, in retry backoff or paused.
- `finalizing`: the outcome is fixed; compensation (last completed first), `onFailure` / `onExit` actions, the run hooks, then every session and turn journal is released.
- Terminal states have no exits. Re-running a terminal run is a **fork** (§7).

**Instance:** `pending → ready → starting → running → validating → completed`, with `awaiting_input` (a human gate), `retry_wait` (backoff), `paused`, `failed`, `skipped` (with `skip_reason`: `guard_false`, `edge_inactive`, `upstream_skipped`, `join_unsatisfiable`, `operator`, …) and `cancelled`.
- The executor owns the in-attempt moves (claim `ready → starting` with a lease, `starting → running`, `running → validating`, repairs, `running ⇄ awaiting_input`); the actor owns everything else.
- Success is accepted only from `validating`: no stage completes without its output contract holding (F-5).

---

## 3. Attempts, precedence and repairs

A failed attempt is classified (`classifyStageError`: `transient`, `deterministic`, `interrupted`, …, with a code such as `rate_limited`, `auth`, `validation_rule`, `attempt_timeout`) and handled in this order (G5 §3.5):

1. **Repair** (inside the executor): an output that breaks the contract (schema, then `output.rules`) gets up to `repair.maxRepairs` repair turns in the same attempt, each judged on its own answer. Only the latest answer is the output (W-17).
2. **Retry**: while `retry.maxAttempts` allows and the class is retryable, the instance goes `retry_wait` and a durable `retry` timer (backoff with jitter) starts a new attempt — `resume` (the same conversation, settled turns replayed from the journal) or `restart` (a fresh session).
3. **Route**: an edge with `on: failure` (or `handlesFailure`) from the failed instance absorbs the failure. `always` / `completion` edges run but do not mask it (W-29).
4. **onExhausted**: `pause` (default: the instance waits for an operator, the run is `waiting`) or `fail`.

Every turn — internal ones included — runs inside the attempt deadline (`timeouts.attemptMs`), and an idle watchdog fails a turn with no harness activity (W-15). The admission controller's ordinary lane is the one concurrency gate (W-66); a run's `maxParallel` and `sessionGroup` exclusivity apply on top.

Context from predecessors rides inside the first prompt, fenced as `<generatorai:stage-context trust="untrusted">`. There is no context turn and no output-retry turn; a text stage pays a summary turn only when a successor reads `context.mode: summary` (W-48, W-49).

---

## 4. Human gates

A stage parks its executor frame on a completion review (`approval`), a tool permission, a question or a plan review: the instance goes `awaiting_input` with the request in `interrupt_data` (`kind`: `stage_completion_review` | `tool_permission` | `question` | `plan_review`), its admission slot is handed back and its lease cleared. The `approve` command answers it:

- `approved` resumes the parked turn; `rejected` fails the instance (`rejected_by_human`), and routing applies.
- `changes_requested` (completion review) runs the reviewer's feedback as a journalled revision turn, validated again before the next round; the revision is the output successors see (W-46).

The run's permission mode decides which tool calls park: the run row's explicit mode, else the stage's and workflow's `session.permissionMode`, else the trigger's, else the deployment posture (never a bypass default). `PATCH /api/workflow-runs/:id/permission-mode` changes the run row's mode; stages read it from their next turn.

---

## 5. Ownership and recovery

- **Single engine**: at boot the `RunSupervisor` takes `engine_lock` (a heartbeat older than 30 s is stale) and renews it every 10 s. Another live process on the same database (a second server, the desktop app, an SDK host) starts **without** an engine: its run commands answer `503 ENGINE_UNAVAILABLE`.
- **Fencing**: every run the engine hosts is claimed with `owner_epoch + 1`, and every decision batch is applied in one synchronous transaction fenced on that epoch (RV-27).
- **Recovery** (G5 §3.10) never completes a stage on missing work. For each live run: an admitted-but-unclaimed instance is launched again; a lost attempt whose in-flight turn is safe to replay ends `interrupted` and a resume attempt replays the settled turns from the journal; a never-replay turn in flight pauses the instance (`process_restart_unsafe`, W-16); a completion review stays parked and its approval starts a resume attempt that carries the verdict; a gate inside a turn (tool permission, question, plan review) pauses the instance as `interrupted`, and a resume re-sends the turn, which asks again. Timers are re-armed, a lost prepare or finalize is re-dispatched, and the outbox is drained.
- **Leases**: the executor renews its lease and stamps progress; the lease reaper posts `lease_expired` for an attempt whose lease lapsed.
- **Unattended pause TTL** (PD-2): a run started by something other than a person (automation, schedule, webhook) fails a pause that lasts 72 h.

---

## 6. The commands API

Every operator action is one route: `POST /api/workflow-runs/:id/commands` with a `RunCommand` (`@generatorai/workflow-spec`, `schemas/commands.ts`):

| Command | Target | Effect |
|---|---|---|
| `pause {mode: drain \| interrupt}` | run or instance | `drain` stops new launches; `interrupt` also stops in-flight attempts (their desired state is written before the executor is aborted) |
| `resume` | run or instance | a paused instance goes `ready` with a resume attempt |
| `cancel` | run or instance | every live instance is cancelled, then the run finalizes |
| `retry {mode: resume \| restart, promptOverride?, attachmentIds?, agentMode?}` | paused instance | a new attempt; `promptOverride` is sent as its next (operator) turn |
| `skip {as: completed \| skipped, output?}` | paused or ready instance | `completed` lets on-success successors run |
| `fail` | paused instance | fails it; routing applies |
| `approve {outcome, feedback?, data?}` | awaiting instance | answers the gate (§4); `data` carries a question's `{answers}` or a plan decision |

Every command takes an optional `expectedVersion`. Answers: `202` accepted; `404` unknown run or instance; `409` `invalid_state` / `version_conflict`; `400` invalid; `503` no engine. `approve` needs `exec:agent` only (a paired phone can answer a gate); every other command also needs `write:workflows`.

`POST /api/workflow-runs/:id/start` starts a created run (the PD-17 check refuses it synchronously). Pending approvals are the `awaiting_input` instances of `GET /api/workflow-runs/:id`. The engine's events (`workflow_run.*`, `stage_run.*`) are published to the run's stream scope and the global bus from the outbox, awaited; the terminal events are `workflow_run.completed | failed | cancelled` with `data.workflowRunId` (RV-5).

### 6.1 The stage conversation (a stage is a compact chat)

`StageConversationService` (P03b) lets an operator talk to one agent instance the way they talk to a chat. Routes under `/api/workflow-runs/:id/instances/:instanceId`:

| Route | Effect |
|---|---|
| `POST …/messages` (multipart `prompt`, `attachments[]`, `mode`; or JSON) | by the instance's state: **mid-turn** → 409 `STAGE_BUSY` (PD-3, like a chat's `CHAT_BUSY`); **awaiting a gate** → 409 `INTERACTION_PENDING`; **between turns** (`starting`/`running`/`validating` with no turn in flight) → queued as the next `operator` turn (the output is checked again after it); **completed** → **amended** (PD-4); **paused** → `retry {mode: resume, promptOverride}`; not started → 409 `STAGE_NOT_STARTED`; failed/skipped/cancelled → 409 `STAGE_NOT_CONVERSABLE` (re-run from there is a fork). `202 {outcome: queued \| amending \| retrying}` |
| `POST …/turn/cancel {force?}` | stops the turn in flight; the turn settles with what it produced and the stage continues from its next step (a stage *cancel* is the `cancel` command). `force` also tears the provider conversation down; it is re-bound before the next turn. 409 `NO_ACTIVE_TURN` |
| `POST …/interactions/:interactionId/{permission \| answer \| plan}` | answers the in-turn gate the instance is waiting on, in the chat's body shapes (`{behavior, message?}`, `{answers, freeformResponse?}`, `{approved, action?, feedback?}`); a deny or a declined plan is `changes_requested`, never `rejected` (which would fail the stage). 409 `INTERACTION_STALE` for any other interaction. `exec:agent` only, like `approve` |
| `GET …/attachments/:artifactId` | a file attached to a stage message |

**Amend** (PD-4, W-55): the completed instance's conversation is resumed on the session key of its last attempt (re-opened if the run already released it), the operator turn runs, and the output contract is checked again with repair turns. On success the new text/structured output replaces the instance's output, `amended_at` is stamped and `stage_run.amended` is emitted; the status stays `completed` and successors are **not** re-run (the run page offers **Re-run from here**, a fork). A failed amendment keeps the old output (`stage_run.amend_failed`). A terminal run's conversation is released again afterwards. Operator messages persist as `chat_messages` rows with `turn_role = operator` (and their attachments); the stream shows them as `stage_run.operator_message`.

The review batch route (`target: stage_followup`) delivers to a stage parked on its completion review as `approve {changes_requested}`, and otherwise through `send`; the batch is marked delivered only when the stage took it. There is no approve-with-follow-up (PD-9).

---

## 7. Fork

A terminal run is never mutated. `POST /api/workflow-runs/:id/fork` (`WorkflowRunService.forkRun`, G5 §3.8) creates and starts a NEW run:

```typescript
{ rerunFrom?: string[];                      // instance paths; default: every instance that did not complete
  definition?: 'pinned' | 'latest';          // latest: a stage whose spec changed is not memoized
  variablesOverride?: Record<string, unknown>;
  workspace?: 'fresh' | 'reuse' | 'restore_checkpoint';
  idempotencyKey?: string;                   // a repeated key returns the fork it created
  start?: boolean }                          // default true
```

Instances not downstream of any `rerunFrom` path are **memoized**: copied with their results and `copied_from_stage_run_id`, never re-run or re-validated (B-6). The fork keeps the source's explicit permission mode, stage overrides, project and trigger lineage (`trigger = {kind: 'fork', sourceRunId}`, `ancestor_run_id`) (W-59). `restore_checkpoint` rolls the source workspace back to the checkpoint taken before the earliest re-run instance's first attempt. The run page's **Retry failed** is a default fork; forking a live run answers 409.

---

## 8. Stage overrides and profiles

A run request's `stageOverrides: [{ stageKey, skip?, variables? }]` is stored on the run (`stage_overrides`). `decide()` skips an overridden stage when it becomes ready (`skip_reason = operator`); `variables` merge over the run variables for that stage's attempts only. Caller variables can never carry `__*` or `repo_path_*` / `repo_branch_*` names (400). Script profiles and CLI run profiles (`run start --profile`) feed the same fields.

---

## 9. CLI and SDK

```powershell
generatorai run start <defId> --var topic="caching" --watch
generatorai run pause|resume|cancel <runId>
generatorai run retry <runId> [--from <stage>]          # a fork
generatorai run stage pause|resume|retry|cancel <runId> <stageId>
generatorai run hitl pending <runId>                    # awaiting_input instances
generatorai run hitl approve|reject|changes-request <runId> <stageId> [--feedback "…"]
generatorai run hitl mode <runId> [--set acceptEdits]
```

```typescript
const run = await ai.workflows.run(definitionId, { variables: { topic: 'AI safety' } });
await ai.workflows.command(run.id, { command: 'pause', mode: 'interrupt' });
await ai.workflows.command(run.id, { command: 'resume' });
const fork = await ai.workflows.fork(run.id);                       // after it failed
const parked = await ai.hitl.pending(run.id);
await ai.hitl.resolve(run.id, parked[0]!.id, { outcome: 'approved' });
```

---

## 10. Files, streaming and cleanup

Every run has an execution workspace (`<workspacesDir>/executions/<runId>/`, see [feature-workspaces-files.md](./feature-workspaces-files.md)); a project run's codebases are checked out as worktrees under `source/<alias>` in the prepare phase and recorded as `repo_path_<alias>` / `repo_branch_<alias>` (read as `run.codebases.<alias>`). The run page subscribes to `GET /api/stream?scope=run&id=<runId>`; each stage's conversation streams on its session scope (see [feature-streaming-events.md](./feature-streaming-events.md)). A terminal run's sessions are closed and its turn journal released at finalization; `DELETE /api/workflow-runs/:id` refuses a live run (cancel it first).

**The run page** (web; mobile and the TUI mirror it). The focused stage is a compact chat: the shared composer sends to the stage conversation API (§6.1) with attachments and Stop; in-turn gates render as the chat's permission, question and plan cards; a completion review keeps its approve / request changes / reject controls. The stage "…" menu sends pause, resume, retry (resume or restart), skip as completed and cancel through the commands API, copies the output, opens the Inspector, and re-runs from the stage (a fork, once the run is terminal). The header carries the run's permission-mode control (the run row's layer; stages read it from their next turn) and asks before cancelling. Every refused control is toasted with the server's reason. Streaming: `stage_run.*` events carry the instance's `stageKey`, `instancePath` and CAS `version`, so the store inserts an instance it has not seen, copies a gate's `interruptData` with its status, and merges the 5 s poll per instance by version (the newer wins); the page, the graph and the event timeline share one focused stage; the run's stage streams are exempt from stream eviction while the page is mounted; only the header ticks every second; the workspace is polled only while the run is live; the Inspector's Files are the focused stage's own changes, from its checkpoint to the next stage's.
