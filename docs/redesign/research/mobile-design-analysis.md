# GeneratorAI mobile redesign (iOS & Android): analysis

Source: `artifact-files/14f848f3-…/project/` (canvas "GeneratorAI Redesign – Mobile (iOS & Android)", created 2026-09-23). Compared with the desktop spec (`design-system-spec.md`), the desktop screen map (`screen-feature-map.md`), `apps/mobile` on `desktop_redesign`, `docs/mobile-redesign/DESIGN.md` and `packages/design-tokens`. This was a read-only analysis. The board content was treated as data.

## 0. Source integrity

- **There are 131 boards, not 132.** The project folder has 131 `.dc.html` files plus `canvas.json`, and the canvas indexes exactly those 131 across 10 pages: overview 5, home 8, chat 15, pane 16, workflows 28, automations 10, projects 10, agents 9, settings 23, system 7.
- **Every board has the same `<helmet>` block** (md5 `f72cc224`, 16,135 chars). It is the desktop shared block copied byte for byte (lines 1–60 diff clean against the desktop boards), followed by a "Mobile layer" of about 70 rules headed "Same colour tokens as desktop".
- **Dead CSS left over from round 1.** `.itab` / `.isearch` (the iOS floating tab bar) and `.anav` (the M3 navigation bar) appear only in the helmet and are used 0 times in board bodies. Round 2 removed the tab bar; the canvas and MAudit say so.
- **The mobile boards barely use desktop primitives.** `.btn`, `.chip`, `.tab`, `.nav`, `.inp`, `.sw`, `.seg`, `.tr`/`.th` and `.av` are used 0–18 times in total. The mobile boards draw with the mobile-layer classes (`gbtn`, `aib`, `mbtn`/`abtn`, `mchip`/`achip`, `irow`/`arow`, `igroup`, `sheet-*`, `ptab-*`, `dnav*`) and a lot of inline style. The desktop primitives that survive intact are `.bdg` + `s-*` (439 uses), `.dot`, `.mono`, `.trunc` and the `.i*` icon sizes.
- **Every board is a pair: iPhone 402×874 pt and Pixel 412×915 dp**, in the same state. Each has the same DCLogic switch as desktop (`mode` dark|light, `accent` = ink).

## 1. Foundations (MFoundations, MPrinciples, MThemesPhone)

### 1.1 Colour tokens are the same as desktop

- **Names and values match.** The mobile helmet's `.t-dark` / `.t-light` blocks and the seven `.acc-*` classes (ink default, blue, violet, green, orange, rose, teal) are identical to the desktop spec §2.
- **Board bodies use only desktop token names.** By frequency: `fg-3`, `fg-2`, `fg`, `line-soft`, `raised`, `line-strong`, `line`, `selected`, `warn`, `accent`, `ok`, `surface`, `err`, `on-accent`, `ground`, `sunken`, `run`, `overlay`, `*-bg`, `shadow-pop`, `add/del-bg`, `scrim`. There are no new colour tokens, and `--hover` is never used because there is no hover on touch.
- **Glass is not a new token.** It is `color-mix(--overlay 68%)` + blur 22 + a 12% `--fg` border. On Reduce Transparency it falls back to opaque `--overlay` + `--line`.

**Discrepancies to resolve:**

1. **Accent count.** MPrinciples says "17 themes × light / dark × 6 accents", but the CSS has 7 (ink + 6).
2. **A new Android-only accent.** MSetAppearance adds **"System (Material You)"**, "accent from your wallpaper", which never touches status colours. This would need dynamic colour (Android 12+ `system_accent1_*` via `PlatformColor`), and neither the token package nor the web has it.
3. **Theme previews.** MThemesPhone previews 8 themes (Instrument Dark/Light, GitHub Dark, Nord Light, Rosé Pine Dark, Solarized Light, High Contrast Dark, Catppuccin Light) as inline overrides. Surfaces, lines, fg, status hues and accents match desktop's `.th-*` blocks. The derived tokens are hand-simplified and differ:

   | Token | Mobile board | Desktop |
   |---|---|---|
   | `fg-3` | equals `fg-2` in every theme | oklab 82% mix |
   | `selected` / `hover` | literal `rgba(…, .06/.08)` | `color-mix` of fg at 4% / 8% |
   | `add-bg` / `del-bg` | hue + `20`/`26` | 10% mix |
   | scrim | .5 | .3 in light |

   Treat the phone board as an illustration only. The emitter must be the source of truth.
4. **Mobile themes recolour only.** Fonts stay Instrument Sans / JetBrains Mono in every theme ("All 17 themes recolour content. Native chrome follows light / dark only"). This is a deliberate difference from desktop, where themes also swap the font stack and radius.

### 1.2 Type scale

The type scale is per platform, uses Instrument Sans + JetBrains Mono on both, is mapped to Dynamic Type / font scale, and allows only weights 400/500/600.

| Role | iOS pt (class) | Android sp (class) |
|---|---|---|
| Large title / Headline M | 32/600 −0.02em (`i-lt`) | 28/600 (`a-hl`) |
| Title / Title L | 20/600 (`i-t2`) | 22/600 (`a-tl`) |
| Detail title | 12 breadcrumb + 16/600, centred | 12 + 18/600, left |
| Headline / Title M | 17/600 (`i-hd`) | 16/600 (`a-tm`) |
| Body | 17 (`i-bd`) | 16/1.5 (`a-bl`) |
| Transcript | 16/1.5 (`i-cb`) | 16/1.5 |
| Subhead / Body M | 15 (`i-sub`) | 14/1.45 (`a-bm`) |
| Footnote | 13 (`i-fn`) | — |
| Caption / Label | 12/500 (`i-cap`) | 12/500 (`a-lb`) |
| Mono | 14 · 13 · 12 (never below 12) | same |

- **Minimums.** 11 pt on iOS and 12 sp in Android content.
- **What the boards actually use.** Measured sizes are 12 (3,210), 13, 14, 15, 16, 11, 17, 18, 20, 22, 21, 24. The type classes themselves are barely used: sizes are mostly inline.
- **Relation to desktop.** "Desktop's 13 px UI default becomes 16–17 on a phone." Desktop's scale is 11/12/13/14/16/20/28. The mobile ramp is a separate, platform-keyed ramp, not the desktop one.

### 1.3 Spacing, geometry and targets

- **Spacing.**
  - 16 px side gutter everywhere (`0 16px` is the top padding value).
  - Gaps 8/6/12/10/4/2; row padding 8–12 × 16.
  - No declared scale. In practice it is 2·4·6·8·10·12·14·16·24.
- **Chrome.**

  | Element | iOS | Android |
  |---|---|---|
  | Safe area | 62 top, 34 bottom | 40 top, 24 bottom |
  | Header | 52 pt | 64 dp top app bar |
  | Header buttons | 44 glass circles (`gbtn`), max 3 in one glass capsule (`gcap`) | 48 icon buttons (`aib`), max 2 + overflow |
  | Sidebar drawer | 318 pt on `--surface`, radius 0 28 28 0 | 336 dp on `--overlay`, radius 0 16 16 0, 48 dp pill items |
  | Right pane | 356 pt (89%), pill tabs 32 | 364 dp, underline tabs 48 |
  | New | glass capsule 52 tall | extended FAB 56 dp, r16 |
  | Sheets | inset 8 px, r38, grabber 36×5 | edge-attached, r28 top, handle 32×4 |

- **Touch targets.**
  - iOS: 44 pt hit area; chips drawn at 32 with a 44 hit area; rows ≥ 52.
  - Android: 48 dp hit area; chips 32 with a 48 hit area; list items 64/72.
- **Radii.**
  - iOS is "concentric": sheet 38, drawer/pane 28, group 22, card 20, code 12, capsule = h/2. Transcript cards are r14.
  - Android uses the M3 shape scale: 8 chips, 12 menus, 16 FAB/drawer, 28 sheets, full buttons. Transcript cards are r12.
  - Measured radii: 12, 16, 8, 4, 7, 14, 20 …
- **Controls.**

  | Control | iOS | Android |
  |---|---|---|
  | Button | `mbtn` 44 h, r22 (capsule) | `abtn` 40 h, r20 (full pill) |
  | Chip | `mchip` 32, r16 (pill) | `achip` 32, r8 |
  | Switch | 51×31 | 52×32 |
  | Segments | segmented control: `--selected` track, `--overlay` selected segment with a line ring | connected button group |

- **Motion.**
  - iOS uses system springs; the drawer and pane use the push spring; content uses `.smooth`; press-scale on buttons only.
  - Android uses the M3 Standard scheme: default spatial 0.9/700, fast 0.9/1400, slow 0.9/300, effects 1.0/1600.
  - Reduce Motion turns springs into cross-fades and stops spinning glyphs.
- **Haptics.** A 7-event vocabulary (selection tick, swipe threshold, long-press, drag, server-confirmed success, reject, run failed). Success fires only when the server confirms. There is a global Haptics off switch.
- **Accessibility.**
  - Content scales fully; chrome rows cap at 1.6×.
  - Contrast 4.5:1 for text and 3:1 for glyphs; status is always glyph + word.
  - Every swipe and long-press is also a VoiceOver/TalkBack custom action.
- **Glass rule.** Glass is iOS-only and only on floating chrome: header buttons, composer, New capsule, "↓ Latest". It is never used on content, the sidebar, the pane or cards. Android uses no glass and relies on tonal layers.

### 1.4 Status map

It is the same map as desktop: Queued, Running, Needs you, Succeeded (chats say "Done"), Failed, Paused and Waiting, with glyph + colour. Queued, Waiting and Paused are neutral. The desktop Foundations board also has Waiting and Skipped; the spec's 7-state table missed Waiting.

- Skipped never appears on mobile.
- "Guarded" (a stage condition) and "Cancelled" (automations) appear as labels and need a decision on whether they count as states.

## 2. Components (MComponents) and gestures (MGestures)

**Primitives**

| Primitive | Variants |
|---|---|
| Header | top-level (sidebar toggle + large title) · detail (back + 12 px breadcrumb + title) · chat/run (pane toggle with count, `⋯`) |
| Button | primary = ink "Prominent" (Send, Approve, Run are the only filled controls) · secondary · destructive; iOS capsule 44, Android 40 dp |
| Chip | filter · toggle · model/agent chip (locked agent vs model picker) |
| Segmented control / connected button group | — |
| Switch | on = accent (ink) |
| Text field | iOS search bar and form row; Android outlined field |
| Badge | status map, sentence case |
| Toast | "Chat archived · Undo" |
| Empty state | one icon, one sentence, one action |
| Skeleton | no shimmer |
| Confirmation | destructive or irreversible actions only |

Note that toasts are not in the desktop design, which has none.

**Shell composites**

- Sidebar drawer (the same content as the desktop sidebar).
- Right pane shell (title, full-screen, close, scrolling tab row).
- Sheet (iOS detents / Android edge sheet).
- Menu (iOS long-press context menu with preview / M3 menu).
- Floating New (glass capsule / extended FAB).

**Content composites (the transcript kit)**

- **Tool block.** Collapsed: "Read 3 files, ran 2 commands, edited 1 file · 1 failed · 6 steps · 2m 44s". While running it shows a live count and the current step, and it expands in place.
- **Message meta.** Agent icon + name + model, or the model only. There are no initials avatars, which is stricter than desktop, where `.av` shows initials.
- **Gate cards.** Permission, Question and Plan, each a bordered card with a tinted header.
- **Composer states.** Idle, typing, running (Send becomes Stop, "Queue a follow-up"), and waiting (Send disabled, with the reason and "Cancel and send").
- **Other composites:**
  - chat list row (status glyph, title, project · agent/model, ±lines, time; swipe actions);
  - stage rail with attempt, agent and model, and a Setup · Stages · Finalize strip;
  - approval/review card with rounds;
  - diff with inline comment;
  - terminal key row;
  - builder stage list and graph;
  - stepper (new automation 1–6);
  - radio/option rows;
  - pickers (model/turn sheet, agent picker).

**Gestures**

- A left-edge swipe opens the sidebar on top-level screens and means back on detail screens.
- No edge gesture opens the pane; it opens from its button only. A swipe right closes it.
- Row swipes (iOS): Pin and Mark unread leading; More and Archive trailing. Approve and Delete are never on a swipe.
- Long-press menu (three groups at most); pull to refresh (not on the transcript); sheet drag between detents.
- Pinch/pan on the workflow map, long-press a diff line to comment, drag to reorder stages (with Move up/down fallbacks), and terminal pinch to set the font size 10–20 plus a key row.
- Rule: every gesture has a button or menu item and a screen-reader action.

**Platform split**

- **The same on both platforms:** screens, rows, data, actions, IA, tokens, status map, fonts and wording.
- **Native per platform:** header shape and alignment, sheets, menus, switches, segments, back behaviour (edge swipe vs predictive back), and glass vs tonal surfaces.
- **Platform versions.** The boards are labelled "iOS 27 · Android 17" (MPrinciples) and "iOS 26 Liquid Glass" (CSS comment).

**Tablets**

- **iPad** (1194×834 landscape): a persistent three-column layout. The sidebar is 312, the chat fills the middle, and the workspace pane is 410.
- **Android tablet** (1280×800): a permanent navigation drawer at 300, the chat, and a 400 pane.
- **Missing states.** No portrait, split-view or compact-width tablet state is drawn.
- **Current code has no tablet layout.** `TWO_PANE_MIN_WIDTH = 768` exists in tokens, and the audit's "only the diff splits at 700 pt" still applies.

## 3. Information architecture

| | Mobile design | Desktop redesign | Current mobile code | Owner memory (22 Sep) |
|---|---|---|---|---|
| Shell | Left drawer, no tab bar | 232 px sidebar | Drawer (`src/navigation/shell/AppDrawer.tsx`), tabs navigator with `tabBar={NO_BAR}` | Drawer = desktop sidebar |
| Order | Home, Chats, Projects, Agents, Workflows, Automations, Scripts | **same** | Home, Projects, Chats, Agents, Workflows, Scripts, Automations (`sections.ts`) | the old desktop order |
| Drawer extras | Server switcher, search field, Needs you + Running lists, connection footer, Settings | same (plus a New chat button) | "navigation only: no New chat, no recent chats" (DESIGN.md) | — |
| Workspace | Right pane, 7 tabs (Changes, Files, Terminal, Browser, Tasks, Plan, Computer); run pane: Output, Files, Hooks, Variables, Changes, Terminal, Browser | Dock: Changes, Files, Terminal, Browser, Tasks + contextual Computer, Plan; run dock: Inspector (Output/Files/Tools/Hooks/Variables), Changes, Terminal, Browser | "Workbench": right index panel, then a bottom sheet per tool with a chip strip; includes a "Session" tool | pane tabs = desktop tabs; no Source-control tab |
| Runs | Under their workflow; no Runs destination | same | same (`/runs/[id]` lights Workflows) | same |
| Settings | Drawer footer; 15 desktop sections in 4 groups (App, Agents & models, Integrations, System) + 4 per-device rows (Notifications, App lock & privacy, Haptics, Widgets & Live Activities) | 960 modal, 15 sections | 13 route files (`app/settings/*`) | — |

The mobile design follows the **desktop redesign's** order and sidebar contents exactly. That makes it consistent with the owner's "mirror desktop" rule, but it changes the current code and the rule written in memory, which encode the *old* desktop order. The two clients should switch together.

Small differences:
- The run pane drops desktop's Tools inspector sub-tab and flattens Inspector.
- The "Session" workbench tool in the current code has no counterpart. It becomes the turn sheet.
- The four per-device Settings rows are the only mobile-only IA, and they are justified by the platform.

## 4. Screen inventory and code mapping

| Area (boards) | Key composites | Current code | Status / gaps |
|---|---|---|---|
| **Home & shell** (8): MHome, MHomeMore, MSidebar, MSidebarChats, MSearch, MServers, MScopeRequest, MPairing | 3-count stat line; Needs you / Running / Recently finished lists; drawer; command palette (contextual, Go to, Actions, Recent); server switcher; 6-cell pairing + QR; scope request (3-step) | `app/(tabs)/index.tsx`, `components/home/*` (StatTiles, ApprovalsQueue, OperationCard), `app/search.tsx` + `components/search/*`, `app/pair.tsx`, `app/scope-request.tsx`, `navigation/shell/*`, `app/approvals.tsx` | Home: replace the 4 stat tiles + queue. Search exists; add Actions and contextual Run. **Multi-server switcher is new** (code keeps 1 server; re-pairing replaces it). Floating New is new (DESIGN.md removed it from Home). |
| **Chats & composer** (15): MChats, Main, MChatRunning, MChatToolsExpanded, MChatStepDetail, MChatNoAgent, MModelPicker, MComposerPlus/Input/Voice, MNewChat(+More), MAgentPicker(+Caps), MChatWorkflowRun | status-glyph rows with Pinned/Recent, swipe + multi-select; grouped tool block; step detail screen; gate cards; "Next turn" sheet (Provider, Model, Mode, Effort, Context, gauge); + menu (attach, camera, browser capture, skills, mention, "Let this chat run workflows"); dictation; orchestrator background tasks; in-chat workflow run / approval / draft cards | `app/(tabs)/chats.tsx`, `app/chats/[id].tsx` (+gate, plan), `components/chat/*` (Composer, ModelSheet, TurnOptionsSheet, NewChatSheet, Permission/Plan/QuestionCard, timeline/*, composer/*) | Mostly present. The composer **reverts** DESIGN.md's split chip row (model, effort, Plan) to one model chip that opens a turn sheet. New: step-detail screen, agent picker "customize capabilities", workflow-run and draft cards in chat, Pinned group, "Let this chat run workflows" toggle. |
| **Workspace pane** (16): MPaneOpen, MPaneTabsOverview, MPaneChanges, MPaneDiff, MPaneCommit(+Done), MPaneFiles, MPaneFilePreview, MPaneTerminal(+Full), MPaneBrowser(+States), MPaneTasks, MPaneTaskDetail, MPanePlan, MPaneComputer | compare seg (turn / chat / branch), checkpoint scrubber + Rewind, pending comments "Send all", Sources (mounts), file tree with M/A/R/D, commit & PR sheet, terminal key row, browser comment/capture, task detail, plan revisions, computer live view | `components/workbench/*`, `components/chat/workbench/*Section.tsx`, `components/chat/panes/*`, `components/changes/*`, `components/review/*`, `components/scm/*`, `app/changes/[workspaceId]/*`, `app/terminal/[workspaceId].tsx` | Shell changes from the workbench index + sheet to a tabbed right pane. **Keep / Keep all / Undo all (owner-requested, shipped) are absent**: only "Discard changes". Desktop's DockChanges also lacks them, so raise it with the owner. |
| **Workflows** (28): list, detail(+More), New(+Basics), Launch(+Advanced, Plan), Run #248 (+Menu, Pane, StageChat, Approval, Graph, Loop), Builder List/Graph/Loop, AgentDraft, Settings, Validate, Stage editor ×7 (Prompt, Session, Tools, Output, Policy ×2, Hooks) | run sheet with variables and plan preview; run header (context %, tokens, $); Setup/Stages/Finalize strip; stage rows with attempts; loop status; biometric approval; runtime graph; **full builder** with reorder, graph, loop groups, validation, version history | `app/(tabs)/runs.tsx`, `app/workflows/[id].tsx`, `app/runs/[id].tsx` (+stages), `components/runs/*`, `components/work/{StartRunSheet,TemplatePickerSheet,workflowGraph,variableForm,stageOverrideForm}` | Run controls (pause/cancel/retry) and templates exist. **Missing: the builder, stage editors, validation, settings/variables editor, loop UI, graph view, run pane.** DESIGN.md had said "the DAG builder stays on desktop"; the design now brings it to mobile. |
| **Automations & scripts** (10) | list with switch, detail, execution, webhook credentials, 6-step create; scripts list, detail with run profiles | `app/automations/[id].tsx`, `app/scripts/[id].tsx`, `components/work/{automationModel,scriptModel,ScriptRow,ExecutionSheet,TriggerInputSheet}` | Missing: create wizard, webhook credentials. Toggle and Run now partly exist. |
| **Projects** (10) | list with long-press, create, detail/codebases, add codebase, settings/delete, codebase worktrees, files, fetch logs, customization, skill detail | `app/(tabs)/projects.tsx`, `app/projects/[id].tsx`, `codebases/[cid]/*`, `components/projects/*` | Missing: fetch logs, customization, skill detail. **Code-only:** `projects/[id]/pull-requests.tsx` and `codebases/[cid]/pull-requests/[number].tsx` have no mobile board, and desktop's redesign replaces the PR tab with Chats/Runs. |
| **Agents** (9) | list, detail (single / orchestrator team), new (start from), import `.agent.md`, 3-part editor, delete-in-use (force) | `(tabs)/projects.tsx?segment=agents`, `components/work/{AgentDetailSheet,agentModel}` (edit model tested) | Missing: detail as a screen, editor, import, force delete. |
| **Settings** (23) | root + 21 sections + pair device | `app/settings/{index,appearance,audio,diagnostics,extensions,notifications,providers,security,source-control,capabilities,tools,accessibility,about}.tsx` | Missing or renamed: General, Agents, Skills/MCP/MCP Add/Templates (today folded into `capabilities`), Browser & terminal (`tools`?), Computer use, Storage, App lock & privacy, Widgets. `accessibility` and `about` have no board (the root footer shows the version). Appearance drops desktop's Density and 12/13/14 font size in favour of OS text size, and adds Reduce transparency and the Material You accent. |
| **System** (7): MNotifications, MLiveActivity, MShortcuts, MWidgets, MTabletIOS, MTabletAndroid, MThemesPhone | see §5 | `notifications/*` (Allow/Deny category), `auth/{AppLock,stepUp}` | Mostly new |

**Features the design invents, with no desktop or server counterpart found:**
- a global **"Pause agents"** control (Control Center control and Quick Settings tile);
- a **morning digest**;
- **quiet hours with approvals let through**;
- **per-project notification levels**;
- a **share-to-agent** flow;
- **"hide content in app switcher" / "hide notification previews"**.

These need server or API work, and a decision under the "no invented destinations" rule. They are features, not destinations.

**In code but without a design:**
- `app/revoked.tsx`;
- `app/approvals.tsx` (the design folds approvals into Home and the notifications);
- the prompt `HistorySheet`;
- `ConflictSheet` / `ConnectGitHubSheet`;
- chat fork/branching (`useChatBranching`);
- the Kept view;
- `UsageFooter`;
- Home's `HealthCard`.

## 5. System surfaces and native modules

| Surface | Design | Native work required | Exists today |
|---|---|---|---|
| Push actions | iOS Time-Sensitive; Allow once with Face ID, Deny, Open; question quick-reply; Android heads-up with fingerprint | `authenticationRequired` action option, interruption level, Android channels | `notificationCategories.ts`, `push.ts`: Allow/Deny only |
| Live Activity / Live Update | Dynamic Island compact/minimal/expanded ("Needs you 3/6", Review); Lock Screen; Android status-bar chip + promoted progress notification | ActivityKit widget extension (Swift) + push-to-start tokens; Android 16+ ProgressStyle / promoted ongoing notifications | none |
| Widgets | iOS small/medium Needs you, Running, summary; Android Glance 4×2 / 2×2 | WidgetKit extension + App Group store; Glance (Kotlin) + a shared data source | none |
| Controls / tiles | Control Center "New chat", "Pause agents" (off/paused/unavailable); Quick Settings tiles | ControlWidget; TileService | none |
| App shortcuts | Quick actions: New chat, Home (3 need you), Run workflow…, Search | `UIApplicationShortcutItems` / `shortcuts.xml` (static + dynamic) | none |
| Share to agent | iOS share extension (existing or new chat, note, server); Android share target | Share extension target; `ACTION_SEND` intent filter + handler | none |
| App lock | Face ID/fingerprint, lock-after interval, step-up for approvals / terminal / pairing, privacy screen | Mostly JS + `expo-local-authentication`; privacy snapshot needs a scene hook (the `withSceneLifecycle` plugin can host it) | `auth/AppLock.tsx`, `stepUp.ts`, `appLockState.ts` |

- **Only one native module exists:** `modules/generatorai-device-key` (Secure Enclave / Keystore key).
- **Plugins:** `withCleartextTraffic`, `withSceneLifecycle`, `withShadowNodeRaceFix`, `babel-plugin-lucide-icons`.
- **Every extension target is greenfield.** They need config plugins that add targets in CNG (`ios/`/`android/` are not committed), plus a native bridge for Live Activity start/update/end and widget reloads.
- **Cross-platform:** each surface is drawn for both platforms, and each needs an explicit "absent" path on the web (react-native-web) build.

## 6. Owner rules: consistency check

1. **"Mirror desktop IA, no invented destinations."** The design meets this against the *redesigned* desktop: same sidebar order and contents, same pane tabs, runs under workflows. It **conflicts** with the current order in code and memory (Projects before Chats; Scripts before Automations) and with the "drawer is navigation only" decision. Flag the invented features listed in §4 and the missing Keep / Keep all / Undo all.
2. **"Blue-tinted controls; never grey fills."** This **conflicts, and deliberately.**
   - The default accent is **ink** (`--accent: var(--fg)`), so primary buttons, switches and Send are near-white on dark, not blue.
   - Selected chips, segments, pane tabs and drawer items use neutral **`--selected`** (the fg wash). The iOS segment track is also `--selected`.
   - This is not a mobile invention: the desktop redesign makes the same change (hover/selected become neutral fg washes, and the old accent tint is removed).
   - The `control` / `control-strong` aliases in `tailwind.config.js` (`--sidebar-accent`, `--accent`) and "tabs select solid `primary-emphasis`" (DESIGN.md) would be reversed. The owner has to explicitly accept Instrument's neutral-selection model for both clients.
3. **"Corner-rounded tabs and chips, not pills."** This **conflicts on iOS and on parts of Android.**
   - iOS: `mchip` r16 on a 32 chip, `mbtn` r22 on 44, iOS pane tabs `ptab-i` r16, and the glass circles and capsules are all full pills.
   - Android: `abtn` r20 on 40, drawer items with 48 dp pill indicators, and the FAB r16.
   - Android `achip` (r8) and the transcript cards (r14 / r12) are corner-rounded.
   - The design justifies pills as "platform chrome keeps platform radii" (HIG capsules, M3 full buttons). This directly contradicts memory, which says "34pt pill → corners; tabs, chips, badges corner-rounded".
4. **"Flat lists."** Mostly met: rows carry a glyph and text with dividers. But iOS uses inset grouped lists (`igroup`: `--raised`, r22) in Settings and forms (79 boards). That is a tile behind the group, not behind each row.
5. **Composer glass.** DESIGN.md chose "composer card 20pt `bg-card`, not glass", and a glass drawer and workbench. The design **reverses both**: the composer is glass, and the drawer and pane are never glass.

## 7. Desktop vs mobile component equivalence (design-contract feasibility)

**Conceptually identical: same content and states, different geometry.**
- tokens and theme axes;
- the status map (glyph, colour, words);
- the badge (`.bdg` + `s-*` is reused verbatim);
- the icon set (Lucide, stroke 1.75, `.i` sizes 12–24);
- breadcrumbs;
- the Needs you / Running lists;
- the tool block and step timeline ("Read 3 files, ran 2 commands…");
- gate cards (permission, question, plan) with the tinted header;
- the composer anatomy (attach, agent locked, model, mode, effort, context gauge, mic, Send/Stop, blocking bars);
- the workspace pane tab set and panel contents (Changes compare / checkpoint / comments / commit, Files sources, terminal instances, browser capture, tasks, plan revisions, computer);
- the run header, stage rail and approval rounds;
- the command palette groups;
- the stepper;
- empty states and no-shimmer skeletons;
- the model/agent pickers.

**Different:**
- **Navigation.** A 232 sidebar and 48 rail vs a modal drawer; a docked 480 panel vs an overlay pane over a scrim.
- **Surfaces.** Popovers become sheets; dialogs become full-screen modals; hover becomes long-press.
- **Controls.** Control heights 24/28/32 become 44/48; pills (mobile) vs r6 (desktop); iOS segmented control vs M3 connected group.
- **Composer.** The composer's chips collapse into one turn sheet.
- **Avatars.** Desktop keeps `.av` initials; mobile bans them.
- **Toasts.** Mobile has toasts; desktop has none.
- **Theming.** Themes swap fonts and radius on desktop; on mobile they are colour only.

**Verdict: a shared contract is feasible at the semantic layer, not the geometry layer.** Share:

1. **Token names and values**, emitted per platform.
2. **The status map** as data: `{state → glyph id, tone, label (chat/run variant)}`.
3. **An icon registry** of concept → Lucide name (49 concepts).
4. **Component API names and props:** `StatusBadge{state}`, `ToolBlock{steps,summary}`, `GateCard{kind}`, `Composer{state}`, `PaneTabs{set: chat|run}`, `Breadcrumb`, `StageRail`, `EmptyState`.
5. **Copy strings** ("3 need you", "Waiting 3m").

Keep sizes, radii, heights, motion and material per platform: web, iOS and Android.

## 8. Token pipeline implications

**`packages/design-tokens`**

1. **Add the Instrument theme and the `ink` accent.** This is shared with the desktop plan.
2. **Emit the new semantic names.** Today the emitter (`emit/native.ts`, `resolveTokenSet`) writes the *old* vocabulary:
   - current names: `--background`, `--card`, `--subtle`, `--emphasis`, `--primary`, `--primary-emphasis`, `--sidebar-accent`, `--success`/`--info`/`--warning`/`--danger`, `--done`, …
   - names to add: `ground`, `surface`, `raised`, `overlay`, `sunken`, `selected`, `hover`, `line`/`line-soft`/`line-strong`, `fg`/`fg-2`/`fg-3`, `run`/`ok`/`warn`/`err` + `-bg`, `add-bg`/`del-bg`, `accent`/`on-accent`, `scrim`.
   - Keep the old names as aliases during migration.
   - Handle the `--accent` collision: today it is a tint; in the design it is the fill.
3. **Pre-resolve every derived value to a literal.** That covers `color-mix` values (`hover`, `selected`, `fg-3` in oklab, add/del-bg, glass fallback). NativeWind cannot evaluate `color-mix()`, and Tailwind v3 opacity modifiers do not work on `var()` colours (the existing `Chip.tsx` comment already works around this).
4. **Add mobile geometry as its own export**, not a theme field:
   - platform type ramps (iOS: largeTitle, title, headline, body, transcript, subhead, footnote, caption; Android: M3 headlineM, titleL, titleM, bodyL, bodyM, label);
   - radius sets (iOS 38/28/22/20/14/12/capsule; M3 8/12/16/28/full);
   - control and target heights (44/52 iOS, 40/48/56/64 Android);
   - chrome widths (drawer 318/336, pane 356/364, tablet 312+410 / 300+400);
   - M3 motion springs;
   - the haptic event map.
5. **Change the font families.** `NATIVE_FONT_FAMILY.sans` is `undefined` today and must become Instrument Sans. The per-weight family names (400/500/600) matter on Android.
6. **Shadow and scrim.** `--shadow-pop` must be emitted in a form RN can use (RN 0.86 `boxShadow` string, or structured values). Emit the scrim as a literal.
7. **Material You** needs a runtime path: a `PlatformColor`-based accent, outside the static tables.
8. **Size.** The generated file is already 14.5k lines (18 themes × 2 × 7 accents × about 70 vars). Adding about 25 names and a theme adds roughly 35%. Consider emitting accent overrides separately from the base theme×appearance tokens.

**`apps/mobile/tailwind.config.js`**
- Colours: map the new names. Retire or repoint `control` / `control-strong`, depending on the owner's decision in §6.
- `fontFamily`: `sans: InstrumentSans`, `mono: JetBrainsMono`.
- `fontSize`: semantic keys (`title`, `body`, `footnote`…) through NativeWind v4's `platformSelect` from `nativewind/theme`, so one class resolves per OS.
- `borderRadius`: replace the ad-hoc `2xl` 12 / `3xl` 16 / `4xl` 24 with the platform radius sets (again via `platformSelect`, or `ios:` / `android:` variants).
- `spacing`: can stay on 4px, adding 6, 10 and 14.

**Fonts.** None are bundled today. The audit also says "0 mono font files bundled", and `JetBrainsMono` is referenced but missing. `expo-font` is not a dependency. Add `expo-font` with its config plugin and bundle Instrument Sans 400/500/600 and JetBrains Mono 400/500 as static TTF/OTF assets from the project's own sources.

**Is NativeWind 4 (Tailwind v3) a constraint?** It is manageable, not blocking:
- Mobile cannot share web's Tailwind v4 `@theme inline` CSS. It has to keep the JS config fed from the generated module, as it does today.
- No `color-mix`, no `backdrop-filter` (glass must stay native through `expo-glass-effect` / `GlassSurface.ios.tsx`), and no opacity modifiers on var colours. All of these are solved by emitting literals.
- `platformSelect` and the `ios:` / `android:` variants cover the per-platform ramps.
- The long-term risk is drift from web's v4 utilities. A move to NativeWind v5 (Tailwind v4) would allow a single CSS token source, but nothing in this design requires it.
