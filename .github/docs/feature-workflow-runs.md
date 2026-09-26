# Feature: Workflow Runs

> A **WorkflowRun** is one execution of one pinned version of a workflow definition (a v2 `WorkflowGraph`). Every run starts through ONE invocation (`POST /api/workflow-invocations`, P04) and goes through ONE lifecycle, whoever started it. The run is driven by the workflow engine (engine v2, P03): a pure scheduler (`decide()`), one serial actor per run, a stage executor, durable timers, an outbox and crash recovery. This doc covers starting a run, the lifecycle, the run and instance states, attempts, failure precedence, recovery, ownership, the commands API and fork.

For definition/stage authoring, see [feature-workflows.md](./feature-workflows.md) and [feature-stages.md](./feature-stages.md); loops, maps, waits, sub-workflows, their decision commands, `GET /workflow-runs/:id/pending-decisions` and the wait callbacks are in [feature-workflow-control-flow.md](./feature-workflow-control-flow.md). Concurrency (flow keys), budgets and cost, the stage summary policy and tracing are in [feature-workflow-operations.md](./feature-workflow-operations.md). The design is G5 (`docs/workflow-audit/evidence/G5_scheduler_v2_loops.md`); the field reference is `docs/workflow-overhaul/generated/FIELDS.md`.

---

## 0. Starting a run

### 0.1 One invocation

Every run starts through `WorkflowInvocationService.invoke` — web, desktop and mobile run dialogs, the CLI and TUI, the SDK, the MCP server, automations (manual, schedule, webhook), scripts and forks. There is no other run-start route.

| Route | What it does |
|---|---|
| `POST /api/workflow-invocations` | JSON `InvocationRequest`, or multipart with a `request` field plus `skills` / `agents` / `prompts` files → 202 `InvocationResult` (`runId`, `trigger`, `plan`, `links`, `replayed`). |
| `POST /api/workflow-invocations/plan` | The same body → `InvocationPlan`: stages by topological layer, skipped stages (override or a statically false guard), each stage's model / provider / agent, codebases, prepare and post-processing steps, the permission mode, lineage, warnings. Nothing is written. |
| `POST /api/workflow-invocations/uploads` | Stage files before starting (kept 1 hour); send their ids in `uploads`. |
| `GET /api/workflow-invocations/:runId/digest?wait=30` | The run digest (status, stages, pending approvals, post-processing results); `wait` long-polls until `finalized`, `stopOnApproval=true` returns on an approval. |

The request: `target` (`definition` — a draft only as a person's `testRun`; `script` — materialized once per script content, with the script's `profile`; `fork` — see §7), `variables` (engine-reserved `__*` / `repo_path_*` / `repo_branch_*` names are refused, W-06), `projectId`, `codebases: [{alias, baseRef?, mode: worktree|in_place}]` (omitted: the workflow's `lifecycle.codebaseAliases`; never "every codebase", W-22), `stageOverrides: [{stageKey, skip?, variables?, model?}]`, `overrides: {model?, harnessType?, reasoningEffort?, permissionMode?}`, `uploads`, `name`, `budget: {maxDurationMs?, maxChildRuns?, maxTokens?, maxCostUsd?}`, `idempotencyKey`, `client` (a label). Every field is in `docs/workflow-overhaul/generated/INVOCATION.md`.

- **The trigger is derived by the server**, never read from the body: a paired device or the local owner is `user`; a service account or an MCP client is `external_agent`; automations, chats, orchestrators, stages and forks build theirs in process (chats, orchestrators and stages through the workflow tools: [feature-workflows-from-agents.md](./feature-workflows-from-agents.md)).
- **Validation** before anything is written: variable types, stage keys, codebase aliases of the project, `requiresCodebase`, the model in the catalog, whether each stage's provider can hold the permission mode (PD-17), lineage (depth ≤ 3, no recursion), the caller's child-run budget, the uploads.
- **Permission** (C-9, PD-18): an explicit `overrides.permissionMode` becomes the run row's mode; it may not exceed the caller's ceiling (a chat's or a stage's own mode, an automation's declared mode). The ceiling is kept on the run (`system_vars.triggerPermissionMode`) so the definition's own mode never widens it. With nothing declared, the deployment posture decides.
- **Idempotency**: the `Idempotency-Key` header, else `idempotencyKey`, else a key derived for in-process callers (`chat:<chat>:<tool call>`, `stage:<stage run>:<tool call>`, `auto:<execution>:<iteration>:<attempt>`). A replay within 24 hours answers the same run; the same key with another body is `409 IDEMPOTENCY_KEY_REUSED`.
- **Scopes** (PD-6): `exec:agent` + `read:workflows` start a run (a default paired phone can); a script target also needs `write:workflows`; bypass off loopback or an in-place codebase need `admin:settings`.
- Errors use one envelope: `{error: {code, message, issues[]}}` (`VALIDATION_ERROR`, `NOT_FOUND`, `IDEMPOTENCY_KEY_REUSED`, `DRAFT_NOT_RUNNABLE`, `CODEBASE_REQUIRED`, `PERMISSION_ESCALATION`, `PERMISSION_GATING_UNSUPPORTED`, `DEPTH_LIMIT`, `RECURSION`, `BUDGET_EXHAUSTED`, `FORBIDDEN_SCOPE`, `CONFLICT`, `ENGINE_UNAVAILABLE`).

### 0.2 One lifecycle

The lifecycle phases are recorded steps inside the run's states, the same for every run. Each phase is journalled under `system_vars.lifecycle['prepare/<phase>' | 'finalize/<phase>']` before the next one starts, so a crash resumes at the phase that did not finish and a phase's hooks fire once (C-17). `workflow_run.phase_started / phase_completed / phase_failed {stage, phase}` narrate them.

`starting` (prepare), in order:

| Phase | What it does |
|---|---|
| `workspace` | The run's execution workspace (the managed root: plans, artifacts, uploads, scratch). `on_run_start` hooks (an abort fails the run). |
| `worktrees` | The run's **mounts**, through `MountService` like a chat's: each selected codebase as a worktree (default; a new `generatorai/<run>` branch from `baseRef`, else the codebase's default branch) or in place, else one generated directory. Private shadow stores, a readiness gate, per-mount checkpoints and Changes, exactly as in chat. `pre_clone` / `post_clone` hooks. The primary mount is the stages' working directory; `run.codebases.<alias>` is `{path, branch, baseRef}`. |
| `uploads` | Staged uploads written by ONE writer into `config/` (outside the mounts, C-8): `skills/<name>/SKILL.md`, `agents/<name>.md`, `prompts/<file>`; the skills directory and the uploaded agents reach every stage's session. |
| `projectConfigs` | The project's agent, prompt and skill configs, through the same writer. |
| `preprocess` | The definition's preprocessing steps: `run_script` in the working directory through the platform shell (`pwsh -NoProfile` on Windows, `sh -c` elsewhere), `clone_repo` (https or ssh only), `validate_input`, `set_variable`, `conditional`. `on_preprocessing_complete` hooks. |
| `sandbox` | The run sandbox when the deployment has one; a failure fails the run unless `lifecycle.sandbox: 'optional'`. |

`finalizing` / `cancelling` (finalize), in order:

| Phase | What it does |
|---|---|
| `compensate` | Compensation of the completed instances, last completed first; a failure fails the run. |
| `hooks` | `onFailure` / `onExit` actions, then `on_run_complete` / `on_run_failed` / `on_run_cancelled`. |
| `postProcess` | For a completed run only: the lifecycle's commit, push and pull request (the `autoCommit` / `autoPush` / `autoCreatePR` flags and the explicit steps), through the one source-control flow, on the run's codebases; a pull request targets the base ref the codebase was mounted from. `on_postprocessing_start`, `pre_commit`, `post_commit`, `on_pr_created` hooks. A failing `failOnError` step fails the run. |
| `release` | The run's sessions (B-15) and turn journals, the sandbox, the workspace. Worktrees are never deleted on cancel or failure (C-7); retention reclaims them. |

A cancel while the run finalizes supersedes the finalize in flight: it stops before its next phase (so post-processing is skipped), and the cancel's finalize runs compensation.

---

## 1. Tables (v57)

| Table | What a row is |
|---|---|
| `workflow_runs` | A run: `status`, `status_reason`, `outcome`, `version` (CAS), pinned `definition_version_id`, `variables` (the caller's inputs only), `permission_mode` (the effective run-level mode), `run_overrides` (the operator's explicit run-level mode, and the invocation's run-wide model / provider / effort), `stage_overrides` (skip, variables, model by stage key), `codebase_selection`, `system_vars` (engine-owned values: working directory, codebases, uploaded skills and agents, sandbox, the trigger's permission ceiling, the lifecycle journal), `trigger`, `invocation_id`, lineage (`parent_run_id`, `parent_stage_run_id`, `root_run_id`, `depth`), `ancestor_run_id` + `fork_spec` (a fork), `idempotency_key`, `owner_id` / `owner_epoch` (who hosts it), `usage`, `budget`. |
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
- `starting` runs the prepare phases of the lifecycle (§0.2); a failed phase fails the run with `status_reason = setup:<phase>`.
- `waiting`: nothing is launchable or in flight, but something is awaiting input, in retry backoff or paused.
- `finalizing`: the outcome is fixed; the finalize phases run (§0.2). `workflow_run.finalized` follows the terminal event once they are done.
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

A run starts through the invocation (§0). Pending approvals are the `awaiting_input` instances of `GET /api/workflow-runs/:id`. The engine's events (`workflow_run.*`, `stage_run.*`) are published to the run's stream scope and the global bus from the outbox, awaited; the terminal events are `workflow_run.completed | failed | cancelled` with `data.workflowRunId` (RV-5), followed by `workflow_run.finalized {status}` once the lifecycle is done — what every waiter keys on (W-63).

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

A terminal run is never mutated. Re-running it is an invocation with a fork target (`WorkflowRunService.forkRun`, G5 §3.8), which creates and starts a NEW run:

```typescript
{ target: {
    kind: 'fork',
    sourceRunId: string,
    rerunFrom?: string[],                     // instance paths; default: every instance that did not complete
    definition?: 'pinned' | 'latest',         // latest: a stage whose spec changed is not memoized
    workspace?: 'fresh' | 'reuse' | 'restore_checkpoint' },
  variables?: Record<string, unknown>,        // merged over the source run's variables
  idempotencyKey?: string }                   // a repeated key returns the fork it created
```

Instances not downstream of any `rerunFrom` path are **memoized**: copied with their results and `copied_from_stage_run_id`, never re-run or re-validated (B-6). The fork keeps the source's explicit permission mode, run and stage overrides, project, codebases and budget; its trigger is `{kind: 'fork', sourceRunId, principalId}` (`ancestor_run_id` set) (W-59). `reuse` and `restore_checkpoint` keep the source workspace (and its system values); `restore_checkpoint` rolls it back to the checkpoint taken before the earliest re-run instance's first attempt. The run page's **Retry failed** is a default fork; forking a live run answers 409.

---

## 8. Stage overrides and profiles

An invocation's `stageOverrides: [{ stageKey, skip?, variables?, model? }]` is stored on the run (`stage_overrides`). `decide()` skips an overridden stage when it becomes ready (`skip_reason = operator`); `variables` merge over the run variables for that stage's attempts only; `model` is the stage's model in this run. The run-wide `overrides` (model, provider, effort) sit under every stage's own session. Caller variables can never carry `__*` or `repo_path_*` / `repo_branch_*` names (400). Run profiles have ONE shape, `RunProfileSchema` (`workflow-spec`, stage overrides by KEY, C-10): CLI profile files (`run start --profile <file>`) and the profiles a workflow script exports (`profile` on a script invocation).

---

## 9. CLI, SDK and MCP

```powershell
generatorai run start <defId> --var topic="caching" --skip review --stage-model build=claude-sonnet `
  --codebase api@main --permission-mode acceptEdits --name "nightly" --watch
generatorai run plan <defId> --var topic="caching"             # the InvocationPlan, nothing started
generatorai run retry <runId> [--from <stage>]                   # an invocation with a fork target
generatorai script run <scriptId> --profile quick --watch
generatorai run pause|resume|cancel <runId>
generatorai run hitl mode <runId> [--set acceptEdits]
```

```typescript
const started = await ai.workflows.run(definitionId, { variables: { topic: 'AI safety' } }); // external_agent via sdk
const digest = await ai.workflows.waitFor(started.runId, { timeoutMs: 600_000 });          // resolves on `finalized`
await ai.workflows.command(started.runId, { command: 'pause', mode: 'interrupt' });
const fork = await ai.workflows.fork(started.runId);                                       // after it failed
const plan = await ai.workflows.plan({ target: { kind: 'definition', workflowDefinitionId: definitionId }, variables: {} });
```

The MCP server (`@generatorai/mcp-server`, `generatorai-mcp`) runs in **remote mode only** (W-58): it talks to the running server at `GENERATORAI_URL` as a paired device of platform `mcp` (PD-22). Pair it with `generatorai device invite --platform mcp --scopes exec:agent,read:workflows` and `generatorai-mcp pair <code>`; the device key lives in the OS-backed vault and the device is revocable in Settings → Devices. Its tools are the workflow tool set (`generatorai_run_workflow`, `generatorai_check_workflow_run`, the authoring tools, …) served by `/api/workflow-tools`, and its resources the authoring skill: see [feature-workflows-from-agents.md](./feature-workflows-from-agents.md). A run it starts is an invocation (`external_agent via mcp`).

Automations start one invocation per iteration and attempt (trigger `{kind: 'automation', automationId, executionId, via, iterationIndex}`, the automation's `permissionMode` as the ceiling, a derived idempotency key) and wait for `workflow_run.finalized` (W-63).

---

## 10. Files, streaming and cleanup

Every run has an execution workspace (`<workspacesDir>/executions/<runId>/`, see [feature-workspaces-files.md](./feature-workspaces-files.md)); its code lives in mounts (`source/<alias>` for a worktree or the generated directory), materialized by the `worktrees` phase and recorded in `system_vars.codebases` (read as `run.codebases.<alias>`). `GET /api/workflow-runs/:id/workspace` lists the root, artifacts, uploads and every mount with its files; `…/workspace/content`, `…/workspace/download` and `…/workspace/diff` (each mount's change set) read it. The run page subscribes to `GET /api/stream?scope=run&id=<runId>`; each stage's conversation streams on its session scope (see [feature-streaming-events.md](./feature-streaming-events.md)). A terminal run's sessions are closed and its turn journal released at finalization; `DELETE /api/workflow-runs/:id` refuses a live run (cancel it first).

**The run page** (web; mobile and the TUI mirror it). The focused stage is a compact chat: the shared composer sends to the stage conversation API (§6.1) with attachments and Stop; in-turn gates render as the chat's permission, question and plan cards; a completion review keeps its approve / request changes / reject controls. The stage "…" menu sends pause, resume, retry (resume or restart), skip as completed and cancel through the commands API, copies the output, opens the Inspector, and re-runs from the stage (a fork, once the run is terminal). The header carries the run's permission-mode control (the run row's layer; stages read it from their next turn) and asks before cancelling. Every refused control is toasted with the server's reason. Streaming: `stage_run.*` events carry the instance's `stageKey`, `instancePath` and CAS `version`, so the store inserts an instance it has not seen, copies a gate's `interruptData` with its status, and merges the 5 s poll per instance by version (the newer wins); the page, the graph and the event timeline share one focused stage; the run's stage streams are exempt from stream eviction while the page is mounted; only the header ticks every second; the workspace is polled only while the run is live; the Inspector's Files are the focused stage's own changes, from its checkpoint to the next stage's.
