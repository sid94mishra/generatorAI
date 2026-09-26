# 08 — Mobile readiness (what this pass prepares for the mobile overhaul)

This pass rebuilds **web and desktop only**. The mobile redesign (https://claude.ai/artifact/3bBuQ3vGwYbJh7A2yX7kqA, 131 boards) is the next pass. Rule D-40: web and mobile share a **design contract and logic**, never UI components. Everything below is built during this pass, in React-free packages, so the mobile pass can start on day one without refactoring shared code.

Background: `research/mobile-design-analysis.md` (design analysis) and `research/mobile-stack-research.md` (stack evidence).

---

## 1. Shared foundations built in this pass

| # | Item | Lives in | Built in | Web consumer | Mobile consumer (next pass) |
|---|---|---|---|---|---|
| M-01 | New token names (`ground`, `surface`, `raised`, `overlay`, `sunken`, `hover`, `selected`, `line*`, `fg*`, `run/ok/warn/err`(+bg), `add-bg`, `del-bg`, `scrim`, `accent`, `on-accent`) resolved per theme × mode × accent, as **pre-computed literals** as well as variables (NativeWind/Uniwind cannot mix colours at runtime) | `packages/design-tokens` (`resolveAppearanceTokens` + the new `resolveDesignTokens`, `02-design-system-spec.md` §2.2), emitted additively by `emit/native.ts` into `apps/mobile/src/theme/tokens.generated.ts` | P1 (P1-T5) | `--gai-*` CSS layer | Uniwind theme variables; Skia/status bar/xterm literals |
| M-02 | **Shared class vocabulary** — one generated `@theme inline` file with the design utility names (`bg-surface`, `text-fg-2`, `text-ui`, `rounded-card`, `h-control` …) | `packages/design-tokens/css/vocabulary.css`, generated from `src/vocabulary.ts` (which is also the TS list of class names for lint) — `02-design-system-spec.md` §10.2 | P1 (P1-T5) | imported by `apps/web/src/styles/globals.css` | imported by Uniwind's global CSS, so an LLM writes the same class names in both apps |
| M-03 | Instrument theme + ink accent (7 accents, 18 themes) in the registry | `packages/design-tokens/src/themes/instrument.ts`, `registry.ts` | P1 (P1-T3, P1-T4) | Appearance settings | Mobile Appearance screen (driven from `themeMeta`) |
| M-04 | **Per-platform geometry schema**: web values now; typed slots for `ios` and `android` (type ramps iOS body 17 / Android 16; touch targets 44pt / 48dp; radii; chrome widths such as the 312pt iPad sidebar and 410pt pane) left `undefined` with a TODO | `packages/design-tokens/src/geometry.ts` | P1 (P1-T6; schema + web values) | `--gai-h-*`, radius scale | Filled at mobile M0 |
| M-05 | **Icon concept registry** — 48 concepts (plus status and UI glyphs, D-17) → `{ lucide, sfSymbol?, material? }` | `packages/design-tokens/src/icons.ts` | P1 (P1-T11; lucide filled) | `apps/web/src/ui/icons` | `expo-symbols` (iOS), Material Symbols (Android), lucide fallback |
| M-06 | **8-state status map** (visual state, glyph concept, tone token, label, dense-dot rule) and an exhaustive mapping from every server/client status union | `packages/shared/src/status/` | P1 (P1-T10) | `StatusBadge`, `StatusDot`, dock/row renderers | Mobile status badges, Live Activity states, notification copy |
| M-07 | **Navigation destinations** (Home, Chats, Projects, Agents, Workflows, Automations, Scripts) with route ids, icon concept, label, order | `NAV_DESTINATIONS` in `packages/shared/src/ui-contract/commands.ts` (subpath `@generatorai/shared/ui-contract`, `06-desktop-and-shell.md` §5.1) | P1 (P1-S2) | Sidebar, rail, palette "Go to" | Drawer |
| M-08 | **Command/shortcut registry** (command id, label, icon concept, per-host bindings) | `COMMANDS` in `packages/shared/src/ui-contract/commands.ts` | P1 (P1-S2) | Palette, key handler, desktop `menu.ts`, `DesktopCommand` | Mobile search/palette actions, app shortcuts, hardware-keyboard shortcuts on iPad |
| M-09 | **Attention feed** read model: Needs you + Running across chats and workflow runs, with live updates | server endpoint + SSE scope (`05-gap-matrix.md` G-01), selector/reducer in `packages/client-core` | P2 (P2-01) | Sidebar lists, Home, palette | Drawer lists, Home, notifications, Live Activities |
| M-10 | Other new read models (Home stats, project columns, plan revisions …) | `packages/client-core` + server | P2 / as needed | Pages | Same screens on mobile |
| M-11 | **UI contract types** for concepts drawn on both platforms: `StatusBadgeProps`, tool-block kinds and verbs (Read, Searched, Ran, Edited …), gate card kinds (permission, question, plan, computer consent) and their actions, composer state machine states (`ComposerBlockingState`: `preparing`, `prep_failed`, `waiting_on_you`, `running`, `stopping`, `force_available` — `03-component-inventory-domain.md` §3.2), dock/pane tab ids (`changes`, `files`, `terminal`, `browser`, `tasks`, `computer`, `plan`, `widget`) | `packages/shared/src/ui-contract/` (types and constants only) | P3–P4 as each concept is built (P3-01, P3-07, P4-02, P4-06, P4-07) | Kit + blocks | Mobile components implement the same props/ids |
| M-12 | Composer state machine as a **pure reducer** (states and transitions, not React). Two-phase stop timing (Stop inert 400 ms, Force reset after 15 s) is defined once | `packages/client-core/src/composer/` | P4 (P4-02; extracted while splitting `ChatInput.tsx`) | `blocks/composer` hook wraps it | Mobile composer hook wraps it |
| M-13 | Copy for statuses, gate-card actions and empty states | `packages/shared/src/ui-contract/copy.ts` (status labels live with the status map) | P1-T10, P4-07, P5-01 | Kit | Mobile |
| M-14 | Fonts: licensing and file choice (Instrument Sans, JetBrains Mono; static weights 400/500/600) documented | `packages/design-tokens/src/themes/fonts.ts` header | P1 (P1-T7) | Fontsource variable packages | `expo-font` config plugin with static TTFs (variable fonts need SDK 58) |

**M-09 landed (P2-01, G-01).** What the mobile pass consumes, with no server work left:
- **Wire types:** `AttentionSnapshot`, `AttentionItem`, `AttentionCounts`, the `attention.*` event payloads and `countAttention` / `compareAttentionItems` in `packages/shared/src/types/Attention.ts` (exported from `@generatorai/shared/client` too).
- **Read model:** `packages/client-core/src/attention/` — `attentionReducer` + `initialAttentionState`, `applyAttentionEvent`, the selectors (`selectNeedsYou`, `selectRunning`, `selectCounts`, `selectAttentionFor`, `selectAttentionByProject`) and `createAttentionStore(api, mux, { projectId? })`. The store takes `createApiClient(...)` (it has `getAttention`) and the app's `MuxStreamClient` as-is; wrap its `subscribe`/`getState` in the mobile state container (e.g. `useSyncExternalStore`).
- **Scopes:** the snapshot and the `global` deltas need only `read:activity`, which the default mobile grant carries. Without `read:chats` / `read:workflows` the server strips `ask.detail` and `progress.label`; render the row without them.
- **Rules to keep:** until the first snapshot arrives the lists are unknown, not empty (`selectCounts` returns `null`); quick actions call the existing chat, run and consent endpoints (`ask.actions` says which); `item.href` is a web route — map it to the mobile route by `entity` + `entityId` (+ `ask.kind` for the plan/computer sheets, `parent` for worker chats).
- **Notifications / Live Activities:** `attention.counts` carries totals without items for surfaces that only badge.

**M-10 (part) landed (P2-02, G-02 / G-14 chat list v2).** What the mobile pass consumes:
- **Wire types:** `ChatListQuery`, `ChatListPage`, `ChatListItem`, `ChatListSummary`, `ChatBulkResult`, `chatListSearchParams`, `liveChatIds` in `packages/shared/src/types/ChatList.ts`; status words from the `chatTurn` domain of the shared status map.
- **Calls:** `createApiClient(...).chats.list(query)` returns one keyset page (`{ items, nextCursor, total, counts }`; pass `nextCursor` back as `cursor` with the same query), `chats.archiveMany(ids)` / `chats.removeMany(ids)` for bulk actions. Filters: `status`, `projectId` (the project screen's chats, G-14), `agentRef`, `tag`, `state`, `q`, `sort`, `workers`. The one-line preview is `summary.preview` (it used to be top-level `preview`).
- **Read model:** `packages/client-core/src/chats/` — `chatRowState(row, chatLiveSets(attention))` for the Status column (combine with the M-09 attention store), `chatListInvalidatedBy(kind, query)` / `chatListStreamFilter(query)` to refetch on the `global` scope instead of polling, `chatListKey(query)` for cache keys, `mergeChatListPages(pages)` for infinite lists.
- **This pass already moved** the mobile Chats tab, project chats, search and activity feed to `.items` / `counts` and bulk delete to `removeMany`; they still load one page (up to 200) and filter locally — paging and server-side search are the mobile pass's to adopt.
- **Bulk over 200 ids** needs nothing on mobile: `archiveMany` / `removeMany` batch under the server's cap through the shared `runChatBulk` contract (P2-R1). Segment counts render only once the page has loaded (no "Active 0" while loading, D-36).
- **Live list edits:** `chat.updated` now also fires on rename, unarchive, tag/description/project/agent changes (P2-R2); `chatListInvalidatedBy` already includes it.

**G-03 landed (P2-03).** `probeServer(endpoint, { timeoutMs })` (`packages/client-runtime/src/connections.ts`) is React-free and platform-agnostic (browser `fetch`/`AbortController`, both available in React Native): given any `ConnectionCatalog` entry's `endpoint`, it returns `{ status: 'connected' | 'offline' | 'unpaired'; serverName?; latencyMs? }` from the same public `GET /api/auth/server-info` mobile already has scope for. This is the read model MD-5 anticipated — mobile's multi-server drawer switcher probes each saved connection with this call directly; there is nothing desktop-specific in it (the desktop-only half of G-03 is the main-process IPC list for the embedded server, which has no mobile equivalent — a phone never runs its own embedded server).

**G-04 / G-05 are desktop-only (P2-03).** The updater state machine (`UpdateState`, `apps/desktop/src/main/updater.ts`) and the dock/taskbar badge (`apps/desktop/src/main/badge.ts`) are Electron main-process concerns with no mobile analogue — app-store auto-update and OS push-badge APIs replace both. Nothing in either gap belongs in a shared package.

**Rule for this pass:** when you build anything that mobile will also draw — a status, a verb, a gate card, a composer state, a nav destination, a command — put the *data and types* in `packages/shared` or `packages/client-core` first. The web component then consumes them. This is enforced in review; `07-phases.md` §"Mobile-readiness deliverables → tasks" names the task that owns each M-xx item.

## 2. What the mobile design contains (summary for planning)

- **Tokens.** The same names and values as desktop, with 7 accents and ink as the default. Android adds a "System (Material You)" accent that the token package doesn't have yet. On mobile, themes change colour only; fonts stay Instrument Sans + JetBrains Mono.
- **Geometry.** Separate iOS and Android type ramps and touch targets. Radii are per platform.
- **Navigation.** A left drawer (no tab bar) in the same order as the desktop sidebar, plus a server switcher, search, and live Needs you / Running lists. A right workspace pane with 7 tabs (Changes, Files, Terminal, Browser, Tasks, Plan, Computer).
- **Screens.** Home, chats, composer states, the pane tabs, the full workflow builder and stage editors (phone!), automations (a 4-board creation wizard, webhook credentials), scripts, projects (create, codebases, customization, skill detail, fetch logs), agents (detail, orchestrator team, new, import, 3-step editor, delete in use), every settings section (these are also the content reference for the undesigned desktop settings sections, see D-32), and tablet layouts (iPad 312pt sidebar + 410pt pane; Android tablet 300dp drawer + 400dp pane).
- **System surfaces.** Notifications, Live Activities / Live Updates, widgets, Control Center and Quick Settings tiles, app shortcuts, share-to-agent, app lock.

## 3. Decisions deferred to the mobile pass (with current recommendation)

The mobile design deliberately reverses some earlier mobile decisions. The owner's saved preferences — "mobile uses blue-tinted controls, corner-rounded tabs/chips and flat lists, never grey fills or pills" and "mobile keeps the desktop IA and feature set; no mobile-only destinations" — must be reconciled at the start of the mobile pass. They are **not** changed by this pass.

| # | Question | Evidence | Recommendation (to confirm at mobile M0) |
|---|---|---|---|
| MD-1 | Selected-state colour: the design's ink/neutral wash vs the saved "blue-tinted controls" rule | The desktop redesign makes the same change (ink accent, neutral `selected`). Visual parity with desktop is the reason for the saved rule | Follow the new design: parity with the *new* desktop is the intent of the rule. Update the saved preference |
| MD-2 | Pill shapes on iOS chips, buttons and pane tabs, and Android buttons/drawer items | The design justifies them as native platform shapes. The saved rule says never pills | Decide per platform with the owner; tokens support both (radius `full` exists) |
| MD-3 | Composer: glass vs flat; one "turn setup" sheet vs separate model/effort/Plan chips | `docs/mobile-redesign/DESIGN.md` recent decision (separate chips; options unreachable bug fixed) | Keep separate chips (a proven usability fix); glass per design |
| MD-4 | Workflow builder and stage editors on phone | Earlier decision: "the DAG builder stays on desktop" | Build after the Workflow Overhaul Plan lands; the list-based builder (`MBuilderList`) is reasonable on phone |
| MD-5 | Multi-server switching | `client-runtime/connections.ts` exists; mobile keeps one server today | Adopt; the desktop server switcher needs the same read model |
| MD-6 | Mobile-only features (Pause agents, morning digest, quiet hours, per-project notification levels, share-to-agent, privacy screen) | Conflicts with "no mobile-only features" | Pause agents and notification settings need server counterparts, so desktop gets them too. Share-to-agent and privacy screen are platform-native (allowed) |
| MD-7 | Keep / Keep all / Undo all missing from mobile Changes | Shipped feature, owner request; desktop keeps them (D-28) | Keep on mobile too |
| MD-8 | Material You accent | Not in tokens | Add as an Android-only runtime accent, derived through `ensureContrast` |

## 4. Mobile pass outline (for sequencing only)

- **M0 – Foundations.**
  - NativeWind v4 → **Uniwind** (Tailwind v4) consuming M-02; delete `tailwind.config.js` colour aliases.
  - Fonts via the `expo-font` plugin. This also fixes JetBrains Mono, which is referenced in `PlanSheet.tsx`, `StartRunSheet.tsx` and `TriggerInputSheet.tsx` but never loaded.
  - lucide-react-native 1.x + `expo-symbols` behind M-05.
  - Resolve MD-1..MD-8 and update the saved preferences.
- **M1 – Kit.** React Native Reusables seeded and restyled; Expo UI for native menus, pickers and switches; TrueSheet + expo-router form sheets replacing `@gorhom/bottom-sheet`; `@legendapp/list` 3.4.
- **M2 – Shell.** Drawer, workspace pane, tablet layouts.
- **M3 – Features by area.** Chats and composer, pane tabs, projects, agents, settings; workflows after the Workflow Overhaul Plan.
- **M4 – System surfaces.** Live Activities, widgets, tiles and app shortcuts, as separate native extension targets. Only `modules/generatorai-device-key` exists today.

Mobile-stack evidence and alternatives are in `research/mobile-stack-research.md`. Uniwind is the only stable Tailwind v4 engine for React Native today. NativeWind v5 has been a release candidate since 13 Sep 2026 and is the fallback; the switch between them is mostly config.
