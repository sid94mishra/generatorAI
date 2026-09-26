# Pitfalls

<!-- generated:generated-note -->

## Mistakes that fail validation

- **Names instead of keys.** Edges, `parentKey`, `context.from` and expressions use the stage `key`
  (`"from": "code_review"`), never its display `name` (`"from": "Code review"`), and never array indexes.
- **Fields from an older format or another tool.** Every object is strict; an unknown field is `unknown-field`
  with a hint. The common ones:

<!-- generated:renamed-fields -->

- **Shapes from other workflow tools** (seen in the evals):

| Written | GeneratorAI |
|---|---|
| top-level `name`, `inputs`, `parameters` | `workflow.name`, `workflow.variables` |
| `{{inputs.x}}`, `{{params.x}}` | `{{variables.x}}` (or `{{x}}`) |
| `prompt: "…"` or `prompt: {…}` on a stage | `prompts: [{"label": "…", "text": "…"}]` |
| `model`, `agent`, `permissionMode` on a stage | `session: {"model": …, "agentRef": …, "permissionMode": …}` |
| `dependsOn`, `runAfter`, `needs` | `edges: [{"from": "<key>", "to": "<key>"}]` |
| `stages` (or `steps`) nested in a loop or map | separate `stages` entries with `"parentKey": "<loop key>"` |
| `title` | `name` (display) and `key` (identity) |
| `map: {"from": …, "as": "file"}`, `over`, `variable` | `map: {"items": "<expression>"}`; the element is always `item` |
| `"items": "{{stages.scan.output.files}}"`, `"guard": "{{…}}"` | bare expressions: `"items": "stages.scan.output.files"` |
| `maxConcurrent`, `parallelism` | `map.concurrency`, `workflow.maxParallel` |
| `wait: {"prompt": "…"}` | `wait: {"type": "approval", "prompt": {"label": "…", "text": "…"}}` |

- **System variables.** `__workingDirectory`, `repo_path_<alias>` and the like are not variables. Codebase paths
  are `run.codebases.<alias>.path`; the run's id and name are `run.id`, `run.name`.
- **A cycle for a retry loop.** An edge back to an earlier stage is `cycle`. Put the repeated stages in a `loop`
  body (see `control-flow.md`).
- **Reading a stage that has not run.** `stages.<key>` in a guard or prompt must be upstream through edges
  (`expr-stage-not-upstream`). A body stage of a loop is read outside it as `stages.<loop>.output.last.<key>`.
- **Untyped JSON.** Reading `stages.x.output.field` of a text stage, or of a JSON stage without a schema, gives
  a type error or `any`. Give the source `output: {format: "json", schema: {…}}`.
- **String versus number.** `'3' == 3` is false and a type error at save time; there is no arithmetic operator;
  keywords are lower case (`and`, `or`, `not`, `in`, `true`, `false`, `null`).
- **Templates in commands.** `check.args`, hook `command` and `args`, and `run_script` scripts are literals
  (`check-args-literal`, `template-in-command`). Pass values through `env`.
- **Literal secrets.** A token or password in a header, env or key field is `secret-literal` or
  `secret-not-secretref`. Use `secretref:<name>`.
- **A map merge without per-item mounts.** `merge: "sequential" | "pr_per_item"` and `itemSetup` need
  `workspace: "mount_per_item"`.

## Mistakes that validate but misbehave

- **A rejected approval wait does not stop the run.** A `wait` of type `approval` completes with `outcome:
  "rejected"`; without `"when": "stages.<wait>.output.outcome == 'approved'"` on the next edge, the next stage
  runs anyway. Post-processing still commits after it. Gate pushes and PRs with `approval` on the last stage.
- **A failure edge after the approval stage.** `on: "failure"` from the stage whose approval gates the PR turns a
  rejection into a handled failure: the run completes and post-processing pushes.
- **`always` and `completion` edges do not handle failures.** The cleanup stage runs, and the run still fails.
- **A stage behind a skipped stage is skipped.** With the default `join: all`, a stage whose predecessors were all
  skipped is skipped too. Add another edge from a stage that ran, or use `join: {mode: "any"}` to merge branches.
- **Failures pause by default.** `onExhausted` defaults to `pause`: a stage that exhausts its retries parks the
  run for an operator (72 h for unattended runs). Set `onExhausted: "fail"` for unattended workflows, or route
  the failure with an `on: "failure"` edge.
- **Loops that never stop early.** An exit that reads nothing per iteration is an error, but an exit that can
  never become true (a verdict value the schema does not allow, a check that always fails) runs to
  `maxIterations` every time and spends the whole budget. Add an anti-spin rule (`not
  loop.last.signals.workspaceChanged`, `consecutive: 2`, action `exhaust`) and a budget.
- **`maxCostUsd` alone.** It fires only on providers that report cost; add `maxTurns` or `maxTokens`.
- **Parallel writers in one worktree.** A `shared` map with `concurrency` above 1 whose body edits files, or
  parallel branches that edit the same files: the edits race. Use `mount_per_item`, `concurrency: 1`, or make the
  parallel stages read-only.
- **Too much permission.** A reviewer in `acceptEdits` may "fix" what it should report. Read-only stages get
  `permissionMode: "plan"`. Never `bypassPermissions` unless the user asks.
- **Command-bearing fields.** `check` stages, hooks, `onExit`/`onFailure`, `compensate`, `custom_script` rules,
  `run_script` steps, stdio MCP servers, `session.provider` and `bypassPermissions` make the server run
  programs or skip approvals. Saving a workflow that adds or changes one needs `admin:settings`; an agent's draft
  may be refused for it. Add them only when asked, and tell the user.
- **The offline validator is not the whole story.** `scripts/validate.mjs` and `generatorai workflow lint` do not
  know the server's agents, models, sub-workflows or extra allowed commands. Validate with `validate_workflow`
  (or `generatorai workflow validate <file>`) and plan with `plan_workflow` before you submit.
- **Publishing or running your own draft.** Drafts are for a person to review. Do not publish them or run them
  unless the human explicitly asks.

## Every validation code

`validate_workflow` and `scripts/validate.mjs` report these codes. Errors make the document invalid; warnings do
not, but read them.

<!-- generated:validation-codes -->

## Limits

<!-- generated:limits -->
