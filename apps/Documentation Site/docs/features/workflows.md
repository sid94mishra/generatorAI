---
description: Design reusable stage graphs with typed variables, controlled context, approval gates, validation, and lifecycle hooks.
---
# Workflow builder

A workflow definition is a reusable directed acyclic graph (DAG). Its stages contain prompts and execution policy; edges determine when downstream stages become eligible. A workflow run is a separate execution record created from a definition and inputs.

## Build a workflow

1. Open **Workflows → New Workflow** and name the definition.
2. Add stages, select each stage, and configure its properties.
3. Connect stages to express dependencies and success/failure behavior.
4. Open **Workflow settings** for project sources, variables, session allocation, workflow hooks, and tags.
5. Use **Validate DAG**, resolve reported errors, and save.
6. Open the saved definition and choose **Run workflow**. Supply required variables before starting.

The builder includes undo/redo, a collapsible stage properties panel, and an unsaved-changes prompt. Saving the definition and starting a run are distinct actions.

## Sessions and graph behavior

| Mode | Meaning |
| --- | --- |
| Single Session | All stages share one agent session and execute sequentially |
| Per-Stage Sessions | Every stage has its own agent session; independent branches can run in parallel |
| Auto | Resolved once at run start: any parallel branch selects per-stage sessions; otherwise the run uses one shared session |

Edge types in the contract are `on_success`, `on_failure`, `on_completion`, and `always`. Stage conditions can be always, on success, on failure, or an expression. A graph must remain acyclic; adding a visual connection is not equivalent to writing a loop. Iterative sub-workflow execution is represented separately in the advanced stage contract.

## Stage properties

| Section | Controls |
| --- | --- |
| Basic | Name and description |
| Model & Template | Template, model/runtime overrides, reasoning effort, agent binding where supported |
| Prompts & Context | Inline or file-based prompts and prompt editor |
| Skills | Stage-selected skill context |
| MCP Servers | Stage-selected registered servers |
| Variables | Values specific to the stage |
| Execution | Condition, expression when relevant, timeout, predecessor context filter, approval required |
| Retry Policy | Retry enablement, maximum retries, backoff milliseconds, multiplier |
| Result Validation | Rules against the result and messages explaining failures |
| Hooks | Phase, type, configuration, failure policy, retries, timeout, and ordering |

The context contract supports full, summary-only, none, and structured predecessor context. Explicit context sources can override direct graph predecessors. An empty explicit list means no predecessor context, not “all stages.” JSON output/schema and iterative sub-workflow mappings are advanced contracts; use source/API reference rather than assuming every field has a corresponding visual editor control.

## Variables and sources

Workflow variables are typed as string, number, boolean, choice, or text, with label, description, required flag, default, and choice options. Prompts use `{{variableName}}` interpolation. Configure a project and selected codebases when the workflow needs repository access, and choose worktree isolation according to the desired execution environment.

A run's supplied values and per-stage overrides are execution inputs. Changing a definition later should not be confused with editing an already completed result. [Script workflows](./workflow-scripts.md) provide a code-first way to manage more elaborate definitions and profiles.

## Validation and hooks

The visual result-rule editor exposes contains, not-contains, minimum/maximum length, regular expression, and custom script checks. Shared orchestration contracts additionally define `json_schema` and `llm_validation`, but their current implementation is limited: `json_schema` parses JSON and checks top-level key presence, while `llm_validation` uses a minimum-output-length heuristic and does not call a model judge. Do not use these names as a guarantee of full JSON Schema compliance or semantic review. A text check does not establish that generated code compiles or passes tests.

Hooks can execute a script, call HTTP, or invoke a function implementation. Stage hooks cover prompt/tool/session and other lifecycle phases; workflow hooks cover run start/completion/failure/cancellation, stage transitions, parallel joins, and processing boundaries. Hook failures can abort, skip, or continue according to policy. A user cancellation has its own event and should not be handled only as a generic error.

Advanced orchestration configuration also includes preprocessing, result validation, and post-processing such as scripts, commits/pushes, and pull-request creation. These actions have real effects and need deliberate configuration. See [configuration reference](../reference/configuration.md) and [Workflow runs](./workflow-runs.md).

## Source evidence

`apps/web/src/pages/WorkflowBuilderPage.tsx`, `apps/web/src/components/workflow/DAGCanvas.tsx`, `apps/web/src/components/workflow/StagePropertiesPanel.tsx`, `apps/web/src/components/workflow/WorkflowConfigPanel.tsx`, `apps/web/src/components/workflow/settings`, `packages/shared/src/types/WorkflowDefinition.ts`, `packages/shared/src/types/StageDefinition.ts`, `packages/shared/src/types/HookDefinition.ts`, `packages/shared/src/types/WorkflowOrchestrator.ts`, and `packages/core/src/services/ResultValidator.ts`.

## Configuration and worked examples

[Workflows](../configuration/workflows.md), [Templates](../configuration/templates.md), [Examples](../configuration/examples.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
