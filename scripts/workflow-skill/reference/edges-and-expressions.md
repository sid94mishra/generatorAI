# Edges, joins and expressions

<!-- generated:generated-note -->

## Edges

<!-- generated:edge-fields -->

<!-- generated:edge-on -->

- An edge connects two stage **keys**, at most one edge per pair (`edge-pair`), never a stage to itself.
  The edges must form a DAG (`cycle`); repetition is a `loop` stage.
- Array order of `stages` is display order only; edges decide what runs when. Stages with no incoming edge
  start first; stages with no dependency between them run in parallel (up to `workflow.maxParallel`).
- Edges connect stages of the same scope: two top-level stages, or two stages in the same loop or map body
  (`edge-crosses-scope`). A body is wired to the outside through its container stage.
- `when` is a boolean expression; `false` makes the edge inactive. It may read `parent.status` (the source's
  status) besides the usual roots.

```json
{ "from": "approve", "to": "deploy", "when": "stages.approve.output.outcome == 'approved'" }
```

## How a stage becomes ready

Each predecessor, once terminal, is **active** (an edge from it matches its outcome and its `when` holds),
**neutral** (it was skipped: that path never happened) or **dead** (it ended in an outcome no edge accepts).

<!-- generated:join-fields -->

- `all` (the default): any pending predecessor blocks; a dead one skips the stage (`join_unsatisfiable`);
  otherwise it runs if at least one predecessor is active, and is skipped (`upstream_skipped`) when all are
  neutral.
- `any`: runs on the first active predecessor. Use it to merge alternative branches (success path and failure
  path) into one stage.
- `n_of_m`: runs once `n` predecessors are active; skipped once that can no longer happen.
- `cancelRemaining` cancels the predecessors that only lead here once the join fires.
- The guard is evaluated after readiness: `false` skips the stage (`guard_false`). A skipped stage is neutral
  for its successors, so a chain behind a skipped stage is skipped too unless another active edge reaches it.

## Failures and failure routing

- A failed stage whose outgoing `on: "failure"` edge is active hands over to that edge's target. When the
  target completes, the failure is **handled** and the run can still complete (the `03-failure-branch.json`
  example).
- `completion` and `always` edges still run their targets (cleanup, a notice), but they do **not** handle the
  failure: the run fails anyway, unless the edge sets `handlesFailure: true`.
- An unhandled failed stage fails its scope: a loop iteration, a map item or the run. Before that, a failing
  stage first repairs, retries and routes (see `stages.md`), and by default pauses (`onExhausted: "pause"`).
- An edge `when` or a guard that cannot be evaluated fails the target stage (`condition_error`); it never
  silently skips.

## Expression v2

Expressions appear in `guard`, edge `when`, loop exits and carry, map `items`, sub-workflow `inputs`,
`workflow.outputs` and wait `eventKey`. Templates (`{{ … }}`) appear in prompts, approval prompts, output
instructions, check `env` values, post-processing messages and hook `env`.

Every expression is parsed and **type-checked when the workflow is saved or validated**: variables are typed by
their declaration, `stages.<key>.output` by the stage's output schema. An unknown stage, field or function, a
comparison of a string with a number, or a non-boolean condition is an error, not a runtime surprise.

<!-- generated:grammar -->

### Where each root is available

| Place | Roots |
|---|---|
| guard, prompts, stage hooks, check `env` | `variables`, `run`, `stages` (only stages that run before this one) |
| edge `when` | the same, seen from the source stage, plus `parent` |
| `workflow.outputs`, post-processing | `variables`, `run`, every top-level stage |
| preprocessing steps | `variables`, `run` (no stage has run yet) |
| inside a loop body, and the loop's own fields | also `loop` (and `loops.<key>` of enclosing loops); see `control-flow.md` for which iteration each field sees |
| inside a map body, and the map's own fields | also `item`, `map` (`{index, key, count}`) and `maps.<key>` of enclosing maps |

- Body stages of a loop are not visible outside it; read them through `stages.<loop>.output.last.<key>`.
  Body stages of a map: `stages.<map>.output.results[i].stages.<key>`.
- `stages.<key>` of a stage that has not run yet at that place is `expr-stage-not-upstream`: add an edge (or
  a path of edges) from it first.

### Examples

| Expression | Meaning |
|---|---|
| `stages.review.output.verdict == 'approve'` | a JSON field compared with an enum member |
| `stages.triage.output.severity in ['high', 'critical']` | list membership |
| `len(stages.scan.output.files) > 0` | a list is not empty |
| `count(stages.review.output.comments, c => c.severity == 'blocker') == 0` | no blocker comments |
| `exists(variables.ticket)` | an optional variable was given |
| `coalesce(variables.branch, 'main')` | a default for a nullable value |
| `stages.tests.output.passed` | a check stage passed |
| `parent.status == 'failed'` | in an edge `when`: the source failed |

### Template examples

```jsonc
"text": "Fix {{variables.issue_url}}.\nPlan:\n{{stages.triage.output.plan | bullets}}"
"text": "{{#if loop.previous}}Address: {{loop.carry.openComments | json}}{{else}}First pass.{{/if}}"
"text": "Files: {{ map(stages.scan.output.files, f => f.path) | json }}"
```
