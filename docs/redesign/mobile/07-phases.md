# 07 — Mobile phases, tasks and exit criteria

**Branch.** Everything lands on `mobile_redesign` (MD-12), one commit per task: `mobile(<task-id>): <summary>`.

**Precedence:** `01-decisions.md` > this file > the other mobile docs > `10-design-feedback.md` > the boards.

**Where each kind of detail lives:**

| Detail | Document |
|---|---|
| Component IDs (MP-, ML-, MB-, MX-) | `03-components.md` |
| Screens and routes | `04-screen-map.md` |
| API gaps (MG-) | `05-gap-matrix.md` |
| Verification commands | `08-verification.md` |
| Session protocol | `09-codex-playbook.md` |

---

## 0. How to read this file

- **Task rows** give the ID, the work, the docs to read, the dependencies and **acceptance**. A task is done when its acceptance holds **and** the per-task Done loop passes (`08-verification.md` §3.1, mirrored in `apps/mobile/AGENTS.md`).
- **Batches.** Phases are built in batches, with one independent review per batch (the owner's batching rule).

  | Batch | Phases | Review |
  |---|---|---|
  | A | M1 + M2 + M3 | `REVIEW_PROMPT` in a fresh Codex session |
  | B | M4 + M5 | same |
  | C | M6 | same |
  | D | M7 | same |
  | E | M8 + M9 | same |
  | F | M10 | final review + merge-readiness report |

- **Batch-end loop.** At the end of a batch:
  1. run the batch checks (`08-verification.md` §3.2);
  2. write the batch evidence in `docs/redesign/mobile/reviews/<batch>/` (`SUMMARY.md` plus the files listed in `08-verification.md` §7);
  3. run the review in a **fresh Codex session** (`CODEX_PROMPT.md` → REVIEW PROMPT); it writes `reviews/<batch>-review.md`;
  4. fix every Critical and Major finding, and Minor ones unless you record why they are deferred;
  5. re-review only if a Critical or Major was found, for at most 3 rounds.
- **"Screen done"** means:
  - the board's iOS and Android variants are built, with the MDF resolutions applied;
  - the data is real (no sample data);
  - the states are present: empty, loading, error, offline, and permission where relevant;
  - testIDs are kept and a Maestro flow exists;
  - the legacy screen is deleted.
- **Sizes** are rough, for one agent working full days.

---

## 1. Timeline

| Phase | Size | Can start |
|---|---|---|
| M0 Kickoff & environment | 1–2 days | now |
| M1 Safety net & tooling (SDK 57) | ~1.5 wk | after M0 |
| M2 Shared-logic adoption (SDK 57) | ~2 wk | after M1 flows are green |
| M3 Platform upgrade & foundations | ~1.5 wk | Expo SDK 58 stable (expected Oct 2026) |
| M4 Kit | ~3 wk | after M3 |
| M5 Shell & navigation | ~2.5 wk | after M4 layout tasks |
| M6 Chat workspace & pane | ~4 wk | after M5 |
| M7 Modules | ~4 wk | after M5 (can interleave with M6 once the kit is stable) |
| M8 Workflows | ~3 wk | after the Workflow Overhaul lands the APIs (§2) |
| M9 System surfaces | ~3–4 wk | after M6 |
| M10 Lockdown & store readiness | ~1.5 wk | last |

- **Total** is about 26–30 weeks.
- **If SDK 58 is not stable when M2 ends:** start the M4 kit tasks that need no native module (`MP` JS primitives, stories) against the M3-03/M3-04 tokens on SDK 57, and do M3-01/M3-02 as soon as 58 ships. Everything native (Expo UI wrappers, sheets, gestures) waits for M3-01.
- **SDK fallback details:** M3-03, M3-04 (tokens, emitter) and M3-05…M3-08 may run on SDK 57 **if the M1-08 spike says Uniwind works on 57** — then the JS kit can be built early on the migrated styling. Batch A is then reviewed as M1 + M2 + the M3 tasks done; M3-01/M3-02 (SDK upgrade + compiler) get their own mini-review (same REVIEW PROMPT, range of those commits) when 58 lands, before any Expo UI wrapper is merged.
- **If the Workflow Overhaul APIs are still missing after M9:** Batch E is reviewed as M9 only; M10 keeps the legacy workflow screens (`src/components/runs/**`, `src/components/work/**` and their routes) and deletes everything else; M8 and the deletion of that legacy tree run later as their own batch. Tell the owner.

---

## 2. What mobile takes from the desktop run (merge `desktop_redesign` to receive it)

State at the branch point `6045856` (2026-09-26). Before starting a task that needs a "coming" item, `git fetch`/merge `desktop_redesign` and check again. **Never re-implement a desktop-owned shared item on this branch.** If it hasn't landed when you need it, re-order your tasks and say so in the phase summary.

| Shared item | Owner (desktop task / decision) | State at `6045856` | Mobile uses it in |
|---|---|---|---|
| `--gai-*` tokens + `vocabulary.css` + native `gaiColors` emit | P1-T5 | landed | M3-04, M3-05 |
| Instrument theme + ink, 18 themes × 7 accents | P1-T3/T4, D-11 | landed | M3 |
| Geometry schema (`GEOMETRY.ios/android` slots empty) | P1-T6 | landed; **mobile fills the values** (additive) | M3-03 |
| Icon concept registry (`sfSymbol`/`material` empty) | P1-T11 | landed; **mobile fills the names** (additive) | M3-07 |
| 8-state status map + labels | P1-T10, D-18 | landed | M2-02 |
| `COMMANDS`, `NAV_DESTINATIONS`, `LAUNCHER_ACTIONS` | P1-S2, D-60 | landed | M5, M9 |
| Attention feed (store, selectors) | P2-01 | landed | M2-06, M5 |
| Chat list v2, `chatRowState` | P2-02 | landed | M6-01 |
| probeServer, stats, activity, system info, project summary/runs, computer consent, model picker catalog | P2-03…P2-06 | landed | M2-06, M5, M7 |
| G-16…G-19: fetch logs, worktree sizes, project artifact prefs, entity search | D-64 | landed | M7-02, M5-06 |
| Composer reducer + slash commands + `ui-contract/composer.ts` | P4-02/P4-08, D-61/D-66 | landed | M2-03, M6-04 |
| Transcript model incl. `deriveTimeline`, `groupSteps`, turns, usage | P4-07, D-67 | landed | M2-01, M6-02 |
| `toolVerbs.ts`, `gates.ts`, `copy.ts` (incl. `EMPTY_STATE_COPY`) | P4-07, P5-01 | landed | M6, M4-09 |
| Pane tab ids, caps, link param (`pane.ts`) | P4-06, D-65 | landed | M5-03 |
| `client-core/src/diff` (`parseUnifiedDiff`) | P4-09 | landed | M6-07 |
| Settings section content (desktop P6) | P6 | in progress | M7-05…M7-07 (read the desktop sections for parity; mobile boards are the layout) |
| Workflow screens data (v2 engine, versions, validation, loops, run commands, plan preview) | Workflow Overhaul PW, G-21…G-29 | coming | **M8 is gated on it** |
| Desktop P7 lockdown (may remove legacy token emit such as `themeVars`) | P7 | not started | **M3-05 must finish before P7 is merged**: mobile stops reading legacy `themeVars` in M3 |

**Merge procedure.** It is in `09-codex-playbook.md` §5. Resolve conflicts per playbook §5 (keep both sides; desktop wins only on lines both changed; re-apply mobile's logged additions) outside `apps/mobile/**` and `docs/redesign/mobile/**` in favour of `desktop_redesign`, then re-run typecheck and the related tests.

---

## M0 — Kickoff and environment

| ID | Task | Read | Acceptance |
|---|---|---|---|
| M0-01 | Read the plan (README → 01 → 07 → 09 → apps/mobile/AGENTS.md → 02–06, 08, 10). Render all boards (`node scripts/mobile/render-boards.mjs`) and look at every screen. Also look at the desktop boards (`node scripts/redesign/render-boards.mjs`) for the screens you'll mirror. Check the artifact version (MD-44) | all | Rendered PNGs exist; `reviews/M0-notes.md` lists questions and any **Owner-confirm** decision (MD-04, MD-42, MD-96) you want the owner to see first |
| M0-02 | Machine setup (`08-verification.md` §1). Flag owner actions: `xcode-select`, JDK install | 08 §1 | Simulator and emulator boot; `adb` and `xcrun simctl` work; recorded in `reviews/M0-notes.md` |
| M0-03 | Build and **launch** the current app on the iOS simulator and Android emulator (`npx expo run:ios` / `run:android`); start the sandbox (`node scripts/redesign/sandbox.mjs`). Pairing and baseline screenshots of Home, Chats, a chat, Changes, Terminal and Settings are taken in M1-04 once `sandbox-pair.mjs` and agent-device exist (manual pairing is optional: 08 §2.2 steps by hand, `npx agent-device@0.21.15` ad hoc) | 08 §1–2 | Both builds launch to the pairing screen; recorded in `reviews/M0-notes.md` |
| M0-04 | Hand the `10-design-feedback.md` "send" list to the owner (the build does not wait) | 10 | Listed in `reviews/M0-notes.md` |

**Exit:** the environment works on both platforms against the sandbox. Commit: `mobile(M0): kickoff notes`.

---

## M1 — Safety net and tooling (SDK 57, no UI change)

| ID | Task | Read | Acceptance |
|---|---|---|---|
| M1-01 | Patch to Expo 57.0.25 / RN 0.86.3 (`npx expo install --fix`). Remove `@gorhom/bottom-sheet`, `@gorhom/portal`, `expo-application`. Add `expo-dev-client`. Build dev clients on both platforms | 06 §8, 02 §10 | App runs as before on both; typecheck/lint/test green |
| M1-02 | **Also an additive `--port` / `GENERATORAI_SANDBOX_PORT` (+ web port) option in `scripts/redesign/sandbox.mjs`** (same commit rules as below) so a second sandbox can run for M2-08 (use 3297/5297; 3198 is the widget port). `scripts/mobile/doctor.mjs` (checks Xcode, JDK, adb, AVDs, sims, agent-device, Maestro; prints device ids), `scripts/mobile/fingerprint.mjs` (`@expo/fingerprint`; says rebuild yes/no), `scripts/mobile/sandbox-pair.mjs` (starts or uses the sandbox, seeds the dummy repo and the mobile Faux fixture `apps/mobile/e2e/fixtures/mobile.faux.json`, creates a pairing code, opens `generatorai://pair?code=` on the booted sim/emulator, confirms via agent-device), `apps/mobile/vrt/devices.json`. **Shared-script change (additive, its own commit, logged in `COORDINATION.md`, listed as an owner-confirm item in the batch summary):** `scripts/redesign/sandbox.mjs` uses `process.env.GENERATORAI_SANDBOX_FAUX_SCRIPT ?? FAUX_SCRIPT_FIXTURE` for `GENERATORAI_TEST_FAUX_SCRIPT` (08 §2.4); default behaviour unchanged. Node `.mjs`, cross-platform | 08 §1–2 | Each script runs on macOS; doctor and fingerprint also on Linux/Windows (Android parts). A fresh sim pairs with one command; the sandbox runs the merged Faux fixture |
| M1-03 | Add `agent-device` (pinned devDependency). Write `apps/mobile/e2e/a11y-check.mjs` (from a snapshot: labels present, roles, `Pressable` frames ≥ 44/48, MD-91) with its vitest and `apps/mobile/e2e/a11y-allow.json`; add the XCUITest audit target (`plugins/withA11yAuditTarget.js`, `A11yAuditTests.swift`, `apps/mobile/e2e/a11y-routes.json`). Delete `apps/mobile/e2e/native-audit.mjs` (08 §6.3) | 08 §4.1, §4.8 | Works on both platforms against the current app |
| M1-04 | First: pair both devices with `sandbox-pair.mjs` and take the **baseline screenshots** of the current app (Home, Chats, a chat, Changes, Terminal, Settings → `docs/redesign/shots/mobile/baseline/`, local, gitignored; list them in `reviews/M1-characterization.md`). Then Maestro: `apps/mobile/.maestro/` layout, sandbox env, tags `smoke` / `full`. **Characterization flows** for the current UI (08 §5): pairing; chat send + stream + approve a gate; two-phase stop; Changes keep/undo/commit on a dummy repo; terminal open + type; theme switch; notification action (as far as the simulator allows). Add only the testIDs listed in 08 §5 (no behaviour change); add the dev-only routes `app/(dev)/notify.tsx` and `app/(dev)/theme.tsx` and `apps/mobile/e2e/push/approval.json`. Delete each web-preview e2e script its flow replaces (08 §6.3: `pair`, `chat`, `gatelive`, `stop`, `light`, `net2`) | 08 §5, §6.3 | Flows green on iOS and Android; `reviews/M1-characterization.md` lists the known defects found |
| M1-05 | ESLint for mobile: `eslint-plugin-boundaries` layers (MD-14, incl. the new folders; `src/ui/native/router/**` may import router presentational exports only, MD-86), `Platform` rule (MD-15), `react-hooks` (+ compiler rules), design-class rule on new layers (vocabulary only, no arbitrary/hex/palette) with a ratchet for legacy, and the import rules of 02 §9.8. `pnpm --filter @generatorai/mobile check:design` | 02 §9.8, AGENTS | Lint passes; a deliberate violation in `src/ui` fails |
| M1-06 | Jest + jest-expo + RNTL 14 for `src/ui` and `src/blocks` (Vitest stays for logic). Add the `test:ui` script (jest) next to `test` (vitest). On-device Storybook RN 10.6 (dev-only route `app/(dev)/storybook.tsx`; replaces `components/ui/gallery.tsx`); enable its MCP if the environment supports it | 08 §4.3, §4.4 | One sample story and test run; `gallery.tsx` deleted |
| M1-07 | Markdown spike (MD-40): `react-native-enriched-markdown` per block from `markdownModel`, on a mid-range Android emulator + iOS sim | 01 MD-40 | `reviews/M1-markdown-spike.md` with numbers and the decision, recorded as a new MD-xx |
| M1-08 | Uniwind Gate B spike on the target SDK (58 preview if not stable) in a scratch folder: theme switch, one `@variant ios/android` block, one class-driven Reanimated component; check whether Gate A's release exists | 01 MD-10, 02 §9.9 | `reviews/M1-uniwind-spike.md` with the go/fallback decision |
| M1-09 | Move the data layer under `src/services/` (auth, transport, stream, notifications, native, storage, voice, crypto, prefs, lib). Mechanical: import paths only | 01 MD-14 | No behaviour change; tests and flows green |

**Exit:** M1 flows green on both platforms; lint layers in place; spikes decided. There is no review here; it is part of Batch A.

---

## M2 — Shared-logic adoption (SDK 57, behaviour-preserving)

Current screens keep working, but with shared logic underneath, so the redesign later only redraws.

| ID | Task | Read | Acceptance |
|---|---|---|---|
| M2-01 | Timeline: switch mobile to `@generatorai/client-core` transcript (`deriveTimeline`, `chatMessageToBlocks`, `groupSteps`, `buildTranscriptTurns`, `computeLiveCounters`). Delete the mobile twins (`components/chat/timeline/deriveTimeline.ts`, `chatMessageToBlocks.ts` …) and port their tests. Mobile-only needs become additive client-core options | 03 MB (transcript) | Characterization flows green; mobile timeline tests pass against client-core |
| M2-02 | Status: replace the 13+ local status→tone maps with `@generatorai/shared` status (`STATUS_STATE_DEFS`, mappers). Board-only words map per MD-25 | 01 MD-25 | `rg` finds no local status→tone maps; flows green |
| M2-03 | Composer logic: adopt `composerReducer`/selectors and `slashCommands` (`BUILTIN_COMMANDS`, `fuzzyMatch`); delete `slashSource.ts` duplicates and the stop logic inside `useComposerController` | MD-03 | Composer behaviour pinned by the flows unchanged |
| M2-04 | Typed API: replace the 79 hand-written `/api` paths with `createApiClient` / admin API methods. Add missing methods **additively** in client-core (log in COORDINATION.md), plus shared query-key factories | 05 | `rg "'/api/" apps/mobile/src apps/mobile/app` → 0 outside `services/transport` |
| M2-05 | Queries out of screens: create `src/features/<area>/queries.ts` for chats, chat, projects, agents, workflows, automations, scripts, settings, home, devices; screens import hooks. No `useQuery`/`useMutation` in `app/` | MD-14 | `rg "useQuery\|useMutation" apps/mobile/app` → 0 |
| M2-06 | Adopt landed read models: attention store (`createAttentionStore` + `useSyncExternalStore`), chat list v2 (keyset paging, server search), `buildModelPickerCatalog`, computer consent model, `stats.summary`, `activity.recent`, `system.info`, project `includeSummary`, `projects.runs` | 05 §landed | Lists page from the server; no local derivation where a read model exists |
| M2-07 | App lifecycle: TanStack `focusManager` (AppState) + `onlineManager` driven by server reachability (`streamHealth`; no NetInfo package, MD-89) + MMKV query persister; one resume routine in `services/stream` (reconnect, catch-up, attention refetch) | 06 §5 | Background → foreground on both OSes resumes a running turn without stale "Running"; offline banner appears |
| M2-08 | Multi-server runtime (MD-05, gap MG-19): session storage keyed by server id, one `AuthenticatedClientRuntime` per server, active-server switch API in `services/auth`, `probeServer` for health. The current single-server UI keeps working | 06 §6.7, 05 MG-19 | Two sandboxes (ports 3197 and 3297, via the M1-02 port option) paired; switching changes data; unit tests |
| M2-09 | Deep links (gap MG-20): add `DEEP_LINK_QUERY_KEYS` (and pairing-entry rule) to `packages/shared` (additive); `attentionItemRoute()` in client-core; mobile linking uses both; `pair` never auto-submits (MD-34) | 06 §3.12, 05 MG-20, 04 §1.6 | Unit tests for the allowlist and route helper |
| M2-10 | Server gaps needed by M5–M6 (`05-gap-matrix.md` §6): MG-06 part A, MG-02, MG-03, MG-04, MG-05 (server verification + approval-key routes; the native key extension is M6-03), MG-21, MG-22 (chat and pane rows), MG-24 spike. API-first with shared types + client-core methods + server tests; each logged in `COORDINATION.md` | 05 §2, §6 | Each gap has tests; openapi updated (append-only) |

**Exit:** no duplicated shared logic; screens are presentational over hooks; flows green.

---

## M3 — Platform upgrade and design-system foundations

| ID | Task | Read | Acceptance |
|---|---|---|---|
| M3-01 | Upgrade to the latest stable Expo SDK (58+): `npx expo install --fix`; RNGH 3 hook API (port `SidePanel` and every gesture); router core changes; webview 14; remove `plugins/withSceneLifecycle.js` (SDK 58 generates the SceneDelegate); set `setNotificationHandler` explicitly; R8 release builds on Android | 06 §8 | Dev **and release** builds run on both OSes; M1 flows green |
| M3-02 | React Compiler on (MD-11); fix or annotate what breaks | MD-11 | Flows green, or the compiler is turned off with a recorded MD |
| M3-03 | Tokens (additive in `packages/design-tokens`): `vocabulary-mobile.ts` (MD-70), fill `GEOMETRY.ios` / `GEOMETRY.android` (02 §3–4, incl. `h-badge-sm`), `MOTION_CONCEPTS` springs (02 §6), `HAPTICS` concepts (02 §7), glass tokens (02 §8), `resolveAccentFromSeed` (MD-08) with a contrast test over seeds × 36 variants. Update `src/__tests__/scales.test.ts` (the "typed empty slots" case becomes the `NativeGeometry` checks of 02 §3.8), logged in `COORDINATION.md` | 02 | `pnpm check:tokens` + design-tokens tests green; web untouched |
| M3-04 | `emit/uniwind.ts` → `apps/mobile/src/theme/uniwind-themes.css` (36 `@variant <theme>-<mode>` + `@variant ios\|android` geometry) + `UNIWIND_THEMES`; `accentVars()`; wired into `tokens:write` / `check:tokens` | 02 §9 | Generated, checked in CI, deterministic |
| M3-05 | Uniwind migration (MD-10): rename the legacy `bg-accent`/`text-accent`/`border-accent` tint classes first (MD-75); remove NativeWind, `tailwind.config.js`, `nativewind-env.d.ts`, the babel preset; add Tailwind 4.3.3, Uniwind, `global.css` (tailwind, uniwind, vocabulary.css, themes, **`legacy.css`** alias layer mapping old class names such as `bg-background`/`text-foreground`/`control*` onto `--gai-*` so legacy screens keep rendering until M10); ThemeProvider → `Uniwind.setTheme` + `updateCSSVariables`, prepaint from MMKV; `cssInterop` → `withUniwind`. Stop reading `themeVars` | 02 §9 | Every current screen renders in all 18 themes × 2 modes (spot-check 4); theme switch no longer re-renders the tree (measured) |
| M3-06 | Fonts via the `expo-font` plugin: Instrument Sans + JetBrains Mono (variable on 58), family names per OS; mono renders in the terminal key row, code and paths | 02 §4 | JetBrains Mono visibly used on both OSes (screenshot) |
| M3-07 | Icons: fill `sfSymbol` / `material` for every concept (02 §5) + registry test: `packages/design-tokens/src/__tests__/icons.test.ts` replaces its "empty mobile slots" assertion with the 02 §5.4 checks (logged in `COORDINATION.md`); `expo-symbols`; lucide 1.48 with the Babel plugin rewritten to `lucide-react-native/icons/*` (or removed); filled-Material SVG fallback (`apps/mobile/scripts/gen-material-filled.mjs`) | 02 §5 | Registry test green; bundle check shows no lucide barrel |
| M3-08 | `useThemeColors()` (active theme's literals only) for native hosts; slim the mobile token module (one theme loaded at a time); Android System accent at runtime (Expo UI palette → `resolveAccentFromSeed` → `updateCSSVariables`, MMKV cache) | 02 §2 | Bundle shrinks (report the number); Material You accent works on an Android 12+ emulator |

**Batch A review** (M1 + M2 + M3).

**Exit:** SDK current; Uniwind live; tokens, fonts and icons ready; flows green in release mode on both OSes.

---

## M4 — Kit (`src/ui`)

Every component follows `03-components.md`: a `.types.ts` contract, platform files where the ID says P or N, a story (variants × states × both platforms × light/dark), a Jest/RNTL test and the a11y props. The kit decisions are already binding in `01-decisions.md` (MD-46…MD-78, MD-85, MD-86, MD-91, MD-94) and the `02-design-system.md` §3.9 renames are already applied to `03-components.md`; at M4 start, check the kit against them once and record any new kit decision as MD-97 onward.

| ID | Task | Components |
|---|---|---|
| M4-01 | Platform layer `src/ui/platform` (03 §1.1): `geometry()`, `hitFrameFor()` (MD-91), `haptic(concept)` (MD-78), `useMotion(concept)`, gesture policy (MD-19), `breakpoints.ts` size classes + `useSizeClass()` (MD-24), reduce-motion/transparency hooks, `useGlass()` guard, `presentation.ts`, `back.ts`, `nouns.ts`; `src/ui/lib` `cn()`, `useThemeColors` re-export, testID helper | platform, lib |
| M4-02 | Foundation primitives | MP-01 Text (roles, `dynamicTypeRamp`, caps), MP-02 Icon, MP-03 Pressable, MP-04 Button, MP-05 IconButton, MP-52 BrandMark |
| M4-03 | Display primitives | Badge, StatusBadge, StatusDot, Count, Chip/ChipGroup, Spinner, ProgressIndicator (native), ProgressBar, ProgressSegments, Skeleton, Separator, AgentGlyph, KbdHint, Gauge, CodeText (InlineCode, CodeBlock), Link, Card, Collapsible, DiffStat |
| M4-04 | Inputs | Input, SearchInput, Textarea, Field, Checkbox, RadioGroup (+ Radio), PairingCodeInput, NumberField, ChoiceCard |
| M4-05 | Native controls (`src/ui/native`, Expo UI) | Switch, SegmentedControl (overflow → Select at large text, MD-47), Select, Slider, DatePicker, Menu, ContextMenu (iOS preview), AlertDialog |
| M4-06 | Presentation | Sheet (formSheet route wrapper + TrueSheet; in-sheet pages, MD-62; action placement, MD-85), FullScreenEditor (dirty guard), DirtyGuard, Toast/Snackbar (+ undo, MD-26, MD-58), Popover |
| M4-07 | Lists | ListSection (grouped inset iOS / flat Android), ListRow kinds, EntityRow, SwipeRow (RNGH 3 + haptic threshold + menu + a11y actions), ReorderList |
| M4-08 | Layout pieces | Screen, Header (`src/ui/native/router/Header`, MD-86: `.ios` native + Toolbar + title view / `.android` JS M3 top app bar), Breadcrumb, StatusLine, NewAction, GlassSurface, StickyActionBar, SectionHeader, KeyValueList, StatTile/StatStrip, FactStrip, Stepper, FormSection, BulkActionBar, ScrollToLatest, BottomToolbar, KeyboardStickyBar |
| M4-09 | States | EmptyState (copy from `EMPTY_STATE_COPY`; the new keys of 10 MDF-136 added additively to `packages/shared/src/ui-contract/copy.ts`, logged in `COORDINATION.md`), ErrorState, OfflineState, PermissionState, Callout (+ Banner), QrCode |
| M4-10 | `scripts/mobile/vrt.mjs` (Storybook story captures on both platforms, odiff, baselines per device in `apps/mobile/vrt/`) + baselines for the kit | VRT |

**Exit:** every MP/ML component in `03-components.md` whose Phase is an M4 task exists with story + test (ML-05 SidePanel, ML-06 Drawer, ML-07 PaneShell, ML-08 PaneTabStrip and ML-17 AdaptiveLayout are built in M5); VRT baselines recorded; **no screen uses it yet** (screens start in M5).

---

## M5 — Shell and navigation

Route moves follow `04-screen-map.md` §1.5 (rows whose "Move in" is M5); legacy code and web-preview e2e scripts are deleted per `04-screen-map.md` §4.2 and `08-verification.md` §6.3 in the task that lands their replacement.

| ID | Task | Boards | Acceptance |
|---|---|---|---|
| M5-01 | New route tree (`04-screen-map.md` §1.2, MD-79, MD-80): remove `(tabs)`, add module stacks, sheet routes, full-screen modal routes; move the current routes per 04 §1.5 (legacy screens temporarily re-exported at their new paths); `ALLOWED_ROOTS` of the notification route guard per 04 §1.6 | — | All current features reachable; flows updated |
| M5-02 | Left `SidePanel` v2 (ML-05) + Drawer (ML-06): `NAV_DESTINATIONS`, search field (MD-46), server switcher row, AttentionList (MB-19; Needs you / Running, attention store), connection footer (MB-43) + Settings; iOS root-only edge swipe, Android button-only (MD-19); persistent sidebar at ≥ 600 (MD-24); module switch resets the Stack (MD-87); testIDs per MD-95 (`menu-button`, `drawer-<NavDestinationId>`, `drawer-inbox`, `drawer-search`, `drawer-settings`) | MSidebar, MSidebarChats, MTablet* | Both platforms match the boards (DIFF at batch end); focus trapped; a11y actions |
| M5-03 | Right `PaneShell` (ML-07) + PaneTabStrip (ML-08; pill / underline, instance chips, counts, full screen as a mode, MD-82) inside WorkspacePane (MB-42), pane registry keyed by `DOCK_TAB_TYPES`, contextual tabs (MD-23; no Widget tab, MD-96); existing tool contents re-hosted until M6. testID renames `workbench-tool-<id>` → `pane-tab-<DockTabType>` with every flow and remaining e2e script updated in the same commit (MD-95) | MPaneOpen, MPaneTabsOverview | Opens from the header toggle; closes by drag/scrim/back; docked at ≥ 840 |
| M5-04 | Header roles (ML-02 in `src/ui/native/router/Header`, MD-86; Android titles per MD-94) + back + breadcrumb per OS, status line, NewAction per module, predictive back off (MD-20), Android Back on module roots (MD-88); testID renames `workbench-button` → `pane-toggle` and removal of `header-inbox` (MD-95); Maestro `navigation/android-back.yaml` (batch check B12) | MFoundations, MPrinciples | Top-level vs detail vs chat headers correct on both OSes |
| M5-05 | AdaptiveLayout: size classes, no remount on resize (MD-24), all orientations; iPad pointer hover | MTabletIOS, MTabletAndroid | Resizing an iPad window / Android freeform keeps the terminal session and transcript scroll |
| M5-06 | SearchPalette (MB-21, ML-28; full-screen modal, MD-81): `COMMANDS` + `NAV_DESTINATIONS` + entity search (G-18 `/search`) + recents | MSearch | Keyboard + touch; results open the right route |
| M5-07 | Server switcher sheet (MB-20) + multi-server UI on the MG-19 runtime (probe, retry, add → the existing pairing screen, rebuilt in M7-08) | MServers | Switch between two sandboxes |
| M5-08 | Deep links + notification responses route to the new tree (allowlist, `attentionItemRoute`, MG-20; push `href` from MG-06 part A); `apps/mobile/e2e/links.json` for the batch surface smoke | — | Every link in `04` §1.6 opens the right screen; unknown links are rejected |
| M5-09 | Hardware keyboard shortcuts (iPad / Android tablets) from `COMMANDS` via the device-key module (key commands) | — | ⌘K / Ctrl+K opens search, ⌘N new chat, Esc closes panels |

**Batch B review** (M4 + M5).

---

## M6 — Chat workspace and pane

The server gaps these screens need (MG-02…MG-05, MG-21, MG-22, MG-24) were built in M2-10. Legacy deletions follow `04-screen-map.md` §4.2 (M6 row) and `08-verification.md` §6.3.

| ID | Task | Boards |
|---|---|---|
| M6-01 | Chats list: ChatRow (MB-48) status-glyph rows (`chatRowState`), All/Active/Archived, swipe (MD-52; Pin/Unread leading from MG-02; More/Archive trailing), model label on agent-less rows (MG-03), header Select + Sort and more (MD-53), long-press menu, bulk select from the header only (MD-60) + BulkActionBar, keyset paging, server search, pull to refresh (MD-93) | MChats |
| M6-02 | Transcript: TranscriptView (Legend List contract kept), UserMessage, AgentTurnHeader, AssistantText (per M1-07), StepRow/ToolCallCard (grouped "tool block", expand in place), StepDetail screen (live output tail not rendered until MG-37), InlineError, DelegationGroup; the chat run/approval/draft cards (MB-18) as a shell that renders once the Workflow Overhaul data exists (M8) | Main, MChatRunning, MChatToolsExpanded, MChatStepDetail, MChatNoAgent, MChatWorkflowRun |
| M6-03 | GateCard family (MB-15, MD-50; `GATE_ACTIONS`, copy; no "Always allow", MD-55) + approval sheet (MB-50) + biometric-signed risky approvals (MD-31): the `approval` key in `modules/generatorai-device-key` and the client signing against the MG-04 / MG-05 routes built in M2-10 | Main, MRunApproval |
| M6-04 | Composer (MB-01, MD-03, MD-56, MD-57) + attachments + slash popover + dictation pill + agent/model chips + "+" menu (MD-63) + TurnSheet (MB-02) + ModelPicker (MB-03) + ContextUsage (MB-41) | MComposer*, MModelPicker |
| M6-05 | New chat sheet (MB-06, large detent, footer primary per MD-85) + AgentPicker (MB-04) + CapabilityEditor (MB-05; per-chat overrides through `CreateChatParams.agentOverrides`, applied at create, 05 NG-05) + ProjectPicker (MB-44); pickers as pages inside the sheet (MD-62) | MNewChat, MNewChatMore, MAgentPicker, MAgentPickerCaps |
| M6-06 | Chat screen assembly: `workspace` header (back + breadcrumb + status line + pane toggle count, MD-18), keyboard behaviour, ↓ Latest (ML-26), run-in-chat cards | Main, MChatRunning |
| M6-07 | Changes tab: ChangesPanel (MB-22; compare bar, mount groups, Keep / Keep all / Undo all, discard confirm, MD-07), DiffView (MB-24; inline comment per MD-61, syntax colour MD-39), CommitSheet (MB-23) + done, CheckpointScrubber (MB-32) | MPaneChanges, MPaneDiff, MPaneCommit, MPaneCommitDone |
| M6-08 | Files tab + FileTree (MB-25) + FilePreview (MB-26) + SourcesCard (MB-45) | MPaneFiles, MPaneFilePreview |
| M6-09 | Terminal tab: TerminalView (MB-27, xterm WebView) + KeyRow (MD-38) + instance chips + full screen + pinch (`fontStep` haptic, MD-78) | MPaneTerminal, MPaneTerminalFull |
| M6-10 | Browser (MB-28; comment pick via the MG-24 spike result) + Computer (MB-29) tabs (MD-37) | MPaneBrowser, MPaneBrowserStates, MPaneComputer |
| M6-11 | Tasks tab + task detail (MB-30; wave and worker limit not rendered until MG-36); Plan tab (MB-31; revisions, comments where the API exists) | MPaneTasks, MPaneTaskDetail, MPanePlan |

Each screen: "screen done" (§0), and the legacy chat components are deleted as their replacements land.

**Batch C review.**

---

## M7 — Modules

**Start with M7-09** (the server gaps these screens need). Legacy deletions follow `04-screen-map.md` §4.2 (M7 row) and `08-verification.md` §6.3.

| ID | Task | Boards |
|---|---|---|
| M7-01 | Home: three counts, Needs you / Running / Recently finished (attention + `activity.recent`; PR and commit outcomes from MG-13), weekly stats (StatsCards MB-40; `stats.summary` for the ISO week, MD-84; averages and rates render when present, omitted when absent, 05 NG-03) | MHome, MHomeMore |
| M7-02 | Projects: list (long-press menu), create (full-screen), detail (tabs incl. **Pull requests**, MD-36), codebases, add codebase (remote branches from MG-11), codebase worktrees + clean-up (G-17), files, fetch logs (G-16), customization (G-19), skill detail (multi-file listing not rendered until MG-35), project settings + delete | MProjects, MProjectCreate, MProjectDetail, MAddCodebase, MProjectSettings, MCodebase, MCodebaseFiles, MCodebaseLogs, MProjectCustomization, MSkillDetail |
| M7-03 | Agents: list, detail (MD-83; CapabilitySummary MB-46), orchestrator team, new (start from), import `.agent.md` (dry-run preview from MG-12), editor (full-screen, one long form), delete in use (force) | MAgents, MAgentDetail, MAgentDetailOrch, MAgentNew, MAgentImport, MAgentEdit1–3, MAgentDelete |
| M7-04 | Automations: list, detail, execution, webhook credentials (rotate and the one-time reveal exist, 05 NG-02), create wizard (6 pages, one node each, full-screen, MD-66; "Save draft" not rendered until MG-10 lands with the Workflow Overhaul); Scripts: list, detail, run | MAutomations, MAutomationDetail, MAutomationExecution, MAutomationWebhook, MAutomationCreate1–4, MScripts, MScriptDetail |
| M7-05 | Settings root (4 groups, 15 + 4 rows) + General, Appearance (themes × modes × accents incl. System on Android, MD-77, live previews with ScopedTheme), Model providers (5 providers, sign in / make default, 05 NG-06), Agents, Skills, MCP (+ add), Templates | MSettings, MSettingsMore, MSetGeneral, MSetAppearance, MSetProviders, MSetAgents, MSetSkills, MSetMcp, MSetMcpAdd, MSetTemplates |
| M7-06 | Settings: Source control, Browser & terminal, Computer use, Audio (dictation language from MG-17), Extensions, Security & devices (+ pair a device with the MG-23 presets; no restart button, MG-27 later), Storage (breakdown not rendered until MG-25), Diagnostics (server log and update check not rendered, MG-18 / MG-26; crash-report toggle placeholder is **not** rendered until M10-06) | MSetSourceControl, MSetBrowserTerminal, MSetComputerUse, MSetAudio, MSetExtensions, MSetSecurity, MSetSecurityMore, MSetPairDevice, MSetStorage, MSetDiagnostics |
| M7-07 | Device settings: Notifications (permission states; server-side preferences not rendered, MG-15 later), App lock & privacy, Haptics, Widgets & Live Activities (guidance + "Add tile"); admin-required rows + scope request flow (MD-30, MG-01, ScopeRequestCard MB-38) | MSetNotifications, MSetAppLock, MSetWidgets, MScopeRequest |
| M7-08 | Pairing first run (QrScanner MB-39 + 12-char PairingCodeInput, MD-35), revoked screen, pairing success; `pair` links pre-fill only (MD-34) | MPairing |
| M7-09 | **First task of M7:** the server gaps M7 needs (`05-gap-matrix.md` §6): MG-01, MG-11, MG-12, MG-13, MG-17, MG-22 (settings and projects rows), MG-23. API-first with shared types, client-core methods and server tests; each logged in `COORDINATION.md` | — |

**Batch D review.**

---

## M8 — Workflows (gated on the Workflow Overhaul APIs; MD-04)

**Entry:** `docs/redesign/HANDOFF.md` and the Workflow Overhaul plan list the endpoints as landed on `desktop_redesign`, and they have been merged here; check the WO-owned gaps of `05-gap-matrix.md` §5 (MG-10, MG-14, MG-28…MG-34). Missing fields are not rendered (MD-27). Legacy deletions follow `04-screen-map.md` §4.2 (M8 row).

| ID | Task | Boards |
|---|---|---|
| M8-01 | Workflows list (RunRow MB-49; per-workflow stats and last run from `stats.summary`, 05 NG-04) + detail (+ setup, variables, menu) + new workflow (template, basics; categories only with MG-30) | MWorkflows, MWorkflowDetail, MWorkflowDetailMore, MWorkflowNew, MWorkflowNewBasics |
| M8-02 | Run sheet: variables (VariableForm MB-36), stages (per-stage overrides as pages inside the sheet, MD-62), advanced (PermissionModePicker MB-47), plan preview | MWorkflowLaunch, MWorkflowLaunchAdvanced, MWorkflowLaunchPlan |
| M8-03 | Run screen (RunTimeline / StageRow MB-33; route MD-80; run number only with MG-29, per-stage cost with MG-31) + run menu (pause, cancel, retry) + stage as compact chat + approval (the M6-03 approval sheet; workflow risk flags MG-34) + the chat workflow cards (MB-18) and the composer "Workflows" item (MG-14) once registered | MWorkflowRun, MWorkflowRunMenu, MRunStageChat, MRunApproval |
| M8-04 | Run pane (Output, Files, Hooks, Variables, Changes, Terminal, Browser; tab contract MG-28, output hints MG-32) + runtime graph (RunGraph MB-35, read-only pan/zoom) + loop status / needs decision (DecisionCard MB-34) | MWorkflowRunPane, MRunGraph, MRunLoop |
| M8-05 | Builder list (linear reorder only, add stage), graph view read-only, loop group settings, validation results (ValidationList MB-37; quick fixes only with MG-33), agent draft + version history | MBuilderList, MBuilderGraph, MBuilderLoop, MWorkflowValidate, MWorkflowAgentDraft |
| M8-06 | Stage editor tabs: Prompt, Session, Tools, Output, Policy (+ more), Hooks — simple fields; complex editors show "Edit on desktop" | MStagePrompt, MStageModel, MStageTools, MStageOutput, MStagePolicy, MStagePolicyMore, MStageHooks |
| M8-07 | Workflow settings (variables) | MWorkflowSettings |

---

## M9 — System surfaces

Legacy deletions follow `04-screen-map.md` §4.2 (M9 row).

| ID | Task | Boards |
|---|---|---|
| M9-01 | Shared live-state model in client-core (gap MG-07, MX-11: fields, state machine, triggers, end states; which items get a surface and when it ends, MD-90) consumed by in-app status, notifications, Live Activity / Update and widgets (06 §7.3); dev route `app/(dev)/live.tsx` | — |
| M9-02 | Notifications v2 (MX-07, 06 §7.2): categories (approve/deny, answer with options, reply), interruption levels, grouping, badges, channels, lock-screen redaction (MD-33, MD-92: iOS Notification Service Extension, Android `PRIVATE`), risky → open app (MD-31); server payload additions (MG-06 part B). **Verify** the Expo Push `interruptionLevel` value: the server sends `'timeSensitive'` (`packages/core/src/services/push/ExpoPushProvider.ts:80`); if Expo expects `'time-sensitive'`, fix it server-side (a bug fix, its own commit, logged in `COORDINATION.md`). Push fixtures `apps/mobile/e2e/push/<case>.json` for the batch surface smoke | MNotifications |
| M9-03 | iOS Live Activity (MX-01) via `expo-widgets` (Dynamic Island compact/minimal/expanded + lock screen), local updates, `staleDate` (MD-32, MD-65) | MLiveActivity |
| M9-04 | Android Live Update (MX-02): in-repo Kotlin module `generatorai-live` (`ProgressStyle`, promoted ongoing, status chip), `specialUse` foreground service while a run is active | MLiveActivity |
| M9-05 | Widgets (MX-03, MX-04; MD-65): iOS WidgetKit via `expo-widgets` (small / medium / large); Android via `expo-widgets` if the SDK provides it, otherwise defer and record; App Group / shared-prefs snapshot | MWidgets |
| M9-06 | iOS Control Center control (MX-05; `@bacons/apple-targets` + App Intent, "New chat") + Android Quick Settings tile (MX-06; in-repo `TileService` + config plugin); "Pause agents" not built (MD-06, MG-16) | MWidgets, MShortcuts |
| M9-07 | Home-screen quick actions (MX-08; `expo-quick-actions`, from `LAUNCHER_ACTIONS`) | MShortcuts |
| M9-08 | Share-to-agent (MX-09; `expo-share-intent` when an SDK-matching release exists; else a share-extension target; route `share.tsx`) + ingest API (gap MG-09, built first in this task) | MShortcuts |
| M9-09 | App lock and privacy: app-switcher blur (MX-10; iOS `expo-screen-capture`, Android recents via module), step-up rules | MSetAppLock |

**Batch E review** (M8 + M9).

---

## M10 — Lockdown and store readiness

| ID | Task | Acceptance |
|---|---|---|
| M10-01 | Delete the legacy layer (`04-screen-map.md` §4.2 M10 row): `src/components/**`, `legacy.css` aliases, any remaining legacy token reads; the mobile token module slimmed to what native hosts need; the lucide Babel plugin once no barrel import remains (02 §5.2) | `rg` finds no legacy imports; bundle report |
| M10-02 | Delete the remaining web-preview Playwright e2e (`apps/mobile/e2e/*.mjs` except the helpers still used); Maestro covers every screen (smoke + full) | Suite green on both OSes |
| M10-03 | VRT baselines for every kit story and the main routes; perf budgets (transcript scroll + streaming, cold start) in release builds | Reports in `reviews/M10-*.md` |
| M10-04 | Accessibility audit (XCUITest audit, Android accessibility checks), Dynamic Type sweep (AX5 / font scale 2.0), focus trapping, custom actions | 0 open Major a11y findings |
| M10-05 | Store readiness: iOS icons (light/dark/tinted/clear), Android monochrome icon, splash per appearance, `PrivacyInfo.xcprivacy`, entitlements (App Groups, time-sensitive, Live Activities), Play Data Safety notes, FGS declaration text, App Review notes + demo server instructions | Checklist in `reviews/M10-store.md` |
| M10-06 | Crash reporting (MD-42, opt-in, off by default; DSN in Settings › Diagnostics; R8 mapping + dSYM upload) | Works against a test DSN; off by default |
| M10-07 | Final review (fresh Codex session) + merge-readiness report for the owner (what changed in shared packages and server, conflicts expected with `desktop_redesign`) | `reviews/F-review.md`, `reviews/merge-readiness.md` |

---

## Risk register (mobile)

| # | Risk | Mitigation |
|---|---|---|
| R-1 | SDK 58 slips | §1 fallback: JS kit on 57 first, native wrappers after |
| R-2 | Uniwind gate fails | NativeWind 5 fallback (same vocabulary) |
| R-3 | Chat regressions (streaming, keyboard, list) | M1 characterization flows, Legend List contract kept |
| R-4 | Desktop P7 removes legacy token emit before M3-05 | Finish M3-05 before merging P7; watch the merge |
| R-5 | Shared-package conflicts with the desktop run | Additive only, COORDINATION.md, merge at each phase start |
| R-6 | Workflow Overhaul APIs late | M8 moves after M9; other phases are unaffected |
| R-7 | Expo UI / router API churn | Every native control is behind `ui/native` wrappers |
| R-8 | Xcode 27 Device Hub tooling breakage | agent-device + Maestro CLI + `xcrun simctl`; no Simulator.app-dependent tools |
| R-9 | Predictive back becomes mandatory (API 37) | Re-verify each SDK bump (MD-20) |
| R-10 | Scope creep from invented features | MG gaps marked `later` are hidden (MD-06, MD-27) |
