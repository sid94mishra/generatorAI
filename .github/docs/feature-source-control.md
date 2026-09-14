# Source control — accounts, commit → PR flow, PR review, open in editor

> Design + contract for the source-control feature. The shared TypeScript shapes live in
> `packages/shared/src/types/SourceControl.ts` and are re-exported from `@generatorai/shared`
> (some names carry an `Scm` prefix there to avoid clashing with older exports).

## 1. Principles

1. **Checkpoints and commits are different layers.** Per-turn checkpoints (shadow repo) are
   the agent's undo. Git commits are the user's durable, reviewable history. Nothing commits
   to git unless the user asks (Changes tab) or opted in at chat/workflow creation.
2. **Programmatic where it can be, agent only where it must.** Branching, committing, syncing
   the base branch, pushing and opening the PR are deterministic git/API steps the server
   runs itself. A model is used only to *write text* (commit message, PR title/body) and,
   optionally, to *resolve merge conflicts* — always followed by a human review.
3. **Never push to the default branch, never force-push, never rewrite history.** When the
   work is on the default branch the flow cuts `generatorai/<slug>` first. Sync is a
   *merge* of `origin/<base>` into the work branch (no rebase).
4. **Every "can't" comes with a reason.** `RepoReadiness.reasons` explains why commit / push /
   PR is unavailable (not a repo, no remote, host not connected, detached HEAD, …). Clients
   show the reason and, when the fix is "connect an account", link to Settings → Source Control.
5. **Providers and accounts are pluggable.** `ISourceControlProvider` is the host port
   (GitHub today). Users can connect several accounts (multiple GitHub accounts / Enterprise
   hosts); the account for a repo is picked by matching the remote host, falling back to the
   default account.

## 2. Accounts and settings

* Config file `<dataDir>/source-control.json` stores `SourceControlSettings` **without tokens**.
  Tokens live in the secret store under namespace `source-control/<accountId>`, name `token`.
  A legacy `github.token` in the file is migrated into an account on first load.
* Sign-in methods (`SourceControlProviderInfo.loginMethods`):
  * `token` — paste a PAT (scopes `repo`; `workflow` optional). Validated with `GET /user`.
  * `device` — GitHub OAuth device flow. Available when `GENERATORAI_GITHUB_OAUTH_CLIENT_ID`
    (or the setting) is configured. Server starts the flow, client shows code + link, server
    polls `login/oauth/access_token` until complete.
  * `gh-cli` — import the token the `gh` CLI already holds (`gh auth token`).
* `generation.{provider,model}` — the harness provider/model used to write commit messages and
  PR text. Null → heuristic text ("Update 3 files in src/…").
* `editor.defaultEditor` — editor used by "Open in editor".

### Endpoints

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/source-control/settings` | → `SourceControlSettingsResponse` |
| PUT | `/api/source-control/settings` | `{ defaultAccountId?, generation?, editor?, defaultBase? }` → `SourceControlSettings` |
| POST | `/api/source-control/accounts` | `{ provider:'github', method:'token', token, host?, label? }` or `{ provider, method:'gh-cli', host? }` → `SourceControlAccount` |
| DELETE | `/api/source-control/accounts/:id` | → 204 |
| POST | `/api/source-control/accounts/device/start` | `{ provider:'github', host? }` → `DeviceLoginStart` |
| GET | `/api/source-control/accounts/device/:loginId` | → `DeviceLoginStatus` |
| GET | `/api/source-control/config` / `status`, PUT `config` | legacy, kept: `status.enabled` = at least one account |

## 3. Readiness

`GET /api/workspaces/:id/scm/readiness[?alias=]` → `WorkspaceReadinessResponse` (one
`RepoReadiness` per git-capable mount). Computed from `git` (repo, remote, branch, detached,
`origin/HEAD` → default branch, dirty, ahead/behind, merge in progress, unmerged files) plus
the account registry (host → account) and, when connected, the open PR for the branch.

Reason strings (user-facing) — commit: "Not a git repository", "Nothing to commit",
"Merge in progress — resolve conflicts first"; push: "No git remote configured";
PR: "No git remote", "Remote host <host> is not connected — connect it in Settings → Source
Control", "Detached HEAD", "Nothing to open a PR from (branch has no commits ahead of base)".

`GET /api/projects/:id/codebases/:cid/readiness` returns the same shape for a codebase path.

## 4. The flow

`POST /api/workspaces/:id/scm/flow` (`ScmFlowRequest`) → `ScmFlowResult`. Steps, in order:

1. `readiness` — blocked with reasons if the requested steps aren't possible.
2. `branch` — if push/PR requested and on the default branch, create
   `generatorai/<slug-of-hint-or-chat-name>-<6 hex>` from HEAD (uncommitted changes carry over).
3. `commit` — `git add -A` (respecting the mount root) + commit. Message from request, else
   generated (model → heuristic). Skipped when clean.
4. `sync` — `git fetch origin <base>`; dry-run `git merge-tree --write-tree` (git ≥ 2.38,
   fallback: real merge with `--no-commit` then abort). Conflicts → `status:'conflicts'` with
   the file list, **working tree untouched** (`mergeStarted:false`). Clean → `git merge
   origin/<base>` (fast-forward when possible). Skipped when base == branch or no remote.
5. `push` — `git push -u origin <branch>`.
6. `pull_request` — if an open PR already exists for the branch, return it; else create with
   title/body from request or generated (PR template from `.github/PULL_REQUEST_TEMPLATE.md`
   is honoured), `base` = request → chat option → repo default → settings.defaultBase.

`POST /api/workspaces/:id/scm/generate` (`ScmGenerateRequest`) → `ScmGenerateResult` for
"Generate" buttons in the UI.

### Conflicts

Returned by the flow as `ScmFlowResult.status === 'conflicts'`. The client offers:

* **Resolve manually** → `POST …/scm/conflicts/start` applies the merge to the working tree
  (markers present), user edits (Open in editor), then `POST …/scm/conflicts/continue` verifies
  no unmerged paths remain, commits the merge and the client re-runs the flow (push/PR).
* **Ask the agent** → `POST …/scm/conflicts/resolve-with-agent { alias, chatId }` starts the
  merge (if not started) and sends the chat a prompt listing the conflicted files, both branch
  names and the rule set (keep both intents, do not touch unrelated files, do not commit, do
  not push, report what was chosen). The user reviews in the Changes tab, then **Continue**.
  Guardrails: only in a mount (worktree or in-place) the chat already owns; never force-push;
  the user must click Continue before anything is pushed.
* **Abort** → `POST …/scm/conflicts/abort` runs `git merge --abort`.

Decision: agent resolution is offered but never automatic; it is a normal chat turn the user
can watch, stop, and rewind, and the push only happens after an explicit Continue.

## 5. Agent-native mode

`CreateChatParams.sourceControl?: ChatSourceControlOptions` (persisted on the chat, editable via
`PATCH /api/chats/:id`). After each completed turn with a non-empty change set the server runs
the flow (`commit.generate`, `push: autoPush`, `pullRequest: { generate: true, base, draft }`
when `autoPullRequest`) and emits `chat.scm.result` on the session scope with the
`ScmFlowResult`; the transcript renders it as a block (commit · pushed · PR link, or the
conflict card with the three actions above). The agent's system hints tell it the platform
commits for it, not to run `git commit/push` itself, and to end its final message with a short
`Summary:` line that seeds the commit message.

Workflows: `OrchestratorConfig.autoCommit | autoPush | autoCreatePR` use the same flow in the
post-processing step; a conflict fails the step with the report attached to the run.

If the mount is not a git repo or the host is not connected, the flow returns `blocked` with the
reason and the block tells the user why (no PR possible) — the chat itself is not affected.

## 6. Pull requests under a project

| Method | Path | → |
|---|---|---|
| GET | `/api/projects/:id/pull-requests?state=open|closed|all` | `ProjectPullRequestsResponse` (all codebases; ones without a remote/account are listed under `unavailable`) |
| GET | `/api/projects/:id/codebases/:cid/pull-requests/:number` | `PullRequestDetail` |
| GET | `…/pull-requests/:number/files` | `PullRequestFile[]` |
| GET | `…/pull-requests/:number/comments` | `PullRequestComment[]` |
| POST | `…/pull-requests/:number/review-chat` | `{ instructions?, model?, agentRef? }` → `{ chat }` |

The web Project page gets a **Pull requests** tab (list with state filter) and a PR detail view
(description, checks, files with diffs, comments, "Open on GitHub", "Review in chat").
"Review in chat" creates a chat whose source is the codebase in worktree mode on the PR head
branch (fetched first) and sends the review prompt (`packages/core/src/services/scm/reviewPrompt.ts`)
with the user's extra instructions.

## 7. Open in editor

`GET /api/editor/editors` → `EditorInfo[]` (VS Code, VS Code Insiders, Cursor, Windsurf;
availability probed via the CLI on PATH and the standard per-OS install locations through one
shared table). `POST /api/editor/open` (`OpenInEditorRequest`) launches the CLI detached on the
server host; the path must lie inside a known workspace mount or project codebase. The response
carries `fallbackUrl` (`vscode://file/<path>[:line[:col]]`) so a browser can try the URL scheme
when the server could not launch anything (e.g. server on another machine).

UI: a split button in the top bar on chat, workflow-run, project and codebase pages
(default editor click; caret lists the others), and a per-file "Open in editor" action in the
Changes tab. Hidden on mobile.

## 8. Settings as a page

`/settings/:section?` renders the settings sections as a routed page inside the app layout with
a Back control (`navigate(-1)`, falling back to `/`). `openSettings(section)` navigates there;
the modal is gone. Deep links such as `/settings/source-control` are used by every "Connect
GitHub" call-to-action.

## 9. Mobile

The phone is a *reader and approver*, not a place to hold credentials. Same contract, three
deliberate omissions: no token entry, no device flow, no "Open in editor".

* **Settings › Source control** (`app/settings/source-control.tsx`) lists `settings.accounts`
  (login · host · sign-in method, with a Default badge), the generation model and `defaultBase`
  read-only. Tapping an account offers **Set default** (`PUT /settings { defaultAccountId }`) and
  **Disconnect** (`DELETE /accounts/:id`, behind a confirm). Adding an account says "connect it
  from the desktop or web app" — a PAT typed on a phone is a credential entered on the least
  trusted device in the chain.
* **Changes pane** (`src/components/changes/CommitBar.tsx`) is readiness-driven: one status line
  per mount (`alias · branch · ↑2 ↓1 · 3 files`) with the open PR as a pill, and every
  unavailable action shows `reasons.*`. `scmModel.actionReason` rewrites the server's
  "connect it in Settings → Source Control" to "Connect GitHub from the desktop or web app",
  because that screen deliberately cannot. One sheet runs the whole flow (message + **Generate**,
  Push, Open pull request with title/body/**Generate**/base/draft) and shows the returned steps;
  conflicts open the card with **Ask the agent** / **Continue** (then a `sync:false`, commit-less
  re-run of the remaining steps) / **Abort**. Still gated on `useCapability('commit')`.
* **Project › Pull requests** (`app/projects/[id]/pull-requests.tsx`, detail at
  `app/projects/[id]/codebases/[cid]/pull-requests/[number].tsx`): Open/Closed/All filter,
  grouped by codebase, `unavailable` codebases rendered with their reason; the detail shows
  mergeability, checks, the markdown description, collapsible per-file patches, comments,
  "Open on GitHub" (`Linking.openURL`) and **Review in chat** (`POST …/review-chat` →
  `/chats/<id>`).
* **New chat** carries `sourceControl: ChatSourceControlOptions` (Auto-commit / Push / Open PR,
  base, draft). The switches imply each other downward and the field is omitted entirely when
  nothing commits (`newChatModel.normalizeSourceControl`).
* **Transcript**: `chat.scm.result` renders through `timeline/ScmResultRow.tsx` —
  "Committed abc1234 · pushed · PR #12", the blocked reason, or the conflict card with the same
  three actions. The block is narrowed structurally (`timeline/scmResultBlock.ts`), so a shape
  change in client-core degrades to "no row" rather than to a broken transcript.
* Endpoints live in `src/components/scm/api.ts` (React-free, so the request bodies are unit
  tested against a mocked fetch); the hook is `useScmApi`.

## 10. Operations and verification notes

* **Git version.** The dry-run conflict probe uses `git merge-tree --write-tree` on git ≥ 2.38.
  Older git (the reference machine runs 2.37) falls back to a real `merge --no-commit --no-ff`
  followed by `merge --abort`, which leaves the tree untouched either way. Both paths are unit
  tested; the live e2e ran on the fallback.
* **Commit messages never go through argv.** `git commit` reads the message from stdin (`-F -`)
  because generated messages routinely contain backticks and parentheses, which the process
  runner's argument guard rejects as shell metacharacters (that was the first live failure of
  the auto-commit hook; the failed result was still emitted and rendered as a card).
* **Private-network hosts.** The source-control HTTP client applies the same private-address
  policy as every outbound call. Operators running GitHub Enterprise on a private network set
  `GENERATORAI_SCM_ALLOWED_HOSTS=<hostname>[,…]`; the e2e rig uses it with a GitHub-compatible
  fake on `localhost`. `GENERATORAI_GITHUB_OAUTH_CLIENT_ID` enables the device-flow sign-in.
* **Readiness "ahead".** `ahead/behind` are relative to the upstream (status line). The PR gate
  uses commits ahead of `origin/<default>`; a pushed work branch reads 0/0 upstream while still
  being ahead of main.
* **Result cards and reload.** `chat.scm.result` is persisted like any stream event; web replays
  every turn's result (last write wins per turn) and keeps the card across the transcript
  cleanup, so "Committed abc1234 · PR #12" and conflict cards survive a reload. Cards for
  older turns render after the history (the history itself comes from messages, not the stream).
* **End-to-end rig.** `git http-backend` behind a ~200-line Node fake of the GitHub REST API
  (`/api/v3/user`, repos, pulls, files, comments, check-runs) serves a bare repo over smart HTTP
  so commit → sync → push → PR, conflicts (manual + agent), project PR list / detail / review
  chat, editor open and the auto-commit hook can be exercised without a real GitHub account.
