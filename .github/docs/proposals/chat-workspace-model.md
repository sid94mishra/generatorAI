# Proposal: Chat workspace model — mounts, scratch isolation, checkpoints

Status: **approved and implemented for chats** (2026-09-06, all recommended options taken). The living reference is now [feature-workspaces-files.md](../feature-workspaces-files.md); this document keeps the audit and the rationale. Workflows (Phase 7) are still on the legacy worktree path.

This document has three parts:

1. **What the code does today** — verified against the working tree, with file:line references. Not what the docs say.
2. **Target architecture** — one model that covers every linking scenario without copying repositories or polluting them.
3. **Implementation plan** — phases, schema, API, UI, harness changes, tests, and the open decisions I need from you.

---

## Part 1 — Current state (verified)

### 1.1 The two roots

Every chat gets a managed workspace at `~/.generatorai/workspaces/executions/<chatId>` (`WorkspaceManager.ts:241`). It is created eagerly for every chat (`ChatManagementService.ts:1408-1460`), `git init`-ed, and given this skeleton (`WorkspaceManager.ts:979-998`):

```
<ws>/  source/  output/  artifacts/{stage-responses,attachments}/  scripts/  config/{agents,prompts,skills,mcp}/
       .git  .gitignore  .workspace.json
```

The agent's working directory is a single value, `getWorkingDirectory(ws) = ws.codeRoot ?? ws.rootPath` (`WorkspaceManager.ts:309-311`). `codeRoot` is written from exactly one place: the "Local Folder Path" text box in the create-chat dialog, passed as `gitRepositories[0].url` (`ChatManagementService.ts:1413,1439`).

### 1.2 What each linking scenario actually produces

| Scenario | On disk | Agent cwd (first turn) | Agent cwd after restart / model switch |
|---|---|---|---|
| Project + git-local codebases (any "worktree" setting) | `git worktree add <ws>/source/<alias> -b generatorai/run-<id8>-<alias>` from the **user's own repo** — a branch and a `.git/worktrees/` entry appear in their repo | `<ws>/source/<firstAlias>` — first in **checkbox click order** (`:1476-1484`) | **`<ws>`** — the managed root, one level above the worktree (`:1964-1974`) |
| Project + git-remote codebase | same, from the managed bare clone | same | same bug |
| Project + local-dir codebase | **full recursive `fs.cp`** of the folder into `<ws>/source/<alias>`, including `node_modules` and `.git` (`WorktreeService.ts:289-290`); never copied back | the copy | `<ws>` |
| Local folder (text box) | `git init` + **`git config user.email/user.name` rewritten in the user's repo** + a "GeneratorAI baseline" commit of everything if the folder had no commits (`WorkspaceManager.ts:1034-1062`) | the folder | the folder (this path survives) |
| Local folder **and** codebases | worktrees are still created and branches made; the agent never sees them; checkpoints resolve worktree paths against the local folder | the folder | the folder |
| No project, no folder | skeleton only | `<ws>` | `<ws>` |

Key facts behind the table:

- `createWorktree` / `useWorktree` do not gate anything. The gate is `projectId && codebaseIds.length` (`ChatManagementService.ts:1469`). `chats.use_worktree` is never written or read; `toDomain` hardcodes `createWorktree: undefined` (`ChatRepository.ts:248`). Two callers rely on `createWorktree:false` and are silently wrong (`acp-entry.ts:123`, `OrchestratorService.ts:427`).
- Worktree creation is fire-and-forget. `waitForWorktree` (`:1305`) has zero callers. The first prompt can run in a directory that does not exist yet; failures are `console.warn`.
- There is no branch choice anywhere. Base ref = `origin/<defaultBranch>` if it resolves, else `<defaultBranch>`, else HEAD (`WorktreeService.ts:62-71`). Branch name is always `generatorai/run-<chatId8>-<alias>`.
- Other codebases in a multi-codebase chat get **no exposure**: no `additionalDirectories`, no symlink, no prompt hint. They are reachable only if the model guesses `../<alias>`.
- `workspace_worktrees` has **no writer** (`trackWorktree` is dead, `WorkspaceManager.ts:355-380,729-731`). The live table for chats is the legacy `worktrees` table (`runType='manual'`). `protectUnpushed` reads the empty table, so retention cannot protect unpushed work (`:858-859`).
- CLI `--codebase` is stripped by validation and does nothing (`cli-core/src/commands/chat.ts:277-279`).

### 1.3 How each harness receives the directory

| Harness | cwd | Extra directories | Verdict |
|---|---|---|---|
| claude-agent | `options.cwd = config.workingDirectory ?? defaultCwd` (`ClaudeAgentProvider.ts:2300`) | never set; SDK supports `additionalDirectories: string[]` | cwd correct, multi-repo blind |
| copilot | per-session `workingDirectory` (`CopilotProvider.ts:1042`), one CLI process per cwd | none in SDK | cwd correct |
| codex | **`cwd: this.opts.defaultCwd`** on `thread/start` and resume (`CodexProvider.ts:595,604`) | none | **ignores the chat's directory entirely**; every Codex chat runs in `~/.generatorai/artifacts` with `workspace-write` sandbox scoped there |
| opencode | `spawn()` with **no `cwd`** (`:248`); session body `{ title }` only | none | **inherits the server process cwd** — can edit the GeneratorAI repo itself |
| acp | `buildSession(params.workingDirectory ?? defaultCwd)` (`:440`) | protocol supports `additionalDirectories`, never sent | cwd correct |
| sub-agents (Claude `agents`, orchestrator workers) | inherit parent cwd | — | fine |

`defaultCwd` for every provider is `~/.generatorai/artifacts` (`composition-root.ts:359,372`) — also where all sessions' uploaded attachments live, so a workspace-less chat's shell can read every other chat's attachments.

### 1.4 What the agent is told

Nothing. There is no system-prompt block that names the working directory, the scratch directory, or where plans, scripts, screenshots or temporary files should go (`chatSystemHints.ts` contains no paths). The only path guidance is the orchestrator prompt's cwd-relative `orchestrator/plan.md` (`orchestrator/prompts.ts:77`), which lands in the user's repo when a folder is linked, and the worker brief's absolute task directory. No environment variable carries a workspace path to any harness (`childEnv.ts:44-61` allowlist).

### 1.5 Where in-process tools write

Root `M` = managed workspace root; `X` = the agent working directory (the user's repo when a folder is linked).

| Producer | Path | Root |
|---|---|---|
| Browser screenshots / DOM / profile / videos / snapshots | `browser/…` | M |
| **Computer-use screenshots** | `computer/*.png` (`CuaDriverBridge.ts:1501`, root from `ChatManagementService.ts:1635,2067`) | **X** |
| **Skill staging on resume** and in workflow stages | `.generatorai/skills/…` (`ChatManagementService.ts:2005-2007`, `StageExecutionService.ts:411-415`) | **X** (create path uses M — same chat, two locations) |
| **Computer-use skill staging** | `.generatorai/platform-skills/…` (`:1656,2089`) | **X** |
| Plans, long responses, orchestrator state, worker task dirs | `plans/`, `artifacts/responses/`, `orchestrator/state.json`, `tasks/<name>/` | M |
| Integrated terminal | opens at `ws.rootPath` (`composition-root.ts:1756`) | M — a different directory from the agent |
| `output/` | created, used by nothing | — |

Neither `computer/` nor `.generatorai/` nor `tasks/` is in the managed root's `.gitignore` (`WorkspaceManager.ts:1081-1121`), so they show up in the Changes panel as workspace files. `skillDirectories` is declared by Claude and Codex and forwarded by neither (`ClaudeAgentProvider.ts:893`); only Copilot reads the staged directory.

### 1.6 Checkpoints, Changes, Files

Checkpoints are whole-tree git snapshots (`git add -A` into a private index, `write-tree`, `commit-tree`, `update-ref refs/generatorai/checkpoints/<ws>/<alias>/<n>`) taken before and after every turn (`ChatManagementService.ts:2398-2409, 2713-2722`), plus a baseline at chat prewarm. They are correct and byte-exact. The problems are where they live and how they are presented:

- **They live in the user's `.git`.** `GitShadowRefStore.indexPath` resolves `--absolute-git-dir` of the mount (`GitShadowRefStore.ts:143-155`). For a linked folder that is the user's repository: four `generatorai-*.index` files, two trees + two commits + two permanent refs per turn, never pruned (`WorkspaceCheckpointService.prune` and `CheckpointService.prune` have no production callers; `forget` deletes DB rows but leaves the refs, `composition-root.ts:1321-1323`). `git gc` cannot collect objects that refs point at.
- **Non-git folders get `git init`-ed** — by `initCodeRootRepo` at link time and by `RepoDiscovery` `autoInit` on a plain `GET /changes` (`RepoDiscovery.ts:102-108`, `workspaces.ts:181`). A read request mutates the filesystem.
- **Rewind is per repo but presented as global.** The timeline lists every alias with identical labels and asks "Rewind every file to this point?" (`CheckpointTimeline.tsx:81,243`); only one repo is restored.
- **Per-file discard is a silent no-op for every non-root repo.** The UI sends `<alias>/<path>` (`ChangesSurface.tsx:601-620`); the server uses it as a pathspec inside the alias's own directory (`CheckpointService.ts:246`). Empty diff, `pre_restore` checkpoint written anyway, success reported.
- **`turn:<id>` base is ambiguous** (before and after checkpoints share the turn id; `phase` column ignored, `workspaces.ts:75-79`). Cross-alias checkpoint base silently degrades to that repo's baseline with the wrong label (`ChangeSummaryService.ts:555-570`).
- **Capture and read disagree on the root** when `codeRoot` is set: capture resolves worktrees against `codeRoot ?? rootPath` (`WorkspaceCheckpointService.ts:214,236`), the changes route against `rootPath` (`workspaces.ts:104`). Review re-anchoring also uses `rootPath` (`composition-root.ts:1222,1237,1289`).
- **Three listings, three truths.** Files tab uses git `ls-files` per discovered repo (`/tree`); the @-mention index uses a raw recursive `readdir` that ignores `.gitignore` and stats every file in the user's project (`/files`, `workspaces.ts:633-647`); the Changes tab uses RepoDiscovery. Two independent reserved-name lists have already drifted.
- No retention runs for `executions/` by default (`WORKSPACE_RETENTION_DEFAULTS.enabled=false`); the source comments quantify the growth at ~50 directories a day.

### 1.7 What the research says (summary)

Full notes are in the session; the consensus across Claude Code, Codex, Cursor, Copilot agent, Devin, OpenHands, Cline/Roo, Conductor, Vibe Kanban:

- **One primary cwd plus an explicit allowlist of additional roots** (Claude Code `additionalDirectories`, Codex `writable_roots`). Nobody treats multi-repo as symmetric; a primary is always named.
- **Scratch lives outside the repo** (Claude Code scratchpad under the temp dir, plans under `~/.claude/plans`, OpenHands separate mounts). When it must be inside, it is hidden through `.git/info/exclude`, never the shared `.gitignore`.
- **Checkpoints use a shadow git directory** (Cline, Roo: `--git-dir=<external> --work-tree=<repo>`), so nothing lands in the user's `.git`. Restore = read the shadow tree, copy files back.
- **Worktree-per-task tools** put worktrees either under the repo (`.claude/worktrees/`, gitignored) or under a tool-owned directory (Conductor `~/conductor/workspaces/<repo>/<name>`), copy an allowlist of ignored files (`.worktreeinclude`, `worktreeInclude`), optionally symlink `node_modules`, and clean up clean worktrees automatically while locking ones with unpushed work.
- Nobody copies a repository per task.

---

## Part 2 — Target architecture

### 2.1 One sentence

A chat's workspace is a **managed scratch root** plus an ordered list of **mounts**; a mount is a directory the agent may edit, described by where it came from, how it was materialised, and what git state it is on. The agent's cwd is the primary mount; every other mount and the scratch root are additional directories; a `[Workspace]` system block tells the agent all of this; change tracking runs per mount through a shadow git store that never touches the mount's own `.git`.

### 2.2 Mounts

```ts
interface WorkspaceMount {
  id: string;
  workspaceId: string;
  position: number;               // deterministic order; 0 = primary
  alias: string;                  // display name, unique per workspace, used as path prefix in the UI
  origin:
    | { kind: 'codebase'; codebaseId: string; projectId: string }   // project link
    | { kind: 'folder' }                                             // ad-hoc local folder
    | { kind: 'generated' };                                         // no source: agent builds from scratch
  originPath: string | null;      // the user's repo / folder, or the bare clone (codebase git-remote)
  mode: 'in-place' | 'worktree' | 'generated';
  path: string;                   // absolute directory the agent edits
  git: {
    isRepo: boolean;
    branch?: string;              // branch checked out in `path`
    baseRef?: string;             // what the branch started from (worktree) or what HEAD was (in-place)
    createdBranch: boolean;       // true when we created `branch`
    nested?: string[];            // immediate sub-repos discovered under `path` (multi-repo folder)
  } | null;
  status: 'preparing' | 'ready' | 'error' | 'removed';
  error?: string;
  hasUncommittedChanges: boolean; // refreshed after each turn
  createdAt; updatedAt;
}
```

**Modes**

| Mode | What happens | When |
|---|---|---|
| `in-place` | `path = originPath`. Nothing is copied or initialised. If the folder is a git repo and the user picked a branch, a static pre-step checks it out (refused when the tree is dirty, with a clear error — never stash or discard). If the user picked "new branch", it is created from the chosen base. | Local folder (git or not), git-local codebase without isolation, a folder that contains several repos |
| `worktree` | `git worktree add <ws>/source/<alias> [-b <branch>] <base>` from `originPath` (the user's repo for git-local, the bare clone for git-remote). Applies `worktreeInclude` copies and optional `symlinkDirs` (for example `node_modules`). Branch defaults to `generatorai/<chat-slug>` but is user-editable; an existing branch can be checked out if no other worktree holds it. | Git codebases and git folders where the user wants isolation or parallel chats |
| `generated` | `path = <ws>/source/<alias>`, empty, `git init`-ed inside the managed root. | Chat with no source: the agent generates a project from nothing; can later be exported or linked as a codebase |

`local-dir` codebases stop being copied: they mount `in-place`. Nothing in the new model copies a tree. Disk cost per chat is the scratch root plus worktree checkouts (shared object store), and nothing else.

**Multi-repo folder.** When a folder is linked and it is not itself a repo but its immediate children are, the picker offers two choices: mount the parent as one `in-place` mount (nested repos are discovered and tracked individually; the agent sees one cwd), or mount each child as its own mount (each gets its own alias, branch controls, and change group). Recommended default: one parent mount, nested tracking.

### 2.3 Scratch root (managed)

```
<workspacesDir>/executions/<chatId>/
├── source/<alias>/        worktree and generated mounts only (never in-place ones)
├── scratch/               the directory the agent is told to use for temp scripts, notes, experiments
├── plans/                 plan documents (existing PlanService)
├── artifacts/             responses/, attachments/, stage-responses/
├── browser/  computer/    screenshots, profiles, DOM dumps (in-process tools)
├── orchestrator/  tasks/  orchestrator state and worker scratch
├── .generatorai/          staged skills/agents (one location, create and resume)
├── .checkpoints/<alias>.git   shadow git stores, one per mount (see 2.6)
└── .workspace.json        manifest: mounts, primary, versions
```

Removed: `output/` (unused), the root `git init` (the root is no longer a repo; scratch is not change-tracked, which is what the UI already does by hiding root-kind files), `config/` (skills are staged under `.generatorai/`).

### 2.4 What the agent receives (every harness, create and resume from one builder)

`WorkspaceExposure` is computed by one function from the mount list and passed into `CreateConversationParams`:

```ts
{
  workingDirectory: mounts[0].path,
  additionalDirectories: [...mounts.slice(1).map(m => m.path), ws.rootPath],
  env: { GENERATORAI_WORKSPACE_ROOT: ws.rootPath, GENERATORAI_SCRATCH_DIR: `${ws.rootPath}/scratch` },
  systemPromptBlocks: [buildWorkspaceHint(ws, mounts)],
}
```

Per harness:

| Harness | cwd | Additional directories | Notes |
|---|---|---|---|
| claude-agent | `options.cwd` | `options.additionalDirectories` (SDK supported) | also forward `skillDirectories` or stop declaring it |
| copilot | session `workingDirectory` | no SDK field → rely on the hint; Copilot CLI is not path-sandboxed | one CLI process per cwd already |
| codex | **fix**: `cwd: params.workingDirectory` on `thread/start`/resume | sandbox policy `workspaceWrite` with `writableRoots` = additional dirs (app-server supports it; verify exact field on the pinned version) | |
| opencode | **fix**: `spawn(..., { cwd })` per workspace, or per-session directory if the server API allows | hint only | consider one server per cwd like Copilot |
| acp | `cwd` | `additionalDirectories` (already in the protocol types) | |

The `[Workspace]` block (appended on create and resume, one source of truth):

```
[Workspace]
Working directory: C:\dev\shop\frontend  (mount "frontend", git branch feature/cart, base main)
Also available: C:\dev\shop\backend  (mount "backend", branch feature/cart)
Scratch directory: C:\Users\me\.generatorai\workspaces\executions\<id>\scratch
Rules:
- Code changes go in the mounted directories above. Use relative paths from the working directory
  and absolute paths for the other mounts.
- Anything that is not a deliverable — plans, notes, experiment scripts, downloads, screenshots,
  temporary files — goes under the scratch directory, never inside a mounted repository.
- Do not run git checkout/switch/stash/reset in a mount; the user controls branches.
- Do not create files in the workspace root outside scratch/ and plans/.
```

Terminal, browser and computer-use tools use the same exposure: the terminal opens at the primary mount, browser and computer-use write under the scratch root, snapshot handoff files are inside `additionalDirectories` so the Read tool can reach them.

### 2.5 Chat creation and the static pre-step

Create-chat payload replaces `projectId + codebaseIds + createWorktree + gitRepositories` with an explicit source list (legacy fields are mapped for one release):

```ts
sources: Array<
  | { kind: 'codebase'; codebaseId: string; mode: 'in-place' | 'worktree';
      branch?: string; newBranch?: string; baseRef?: string; alias?: string }
  | { kind: 'folder'; path: string; mode: 'in-place' | 'worktree';
      branch?: string; newBranch?: string; baseRef?: string; alias?: string; splitNested?: boolean }
>;
primary?: string;            // alias; defaults to sources[0]
```

Lifecycle:

1. `POST /api/chats` validates sources synchronously: paths exist and are directories, no path is inside another mount, no path is inside the managed workspaces directory, aliases unique, branch exists or `newBranch` given, a chosen existing branch is not already checked out in another worktree.
2. The chat row and workspace row are inserted with `workspace.status = 'preparing'`; the chat is returned immediately so the UI can open it.
3. `MountService.prepare(workspaceId)` runs in the background: creates worktrees in parallel, checks out branches for in-place mounts, stages skills, writes the manifest, takes the baseline checkpoint per mount, then flips `status = 'ready'` and emits `workspace.ready` over SSE. Errors mark the mount `error` with a message and the workspace `error`.
4. `sendMessage` awaits `workspaceManager.ready(workspaceId)` (bounded, surfaces the error to the user) before building the conversation. The composer shows "Preparing workspace… creating worktree for backend" and disables send until ready. This is the static step you asked for: the prompt never runs before the tree exists.
5. Resume builds the exposure from the persisted mounts, so restarts and model switches keep the same cwd.

Mounts can be changed after creation through `PATCH /api/chats/:id/sources` (add, remove, change primary, switch branch on an idle chat), with the same validation and pre-step. Removing a worktree mount removes the worktree directory; the branch is kept unless the user ticks "delete branch".

The dialog gets a proper source picker: a directory browser endpoint (`GET /api/fs/dirs?path=`) instead of a free-text box, git detection with branch list, mode toggle per source, editable branch name, nested-repo detection, and a read-only summary line ("frontend → worktree on generatorai/cart-fix from main; backend → in place on develop").

### 2.6 Change tracking on the mount model

**Shadow store per mount.** All snapshot commands run with `GIT_DIR=<ws>/.checkpoints/<alias>.git` and `--work-tree=<mount.path>`. Consequences:

- Nothing is written into the user's `.git`: no index files, no refs, no objects. `initCodeRootRepo` is deleted; the identity rewrite and baseline commit go with it.
- Non-git folders are tracked without being turned into repositories.
- The shadow store's `objects/info/alternates` points at the origin repository's object directory when the mount is a git repo, so unchanged blobs are never duplicated; only new content costs disk.
- The mount's own `.gitignore` files are still honoured (git reads work-tree ignore files regardless of `GIT_DIR`); `<shadow>/info/exclude` adds `.generatorai/`, `node_modules/`, `.env*` for folders that have no ignore file. No `.gitignore` is ever written into a mount.
- Deleting the workspace deletes the shadow stores. `prune` is wired after every capture with the existing retention defaults (100 per repo, 30 days).

**Baselines.** For a git mount the store records two bases: `Branch base` (the commit tree of `baseRef`/HEAD at mount time, EOL-normalised) and `Session start` (the working tree at mount time, byte-exact). The Changes header selector exposes both plus turn checkpoints. This replaces the "Worktree HEAD" fallback and the `normalized` flag remains the mechanism for comparing against commit trees.

**Restore.** Checkpoints keep a `turnId` and `phase`; the timeline groups by turn and shows one row per turn with a per-mount breakdown. "Rewind" restores every mount that has a checkpoint for that turn (atomic per mount, reported per mount); a mount-only rewind is available from the mount's group header. Per-file discard sends the mount alias and the repo-relative path separately. The `pre_restore` checkpoint is labelled "Redo point" and shown as such.

**Files, Changes, @-mention.** One `WorkspaceTreeService` backed by the shadow store's `ls-files --others --cached --exclude-standard` serves all three: the Files tab shows one section per mount plus a "Workspace" section for `scratch/` and `plans/`; the Changes tab groups by mount alias and prefixes paths with the alias only when there is more than one mount; the @-mention index is the same list. One reserved-name list lives in `packages/changes` and is imported by the routes. `RepoDiscovery.autoInit` is removed.

### 2.7 Lifecycle and disk

| Event | Action |
|---|---|
| Chat archived | worktree mounts removed from disk after the project's `worktreeRetention` (default 24 h); branches kept; in-place mounts untouched; shadow stores kept until workspace deletion |
| Chat deleted | worktrees removed immediately unless `hasUncommittedChanges` or unpushed commits (409 with `?force`); shadow stores and scratch root removed |
| Workspace retention sweep (opt-in, unchanged) | reads `workspace_mounts` for the unpushed-work guard instead of the dead table |
| Unarchive | no longer recreates an empty workspace; mounts are re-prepared from the persisted spec |

Worktrees stay under `<ws>/source/<alias>` (same convention as workflow runs) rather than inside the user's repo. Optional per-codebase settings: `worktreeInclude` (exists), `symlinkDirs` (new, for `node_modules` and similar), `sparsePaths` (new, cone-mode sparse checkout for monorepos).

### 2.8 Scenario walk-through under the new model

| Scenario | Mounts | cwd | Extra dirs | Disk cost |
|---|---|---|---|---|
| Project, frontend + backend git-local, no isolation | 2 × in-place | frontend | backend, scratch root | scratch only |
| Same with isolation | 2 × worktree at `<ws>/source/{frontend,backend}` on `generatorai/<slug>` | frontend worktree | backend worktree, scratch | two checkouts, shared objects |
| Local git folder, existing branch `develop` | 1 × in-place, checkout develop (refused if dirty) | folder | scratch | none |
| Local git folder, new worktree | 1 × worktree from the folder's repo | worktree | scratch | one checkout |
| Local plain folder | 1 × in-place, shadow store only | folder | scratch | shadow objects |
| Folder containing several repos | 1 × in-place with nested tracking (or N mounts) | folder | scratch | none |
| No source | 1 × generated at `<ws>/source/main` | that dir | scratch | whatever the agent generates |

In every row the agent's screenshots, plans, scripts and temp files land under the scratch root, and nothing is written into a repository except the code changes the user asked for.

---

## Part 3 — Implementation plan

### Phase 0 — Stop the damage (small PR, no schema change)

1. Delete `initCodeRootRepo`; never `git init`, set identity, or commit inside a linked folder.
2. Route computer-use screenshots, resume-path skill staging, and computer-use skill staging to `ws.rootPath`; add `computer/`, `.generatorai/`, `tasks/` to the managed `.gitignore` and to the reserved list.
3. Codex: pass `params.workingDirectory` as `cwd`. OpenCode: spawn with `cwd`, per workspace.
4. Resume path resolves the same cwd as create (persist the resolved working directory on the workspace row until Phase 1 replaces it with mounts).
5. `createWorktree:false` actually skips worktree creation; `sendMessage` awaits the pending worktree promise and surfaces failure.
6. `RepoDiscovery` default `autoInit=false` on read routes.
7. Per-file discard: send alias and path separately; `turn:` selector honours `phase`.

Tests: unit tests for each; live check of scenario "local git folder" confirming the user's `.git/config` and refs are untouched.

### Phase 1 — Data model and MountService

- Migration 51: `workspace_mounts` table (fields in 2.2); backfill: `codeRoot` → in-place mount, `worktrees` rows with `runType='manual'` → worktree mounts, otherwise a `generated` mount at `rootPath` for existing chats so nothing changes for them. Drop `workspace_worktrees`; leave `worktrees` for workflow runs until Phase 7.
- `MountService` in `packages/core`: `plan(sources)`, `validate`, `prepare(workspaceId)`, `remove`, `refreshStatus`, `exposure(workspaceId)`. Uses `GitClient` for worktree/branch operations (extend with `worktreeAdd(existingBranch)`, `checkoutBranch`, `isClean`, `listWorktreesHoldingBranch`).
- `WorkspaceManager.getWorkingDirectory` becomes `getExposure` and returns the full structure; `codeRoot` column deprecated.
- Shared types and Zod schemas for `sources` in `packages/shared`.

### Phase 2 — Chat creation API and UI

- `CreateChatSchema.sources`, `primary`; legacy field mapping; `PATCH /api/chats/:id/sources`; `GET /api/fs/dirs` (loopback-only, path-validated) and `GET /api/fs/git-info?path=` (is repo, current branch, branches, dirty, nested repos).
- Workspace `status: preparing | ready | error` on the chat DTO, `workspace.ready` SSE event, composer "Preparing workspace" state, send gated on ready.
- New source picker in `CreateChatDialog` (project tab, folder tab, none), per-source mode/branch controls, summary line. Chat settings panel to view and edit mounts.
- CLI `chat create --source <path>[:mode[:branch]]` and `--codebase alias[:mode[:branch]]` wired to the schema.

### Phase 3 — Harness exposure and hints

- `CreateConversationParams.additionalDirectories`, `env`, `systemPromptBlocks` populated from `MountService.exposure` on create and resume (one builder).
- claude-agent: `additionalDirectories`; forward `skillDirectories` or remove the capability flag. codex: `writableRoots`. acp: `additionalDirectories`. Warnings via `FIELD_UNSUPPORTED_BY_PROVIDER` where a harness cannot honour a field.
- `[Workspace]` hint block; orchestrator prompt's `orchestrator/plan.md` changed to the absolute scratch path; worker briefs unchanged.
- Terminal opens at the primary mount; snapshot handoff writes under scratch (now reachable).
- Env allowlist gains `GENERATORAI_WORKSPACE_ROOT`, `GENERATORAI_SCRATCH_DIR`.

### Phase 4 — Shadow checkpoint store

- `GitShadowRefStore` takes `{ gitDir, workTree, alternates? }`; all snapshot commands use `--git-dir/--work-tree`. Migration for existing chats: on first capture, create the shadow store and stop touching the origin `.git`; a one-off cleanup command removes `refs/generatorai/*` and `generatorai-*.index` from repositories that older versions touched (dry-run + confirm).
- Wire `prune` after capture; delete shadow stores on workspace delete.
- Dual baseline (`Branch base`, `Session start`); remove the "Worktree HEAD" fallback.
- Turn-grouped timeline, per-mount rewind results, "Redo point" label.

### Phase 5 — Files, Changes, @-mention unification

- One tree service and one reserved list; `/files` removed in favour of `/tree`; SSE invalidation for the file index; Files tab sections per mount plus Workspace; Changes tab grouped by mount; `toDisplayPath` uses mount paths from the chat DTO instead of guessing from path shape.

### Phase 6 — Lifecycle and retention

- Archive/delete/unarchive behaviour from 2.7; `protectUnpushed` on mounts; `hasUncommittedChanges` refresh after each turn; `symlinkDirs` and `sparsePaths` codebase settings.

### Phase 7 — Workflows (later)

- `WorkflowOrchestrator` builds mounts through `MountService` instead of `createRunWorktrees`; `repo_path_<alias>` and `__workingDirectory` come from the exposure; stages inherit the same `[Workspace]` block.

### Test matrix (run live on the isolated instance, claude-agent provider, Sonnet)

For each of the seven scenarios in 2.8: create the chat, confirm the "Preparing" state and readiness, send a prompt that edits a file in each mount and writes a script plus a screenshot, then verify: files land where expected; nothing new appears under any repository except the edited files (`git status` in the origin repo shows only the intended change, no refs/index files, identity unchanged); Changes tab groups per mount with correct paths; per-file discard and turn rewind work on a non-primary mount; restart the server and confirm the next turn runs in the same cwd; archive and confirm worktree removal after retention while branches survive. Add the CRLF regression to the branch-base comparison.

### Decisions I need from you

1. **Worktree location**: under the managed workspace (`<ws>/source/<alias>`, recommended, matches workflows) or inside the repo (`<repo>/.generatorai/worktrees/<name>`, Claude Code style, visible to the user's editor)?
2. **Default branch name** for new worktrees: `generatorai/<chat-slug>` (recommended) or `generatorai/run-<id8>-<alias>` as today?
3. **Dirty tree on in-place branch switch**: refuse with a message (recommended) or offer stash-and-restore?
4. **Multi-repo folder default**: one parent mount with nested tracking (recommended) or split into one mount per repo?
5. **Scratch tracking**: leave `scratch/` and `plans/` out of change tracking (recommended; they are visible in the Files tab) or track them as a "Workspace" group?
6. **`local-dir` codebase type**: convert to in-place mounts and drop the copy (recommended), or keep the copy as an explicit `mode: 'copy'` for people who want a throwaway?
7. **Phase 0 first**: ship the damage-stopping fixes as a separate PR before the model change, or fold them into Phase 1?
