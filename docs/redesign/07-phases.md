# 07 — Phase-by-phase plan

The executable plan. Each phase lists its goal, entry criteria, PR-sized tasks (with the documents that hold the detail), acceptance criteria, and exit criteria. Task IDs (`P3-04` …) are stable; use them in branch names, PR titles and the progress table in `README.md`.

**Read before any task:** `01-decisions.md` (binding), `10-llm-playbook.md` (session protocol, CLAUDE.md, task packet), `09-verification.md` §6 (Done loop).

---

## Overview

| Phase | Goal | PRs | Depends on | Parallel? | Session model |
|---|---|---|---|---|---|
| **P0** Documentation & rails | Plan committed, CI covers redesign branches, guardrails exist, dead code gone | 5–7 | — | partly | Sonnet (P0-04 Opus) |
| **P1** Platform, tokens, shared registries | Upgraded toolchain; new token layer + scales + Instrument/ink + fonts; status/nav/commands/icons/CHROME registries; router split; theme single-writer; overlay contract; Storybook | 20–24 | P0 | serial core, some parallel | Opus (tokens, theme, overlay), Sonnet (upgrades, registries) |
| **P2** Backend track | API gaps G-01…G-20 in server + `client-core` | 15–20 | P1-T10 (status map) for G-01 | yes, runs alongside P1–P5 | Opus (G-01, G-02, G-07), Sonnet (rest) |
| **P3** Slice A — shell + Chats list | New app frame on all OSes, palette, native IA, first primitives, Chats list ported | 8–10 | P1, G-01…G-05 | serial shell; primitives parallel | Opus (shell/desktop), Sonnet (primitives, ChatsList) |
| **P4** Slice B — chat workspace | Chat page, composer, transcript, dock and panels on the kit; giant files split | 12–16 | P3 | mostly serial | Opus |
| **Handoff** | Kit + shell + transcript + registries usable by the Workflow Overhaul Plan | — | P4 | — | — |
| **P5** Fan-out | Projects, codebases, PRs, agents, create chat, Home, pairing, errors, static desktop pages, palette search | 18–24 | P4 (kit), P2 gaps | yes | Sonnet (Opus for Home, ProjectDetail) |
| **P6** Settings | Settings modal + all 15 sections | 8–12 | P5 kit parts | yes (sections) | Sonnet |
| **PW** Workflow surfaces | Workflows, automations, scripts built once on the kit by the Workflow Overhaul Plan | (that plan) | Handoff | — | per that plan |
| **P7** Lockdown | Legacy layer, Header, old components, Radix gone; namespace reset; rules are errors | 3–5 | P6 + PW (or D-35 fallback) | no | Opus |
| **P8** Deferred platform | Vite 8, React Compiler, TypeScript 7 | 3 | P7 | no | Sonnet |

**Total (this plan, excluding PW):** about 90–110 PRs. For one developer reviewing LLM output that is roughly **14–20 weeks**, overlapping with the Workflow Overhaul Plan (~30 weeks), which competes for the same review time.

```
week:   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18
P0     ██
P1       ████████
P2          ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   (G-01..G-05 before P3; rest before the P5 page that needs them)
P3                 ██████
P4                       ██████████
handoff                            ▲ (Workflow Overhaul Plan UI work packages start on the kit)
P5                                 ██████████████
P6                                         ████████
P7                                   (after P6 + PW or the D-35 fallback) ███
```

---

## P0 — Documentation & rails

**Goal.** Everything a session needs is in the repo; CI runs on redesign branches; the guardrails exist and are baselined; dead code is removed so later diffs are clean.
**Entry.** This plan exists in `docs/redesign/`.

| ID | Task | Detail in | Acceptance |
|---|---|---|---|
| P0-01 | **Commit the plan + board snapshot + rendered PNGs.** Add `scripts/redesign/render-boards.mjs` (strips the `<x-dc>`/`<helmet>` wrapper, substitutes `{{rootClass}}` with `t-dark acc-ink` / `t-light acc-ink`, screenshots at board size) → `docs/redesign/boards/png/<Board>.<dark|light>.png`; also add `scripts/redesign/side-by-side.mjs` (board PNG + app screenshot → compare PNG, `09` §4.6). PNGs are reproducible and **gitignored** (`09` §4.6), so they are regenerated on demand, not committed. | `09-verification.md` §4.6 | the script renders all 60 boards × 2 modes with no validation error; `side-by-side.mjs` produces a compare PNG for one board; both scripts are documented in `README.md` |
| P0-02 | **Session rules.** Write `.claude/CLAUDE.md` from `10-llm-playbook.md` §2 plus the verification loop (`09-verification.md` §6.1) and the testid rule (§7.2). Update `.github/AGENTS.md` UI section to point at `docs/redesign/`. Fix `.claude/launch.json` (`pnpm start:web` does not exist → the `dev` entry of `09` §6.2 now; the `storybook` entry is added by P1-SB and `sandbox` by P2-00). Add `scripts/redesign/make-dummy-repo.mjs` (`09` §6.6) so every later SCM walkthrough has its dummy repo. | `10-llm-playbook.md` §2, `09-verification.md` §6 | A fresh Claude Code session can start the dev server from `launch.json`; CLAUDE.md < 120 lines; `node scripts/redesign/make-dummy-repo.mjs` prints a repo path outside this checkout on the developer's OS |
| P0-03 | **CI coverage.** Add `desktop_redesign`, `arch-redesign` and `redesign/**` to the CI branch triggers (today only `main`/`dev`). Repair the already-stale `right-pane-desktop-smoke.mjs`. Record the green baseline of all 13 e2e specs + UI smokes in `docs/redesign/shots/BASELINE.md`. | `09-verification.md` §1.3, §7.1 | CI runs on a PR into `desktop_redesign`; baseline file lists pass/fail per spec |
| P0-04 | **Guardrails.** Extend `apps/web/scripts/check-design-system.mjs` with the 14 new rules and measured baselines (ratchet only down; new folders `ui/`, `blocks/`, `features/`, `app/` must be 0 from day one). Add `eslint-plugin-better-tailwindcss` (scoped to the new folders), `eslint-plugin-boundaries` (D-04 elements), `no-restricted-imports` blocks. Add the `check-css-emission.mjs` skeleton. Make `apps/web/vitest.config.ts` the single vitest config (today root = jsdom + strong setup, app = happy-dom + weak setup), already in the `projects` form with a `unit` project (`09` §1.1, §3.4; P1-SB adds the `storybook` project) so the Done loop's `--project unit` works from P0; add `@testing-library/user-event`; add the `check:css` script (`09` §3.7). | `09-verification.md` §1.1, §2 | `pnpm lint` + `check:design --strict` green; a deliberately bad file in `ui/` fails lint (shown in PR) |
| P0-05 | **Dead code.** Delete the dead shims `chat/redesign/StepRow.tsx`, `chat/redesign/UsageChip.tsx` (`workflow/ToggleSwitch.tsx` and `workflow/StyledSelect.tsx` turned out to be imported relatively by `StagePropertiesPanel` and `settings/HooksTab` — they stay for PW), the ~13 unused CSS classes in `globals.css`, the zero-importer components (`ArtifactPicker`, `ArtifactBrowser`, `ProjectPicker`, `CodebasePicker`, `ChatList`, `WorkflowDefinitionList`), unused deps (`material-file-icons`, `rehype-highlight`). Lower the ratchet baseline to the measured counts. | `03-component-inventory-kit.md` §8, `04-screen-map.md` §0 | typecheck/test/e2e unchanged vs BASELINE |
| P0-06 | **Cross-plan coordination (owner action).** Apply the PD-19 amendment below to the Workflow Overhaul Plan artifact. | §Coordination below | Amendment recorded in that plan |

**Exit.** CI green on the redesign branch with all new rules; plan and boards in repo; BASELINE recorded.

---

## P1 — Platform upgrades, tokens v2, shared registries

**Goal.** The toolchain is current; the new design vocabulary exists (additively) with all scales, fonts and defaults; the shared React-free registries exist; routing, theme writing and the overlay contract are restructured — all **without visually changing any legacy page** (GitHub/blue pinned screenshots pixel-identical).
**Entry.** P0 done.
**Order.** Upgrades first (U-tasks, each its own PR, full suite green before the next), then the router split, then tokens T1–T11 in order, with S-tasks slotted as noted.

### P1-U Platform upgrades (D-37)
| ID | Task | Acceptance |
|---|---|---|
| P1-U1 | Tailwind 4.2 → 4.3 | Built CSS diff limited to the version banner; e2e baseline unchanged |
| P1-U2 | TypeScript 5.8 → 6.0 (all packages) | `pnpm -r typecheck` green |
| P1-U3 | Vite 6.4 → 7.x and Vitest → 4 (`@vitest/browser-playwright` available for Storybook) | web/desktop build + all tests green; bundle budget unchanged |
| P1-U4 | React Router 7 → 8: `react-router-dom` → `react-router`, React ≥ 19.2.7 | e2e navigation spec green; `useBlocker` in WorkflowBuilder still blocks |
| P1-U5 | lucide-react 0.460 → 1.x + `apps/web/src/ui/icons` registry reading `ICON_CONCEPTS` (lands after P1-T11 or creates the concept file stub); brand icons → `ui/icons/vendor/` | registry name test green; no missing-icon warnings in the console on every route |

### P1-S3 Router split (before tokens; unblocks parallel work)
Per-area route modules `app/routes/<area>.routes.tsx` (they lazy-import today's `pages/*` and, after each port, the `features/<area>/` page), `app/routes/index.ts`, `defineRoute`, `RouteSlot` (the place LegacyHeader will render), `'*'` + errorElement placeholders; delete `router.tsx`. Lands after P1-U4, so it imports from `react-router`. Detail: `06-desktop-and-shell.md` §2.4, `04-screen-map.md` §0–§1. *Accept:* every route behaves as today; e2e green.

### P1-T Tokens (detail and exact acceptance: `02-design-system-spec.md` §13)
Baseline check for every T-task: GitHub/blue pinned, dark and light, screenshots of `/`, `/chats`, `/workflows` at 1440×900, pixel diff AE = 0 unless stated.

| ID | Task |
|---|---|
| P1-T1 | Collision codemod: legacy `accent` → `accent-tint` (126 sites), `surface` → `card` (5 sites); drop legacy `raised`/`overlay` from the bridge (0 uses) |
| P1-T2 | Colour utilities: `oklabMix`, `ensureContrastAll`, `TINT` additions + unit tests |
| P1-T3 | Ink accent + `onAccent` across emitters (CSS legacy + ANSI + native additive + docs site + cli-core/tui-kit unions) |
| P1-T4 | Instrument theme + new defaults (`DEFAULT_THEME=instrument`; per-theme default accent; tests that pin github/blue updated) |
| P1-T5 | Design colour layer: `resolveDesignTokens`, `--gai-*` emission, `vocabulary.ts` + `vocabulary.css` (shared class vocabulary, M-02), native additive `--gai-*`, 252-combination suite |
| P1-T6 | Scales: radius (derived per theme, D-14), type (7 steps + font-size axis), heights + density, z-index (D-41), motion + reduced, focus ring utility, prose, shell width vars; per-platform geometry schema `packages/design-tokens/src/geometry.ts` with web values and typed empty `ios`/`android` slots (M-04) |
| P1-T7 | Fonts: Fontsource variable Instrument Sans + JetBrains Mono; stacks; `diffTheme.ts` mono var; font budget in `check-bundle-size.mjs` |
| P1-T8 (= P1-S4) | Pre-paint (generated), ThemeProvider single writer for 5 axes + reduce motion, desktop IPC `setAppearance`/`appearanceRequest`, `themeSource` mirroring, background hex push + persistence, both CSP hashes (`06-desktop-and-shell.md` §6) |
| P1-T9 | tailwind-merge v3 + `cn` with generated config + conflict test |
| P1-T10 | Status map in `packages/shared/src/status` (8 states, exhaustive over server unions); client-core re-exports shared `RunStatus`/`StageRunStatus` |
| P1-T11 | Icon concept registry `packages/design-tokens/src/icons.ts` (48 concepts + status + UI glyphs; lucide names; empty sf/material) |

### P1-S Shared registries, overlay contract, Storybook
| ID | Task | Detail | Acceptance |
|---|---|---|---|
| P1-S1 | `CHROME` + `SHELL` constants and chrome colours in `design-tokens` (`./chrome` export); desktop devDependency + tsup `noExternal`; `platform.ts`/`window-manager.ts` use `CHROME.minWindow` only | `06` §3.1–§3.2, `02` §8 | desktop build/typecheck/test + packaged smoke green |
| P1-S2 | Command/shortcut registry + `NAV_DESTINATIONS` in `@generatorai/shared/ui-contract`; `menu.ts`/`tray.ts` consume it (Home label, Agents entry, per-host accelerators); `DesktopCommand` from the registry; `useCommandHost` replaces the switch in `useDesktopIntegration.ts` and the ⌘K handler in `AppLayout.tsx`; `ShortcutsSheet` (fixes the dead "Keyboard Shortcuts" command); `scripts.reload` wired | `06` §5 | Help ▸ Keyboard Shortcuts opens the sheet on all hosts; web `G C` → Chats, ignored in text inputs |
| P1-S5 | Overlay contract: `ui/lib/overlay.ts`, pure `nativeBrowserOcclusion.ts` (selector `[data-gai-overlay], [data-sonner-toast]` + ancestor exemption) wired into `NativeBrowserView.tsx`; legacy selectors kept in `LEGACY_OVERLAY_SELECTOR` until P7 | `06` §4.1–§4.2, D-19 | unit tests 1–7 green; on desktop a toast now hides the native view; Radix menus still do |
| P1-SB | Storybook 10 in `apps/web/.storybook` (Vite builder, Tailwind, fonts, appearance toolbar), addon-vitest (browser), addon-a11y (fail on violations), addon-mcp; one "Foundations" story rendering the token vocabulary in all themes; `claude mcp add --transport http storybook http://localhost:6006/mcp --scope project`; CI `storybook` job; VRT container `docker/vrt.Dockerfile` + stories project | `09` §3, §4.4 | `test:stories` green in CI; MCP lists the Foundations story; VRT `stories` project green (the `routes` project needs P2-00's seeded server — if P2-00 has not merged, it is added in P3-08) |

**Exit.** All T/U/S tasks merged; 252-combination WCAG suite green; legacy pages pixel-identical with GitHub/blue pinned; cleared storage renders Instrument/ink; Storybook + VRT jobs green; registries typed and consumed by desktop menu/tray.

---

## P2 — Backend track (runs alongside P1–P5)

**Goal.** Every designed element has real data before its page is ported (D-36). All gaps and exact shapes: `05-gap-matrix.md`.
**Rules for every P2 PR** (`05-gap-matrix.md` §5): cross-platform file/disk APIs only; SCM-touching tests on a dummy repo; replace response shapes cleanly and update every consumer (web, mobile, CLI) in the same PR; read models in `packages/client-core`; add the mobile note to `08-mobile-readiness.md`.

| Order | ID | Gap | Needed by |
|---|---|---|---|
| 0 | P2-00 | Test harness: rename the load-test-only fake-provider env var (`GENERATORAI_LOAD_TEST_FAUX_HARNESS`) to a general test flag, add a scripted-response hook, seeded isolated server script for VRT/e2e (ports 3197/5197) — or adopt the Workflow Overhaul Plan's test server if it has landed | P1-SB VRT routes, P3 |
| 1 | P2-01 | **G-01 attention feed** (service, `GET /attention`, SSE events, client-core store, web hook) — start during P1 | P3 sidebar |
| 2 | P2-02 | G-02 chat list v2 (migration for `last_*`/`changes_*`, paging, filters) + G-14 | P3 ChatsList |
| 3 | P2-03 | G-03 server switcher, G-04 update state in renderer, G-05 attention counts in desktop main (parallel) | P3 |
| 4 | P2-04 | G-08 deep links keep allowlisted query (fixes `generatorai://pair?code=`), G-09 model-picker provider methods, G-20 task cancel attribution; then G-07 computer consent/take-over | P4 |
| 5 | P2-05 | G-12 system info → G-13 project summaries → G-14/G-15 project chats/runs → G-10 stats → G-11 recently finished | P5 |
| 6 | P2-06 | G-16 fetch logs, G-17 worktree enrichment, G-19 per-project customization on server, G-18 palette entity search | P5 |

Note: G-10 and G-15 touch run history, which the Workflow Overhaul Plan's migration drops — coordinate before implementing.

---

## P3 — Slice A: shell + Chats list

**Goal.** The new app frame (sidebar/rail/main card/title chrome per OS), command palette, native IA and the first ~25 primitives are live; every legacy page still works inside the new frame via `LegacyHeader`; the Chats list is the first ported page.
**Entry.** P1 done; G-01…G-05 merged (sidebar live lists render only if G-01 exists — never fake).

| ID | Task | Detail | Acceptance |
|---|---|---|---|
| P3-01 | **Primitives batch A** (+ stories, a11y): Icon, Button, IconButton, Kbd, Badge, StatusBadge (P1-T10 map; `StatusBadgeProps` in `packages/shared/src/ui-contract/`, M-11), StatusDot, Count, Chip, Avatar, Spinner, Separator, Link | `03-kit` §2, §6 Rosetta | Storybook tests green; MCP lists them |
| P3-02 | **Primitives batch B**: Input, SearchInput, SegmentedControl (`semantics` prop), NavItem, Tooltip, Menu (+context, submenu, kbd hints), AlertDialog, Toast (sonner wrapper), ScrollArea, Skeleton, EmptyState, Toolbar, Checkbox, Table, Autocomplete (for the palette) — Base UI seeded via shadcn CLI, restyled | `03-kit` §2, D-05 | every floating part carries `data-gai-overlay`; stories for all variants × states |
| P3-03 | **Patterns + T-01**: PageHeader, Breadcrumb, PageTitle, FilterBar, DataTable (virtualized), BulkActionBar, SectionHeader, MenuButton; ListPage template | `03-kit` §3, §5 | stories incl. empty/loading/error and 1100px |
| P3-04 | **App frame + desktop chrome geometry** (= `06` P3-S1 + P3-S2, one PR): `ui/shell` S-01…S-07 + S-13; `app/shell` wiring (ConnectedSidebar with attention lists, rail at < 1200px, server switcher, connection footer); `LegacyHeader` in `RouteSlot` for every unported route; `uiStore` → `shellStore`; per-OS chrome (`platform.ts` §3.3, `window-manager.ts` §3.4, `lib/desktop.ts` §3.6, `--titlebar-*` → `--gai-titlebar-*`, drag rules §3.7); NotFound + RouteError (L-03); delete `AppLayout.tsx`, `TitleBar.tsx`, `Sidebar.tsx`; rewrite `desktop-chrome-smoke`, `packaged-app-smoke`, `navigation.spec`, `browser-ui-e2e` | `06` §2–§3, §9.1; `09` §7 | per-OS matrix rows 1–5 (macOS, Windows, Linux native, Linux custom, web); board-vs-app PNGs for DesktopMac, DesktopWindows, Main (frame only), ChatNarrow (rail); every legacy route keeps its Header actions; mac rail inset shows no overlap |
| P3-05 | **Command palette** (Base UI Autocomplete; Go to / Actions / Recent chats; registry hints; Tab → row actions; `theme.toggle`). Builds P-31 Dialog (pulled forward from P4-05), S-10 CommandPaletteFrame and C-21 CommandList. Delete `components/layout/CommandPalette.tsx`; `cmdk` stays until `SearchableSelect` and `ui/primitives/command.tsx` lose their last importer (`03-kit` §8, P5). Entity search is P5-12 | `06` §10 P3-S3; F-palette in `03-domain` | CommandPalette board comparison; `Mod+K` opens from a textarea |
| P3-06 | **Native IA alignment** (`06` P3-S4): menu, tray, macOS dock menu, JumpList, `generatorai://command/<id>`, Servers IPC + popover (G-03), updater pill (G-04), badge counts (G-05) | `06` §8 | `generatorai://command/chat.new` works cold and warm; mock update server shows the pill **and installs** on each OS (fix `app.exit(0)` path if not, `06` §11 R5) |
| P3-07 | **Chats list port** (T-01; G-02 columns; All/Active/Archived; filters; Select mode + bulk actions; floating BulkActionBar); delete `pages/ChatsListPage.tsx`, `data/FilterTabs` users it owned. "New chat" keeps opening the existing `components/chat/CreateChatDialog.tsx` until P5-09 replaces it | `04` §2.1 ChatsList; `03-domain` §3.5 | first page with `legacyHeader: false`; `ChatRowModel` in `ui-contract` (M-11); `chats.spec.ts` updated; VRT route baselines for `/chats` |
| P3-08 | **VRT route baselines** for the shell on 4 legacy routes + `/chats`; update BASELINE.md | `09` §4 | vrt job green |

**Exit.** New frame on all OSes and web; no legacy route lost an action; Chats list matches its board (differences listed in its DIFF.md); ratchet lowered.

---

## P4 — Slice B: chat workspace

**Goal.** The chat page (`/chats/:id`) is fully on the kit: transcript, composer and all dock panels, with the giant files split, the desktop browser contract hardened, and extension points ready for the Workflow Overhaul Plan.
**Entry.** P3 done; G-08, G-09 merged (G-07 may land later — the Computer panel degrades).
**Rule.** Every giant-file split is two PRs: (1) characterization tests + logic extraction with no visual change, (2) the new view.

| ID | Task | Detail | Acceptance |
|---|---|---|---|
| P4-01 | **Characterization tests** for ChatInput, BrowserPanel + NativeBrowserView, ChangesSurface, ChatPage, RightPane (behaviour lists with file:line) — may be 2–3 PRs | `09` §5; `03-domain` §6 | all green on current code; the IME-Enter bug recorded as `it.fails` |
| P4-02 | **Composer logic extraction**: composer state machine as a pure reducer in `packages/client-core/src/composer` (M-12; two-phase stop 400 ms / 15 s); `ui-contract` composer states; ChatInput split into the 8 hooks (`03-domain` §6.1) — no visual change | `03-domain` §3.2, §6.1 | characterization tests unchanged and green |
| P4-03 | **Browser logic extraction**: BrowserPanel transport/stream hook, input mapping module, native view driver — no visual change | `03-domain` §6.2 | tests green; desktop browser smoke green |
| P4-04 | **Changes + ChatPage logic extraction**: ChangesSurface hooks; `useChatView` controller; ChatPage raw `fetch` → query hooks; `apiFetch`/`usePlatform` direct uses in chat components → hooks | `03-domain` §6.3–§6.4 | tests green; no `fetch('/api` in `features/`/`blocks/` |
| P4-05 | **Primitives + patterns batch C**: Textarea, Combobox, Popover, Sheet, Gauge (context ring), Callout, InlineCode, Collapsible, Slider, Switch (only if a composer toggle needs it; otherwise P5-01) — Dialog already landed in P3-05; DockTabStrip, SplitPane, CodeBlock, TerminalFrame, StepRail, KbdHintRow, GateCardFrame, FindWidget, DiffStat; T-04 Workspace | `03-kit` §9 P4 | stories + a11y green |
| P4-06 | **DockFrame** (`06` P4-S1): react-resizable-panels 4, stable tree across 1200px, non-modal narrow sheet, collapse-not-unmount, `blocks/dock` state (`generatorai:dock:chat:*`), `?dock=` param (R-4), browser-host injected palette from tokens; **swap the legacy workflow run page's panel imports** (Changes, Terminal, Browser, Widget) to the new blocks — `RightPane.tsx` itself stays for that page until PW or the D-35 fallback (`04` §2.1 note); dock tab ids in `packages/shared/src/ui-contract/pane.ts` (M-11) | `06` §4.3–§4.4; D-27; D-35 | `desktop-dock-browser-smoke.mjs` cases 1–7 on macOS, Windows, Linux; crossing 1200 does not destroy the browser view; legacy run page still works |
| P4-07 | **Transcript kit** (`blocks/transcript`): turn header, step rail rows + verbs (`ui-contract`), thought pill, tool-call cards + **tool-card registry**, gate cards (permission, question, plan, computer consent; `GateKind` + actions in `packages/shared/src/ui-contract/gates.ts`, action copy in `copy.ts`, M-11/M-13), inline error, delegation group, background step tail; Streamdown 2 + Shiki 4 replacing react-markdown/highlight.js; G-06 view mode (client only); **virtualization spike** (D-33, acceptance incl. Find-in-page) | `03-domain` §2.4; `09` §8.2 | spike report committed; transcript renders every `StreamBlock` kind; `streaming-turn-live.spec` green |
| P4-08 | **Composer view** (`blocks/composer`): toolbar chips, blocking bars, slash/@ menus, attachments, dictation, sources/skills·MCP chips, orchestrator team row, context gauge popover, **composer tool-toggle registry**; ModelPicker + AgentPicker blocks (G-09) | `03-domain` §3.2, §2.1 | every ComposerStates panel reproduced (DIFF.md per state); `context-usage-ui.spec` green |
| P4-09 | **Changes panel** (`blocks/changes`): compare This turn/This chat/Branch, checkpoint scrubber + Rewind, inline comment threads, unified/split DiffView, **Keep / Keep all / Undo all** (D-28), commit → push → PR footer; FileTree block | `03-domain` §3.3; DockChanges board | diff-review smokes green; SCM tested on a dummy repo |
| P4-10 | **Files, Terminal, Browser panels** (`blocks/files`, `blocks/terminal`, `blocks/browser`): pinned Files tab + file-viewer tabs; agent console + shells (xterm themed from tokens); browser tabs, comment pins, capture, device emulation; D-19 tests (sheet ancestor exemption, menu over view, maximized dock) | DockFiles/DockTerminal/DockBrowser boards; `06` §4.5 | terminal + browser desktop smokes on 3 OSes |
| P4-11 | **Tasks, Computer, Plan, Widget panels**: Tasks (orchestrator chats only) with **pluggable sections registry**; Computer (replay; G-07 consent/take-over when available); Plan (revisions, inline comments — existing API); Widget via "+" | DockTasks/ChatComputer/ChatPlan boards | panels match boards; registries documented |
| P4-12 | **ChatPage on T-04**: chat header actions (Archive, Open in editor, fork provenance, dock toggle "Show side pane"), `legacyHeader: false`, FindBar restyle, delete `ChatInput.tsx`, `BrowserPanel.tsx`, `ChangesSurface.tsx`, the chat's use of `RightPane.tsx` (the file stays for the legacy run page), `rightPaneStore` Header bridge, `pages/ChatPage.tsx` | `04` §2.1; `09` §7.1 P4 row | all P4 specs/smokes green; board-vs-app DIFF.md for Main, ChatLight, ChatNarrow, Chat* boards |

**Handoff to the Workflow Overhaul Plan (end of P4).** Publish in `docs/redesign/HANDOFF.md`: the kit's Storybook URL/MCP, the template list, `blocks/transcript` + tool-card registry, `blocks/composer` (compact variant for stage messages) + tool-toggle registry, dock state + Tasks sections registry, status map, and the WF-xx list (`03-component-inventory-domain.md` §4) with which are already built. From here, that plan's UI work packages build on the kit.

**Exit.** Chat workspace fully ported; old chat files deleted; desktop browser contract tests green on 3 OSes; handoff published.

---

## P5 — Fan-out

**Goal.** Every remaining redesign-owned page is on the kit.
**Entry.** P4 done; the P2 gaps for each page merged before that page's PR (no fake data).
**Parallel.** Page PRs are independent once P5-01 lands.

| ID | Task | Boards / detail | Gaps |
|---|---|---|---|
| P5-01 | **Kit batch D**: Field, Select, Switch (if not in P4), RadioGroup, RadioCard, Tabs, ProgressBar/Meter, Card; EntityRow, ActivityRow, EntityCard/CardGrid, StatStrip, KeyValueList, FormSection, SummaryAside, ActionBar, Inspector, ChoiceCardGrid, PairingCodeInput, Banner, Dropzone, ModalForm; T-02, T-03, L-01 (L-03 already exists from P3-04's NotFound/RouteError); empty-state copy into `packages/shared/src/ui-contract/copy.ts` (M-13) | `03-kit` §9 P5 | — |
| P5-02 | **Projects list** (T-01) | Projects | G-13 |
| P5-03 | **Create project** (T-03; content from mobile `MProjectCreate`) | — (D-32) | — |
| P5-04 | **Project detail** (T-02; tabs as path segments R-3: Codebases, Chats, Runs, Pull requests, Customization, Settings); split `ProjectDetailPage.tsx` | ProjectDetail, ProjectCustomization | G-13, G-14, G-15, G-19 |
| P5-05 | **Codebase detail** (T-02: Worktrees, Files) | CodebaseDetail | G-16, G-17 |
| P5-06 | **Pull request page** (T-02 + DiffView block; D-31) | — | — |
| P5-07 | **Agents list** (T-01 grid, role filter, export `.agent.md`) | Agents | — |
| P5-08 | **Agent editor** (T-03, TanStack Form + zod 4, CapabilityToggleList + effective-capabilities aside) | AgentEditor, AgentPickerBoard | — |
| P5-09 | **New chat dialog + `/chats/new` page** (R-1; shared `CreateChatDraft`; who-works chooser, orchestrate switch, sources, capabilities, browser settings, summary aside) | NewChat, ChatCreate, ChatCreateOrchestrator, ChatCreateModel | — |
| P5-10 | **Home** (L-01) replacing Dashboard: quick-start composer, Needs you with inline actions, Running, Recently finished, This week stats, System card, shortcuts; rename Dashboard→Home everywhere; `docs/clients/*.md` | Home | G-01, G-10, G-11, G-12 |
| P5-11 | **Pairing gate** (L-03; split `AuthGate.tsx` logic from view; code layout from the server format, D-42) + **static desktop pages** (splash/error/prompt from tokens, `06` §7) | Pairing | — |
| P5-12 | **Palette entity search + recents** | CommandPalette | G-18 |
| P5-13 | **WF-xx engine-independent pieces** (only those the Workflow Overhaul Plan asks for at this point: version/key chips, problems panel, stage table row, lifecycle card, budget/context meters, decision/review cards, version-history panel) | `03-domain` §4 | coordinate with that plan |

**Exit.** All redesign-owned routes have `legacyHeader: false`; feature-parity checklist (`04-screen-map.md` §4) ticked for these areas.

---

## P6 — Settings modal and sections

**Goal.** Settings is the 960×640 modal addressed by URL with all 15 sections on the section recipe.
**Entry.** P5-01 done.

| ID | Task | Detail |
|---|---|---|
| P6-01 | NumberField, swatch/tile variants, C-13 SettingsSection/SettingRow/SettingsTable recipe, C-34 ListPane, S-11 SettingsModalFrame, T-05 MasterDetail | `03-kit` §9 P6 |
| P6-02 | **Settings modal route** (D-26 background location; `open-settings` command from the native menu; `isOverlayNavigation` so the WorkflowBuilder blocker ignores it; `generatorai://settings/<section>`); searchable nav from `SETTINGS_NAV`; update `navigation.spec` URL assertion deliberately | `06` §2.4, P6-S1 |
| P6-03 | **Appearance** (18 themes × mode × 7 accents, density, font size, reduce motion; live previews) | SettingsAppearance |
| P6-04 | **Security & devices** (split `Security.tsx`: servers, network — only server-supported options (D-42), pairing + QR, requests, devices) | SettingsSecurity |
| P6-05…P6-10 | Remaining 13 sections in batches of 2–3 (General · Model providers · Agents · Skills · MCP servers · Templates · Source control · Browser & terminal · Computer use · Audio · Extensions · Storage · Diagnostics), each from the recipe with the mobile settings board as content reference | `04-screen-map.md` §3.1; `03-domain` §3.9 |
| P6-11 | Delete `pages/SettingsPage.tsx`, `components/settings/shared.tsx` (after `ProjectDetailPage` no longer imports it) | — |

**Exit.** Settings e2e specs green; every section reachable by URL and palette.

---

## PW — Workflow surfaces (built by the Workflow Overhaul Plan, D-35)

Owned by https://claude.ai/artifact/Kqrzv5CnsYg13EdQNTp2gC. This plan's contribution: the kit, templates L-02/L-04/L-05, Stepper, WF-xx pieces, registries, the dock, the status map, the board map in `04-screen-map.md` §2.6 (which boards each of its work packages builds), and the gap list G-21…G-29. Builder routes get `forceRail`; the run page uses T-04 + DockFrame at 440px with `generatorai:dock:run:*` keys.

**Fallback (D-35).** If PW's UI work packages have not started when P6 finishes, port the current Workflows list, WorkflowDetail and Automations list/detail as-is onto the kit (no new features) so P7 is not blocked; builder and run page keep `LegacyHeader` and P7's global steps skip them.

### Coordination — amendment text for the Workflow Overhaul Plan (P0-06)
> **PD-19 (amended 2026-09-25).** Both plans run in parallel on separate branches/worktrees. (1) Engine, data, API and store work proceeds immediately and is unaffected. (2) Overhaul UI work packages scheduled **before** the redesign handoff (end of redesign P4, ~week 10 — this includes WP-1.8, the v2 builder) stay **functional-only on the existing components**: wire the new data and behaviour, add no new visual design, add no new ad-hoc styling. (3) Every overhaul UI work package **after** the handoff builds its screens **once**, directly on the redesign kit (`apps/web/src/ui`, `apps/web/src/blocks`), and also rebuilds the functional-only screens from (2) on the kit. Result: the builder is built twice (functional, then final), everything else once — instead of three times. Until a screen is rebuilt, the current workflow pages keep running inside the new shell. The redesign supplies: templates, Stepper, WF-xx pieces, tool-card and composer tool-toggle registries, Tasks-dock sections registry, dock state, and the shared 8-state status map in `packages/shared/src/status` (both plans edit that one file). Costs show tokens-only when a provider doesn't report cost. E2E for workflows uses the overhaul's isolated test server, never :3100 or the real DB. Migration v55 (drops run history) is coordinated with redesign gaps G-10/G-15.

### Running in parallel with the Workflow Overhaul (rules for both sessions)

| Area | Owner | Rule for the redesign session |
|---|---|---|
| `apps/web/src/pages/{Workflow*,Automation*,CreateAutomation*,Script*}.tsx`, `components/{workflow,automation}/**`, `stores/workflow*`, `hooks/{workflow,automation,script}Queries.ts`, server workflow/automation/script routes and engine, their DB tables | Workflow Overhaul | **Do not edit**, except the whole-repo mechanical changes below |
| Whole-repo mechanical changes: P0-05 dead-code deletes, P1-U1…U5 upgrades, P1-T1 collision codemod, P1-S3 router split, P4-06 import swap in the legacy run page | Redesign | Land each as a **short-lived, separate commit/PR, merged quickly**, and note it in `docs/redesign/COORDINATION.md` (date, commit, files touched in workflow-owned areas) so the other session rebases right after. Never mix with feature work |
| `packages/shared/src/status/**` (8-state map), `packages/shared/src/ui-contract/**`, `packages/design-tokens/**` | Redesign (shared) | The overhaul adds statuses only through this file; the exhaustive map makes an unmapped server status a type error, which is intended |
| DB migrations | Both | Before adding a migration (P2-02 G-02, G-10, G-15 …), fetch the base branch and take the next free number; if the other branch lands one first, renumber yours before merging. G-10/G-15 read run history, which overhaul migration v55 drops — implement them after v55 or make them tolerate empty history |
| `HttpPlatformClient.ts`, `IPlatformClient` in `packages/shared`, `apps/server/src/routes/index.ts`, `openapi.ts` | Both | Append-only edits; expect textual merge conflicts and resolve by keeping both sides |
| Merge cadence | Both | Merge the base branch into the redesign branch at the start of every phase and at least weekly; run the full Done loop after each merge |

---

## P7 — Lockdown

**Entry.** P6 done and PW done (or the D-35 fallback applied).

| ID | Task |
|---|---|
| P7-01 | Delete `components/layout/Header.tsx`, `LegacyHeader`, `legacyHeader` route handles, `LEGACY_OVERLAY_SELECTOR`, `.app-titlebar` legacy CSS, `RightPane.tsx`/`useRightPaneOpen`/`useResizablePane` (if PW ported the run page), remaining `components/**` per `03-kit` §8 delete list |
| P7-02 | Remove the legacy token layer (unprefixed vars + compat `--color-*` + legacy `@theme` bridge) once the ratchet reports 0 legacy usages; **reset Tailwind default namespaces** (`--color-*`, `--text-*`, `--radius-*`, `--shadow-*` → `initial`) gated on 0 default-namespace usages (D-07); remove Radix packages |
| P7-03 | Turn every ESLint design rule to `error`; ratchet baselines at 0; rewrite `apps/web/DESIGN_SYSTEM.md` as the kit index (generated from Storybook manifest where possible); update `.github/AGENTS.md` |
| P7-04 | Full regression: all e2e specs and desktop smokes on macOS, Windows, Linux (native + custom), VRT full matrix, a11y |

**Exit.** No legacy UI code, no legacy tokens, no Radix; all rules are errors.

## P8 — Deferred platform upgrades
P8-01 Vite 7 → 8 (Rolldown) once Storybook, Vitest and `@tailwindcss/vite` support it · P8-02 React Compiler 1.0 (`'use no memo'` for `useVirtualizer` components; measure xyflow canvases) · P8-03 TypeScript 7 for `tsc` after 7.1 lands (typescript-eslint support).

---

## Mobile-readiness deliverables → tasks

Mobile UI is not built in this pass (D-39, D-40), but every shared item in `08-mobile-readiness.md` §1 has an owning task here. A task that builds one of them is not done until the shared item exists in its React-free package.

| 08 item | Built in |
|---|---|
| M-01 token names + native literals | P1-T5 (native additive `--gai-*`) |
| M-02 shared class vocabulary (`vocabulary.css`) | P1-T5 |
| M-03 Instrument + ink | P1-T3, P1-T4 |
| M-04 per-platform geometry schema | P1-T6 |
| M-05 icon concept registry | P1-T11 (lucide names via P1-U5) |
| M-06 8-state status map | P1-T10 |
| M-07 / M-08 `NAV_DESTINATIONS` + command registry | P1-S2 |
| M-09 attention feed read model | P2-01 |
| M-10 other read models | P2-02 … P2-06 |
| M-11 UI-contract types | P3-01 (status badge), P3-07 (`ChatRowModel`), P4-02 (composer states), P4-06 (pane tab ids), P4-07 (tool verbs, gate kinds) |
| M-12 composer reducer | P4-02 |
| M-13 shared copy | P1-T10 (status labels), P4-07 (gate actions), P5-01 (empty states) |
| M-14 font licensing header | P1-T7 |

---

## Risk register

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | Two overhauls rewrite the same workflow UI | High / High | D-35, PD-19 amendment, shared status file, handoff |
| R-2 | Hidden backend scope stalls UI PRs or tempts fake data | High / Med | Gap matrix; P2 track ahead of each page; review rejects mock data |
| R-3 | Chat workspace regressions (streaming, native browser, composer states, two-phase stop) | Med / High | Characterization tests first; two-PR splits; desktop smokes on 3 OSes |
| R-4 | Silent CSS breakage (missing `@source`, merge collisions, namespace reset) | Med / High | Additive tokens; CSS-emission check; tailwind-merge test; reset only at 0 usage; VRT |
| R-5 | Desktop regressions on an untested OS | Med / High | Per-OS matrix for every shell/dock/overlay/theme PR; shared `CHROME` constants |
| R-6 | LLM drift (new variants, arbitrary values, wrong layer, Radix APIs on Base UI) | High / Med | CLAUDE.md, lint boundaries, better-tailwindcss, Storybook MCP, ratchet |
| R-7 | Design keeps changing | Med / Med | Snapshot VERSION check at session start; kit grows with consumers; `11-design-feedback.md` |
| R-8 | Transcript virtualization breaks Find or anchoring | Med / Med | D-33 spike acceptance incl. Find; fallback to collapsing old turns |
| R-9 | Contrast fixes flatten the visual hierarchy (fg-3 ≈ fg-2 in most themes) | High / Low | Accepted (D-12); Instrument keeps a visible step |
| R-10 | Updater install path unverified (`app.exit(0)`) | Med / Med | P3-06 tests install with the mock update server on each OS |
