# Usage — Web UI

> React 19 SPA hosted by Vite in dev and served statically by the server in prod. Talks to the API via the same `IPlatformClient` interface the CLI uses.

For the component map and pages list, see [apps.md → apps/web](./apps.md#appsweb--react-19-spa).

---

## 1. Sidebar navigation (8 entries)

| Entry | Route | Purpose |
|---|---|---|
| Dashboard | `/` | 4 stat cards + 3 quick actions + 3 recent panels |
| Projects | `/projects` | Project management |
| Chats | `/chats` | Conversational AI sessions |
| Workflows | `/workflows` | DAG workflow definitions |
| Scripts | `/scripts` | Programmatic Workflow Scripts (PWS) |
| Automations | `/automations` | Scheduled / webhook / manual batch executors |
| Templates | `/templates` | Browse system workflow templates |
| Settings | `/settings` | General / Provider / Copilot / Advanced |

---

## 2. Dashboard

- **4 stat cards**: Active Chats, Workflows count, Active Runs, Completed Runs.
- **3 Quick Actions** (each navigates):
  - **New Chat** → `/chats/new` (opens CreateChatDialog).
  - **New Workflow** → `/workflows/new`.
  - **Browse Workflows** → `/workflows`.
- **Recent Chats / Recent Runs / Your Workflows** panels (3–5 entries each, link to detail).

---

## 3. Projects

`/projects` page lists all projects (filterable by status). `+ New Project` button → `/projects/new` form (name, description, settings).

`/projects/:id` page tabs:

| Tab | Contents |
|---|---|
| **Codebases** | Linked codebases with status badges. Buttons: Link, Fetch, Browse, Unlink, Update. |
| **Configs / Assets** | Skills, Prompts, Agents lists with upload/edit/delete + system artifact merge view. |
| **MCP Servers** | System + project MCP server toggles + create/edit form. |
| **Worktrees** | Active worktrees for this project; remove + cleanup. |
| **Artifacts** | Project-level artifacts (uploaded outputs). |
| **Pull requests** | Every PR across the project's codebases, filtered Open / Closed / All. A row shows number, title, codebase alias, `head → base`, author, a Draft badge and the last update; clicking it opens the PR page below. Codebases that could not be listed are shown as muted rows with the server's reason — and a **Connect GitHub** link to `/settings/source-control` when that is the fix, because a silently short list is indistinguishable from "nothing in flight". |
| **Settings** | Project settings (maxCodebases, worktreeRetention, autoFetchInterval, …). |

`/projects/:id/codebases/:cid` — Codebase detail page with file browser (tree view + viewer), branches list, fetch button.

`/projects/:id/codebases/:cid/pull-requests/:number` — Pull request page: title, state badge, author, `head → base` and **Open on GitHub**; mergeability (`computing…` while the host has not answered yet) and the checks roll-up; the description rendered as markdown; **Files** (each expandable to its diff, parsed from the patch); **Comments**; and **Review in chat** — optional instructions plus a model picker, which creates a chat on the PR's head branch seeded with the review prompt and navigates to it.

---

## 4. Chats

`/chats` page lists all chats (cards). Each card: name, model, status, last activity. Click card → `/chats/:id`.

### Create dialog (`CreateChatDialog`)
- Name (required)
- Description
- Model dropdown (populated from `/api/copilot/models`)
- Tags input
- Project picker (optional) → exposes codebase checkboxes (up to 3)
- "Create worktree" toggle (default ON when project + codebases set)
- Alternative: ad-hoc git URLs + aliases
- **Source control** — *Auto-commit after each turn* / *Push* / *Open pull request*, plus a base branch and a Draft switch once a PR is requested. The switches imply one another downstream (push needs a commit, a PR needs a push), and the block is sent as `sourceControl` only when auto-commit is on — nothing commits to git unless asked. The same controls are on **Edit sources** for a live chat (`PATCH /api/chats/:id`).

### Chat page (`/chats/:id`)
- Message list with streaming live tokens, thinking blocks, tool calls, system messages.
- Right toolbar:
  - **Panel toggle** — opens the unified `RightPane` on the right side.
- Input row:
  - Textarea (Shift+Enter for newline, Enter to send)
  - Model selector + reasoning effort dropdown
  - Codebase indicator (count badge) — expand to see linked codebases
  - Attachments button
  - Send / Stop button
- Between the input and the message list: a **`📎 N capture pending`** banner appears whenever the Browser panel's Inspect / Capture actions or the Terminal panel's Attach button has queued a file. Consumed on the next send.

### Right side pane (Changes / Browser / Terminal / Canvas)

Same shared `RightPane` component the workflow-run page uses. Tab strip + `+` add-menu + drag-resizable width, all state persisted to `localStorage:generatorai:rightPane:chat`.

| Tab | Purpose |
|---|---|
| **Changes** *(always present, default)* | `ChangesSurface` — the change set with per-file diffs, Keep / Undo, review comments, checkpoints, a per-file **Open in editor** action, and the **source-control block** described below. |
| **Browser** *(add-able, singleton)* | Integrated Browser panel (`BrowserPanel`) — VSCode-style share/inspect/capture bar, WebSocket JPEG live-view with click-through + typing, viewport that follows the panel size (no letterbox), overlay scroll indicator on the right edge. Disabled until the chat has a workspace. See [feature-integrated-browser.md](./feature-integrated-browser.md). |
| **Terminal** *(add-able, multi-tab)* | Integrated Terminal panel (`TerminalPanel`) — xterm.js with inline search, Attach-selection-to-chat, Clear, Kill. Multiple parallel terminals per workspace. See [feature-integrated-terminal.md](./feature-integrated-terminal.md). |
| **Canvas** *(auto-added on first widget render)* | `CanvasHost` — stacked sandboxed widget iframes served from `/api/widget-assets`. Agent-rendered UI (polls, forms, editors, dashboards) that users can click through; clicks and typing round-trip back to the agent via `read_widget`. See [feature-extensions-widgets.md](./feature-extensions-widgets.md). |

### Source control in the Changes tab

Driven by `GET /api/workspaces/:id/scm/readiness`, so the block states what each mount can do rather than offering buttons that fail at the server:

- **Status line** — branch, ahead/behind, and a link to the open PR for that branch when one exists. With more than one mount, a row of chips picks which one to act on.
- **Blocked** — the server's own reason ("Not a git repository", "No git remote configured", "Remote host … is not connected"). When the fix is connecting an account, a **Connect GitHub** button links to `/settings/source-control`; when it is not (this is not a repository), no button is offered.
- **Actions** — a commit message box with a **Generate** button (`POST …/scm/generate {kind:'commit'}`), a **Push** toggle, and an **Open pull request** toggle revealing title/body (each with its own Generate), base branch (defaulting to the repo's default) and **Draft**. One primary button runs `POST …/scm/flow`; the step list it renders is the server's own, and the outcome shows the commit sha, whether it pushed, and the PR link.
- **Conflicts** — the flow reports them with the working tree untouched. The card lists the files and offers three decisions: **Resolve manually** (applies the merge, you edit, then **Continue** re-runs the flow), **Ask the agent** (a normal, watchable chat turn — only where a chat is in scope, so not on a run page), and **Abort**. Nothing is pushed until Continue succeeds.

Keep / Undo and the checkpoint timeline are unchanged; source control is a separate layer from the agent's per-turn undo.

In agent-native mode the same result appears **in the transcript** as a compact card under the turn it belongs to — "Committed abc1234 · pushed · PR #12 ↗", the blocking reason, or the same conflict card with the same three actions. It survives a reload.

---

## 5. Workflows

### `/workflows` (list page)
- Grid ↔ List view toggle (425px ↔ 1746px card width).
- Search filter (any text in name/description).
- Tag filter.
- Bulk select (checkbox per card) → **Delete Selected** with confirmation dialog.
- **Template** button → JSON download of selected definition (uses temp `<a download>`).
- **Upload JSON** button → file picker → `POST /api/workflow-definitions/import-json` → redirects to `/workflows/<id>/edit`.

### `/workflows/:id` (read-only summary)
- DAG canvas (read-only).
- Stage list.
- Variables list.
- Workflow-scope hooks list.
- Recent runs panel.

### `/workflows/:id/edit` (visual builder)

Header buttons: **Back / Title input / Undo / Redo / Settings / Validate / Hide-properties / Save / Run / Auto-Layout / Add Stage / Zoom In/Out / Fit View / Toggle Interactivity**

Canvas: React Flow with `StageNode` (rounded rectangle, input/output handles) and labeled edges:
- Success (green badge)
- Failure (red badge)
- Complete (blue badge)
- Always (gray badge)
- Each has a "Remove edge" button.
- Drag from source-right → target-left handle creates an edge.

**Settings dialog (5 tabs)** — `WorkflowConfigPanel`:

| Tab | Contents |
|---|---|
| **General** | Name, Description, **Session Mode** radio (Automatic / Single Session / Per-Stage Sessions) |
| **Project & Codebases** | Project dropdown (Global or per-project), the codebase picker, and **Post-processing**: *Auto-commit changes* / *Push the work branch* / *Auto-create Pull Request* (`OrchestratorConfig.autoCommit | autoPush | autoCreatePR`). They imply one another downstream, and the run uses the same commit → sync → push → PR flow the Changes tab does; a conflict fails the step with the report attached to the run. |
| **Variables** | Add/Edit/Delete variables (Name + Label + Type + Required + Default). Type dropdown: String / Number / Boolean / Choice / Text multiline |
| **Hooks** | Workflow-scope hooks with phase dropdown (15 options), Type (Script/HTTP/Function), Failure policy, etc. |
| **Tags & Metadata** | Free-form tag input |

**Stage Properties panel** (right drawer, slide-in):

**Properties tab:**

| Section | Contents |
|---|---|
| **Basic** | Stage Name, Description |
| **Model & Template** | Template (read-only), Model Override dropdown, Reasoning Effort dropdown |
| **Prompts & Context** | Inline / Files / Agent tabs; per-prompt label + Wait checkbox + reorder + edit/preview/delete; multiline textarea |
| **Skills** | Toggleable list of system + project skills |
| **MCP Servers** | Toggleable list of system + project MCP servers (8 system defaults) |
| **Variables** | Stage-local variables |

**Execution tab:**

| Section | Options |
|---|---|
| **Run Condition** | Always / On upstream success / On upstream failure / Custom expression |
| **Timeout (seconds)** | Numeric stepper |
| **Context from Predecessors** | Summary only (default) / Full context / No context / Structured |
| **Retry Policy** | Toggle + max retries + backoff + multiplier |
| **Result Validation** | List of rules with type dropdown (Contains / Not Contains / Min Length / Max Length / Regex Match / Custom Script / JSON Schema / LLM Validation) + value + failure message |
| **Hooks** | Stage-scope hook list (`pre_run`, `post_run`, …) |

**Run button** opens the Run dialog:
- Variable inputs (per workflow variables)
- **Stage Overrides** collapsible section — toggle skip per stage + override config
- **Custom Content** tabs — upload Prompts / Skills / Agents that exist only for this run

---

## 6. Scripts (PWS)

### `/scripts` page
- Cards: name, description, stages count, profiles count, tags.
- **Run with defaults** button.
- Reload button (re-scans `templates/scripts/`).
- Search filter.

### `/scripts/:id` page
- Stages list (collapsed).
- Edges list.
- Run Profiles (each expandable: variables, sessionMode, permissionMode, stageOverrides).
- **Run Script** button (profile picker).
- **Materialize** button (creates a mutable workflow definition).

---

## 7. Run page

`/workflows/:runId/runs/:rid` or accessed from definition page.

Header: status badge (Queued / Running / Paused / Completed / Failed / Cancelled), stage count, duration, started time.

Buttons: **Pause / Resume / Cancel / Retry / Run Settings** (drawer).

Left pane: **RuntimeDAGCanvas** — same DAG layout as builder but live status colors per stage (gray pending, blue running, green completed, red failed, amber awaiting_input, gray skipped).

Right pane tabs:

| Tab | Contents |
|---|---|
| **Changes** *(default)* | `RunArtifactsPanel` — workspace files + per-worktree files + Download all + View Diff. |
| **Inspector** *(add-able)* | Per-stage prompt + response + hooks + tools drill-down (`RightInspector`). |
| **Browser** *(add-able)* | Integrated Browser panel — WebSocket JPEG live-view with click-through + typing, viewport that follows the panel size, overlay scroll indicator. Disabled until the run has a workspace. See [feature-integrated-browser.md](./feature-integrated-browser.md). |
| **Terminal** *(add-able, multi-tab)* | Integrated Terminal panel with a **`[cd ▾]`** worktree quick-jump dropdown in the header. See [feature-integrated-terminal.md](./feature-integrated-terminal.md). |

Bottom pane: **RunTimeline** — chronological event log with timestamps + durations.

**HITL Banner** appears at top when a stage is `awaiting_input`:
- "Stage 'X' is awaiting your input" + **Review & Approve** button.
- Opens the **HitlPanel** in the Run Settings drawer.

**HitlPanel** in Run Settings drawer:
- Permission mode dropdown (4 options): Auto-approve (default) / Ask for unmatched requests / Auto-approve file edits only / Plan mode (approve every tool call).
- Description text updates per selection.
- Awaiting stages list with interrupt data JSON.
- **Approve** button → stage status returns to running.
- **Reject** button → stage status returns to running (rejection still resumes; equivalent to "deny this action, continue").

---

## 8. Automations

### `/automations` (list page)
Cards with: name, trigger type, enabled toggle, last run, executions count.

### `/automations/new` (create form)
| Section | Options |
|---|---|
| **Basic Info** | Name, Description |
| **Trigger** | **Manual** / **Schedule** (cron `0 9 * * *` default + help) / **Webhook** (token generated on save) |
| **Project Scope** | All Projects (Global) or per-project |
| **Workflows** | Multi-select with `(global)` badges |
| **Input Mode** | **Single** / **Loop** (Variable Name + Items JSON Array + Max Concurrency + On Error) / **Batch** (Data Format CSV/JSON Array/JSONL + Batch Data + Max Concurrency + On Error) / **Script** (DataSourceConfig — inline / file / script command) |
| **Base Variables** | JSON object merged into every run |

### `/automations/:id` (detail)
- Trigger config summary
- Workflows list
- Executions table (status, started, completed, total iterations, completed, failed)
- Per-execution detail with nested workflow runs

Buttons: Enable / Disable / Trigger / Rotate Webhook Token / Delete.

---

## 9. Templates

`/templates` page: 5 system template cards. **Use Template** button → creates a new mutable workflow with name, description, stages, edges, default Success edges, then redirects to `/workflows/<id>/edit`.

---

## 10. Settings

A routed **page** at `/settings/:section?` inside the app layout — not a modal. The section is in the URL, so `/settings/source-control` is a link every "Connect GitHub" call-to-action uses, and a reload keeps you where you were. `/settings` alone is General.

- **Back** (top left) returns to the page you came from, or the dashboard when Settings was opened directly in a fresh tab. **Esc** does the same.
- Picking a section from the nav rail *replaces* the history entry, so paging through sections never buries the page you arrived from.
- `openSettings(section)` — the sidebar gear, the command palette and every in-app deep link — navigates here.

Sections:

| Tab | Contents |
|---|---|
| **General** | Default model for new chats; About (version 0.1.0). |
| **Appearance** | **Mode** — Light / Dark / System (System shows which variant it resolved to); **Theme** — 17 palettes, each with a light and a dark variant and a live mini-preview, grouped as *Product* (GitHub, Graphite, Carbon, Clay), *Editor* (One, Dracula, Tokyo Night, Catppuccin, Ayu, Night Owl, Rosé Pine) and *Low glare* (Nord, Everforest, Gruvbox, Solarized, Flexoki, High Contrast). A theme owns surfaces, hues, type stack and corner radii; **Accent** — six accents drawn from the active theme's own palette. All three apply instantly, persist per device, and drive every surface including the integrated terminal, code blocks, the DAG canvas and charts. `High Contrast` targets WCAG AAA rather than AA. See [apps/web/DESIGN_SYSTEM.md](../../apps/web/DESIGN_SYSTEM.md#1-tokens--theming). |
| **Browser & Terminal** | **Integrated Browser** — web-only interactivity toggle (default OFF: user can only view + scroll + Inspect; desktop always full); **Integrated Terminal** — default shell override, Load PowerShell profile toggle, Allow SSH/AWS secrets toggle (all persisted to localStorage; apply next time you open a Terminal tab). |
| **Provider** | One card per provider (GitHub Copilot, Claude Agent SDK, Codex) with live status (installed → client running → authenticated), the models it serves, **Test connection**, **Make default**, and — for providers with an in-app flow (Codex: ChatGPT browser sign-in via `account/login/start`) — **Sign in** / **Sign out**. The Codex CLI ships with the build (`@openai/codex`), so only the sign-in is needed. |
| **Source Control** | Connected **accounts** (avatar, login, host, sign-in method, a *Default* badge, **Set default** and **Disconnect**). **Connect account** offers exactly the methods the server reports: *Sign in with GitHub* (device flow — shows the user code with a copy button and an **Open GitHub** link, then polls at the interval GitHub asked for), *Paste a token* (PAT + optional Enterprise host + label) and *Use GitHub CLI* (imports the token `gh` already holds on the server host). Below: **Model for commit messages & PR text** (or *Heuristic (no model)*), **Default editor** (editors the server host cannot launch are named "not found on this machine" — they still work through their URL scheme in a browser) and a **Fallback base branch**. Tokens are write-only and never come back to the browser. |
| **Copilot** | SDK Connection: Connected (Refresh button), 12+ Available Models list |
| **Advanced** | Server Health (Status/Database/Copilot SDK/Uptime), Sandbox status, Configuration info |

---

## 10b. Open in editor

A split button in the top bar on chat, workflow-run, project and codebase pages. The left half opens the page's subject in the default editor; the caret lists every editor the server knows about (marking the ones it cannot launch) plus **Copy path**.

What it opens comes from the page, not the header: each page publishes a path into `editorTargetStore` while it is mounted — a chat's primary mount, a run's workspace root, a project's first codebase checkout, a codebase's own path. No target, no button.

The launch happens on the **server** host (`POST /api/editor/open`). When it cannot launch anything — typically a browser talking to a server on another machine — the response carries a `vscode://`-style `fallbackUrl` and the browser opens that instead. The Changes tab's per-file **Open in editor** action uses the same path, and is hidden when the server reports no editor and we are not in the desktop shell.

---

## 11. Theme

Tailwind 4 + CSS custom properties, generated from [`packages/design-tokens`](../../packages/design-tokens/). Three orthogonal axes — mode × theme × accent — applied as a class plus two `data-` attributes on `<html>`, so a switch is two attribute writes and zero re-renders. The **System** mode respects `prefers-color-scheme` and keeps following it live. All three are persisted to `localStorage` (`generatorai-theme`, `generatorai-theme-palette`, `generatorai-accent`) and re-applied by an inline script before first paint, so there is no flash on reload.

Every theme × appearance × accent combination is asserted against WCAG AA in `packages/design-tokens/src/__tests__/tokens.test.ts`. Full details: [apps/web/DESIGN_SYSTEM.md](../../apps/web/DESIGN_SYSTEM.md#1-tokens--theming).

---

## 12. Authentication

Currently the server has no auth (development setup). For prod deployment you'd:
1. Wrap server behind a reverse proxy with auth (OAuth/SSO).
2. Set `--api-key` flag on the web app's `apps/web/src/platform/HttpPlatformClient` (add header).
3. Disable SSE auto-reconnect for unauthenticated sessions.

This is on the roadmap; no code change yet.

---

## 13. Embedding

The web app is fully static once built (`pnpm --filter @generatorai/web build`). To embed in an existing site:

1. Run `apps/server` somewhere.
2. Configure CORS in `apps/server/src/app.ts` for your origin.
3. Build the web app with `VITE_API_BASE=https://your-server.example.com` and serve `apps/web/dist/`.

Alternatively, integrate via the REST API directly — see [feature-streaming-events.md](./feature-streaming-events.md) for the wire format.

---

## 14. Edge cases & UX notes

1. **Stream reconnect** — UI shows a small "reconnecting…" indicator in the lower-right when SSE drops. Auto-resumes via `Last-Event-ID`.
2. **Pause mid-stage** — UI button is disabled while harness call is in flight; pause takes effect at the next safe boundary (after current prompt completes).
3. **Worktree creation latency** — `CreateChatDialog` and Run dialog show a spinner while the worktree is being created (10-30s for large repos).
4. **Unsaved changes in builder** — leaving the page prompts a confirmation dialog if the workflow has unsaved edits.
5. **Stale cache** — All TanStack Query keys invalidate on successful mutations. Refreshing the page hard-fetches from the server.
6. **Browser back/forward** — React Router preserves Zustand state for builder undo/redo, but TanStack Query refetches.
7. **Validation rule UI** — adding a `regex` rule shows a "flags" sub-input (e.g., `i`, `m`).
8. **Bulk delete** — confirmation dialog shows the count and disables if any selected workflow has active runs.
9. **`agentName` requires a project** — `AgentSelector` shows "Link a project to select agents" if no project is set.
10. **Long stage prompts** — the textarea grows to a max-height then scrolls.
