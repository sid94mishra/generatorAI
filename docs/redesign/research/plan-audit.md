# Audit of Plan v1: GeneratorAI web and desktop design overhaul

Auditor: an independent review, adversarial by brief. I read `plan-v1.md`, `design-system-spec.md`, `screen-feature-map.md`, the board deltas in `delta/`, and the workflow overhaul plan that sits beside them (`wfplan/`). I checked the claims against the repo at `desktop_redesign @ a83a7bf`. Every number below was measured with grep or tsc unless it is marked as an estimate.

---

## 1. Verdict

**The direction is right, but the plan is not executable as written.**

These parts are sound:
- the layer model (tokens, primitives, patterns, templates, features);
- keeping the token engine and the WCAG suite;
- keeping Radix;
- migrating page by page (strangler) and deleting as you go;
- the recipe of view hooks plus a template for the large pages.

Five problems would, on their own, cause weeks of rework or a broken app in the middle of the migration:

1. **It treats the redesign as front-end only.** It also runs in parallel with a separate 30-week workflow overhaul (`wfplan/`, same base branch, same date), and it does not mention that plan. Many of the designed features need new server or client-core APIs. The workflow boards updated today (loops, versions, agent draft, run dialog, workflow-run cards in chat) are the UI for work in phases P01/P04/P05/P06 of that plan.
2. **It resets Tailwind's default namespaces in Phase 1, while about 200 files still use them.** Tailwind emits nothing for an unknown class and gives no error, so the breakage would be silent.
3. **It removes the global Header in Phase 3, before any page is ported.** `Header.tsx` carries the chat actions today.
4. **It builds the kit before any real page uses it, while the design is still changing.** The status map went from 7 to 8 states today, and 15 workflow boards changed.
5. **It ignores several desktop contracts that the new layout breaks.** The narrow dock sheet is `role="dialog"` and would hide its own browser view. The macOS traffic lights do not fit in a 48px rail. Browsers reserve the design's shortcuts.

**Recommendation:** keep the architecture, reorder into vertical slices, make the token work additive, and add a backend and cross-plan coordination track. The corrected plan is roughly 70–90 PRs, not about 30.

---

## 2. Issues ranked

### Critical

#### C1. The plan treats "stores/hooks/*Queries unchanged" as true. It is false: a large share of the design needs new APIs.

**Evidence.**
- The sidebar shows **Needs you** and **Running** on every screen, mixing chats and runs, and Home is built on the same lists. The server exposes only per-entity endpoints: `chats.ts:1145 GET /:id/interactions` and `workflowRuns.ts:420 GET /:id/pending-interrupts`. There is no cross-entity feed and no SSE scope for one.
- Other designed data with no endpoint today:
  - Home "This week" stats;
  - the Workflows stat strip (Runs 30d, Median run time);
  - Automations "Next run" and AutomationDetail "Executions 30d / Avg duration";
  - Projects columns (Active chats, Worktrees, Last run);
  - ProjectDetail **Chats** and **Runs** tabs;
  - the ChatsList "Changes +/−" column;
  - the transcript view mode (Normal / Verbose / Summary);
  - Computer replay and grants;
  - plan revisions v1/v2/v3 with inline step comments;
  - the model-picker detail (max output, reasoning levels);
  - the palette's entity search.
- The updated workflow boards (`delta/WorkflowLoopBuilder`, `WorkflowAgentDraft`, `WorkflowRunDialog`, `WorkflowRunLoop`, `ChatWorkflowRun`) show a loop stage ("Loop · max 5, until verdict == 'approve'"), Version history, Draft/Publish and Test run. These are exactly `wfplan` P01 (versions, draft/publish), P04 (invocation), P05 (generic loop) and P06 (agent authoring and tool cards). Those phases total roughly 20 or more weeks and are not built yet.

**Fix.**
- Add a **gap matrix** to Phase 0 with one row per designed element and one column per class: *UI only*, *needs API (new endpoint, SSE scope, client-core method)*, or *blocked by wfplan phase N*.
- Put every new read model in `packages/client-core`, so the mobile app gets it for free. The mobile boards also have Needs you and Running.
- Build the **attention/activity feed** (one endpoint plus one SSE scope) before the shell slice. The sidebar depends on it.
- Anything blocked by wfplan ships later, not as fake UI.

#### C2. Collision with the workflow overhaul plan

**Evidence.**
- `wfplan/README.md` is dated 2026-09-24, with baseline `desktop_redesign @ a83a7bf`, the same commit as this plan.
- Its PD-19 reads: "the overhaul lands data, API, stores and behaviour with existing components; the redesign reskins once afterwards."
- Plan v1 puts "→ workflows →" in the middle of Phase 4.
- The two plans would rewrite the same files:
  - wfplan P03b rebuilds the run page (stage conversation, amend, turn cancel);
  - wfplan P05 changes the builder model (loops, maps, sub-workflows);
  - Plan v1 ports `WorkflowRunPageV2`, `WorkflowBuilderPage` and `StagePropertiesPanel`.
- Also, `delta/Foundations.diff` adds an 8th status, **Waiting** ("Wait stage on an event, timer or form"), and redefines Paused. That comes straight from wfplan's `wait` stage, and it already makes plan v1's "single 7-state map" stale.

**Fix.**
- Make the sequencing between the two plans explicit:
  1. The redesign ports the workflow **list, detail and automations** surfaces early; they are shallow.
  2. The **builder, run page, stage inspector and wizard** go last, or are built *once* by the wfplan UI work packages on top of the new kit once kit v1 and the shell have landed. Change PD-19 to say "wfplan UI WPs consume `ui/` once it exists." Otherwise the run page gets built twice.
- Derive the status map from the server's state enum in a React-free place (`packages/shared` or `design-tokens`), not from a hand-typed list in `ui/status.ts`.
- Keep one shared "status vocabulary" file that both plans edit.

#### C3. Phase 1's Tailwind namespace reset would blank the unported app without any error

**Evidence.**
- The plan puts `--color-*: initial` and `--text-*: initial` in Phase 1.
- Current usage in `apps/web/src` (excluding tests):
  - **930** `text-xs|sm|base|lg|xl…`;
  - **299** palette classes;
  - **32** `text/bg/border-white|black`;
  - **986** default `rounded*`/`shadow*`.
- Tailwind v4 generates nothing for a class that no longer resolves. tsc, vitest and ESLint cannot see this. It would only appear in screenshots.
- `bg-transparent` and `bg-current` survive the reset, but `white` and `black` do not.
- Third-party CSS is *not* at risk: there is no `@apply` in `globals.css`, and xyflow, xterm, sonner and @pierre/diffs ship their own CSS.

**Fix.**
- Phase 1 **adds** the design namespaces (`--text-ui`, `--color-fg-2`, and so on) next to the defaults.
- The reset moves to Phase 5 (lockdown). It is gated by a new ratchet rule in `check-design-system.mjs` that counts default-namespace classes (`text-sm`, palette classes, `white/black`), and the reset lands only when that count is 0.
- Add a single CI job that builds and greps the emitted CSS for a list of design utilities, to catch a missing `@source` (see M4).

#### C4. Removing the global Header in the shell phase takes features away from pages that have not been ported

**Evidence.** `components/layout/Header.tsx` is 330 lines.
- It sniffs routes (`pathname.startsWith('/chats/')`, `isDashboard`, `isWorkflowsContext`) and runs `useChat` and `useArchiveChat`.
- It owns the chat header actions, the breadcrumb, connection status and the dark toggle.
- Plan v1's Phase 3 introduces the inset main card "with own 44px header (global Header removed)", but pages are ported only in Phase 4.
- `agent-tests/desktop-chrome-smoke.mjs:76,178–221` waits for `[data-testid="app-header"]` and `app-titlebar`, and asserts that the header sits below the title bar. `e2e/navigation.spec.ts` asserts `header-toggle-sidebar`, "Dashboard" and "Mission Control".

**Fix.**
- The shell exposes a `LegacyHeader` slot, driven by a route-meta flag (`legacyHeader: true`), that renders the current Header inside the main card for routes not yet ported. The flag is removed for each route as it is ported, and the component is deleted in lockdown.
- Rewrite the desktop smoke and navigation e2e in the **same PR** as the shell.
- Better still, ship the shell together with its first ported page (see M1).

### Major

#### M1. Build the kit alongside the first real pages, not before them

- Plan v1 builds about 30 primitives, about 15 patterns and 8 templates with nothing consuming them. For an LLM-driven project that is the worst case: every component is built from a static board with no real data or edge cases (long names, 0 or 1000 rows, loading and error states, a 1100px window, a light theme with a non-default palette). The API mistakes surface in Phase 4, when 30 or more consumers already exist.
- The design is also still changing: 15 workflow boards and the status map changed today.

**Recommended order:**
1. **Tokens, additive only.**
2. **Slice A:** about 12 primitives (Button, IconButton, Kbd, Badge/Status, Chip, Input/Search, Segmented, Tabs, Menu, Dialog, Tooltip, Table rows), **AppShell with the LegacyHeader slot** and the sidebar (including the attention feed), and **ChatsList** end to end.
3. **Slice B:** the chat workspace (dock frame, transcript kit, composer, NativeBrowserView contract, narrow sheet, desktop title strips). This is the hardest surface and validates the most kit.
4. **Fan out:** lists, details, forms, the settings modal, Home, the palette.
5. **Workflow deep surfaces**, coordinated with wfplan.
6. **Lockdown.**

The kit grows only on demand, and each primitive lands with its first consumer.

**Visual inconsistency:** old pages inside the new shell will look mismatched for about 6–10 weeks. That is acceptable, because the app is not live. It is fine as long as the old pages still *work* (C4) and old tokens keep their old values (M2).

#### M2. The token migration footprint is roughly three times the plan's count, and old→new is not 1:1, so do not alias

**Evidence.**
- Uses in `apps/web/src`:
  - `var(--color-*)`: **1,509** uses in 69 files (the plan says 1,403 in 67);
  - semantic utilities (`bg-background`, `text-muted-foreground`, `bg-accent`…): **2,563**;
  - `sidebar-accent`: **429**;
  - `accent` utilities and vars: 53 and 74.
- The spec's own §7 shows the mapping depends on appearance:
  - `--ground` is "the darker of background/card", which is `background` in dark themes and `card` in light ones;
  - `--hover`/`--selected` are new neutral washes replacing accent tints.
- So `bg-background → bg-ground` is wrong in half of the 34 appearance variants. An alias of old→new would visibly change unported pages differently in light and dark. A blind codemod has the same problem.

**Fix.**
- **Keep old tokens emitting their current values, untouched.** Add the design names as a new, parallel layer.
- Only the two names that collide need work up front:
  - codemod the old `--accent` to `--accent-tint` (127 sites);
  - codemod `--surface` (6 sites) in one PR before the new layer is emitted.
- Old names die when their last user is ported, which the ratchet tracks.

**Knock-on edits the plan does not list:**
- `index.html:21–26` hardcodes the defaults `'dark'`/`'github'`/`'blue'`, and must also apply **density** and **font-size** pre-paint, or controls will jump height on load.
- `apps/desktop/src/main/window-manager.ts:69–72` (`#0d1117`/`#ffffff`), `prompt-window.ts:44` and `platform.ts:70` (`titleBarSymbolColor`, GitHub hexes).
- `apps/Documentation Site/scripts/generate-theme.mjs:15` reads `resolveAppearanceTokens` fields (background, card, mutedForeground…) and breaks if `AppearanceTokens` fields are renamed.
- `apps/mobile/src/theme/tokens.generated.ts`: emit the new names **additively** in Phase 1 as well. It costs almost nothing and unblocks the mobile work.

**Background colour flash:** the main process only knows the mode (`loadSettings().theme`), not the palette. The renderer should push the resolved `--ground` to main (via `setBackgroundColor` plus persistence) so that the next launch paints the right colour in all 18 themes.

#### M3. tailwind-merge will silently drop classes once custom type names exist

**Evidence.** `tailwind-merge@^2.6.1` targets Tailwind v3. With custom namespaces (`text-ui`, `text-title`, `text-fg-2`), tailwind-merge v2 and v3 both classify an unknown `text-{x}` as a colour. `cn('text-fg-2', 'text-title')` then drops one of them.

**Fix.**
- Upgrade to v3.
- Use `extendTailwindMerge` with the theme scales (`text`, `color`, `radius`, `shadow`), **generated from design-tokens**.
- Add a unit test with about 10 conflict pairs.

This belongs to Phase 1, not the kit phase.

#### M4. `packages/ui` works but earns little. Use a folder with a lint boundary, or accept the plumbing it needs.

**What I verified.**
- The TS-source package pattern already works. `@generatorai/design-tokens` exports `./src/index.ts`, and `tsc --noEmit` on web passes cleanly in 10.5s, so TS project references and turbo are not a cost.
- The real costs are elsewhere:
  - **Tailwind v4 does not scan `../../packages/ui`.** It needs `@source "../../../../packages/ui/src"` in `globals.css`. Missing it fails silently, the same way as C3.
  - **The package boundary does not stop the `@` alias.** Vite's `@` alias is global and web's tsconfig `paths` maps `@/*`, so a file in `packages/ui` importing `@/stores/x` builds and typechecks under web. The package.json boundary does not catch it. It needs an ESLint `no-restricted-imports` rule on `packages/ui/**` for `@/*`, `@generatorai/client-*`, `@tanstack/react-query`, `zustand` and `react-router-dom`.
  - Separate vitest, happy-dom and jest-dom setup.
  - LLMs guessing wrongly which package a component lives in.
- **The package has one consumer.** Desktop loads the web SPA, mobile is React Native, and the docs site is Docusaurus.

**Recommendation.** Use `apps/web/src/ui/` with the same subfolders plus the ESLint boundary. That gives the same enforcement with none of the plumbing. It can be promoted to a package later if a second DOM consumer appears. If you keep the package, the `@source` line, the ESLint rule and the CSS-grep CI check are all mandatory.

**Missing layer: cross-feature domain composites.** These are the most-reused things in the design:
- `CapabilityToggleList` (6 surfaces);
- `ModelPicker` and `AgentPicker`;
- the diff view;
- the file tree with status letters;
- `EntityTable`/`FilterBar` bound to queries;
- the transcript parts, which the chat, the run page stages (wfplan P03b "a stage is a compact chat") and the palette recents all use.

They cannot live in `ui/`, because they need queries, and they must not live inside one feature. Add an `apps/web/src/blocks/` layer, allowed to import `ui/` and hooks but not features. Put chat-only composites (composer, dock panels) in `features/chat/`.

#### M5. Desktop coupling gaps

1. **The narrow dock sheet hides its own browser view.**
   - `NativeBrowserView.tsx:59–68` treats any `[role="dialog"]` that overlaps the view as an occluder.
   - The design's under-1200px dock is `role=dialog` and *contains* the Browser tab, so the WCV would hide itself permanently.
   - Fix: switch to an explicit `data-gai-overlay` contract (as planned), **ignore overlays that are ancestors of the container**, and add a test for "browser tab inside sheet stays visible".
   - The Maximize-dock state needs the same test.
2. **The macOS 48px rail cannot hold the traffic lights.**
   - The lights sit at x=16 and are about 52px wide (`MAC_TRAFFIC_LIGHT_INSET = 78`), but the rail is 48px.
   - `DesktopMac.txt` only shows the 232px sidebar, and WorkflowBuilder auto-collapses to the rail even at full width.
   - This is undesigned. It needs a decision: a 44px spacer row above the rail with the lights overflowing into the header's inset, or a dynamic `setWindowButtonPosition`.
3. **Title bar geometry.**
   - `TITLE_BAR_HEIGHT = 40` is documented as "lockstep with web h-10".
   - The new model has different heights per platform: Windows 36, macOS 44 (sidebar row and page header), and Linux 0 (native frame by default, since `useCustomTitleBar()` opts Linux in only through an env var).
   - Emit these from design-tokens as named constants that `platform.ts` and the shell both import.
   - Specify where the Windows strip's back/forward, search, update pill and server chip go on **Linux native frame** and on the **web** (answer: the sidebar), so that Linux is not left out.
4. **Shortcuts.**
   - The palette design lists `Ctrl 1…n`, `Ctrl N`, `Ctrl Shift N` and `Ctrl ,`.
   - In a browser tab, Chrome reserves `Ctrl+N`, `Ctrl+Shift+N`, `Ctrl+1..9` and `Ctrl+W`, so they cannot be intercepted in web mode.
   - The desktop already uses `sectionAccelerator()`: `Cmd+Shift+key` on macOS and `Ctrl+N` elsewhere.
   - Fix: one shortcut registry (in shared or client-core) with host-specific bindings (web, desktop-mac, desktop-win/linux). The palette hints, `menu.ts` and `DesktopCommand` all read from it.
5. **Theme writers.** Today the theme is written from `ThemeProvider.tsx:142/165`, `useDesktopIntegration.ts:189` and `menu.ts:381`. The design asks for one writer; say which module that is.
6. **Smokes to rewrite in the shell PR:** `desktop-chrome-smoke.mjs`, `right-pane-desktop-smoke.mjs` and `desktop-browser-smoke.mjs`. They check the header, drag regions and right-pane testids.

#### M6. The testing and verification plan is too thin for LLM ports

**Evidence.**
- Web has 69 vitest files.
- `ChatInput.tsx` (2,122 lines) has **no** dedicated test, and `ChangesSurface.tsx` only has `keptFiles.test.ts`.
- `agent-tests/e2e` has 13 specs that use 180 `getByRole`, 56 testid and 56 text selectors, with 239 `data-testid`s in web source.
- There are 0 `toHaveScreenshot` uses.

**Fixes.**
- **Characterization tests before any split** of ChatInput, BrowserPanel or ChangesSurface. Cover the composer states from the ComposerStates board: blocking bars, the Stop → Force-reset timing, the slash and @ menus, attachments.
- **A rule in CLAUDE.md:** keep existing `data-testid`s and accessible names on ported elements. Renaming one needs an e2e update in the same PR.
- **Visual regression against the app's own baselines, not the boards.** The boards use fake data and Google Fonts, so a pixel diff against them is noise. Also, macOS, Windows and Linux rasterize text differently.
  - Run `toHaveScreenshot` on the `/__kit` route and on about 10 key routes, in one pinned Linux container with bundled fonts.
  - Use 2 themes × 2 modes × 2 widths.
  - Board-vs-app remains a **review artifact**: side-by-side PNGs that the LLM reads, listing the differences.
- **Per-task loop**, which should go in CLAUDE.md:
  1. typecheck, lint and `check:design`;
  2. the affected vitest;
  3. playwright-cli in headed Chrome at 1440×900 and 1100×760, dark and light, Instrument plus one light non-default theme (for example Solarized, to expose hardcoded colours), with screenshots saved under `docs/redesign/shots/<route>/`;
  4. a side-by-side comparison with the board PNG;
  5. the page's e2e spec;
  6. the desktop smoke if the shell, dock or overlays changed.
- **A cross-OS matrix** for the shell and desktop PRs (macOS, Windows, Linux with and without `GENERATORAI_LINUX_CUSTOM_TITLEBAR`). The `wfplan` R-9 notes suggest the developer also works on Windows.

#### M7. Scope gaps the plan leaves open

- **Toasts.** Decide before the kit is built. The design has none, but 31 files reference toast and `NativeBrowserView` whitelists `[data-sonner-toaster]` as an occluder. The cheapest option is to keep sonner, styled with overlay tokens, for errors only.
- **13 undesigned settings sections.** Define a *settings section recipe* from the Appearance and Security boards (FormSection, switch row, seg row, table) and port the sections mechanically. Budget 3–5 PRs, not zero.
- **PR page, CreateProject and 404/error.** Map them to templates now (T3, T4, and a Gate-like error). Decide whether to keep the PR page before its data hooks are refactored.
- **Transcript performance.** Only `ChatsListPage` and `WorkflowListPage` use `useVirtualizer`. The transcript is not virtualized, and the new 28px step rows increase the row count. Decide on virtualization, or a collapsed-turns policy, in slice B.
- **Density and font size.** These are new axes that change control heights. The heights must be CSS variables from day one (`--h-control-md` and so on), not literal `h-7` classes baked into cva recipes, or density becomes a second migration. They also need pre-paint in `index.html`.
- **Reduce motion.** The design has no motion, but the tokens keep `MOTION` (120/180/220). Add `prefers-reduced-motion` plus a setting-driven root class in the tokens phase.
- **Accessibility.**
  - Keep the plan's decision to derive accents per theme.
  - Explicitly **reject** the design's `--line-strong` values (1.37–1.66:1) for checkbox and switch borders, and use the `inputBorder()` 3:1 value.
  - Decide what to do about fg-3 on overlay (4.30).
  - Enforce the 24px minimum hit area in the kit.
- **i18n.** There is none in the code (1 hit). State "out of scope" explicitly, so that no LLM session starts wiring it in.
- **Mobile timing.** The mobile design is 132 boards (more than the web's 78). It uses the same token names but a different type scale (15/17/22/32 in `mob_helmet.txt`). Plan v1's "mobile follow-up (names, nav order)" understates this.
  - Put the React-free shared pieces in shared packages **during** the web work: the status map, the icon-concept names, the nav order, the shortcut registry and the attention feed.
  - Start mobile after slice B, in parallel with the web fan-out.
  - Give design-tokens a per-platform type scale.

### Minor

- **The diagnosis numbers drift.**
  - Palette classes: 299 by grep, 314 in `design-system-baseline.json`, 344 in the audit board.
  - `unstyled`: 51, not 42.
  - "Enforcement warn-only" is half true. `.github/workflows/ci.yml:111` fails the build on any *increase* in the ratchet; only the ESLint rules are `warn`.
  - `SPACING` already exists in `tokens.ts:116`; it just is not emitted to the web.
- **Radius is contradictory** (theme radius 4/6/8 against component radii 6/8/10/12). Add it to the open questions and resolve it before the Button recipe exists.
- **Fonts.** Adopting them reverses the `themes/fonts.ts` "nothing bundled" policy, so rewrite that header.
  - Bundle 400/500/600 only; 700 is unused.
  - Theme fonts (Geist, Plex, Cascadia) are either lazy-loaded per theme or all bundled. Decide which.
  - Fonts do not count against the 800 KB JS budget (`check-bundle-size.mjs` reads JS entry and preload), so add a separate font-size budget.
  - Mobile needs `expo-font`.
- **Upgrade lucide** (0.460 → current; icons have been renamed) in its own PR, before the icon registry.
- **Templates.** Keep only the ones with at least 3 consumers:
  - ListPage (5), DetailPage (5), FormWithAside (4–5), Workspace (chat and run);
  - MasterDetail (Scripts and the Settings modal).
  - `Wizard` (AutomationCreate only), `Gate` (Pairing only) and `CanvasEditor` (the builder only) are premature. Build each as a page-local layout and promote it on a second use.
  - Templates should be layout slots only, never data-aware.
- **View hooks.** Mandate `useXxxView` only where a page is over about 400 lines or does transport in handlers (ChatPage's raw `fetch`). For a 150-line list page it is ceremony, and LLMs will copy the ceremony.
- **Merge-conflict hotspots for parallel worktrees:**
  - `globals.css` (5,709 lines, mostly generated): feature PRs must never touch it;
  - `components/ui/index.ts` barrel: in the new `ui/`, import primitives by file path, or generate the barrel;
  - `router.tsx` (24 routes, 20 `lazy`): split it into per-feature route modules first.
  - Do those three restructurings once, before any parallel work starts.
- **Instruction files.** `.claude/CLAUDE.md` is empty (a single newline). `.github/AGENTS.md` is dated "circa 2026-06" and describes the old UI. Write the redesign rules into CLAUDE.md in Phase 0:
  - the layer imports;
  - "no arbitrary values, no hex, no `var()` in class";
  - "use the Rosetta table";
  - "keep testids";
  - the verification loop;
  - "never edit generated blocks".
- **Docs drift.** `docs/clients/*.md` still say "Dashboard/Mission Control", and `pnpm lint` runs `check:docs`. Update the docs as part of the Home port.
- **The static board renderer is partly done.** `outlines/` and `mtxt/` exist. Render each board **once** to PNG (both modes) and commit the PNGs under `docs/redesign/boards/`. Keeping a live renderer is not worth it.
- **Open questions to add:**
  - radius;
  - mac rail;
  - the shortcut map;
  - the attention-feed API;
  - the Waiting state;
  - the Widget dock tab (implemented but only mentioned in a "+" tooltip);
  - `FindBar` (desktop Cmd+F);
  - `ScmResultCard` and the standalone `QuestionCard`.

---

## 3. Recommended changes to the plan

| # | Change |
|---|---|
| 1 | **Phase 0 additions:** the gap matrix with an API column and a wfplan column; cross-plan sequencing (amend wfplan PD-19); CLAUDE.md rules and verification loop; resolve radius, toasts, mac rail, shortcuts, the status map (8 states, from a server enum), and the settings URL; commit board PNGs; split `router.tsx` into route modules; remove the barrel. |
| 2 | **Phase 1, additive only:** emit the new names beside the old ones, with old values unchanged. Rename `--accent` to `--accent-tint` and fix `--surface` by codemod first. Add Instrument and ink; the type, radius, height and density scales as CSS variables; the reduce-motion class; bundled fonts; pre-paint for all five axes; tokens for the desktop background and symbol colours; the native emitter (additive) and the docs-site generator. Upgrade tailwind-merge to v3 with a generated config. Extend the WCAG suite. **No namespace reset.** |
| 3 | **Slice A:** 12 primitives, AppShell with LegacyHeader, the sidebar with the attention feed (server plus client-core), and ChatsList. Rewrite the nav and desktop smokes. |
| 4 | **Slice B:** characterization tests, then split ChatInput, BrowserPanel and ChangesSurface. Then the transcript kit, dock frame, narrow sheet, the overlay contract (with the ancestor exemption), and the title strips for all three OSes plus the mac rail. |
| 5 | **Fan-out** by template: lists, details, forms, the settings modal (with the 13-section recipe), Home, the palette. Each primitive is added with its first consumer. |
| 6 | **Workflow deep surfaces** (builder, run, inspector, wizard, loop, versions): built once, together with wfplan P03b/P05/P06, on the kit. |
| 7 | **Lockdown:** the namespace reset (gated on a zero count), hard errors, deleting old tokens, rewriting DESIGN_SYSTEM.md and AGENTS.md. |
| 8 | **Mobile:** starts after slice B, using the shared React-free pieces. |

---

## 4. Keep as-is

- Keep the token engine, the `ThemeDef` model, `ensureContrast`-derived accents (rejecting the fixed `.acc-*` hexes) and the WCAG suite.
- Keep Radix wrapped behind the kit, and use cva.
- Do not use Storybook. A `/__kit` route plus Playwright is the right weight.
- Build pages page by page (strangler) with delete-as-you-go, and no backward compatibility.
- Keep the Rosetta table (design class → component). It is the single most useful LLM aid in the plan.
- Keep a single status map with glyph plus word, one icon registry, and one type scale.
- Keep "view hook, then template, then swap route" as the per-page recipe for large pages.
- Keep the rejected alternatives (restyle in place, big bang, MUI/Mantine). They are rightly rejected.

---

## 5. Estimate and ranked risks

**Size.** The web UI is 56.7k lines of TSX across 209 component and page files. My estimates:

| Phase | PRs |
|---|---|
| Phase 0 | 3 |
| Tokens | 4–6 |
| Slice A | 8–10 |
| Slice B | 12–16 (the chat workspace alone is about 8,000 lines across ChatInput, BrowserPanel, ChangesSurface, ChatPage, ComputerPanel, TerminalPanel and RightPane) |
| Fan-out | 20–25 |
| Settings sections | 3–5 |
| Workflow deep surfaces | 8–12 (shared with wfplan) |
| Lockdown | 3 |
| **Total** | **about 70–90 PRs** |

For a solo reviewer of LLM output that is roughly 12–18 weeks for web and desktop. The ~30-week wfplan runs alongside it, and the two compete for the same review time.

**Risks, highest first:**

| # | Risk | Mitigation |
|---|---|---|
| 1 | Two overhauls rewriting the same workflow UI, causing double work and conflicts | Cross-plan sequencing (C2); a shared status vocabulary |
| 2 | Hidden backend scope stalls UI PRs, or tempts the LLM to fake data | Gap matrix; API-first work packages in client-core (C1) |
| 3 | Chat workspace behaviour regressions (streaming, the WCV, composer states, two-phase stop) | Characterization tests first; desktop smokes; slice B early, while the kit is small |
| 4 | Silent CSS breakage (namespace reset, missing `@source`, tailwind-merge collisions): tests stay green while the UI blanks | Additive tokens; zero-count gate; tailwind-merge config test; CSS-grep CI; screenshot baselines |
| 5 | Desktop regressions on the OS not being tested (Linux native frame, Windows WCO, mac rail) | Per-OS matrix in the shell and dock PRs; shared chrome constants |
| 6 | LLM drift (new variants, arbitrary values, wrong layer) | CLAUDE.md rules; ESLint boundaries including the `@/` ban; ratchet rules for arbitrary values, hex and `var()` added in Phase 1, not Phase 5 |
| 7 | Design churn invalidates kit work | On-demand kit growth; the status map and other vocabularies generated from data |
