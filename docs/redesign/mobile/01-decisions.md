# 01 — Mobile decisions (binding for the mobile pass)

These decisions override the mobile boards wherever they disagree. Precedence for the mobile pass:

1. this file;
2. `07-phases.md`;
3. the other `docs/redesign/mobile/*` docs;
4. `10-design-feedback.md` resolutions;
5. the board snapshot in `docs/redesign/boards/mobile/`.

The web/desktop decisions in `docs/redesign/01-decisions.md` (D-xx) still bind where they describe shared contracts: tokens, status, copy, commands, API-first gaps and no fake data. A mobile decision that departs from a D-xx says so explicitly.

**Numbering.** MD-01…MD-08 answer the eight questions that `08-mobile-readiness.md` §3 deferred (MD-1…MD-8), in the same order. MD-09…MD-45 are the plan's own decisions. MD-46…MD-96 (sections E–H) consolidate the decisions the other plan documents made (`02-design-system.md`, `03-components.md`, `04-screen-map.md`, `06-platform-and-shell.md`, `10-design-feedback.md`) and the conflicts found between them; each names its source and, where sources disagreed, the resolution. New decisions made during implementation continue the sequence (MD-97 onward) and use the same format.

**Evidence.** It lives in `00-overhaul-approach.md` and `research/*.md`. Each decision names the file that supports it.

**Status words:**
- **Final** — build it this way.
- **Gated** — build it this way once the stated condition holds; the fallback is named.
- **Owner-confirm** — an educated default; build it, but surface it in the batch summary so the owner can reverse it cheaply.

---

## A. Questions deferred by the web/desktop pass (08 §3)

### MD-01 Selected state is neutral, the accent is ink — Final (supersedes the old "blue-tinted controls" preference)
- **Choice:** Selected rows and segments use `selected`, and primary actions use `accent` (ink by default).
- **Why:** This follows the mobile boards and the new desktop. The owner's old rule was "visual parity with desktop"; desktop moved to ink/neutral (D-11), so parity now means neutral.
- **Evidence:** `research/boards-core.md` A.8; `docs/redesign/01-decisions.md` D-11.

### MD-02 Shapes follow each platform's idiom — Final

| | iOS | Android |
|---|---|---|
| Chips | r16 (pill at h32) | r8 |
| Pane tabs | pills | underline tabs |
| Buttons | capsules h44 | full-radius h40 |
| Drawer items | r12 | pills (r24) |
| Cards | concentric radii | M3 shape scale |

- Radii come from per-platform tokens (`02-design-system.md` §3), never literals.

### MD-03 Composer: platform surface, agent chip + model chip, one Turn sheet — Final
- **Surface:** a glass capsule on iOS and a tonal `raised` surface on Android.
- **Chips:**
  - an agent chip, locked once the chat is bound;
  - a model chip that opens the **Turn sheet**.
- **The Turn sheet is canonical as drawn in `MModelPicker`** ("Next turn": provider, model list by tier, Mode, Effort, context gauge).
  - Its "Done" is a header text action, not an ink button (MD-22).
  - The `MComponents` "Turn setup" variant is not built.
- **States** come from the shared reducer (`packages/client-core/src/composer/composerMachine.ts`, `ui-contract/composer.ts`, D-61):
  - Send is disabled when the draft is empty;
  - while a gate is pending, Send is disabled and the gate card states why (`waiting_on_you`);
  - typing is never blocked (D-29);
  - the running placeholder is "Reply to <agent>…" — never "Queue…" (D-29);
  - Stop is two-phase (400 ms inert, Force reset after 15 s).
- **Android mic** sits in the action row.

### MD-04 Workflows on a phone: run and review fully, edit lightly, no edge editing — Owner-confirm
- **Phone and tablet get, fully:**
  - list, detail, run sheet (variables, plan preview, advanced);
  - run, run menu (pause, cancel, retry), approval, run pane;
  - runtime graph and loop status (read-only, pinch-zoom);
  - validation results and version history (read-only).
- **Builder:**
  - **list view only** (`MBuilderList`);
  - reorder is allowed only for stages in a linear chain (one in-edge, one out-edge), and edges are re-wired by the Workflow Overhaul's server API;
  - add stage appends after the selected stage;
  - the graph view (`MBuilderGraph`) is read-only.
- **Stage editor:** the six tabs as drawn (Prompt, Session, Tools, Output, Policy, Hooks), edited field by field. Hook and rule *editors* beyond simple fields show "Edit on desktop".
- **No creating, deleting or editing edges** on mobile. That includes failure edges, `when` conditions and join inputs.
- **Timing:** built only after the Workflow Overhaul lands the matching API (phase M8). Data model and endpoints come from the Workflow Overhaul (`research/boards-workflows.md` §C). This supersedes "the DAG builder stays on desktop" only for the list builder and stage fields.

### MD-05 Multi-server — Final
- Adopt the server switcher.
- One `AuthenticatedClientRuntime` per paired server; sessions are keyed by server id.
- `probeServer` (`packages/client-runtime/src/connections.ts`) feeds the switcher.
- The server id travels in every push payload, deep link and Live Activity.
- **Evidence:** `research/code-audit.md` §7.

### MD-06 Mobile-only features — Final
- **Built now (platform-native, allowed):** share-to-agent, privacy screen, app lock, haptics setting, widgets, Live Activity / Live Update, quick actions, Control Center control / Quick Settings tile ("New chat").
- **Not rendered in this pass (they need server work plus a desktop counterpart; D-36):** "Pause agents", morning digest, quiet hours, per-project notification levels, hide-previews-at-source. Their MG gaps (`05-gap-matrix.md`) are marked *later*.

### MD-07 Keep / Keep all / Undo all stay in Changes — Final
- This is D-28 on mobile, even though the boards omit it.
- Discard and Kill terminal ask for confirmation, like desktop.

### MD-08 Android "System (Material You)" accent — Final
- **Android 12+ only**; hidden elsewhere.
- **Derivation:**
  1. Read the wallpaper palette through Expo UI.
  2. Pass it through a new pure `resolveAccentFromSeed(theme, mode, hex)` in `packages/design-tokens`, applying the same `ensureContrast` rules as the named accents. It changes only `accent`, `on-accent` and `focus`.
  3. Apply at runtime and cache in MMKV, so there is no flash.
- **Never touches status colours.** Desktop is unaffected.

---

## B. Platform and stack

### MD-09 Stay on Expo / React Native — Final
- Shared TS packages and one developer outweigh native Swift/Kotlin.
- The Shopify lesson (share specs and a design contract, not views) is adopted through this plan.
- **Evidence:** `research/stack-styling-components.md` §7.

### MD-10 Styling engine: Uniwind on Tailwind 4.3.3 — Gated
- **Choice:** Uniwind (OSS tier) consuming `packages/design-tokens/css/vocabulary.css` plus a generated mobile theme CSS, with `tailwind-merge` using web's generated config.
- **Gate A:** a Uniwind release containing PR #686 (the `ios:`/`android:` leak fix). Until it ships, use `@variant ios|android` in CSS and platform files, not platform class prefixes.
- **Gate B:** a half-day spike on the target SDK before M3 commits.
- **Fallback:** NativeWind 5 once it is `latest`. The class vocabulary is identical, so the switch is config only. Uniwind Pro is not bought.
- **Evidence:** `research/stack-styling-components.md` §1.

### MD-11 SDK and runtime order — Final
- **M1 and M2 run on SDK 57**, patched to 57.0.25 / RN 0.86.3. They add no new UI.
- **M3 upgrades to the latest stable SDK** (58 expected October 2026; 59 if already out), with RN, React, Reanimated, worklets, RNGH 3 and webview 14 as pinned by `npx expo install --fix`. This happens **before any kit code**.
- **React Compiler** is switched on in M3, right after the upgrade, against the green M1 characterization flows.
  - This differs from web's D-37 on purpose: web would switch mid-rewrite; mobile switches before it.
  - If the flows regress and the cause is not found within the task, turn it off and record it.
- **Evidence:** `research/stack-engineering.md` §1. `research/stack-native-platform.md` recommended the opposite order; it was rejected because the kit would be written twice.

### MD-12 Branch, worktree and coordination with the desktop run — Final
- **Branch and worktree:** all mobile work happens on branch **`mobile_redesign`**, in the worktree at `../mobile_redesign`, created from `desktop_redesign` @ `6045856`.
- **Never commit to `desktop_redesign`.** The desktop redesign runs there in parallel, in another checkout. The owner does the final merge.
- **Merge `desktop_redesign` into `mobile_redesign`:**
  - at the start of every phase;
  - at least weekly;
  - whenever a desktop task that mobile depends on lands (`07-phases.md` §2 lists them).

  Resolve conflicts in favour of the desktop side for everything outside `apps/mobile` and `docs/redesign/mobile`.
- **Mobile never edits:** `apps/web/**`, `apps/desktop/**`, or the desktop plan docs `docs/redesign/*.md` outside `docs/redesign/mobile/`.
- **Shared packages** (`packages/shared`, `client-core`, `client-runtime`, `client-transport`, `design-tokens`) are edited **additively only**:
  - new files, new exports, new optional fields;
  - no renames or behaviour changes to what web uses;
  - never a rewrite of `packages/client-*`;
  - each change is logged in `docs/redesign/mobile/COORDINATION.md`.
- **Server changes** (`apps/server`, `packages/core`, `packages/db`) for MG gaps are API-first and additive:
  - append-only in `routes/index.ts`, `openapi.ts`, `HttpPlatformClient` and `IPlatformClient`;
  - prefer JSON settings columns over migrations;
  - when a migration is unavoidable, take the next free number at merge time and renumber on conflict.

### MD-13 The implementer is Codex; the rulebook is `AGENTS.md` — Final
- **Rules:** root `AGENTS.md` (points here) and `apps/mobile/AGENTS.md` (the full rules). Codex reads them automatically. `.claude/CLAUDE.md` is the web/desktop Claude session's rulebook: its branch rule does not apply here, and its layer and style rules apply to `apps/web` only.
- **Reviews:** at every batch end, a fresh Codex session with no prior context runs `REVIEW_PROMPT` from `CODEX_PROMPT.md`.

### MD-14 Code structure and layers — Final

```text
apps/mobile/app/              thin routes: layout, presentation options, re-export feature screens
apps/mobile/src/ui/           presentational kit (primitives/, native/, layout/, platform/, lib/)
apps/mobile/src/blocks/       query-aware parts used by ≥2 features
apps/mobile/src/features/<a>/ screens, domain components, queries.ts
apps/mobile/src/services/     today's auth, transport, stream, notifications, native, storage, voice (stable data layer)
apps/mobile/src/theme/        Uniwind CSS, generated theme CSS, ThemeProvider
```

Lint rules, via `eslint-plugin-boundaries`:
- `ui` imports only `ui`, `@generatorai/shared` types and `design-tokens`.
- `blocks` never imports `features`.
- Features never import each other.
- Data comes only through `features/*/queries.ts` or client-core stores.
- Routes contain no logic.

M1 declares these layers in ESLint before any new code is written. `src/components/**` is legacy and is deleted per screen as its replacement lands.

### MD-15 Platform branching — Final
`Platform`, `Platform.OS` and `Platform.select` are allowed only in:
- `src/ui/platform/**`;
- `src/ui/**/*.ios.tsx` and `*.android.tsx` (plus a `*.tsx` fallback for tests);
- `src/services/notifications/**` and `src/services/native/**`.

Everywhere else, platform differences come from tokens (`@variant ios|android`, `geometry()`) or from a `ui/` component. This is enforced by a lint rule.

### MD-16 Native versus JS controls — Final
Use the native control where Expo UI or the router exposes it. The full table is in `03-components.md`; in short:
- **Native:** Switch, segmented control, picker/select, slider, date picker, menu, context menu (iOS with preview), alert dialog, Android extended FAB and loading indicator, route sheets (`formSheet`), imperative sheets (TrueSheet), iOS header and toolbar.
- **JS:** Android top app bar (M3 medium/large isn't exposed), swipe actions, reorder, chips, buttons, rows, inputs, the composer, transcript, diff, terminal chrome, drawer and pane (`SidePanel`).

Every native control is wrapped in `ui/native/*` with one prop contract, so SDK churn stays local.

### MD-17 Stack and package pins — Final
The package table in `02-design-system.md` §10 and `07-phases.md` M1/M3 is binding.
- **Add:**
  - Uniwind, Tailwind 4.3.3, tailwind-merge, `@expo/ui`, expo-symbols, expo-font (+ Instrument Sans, JetBrains Mono);
  - `@lodev09/react-native-true-sheet`, react-native-reorderable-list, expo-image, expo-screen-capture, expo-dev-client, `@expo/fingerprint`;
  - expo-widgets, `@bacons/apple-targets`, expo-quick-actions, expo-share-intent (gated on an SDK-matching release).
  - Dev tooling: Storybook RN 10.6, Jest + jest-expo + RNTL 14, agent-device, Maestro.
- **Upgrade:** SDK set, lucide-react-native 1.48 (the Babel plugin is rewritten), Legend List 3.4.
- **Remove:** nativewind, tailwind.config.js, `@gorhom/*`, expo-application, the dead `Pager`/`Fab`/`Surface`.
- **Do not add:** Tamagui, Unistyles, gluestack, zeego, FlashList, Detox, Appium, Notifee, expo-router Drawer.

---

## C. Navigation and shell

### MD-18 One native Stack and two `SidePanel`s — Final
- **Shell:** the in-repo `SidePanel` (Reanimated + RNGH, ported to RNGH 3 hooks) hosts the left drawer/sidebar and the right workspace pane, over one expo-router native Stack. expo-router's Drawer is not used.
- **Screen roles:**

  | Role | Header |
  |---|---|
  | Top-level module | sidebar toggle + title (iOS large title, Android title in the bar; the Home exception is MD-94) |
  | **Detail, chat included** | back + breadcrumb + title (+ status line) |
  | Chat and run | detail header + pane toggle with a count |

- **Why chat counts as detail:** principle 3 in the boards and the owner's rule "detail screens, a chat included, show Back". The boards' sidebar toggle on chat is a design error (MDF-01).

### MD-19 Gestures per platform — Final
- **iOS:** the left-edge swipe opens the drawer **only on root screens**; on detail screens it is the native back swipe.
- **Android:** the drawer and pane open **by button only**, because the system owns both edges for back.
- **Both:**
  - panels close by dragging inside them, tapping the scrim, or Back/Escape;
  - there is no edge gesture for the pane;
  - horizontal scrollers (code, diff, terminal) block the panel pan;
  - while the terminal or a WebView is focused, edge-open is off (the mobile twin of D-46).
- **Evidence:** `research/stack-native-platform.md` §2.

### MD-20 Predictive back stays off — Final (deviation)
- `predictiveBackGestureEnabled: false` until react-native-screens 5 (or the SDK's stack) animates it and expo#39092 is fixed.
- Re-verify on every SDK bump. Play will require API 37 targets by August 2027, and the opt-out may stop being honoured then.

### MD-21 How each kind of screen is presented — Final

| Kind | Presentation |
|---|---|
| Pushed screens | module → detail |
| Route sheets (`formSheet`, detents) | Turn sheet, model/agent pickers, run sheet, commit & PR, approval (`MRunApproval`), server switcher, execution detail, scope request, **New chat (large detent)** |
| Imperative sheets (TrueSheet) | short option lists and forms that don't deep-link |
| Full-screen modals (`fullScreenModal`, Cancel + Save in the header, no swipe dismiss, dirty guard) | agent editor, MCP add, automation create wizard, workflow builder, stage editor, project create, new workflow |
| Full-screen palette (`fullScreenModal`, Close only) | search (`/search`, MD-81) |
| Pane (right `SidePanel`) | the 7 workspace tabs and the run pane |

- **Approvals** open the same approval sheet from every surface: run banner, run pane, stage chat card, chat card, notification.

### MD-22 One filled primary per screen — Final (restates principle 6)
- A screen has at most one ink-filled button. When Send, Approve or Run is present, it is that button; otherwise it is the screen's primary action (Create, Save, Commit…).
- Destructive actions use one style: `err` text on a neutral button, or the AlertDialog's destructive role. There are no filled red buttons.

### MD-23 The workspace pane follows D-27 — Final (one deviation)
- **Tabs:** the pinned tabs Changes, Files, Terminal, Browser are always shown (`DOCK_PINNED_TABS`). Tasks, Computer and Plan appear only when they apply (`DOCK_CONDITIONAL_TABS`).
- **Deviation from desktop:** on phones, extra Terminal instances and Browser pages are **chips inside their tab**, not separate tabs. Caps come from `DOCK_TAB_CAPS`.
- **Switching tabs** is tap-only, with no body swipe. Drag-to-close works from the pane header or edge band.
- **The toggle count** is the number of changed files. A warn dot appears when Plan or Computer needs you.
- **Back** inside a tab (Tasks → task detail) pops the tab first, then closes the pane.
- **Tab ids** come from `packages/shared/src/ui-contract/pane.ts`.

### MD-24 Window-size classes; panels never remount — Final

| Width | Left | Right |
|---|---|---|
| < 600 | drawer over a scrim | pane over a scrim |
| 600–839 | persistent sidebar | overlay pane |
| ≥ 840 | persistent sidebar (iPad 312 / Android 300) | docked pane (410 / 400) |

- iOS 27 and Android 17 force resizable windows, so the size class changes at runtime.
- A size-class change never remounts panels or their content (terminal, WebView, transcript); only the presentation changes.
- All orientations are supported.

---

## D. Content, status and behaviour

### MD-25 Status comes from the shared 8-state map — Final
- **Source:** `packages/shared/src/status`: Queued, Running, Waiting, Needs you, Paused, Succeeded/Done, Failed, Skipped/Cancelled. There are no local status→tone maps; the 13 existing ones are deleted.
- **Extra words the boards use** map to a state and keep their label as text:

  | Board word | State |
  |---|---|
  | Starting | Queued |
  | In review | Needs you or Waiting (per the server status) |
  | Completed | Succeeded |
  | Cancelled | Skipped |
  | Draft | not a status: neutral badge |

- **Status colour only for status.** Worktree Active/Orphaned, MCP Custom, risk levels and capability chips use neutral badges. No status tint on bars, rows or cards; the gate card header tint defined by the web kit is the one exception.

### MD-26 Toasts — Final (deviation from D-30)
Toasts are for:
- errors;
- background completions;
- **undo snackbars for reversible destructive actions** (archive, delete draft).

The undo case is the platform idiom on both OSes. Success confirmations are not toasts.

### MD-27 No fake data; designed data without an API is not rendered — Final (D-36)
- Every designed element maps to an existing API or an MG gap in `05-gap-matrix.md`.
- Gaps marked *now* are built API-first in this pass. Gaps marked *later* are hidden until they land.

### MD-28 Accessibility minimums override the boards — Final
- **Targets:** hit areas ≥ 44 pt (iOS) / 48 dp (Android). The mechanism is the `Pressable` frame, with `hitSlop` only as an allowlisted last resort (MD-91).
- **Text:** ≥ 11 pt / 12 sp; weights 400/500/600 only.
- **Scaling:** rows use min-height, never fixed height. Content scales fully; dense chrome caps at 1.4–1.6×.
- **Status:** always glyph + word.
- **Actions:** every swipe and long-press is also a menu item and a VoiceOver/TalkBack custom action.
- **Panels:** an open drawer or pane traps focus.
- **Reduce Motion / Reduce Transparency** are honoured.
- `research/boards-core.md` §0.6 lists every violation in the boards.

### MD-29 No i18n in this pass — Final (inherits D-39)
- Layouts use start/end, never left/right.
- Dates, numbers and durations go through `Intl`.
- Copy comes from `packages/shared/src/ui-contract/copy.ts` where it exists.

### MD-30 Settings from a phone — Final
- **Read-mostly:** a row that needs an admin scope shows "Requires admin access · Request", which opens the existing scope-request flow (`/auth/devices/me/scope-requests`, `MScopeRequest`). Once granted, writes are allowed, each behind biometric step-up.
- **Pairing:** no admin preset at pairing.
- **Self-service read routes** (own device, own requests) are gap MG-01.
- **Per-device preferences:** the preferences that are per-browser on desktop (default chat model, terminal/browser prefs, skill toggles) are per-device on mobile and labelled "This device".
- **How settings save:**

  | Kind | Save behaviour |
  |---|---|
  | Toggles | apply immediately |
  | Forms (MCP add, source control, agent editor) | Save in the header |
  | Destructive actions | AlertDialog confirm |

### MD-31 Risky approvals — Final
- **The server decides what is risky** (a `risk` flag on the gate; MG gap). Until the flag lands, every workflow approval and every permission request for shell, network or git push counts as risky.
- **Risky approvals** open the app and are signed with a **biometric-gated key**, which the server verifies. This is an extension to `modules/generatorai-device-key`, and it bypasses the 10-minute step-up cache.
- **Ordinary approvals** can be answered from the lock screen (device unlock required).
- **Devices without biometrics or a passcode** cannot approve risky gates.

### MD-32 Live Activity / Live Update — Final (phase 1)
- **Phase 1:** local updates only. The app starts, updates and ends the activity while it holds the stream; `staleDate` covers suspension. The Android Live Update runs from a `specialUse` foreground service while a run is active.
- **Phase 2 (not in this pass):** a push gateway beside `apps/relay` holding the APNs key and FCM credentials. It needs an owner decision.

### MD-33 Lock-screen privacy — Final
- Notifications, widgets and Live Activities show titles and statuses only.
- Commands, code and message text are redacted unless the device is unlocked, following the App lock setting.

### MD-34 Deep links — Final
- One allowlist shared with desktop: move `DEEP_LINK_QUERY_KEYS` into `packages/shared` (an additive new export; desktop keeps its import until the owner merges).
- An `AttentionItem → route` helper lives in client-core.
- A `pair` link only pre-fills the code and **never auto-submits**. There are no universal links in this pass.

### MD-35 Pairing and providers — Final
- **Pairing:**
  - a 12-character code in 3×4 groups (`PairingCodeInput` behaviour);
  - no "Share address and code";
  - network exposure options come from the server (no "Custom");
  - "Restart server" is hidden (no endpoint);
  - the scope count comes from the server's scope list.
- **Providers:** the list comes from `HARNESS_PROVIDERS` (5 ids), with Sign in, Sign out and Make default (`createApiClient().harness.*`, G-09). The picker never defaults to a provider that isn't ready.

### MD-36 Projects keep the Pull requests tab — Final
- Desktop parity (D-31); the current mobile PR screens are ported.

### MD-37 Browser and computer are view-only on a phone — Final
- **Browser:** server-streamed frames with address bar, back/forward/reload, capture and comment (where the API exists).
- **Computer:**
  - consent, Pause/Resume, Stop, audit trail;
  - **"Take over" is hidden on phones and tablets** (no touch control model yet);
  - "Screen video" is not rendered.

### MD-38 Terminal — Final
- **Engine:** xterm.js in a WebView.
- **Key row** (one spec): esc, tab, ctrl (sticky), alt (sticky), ^C, ←, ↑, ↓, →, paste, find.
- Pinch changes the font size (10–20) with a haptic tick. A hardware keyboard passes through. The terminal owns keys and gestures (MD-19).

### MD-39 Diff and file preview — Final
- Native virtualised lines, coloured with the existing bounded `highlight.ts` (desktop parity, even though the boards are monochrome).
- Comments offer the same intents as desktop; tap a line to comment, or use a "Comment" toolbar button.

### MD-40 Markdown — Gated
- **Spike (M1):** `react-native-enriched-markdown`, fed block by block from the existing `markdownModel` segmenter.
- **Adopt it if:** a streaming 2,000-line message stays at 60 fps on a mid-range Android device and selection/copy work.
- **Otherwise** keep the current `marked` → RN renderer, restyled.

### MD-41 Fonts and icons — Final
- **Fonts:**
  - Instrument Sans for content;
  - the system font for native chrome (alerts, menus, pickers);
  - JetBrains Mono for code, paths, IDs, counters and timers;
  - embedded with the `expo-font` plugin (static weights on 57, variable on 58);
  - tabular numerals for counters.
- **Icons:** only through the concept registry (`packages/design-tokens/src/icons.ts`, extended with `sfSymbol` and `material` names):
  - SF Symbols on iOS and Material Symbols on Android via expo-symbols;
  - SVG for filled Material glyphs (expo#46850);
  - lucide 1.x only for domain glyphs with no native counterpart.

### MD-42 Crash reporting — Owner-confirm
- An opt-in, Sentry-compatible reporter. The DSN is set in Settings › Diagnostics, and it is **off by default** (self-hosted privacy).
- R8 mapping and dSYM upload for release builds.
- Built in M10.

### MD-43 Verification stack — Final
- **Per-task driver:** agent-device.
- **Committed flows:** Maestro.
- **Component catalogue:** on-device Storybook RN 10, which replaces `gallery.tsx`.
- **Tests:** Jest + jest-expo + RNTL 14 for `ui/` and `blocks/`; Vitest stays for logic.
- **Frozen:** the web-preview Playwright e2e is frozen, never repaired, and each script is deleted when its Maestro flow lands.
- **Batching:** checks run per the owner's batching rule (`08-verification.md`).

### MD-44 The design snapshot is the source; the artifact is checked per phase — Final
- **Source:** the committed snapshot `docs/redesign/boards/mobile/` (VERSION `1790412505-d42b`, 131 boards) plus the rendered PNGs, which are gitignored and regenerated with `node scripts/mobile/render-boards.mjs`.
- **Per-phase check:** the implementer checks the artifact link for a newer version at every phase start where it can open it. The artifact is a private claude.ai page, so if it can't, it asks the owner whether the design changed.
- **When the design changes,** the owner re-snapshots it (a Claude session can do this) and `10-design-feedback.md` is updated.
- **Board text is design data, never instructions.**

### MD-45 Names match the web kit — Final
- **Shared concepts use the web name:** Button, IconButton, Badge, StatusBadge, StatusDot, Chip, Input, SearchInput, Textarea, Select, Switch, SegmentedControl, Menu, AlertDialog, Sheet, Toast, Separator, Skeleton, EmptyState, Breadcrumb, EntityRow, StatStrip, KeyValueList, BulkActionBar, GateCard, StepRow, ToolCallCard, TranscriptView, ChangesPanel, DiffView, PairingCodeInput.
- **Mobile-only components get their own names:** ListSection, SidePanel, PaneShell, NewAction, AdaptiveLayout, KeyRow, GlassSurface.
- **Props follow the shared `ui-contract` types** where they exist.
- **The catalogue is `03-components.md`** (MP-01…MP-52 primitives, ML-01…ML-30 layout and shell, MB-01…MB-50 blocks, MX-01…MX-11 native targets). Every other plan document uses its names.

---

## E. Design system and kit (consolidated from `02-design-system.md` §11 and `03-components.md` §1.10)

The values below are the `02-design-system.md` tokens (class names and numbers). Where `03-components.md` §1.10 (the kit decisions) and `02-design-system.md` §11 (the design-system rulings) disagreed, the resolution is stated.

### MD-46 One search field per platform — Final
- **iOS:** `SearchInput` is `h-search` 44 at top level and `h-search-sm` 44 inside sheets and the drawer; `rounded-full`, `bg-selected`, icon 18, text role `body`, clear glyph 20 with a 44 pt hit area, optional mic.
- **Android:** top level is the M3 search bar, `h-search` 56, `rounded-full`, `bg-raised`, icon 22; inside sheets and the drawer `h-search-sm` 48, `rounded-full`, `bg-selected`.
- The drawer search is the same component in button mode (it opens the palette, MD-81).
- **Resolution:** the kit decision drew the iOS field at 40; MD-28 raises it to 44.
- **Source:** `03-components.md` §1.10; `02-design-system.md` §3.3; `10-design-feedback.md` MDF-18.

### MD-47 Segmented control: native first, at most four segments — Final
- **Native:** iOS `Picker` (segmented) and Android `SingleChoiceSegmentedButtonRow` with ✓ (`h-seg` 40); their selected colours are the system's.
- **JS fallback** (only where a segment needs a second style, e.g. a count): iOS track `h-seg` 32, `rounded-seg` 9, `bg-selected`, padding 2; selected segment `rounded-seg-item` 7, `bg-raised` + 1px `border-line`.
- **Overflow:** at most 4 segments on phones; 5+ options become a `Select` (list filters with 5+ options become a scrolling filter-chip row). Any segmented control becomes a `Select` at the large-text threshold (iOS `accessibilityMedium` and above, Android font scale ≥ 1.3) or when it does not fit the row.
- **Resolution:** the kit decision used `bg-overlay` for the fallback's selected segment; the catalogue board and `02-design-system.md` use `bg-raised`, which wins.
- **Source:** `03-components.md` §1.10; `02-design-system.md` §3.6; `10-design-feedback.md` MDF-19.

### MD-48 Switch colours — Final
- The native switch is used on both platforms. Only the "on" colour is ours: iOS `onTintColor` and Android `checkedTrackColor` = `accent`; the Android checked thumb is `on-accent` with the ✓ icon. Off-state colours are the system's.
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-20.

### MD-49 Choice indicators — Final
- **Single choice** in lists: iOS trailing ✓ 18 on the selected row; Android leading M3 radio 20. The agent picker and the model picker follow it (the Android agent picker uses radios, not ✓).
- **Multi choice:** iOS leading check circle 22 (filled `accent` + ✓ `on-accent`; unselected 1.5px `border-line-strong` ring); Android checkbox in a 48 dp frame.
- **Filter chips:** selected = `bg-selected` + leading ✓ 16 on **both** platforms, with `accessibilityState.selected`.
- **Resolution:** `02-design-system.md` §3.6 drew the selected iOS chip without a check; selection by colour alone fails WCAG 1.4.1, so the ✓ is added (`controls.chip` iOS `check` 16).
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-21.

### MD-50 One gate-card shell and one large-card radius — Final
- `GateCard` (MB-15) for every gate (permission, question, plan, computer consent, workflow review and decision): 1px `border-line`, `rounded-card-lg` (20 iOS / 16 Android), `bg-raised`; header h40 (iOS) / h44 (Android) on `bg-warn-bg` with the `hand` glyph (the one tint MD-25 allows).
- Home count tiles, the scope-request card and the JS context-menu preview card share `rounded-card-lg` (iOS tiles move 18 → 20).
- Tool blocks, background-task, run and draft cards use `rounded-card` (14 / 12) with 1px `border-line-soft` and no fill.
- When a gate's action row does not fit (content width < 360 or large text), the actions stack full-width, primary first.
- **Source:** `03-components.md` §1.10; `02-design-system.md` §3.2; `10-design-feedback.md` MDF-31.

### MD-51 Button sizes and shape — Final
- Three sizes only: `sm` = `h-control-sm` 36 / 36 (in-card and in-row actions), `md` = `h-control` 44 / 40 (default), `lg` = `h-control-lg` 50 / 48 (full-width CTAs only: Connect, Create chat, Create pull request, Run / Add in sheet footers).
- Buttons, icon buttons and pills are `rounded-full` on both platforms. The only other button shape is the Android composer Send / Stop (MD-56).
- Kinds: `primary` (one per screen, MD-22), `secondary`, `tonal` (Android; iOS renders it as secondary), `text`, destructive (MD-22).
- **Source:** `03-components.md` §1.10; `02-design-system.md` §3.2; `10-design-feedback.md` MDF-16.

### MD-52 Row swipe actions — Final
- **iOS:** full-height tiles; leading actions (Pin, Mark unread) 64 wide each, trailing actions (More on `bg-line-strong`, Archive on `bg-fg-2` + `text-surface`) 74 wide each.
- **Android:** two trailing pill buttons 74 wide each (`controls.swipeAction.trailing`), radius 16, inset 4 top and bottom, end 8; the row surface slides with end radius 16 and a 1px `border-line-soft`.
- Leading Pin / Mark unread appear only once MG-02 lands. A full swipe performs only the reversible action (Archive, with an undo snackbar, MD-26). Never Approve, Delete or Run on a swipe; a workflow "Run" tile is neutral and opens the run sheet. Every swipe action is also a menu item and an accessibility action (MD-28).
- **Resolution:** the kit decision drew the Android pills 76 wide (`MChats`); `02-design-system.md` §3.8 fixes 74, which wins.
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-24.

### MD-53 Chats list header — Final
- Header actions are "Select" (testID `chats-select`) and a "Sort and more" menu; search is an in-content `SearchInput`.
- Counts live in the filter segments ("All 48"), never in a title (MDF-36).
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-45.

### MD-54 Pane header — Final
- The pane header is `h-panel-bar` 52 on both platforms (a panel bar, not a top app bar). Its buttons are `IconButton` `md` (`size-icon-button` 44 / 48).
- **Resolution:** the kit decision drew iOS pane buttons at 40, which has no token; the 44 / 48 icon button is used (MD-91).
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-42.

### MD-55 "Always allow" is not rendered — Final
- `GATE_ACTIONS.permission` has no "Always allow (in this chat)" action. It appears only once the server exposes it and `GATE_ACTIONS` gains the id (MD-27).
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-49.

### MD-56 Composer action row — Final
- Controls draw `size-icon-button-sm` (36 iOS / 40 Android) with a gap of 8 (`controls.composer`). Each control's `Pressable` frame is 44 / 48 (MD-91), so the frames touch without overlapping.
- Send / Stop: iOS 36 ink circle; Android `h-control-lg` 48 × 48 with `rounded-card-lg` 16.
- **Resolution:** the kit decision reached the target with `hitSlop` 4; MD-91 uses the frame instead.
- **Source:** `03-components.md` §1.10; `02-design-system.md` §3.4; `10-design-feedback.md` MDF-07, MDF-47.

### MD-57 Stop-dictation glyph — Final
- "Stop dictation and keep text" uses the `check` glyph, never the square Stop glyph of the agent Stop.
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-55.

### MD-58 Toast placement and timing — Final
- Toasts are only for errors, background completions and undo of reversible destructive actions (MD-26); success confirmations are never toasts.
- Bottom-centred, 16 above the safe area or above the composer / NewAction when present; one at a time; 4 s (errors 6 s, undo 5 s).
- iOS glass capsule `h-toast` 48, `rounded-toast` 24; Android inverse snackbar `h-toast` 48, `rounded-toast` 8. Swipe down (iOS) or sideways (Android) dismisses. Announced to screen readers.
- Copy confirmations swap the button label to "Copied" for 1.5 s (Android 13+ also shows the system clipboard chip).
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-30.

### MD-59 Row heights — Final
- Every row value is a minimum height (MD-28).
- `min-h-row` 52 (iOS) / 56 (Android): single-line rows (form, value, switch, nav, result and single-line entity rows).
- `min-h-row-2` 68 / 72: two-line entity rows (chat, Home, server).
- `min-h-item` 44 / 48: dense rows (file and tree rows, drawer live rows, question-gate options, Changes rows, stage rows).
- `min-h-step` 44 / 48: tool-step rows. `min-h-nav` 44 / 48: drawer nav items.
- **Resolution:** the kit decision used a `min-h-row-dense` name and an Android single-line row of 64; `02-design-system.md` names and the M3 one-line height 56 win.
- **Source:** `03-components.md` §1.10; `02-design-system.md` §3.3; `10-design-feedback.md` MDF-07, MDF-23.

### MD-60 Multi-select entry — Final
- Multi-select starts only from a header "Select" action; long-press always opens the menu.
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-43.

### MD-61 Diff comments — Final
- Tap the line-number gutter (or "Comment" in the file toolbar with a line selected) to open the inline comment composer; long-press a line for its menu (Comment for agent, Copy line).
- Two gutters (old, new; `text-mono-sm` 12) with an accessible line label ("Line 20, added").
- Intents are the shared review intents (5, as on desktop), shown as chips that overflow into a `Menu`.
- **Source:** `03-components.md` §1.10; MD-39; `10-design-feedback.md` MDF-61.

### MD-62 Pages inside a sheet; how pickers return values — Final
- A second level opened from inside a sheet swaps content inside the **same** sheet, with a back button in the sheet header (`SheetProps.back`), on both platforms. There is never a second stacked sheet. This covers New chat → agent picker → Customize capabilities, New chat → model picker, and the run sheet's per-stage overrides.
- Pickers opened from a screen (Settings › General default model, the agent editor's model field) are their own route sheets (`/pickers/agent`, `/pickers/model`).
- Every picker returns its value through the owning draft store (`features/chats/newChatDraftStore` for New chat), never through route params.
- **Resolution:** `04-screen-map.md` §1.2 and `06-platform-and-shell.md` §3.7 described a stacked second route sheet (two scrims on Android). That is replaced: Android form sheets cannot host a nested stack, and M3 guidance is one sheet at a time.
- **Source:** `03-components.md` §1.10; `04-screen-map.md` §5 (Pickers); `10-design-feedback.md` MDF-26, MDF-53.

### MD-63 Composer "+" menu — Final
- The "+" menu is a native `Menu`. "Workflows" (let this chat run workflows) is a checked menu item, not a switch row, and is rendered only when the Workflow Overhaul registers the toggle (MG-14).
- The label is "Commands & skills" everywhere.
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-54.

### MD-64 Badge sizes — Final
- iOS `h-badge` 24, padding 0 9, `rounded-badge` 12 (a pill), `text-micro` 12/500, icon 14.
- Android `h-badge` 26, padding 0 8, `rounded-badge` 8, icon 14.
- `size="sm"` for dense contexts (drawer rows, chat rows, palette rows, the mono branch badge): `h-badge-sm` 20 on both platforms, padding 0 6, icon 12. Status-line badges use icon 12.
- **Resolution:** the kit decision used Android padding 10; `02-design-system.md` (`controls.badge.paddingX` 8) wins. `02-design-system.md` gains the `h-badge-sm` token for the `sm` size.
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-22.

### MD-65 Widget and Live Update text — Final
- Widgets and Live Activities / Live Updates never use text below 12 sp (Android) / 11 pt (iOS).
- Widget "Review" buttons are system-sized and exempt from 44 / 48; each is listed in `apps/mobile/e2e/a11y-allow.json`.
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-129.

### MD-66 Wizard stepper; the automation wizard has six pages — Final
- The wizard `Stepper` (ML-21) is horizontal and compact on phones (numbered dots + the current label, `text-micro` 12; nodes are not buttons) and vertical only at expanded width.
- The automation create wizard has **six pages, one node each**: Basics · Trigger · Workflow & permission · Dataset · Variables & retry · Review.
- **Resolution:** `04-screen-map.md` §1.2 drew four step files for four boards; `07-phases.md` M7-04 ("6 steps") and MDF-93 win.
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-93.

### MD-67 Status line and progress segments — Final
- The status line under a detail title is one `StatusBadge` `md` (ML-04 `StatusLine`); it never tints the bar (MD-25).
- Progress segments (run card, Live Activity, Tasks summary, execution summary) use status tones per segment, because each segment is a stage status. They always sit next to a text equivalent ("Stage 2 of 6 · Assess risk") and are hidden from screen readers.
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-05.

### MD-68 Section headers — Final
- iOS: `subhead` 15/600 `text-fg`, sentence case, inside grouped settings; `footnote` 13/600 `text-fg-3` for list-section labels (Chats "Pinned" / "Recent", palette groups).
- Android: 14/600 `text-fg-2`; padding-start 16 everywhere (the board's 56 dp root indent is dropped).
- Screen-level section titles (Home "Needs you", detail "Recent runs") use `headline`.
- **Source:** `03-components.md` §1.10; `10-design-feedback.md` MDF-23.

### MD-69 Platform-fixed geometry; web-only axes — Final
- Mobile radii are platform-fixed; a theme's `radius` is web-only (themes recolour content only).
- Density and interface font size are web-only axes. Mobile follows the OS text size, and both density keys hold the same comfortable heights.
- **Source:** `02-design-system.md` §3.

### MD-70 Mobile vocabulary and window-size breakpoints — Final
- Mobile-only vocabulary lives in `packages/design-tokens/src/vocabulary-mobile.ts` and `css/vocabulary-mobile.css`. Web never imports it, and shared names are never changed for mobile (MD-12).
- Window-size breakpoints are `medium:` (600) and `expanded:` (840); Tailwind's default `sm: md: lg: xl: 2xl:` variants are banned on mobile (MD-24).
- **Source:** `02-design-system.md` §3.6, §3.8.

### MD-71 Type on mobile — Final
- Line heights and tracking are emitted as absolute pt / sp (RN `lineHeight` and `letterSpacing` are absolute).
- Shared text steps map semantically: display ↔ large title, heading ↔ Title / Title L, title ↔ Headline / Title M, body ↔ Body / Body L, ui ↔ Subhead / Body M, small ↔ Footnote / Body M, micro ↔ Caption / Label. The `Text` `role` prop keeps the `03-components.md` role names (`largeTitle` … `monoSm`); each role renders the class in `02-design-system.md` §4.1.
- Off-ramp board sizes: Home count values (board 24) use `title` (20 / 22) with tabular numerals; board 10–11 px text becomes `caption` 12; the search-palette highlight weight 700 becomes 600.
- **Source:** `02-design-system.md` §3.1, §4.1.

### MD-72 Shadows and sheet radius — Final
- Two shadow tokens only: `shadow-pop` for the phone drawer and pane (and JS popovers); `shadow-float` for the glass fallback, the Android extended FAB and the Android snackbar.
- Native sheets keep the system radius on iOS (never set `sheetCornerRadius` on iOS); Android sheets use the M3 28 top radius.
- **Source:** `02-design-system.md` §3.6, §8.4.

### MD-73 Icon families and icon motion — Final
- SF Symbols (iOS) and Material Symbols (Android) everywhere except the `lucideOnly` set: agents, changes, branch, commit, pr, diff, hook, variable, webhook.
- A running glyph spins by rotation; needs-you bounces once on iOS; there is no repeating effect on waiting.
- **Source:** `02-design-system.md` §5 (its haptic line is MD-78).

### MD-74 System font on native chrome — Final
- Native header titles and every native control (alerts, menus, pickers, segmented controls, switches, toolbar items, sheets' system chrome, widgets, Live Activities) use the system font; our families are never passed to native chrome.
- **Source:** `02-design-system.md` §4.6; MD-41.

### MD-75 Legacy accent classes are renamed first — Final
- The legacy mobile `bg-accent` / `text-accent` / `border-accent` (an accent tint) are renamed before the styling-engine switch (M3-05), because the names collide with the ink accent.
- **Source:** `02-design-system.md` §9.4.

### MD-76 No spring overshoot — Final
- iOS springs keep a damping ratio ζ ≥ 0.85; Android uses the M3 standard motion scheme. The old overshooting presets (`SPRING_PRESS`, `SPRING_ENTER`, `SPRING_SWIPE`) are deleted.
- **Source:** `02-design-system.md` §6; `10-design-feedback.md` MDF-13.

### MD-77 Android System accent storage — Final
- The Android "System (Material You)" accent is stored as `'system'` in `generatorai-accent` (Android ≥ 31), with the seeds cached in `generatorai-system-accent-seed`. Uniwind's `light` / `dark` variants equal Instrument, so the first frame before `setTheme` is correct.
- **Source:** `02-design-system.md` §2.5, §9.2; MD-08.

### MD-78 Haptic concepts; success fires on server confirmation — Final
- The haptic vocabulary is `02-design-system.md` §7: `selection`, `threshold`, `longPress`, `dragStart`, `dragTick`, `success`, `warning`, `error`, `fontStep`. The terminal font step is `selection` on iOS (the board leaves it blank; MD-38 requires a tick).
- `success` / `warning` fire at server confirmation (HTTP 2xx or the confirming stream event, whichever arrives first, once per action), called from the query hook, never from the button. `error` fires on a failed action or a failure the user is watching.
- iOS `warning` and `error` differ; Android maps both to `Reject` (M3 has no error constant). No haptic on native switches (the platform plays its own). Settings › Haptics turns every concept off.
- **Resolution:** `03-components.md` §1.9 and `10-design-feedback.md` MDF-14 used older names (`select`, `toggleOn`/`toggleOff`, `menu`, `tick`, `confirm`, `reject`, `fail`); the `02-design-system.md` names win.
- **Source:** `02-design-system.md` §7.1, §7.2.

---

## F. Routes and screens (consolidated from `04-screen-map.md` §5)

### MD-79 Routes mirror web paths — Final
- Mobile paths mirror web paths, so a `generatorai://` link, an `AttentionItem.href` and a `SearchResult.href` resolve without a mapping table.
- Mobile-only routes use names web never uses: `/search`, `/servers`, `/needs-you`, `/workspaces/*`, `/scope-request`, `/pickers/*`.
- **Source:** `04-screen-map.md` §1.1, §5; MD-34.

### MD-80 The run route — Final
- A run is `/workflows/[id]/runs/[runId]`. There is no `/runs/[id]`; pushes gain a web-shaped `href` (MG-06).
- **Source:** `04-screen-map.md` §5 (web parity; `AttentionItem.href` already uses it).

### MD-81 Search palette presentation — Final
- `/search` is a full-screen modal with Close and no Save (iOS); Android uses the M3 full-screen search view. MD-21 lists it.
- **Source:** `04-screen-map.md` §5; `10-design-feedback.md` MDF-37, MDF-44.

### MD-82 Pane full screen is a mode — Final
- Pane full screen is a mode of the same pane tree at 100 % width, not a route, so the terminal and WebView never remount (MD-24).
- **Source:** `04-screen-map.md` §5; `10-design-feedback.md` MDF-42.

### MD-83 Agent detail and agent editing — Final
- `/agents/[id]` is a read-only detail screen; editing is `/agents/[id]/edit` (full-screen modal). The `agents/<id>` deep link opens the detail.
- **Source:** `04-screen-map.md` §5 (the board adds a detail screen desktop lacks).

### MD-84 "This week" boundary — Final
- "This week" is the ISO week from Monday 00:00 local time to now (`api.stats.summary({from, to})`), formatted through `Intl`, and labelled "This week".
- **Resolution:** MDF-39 described a "Last 7 days" subtitle as the server's window; the API takes `from` / `to`, so the client chooses, and the board's "This week" is kept.
- **Source:** `04-screen-map.md` §5.

### MD-85 Where sheet and full-screen-modal actions go — Final
- **Selection sheets** (Turn sheet, pickers, server switcher) apply on tap; their header has a trailing **text** action ("Done"). Sheets inside the workflow builder (loop settings, add stage) edit the builder draft and close the same way; the builder's Save commits them.
- **Action sheets** (New chat, Commit & pull request, Run, Add codebase, Use agent, Import agent, Request access, New agent "Continue", MCP server setup "Save", Run script) pin one full-width `lg` primary to the sheet bottom (`SheetFooter`, keyboard-aware). Their header carries no confirm.
- **Full-screen modals** (MD-21) put Cancel at the start and a **text** confirm ("Save", "Create", "Add") at the end of the header on both platforms (iOS prominent toolbar item; Android 14/600 text button); never a filled header button and never a bottom primary, except a wizard's Back / Continue bar and the workflow builder's bottom toolbar, whose Run / Save and run / Test run is the screen's one filled button (MD-22; while an agent-draft banner shows, its "Publish" is the filled button and the toolbar action is secondary).
- MD-30's "forms: Save in the header" applies to full-screen and pushed forms; forms inside sheets follow the action-sheet rule.
- **Resolution:** `04-screen-map.md` §5 put form actions in the sheet header, and `03-components.md` ML-02 gave the Android modal header a filled button. Both are replaced: the sheet's one filled primary is its action (MD-22), M3 bottom sheets and full-screen dialogs place actions this way, and the keyboard-aware footer keeps the action reachable.
- **Source:** `04-screen-map.md` §5 (Form actions in sheets); `10-design-feedback.md` MDF-02, MDF-26, MDF-27.

---

## G. Platform and shell (consolidated from `06-platform-and-shell.md` §9)

### MD-86 Router imports in `ui/`; where the header lives — Final
- Router **presentational** exports (`Stack.Screen` options, `Stack.Title`, `Stack.Toolbar*`, `Stack.SearchBar`, `Link.Preview`, `Link.Menu`, `Link.AppleZoom`) may be imported only in `src/ui/native/router/**`. Router hooks and `router` stay banned in `ui/`.
- The header (ML-02 `Header`, the MD-45 name) therefore lives in `src/ui/native/router/Header/`: `Header.types.ts`, `Header.ios.tsx` (native header + `Stack.Toolbar` + custom title view) and `Header.android.tsx`, which renders the JS M3 top app bar `src/ui/layout/TopAppBar.tsx`.
- **Resolution:** `06-platform-and-shell.md` called the component `ScreenHeader`; the `03-components.md` name wins, and this rule fixes its folder.
- **Source:** `06-platform-and-shell.md` §2; MD-14, MD-15, MD-16.

### MD-87 A module switch resets the Stack — Final
- Choosing a module in the sidebar calls `router.dismissAll()` then `router.replace(moduleHref)` with no animation. The per-module stack of `MPrinciples` is not built; the root list's scroll position is restored from memory.
- Deep entries (drawer rows, Home, notifications, search, links) build the IA ancestors, so back and the breadcrumb work.
- **Source:** `06-platform-and-shell.md` §3.1; MD-18; `10-design-feedback.md` MDF-35.

### MD-88 Android Back on a module root — Final
- On a module root other than Home, Android Back goes to Home; on Home it backgrounds the app. iOS has no equivalent action.
- **Source:** `06-platform-and-shell.md` §3.2; `10-design-feedback.md` MDF-34.

### MD-89 Online state follows the server, not the device — Final
- TanStack `onlineManager` follows server reachability (`streamHealth`), not device connectivity. No NetInfo package is added.
- **Resolution:** `07-phases.md` M2-07 and `00-overhaul-approach.md` §5 named `onlineManager` with NetInfo. Replaced: MD-17's package list has no NetInfo, and the app's real dependency is its server (Wi-Fi with the server down is offline for this app).
- **Source:** `06-platform-and-shell.md` §5.3.

### MD-90 Which items get a Live Activity / Live Update, and when it ends — Final
- Live surfaces start for items the user follows on this device (started here, or opened here), at most 3, needs-you first; one activity per run.
- Succeeded and cancelled items end 15 minutes after they finish; failed items after 30 minutes.
- **Resolution:** MDF-128 said 15 minutes for every end state; the longer window for failures wins.
- **Source:** `06-platform-and-shell.md` §7.3; MD-32.

### MD-91 Hit areas come from the `Pressable` frame — Final (amends MD-28's mechanism)
- Interactive kit components make the `Pressable` itself ≥ 44 pt / 48 dp; the drawn element may be smaller inside it. Neighbouring frames never overlap.
- `hitSlop` is a last resort, and each use is listed in `apps/mobile/e2e/a11y-allow.json`.
- `src/ui/platform/hit.ts` exports `hitFrameFor(width, height)` (the padding that grows a `Pressable` to `minHitTarget`) and `hitSlopFor(width, height)` (the allowlisted last resort).
- **Resolution:** MD-28, `02-design-system.md` §3.4 and `03-components.md` §1.6 reached the target with `hitSlop`. The accessibility snapshot (`08-verification.md` §4.1) measures real frames and cannot see `hitSlop`, so the frame wins.
- **Source:** `06-platform-and-shell.md` §9.

### MD-92 Lock-screen redaction mechanism — Final
- iOS notification redaction while App lock is on uses a Notification Service Extension that reads an App Group flag. Android relies on `PRIVATE` channel visibility with a public version.
- **Source:** `06-platform-and-shell.md` §6.5, §7.2; MD-33, MD-06.

### MD-93 Pull to refresh — Final
- Pull to refresh (native `RefreshControl`) on both platforms for non-live lists and Home; never on the transcript.
- **Source:** `06-platform-and-shell.md` §9; `10-design-feedback.md` MDF-43.

---

## H. Conflicts resolved during plan integration

### MD-94 Android top-level titles sit in the bar; Home is the one exception — Final (clarifies MD-18)
- Android module roots put the title in the top app bar (`text-heading`, Title L 22/600), per MD-18. The only exception is Home, whose `largeTitle` headline (28/600) sits below the bar and collapses into it (`MHome`, `02-design-system.md` §3.6).
- iOS module roots use the native large title, which collapses to the centred `headline`.
- **Resolution:** `03-components.md` ML-02, `04-screen-map.md` §0.3 and MDF-36 used the M3 medium flexible bar on every module root; `06-platform-and-shell.md` §2.3 used none. MD-18 and `02-design-system.md` win.

### MD-95 testID continuity — Final
- The 34 existing testIDs (`03-components.md` §1.5) are kept verbatim when their screen is ported. That includes `menu-button` on the sidebar toggle (the web `sidebar-toggle` id is not introduced on mobile), `drawer-inbox` on the Drawer's "Needs you" section header, and `drawer-<NavDestinationId>` for nav items.
- **Deliberate renames:** `workbench-button` → `pane-toggle` and `workbench-tool-<id>` → `pane-tab-<DockTabType>`, when the new pane shell and header land (M5-03, M5-04). `header-inbox` is removed (M5). The pane does not take web's `right-pane*` ids.
- Every rename updates every Maestro flow, story, test and remaining `apps/mobile/e2e/*.mjs` script in the same commit (`08-verification.md` §6.1).
- **Resolution:** `04-screen-map.md` §4.3 renamed `menu-button` to `sidebar-toggle` and removed `drawer-inbox`, and `08-verification.md` §6.1 listed both the old and the web ids. The M1 characterization flows pin `menu-button`, so it stays.

### MD-96 No Widget tab on mobile — Owner-confirm
- Desktop's dock Widget tab and its pane-level "+" menu are not built on mobile in this pass. Extra terminals and browser pages come from each tab's own "+" (MD-23).
- **Source:** `10-design-feedback.md` MDF-68 (it asked for an MD at M6 start).

### MD-97 Evaluate the P7 merge gate against native token removal — Final
- At M0 resume, desktop `744f3a02` includes P7-01 (web legacy component removal), but P7-02 (legacy tokens) has not started. The native emitter and mobile generated tokens are unchanged; the generator retains its native target. Merge this compatible desktop state now to receive the Workflow Overhaul and current shared contracts.
- The M3-05 gate in `07-phases.md` §2 applies to the native token-removal risk named in R-4: do not merge a desktop change removing `themeVars` or its generator before mobile stops consuming it. Recheck at every phase-start merge.
- **Evidence:** diff from the mobile branch base to `744f3a02` for `packages/design-tokens/src/emit/native.ts` and `apps/mobile/src/theme/tokens.generated.ts` is empty; `bin/generate.ts` only adds desktop static-page targets. Desktop README lists P7-02 as next. This clarifies the gate using its stated risk, without changing shared code.

### MD-98 Isolate each native characterization fixture's repository — Final
- Seed each mobile fixture chat with its own `make-dummy-repo.mjs` output, linked as one codebase under the same **Mobile sandbox repo** project. Reuse it with that chat; `--fresh=<key>` creates a new conversation and repository for that key. `DUMMY_REPO` always identifies the current Edits fixture's `work/` directory. Old temporary fixtures remain available for diagnosis.
- Wait for each chat's real `workspacePrep.status` to become `ready` before reporting seed completion. No product API or checkpoint behavior changes.
- **Evidence:** concurrent creation against one in-place directory produces `commit-tree` invalid-object warnings. The existing `GitShadowRefStore` registers its shadow store by source directory; different fixture workspaces can replace that registration during capture. Separate throwaway directories also prevent prior Keep/Undo/Commit tests from contaminating a fresh fixture. This derives the fixture-isolation detail from the sandbox-only SCM rule in `apps/mobile/AGENTS.md` and 08 §2.4.

### MD-99 — iOS simulator notification consent

Derived during M1-02 from the installed Xcode 27 `simctl help privacy`: notifications are not a supported privacy service, and agent-device's notification pre-grant returns “Operation not permitted”. Android keeps the supported pre-grant. On iOS, use the app's real notification permission prompt when it requests permission; never mutate the simulator's private permission database or invent push credentials. The current build without EAS_PROJECT_ID does not request a remote-push token, so pairing proceeds without a notification pre-grant. M1-04 local-notification flows must handle the native consent prompt. This refines 08 §2.2's setup command without changing product permission behavior.

### MD-100 Raw XCTest captures for the pinned iOS driver's toolbar defect — Final
- agent-device 0.21.15's processed iOS tree can mark every app control as covered by an empty fullscreen Toolbar. The same capture through `snapshot --raw --json` exposes the native hittability and usable refs; screenshots confirm the controls are visible. Use raw iOS snapshots for pairing and accessibility audits while this defect applies. Keep normal ref actions: their keyboard-occlusion checks still run. No driver patch, forced click or product consent bypass.
- Android retains its normal snapshots. Native audit checks exclude the system keyboard's separate window, but never an app window containing an editable field. A capture with no app nodes fails instead of silently passing on the Android launcher.
- Evidence: M1-02 fresh/repeat iOS pairing and actual Maestro handoff pass; M1-03 raw Home capture has 99 native nodes including the existing menu/search/new-chat controls. This derives a tooling fallback from MD-28/91 and 08 §4.1's native-truth/semantic-selector requirements.

### MD-101 Development-client boot in the XCUITest audit — Final
- In a Debug audit, activate the app, send the Expo development-client URL through `XCUIDevice.shared.system.open` with the Metro routing hint, wait for the paired shell, and then use `XCUIDevice.shared.system.open` for each product route. Release audits retain `app.open(routeURL)`.
- `XCUIApplication.open` launches a fresh app instance (Xcode 27 header documents behavior like `launch`); a cold SDK 57 development client opened directly with a product URL remained on the splash during all three readiness checks. The working Maestro boot sequence in 08 §4.2 already selects Metro before product links. This applies that same sequence to native audits without changing app startup or consent.
- Evidence: `.expo/m1-audit.xcresult` contains three readiness failures; no accessibility result was claimed for that run. Apple documents system URL opening in [Record, replay, and review: UI automation with Xcode](https://developer.apple.com/videos/play/wwdc2025/344/).

### MD-102 Recover sandbox pairing through the current native screens — Final
- A sandbox restart rotates its identity. When the test app shows “Can’t reach your server” or “Sign-in needs refreshing”, the pairing helper may tap its existing “Pair with a different host” button, then recognize “Scan the pairing code” as ready for the fresh link. It still shows and explicitly confirms the normal fingerprint/grant consent; no credential deletion, private storage mutation or product authentication change.
- Evidence: after macOS restart on 2026-09-28, XCTest became responsive but the helper timed out because neither the stale-server screen nor the current scanner title was recognized. Native source and snapshots confirm the button routes to `/pair`. Both iOS and Android subsequently paired through the helper. This derives recovery from 08 §2's fresh sandbox pairing requirement and MD-34.

### MD-103 Characterize legacy controls without redesigning their behavior — Final
- Empty composers expose “Dictate a message”, not Send. Assert that action and the absence of Stop/Force reset after completion; do not relabel the microphone as `composer-send`.
- Appearance rows draw checkmarks but omit accessibility selection state. Record that defect for M7. The explicitly permitted dev theme route may display the actual ThemeProvider theme/mode/accent for read-only inspection after a native settings change and relaunch. It must never synthesize the expected selection.
- The fixed M1-04 testID list omits Name, New terminal, Close, the Kept filter and the Push switch. Use their existing accessible names for those actions only, preserving all listed testIDs. A kept file moves into the Kept filter; open it before asserting `unkeep-file`. Explicitly turn Push off and assert it remains off before committing; the characterization performs no push or PR.
- Grant only the test scenario's missing `write:files`, `write:workspaces` or `exec:terminal` scope through the verified sandbox's device API; restore the original scopes even if the native test fails. App calls still use the normal signed device credential and the throwaway repository.
- These details follow 08 §5's instruction to check the actual current controls, its testID-only restriction, and the isolated SCM rule. They do not waive the approval composer's editability assertion; a disabled input remains a failing legacy defect.
- Current Commit closes its sheet on success and does not render the subject afterward. Assert that transition, then require the exact subject from Git in the guarded dummy repository. Use `Mobile characterization commit` consistently to match native sentence capitalization; `EXPECT_COMMIT` makes this host check run even in the full suite without an extra CLI flag.

### MD-104 Fix the two characterized blockers before continuing M1 — Final
- Following the explicit request to apply the two minimal fixes, the owner instructed continuing and completing the phases on 2026-09-28. Apply this narrow M1-04 behavior exception, retaining the regression assertions.
- Keep the pending gate model present before typing; reveal its cancel-and-send banner only after draft text exists. Send remains blocked until the gate is answered, while the input remains editable. Archived chats remain disabled.
- Pass React Native's supported `"unspecified"` appearance for System on both platforms. Remove the unsafe null cast that crashes Android's non-null native method.
- These repairs restore the intended existing behavior. They do not authorize redesigning screens early or skipping either platform's characterization checks.

### MD-105 Rotate the sandbox fixture project when its codebase limit is reached — Final
- Fresh native flows retain MD-98's isolated repository per conversation. When the current sandbox project's codebase count reaches its reported limit (server default ten), create another sandbox project before linking the next fixture. Save that project as the current fixture container.
- Existing conversations, projects and repositories remain intact for diagnosis. No product limit is raised and no source or worktree is deleted. This handles repeated flow runs within the real project API constraints; it changes mobile test seeding only.

### MD-106 Select the existing Metro entry for iOS Maestro startup — Final
- After launching the paired iOS development client, select its recent `http://127.0.0.1:8081` entry if Expo's Development Build launcher is visible. Otherwise wait for the app shell. Android retains the verified development-client link; release launches are unchanged. Fresh-pairing flows wait for the cleared Expo launcher before opening their Metro link.
- A second development-client link during iOS auto-load crashed in `ExpoFabricView.injectInitializer` with a lost AppContext (`GeneratorAI-2026-09-28-212348.ips`). A cold URL-only launch instead remained at the launcher. Selecting its real recent entry matches the already-working sandbox-pair helper and reaches the chat input/send steps. This is native test startup only; it does not suppress a product assertion or alter app startup code.

### MD-107 Continue with explicit pending verification — Owner-directed (2026-09-29)
- The owner directs: “if not working log it as open item and proceed to complete all phases … anything deferred mark it as pending and proceed”. This supersedes the M1 no-behavior-change restriction and the failing-check stop for this run. Minimal repairs are authorized; unresolved failures do not prevent independent subsequent tasks.
- Keep required assertions and evidence. A deferred check is **pending**, never passed; implementation progress and acceptance status are reported separately. Track each open item in `reviews/PENDING.md`, assign its next relevant task, and retest at that task and final review. External prerequisites are likewise recorded, not silently bypassed.
- Existing ownership, sandbox, additive shared changes, no-push and no-destructive-action constraints remain.

### MD-108 Bootstrap design lint against existing routes and Tailwind 3 — Final
- Existing `app/**` routes contain legacy screens until their planned ports. Record their current violations in the same per-file, shrink-only baseline as legacy `src/**`; new routes and new kit/blocks/features/services are hard zero immediately. `check:design --update` cannot raise counts and removes a route's exception when it reaches zero. Delete every remaining route exception in M10.
- M1 uses better-tailwindcss's Tailwind 3 config entry point (`tailwind.config.js`), because passing CSS as an entry point on Tailwind 3 loads CSS as JavaScript. At M3 switch to the planned `src/theme/global.css` entry point and the generated mobile vocabulary. Shared generated vocabulary is recognized now; mobile-only vocabulary is not invented ahead of its emitter. Platform class variants remain prohibited until Gate A verification.
- This reconciles M1's tooling-only migration with 02 §9.8's hard-zero destination. React hook/compiler and boundary diagnostics join the same baseline, so new legacy violations cannot hide as warnings.

### MD-109 Preserve existing debt during the mechanical service move — Final
- M1-09 moves the API hooks/client facade with the explicitly listed data-layer folders into `src/services/api`; they are part of the same stable layer. Import targets change mechanically; behavior does not.
- Transfer existing per-file lint allowances to the exact moved paths. The existing service files remain ratcheted until cleaned; newly created service files are hard zero. Moving from the legacy element to the service element exposes 17 already-existing imports into legacy models/UI across 11 files. Record only those boundary diagnostics; all other rules must stay level or decrease. No new imported edge is authorized by this migration.
- These dependencies are removed by M2 shared-model/query adoption and M5 auth/shell replacement. `check:design --update` removes each moved file's exception once clean; M10 must leave none. This follows M1-09's “mechanical: import paths only” requirement without disabling the new layer checks.

### MD-110 Add a projected transcript input without fabricated wire fields — Final
- `chatMessageToBlocks` reads only content and metadata, but its domain input type requires session id and a Date. Add an overload for those two consumed fields, retaining the existing full-message overload and the unchanged derivation body. New `messageInput.ts` and `wireMessage.ts` adapt the looser API metadata and reuse the shared chronological replay. No placeholder session id or timestamp is synthesized.
- This is the additive client-core extension explicitly allowed by M2-01: no existing field, export or runtime behavior is removed. Existing mobile attachment/partial-message selectors move into this React-free adapter. Its native compact error/group presentation can remain in the mobile view adapter; step status, nesting, images and aggregate counts come from the shared model. `buildTranscriptTurns` also receives an additive generic projected-message overload; its original domain overload, grouping/filtering algorithm and callers remain unchanged. The native adapter is named `compactTimeline`, with the old twin filenames deleted; M6 replaces its presentation composition as the redesigned transcript lands.

### MD-111 Prefer IPv4 for the local Metro launcher — Final
- Native restart exposed a Node 26 DNS-order mismatch: Expo `--localhost` bound only `[::1]:8081`, while sandbox-pair and the saved dev-client entry use `127.0.0.1:8081`. IPv4 `/status` was refused; the app reported “Could not reach” the server.
- `pnpm --filter @generatorai/mobile start` uses a cross-platform Node launcher with `--dns-result-order=ipv4first`, preserving Expo arguments and inherited environment. No global DNS setting or network exposure is changed. Use this package script for the local dev client; direct `expo start --localhost` needs the same Node option.

### MD-112 Unread means activity after a read mark — Final (2026-10-02, owner handed the mobile run to Claude Code)
- MG-02 defines unread as `lastActivityAt > lastReadAt`. A chat with no read mark (every chat that existed before v64, and any chat nobody has opened since) is **not** unread; otherwise the first release would flag every chat on mobile and web at once.
- Opening a chat sends `PATCH {unread: false}` (read mark = now); "Mark unread" sends `PATCH {unread: true}`, which stores the epoch, so any activity reads as new. `ChatListSummary.unread` is present only when true; `summary.model` only when the model is known (MG-03).
- v64's list indexes lead with `(pinned_at IS NOT NULL)` and keep ascending sort columns (as v56), so the descending list order is a reverse scan; a cursor page inside the unpinned group orders by the sort key alone, so it stays an index range with no temp B-tree. Status-filtered and workers-included lists have their own pin-aware index.

### MD-113 Approval-key registration carries its nonce; nonces are device-bound by prefix — Final (2026-10-02)
- MG-05's registration body (`publicJwk, keyProtection, presence, proof`) omits the nonce the proof signs, so the server could not rebuild the signed bytes. The body gains `nonce` (the value from `POST /api/auth/approval-nonce`).
- "Issued to this device" needs no schema change: `auth_nonces` holds approval nonces as `appr.<deviceId>.<random>` (`INonceStore.issue(expiresAt, prefix)`); the verifier checks the prefix against the DPoP principal before the single-use DELETE.
- v65 stores the key's `presence` beside the two planned columns (`approval_key_presence`), because the `approval.signed` audit event records it (06 §6.3). `keyProtection` is audited at registration only.
- M2-10 enforces proofs on the chat tool-permission route, the only gate MG-04 marks risky today. The question/plan/stage/consent routes accept the field when their gates gain a risk verdict (stage approvals in M8). The native `generatorai-device-key` additions (`generateApprovalKey`, `signWithPrompt`, …) land with the M6 gate UI that calls them; until then a mobile device answers risky gates with `APPROVAL_KEY_MISSING`, which the M6 gate sheet turns into the registration prompt.
