# Control flow: check, loop, map, sub-workflow, wait, plan-then-execute

<!-- generated:generated-note -->

The engine knows six generic stage kinds and nothing else. Every scenario (fix and review until approved, test
until green, fan out over files, wait for CI) is an ordinary graph built from them; the shipped templates at the
end of this file are exactly that, generated from presets.

Containers (`loop`, `map`) own a **body**: the stages whose `parentKey` is the container's key. A body is a
small graph of its own: its edges connect body stages only, and it is wired to the outside through the
container. A container with no body is `empty-body`.

## check: one deterministic command

<!-- generated:check-fields -->

- The output is `{exitCode, passed, timedOut, stdoutTail, stderrTail, durationMs, json, jsonError}`. By default a
  non-zero exit COMPLETES the stage with `passed: false`, so a loop can read it; `failOnNonZero: true` fails the
  stage instead.
- A command that cannot start (not on the allow-list, not found) fails the stage with `check_launch_failed`, so a
  test-until-green loop cannot spin on a broken command.
- `command` and `args` are literals; templated values go through `env` only (`check-args-literal`).
- A check runs repository code that an agent may just have edited: it is refused when the run's permission mode is
  `plan`, it is the risk flag `runs_repo_code`, and adding or changing one needs `admin:settings`.

<!-- generated:command-allowlist -->

## loop: repeat a body until a rule fires

<!-- generated:loop-fields -->

How an iteration ends:

1. The body runs (iteration k, from 0). A failed body fails the loop (`onBodyFailure: "fail"`), or is recorded in
   `loop.last.failures` and the loop goes on (`"next_iteration"`). A body that failed only by exhausting the
   budget exhausts the loop instead.
2. `carry` is evaluated, all entries at once, each reading the previous carry.
3. Every exit rule is evaluated; a rule fires when it held `consecutive` iterations in a row. When several fire,
   **fail > complete > pause > exhaust**, then array order.
4. No rule fired: the loop exhausts at `maxIterations` or when the budget runs out, else iteration k+1 starts.
5. Exhausting (`exhaust` rules, the iteration cap, the budget) runs `wrapUp` (budget only), then `onLimit`:
   `pause` (the default: an operator grants iterations, raises the budget, continues with input, accepts or
   fails), `fail`, `accept_last`, or `accept_best` (restores the checkpoint of the best `score`).

Which iteration each place sees:

| Place | `stages.<bodyKey>` | `loop.last` | `loop.previous` | `loop.carry` |
|---|---|---|---|---|
| body prompts, guards, edges, check `env` (iteration k) | the body stages upstream of it, in iteration k | iteration k-1 | iteration k-1 | carry after k-1 |
| `carry` (after iteration k) | iteration k | iteration k | iteration k-1 | carry after k-1 |
| `exits[].when`, `onLimit.score`, `output.select` (after k) | iteration k | iteration k | iteration k-1 | carry after k |

- In the templates of iteration 0, `loop.last` and `loop.previous` are null, and so is a carried value without
  `carryInit`. Guard such text with `{{#if loop.previous}}…{{/if}}` and use `followUpPrompts` for "address the
  feedback" turns. `loop.priorCarry` is the carry one step before `loop.carry`.
- An exit rule must read something that changes per iteration: a body stage, `loop.carry`, `loop.last`,
  `loop.history`, `loop.usage` or `loop.iteration` (`exit-unbound`). A loop without exits is `loop-no-exit`.
- Anti-spin exits: `not loop.last.signals.workspaceChanged` with `consecutive: 2` and action `exhaust` stops a
  loop that edits nothing; comparing `loop.carry` with `loop.priorCarry` detects no progress.
- `sessionReuse: "continue"` on a body agent keeps its conversation across iterations; `compactAfter` bounds it.
- The loop's output: `stages.<loop>.output = {iterations, exitReason, exitAction, last: {<bodyKey>: output},
  wrapUp, carry, history, …select}`.
- Always give a loop a `budget` and a small `maxIterations`; the operator can grant more at run time.

```jsonc
{ "key": "green", "kind": "loop", "name": "Until green",
  "loop": { "maxIterations": 6,
            "exits": [ { "when": "stages.tests.output.passed", "action": "complete", "reason": "green" } ] },
  "budget": { "maxTurns": 200 } }
// body: { "key": "fix", "parentKey": "green", "kind": "agent", … }, { "key": "tests", "parentKey": "green", "kind": "check", … }
```

## map: run a body once per item

<!-- generated:map-fields -->

- `items` must type-check to a list: a list variable (`variables.files`), a JSON field (`stages.scan.output.files`)
  or a literal (`['security', 'performance']`). Inside the body, `item` is the element, `map.index`, `map.key` and
  `map.count` describe it, and `maps.<key>.item` is the item of an enclosing map.
- `itemKey` gives each item a stable key (for example `item.path`); duplicates fail the map.
- `workspace: "shared"`: every item works in the run's mounts. Keep shared bodies read-only, or set
  `concurrency: 1`: parallel writers in one worktree is the warning `map-shared-write-concurrency`.
- `workspace: "mount_per_item"`: each item gets its own git worktree cut from a snapshot of the run mounts;
  `merge` brings them back: `none`, `sequential` (a conflict fails that item with `merge_conflict`), or
  `pr_per_item` (a branch per item; the push and PR follow `lifecycle.postProcessing`), or
  `{"mode": "winner", "key": "stages.judge.output.winner"}` (only the item a stage AFTER the map picks is
  merged: a judge panel / best-of-N; the key must read such a stage, `map-winner-unbound`; stages after the judge
  wait for the merge; a key naming no completed item fails the run with `map_winner_failed`). `merge` and
  `itemSetup` need `mount_per_item`. `itemSetup` commands are command-bearing.
- `toleratedFailurePercent` lets some items fail without failing the map.
- The map's output: `{count, results, failures}`; each entry is `{index, key, item, status, error, stages: {<bodyKey>:
  {status, output, summary}}, pr, branch, workdir, …select}` (`workdir`: a mount_per_item item's worktree, where a
  judge reads the candidate's changes).

## subworkflow: run another published workflow as a stage

<!-- generated:subworkflow-fields -->

- The child must be **published** (a draft child is a warning at save and an error at publish and run). Refer to
  it by `name` to stay portable across export and import.
- `inputs` maps the child's variable names to expressions; an input the child does not declare, or a required
  child variable left unset, is `subworkflow-input`.
- `stages.<key>.output` is the child's declared `workflow.outputs`, typed from the child.
- `workspace: "inherit"`: the child works in the parent's mounts and the parent commits; `"isolated"`: a full
  child lifecycle with its own post-processing.
- Sub-workflows nest at most 3 deep, and never in a cycle.

## wait: an approval, an external event or a timer

<!-- generated:wait-fields -->

<!-- generated:wait-outcomes -->

- A wait holds no agent, lease or admission slot. Its output is `{outcome, data, by, at}`.
- `approval`: a person approves or rejects, optionally filling `form` (a JSON Schema; the answer is
  `output.data`). **A rejection completes the wait** with `outcome: "rejected"`: gate the next edge with
  `"when": "stages.<wait>.output.outcome == 'approved'"`, or the next stage runs anyway.
- `event`: waits for `eventKey` (an expression); deliver it with the `deliver_event` run command or by POSTing
  to `stages.<wait>.callbackUrl` (for example from CI). Early events are buffered.
- `timer`: waits `durationMs`.
- `onTimeout: "complete"` completes with `outcome: "timeout"` (route on it); `"fail"` fails with `wait_timeout`.
  An unattended run's wait without `timeoutMs` expires after 72 h.

## Plan-then-execute: an agent plans the stages that run next

An agent stage with `expands` is a **planner**. Its output is a plan (the schema is fixed: do NOT set
`output.schema`, `expansion-output-schema`):

```jsonc
{ "stages": [{ "key": "api", "name": "API", "prompt": "…", "agentRef": "…", "model": "…", "readOnly": true }],
  "edges": [{ "from": "api", "to": "docs" }], "summary": "…" }
```

- `expands: {maxStages (1-20, default 8), allowedAgentRefs, allowedModels, join: "all" | "tolerate"}`. A planned
  stage may only name agents and models from the allow-lists (empty: the defaults only). Planned stages are agent
  stages with one prompt: no hooks, tools, MCP servers, checks or containers; `readOnly` runs one in plan mode; the
  run's permission ceiling applies.
- The engine validates the plan (keys unique and not keys of the workflow, edges between planned keys, no cycle)
  when the planner completes, stores it, and runs the planned stages right after the planner. The stages after the
  planner (its success edges) wait for them and read `stages.<planner>.expansion.results` (each
  `{key, name, status, output, summary, error}`). `join: "all"` fails on a failed planned stage
  (`expansion_failed`); an invalid plan is `expansion_invalid`. A restart never re-asks the planner.
- Add `approval` to the planner to let a person review the plan before it runs. The workflow carries the risk flag
  `plans_stages_at_run_time`.

```jsonc
{ "key": "plan", "name": "Plan", "kind": "agent",
  "prompts": [{ "label": "plan", "text": "Goal: {{variables.goal}}
Plan it as a few steps, each with a precise prompt." }],
  "expands": { "maxStages": 6 } },
{ "key": "report", "name": "Report", "kind": "agent",
  "prompts": [{ "label": "report", "text": "Report per stage:
{{ stages.plan.expansion.results | json }}" }] }
// edge: plan -> report
```

## The shipped templates

Every shipped template is in `examples/` as `template-<name>.json`. The ones that use control flow, with the settings
of their non-agent stages (and of their planners):

<!-- generated:control-flow-templates -->

## Presets (TypeScript builders)

`@generatorai/workflow-spec/presets` exports the functions the templates are generated from. Each returns plain
`{stages, edges}` over the generic kinds; the output is an ordinary graph.

<!-- generated:presets -->

## All examples

<!-- generated:examples-table -->
