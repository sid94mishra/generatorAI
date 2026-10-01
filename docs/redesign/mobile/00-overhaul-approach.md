# GeneratorAI mobile overhaul (iOS 27 + Android 17): analysis and proposed approach

Status: **analysis (background)**. The plan built on it is `README.md` → `01-decisions.md` (MD-xx) → `07-phases.md`. Where this document differs from `01-decisions.md`, the decisions win. Examples: O-4 is resolved by MD-12 (the `mobile_redesign` worktree), and the O-x recommendations became MD-xx.

Date 2026-09-26 · branch `desktop_redesign`. The mobile code was audited at `952be77`; the web pass has moved since (HEAD `5cc0c54`: P4-02…P4-04 landed, D-61/D-62). An independent review of this document was applied (its findings are folded in).

Design: https://claude.ai/artifact/3bBuQ3vGwYbJh7A2yX7kqA, 131 boards, snapshot version `1790412505-d42b` in `docs/redesign/boards/mobile/`. PNG renders (dark and light) are in `docs/redesign/boards/png/mobile/`, which is gitignored. The design was edited while this analysis ran; the version changed between listing and download.

**Evidence.** Every claim below is backed by one of the research files. They carry the file:line references, npm versions and source URLs.

| File | What it covers |
|---|---|
| `research/boards-core.md` | Overview, home, navigation, chat, composer, system surfaces, tablets, themes (35 boards) + design-system summary + component catalogue |
| `research/boards-pane-automations.md` | Workspace pane (7 tabs), automations, scripts (26 boards) |
| `research/boards-workflows.md` | Workflows, runs, builder, stage editors (28 boards) + Workflow Overhaul dependencies |
| `research/boards-projects-agents-settings.md` | Projects, agents, every settings section (42 boards) + API gaps |
| `research/code-audit.md` | Current `apps/mobile`: structure, screens vs boards, kit, styling, native layer, data layer, quality, dependencies |
| `research/foundations-state.md` | What the web/desktop pass already built for mobile (M-01…M-14, G-xx) and what is missing |
| `research/stack-styling-components.md` | Styling engine, component foundation, Liquid Glass / M3 Expressive, Material You, type, icons, tokens, case studies |
| `research/stack-native-platform.md` | Navigation, drawer/pane gestures, sheets, menus, controls, haptics, keyboard, biometrics, Live Activities, widgets, notifications, tablets, a11y |
| `research/stack-engineering.md` | SDK/RN baseline, React Compiler, performance, markdown/terminal/graph engines, Storybook, testing, VRT, AI-agent tooling, build/release, Done loop |

Earlier inputs, still valid unless corrected in the files above:
- `../08-mobile-readiness.md`
- `../research/mobile-stack-research.md` (2026-09-24)
- `../research/mobile-design-analysis.md` (partly stale)
- `docs/mobile-redesign/DESIGN.md`

---

## 1. Verdict in brief

1. **Stay on React Native + Expo.** Keep the shared TypeScript packages and the shared class vocabulary with web. Make **native controls the default** wherever Expo UI or the router provides them.
   - Shopify's move back to Swift/Kotlin (2026-09-10) is the strongest counter-signal. That makes sense for a team with platform engineers and no shared TS core.
   - This project has one developer, ~40 tested pure models in the mobile app (1,099 tests), and client-core/runtime/transport already in TS. Two native codebases would double the UI work and discard the shared logic.
   - Shopify's real lesson applies either way: share a **written spec and design contract**, not view code (§5.1).
2. **This is a UI rewrite on a sound data core.**
   - **Keep** (move, don't rewrite): auth, crypto, transport, streams, notifications logic, voice, the native device-key module, and ~40 tested pure models.
   - **Rewrite:** every screen, the kit (38 files) and the shell.
   - **New:** 42 of 126 screen boards have no code today.
3. **The IA change is smaller than it looks.** Today's app has no tab bar: it already uses a left drawer and a right "workbench". What changes is the drawer content and order, and turning the pane into 7 tabs. What is new is a tablet split layout and multi-server support.
4. **Platform differences go through two mechanisms only:**
   - tokens that resolve per platform (type ramp, radii, heights, targets, widths);
   - a small set of `ui/` components with one prop contract and `.ios.tsx` / `.android.tsx` implementations.

   Feature code never checks `Platform.OS`, and lint enforces that (§5.5).
5. **Theming:** move NativeWind 4 / Tailwind 3 to **Uniwind on Tailwind 4.3**, the same Tailwind as web, consuming the shared `vocabulary.css`.
   - 36 theme×mode variants, with the accent applied at runtime.
   - An Android-only "System (Material You)" accent derived through the existing contrast rules.
   - Literal colours for native hosts (Expo UI, sheets, widgets, Live Activities).
   - Two gates first: a Uniwind release with the platform-variant fix (PR #686), and an SDK 58 spike. NativeWind 5 is the fallback.
6. **Baseline: two steps.**
   - **On SDK 57 (can start now):** tooling, characterization flows and logic extraction. No new UI.
   - **Before any kit code:** upgrade to the latest stable SDK. SDK 58 is in beta; RN 0.88 is expected in October.
   - Turn React Compiler on right after the upgrade, once the characterization flows are green.
   - Gesture handler 3's hook API arrives with the upgrade, so all new gesture code is written once.
   - The two platform research files disagree here: one says redesign on 57 and bump later. I chose SDK-first for new UI because 58 breaks exactly the layers the kit is built on (§5.2).
7. **Heavy surfaces keep their engines:**
   - Legend List for the transcript;
   - xterm.js in a WebView for the terminal;
   - streamed images for browser and computer use;
   - native list rendering for diffs;
   - SVG for the run graph.

   Markdown gets a spike on Software Mansion's native `react-native-enriched-markdown`.
8. **System surfaces are greenfield native work, budgeted as their own phase.**
   - iOS Live Activities and widgets: `expo-widgets`.
   - Android Live Updates and the Quick Settings tile: a small Kotlin module.
   - Control Center: `@bacons/apple-targets`.
   - Share-to-agent: `expo-share-intent`.
   - Home-screen quick actions: `expo-quick-actions`.
   - **Remote Live Activity updates need a push gateway that holds an APNs key.** That is a product decision (§7, O-15).
9. **Verification an agent can run itself:**
   - Callstack `agent-device`: both platforms, accessibility-tree first, screenshots, dark mode and text-size switches;
   - Maestro for committed flows;
   - on-device Storybook RN 10 with its MCP server;
   - Jest + RNTL for kit contracts; Vitest stays for logic;
   - batched visual regression against Storybook stories.

   One environment warning: Xcode 27's Device Hub breaks several simulator tools, including Claude Code's own simulator panel.
10. **The design needs one corrections round before build.**
    - It contradicts itself: composer states, the turn sheet, the chat header, control styles.
    - It contradicts binding decisions D-18, D-27, D-28, D-29 and D-11.
    - It breaks its own touch-target and minimum-text rules in dozens of places.
    - It introduces ~25 features that have no server support.

    §6 lists the corrections. §7 lists the decisions only you can make.

---

## 2. What exists today (code audit summary)

| Area | Today | Consequence for the overhaul |
|---|---|---|
| Runtime | Expo 57.0.9, RN 0.86.2, React 19.2.3, New Architecture, Hermes, CNG (`ios/` and `android/` generated, not committed) | Patch now; SDK upgrade first (§5.2) |
| Shell | `(tabs)` with **no bar** (`tabBar={NO_BAR}`, 4 mounted scenes). Left `AppDrawer` + right `WorkbenchPanel` (8 tools incl. "Session") opening each tool as a bottom sheet; built on a custom Reanimated/RNGH `SidePanel` | Keep `SidePanel` as the engine; replace drawer content, order and pane model |
| Screens | 40 routes. Of 126 screen boards: **60 exist, 24 exist in a different shape, 42 missing** (builder/stage editor/run graph 17, automation wizard/webhook 5, agent create/edit 6, settings 5, system surfaces 3, tablets 2, project extras 3, servers 1) | New UI is the bulk of the work (§4) |
| Kit | Hand-built `src/components/ui` (38 files, 6.7k LOC): Button (96 users), Sheet (40), ListRow/ListItem, SegmentedControl, ContextMenu (JS), Toast, States. **Everything is JS**, incl. headers, menus, switch, segmented control, sheets (only iOS route sheets use native `formSheet`). Dead: `Pager`, `Fab`, `Surface` | Replace with the new kit; keep the behaviour math (`sheetMath`, `keyboardMath`, `sidePanelMath`, motion, a11y helpers) |
| Styling | NativeWind 4 + Tailwind 3; 1,695 `className`, only 17 hex literals and 33 arbitrary values (good discipline). `tailwind.config.js` aliases legacy colour names | Engine swap + vocabulary rename, absorbed by the restyle |
| Theming | 18 themes × 2 modes × 7 accents via NativeWind `vars()`. `tokens.generated.ts` is **25,966 lines / 915 KB of source**, imported whole by `ThemeProvider`, so all of it is bundled; 135 `useTheme()` consumers and 530 icon colour props re-render on theme change. New `gaiColors` vocabulary is generated but unused | Slim emit, CSS-variable driven colours, per-theme literals loaded on demand (§5.6) |
| Type | **No fonts embedded** (JetBrains Mono silently falls back; Instrument Sans unused). Body text mostly 11–12 px (`text-sm` = 12 px ×338); boards use 15–17 pt. 684 raw `<Text>`, no typography primitive | New `Text` primitive with per-platform ramps; `expo-font` plugin |
| Icons | lucide 0.460 in 124 files, 168 icons, 4 separate icon maps; the lucide Babel plugin silently breaks on lucide 1.x | Concept registry → SF Symbols / Material Symbols / lucide |
| Status | **13+ separate status→tone maps** | Consume `packages/shared/src/status` (D-18) |
| Data | 90 query/mutation hooks inside `app/` route files; **79 hand-written `/api` paths in 31 files** bypass client-core's typed client; 55 ad-hoc query keys; `deriveTimeline` duplicated with web (905 / 875 lines); no TanStack `focusManager`/`onlineManager`, no persistence | Extract before redrawing (§5.9) |
| Platform code | 4 platform files, 36 `Platform.OS`; glass only on side panels; 7 haptic verbs; Face ID app lock + 10-min step-up; **predictive back disabled** (RN 0.86 does not forward it); no tablet layout (content centred at 720 pt) | Formalise in `ui/platform` (§5.5) |
| Native layer | 3 config plugins (cleartext LAN, Fabric race fix, iOS 27 scene lifecycle), 1 Expo module (Secure Enclave / StrongBox DPoP key). **No widgets, Live Activities, extensions, shortcuts, tiles, share target**; no `expo-updates`, no `expo-dev-client` (EAS profile expects it) | System surfaces phase (§5.11) |
| Quality | typecheck clean; lint 0 errors; 1,098/1,099 tests pass (1 timing-flaky); unit tests cover logic only; e2e drives the **Expo web preview** with Playwright + 1 adb script, no iOS automation; 34 testIDs; no react-hooks lint for mobile | New verification stack (§5.13) |
| Shared foundations from the web pass | Done but **not consumed by mobile**: status map, nav destinations, command registry, attention feed, chat list v2, probeServer, stats, recent activity, system info, project summary/runs. Partial: tokens (generated, unused), computer consent, model picker. **Landed since the audit:** composer reducer `client-core/src/composer/composerMachine.ts` + `ui-contract/composer.ts` (D-61). Not started: iOS/Android geometry, SF/Material icon names, ui-contract types for gates/tool verbs/pane tabs (web P4-06/07), shared copy | Adopt in the extraction phase; fill the gaps listed in §5.1 |

Deliberately-desktop features in code comments today ("a phone cannot host the DAG builder") conflict with the design. See decision O-5.

---

## 3. What the design asks for (summary)

**Principles (MPrinciples).** Same screen on both phones: the same sections, rows, data and actions in the same state. Only the native language differs: controls, glass vs tonal surfaces, type scale, sheets, back gesture.
- The left sidebar is a drawer; there is no tab bar.
- Detail screens use back + a tappable breadcrumb.
- The workspace is a right pane.
- "What needs you" comes first.
- One ink action per screen.
- Tool calls read as one step.
- Names, not initials.
- Chrome floats (glass on iOS only); content stays flat.
- Every gesture has a button and a screen-reader action.

**IA.** Drawer modules: Home, Chats, Projects, Agents, Workflows, Automations, Scripts (the desktop order). It also holds a search field ("go to anything"), a server switcher, live **Needs you** and **Running** lists, a connection footer and Settings.
- Presentation types: pushed, sheet, full-screen modal, right pane.
- The pane has 7 tabs: Changes, Files, Terminal, Browser, Tasks, Plan, Computer.
- A run pane has Output, Files, Hooks, Variables, Changes, Terminal and Browser.

**Per-platform chrome (MFoundations).**

| | iOS 27 | Android 17 |
|---|---|---|
| Header | 52 pt, glass circle buttons 44, large title 32/600 on top level, centred detail title 16/600 with 12 pt breadcrumb, max 3 trailing in one glass capsule | 64 dp top app bar, icon buttons 48, title 22/600 in bar, left-aligned detail title 18/600, max 2 + overflow |
| Drawer / pane | 318 pt drawer (r 28, `$surface`), 356 pt pane, pill tabs 32 | 336 dp modal drawer (`$overlay`, r 16), 364 dp pane, underline tabs 48 |
| New | glass capsule h52 bottom-right | extended FAB 56 dp |
| Sheets | inset glass, r38, detents, grabber | edge sheet r28, handle |
| Menus | context menu with preview | M3 menu |
| Controls | switch 51×31, segmented control | switch 52×32, connected button group |
| Back | chevron + edge swipe | arrow + predictive back |
| Lists | grouped inset `$raised` r22, rows ≥ 52 | flat M3 items 64/72 |
| Targets | 44 pt | 48 dp |
| Type | Dynamic Type: large title 32, title 20, headline 17, body 17, transcript 16, subhead 15, footnote 13, caption 12; mono 14/13/12 | M3 sp: headline M 28, title L 22, title M 16, body L 16, body M 14, label 12; mono 14/13/12 |
| Motion | system springs; `.smooth` | M3 standard scheme (0.9/700 default spatial …) |
| Haptics | selection / impact light, medium / notification success, warning, error | SEGMENT_TICK / TOGGLE_ON / LONG_PRESS / GESTURE_START / CONFIRM / REJECT |
| Tablets | iPad persistent 312 sidebar + chat + 410 pane (inset cards) | 300 drawer + 400 pane (edge-attached) |

**System surfaces:**
- actionable notifications (Allow/Deny, answer, reply);
- a Live Activity (Dynamic Island compact/minimal/expanded + lock screen) and an Android Live Update (status-bar chip + expanded notification) for runs that need you;
- widgets (small/medium/large), a Control Center control and a Quick Settings tile ("New chat", "Pause agents");
- home-screen quick actions, share-to-agent, app lock and a privacy screen.

**Board coverage by area** (from the code audit):

| Area (boards) | Exists | Different | Missing |
|---|---:|---:|---:|
| Home & navigation (8) | 4 | 3 | 1 |
| Chats & composer (15) | 13 | 2 | 0 |
| Workspace pane (16) | 12 | 4 | 0 |
| Workflows (28) | 7 | 4 | 17 |
| Automations & scripts (10) | 5 | 0 | 5 |
| Projects (10) | 7 | 0 | 3 |
| Agents (9) | 0 | 3 | 6 |
| Settings (23) | 12 | 6 | 5 |
| System & tablets (7) | 0 | 2 | 5 |
| **Total (126)** | **60** | **24** | **42** |

"Exists" still means **redrawn**: every existing screen changes visually.

---

## 4. Gap analysis by area

| Area | Change type | Main work | Server/API dependency |
|---|---|---|---|
| Foundations (tokens, type, icons, engine) | Replace | Uniwind + vocabulary, per-platform geometry, fonts, icon registry, slim theme emit, Material You accent | None |
| Shell (drawer, pane, headers, back, search, tablets) | Rebuild | Drawer content from `NAV_DESTINATIONS` + attention feed, server switcher, pane with 7 contextual tabs, per-OS header, search palette, tablet split | Multi-server: client work + server id in pushes/links |
| Chats list | Redraw | status-glyph rows, All/Active/Archived, swipe + long-press menu, bulk select, keyset paging (chat list v2) | Pinned/unread chats, model name on rows: **missing** |
| Chat + composer | Redraw (largest) | Transcript blocks, tool block, gate cards, composer states (from the shared composer reducer), turn sheet, new chat, agent picker + capabilities | Per-chat "run workflows" toggle, per-chat capability overrides: **missing** |
| Workspace pane | Rebuild | Changes (+Keep/Undo, commit & PR sheet), diff with inline comments, files/preview, terminal + key row, browser (view-only stream + comment/capture), tasks + detail, plan revisions/comments, computer | Browser page comments: check; automation drafts n/a |
| Home | Redraw | three counts, Needs you / Running / Recently finished, weekly stats | Stats exist (G-10); avg run time + PR events **missing** |
| Projects | Redraw + new | project, codebases, worktrees, customization, skill detail, fetch logs, PR tab (desktop has it) | Fetch logs G-16, sizes G-17, per-project toggles G-19, remote branch list: **missing** |
| Agents | New | list, detail, orchestrator team, new/import, editor (one long form), delete-in-use | Import preview: **missing** |
| Automations & scripts | Redraw + new | list, detail, execution, 6-step create wizard, webhook credentials, scripts + run | Automation drafts, webhook rotate/reveal: **missing** |
| Workflows | Redraw + new (scope decision O-5) | list, detail, run sheet, run, approval, run pane, graph, loop; builder + 6 stage editor tabs | Most fields depend on Workflow Overhaul phases P01–P07; run numbers and per-workflow stats **missing** |
| Settings | Redraw + new | 15 desktop sections + 4 device rows (Notifications, App lock, Haptics, Widgets) | **Admin scope from a phone** (O-9); notification prefs server-side (quiet hours, digest, per-project) **missing**; 5 provider ids vs 2 drawn |
| Pairing & servers | Redraw + new | QR / code pairing (12-char code), server switcher with probe | `probeServer` exists (G-03); multi-session auth is client work |
| System surfaces | New native | notifications v2, Live Activity / Live Update, widgets, control/tile, quick actions, share-to-agent | Live Activity push tokens + gateway, question options in push, "Pause agents", share upload: **missing** |
| Tablets | New | breakpoints 600/840, persistent sidebar, docked pane, portrait/resizable windows (iOS 27 and Android 17 force resizability) | None |

---

## 5. Target architecture

### 5.1 Principles

1. **Shared contract, native implementation** (D-40 extended). Both apps implement the same things:
   - tokens and the class vocabulary;
   - status map, icon concepts, nav destinations, command registry, copy;
   - the ui-contract prop types for shared concepts (status badge, tool block, gate cards, composer states, pane tabs);
   - React-free read models and reducers.

   Web implements them with Base UI + Tailwind; mobile with Uniwind + Expo UI + RN.
2. **Native first for controls and chrome.** A control is JS-drawn only when:
   - the platform component is unreachable from RN today (Android M3 large top app bar, connected button group, swipe actions in a virtualised list); or
   - it is a domain surface (composer, transcript, diff, terminal).
3. **One prop contract per component.** Platform differences live in tokens first and in `.ios.tsx` / `.android.tsx` files second. Screens are identical code on both platforms.
4. **Logic out of screens.** Screens are presentational. Data comes from `features/*/queries.ts` hooks over client-core's typed API, and stream state from client-core reducers.
5. **No fake data** (D-36). A designed element whose API does not exist is not rendered until its gap lands.
6. **Enforced by construction**, as on web:
   - layer lint;
   - a design-class lint (no hex, no arbitrary values, no palette classes);
   - a ban on `Platform.OS` outside `ui/`;
   - a check that every icon concept has SF and Material names;
   - stories-present ratchet.
7. **Shared-foundation gaps to add** (not planned anywhere yet):
   - `GEOMETRY.ios` / `GEOMETRY.android` values;
   - a motion/spring vocabulary;
   - a haptic concept vocabulary;
   - glass material tokens;
   - `resolveAccentFromSeed` (Material You);
   - a shared deep-link allowlist (move `DEEP_LINK_QUERY_KEYS` out of `apps/desktop`);
   - an `AttentionItem → route` helper;
   - notification category/copy vocabulary;
   - a Live Activity state model;
   - ui-contract types for gates, tool verbs and pane tabs (from web P4-06/07; composer states already landed, D-61).
8. **Shared packages change additively.** The CLAUDE.md rule "never rewrite `packages/client-*`" holds. The timeline move, typed endpoints and the per-server runtime are additions, each logged in `COORDINATION.md` because the web pass and the Workflow Overhaul use the same packages.

### 5.2 Stack (evidence in the research files; versions checked 2026-09-26)

| Layer | Choice | Action | Why (short) |
|---|---|---|---|
| Runtime | 57.0.25 / RN 0.86.3 patch now; Expo SDK **58** (RN 0.88, React 19.3) as soon as stable, **before any kit code** | Upgrade (M1b) | SDK 58 breaks the exact layers the kit sits on: RNGH 3, router core, Expo UI Host alignment, generated SceneDelegate, R8. Tooling, characterization flows and logic extraction don't need 58 and start on 57 (M1a). `stack-native-platform.md` recommends "redesign on 57, bump later"; rejected because it means writing the kit twice |
| Compiler | React Compiler (`experiments.reactCompiler`) | Add after the SDK upgrade, once characterization flows are green | Automatic memoisation for LLM-written code. Web defers it (D-37) because switching memo semantics *mid-rewrite* hides regressions; on mobile it is switched on *before* the rewrite, against green flows. Needs a mobile D-xx. If flows regress, defer as web did |
| Styling | **Uniwind** (OSS tier) + Tailwind 4.3.3 + shared `vocabulary.css`; `tailwind-merge` with web's generated config | Replace NativeWind 4 | Only stable Tailwind-4 engine for RN; same Tailwind as web; theme APIs fit 36 variants + runtime accent. Gates: #686 release, SDK 58 spike. Fallback NativeWind 5 (still RC, pins TW 4.1.12) |
| Primitives | In-house kit seeded from React Native Reusables copy-ins (Button, Badge, Input, Textarea, Checkbox, Progress, Skeleton) and restyled; `@rn-primitives/*` where a copy-in needs it | Add | shadcn names mirror the web kit; matches 08 §4 M1 |
| Native controls | **`@expo/ui`** (SwiftUI / Jetpack Compose): Menu, ContextMenu + Preview, Toggle/Switch, segmented Picker / SegmentedButtonRow, Slider, Date pickers, ExposedDropdown, Android ExtendedFAB, LoadingIndicator | Add | Exact native geometry, haptics, system font, Liquid Glass / M3 for free |
| Navigation | expo-router native **Stack** + `Stack.Toolbar` (iOS glass header buttons), `formSheet` route sheets, `fullScreenModal` editors, `Link.Preview`/`Link.Menu`, `Link.AppleZoom` | Keep, extend | Native push/back/sheets |
| Drawer + pane | In-repo **`SidePanel`** (Reanimated + RNGH), ported to RNGH 3 hooks | Keep | expo-router Drawer is also JS and single-sided; Bluesky ships the same shape |
| Sheets | Two mechanisms only: `formSheet` for route sheets; **TrueSheet** 3.11.x (→ 4) for imperative sheets. Expo UI BottomSheet not used | Add; remove `@gorhom/*` (unused already) | Real system sheet controllers with glass/M3 and keyboard handling |
| Lists | `@legendapp/list` 3.4 (transcript tuned on it); `react-native-reorderable-list` for drag-reorder; RNGH swipeable for row actions | Upgrade / add | Best chat APIs; FlashList has open chat-scroll bugs |
| Icons | `expo-symbols` (SF Symbols on iOS, **Material Symbols on Android since SDK 55**), lucide 1.48 for domain glyphs (git, diff, providers) via `lucide-react-native/icons/*` | Add / upgrade | One concept registry; filled Material symbols need SVG fallback (expo#46850) |
| Fonts | `expo-font` config plugin; Instrument Sans (content), JetBrains Mono (code), system font for native chrome; variable fonts on 58 | Add | Fixes missing mono font; no FOUT |
| Glass | `expo-glass-effect` for our own floating chrome only | Keep | Native chrome gets glass automatically on the iOS 27 SDK (no opt-out) |
| Keyboard | `react-native-keyboard-controller` (KeyboardChatScrollView, interactive dismissal) | Keep | Already used |
| Haptics | `expo-haptics` (covers the full iOS + Android vocabulary) | Keep | — |
| Markdown | Spike **`react-native-enriched-markdown`** fed block-by-block from the existing `markdownModel` segmenter; keep `marked` model | Spike | Native selection/copy, highlighting; re-parses whole docs (#391) → per block |
| Terminal | xterm.js 6 in `react-native-webview` (14 with SDK 58) + native key row | Keep | One emulator both platforms |
| Graph | react-native-svg + Reanimated/RNGH pan-zoom; Skia only if a board proves too heavy | Keep | Binary size vs need |
| Images | `expo-image` | Add | Caching, SVG, placeholders |
| State/data | TanStack Query 5 (+ `focusManager`/`onlineManager`, MMKV persister), zustand 5, MMKV 4, client-core reducers | Keep, wire | Focus refetch is inert today |
| System surfaces | `expo-widgets` (iOS widgets + Live Activities; Android widgets on 58), custom Kotlin module for Android 16+ Live Updates + QS `TileService`, `@bacons/apple-targets` (Control Center), `expo-quick-actions`, `expo-share-intent` (**peer `expo ^57`; gate on a 58-compatible release, fallback a small share-extension target**), `expo-screen-capture` (iOS app-switcher), extend `generatorai-device-key` (biometric-gated approval key, `setRecentsScreenshotEnabled`, hardware key commands, gesture-exclusion band) | Add / build | First-party where possible; small in-repo Kotlin/Swift where no maintained library exists |
| Dev build | `expo-dev-client`, `@expo/fingerprint`, `expo-updates` (if EAS channels are meant to work) | Add | EAS profile already assumes a dev client |
| Rejected | Tamagui, Unistyles, gluestack, zeego (stale), FlashList, Detox/Appium, react-native-web as product surface, Notifee (archived), expo-router Drawer, predictive-back `ExperimentalStack` (alpha, no sheets) | — | See research files |

### 5.3 Code structure and layers (mirrors web; lint-enforced with `eslint-plugin-boundaries`)

```text
apps/mobile/
  app/                         thin route files: layout, presentation options, re-export feature screens
  src/
    ui/                        presentational kit — no queries, stores, platform services, router
      primitives/              Text, Icon, Pressable, Button, IconButton, Badge, StatusBadge, Chip, TextField …
      native/                  wrappers over @expo/ui & router controls: Switch, Segmented, Menu, ContextMenu,
                               Picker, Slider, DatePicker, Sheet, ConfirmDialog, NewAction (.ios/.android/.tsx)
      layout/                  Screen, Header, Breadcrumb, SidePanel, PaneShell, ListSection, AdaptiveLayout …
      platform/                THE ONLY place that branches on OS: geometry(), haptic(), gestures policy,
                               glass availability, reduce-transparency/motion, breakpoints
      lib/                     cn(), useThemeColors(), testID helpers
    blocks/                    query-aware parts used by ≥2 features: Composer, TranscriptView, ToolBlock, GateCards,
                               AttentionList, ServerSwitcher, SearchPalette, ModelPicker, AgentPicker, pane tabs …
    features/<area>/           screens + domain components + queries.ts (data hooks) — no cross-feature imports
    services/                  (today's auth, transport, stream, notifications, native, storage, voice) — stable data layer
    theme/                     Uniwind global.css, generated theme CSS, ThemeProvider (setTheme / updateCSSVariables)
    stories/                   (or co-located *.stories.tsx) on-device Storybook
```

Rules:
- `ui` imports nothing above it.
- `blocks` never imports `features`.
- Features never import each other.
- `Platform` may be used only in:
  - `ui/platform` and `ui/**/*.ios|android.tsx`;
  - `services/notifications` (Android channels) and `services/native` (module bindings).
- Data only via `queries.ts` hooks or client-core stores.
- Routes contain no logic.
- Names match the web kit wherever the concept is shared (Button, IconButton, Badge, StatusBadge, Chip, Input, SearchInput, Textarea, Separator, AlertDialog, Sheet, Menu, Breadcrumb, EntityRow, StatTile, BulkActionBar, GateCard, StepRow, ToolCallCard), so one design contract describes both.
- Mobile-only components get new names: ListSection, SidePanel, PaneShell, NewAction, AdaptiveLayout, KeyRow.

### 5.4 Component system (consolidated)

The legend for "impl" is:

| Code | Meaning |
|---|---|
| **N** | Native via Expo UI or router |
| **J** | JS-drawn on Uniwind |
| **P** | One contract, platform files |

**Primitives (≈32).**

| Component | Impl | Notes |
|---|---|---|
| Text | J | roles → iOS text styles via `dynamicTypeRamp` / Android sp with per-role `maxFontSizeMultiplier` caps; mono; tabular numerals |
| Icon | P | concept → `SymbolView` (SF / Material) or lucide |
| Pressable | J | press-scale (iOS) / ripple (Android) + haptic concept |
| Button | J | primary(ink) / secondary / ghost / destructive × sm/md; iOS capsule h44, Android h40 |
| IconButton | P | iOS glass circle 44 / Android 48 |
| Badge, StatusBadge, StatusDot, Count | J | from the shared status map (8 states incl. Skipped) |
| Chip, ChipGroup | J | iOS r16 h32 / Android r8 h32; 44/48 hit area |
| Input, SearchInput, Textarea | J | one spec per platform (resolves 5 drawn variants) |
| Switch | N | Toggle 51×31 / M3 Switch 52×32 |
| Checkbox, Radio | J | Android single-choice indicator decided once |
| SegmentedControl | N/P | iOS segmented Picker; Android SingleChoiceSegmentedButtonRow (connected ButtonGroup later); overflow → Menu at large text |
| Picker / Select | N | Menu-style picker / ExposedDropdownMenu |
| Slider, DatePicker | N | |
| Menu, ContextMenu | N | UIMenu + preview / M3 DropdownMenu anchored on long-press |
| AlertDialog | N | RN Alert / Compose AlertDialog |
| Toast / Snackbar | J | errors, background completions, undo (O-12) |
| Spinner, ProgressIndicator, ProgressSegments | P | Android Expressive LoadingIndicator |
| Skeleton, EmptyState, ErrorState, OfflineState, PermissionState | J | recipes for the missing states |
| GlassSurface | P | iOS floating chrome only; opaque `overlay` + `line` fallback |
| Separator, AgentGlyph | J | No monogram avatars ("names, not initials") |

**Layout and shell (≈16).**

| Component | Impl | Notes |
|---|---|---|
| Screen | J | safe areas, edge-to-edge, scroll, keyboard, large-title collapse |
| Header | P | iOS: native header + `Stack.Toolbar` glass items + custom title view (breadcrumb + title + status line). Android: JS M3 top app bar (small/medium; collapsing) |
| Breadcrumb, StatusLine | J | every segment tappable; middle collapse |
| SidePanel, Drawer, PaneShell, PaneTabStrip | J | pill tabs iOS / underline Android; count badges; full screen |
| NewAction | P | glass capsule 52 / ExtendedFAB 56 |
| Sheet | N | `formSheet` or TrueSheet; detents; dirty-dismiss guard |
| FullScreenEditor | N | `fullScreenModal`; Cancel / Save in header; no swipe dismiss |
| ListSection, ListRow | P | grouped inset iOS / flat M3 Android; row kinds: navigation, toggle, value, picker, destructive, info |
| EntityRow, SwipeRow, ReorderList | J | swipe actions mirrored in menu + a11y actions; long-press opens the menu (multi-select enters from the header "Select"; one meaning per gesture) |
| AdaptiveLayout | J | phone / tablet 600 / 840 breakpoints; persistent sidebar and docked pane |
| StatTile/StatStrip, KeyValueList, SectionHeader, Stepper (wizard), FormSection, StickyActionBar, FactStrip | J | |

**Blocks (≈24).**
- Composer (states from the shared composer reducer, attachments, slash popover, dictation pill, agent/model chips)
- TurnSheet, ModelPicker, AgentPicker (+ capability customiser), NewChat
- TranscriptView, UserMessage, AgentTurnHeader, AssistantText (markdown), ToolCallCard/StepRow (the design's "tool block": consecutive calls as one step), StepDetail
- GateCard family (permission, question, plan, computer consent)
- InlineError, DelegationGroup, chat run/approval/draft cards
- AttentionList, ServerSwitcher, SearchPalette, BulkActionBar
- Pane tabs: ChangesPanel (Keep / Keep all / Undo all, commit bar), CommitSheet, DiffView (+ inline comment), FileTree/FilePreview, TerminalView + KeyRow, BrowserView, TasksList/TaskDetail, PlanView, ComputerView, CheckpointScrubber
- RunTimeline/StageRow, DecisionCard, RunGraph

**Features.**
- Home
- Chats
- Projects (codebase, worktrees, customization, skills, logs, PRs)
- Agents (detail, team, editor, import)
- Workflows (detail, run sheet, run, approval, run pane, graph, loop; builder and stage editor per O-5)
- Automations (detail, execution, wizard, webhook)
- Scripts
- Settings (15 + 4)
- Pairing, Servers

**Native extension targets (not RN views).**
- LiveActivity (SwiftUI)
- Widgets (small / medium / large)
- ControlWidget (iOS)
- QS Tile (Android)
- Live Update (Android notification `ProgressStyle`)
- Notification categories
- Quick actions
- Share target

### 5.5 How OS-specific behaviour is handled

| Concern | iOS 27 | Android 17 | How it is built |
|---|---|---|---|
| Header | native stack header, glass circle buttons, large title | JS M3 top app bar (native one double-counted status bar before) | `ui/layout/Header.ios.tsx` / `.android.tsx`, one prop contract |
| Back | chevron + native edge swipe | arrow + system back; **predictive back stays off** (expo#39092 open; screens v4 cannot animate it) | router; D-xx deviation until screens v5 |
| Open drawer | edge swipe **only on root screens** (on detail, left edge = back) | **button only** (system owns both edges; exclusion capped at 200 dp) | `ui/platform/gestures.ts` policy |
| Pane | button + drag-to-close inside the pane; scrim tap; Esc/Back closes | same | `SidePanel`; horizontal scrollers block the panel pan |
| New | glass capsule | extended FAB | `NewAction` |
| Sheets | inset glass, detents | edge sheet (formSheet max 3 detents; no nested stack) | `Sheet` |
| Menus | context menu + preview | long-press anchored M3 menu | `Menu`, `ContextMenu` |
| Controls | Toggle, segmented Picker, Slider | M3 Switch, segmented button row, Slider | `ui/native/*` |
| Dialogs | Alert | AlertDialog | `AlertDialog` |
| Lists | grouped inset | flat M3 | `ListSection` platform token set |
| Swipe / reorder | JS swipe (+ haptic at threshold), drag handle | same | `SwipeRow`, `ReorderList` (+ menu + a11y actions) |
| Haptics | selection / impact / notification | `AndroidHaptics` constants (API-level fallbacks) | shared `HAPTICS` concept map → `haptic(concept)`; success only on server confirm |
| Surfaces | glass on floating chrome | tonal layers | tokens + `GlassSurface` |
| Type | Dynamic Type ramp (`dynamicTypeRamp`) | sp scale with per-role caps | `Text` roles from `GEOMETRY.ios/android` |
| Icons | SF Symbols (+ effects for running) | Material Symbols (SVG for filled) | `Icon` concept registry |
| Accent | 7 accents | 7 + System (Material You, Android 12+) | `resolveAccentFromSeed` + MMKV cache |
| System bars | status bar style by theme | edge-to-edge (mandatory), nav bar contrast | ThemeProvider; `expo-navigation-bar` if needed |
| Keyboard | interactive dismissal, sticky composer; iPad hardware shortcuts from `COMMANDS` | same; hardware keyboard on tablets/Chromebooks | keyboard-controller; device-key module key commands |
| Biometrics | Face ID prompt; risky approvals signed by a biometric-gated Secure Enclave key (server-verifiable) | BiometricPrompt; StrongBox key with user-auth | extend `generatorai-device-key` |
| App lock / privacy | lock on resume; app-switcher blur (`expo-screen-capture`) | `setRecentsScreenshotEnabled(false)` / FLAG_SECURE | existing `AppLock` + module call |
| Notifications | categories, auth-required actions, text reply, time-sensitive, threads | channels, actions, grouping | `expo-notifications`; shared category vocabulary |
| Live progress | Live Activity (Dynamic Island + lock screen) | Live Update (`ProgressStyle`, promoted ongoing) | `expo-widgets` / Kotlin module fed by one shared state model |
| Widgets / controls | WidgetKit, ControlWidget | Glance widgets (SDK 58 expo-widgets), TileService | native targets + App Group / shared prefs |
| Shortcuts / share | quick actions, App Intents (58, alpha), share extension | app shortcuts, share target | `expo-quick-actions`, `expo-share-intent` |
| Tablets | resizable windows (iOS 27 ignores `UIRequiresFullScreen`), pointer hover | large screens ignore orientation locks (API 36) | `AdaptiveLayout` breakpoints, all orientations |
| App icon / splash | light, dark, tinted, clear icon variants; splash per appearance | adaptive + **monochrome** themed icon; splash per appearance | config + assets |
| Deep links | `generatorai://` + shared allowlist; pairing entry | same | shared constant, router linking. No universal links exist, so any app can claim the scheme: a `pair` link only pre-fills the code and never auto-submits; every link is untrusted input |
| Permissions | camera, mic, local network, notifications, Face ID strings | camera, mic, notifications, biometrics | per-feature `PermissionState` recipes |

### 5.6 Theming and tokens

1. **Generator (keep the custom emitter; no Style Dictionary).** Add:
   - `emit/uniwind.ts` producing 36 `@variant <theme>-<mode>` blocks of `--gai-*` plus `@variant ios|android` geometry blocks, with `UNIWIND_THEMES` exported for Metro;
   - `accentVars(theme, mode, accent)`;
   - `resolveAccentFromSeed()` for Material You (the same `ensureContrast` rules as named accents).
2. **Runtime.**
   - Call `Uniwind.setTheme('<theme>-<mode>')` and `Uniwind.updateCSSVariables(accentVars)`.
   - Theme previews use `ScopedTheme`.
   - The theme is set before first paint (keep hold-splash-until-hydrated).
   - Theme changes stop re-rendering the tree: colours come from CSS variables, and icons read variables instead of 530 `colors.x` props.
3. **Literal colours** for native hosts (Expo UI `seedColor`/colors, TrueSheet background, status/nav bar, xterm, widgets, Live Activities):
   - `useThemeColors()` reads the resolved literals for the active theme only;
   - the 915 KB all-theme module is split, so one theme is loaded at a time;
   - widgets and Live Activities get the current palette through the App Group / shared prefs on each change.
4. **Geometry.** Fill `GEOMETRY.ios` / `GEOMETRY.android`: type ramps with iOS `ramp`, radii (iOS concentric / M3 shape scale), heights, targets 44/48, switch sizes, shell widths (phone and tablet). The same class (`text-body`, `rounded-card`, `h-row`) then resolves per platform, so a screen's markup is identical on both.
5. **Motion and haptics.**
   - `MOTION` gains per-concept springs `{ reanimated, m3 }`, plus reduced-motion variants.
   - `HAPTICS` maps each concept to its iOS and Android primitives.

### 5.7 Navigation and shell

- **One native Stack** under an app shell of two `SidePanel`s.
- **Window-size classes:**

  | Width | Left `SidePanel` | Right `SidePanel` |
  |---|---|---|
  | Compact < 600 | drawer over a scrim | pane over a scrim |
  | Medium 600–839 | persistent drawer (sidebar) | overlay pane |
  | Expanded ≥ 840 | persistent sidebar (iPad 312 / Android 300) | docked pane (410 / 400) |

  - Widths are the design's; on phones they are also capped as a share of the window (MFoundations: sidebar 79–82 %, pane 89 %).
  - iOS 27 and Android 17 force resizable windows, so the size class changes at runtime. **Panels and their content (terminal, WebView, transcript) are never remounted by a size-class change**: the tree stays stable and only the presentation changes. This is the mobile twin of D-27's stable tree.
- **Screen roles:**
  - top-level module: sidebar toggle + large title (iOS) / title in bar (Android);
  - detail: back + breadcrumb;
  - chat and run: detail + pane toggle with count.
  - Sheets are routes (`formSheet`) where they deep-link, otherwise imperative (TrueSheet).
  - Multi-step editors are `fullScreenModal`.
- **Search palette.** A route modal fed by `COMMANDS` + `NAV_DESTINATIONS` + server search. The same commands feed quick actions, iPad hardware shortcuts and App Intents.
- **Multi-server.**
  - One `AuthenticatedClientRuntime` per paired host.
  - Session storage keyed by server id.
  - `probeServer` for the switcher.
  - The server id travels in push payloads, Live Activities and deep links.
  - This is auth work, and it is scheduled before shell UI.
- **Deep links.** A shared allowlist and an `AttentionItem → route` helper, used by notifications, widgets and Live Activities alike.

### 5.8 Data layer and shared-logic extraction (before redrawing)

1. `deriveTimeline` + tool presentation/folding → `client-core`, one implementation for web and mobile. Coordinate with web P4, which rebuilds the chat workspace.
2. 79 hand-written endpoints → typed `createApiClient` methods + shared query-key factories.
3. Data hooks out of `app/` → `features/*/queries.ts`.
4. The 13+ status maps → `packages/shared/src/status`; the 4 icon maps → the concept registry.
5. Adopt the landed read models: attention feed, chat list v2 (keyset paging, server search), `buildModelPickerCatalog`, computer consent model, stats, activity, system info, project summary and runs.
6. Adopt the composer reducer and the ui-contract types from web P4 (P4-02 / P4-06 / P4-07) instead of mobile's `useComposerController` logic.
7. TanStack Query `focusManager` (AppState) + `onlineManager` (NetInfo in this analysis; superseded by MD-89: server reachability, no NetInfo), plus an MMKV query persister for cold-start lists.
8. Fix `IPlatformClient.downloadArtifact`'s `Buffer` type before mobile calls it.

### 5.9 Heavy surfaces

| Surface | Engine | Notes |
|---|---|---|
| Transcript | Legend List 3.4 (`alignItemsAtEnd`, `maintainScrollAtEnd`, keyboard entry) | Keep the tuned list contract; redraw rows; React Compiler + memoised rows |
| Markdown | spike `react-native-enriched-markdown` per block; fall back to the current model → RN tree | Selection/copy is a real UX gain |
| Code / diff / file preview | native virtualised lines + existing `highlight.ts` (bounded) | Design is monochrome; decide syntax colour (O-19) |
| Terminal | xterm.js in WebView + native key row (one spec incl. ^C) + pinch font 10–20 | Owns gestures and keys (mobile twin of D-46) |
| Browser / computer | server-streamed frames (`expo-image`), view-only with capture + comment | Matches today's architecture |
| Run / builder graph | RN views for nodes + SVG edges + Reanimated pan-zoom | Skia only if needed |
| Voice | existing PCM → server WS pipeline; new dictation UI | `expo-speech-recognition` optional |

### 5.10 System surfaces

- **One shared "live run/turn" state model** in client-core feeds all of these:
  - in-app status;
  - notification copy;
  - Live Activity / Live Update content;
  - widgets.
- **Update paths:**
  - **Local, phase 1:** the app starts, updates and ends activities while it has a stream. When iOS suspends it, the activity goes stale (`staleDate`).
  - **Remote, phase 2:** needs push-to-start/update tokens registered with the server, and a gateway that holds the APNs key. The Expo Push Service has no documented Live Activity support. Android Live Updates can use FCM data messages through the same gateway.
- **Notifications v2:**
  - categories: approve/deny, answer with options, reply;
  - interruption levels (time-sensitive for Needs you), grouping by chat or run, badges from `attention.counts`;
  - risky actions open the app for biometric-signed confirmation instead of acting from the lock screen (O-14).
- **Lock-screen privacy.** Notifications, widgets and Live Activities show titles and states only. Code, commands and message text are redacted unless the device is unlocked, following the App lock setting.
- **Widgets, controls and tiles.**
  - Widgets read a snapshot the app writes to the App Group.
  - The "New chat" control or tile deep-links into the app.
  - "Pause agents" needs a server endpoint (O-17).

### 5.11 Accessibility

- 44 pt / 48 dp **hit** areas. The kit enforces them through `hitSlop` and min sizes, whatever size the element is drawn at.
- Rows use min-height, never fixed height. Content scales fully; dense chrome is capped (1.4–1.6×).
- Text is at least 11 pt / 12 sp; weights are 400/500/600 only.
- Status is always glyph + word; contrast is 4.5:1 for text, 3:1 for glyphs.
- Every swipe and long-press is also a VoiceOver/TalkBack custom action, a visible button or a menu item.
- Reduce Motion turns springs into fades and freezes spinners. Reduce Transparency makes glass opaque; iOS reports it, Android always reports false.
- An open drawer or pane traps screen-reader focus (`accessibilityViewIsModal` on iOS, `importantForAccessibility` on the content behind it on Android), and Escape / two-finger Z closes it.
- Android 14+ scales fonts non-linearly, so per-role caps are tested at font scale 2.0, not assumed from iOS.
- No i18n in this pass (inherits D-39), but layouts use start/end (never left/right) and all dates, numbers and durations go through `Intl`, so RTL and translation stay possible.
- Tests assert labels, roles and target sizes from the accessibility snapshot. XCUITest `performAccessibilityAudit` runs once per batch, plus a Dynamic Type sweep (AX5 / font scale 2.0).

### 5.11a App lifecycle, background and offline

| Situation | iOS | Android | Contract |
|---|---|---|---|
| App in background | The stream is suspended within seconds; no background streaming | The stream stops when the process is cached. Only a Live Update runs a foreground service (`specialUse` type with a Play Console justification; Android 15+ time limits apply to `dataSync`, so it is not used) | Push is the only channel while backgrounded (the MAudit known defect becomes the rule, not a bug) |
| Return to foreground | Reconnect the mux stream; catch up unfinished turns (`useTurnCatchUp`); refetch attention and lists through the TanStack `focusManager` | same | One resume routine in `services/stream`; the UI shows "Reconnecting" through `streamHealth`, never stale "Running" |
| Offline / server unreachable | `onlineManager` (server reachability, MD-89); persisted lists render read-only with an offline banner; actions disabled with a reason | same | No optimistic writes for approvals |
| Badges | from `attention.counts` in push payloads | launcher badge where supported | one source |
| Live progress | Live Activity updated locally while the app runs; `staleDate` when suspended; remote updates need O-15 | Live Update through the FGS while a run is active | shared live-state model (§5.10) |

### 5.11b Store compliance and observability

- **iOS:**
  - `PrivacyInfo.xcprivacy` required-reason APIs (MMKV/UserDefaults, file timestamps, boot time);
  - entitlements: App Groups, Time Sensitive Notifications, `NSSupportsLiveActivities`, push;
  - icon variants.
- **Android:** the Play Data Safety form, the foreground-service declaration for Live Updates, notification and biometric permissions, and the large-screen quality checklist.
- **App Review:** the app is unusable without a paired server. Provide a reviewer demo server (or a scripted demo mode against a sandbox) and review notes.
- **Crash reporting and diagnostics:** there is none today.
  - SDK 58 turns on R8, so release builds need mapping and dSYM upload for readable stack traces.
  - Decision O-23: an opt-in crash reporter (self-hostable, e.g. Sentry or GlitchTip) or none. Settings › Diagnostics already exists as the home for the toggle.

### 5.12 Verification and tooling (LLM-operable)

- **Machine prerequisites** (the Mac is not ready today):
  - Xcode 27 selected: `xcode-select` points at the Command Line Tools **today** and must be switched (an owner action, needs sudo);
  - JDK 17;
  - `adb` on PATH;
  - Android 36 (+37) images and AVDs for phone and tablet;
  - pinned iOS simulators (iPhone Pro, 13" iPad).
- **Tools:**
  - `agent-device` (Callstack, 0.21.x): the per-task driver. It reads the accessibility snapshot, taps by ref/role, switches dark mode and text size, captures screenshots and logs, and reloads Metro.
  - **Maestro** 2.10: committed flows per feature; these replace the web-preview Playwright scripts one by one.
  - **On-device Storybook RN 10.6** (+ experimental MCP): replaces `gallery.tsx`; every `ui/` and `blocks/` component gets stories for all variants × states × platforms.
  - **Jest + jest-expo + RNTL 14** for `ui/` and `blocks/` contracts; **Vitest** stays for logic.
  - **VRT:** Storybook story captures on both platforms diffed with `odiff`, batched. Theme combinations are covered by unit tests + one theme-matrix story, not by multiplying screenshots.
  - The Expo Claude Code plugin (skills + MCP) and optional Argent for profiling.
- **Per-task Done loop** (fast; follows the owner's batching rule; details in `research/stack-engineering.md` §10):
  1. typecheck, lint, check:design;
  2. related Vitest/Jest;
  3. rebuild natively only when `@expo/fingerprint` changes, otherwise reload Metro;
  4. a short agent-device look at the **new** UI on both platforms in the default appearance: accessibility snapshot (labels, roles, targets) and no new log errors;
  5. write or port the feature's Maestro flow (not the full suite).
- **Per batch:**
  - the appearance matrix (light/dark × default/AX text × Instrument + one other theme) on both platforms, with side-by-side against the iOS and Android board variants → `DIFF.md`;
  - VRT and the full Maestro suite;
  - a release-build perf check (transcript scroll + streaming);
  - the XCUITest a11y audit and the Dynamic Type sweep;
  - a system-surface smoke.
- **On Windows or Linux:** the loop runs Android only (emulator + agent-device + Maestro). iOS verification then comes from an EAS build + Maestro job, or from the next macOS batch run. Scripts are Node (`.mjs`) per the cross-platform rule.
- **Legacy web-preview e2e scripts** are frozen, not repaired. Each is deleted when the Maestro flow for its screen lands.
- **Xcode 27 caveat:** Device Hub replaced Simulator.app. This breaks Claude Code's simulator panel (issue #95085), XcodeBuildMCP UI automation and Maestro Studio's live view. `xcrun simctl`, agent-device and the Maestro CLI work.

### 5.13 Build and release

- Keep **CNG**. Native targets come from config plugins (`expo-widgets`, `@bacons/apple-targets`, in-repo plugins for the Kotlin module and TileService).
- Add `expo-dev-client`, and `expo-updates` with a fingerprint runtime policy if OTA is wanted.
- App Store: iOS 27 SDK (Liquid Glass mandatory, scene lifecycle — the SDK 58 prebuild generates it, so remove `withSceneLifecycle`).
- SDK 58 shows notifications in the foreground by default: set `setNotificationHandler` explicitly so a Needs-you push doesn't duplicate the in-app banner.
- Google Play: target API 36 (edge-to-edge mandatory, 16 KB pages, large-screen resizability), and R8 on by default in SDK 58, so release-mode smokes are needed.
- Icons: iOS dark/tinted/clear, Android monochrome. Splash follows appearance.

---

## 6. Design corrections to request before build (round 3 feedback)

These go back to the design artifact as a feedback list, as `11-design-feedback.md` did for web. Items marked ★ contradict binding decisions.

1. **Chat header** uses the sidebar toggle. Principle 3 and the owner's earlier "detail screens (a chat included) show Back" say back + breadcrumb.
2. **Composer** contradictions:
   - Send enabled vs disabled when empty;
   - Send while a gate is pending (★ D-29 "Cancel & send");
   - "Queue a follow-up…" placeholder (★ D-29, no queue);
   - Android mic position.
3. **Turn sheet** has two definitions ("Turn setup" rows vs "Next turn" with provider/context gauge); "Done" is ink.
4. **New chat** is drawn full-screen but listed as a sheet in the IA.
5. **Pane tabs** are always 7; ★ D-27 makes Tasks/Plan/Computer contextual. Instances are chips inside the tab (accept for phones).
6. ★ **Keep / Keep all / Undo all** (D-28) are missing from Changes. Discard and Kill have no confirm.
7. ★ **Status map** lacks Skipped/Cancelled (D-18). Starting / In review / Completed / Draft need mapping.
8. ★ **Theme copy** says 17 × 6; D-11 is 18 × 7. The Appearance previews stay dark in light mode.
9. **"One ink action"** is broken on ~30 screens (Commit, Create PR, Create, Save, Start chat, Review, Continue …). Restate as "one filled primary per screen". Unify destructive styling (3 variants drawn).
10. **Status colours on non-states:** worktree Active/Orphaned, MCP Custom, risk levels, capability chips, guard syntax, tinted rows and banners.
11. **Touch targets below 44/48** (composer 34 with Mic/Send 4 pt apart, Home "Review" 34, drawer rows 40/36, sheet close 30–32, search clear 20, attachment ✕ 14, pane header buttons 40, key-row keys, drag handle 36×28, rows 44 < 52).
12. **Text below minimum:** pane badge 10–11, Android 11 sp in widgets/timers, mono 11 in several panes. There is also weight 700 in the search highlight.
13. **Inconsistent controls:** search field sizes, iOS segmented selection colour, iOS off-switch thumb, Android single-choice (radio vs ✓), gate-card shell, primary heights 44/48/50, Android row swipe shape, Chats header actions, Android pane header 52 vs 64, Android builder header with 3 icons.
14. **Gestures:**
    - Android left-edge drawer swipe conflicts with system back.
    - A pane body swipe to switch tabs conflicts with drag-to-close and with horizontal content.
    - The terminal key row is drawn 3 ways (^C missing on phone).
15. **Segmented controls with 5–6 segments** (stage editor, workflow settings, effort) break at large text → scrollable tabs or a menu.
16. **Pairing:**
    - the code must be 12 chars (3×4);
    - "Share address and code" contradicts the screenshot warning;
    - "Custom" exposure is unsupported;
    - 25 scopes, not 22;
    - "Restart server" has no endpoint.
17. **Providers:** 5 server providers, not 2; add Sign in / Make default. The project **Pull requests** tab is missing (desktop D-31).
18. **Presentation drift:**
    - builder, agent editor and MCP add are drawn pushed but specified as full-screen modals;
    - the approval is drawn pushed but specified as a sheet;
    - four approval surfaces for one gate.
19. **"Control Center / Quick Settings" switch:** apps can't toggle these. Redraw as guidance + "Add tile".
20. **Missing states** (derive by D-32 recipes or draw):
    - empty / loading / error / offline everywhere;
    - bulk select;
    - permission denied (camera, notifications, biometrics);
    - pairing success;
    - scope request pending/approved/denied;
    - revoked device;
    - Live Activity end states;
    - run failed/cancelled/paused;
    - commit progress/error;
    - read-only admin states;
    - tablets in portrait / split / resizable.
21. **Workflow builder on phone:** no edge editing, undefined reorder semantics, board data drift (variables 5 vs 6, hooks 1 vs 2 …).
22. **Gesture meanings to pin down:**
    - long-press is drawn as both "menu" and "multi-select";
    - the pane-toggle count badge has no defined meaning (changes vs tasks);
    - Android `REJECT` haptic is used for both "denied" and "run failed";
    - no iOS pull-to-refresh and no toast swipe-to-dismiss are drawn.

---

## 7. Decisions for you (with my recommendation)

| # | Decision | Recommendation |
|---|---|---|
| O-1 | Stay on RN/Expo or go native Swift/Kotlin | **Stay on RN/Expo** (§1.1) |
| O-2 | Styling engine | **Uniwind** (gated); NativeWind 5 fallback; re-check both at kickoff |
| O-3 | SDK timing | Tooling, characterization flows and logic extraction on 57 (M1a, M2); **latest stable SDK (58, or 59 if out) before any kit code** (M1b) |
| O-4 | When mobile starts, and where | Your override says redesign work lands on `desktop_redesign` in the main checkout. A branch can't be checked out in two worktrees, and two sessions in one working tree collide. Options: **(a, recommended)** start mobile after the web pass (or after its P5 + P6 batch), same branch and checkout, mobile-only paths. (b) Run M1a now from another device on `desktop_redesign`, as the Workflow Overhaul does, logging shared-package changes in `COORDINATION.md`. (c) Reverse the override for mobile only: a `mobile_redesign` branch in its own worktree, merged at each batch end. Kit and screens need web P4-06/07 (pane/gate contract types) either way; workflows need the Workflow Overhaul |
| O-5 | Workflow builder + stage editors on phone | **Phone:** view, run, approve, run pane and graph read-only, plus simple field edits in the stage editor (prompt, model, policy values) on the list builder. **No edge editing on phone.** Full builder on tablet ≥ 840 dp later. Supersedes "builder stays on desktop" only partly |
| O-6 | Chat screen header | **Back + breadcrumb** (detail), per principle 3 and your earlier rule |
| O-7 | Android drawer gesture | **Button only** (plus iOS root-only edge swipe) |
| O-8 | Predictive back | **Keep off** until react-native-screens 5 / RN support; record as a deviation |
| O-9 | Settings from a phone (admin scopes) | **Read-mostly with "Requires admin · Request access"** rows, using the existing scope-request flow (`/auth/devices/me/scope-requests`). Writes are allowed once granted, each behind biometric step-up. No admin preset at pairing. Needs one API change: self-service **read** routes, because listing devices and requests currently needs `admin:devices` |
| O-10 | Ink rule | Amend to **"one filled primary action per screen"** (Send/Approve/Run keep priority where present) |
| O-11 | Selected state & pills vs your saved "blue-tinted controls, no pills" preference | **Follow the new design**: desktop moved to ink/neutral selection, so parity now means neutral. Pills where the platform uses them (iOS chips/tabs/buttons, Android buttons and nav items). Your saved preference gets updated after you confirm |
| O-12 | Undo toasts on mobile (desktop D-30 forbids) | **Allow undo snackbars for reversible destructive actions only** (platform idiom) |
| O-13 | Material You accent | **Add** as Android-only runtime accent; never touches status colours; desktop unaffected |
| O-14 | Risky approvals | Lock-screen actions for ordinary approvals (device unlock). **Risky ones open the app and sign with a biometric-gated key** the server verifies. Server flags "risky" |
| O-15 | Live Activity / Live Update remote updates | **Phase 1 local-only**; phase 2 a small push gateway beside `apps/relay` holding the APNs key (and FCM) if you want lock-screen progress while the app is suspended |
| O-16 | Multi-server | **Adopt** (auth work first; server id in pushes/links) |
| O-17 | New server features from the design: pinned/unread chats, model on rows, Pause agents, weekly averages, per-chat workflow toggle & capability overrides, scope requests, question options in push, share upload, automation drafts, webhook rotate, notification prefs (quiet hours, digest, per-project), dictation language, server logs | Treat each as an API-first gap (D-36), with **desktop parity** for anything that isn't platform-native. Pick which ship in the mobile pass vs later. **Suggested in:** pinned/unread, model on rows, self-service device reads, question options in push. Scope requests and webhook rotate are already server-side. **Later:** digest, quiet hours, per-project levels, Pause agents |
| O-18 | New chat presentation | **Sheet at the large detent**, same content as drawn |
| O-19 | Syntax colour in diff/file preview | **Add** token-based highlighting (desktop parity); design is monochrome |
| O-20 | Tablet scope | JS adaptive layouts at 600/840 breakpoints, all orientations, resizable; iPad keyboard shortcuts from `COMMANDS`; iOS native split view later |
| O-21 | Markdown engine | **Spike** enriched-markdown in M1a; keep the current renderer if it fails on streaming perf |
| O-22 | Test stack | agent-device + Maestro + Storybook RN + Jest/RNTL (kit) + Vitest (logic); web-preview e2e frozen, deleted per screen as Maestro flows land |
| O-23 | Crash reporting | **Opt-in, self-hostable** reporter (Sentry SDK pointed at the user's choice, or GlitchTip), off by default; R8 mapping + dSYM upload in release builds. Or none, and rely on Diagnostics export |
| O-24 | React Compiler on mobile (web defers it, D-37) | **On**, right after the SDK upgrade and before the kit, against green characterization flows; recorded as a mobile D-xx |

---

## 8. Server/API gaps introduced by the mobile design (API-first per D-36)

**Pinned, unread and model name on chat rows.**
- Add `pinnedAt` and `unread` to the chat list, and a model field on rows that have no agent.
- Web can reuse them.

**Multi-server.**
- A server id in every push payload, deep link and Live Activity.

**Device scope requests and admin approval.**
- The request, approve and deny endpoints **already exist** (`apps/server/src/routes/scopeRequests.ts`, client-core `admin.ts`); this is UI work.
- **Gap:** self-service read routes (own device, own requests) that don't need `admin:devices` (O-9).

**Push extensions.**
- Question options in the push payload.
- Push-to-start and update token registration for Live Activities.
- The gateway (O-15).
- Time-sensitive categories.

**Share-to-agent upload.**
- An attachment ingest endpoint for text, URLs, images and files.

**Automations.**
- Drafts ("Save draft").
- Webhook rotate **exists** (`POST /api/automations/:id/rotate-webhook-token`); UI only. A one-time credential reveal needs checking.
- Manual and webhook trigger variants.

**Projects.**
- Fetch and clone logs with progress (G-16).
- Worktree and workspace sizes (G-17).
- Per-project enable and disable (G-19).
- A remote branch list before cloning.

**Agents.**
- An import preview for `.agent.md`.

**Stats.**
- Average and median run time for the week.
- PR events in "Recently finished" (G-11 deferred).

**Workflows.** Mostly owned by the Workflow Overhaul:
- run numbers;
- per-workflow stats;
- template categories;
- per-stage tokens and cost;
- versions, validation, loops and gates (P01–P07).

**Settings.**
- Move server-wide preferences (default model, terminal and browser prefs, skill enablement) to the server.
- Notification preferences server-side: quiet hours, digest, per-project levels (later).
- Dictation language.
- Server logs and export.
- "Pause agents" (later).

---

## 9. Proposed phases (for sequencing; the detailed plan comes after your review)

The batches follow your "build several phases, then one combined test + review" rule. Durations are rough, for one developer with Claude Code.

| Phase | Content | Depends on | Size |
|---|---|---|---|
| **M0 Decide & fix design** | Your decisions (§7); a design feedback round to the artifact (§6); machine setup (Xcode 27, JDK 17, AVDs 36/37); write the mobile plan docs + mobile `.claude` rules | — | ~1 wk |
| **M1a Tooling & safety net (on SDK 57)** | Patch 57.0.25; remove dead deps; dev client; agent-device + Maestro; **characterization flows** for pairing, chat send/approve, changes keep/commit, terminal; lint layers/design rules; Jest/RNTL; Storybook RN; markdown spike | O-4 | ~1.5 wk |
| **M2 Logic extraction (on SDK 57)** | Timeline to client-core (additive; web keeps its twin until its own port); typed endpoints; queries out of screens; adopt landed read models + the composer reducer (D-61); TanStack focus/online/persist; per-server runtime (additive in client-runtime) | M1a flows green | ~2 wk |
| **M1b Platform upgrade** | SDK 58 (or latest stable) + RNGH 3 + React Compiler, verified in release mode on both OSes against the flows; Uniwind + vocabulary + per-platform geometry + motion/haptics + Material You emitter; fonts; icon registry (SF/Material) + lucide 1.x | SDK stable; M2 | ~1.5 wk |
| *Batch review A (M1a + M2 + M1b)* | | | |
| **M3 Kit** | Primitives, native wrappers, layout, all with stories, contracts and a11y | M1b; web P4-06/07 contract types | ~3 wk |
| **M4 Shell** | Drawer, pane shell, headers, back/gesture policy, search palette, server switcher, tablets | M3, M2 | 2–3 wk |
| *Batch review B (M3 + M4)* | | | |
| **M5 Chat workspace** | Chats list, chat, composer, turn sheet, new chat, pickers, all 7 pane tabs | M4 | ~4 wk |
| *Batch review C* | | | |
| **M6 Modules** | Home, projects, agents, automations, scripts, settings, pairing | M4 + API gaps | ~4 wk |
| *Batch review D* | | | |
| **M7 Workflows** | List, detail, run sheet, run, approval, run pane, graph, builder per O-5 | Workflow Overhaul P01–P07 | ~3 wk |
| **M8 System surfaces** | Notifications v2, Live Activity / Live Update, widgets, control / tile, quick actions, share-to-agent, privacy; gateway if chosen | M5, O-15 | 3–4 wk |
| *Batch review E (M7 + M8)* | | | |
| **M9 Lockdown** | Delete legacy kit, `tokens.generated` legacy vars and the last web-preview e2e; VRT baselines; perf budgets; a11y audit; store readiness (icons, splash, permission strings, privacy manifest, Data Safety, FGS declaration, entitlements, App Review demo server, crash reporting per O-23) | all | 1–2 wk |

**Total: ~25–30 weeks** of focused work. M1a and M2 can overlap with the rest of the web pass if O-4 allows it. The real accelerators are the shared contract and LLM-written UI; the unavoidable costs are the native targets and two-platform verification.

---

## 10. Top risks

1. **SDK 58 majors** (RNGH 3, router core, Host alignment, R8, strict TS). Upgrade once, first, verified in release mode on both OSes.
2. **Uniwind maturity.** Single vendor, unreleased platform-variant fix, SDK 58 support undeclared. Gates + NativeWind 5 fallback, same class vocabulary.
3. **Expo UI Host layout / API churn.** Leaf controls only, each behind an in-house wrapper with stories.
4. **Android gaps.** No predictive-back animation, no M3 large top app bar or ButtonGroup in Expo UI, filled Material icons (#46850). Handled with JS app bar, segmented row, SVG fallbacks and a recorded deviation.
5. **Scope.** ~27 boards the code deliberately left to desktop (builder, editors, wizards), plus ~25 server features. O-5 and O-17 control this.
6. **Chat screen regressions.** The transcript and keyboard behaviour were tuned against many device bugs. Mitigation: characterization flows before the rewrite, and keeping the Legend List contract.
7. **Native extension cost.** Widgets, Live Activities, tiles and the share extension each add build surface. Mitigation: first-party packages, one shared state model, phase-1 local updates.
8. **Security.** Multi-server sessions, admin from phone, lock-screen approvals, deep links as untrusted input. Server-verified biometric signatures, allowlists, read-mostly admin.
9. **Verification environment.** Xcode 27 Device Hub tool breakage; the Mac lacks JDK and API 36 images. M0/M1a setup and Node-based scripts.
10. **Predictive-back opt-out may expire.** Play requires API 37 (Android 17) targets by Aug 2027, and the `enableOnBackInvokedCallback=false` opt-out may stop being honoured there. Re-verify on every SDK bump; adopt react-native-screens 5 when it ships.
11. **Parallel sessions.** Web pass, Workflow Overhaul and mobile touch shared packages (tokens, shared, client-core). Per O-4; additive shared-package changes logged in `COORDINATION.md`, merge at each phase start.

---

## 11. Package changes at a glance

| Action | Packages |
|---|---|
| **Upgrade** | expo + expo-* (SDK 58), react-native 0.88, react 19.3, reanimated 4.7 / worklets 0.13, gesture-handler 3.2, keyboard-controller 1.22, webview 14, screens (SDK pin), @legendapp/list 3.4, lucide-react-native 1.48 (+ rewrite the Babel plugin), @tanstack/react-query 5.10x |
| **Add** | uniwind, tailwindcss 4.3.3, tailwind-merge, @expo/ui, expo-symbols, @expo/material-symbols (XML icons inside Expo UI Compose hosts), expo-font (+ Instrument Sans, JetBrains Mono), @lodev09/react-native-true-sheet, react-native-reorderable-list, expo-image, expo-screen-capture, expo-dev-client, @expo/fingerprint, expo-widgets, @bacons/apple-targets, expo-quick-actions, expo-share-intent (gated on an SDK 58 release), (optional) expo-updates, expo-navigation-bar, expo-speech-recognition, expo-app-intents (SDK 58, alpha), crash reporter (O-23), react-native-enriched-markdown (spike-gated); dev: @storybook/react-native 10.6, jest + jest-expo + @testing-library/react-native 14, agent-device, Maestro CLI, odiff-bin, Argent (optional profiler), eslint-plugin-boundaries/better-tailwindcss/react-hooks for mobile |
| **Build in repo** | Kotlin module (Live Updates, TileService, recents-screenshot, gesture-exclusion band), device-key extensions (biometric-gated approval key, hardware key commands), config plugins for targets |
| **Remove** | nativewind, tailwind.config.js, nativewind-env.d.ts, tailwindcss 3, @gorhom/bottom-sheet, @gorhom/portal, expo-application, the custom `Sheet.tsx` gesture code, `Pager`/`Fab`/`Surface`, `withSceneLifecycle` (at SDK 58), web-preview e2e scripts (progressively) |
| **Keep** | client-core/runtime/transport/shared, zustand, MMKV, nitro, quick-crypto, react-native-svg, xterm (build-time), marked (segmenter), expo-glass-effect, expo-haptics, expo-notifications, expo-local-authentication, expo-secure-store, expo-camera, expo-audio, react-native-web (dev preview only) |
| **Do not add** | Tamagui, Unistyles, gluestack, zeego, FlashList, Skia (unless a graph needs it), Detox, Appium, Notifee, expo-router Drawer, react-native-drawer-layout, Style Dictionary, Uniwind Pro |
