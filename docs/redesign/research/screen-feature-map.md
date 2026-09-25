# GeneratorAI redesign: screen and feature map

Sources: 49 `.dc.html` boards (Theme*, Foundations, Components and Audit excluded), compared with `apps/web/src` (router.tsx, pages/*, components/*). Paths below are relative to `apps/web/src`.

---

## 1. App shell

### 1.1 Global frame (web, 1440×900)
- **Ground and card.** The window background uses the `--ground` token. The sidebar sits directly on it with no border. The `<main>` element is an inset card: `margin: 8px 8px 8px 0`, `--surface` background, 1px `--line-soft` border, 10px radius. Every page renders inside this card.
- **Left sidebar, 232px wide.** Padding is 10/8/8. From top to bottom:
  1. **Server switcher row** (40px): logo, "GeneratorAI", "This computer", and a chevron. Clicking it opens the Servers popover (280px): the server list with status, "Add server…", "Manage servers" and a link to Security & devices. A "Collapse sidebar" icon button sits on the right.
  2. **Search button** (30px) labelled "Search Ctrl K" (⌘K on macOS), which opens the command palette. Next to it is a 30×30 **New chat** icon button.
  3. **Primary nav** (30px rows, 16px icons), in this order: **Home, Chats, Projects, Agents, Workflows, Automations, Scripts**.
  4. **"Needs you" section**, with a count. Rows are 44px and two lines tall: a status dot, the title, and the pending ask (for example "Approve 'Apply upgrades'" or "Allow git push?"). These rows mix chats and workflow runs.
  5. **"Running" section**, with a count. Rows are one line: the title plus an elapsed timer (for example "4:12").
  6. **Footer** (44px, pinned to the bottom): a connection dot, "Connected", `local:3100` in mono, and a **Settings** gear.
- **Page header, 44px, at the top of the main card.** It holds a breadcrumb (for example "payments-service / Fix flaky checkout test"), a status badge, a spacer, contextual chips and buttons (branch chip, More, dock toggle) and page actions (for example "Run workflow" and "New workflow" on Home). There is no global app header: each page owns its header row.
- **Right dock** (chat and run pages only). It sits inside the main card, 480px wide (440px on workflow runs), with a `border-left` and the `--surface` background. From top to bottom:
  - **Tab strip** (44px): tabs are text buttons 28px tall with counts or dots. The chat set is **Changes · Files · Terminal · Browser · Tasks**, with **Computer** and **Plan** appearing when they are relevant. After the tabs come a "+" button ("Open another panel", which lists Browser, Files, Widget and others that are not pinned), a spacer, and "Maximize dock". In the narrow layout a "Close dock" button is added.
  - **Panel toolbar** (40–44px).
  - **Body.**
  - **Optional sticky footer**, for example commit and PR.
  - The dock is toggled from the page header's "Hide/Show side dock" button.
  - Some dock tabs are multi-instance: browser pages (up to 5), shells (up to 4) and file tabs (up to 8).
- **Narrow window** (ChatNarrow, 1100×760, used when the window is under 1200px):
  - The sidebar collapses to a **48px icon rail**. From top to bottom it holds the server logo, Expand, Search and New chat, then the nav icons (Home carries a "needs you" dot), then a "3 running" counter button, and at the bottom the connection dot and Settings.
  - The dock becomes an **overlay sheet**: `position:absolute; top:44px; right:0; width:380px`, `--overlay` background, shadow, and `role=dialog`. The chat column keeps a 380px gutter.
  - Dock tabs other than the active one collapse to icon-only buttons.
  - The branch chip is dropped from the header.
  - The builder boards also use the rail at full width: WorkflowBuilder auto-collapses the sidebar and the rail shows "Needs you: 2" and "Running: 3" icon badges.
- **Command palette** (640px modal over a scrim):
  - A query line with a result count.
  - Grouped results: **contextual matches**, for example a Workflows group with an inline "Run 'Nightly dependency audit'" action; **Go to**, with shortcuts `Ctrl 1…n` and nested entities such as "Automations › Nightly audit"; **Actions**, including New chat `Ctrl N`, New workflow `Ctrl Shift N`, Toggle theme and Open settings `Ctrl ,`; and **Recent chats**, with a project and a status badge or timer.
  - Footer key hints: ↑↓ Navigate, ↵ Open, **Tab Actions**, Esc Close.
- **Settings** is a **960×640 modal** over the current page, not a page. It has a 220px nav with "Search settings /" and a close button.

### 1.2 Desktop chrome
- **macOS** (DesktopMac, 1280×800): there is no title strip. The **traffic lights sit in a 44px row at the top of the sidebar** (three 12px dots), and the server switcher moves below them. The page header, also 44px, is the drag region. The board also shows the **menu-bar (tray) menu** at 256px: "Server running · 3 agents :3100", Open GeneratorAI, New chat ⌘N, Go to (Home/Chats/Workflows with a badge/Automations/Projects/Agents), Restart server, Quit ⌘Q.
- **Windows** (DesktopWindows): a **36px full-width title strip** above everything. It contains:
  - Left: Back, Forward and Toggle sidebar icon buttons.
  - Centre: a **420px Search (Ctrl K)** button.
  - Right: "Restart to update" (shown when an update is ready), a server chip ("● This computer") and **three 46×36 caption buttons** (138px).

  The sidebar header on Windows shrinks to "GeneratorAI" plus a New chat icon, because search and the server switcher have moved into the strip.
- Current code: `components/layout/TitleBar.tsx` is a centred-name drag strip. `apps/desktop/src/main/platform.ts` sets `TITLE_BAR_HEIGHT = 40`, uses `hiddenInset` with `trafficLightPosition` on macOS, and `titleBarOverlay` (the OS draws the caption buttons) on Windows. `apps/desktop/src/main/tray.ts` already exists. The design requires a 36px Windows strip, where the code uses 40px. It also requires the macOS lights to be centred in a 44px sidebar row (y ≈ 16) and back/forward/search/update/server controls in the Windows strip.

### 1.3 Structural changes compared with the current shell

| Area | Current (`components/layout/*`, App.tsx, router.tsx) | Redesign |
|---|---|---|
| Frame | `AppLayout` stacks TitleBar, then Sidebar/Drawer, `Header`, and `<Outlet/>` | Sidebar on the ground colour; each page renders inside an inset card with its own 44px header. The global `Header.tsx` (actions, connection status, dark toggle) goes away: connection status moves to the sidebar footer and the theme toggle moves to the palette and settings |
| Nav IA | Dashboard, Projects, Chats, Agents, Workflows, Scripts, Automations | **Home**, Chats, Projects, Agents, Workflows, **Automations before Scripts**. "Dashboard" is renamed Home |
| Sidebar content | Static nav; footer has Settings and a ⌘K hint | Adds server switcher, search button, New chat, and **live "Needs you" and "Running" lists** that cover chats and runs. Collapses to a 48px rail (new) |
| Right dock | `RightPane.tsx`, a generic resizable tab pane. ChatPage tabs: Changes, Browser, Terminal, Computer, Widget, Background Tasks, Plan. Files open only as file tabs through `useFileTabs` | Fixed 480px dock with a text tab strip: Changes, **Files (a pinned browse tab, new)**, Terminal, Browser, Tasks, plus contextual Computer and Plan. "+" menu for the rest. Maximize button. Below 1200px it becomes an overlay sheet |
| Settings | Routed page `/settings/:section` (`SettingsPage.tsx`, `settingsUiStore.openSettings` navigates) | Modal overlay with searchable nav. Groups and items are **identical** to `SETTINGS_NAV` |
| Palette | `CommandPalette.tsx`: Navigate and Actions groups only | Adds entity search with inline actions, Recent chats with status, shortcut hints and Tab-for-actions |
| Auth | `AuthGate.tsx` | Pairing board (see §2) |

---

## 2. Screen inventory

Legend: **T#** refers to a template in §3. **NEW** means the design shows something with no current implementation.

### 2.1 Chat page

| Board | Purpose / template | Key composites | Current code |
|---|---|---|---|
| **Home** | Landing page, **T1 Dashboard**. Max-width 1040, two columns: 1fr and a 300px rail. Left column: date line; H1 "2 need you · 3 running"; **quick-start composer** (project chip, "No agent", model, "Worktree", `Ctrl ↵`, "More options"); sections **Needs you** (56px rows with inline Review/Approve/Allow once), **Running** (44px rows: title 184, project 116, live step, timer, stop), **Recently finished** (+/−, PR link, failed with Retry). Rail: **This week** 2×2 stat card, **System** key-value card (Server, Agents, Database, Disk bar, Uptime, Version + Diagnostics), and a shortcut card of counts | ActivityRow, StatGrid, KeyValue card, quick composer | `pages/DashboardPage.tsx` ("Mission Control"), `components/dashboard/{ActivityPanel,SystemHealthCard,HealthStatCard,SystemStatusPill}`, `CreateChatDialog`. **NEW**: the inline quick composer and inline approval from Home |
| **Main** (Chat · Changes dock) | **T5 Chat workspace**: transcript, composer, dock | Transcript parts (§4), PermissionCard, changes tray, Composer, Changes panel with unified diff, Keep/Discard per file, commit bar | `pages/ChatPage.tsx`, `chat/ChatMessageList`, `agent/StreamPanel`, `agent/StepRow`, `chat/PermissionCard`, `chat/ChatInput`, `chat/ChatChangesTray`, `layout/RightPane`, `diff/ChangesSurface`, `diff/DiffCodeView`, `scm/SourceControlPanel` |
| **ChatLight** | Running chat in light theme | Header **Transcript view seg: Normal / Verbose / Summary** (**NEW**); background step with a live output tail; streaming caret; working bar ("Writing · pnpm build running 4:12 · 23 files +146 −92 · Stop Esc"); ↑ History hint | `agent/LiveActivityStrip`, `chat/StreamingMessage`, `composer/promptHistory` |
| **ChatNarrow** | Responsive behaviour at 1100 wide | Icon rail, dock sheet | `AppLayout` (mobile Drawer). **NEW**: the rail and the sheet |
| **ChatFiles** | Files dock | Source switcher ("payments-api · fix/checkout-flake · 1 of 2"), filter `/`, tree with M/A/R badges and dirty dots | `diff/FilesSurface`, `diff/useFileTabs`, `shared/FileExplorer`, `codebase/CodebaseFileBrowser`. **NEW** as a permanent tab |
| **ChatTerminal** | Terminal dock | Terminal seg (Agent console (4) · pwsh 1 · pwsh 2 · +, "3 of 4"), cwd chip, "Attached to agent", Find, Clear, **Kill** with a confirm popover | `terminal/TerminalPanel`, `chat/AgentConsole` |
| **ChatBrowser** | Browser dock | Page sub-tabs, back/forward/reload, URL, **Shared** toggle, device chip "Desktop 1280", Comment/Comments, capture, DevTools, stop | `chat/BrowserPanel`, `chat/NativeBrowserView`, `browser/BrowserVisibilityPicker` |
| **ChatTasks** | Orchestrator chat with Tasks dock | Transcript row "Delegated 4 tasks" with a sub-list of avatars; **relayed question card** ("Code Reviewer asks", with answer buttons); dock task cards with the last 3 steps | `chat/BackgroundTasksPanel`, `chat/QuestionCard` |
| **ChatComputer** | Computer-use dock | **Consent card** listing numbered planned actions and a Scope seg ("Queue Inspector only / Any app"), with Deny / Allow for this chat / Allow once; live frame (Live 12 fps); Pause agent / Take over; **Replay scrubber** with an action list; **Grants** list with Revoke | `chat/ComputerPanel`, `chat/PermissionCard`. **NEW**: replay, scrubber and grants UI |
| **ChatPlan** | Plan review | In-transcript "Plan ready for review" card with "Open in dock"; dock plan document with a **revision seg v1/v2/v3**, numbered steps with file refs, an **inline step comment**, Risks, notes input, Discard / Request changes / Approve plan (`Ctrl ↵`) | `chat/PlanCard`, `chat/PlanDocumentPanel` |
| **ChatsList** | **T2 List page** | H1 with count and "New chat Ctrl N"; search; seg All/Active/Archived; filter chips (Project, Agent, Status, Tags); sort "Last activity"; **table with checkboxes** (Title, Project 140, Agent 150, Status 96, Changes 88, Activity 72, actions 56); "Showing 12 of 48 · scroll to load"; **floating bulk-action bar** (Archive, Delete, Select all 48, Clear Esc) | `pages/ChatsListPage.tsx`, `chat/ChatList.tsx`, `data/FilterTabs` |
| **NewChat** | Quick-create **dialog** (640px) | Task textarea (@ Files, / Skills), Name; **Where** (Project, per codebase Worktree/In place and branch, "Not included", Add local folder); **Who** (Agent, Model + context, Effort seg); Customize capabilities; collapsed "Options" row; footer Cancel / Start chat `Ctrl ↵` | `chat/CreateChatDialog.tsx`, `chat/sources/SourcePicker`, `agents/AgentPicker`, `shared/ModelPicker` |

### 2.2 Compose page

| Board | Purpose / template | Current code |
|---|---|---|
| **ComposerModelPicker** | 620×384 popover. Provider column (150px), with unavailable providers shown as "Not signed in" plus help text; model list (272px) with search, refresh, groups **Fast / Balanced / Powerful**, and context sizes "200K · 1M"; **detail pane** (Provider, Context, Long context, Max output, Reasoning levels, Vision; "applies from the next turn") | `shared/ModelPicker.tsx` |
| **AgentPickerBoard** | 760px popover. Search; scope seg All/Global/Project/Built-in; "No agent — just a model" row; groups **Orchestrators / Workers**; detail pane (team, runtime, skills and MCP badges, Always on); "Manage agents". Also a **Customize capabilities** card: Skills 5/9 and MCP 2/4 toggles with "from agent" badges and scope column, and a capabilities grid with reset-to-inherited | `agents/AgentPicker.tsx`, `agents/AgentOverridesEditor.tsx`, `agents/CapabilityToggleList.tsx` (the board names the first two) |
| **ChatCreate / ChatCreateOrchestrator / ChatCreateModel** | **Full-page create chat, T4 Form + summary**. 720px form, **320px Summary aside** ("What will be created", "Before you can create" checklist), 56px sticky footer. Sections: Task (+ Name, Description); **Who works on this** as 3 choice cards (*Just a model / An agent / An orchestrator*); **Orchestrate mode** switch (forced and badged "Set by Orchestrator"; model-strength warning "Pick a powerful model… Use Claude Opus 5.5"); Model (+ Effort, Context 200K/1M); **Where** (Project, Add codebase, Add local folder, per-source alias rename, reorder, remove, Worktree/In place, branch New/Existing/Stay on, "Make working directory"; empty managed workspace state); **Capabilities** (seg Tool groups / Skills / MCP / Instructions with toggles); More (Tags); invalid state | **NEW page**: no `/chats/new` route exists. Pieces exist in `CreateChatDialog`, `chat/sources/*`, `agents/*` |
| **ComposerStates** | Composer spec sheet (see §4) | `chat/ChatInput.tsx` (named on the board), `composer/*`, `AttachmentChips`, `VoiceRecorder`, `shared/ContextUsageGauge`, `ChatChangesTray`, `sources/WorkspacePrepBar`, `sources/SourcesPanel`, `sources/EditSourcesDialog` |

### 2.3 Dock page (close-ups at 460px, each with three states)

| Board | States and features | Current code |
|---|---|---|
| **DockChanges** | *Review*: toolbar (Comments, Show file tree, Expand all, View settings, Checkpoints, Refresh); **Compare seg This turn / This chat / Branch vs main**; "+2 workspace files" chip; **checkpoint scrubber** ("Turn 3 of 4", Compare, Rewind to here); pending-comments bar (Note, Preview, Send all); per-file collapsible diff with status letter, comment badge, Discard (with "Confirm discard"); inline comment thread (Resolve, Reply, Send to agent `Ctrl ↵`). *Split view*: two-column diff, new file in a single column. *Ship*: commit message, Commit / Commit & open PR, hidden when there are 0 changes | `diff/ChangesSurface`, `ChangesTree`, `CheckpointTimeline`, `DiffCodeView`, `diff/review/{ReviewBatchBar,ReviewThreadCard,ReviewComposerPopover,ReviewCommentsPopover}`, `chat/RewindMenu`, `scm/SourceControlPanel` |
| **DockFiles** | *Tree*: Sources header ("2 mounts", Edit sources…), mount cards (alias, Worktree/In place badge, branch, path, copy); one tree section per mount with file count. *Preview*: file tab (max 8, restored). *Filter & states*: match grouping, empty state | `diff/FilesSurface`, `diff/useFileTabs`, `diff/FileCodeView`, `chat/sources/SourcesPanel` |
| **DockTerminal** | *Agent console*: read-only list of `$ cmd` blocks with a purpose line, duration and output; the command opened from the transcript is ringed. *Interactive shell*: tabs up to 4, Find overlay, "Attach" selection to chat. *States*: exited, cap reached, error | `terminal/TerminalPanel`, `chat/AgentConsole` |
| **DockBrowser** | *Browsing*: page tabs (up to 5) in the dock strip, "Bug Fixer is browsing · click 'Apply' · Your clicks still work" strip, status bar (live view 1280×800), DevTools menu. *Comment & capture*: numbered pins, Send to chat, region capture, device emulation. *States*: pool full, load failure, empty/Start | `chat/BrowserPanel`, `chat/NativeBrowserView` |
| **DockTasks** | *Overview*: "4 tasks · wave 1 · 4 of 4 workers", segmented progress bar, legend, seg All/Active/Done, pinned "asks" card with Answer, task rows (agent, model, live step, status badge, timer, cancel). *Task detail*: Brief, Result, review rounds (cap 3), Accepted. *States*: empty (orchestrate-only), failed, cancelled-by | `chat/BackgroundTasksPanel` |

### 2.4 Workflows page

| Board | Purpose / template | Current code |
|---|---|---|
| **Workflows** | T2 list: H1, Import (menu: Upload JSON…), New workflow; **stat strip** (Needs you, Running, Runs 30d, Succeeded 30d, Median run time); search; seg by last-run status; chips (Project, Tags, Automation, Updated); list/grid toggle; table (Name, Project 132, Last run 136, Success 64, Automation 176, Updated 72, row Run and More); footer link to Scripts | `pages/WorkflowListPage.tsx`, `workflow/WorkflowCard`, `WorkflowDefinitionList` |
| **WorkflowDetail** | **T3 Detail + rail**: header actions Edit / Run / More; read-only mini-DAG with Fit and Open in builder; 2-column key-value config; Variables table; **360px rail** with run stats, recent runs and schedule | `pages/WorkflowDefinitionPage.tsx`, `workflow/RuntimeDAGCanvas`, `workflow/RunTimeline` |
| **WorkflowBuilder** | **T6 Canvas builder**: header with "Unsaved changes", Save `Ctrl S`, Undo, Redo, Validate, Run `Ctrl ↵`, Hide inspector; canvas with stage nodes 232×124 (agent, model·effort, chips such as Approval, Retry 2×, Timeout, JSON, rules), edge labels, Add stage (On success/On completion), Auto-layout, zoom, minimap; **400px Stage inspector** with tabs Prompt / Model / Tools / Policy / Hooks and a "Workflow settings" link | `pages/WorkflowBuilderPage.tsx`, `workflow/{DAGCanvas,StageNode,StageEdge,StagePropertiesPanel}` |
| **WorkflowRun** | **T5 variant (run workspace)**: breadcrumb "Workflows / X / Run #248", badge, elapsed time, Pause, Cancel, More; **HITL banner** with Review / Approve; pipeline overview strip; Graph and Events toggles; **Gantt stage timeline** (Stage 230, time axis 392, Duration 72) with an expandable stage (agent, model, Stage prompt, "Waiting for approval", output chips); **440px dock** with Inspector / Changes / Terminal / Browser (+ Files, Widget) and inspector sub-tabs Output / Files / Tools / Hooks / Variables, output shown as a structured table | `pages/WorkflowRunPageV2.tsx`, `workflow/redesign/{RunHeaderBar,PipelineFlow,StageTimelineItem,InlineHitlControls,RightInspector}` |
| **Automations** | T2 list: seg All/Enabled/Disabled; chips (Trigger, Project, Input mode, Last result, Next run); table with a leading **enable switch**, Trigger 156, Workflows 176, Input 104, Last execution 160, Next run 96, Run now and More | `pages/AutomationsPage.tsx` |
| **AutomationDetail** | T3: header with enable switch, Run now, Edit, More; description; stat row (Executions 30d, Success, Avg duration, Next run); **Execution history** table with expandable executions (per-iteration rows, inline Review, "Changes in #248"); 360px rail cards (Trigger, Workflow, …) | `pages/AutomationDetailPage.tsx`, `automation/TriggerAutomationModal` |
| **AutomationCreate** | **T7 Stepped wizard**: header "Draft saved 14:02"; **220px step nav** (6 steps: name, Trigger, Workflow, Variables & schema, Retry & review, …); step body with radio cards (Manual / Schedule / Webhook), Repeats seg (Every day / Weekdays / Weekly / Cron), time, timezone, missed-run and overlap policies, "Next 3 runs" preview | `pages/CreateAutomationPage.tsx` is a single long form. The **stepper UX is NEW**. `automation/WebhookCredentialsDialog` |
| **Scripts** | **T8 Master-detail**: 320px list pane (filter, Reload, state badges such as Never run / Not loaded / Load error with the error text, a trust note) and a detail pane (title, description, Materialize as workflow, Run script, last run, validated, **Run profile seg**, Stages table with an approval-gate chip) | `pages/ScriptsListPage.tsx` and `pages/ScriptDetailPage.tsx` merge into one master-detail page |

### 2.5 Workflow creation page

| Board | Purpose | Current code |
|---|---|---|
| **WorkflowNew** | Centred 720px form: starting point radio cards (Blank canvas / From a template / Import JSON), searchable **template grid (3 columns)**, Name, Project, Description, Codebases, Session mode seg (Automatic / Single session / Per-stage), footer "Create and open builder" | **NEW**: `/workflows/new` currently opens `WorkflowBuilderPage` directly |
| **WorkflowStagePrompt** | Inspector Prompt tab: Name, description, Instructions, prompt source seg, Prompts list with Insert variable, Output seg, Expected output; variable-search popover | `workflow/StagePropertiesPanel`, `workflow/PromptEditor`, `workflow/PromptFilePicker` |
| **WorkflowStageModel** | Agent binding, "Effective for this stage", Customize capabilities, Model ("Agent default"), Effort, Context window, Stage template, Max turns, Agent mode | `workflow/AgentBindingSection`, `shared/ModelPicker` |
| **WorkflowStageTools** | Skills list and MCP servers list with search and scope | `workflow/SkillSelector`, `workflow/McpServerSelector` |
| **WorkflowStageHooks** | Stage hooks list (Phase: before/after/fail/cancel/prompt-turn; Type seg; Command; Timeout; Retries; Priority) | `StagePropertiesPanel` (hooks section) |
| **WorkflowSettingsPanel** | Workflow settings in the inspector: tabs General / Project / Variables ("Run inputs") / Hooks; variable editor rows; **"Preview dialog"** of the launch prompt | `workflow/WorkflowConfigPanel`, `workflow/settings/{GeneralTab,ProjectCodebasesTab,VariablesTab,HooksTab,TagsMetadataTab}`, `workflow/VariableInputModal` |
| **WorkflowValidate** | **Problems panel** over the canvas ("Save and Run are blocked until fixed"): undefined variable, duplicate edge; each problem links to its stage or edge | Validation in `WorkflowBuilderPage`. The panel UI is **NEW** |

### 2.6 Library page

| Board | Purpose / template | Current code |
|---|---|---|
| **Projects** | T2: search, seg Active/Archived, Updated chip, list/grid toggle, table (Project + description, Codebases 84, Active chats 120, Last run 272, Worktrees 76, Updated 72); **row action menu** (Open, New chat in project, Run workflow…, Add codebase…, Copy root path, Project settings, Archive, Delete) | `pages/ProjectsListPage.tsx` |
| **ProjectDetail** | T3 with tabs: header (New chat, Run workflow, More); description; needs-you banner; tabs **Codebases (2) / Chats (6) / Runs (14) / Customization / Settings**; **inline Add codebase form** (Git remote / Local git / Local folder, alias, URL, branch, subdirectory); codebase table with Fetch and Logs | `pages/ProjectDetailPage.tsx` tabs are Codebases / Project Customization / **Pull requests** / Settings. **NEW**: Chats and Runs tabs, inline add form |
| **ProjectCustomization** | Customization tab: seg **Skills / Prompts / Agents / MCP**, filter, Upload, table with enable switches, **400px preview panel** (SKILL.md rendered, file chips, Delete / View JSON / Edit) | `ProjectDetailPage` "artifacts" tab, `artifacts/ArtifactBrowser` |
| **CodebaseDetail** | T3: header (Logs, More); meta row (remote, Default branch chip, Last fetched, Active worktrees, Fetch); tabs **Worktrees / Files**; seg All / Active / Orphaned / Completed; Clean up orphans; table (Linked to, Status, Created, Remove) | `pages/CodebaseDetailPage.tsx` (same two tabs) |
| **Agents** | **T2 grid variant**: 3-column cards (avatar, name, role badge, description, scope "Built-in · read-only" or "Project · x", Disabled badge; Edit, **Export .agent.md**, Delete); seg by scope; Role and Name chips | `pages/AgentsListPage.tsx`, `data/EntityCard` |
| **AgentEditor** | **T4 Form + aside**: 720px form (Identity: avatar, name, slug, description, scope, tags, enabled; Instructions + Add to / Replace default; **Role seg Worker / Orchestrator**; Runtime: provider, model, max turns, effort, context tier; Skills; MCP; **Capabilities tri-state Inherit / On / Off**) and a 320px "Effective capabilities" aside | `pages/AgentEditorPage.tsx`, `agents/{EffectiveCapabilitiesPanel,ToolPolicyEditor,CapabilityToggleList}` |

### 2.7 System page

| Board | Purpose | Current code |
|---|---|---|
| **SettingsAppearance** | Settings modal: Mode seg (System / Light / Dark); Theme gallery (5 columns, filters Product / Editor / Low glare); Accent swatches (7); Density (Compact / Comfortable); Font size 12/13/14; Reduce motion; footer "Changes apply instantly · Saved on this device" | `settings/sections/Appearance.tsx`, `pages/SettingsPage.tsx` |
| **SettingsSecurity** | Servers (Switch); Network exposure seg (Loopback / LAN / Custom) with Restart server; Pending access requests (scopes, Approve 2/3); Paired devices table (scopes, seen, Revoke); Pair a new device (address, code, QR, expiry) | `settings/sections/Security.tsx` |
| **CommandPalette** | See §1.1 | `layout/CommandPalette.tsx`, `ui/primitives/command.tsx` |
| **DesktopWindows / DesktopMac** | See §1.2 | `layout/TitleBar.tsx`, `apps/desktop/src/main/{platform,tray,updater}.ts` |
| **Pairing** | Centred 420px card: server address with reachability, **6-character code boxes** with an expired error, device name, Connect, "Scan QR from the desktop app", hint for `generatorai device invite` | `components/AuthGate.tsx` |

### 2.8 Gaps

**Designed but not implemented (NEW):**
- Home: quick composer, inline approvals, and the This-week and System cards in their new form.
- Sidebar: live Needs-you and Running lists, the 48px rail, the server switcher and Servers popover.
- Chat: Transcript view seg (Normal / Verbose / Summary); a pinned Files dock tab; the dock as an overlay sheet under 1200px.
- Computer use: replay scrubber and grants.
- Plan: revision seg and inline step comments (verify against `PlanDocumentPanel`).
- Create chat: full-page route with a Summary aside and a 3-way "Who works" chooser.
- Pickers: model detail pane, agent-picker detail and team pane.
- Chats list: bulk-action floating bar (partly in `ChatsListPage`).
- Workflows: list stat strip, the WorkflowNew start page with templates, the validation problems panel.
- Automations: stepped create wizard.
- Scripts: master-detail layout.
- Projects: Chats and Runs tabs, inline add-codebase form.
- Settings as a modal with search.
- Palette: entity search and actions.
- Windows strip: back/forward, update button, server chip.
- macOS tray menu contents.

**Implemented but not designed:**
- Routes: `PullRequestPage` (`/projects/:id/codebases/:cid/pull-requests/:number`) and the project **Pull requests** tab (`scm/ProjectPullRequestsTab`); `CreateProjectPage` (`/projects/new`); `ScriptDetailPage` as its own route (absorbed by Scripts master-detail); the 404 page; route-level `ErrorBoundary`/`PageErrorBoundary` states.
- **Widget** dock tab (`widgets/WidgetHost`, `WidgetFrame`): only mentioned in a "+" tooltip on the run dock.
- `FindBar` (desktop Cmd+F).
- Mobile `Drawer` layout (the mobile app is separate).
- `scm/ScmConflictActions` and `ScmResultCard` (the `scm_result` transcript block).
- `artifacts/ArtifactPicker`.
- Workflow `TagsMetadataTab`.
- `QuestionCard` in its standalone (non-relayed) form: the relayed form is shown in ChatTasks.
- **Settings sections.** The code has all 15 of these in 4 groups. The nav is designed in full (it matches the code exactly), but only two section bodies are designed:

| Group | Sections in code | Body designed? |
|---|---|---|
| App | General (`General.tsx`), Appearance (`Appearance.tsx`) | Appearance only |
| Agents & models | Model providers (`Providers.tsx`), Agents (`Agents.tsx`), Skills / MCP servers / Templates (`Catalogs.tsx`) | none |
| Integrations | Source control (`SourceControl.tsx`), Browser & terminal (`BrowserTerminal.tsx`), Computer use (`ComputerUse.tsx`), Audio (`Audio.tsx`), Extensions (`Extensions.tsx`) | none |
| System | Security & devices (`Security.tsx`), Storage (`WorkspaceRetention.tsx`), Diagnostics (`Diagnostics.tsx`) | Security only |

---

## 3. Page templates and recurring composites

### 3.1 Templates

| ID | Template | Anatomy | Boards |
|---|---|---|---|
| T1 | **Dashboard** | Header, max-width content: 1fr column of sections plus a 300px rail of cards | Home, DesktopWindows body |
| T2 | **Entity list** | Header; H1 + count + primary action; optional stat strip; toolbar (search 240–264 + scope seg + filter chips + sort + view toggle); table (`.th` / `.tr`, fixed-width columns, trailing icon actions) or a 3-column card grid; footer note; optional bulk bar | ChatsList, Workflows, Automations, Projects, Agents (grid), CodebaseDetail body |
| T3 | **Entity detail** | Breadcrumb header + actions; title block (H1, meta, description, badges, needs-you banner); optional stat row; tabs or sections; optional 360px rail of cards | WorkflowDetail, AutomationDetail, ProjectDetail, ProjectCustomization (+400 preview), CodebaseDetail |
| T4 | **Form + summary** | Centred 720px sectioned form (h2 + hint per section), 320px sticky aside (summary or effective result), 56px footer | ChatCreate×3, AgentEditor, WorkflowNew (no aside), NewChat (dialog variant) |
| T5 | **Workspace + dock** | Header (breadcrumb, badge, chips, dock toggle); centre column (transcript or timeline); bottom composer or banner; 440–480px tabbed dock; overlay sheet when narrow | Main, Chat* (7 boards), WorkflowRun, Dock* |
| T6 | **Canvas builder** | Rail sidebar, header with save state / undo / validate / run, canvas with floating controls and minimap, 400px inspector with tabs, optional problems panel | WorkflowBuilder, WorkflowStage*, WorkflowSettingsPanel, WorkflowValidate |
| T7 | **Stepped wizard** | 220px step nav (numbered, subtitles, done/current) plus a step body ("Step 2 of 6", h2, p, radio cards) and draft-saved state | AutomationCreate |
| T8 | **Master-detail** | 320px list pane plus a detail pane | Scripts; the Settings modal is a variant (220px nav + body) |
| T9 | **Overlay / popover** | Scrim + modal (640 / 960) or anchored popover (256–760) with a key-hint footer | NewChat, CommandPalette, Settings, Model and Agent pickers, Servers, tray menu |
| T10 | **Centered gate** | 420px card on the ground colour | Pairing |

### 3.2 Recurring composites

| Composite | Boards | Closest current code |
|---|---|---|
| **PageHeader (44px)**: breadcrumb, status badge, chips, actions | all pages | `layout/Breadcrumb`, `ui/PageHeader`, `layout/Header` (to be replaced) |
| **TitleBlock**: H1, count, meta, description, primary CTA | lists, details | `ui/PageHeader` |
| **Toolbar / FilterBar**: search + `kbd /`, seg with counts, filter chips, sort, view toggle | all T2 boards, CodebaseDetail, DockTasks | `layout/Toolbar`, `ui/SearchInput`, `data/FilterTabs` |
| **Segmented control (`.seg`)** | everywhere (modes, scopes, effort, compare) | `ui/Tabs`, `data/FilterTabs`. Needs a dedicated SegmentedControl |
| **EntityTable** (`.th` / `.tr`, checkbox, avatar + name, mono cells, +/− cell, status badge, row actions) | ChatsList, Workflows, Automations, Projects, CodebaseDetail, Paired devices, execution history | `ui/primitives/table`, `data/EntityListRow` |
| **EntityCard** (grid) | Agents, template grid, theme gallery | `data/EntityCard`, `ui/Card` |
| **StatusBadge** (run / ok / warn / err / idle) + status dot | everywhere | `ui/StatusBadge`, `ui/Badge` |
| **StatStrip / StatGrid** | Home, Workflows, AutomationDetail, WorkflowDetail rail, CodebaseDetail meta | `ui/StatCard`, `dashboard/HealthStatCard` |
| **KeyValue list / card** | Home System, WorkflowDetail config, AutomationDetail rail, model detail, agent detail | `dashboard/SystemHealthCard`, `shared/ModelPicker` `DetailRow` |
| **ActivityRow** (title, project, live step, timer, action) | Home, sidebar lists, palette recents | `dashboard/ActivityPanel` |
| **Tabs (`nav.tabs` / `a.tab` with counts)** | ProjectDetail, CodebaseDetail, stage inspector, run inspector | `ui/Tabs` |
| **Inspector panel** (400–440px, title, id, tabs, form rows) | WorkflowBuilder/Stage*, WorkflowRun, WorkflowSettingsPanel | `workflow/StagePropertiesPanel`, `WorkflowConfigPanel`, `redesign/RightInspector` |
| **Form section** (h2 + hint, `.lbl`, `.inp`, switch row, seg row) | T4 boards, settings, wizard | `ui/Input`, `ui/Select`, `ui/ToggleSwitch`, `settings/shared.tsx` |
| **Capability toggle list** (toggle, "from agent" badge, scope, reset-to-inherited, tri-state) | AgentPicker, ChatCreate*, AgentEditor, StageModel/Tools, ProjectCustomization | `agents/CapabilityToggleList`, `AgentOverridesEditor`, `EffectiveCapabilitiesPanel` |
| **Stepper nav** | AutomationCreate | none (NEW) |
| **Choice cards (radio cards)** | ChatCreate "Who works", WorkflowNew start, AutomationCreate trigger | none (NEW) |
| **Timeline / Gantt / run log** | WorkflowRun, AutomationDetail executions, checkpoint scrubber, computer replay, terminal console | `workflow/RunTimeline`, `redesign/StageTimelineItem`, `diff/CheckpointTimeline` |
| **DAG canvas + StageNode** | WorkflowDetail (read-only), Builder, Run (Graph) | `workflow/DAGCanvas`, `RuntimeDAGCanvas`, `StageNode`, `StageEdge` |
| **Needs-you / HITL banner** (title, reason, Review, Approve) | WorkflowRun, ProjectDetail, Home rows | `workflow/redesign/InlineHitlControls` |
| **Transcript parts** (§4) | Chat* | `agent/StreamPanel`, `StepRow`, `chat/*Card` |
| **Diff view** (unified / split, hunks, inline threads) | Main, DockChanges, ChatNarrow | `diff/DiffCodeView`, `diff/review/*`, `chat/InlineDiff` |
| **File tree with status letters** | DockFiles, ChatFiles, DockChanges tree, composer tray | `diff/ChangesTree`, `shared/FileExplorer`, `codebase/CodebaseFileBrowser` |
| **Terminal frame / command block** | DockTerminal, ChatTerminal | `terminal/TerminalPanel`, `chat/AgentConsole` |
| **Dock tab strip** | all T5 boards | `layout/RightPane` |
| **Empty / error / cap states** (message, real error, Retry) | Dock* "States" columns, ChatCreate empty sources, Scripts load error | `ui/EmptyState` |
| **Popover menu** (26px group label, 30px items, kbd, separators) | row actions, palette, tray, servers, DevTools, composer menus | `ui/primitives/dropdown-menu`, `popover` |
| **Avatar monogram** (20/24px) | agents everywhere | none (inline). Needs an `Avatar` |
| **Kbd hint footer** | pickers, palette, dialogs, composer | `ui/Kbd` |

---

## 4. Chat specifics

### 4.1 Transcript part types (as drawn)

| Part | Anatomy | Current file |
|---|---|---|
| **User message** | Card (`--raised`, 10px radius, 12/14 padding), 14px/1.6 text with inline mono, attachment chips | `chat/UserMessage.tsx` |
| **Agent turn header** | Avatar monogram, agent name, model ("Claude Sonnet 5"), time | `chat/AssistantMessage.tsx`, `agent/UsageChip` |
| **Thinking** | Collapsed pill "Thought for 12s". When the turn is collapsed: "6 steps · 2m 44s" | `chat/ThinkingPlaceholder`, StreamPanel thinking block |
| **Step timeline** | "Timeline, no cards": a 1px vertical rail with 28px rows. Each row is a verb (Read / Searched / Ran / Edited / Opened browser / Took screenshot / Focused window / Revised plan / Delegated / Running), a mono target, a result ("3 of 20 failed", "6 matches", "+14 −6", "v2 → v3") and a duration | `agent/StepRow`, `agent/groupSteps`, `chat/redesign/StepRow` |
| **Step error** | A mono error line under the step ("BrowserService: max concurrent sessions (5) reached") | `chat/ToolMessage` (legacy), StepRow |
| **Background running step** | "Running pnpm build · in background · 0:18" with a 3-line live output tail | `agent/LiveActivityStrip` |
| **Delegation group** | "Delegated 4 tasks · 1 running · 1 needs you…" with Open in dock and avatar sub-rows | `group` / `steps` blocks, `BackgroundTasksPanel` |
| **Assistant text** | Paragraphs with inline mono; a streaming caret (2px) while writing | `chat/MarkdownRenderer`, `IncrementalMarkdown`, `StreamingMessage` |
| **Permission request** | Header "Allow this command?" plus a risk class ("Network · writes to remote"); mono command; reason; Deny `Esc` / Always in this chat / Allow once `↵` | `chat/PermissionCard.tsx` |
| **Computer consent** | Numbered planned actions, Scope seg, Deny / Allow for this chat / Allow once | PermissionCard variant (NEW) |
| **Question (relayed)** | "Code Reviewer asks · background task", with answer option buttons and Open task chat | `chat/QuestionCard.tsx` |
| **Plan approval card** | "Plan ready for review · Revision 3 · 5 steps · 1 comment", Open in dock | `chat/PlanCard.tsx` → `PlanDocumentPanel` |
| **Changes tray** (above composer) | "2 files changed +18 −8 · Review changes". Expands to per-folder files ("updating…" while the agent writes) | `chat/ChatChangesTray.tsx` |

Not drawn: system messages (`SystemMessage`), widget blocks (`WidgetHost`), `scm_result` cards, `answer` blocks, and message actions such as copy and rewind (`MessageActions`, `RewindMenu`). Rewind now lives in the Changes checkpoint scrubber.

### 4.2 Composer anatomy (ComposerStates, named after `ChatInput.tsx`)
- **Box**: a placeholder line ("Reply to Bug Fixer…" or "Message Claude Sonnet 5…"), then the toolbar: Attach (+), **agent chip** (read-only, with a lock, "Agent is fixed for this chat"), **model chip**, **mode chip** (Auto / Plan), **Effort chip**, **context tier chip** (200K), a spacer, the **context gauge** button (42%), Dictate, and Send. Below the box: a **Sources chip** (primary mount + branch) and a **"N skills · M MCP" chip**. Below that, a hint row: ↵ Send, Shift↵ New line, / Skills, @ Files, ↑ History, plus a status such as "Waiting for you · 3m 10s".
- **Binding variants**:
  - *No agent*: the model chip is the identity.
  - *Worker agent*: a locked chip; skills shown as "5 skills (3 from agent + 2 added)".
  - *Orchestrate mode, no agent*: an "Orchestrating · 3 running" chip that opens Background tasks.
  - *Orchestrator agent*: a **Team** avatar strip under the toolbar, "Orchestrate mode is enabled by this agent".
- **Per-turn menus** (open upward, one at a time):
  - Agent mode: **Auto** / **Plan**.
  - Reasoning effort: Low / Medium / High. Shown only when the model reports reasoning levels.
  - Context window: Standard 200K / Long 1M. Shown only when the model has both.
  - **Gauge popover**: tokens used/total, a stacked bar (System prompt, Tool definitions, MCP tools, Skills, Conversation), an auto-compact marker at 160K, and Remaining / Max prompt / Max output. It is empty before the first response.
  - Below 420px of toolbar width, Effort and Tier fold into one menu. Mode is hidden in worker chats.
- **Input aids**:
  - `/` menu: groups Tools (/browser, /terminal), Skills and Prompts. Picking an item makes a pill with an argument hint.
  - `@` file menu: file name, path and mount badge. Attaches the contents as an @ chip.
  - Attachment chips: file, image with hover preview, @ file, and browser/terminal captures shown as filled chips.
  - Dictation: inline text at the caret, ✓ to keep and × to discard.
  - ↑/↓ history recall.
- **Blocking states** (typing is never blocked):
  - *Workspace preparing*: a bar reading "Preparing workspace… creating worktrees", Send disabled.
  - *Preparation failed*: Retry or change sources.
  - *Waiting on you*: "The agent is waiting for you to allow or deny a tool call" with **Cancel and send**.
  - *Running*: Send becomes **Stop**, then "Stopping…", then **Force reset** after 15s. The draft is kept and **there is no queue**. Note that ChatTasks shows "Queue a message for Orchestrator…" and a "Queue" key hint, which conflicts with this rule; confirm which is intended.
- **Sources popover**: every mount (Worktree / In place, branch, path) with "Edit sources…" and "Edits apply to the next turn".

Current mapping:
- `chat/ChatInput.tsx`: toolbar, model, mode, effort.
- `composer/ComposerMenu.tsx` and `builtins.ts`: the / and @ menus.
- `composer/promptHistory.ts`: ↑/↓ recall.
- `AttachmentChips.tsx`, `VoiceRecorder.tsx`, `shared/ContextUsageGauge.tsx`, `ChatChangesTray.tsx`.
- `sources/WorkspacePrepBar.tsx`, `sources/SourcesPanel.tsx`, `sources/EditSourcesDialog.tsx`.

### 4.3 Pickers and orchestrator mode
- **Model picker**: see §2.2. It is shared by the composer, New chat, ChatCreate, AgentEditor and StageModel (`shared/ModelPicker.tsx`). The design adds the provider column with a signed-out state, tier grouping, and the detail pane.
- **Agent picker**: see §2.2 (`agents/AgentPicker.tsx`). It is used only at creation; afterwards the agent is read-only in the composer and capabilities can only be added (removals of "from agent" items are recorded per chat).
- **Orchestrator mode**:
  - It is set at creation and fixed for the life of the chat. There are two ways in: (a) orchestrate mode with no agent, where the chat itself orchestrates; (b) an agent with role *Orchestrator*, which forces the mode and shows its Team.
  - Create-time validation nudges toward a Powerful-tier model.
  - At runtime: "Delegated N tasks" group rows, relayed questions, the composer "Orchestrating · N running" chip, and the **Tasks** dock tab (which exists only for orchestrate chats). The dock shows the worker limit ("4 of 4 workers"), waves, review rounds (cap 3), and accepted / in-review / failed / cancelled states.
  - Current code: `chat/BackgroundTasksPanel.tsx`, `chat/CreateChatDialog.tsx`, and the orchestration toggles in `agents/*`.
