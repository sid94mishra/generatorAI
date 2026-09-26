# The run lifecycle: variables, codebases, pre- and post-processing, hooks, budgets

<!-- generated:generated-note -->

A run goes through one lifecycle, whoever starts it (the app, the CLI, an automation, a chat, an MCP client):

- **starting**, in order, each phase journalled (a crash resumes at the phase that did not finish):

<!-- generated:prepare-phases -->

- **running**: the stages.
- **finalizing** (or cancelling), in order:

<!-- generated:finalize-phases -->

## Variables

<!-- generated:variable-fields -->

<!-- generated:forbidden-variables -->

- Reference a variable as `variables.<name>` in expressions, or `{{name}}` / `{{variables.name}}` in templates.
- `required: true` with no `defaultValue` means every run must supply it; a variable that is neither required nor
  defaulted is nullable in expressions (test it with `exists(variables.x)` or `coalesce`).
- A `choice` variable needs `options`; `list` is a list of strings (a map can fan out over it); `json` is any JSON.
- Never ask for secrets as variables. Tokens and keys are `secretref:` references in the fields that take them,
  each into its own namespace (`secret-namespace` otherwise): `secretref:workflow/<name>` in check, hook and
  `custom_script` env and http hook headers; `secretref:mcp/<system|project|custom>/<server id>/<name>` (that
  server's own credentials, the server keyed by its catalog id) in MCP headers and env;
  `secretref:provider/<name>` in `session.provider.apiKey`. A remote MCP server or http hook carrying one needs
  admin rights to add or change (a command-bearing field).

## Codebases and worktrees

<!-- generated:lifecycle-fields -->

- The run mounts the codebases the run request names, else `lifecycle.codebaseAliases`; never every codebase of
  the project. With `requiresCodebase: true` a run without one is refused.
- `useWorktree: true` (the default) gives the run its own worktree per codebase, on its own branch, so the
  user's checkout is never touched. `in_place` mounts need `admin:settings` at run time.
- Stages read a codebase's location as `run.codebases.<alias>.{path, branch, baseRef}`; never as a variable.
- Worktrees are not deleted when a run ends; retention reclaims them.
- `sandbox: "required"` fails the run if the deployment's sandbox cannot start; `"optional"` runs on the host.

## Preprocessing

`lifecycle.preprocessingSteps` run before any stage: `clone_repo`, `run_script` (command-bearing), `validate_input`
(rules on a variable), `set_variable` (a template) and `conditional` (an expression over variables, with then and
else steps). Prefer `validate_input` to check inputs early; avoid `run_script` unless the user asks for it.

## Post-processing: commits, pushes and pull requests

- `autoCommit` commits the run's changes when the run **completes**; `autoPush` pushes the work branch;
  `autoCreatePR` opens a pull request (it implies commit and push).
- `steps` add explicit `commit_and_push`, `create_pr` or `run_script` steps (messages and titles are templates).
- A failed or cancelled run commits nothing. So the safe gate before a push or PR is `approval` on the last stage:
  a rejection fails the run (see `stages.md`). Do not add an `on: "failure"` edge from that stage, or a rejection
  becomes a handled failure and the run completes and pushes.
- A sub-workflow with `workspace: "inherit"` skips its own post-processing; the parent commits.
- Tell the user, before submitting, whether the workflow commits, pushes or opens a PR.

## Hooks, onExit and onFailure

Hooks run a `script`, an `http` call or a `function` at a lifecycle phase. They are command-bearing: saving a
workflow that adds or changes one needs `admin:settings`. Add them only when the user asks.

- `failurePolicy`: `abort` fails the owner, `skip` (the default) ignores the failure, `continue` logs and proceeds.
- `type` must equal `config.type` (`hook-type-mismatch`); hook ids are unique per list.
- Script hooks take literal `command` and `args`; values go through `env`.
- `workflow.onFailure` actions run when the run finalizes as failed, then `workflow.onExit` actions run whatever
  the outcome.

Stage hook phases (`stages[].hooks[].phase`):

<!-- generated:stage-hook-phases -->

Workflow hook phases (`workflow.hooks[].phase`):

<!-- generated:workflow-hook-phases -->

## Budgets

<!-- generated:budget-fields -->

- `workflow.budget` caps the whole run: when it is exhausted, no new stage starts and the run pauses
  (`budget_exhausted`) for an operator.
- A stage `budget` caps one stage; a `loop` or `map` budget is cumulative over its iterations or items; a
  `subworkflow` budget is the child run's share.
- Exhausting a budget never counts as success. `maxCostUsd` only fires on providers that report cost; pair it
  with `maxTurns` or `maxTokens` (see `agents-and-models.md`).
- `workflow.maxParallel` bounds the stages running at once (engine default 4).

## Outputs, tags and project

- `workflow.outputs` names results as expressions over top-level stages (`{"verdict":
  "stages.review.output.verdict"}`). A parent workflow reads them through a `subworkflow` stage's output.
- `tags` are free labels; `projectId` ties the workflow to a project (null or omitted: global). The draft tools
  set the project from the caller when you omit it.
