# GeneratorAI mobile — code audit before the iOS 27 / Android 17 overhaul

Date 2026-09-26 · branch `desktop_redesign` (HEAD `952be77`) · scope `apps/mobile` · read-only audit.
All counts come from `rg`/`wc` over `apps/mobile/{app,src}` excluding `*.generated.ts` and tests unless stated.
The design reference is the 131-board mobile canvas (`docs/redesign/boards/mobile/project/canvas.json`).

## 0. Headline findings

1. **There is no tab bar today.** `app/(tabs)/_layout.tsx:45` passes `tabBar={NO_BAR}`; the Tabs navigator only keeps four
   scenes mounted (Home, Chats, "Work", Projects). Navigation is already a left drawer (`src/navigation/shell/AppDrawer.tsx`)
   and a right "workbench" panel + sheet. The overhaul changes the *shape* of the drawer and pane, not the paradigm.
2. **Feature coverage is about half the boards.** Of 126 screen boards (the other 5 are audit/foundation boards), 60 have
   a working counterpart, 24 exist in a different shape, 42 are missing. The missing ones cluster in: workflow creation,
   builder, stage editor, run graph/loop/pane (17), automation create wizard + webhook (5), agent create/import/edit/delete
   (6), settings pages (5, incl. Widgets), system surfaces (Live Activity, shortcuts, widgets: 3), tablets (2), project
   logs/customization/skill detail (3) and the server switcher (1).
3. **The UI kit is hand-built and decent** (38 files in `src/components/ui`, 6.7 k LOC; `Button` in 96 files, `Sheet` in 40),
   but it is **not native**: headers, sheets, menus, context menus, drawer, segmented control, switches and toasts are all
   JS re-implementations. Only route sheets on iOS use a native `formSheet` (`app/_layout.tsx:480-495`), and only the side
   panels use Liquid Glass (`GlassSurface.ios.tsx`, one consumer: `ui/SidePanel.tsx:41`).
4. **Logic and UI are interleaved in screens.** 62 `useQuery` + 28 `useMutation` live directly in `app/` route files and
   49 + 47 in `src/components`; only 16 are in `src/api`. 79 hand-written `/api/...` paths in 31 files bypass the typed
   `createApiClient` of `@generatorai/client-core`. A UI rewrite must first lift data hooks out of screens.
5. **Pure models are the real asset**: ~40 `*.ts` model files (deriveTimeline 905, highlight 909, markdownModel 488,
   projectEditModel 446, agentModel 373, diffModel 329 …) with 105 vitest files / 1,099 tests. They survive as-is.
6. **Typography is off-spec for a phone.** No fonts are embedded (no `expo-font`, no `.ttf`; `assets/` holds 3 PNGs);
   `font-mono`/`fontFamily: 'JetBrainsMono'` silently falls back to the system font. `text-sm` = **12 px** is used 338× and
   `text-xs` = 11 px 195×; the boards' body is 15–17 pt. There is no `Text`/typography primitive: 684 raw `<Text>`.
7. **Theming works and is shared** (18 palettes × light/dark × 7 accents from `@generatorai/design-tokens` injected via
   NativeWind `vars()`), but it is **heavy**: `src/theme/tokens.generated.ts` is 25,966 lines / 915 KB of JS shipped in the
   bundle, and 530 icon props read `colors.*` from context, so every theme switch re-renders 135 `useTheme()` consumers.
8. **Native layer is thin and clean**: CNG (ios/android untracked, 0 files in git), 3 config plugins + 1 Babel plugin,
   1 local Expo module (Secure Enclave / StrongBox DPoP key). No widgets, Live Activities, extensions, App Intents,
   shortcuts, tiles or share targets exist — every system board is greenfield native work.
9. **Android predictive back is disabled** (`app.config.ts:145`) because RN 0.86 does not forward
   `OnBackInvokedDispatcher` to `BackHandler`; the design's Android 17 target assumes predictive back.
10. **Health**: typecheck clean; lint 0 errors / 2 warnings; tests 1,098/1,099 pass (1 timing-flaky test, passes alone).
    Stale deps: `@gorhom/bottom-sheet`, `@gorhom/portal`, `expo-application` are declared but never imported.

Corrections to earlier documents (verify-don't-trust):

| Claim | Where | Actual |
|---|---|---|
| `(tabs)` has a tab bar (task brief) | — | No bar: `app/(tabs)/_layout.tsx:28,45` |
| `tokens.generated.ts` is 14,526 lines | mobile-stack-research §0 | 25,966 lines, 915 KB, 18 themes, plus a `gaiColors` (D-40) block at `:25875` that nothing consumes |
| "`Sheet.tsx` is the only file that imports `@gorhom/*`" | mobile-stack-research §0 | No file imports it; `Sheet.tsx:7-10` only mentions it in a comment and `scripts/check-bundle.mjs:42` *forbids* it in the bundle |
| iOS drawer "pushes the content aside" | README checklist, DESIGN.md table | `AppDrawer.tsx:99` uses `presentation="overlay"` on both platforms (the `push` path in `SidePanel.tsx:105` is unused by the drawer) |
| Chat screen has a "pane strip … swipeable panes" | `app/chats/[id].tsx:1-30` header comment | Stale: the screen uses `SidePanelHost`+`WorkbenchPanel`+`WorkbenchSheet` (`:1478-1530`); `ui/Pager.tsx` (450 LOC) is used only by `ui/gallery.tsx` |
| JetBrains Mono not embedded | mobile-stack-research §0 | Confirmed; Instrument Sans is not referenced anywhere either (`NATIVE_FONT_FAMILY.sans` is `undefined`, design-tokens `tokens.ts:91`) |

---

## 1. Structure

### 1.1 Folder sizes (source files: .ts/.tsx/.mjs/.js/.swift/.kt)

| Folder | Files | LOC | Notes |
|---|---:|---:|---|
| `app/` (routes) | 42 | 12,176 | 2 layouts, 40 screens; `chats/[id].tsx` alone is 1,700 |
| `src/components/` | 246 | 42,781 | incl. 14 co-located test files (2,185 LOC); see §3 |
| `src/__tests__/` | 85 | 8,535 | node-only vitest |
| `src/theme/` | 2 (+css) | 26,159 | 25,966 of it is `tokens.generated.ts` |
| `src/terminal/` | 11 | 2,550 | + `xtermBundle.generated.ts` (33 lines, 586 KB of inlined xterm) |
| `src/auth/` | 18 | 2,376 | pairing, DPoP runtime wiring, app lock, step-up, scopes |
| `src/stream/` | 13 | 1,624 | mux stream binding, catch-up, stage live, two-phase stop |
| `src/voice/` | 9 | 1,185 | live dictation (`useAudioStream` PCM → server WS), TTS (flagged off) |
| `src/api/` | 12 | 1,128 | typed client hook, activity, models, send prompt |
| `src/navigation/` | 13 | 1,058 | drawer shell, `RouteSheet`, `StackHeader`, back fallback |
| `src/notifications/` | 6 | 841 | push registration, categories, filter, route guard |
| `src/prefs/` | 3 | 344 | interaction prefs (motion/haptics/app lock/large titles), last route |
| `src/lib/` | 2 | 296 | `base64`, `fuzzyMatch` |
| `src/native/` | 1 | 171 | JS facade of the device-key module |
| `src/transport/` | 1 | 122 | endpoint candidate plan (loopback → LAN → relay) |
| `src/settings/` | 1 | 108 | `audioModel.ts` |
| `src/storage/` | 1 | 57 | MMKV prefs |
| `src/crypto/` | 2 | 40 | installs `react-native-quick-crypto` as WebCrypto (+ `.web.ts`) |
| `modules/` | 2 | 516 | `generatorai-device-key` (Swift 259 + Kotlin 257) |
| `plugins/` | 8 | 380 | 3 config plugins, 1 Babel plugin, pure helpers |
| `scripts/` | 2 (+2 .sh) | 249 | `check-bundle.mjs`, `build-terminal-bundle.mjs`, `ios-sim-*.sh` |
| `e2e/` | 21 | 1,091 | Playwright on the Expo web preview + one adb script |

There is no `src/services`, `src/hooks` or `src/store(s)` folder: hooks and stores are scattered by domain.

### 1.2 Biggest hand-written files

| LOC | File | Kind |
|---:|---|---|
| 1,700 | `app/chats/[id].tsx` | screen (9 `useState`, 4 `useEffect`, 23 `useMemo/useCallback`) |
| 1,335 | `src/components/chat/NewChatSheet.tsx` | sheet |
| 1,129 | `src/terminal/TerminalView.tsx` | xterm WebView + PTY socket |
| 1,104 | `src/components/chat/Composer.tsx` | composer (keeps a "v1 prop set" compat path, `:15-17,258-356`) |
| 909 | `src/components/markdown/highlight.ts` | pure syntax highlighter |
| 905 | `src/components/chat/timeline/deriveTimeline.ts` | pure (a 875-line twin lives in `apps/web/src/components/agent/deriveTimeline.ts`) |
| 840 | `app/settings/security.tsx` | screen |
| 834 | `src/components/chat/timeline/TimelineRow.tsx` | transcript rows |
| 754 | `src/components/chat/composer/useComposerController.ts` | hook |
| 643 | `src/components/ui/gallery.tsx` | dev catalogue (no Storybook on mobile) |
| 633 | `src/components/ui/Sheet.tsx` | custom sheet |
| 617 | `app/(tabs)/chats.tsx` | screen |

### 1.3 Shell and IA today vs the design

| | Code today | Design (MSidebar, MPaneOpen, MTablet*) |
|---|---|---|
| Top level | `Tabs` navigator, no bar (`(tabs)/_layout.tsx:44-60`); 4 scenes; `runs` scene renders Workflows/Scripts/Automations by `?segment=`, `projects` renders Projects/Agents (`shell/sections.ts:35-43`) | Left drawer = desktop sidebar |
| Drawer | `AppDrawerHost` wraps the whole app (`app/_layout.tsx:530`), overlay `SidePanelHost` (`AppDrawer.tsx:99`), glass on iOS 26+; search, 7 destinations, host status, approvals, Settings; opens only on the 4 roots (`sections.ts:86`) | Adds server switcher, search field, Needs-you + Running lists, connection footer |
| Order | Home, Projects, Chats, Agents, Workflows, Scripts, Automations (`sections.ts:35-43`) | Home, Chats, Projects, Agents, Workflows, Automations, Scripts |
| Right pane | Workbench: index panel from the right (`WorkbenchPanel`), each tool raised as a bottom sheet with a chip strip (`WorkbenchSheet`); 8 tools incl. **Session** (`workbench/workbenchModel.ts:16-24`) | Right pane with 7 tabs (no Session → the turn sheet); run pane Output/Files/Hooks/Variables/Changes/Terminal/Browser |
| Tablet | Content centred at 720 pt (`ui/windowInsets.tsx:50`, `ui/Screen.tsx:53`, `ui/Sheet.tsx:452`); split diff ≥ 700 dp (`changes/diffModel.ts:265`). `TWO_PANE_MIN_WIDTH = 768` is exported by tokens (`tokens.generated.ts:25966`) and **used nowhere** | Persistent sidebar + chat + pane (iPad, Android tablet) |

Note: expo-router 57 already ships `native-tabs` and `split-view` (in `node_modules/expo-router/build`), and depends on
`@expo/ui`, `expo-symbols`, `expo-glass-effect` — the pieces a native drawer/split IA would use are installed transitively.

---

## 2. Screen inventory

### 2.1 Routes (40 screens)

Presentation is set centrally in `app/_layout.tsx:315-455`. Default: JS `StackHeader` (`:320`), `slide_from_right` on
Android (`:329`), `freezeOnBlur` (`:332`). Route sheets: iOS `formSheet` detents `[0.6, 1]`, grabber, radius 24; Android/web
`modal` + `slide_from_bottom` (`:480-495`).

| Route | File (LOC) | Presentation | What it does | Board(s) |
|---|---|---|---|---|
| `/(tabs)` Home | `(tabs)/index.tsx` (222) | tab scene | Stat tiles, needs-you/running feed (`useActivity`), `LegendList` | MHome, MHomeMore |
| `/(tabs)/chats` | `(tabs)/chats.tsx` (617) | tab scene | All/Active/Archived, search, swipe, select mode, `?new=1` → NewChatSheet | MChats |
| `/(tabs)/runs` | `(tabs)/runs.tsx` (267) | tab scene | Workflows / Scripts / Automations by segment; "+" = template only | MWorkflows, MScripts, MAutomations |
| `/(tabs)/projects` | `(tabs)/projects.tsx` (296) | tab scene | Projects / Agents by segment | MProjects, MAgents |
| `/pair` | `pair.tsx` (473) | push, no gesture | QR (`expo-camera` `CameraView`, `:315`) or code → consent → enrol | MPairing |
| `/revoked` | `revoked.tsx` (57) | push, no gesture | Device revoked → re-pair | — |
| `/` | `index.tsx` (35) | push | Hand-off to `(tabs)` | — |
| `/chats/[id]` | `chats/[id].tsx` (1,700) | push, own header | Transcript (`LegendList`), dock (changes tray, gate cards), composer, workbench | Main, MChatRunning, MChatToolsExpanded, MChatStepDetail, MChatNoAgent, MChatWorkflowRun, MPaneOpen |
| `/chats/[id]/gate/[interactionId]` | 147 | route sheet | One pending permission/question (push deep link) | (Main) |
| `/chats/[id]/plan/[planId]` | 161 | route sheet | Plan read + decide | MPanePlan |
| `/runs/[id]` | `runs/[id].tsx` (433) | push | Stage rail, decisions, retry/resume, live `run` scope | MWorkflowRun, MWorkflowRunMenu |
| `/runs/[id]/stages/[stageRunId]` | 391 | push | Stage transcript/output | MRunStageChat |
| `/workflows/[id]` | 388 | push | Runs list + stage outline (no DAG) + Start Run | MWorkflowDetail(+More) |
| `/scripts/[id]` | 320 | push | Script detail + run from profile | MScriptDetail |
| `/automations/[id]` | 484 | push | Detail, run now, history; "creation and editing stay on the desktop" (`:3-4`) | MAutomationDetail, MAutomationExecution |
| `/projects/[id]` | 568 | push | Overview / Artifacts / Settings segments | MProjectDetail, MProjectSettings |
| `/projects/[id]/pull-requests` | 162 | push | PRs across codebases | — |
| `/projects/[id]/codebases/[cid]` | 413 | push | Branch, readiness, worktrees, PRs | MCodebase |
| `…/[cid]/files`, `…/[cid]/file` | 130, 110 | push | Directory level per push; read-only file | MCodebaseFiles |
| `…/[cid]/pull-requests/[number]` | 313 | push | PR detail, checks, "Review in chat" | — |
| `/changes/[workspaceId]` (+`/file`) | 36, 29 | push | Thin wrappers over the Changes pane / one diff | MPaneChanges, MPaneDiff |
| `/terminal/[workspaceId]` | 48 | push | `TerminalTabs` behind `exec:terminal` + step-up | MPaneTerminalFull |
| `/search` | 283 | push | Local index across entities, recents in MMKV | MSearch (design: palette sheet) |
| `/approvals` | 124 | route sheet | Grouped approval queue | — (design folds into Home/notifications) |
| `/scope-request` | 220 | route sheet | Request a missing scope | MScopeRequest |
| `/settings/*` (13) | 102–840 | push, own header | index, appearance, notifications, accessibility (incl. app lock `:214`), providers, capabilities (skills + MCP + agents + prompts), extensions, source-control, audio, security (devices, `PairDeviceSheet` `:757`), tools ("Phone access"), diagnostics, about | MSettings… |

No `+not-found`, no `+html`, no nested `_layout` besides `(tabs)`.

### 2.2 Boards → code (126 screen boards; 5 overview boards are system reference)

"Exists" = the feature is implemented (visuals will change everywhere). "Different" = implemented in another shape.

| Page (boards) | Exists | Different | Missing in code |
|---|---:|---:|---|
| Home & navigation (8) | MHome, MHomeMore, MScopeRequest, MPairing | MSidebar, MSidebarChats (overlay drawer, other order, no lists/server), MSearch (pushed screen, not palette) | MServers (single paired host; `AuthProvider.tsx` holds one session) |
| Chats & composer (15) | Main, MChats, MChatRunning, MChatToolsExpanded, MChatStepDetail, MChatNoAgent, MModelPicker (`ModelSheet`), MComposerPlus, MComposerInput, MComposerVoice (`VoicePill`), MNewChat, MNewChatMore, MChatWorkflowRun | MAgentPicker, MAgentPickerCaps (agent choice lives inside `NewChatSheet`/`TurnOptionsSheet`; no picker sheet, no capability customiser) | — |
| Workspace pane (16) | MPaneChanges, MPaneDiff (`ReviewCommentsSheet`), MPaneCommit, MPaneCommitDone (`ScmFlowSheet`, `CommitBar`), MPaneFiles, MPaneFilePreview, MPaneTerminal, MPaneTerminalFull, MPaneBrowserStates, MPaneTasks, MPanePlan, MPaneComputer | MPaneOpen, MPaneTabsOverview (panel + sheet, 8 tools), MPaneBrowser (screenshot `Image`, no pointer input by design `BrowserSection.tsx:1-20`; capture exists, page comments not found), MPaneTaskDetail (inline rows only) | — |
| Workflows (28) | MWorkflows, MWorkflowDetail, MWorkflowLaunch, MWorkflowLaunchAdvanced (`StartRunSheet`), MWorkflowRun, MRunStageChat, MRunApproval | MWorkflowDetailMore (no variables/menu editing), MWorkflowNew (template picker only), MWorkflowRunMenu (controls exist, not a menu), MWorkflowLaunchPlan | MWorkflowNewBasics, MWorkflowRunPane, MRunGraph, MRunLoop, MBuilderList, MBuilderGraph, MBuilderLoop, MWorkflowAgentDraft, MWorkflowSettings, MWorkflowValidate, MStagePrompt/Model/Tools/Output/Policy/PolicyMore/Hooks (7) — deliberate: "a phone cannot host the DAG builder" (`(tabs)/runs.tsx:15,221`) |
| Automations & scripts (10) | MAutomations, MAutomationDetail, MAutomationExecution (`ExecutionSheet`), MScripts, MScriptDetail | — | MAutomationWebhook, MAutomationCreate1–4 (deliberate, `automations/[id].tsx:3-4`) |
| Projects (10) | MProjects, MProjectCreate, MProjectDetail, MAddCodebase, MProjectSettings, MCodebase, MCodebaseFiles | — | MCodebaseLogs, MProjectCustomization, MSkillDetail |
| Agents (9) | — | MAgents (segment of Projects scene), MAgentDetail, MAgentDetailOrch (`work/AgentDetailSheet.tsx`, lightweight edit only) | MAgentNew, MAgentImport, MAgentEdit1–3, MAgentDelete |
| Settings (23) | MSettings, MSettingsMore, MSetAppearance, MSetProviders, MSetSourceControl, MSetAudio, MSetExtensions, MSetSecurity, MSetSecurityMore, MSetPairDevice, MSetDiagnostics, MSetNotifications | MSetAgents, MSetSkills, MSetMcp, MSetTemplates (all folded into `capabilities.tsx`), MSetBrowserTerminal (`tools.tsx`), MSetAppLock (inside `accessibility.tsx:214`) | MSetGeneral, MSetMcpAdd, MSetComputerUse, MSetStorage, MSetWidgets |
| System & tablets (7) | — | MNotifications (Allow/Deny actions with `isAuthenticationRequired`, `notificationCategories.ts:51-58`; no quick reply, no time-sensitive level), MThemesPhone (palettes exist; type/fonts do not) | MLiveActivity, MShortcuts, MWidgets, MTabletIOS, MTabletAndroid |
| **Total (126)** | **60** | **24** | **42** (plus partial gaps inside "different") |

In code but not in design: `/revoked`, `/approvals`, `/projects/[id]/pull-requests`, PR detail, gate and plan route sheets,
`HistorySheet` (prompt history), `ConflictSheet`, `ConnectGitHubSheet`, `CheckpointsSheet`, the workbench **Session** tool,
chat fork/branching (`api/useChatBranching.ts`), `settings/about.tsx`, `settings/accessibility.tsx` as a page.

---

## 3. Component layer (`src/components`, 246 files)

| Folder | Files | LOC | Character |
|---|---:|---:|---|
| `ui/` | 38 | 6,728 | kit: primitives, composites, pure math (`sheetMath`, `pagerMath`, `sidePanelMath`, `keyboardMath`, `segmentLayout`), `motion`, `haptics`, `accessibility`, `gallery` |
| `chat/` root | 22 | 4,984 | Composer (1,104), NewChatSheet (1,335), ModelSheet, gate cards, pure `toolPresentation`, `rewindOptions`, `permissionPreview`, `composerMenu`, `gateActions` |
| `chat/composer/` | 20 | 3,546 | `useComposerController` (754) + 10 pure models (slash, sources, turn options, attachments, captures, history) |
| `chat/timeline/` | 11 | 3,019 | `deriveTimeline` (905), `TimelineRow` (834), `RowFrame`, `chatMessageToBlocks`, `mergeScmRows`, `selectChatView` |
| `work/` | 19 | 3,547 | Agent/StartRun/Trigger/Execution/Template sheets; 9 pure models |
| `markdown/` | 8 | 2,744 | `marked` lexer → `markdownModel` → RN tree; custom `highlight.ts` |
| `changes/` | 14 | 2,189 | `FileDiff`, `ChangesList`, `CommitBar`, `diffModel`, `keptModel` |
| `review/` | 11 | 2,169 | Plan, review comments, checkpoints sheets + models |
| `chat/workbench/` | 8 | 2,046 | Changes/Files/Browser/Tasks/Terminal/Plan sections |
| `projects/` | 9 | 1,780 | `projectEditModel` (446), settings form, artifacts, sheets |
| `scm/` | 11 | 1,632 | commit→push→PR flow, GitHub device login, PR model |
| `runs/` | 15 | 1,290 | run rows, stage timeline, `statusStyle`, `runModel` |
| `chat/panes/` | 9 | 1,122 | `ComputerPane`, `ChangesTray`, inspector |
| `workbench/` | 6 | 1,066 | panel, sheet, `workbenchModel`, `toolIcons` |
| `home/` | 9 | 878 | stat tiles, operation/decision cards |
| `devices/` | 6 | 784 | pair/edit-scopes sheets, `qrMatrix`, `QrCode` (SVG) |
| `common/` | 8 | 483 | `ConnectionStrip`, `groupByDay`, `entityIcons`, `States.tsx` shim |
| `search/`, `brand/`, `diff/` | 5 | 589 | search row/model, `BrandMark`, `VendorIcons`, one diff wrapper |

### 3.1 How each pattern is built today

| Pattern | Implementation | Use |
|---|---|---|
| Button | `ui/Button.tsx:52` variants primary/secondary/ghost/danger × sm/md/lg; `IconButton` `:117`; `Fab` `:183` (unused) — all on `ui/Touchable.tsx` (Pressable + haptic intent + press scale; ripple on Android `:108`) | Button 96 files, IconButton 47, Touchable 60 |
| Rows | `ui/ListItem.tsx` (64 pt entity row, status avatar) and `ui/ListRow.tsx` (56 pt settings row with chevron/toggle) + `ListGroup`; `runs/RunRow.tsx` hand-rolls a third | ListRow 25, ListItem 9 (outside `ui/`) |
| Lists | `@legendapp/list` 13 uses / 9 files (chat transcript, 4 tab scenes, diff, changes, files, pull-to-refresh); `ScrollView` 46 / 29 files; `.map(` 323; `FlatList` 2 (`AgentConsole`, stage screen), `SectionList` 1 (`search.tsx`) | — |
| Sheets | `ui/Sheet.tsx` (633): RN `Modal` + Reanimated + RNGH, detents in `sheetMath.ts`, re-applies theme vars inside the Modal subtree; 26 `*Sheet.tsx` build on it. iOS route sheets use native `formSheet` via `navigation/RouteSheet.tsx:43` | Sheet 40 files |
| Menus | `ui/ContextMenu.tsx` (JS long-press menu rendered as the custom `ActionSheet`), `ActionSheet`/`ConfirmSheet`; 27 `onLongPress` sites; no `UIMenu`/`zeego`/native popup | ActionSheet 14, ConfirmSheet 17, ContextMenu 3 |
| Headers | `ui/Screen.tsx` `ScreenHeader` large/compact with a UI-thread large-title collapse; no native header / `headerLargeTitle` / search bar anywhere; stack header is the JS `StackHeader` because the native Android one double-paid the status bar (`navigation/StackHeader.tsx:7`) | Screen 41 files |
| Badges / status | `ui/primitives.tsx` `Badge` `:101`, `StatusDot` `:133`; `ui/Chip.tsx` `Chip`/`StaticChip`; `runs/StatusGlyph.tsx`. **13+ independent status→tone maps** (`runs/statusStyle.ts:38`, `runs/tone.ts:6`, `home/OperationCard.tsx:50`, `work/cards.tsx:25`, `work/projectModel.ts:53,166`, `work/automationModel.ts:163`, `scm/prModel.ts:29,78,134`, `scm/scmModel.ts:196`, `projects/projectEditModel.ts:254`, `changes/statusStyle.ts:16`, local maps in `review/PlanSheet.tsx:43` and `review/ReviewCommentsSheet.tsx:64`) | Badge 31, Chip 18 |
| Inputs | `ui/Form.tsx` `Field` `:53`, `SearchField` `:103`; composer field inline in `Composer.tsx`; 9 raw `<TextInput>` | Field 20, SearchField 8 |
| Switch | `ui/Form.tsx:22` wraps RN `Switch` (`thumbColor="#ffffff"`), also a `toggle` prop on rows | 6 + row props |
| Segmented | `ui/SegmentedControl.tsx:58` (JS, bordered track + `primary-emphasis` pill, swipe-to-step) — not `UISegmentedControl`/M3 segmented button | 9 files |
| Pager / tabs | `ui/Pager.tsx` — **dead in product** (only `gallery.tsx`) | 0 |
| Toasts | `ui/Toast.tsx` provider + `useToast` | 54 files |
| Empty/loading/error | `ui/States.tsx` (`EmptyState` 39, `ErrorState` 43, `LoadingState` 18, `LockedState` 8, `Spinner` 28), `ui/Skeleton.tsx`; 16 files still hand-roll empty states; `common/States.tsx` is a re-export shim | — |
| Dialogs | `Alert.alert` 14 call sites (4 in components, rest in routes) vs `ConfirmSheet` | — |
| Icons | `lucide-react-native` 0.460 in 124 files, 168 distinct icons; 4 separate icon maps (`workbench/toolIcons.tsx:15`, `common/entityIcons.ts:24`, `brand/VendorIcons.tsx:82`, `chat/timeline/TimelineRow.tsx:91,104`); icons coloured by `color={colors.x}` 530× | — |
| Side panels | `ui/SidePanel.tsx` (301): edge-swipe panel, `push` (iOS left) or `overlay`, glass on iOS, scrim, `BackHandler` | drawer + workbench |

Dead or near-dead kit parts: `Pager`/`PagerIndicator`/`pagerMath` (0 product uses), `Fab` (0), `Surface` (0),
`StatusAvatar` (0 outside `ui/`), `SwipeableRow` (1), `ProgressRing` (1). The `@/` path alias exists in `tsconfig.json` but
all imports are relative.

**Kit seed candidates:** the pure pieces (`sheetMath`, `keyboardMath`, `sidePanelMath`, `segmentLayout`, `motion`,
`accessibility`, `haptics`, `windowInsets`, `keyboard.ts`), and as behaviour references `Sheet`, `SidePanel`, `Touchable`,
`States`, `Toast`. Visual components (Button, Chip, rows, headers, segmented) will be redrawn to the new spec; menus,
headers, segmented controls and switches should move to native (`@expo/ui`, native stack headers, native menus).

---

## 4. Styling and theming

### 4.1 Usage counts

| Measure | Count |
|---|---:|
| `className=` | 1,695 in 151 files |
| `StyleSheet.create` | 4 (`MarkdownImage`, `WorkbenchSheet`, `SidePanel`, `Sheet`) |
| `style={{…}}` inline objects | 135 (204 `style={` total) |
| Hex literals | 17 (terminal fallback theme `terminalHtml.ts:96-97,218-219`, QR black/white, brand colours, `#ffffff` switch thumbs `Form.tsx:47`/`ListRow.tsx:113`, image lightbox, scrim `#000` `SidePanel.tsx:260`) |
| `rgb(a)(` | 13 (shadows, lightbox, ripple `Touchable.tsx:109`) |
| Arbitrary values `x-[…]` | 33: `ml-[46px]` 10, `text-[10px]` 9, `w-[18px]` 3, `text-[9px]` 1, `h-[34px]` 1, … |
| Palette classes (`bg-blue-500`, `text-white`) | 0 |
| `dark:` variants | 0 (theme switches through variables only) |
| `colors.x` / `colors['x']` imperative reads | 398 / 389 |

Colour discipline is good; geometry and type are where drift lives.

### 4.2 Tailwind config (`tailwind.config.js`, Tailwind 3.4, NativeWind 4.2)

- Requires `./src/theme/tokens.generated.ts` at build time (`:5`) for `tailwindColors`, `radius`, `fontSize`, `spacing`, `lineHeight`.
- `darkMode: 'class'` (`:15`) so the in-app appearance picker can override the OS.
- Colours: the ~60 shadcn-style tokens (`background`, `card`, `primary`, `sidebar-*`, `file-icon-*`, `chart-*`) plus mobile
  aliases `control`, `control-strong`, `control-foreground` (`:25-27`). The new `gai-*` design vocabulary (32 vars, D-40) is
  emitted into the token file but **not mapped** in Tailwind and **used nowhere** (0 hits).
- Radii: tokens 6/8/10 plus mobile-only `2xl` 12, `3xl` 16, `4xl` 24 (`:32-40`).
- Type scale: xs 11, sm 12, base 14, md 15, lg 17, xl 20, 2xl 24, 3xl 30 (px). Usage: `text-sm` 338, `text-xs` 195,
  `text-md` 66, `text-lg` 26, `text-base` 5. The boards (see `mobile-design-analysis.md` §1.2) use 17 pt body / 16 transcript
  on iOS and 16 sp on Android, weights 400/500/600 only; code uses `font-bold` 14×.
- `fontFamily.mono = ['JetBrainsMono', …]` (`:54`) — not embedded.

### 4.3 Theme runtime

- `src/theme/ThemeProvider.tsx`: three axes (mode system/light/dark, 18 palettes, accent) read synchronously from MMKV
  before first paint (`:76-96`); `RNAppearance.setColorScheme` keeps native chrome in step (`:136-141`); resolves one variable
  bag (`:156-159`) and exposes `style: vars(bag)`, `colors` (literal values) and `terminal` (xterm theme) (`:171-186`).
- Root applies the bag once (`app/_layout.tsx:97`); `Sheet.tsx` re-applies it inside its `Modal` because Modal is a separate
  host subtree. Any new native surface (formSheet, menus, `@expo/ui` hosts) needs literal colours, not class names.
- `tokens.generated.ts`: 25,966 lines / 915 KB; `themeVars` (18 × 2 × 7 bags × ~94 vars), `terminalThemes`, `themeMeta`,
  `tailwindColors`, `gaiColors`, `radius`, `fontSize`, `lineHeight`, `spacing`, `motion`, `TWO_PANE_MIN_WIDTH`. Emitted by
  `packages/design-tokens/src/emit/native.ts`. All of it ships in the JS bundle because ThemeProvider imports `themeVars`.
- Native chrome colours: status bar `StatusBar style` from appearance (`app/_layout.tsx:98`); root view background
  `SystemUI.setBackgroundColorAsync(colors.background)` (`:78`); splash is static `#0d1117` + `splash-mark.png`
  (`app.config.ts:166-172`) — a light-mode user gets a dark splash; Android nav bar is transparent edge-to-edge with no
  `expo-navigation-bar` control; xterm gets `useTheme().terminal` (`TerminalView.tsx:180`) with a hex fallback
  (`terminalHtml.ts:96`); Skia is not used (removed; `check-bundle.mjs:43` forbids it).
- Dynamic Type: font scaling is on everywhere (0 `allowFontScaling`), capped selectively with `maxFontSizeMultiplier` (85
  sites) using `MAX_SCALE.chrome = 1.4` / `control = 1.8` (`ui/accessibility.ts:31-36`); `useFontScale` + `scaled()` for
  computed geometry (`:100-113`); text size is deliberately not an app setting (`prefs/preferences.tsx` header).
  There is no semantic text style (iOS text styles / M3 type roles), so the new per-platform ramp needs a new primitive.
- Reduce Motion (OS + app pref) and Reduce Transparency (`GlassSurface.ios.tsx:10-21`) are honoured.

---

## 5. Platform-specific code

| Item | Evidence |
|---|---|
| Platform files | 4: `crypto/installCrypto.web.ts`, `auth/secureItemStore.web.ts`, `api/sendChatPrompt.native.ts`, `ui/GlassSurface.ios.tsx` (no `.android.*`) |
| `Platform.OS` | 36 uses in 21 files, 0 `Platform.select`, 0 `Platform.Version`. Most are web-preview guards (push, lock, step-up, share). Real platform branches: stack animation (`_layout.tsx:329`), route-sheet presentation (`_layout.tsx:481`, `RouteSheet.tsx:43`), side-panel push/glass (`SidePanel.tsx:50,105,223,248`), ripple (`Touchable.tsx:108`), 44/48 min target (`accessibility.ts:128`), Android edge-swipe gutter (`Pager.tsx:268`), sheet back handler (`Sheet.tsx:261`) |
| Glass | `expo-glass-effect` only in `GlassSurface.ios.tsx`, consumed only by `SidePanel` (drawer + workbench panel); falls back to `colors.raised` when unavailable or Reduce Transparency is on. No glass on headers, composer, sheets, tab/tool bars |
| Haptics | `ui/haptics.ts` 7 verbs (comment says five): error 33, success 24, warn 22, tap 20, commit 19, select 18, threshold 3; user switch in prefs |
| Biometrics | `expo-local-authentication` in `auth/AppLock.tsx:28` (app lock + privacy overlay), `auth/stepUp.ts:49` (step-up for terminal, admin, approvals), `settings/accessibility.tsx:17` |
| Keyboard | `react-native-keyboard-controller`: `KeyboardProvider` (`_layout.tsx:503`), `useReanimatedKeyboardAnimation` (`ui/keyboard.ts:31`), `KeyboardController` in Composer; `KeyboardSticky`; RN `Keyboard`/`KeyboardAvoidingView` 6 sites; Android `softwareKeyboardLayoutMode: 'resize'` (`app.config.ts:149`) |
| Safe areas | `useSafeAreaInsets` in 18 files, `useWindowInsets` 5, 0 `SafeAreaView`; `ConnectionStripHost` pays left/right insets once |
| Edge-to-edge | Enforced by SDK 57 (`gradle.properties` `edgeToEdgeEnabled=true`); handled in keyboard math (`ui/keyboardMath.ts:26`) |
| Predictive back | **Off**: `predictiveBackGestureEnabled: false` → `enableOnBackInvokedCallback="false"` (`app.config.ts:138-145`); JS `BackHandler` in 4 places (`_layout.tsx:287`, `Sheet.tsx:262`, `SidePanel.tsx:134`, `ChangesSection.tsx:164`) |
| Orientation | `orientation: 'default'` (`app.config.ts:77`), all four on iPhone and iPad; no `expo-screen-orientation` |
| Tablet / iPad | `supportsTablet: true`, `UIRequiresFullScreen=false` (Split View/Slide Over allowed), `UIApplicationSupportsMultipleScenes=false`; layout only centres a 720 pt column — no split view, no persistent sidebar, no keyboard shortcuts (`UIKeyCommand`), no pointer/hover work |
| Status/nav bar | `expo-status-bar` + `expo-system-ui`; no `expo-navigation-bar` |

---

## 6. Native layer

- **CNG.** `ios/` and `android/` are generated and ignored (`apps/mobile/.gitignore:12-14`; `git ls-files` → 0). Local
  copies on disk are stale build artefacts (e.g. duplicated keys in `android/gradle.properties:31,65`).
- **Targets:** iOS 16.4 deployment target (Podfile default), one Xcode target (`GeneratorAI`, application); Android min 24 /
  target 36 / compile 36 (RN 0.86 version catalog), NDK 27.1, Kotlin 2.1.20, Hermes, New Architecture (unconditional).
- **`app.config.ts` (249 lines):** name/slug `GeneratorAI`/`generatorai`; scheme `generatorai`; bundle/package
  `dev.generatorai.app`; `userInterfaceStyle: 'automatic'`; iOS icon `icon-ios.png` (opaque, **no dark/tinted variants**),
  Android adaptive icon with **no monochrome layer**; Info.plist: camera/mic/Face ID/local-network strings as single
  constants shared by all plugins, `NSAllowsLocalNetworking`, `ITSAppUsesNonExemptEncryption: true`,
  `UIBackgroundModes: ['remote-notification']` only; Android permissions CAMERA, RECORD_AUDIO, USE_BIOMETRIC,
  POST_NOTIFICATIONS. Plugins: expo-router, splash, secure-store (Android backup rules, Face ID), camera, image-picker,
  local-authentication, notifications (`mode` from `APS_ENVIRONMENT`), web-browser, audio (no background playback),
  `withCleartextTraffic`, `withShadowNodeRaceFix`, `withSceneLifecycle`. `experiments.typedRoutes` only — **no React
  Compiler**. **No `expo-updates`, no associated domains / universal links, no App Groups, no dev-client dependency.**
- **Plugins:**

| Plugin | Does | Why |
|---|---|---|
| `withCleartextTraffic.js` (+ pure `androidManifestCleartext.js`) | `android:usesCleartextTraffic="true"` | LAN pairing over `http://<lan-ip>`; SDK 57 removed the config key; privacy of LAN endpoints enforced in `PairingEndpointSchema` |
| `withShadowNodeRaceFix.js` | Patches `MainApplication.kt` to force `fixFindShadowNodeByTagRaceCondition` before `ReactHost` starts; throws if the anchor drifts | RN 0.86.2 Fabric race |
| `withSceneLifecycle.js` (207) | Adds `UIApplicationSceneManifest`, rewrites `AppDelegate.swift`, generates `SceneDelegate.swift` forwarding URLs/activities/lifecycle | iOS 27 refuses non-scene apps (DESIGN.md "Defects found on iOS 27") |
| `babel-plugin-lucide-icons.js` | Rewrites lucide barrel imports to per-icon modules | barrel = 1.29 MB source; will need rework for lucide 1.x paths |

- **`modules/generatorai-device-key`** (Expo module, `expo-module.config.json` apple + android): API `isSupported`,
  `generate(alias)`, `exists`, `load`, `backing`, `sign(alias, dataBase64)` → raw 64-byte `r||s`, `remove`
  (`src/native/deviceKeyModule.ts:59-70`, degrades to a software key when unlinked `:72`). iOS: Secure Enclave P-256,
  `AfterFirstUnlockThisDeviceOnly` + `.privateKeyUsage`, no biometric binding (lock-screen Allow must still sign). Android:
  AndroidKeyStore P-256, StrongBox first, honest `securityLevel` readback, no user-auth requirement. Both files still carry
  an "UNCOMPILED" header (`GeneratorAIDeviceKeyModule.swift:4`) although DESIGN.md records an iOS 27 simulator release build.
- **`eas.json`:** development (dev client, APK, simulator, APS development), preview (internal APK, APS production,
  channel preview), production (autoIncrement, APS production); `appVersionSource: remote`. Channels are set but
  `expo-updates` is absent, so they do nothing.
- **Extensions / system surfaces: none.** No WidgetKit, ActivityKit, notification service/content extension, share
  extension, App Intents, `UIApplicationShortcutItems`, `shortcuts.xml`, TileService, Glance, Watch/Wear. Every
  MLiveActivity / MWidgets / MShortcuts / MSetWidgets board needs new native targets (config plugins that add targets under
  CNG, App Group storage, a bridge to start/update/end activities and reload widgets, push-to-start tokens).

---

## 7. Navigation and state

- **Provider stack** (`app/_layout.tsx:499-552`): GestureHandlerRoot → SafeArea → KeyboardProvider → Theme → Preferences →
  ThemedShell → QueryClient → Auth → MuxStream → Toast → ContextMenu → AppLockGate → AuthLifecycle → AppDrawerHost →
  ConnectionStripHost → ErrorBoundary → RootStack.
- **Auth gating:** `AuthGate` via `Stack screenLayout` (`:316`) wraps every screen; public routes `/pair`, `/revoked`; locked
  keychain at cold start → "Unlock to continue" (`auth/restoreState.ts`), never `/pair`. Back without history uses
  `navigation/backFallback.ts` (`_layout.tsx:287-294`).
- **Deep links:** scheme `generatorai://` (pair, chats, runs, gates); notification responses routed via
  `notifications/routeGuard.ts`; last route restored from MMKV (`prefs/lastRoute.ts`). No universal links.
- **Pairing / servers:** one paired host. `AuthProvider` (416) wires `AuthenticatedClientRuntime` (client-runtime: DPoP,
  refresh, tickets) → `EndpointSupervisor` → `DirectTransport`/`RelayTransport` (client-transport);
  `transport/endpointPlan.ts` orders loopback → LAN → relay. Sessions in SecureStore (`auth/stores.ts`), key in the native
  module. A server switcher (MServers) needs multi-session storage and a runtime per host — new work in auth, not UI.
- **Zustand stores (4):** `stream/streamStore.ts:215` (shared reducer from client-core + LRU bounds), `stream/streamHealth.ts:47`,
  `navigation/shell/shellStore.ts:18`, `notifications/pushStatus.ts:40`. Other state: MMKV prefs, draft store, React context.
- **TanStack Query:** `useQuery` 117, `useMutation` 86, `useQueryClient` 47, `useQueries` 3, `useInfiniteQuery` 0 (the chat
  pages by growing a limit, `chats/[id].tsx` "Load earlier messages"). Keys: `queryKeys.*` 142 (client-core
  `api/client.ts:881`), `scmKeys` 17, `projectKeys` 9, ad-hoc arrays 55. Client config (`_layout.tsx:54-64`): `retry: 2`,
  `staleTime: 30s`, `refetchOnWindowFocus: true` — **but no `focusManager`/`onlineManager` binding** (0 hits for
  `focusManager`, `onlineManager`, `NetInfo`), so focus refetch is inert on native and there is no offline detection; no
  query persistence, so every cold start is network-bound. AppState is handled per feature in 5 places.
- **Streams:** one multiplexed connection (`stream/MuxStreamProvider.tsx`, `muxTransport.ts`) over `expo/fetch`
  (`expoStreamFetch.ts` — RN `fetch` has no readable body); `useChatStream` → client-core `StreamEventRouter` → effects →
  store + query invalidation; `useGlobalStream` for lists; `useRunStream`, `useStageLive`; `useTurnCatchUp` replays an
  unfinished turn; `useTwoPhaseStop` binds client-core's stop controller; `streamHealth` drives `ConnectionStrip`.
- **Shared vs duplicated:** `@generatorai/client-core` imported in 120 files, `shared` 35, `client-runtime` 5,
  `client-transport` 4, `design-tokens` 2. Duplicated with web: `deriveTimeline` (mobile 905 / web 875 lines), markdown
  (mobile `marked` model vs web react-markdown), status/tone vocabularies, tool presentation, chat naming, fuzzy match.
  79 hand-written endpoint paths in 31 files (e.g. `/scm/` in 18 files, `/review` 13, `/browser/` 7, `/devices` 6,
  `/voice` 4) plus `requestJson` 47 calls in 5 files.

---

## 8. Heavy surfaces

| Surface | Today | Notes for the overhaul |
|---|---|---|
| Transcript | `LegendList` with `alignItemsAtEnd`, `initialScrollAtEnd`, `maintainScrollAtEnd`, `maintainVisibleContentPosition`, `recycleItems={false}` (`chats/[id].tsx:1229-1260`); rows `memo`ised (`TimelineRow.tsx:141`, `UserMessageRow.tsx:34`); the screen subscribes via `selectChatView` + `useShallow` | Behaviour tuned against many device bugs (DESIGN.md) — keep the list contract, redraw rows |
| Markdown | `marked` 15 lexer → `markdownModel.ts` → RN `Text`/`View` tree (`Markdown.tsx`), GFM incl. tables/tasks/images; `linkPolicy.ts`; streaming closes open emphasis | No selection/copy of ranges, no math; keep model, restyle |
| Code / syntax | `markdown/highlight.ts` own scanner, bounded 400 lines / 40 KB, not while streaming; `CodeBlock` wrap toggle + copy | Colours from `syntaxColors.ts` → must follow new tokens |
| Tool blocks | `deriveTimeline` folds work into "Ran 2 commands, read 3 files"; `TimelineRow` icon maps; `InlineDiff`; `ScmResultRow` | Twin of web logic — candidate for client-core |
| Composer | `Composer.tsx` (1,104) + `useComposerController` (754): attachments (image picker, files, captures), `/` and `@` strip, model/effort/plan chips, options, context gauge, voice pill, morphing send/stop, long-press send = plan | Biggest UI rewrite; drop the v1 prop path |
| Voice | `voice/useVoiceInput.ts`: `expo-audio` `useAudioStream` PCM → server WS, live partials, 10 s/30 s timeouts; TTS behind `READ_ALOUD_ENABLED = false` | UI only (MComposerVoice) |
| Terminal | xterm 6 UMD inlined by `scripts/build-terminal-bundle.mjs` into `xtermBundle.generated.ts`, loaded lazily into a sandboxed `react-native-webview` (no network/file access); RN owns the PTY WebSocket with ACK flow control; unmounts when inactive; key bar esc/ctrl/alt/find/paste (`TerminalView.tsx:131-141`), tabs (`TerminalTabs.tsx`) | Needs `data-gai-keys`-style ownership of gestures; theme via `terminal` bag |
| Diff / changes | `changes/diffModel.ts` parse → `FileDiff` virtualised, unified or split ≥ 700 dp; Keep / Keep all / Undo all, kept view, discard; `CommitBar` → `ScmFlowSheet` commit → push → PR; review comments sheet | Logic reusable; MPaneDiff inline comment exists as a sheet |
| File preview | Workbench `FilesSection` tree (`fileTree.ts`), recent files, `CodeBlock` or virtualised plain lines past the highlight budget; codebase files are one level per pushed screen | — |
| Browser | Screenshot `Image` + address bar, back/forward/reload, share-with-agent, send to chat; **no pointer forwarding by design** (`BrowserSection.tsx:1-20`) | MPaneBrowser "comment" not implemented |
| Computer use | `ComputerPane.tsx`: consent card (step-up to allow), latest frame `Image`, audit trail, grants; read-only | matches MPaneComputer scope |
| Workflow run / graph | Stage rail with in-place live transcript (`StageTimeline`, `StageTranscriptInline`, `useStageLive`); **no graph** — `react-native-svg` is used only for QR, `ProgressRing`, vendor icons | MRunGraph / MBuilderGraph need a graph renderer (SVG or Skia) |
| Notifications | `expo-notifications`; Android channels approval/failed/completed (`push.ts:66-92`); iOS category with Allow/Deny, `opensAppToForeground:false`, `isAuthenticationRequired:true`; foreground filter + server mute; needs `EAS_PROJECT_ID` | No quick reply, no interruption levels, no grouping/threads |
| QR pairing | `expo-camera` `CameraView` barcode `qr` (`pair.tsx:315-317`), manual code, consent grouped by scope; AppState retry for iOS Local Network prompt | — |

---

## 9. Quality

### 9.1 Checks run (2026-09-26, machine under load from another session)

| Command | Result |
|---|---|
| `pnpm --filter @generatorai/mobile typecheck` | exit 0 |
| `pnpm --filter @generatorai/mobile lint` | exit 0 — 0 errors, 2 warnings (`app/scope-request.tsx:35` unused `SectionHeader`; `src/auth/secureItemStore.web.ts:39` console) |
| `pnpm --filter @generatorai/mobile test` | exit 1 — 105 files, **1,098 passed / 1 failed**: `base64.test.ts:60` "handles a large buffer" timed out at 5 s; passes alone in 3.7 s (`npx vitest run src/__tests__/base64.test.ts`: 22/22). Timing-flaky under load |

### 9.2 Tests

- vitest, `environment: 'node'`, `include: ['src/**/*.test.ts']` (`vitest.config.ts:10-12`); **no `.test.tsx`, no component
  rendering tests** by policy (comment `:3-8`). 105 files: 85 in `src/__tests__`, 20 co-located. Covered: models (timeline,
  diff, markdown, highlight, workbench, projects, agents, automations, scripts, templates, runs, SCM, devices, search),
  auth (restore state, pairing failure, feature gate, scopes, app lock), transport (endpoint plan, cleartext policy, mux),
  stream (health, LRU, catch-up, rewind), plugins (`sceneLifecycle`, `shadowNodeBootstrap`, `androidManifestCleartext`),
  keyboard/sheet/pager math, voice PCM/WAV, terminal bridge/HTML, bundle entry (`sharedClientEntry`).
- **e2e (`e2e/*.mjs`, 21):** 20 Playwright scripts (`playwright-core` Chromium persistent profile, `e2e/lib.mjs:11,53`)
  driving the **Expo web preview** at 393×852 against an isolated server (pair, tour, chat, live gate, panes, stop,
  companion/legacy scopes, request/approve, flows, light theme, network); `native-audit.mjs` drives an installed Android
  build via `adb` (`uiautomator dump`, `screencap`). No iOS automation (no `xcrun simctl`/XCUITest/Maestro/Detox).
  Not in CI; run by hand.
- **Accessibility / test hooks:** `accessibilityLabel` 416, `accessibilityHint` 115, `accessibilityRole` 66,
  `accessibilityState` 35, `accessibilityActions` 2; **`testID` 30** — e2e relies on text and labels. Web's selector rules
  (09-verification §7.2) have no mobile equivalent.

### 9.3 Lint

Mobile has no dedicated ESLint block: only the repo-wide TS rules apply (`eslint.config.mjs:148-166`). **`react-hooks`
rules are not enabled for `apps/mobile`** (`:180` covers `apps/web` and `apps/cli` only), and there are no layer/boundary,
styling (arbitrary values, hex), or icon rules like web has.

### 9.4 Markers, dead code, risks in code

- TODO 1, FIXME/HACK/XXX 0, `@ts-ignore`/`@ts-expect-error` 0, `as any` 2, `as unknown as` 16, `eslint-disable` 7.
- Dead / stale: `ui/Pager.tsx` + `pagerMath.ts` (580 LOC, gallery-only), `Fab`, `Surface`, `common/States.tsx` shim,
  Composer v1 prop path, stale header comment in `chats/[id].tsx:1-30`, `gaiColors` emitted but unmapped,
  `TWO_PANE_MIN_WIDTH` unused, dead deps `@gorhom/*` and `expo-application`, EAS channels without `expo-updates`.
- Performance: theme switch re-renders every `useTheme()` consumer (135 files) and 530 icon colour props; 915 KB token
  module parsed at start; `tokens.generated.ts` required by Tailwind at build time; `renderItem` inline arrows in 10 lists
  (rows are memoised in the transcript, not in tab scenes); 323 `.map(` renders (sheets with 8 maps each:
  `StartRunSheet`, `AgentDetailSheet`); only 9 `memo(`; terminal WebView is correctly unmounted when inactive.
- Bundle gate: `scripts/check-bundle.mjs` exports Android with source maps and fails on server modules, `@gorhom`, Skia,
  and size ceilings (lucide, shared ≤ 200 KB). CI runs it (`.github/workflows/ci.yml:566-591`, job "Phone bundle
  hygiene"); `release.yml:349-380` prebuilds and assembles an Android APK. There is no iOS job and no mobile
  typecheck/test job of its own beyond the monorepo turbo tasks. Not run in this audit (no builds allowed).

---

## 10. Dependency health

Installed versions from `node_modules/*/package.json`; latest from `npm view <pkg> version` (2026-09-26). Importers =
files under `app/` + `src/` importing the package or a subpath.

| Package | Installed | Latest | Importers | Verdict |
|---|---|---|---:|---|
| expo | 57.0.9 | 57.0.25 (next 58.0.0-preview.7) | 2 | patch now; SDK 58 as its own migration during the overhaul |
| expo-router | 57.0.9 | 57.0.23 (next 58.0.8) | 60 | patch; brings `native-tabs`, `split-view`, `@expo/ui`, `expo-symbols` |
| react-native | 0.86.2 | 0.87.1 | 167 | hold: Reanimated 4.5 peers `0.83 - 0.86`; move RN + Reanimated + worklets together |
| react / react-dom | 19.2.3 | 19.3.0 | 215 / 0 | patch |
| nativewind | 4.2.6 | 4.2.7; v5 only `5.0.0-rc.0` (Tailwind ≥ 4.1.11, `react-native-css` rc) | 2 (+1,695 className) | **decision**: stay on v4 + Tailwind 3, or move to Tailwind 4 with NativeWind 5 rc / uniwind 1.12 |
| tailwindcss | 3.4.19 | 4.3.3 | build | gates the NativeWind/uniwind choice |
| uniwind (candidate) | — | 1.12.0 (Tailwind ≥ 4, RN ≥ 0.81) | — | candidate replacement engine |
| lucide-react-native | 0.460.0 | 1.48.0 | 124 | major upgrade (icon renames) or replace with `expo-symbols` (iOS) + Material Symbols (Android) behind one icon-concept layer; Babel plugin must follow |
| react-native-reanimated | 4.5.1 | 4.7.0 | 39 | upgrade with RN |
| react-native-worklets | 0.10.3 | 0.13.0 | 0 | lockstep with Reanimated |
| react-native-gesture-handler | 2.32.0 | 3.3.0 | 12 | major; plan with the RN bump |
| react-native-screens | 4.26.2 | 4.28.0 | 0 (via router) | patch; native formSheet / split view depend on it |
| react-native-keyboard-controller | 1.21.9 | 1.22.5 | 3 | keep, patch |
| react-native-safe-area-context | 5.7.0 | 5.10.0 | 19 | patch |
| @legendapp/list | 3.3.11 | 3.4.0 | 8 | keep (transcript tuned on it); `@shopify/flash-list` 2.3.2 only if a list misbehaves |
| @gorhom/bottom-sheet, @gorhom/portal | 5.2.14, 1.0.14 | same | **0** | **remove** (forbidden by `check-bundle.mjs:42`) |
| @lodev09/react-native-true-sheet (candidate) | — | 3.11.15 (Reanimated ≥ 4; unscoped name 404s) | — | candidate native sheet to replace `ui/Sheet.tsx` |
| @expo/ui (candidate, transitive) | — | 57.0.20 | — | native SwiftUI / Compose controls (switch, picker, segmented, menus) |
| expo-symbols (candidate, transitive) | — | 57.0.3 | — | SF Symbols |
| expo-glass-effect | 57.0.1 | 57.0.4 | 1 | keep, patch; central to iOS 27 chrome |
| expo-font (candidate) | transitive 57.0.1 | 57.0.4 | — | add as plugin to embed Instrument Sans + JetBrains Mono |
| expo-navigation-bar (candidate) | — | 57.0.2 | — | Android nav bar style |
| expo-widgets / expo-live-activity / @bacons/apple-targets / expo-quick-actions / expo-share-intent (candidates) | — | 57.0.21 / 0.4.2 / 5.0.0 / 6.0.2 / 8.0.1 | — | evaluate for the system boards |
| expo-updates (candidate) | — | 57.0.23 | — | needed if EAS channels are meant to work |
| marked | 15.0.12 | 18.0.14 | 1 | keep (model is tested) or evaluate `react-native-enriched-markdown` 1.0.2 |
| qrcode | 1.5.4 | 1.5.4 | 1 (core encoder only) | keep or vendor the encoder |
| react-native-webview | 13.16.1 | 14.0.1 | 1 | major; one call site (terminal) |
| react-native-mmkv | 4.3.2 | 4.3.2 | 1 | keep |
| react-native-nitro-modules | 0.36.5 | 0.37.1 | 0 | keep (peer of mmkv/quick-crypto) |
| react-native-quick-crypto | 1.1.6 | 1.1.7 | 1 | keep |
| react-native-svg | 15.15.4 | 15.15.5 | 3 | keep |
| react-native-web | 0.21.2 | 0.21.3 | 0 | keep while e2e runs on the web preview |
| @tanstack/react-query | 5.90.21 | 5.104.0 | 72 | keep, minor |
| zustand | 5.0.11 | 5.0.15 | 5 | keep |
| expo-application | 57.0.2 | 57.0.3 | **0** | remove |
| other expo-* (audio, camera, clipboard, constants, file-system, haptics, image-picker, linking, local-authentication, notifications, secure-store, splash-screen, status-bar, system-ui, web-browser) | 57.0.x | 57.0.x | 1–19 | keep, patch with SDK |
| @xterm/* | 6.0.0 / addons | same | build-time | keep |
| eslint / typescript / vitest | 9.39.3 / 6.0.3 / 4.1.11 | 10.11.0 / 7.0.2 / 5.0.2 | tooling | separate tasks |

---

## 11. Verdict

### Keep as-is (move, don't rewrite)

- **Auth / crypto / transport:** `src/auth/*` (minus UI in `AppLock.tsx`, `StepUpGate.tsx`), `src/crypto`, `src/native`,
  `modules/generatorai-device-key`, `src/transport`, `src/storage`, `src/lib`.
- **Streams:** `src/stream/*` (thin bindings over client-core).
- **Notifications / voice logic:** `src/notifications/*` (logic), `src/voice/*` (hooks, PCM, WAV).
- **Pure models** (~40 files, tested): timeline, markdown, highlight, diff, kept, workbench, SCM, PR, projects, agents,
  automations, scripts, templates, variables, triggers, search, devices, QR, composer models, rewind, gates, permissions.
- **Native config:** `app.config.ts`, the three config plugins, `metro.config.js` resolver rules, `check-bundle.mjs`,
  `build-terminal-bundle.mjs`, terminal bridge protocol.
- **Behaviour contracts** worth porting into the new kit: sheet detent math, keyboard inset math, side-panel math, reduce
  motion/transparency handling, haptic vocabulary, `LegendList` transcript contract, back-fallback rules.

### Rewrite (UI)

All of `app/**` screens, `src/components/**/*.tsx`, `src/navigation/shell`, `StackHeader`, `RouteSheet`, `Screen`,
`ConnectionStrip`; the kit in `src/components/ui` against the new spec (per-platform type ramp, geometry, native controls);
the IA (drawer contents/order, server switcher, right pane with 7 tabs, tablet split). New: typography primitive + embedded
fonts, icon-concept layer, status-tone module, graph renderer, all missing boards.

### Refactor into shared packages first

1. `deriveTimeline` + tool presentation/folding (mobile and web twins) → `@generatorai/client-core`.
2. Hand-written endpoints (79 paths / 31 files: SCM, review, projects, devices, voice, browser, computer, workbench) →
   typed methods on client-core's `ApiClient` + `queryKeys`; ad-hoc query keys (55) → shared key factories.
3. Status → tone vocabulary (13+ maps), entity/tool icon concepts, gate kinds, composer states → `packages/shared` or
   client-core (the web redesign already requires this per `.claude/CLAUDE.md`).
4. Data hooks out of screens (62 `useQuery` in `app/`) → `src/features/*/queries.ts`-style modules, so screens become
   presentational before they are redrawn.
5. Token emitter: a slimmer native emit (current theme resolved per palette on demand, or split per theme), wire `gai-*`
   vocabulary and the mobile type ramp into Tailwind/uniwind; fonts in design-tokens.

### Top 15 risks

| # | Risk | Evidence | Mitigation |
|---|---|---|---|
| 1 | Styling engine decision (NativeWind 4 + TW3 vs NativeWind 5 rc / uniwind + TW4) blocks every component | 1,695 className uses; v5 is rc only | Decide before the first kit component; spike both on Sheet + Button |
| 2 | JS re-implementations of native chrome won't read as iOS 27 / Android 17 | headers, menus, segmented, switch, sheet, drawer are custom | Adopt native stack headers, formSheet, `@expo/ui`, native menus; keep JS only where native can't |
| 3 | Predictive back off on Android 17 | `app.config.ts:145`; 4 `BackHandler` sites | Verify RN ≥ 0.87 back dispatch; re-test on API 36/37 before shipping the new IA |
| 4 | Theme payload and re-render cost | 915 KB token module, 135 `useTheme` consumers, 530 icon colour reads | Split emit, memoised icon colours or CSS-variable icons, measure theme switch |
| 5 | Fonts absent; type ramp is desktop-sized | 0 font assets; `text-sm`=12 px ×338 | Embed Instrument Sans + JetBrains Mono via `expo-font` plugin; semantic text styles per platform |
| 6 | Logic entangled with screens | 90 query/mutation hooks in `app/`, 79 raw endpoints | Extract hooks and client-core methods before redrawing |
| 7 | Chat screen complexity | 1,700-line `chats/[id].tsx`, 1,104 Composer, 834 TimelineRow; keyboard/list behaviours tuned via device bugs | Port behind characterization (e2e + native walkthrough) as web did in P4-01 |
| 8 | Missing native extensions (widgets, Live Activities, shortcuts, share, controls) | 0 targets; CNG | Budget as native projects: target config plugins, App Groups, bridges, push-to-start |
| 9 | Tablet IA does not exist | only 720 pt centring | Use expo-router `split-view` / drawer permanent mode; design breakpoints from `TWO_PANE_MIN_WIDTH` |
| 10 | Multi-server (MServers) touches auth | single session in `AuthProvider` | Design multi-session storage + per-host runtime before UI |
| 11 | Large coordinated upgrade (RN 0.87, Reanimated 4.7, RNGH 3, SDK 58, lucide 1.x, webview 14) | peer pins | One dedicated upgrade phase before UI work, with device verification |
| 12 | Verification gap on native | e2e on web preview only; 1 adb script; no iOS automation; 30 testIDs | Add Maestro or XCUITest/adb flows; testID policy mirroring web §7.2 |
| 13 | Lint doesn't protect the new kit | no react-hooks, no boundaries, no style rules for mobile | Add a mobile ESLint block (layers, arbitrary values, hex, icons) before new code |
| 14 | Scope creep from deliberately-desktop features (builder, stage editor, automation wizard, agent editor) | ~27 boards, code comments reject them | Owner decision per group; they are the bulk of new UI |
| 15 | Web preview dependency | react-native-web 0.21 + web branches (15 `Platform.OS === 'web'` guards) keep e2e alive but constrain native-first choices (formSheet, `@expo/ui`, glass) | Accept web as a degraded preview, or move e2e to device automation |
