---
title: Workspaces and source control
description: Projects, multiple source mounts, worktrees, checkpoints, review anchors, and remote pull requests.
---

# Workspaces and source control

A project is reusable organization and configuration. An execution workspace is the concrete filesystem context for a chat or run. A mount identifies one directory the agent may work with. Keeping these separate enables a chat to work with several codebases without pretending the project directory itself is an isolated execution environment.

## Project and codebase layer

`ProjectService` manages project records and project-level folders. `CodebaseService` handles attached codebases; `ProjectConfigService` manages configuration assets. `WorktreeService` supports run-oriented worktrees, while the newer `MountService` materializes chat sources through a common mount model.

Project configuration can include skills, prompts, agent definitions, and MCP configuration. Those assets are resolved into execution configuration; merely attaching a project does not mean every stored artifact is enabled for every agent.

## Source modes

| Mode | Files the agent edits | Git behavior |
| --- | --- | --- |
| In-place | The selected existing directory | No copy or initialization; an explicit branch switch is validated and refuses a dirty tree |
| Worktree | A new checkout under the managed workspace's source directory | Uses `git worktree add`; shares object storage with its repository |
| Generated | Empty managed source directory | Provides a place for new output; checkpoint tracking uses the private shadow store |

Each mount has an alias, position, source/origin metadata, and execution path. A primary mount selects the default working directory. Additional mount roots must be passed through provider-supported filesystem configuration and application tools; support is not assumed uniform across harnesses.

`MountService` plans and validates before materialization. The public source choice and the directory actually sent to the provider should remain traceable in workspace metadata.

## Workspace lifecycle

`WorkspaceManager` is the central workspace lifecycle service. It serializes concurrent create attempts per owner, tracks artifact relationships, resolves safe paths, and coordinates archive/delete cleanup.

Native resources are released before storage cleanup. The directory is removed before its authoritative metadata is discarded; a busy or otherwise undeletable tree retains its row so a later retry can find it. Worktrees must also be unregistered from their parent repository rather than simply leaving stale git worktree metadata.

Retention policy is separate from manual archive/delete and separate from stream-event retention. `WorkspaceRetentionService` and `WorktreeCleanupService` own those cleanup concerns.

## Local git, changes, and remote source control

Three packages deliberately separate responsibilities:

```text
@generatorai/git
    low-level local git operations and process execution
          │
          ├─ @generatorai/changes: status, tree, versions, patches, summaries
          ├─ @generatorai/checkpoints: private snapshot refs and restoration
          └─ core source-control flow: readiness, commit, push, PR coordination

@generatorai/source-control
    remote host provider operations (currently GitHub)
```

GitHub remote-host integration is not the same as local git support. `SourceControlRegistry` selects configured accounts/hosts; `GitHubProvider` supplies repository and pull-request operations. `providerFactory.ts` currently implements GitHub only. The abstraction does not mean GitLab/Bitbucket providers already exist.

`SourceControlFlowService` combines repository readiness, explicit flow steps, generated commit/PR text and provider operations. `AutoSourceControlRunner` performs configured post-turn behavior. These flows need a suitable repository, credentials, remote and permissions; a diff alone does not imply a pushable branch or an existing PR.

## Changes and files

`ChangeSetService` and `ChangeSummaryService` centralize file status and revision comparison across mounts. `WorkspaceTreeService` supplies tree and file reads. This avoids each client independently invoking git or interpreting source aliases.

The change API can return summaries before full file content/patches, with bounded file and patch sizes. Clients should represent a truncated/large/binary file explicitly rather than interpreting absent text as an empty file. Repo discovery excludes nested repository paths appropriately so a parent does not count another mount's files twice.

## Checkpoints

Every mount has a workspace-private shadow git store under `.checkpoints/`. Capturing state does not write checkpoint refs, objects, or indexes into the user's own `.git`, and it can track an ordinary directory without running `git init` inside that directory.

`CheckpointService` creates, lists, diffs, restores and prunes snapshots. `WorkspaceCheckpointService` captures a logical moment across all mounts, including turn/stage provenance. A restore returns per-mount outcomes; one failed mount must not falsely make every mount look restored.

Checkpoint restore changes files. Provider conversation rewind changes provider history. A user-facing rewind may coordinate both, but the two mechanisms have different capability and failure boundaries. A file-only undo should not be described as deleting all conversation history.

## Review state and inline feedback

`ReviewThreadService` stores comments anchored to workspace file revisions. `AnchorResolver` maps positions through patches, hashes anchors and detects overlap/stale positions. `ReviewPromptSerializer` converts review feedback into agent-readable context.

Per-file reviewed/kept state is stored separately in `workspace_file_reviews`. It should describe the reviewed content/revision, not merely that a path was visited once. Changes after a review require a fresh comparison before treating that file as already accepted.

An inline review, a checkpoint, a git commit, and a pull-request review are distinct artifacts. Keeping their IDs and revision bases explicit prevents a client from applying a comment or undo against the wrong state.

## Source evidence

`packages/core/src/services/ProjectService.ts`, `CodebaseService.ts`, `ProjectConfigService.ts`, `WorkspaceManager.ts`, `MountService.ts`, `WorktreeService.ts`, `WorkspaceCheckpointService.ts`, and `services/scm/`; `packages/git/src/`; `packages/changes/src/`; `packages/checkpoints/src/`; `packages/review/src/`; `packages/source-control/src/`; `packages/db/src/repositories/WorkspaceFileReviewRepository.ts`.

Related: [Data and storage](./data-and-storage.md), [Execution](./execution.md), and [Feature guides](../features/index.md).
