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
| **Settings** | Project settings (maxCodebases, worktreeRetention, autoFetchInterval, …). |

`/projects/:id/codebases/:cid` — Codebase detail page with file browser (tree view + viewer), branches list, fetch button.

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
| **Changes** *(always present, default)* | `ChatFilesPanel` — workspace files, per-worktree files, response markdown, attachments. Click any file → `FileViewerModal`. |
| **Browser** *(add-able, singleton)* | Integrated Browser panel (`BrowserPanel`) — VSCode-style share/inspect/capture bar, WebSocket JPEG live-view with click-through + typing, viewport that follows the panel size (no letterbox), overlay scroll indicator on the right edge. Disabled until the chat has a workspace. See [feature-integrated-browser.md](./feature-integrated-browser.md). |
| **Terminal** *(add-able, multi-tab)* | Integrated Terminal panel (`TerminalPanel`) — xterm.js with inline search, Attach-selection-to-chat, Clear, Kill. Multiple parallel terminals per workspace. See [feature-integrated-terminal.md](./feature-integrated-terminal.md). |
| **Canvas** *(auto-added on first widget render)* | `CanvasHost` — stacked sandboxed widget iframes served from `/api/widget-assets`. Agent-rendered UI (polls, forms, editors, dashboards) that users can click through; clicks and typing round-trip back to the agent via `read_widget`. See [feature-extensions-widgets.md](./feature-extensions-widgets.md). |

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
| **Project & Codebases** | Project dropdown (Global or per-project) |
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

`/settings` page, grouped into sections:

| Tab | Contents |
|---|---|
| **General** | Default model for new chats; About (version 0.1.0). |
| **Appearance** | **Mode** — Light / Dark / System (System shows which variant it resolved to); **Theme** — 17 palettes, each with a light and a dark variant and a live mini-preview, grouped as *Product* (GitHub, Graphite, Carbon, Clay), *Editor* (One, Dracula, Tokyo Night, Catppuccin, Ayu, Night Owl, Rosé Pine) and *Low glare* (Nord, Everforest, Gruvbox, Solarized, Flexoki, High Contrast). A theme owns surfaces, hues, type stack and corner radii; **Accent** — six accents drawn from the active theme's own palette. All three apply instantly, persist per device, and drive every surface including the integrated terminal, code blocks, the DAG canvas and charts. `High Contrast` targets WCAG AAA rather than AA. See [apps/web/DESIGN_SYSTEM.md](../../apps/web/DESIGN_SYSTEM.md#1-tokens--theming). |
| **Browser & Terminal** | **Integrated Browser** — web-only interactivity toggle (default OFF: user can only view + scroll + Inspect; desktop always full); **Integrated Terminal** — default shell override, Load PowerShell profile toggle, Allow SSH/AWS secrets toggle (all persisted to localStorage; apply next time you open a Terminal tab). |
| **Provider** | One card per provider (GitHub Copilot, Claude Agent SDK, Codex) with live status (installed → client running → authenticated), the models it serves, **Test connection**, **Make default**, and — for providers with an in-app flow (Codex: ChatGPT browser sign-in via `account/login/start`) — **Sign in** / **Sign out**. The Codex CLI ships with the build (`@openai/codex`), so only the sign-in is needed. |
| **Copilot** | SDK Connection: Connected (Refresh button), 12+ Available Models list |
| **Advanced** | Server Health (Status/Database/Copilot SDK/Uptime), Sandbox status, Configuration info |

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
