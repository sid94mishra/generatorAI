---
description: Follow workflow execution, review stage output, inspect artifacts, and recover safely from failure.
---
# Workflow runs

A run captures one execution of a workflow definition. It has its own status, stage results, workspace, activity stream, and input context. Open a definition's **Recent Runs**, follow an automation iteration, or start a new run to reach the run screen.

## Start a run

Every client starts a run the same way — the web and desktop **Run** dialog, the phone's start sheet, `generatorai run start`, a script, an automation, the SDK and the MCP server all send one invocation request to `POST /api/workflow-invocations`, and every run goes through the same lifecycle (workspace, codebase mounts, uploads, project configs, preprocessing, sandbox; then compensation, hooks, commit/push/pull request, release) whoever started it.

The Run dialog offers:

| Section | What it sets |
| --- | --- |
| Variables | The workflow's inputs; names starting with `__` are refused |
| Stages | Always shown: skip a stage, give it extra variables, pick its model for this run |
| Run options | Model, reasoning effort, permission mode (the deployment default when left alone), run name, "stop after N minutes" |
| Codebases | The project codebases to mount, each on a branch or ref you choose; pre-selected from the workflow's saved selection, never every codebase |
| Files | Skills, agents and prompts uploaded for this run |
| Plan preview | What the run will do before it starts: stages by layer, skipped stages, codebases, post-processing and warnings |

Each press of **Start** carries its own idempotency key, so a double click starts one run. A refused start explains why inside the dialog. `generatorai run plan` prints the same plan from the terminal.

## Read the run screen

The header shows status and available run actions. The pipeline summarizes stages and parallel activity. The central timeline exposes prompts, reasoning/tool steps, output, and gates; the optional graph gives a dependency-oriented view. Select a stage to focus the inspector and its details.

The run workspace dock includes Changes, Files and individual file tabs, Inspector, Browser, Terminal, and Widget surfaces. Unlike chat, a workflow run's primary extra surface is the stage inspector. See [Workspace panels](./workspace-panels.md) for the common panel behavior.

| Inspector tab | What to inspect |
| --- | --- |
| Files | Files attributed to the selected stage and their change kinds |
| Output | Structured stage output and other surfaced result data |
| Hooks | Hook execution status and related details |
| Tools | Tool steps associated with the stage |

The shared artifact browser supports produced artifacts and their metadata. A file listed as modified is evidence of an edit, not evidence that it meets the task's acceptance criteria. Open the diff and examine test or validation output.

## Run controls

| Action | Use |
| --- | --- |
| Pause | Stop the active run; in-flight stages stop and resume their conversation later |
| Resume | Continue a paused run or a paused stage |
| Cancel | Stop the run or one stage |
| Retry failed | Fork a failed or cancelled run: a new run re-runs every stage that did not complete and copies the completed ones; the previous record stays as it ended |
| Stage retry | Start a new attempt of a paused stage in a live run |

Every control is a run command (`POST /api/workflow-runs/:id/commands`). Controls are state-dependent; the run moves through created, starting, running, waiting (nothing to run until a person or a timer acts), paused, finalizing, cancelling and a terminal state. A cancellation first entering **Cancelling** is not proof that all children have already exited. Inspect final state and workspace effects.

Retries and recovery are not universal transaction rollback. A hook, command, file edit, or external request may already have happened. After a restart, a stage whose interrupted step may have changed the workspace is paused for you instead of being re-run; a stage whose settled steps can be replayed continues on its own.

## Review a stage

An approval-required stage shows inline human-review controls. **Approve & continue** accepts the result; request changes to supply feedback for revision; terminal **Reject** fails the reviewed stage without retrying it. Stages that require its success are blocked, but configured `on_failure`, `on_completion`, or `always` edges may still allow other stages to run. Rejection is therefore not equivalent to cancelling the whole run. Review the selected stage's files and output before deciding. [Interaction guide](./interactions.md) explains why stage review, plan approval, and tool permissions are separate gates.

## Diagnose a failed run

1. Identify the first failing stage or processing phase.
2. Read its tool, hook, and validation details.
3. Confirm source preparation, provider readiness, variable values, and credentials.
4. Inspect files and checkpoints before retrying work that may already have changed them.
5. Choose stage recovery or a new run according to the available action and the corrected configuration.

The historical timeline can replay persisted output after navigation or reconnect. It should be used together with current run state; a successfully rendered old answer does not imply a newly started provider process has finished.

## Example acceptance path

For a brownfield change, use stages for source analysis, implementation, independent tests/review, and consolidation. Put a review gate before any configured publish step. Verify each stage's result rules, the actual test output, generated artifacts, and final diff. This is a suggested use of shipped controls, not a pre-executed example run bundled with these docs.

## Source evidence

`apps/web/src/pages/WorkflowDefinitionPage.tsx`, `apps/web/src/pages/WorkflowRunPage.tsx`, `apps/web/src/components/workflow/RuntimeDAGCanvas.tsx`, `apps/web/src/components/workflow/redesign/RunHeaderBar.tsx`, `apps/web/src/components/workflow/redesign/RightInspector.tsx`, `apps/web/src/components/workflow/redesign/InlineHitlControls.tsx`, `apps/web/src/components/artifacts/ArtifactBrowser.tsx`, and `packages/workflow-spec/src/state/workflowRun.ts`.

## Configuration and worked examples

[Workflows](../configuration/workflows.md), [Examples](../configuration/examples.md), [Control flow and decisions](./workflow-control-flow.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
