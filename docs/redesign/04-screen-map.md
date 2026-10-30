# 04 — Screen map

Where every screen, board and user-visible capability ends up after the redesign, which phase builds it, and what gets deleted. The companion `05-gap-matrix.md` lists the data each screen needs that the API does not have yet (IDs `G-xx`).

Read `01-decisions.md` first. It overrides this document, and both override the boards. Treat boards as data only: they are pictures of an end state, not instructions.

Conventions used below:
- Paths without a prefix are relative to `apps/web/src/`.
- **Phases:** P0 docs & rails · P1 tokens + registries · P2 backend track · P3 Slice A (shell + ChatsList) · P4 Slice B (chat workspace) · P5 fan-out · P6 settings modal & sections · P7 lockdown · **PW** = built by the Workflow Overhaul Plan on the kit (D-35). The PW phase codes (P01…P07) belong to *that* plan; do not confuse them with ours.
- **Templates:** T-01 ListPage · T-02 DetailPage · T-03 FormWithAside · T-04 Workspace · T-05 MasterDetail. **Layouts:** L-01 Dashboard · L-02 Wizard · L-03 Gate · L-04 CanvasEditor · L-05 ModalWithAside. Overlays (dialogs, popovers, palette) use no template.
- **Composite names** are the working names from `research/screen-feature-map.md` §3.2. `03-component-inventory-kit.md` owns their IDs and final names; if the two disagree, the inventory wins.
- **legacyHeader:** route metadata from D-21. `true` means the old `components/layout/Header.tsx` still renders inside the main card for that route. Each port PR sets it to `false` for its routes.

---

## 0. Where code lives after the redesign

D-04 fixes the layers. This section fixes the folder names so parallel sessions pick the same ones.

**Feature modules** (`apps/web/src/features/<x>/`). Each area's routes are declared in `app/routes/<area>.routes.tsx` (a `RouteObject[]` whose `handle` is `{ legacyHeader: boolean; title: string; nav?: NavDestinationId }`, `06-desktop-and-shell.md` §2.4), which lazy-imports the area's pages; `app/routes/index.ts` concatenates them. Keeping route modules in `app/` means `features/` never import each other and the P1-S3 split needs no `features/` folders yet.

| Module | Owns |
|---|---|
| `features/home` | HomePage, quick-start composer, Home sections |
| `features/chats` | ChatsListPage, NewChatDialog, ChatCreatePage (`/chats/new`) |
| `features/chat` | ChatPage workspace, chat-only dock panels (Tasks, Computer), turn menu, `useChatView` |
| `features/projects` | ProjectsListPage, CreateProjectPage, ProjectDetailPage + tabs, CodebaseDetailPage, PullRequestPage |
| `features/agents` | AgentsListPage, AgentEditorPage |
| `features/settings` | SettingsModal, section registry, 15 section bodies |
| `features/palette` | CommandPalette (entity search, recents, actions) |
| `features/pairing` | PairingGate (rendered by `AuthGate`, not a route) |
| `features/workflows`, `features/automations`, `features/scripts` | **PW.** Until PW ports them, their `app/routes/<area>.routes.tsx` wraps the current `pages/*` files with `legacyHeader: true` |
| `app/` | router, providers, AppFrame wiring (ConnectedSidebar, ConnectedRail, title strips), NotFoundPage, RouteErrorPage, PageErrorBoundary |

**Blocks** (`apps/web/src/blocks/`). These are needed by two or more features. The chat workspace and the workflow run page share most dock panels, and features may not import each other (D-04), so these panels are blocks and not part of `features/chat`:

`blocks/transcript` (turn header, step timeline, thinking, permission/question/plan cards, tool-card registry) · `blocks/composer` (full and compact composer; the PW stage composer reuses it; its pure reducer lives in `packages/client-core/src/composer`, M-12) · `blocks/model-picker` · `blocks/agent-picker` · `blocks/capabilities` (CapabilityToggleList, effective-capabilities aside) · `blocks/sources` (sources editor, sources popover, mount cards) · `blocks/changes` (Changes panel, DiffView, checkpoint scrubber, commit/PR footer) · `blocks/files` · `blocks/terminal` · `blocks/browser` · `blocks/plan` · `blocks/widgets` · `blocks/attention` (AttentionRow and lists: sidebar, Home, ProjectDetail banner) · `blocks/entity-table` (query-bound EntityTable and FilterBar).

**Cross-feature actions go through stores or navigation, never imports.** Examples: Home opens the New chat dialog with `useNewChatStore.getState().open(draft)`; `app/` mounts `<NewChatDialog/>` from `features/chats`; the palette navigates.

---

## 1. Route table after the redesign

| Path | Module → page component | Template | Board(s) | Owner | legacyHeader until |
|---|---|---|---|---|---|
| `/` | home → `HomePage` | L-01 | Home | P5 | P5 (legacy `DashboardPage` renders here until then) |
| `/chats` | chats → `ChatsListPage` | T-01 | ChatsList (+ NewChat overlay) | P3 | P3 (first ported page) |
| `/chats/new` | chats → `ChatCreatePage` | T-03 | ChatCreate, ChatCreateOrchestrator, ChatCreateModel | P5 | new in P5 |
| `/chats/:id` | chat → `ChatPage` | T-04 | Main, ChatLight, ChatNarrow, ChatFiles, ChatTerminal, ChatBrowser, ChatTasks, ChatComputer, ChatPlan, ComposerStates, ComposerModelPicker, Dock* | P4 | P4 |
| `/projects` | projects → `ProjectsListPage` | T-01 | Projects | P5 | P5 |
| `/projects/new` | projects → `CreateProjectPage` | T-03 | — (content: mobile `MProjectCreate`) | P5 | P5 |
| `/projects/:id/:tab?` | projects → `ProjectDetailPage` | T-02 | ProjectDetail, ProjectCustomization | P5 | P5 |
| `/projects/:id/codebases/:cid/:tab?` | projects → `CodebaseDetailPage` | T-02 | CodebaseDetail | P5 | P5 |
| `/projects/:id/codebases/:cid/pull-requests/:number` | projects → `PullRequestPage` | T-02 | — (D-31) | P5 | P5 |
| `/agents` | agents → `AgentsListPage` | T-01 (grid) | Agents | P5 | P5 |
| `/agents/new`, `/agents/:id` | agents → `AgentEditorPage` | T-03 | AgentEditor | P5 | P5 |
| `/workflows` | workflows → `WorkflowListPage` | T-01 | Workflows | PW (fallback D-35: port as-is at end of P6) | PW |
| `/workflows/new` | workflows → `WorkflowNewPage` | T-03 | WorkflowNew | PW P01 (until then the legacy builder) | PW |
| `/workflows/:id` | workflows → `WorkflowDetailPage` (+ `?run` opens RunDialog) | T-02 (+ L-05 overlay) | WorkflowDetail, WorkflowRunDialog | PW (fallback D-35) | PW |
| `/workflows/:id/edit` | workflows → `WorkflowBuilderPage` | L-04 | WorkflowBuilder, WorkflowStage*, WorkflowSettingsPanel, WorkflowValidate, WorkflowLoopBuilder, WorkflowAgentDraft | PW | PW |
| `/workflows/:id/runs/:runId` | workflows → `WorkflowRunPage` | T-04 | WorkflowRun, WorkflowRunLoop | PW | PW |
| `/automations` | automations → `AutomationsPage` | T-01 | Automations | PW (fallback D-35) | PW |
| `/automations/new` | automations → `AutomationCreatePage` | L-02 | AutomationCreate | PW P02 | PW |
| `/automations/:id` | automations → `AutomationDetailPage` | T-02 | AutomationDetail | PW (fallback D-35) | PW |
| `/automations/:id/edit` | automations → `AutomationCreatePage` in edit mode | L-02 | AutomationCreate | PW (new route; PW decides) | — |
| `/scripts`, `/scripts/:id` | scripts → `ScriptsPage` (`:id` = selection) | T-05 | Scripts | PW | PW |
| `/settings/:section?` | settings → `SettingsModal` over the background location (D-26) | Dialog + T-05 | SettingsAppearance, SettingsSecurity | P6 | P6 (legacy `SettingsPage` renders as a page until then) |
| `*` | app → `NotFoundPage` | L-03 | — | P3 | never (built new) |
| route `errorElement` | app → `RouteErrorPage` | L-03 | — | P3 | never |
| (no route) | pairing → `PairingGate` inside `AuthGate` | L-03 | Pairing | P5 | n/a |
| (overlay) | palette → `CommandPalette` | — | CommandPalette | P3 (Go to / Actions / Recent chats; replaces `components/layout/CommandPalette.tsx`), P5 adds entity search (G-18) | n/a |
| (overlay) | chats → `NewChatDialog` | — | NewChat | P5 | n/a |

**Removed or renamed**
- **"Dashboard" becomes "Home"** everywhere: sidebar, palette, desktop menu, tray, macOS dock menu, the `usePageTitle` label, `docs/clients/*.md`. The e2e assertions for "Dashboard"/"Mission Control" (`agent-tests/e2e/navigation.spec.ts`) are rewritten in the P5 Home PR.
- **`/chats?new=1` is removed** (`components/layout/CommandPalette.tsx:43`, `pages/ChatsListPage.tsx:41`). New chat is a store-driven dialog; the full page is `/chats/new`.
- **`/settings` as a page is removed in P6.** `/settings` and `/settings/:section` stay as URLs but render the modal.
- **`ScriptDetailPage` merges** into `ScriptsPage` (PW). The URL `/scripts/:id` keeps working as the selected row.
- **Kept:** `/?pair=<code>` is read by `AuthGate` (`components/AuthGate.tsx:160`) and stays.

### Route decisions made here (not in `01-decisions.md`)

**R-1 — New chat is a dialog for a quick start plus a full page at `/chats/new` for everything else.** (Also recorded as DF-15 in `11-design-feedback.md`.)

The design has both forms:
- NewChat is a 640px dialog drawn over ChatsList. It has a collapsed "Options" row.
- The ChatCreate boards are a full page. The breadcrumb reads "Chats / New chat" and the board literally shows `/chats/new`. They add the 3-way "Who works on this" chooser, the orchestrate switch, multi-source editing, the capabilities tabs, the browser settings and the Summary aside.
- Home's quick composer has a "More options" link.

Both are kept, with one data model (`CreateChatDraft`, held in `features/chats`) so either one can hand over to the other:
- **Opens the dialog:** the sidebar "New chat" icon, `new-chat` (Ctrl/⌘ N on desktop), the palette action "New chat", the ChatsList header button, and the Projects row action "New chat in project" (project preset).
- **Opens `/chats/new`:**
  - the dialog's "Options" row, via a "More options" link. It navigates with `state: { draft }` and closes the dialog;
  - Home's "More options" link;
  - a direct URL or deep link (`generatorai://chats/new`, the Windows JumpList, the tray when no window is focused).
- **Why not a dialog-only flow:** the full form is 720 + 320px wide and 1,340px tall, which does not fit a 640px dialog. It also needs a URL that deep links and the palette can address.
- **Why not a page-only flow:** the dialog keeps the user in context and matches the board.

**R-2 — The New chat dialog is not URL-addressed.** It is transient UI with no shareable state, so a URL-addressed modal (as D-26 uses for Settings) buys nothing. `/chats/new` is the addressable form.

**R-3 — ProjectDetail tabs are path segments:** `/projects/:id/codebases|chats|runs|pull-requests|customization|settings`, with `codebases` as the default. The Customization sub-view is `?kind=skills|prompts|agents|mcp`.

This is a new rule. Tabs are held in `useState` today (`pages/ProjectDetailPage.tsx:232`), which means a link cannot open the Runs tab or the needs-you banner's target.

`/projects/:id/codebases/:cid` still resolves to CodebaseDetail, because React Router ranks the longer static path first. CodebaseDetail tabs: `/projects/:id/codebases/:cid/worktrees|files`.

**R-4 — `/chats/:id?dock=<tab>` opens a dock tab.** Values: `changes|files|terminal|browser|tasks|computer|plan`.

Home "Review", the sidebar Needs-you rows, the palette and deep links need to land on the right panel. The page consumes the parameter once and removes it with `replace`, so browser history does not fill with dock states.

Deep links need a desktop change first: `apps/desktop/src/main/deep-link.ts` `urlToRoute` drops the query string today (G-08). See §5.

**R-5 — `/workflows/:id?run` opens the RunDialog** (L-05) over WorkflowDetail. It is a proposal for PW. The palette's inline "Run 'Nightly dependency audit'" and Home's "Run workflow" need an address.

**R-6 — Errors.** The 404 route and the route `errorElement` render inside the main card with the L-03 Gate layout (a centred 420px card: title, the real error message, "Go Home" and "Reload"). `PageErrorBoundary` keeps the sidebar alive and uses the same card. The inline JSX in `router.tsx` (the `text-blue-500` link) is deleted in P3.

---

## 2. Board map

55 boards are listed below. The four overview boards (Audit, Foundations, Components, Themes) and ThemeInstrument are references for P1 and the kit, and are not mapped.

Columns:
- **Replaces:** the current files whose job the screen takes over.
- **Delete:** what that PR removes. "(last importer)" means the file is deleted only when nothing imports it any more. The legacy workflow pages import several chat parts (see the note after §2.1).
- **Gaps:** IDs in `05-gap-matrix.md`. Per D-36, a designed element whose gap is open is **not rendered**.

### 2.1 Home & chat (canvas page `chat`)

| Board | Title | Purpose | T/L | Key composites | Replaces | Delete | Gaps | Owner | Edge states / notes |
|---|---|---|---|---|---|---|---|---|---|
| Home | Home | Landing page: quick start, Needs you with inline approvals, Running with Stop, Recently finished, This week, System, shortcut counts | L-01 | PageHeader, QuickComposer, AttentionRow (56px two-line), ActivityRow (44px), StatGrid, KeyValueCard, CountLinks | `pages/DashboardPage.tsx`, `components/dashboard/{ActivityPanel,HealthStatCard,SystemHealthCard,SystemStatusPill}.tsx`, `dashboard/useTicker.ts`, `hooks/useLiveOperations.ts` | all listed; `ui/StatCard.tsx` (last importer) | G-01, G-10, G-11, G-12, G-04 | P5 | Empty: each list hides and H1 reads "Nothing needs you". Loading: skeleton rows, no shimmer. Error: per-card inline error with Retry. Below 1200px the 300px rail stacks under the main column. Rows with open gaps are not drawn |
| Main | Chat · Changes dock | Chat workspace: transcript, permission card, changes tray, composer, Changes dock with unified diff, Keep/Discard, commit | T-04 | PageHeader (breadcrumb, status, branch chip, More, dock toggle), transcript parts, PermissionCard, ChangesTray, Composer, DockFrame + DockTabStrip, DiffView, CommitBar | `pages/ChatPage.tsx`, `components/chat/{ChatMessageList,AssistantMessage,UserMessage,ToolMessage,SystemMessage,ThinkingPlaceholder,StreamingMessage,MarkdownRenderer,IncrementalMarkdown,InlineDiff,PermissionCard,ChatChangesTray}.tsx`, `agent/{StreamPanel,StepRow,UsageChip}.tsx`, `chat/redesign/*`, `layout/RightPane.tsx`, `hooks/useResizablePane.ts` | chat files listed; `StreamPanel`, `RightPane`, `useResizablePane` (last importer, see note) | — | P4 | legacyHeader off for `/chats/:id`. The header "More" menu takes Rename, Archive, Fork, Copy transcript and Open in editor (§4). Keep/Keep all/Undo all stay (D-28) |
| ChatLight | Chat · running (light) | Running turn: transcript view seg, background step with a live tail, streaming caret, working bar with Stop | T-04 | TranscriptViewSeg, LiveStepTail, WorkingBar, StreamingCaret | `agent/LiveActivityStrip.tsx`, `hooks/useTwoPhaseStop.ts` (logic moves to `packages/client-core/src/composer/`, M-12), `pages/chatStopEffects.ts` | same | G-06 | P4 | Light-theme verification board. The view seg is client-only (G-06) |
| ChatNarrow | Chat · narrow window (1100) | Behaviour under 1200px: 48px rail, dock as a 380px overlay sheet, icon-only inactive tabs | T-04 + shell | Rail, DockSheet (`data-gai-overlay`, D-19 ancestor exemption) | `layout/AppLayout.tsx` (Drawer branch), `ui/Drawer.tsx` | Drawer (last importer) | — | P3 (rail) · P4 (sheet) | No drawer below `md`. The rail stays down to 360px. The branch chip is dropped |
| ChatFiles | Chat · Files dock | Pinned Files tab: source switcher, filter, tree with status letters, file preview | T-04 dock | FileTree, SourceSwitcher, CodePreview | `diff/{FilesSurface,FileCodeView}.tsx`, `diff/useFileTabs.tsx`, `diff/fileTabId.ts` | same (after `RightPane` goes) | — | P4 | See DockFiles |
| ChatTerminal | Chat · Terminal dock | Terminal seg (Agent console + shells), cwd chip, Find, Clear, Kill with confirm popover | T-04 dock | TerminalFrame, TerminalSeg, ConfirmPopover | `terminal/TerminalPanel.tsx`, `chat/AgentConsole.tsx` | last importer | — | P4 | The board's "Queue a message…/↵ Queue" is ignored (D-29) |
| ChatBrowser | Chat · Browser dock | Page sub-tabs, URL bar, Shared toggle, device chip, Comment/Comments, capture, DevTools, stop | T-04 dock | BrowserToolbar, PinComment, DeviceMenu | `chat/BrowserPanel.tsx` (2,105 lines), `browser/BrowserVisibilityPicker.tsx` (moves to ChatCreate) | BrowserPanel (last importer: `settings/sections/BrowserTerminal.tsx`, `WorkflowRunPageV2`) | — | P4 | `NativeBrowserView.tsx` is kept and rewired to `[data-gai-overlay]` (D-19). Queue hint ignored (D-29) |
| ChatTasks | Chat · Background tasks dock | Orchestrator chat: "Delegated N tasks" group, relayed question card, task cards | T-04 dock | DelegationGroup, RelayedQuestionCard, TaskCard | `chat/BackgroundTasksPanel.tsx`, `chat/QuestionCard.tsx` (relayed form) | same | — | P4 | Tasks panel sections are pluggable (PW P06 adds "Workflow runs" and "Drafts"). Queue hint ignored |
| ChatComputer | Chat · Computer use dock | Consent card, live frame, Pause agent / Take over, replay scrubber, grants with Revoke | T-04 dock | ConsentCard, LiveFrame, ReplayScrubber, GrantList | `chat/ComputerPanel.tsx` (1,201 lines), the PermissionCard consent variant | same | G-07 | P4 | The consent card renders the single pending action until G-07 lands (no Scope seg, no numbered plan). Pause/Take over are hidden until G-07. The board shows Tasks on a non-orchestrator chat and moves Browser into "+"; follow D-27 instead |
| ChatPlan | Chat · Plan dock | Plan-ready card; plan document with revision seg, numbered steps, inline step comment, Risks, Approve/Request changes/Discard | T-04 dock | PlanCard, PlanDocument, RevisionSeg, InlineComment | `chat/PlanCard.tsx`, `chat/PlanDocumentPanel.tsx` | same | none (revisions and anchored comments exist, see 05 §3) | P4 | "Edit plan" and "Save plan to workspace" stay (current features) |
| ChatsList | Chats · list | H1 + count, search, All/Active/Archived seg, chips (Project, Agent, Status, Tags), sort, checkbox table, infinite scroll, floating bulk bar | T-01 | PageHeader, TitleBlock, FilterBar, SegmentedControl, FilterChip, EntityTable, BulkBar, StatusBadge, AgentGlyph (DF-13) | `pages/ChatsListPage.tsx`, `components/data/EntityListRow.tsx`, `data/FilterTabs.tsx` | ChatsListPage; `chat/ChatList.tsx` (dead today, deleted in P0-05); EntityListRow/FilterTabs (last importer) | G-01, G-02 | P3 | Empty (no chats): "Start your first chat" + New chat. No results: "No chats match" + Clear filters. Loading: 12 skeleton rows. Error: inline callout with Retry. The Changes cell shows "—" until G-02. Status comes from G-01 + G-02. Worker chats stay hidden (`hooks/queries.ts:402`) |
| NewChat | Chats · New chat dialog | Quick create: task, name; Where (project, per-codebase Worktree/In place + branch, local folder); Who (agent, model, effort); capabilities; Options | overlay (Dialog 640) | Dialog, SourcesEditor (compact), AgentPicker, ModelPicker, SegmentedControl, KbdHints | `chat/CreateChatDialog.tsx`, `chat/sources/{SourcePicker,DirectoryBrowser}.tsx` | same (`common/{ProjectPicker,CodebasePicker}.tsx` are dead today and already deleted in P0-05) | — | P5 | Until P5, ChatsList "New chat" opens the legacy `CreateChatDialog`. Invalid state: Start disabled with the reason in the footer. See R-1 |

**Legacy workflow pages import chat parts.** Today these legacy files still import chat components:
- `WorkflowRunPageV2` imports `RightPane`, `ChangesSurface`, `TerminalPanel`, `BrowserPanel` and `WidgetHost`;
- `StageTimelineItem` imports `StreamPanel` and `ContextUsageGauge`;
- `AgentBindingSection` imports `AgentPicker`, `AgentOverridesEditor` and `EffectiveCapabilitiesPanel`;
- `StagePropertiesPanel` imports `ModelPicker`;
- `AutomationDetailPage` imports `ChangesSurface`.

Rule for P4/P5: when a block replaces one of these, the same PR **repoints those imports to the new block** if the props contract allows it. Only the import changes; the legacy layout stays, as D-35 allows. The old file is then deleted.

`RightPane.tsx` and `useResizablePane.ts` cannot be swapped like that, because the run page's layout depends on them. They survive until PW (or the D-35 fallback) replaces `WorkflowRunPageV2`.

### 2.2 Composer & new chat (canvas page `compose`)

| Board | Title | Purpose | T/L | Key composites | Replaces | Delete | Gaps | Owner | Edge states / notes |
|---|---|---|---|---|---|---|---|---|---|
| ComposerModelPicker | Chat · Model picker | 620×384 popover: provider column with a "Not signed in" state, searchable model list grouped Fast/Balanced/Powerful, detail pane | overlay (Popover) | Combobox (Base UI), ProviderColumn, ModelDetail (KeyValue) | `shared/ModelPicker.tsx`, `ui/SearchableSelect.tsx` | ModelPicker (last importer: `StagePropertiesPanel` is repointed); SearchableSelect (last importer) | G-09 (client method only) | P4 | Signed-out provider: help text + "Sign in" goes to Settings › Model providers. Empty search: "No models match". "Applies from the next turn" |
| AgentPickerBoard | Agent picker | 760px picker: search, scope seg, "No agent", Orchestrators/Workers groups, detail with team; Customize capabilities card | overlay (Popover) | Combobox, AgentGlyph, TeamList, CapabilityToggleList (tri-state, "from agent" badge, reset) | `agents/{AgentPicker,AgentOverridesEditor,CapabilityToggleList}.tsx` (`useAgentCatalog.ts` kept) | repoint `AgentBindingSection`, then delete | — | P5 (first consumer is NewChat); CapabilityToggleList in P4 (composer skills chip) | Only used at creation; afterwards the composer shows the agent read-only |
| ComposerStates | Composer · states | Spec sheet: binding variants, per-turn menus, gauge popover, `/` and `@` menus, attachments, dictation, blocking states, changes tray, sources popover | component spec | Composer (full + compact), ChipMenu, ContextGauge, SlashMenu, MentionMenu, AttachmentChip, DictationBar, BlockingBar, SourcesPopover | `chat/ChatInput.tsx` (2,122 lines), `chat/composer/{ComposerMenu,builtins,promptHistory,types}.ts(x)`, `chat/{AttachmentChips,VoiceRecorder}.tsx`, `shared/{ContextUsageGauge,ImageHoverPreview}.tsx`, `chat/sources/{WorkspacePrepBar,EditSourcesDialog,SourcesPanel}.tsx` | same, after characterization tests (plan-audit M6) | — | P4 | States to cover: workspace preparing, prep failed (Retry / Edit sources), waiting on you (Cancel and send), running (Stop → Stopping… → Force reset after 15s), empty gauge ("Context usage appears here after the model responds"), toolbar under 420px (effort and tier fold into one menu). No queue (D-29) |
| ChatCreateOrchestrator | Chats · Create chat (orchestrator) | Full-page create with an orchestrator agent: forced orchestrate switch, powerful-model nudge, 200K/1M, capabilities tabs, Team in the Summary | T-03 | ChoiceCards, FormSection, SwitchRow, CapabilityTabs, SummaryAside, StickyFooter | new `features/chats/ChatCreatePage.tsx` built from blocks | — | — | P5 | Empty managed workspace state ("No sources yet …") |
| ChatCreateModel | Chats · Create chat (model + orchestrate, invalid) | "Just a model" + orchestrate on; invalid state (no task); model-strength warning with a "Use Claude Opus 5.5" fix | T-03 | Callout (warn) with inline fix, "Before you can create" checklist | same page | — | — | P5 | Invalid: footer "Create chat" disabled with the reason; checklist in the aside |
| ChatCreate | Chats · Create chat (agent) | Full form: task, name, description, who, orchestrate, model/effort, Where (sources: alias rename, reorder, remove, Worktree/In place, branch New/Existing/Stay on, Make working directory), capabilities, tags, integrated browser | T-03 | SourcesEditor (full), TagInput, SegmentedControl, SummaryAside | `browser/BrowserVisibilityPicker.tsx` moves here | — | — | P5 | Bare-clone codebase: "In place" disabled with a tooltip. Summary lists the setup side effects ("1 worktree and 1 branch will be created") |

### 2.3 Dock close-ups (canvas page `dock`)

| Board | Title | Purpose | T/L | Key composites | Replaces | Delete | Gaps | Owner | Edge states / notes |
|---|---|---|---|---|---|---|---|---|---|
| DockChanges | Dock · Changes | Review (compare seg This turn / This chat / Branch vs main, workspace-files chip, checkpoint scrubber, pending-comment bar, per-file diff, inline thread), Split view, Ship (commit + PR) | T-04 dock | CompareSeg, CheckpointScrubber, ReviewBatchBar, DiffView (unified/split), ThreadCard, ConfirmPopover, CommitForm, PrForm | `diff/{ChangesSurface,ChangesTree,CheckpointTimeline,DiffCodeView,checkpointGroups,changeVisibility}.ts(x)`, `diff/review/*`, `scm/{SourceControlPanel,SourceControlOptionsFields}.tsx` (`DiffProviders.tsx` and `diffTheme.ts` kept) | ChangesSurface (last importers `WorkflowRunPageV2`, `AutomationDetailPage`: repoint to `blocks/changes`) | none (05 §3) | P4 | Empty: "No changes yet …" + Refresh. Commit/PR hidden at 0 files or when Source control is off. Keep, Keep all and Undo all kept (D-28). "Rewind to here" is workspace-only; the conversation rewind moves to the turn menu (§4) |
| DockFiles | Dock · Files | Tree (Sources header, mount cards, one section per mount), Preview (file tabs ≤8, restored), Filter & states | T-04 dock | MountCard, FileTree, FileTab, EmptyState | as ChatFiles + `chat/sources/SourcesPanel.tsx` | same | — | P4 | Empty filter: "No files match …" + Clear. Binary, too large and deleted-file preview states |
| DockTerminal | Dock · Terminal | Agent console (read-only command blocks, ringed from the transcript), interactive shell (≤4 tabs, Find, Attach selection), states | T-04 dock | CommandBlock, TerminalFrame, FindOverlay | as ChatTerminal | same | — | P4 | Exited ("Process exited — code 1"), tab cap reached, fallback shell (no node-pty), connection error with the scrollback promise |
| DockBrowser | Dock panel · Browser | Browsing (page tabs ≤5, agent-browsing strip, status bar, DevTools menu), Comment & capture, States | T-04 dock | as ChatBrowser + DeviceToolbar | as ChatBrowser | same | — | P4 | Pool full (the real error + Retry + `GENERATORAI_BROWSER_MAX_CONCURRENT`), load failure (net error + Retry + Open Terminal), empty (Start). The sharing toggle is locked while a turn streams |
| DockTasks | Dock panel · Background tasks | Overview (wave, worker limit, progress bar, seg, pinned asks), Task detail (brief, last steps, result, review rounds), States | T-04 dock | SegmentedProgress, AskCard, TaskRow, TaskDetail | `chat/BackgroundTasksPanel.tsx` | same | G-20 | P4 | Empty (orchestrate-only tab), failed (verbatim error + "Ask Orchestrator to retry"), cancelling (inline confirm). "Cancelled by you at 14:09" shows the time only until G-20 |

### 2.4 Projects & agents (canvas page `library`)

| Board | Title | Purpose | T/L | Key composites | Replaces | Delete | Gaps | Owner | Edge states / notes |
|---|---|---|---|---|---|---|---|---|---|
| Projects | Projects · list | Search, Active/Archived seg, list/grid, table (Codebases, Active chats, Last run, Worktrees, Updated), row action menu | T-01 | EntityTable, ViewToggle, RowMenu | `pages/ProjectsListPage.tsx`, `data/EntityCard.tsx` (last importer) | ProjectsListPage | G-13 | P5 | Row menu: Open, New chat in project (dialog with project preset), Run workflow… (legacy workflow picker until PW), Add codebase… (`/projects/:id/codebases?add=1`), Copy root path, Project settings, Archive, Delete. Columns with open gaps are hidden. Empty: "No projects yet" + New project |
| ProjectDetail | Project · Codebases | Header actions, description/meta, needs-you banner, tabs Codebases/Chats/Runs/Customization/Settings (+ Pull requests, D-31), inline Add codebase form, codebase table with Fetch and Logs | T-02 | TitleBlock, HitlBanner, Tabs (R-3), InlineForm, EntityTable | `pages/ProjectDetailPage.tsx` (1,389 lines; split one file per tab), `scm/ProjectPullRequestsTab.tsx` (restyled, kept) | ProjectDetailPage | G-01 (banner), G-14, G-15, G-16 | P5 | Tab order: Codebases · Chats · Runs · Pull requests · Customization · Settings. Settings tab = today's `ProjectSettingsForm` (root path, retention, max codebases, Delete project). Clone progress "in Logs" needs G-16 |
| ProjectCustomization | Project · Customization | Seg Skills/Prompts/Agents/MCP, filter, Upload, table with enable switches, 400px preview (rendered SKILL.md, files, Delete / View JSON / Edit) | T-02 (tab) + preview aside | SegmentedControl, EntityTable, PreviewPanel, Markdown | the artifacts tab in `ProjectDetailPage.tsx`, `stores/projectCatalogPrefsStore.ts` | `artifacts/ArtifactBrowser.tsx` (dead today); the prefs store once G-19 lands | G-19 | P5 | The MCP "Add server" form moves into this tab (today it is inline). Enable switches stay device-local until G-19, with a "This device" note |
| CodebaseDetail | Codebase · Worktrees | Meta row (remote, default branch, last fetched, active worktrees, Fetch), tabs Worktrees/Files, seg All/Active/Orphaned/Completed, Clean up orphans, worktree table | T-02 | MetaRow, Tabs, EntityTable, ConfirmPopover | `pages/CodebaseDetailPage.tsx`, `codebase/CodebaseFileBrowser.tsx`, `shared/FileExplorer.tsx` | same | G-16, G-17 | P5 | "Change default branch" (branch search) stays in the More menu. Size and "Linked to" columns are hidden until G-17 |
| Agents | Agents · catalog | 3-column card grid: role badge, description, runtime line, scope/version, Disabled; Edit / Export .agent.md / Delete; Import .agent.md; New agent | T-01 (grid) | EntityCard, AgentGlyph (DF-13), ScopeSeg, FilterChip | `pages/AgentsListPage.tsx` | same; EntityCard (last importer) | — | P5 | Built-in agents are read-only ("duplicate one to change it"). Empty and no-results states |
| AgentEditor | Agent · editor (full page) | Identity, Instructions (+ add/replace default), Role seg, Runtime, Skills, MCP, Capabilities tri-state; aside "Effective capabilities" + Used by | T-03 | FormSection, TriStateRow, SummaryAside, StickyFooter (unsaved) | `pages/AgentEditorPage.tsx`, `agents/{EffectiveCapabilitiesPanel,ToolPolicyEditor}.tsx` | same (EffectiveCapabilitiesPanel after repointing `AgentBindingSection`) | — | P5 | Orchestrator role reveals Team, Max concurrent workers and Default worker model (current fields). Unsaved footer with Discard / Save (Ctrl S). Size warnings for instructions |

### 2.5 Settings, palette, desktop, pairing (canvas page `system`)

| Board | Title | Purpose | T/L | Key composites | Replaces | Delete | Gaps | Owner | Edge states / notes |
|---|---|---|---|---|---|---|---|---|---|
| SettingsAppearance | Settings · Appearance | 960×640 modal with searchable nav; Mode, Theme gallery (filters), Accent (7), Density, Font size 12/13/14, Reduce motion | Dialog + T-05 | SettingsModal, SettingsNav (search), SettingsSection, SettingRow, ThemeCard grid, SwatchGroup | `pages/SettingsPage.tsx`, `settings/sections/Appearance.tsx`, `settings/shared.tsx`, the router-navigator in `stores/settingsUiStore.ts` | same | — | P6 | Nav labels follow the board ("Agents & models", "Model providers", "MCP servers"…). Search filters the nav by label and keywords (a client-side index; no API). Direct load renders over Home (D-26) |
| SettingsSecurity | Settings · Security & devices | Servers (Switch), Network exposure seg + Restart server, pending access requests, paired devices, pair a new device (address, code, QR, expiry) | Dialog + T-05 | SettingsTable, CodeBoxes, QR, Callout | `settings/sections/Security.tsx` (1,420 lines; split per card) | same | G-03 (server status) | P6 | Restart server: desktop through `window.generatoraiDesktop.restartServer`; in a browser, a "Restart required" callout (current behaviour) |
| CommandPalette | Command palette | 640px: query + count, contextual entity matches with inline action, Go to (shortcuts), Actions, Recent chats; key hints (↑↓, ↵, Tab actions, Esc) | overlay | Autocomplete (Base UI), ResultGroup, KbdHints | `layout/CommandPalette.tsx`, `ui/primitives/command.tsx` (cmdk) | same; remove the `cmdk` dependency | G-18, G-02 (recents) | P3 (P3-05: Go to / Actions / Recent chats) · P5 (P5-12: entity search) | Until G-18: navigation, actions and client-side matches over already-fetched lists only. Includes "Toggle theme" (D-21). No results: "No matches — try …" |
| DesktopWindows | Desktop · Windows title strip | 36px strip: back/forward/toggle sidebar, centred 420px Search, "Restart to update", server chip, WCO caption buttons; Servers popover | shell | TitleStrip, ServerChip, UpdatePill, ServersPopover | `layout/TitleBar.tsx`; `apps/desktop/src/main/platform.ts` (`TITLE_BAR_HEIGHT` → `CHROME`) | TitleBar | G-03, G-04 | P3 | Linux native frame and plain web put these items in the sidebar header row (D-23) |
| DesktopMac | Desktop · macOS | Traffic lights in a 44px sidebar row; menu-bar (tray) menu | shell | Sidebar (mac variant), TrayMenu (native) | `layout/{Sidebar,AppLayout}.tsx`, `status/ConnectionStatus.tsx` (→ sidebar footer), `apps/desktop/src/main/tray.ts` | Sidebar, AppLayout (→ `app/`) | G-05 | P3 | Rail on macOS: an empty 44px drag row plus a page-header inset (D-23, DF-08). The tray gets the board's items on every OS (§5) |
| Pairing | Pairing gate | Connect card: server address with reachability, 12-character code in 3 groups of 4 (board draws 6 boxes — DF-19), expired error, device name, Connect, QR hint | L-03 | GateCard, CodeBoxes, Callout | the view part of `components/AuthGate.tsx` (pairing logic kept) | view code only | — | P5 | Reachability is a client probe of `GET /api/auth/server-info` (exists). Expired code error. `/?pair=` prefill kept |

### 2.6 Workflows, automations & scripts (canvas pages `workflows` and `wfcreate`) — all PW

These boards depict Workflow Overhaul Plan end states (D-35, DF-17). The redesign builds only the engine-independent kit pieces (`03-component-inventory-kit.md`, marked *WF*). Until PW ports a page, its current files keep running with `legacyHeader: true`, and only a token/alias pass is allowed on them. "Replaces" names what PW deletes. **The redesign deletes nothing here**, except by the D-35 fallback: if PW UI work has not started when P6 ends, the redesign ports Workflows list, WorkflowDetail, Automations and AutomationDetail as they work today, with no new features.

| Board | Title | Purpose | T/L | Key composites | Replaces (PW) | Gaps | Owner (PW WP) | Notes |
|---|---|---|---|---|---|---|---|---|
| Workflows | Workflows · list | Stat strip, Draft/Published status, trigger/tags chips, list/grid, row Run + menu | T-01 | StatStrip, VersionBadge, EntityTable | `pages/WorkflowListPage.tsx`, `workflow/WorkflowCard.tsx` (`WorkflowDefinitionList.tsx` is dead today) | G-10, G-21 | PW P01 (WP-1.8) | Footer link to Scripts. Agent-draft row needs P06 |
| WorkflowDetail | Workflow · definition | Published vN, Versions, Test run, Run; read-only mini-DAG; config key-values; variables; runs rail with Ver/Trigger | T-02 | DagCanvas (read-only), KeyValueCard, EntityTable | `pages/WorkflowDefinitionPage.tsx`, `workflow/{RuntimeDAGCanvas,RunTimeline}.tsx` | G-10, G-21, G-22, G-29 | PW P01, P04 | Median cost uses the tokens-only fallback (G-29) |
| WorkflowBuilder | Workflow · builder | Canvas, stage nodes with key and pills, edge labels, inspector with 6 tabs (Policy shown), Save/Publish/Validate/Run | L-04 | DagCanvas, StageNode, Inspector, Tabs | `pages/WorkflowBuilderPage.tsx`, `workflow/{DAGCanvas,StageNode,StageEdge,StagePropertiesPanel,canvasContext,edgeTypeStyles}.ts(x)`, `hooks/useResizable.ts` | G-21, G-23 | PW P01 WP-1.8 (+ P03 gate, P05, P07) | Always in rail mode (D-22) |
| WorkflowRun | Workflow · run #248 needs approval | Run header (budget meter, context gauge, pinned version), lifecycle card, stage table with attempts, inline review card, stage composer, dock Inspector/Changes/Terminal | T-04 | RunLifecycleCard, StageTableRow, ReviewCard, BudgetMeter, Composer (compact), DockFrame | `pages/WorkflowRunPageV2.tsx`, `workflow/redesign/*`, `workflow/{RuntimeStageNode,RuntimeStageEdge}.tsx`, `layout/RightPane.tsx`, `hooks/useResizablePane.ts` | G-22, G-23 | PW P03b WP-3b.2, P04 | 440px dock (D-27) |
| Automations | Automations · list | Enable switch per row, Trigger, Workflows, Dataset, Permission, Last execution, Next run, Run now | T-01 | EntityTable, Switch | `pages/AutomationsPage.tsx` | G-26 | PW P01 WP-1.6, P02 | Next run already exists (`Automation.nextRunAt`, `lib/nextRun.ts`) |
| AutomationDetail | Automation · detail | Stat row (Executions 30d, Success, Avg duration, Next run), execution history with iterations, rail cards | T-02 | StatStrip, ExpandableRow, KeyValueCard | `pages/AutomationDetailPage.tsx`, `automation/TriggerAutomationModal.tsx` | G-10, G-26 | PW P01/P02 | Webhook credentials dialog kept |
| AutomationCreate | Automation · create (stepped) | 6-step wizard, draft saved, trigger radio cards, schedule, missed/overlap policy, Next 3 runs | L-02 | Stepper, ChoiceCards, SchedulePreview | `pages/CreateAutomationPage.tsx` (40 `useState`), `automation/WebhookCredentialsDialog.tsx` | G-26 | PW P02 | TanStack Form (D-38) |
| Scripts | Scripts · list + detail | Master-detail: list with load states, detail with Materialize as draft, Run script, profiles, compiled stages | T-05 | MasterDetail, StateBadge, EntityTable | `pages/ScriptsListPage.tsx`, `pages/ScriptDetailPage.tsx` | G-27 | PW P01, P05 | Load-error row shows the real error. "Reload" replaces the dead `reload-scripts` event (§5) |
| WorkflowRunDialog | Workflow · Run dialog | 1040×856: stage overrides, run options, codebases, uploads, 360px Plan preview, Cancel / Test run / Run | L-05 | ModalWithAside, PlanPreview, EntityTable | `workflow/VariableInputModal.tsx` | G-22 | PW P04 WP-4.4 | R-5 `?run` |
| WorkflowRunLoop | Workflow · run with a loop | Loop row expanded: exit-rule table, budget, carry, iterations, decision card | T-04 | LoopRow, DecisionCard | — | G-24 | PW P05 WP-5A.5 | — |
| ChatWorkflowRun | Chat · workflow run, approval and draft cards | Orchestrator transcript with run, approval and draft tool cards; Tasks sections; composer Workflows toggle | T-04 | ToolCard registry entries, TasksSection | extension points in `blocks/transcript` and `features/chat` (built in P4) | G-25 | PW P06 WP-6.1/6.2 | The P4 extension points (tool-card registry, Tasks sections, composer tool-toggle registry) are the only redesign work |
| WorkflowNew | Workflows · new workflow | Start point (Blank / Template / Import), template grid with category seg, preview, basics; "Create draft and open builder" | T-03 (aside = template preview) | ChoiceCards, TemplateCard grid | today `/workflows/new` opens the builder directly | G-21, G-24 | PW P01 (+ P05 templates) | — |
| WorkflowStagePrompt | Workflow · stage Prompt | Inspector Prompt tab: context from stage keys, prompts, variable popover with output-schema fields | L-04 inspector | Inspector, VariablePopover | `workflow/{PromptEditor,PromptFilePicker}.tsx` | G-21 | PW P01 | — |
| WorkflowStageModel | Workflow · stage Session | Agent (optional), model, effort, provider, permission, session reuse/group | L-04 inspector | SessionEditor | `workflow/AgentBindingSection.tsx` | G-23 | PW P02 WP-2.11 | — |
| WorkflowStageTools | Workflow · stage Tools | Skills, MCP, platform tool toggles | L-04 inspector | CapabilityToggleList | `workflow/{SkillSelector,McpServerSelector}.tsx` | — | PW P02 | — |
| WorkflowStageHooks | Workflow · stage Hooks + Output | Hooks (admin only), Output tab (format, schema, extraction, rules incl. Judge, max repairs) | L-04 inspector | HookRow, RuleRow | the hooks section of `StagePropertiesPanel` | G-21, G-24 | PW P01 (Judge P05 WP-5A.6) | — |
| WorkflowSettingsPanel | Workflow · settings, Variables | Tabs General/Project/Variables/Hooks/Tags/Budget; run-dialog preview | L-04 inspector | Inspector, VariableEditor | `workflow/WorkflowConfigPanel.tsx`, `workflow/settings/*` (incl. `TagsMetadataTab`) | G-21 | PW P01/P02 | TagsMetadataTab becomes the Tags tab |
| WorkflowValidate | Workflow · validation problems | Problems panel with codes and quick fixes; Publish/Run blocked | L-04 | ProblemsPanel | validation in `WorkflowBuilderPage` | G-28 | PW P01 | — |
| WorkflowLoopBuilder | Workflow · loop builder | Loop group node, kind palette, loop inspector | L-04 | GroupNode, KindPalette | — | G-24 | PW P05 | — |
| WorkflowAgentDraft | Workflow · agent draft + version history | Draft banner, Added/Changed tags, Check node, version-history aside | L-04 | DraftBanner, VersionHistoryAside | — | G-21, G-25 | PW P01 WP-1.6/1.7, P06 WP-6.5, P07 WP-7.6 | — |

---

## 3. Undesigned but existing features (D-31, D-32)

Recipes use only kit parts. The content reference says which fields and copy to keep; the layout always follows the recipe.

| Feature | Current files | Recipe | Content reference | Phase |
|---|---|---|---|---|
| PullRequestPage | `pages/PullRequestPage.tsx` (392 lines) | T-02: PageHeader (Projects / project / codebase / #n, state badge Draft/Open/Merged), TitleBlock, tabs Files / Comments, DiffView block, a "Review in chat" form (instructions + ModelPicker) | the current page | P5 |
| Project Pull requests tab | `scm/ProjectPullRequestsTab.tsx` | EntityTable inside the ProjectDetail tab (`/projects/:id/pull-requests`) | the current tab | P5 |
| CreateProjectPage | `pages/CreateProjectPage.tsx` | T-03: sections Basics, Repositories (repeatable codebase rows as in the ProjectDetail inline form), Settings (retention, max codebases); aside "What will be created" | mobile `MProjectCreate` | P5 |
| ScriptDetailPage | `pages/ScriptDetailPage.tsx` | Absorbed by the Scripts T-05 detail pane | Scripts board | PW |
| 404 | inline in `router.tsx` | L-03 card: "Page not found", the path in mono, Go Home | — | P3 |
| Route error | `router.tsx` `errorElement`, `components/ErrorBoundary.tsx` | L-03 card: "Something went wrong", the error message, Reload / Go Home | — | P3 |
| Page error boundary | `components/PageErrorBoundary.tsx` | Same card rendered inside the main card; the sidebar stays live | — | P3 |
| FindBar (desktop Cmd+F) | `layout/FindBar.tsx` | Restyled floating bar (Input, match count, previous/next IconButtons, Close); `data-gai-overlay` | — | P5 |
| Widget dock tab | `widgets/{WidgetHost,WidgetFrame,widgetTabId}.ts(x)` | `blocks/widgets`; opened from the dock "+" menu or the transcript widget block; DockTab with the widget title | — | P4 |
| SCM conflict and result cards | `scm/{ScmConflictActions,ScmResultCard}.tsx` | Transcript tool cards registered in the tool-card registry; Callout + Button row | — | P4 |
| ArtifactPicker | `artifacts/ArtifactPicker.tsx` | **No importers today (dead). Delete in P3** — D-32 listed it for a restyle | — | P3 |
| TagsMetadataTab | `workflow/settings/TagsMetadataTab.tsx` | TagInput inside the WorkflowSettingsPanel Tags tab | WorkflowSettingsPanel | PW |
| Standalone QuestionCard | `chat/QuestionCard.tsx` | Transcript card (non-relayed) with option buttons + free text | ChatTasks (relayed form) | P4 |
| System message, `answer` blocks, message actions | `chat/{SystemMessage,MessageActions,RewindMenu}.tsx` | Muted system row; turn "…" menu: Copy transcript, Fork from here, Rewind (code + conversation / code only / conversation only) | — | P4 |
| Dead code | `chat/ChatList.tsx`, `artifacts/ArtifactBrowser.tsx`, `common/{ProjectPicker,CodebasePicker}.tsx`, `workflow/WorkflowDefinitionList.tsx` | Delete (0 importers) | — | P3 (WorkflowDefinitionList by PW) |

### 3.1 Settings sections

`SETTINGS_NAV` (`components/settings/sectionRegistry.tsx`) has 15 sections in 4 groups. **Settings section recipe (P6):**
- a SettingsSection header (title + one-line description);
- one or more SettingsGroup cards, each holding SettingRows (label, description, control on the right: Switch, SegmentedControl, Select, NumberField, Button);
- a SettingsTable for lists (accounts, servers, devices, MCP servers, extensions);
- inline callouts for restart-required and error states;
- no toasts for successes (D-30).

The group header "Agents" becomes **"Agents & models"** per the board.

| Group | Section id | File | Desktop board | Content reference (mobile) | Phase |
|---|---|---|---|---|---|
| App | `general` | `sections/General.tsx` | — | MSetGeneral | P6 |
| App | `appearance` | `sections/Appearance.tsx` | SettingsAppearance | — | P6 |
| Agents & models | `providers` | `sections/Providers.tsx` (raw `fetch`; move to G-09 client methods) | — | MSetProviders | P6 |
| Agents & models | `agents` | `sections/Agents.tsx` | — | MSetAgents | P6 |
| Agents & models | `skills` | `sections/Catalogs.tsx` (`SkillsSection`) | — | MSetSkills | P6 |
| Agents & models | `mcp` | `sections/Catalogs.tsx` (`McpSection`) | — | MSetMcp, MSetMcpAdd (the add-server form) | P6 |
| Agents & models | `templates` | `sections/Catalogs.tsx` (`TemplatesSection`) | — | MSetTemplates | P6 |
| Integrations | `source-control` | `sections/SourceControl.tsx` | — | MSetSourceControl | P6 |
| Integrations | `browser-terminal` | `sections/BrowserTerminal.tsx` | — | MSetBrowserTerminal | P6 |
| Integrations | `computer-use` | `sections/ComputerUse.tsx` | — | MSetComputerUse | P6 |
| Integrations | `audio` | `sections/Audio.tsx` | — | MSetAudio | P6 |
| Integrations | `extensions` | `sections/Extensions.tsx` | — | MSetExtensions | P6 |
| System | `security` | `sections/Security.tsx` | SettingsSecurity | MSetSecurity, MSetPairDevice (pairing detail) | P6 |
| System | `storage` | `sections/WorkspaceRetention.tsx` | — | MSetStorage | P6 |
| System | `diagnostics` | `sections/Diagnostics.tsx` | — | MSetDiagnostics | P6 |

**Mobile-only boards with no desktop section:**
- `MSetNotifications`, `MSetAppLock` and `MSetWidgets` are per-device phone settings (`08-mobile-readiness.md`). They get no desktop section.
- If a desktop notifications preference is ever added, it goes under App › General.

---

## 4. Feature parity checklist

Every capability in today's web app and desktop shell, and where it lives after the redesign. Tick each row in the PR that ports it (`10-llm-playbook.md`). "Legacy" means the capability keeps working on an unported page with `legacyHeader: true`.

### 4.1 Shell and global

| # | Capability (today) | After the redesign | Phase |
|---|---|---|---|
| 1 | Sidebar nav: Dashboard, Projects, Chats, Agents, Workflows, Scripts, Automations (`layout/Sidebar.tsx:90`) | Home, Chats, Projects, Agents, Workflows, Automations, Scripts from `NAV_DESTINATIONS` (D-22) | P3 |
| 2 | Hide/show sidebar (sidebar button, `header-toggle-sidebar`, Ctrl/⌘ B) | Collapse button in the sidebar header; rail expand button; `toggle-sidebar` command | P3 |
| 3 | Mobile drawer below `md` (`AppLayout.tsx`) | Rail (no drawer) | P3 |
| 4 | Settings link + ⌘K hint in the sidebar footer | Footer gear (connection status beside it); Search button at the top | P3 |
| 5 | Connection status + "events missing" badge in the Header (`status/ConnectionStatus.tsx`) | Sidebar footer (dot + label + host); on the rail, a dot with a tooltip; the missing-events badge becomes a footer callout | P3 |
| 6 | Theme mode cycle button in the Header | Palette action "Toggle theme"; Settings › Appearance; desktop View ▸ Appearance. **P3 adds "Toggle theme" to the existing palette**, so ported routes are never left without a toggle | P3 |
| 7 | Open in editor (`shared/OpenInEditorButton.tsx`, `editorTargetStore`) | Page-header action on chat, run, project and codebase pages (block, restyled) | P4/P5 |
| 8 | Header breadcrumb and section title | Each page's 44px PageHeader | per page |
| 9 | Right pane toggle (`header-toggle-right-pane`, Ctrl+Alt+B) | Dock toggle in the chat/run page header; `toggle-right-pane` command | P4 |
| 10 | Command palette ⌘K: Navigate + Actions (New Chat/Agent/Workflow/Automation/Project, Settings) | New palette: Go to, Actions (same set + Toggle theme, Open settings), entity search (G-18), Recent chats | P5 |
| 11 | Find in page (desktop) | Restyled FindBar | P5 |
| 12 | Toasts (sonner) | Kept, restyled, errors and background completions only (D-30) | P3 |
| 13 | Page titles and the desktop "Open Recent" list (`usePageTitle`, `pageTitleStore`) | Kept; the title comes from route `handle.title` | P3 |
| 14 | Unsaved-work guard on window close (`unsavedWorkStore`) | Kept | — |
| 15 | Pairing gate (`AuthGate`) | PairingGate L-03 | P5 |

### 4.2 Home (today: Dashboard "Mission Control")

| # | Capability | After | Phase |
|---|---|---|---|
| 16 | Greeting + counts (Chats, Workflows, Automations) | H1 "N need you · N running" + shortcut count card (Projects, Agents, Automations next run, Scripts) | P5 |
| 17 | Activity panel: today / running / attention with Cancel, Retry and Trigger (`dashboard/ActivityPanel.tsx`) | Needs you (inline Approve / Allow once / Review), Running (Stop/Cancel), Recently finished (Retry, PR link) — G-01, G-11 | P5 |
| 18 | System health card and pill | System card (G-12); the Diagnostics link opens Settings › Diagnostics | P5 |
| 19 | New chat dialog from the dashboard | Quick composer + "More options" → `/chats/new` | P5 |

### 4.3 Chats list

| # | Capability | After | Phase |
|---|---|---|---|
| 20 | Search chats | FilterBar search (`/` focuses it) | P3 |
| 21 | All / Active / Archived filter | Seg with counts | P3 |
| 22 | Bulk select + delete with confirm | Checkbox column + floating bulk bar: Archive, Delete, Select all N, Clear (Esc) | P3 |
| 23 | New chat (`?new=1`) | Header button → dialog (R-1) | P3 (legacy dialog), P5 (new) |
| 24 | Open a chat (row click / Enter / Space) | Row link | P3 |

### 4.4 Chat workspace

| # | Capability | After | Phase |
|---|---|---|---|
| 25 | Archive chat (Header) | Page header More ▸ Archive (+ confirm) | P4 |
| 26 | Chat status badge in the Header | Page header StatusBadge (8-state, D-18) | P4 |
| 27 | Rename chat | Page header More ▸ Rename (PATCH `/chats/:id`) — new but cheap | P4 |
| 28 | Copy transcript, Fork from here (`MessageActions.tsx`) | Turn "…" menu | P4 |
| 29 | Rewind: code + conversation / code only / conversation only (`RewindMenu.tsx`) | Turn "…" menu (all three); the checkpoint scrubber's "Rewind to here" restores the workspace only | P4 |
| 30 | Transcript blocks: markdown, steps, thinking, tool, system, widget, scm_result, answer, permission, question, plan cards | `blocks/transcript` + the tool-card registry | P4 |
| 31 | Live activity strip | Background running step with a live tail + working bar | P4 |
| 32 | Composer: attach (button, drag, paste), `/` menu, `@` files, ↑/↓ history, dictation, agent mode Auto/Plan, effort, context tier, gauge popover, Send / Stop / Force reset, workspace-prep bar, prep failed, Cancel and send, sources popover + Edit sources | `blocks/composer`, every state from ComposerStates | P4 |
| 33 | Model picker in the composer | ComposerModelPicker block | P4 |
| 34 | Changes tray above the composer | Kept (collapsed + expanded) | P4 |
| 35 | Changes: compare against (session start, branch base, per turn), Keep / Unkeep / Keep all / Undo all, per-file undo, open in editor, comment on a line range, review batch, threads, checkpoints & rewind, view settings, refresh, commit, create PR, conflict actions | DockChanges: compare seg (This turn = `turn:<last>`, This chat = `baseline`, Branch vs main = `ref:<baseCommit>`) + a "More bases" menu for older turns; scrubber; everything else kept | P4 |
| 36 | Browser tab: multiple pages, back/forward/reload, URL, share toggle, comments, capture, device toolbar, zoom, DPR, DevTools (F12), reload (F5), stop | DockBrowser (tabs ≤5) | P4 |
| 37 | Terminal tab: shells, find (Ctrl F), clear, kill, attach selection, cd to worktree | DockTerminal (≤4), Agent console seg | P4 |
| 38 | Agent console (opened from a Ran step) | Terminal ▸ Agent console, with the command ringed | P4 |
| 39 | Computer tab: live view, replay (video + per-turn frames), recording start/stop, grants + revoke, runtime start/restart/stop | ChatComputer dock; runtime controls under More | P4 |
| 40 | Widget tab | Dock "+" ▸ Widget (`blocks/widgets`) | P4 |
| 41 | Background Tasks tab | Tasks tab (orchestrator chats only) | P4 |
| 42 | Plan tab: revisions, anchored comments, edit, save to workspace, discard, approve / request changes | Plan dock | P4 |
| 43 | Files open as file tabs (`useFileTabs`) | Pinned Files tab + file tabs (≤8, restored) | P4 |
| 44 | Resizable right pane (drag, arrows, double-click reset) | react-resizable-panels, persisted per page (D-27) | P4 |

### 4.5 Projects, codebases, PRs

| # | Capability | After | Phase |
|---|---|---|---|
| 45 | Projects list: search, list/grid, delete, archive toggle | T-01 + row menu | P5 |
| 46 | Create project with repositories and settings | CreateProjectPage T-03 | P5 |
| 47 | Codebases: add (remote / local git / local folder), fetch/sync, delete | Codebases tab + inline form; Fetch; Logs (G-16) | P5 |
| 48 | Customization: skills, prompts, custom agents, MCP servers (add form, remove), per-project enable toggles, edit contents | Customization tab + preview panel; Upload | P5 |
| 49 | Pull requests tab, PR page (files, comments, Review in chat) | Kept (D-31) | P5 |
| 50 | Project settings: root path, retention, max codebases, delete | Settings tab | P5 |
| 51 | Codebase detail: change default branch, worktrees (remove), files with rendered/source preview | CodebaseDetail; branch change under More | P5 |

### 4.6 Agents

| # | Capability | After | Phase |
|---|---|---|---|
| 52 | List: search, scope and role filters, import/export `.agent.md`, delete, open | Agents grid | P5 |
| 53 | Editor: identity, instructions + projection, role, runtime (provider, model, max turns, effort, context tier), skills, MCP, capabilities, team / max workers / default worker model, effective capabilities, export | AgentEditor T-03 + Used by | P5 |

### 4.7 Workflows, automations, scripts (legacy until PW)

| # | Capability | After | Phase |
|---|---|---|---|
| 54 | Workflow list: search, grid/list, bulk delete, upload JSON, download template, start from template | Legacy → PW Workflows | PW |
| 55 | Definition page: run, edit, delete, recent runs, session mode | Legacy → PW WorkflowDetail | PW |
| 56 | Builder: DAG edit, undo/redo (Ctrl Z / Ctrl Shift Z), save (Ctrl S), delete node (Delete/Backspace), validate, settings, stage properties | Legacy → PW builder | PW |
| 57 | Run page: inspector, changes, terminal, browser, widget, HITL approve/reject, pause/resume/cancel/retry (run and stage), permission mode | Legacy → PW run page | PW |
| 58 | Automations: list (run now, enable, delete), detail (executions, cancel, webhook credentials, rotate token), create form | Legacy → PW | PW |
| 59 | Scripts: list (search, run with defaults), detail (profiles, materialize, run, reload) | Legacy → PW Scripts | PW |

### 4.8 Settings

| # | Capability | After | Phase |
|---|---|---|---|
| 60 | 15 sections as a routed page | 960×640 modal, searchable nav, `/settings/:section?` (D-26); §3.1 | P6 |
| 61 | Default chat model (General) | General section | P6 |
| 62 | Servers: switch / forget (Security) | Security ▸ Servers + the sidebar Servers popover (G-03) | P3 (popover), P6 |

### 4.9 Keyboard shortcuts

These are the bindings after the redesign. The source of truth is `SHORTCUTS` in `packages/shared` (D-24). Web has no binding for the Chrome-reserved chords: those commands are reachable from the palette.

| Command id | macOS desktop | Win/Linux desktop | Web |
|---|---|---|---|
| `palette.open` | ⌘K | Ctrl K | Ctrl/⌘ K |
| `chat.new` | ⌘N | Ctrl N | — (palette) |
| `workflow.new` | ⇧⌘N | Ctrl Shift N | — |
| `settings.open` | ⌘, | Ctrl , | Ctrl/⌘ , |
| `nav.goto.<dest>` (Home 1 … Scripts 7, `NAV_DESTINATIONS` order) | ⇧⌘H, C, P, G, W, A, S | Ctrl 1…7 | — |
| `sidebar.toggle` | ⌘B | Ctrl B | Ctrl/⌘ B (when not in an editable field) |
| `dock.toggle` | ⌥⌘B | Ctrl Alt B | Ctrl/⌘ Alt B |
| `find.open` / next / previous | ⌘F / ⌘G / ⇧⌘G | Ctrl F / G / Shift G | browser native |
| `nav.back` / `nav.forward` | ⌘[ / ⌘] | Alt ← / Alt → | browser native |
| `shortcuts.show` | ⌘/ | Ctrl / | Ctrl/⌘ / |
| composer | ↵ send · ⇧↵ newline · ↑/↓ history · Esc stop · Tab/Backspace on pills | same | same |
| composer create / plan approve | ⌘↵ | Ctrl ↵ | Ctrl/⌘ ↵ |
| browser dock | F5 reload · F12 DevTools | same | same |
| terminal | Ctrl F find | same | same |
| builder (PW) | ⌘S, ⌘Z, ⇧⌘Z, Delete | Ctrl S, Ctrl Z, Ctrl Shift Z, Delete | same |

The palette board shows "Workflows Ctrl 4". That is today's menu numbering. The new numbering follows `NAV_DESTINATIONS`, so Workflows is 5.

`shortcuts.show` needs a Shortcuts help sheet: an overlay listing `SHORTCUTS` for the current host, built in P5. Help ▸ Keyboard Shortcuts is dead today (§5).

---

## 5. Navigation and desktop entry points

### 5.1 Native menu (`apps/desktop/src/main/menu.ts`)

| Menu item (today) | Sends | After the redesign |
|---|---|---|
| App ▸ Settings… (⌘,) / File ▸ Settings (Ctrl ,) | `nav('/settings')` | Unchanged URL; opens the modal over the current page |
| Server ▸ This Computer / remote connections / Add Server… / Forget Server | `backend-switcher.ts` | Kept. The same list feeds the sidebar Servers popover through a new IPC (G-03) |
| File ▸ New Chat (CmdOrCtrl+N) | `new-chat` → today `navigate('/chats')` (`hooks/useDesktopIntegration.ts`) | Opens the New chat dialog over the current page |
| File ▸ New Workflow (⇧⌘N) | `new-workflow` → `/workflows/new` | Unchanged (PW page later) |
| File ▸ New Project / New Automation | `new-project` / `new-automation` | `/projects/new`, `/automations/new` |
| File ▸ Open Recent | `nav(route)` | Kept |
| File ▸ Reload Scripts | `nav('/scripts')` + `reload-scripts` | The `generatorai:reload-scripts` window event **has no listener today**. P3 wires the command to `useReloadScripts()` |
| Edit ▸ Find / Find Next / Find Previous | `find-in-page` / `find-next` / `find-previous` | FindBar (restyled P5) |
| View ▸ Command Palette (CmdOrCtrl+K) | `command-palette` | New palette (P5) |
| View ▸ Dashboard, Projects, Chats, Workflows, Scripts, Automations (`sectionAccelerator`) | `nav(route)` | Generated from `NAV_DESTINATIONS` + `SHORTCUTS`: **Home**, Chats, Projects, **Agents (missing today)**, Workflows, Automations, Scripts |
| View ▸ Back / Forward | history | Kept; the Windows strip back/forward buttons call the same history API |
| View ▸ Toggle Sidebar (CmdOrCtrl+B) / Toggle Right Panel (CmdOrCtrl+Alt+B) | `toggle-sidebar` / `toggle-right-pane` | Sidebar collapse / dock toggle |
| View ▸ Appearance (Follow System / Dark / Light) | theme IPC | A request to ThemeProvider, the single writer (D-25) |
| View ▸ Reload, Toggle Developer Tools | window | Kept |
| Help ▸ Keyboard Shortcuts (CmdOrCtrl+/) | `show-shortcuts` → `generatorai:show-shortcuts` event | **No listener today (dead).** P5 opens the Shortcuts help sheet |
| Help ▸ Documentation, Troubleshooting (Restart Server, Server Health, Open Data Folder, View Logs), Check for Updates, About | main process | Kept |

**`DesktopCommand` (`apps/desktop/src/shared/ipc.ts:185`)** after the redesign. The union is generated from `SHORTCUTS` command ids (D-24):
- `new-chat` now opens the dialog;
- add `open-settings`, `toggle-theme` and `goto:<destination>`;
- keep `new-workflow`, `new-project`, `new-automation`, `command-palette`, `find-*`, `toggle-sidebar`, `toggle-right-pane`, `show-shortcuts` (now implemented) and `reload-scripts` (now implemented);
- remove `focus-search`: no menu item sends it, and the palette is the search.

### 5.2 Deep links (`deep-link.ts`)

`generatorai://<path>` becomes the route `/<path>`. The query and hash are dropped today, which breaks `generatorai://pair?code=…` (AuthGate reads `?pair=`) and R-4's `?dock=`.

Change for P4 (G-08): keep the query string, but only these keys: `pair`, `dock`, `tab`, `kind`, `run`. Every route in §1 is valid as a deep link. Worked examples:
- `generatorai://chats/new` opens the full create page;
- `generatorai://settings/security` opens the modal over Home on a cold start;
- `generatorai://chats/<id>?dock=plan` opens the chat at its Plan tab.

### 5.3 Tray (`tray.ts`), macOS dock menu and Windows JumpList (`index.ts:398–430`)

| Surface | Today | After (board DesktopMac) |
|---|---|---|
| Tray header | "Server: <state> (:port)" | "Server running · N agents :port". N = running chats from G-05 |
| Tray items | Open GeneratorAI, Dashboard, Chats, Workflows, Automations, Restart Server, Quit | Open GeneratorAI, New chat (⌘N: restore the window, then send `new-chat`), Go to ▸ Home, Chats, Workflows (needs-you badge from G-05), Automations, Projects, Agents, Restart server, Quit (⌘Q). Same items on Windows and Linux |
| macOS dock menu | New Chat (`/chats`), New Workflow, Dashboard | New chat (sends `new-chat`), New workflow, Home |
| Windows JumpList | Chats (`generatorai://chats`), New Workflow | Chats, New chat (`generatorai://chats/new`: argv deep links cannot open a dialog), New workflow |

### 5.4 In-app entry points to the new routes

| Entry point | Target |
|---|---|
| Sidebar Needs-you row | the chat (`?dock=` for plan or computer asks) or the run page; the row's primary action (Allow once / Approve) inline on Home only |
| Sidebar Running row | the chat or run page |
| Home "Review" / "Open" / "Approve" / "Allow once" / Stop / Retry | a route per the row entity; the actions call existing endpoints (05 §3) |
| Home "Run workflow" / "New workflow" (header) | legacy workflow picker → `/workflows/:id?run` once PW lands; `/workflows/new` |
| ProjectDetail needs-you banner "Review" | the first attention item for the project |
| Palette recents | `/chats/:id` |
| Changes tray "Review changes" | `?dock=changes` on the same chat (no navigation) |
