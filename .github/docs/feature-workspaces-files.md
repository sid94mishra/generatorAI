# Feature: Workspaces, Mounts & File Management

> A chat's **workspace** is a managed scratch root plus an ordered list of **mounts** — the directories the agent is allowed to edit. The agent's working directory is the primary mount; every other mount and the scratch root are additional directories; change tracking runs per mount through a private shadow git store that never touches the mount's own `.git`.

This replaced the earlier "copy the codebase into the workspace / point cwd at one folder" model in September 2026. Design rationale and the audit that motivated it: [proposals/chat-workspace-model.md](./proposals/chat-workspace-model.md). For projects and codebases see [feature-projects-codebases.md](./feature-projects-codebases.md).

---

## 1. Filesystem layout

```
<workspacesDir>/executions/<ownerId>/          managed root — never a repository for chats
├── source/<alias>/                            worktree and generated mounts only (never in-place ones)
├── scratch/                                   what the agent is told to use for temp scripts, notes, experiments
├── plans/                                     plan documents (PlanService)
├── artifacts/{responses,attachments,stage-responses}/
├── browser/  computer/                        screenshots, DOM dumps, Chromium profile, computer-use captures
├── orchestrator/  tasks/                      orchestrator state and worker scratch
├── .generatorai/                              staged skills / agents (one location, create AND resume)
├── .checkpoints/<alias>.git                   shadow git store per mount (objects, refs, index files)
└── .workspace.json                            manifest: mounts, scratch dir
```

`<workspacesDir>` defaults to `~/.generatorai/workspaces` (`WORKSPACES_DIR`). A mount edited **in place** lives wherever the user's folder is; nothing is ever copied.

---

## 2. Mounts

### The three modes

| Mode | What happens on disk | Used for |
|---|---|---|
| `in-place` | `path = originPath`. Nothing is copied, initialised, configured or committed. If the folder is a git repo and a branch was chosen, the static pre-step checks it out — **refused when the tree is dirty**; a `newBranch` is created from the chosen base. | Local folders (git or plain), git-local codebases without isolation, a folder that contains several repos |
| `worktree` | `git worktree add <root>/source/<alias> [-b <branch>] <base>` from the codebase clone (bare, for git-remote) or the user's own repo. Objects are shared, so the cost is one checkout. `worktreeInclude` files (e.g. `.env`) are copied in. | Git codebases and git folders when the user wants isolation or parallel chats |
| `generated` | An empty managed directory under `source/<alias>` (`git init`-ed) the agent builds a project in. | A chat with no source at all (alias `main`) |

`local-dir` codebases are never copied any more: they mount in place. A git-remote codebase (bare clone) can only be a worktree.

### Multi-repo folders

A folder whose immediate children are repositories mounts as ONE in-place mount; the nested repos are recorded in `git.nested` and each gets its own shadow store, so the Changes tab attributes edits to `<alias>/<sub>` and the parent's gitlink entries are filtered out.

### Entity — `workspace_mounts` (v51)

```
id, workspace_id (FK cascade), position (0 = primary), alias (unique per workspace),
origin_kind 'codebase'|'folder'|'generated', codebase_id?, project_id?, origin_path?,
mode 'in-place'|'worktree'|'generated', path (absolute, what the agent edits),
git JSON { isRepo, branch?, baseRef?, baseCommit?, createdBranch?, nested?[], shadow? },
status 'preparing'|'ready'|'error'|'removed', error?, has_uncommitted_changes, created_at, updated_at
```

`execution_workspaces.prep_status` (`pending|preparing|ready|error`) + `prep_error` gate the first prompt. `chats.sources` / `chats.primary_source` keep the plan the chat was created with.

`workspace_worktrees` (never written by anything) was dropped. Workspaces created before v51 get their mounts **back-filled on first read** from what they had — a bound local folder → in-place mount `.`; legacy `worktrees` rows → worktree mounts; otherwise one `generated` mount at the root. Back-filled mounts carry `git.shadow = false` and keep using their own `.git`, so their existing checkpoints stay valid.

---

## 3. Chat creation and the static pre-step

`POST /api/chats` accepts:

```ts
sources?: Array<
  | { kind: 'codebase'; codebaseId; mode?: 'in-place'|'worktree'; branch?; newBranch?; baseRef?; alias? }
  | { kind: 'folder';   path;       mode?: 'in-place'|'worktree'; branch?; newBranch?; baseRef?; alias? }
>;
primary?: string;   // alias; defaults to the first source
```

The legacy trio (`codebaseIds` + `createWorktree` + `gitRepositories`) is still accepted and mapped onto sources. The CLI: `chat create --codebase alias[:mode[:branch]] --folder path[:mode[:branch]] --primary alias`.

Flow (`ChatManagementService.createChat` → `MountService`):

1. **Plan** — `MountService.plan()` validates every source *before anything is written*: paths exist and are directories, not inside the managed workspaces dir, no overlap between mounts, aliases unique, `branch` exists, `newBranch` does not, `baseRef` resolves, an existing branch requested for a worktree is not already checked out elsewhere. Failures are a `400` with a message the user can act on.
2. Session, workspace (`prepStatus: 'pending'`, `gitEnabled: false`) and `workspace_mounts` rows (`preparing`) are created. The exposure (cwd, additional directories, env, hint) is computed from the planned mounts — paths are deterministic — and the harness conversation is created with it.
3. **Prepare** runs in the background, single-flight per workspace: worktrees are added in parallel, in-place branches switched, shadow stores initialised, nested repos detected, the manifest written, the **baseline checkpoint captured**, then `prepStatus → ready` and a `workspace.prep` event is emitted. Any failure marks the mount and the workspace `error` with the message.
4. `sendPrompt` awaits `MountService.ready(workspaceId)` — resolves immediately once ready, throws the preparation error otherwise. The composer shows "Preparing workspace…" and disables Send until then; on error it offers Retry (`POST /api/chats/:id/workspace/prepare`) and Edit sources.
5. **Resume** (`buildConversationConfig`) derives the identical exposure from the persisted mounts, so a restart, an eviction or a model switch never moves the agent out of its mount.

`PUT /api/chats/:id/sources` replaces the plan of an idle chat (409 `CHAT_BUSY` while a turn runs): unchanged mounts are kept with their checkpoints, the rest removed and the new ones prepared.

---

## 4. What the agent receives

`WorkspaceExposure` (built by `buildExposure`, one function for create and resume):

| Field | Value |
|---|---|
| `workingDirectory` | `mounts[0].path` |
| `additionalDirectories` | every other mount's path + the managed root (scratch, plans, screenshots) |
| `env` | `GENERATORAI_WORKSPACE_ROOT`, `GENERATORAI_SCRATCH_DIR` |
| `hint` | the `[Workspace]` system-prompt block below, appended right after the caller's own system message |

```
[Workspace]
Working directory: C:\dev\shop\frontend  (mount "frontend", git repository, edited in place, branch feature/cart)
Also mounted: C:\dev\shop\backend  (mount "backend", git worktree, branch generatorai/cart-fix-1a2b3c, from origin/main)
Scratch directory: C:\Users\me\.generatorai\workspaces\executions\<id>\scratch
Rules:
- Code changes go in the mounted directories above. …
- Anything that is not a deliverable — plans, notes, experiment scripts, downloads, screenshots, temporary files — goes under the scratch directory, never inside a mounted repository.
- Do not run git checkout/switch/stash/reset in a mount; the user controls branches.
- Do not create files in <root> outside scratch/ and plans/.
```

Per harness: claude-agent passes `cwd` + `additionalDirectories` + allow-listed `GENERATORAI_*` env; codex passes `cwd` from the chat (it used to ignore it) and writable roots where the app-server protocol allows; acp sends `additionalDirectories`; copilot is cwd-only and relies on the hint. Integrated terminal opens at the primary mount. Computer-use screenshots, staged skills (create *and* resume) and browser artefacts always land in the managed root.

---

## 5. Change tracking — shadow stores

Every snapshot command for a mount runs through `IGitClient.withGitDir(<root>/.checkpoints/<alias>.git)`, i.e. `GIT_DIR=<shadow> GIT_WORK_TREE=<mount>`:

- nothing is written into the user's `.git` — no refs, no objects, no `generatorai-*.index` files; a plain folder is tracked without being `git init`-ed, and the user's `user.email` / `user.name` are never touched;
- `objects/info/alternates` points at the origin repository's object store, so unchanged blobs are shared and only the agent's new content costs disk;
- the mount's own `.gitignore` files still apply; `<shadow>/info/exclude` adds `.generatorai/`, `node_modules/` (and build outputs for plain folders);
- `core.autocrlf` is copied from the origin so EOL-normalised trees compare cleanly against real commits (`WriteTreeOptions.honourEol`);
- the shadow store is deleted with the workspace; `CheckpointService.prune` now runs after every durable capture (retention: 100 per repo, 30 days).

`RepoDiscovery.discoverRepos({ mounts })` is the single definition of "which directories are tracked" — shared by checkpoint capture, the Changes tab, the Files tab and the composer's @-mention index — and it no longer scans the managed root or auto-`git init`s anything. `WorkspaceManager.toMountRefs(ws)` produces the list (with shadow dirs and nested repos).

**Baselines.** The baseline checkpoint is captured before readiness is announced. Until it lands (and as the "Branch base" option afterwards) a mount's `git.baseCommit` is the anchor (`ref:<sha>` base selector, EOL-normalised comparison). "Session start" = the baseline checkpoint.

**Restore.** Per-file discard takes repo-relative paths (an `<alias>/` prefix is stripped server-side — it used to make the discard a silent no-op). `turn:<id>` as a base resolves to the turn's *before* checkpoint. `pre_restore` checkpoints are the redo points. A chat **rewind** (`POST /api/chats/:id/rewind`, see [feature-chat.md §2.7](./feature-chat.md#27-rewind-fork-and-copy-transcript)) restores every mount to the turn's *before* snapshot in one server call through `WorkspaceCheckpointService.restoreTurn` — per-mount results, a mount without a snapshot for that turn falls back to its newest earlier one — rather than the per-mount client loop the Checkpoints panel used to run.

Repositories that older versions polluted (`refs/generatorai/**`, `generatorai-*.index` in the user's `.git`, `generatorai/run-*` branches) can be cleaned with `POST /api/fs/scrub-legacy-refs { path, dryRun? }` (refs + index files; branches are the user's to delete).

---

## 6. Lifecycle & disk

| Event | Action |
|---|---|
| Chat archived | after the project's `worktreeRetention` (default 24 h) the worktree **directories** are released (`MountService.releaseWorktrees`, driven by `WorktreeCleanupService`); branches and rows are kept. In-place mounts are untouched. |
| Chat deleted | worktree mounts unregistered from their origin and removed; in-place mounts forgotten, never deleted; shadow stores and scratch root removed |
| Retention sweep (opt-in) | `protectUnpushed` reads `workspace_mounts.has_uncommitted_changes`, refreshed after every turn |
| Unarchive | mounts are re-prepared from `chats.sources` |

Nothing copies a repository any more, so per-chat disk cost is the scratch root plus shadow objects the agent created plus worktree checkouts (shared object store).

---

## 7. APIs

```
POST /api/chats                                  sources[], primary
PUT  /api/chats/:id/sources                      { sources, primary? }         409 CHAT_BUSY while a turn runs
POST /api/chats/:id/workspace/prepare            re-run preparation after an error (202)
GET  /api/chats/:id                              …, sources, primarySource, workspacePrep { status, error? }

GET  /api/workspaces/:id                         …, prepStatus, prepError, mounts[], scratchPath, workingDirectory
GET  /api/workspaces/:id/changes[?base=…]        per mount (kind 'mount' | 'nested'); base: baseline | checkpoint:<id> | turn:<id> | ref:<sha>
GET  /api/workspaces/:id/tree                    git ls-files per mount through the shadow store
GET  /api/workspaces/:id/files                   @-mention index: mounts[], worktrees[] (one per mount, in-place included), workspaceFiles (scratch/plans)
POST /api/workspaces/:id/checkpoints/:cid/restore { paths?: string[] }   repo-relative paths
POST /api/workspaces/:id/changes/review   { keep?: [{alias,path,blob}], unkeep?: [{alias,path}], keepAll?: boolean }   Changes tab "Keep"
POST /api/workspaces/:id/changes/discard  { files?: [{alias,path}], all?: boolean }   per-mount restore from that mount's own base
POST /api/chats/:id/rewind                { turnId, scope }              every mount back to the turn's before-snapshot (+ conversation)

GET  /api/fs/dirs?path=                          directory browser for the source picker (loopback / admin)
GET  /api/fs/git-info?path=                      isRepo, currentBranch, branches, dirty, nestedRepos
POST /api/fs/scrub-legacy-refs                   { path, dryRun? }
```

---

## 8. Edge cases & gotchas

1. **Dirty tree on branch switch** — refused with a `ConflictError`; the chat shows the message with Retry once the user has committed or stashed.
2. **A branch can be checked out in one place** — asking for an existing branch as a worktree while another worktree holds it is a 400 at creation; choose "new branch".
3. **Worktree default branch** — `generatorai/<chat-name-slug>-<id6>`; suffixed `-2`, `-3` if taken. Base = `baseRef` → codebase `defaultBranch` (remote-tracking ref when present) → HEAD.
4. **Preparation survives restarts** — `ready()` re-runs `prepare()` when a workspace is still `pending`/`preparing` and nothing is in flight in this process.
5. **Nested repos are one level deep**, as before.
6. **Legacy workspaces** keep their own `.git` for checkpoints (`git.shadow === false`); their old refs are only removed by the scrub route.
7. **Workflow runs** still use `WorktreeService.createRunWorktrees` and the `worktrees` table; their workspaces are `gitEnabled` and their mounts are back-filled. Migrating workflows onto `MountService` is the next phase.
