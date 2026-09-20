---
description: Resolve plans, structured questions, and tool permission requests without confusing their different effects.
---
# Plans, questions, and permissions

GeneratorAI represents human interaction as durable server records. A pending request can appear in more than one connected client; answering it resolves the shared interaction rather than creating separate approvals for each screen.

## Plan mode

Select **Plan** in the chat composer when you want an implementation proposal before changes. The mode applies a planning permission policy and a blocking review gate. **Auto** can still record a plan, but its recorded plan is informational and does not create the same approval pause.

When a plan is ready, open its transcript card or the **Plan** dock tab. The plan surface presents a Markdown document, revisions, editing, comments, and available decision actions. You can save a tracked copy into the workspace. A saved document and a review decision are separate actions.

| Decision | Effect |
| --- | --- |
| Request changes with feedback | Return the proposal for revision while retaining review history |
| Approve an available implementation action | Authorize the selected continuation policy |
| Exit/discard without implementing | Leave plan mode without authorizing implementation of the proposal |

The domain supports `exit_only`, `implement_interactive`, and `implement_autopilot`; the visible actions are constrained by what the provider and current plan expose. A plan's states include drafting, recorded, awaiting review, changes requested, approved, rejected, superseded, and expired. A cancelled turn or restarted server can expire a gate; an expired card cannot be treated as a new approval request.

## Structured questions

A question card may contain multiple questions, choices with descriptions, multi-select answers, and an **Other** freeform answer. Answer the actual questions and submit the card to unblock the agent. The provider contract determines whether a question has predefined choices or only free text.

The card records answered or expired state. A normal chat message is not always a substitute for resolving a structured gate; the composer identifies when a pending interaction blocks sending. Auto mode deliberately does not open the same blocking question gate as Plan mode.

## Tool permissions

A permission card identifies the tool, action category, description, and bounded input summary. Categories include file reads, file writes, shell execution, network access, and other operations. Choose Allow or Deny; a denial can include a message the agent receives.

Permission records are shared across clients and can expire. A grant is not proof that the tool succeeded; inspect its subsequent output. Agent capabilities, device scopes, server restrictions, provider permission modes, and OS permissions remain relevant even when one prompt is allowed.

## Workflow stage review

Workflow completion review is a different gate from a chat plan. A stage configured for approval pauses at its review boundary. The run's inline controls offer:

- **Approve & continue**, accepting the stage result.
- A changes-request action that returns feedback for another attempt.
- **Reject**, a terminal decision that fails the reviewed stage without retrying it. Stages that require its success are blocked, while configured `on_failure`, `on_completion`, or `always` edges may still allow other stages to run.

The approve action does not treat text in the feedback box as an instruction to revise. Choose the revision action when that is the intended result. Terminal rejection has its own confirmation. See [Workflow runs](./workflow-runs.md).

## Source evidence

`packages/shared/src/types/AgentMode.ts`, `apps/web/src/components/chat/PlanDocumentPanel.tsx`, `apps/web/src/components/chat/PlanCard.tsx`, `apps/web/src/components/chat/QuestionCard.tsx`, `apps/web/src/components/chat/PermissionCard.tsx`, and `apps/web/src/components/workflow/redesign/InlineHitlControls.tsx`.

## Configuration and worked examples

[Chats](../configuration/chats.md), [Examples](../configuration/examples.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
