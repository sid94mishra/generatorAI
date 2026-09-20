---
description: Review changes, preserve or undo edits, rewind a conversation, and run commit/push/pull-request flows.
---
# Changes and source control

GeneratorAI separates reviewing a change, restoring files, and publishing source-control history. The **Changes** panel is the shared place to inspect workspace differences; its source-control actions operate on eligible Git mounts.

## Choose the comparison

The **Compare against** picker starts with **Since session start**, then offers relevant branch bases and checkpoint/turn comparisons. A branch-base comparison answers what the current branch adds to its origin; a turn checkpoint answers what changed since a particular conversational point. They are not interchangeable.

Multi-codebase workspaces retain a base for each mount. Browse grouped files or the change tree, expand or collapse diffs, adjust view settings, refresh, and open files in the configured editor. Supported renderers distinguish text differences from previews or unsupported/binary content.

## Review edits

| Action | Effect |
| --- | --- |
| Keep | Mark the current file change as reviewed and move it out of the active review list |
| Unkeep | Return a kept change to the review list |
| Keep all | Mark the currently changed files reviewed |
| Undo file | Restore that file toward the selected mount/base revision |
| Undo all | Restore the changed workspace files toward their bases, with confirmation |
| Comment | Add feedback on a file or selected line range |

Keep is review state, not a Git commit or a permanent promise to accept every future edit to the file. Undo changes files. The restore flow creates a pre-restore checkpoint so that eligible restore actions can themselves be recovered.

Review comments are scoped to a chat or run/stage context. Select a range or use the comment affordance, write feedback, and send the batch through the review bar to the appropriate agent target. Local review feedback is not automatically a posted GitHub review.

## Checkpoints and rewind

Open **Checkpoints & rewind** to inspect snapshots. In a chat, **Rewind to here** is anchored on a user message and refers to the state before that prompt was sent.

| Rewind choice | Restored state |
| --- | --- |
| Restore code and conversation | Files return to the checkpoint; that prompt and later conversation are removed from the active history |
| Restore conversation only | History is rewound while current files remain |
| Restore code only | Eligible files are restored while the conversation remains |

Wait for an active turn to finish or stop it before rewinding. When conversation is restored, the original prompt returns to the composer for editing; it is not automatically resent. If the provider lacks native rewind, the UI explains that a surviving-conversation summary will be provided on the next turn.

Checkpoint restoration covers managed workspace files, not arbitrary external effects. A previously sent webhook or pushed commit does not disappear because a chat is rewound.

## Commit, push, and pull request

Configure a source-control account in **Settings → Source Control**. The panel reports branch, upstream ahead/behind state, available actions, and reasons an operation is blocked. Enter a commit message or generate one from the change. Select Push and, when supported, Open pull request; opening a PR requires a pushed branch, so the UI couples these choices.

The PR form supports title, description, base branch, and relevant options. Generated text is editable. A non-Git directory, missing account, unsuitable remote, or unresolved merge state can disable actions. When a merge conflict is reported, use the conflict actions and inspect the files before continuing or aborting the flow.

These operations intentionally affect Git history and remote repositories. Review the chosen repository, branch, files, and options before triggering the action. Workflow post-processing can perform similar operations when configured; do not assume completion is always review-only.

## Pull-request review

Open a project's **Pull requests** tab and choose an item. The detail screen shows title, author, head/base, description, mergeability, checks, and change counts, with a link to GitHub. **Review in chat** creates a chat on the PR head and asks the selected/default model to review the diff with your optional instructions.

The displayed checks and mergeability are retrieved state, not a local guarantee that merging is authorized. Reviewing in chat does not itself merge or publish a review.

## Source evidence

`apps/web/src/components/diff/ChangesSurface.tsx`, `apps/web/src/components/diff/CheckpointTimeline.tsx`, `apps/web/src/components/diff/review`, `apps/web/src/components/chat/RewindMenu.tsx`, `apps/web/src/components/scm/SourceControlPanel.tsx`, `apps/web/src/components/scm/ScmConflictActions.tsx`, `apps/web/src/pages/PullRequestPage.tsx`, and `packages/shared/src/types/SourceControl.ts`.

## Configuration and worked examples

[Projects And Settings](../configuration/projects-and-settings.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
