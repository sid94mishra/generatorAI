# GeneratorAI — Web + Desktop Feature Catalog (mobile-parity baseline)

Generated 2026-09-06 from the `arch-redesign` working tree (uncommitted changes included).
Repo root: `C:/Users/sidmishra/Desktop/New folder (2)/GeneratorAI`. Paths below are relative to it.

Sources: `.github/docs/usage-web.md`, `apps.md`, `architecture.md`, every `feature-*.md` (working-tree `feature-chat.md`), then verified against `apps/web/src/**`, `apps/desktop/src/**`, `apps/server/src/routes/**`, `packages/{shared,core,auth,agent-harness-providers,client-core}`.

Legend: **[doc-stale]** = the doc describes something the code no longer has / has differently. **verify** = not independently confirmed in code.

Doc-vs-code discrepancies worth knowing up front:
- `usage-web.md` lists a `/templates` route and a 4-tab Settings page. The router has **no** `/templates` route (templates live in Settings → Templates), and Settings is a **modal** with 14 sections, opened from the sidebar; `/settings` only redirects and opens the modal (`apps/web/src/pages/SettingsRoute.tsx`).
- `usage-web.md` says "no auth"; the code has a full device-pairing/DPoP auth gate (`apps/web/src/components/AuthGate.tsx`, `packages/auth`).
- `usage-web.md` sidebar has 8 entries; code has 7 nav items + Settings button (no Templates entry; Agents added).

---

## 1. Navigation / Information Architecture

### 1.1 Route table (`apps/web/src/router.tsx`)

| Route | Page component | Notes |
|---|---|---|
| `/` | `DashboardPage` | |
| `/chats` | `ChatsListPage` | New-chat dialog is a modal on this page |
| `/chats/:id` | `ChatPage` | |
| `/agents` | `AgentsListPage` | |
| `/agents/new`, `/agents/:id` | `AgentEditorPage` | |
| `/settings` | `SettingsRoute` | redirect → opens Settings modal |
| `/workflows` | `WorkflowListPage` | |
| `/workflows/new`, `/workflows/:id/edit` | `WorkflowBuilderPage` | |
| `/workflows/:id` | `WorkflowDefinitionPage` | read-only |
| `/workflows/:id/runs/:runId` | `WorkflowRunPageV2` | |
| `/automations`, `/automations/new`, `/automations/:id` | `AutomationsPage`, `CreateAutomationPage`, `AutomationDetailPage` | |
| `/projects`, `/projects/new`, `/projects/:id` | `ProjectsListPage`, `CreateProjectPage`, `ProjectDetailPage` | |
| `/projects/:id/codebases/:cid` | `CodebaseDetailPage` | |
| `/scripts`, `/scripts/:id` | `ScriptsListPage`, `ScriptDetailPage` | |
| `*` | 404 | |

Every page is lazy-loaded and wrapped in `PageErrorBoundary` + `Suspense` (page crash keeps shell alive).

### 1.2 App shell (`apps/web/src/App.tsx`, `components/layout/*`)

| Element | Details | File |
|---|---|---|
| Provider stack | `ThemeProvider → QueryProvider → PlatformProvider → AuthGate → RouterProvider` + global `Toaster` | `App.tsx` |
| Sidebar nav | Logo (→ `/`), Hide-sidebar button, items: Dashboard, Projects, Chats, Agents, Workflows, Scripts, Automations; footer: Settings (opens modal), "Command palette ⌘K" hint | `components/layout/Sidebar.tsx` |
| Header | Show-sidebar (when collapsed), context breadcrumb/title, `ConnectionStatus` pill, chat-only Archive button (+confirm), appearance cycle button (light→dark→system), right-pane toggle (only when page registers a controller) | `components/layout/Header.tsx`, `stores/rightPaneStore.ts` |
| TitleBar | Desktop-shell-only strip; double-click toggles maximize | `components/layout/TitleBar.tsx` |
| RightPane | Generic tabbed dock used by Chat + Run pages: drag-resize (persisted), tab strip with overflow menu, `+` add-tab popover (respects `allowMultiple` / `maxInstances`, "N tabs is the limit" notice), per-tab close, fullscreen toggle, close pane, Esc handling, per-page `localStorage` persistence; on narrow viewports becomes a full sheet | `components/layout/RightPane.tsx` |
| Command palette | ⌘/Ctrl+K; Navigate group (Dashboard/Projects/Chats/Workflows/Scripts/Automations/Settings), Actions group (New Chat/Workflow/Automation/Project) | `components/layout/CommandPalette.tsx`, `AppLayout.tsx` |
| Breadcrumb / Toolbar / PageContainer / PageHeader | layout primitives | `components/layout/*` |
| Mobile drawer | Sidebar becomes a `Drawer` sheet on small screens | `components/ui/Drawer.tsx` |
| Error boundaries | Root (`Try Again` / `Go Home`) and per-page (`Retry` / `Back to home`) | `components/ErrorBoundary.tsx`, `PageErrorBoundary.tsx` |
| Toasts | sonner-backed `toast({variant,title,description,logs,duration})`; error 8s, others 4s, `0` = sticky; expandable logs | `components/Toast.tsx` |
| Offline / reconnect | Per-scope SSE state (connected/reconnecting/disconnected), gap tracking, "events may be missing" badge + Refresh (invalidates all queries) | `stores/connectionStore.ts`, `components/status/ConnectionStatus.tsx` |
| PWA | None (no manifest / service worker) | — |
| OS / push notifications | None in web (`new Notification(` absent). Push exists only in mobile app; server has `PUT/DELETE /api/auth/push-token`, `PUT /api/auth/push-token/mute` | — |

### 1.3 Global keyboard shortcuts

| Shortcut | Effect | File |
|---|---|---|
| ⌘/Ctrl+K | Command palette | `layout/AppLayout.tsx` |
| ⌘/Ctrl+F | Terminal inline find | `terminal/TerminalPanel.tsx` |
| Delete / Backspace | Remove selected DAG node/edge | `workflow/DAGCanvas.tsx` |
| ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z | Undo / redo in DAG | `workflow/DAGCanvas.tsx` |
| ⌘/Ctrl+S | Save workflow | `pages/WorkflowBuilderPage.tsx` |
| Enter / Shift+Enter / Ctrl+Enter | Send / newline in composer (capability-gated) | `chat/ChatInput.tsx` |
| ↑ / ↓ (first/last line) | Prompt history recall | `chat/ChatInput.tsx`, `chat/composer/promptHistory.ts` |
| Esc | Close search/popovers, exit right-pane fullscreen, cancel confirm states | multiple |
| Desktop-only accelerators | Ctrl/Cmd+N New Chat, Ctrl/Cmd+Shift+N New Workflow, Ctrl/Cmd+B sidebar, Ctrl/Cmd+Alt+B right panel, Ctrl/Cmd+1..6 sections, Cmd+[ / ] or Alt+←/→ back/forward, Ctrl/Cmd+, Settings, Ctrl/Cmd+/ shortcuts, Ctrl/Cmd+R reload | `apps/desktop/src/main/menu.ts` → `apps/web/src/hooks/useDesktopIntegration.ts` |

No user-configurable keybinding settings exist.

---

## 2. Feature areas

### 2.1 Dashboard (`apps/web/src/pages/DashboardPage.tsx`)

| Capability | Details | File | Route/hook |
|---|---|---|---|
| Greeting + `SystemStatusPill` | Disconnected / N running / All idle | `components/dashboard/SystemStatusPill.tsx` | `useLiveOperations` |
| New Chat button | Opens `CreateChatDialog` | `DashboardPage.tsx` | — |
| New Workflow button | → `/workflows/new` | | — |
| Stat cards ×4 | Chats, Workflows, Automations (click → list), Health (→ Settings/Diagnostics) | `components/dashboard/HealthStatCard.tsx` | `useChats`, `useWorkflowDefinitions`, `useAutomations`, `useHealth` |
| ActivityPanel | Tabs Today / Running / Needs attention; inline row actions: Cancel run, Restart failed run, Cancel automation, Restart automation, Stop chat; live elapsed timer | `components/dashboard/ActivityPanel.tsx` | `useCancelWorkflowRun`, `useRetryWorkflowRun`, `useCancelChat`, `useCancelAutomationExecution`, `useTriggerAutomation` |
| SystemHealthCard | heartbeat, uptime, provider health, DB health, active chats/runs | `components/dashboard/SystemHealthCard.tsx` | `GET /api/health` |

**[doc-stale]** `usage-web.md` describes 4 stat cards (Active Chats/Workflows/Active Runs/Completed Runs) + 3 recent panels; code has the ActivityPanel instead.

### 2.2 Chat list (`apps/web/src/pages/ChatsListPage.tsx`, `components/chat/ChatList.tsx`)

| Capability | Details | Route/hook |
|---|---|---|
| Virtualized list | `@tanstack/react-virtual` | `useChats` → `GET /api/chats` |
| Search | name + tags substring | client |
| Status filter tabs | All / Active / Archived | client |
| Sort | fixed `updatedAt` desc (no control) | — |
| New Chat | opens `CreateChatDialog` | — |
| Select mode + Select All / Deselect All | bulk checkbox | — |
| Bulk delete (+confirm) | | `useBulkDeleteChats` → `DELETE /api/chats/:id` ×N |
| Row content | archived/active icon, up to 2 tags + "+N", relative time, model badge | — |
| Per-row pin / rename / single delete / tag edit | **not present** (archive only via Header on the chat page; hooks `useArchiveChat`/`useDeleteChat` exist) | archive = `PATCH /api/chats/:id {status:'archived'}` (`platform/HttpPlatformClient.ts:703`); **[doc-stale]** `feature-chat.md`'s `POST /api/chats/:id/archive` and `/stop` do not exist in `routes/chats.ts` (cancel is `POST /api/chats/:id/cancel`) |

#### CreateChatDialog (`components/chat/CreateChatDialog.tsx`)

| Field | Options | Route |
|---|---|---|
| Name (required), Description | | `POST /api/chats` |
| Model | `ModelPicker` (live catalog, provider rail, search, details popover, refresh) | `GET /api/harness/providers` |
| Agent binding | `AgentPicker` + "Customize capabilities" → `AgentOverridesEditor` + `EffectiveCapabilitiesPanel` | `GET /api/agents?selectable=1`, `POST /api/agents/resolve-preview` |
| Orchestrate mode | checkbox (`orchestratorMode`) | |
| Sources | `SourcePicker`: add codebase (project) or local folder (`DirectoryBrowser`, host-only), worktree vs in-place, branch mode (current / existing / new + base ref), alias, reorder, set primary (cwd), remove | `GET /api/fs/dirs`, `GET /api/fs/git-info`, `GET /api/projects/:id/codebases/:cid/branches` |
| Advanced: Tags | chip input | |
| Advanced: Browser visibility | Headless / Visible / Off; "Allow run_playwright_code" (`evalAllowed`); Allowed hosts | `components/browser/BrowserVisibilityPicker.tsx` |

### 2.3 Chat page (`apps/web/src/pages/ChatPage.tsx`)

| Capability | Details | Route/hook |
|---|---|---|
| Transcript | `ChatMessageList` (persisted) + optimistic user bubble + `LiveTranscript` + `ThinkingPlaceholder`; stick-to-bottom with "Jump to latest" | `GET /api/chats/:id/messages` (paged, "Load earlier" +100) |
| Status banner | Generating… / Processing… / Paused — waiting for your input | streamStore |
| Archived banner | when `status==='archived'` | |
| Composer (`ChatInput`) | active chats only — see 2.4 | |
| `ChatChangesTray` | docked above composer: "N files changed · +A −D", live pulse, expandable tree, click → Changes tab, **Review changes** button | `GET /api/workspaces/:id/changes` |
| Right pane tabs | Changes (default), Files (≤4), File (per-file ≤8), Browser (≤5), Terminal (≤4, or Agent Console), Computer, Widget (≤6), Background Tasks, Plan | `RightPane` |
| Auto-open tabs | Browser on `browser.session_created` (visible mode), Computer on `computer.session_started`/`consent_required`, Widget per full-page widget, Background Tasks for orchestrator chats, Plan on `awaiting_review` | SSE |
| Edit Sources | `EditSourcesDialog` mid-conversation | `PUT /api/chats/:id/sources` (409 `CHAT_BUSY` while a turn runs) |
| Workspace prep gating | Send disabled until `workspace.prep` ready; Retry / Edit sources | `POST /api/chats/:id/workspace/prepare` |
| Two-phase Stop | Stop → "Stopping…" → Force reset (15s escape hatch) | `POST /api/chats/:id/cancel`; `hooks/useTwoPhaseStop.ts`, `pages/chatStopEffects.ts` |
| Plan gate (PLN-01) | approve / request changes / answer via optimistic writes | `POST /api/chats/:id/plans/:planId/decision` |
| Pending interactions reconciliation | 5s poll, expires stale cards | `GET /api/chats/:id/interactions` |
| Model / effort / context-tier persistence | composer picks saved to chat | `PATCH /api/chats/:id` |
| Header Archive | with confirm | `PATCH /api/chats/:id` |
| Stream connection | multiplexed unified stream | `POST /api/stream/tickets`, `POST /api/stream/connections`, `GET /api/stream?c=`, `GET /api/stream/replay` |
| Send refused | 409 `CHAT_BUSY` / `INTERACTION_PENDING` restores draft + "Message not sent" toast | |
| Message dedup / prompt history feed | derived from persisted user messages | |
| Sources panel | read-only mounts (alias, mode, branch, dirty dot, path, copy) | `GET /api/workspaces/:id` |
| Background Tasks panel | orchestrator worker chats with status; cancel | `GET /api/chats/:id/background-tasks[/:taskId]`, `POST …/cancel` |
| Plan document panel | full plan review: read revisions, edit content, inline comments, approve/request changes, save to workspace | `GET/PUT /api/chats/:id/plans/:planId/content`, `POST …/comments`, `POST …/decision`, `POST …/save-to-workspace` |
| Computer panel | window frames, live preview, consent prompts, grants, activity, recording replay | `GET /api/workspaces/:id/computer/{frames,activity,consent,grants,runtime,recording/*}` |
| Agent Console | shell-history view of agent-run commands (Terminal tab variant) | `components/chat/AgentConsole.tsx` |

**Not present in chat:** retry/regenerate a turn, edit a sent message, fork/branch a conversation, share/export chat, per-row pin/rename.

### 2.4 Chat composer (`components/chat/ChatInput.tsx`, `composer/*`, `sources/*`, `VoiceRecorder.tsx`)

| Control | Details | Route/hook |
|---|---|---|
| Textarea | auto-resize ≤200px; Enter send / Shift+Enter newline (capability-gated) | `POST /api/chats/:id/prompt` (multipart, ≤10 attachments × 10 MB) |
| Send / Stop / Force-reset | two-phase stop | `POST /api/chats/:id/cancel` |
| Attach file | picker, drag-drop, paste image; chips with remove + image hover preview | attachments on prompt; served back via `GET /api/chats/:id/attachments/:artifactId` |
| Pending captures | browser Inspect/Capture + terminal Attach queue files; "📎 N capture pending" | |
| Model picker | `shared/ModelPicker.tsx`: provider rail (locked when unready, error tooltip), search, per-model details (context window, long-context tier, reasoning levels, vision, pricing), Refresh catalog (`?refresh=1`), brand icons | `GET /api/harness/providers`, `GET /api/harness/models` |
| Reasoning effort | Default / Low / Medium / High / Extra High (model-provided list; `low|medium|high|xhigh|max`); overflows into "⋯" on narrow toolbars | `PATCH /api/chats/:id` (`harnessConfig.reasoningEffort`) |
| Context-window tier | Standard vs Long context (`contextTier: default|long_context`), shown only when model `supportsLongContext` | `PATCH /api/chats/:id` |
| Context usage gauge | ring + popover breakdown (system/tools/MCP/memory/skills/conversation), cost, duration, auto-compact marker | `harness.context_usage` events |
| Agent mode picker | Interactive (`auto`) / Plan (`plan`); `AGENT_MODE_REGISTRY` in `packages/shared/src/types/AgentMode.ts` | `PATCH /api/chats/:id` (`defaultAgentMode`) |
| Permission mode | changed via `PATCH /api/chats/:id/permission-mode` (`bypassPermissions|default|acceptEdits|plan`); raising to bypass requires `admin:settings`. UI exposure: agent mode drives it; no separate composer dropdown found — verify | |
| Bound-agent chip | read-only, frozen for conversation | |
| Codebase / local-folder panel | expandable read-only list of mounts | `useProjectCodebases` |
| Slash commands `/` | built-ins `/browser`, `/terminal`; skills (system + project), prompts (lazy template load), Computer Use skill; fuzzy menu; active-command pill | `GET /api/system/artifacts`, `GET /api/projects/:id/available-artifacts` |
| `@` mentions | fuzzy file index over workspace / source / worktree / artifacts; attaches file content | `GET /api/workspaces/:id/files`, `GET /api/workspaces/:id/files/content` |
| Prompt history ↑/↓ | recalls prompt + re-materialises attachments; draft parking | `GET /api/chats/:id/attachments/:artifactId` |
| Voice dictation | mic button → recording pill (waveform, pause/resume, cancel/accept), live interim text region, "scratch that" retraction; engines Nemotron/Moonshine/Parakeet/Whisper (server) | WS `/api/stt/stream` (`apps/server/src/stt-ws.ts`), `hooks/useSpeechToText.ts` |
| Read aloud / Speak live (TTS) | implemented, hidden by `READ_ALOUD_ENABLED=false` (`chat/featureFlags.ts`) | WS `/api/tts/stream`, `hooks/useTextToSpeech.ts` |
| Built-in command hand-off | `/browser` pre-starts the browser tab | `POST /api/workspaces/:id/browser/start` |
| Workspace prep bar | preparing / error, Retry, Edit sources | `POST /api/chats/:id/workspace/prepare` |
| Pending-interaction banner | "Waiting on your plan review…" + "Cancel and send" | |
| Repo count chip | toggles codebase panel | |
| Loading skeleton | while model catalog pending | |

### 2.5 Streaming timeline (`components/agent/StreamPanel.tsx`, `StepRow.tsx`, `deriveTimeline.ts`, `groupSteps.ts`, `chatMessageToBlocks.ts`, `streamActions.ts`, `UsageChip.tsx`)

`StreamBlock` union (`packages/client-core/src/stream/types.ts`): `ThinkingBlock, TextBlock, ToolCallBlock (+fileOp hunks), SystemBlock (system|subagent|error|warning), WidgetBlock (inline|widget), PlanBlock, QuestionBlock, PermissionBlock`.

| Block / step | Rendering | User actions |
|---|---|---|
| Thinking | collapsible "Thinking about… / Thought about…" | expand |
| Text answer | `IncrementalMarkdown` live → `MarkdownRenderer`; code blocks with copy | copy, links |
| Tool: read | "Read N files" group | expand args/result, open in Changes |
| Tool: write/edit/create | `+A −D`, inline unified diff (`InlineDiff.tsx`, ≤160 lines, "hunksTruncated" link), raw toggle | open in Changes |
| Tool: grep/glob/search | "Searched N times" | expand |
| Tool: bash/shell/powershell | "Ran N commands"; open in Agent Console | expand |
| Tool: memory | "N memory operations" | expand |
| Tool: generic / MCP (`mcp__server__tool` humanized) | named row | expand |
| Sub-agent | "Explore <agent>" nested children (`parentCallId` / subagent system block) | expand |
| Failed tool | red cross + "Failed" (`is_error` / `{ok:false}`) | |
| Ask-user question | `QuestionCard.tsx`: paginated, radio/checkbox, markdown previews, "Other…" | Answer, Skip & let agent decide, Next/Prev |
| Permission request | `PermissionCard.tsx`: tool, type badge, redacted input | Allow / Deny (+reason) → `POST /api/chats/:id/interactions/:iid/permission` |
| Plan card | `PlanCard.tsx`: title, status, revision, summary | Review plan (Plan tab), Approve & implement, Approve & run autonomously, Request changes |
| Error / Warning | row + red banner / warning row (e.g. MCP failed) | expand |
| Usage chip | model, ↑/↓ tokens, cache-read, duration, cost, cache-miss notice | hover |
| Screenshot image | image badge + hover preview; `GET /api/workspaces/:id/browser/files/*` | open |
| Widget inline / full-page | sandboxed `WidgetFrame` / own tab | interactive |
| Attachments on user msg | `AttachmentChips.tsx` with preview/download | |
| "Stopped before the agent responded" | marker on cancel | |
| Group rows | consecutive same-kind steps fold (`StepGroupRow`) | expand |
| Detail cap | 260 px scroll panel | |
| Motion | `ThinkingPlaceholder`, 180 ms settle, indeterminate bar | |

**Not distinct block types:** todo/checklist (only in `redesign/types.ts` proposal), checkpoints (Changes tab only), hooks (captured but rendered only in run Inspector), notifications, skill invocation (surfaces as tool calls).

### 2.6 Changes view (`components/diff/*`)

| Capability | Details | Route/hook |
|---|---|---|
| Summary-first load, lazy file bodies (ETag) | | `GET /api/workspaces/:id/changes`, `GET …/changes/file` |
| Base picker | Since session start / mount branch-base / per-turn checkpoints (`baseline|checkpoint:<id>|turn:<id>|ref:<sha>`) | `GET /api/workspaces/:id/checkpoints` |
| Diff modes | Split / Unified; wrap lines | `DiffCodeView.tsx` |
| File tree dock | left/right, `ChangesTree.tsx` (@pierre/trees) | |
| Expand all / Collapse all | auto-expand ≤3 files | |
| Per-file discard (revert) | writes `pre_restore` checkpoint | `POST /api/workspaces/:id/checkpoints/:cid/restore` (path-scoped) |
| Per-hunk revert | **not present** | |
| Checkpoint timeline | kind, label, phase, stats, prompt excerpt; Compare / Rewind (+confirm, result banner) | `CheckpointTimeline.tsx` |
| Manual checkpoint | server route exists; UI — verify | `POST /api/workspaces/:id/checkpoints` |
| Stage / unstage | **not present** | |
| Commit | commits everything | `POST /api/workspaces/:id/commit` |
| Pull request | create (title/body) + list with link | `POST /api/workspaces/:id/pull-request`, `GET …/pull-requests` |
| Open in external editor | **not present** | |
| Mount groups bar | alias, branch, stats; click jumps | `GET /api/workspaces/:id` |
| Refresh | | |
| Hidden workspace files toggle | "+N workspace files" (`changeVisibility.ts`) | |
| Alias prefixing | `<alias>/<path>` for multi-mount | `chat/changes/changePaths.ts` |
| Review comments | select lines → composer popover with intents Fix/Question/Refactor/Test/Note; thread card (reply, edit own, resolve, delete, send-to-agent); all-comments popover; batch bar (pending count, note, Preview, Send all, Discard) | `GET/POST /api/workspaces/:id/review/threads`, `POST …/threads/:t/comments`, `PATCH …/threads/:t`, `DELETE …/threads/:t`, `PATCH …/comments/:c`, `POST …/review/submit` |
| Comment count badge per file | | |
| Focus-file deep link | from step rows / tray / turn summary | |
| Files tab (`FilesSurface.tsx`) | browse all files, markdown preview/source, wrap, refresh, multi-repo headers; per-file tabs | `GET /api/workspaces/:id/tree`, `GET …/tree/file` |
| Diff engine | `@pierre/diffs` + 8-worker Shiki pool | `DiffProviders.tsx` |

### 2.7 Plan mode

| Capability | Details | Route |
|---|---|---|
| Agent mode `plan` | `permissionMode=plan`, blocking plan gate, question gate on | `packages/shared/src/types/AgentMode.ts` |
| Plan lifecycle events | `chat.plan.created/updated/drafting/review_requested/decided/expired/extraction_failed` | SSE |
| Plan tab (`PlanDocumentPanel.tsx`) | read, edit (optimistic concurrency), inline comments, approve / request changes, save to workspace | `/api/chats/:id/plans/*` |
| Claude-native tools recognised | `ExitPlanMode`, `AskUserQuestion` (`plan-gate.ts`) | |

### 2.8 Orchestrator mode / Background agents (`feature-orchestrator-chat.md`, `components/chat/BackgroundTasksPanel.tsx`)

| Capability | Details | Route |
|---|---|---|
| Orchestrate toggle | in CreateChatDialog / `PATCH /api/chats/:id` (`orchestratorMode`) | |
| Orchestrator tools | `list_models`, `spawn_background_agent`, `check_background_agents`, `send_to_background_agent`, `list_background_agents` | |
| Worker status | `running → needs_review → completed/failed/cancelled` | `chat.background_task.*` events |
| Background Tasks tab | list, digest, cancel | `GET /api/chats/:id/background-tasks[/:taskId]`, `POST …/cancel` |
| Shared workspace `tasks/<name>/`, `orchestrator/state.json` (hidden from Changes) | | |
| Tuning env | `GENERATORAI_ORCH_MAX_WORKERS`, `_MAX_REVIEW_ROUNDS`, `_DEFAULT_WORKER_MODEL`, `_WORKER_TIMEOUT_MS`, `_WARM_FIRST` | |
| Agent role `orchestrator` | team agents, max workers, default worker model (Agent editor) | |

### 2.9 Integrated Terminal (`components/terminal/TerminalPanel.tsx`)

| Control | Details | Route |
|---|---|---|
| Spawn / list / describe / scrollback / resize / signal / kill | | `POST/GET /api/workspaces/:id/terminals`, `GET /:sid`, `GET /:sid/scrollback`, `POST /:sid/resize`, `POST /:sid/signal`, `DELETE /:sid` |
| Live IO | xterm.js + Fit + WebLinks + Search + WebGL; binary WS, 64 KB ACK flow control, scrollback replay on reconnect | WS `/api/workspaces/:id/terminals/:sid/stream` (scope `exec:terminal`) |
| Header | cwd pill, host badge (pty/sandbox/fallback), agent badge, `[cd ▾]` worktree quick-cd (run page), Attach selection to chat, Find (Ctrl+F), Clear, Kill | |
| Banners | sandbox tint, fallback warning, exit code | |
| Session persistence | server sid cached per (workspace, tab) in localStorage | |
| Multi-tab | up to 4 per page | |
| Settings | default shell, load PowerShell profile, allow SSH/AWS secrets (localStorage) | Settings → Browser & Terminal |
| Limits | 5/workspace, 20/server; `GENERATORAI_TERMINAL=0` kill switch | |

### 2.10 Integrated Browser (`components/chat/BrowserPanel.tsx`, `NativeBrowserView.tsx`, `components/browser/BrowserVisibilityPicker.tsx`)

| Control | Details | Route |
|---|---|---|
| Start / Stop | | `POST /api/workspaces/:id/browser/{start,stop}` |
| Toolbar | Back / Forward / Reload, URL pill, Share (attach/detach to agent), Inspect (DOM selection → attachment), Capture (region PNG → attachment) | `POST …/actions`, `POST …/attach`, `POST …/detach`, `POST …/selection`, `POST …/capture` |
| Live view | WS JPEG/VP8 screencast + click/type/scroll/wheel/key input; viewport follows panel; overlay scroll indicator | WS `/api/workspaces/:id/browser/stream` (scope `exec:browser`), `POST …/input`, `POST …/resize`, `GET …/scroll`, `GET …/screencast.jpg` |
| Snapshots / files | | `GET …/snapshots`, `GET …/files/*`, `GET …/descriptor` |
| Cookie import | from local Chrome/Edge/Brave/Arc | `POST …/cookies/import` |
| Read page (a11y tree) | non-graphical clients | `POST …/read-page` |
| Visibility config | Headless / Visible / Off; `evalAllowed`; allowed hosts | chat/workflow create |
| Web-only interactivity toggle | default OFF (view/scroll/Inspect only) | Settings → Browser & Terminal |
| Desktop native mode | `GENERATORAI_DESKTOP_NATIVE_BROWSER=1` → Electron `WebContentsView` with annotate/pick-element/devtools/emulation/zoom | `apps/desktop/src/shared/browser-ipc.ts`, `/internal/browser/cdp-endpoint` |
| Agent tools | `open_browser_page, read_page, navigate_page, click_element, type_in_page, hover_element, drag_element, screenshot_page, handle_dialog, run_playwright_code` | `packages/core/src/tools/browser/index.ts` |
| Multi-instance | ≤5 tabs | |

### 2.11 Computer Use (`components/chat/ComputerPanel.tsx`, Settings → Computer Use)

| Control | Details | Route |
|---|---|---|
| Enable / allow synthetic | server-side settings; kill switch `GENERATORAI_COMPUTER_USE` | `GET/PUT /api/system/computer-use` |
| Driver runtime status / start / restart / stop | | `GET/POST /api/workspaces/:id/computer/runtime` |
| Consent prompts | list / answer; standing grants list / revoke | `GET/POST …/consent`, `GET …/grants`, `DELETE …/grants/:app` |
| Live preview | window frames, cursor, SSE `computer.preview.*` | `GET …/frames[/:id]`, `GET …/preview/stream` (legacy) |
| Activity audit | | `GET …/activity` |
| Recording | start/stop/status; video; per-turn before/click/after PNGs | `POST …/recording`, `GET …/recording/{video,turns,turns/:t/:kind}` |
| `/computer-use` slash skill | names staged skill + `computer_*` tools | `composer/builtins.ts` |
| Agent tools | 16 `computer_*` tools (`packages/core/src/tools/computer/index.ts`) | |
| Desktop host | `cua-driver` spawned by signed Electron app (macOS TCC) | `apps/desktop/src/main/computer-host.ts` |

### 2.12 Workflows — builder (`pages/WorkflowBuilderPage.tsx`, `components/workflow/*`)

| Control | Details | Route |
|---|---|---|
| Toolbar | Back, inline name, status text, Undo/Redo, Settings, Validate, properties toggle, Save (Ctrl+S), Run (after save) | `POST/PATCH /api/workflow-definitions[/:id]`, `POST …/:id/validate` |
| DAG canvas | React Flow: drag/connect, snap grid, zoom 0.2–1.5, minimap (>6), controls, edge legend, Auto-layout, Add Stage, Delete/Backspace, undo/redo | `DAGCanvas.tsx` |
| Stage node | name, status icon, pills (model, template, prompt count, agent, skills, MCP, validation, JSON out, retry); hover Duplicate / Delete | `StageNode.tsx` |
| Edges | `on_success` (green) / `on_failure` (red) / `on_completion` (blue) / `always` (gray); remove edge | `POST/DELETE …/:id/edges[/:e]` |
| Stage properties — Properties tab | Name, Description; Model override (`ModelPicker`), Reasoning effort; Prompts (Inline/Files/Agent, label, Wait, reorder, edit/preview/delete); Skills checklist; MCP checklist (8 bundled + project); Variables (key/value); Agent binding (`AgentBindingSection` + overrides + live preview) | `POST/PUT/DELETE …/:id/stages[/:s]` |
| Stage properties — Execution tab | Run condition (always / on_success / on_failure / expression), Timeout stepper, Context from predecessors (summary-only / full / none / structured), Approval required toggle, Retry policy (max, backoff, multiplier), Result validation rules (contains, not_contains, min_length, max_length, regex+flags, custom_script, json_schema, llm_validation), Output format (text/json + schema), Hooks (phase/type/failure policy, script/http/function config) | |
| Settings dialog | General (name, description, session mode auto/single/per-stage); Project & Codebases (project, ≤3 codebases, auto-commit, auto-PR); Variables (string/number/boolean/choice/text, required, default, options); Hooks (15 workflow phases); Tags & Metadata | `WorkflowConfigPanel.tsx` + `settings/*Tab.tsx` |
| Unsaved-changes blocker | confirm on leave | `useBlocker` |
| Resizable properties panel | 280–600 px; overlay on mobile | `useResizable` |
| Run dialog (`VariableInputModal`) | typed variable inputs, git-var autofill, upload prompts/skills/agents for this run, Stage Overrides (skip per stage) | `POST /api/workflow-runs`, `POST …/:id/start`, `POST /api/orchestrator/runs`, `POST /api/orchestrator/runs/:id/uploads` |

#### Workflow list / definition pages

| Control | Details | Route |
|---|---|---|
| List: search, Grid/List toggle (virtualized), Select mode → Select All / Delete Selected (+confirm), Template JSON download, Upload JSON, New Workflow, "Start from a template" banner (→ Settings/Templates), per-card Edit/Run/Delete | | `GET /api/workflow-definitions`, `POST …/import-json`, `DELETE …/:id` |
| Definition page: name, Orchestrated badge, meta chips, Run (dialog), Edit, Delete (overflow on narrow), read-only DAG, Recent Runs (Show more/less) | | `GET /api/workflow-runs?definitionId=` |
| Templates: 5 system templates; Use → creates definition | Settings → Templates | `GET /api/templates`, `POST /api/orchestrator/from-template`, `POST /api/workflow-definitions/import` |

### 2.13 Workflow runs (`pages/WorkflowRunPageV2.tsx`, `components/workflow/redesign/*`)

| Control | Details | Route |
|---|---|---|
| Header bar | status pill, name, progress, elapsed, parallel/awaiting badges, Pause / Resume / Cancel / Retry, Pipeline / Graph / Files toggles | `POST /api/workflow-runs/:id/{pause,resume,cancel,retry}` |
| Runtime DAG (collapsible) | live status colours | `RuntimeDAGCanvas.tsx` |
| Pipeline flow | horizontal stage pills; click focuses | |
| Stage timeline items | status dot, expand, prompt bubble, sleeping countdown + Wake now, `StreamPanel` steps/answer/error, file/output chips, context gauge, retry icon, inline HITL controls | `POST …/:run/stages/:s/{wake,retry,cancel,pause,resume}` |
| Inline HITL | Approve & continue / Request changes (feedback) / two-step Reject | `POST …/:run/stages/:s/approve`, `GET …/:id/pending-interrupts` |
| Permission mode (HITL panel) | bypassPermissions / default / acceptEdits / plan | `GET/PATCH /api/workflow-runs/:id/permission-mode` |
| Event timeline modal | `RunTimeline.tsx` | |
| Right pane | Changes (review-enabled, `stage_followup`), Files, Inspector (Files/Output/Hooks/Tools per stage), Browser (≤5), Terminal (≤4 with worktree cd), Widget | `GET /api/orchestrator/runs/:id/workspace[/download|/content|/diff]`, `GET /api/workflow-runs/:id/scratchpad` |
| Run statuses | created, starting, running, paused, completed, failed, cancelled; stage: pending, queued, running, paused, completed, failed, cancelled, skipped, sleeping, awaiting_input | |
| Session modes | single / per-stage / auto | |
| Delete run | | `DELETE /api/workflow-runs/:id` |

### 2.14 Automations (`pages/AutomationsPage.tsx`, `CreateAutomationPage.tsx`, `AutomationDetailPage.tsx`, `components/automation/*`)

| Control | Details | Route |
|---|---|---|
| List rows | enabled dot, trigger badge (Manual/Schedule/Webhook), input-mode badge (Loop/Batch/Script), workflow count, last/next run, cron; actions Run now, Enable/Disable, Delete (+confirm) | `GET /api/automations`, `POST …/:id/{enable,disable,trigger}`, `DELETE …/:id` |
| Create: Basic (Name, Description) | | `POST /api/automations` |
| Create: Trigger | Manual / Schedule (cron, default `0 9 * * *`) / Webhook (token+secret shown once in `WebhookCredentialsDialog`) | |
| Create: Project scope | Global / project | |
| Create: Workflows | ordered multi-select, sequential | |
| Create: Input mode | Single; Loop (variable, JSON items, concurrency, on-error continue/stop); Batch (CSV / JSON array / JSONL, live parse preview, column→variable mapping); Script (command, output format, timeout, env JSON, **Test Data Source**) | `POST /api/automations/test-data-source`, `POST …/preview-iterations` |
| Create: Base variables JSON | | |
| Create: Schema-driven data (advanced) | data-schema JSON, iteration mode each_row / group_by / single, default dataset | |
| Create: Retry policy (advanced) | max attempts, backoff ms/multiplier/max, retry-on workflow_failed / timeout / network | |
| Detail | Run Now (`TriggerAutomationModal` for schema-driven), Enable/Disable, Delete, config cards, Rotate token & secret, read-only variables/batch/schema/retry panels | `POST …/:id/rotate-webhook-token`, `PATCH …/:id` |
| Execution history | expandable executions (Cancel running), per-iteration rows with embedded `ChangesSurface` + link to run | `GET …/:id/executions[/:e]`, `POST …/:id/executions/:e/cancel`, `useAutomationExecutionStream` (scope `automation`) |
| Inbound webhook | | `POST /api/automations/webhooks/:token` (public, HMAC) |

### 2.15 Projects / Codebases (`pages/Projects*`, `CodebaseDetailPage.tsx`, `components/codebase/*`, `components/common/*`)

| Control | Details | Route |
|---|---|---|
| Projects list | search, Card/List toggle (persisted), active/inactive Switch, Delete (+confirm) | `GET /api/projects`, `PUT /api/projects/:id`, `DELETE /api/projects/:id` |
| Create project | Name, Description, Worktree Retention (immediate / hours-24 / hours-72 / manual), Max Codebases; repository rows (Alias, Type git-remote / git-local / local-dir, URL or path, default branch) add/remove | `POST /api/projects`, `POST /api/projects/:id/codebases` |
| Project detail — Codebases tab | Add Repository form; rows with type/status badges (pending, cloning, ready, error, stale), sync spinner, View Logs, Fetch Latest, Delete | `GET/POST …/codebases`, `POST …/codebases/:cid/fetch`, `DELETE …/codebases/:cid`, `GET …/codebases/:cid/status` |
| Project detail — Customization tab | categories Skills / Prompts / Custom Agents / MCP Servers; enable Switch, Preview (view/edit/save), Delete, upload (folder upload for skills); MCP: List/JSON toggle, All/System/Project filter, Add server modal (Name, Description, Type http/stdio, URL or Command+Args) | `GET/POST/PUT/DELETE …/configs[/:cid]`, `GET/POST/PUT/DELETE …/mcp-servers[/:mid]`, `GET …/available-artifacts` |
| Project detail — Settings tab | Worktree Retention, Max Codebases, read-only root path/created, Save; Delete project | `PUT /api/projects/:id` |
| Codebase detail | View Logs, Fetch Latest, active-worktree count, Default branch popover picker, last fetched; Worktrees tab (Cleanup Orphans, Remove); Files tab (`FileExplorer` + tree filter + preview Markdown/Code) | `GET …/codebases/:cid/branches`, `PUT …/codebases/:cid`, `GET …/codebases/:cid/worktrees`, `DELETE …/worktrees/:wid`, `POST …/worktrees/cleanup`, `GET …/codebases/:cid/files[/content]` |
| Doc-only tabs **[doc-stale]** | `usage-web.md` lists Worktrees / Artifacts tabs on project page; code has Codebases / Project Customization / Settings | |

### 2.16 Agents (`pages/AgentsListPage.tsx`, `AgentEditorPage.tsx`, `components/agents/*`)

| Control | Details | Route |
|---|---|---|
| List | Import `.agent.md` (256 KB cap), New agent, search, Scope filter (system/global/project), Role filter (agent/orchestrator); cards with view/edit, Export, Delete (+confirm), badges | `GET /api/agents`, `POST …/import`, `POST …/:id/export`, `DELETE …/:id[?force=1]` |
| Editor — Identity | Name, Slug (auto, locked after save), Description (≥10), Scope + Project, Tags, Enabled | `POST/PUT /api/agents[/:id]` |
| Editor — Instructions | textarea w/ byte counter (32 KB hard cap, 8 KB warn), Projection append / replace | |
| Editor — Role | Agent / Orchestrator | |
| Editor — Skills / MCP | `CapabilityToggleList` (inherited locked, search, all on/off) | |
| Editor — Capabilities | `ToolPolicyEditor` tri-state per `AGENT_TOOL_GROUPS`, reset | |
| Editor — Team (orchestrator) | per-agent Switch, max workers, default worker model | |
| Editor — Runtime | Provider, Model, Reasoning effort, Context tier, Max turns | |
| Effective capabilities popover | live debounced preview | `POST /api/agents/resolve-preview` |
| Usage | where bound | `GET /api/agents/:id/usage` |
| Bundled | code-reviewer, implementation-planner, test-author, docs-writer, security-auditor, bug-fixer, delivery-lead | `templates/system/artifacts/agents/` |

### 2.17 Skills / Prompts / MCP (`feature-skills-agents-mcp.md`, Settings → Skills / MCP Servers)

| Control | Details | Route |
|---|---|---|
| Skills catalog | search, enable/disable (client pref `catalogPrefsStore`), expand, Preview full content | `GET /api/system/artifacts?type=skill`, `GET /api/system/artifacts/:id` |
| Bundled MCP servers (8) | GitHub, Filesystem, PostgreSQL, SQLite, Slack, Brave Search, Puppeteer, AWS Knowledge Base; enable toggle; inline Setup form for inputs/credentials | `GET /api/system/mcp-servers`, `PUT …/system/:id` |
| Custom MCP servers | Add (name, transport stdio/http/sse, command/args or URL, env/headers key-value, timeout default 180 s), enable toggle, Remove; legacy localStorage migration | `POST/PUT/DELETE /api/system/mcp-servers/custom[/:id]` |
| Project-scope configs | see 2.15 | |
| Credential vault | `secretref:` pointers, masked | `packages/secrets` |
| Prompts | system + project prompt artifacts as slash commands | |

### 2.18 Extensions / Widgets (`components/widgets/*`, Settings → Extensions)

| Control | Details | Route |
|---|---|---|
| Install (path + scope user/workspace), Reload all, per-extension enable/disable (system locked), Uninstall (+confirm), list with contribution chips + errors | | `GET/POST /api/extensions`, `POST …/reload`, `POST …/:id/reload`, `PATCH …/:id`, `DELETE …/:id` |
| WidgetFrame | sandboxed iframe from isolated origin (`WIDGET_PORT` 3101), retry ×3, refuses unsafe origin | `GET /api/widget-assets/:ext/*` (separate origin) |
| WidgetHost | RightPane tab: bound instance fullscreen / launcher list / stacked | |
| Widget instances | list, read, state, actions, invoke-result, context, teardown-ack, close | `/api/widgets/*` |
| Agent tools | `search_widget, render_widget, update_widget, read_widget, describe_widget, list_widgets, close_widget, widget_action, widget_exec, write_extension, reload_extension` | |
| Events | `harness.widget.render/state/action/invoke/teardown/closed/error`, `extension.installed/reloaded/uninstalled/error` | |

### 2.19 Templates / Scripts (`pages/Scripts*`, Settings → Templates)

| Control | Details | Route |
|---|---|---|
| Scripts list | Reload (rescan `.workflow.mjs`), search, cards with Run-with-defaults | `GET /api/workflow-scripts`, `POST …/reload`, `POST …/:id/run` |
| Script detail | Run Script (profile picker), Materialize, tags, Run Profiles (variables, sessionMode, permissionMode, stageOverrides), Stages, Edges | `GET …/:id`, `GET …/:id/profiles`, `POST …/:id/materialize` |
| Upload script | server route, opt-in `GENERATORAI_ALLOW_SCRIPT_UPLOAD`; UI — verify | `POST …/upload`, `POST …/validate` |
| Templates | 5 system JSON templates; search; Use | `GET /api/templates[/:id]` |

### 2.20 Hooks (`feature-hooks.md`, workflow Settings → Hooks, stage Execution → Hooks)

| Control | Details | Route |
|---|---|---|
| Hook definition | name, phase (22 phases; 15 workflow-scope in UI), type script / http / function, priority, enabled, failure policy abort / skip / continue, timeout (30 s), retries, config | `GET /api/hooks/phases` |
| Script allowlist | node, python, bash, git, echo, pwsh, pip, pnpm, npm | |
| Built-in function hooks | enrichContext, injectRequirements, addAttachment, logCompletion, browser.beforeAction/afterAction | |
| Session hooks / test | | `GET /api/hooks/sessions/:id/hooks`, `POST …/test` |
| Run inspector Hooks tab | shows `hook.started/completed/failed/skipped` | `RightInspector.tsx` |

### 2.21 Settings modal (`components/settings/SettingsModal.tsx`, `sections/*`)

Nav groups: **App** (General, Appearance) · **Agents** (Model Providers, Agents, Skills, MCP Servers, Templates) · **Integrations** (Source Control, Browser & Terminal, Computer Use, Audio, Extensions) · **System** (Security & Devices, Storage, Diagnostics).

| Section | Controls | Route |
|---|---|---|
| General | Default model for new chats (`ModelPicker`, localStorage `appPreferences`); About (version) | `GET /api/harness/providers` |
| Appearance | Mode system/light/dark; Theme 16 palettes (Product: GitHub, Graphite, Carbon, Clay · Editor: One, Dracula, Tokyo Night, Catppuccin, Ayu, Night Owl, Rosé Pine · Low glare: Nord, Everforest, Gruvbox, Solarized, Flexoki, High Contrast); Accent blue/violet/green/orange/rose/teal; live preview. Theme bundles fonts + radii; no separate font/density control | client (`ThemeProvider`, `packages/design-tokens`) |
| Model Providers | Test all connections; per-provider row (status Connected / Not signed in / Not installed), Test connection, Make default, detail rows (SDK installed, client running, authenticated, error), model list. No API-key / CLI-path / OAuth fields in UI | `GET /api/harness/providers[?refresh=1]`, `POST /api/harness/switch` |
| Agents | search, New, list → `/agents/:id`, Manage agents | `GET /api/agents` |
| Skills | see 2.17 | |
| MCP Servers | see 2.17 | |
| Templates | search, Retry, Use | `GET /api/templates` |
| Source Control | status pill, Provider github/none, GitHub token (masked, blank = keep / `gh` fallback), Enterprise host, Save | `GET/PUT /api/source-control/config`, `GET …/status` |
| Browser & Terminal | web browser interactivity toggle (forced on desktop); default shell; load PowerShell profile; allow SSH/AWS secrets | localStorage |
| Computer Use | Enable; Allow screen-takeover (`allowSynthetic`); driver status card; info lists | `GET/PUT /api/system/computer-use` |
| Audio | Download / Remove Nemotron model (+progress); STT engine auto/nemotron/moonshine/parakeet/whisper (pinned by env); spoken punctuation rule-based/none; pause before commit (ms); TTS enable; TTS voice (Kokoro, default `af_heart`); TTS speed 0.5–2.0 | `GET/PUT /api/system/audio`, `GET/POST/DELETE /api/system/audio/model` |
| Extensions | see 2.18 | |
| Security & Devices | Servers list (Switch / Forget, local); Refresh; posture (auth required, legacy key, secret storage strength, host fingerprint, relay state, warnings); Network access local-only/network-accessible (+blockers, restart notice, addresses; desktop restarts server); Pair device (name, platform mobile/web/desktop/cli, preset default/readonly/companion/workstation, include relay) → code + address copy + QR, Cancel; pending grants; devices (last seen, transport, version, relay), scopes detail, capability toggles `exec:terminal`, `exec:browser`, `write:files`, `write:workflows`, `write:projects`, `admin:devices` (confirm on high-risk), Revoke; revoked list | `GET /api/security/posture`, `GET/POST /api/security/network-access`, `POST /api/auth/pair`, `GET …/pair/pending`, `DELETE …/pair/:g`, `GET /api/auth/devices?includeRevoked`, `PUT …/devices/:d/scopes`, `DELETE …/devices/:d` |
| Storage | nightly cleanup toggle, keep-days, Clean up now | `GET/PUT /api/system/workspace-retention`, `POST …/run` |
| Diagnostics | Refresh, `SystemHealthCard`, OTel status, Sandbox status (env-only), Runtime labels, snapshot | `GET /api/health`, `GET /api/health/config` |

Not present as settings: keyboard shortcuts, notifications, font/density, desktop auto-update toggle, telemetry opt-out, default reasoning effort.

### 2.22 Auth / Devices / Pairing (`components/AuthGate.tsx`, `platform/authRuntime.ts`, `packages/auth`)

| Capability | Details | Route |
|---|---|---|
| AuthGate | blocks rendering until paired / legacy key / dev loopback; PairingScreen: code input (`?pair=` deep link, paste, blob), consent preview (server, endpoint, host identity, scopes), device name, Connect | `GET /api/auth/server-info`, `POST /api/auth/nonce`, `POST …/pair/preview`, `POST …/pair/complete`, `POST …/token/refresh` |
| DPoP-bound tokens | RFC 9449 (`packages/auth/src/dpop.ts`) | |
| Desktop auto-pair | silent grant via `/internal/desktop/pairing` (rate-limited, native confirm after first) | |
| Multi-server | remembered connections, switch/forget (web local; desktop native Server menu) | |
| Scopes | 23 scopes (`packages/auth/src/scopes.ts`); presets DEFAULT_DEVICE / MOBILE / CLI; HIGH_RISK set | |
| Device admin | rename, rotate, scopes, revoke, audit | `PATCH/POST /api/auth/devices/:d[/rotate|/revoke]`, `GET /api/auth/audit` |
| Relay | `apps/relay` (`/relay/host`, `/relay/client`, `/relay/data`, `/relay/assignment`, `/healthz`); "include relay" on pairing | |

### 2.23 Theme system

Three axes on `<html>` — `mode` (class + `data-mode`), `data-theme` (16 palettes), `data-accent` (6) — persisted in localStorage, pre-paint inline script, WCAG AA asserted in `packages/design-tokens`; drives terminal, code blocks, DAG, charts. Header button cycles mode only. (`providers/ThemeProvider.tsx`, `styles/globals.css`.)

### 2.24 Desktop app (`apps/desktop/src/**`)

| Feature | Details | File |
|---|---|---|
| Embedded server | spawns real server on loopback port, health-gate, crash restart (5× backoff), graceful IPC shutdown, isolated widget origin, per-launch admin/IPC tokens, vault KEK env | `main/server-manager.ts` |
| Windows | splash, persisted bounds, min 860×560, custom title bar (hiddenInset / WCO), minimize-to-tray, external links → OS browser, error page | `main/window-manager.ts` |
| Native menu | File (New Chat/Workflow/Project/Automation, Open Recent 10, Reload Scripts, Settings), Edit, View (palette, sections, back/forward, sidebar, right panel, Appearance radio, zoom, devtools), Server (This Computer, remote list, Add/Forget), Window, Help (Docs, Shortcuts, Troubleshooting: Restart Server / Health / Data folder / Logs, Check for Updates, About) | `main/menu.ts` |
| Tray | server state, Open, quick-nav, Restart Server, Quit | `main/tray.ts` |
| Auto-update | electron-updater; Restart Now / Later dialog; interactive check | `main/updater.ts` |
| Deep links | `generatorai://` protocol, single-instance, second-instance argv | `main/deep-link.ts`, `main/index.ts` |
| Native dialogs | Save-As downloads (+show in folder), select dir/file, save file; `showDirectoryPicker` shim | `main/downloads.ts`, `main/ipc.ts`, `preload/index.ts` |
| Secret storage | `safeStorage`-wrapped KEK (Keychain / DPAPI / libsecret), quarantine on corruption | `main/secret-protection.ts` |
| Backend switching | embedded ↔ remote servers (loadURL) | `main/backend-switcher.ts` |
| Settings file | theme, bounds, port, harnessType, minimizeToTray, lastRoute, connections (Zod-validated) | `main/config.ts` |
| Native browser bridge | `WebContentsView` per workspace, annotate/pick/capture, scoped CDP | `main/browser-host.ts`, `shared/browser-ipc.ts` |
| Computer-use host | `cua-driver` from signed bundle | `main/computer-host.ts` |
| Hardening | CSP floor, mic-only permission, origin guard, pairing gate (5 / 10 min), IPC sender guard | `main/session-hardening.ts` etc. |
| OS integration | macOS dock menu, Windows JumpList, localhost TLS trust | `main/index.ts` |
| No native notifications | dialogs only | |

### 2.25 Mobile baseline (`apps/mobile`)

Expo/RN: tabs Home / Chats / Projects / Runs; `pair`, `revoked`; details for chats, projects, automations, workflows, runs; `changes/[workspaceId]` (+per-file); `terminal/[workspaceId]`; Settings: about, appearance, capabilities, diagnostics, notifications, providers, security, source-control, tools; push notifications; voice. Uses per-scope `GET /api/stream?scope=chat` (no multiplexing, chat scope only). No dashboard, agents editor, workflow builder, scripts, create-automation / create-project forms.

---

## 3. Server route inventory (`apps/server/src/routes/index.ts`, `app.ts`)

Middleware: requestId → OTel → CORS → CSP → security headers → body limits (2 MB JSON) → `/api` auth (`packages/auth/src/routePolicy.ts`) → rate limit → internal routers → `/api` router → static SPA → error handler.

| Prefix | Summary | Endpoints |
|---|---|---|
| `/api/chats` | chat CRUD, prompt, cancel, sources, prepare, messages, attachments, background tasks, plans, interactions, permission-mode | 27 |
| `/api/agents` | list/CRUD, usage, export/import, resolve-preview | 9 |
| `/api/workflow-definitions` | CRUD, stages, edges, validate, import/import-json/export | 14 |
| `/api/workflow-runs` | CRUD, start/pause/resume/retry/cancel, stages (pause/resume/wake/retry/cancel/interrupt/approve), permission-mode, pending-interrupts, scratchpad | 22 |
| `/api/orchestrator` | system workflows, from-template, runs (start/context/cancel), workflow + run uploads, run workspace (list/download/content/diff) | 15 |
| `/api/projects` | CRUD, codebases (link/update/unlink/fetch/branches/status/files/worktrees), configs, mcp-servers, available-artifacts, legacy worktrees | 31 |
| `/api/system` | artifacts, mcp-servers (custom + system prefs), audio (+model), workspace-retention (+run), computer-use | 17 |
| `/api/automations` | CRUD, enable/disable/trigger, rotate token, test-data-source, preview-iterations, executions (+cancel), public webhook | 14 |
| `/api/workspaces` | list/get/archive/commit/delete, changes (+file/content), checkpoints (+create/restore), tree (+file), pull-request(s), cleanup, worktrees, files (+content get/put) | 20 |
| `/api/workspaces/:id/review` | threads CRUD, comments, submit | 7 |
| `/api/workspaces/:id/browser` | start/stop, cookies/import, actions, selection, attach/detach, capture, read-page, descriptor, snapshots, files/*, screencast.jpg, input, resize, scroll | 16 |
| `/api/workspaces/:id/computer` | consent, grants, runtime, recording (+video/turns), activity, frames, preview/stream (SSE) | 14 |
| `/api/workspaces/:id/terminals` | spawn/list/describe/scrollback/resize/signal/kill | 7 |
| `/api/fs` | dirs, git-info, scrub-legacy-refs (loopback/admin) | 3 |
| `/api/source-control` | config get/put, status | 3 |
| `/api/sessions` | `/:sessionId/chat` history | 1 |
| `/api/templates` | list/get | 2 |
| `/api/webhooks` | github, custom/:trigger, registrations (deprecated) | 5 |
| `/api/health` | `/`, `/loop-turn`, `/config` | 3 |
| `/api/auth` | server-info, nonce, pair (mint/preview/complete/pending/revoke), token/refresh, devices (list/get/rename/scopes/rotate/revoke), push-token (put/delete/mute), audit | 19 |
| `/api/security` | posture, network-access get/post | 3 |
| `/api/copilot` | models (deprecated), state, conversations, messages, ping | 5 |
| `/api/hooks` | phases, session hooks, test | 3 |
| `/api/harness` | `/`, providers, models, switch | 4 |
| `/api/workflow-scripts` | list/get/profiles/materialize/run/reload(+one)/upload/validate | 9 |
| `/api/extensions` | list, widgets, reload(+one), get, install, uninstall, patch | 8 |
| `/api/widgets` | list/get/create/state/actions/invoke-result/context/teardown-ack/delete | 9 |
| `/api/widget-assets/:ext/*` | served from **separate loopback origin** (`WIDGET_PORT` 3101) | 1 |
| `/api` root | `openapi.json`, `docs` (public) | 2 |
| `/api/stream` | tickets, connections (+subs), SSE, replay | 5 |
| `/internal/browser`, `/internal/computer`, `/internal/desktop` | Electron-only loopback token routes (cdp-endpoint; endpoint, consent; pairing) | 4 |

### 3.1 Streaming endpoints

| Kind | Endpoint | File |
|---|---|---|
| SSE (unified, multiplexed) | `GET /api/stream?scope=session\|run\|chat\|global\|automation\|workspace&id=&afterSeq=&filter=` or `?c=<connId>`; ephemeral scopes `computer/terminal/browser` | `routes/stream.ts` |
| SSE replay | `GET /api/stream/replay` | |
| SSE (legacy) | `GET /api/workspaces/:id/computer/preview/stream` | `routes/computer.ts` |
| WS | `/api/workspaces/:id/browser/stream` (`exec:browser`) | `browser-ws.ts` |
| WS | `/api/workspaces/:id/terminals/:sid/stream` (`exec:terminal`) | `terminal-ws.ts` |
| WS | `/api/stt/stream` (`write:chats`) | `stt-ws.ts` |
| WS | `/api/tts/stream` (`read:chats`) | `tts-ws.ts` |
| stdio | ACP (Agent Client Protocol) entry | `acp-entry.ts` |
| Relay WS | `/relay/host`, `/relay/client`, `/relay/data` | `apps/relay/src/cell.ts` |

Host processes: `apps/pty-host` (opt-in `GENERATORAI_PTY_HOST=true`), `apps/agent-host` (opt-in `GENERATORAI_AGENT_HOST=true`), `apps/browser-host` and `apps/cua-host` (standalone, not wired).

---

## 4. Cross-cutting catalogues

### 4.1 Harness providers (`packages/agent-harness-providers/src/types.ts`, `HarnessRegistry.ts`)

| Type | Default probe | Notes |
|---|---|---|
| `copilot` | yes | GitHub Copilot SDK; persistent CLI process |
| `claude-agent` | yes | Claude Agent SDK; per-query subprocess; plan mode, `[1m]` long context |
| `codex` | config-only | breadth adapter, no hooks |
| `opencode` | config-only | breadth adapter, no hooks |
| `acp` | config-only | generic Agent Client Protocol bridge — how Gemini CLI / Goose are reached; **no first-class `gemini` type** |
| `faux` | test-only | |

`ProviderCapabilities`: vision, reasoning, reasoningEfforts (`low|medium|high|xhigh|max`), maxParallelTools, planMode, mcpServers, skillDirectories, fullToolGating, sessionPersistence, budgetTracking, computerUse, maxContextTokens, prewarm (`packages/core/src/domain/ports/IProviderInstance.ts`).

Model catalogue: **dynamic only** (`GET /api/harness/models`); `HarnessModel` fields id, name, provider, description, category (`powerful|lightweight|versatile`), promptTokenLimit, totalContextWindow, longContext, maxOutputTokens, supportsVision, supportsReasoning, reasoningEfforts.

### 4.2 Permission modes

| Type | Values | File |
|---|---|---|
| `AgentPermissionMode` | default, acceptEdits, bypassPermissions, plan, dontAsk | `packages/shared/src/types/AgentMode.ts` |
| `ChatPermissionMode` / `WorkflowRunPermissionMode` | bypassPermissions (default), default, acceptEdits, plan | `Chat.ts`, `WorkflowRun.ts` |
| Script profile aliases | askOnEachTool → default, askOnce → acceptEdits, bypassPermissions | `routes/workflowScripts.ts` |

Rule: raising to `bypassPermissions` requires `admin:settings`.

### 4.3 Chat / agent modes

| Concept | Values |
|---|---|
| `AgentMode` | `auto` (interactive; bypassPermissions, non-blocking plan gate) / `plan` (plan permission, blocking plan gate, question gate); legacy alias `interactive` |
| Orchestrator | boolean `orchestratorMode` on chat |
| Background task status | running, needs_review, completed, failed, cancelled |
| Workflow session mode | single, per-stage, auto |
| Chat status | active, archived |

### 4.4 Streaming event kinds (grouped; `packages/core/src/services/*`)

- `harness.*`: token, message_complete, reasoning_delta, reasoning_complete, tool_start, tool_complete, idle, cancelled, error, warning, session_start, session_info, turn_start, turn_end, user_message, usage, context_usage, mode_changed, plan_changed, client_error/restarting/started/stopped, unknown, widget.render/state/action/invoke/teardown/closed/error
- `chat.*`: created, updated, archived, deleted, agent_changed, mode_changed, prompt_sent, prompt_failed, plan.created/updated/drafting/review_requested/decided/expired/extraction_failed, question.asked/answered/expired, permission.requested/resolved/expired, background_task.spawned/status/completed/failed
- `session.*`: created, active, closing, closed, paused, error
- `workflow_run.*`: created, starting, running, paused, resumed, cancelling, cancelled, completed, failed, retried, orchestration_started/completed/failed, permission_mode_changed, preprocessing_*, postprocessing_*, sandbox_created/destroyed, stage_validation, worktree_creating/created
- `stage_run.*`: pending, queued, running, paused, resumed, completed, failed, cancelled, skipped, retrying, awaiting_input, input_received, sleeping, woken, step_started, step_completed
- `automation_execution.*`: started, progress, completed, failed, cancelled, partial, recovered, iteration_started/completed/failed/retried; `automation.schedule_deferred/skipped`
- `browser.*`: session_created/stopped/updated, action_started/completed, snapshot, selection, error
- `computer.*`: session_started/stopped, action, consent_required/resolved, refusal, snapshot, error, preview.open/frame/cursor/window/run
- `terminal.*`: session_created/closed/resized
- `voice.*`: stt_session_started/ended/paused/resumed, tts_session_started/ended
- misc: `agent.created/updated/deleted`, `artifact.created/available`, `checkpoint.created/restored`, `workspace.changed`, `workspace.prep`, `git.clone_start/progress/complete/commit/push/pr_created`, `hook.started/completed/failed/skipped`, `script.stdout/stderr/exit`, `extension.installed/reloaded/uninstalled/error`, `permission.requested/granted/denied/timeout`

Client reducer actions: `packages/client-core/src/stream/applyEffects.ts` (appendToken, appendThinking, addToolCall, completeToolCall, upsertPlan, upsertQuestion, upsertPermission, addWidget, setUsage, setContextUsage, runStatus, stageStatus, … 40+).

### 4.5 Feature flags / env toggles (subset of ~170 `GENERATORAI_*`)

| Var | Effect |
|---|---|
| `GENERATORAI_TERMINAL=0` | disable terminal (501) |
| `GENERATORAI_STT=0`, `GENERATORAI_TTS=0`, `GENERATORAI_STT_ENGINE`, `_STT_PREFERRED`, `_STT_VAD`, `_NEMOTRON_*` | voice |
| `GENERATORAI_COMPUTER_USE`, `_COMPUTER_USE_AUTO_APPROVE`, `_COMPUTER_USE_SYNTHETIC` | computer use |
| `GENERATORAI_ALLOW_SCRIPT_UPLOAD` | script upload route |
| `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK`, `GENERATORAI_API_KEY`, `GENERATORAI_BIND_HOST`, `_ADVERTISED_URL(S)` | auth / network |
| `GENERATORAI_RELAY_ENABLED`, `_RELAY_DIRECTOR_URL`, `_RELAY_TOKEN` | relay |
| `GENERATORAI_DESKTOP_NATIVE_BROWSER`, `_ELECTRON_IPC_TOKEN`, `_DESKTOP_ADMIN_TOKEN` | desktop |
| `GENERATORAI_PRIMARY_HARNESS`, `_DEFAULT_MODEL`, `_DEFAULT_PERMISSION_MODE` | defaults |
| `GENERATORAI_ORCH_*` | orchestrator |
| `GENERATORAI_PTY_HOST`, `GENERATORAI_AGENT_HOST` | host process split |
| `GENERATORAI_SECRET_KEY`, `_REQUIRE_SECURE_SECRETS` | secrets |
| `GENERATORAI_BROWSER_MAX_CONCURRENT`, `_TERMINAL_ALLOW_SECRETS`, `_TERMINAL_*_WATERMARK_BYTES`, `_TERMINAL_PERSIST` | browser/terminal limits |
| `SANDBOX_ENABLED`, `WIDGET_PORT`, `WIDGET_ORIGIN`, `WIDGET_CONNECT_SRC` | sandbox / widgets |
| Client: `READ_ALOUD_ENABLED` (`apps/web/src/components/chat/featureFlags.ts`) | TTS buttons hidden |
| `AppConfig` sections: streaming.enabled, security.*, sandbox.*, scripts.workflowScriptsEnabled, retention.*, computerUse.*, otel.* | `packages/shared/src/config/AppConfig.ts` |

### 4.6 Auth scopes (`packages/auth/src/scopes.ts`)

read:status, read:projects, read:workspaces, read:chats, read:workflows, read:files, read:reviews, write:projects, write:workspaces, write:chats, write:workflows, write:files, write:reviews, stream:events, exec:agent, exec:terminal, exec:browser, exec:computer, admin:harnesses, admin:credentials, admin:devices, admin:settings, admin:relay. Presets: DEFAULT_DEVICE, DEFAULT_MOBILE (no write:workflows), DEFAULT_CLI (+write:projects/workspaces/files, exec:terminal). Platforms: web, desktop, cli, mobile, other. Principals: local-desktop, paired-device, user-session, service-account, signed-link, internal-service.

### 4.7 Agent tool name sets

- Browser (10): see 2.10 · Computer (16): `computer_capabilities … computer_click_point` · Widgets (9) + extension author (2): see 2.18 · Orchestrator (5): see 2.8 · MCP naming: Copilot `mcp_<server>_<tool>`, Claude `mcp__<server>__<tool>` · Claude plan-gate recognised: `ExitPlanMode`, `AskUserQuestion`, write set (`Write, Edit, MultiEdit, NotebookEdit, …`), read set (`Read, Glob, Grep, NotebookRead, …`).

---

## 5. Feature count summary

| Area | Concrete controls / capabilities |
|---|---|
| Navigation, shell, shortcuts | 32 |
| Dashboard | 8 |
| Chat list + create dialog | 18 |
| Chat page + panels | 26 |
| Composer | 24 |
| Streaming timeline | 26 |
| Changes / Files / Review | 30 |
| Plan / Orchestrator | 12 |
| Terminal | 12 |
| Browser | 14 |
| Computer use | 10 |
| Workflow builder + list | 32 |
| Workflow runs | 14 |
| Automations | 18 |
| Projects / Codebases | 20 |
| Agents | 14 |
| Skills / MCP | 8 |
| Extensions / Widgets | 8 |
| Templates / Scripts | 8 |
| Hooks | 5 |
| Settings (14 sections) | ~100 |
| Auth / devices / pairing | 12 |
| Desktop-only | 18 |
| **Total (approx.)** | **≈ 470 user-facing controls / capabilities**, backed by **≈ 300 server endpoints** across 30 route families, 4 WebSocket + 2 SSE endpoints |
