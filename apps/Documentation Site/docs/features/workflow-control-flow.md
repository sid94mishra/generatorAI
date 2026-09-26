---
description: Repeat work with loops, fan out with maps, wait for approvals, events and timers, and compose workflows with sub-workflows — all as ordinary stages of the graph.
---
# Workflow control flow

Loops, fan-outs, waits and sub-workflows are **stage kinds** of the workflow graph, not commands. You draw them in the builder (or import them as JSON); they run like any other stage, and you act on them from the run page, the mobile app, the TUI or `generatorai run command`. There are no slash commands or chat commands for any of them.

| Kind | Use it to | Output |
| --- | --- | --- |
| Check | Run one deterministic command (tests, a typecheck) without an LLM | exit code, `passed`, output tails, parsed JSON |
| Loop | Repeat a group of stages until a rule fires (fix and review, test until green, reach a goal) | iterations, exit reason, last iteration, carried values |
| Map | Run a group of stages once per item of a list (per file, per finding, per source) | one result per item, and the failed ones |
| Sub-workflow | Run another published workflow as one stage | the child's declared outputs |
| Wait | Wait for a person's approval, an external event (such as CI) or a timer | outcome, data, who resolved it, when |

The body of a loop or a map is the set of stages whose container is that loop or map. Edges connect stages inside the same body; connect outside stages to the container itself. Containers nest at most three deep.

## Loops

A loop runs its body, then evaluates its **exit rules** in order of precedence (fail, complete, pause, exhaust). A rule can require several iterations in a row (`consecutive`). **Carried values** pass information from one iteration to the next — for example the reviewer's open comments — and later iterations can use **follow-up prompts** that read them. When the loop reaches its maximum iterations or its budget, `onLimit` decides: pause for your decision, fail, accept the last iteration, or accept the best-scoring one (its workspace checkpoint is restored). A wrap-up turn can summarise the work when the budget runs out.

A paused loop shows a decision card: grant more iterations, raise the budget, continue with a message (sent to the next iteration's first stages), accept the last iteration or an earlier one, or fail it.

## Maps

A map evaluates its list when it starts and runs its body once per item, at most `concurrency` items at a time. Inside the body, `item` is the current item (`{{item}}`, `{{item.path}}`), `map.index`, `map.key` and `map.count` describe it, and `maps.<key>.item` reads an enclosing map's item. Each item can have a stable key (`itemKey`), used in the run page and when re-running one item.

- **Shared workspace** — every item works in the run's own mounts. Parallel items that write can collide; make the body read-only or run one item at a time.
- **A worktree per item** (`mount_per_item`) — the map snapshots the run's repositories (uncommitted changes included) and gives each item its own git worktree on its own branch. Setup commands (for example installing dependencies) run in each item's worktree first. Other stages that write to the run's repositories wait while the map runs.
- **Merges** — `sequential` merges each item back into the run's repositories one at a time; a conflicting item fails and its worktree is kept for inspection. `pr_per_item` pushes each item's branch and opens a pull request when the workflow's post-processing settings allow it.

The map fails when more items fail than `toleratedFailurePercent` allows. Its output lists every item with its status, its body stages' results and the fields of the map's per-item `select`.

## Sub-workflows

A sub-workflow stage runs another **published** workflow, referenced by name (portable across export and import) or by id. Its inputs are expressions over the parent's stages and variables. With `inherit`, the child works in the parent's workspace and the parent commits; with `isolated`, the child has its own workspace and post-processing. The stage completes with the child's declared outputs, so later edges can route on them — for example `stages.security.output.verdict == 'pass'`. Cancelling or pausing the parent reaches the child, and every decision the child waits on also appears in the parent's list of pending decisions.

## Waits

- **Approval** — shows a prompt and, optionally, a form. Approving (with the form's data) or rejecting completes the wait; the output records who decided.
- **Event** — waits for an event with a key such as `ci:<commit sha>`. An operator can deliver it from the run page, or an external system can POST to the wait's **callback URL**, which needs no user credential and can deliver only that one event. An event that arrives early is kept until the wait is reached.
- **Timer** — completes after a fixed time.

An approval or event wait can time out: the wait then either fails or completes with the outcome `timeout`, which an edge can route on (for example to an escalation stage). In an unattended run, a wait without a timeout expires after 72 hours.

## Decisions and scopes

Approving, the loop decisions and delivering an event are run-time decisions: they need the `exec:agent` scope, which a default paired phone has. Pausing, resuming, cancelling, retrying, skipping and failing steer the run and need `write:workflows`. The run page's pending-decisions list (and `GET /api/workflow-runs/:id/pending-decisions`) shows every decision of the run and of its sub-workflow children.

## Templates

Every scenario is an ordinary, editable workflow generated from a preset. The system templates include:

| Template | What it does |
| --- | --- |
| Fix and review until approved | Fix and review in a loop until the reviewer approves |
| Test until green | Fix and re-run the tests until they pass |
| Goal loop | Work toward an objective with an audit after every round |
| Refine until it scores | Draft and critique until the score is high enough; keep the best |
| Research until dry | Collect sources until two rounds find nothing new |
| Completeness critic | Work until a fresh critic finds nothing missing |
| Migrate until clean | Plan, migrate files in parallel worktrees, typecheck; repeat until clean |
| Per-file migration | Migrate each file in its own worktree with its own pull request |
| Multi-source research | Research several sources in parallel, then synthesize |
| Adversarial verification | Verify each finding from three angles; confirm on two of three |
| Approval-gated release | Deploy after an approval that picks the environment; escalate on timeout |
| CI-gated deploy | Push, wait for CI to report on the commit, deploy |
| Cool down, then verify | Deploy, wait, verify |
| Security review / Release with a security review | A reusable security review, run as a sub-workflow before a release |

## Source evidence

`packages/workflow-spec/src/schemas/stage.ts`, `packages/workflow-spec/src/presets/index.ts`, `packages/core/src/domain/scheduler/loops.ts`, `packages/core/src/domain/scheduler/maps.ts`, `packages/core/src/domain/scheduler/waits.ts`, `packages/core/src/domain/scheduler/subworkflows.ts`, `packages/core/src/services/engine/MapEffects.ts`, `packages/core/src/services/engine/SubworkflowEffects.ts`, `packages/core/src/services/WorkflowApprovalService.ts` and `apps/server/src/routes/workflowCallbacks.ts`.

## Configuration and worked examples

[Workflows](../configuration/workflows.md), [Templates](../configuration/templates.md), [Workflow builder](./workflows.md), [Workflow runs](./workflow-runs.md).
