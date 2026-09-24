---
description: Follow workflow execution, review stage output, inspect artifacts, and recover safely from failure.
---
# Workflow runs

A run captures one execution of a workflow definition. It has its own status, stage results, workspace, activity stream, and input context. Open a definition's **Recent Runs**, follow an automation iteration, or start a new run to reach the run screen.

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
| Pause | Request a pause on an active run |
| Resume | Continue an eligible paused run |
| Cancel | Request termination of an active or paused run |
| Retry | Start a new run from an eligible failed run; the previous record remains terminal |
| Stage retry | Retry an eligible stage through its stage action |

Controls are state-dependent. The UI distinguishes pending/starting, running, paused, cancelling, cancelled, completed, and failed. A cancellation request first entering **Cancelling** is not proof that all children have already exited. Inspect final state and workspace effects.

Retries and recovery are not universal transaction rollback. A hook, command, file edit, or external request may already have happened. For example, a hook that posts a notification can repeat if its relevant stage is retried. Design such hooks with the expected retry semantics.

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

`apps/web/src/pages/WorkflowDefinitionPage.tsx`, `apps/web/src/pages/WorkflowRunPage.tsx`, `apps/web/src/components/workflow/RuntimeDAGCanvas.tsx`, `apps/web/src/components/workflow/redesign/RunHeaderBar.tsx`, `apps/web/src/components/workflow/redesign/RightInspector.tsx`, `apps/web/src/components/workflow/redesign/InlineHitlControls.tsx`, `apps/web/src/components/artifacts/ArtifactBrowser.tsx`, and `packages/shared/src/types/WorkflowRunStateMachine.ts`.

## Configuration and worked examples

[Workflows](../configuration/workflows.md), [Examples](../configuration/examples.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
