# Feature: Workflow Control Flow

Control flow in a workflow is made of **stage kinds**, never of commands. A loop, a fan-out, a
wait for a person or for CI, a sub-workflow and a deterministic command are nodes of the DAG:
they are drawn in the builder, imported as JSON or produced by the authoring tools, and they run
through the normal pipeline (invoke → engine → run page). There are no slash commands and no chat
commands for any of them. Operators act on a running workflow with **run commands** (the run
page's cards, `POST /api/workflow-runs/:id/commands`, `generatorai run command …`).

The document format is described in [feature-workflows.md](./feature-workflows.md), the stage
fields in [feature-stages.md](./feature-stages.md), running and forking in
[feature-workflow-runs.md](./feature-workflow-runs.md). Every field, with its type and default,
is in the generated [FIELDS.md](../../docs/workflow-overhaul/generated/FIELDS.md). The design is
[PHASE-05](../../docs/workflow-overhaul/PHASE-05-control-flow.md); where the implementation
differs from it, [DEVIATIONS.md](../../docs/workflow-overhaul/DEVIATIONS.md) (P05 rows) says how.

---

## 1. The kinds

| Kind | What it is | Fields beyond the common ones | Output (`stages.<key>.output`) |
|---|---|---|---|
| `agent` | An LLM stage (a compact chat) | `prompts`, `followUpPrompts`, `session`, `sessionReuse`, `compactAfter`, `sessionGroup`, `context`, `output`, `retry`, `repair`, `onExhausted`, `timeouts`, `budget`, `approval`, `hooks`, `expands` (a planner, §5b) | its structured output, else its text (a planner: its plan) |
| `check` | One deterministic command, no LLM | `check`, `retry`, `timeouts.queueMs` | `{exitCode, passed, timedOut, stdoutTail, stderrTail, durationMs, json?, jsonError?}` |
| `loop` | Repeats its body until an exit rule fires | `loop`, `budget` (cumulative) | `{iterations, exitReason, exitAction, last, wrapUp, carry, history, …select}` |
| `map` | Runs its body once per item of a runtime list | `map`, `budget` (cumulative) | `{count, results, failures}` |
| `subworkflow` | Runs another published workflow as the stage | `subworkflow`, `budget` (the child's) | the child's declared `workflow.outputs` |
| `wait` | Waits for an approval, an event or a timer | `wait` | `{outcome, data, by, at}` |

Every kind has the common fields `key`, `name`, `description`, `parentKey`, `guard`, `join`,
`position` and `compensate`. A field of another kind is the validation error
`field-not-applicable`.

- **Bodies.** A `loop` or a `map` is a container: its body is every stage whose `parentKey` is its
  key, of any kind, nested at most 3 containers deep (`nesting-too-deep`). Edges connect stages of
  the same scope only (`edge-crosses-scope`); connect outer stages to the container itself. A
  container needs a body (`empty-body`). Cycles are checked per scope: the outer graph stays
  acyclic, and repetition exists only inside a loop.
- **Reading a body from outside.** A body stage is not visible outside its container: read a
  loop's body as `stages.<loop>.output.last.<key>`, a map's as the entries of
  `stages.<map>.output.results`.

### `check`

`check: {command, args, env?, mount?, cwd?, timeoutMs, parseJson, failOnNonZero, tailBytes}`.
The command is a bare name on the command allow-list (the server's effective list: defaults plus
the operator's extras), the arguments are literals (a template is `check-args-literal`), and
`env` is the only templated field. A launch failure (not allowed, not found, refused, a run in
`plan` mode) fails the stage with `check_launch_failed`; it never yields `passed: false`, so a
loop waiting for a pass cannot spin on a broken command. A non-zero exit or a timeout completes
with `passed: false`, or fails with `check_failed` under `failOnNonZero`. A check runs repository
code, which is the run capability `shell`: adding or editing one needs `admin:settings`, and the
invocation plan flags it as `runs_repo_code`.

---

## 2. Loops

```ts
loop: {
  maxIterations: 1..50,
  exits: Array<{ when: Expr, action: 'complete' | 'fail' | 'pause' | 'exhaust', consecutive: 1..10 = 1, reason: string }>,
  carryInit?: Record<name, Expr>,     // carry(-1), evaluated once at the start
  carry?: Record<name, Expr>,         // evaluated after each iteration, all at once
  carrySchema?: Record<name, JSONSchema>,
  onLimit: { mode: 'pause' } | { mode: 'fail' } | { mode: 'accept_last' } | { mode: 'accept_best', score: Expr },
  wrapUp?: { stage, prompt, maxTurns = 1, maxCostShare = 0.1 },
  onBodyFailure: 'fail' | 'next_iteration',
  checkpointEachIteration?: boolean,  // on by default with accept_best
  output: { select?: Record<name, Expr> },
}
```

### Evaluation contexts

Every loop expression reads the `loop` root in one of three contexts of iteration k:

| Context | Used by | `stages.<bodyKey>` | `loop.last` | `loop.previous` | `loop.carry` | `loop.priorCarry` |
|---|---|---|---|---|---|---|
| **T(k)** | `prompts` (k = 0), `followUpPrompts` (k ≥ 1), body guards, edge `when` in the body, check `env` | outer stages only | iteration k-1 | iteration k-1 | carry(k-1) | carry(k-2) |
| **C(k)** | `carry` | iteration k | iteration k | iteration k-1 | carry(k-1) | carry(k-2) |
| **E(k)** | `exits[].when`, `onLimit.score`, `output.select` | iteration k | iteration k | iteration k-1 | carry(k) | carry(k-1) |

In iteration 0, `loop.previous`, `loop.priorCarry` and a carry without `carryInit` are `null`
(nullable types, not errors). The other paths are `loop.iteration`, `loop.number`,
`loop.maxIterations` (grants included), `loop.remaining`, `loop.last.stages.<key>.{output,
status, summary}`, `loop.last.signals` (`toolCalls`, `workspaceChanged`, and per stage
`toolCalls`, `outputHash`, `status`), `loop.last.failures` (with `onBodyFailure:
next_iteration`), `loop.history[i]`, `loop.usage.{turns, costUsd, tokens}` and
`loop.operatorInput`. `loops.<key>` is every enclosing loop.

### The algorithm

```
loop ready        carry(-1) := carryInit; capture the start tree hashes; scope <loop>#0
scope k terminal  phase settling; effect capture_iteration (tree hash per mount, checkpoint)
captured          signals(k) from the attempts and the hashes
                  failed with only budget/wall-clock codes → EXHAUST(budget)
                  failed and onBodyFailure fail           → FAIL(body_failed)
                  carry(k) := every carry expression in C(k), all at once
                             (an error keeps carry(k-1)[name] and emits loop.carry_error)
                  exits in E(k): an error or null is false (loop.exit_error); streaks;
                  precedence fail > complete > pause > exhaust, then array order
                  loop_iterations row k is written with the next scope
                  fired action | k+1 = max → EXHAUST(max_iterations)
                  | budget spent or projected → EXHAUST(budget) | scope k+1
EXHAUST(reason)   budget + wrapUp (once): a wrap-up instance <loop>#wrapup/<stage> on its own
                  allowance, then onLimit: pause (park) | fail | accept_last | accept_best
```

A streak counts the trailing iterations a rule held since the loop start, the last operator
command and the rule's last firing; an evaluation error or a failed iteration breaks every
streak. The budget is projected at each boundary, the in-flight body is aborted at 1.25× (it
then exhausts, with the wrap-up), and the wall clock excludes time parked for an operator.
`accept_best` keeps the best-scoring iteration (ties to the latest; all null behaves as
`pause`) and restores its checkpoint on every mount, all or nothing.

A parked loop waits in `awaiting_input` with a decision card. Its commands (below) reset every
streak.

---

## 3. Maps

```ts
map: {
  items: Expr,                        // a list, evaluated when the map starts
  itemKey?: Expr,                     // a stable key per item (`item` bound); default the index
  maxItems: 1..200 = 50,
  concurrency: 1..16 = 4,
  toleratedFailurePercent: 0..100 = 0,
  workspace: 'shared' | 'mount_per_item' = 'shared',
  merge: 'none' | 'sequential' | 'pr_per_item'             // mount_per_item only
       | { mode: 'winner', key: Expr } = 'none',            // P08: only the item a later stage picks
  itemSetup?: CheckSpec[],            // mount_per_item only: run in each item mount first
  output: { select?: Record<name, Expr> },                  // evaluated per item
}
```

- **Start.** `items` is evaluated in the map's place (context T of its enclosing loops, the items
  of enclosing maps). Not a list (or an evaluation error) fails the map with `map_items_invalid`,
  more than `maxItems` with `map_too_large`, two equal keys with `map_duplicate_item_key`. An
  empty list completes the map with no results.
- **Items.** Item i's scope is `<map>#<i>/<bodyKey>`, keyed by its index (`item_index`); its key
  is kept in `item_key` and in the map's state. At most `concurrency` items run at a time, in
  index order; each item's outcome is the outcome of its scope.
- **Scopes.** Inside the body, `item` is the item (the element of the list: `{{item}}` renders a
  string item, `item.path` reads a field of an object item), `map` is `{index, key, count}` of
  the nearest map, and `maps.<key>` is `{item, index, key, count}` of every enclosing map (the
  outer item of a nested map). `itemKey` sees `item`; `output.select` sees the item and its body
  stages.
- **Outcome.** When every item is done, `failed items / all items × 100 ≤
  toleratedFailurePercent` completes the map; otherwise it fails with `map_tolerance_exceeded`
  (its output is still set). The output is `{count, results, failures}` where
  `results[i] = {index, key, item, status, error, stages: {<bodyKey>: {status, output,
  summary}}, pr, branch, workdir, …select}` (`branch` and `workdir`: a mount_per_item item's
  branch and primary worktree) and `failures` is the entries that did not complete.
- **`shared`.** Every item works in the run's mounts. Several items writing at once is only a
  warning (`map-shared-write-concurrency`, at save and in the invocation plan): make the body
  read-only (`session.permissionMode: plan`), set `concurrency: 1`, or use `mount_per_item`.
- **`mount_per_item`.** The map snapshots every run mount into a commit — the working tree as it
  is, uncommitted upstream changes included — and each item gets its own workspace whose mounts
  are git worktrees on new branches (`generatorai/<run>-<map>-<i>`) cut from those commits, all
  or nothing (`mount_fork_failed`). `itemSetup` then runs in the item mount (for example
  `pnpm install --offline`: worktrees have no `node_modules`); a failure or a non-zero exit fails
  the item (`item_setup_failed`). The run's mounts must be git repositories: a `local-dir`
  codebase is refused at invoke. Stages inside the item run in the item's workspace, and a
  `check` there runs in the item's worktree.
- **Writer exclusion.** While a mount_per_item map runs it holds a shared lease on each run
  mount (`worktree:<mountId>`); in a run that has such a map, every stage outside it that may
  write (agents and checks) takes a `write` lease first, so it waits until the map is done, and a new map's snapshot waits
  for writers in flight. Writers do not wait for each other.
- **Merges** run one at a time. `sequential`: under the exclusive lease, a 3-way merge per mount
  (base = the snapshot, ours = the run mount now, theirs = the item) is computed for every mount
  first; a conflict fails the item with `merge_conflict` (counted toward the tolerance) with
  nothing applied and the item's mount kept for inspection; otherwise each run mount is moved to
  its merged tree (only the changed paths are written) and the item's worktrees are removed.
  `pr_per_item`: the item branch is committed and, following
  `lifecycle.postProcessing.autoPush` / `autoCreatePR`, pushed and given a pull request; the
  entry's `pr` is `{url, branch}`. With `merge: none` the item mounts stay until workspace
  retention reclaims them.
- **Winner merge** (P08, judge panel / best-of-N): `merge: {mode: 'winner', key}`. No item comes
  back while the map runs. The key reads a stage that runs **after** the map (the judge, for
  example `stages.judge.output.winner`; `map-winner-unbound` otherwise) and is typed in the map's
  scope plus the map and its successors. Once the map completed and every stage the key reads
  after it settled, the key is evaluated: `null`, or a judge that did not complete, merges
  nothing; a key naming a completed item merges that item (the `sequential` merge above), and
  the other item mounts stay (the judge reads them through `results[i].workdir`). Stages after
  the judge wait for that merge, and the judge's scope (the top level, a loop iteration, a map
  item) does not end before it. A key naming no completed item, or a merge conflict, fails those
  stages and the run with `map_winner_failed`. The map's state keeps the pick
  (`winner: {phase, index, key, outcome, error}`), and the events `map.winner_selected` /
  `map.winner_settled` report it.

---

## 4. Sub-workflows

```ts
subworkflow: {
  workflowRef: { id } | { name, projectScope?: 'project' | 'global' },
  version: 'pin_at_run_start' | <published version number> = 'pin_at_run_start',
  inputs: Record<childVariable, Expr> = {},
  workspace: 'inherit' | 'isolated' = 'inherit',
}
```

- **References.** By id, or by name: the parent's project first, then workflows without a
  project (`projectScope` narrows it). A reference is resolved when the parent is saved,
  imported, published and invoked. A missing or draft child is a warning while drafting
  (`subworkflow-ref`, `subworkflow-draft`) and an error at publish and invoke; an archived child
  is an error. Inputs must be variables the child declares, and every required child variable
  must be set (`subworkflow-input`). Sub-workflows nest at most 3 deep, without cycles
  (`subworkflow-depth`, `subworkflow-cycle`).
- **Outputs.** The stage's output is the child's `workflow.outputs` (expressions over the
  child's top-level stages), typed from the child at save. At invoke, and again when the stage
  starts with the version it pins, the parent's expressions are re-checked against the child's
  outputs: an incompatible child fails with `subworkflow_output_drift`.
- **Running.** The inputs are evaluated when the stage starts, and the child run is invoked
  through the one invocation path (trigger `{kind: 'stage'}`, the parent's permission mode as the
  ceiling, the stage `budget` as the child's run budget, an idempotency key per stage instance).
  `inherit`: the child works in the parent's workspace and mounts, skips its own mount
  preparation and post-processing, and leaves commits and PRs to the parent. `isolated`: a full
  child lifecycle. When the child finalizes, a completed child completes the stage with its
  outputs, a failed one fails it (`subworkflow_failed`), a cancelled one cancels it; the child's
  usage rolls up into the stage and the run. Cancelling the stage or the run cancels the child;
  pausing or resuming the run (or the stage) pauses or resumes it.
- **Decisions.** Every decision a child waits on (approvals, parked loops, waits) is listed with
  the parent's (§6) and can be answered through the parent run.

---

## 5. Waits

```ts
wait:
  | { type: 'approval', prompt: PromptDefinition, form?: JSONSchema, timeoutMs?, onTimeout: 'fail' | 'complete' = 'fail' }
  | { type: 'event', eventKey: Expr, timeoutMs?, onTimeout: 'fail' | 'complete' = 'fail' }
  | { type: 'timer', durationMs }
```

A wait holds no executor, lease or admission slot: it moves `ready → waiting` with its question
in `interrupt_data` (`{kind: 'wait', type, prompt, form, eventKey, until, onTimeout}`), and the
run is `waiting`, not `running`, while nothing else works. Its output is
`{outcome: approved | rejected | event | timeout | elapsed, data, by, at}`.

- **approval** — the `approve` command with `outcome: approved | rejected` (a change request
  does not apply) and `data`, validated against `form` (a 400 when it does not match). `by` is
  the approver.
- **event** — the wait takes the **oldest unconsumed** event delivered to the run with its
  evaluated `eventKey`; an event that arrives before the wait is reached waits in the run's event
  table. Each wait instance consumes its own event, so a wait inside a loop or a map takes one
  event per instance. Events are delivered by the `deliver_event` run command or the wait's
  callback URL.
- **timer** — completes with `elapsed` after `durationMs`.
- **Timeouts.** `timeoutMs` completes the wait with `outcome: timeout` (`onTimeout: complete`,
  route on it with an edge `when`) or fails it with `wait_timeout`. An approval or event wait
  without `timeoutMs` in an unattended run (an automation, a schedule, a webhook, a
  sub-workflow child) expires after the pause TTL (72 h) with `pause_expired`.
- **Delivering an event.** `deliver_event {eventKey, idempotencyKey, data}` stores the event
  idempotently per `(run, eventKey, idempotencyKey)`: the same key with the same data answers
  200 `replayed`, the same key with other data 409. Then any waiting wait with that key takes it.
- **Callback URLs.** A waiting event wait has a callback: `POST
  /api/workflow-callbacks/<token>` with `{data?, idempotencyKey?}` (or an `Idempotency-Key`
  header; without a key the data is the key, so a retried POST replays). The token is
  `v1.<runId>.<instanceId>.<HMAC-SHA256(run, instance, eventKey)>` under the server's callback
  key (`<dataDir>/workflow-callback.key`; deleting it revokes every token): it can deliver that
  wait's one event to that run and nothing else, so CI needs no user credential. The route is
  public, rate-limited per token and per address, and answers 202 delivered, 200 replayed, 409 a
  conflict or a wait that is no longer waiting, 404 an unknown token. The callback is shown on the
  wait's row (`callback: {url, token}` in `GET /api/workflow-runs/:id`), in the pending
  decisions, and as `stages.<wait>.callbackUrl` / `callbackToken` in the templates of stages that
  can see the waiting wait.

---

## 5b. Plan-then-execute (dynamic expansion)

An agent stage with `expands` is a **planner**: its output is a plan — a small graph of agent
stages — and the engine runs that plan after it (P08 WP-8.4, G5 §4.7). There is no command for
it: the planner is an ordinary stage, and the planned stages are ordinary stage instances.

```ts
expands: {
  maxStages: 1..20 = 8,              // a larger plan is refused
  allowedAgentRefs: string[] = [],   // agents a planned stage may name; empty: the default agent only
  allowedModels: string[] = [],      // models a planned stage may name; empty: the default model only
  join: 'all' | 'tolerate' = 'all',  // all: a failed planned stage fails the expansion
}
// the planner's output (its contract; output.schema is refused: expansion-output-schema)
{ stages: [{ key, name, prompt, agentRef?, model?, readOnly? }], edges: [{ from, to }], summary? }
```

- **The expansion node.** The engine adds an implicit container `<planner>~x` right after the
  planner, in the planner's scope. The planner's **success** edges leave from it, so the stages
  after the planner wait for the planned stages; its failure, completion and always edges stay
  on the planner. The run page shows it as a dashed group "planned by <planner>", the builder
  shows the planner with its dashed "planned by" placeholder, and its instance path is
  `<planner path>~x`.
- **Validation, in the planner's transaction.** The executor validates the plan against the plan
  schema (the allow-lists are enums, `maxStages` is `maxItems`) and against the graph rules
  below; a plan that fails either gets a repair turn like any output contract. When the planner
  completes, the expansion node becomes ready in the same `decide()` call — the same store
  transaction — checks the plan again (`validateExpansion`), compiles it into full agent stages
  and stores it in its state. A plan that still does not hold fails the node with
  `expansion_invalid`. Rules: at most `maxStages` stages; unique keys that are not keys of the
  workflow; `agentRef` and `model` from the allow-lists; edges between planned keys, no
  self-edge, no cycle.
- **The clamp.** A planned stage is always an agent stage with one prompt: the plan's shape has
  no hooks, MCP servers, tools, checks, loops, maps or custom-script rules. `readOnly` runs it in
  plan mode; nothing in the plan can raise its permission, and the run's permission ceiling
  applies as to every stage. The workflow's session settings apply as defaults.
- **Running.** Each planned stage gets its instance `<planner path>~x/<key>` (deterministic
  ids). Planned stages see each other (`stages.<key>`) and the stages visible to the planner;
  their context is their planned predecessors' summaries. Recovery and replay read the stored
  plan: the planner is never asked again.
- **Outcome.** When every planned stage ended: `join: all` fails the node with
  `expansion_failed` if one failed (and no edge handled it); `tolerate` completes it. Its output
  is `{count, results, failures}`, `results[i] = {key, name, status, output, summary, error}`,
  and the stages after the planner read it as `stages.<planner>.expansion.results`; their
  context block for the planner also lists what each planned stage did. `cancel` on the node
  cancels the planned stages. The plan is `stages.<planner>.output`.
- **Risk flag.** A workflow with a planner carries `plans_stages_at_run_time` (describe_workflow,
  the agent-draft banner).

---

## 6. Operator commands and decisions

All operator actions are run commands: `POST /api/workflow-runs/:id/commands` with a
`RunCommand`, the run page's cards, the mobile and TUI cards, and the CLI
(`generatorai run command <run> <instance|-> <command> --json '<payload>'`).

| Command | Applies to | Scope |
|---|---|---|
| `approve {outcome, feedback?, data?}` | a completion review, an in-turn gate, an approval wait | `exec:agent` |
| `grant_iterations {n}` | a loop (a parked one continues when it can) | `exec:agent` |
| `raise_budget {maxTurns?, maxCostUsd?, maxTokens?, maxWallClockMs?}` | a loop | `exec:agent` |
| `continue_with_input {text}` | a loop: the text is an operator turn of the next iteration's first stages and `loop.operatorInput` | `exec:agent` |
| `accept`, `accept_iteration {k}` | a parked loop (`accept_iteration` of an earlier iteration needs its checkpoint) | `exec:agent` |
| `deliver_event {eventKey, idempotencyKey, data?}` | the run | `exec:agent` |
| `fail` | a paused instance, a parked loop | `write:workflows` |
| `pause`, `resume`, `cancel`, `retry`, `skip` | the run or an instance (a sub-workflow: cancel, pause, resume its child; a map, a wait or an expansion node: cancel) | `write:workflows` |

Decisions (the `exec:agent` rows) are run-time acts on a run the caller may start, so a default
paired phone can take them; steering a run needs `write:workflows`.

`GET /api/workflow-runs/:id/pending-decisions` lists every decision the run waits on —
completion reviews, in-turn gates, parked loops, approval and event waits — and those of its
running sub-workflow children, each with the chain of sub-workflow stages it came through
(`via`). An `approve` sent to the parent's commands route for a child's instance reaches the
child that owns it. The run digest (`GET /api/workflow-invocations/:runId/digest`) lists the same
decisions.

---

## 7. Presets are templates

The engine knows only the generic kinds. Every scenario is an ordinary graph built from them:
**presets** in `@generatorai/workflow-spec/presets` are template functions (each with a zod
parameter schema) that emit plain stage and edge JSON, and the shipped
`templates/system/<id>-workflow.json` files are generated from them (`pnpm generate:templates`;
`pnpm check:templates` in lint). The `check-workflow-invariants` lint fails when a preset export
name or a template id appears in the scheduler or the engine.

| Template | Preset | Example | Shape |
|---|---|---|---|
| `fix-review-loop` | `fixReviewLoop` | L1 | triage → loop(fix ↔ review until approved; stall on no change) → open PR |
| `test-until-green` | `testUntilGreen` | L2 | loop(fix → `pnpm exec vitest` check) until passed; exhaust when failures stop decreasing |
| `goal-loop` | `goalLoop` | L3 | loop(work → assess) until met; fail on impossible; pause on the same blocker 3×; wrap-up on budget |
| `refine-until-score` | `refineUntilScore` | L4 | loop(draft → critique) until score ≥ 8; accept_best |
| `research-until-dry` | `researchUntilDry` | L5 | loop(find) with an accumulating carry until two rounds find nothing new |
| `completeness-critic` | `completenessCritic` | L5-shaped | loop(work → critic) until the critic finds nothing missing |
| `migrate-until-clean` | `migrateUntilClean` | L6 | loop(plan → map(edit, mount_per_item, sequential) → typecheck) until clean |
| `per-file-migration` | `perFileMigration` | M1 | scan → map(migrate, itemKey `item.path`, mount_per_item, pr_per_item) |
| `multi-source-research` | `multiSourceResearch` | M2 | map over the `list` variable `sources` (read-only, shared) → synthesize |
| `adversarial-verify` | `adversarialVerify` | M3 | audit → map(findings) of map(three angles, read-only verify); `confirmed` when 2 of 3 agree → report |
| `judge-panel` | `judgePanel` | P08 judge panel | map(three angles, mount_per_item, merge winner) → read-only judge `{winner, scores, rationale}`; only the winner is merged |
| `plan-then-execute` | `planThenExecute` | P08 plan-then-execute | planner (`expands`, at most 6 stages) → its planned stages → read-only report over `stages.plan.expansion.results` |
| `approval-gated-release` | `approvalGatedRelease` | W1 | prepare → approval wait (form: environment, notes; timeout completes) → deploy on approved, escalate on timeout |
| `ci-gated-deploy` | `ciGatedDeploy` | W2 | push (sha) → event wait `concat('ci:', sha)` (CI posts to its callback URL) → deploy |
| `cooldown-then-verify` | `cooldownThenVerify` | W3 | deploy → timer wait → verify |
| `security-review` | `securityReview` | S1 child | review with a verdict; `workflow.outputs.verdict` |
| `release-with-security-review` | `releaseWithSecurityReview` | S1 | build → sub-workflow "Security review" (isolated) → release when its verdict is pass |

The examples, as graphs:

```jsonc
// L6 — plan, fan out and verify each iteration (body edges plan -> per_file -> typecheck)
{ "key": "migrate_until_clean", "kind": "loop",
  "loop": { "maxIterations": 3, "exits": [{ "when": "stages.typecheck.output.passed", "action": "complete", "reason": "clean" }] } },
{ "key": "plan", "parentKey": "migrate_until_clean", "kind": "agent",
  "prompts": [{ "label": "plan", "text": "List every file that must change to migrate to the new API." }],
  "followUpPrompts": [{ "label": "replan", "text": "Typecheck still fails:\n{{loop.previous.stages.typecheck.output.stdoutTail}}\nList only the files that still need changes." }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["files"], "properties": { "files": { "type": "array", "items": { "type": "object", "required": ["path"], "properties": { "path": { "type": "string" }, "reason": { "type": "string" } } } } } } } },
{ "key": "per_file", "parentKey": "migrate_until_clean", "kind": "map",
  "map": { "items": "stages.plan.output.files", "itemKey": "item.path", "maxItems": 100, "concurrency": 4, "workspace": "mount_per_item", "merge": "sequential" } },
{ "key": "edit", "parentKey": "per_file", "kind": "agent", "prompts": [{ "label": "edit", "text": "Migrate {{item.path}} to the new API. Reason: {{item.reason}}" }] },
{ "key": "typecheck", "parentKey": "migrate_until_clean", "kind": "check", "check": { "command": "pnpm", "args": ["typecheck"], "timeoutMs": 900000 } }
```

```jsonc
// M3 — adversarial verification (the verify agent is read-only: the items share the workspace)
{ "key": "verify_findings", "kind": "map",
  "map": { "items": "stages.audit.output.findings", "itemKey": "item.id", "maxItems": 50, "concurrency": 4, "workspace": "shared", "merge": "none",
           "output": { "select": { "confirmed": "count(stages.verify_map.output.results, r => r.stages.verify.output.real) >= 2" } } } },
{ "key": "verify_map", "parentKey": "verify_findings", "kind": "map",
  "map": { "items": "['correctness', 'security', 'reproducibility']", "maxItems": 3, "concurrency": 3, "workspace": "shared", "merge": "none" } },
{ "key": "verify", "parentKey": "verify_map", "kind": "agent", "session": { "permissionMode": "plan" },
  "prompts": [{ "label": "verify", "text": "Independently verify this finding from the {{item}} angle. Default to real=false unless you can demonstrate it:\n{{maps.verify_findings.item | json}}" }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["real", "evidence"], "properties": { "real": { "type": "boolean" }, "evidence": { "type": "string" } } } } }
```

```jsonc
// Plan-then-execute — the planner's success edge to report leaves from its expansion node plan~x
{ "key": "plan", "kind": "agent", "prompts": [{ "label": "plan", "text": "Goal: {{variables.goal}}
Plan it as a few steps, each with a precise prompt." }],
  "expands": { "maxStages": 6, "allowedAgentRefs": [], "allowedModels": [], "join": "all" } },
{ "key": "report", "kind": "agent", "session": { "permissionMode": "plan" },
  "prompts": [{ "label": "report", "text": "Report per stage:
{{ stages.plan.expansion.results | json }}" }] }
// edge: plan -> report. A plan the planner outputs:
// { "stages": [{ "key": "api", "name": "API", "prompt": "…" }, { "key": "docs", "name": "Docs", "prompt": "…", "readOnly": false }],
//   "edges": [{ "from": "api", "to": "docs" }] }

// Judge panel — best of N; only the judge's pick is merged (edge panel -> judge)
{ "key": "panel", "kind": "map",
  "map": { "items": "['minimal', 'thorough', 'idiomatic']", "itemKey": "item", "maxItems": 3, "concurrency": 3, "toleratedFailurePercent": 50,
           "workspace": "mount_per_item", "merge": { "mode": "winner", "key": "stages.judge.output.winner" } } },
{ "key": "attempt", "parentKey": "panel", "kind": "agent", "prompts": [{ "label": "attempt", "text": "Solve this task: {{variables.task}}
Take the {{item}} approach." }] },
{ "key": "judge", "kind": "agent", "session": { "permissionMode": "plan" },
  "prompts": [{ "label": "judge", "text": "Score every candidate and pick the best as `winner`.
{{ stages.panel.output.results | json }}" }],
  "output": { "format": "json", "schema": { "type": "object", "required": ["winner", "scores", "rationale"],
    "properties": { "winner": { "enum": ["minimal", "thorough", "idiomatic"] }, "scores": { "type": "array" }, "rationale": { "type": "string" } } } } }
```

```jsonc
// W1 — approval with a form; a timeout completes the wait and routes to escalate
{ "key": "approve", "kind": "wait",
  "wait": { "type": "approval", "prompt": { "label": "Release?", "text": "Approve release {{variables.version}}?" },
            "form": { "type": "object", "required": ["environment"], "properties": { "environment": { "enum": ["staging", "prod"] }, "notes": { "type": "string" } } },
            "timeoutMs": 86400000, "onTimeout": "complete" } }
// edges: approve -> deploy   when stages.approve.output.outcome == 'approved'
//        approve -> escalate on completion, when stages.approve.output.outcome == 'timeout'
// deploy reads {{stages.approve.output.data.environment}}

// W2 — CI posts to the wait's callback URL
{ "key": "wait_ci", "kind": "wait", "wait": { "type": "event", "eventKey": "concat('ci:', stages.push.output.sha)", "timeoutMs": 3600000, "onTimeout": "fail" } }

// W3 — a cool-down
{ "key": "cooldown", "kind": "wait", "wait": { "type": "timer", "durationMs": 600000 } }

// S1 — the child declares outputs: { "verdict": "stages.review.output.verdict" }
{ "key": "security", "kind": "subworkflow",
  "subworkflow": { "workflowRef": { "name": "Security review" }, "inputs": { "target": "stages.build.output.artifactPath" }, "workspace": "isolated" } }
// edge: security -> release when stages.security.output.verdict == 'pass'
```

The loop examples L1–L5 are in [PHASE-05 §3](../../docs/workflow-overhaul/PHASE-05-control-flow.md);
the generated templates carry each of them with complete output schemas.

---

## 8. Source

| What | Where |
|---|---|
| Schemas, scope typing, validator | `packages/workflow-spec/src/schemas/stage.ts`, `validate/scope.ts`, `validate/validateWorkflow.ts` |
| Presets | `packages/workflow-spec/src/presets/index.ts` |
| Loop, map, wait, sub-workflow, expansion decisions | `packages/core/src/domain/scheduler/{loops,maps,waits,subworkflows,expansion}.ts` |
| The plan schema and its JSON Schema | `packages/workflow-spec/src/schemas/expansion.ts` |
| Effects | `packages/core/src/services/engine/{LoopEffects,MapEffects,SubworkflowEffects,WorktreeLeases,WorkflowCallbacks}.ts` |
| Item mounts | `MountService.forkFromSnapshot` (`packages/core/src/services/MountService.ts`) |
| Decisions | `packages/core/src/services/WorkflowApprovalService.ts` |
| Routes | `apps/server/src/routes/workflowRuns.ts` (commands, pending decisions), `workflowCallbacks.ts` |
