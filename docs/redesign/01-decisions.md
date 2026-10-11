# 01 — Decision log

Every decision the overhaul depends on, with the options considered, the evidence, the choice, and its consequences. Decisions are numbered `D-xx` and are referenced from every other document in this folder. If a later session wants to change one, change it **here first** and then follow the references.

Status legend: **Final** (implement as written) · **Spike** (a time-boxed experiment decides the detail; the default is written) · **Deferred** (explicitly not in this pass).

Evidence sources are listed at the end. Numbers quoted from the code were measured with grep/tsc on `desktop_redesign @ a83a7bf` (2026-09-23/24).

---

## A. Strategy

### D-01 Strangler migration in vertical slices; the kit grows with its consumers — Final
- **Options:** (a) restyle in place; (b) big-bang rewrite on a long branch; (c) build the whole component kit first, then port pages; (d) vertical slices: tokens → shell + one list page → the chat workspace → fan-out, each primitive landing with its first consumer.
- **Evidence:** ≈1,400–1,500 `var(--color-*)` arbitrary values in 62–69 files (depending on the regex) and 577 arbitrary font sizes mean "restyle in place" touches every file anyway without producing reusable parts. A big-bang branch leaves the app unrunnable for weeks and risks silently dropping undesigned features (13 settings sections, PR page). Kit-first builds ~50 components from static boards with no real data; the design changed while this plan was written (status map 7→8 states, 17 boards revised on 2026-09-24), so kit-first would bake in stale APIs. The independent audit ranked kit-first as a Major risk.
- **Choice:** (d). Every PR leaves the app working. Old pages keep running inside the new shell until ported.
- **Consequences:** for several weeks old and new pages coexist and look different. Acceptable: the app is not released (see `no-backward-compatibility`). Old pages must keep *working* (D-21 LegacyHeader, D-06 untouched legacy tokens).

### D-02 Delete as you go; no compatibility layers beyond migration scaffolding — Final
The app has no users and one developer. Each ported page deletes its old files in the same PR. The only temporary scaffolding allowed: the legacy token layer (D-06), the `LegacyHeader` slot (D-21), the legacy `components/ui` folder until its last importer is gone. All three are removed in Phase 7 (Lockdown).

### D-03 Enforcement by construction, not by prose — Final
LLM sessions follow failing checks far more reliably than style guides. Every rule in `10-llm-playbook.md` has a mechanical check: ESLint (`eslint-plugin-better-tailwindcss`, `eslint-plugin-boundaries`, `no-restricted-imports`), the extended `apps/web/scripts/check-design-system.mjs` ratchet, the Tailwind namespace reset at lockdown, Storybook a11y tests, Playwright screenshot baselines.

---

## B. Architecture

### D-04 Where the component library lives: `apps/web/src/ui` (not a new package) — Final
- **Options:** (a) new workspace package `packages/ui`; (b) folder inside the web app with lint-enforced boundaries.
- **Evidence:** the DOM kit has exactly one consumer. Desktop loads the web SPA; mobile is React Native and cannot consume DOM components (D-40); the docs site is Docusaurus. A package needs an `@source` line or Tailwind v4 silently generates no CSS for it, its own vitest/happy-dom setup, and it still does not stop `@/` alias imports (Vite's `@` alias and web's tsconfig `paths` apply to it) — so it needs the same ESLint boundary rule anyway. The shadcn CLI supports both layouts.
- **Choice:** (b), with this layout:
  ```
  apps/web/src/
    ui/                 presentational kit — MUST NOT import stores, platform, react-query, router, features, blocks
      primitives/       P-xx (Button, Input, Menu, Dialog …)
      patterns/         C-xx composites without data (PageHeader, FilterBar, DataTable, Stepper, Inspector …)
      shell/            S-xx app-frame parts (AppFrame, Sidebar, Rail, MainCard, TitleStrip, DockFrame …)
      templates/        T-xx page layouts, slot-only (ListPage, DetailPage, FormWithAside, Workspace, MasterDetail)
      icons/            icon registry (concept → lucide component) — reads packages/design-tokens concept list
      lib/              cn(), tailwind-merge config, overlay attribute helper, focus helpers
      foundations/      Storybook-only showcase of the tokens (colour, type, radius, status). Not a kit folder:
                        no component lives here and nothing may import it (its own ESLint element, `foundations`)
    blocks/             B-xx query-aware parts shared by ≥2 features (ModelPicker, AgentPicker, CapabilityToggleList,
                        DiffView, FileTree, EntityTable bindings, transcript parts) — AND the composer and the dock
                        panels (Changes, Files, Terminal, Browser, Plan, Widgets; the chat-only Tasks and Computer panels stay in `features/chat`), because the chat page and the
                        workflow run page (legacy today, rebuilt by the Workflow Overhaul Plan later) both mount them.
                        May import ui/, hooks/, stores/. MUST NOT import features/.
    features/<domain>/  pages + domain components + view hooks. May import ui/, blocks/, hooks/, stores/, platform
                        (platform only through hooks). MUST NOT import another feature.
    app/                router (per-feature route modules), providers, shell wiring (ConnectedSidebar …)
    platform/ stores/ hooks/*Queries.ts   unchanged data layer
  ```
- **Consequences:** boundaries enforced by `eslint-plugin-boundaries` element types `ui`, `blocks`, `features`, `app`, `data` (plus `foundations`, which may import `ui` and which nothing may import). Promote `ui/` to a package only if a second DOM consumer appears.

### D-05 Headless primitives: Base UI (replacing Radix) — Final
- **Options:** Radix (current), Base UI 1.x, React Aria Components, Ark UI.
- **Evidence:** Base UI v1 went stable Dec 2025 with monthly releases since; shadcn made it the default primitive layer in July 2026. It ships parts the design needs that Radix lacks: **Combobox / Autocomplete** (model picker, agent picker, searchable selects, the command palette with entity search), **NumberField** (budgets, timeouts, max rounds, worker limits), **Toolbar**, **Menubar**, **Toast**. Radix is still maintained (June–July 2026 releases) — a valid fallback. React Aria: most verbose API, largest bundle, weakest LLM familiarity. Ark UI: small React mindshare. Migration cost is ~zero because every primitive is being rewritten anyway; the one Radix coupling outside `ui/` (`NativeBrowserView.tsx` overlay selector `[data-radix-popper-content-wrapper]`, `SearchableSelect.tsx` `--radix-popover-trigger-width`) is replaced by D-19.
- **Choice:** Base UI, seeded with the shadcn CLI (`base-ui` style) into `apps/web/src/ui/primitives`, then owned and restyled to the design. Radix packages are removed when the legacy `components/ui` is deleted (Phase 7).
- **Consequences:** Base UI uses a `render` prop where Radix used `asChild`. The playbook (`10-llm-playbook.md`) states this explicitly and the Storybook MCP manifest exposes the real APIs, so sessions stop guessing Radix APIs.

### D-06 Tokens: new design-named layer added alongside the legacy layer; legacy values untouched — Final
- **Options:** (a) rename legacy tokens to design names via aliases; (b) codemod all usages old→new; (c) add a new parallel layer, leave legacy tokens emitting their current values, port pages onto the new layer, delete the legacy layer when its usage count reaches zero.
- **Evidence:** old→new is not 1:1. `--ground` is "the darker of background/card" — `background` in dark themes, `card` in light ones; `--hover`/`--selected` replace accent tints with neutral washes. Any alias or blind codemod visibly changes unported pages differently in light vs dark. Legacy usage: ≈1,400–1,500 `var(--color-*)`, 2,563 semantic utilities, 429 `sidebar-accent`.
- **Choice:** (c). Only names that *collide* between the layers are renamed up front with a codemod (see `02-design-system-spec.md` §Collisions — at minimum legacy `accent`→`accent-tint`, legacy `surface`→`card`, and any legacy `raised`/`overlay` whose meaning differs).
- **Consequences:** two layers coexist until Phase 7. The ratchet counts legacy-layer usages; lockdown removes the legacy layer when the count is 0.

### D-07 Tailwind default namespaces are reset only at lockdown — Final
Resetting `--color-*`, `--text-*`, `--radius-*`, `--shadow-*` to `initial` makes off-system classes impossible — but Tailwind emits nothing (and reports nothing) for an unknown class, and unported code still uses 930 default `text-*` sizes, 299 palette classes, 32 white/black classes and 986 default `rounded*`/`shadow*`. Resetting early silently blanks the old pages. The reset lands in Phase 7, gated on the ratchet reporting 0 default-namespace usages. Until then new code is held to the design vocabulary by `eslint-plugin-better-tailwindcss` rules scoped to `ui/`, `blocks/`, `features/`.

### D-08 Class vocabulary = design token names; raw variables prefixed `--gai-` — Final
Raw runtime variables are `--gai-<token>` (no collision with legacy unprefixed vars or third-party vars). Tailwind `@theme inline` maps them to utilities whose names are exactly the design's names: `bg-ground`, `bg-surface`, `bg-raised`, `bg-overlay`, `bg-sunken`, `bg-hover`, `bg-selected`, `border-line`, `border-line-soft`, `border-line-strong`, `text-fg`, `text-fg-2`, `text-fg-3`, `bg-accent`, `text-on-accent`, `text-run`/`bg-run-bg`, `ok`, `warn`, `err`, `bg-add-bg`, `bg-del-bg`, `shadow-pop`, `bg-scrim`, and the focus colour `ring-focus`/`outline-focus`/`border-focus` (D-12); status colours split into a readable **text** value (`text-run|ok|warn|err`) and the original **hue** (`bg-run`, glyph fills) — `02-design-system-spec.md` §2.3; type `text-micro … text-display`; radii `rounded-badge … rounded-dialog`; heights `h-control-sm|h-control|h-control-lg`, `h-bar`, `h-tab`, `h-row`, `h-nav` plus `h-item`, `h-step`, `h-th`, `h-badge`, `h-kbd`, `h-panel-bar`, `h-dialog-bar`, `h-footer` (§6.3); widths `w-sidebar`, `w-rail`, `w-dock` … from `SHELL` (§8). The full table is in `02-design-system-spec.md`. The **same class vocabulary is generated for mobile** (D-40) so an LLM writes identical classes in both apps.

### D-09 Variant API: cva + a generated tailwind-merge v3 config — Final
- cva 0.7.1 (already a dependency, shadcn convention, best LLM coverage). tailwind-variants rejected: its built-in merger does not document custom theme scales.
- `tailwind-merge` ^2.6 targets Tailwind v3 and classifies unknown `text-*` as colours, so `cn('text-fg-2','text-title')` drops one class. Upgrade to v3 and build `cn` with `extendTailwindMerge`, whose `theme` groups (`text`, `color`, `radius`, `shadow`, `spacing`) are **generated from `packages/design-tokens`** so they cannot drift. A unit test asserts ~10 conflict pairs.

### D-10 Workshop: Storybook 10 in `apps/web` (with addon-vitest, addon-a11y, MCP) — Final
- **Options:** Storybook 10, Ladle, in-app dev-only `/__kit` route.
- **Evidence:** Storybook 10 is Vite-native; `@storybook/addon-vitest` runs every story as a browser component test; `addon-a11y` runs axe per story; the **Storybook MCP server exposes a component manifest (components, props, stories) that Claude Code can query** — directly targeting the most likely LLM failure mode here (re-inventing a component that already exists). Ladle has no MCP/test integration. A `/__kit` route gives screenshots only.
- **Choice:** Storybook 10 with those addons, configured with the app's Tailwind pipeline and a theme/mode/accent/density toolbar. Fallback if Storybook blocks a Vite upgrade: keep Vite 6.4 (D-37).
- **Consequences:** every `ui/` component ships with stories (all variants × states), which double as tests and as the visual-regression surface (D-34).

---

## C. Visual system

### D-11 Default theme Instrument, default accent Ink; accents derived per theme — Final
The design introduces the **Instrument** theme (neutral graphite/ivory) and the **ink** accent (the accent is the foreground colour; text on it is the surface colour). Both become defaults. The design's six other accents are fixed hexes (`#2f6fed`, `#7152e0`, `#1b8a52`, `#d4561c`, `#c8325f`, `#0f7f7a`) — white text on green is 4.37:1 and on orange 4.08:1 (fail AA), and fixed hexes ignore the theme. Keep the existing per-theme accent derivation (`ensureContrast()` in `packages/design-tokens/src/color.ts`) for blue/violet/green/orange/rose/teal, add `ink` as a seventh accent. Result: 18 themes × 2 modes × 7 accents = 252 combinations, all asserted by the WCAG suite.

### D-12 Contrast: the token package overrides the design where the design fails — Final
Design values that fail the existing assertions are not used: `--fg-3` in dark Instrument is 4.30:1 on `--overlay` (needs 4.5); `--line-strong` is 1.37–1.66:1 (checkbox/switch borders need 3:1); inputs bordered with `--line` are 1.2–1.3:1. Rules (exact algorithms in `02-design-system-spec.md` §2):
- `fg-3` = OKLab mix of muted text toward the surface, **clamped to ≥ 4.5:1 on all five surfaces** (ground, surface, raised, overlay, sunken). Measured consequence: the unclamped 82 % mix fails in 31 of 34 variants, so in most themes the clamped `fg-3` lands close to `fg-2`. That is accepted — legibility wins over a third visible tier. `fg-2` is clamped the same way (4 themes need it).
- `line-strong` is derived to ≥ 3:1 against **all five surfaces** (the existing `inputBorder()` only guarantees background/card and fails on raised/overlay in 18 of 34 variants — e.g. inputs inside dialogs). Input, checkbox and switch borders use `line-strong`.
- Status colours get **text variants**: `text-run|ok|warn|err` resolve to a readable-at-12px value (≥ 4.5:1 on surface/raised), while `bg-run|…` and glyph fills keep the original hue (the darkened hues become hard to tell apart otherwise). Measured: raw status colours as 12px text fail AA in 20+ variants.
- A dedicated **`focus`** token drives the focus ring (≥ 3:1 against every surface); the accent fill is below 3:1 against at least one surface in 22 theme × accent combinations, so the ring cannot simply reuse `accent`.
The WCAG suite is extended to every new token and all 252 combinations.

### D-13 Type scale: 7 semantic steps; interface font size setting 12/13/14 — Final
Measured usage across the boards: 11px (1,734), 12px (1,383), 13px (456), 14px (80), 16px (69), 20px (77), 28px (7); 9–10px only inside tiny avatars. Scale: `micro` 11 · `small` 12 · `ui` 13 (base, lh 1.45) · `body` 14 (prose, lh 1.6) · `title` 16/600 · `heading` 20/600 (−0.01em) · `display` 28/600 (−0.02em). Mono: 12 (and 11 in dense rows). Weights 400/500/600 only. The design's per-device "Interface font size" (12/13/14) shifts every step by −1/0/+1 px through CSS variables set on `<html>`.

### D-14 Radius: theme-owned base radius, derived scale — Final
- **Conflict:** the design labels Instrument "4/6/8" but draws badge 4 · small control 5 · control 6 · segmented track 7 · card/menu 8 · main card & user message 10 · dialog & composer 12; the theme boards never vary component radii; the current token package lets themes own radius (4px on Graphite, 10px on Rosé Pine) — a real theme trait users see.
- **Choice:** each theme owns one **base** radius `r` (= its current "md"). The scale is derived: `badge = r−2`, `control-sm = r−1`, `control = r`, `seg = r+1`, `card = r+2`, `panel = r+4`, `dialog = r+6`, each clamped ≥ 2 (≥ 0 for themes that choose square). Instrument `r = 6` reproduces the design exactly (4/5/6/7/8/10/12). Themes keep their character; defaults match the boards.

### D-15 Density (Comfortable default / Compact) and control heights as variables — Final
Design heights are Comfortable: controls 24/28/32, nav row 30, list row 44, table header 32, tabs 36, page header 44. Compact subtracts 4px from rows/controls (20/24/28, nav 26, list row 36, tabs 32) — header bars stay 44 (window chrome alignment). All heights are CSS variables (`--gai-h-*`) consumed by utilities, never literal `h-7` in cva recipes, so density is a variable swap, not a second migration. Compact never shrinks a **hit area** below 24 × 24 px (WCAG 2.5.8): small controls that draw at 20px get an invisible expanded hit target (pseudo-element), so density changes the look, not the target size. Layout widths (sidebar 232, rail 48, dock 480/440, narrow sheet 380, summary aside 320, detail rail 360, inspector 400, dialogs 420/640/960) and fixed bar heights (Windows strip 36, tabs 36, headers 44) are named constants (`SHELL`/`CHROME` in `packages/design-tokens`), not literals.

### D-16 Fonts: bundle Instrument Sans + JetBrains Mono (variable, via Fontsource) — Final
Electron must work offline and the web app must not depend on Google Fonts. Bundle `@fontsource-variable/instrument-sans` and `@fontsource-variable/jetbrains-mono`, subset latin + latin-ext, weights 400–600. Theme font stacks (Geist, IBM Plex, Nunito, Cascadia …) stay declared first in each theme's stack and fall back to the bundled families (not to system fonts) — no per-theme font downloads. Rewrite the "nothing bundled" policy header in `packages/design-tokens/src/themes/fonts.ts`. Add a separate font-byte budget to `apps/web/scripts/check-bundle-size.mjs` (fonts do not count against the 800 KB JS budget). Point `@pierre/diffs` `--diffs-font-family` at `var(--font-mono)` (it is hard-coded in `components/diff/diffTheme.ts`).

### D-17 Icons: lucide-react 1.x behind a concept registry; stroke 1.75; sizes 12/14/16/20 — Final
The Audit board found 174 lucide icons used for ~35 concepts (measured: 147 direct `lucide-react` imports in `apps/web/src`). The design's Foundations board maps 48 concepts to one glyph each (plus 8 status glyphs and ~50 UI glyphs; full list in `02-design-system-spec.md` §9). `packages/design-tokens` exports the concept list (`ICON_CONCEPTS`: concept → `{ lucide, sfSymbol?, material? }`, the last two filled during the mobile pass); `apps/web/src/ui/icons` maps concepts to lucide components. Direct `lucide-react` imports outside `ui/icons` are lint errors. lucide 1.x renamed icons and removed brand icons — the ~9 `Github` uses and the existing `components/shared/VendorIcons.tsx` / `components/settings/BrandIcons.tsx` move to `apps/web/src/ui/icons/vendor/` (so nothing under `components/` survives P7). Add the missing `.i16`-equivalent size (the v2 boards use `.i16` without defining it).

### D-18 Status: one 8-state visual map derived from server enums — Final
Design v2 (Foundations/Components boards): **Queued** (circle-dashed, fg-3) · **Running** (loader-circle, run; also covers finalizing, shows its phase) · **Waiting** (clock, fg-2; waiting on an event/timer/form) · **Needs you** (hand, warn) · **Paused** (circle-pause, fg-2; needs a decision: budget/retries/restart) · **Succeeded** — chats say "Done" (circle-check, ok) · **Failed** (circle-x, err) · **Skipped** (circle-minus, fg-3). Always glyph + word; 8px dots only in dense rows. The map (`server status → visual state`) lives in `packages/shared` (React-free, used by web now and mobile next pass), generated/typed from the server's status unions so a new server state is a type error until mapped. `packages/client-core` currently redefines `RunStatus`/`StageRunStatus` instead of importing them from `packages/shared` — unify them first. Replaces `StatusBadge`'s 19-status map and ~15 local status maps (PlanCard, BackgroundTasksPanel, ChangesSurface, ReviewThreadCard, ChatChangesTray, FileViewerComponents, RuntimeStageNode …) and the hard-coded `#a855f7` streaming colour.

### D-19 Overlay contract: `data-gai-overlay` with an ancestor exemption — Final
`apps/web/src/components/chat/NativeBrowserView.tsx` polls every 100 ms and hides the native Electron `WebContentsView` whenever an element matching a hard-coded list (`[data-radix-popper-content-wrapper]`, `[role="dialog"]`, `[role="menu"]`, `[role="listbox"]`, sonner selectors, `[data-modal-open]`) overlaps it. Two problems: every new overlay library breaks it, and the design's narrow-window dock is itself a `role="dialog"` sheet that *contains* the browser view, so the view would hide itself forever. New contract: every floating layer rendered by `ui/` sets `data-gai-overlay` (menus, popovers, selects, comboboxes, tooltips, dialogs, sheets, command palette); NativeBrowserView queries `[data-gai-overlay], [data-sonner-toast]` (sonner cannot carry a custom attribute on each toast — note that toasts do **not** hide the browser view today, a current bug) and **ignores overlays that are ancestors of its own container**. The narrow dock sheet is **non-modal** (no backdrop): a modal scrim would cover the browser view permanently. The overlap test is a small pure function with unit tests (`06-desktop-and-shell.md` §4). Tests: "browser tab inside narrow dock sheet stays visible", "menu over browser tab hides it", "maximized dock".

### D-20 Motion: near-zero, CSS only; reduced-motion honoured — Final
The design has no motion (skeletons without shimmer). Keep hover/press transitions ≤120 ms via `MOTION` tokens; spinners only for Running glyphs. `prefers-reduced-motion` plus the design's "Reduce motion" setting set `data-motion="reduce"` on `<html>`, which zeroes transitions and stops non-essential animation. No `motion` library dependency.

---

## D. Shell, navigation, desktop

### D-21 App shell per the design; the global Header is retired route by route — Final
Frame: window background `ground`; 232px sidebar directly on it (no border); every page renders in an inset **main card** (8px margin, `panel` radius, `surface`) with its **own 44px page header** (breadcrumb, status badge, chips, actions, dock toggle). The global `components/layout/Header.tsx` (330 lines; route sniffing, `useChat`, `useArchiveChat`, chat actions, connection status, theme toggle) is **not** removed in the shell PR — the shell exposes a `LegacyHeader` enabled per route via route metadata (`handle: { legacyHeader: true }`), rendered **inside the route's own element** (a wrapper around the lazy page) so it keeps access to the route params the old header needs for the chat breadcrumb and Archive action. Each ported page turns it off; Phase 7 deletes Header.tsx. Connection status moves to the sidebar footer; the theme toggle moves to the palette and Settings.

### D-22 Sidebar and navigation IA — Final
Sidebar top→bottom: server switcher ("GeneratorAI / This computer", opens a 280px Servers popover) · collapse button · "Search Ctrl K" · "New chat" · nav **Home, Chats, Projects, Agents, Workflows, Automations, Scripts** · live **Needs you** list (two-line 44px rows) · live **Running** list (title + elapsed) · footer connection status + Settings gear. Below 1200px window width (and always in the workflow builder) the sidebar collapses to a 48px **rail** with a needs-you dot and running counter. `/` is **Home** (the current `DashboardPage` "Mission Control" is replaced). The nav destinations and order are exported from `packages/shared` (`NAV_DESTINATIONS`) for mobile. Needs you / Running require the attention feed (D-36).

### D-23 Window chrome per OS from shared constants — Final
- `apps/desktop/src/main/platform.ts` has `TITLE_BAR_HEIGHT = 40` "in lockstep with web h-10". The design has different geometry per OS, so the constants move to `packages/design-tokens` (`CHROME`) and both `platform.ts` and `ui/shell` import them.
- **macOS:** no title strip. Traffic lights sit in a 44px row at the top of the sidebar (`trafficLightPosition` centred in 44px). In rail mode (48px rail cannot hold lights that end at x≈78) the rail's top 44px row is an empty drag region and the main card's page header gets extra leading inset `max(0, 78 − railWidth − cardLeftMargin)` = 30px (the boards draw the card flush with the rail, margin 0). The CSS variables written by `apps/web/src/lib/desktop.ts` (`--titlebar-height`, `--titlebar-inset-left`, `--titlebar-inset-right`) are renamed to `--gai-titlebar-*` in P3-S1 — writer and every reader live in `apps/web`, so the rename is atomic in one PR (`06-desktop-and-shell.md` §3.6); the `<html>` classes stay unchanged. On macOS `titleBarHeight` becomes 0 (no strip) and the old "lockstep with h-10" coupling in `platform.ts` is deleted.
- **Windows:** 36px full-width strip (`titleBarOverlay.height = 36`): left back/forward/toggle sidebar, centre 420px search button, right "Restart to update" pill + server chip, caption buttons 46×36 painted by WCO. Overlay symbol colour from tokens (`--gai-fg`), background transparent.
- **Linux:** native frame by default (`useCustomTitleBar()` is opt-in via `GENERATORAI_LINUX_CUSTOM_TITLEBAR=1`). With the native frame, the Windows-strip items move into the sidebar: a 36px row at the top of the sidebar holds back/forward (they do not fit beside the server switcher), the update pill sits in the sidebar footer, and search stays in the sidebar; with the custom title bar, Linux uses the Windows layout. Plain web (browser tab) uses the Linux-native layout.
- Keep: `.app-drag-region`/`no-drag` rules, `<html>` classes (`platform-*`, `desktop-shell`, `custom-titlebar`, `titlebar-overlay`, `titlebar-inset`, `window-fullscreen`, `window-maximized`, `window-blurred`), `navigator.windowControlsOverlay` geometry tracking in `apps/web/src/lib/desktop.ts`.

### D-24 Shortcut registry with per-host bindings — Final
The palette design shows `Ctrl 1…n`, `Ctrl N`, `Ctrl Shift N`, `Ctrl ,`, `Ctrl K`. In a browser tab Chrome reserves `Ctrl+N`, `Ctrl+Shift+N`, `Ctrl+1..9`, `Ctrl+W`; desktop menus already use `sectionAccelerator()` (`Cmd+Shift+<key>` on macOS). One registry in `packages/shared` (`COMMANDS` in `packages/shared/src/ui-contract/commands.ts`: command id → `{ web, desktopMac, desktopWinLinux, … }`; as built see D-46) drives palette hints, the web key handler, `apps/desktop/src/main/menu.ts` accelerators, the `DesktopCommand` union handled in `apps/web/src/hooks/useDesktopIntegration.ts`, and the shortcuts help sheet. Adding a command without bindings is a type error. On **web**, combinations the browser reserves (`Mod+N`, `Mod+Shift+N`, `Mod+1..9`, `Mod+W`, and `Mod+,` which is Chrome's settings on macOS) are bound to key **sequences** instead (`G H` Home, `G C` Chats, `G P` Projects, `N` new chat, `Shift+N` new workflow …); the palette shows whichever binding applies to the current host. Section shortcuts follow the D-22 nav order (the palette and tray boards list a different order — the sidebar order wins; e.g. Workflows is `Ctrl+5`, not the palette board's `Ctrl 4`; the tray also follows `NAV_DESTINATIONS`).

### D-25 Theme: one writer, pre-paint for five axes, desktop background pushed to main — Final
Today the theme is written from `ThemeProvider.tsx`, `useDesktopIntegration.ts` and `menu.ts`. `ThemeProvider` becomes the only writer of **mode, theme, accent, density, font size** (+ reduce motion); the native `View ▸ Appearance` menu sends a request through IPC and ThemeProvider applies it. The inline pre-hydration script in `apps/web/index.html` (defaults `'dark'`/`'github'`/`'blue'` today) is **generated** by the token package and applies all axes before first paint with the new defaults (`dark`/`instrument`/`comfortable`/`13`); when no accent is stored, the accent defaults to **the stored theme's own default accent** (ink for Instrument) — a flat `ink` default would flash for a GitHub-theme user with no stored accent. The CSP hash of the inline script must be updated in both places that pin it (`apps/server` CSP and `apps/desktop/src/main/session-hardening.ts`). On every change the renderer pushes the theme's `ground` as a **hex literal for both light and dark** (from the token package, not a computed CSS string that `setBackgroundColor` may reject) to main, which persists it, so the next launch paints the correct colour in all 18 themes (today `window-manager.ts` hard-codes `#0d1117`/`#ffffff`). `nativeTheme.themeSource` mirrors the app's mode so Windows caption glyphs never go dark-on-dark. Appearance is stored per server origin (localStorage is per origin; desktop remote mode changes origin) — accepted.

### D-26 Settings is a modal addressed by URL — Final
The design draws Settings as a 960×640 modal with searchable left nav (groups/items identical to `SETTINGS_NAV`). Route stays `/settings/:section?` so deep links (`generatorai://settings/...`) and direct loads keep working; rendered with React Router's background-location pattern (the modal opens over the current page; a direct load renders it over Home). The native menu's "Settings…" item sends an `open-settings` **command** (not a `navigateTo` URL), because a `pushState` navigation from main cannot carry the background location. Opening Settings over a page with unsaved work must not trigger the unsaved-changes blocker (the blocker ignores navigations that keep the background location). `agent-tests/e2e/navigation.spec.ts` currently asserts that opening Settings leaves the URL unchanged — updated deliberately in P6.

### D-27 Right dock model — Final
Chat and workflow-run pages only. Inside the main card, 480px default (440 on runs), resizable with **react-resizable-panels 4** (replaces `useResizablePane` and ChatPage's own split state; persisted per page). Tab strip 44px: **Changes · Files · Terminal · Browser** always; **Tasks** only in orchestrator chats; **Computer** and **Plan** when relevant; "+" menu for Widget and extra instances (Browser ≤5, Terminal ≤4, file-viewer tabs ≤8, widgets ≤6 — the caps in the current code); Maximize. **Files** is a new single pinned tab (the tree); opened files still open as file-viewer tabs (today files open only on demand via `useFileTabs`). Below 1200px the dock becomes a **non-modal** overlay sheet (380px, absolute, `data-gai-overlay` + exempted by D-19), inactive tabs icon-only, Close button. The panel and the sheet share **one stable React tree** across the breakpoint (only the container styling changes), so crossing 1200px never remounts terminals or recreates native browser views. **Closing the dock collapses it; it does not unmount it** (today closing unmounts, which destroys browser views and terminal sessions). Inactive panels keep `visibility:hidden` (not `display:none`) — `NativeBrowserView.isContainerHidden()` relies on it.

---

## E. Behaviour and scope decisions (previously open questions)

### D-28 Keep / Keep all / Undo all stay in Changes — Final
Both designs omit them, but they ship today (`components/diff/ChangesSurface.tsx`, "Kept" view, `changes/discard`) and were an explicit owner request. Treated as a design omission; the Changes dock keeps them (header actions + per-file row action).

### D-29 No message queue — Final
The ChatTasks, ChatTerminal and ChatBrowser boards show "Queue a message…"; ComposerStates says "there is no queue"; the Workflow Overhaul Plan's PD-3 refuses busy sends (`STAGE_BUSY`, "chat parity"). Follow ComposerStates + PD-3: typing is never blocked; while running, Send becomes Stop → Force reset after 15 s; "waiting on you" shows Cancel & send. The ChatTasks board's queue hint is ignored.

### D-30 Toasts: keep sonner, restyled, for errors and background completions only — Final
The desktop design has no toasts; 31 files use them. Keep `sonner` (maintained), styled with `overlay` tokens, carrying `data-gai-overlay`; allowed for errors and "background job finished" notices only. Inline status (callouts, badges) is preferred everywhere else; the playbook forbids success toasts for inline actions.

### D-31 PR page and project "Pull requests" tab stay — Final
No board covers `PullRequestPage` (`/projects/:id/codebases/:cid/pull-requests/:number`) or the project Pull requests tab, but they are working features. Rebuilt with the Detail template (T-02) and the DiffView block. ProjectDetail tabs: **Codebases · Chats · Runs · Pull requests · Customization · Settings** (Chats/Runs need API support — see `05-gap-matrix.md`).

### D-32 Undesigned screens are composed from the kit with explicit recipes — Final
- 13 settings sections without desktop boards (General, Model providers, Agents, Skills, MCP servers, Templates, Source control, Browser & terminal, Computer use, Audio, Extensions, Storage, Diagnostics): built with the **Settings section recipe** (C-xx `SettingsSection`, `SettingRow`, `SettingsTable`) derived from the Appearance and Security boards. The **mobile settings boards** (`MSetGeneral`, `MSetProviders`, `MSetMcp`, `MSetSkills` …) are the content reference (which fields, grouping, copy) — only the layout is desktop.
- `CreateProjectPage` → FormWithAside template (content reference: `MProjectCreate`).
- 404 / route error / page error boundary → centred Gate-style layout.
- FindBar (desktop Cmd+F), Widget dock tab, `ScmConflictActions`/`ScmResultCard`, standalone `QuestionCard` → restyled with kit parts, no layout change.
- Dead components found with zero importers — `ArtifactPicker`, `ArtifactBrowser`, `ProjectPicker`, `CodebasePicker`, `ChatList`, `WorkflowDefinitionList` — are **deleted in P0**, not ported.

### D-33 Chat transcript rendering: Streamdown + Shiki; virtualization by spike — Spike
- Replace `react-markdown` and the highlight.js-based highlighting (`apps/web/src/lib/highlight`, `rehype-highlight` is in `package.json` but no longer imported) with **Streamdown 2** (built for streaming LLM markdown; handles incomplete markdown) and **Shiki 4** (already used by `@pierre/diffs`, removes a second highlighter). The `.hljs-*` syntax rules become Shiki themes generated from the `--syntax-*` tokens.
- Transcript virtualization: only `ChatsListPage` and `WorkflowListPage` virtualize today; the new 28px step rows raise row counts. Spike in Phase 4 with TanStack Virtual 3.14 (chat anchoring, May 2026): virtualize at **turn** granularity with stick-to-bottom. Accept only if (1) a 2,000-block transcript scrolls at 60 fps, (2) streaming stays anchored, and (3) **desktop Find-in-page (FindBar / `findInPage`) still finds text in off-screen turns** (Chromium find cannot see unrendered DOM — the spike must provide an app-level transcript search that scrolls the match into view, or fail). Otherwise fall back to collapsing finished turns beyond the last 20.

### D-34 Visual regression and verification — Final
- `toHaveScreenshot` baselines of **the app itself** (Storybook stories + ~12 key routes), rendered in **one pinned Linux container** (`mcr.microsoft.com/playwright` image matching the repo's Playwright version) with the bundled fonts (text rasterises differently per OS). Per PR: Instrument dark + Instrument light + Solarized light at 1440 and 1100 (6 per route); on merge to the redesign branch: the same plus Solarized dark. Routes run against a seeded isolated server with the fake provider (not `MockPlatformClient`, which only covers the old session API and only runs inside vitest). Chromatic rejected (free tier cannot cover the matrix); Lost Pixel is shutting down.
- Board-vs-app comparison is a **review artifact**, not a test: the boards use sample data and web fonts. Each port PR includes side-by-side PNGs (board PNG from `docs/redesign/boards/` + playwright-cli screenshot) that the session inspects and lists differences for.
- Every task also drives the real app with `playwright-cli --browser=chrome --headed` (owner requirement), see `09-verification.md`.

### D-35 Workflow, automation and script screens are built once, by the Workflow Overhaul Plan, on the new kit — Final (requires an amendment to that plan)
- **Evidence:** the v2 boards for Workflows, WorkflowDetail, WorkflowBuilder, WorkflowRun, the 6 stage-editor boards, WorkflowNew, WorkflowValidate, WorkflowSettingsPanel, Automations, AutomationDetail, AutomationCreate, Scripts and the 5 new boards (WorkflowRunDialog, WorkflowRunLoop, WorkflowLoopBuilder, WorkflowAgentDraft, ChatWorkflowRun) depict the end state of the Workflow Overhaul Plan (https://claude.ai/artifact/Kqrzv5CnsYg13EdQNTp2gC, v1.2, phases P01–P07): versions and draft/publish, stage kinds (Agent/Check/Loop/Map/Sub-workflow/Wait), guards/joins/timeouts/budget/retry policy, Output tab with an LLM judge, Setup/Finalize lifecycle, run dialog with plan preview, loop runs with decision cards, agent-drafted workflows, workflow cards in chat. Almost none exists in the backend (e.g. `iterationConfig` is stored but never executed; `workflow_definitions.version` is a bare integer). That plan's PD-19 says it builds on *existing* components and the redesign reskins afterwards — combined with a redesign port, the workflow UI would be built three times.
- **Choice:** the redesign does **not** port the workflow/automation/scripts pages. It (1) ships the kit + shell + transcript kit early, (2) builds the engine-independent workflow kit pieces listed in `03-component-inventory-domain.md` §4 (WF-01…WF-20), and (3) exposes extension points in chat (tool-card registry, pluggable Tasks-panel sections, composer tool toggles). The Workflow Overhaul Plan's UI work packages build those screens once, directly on `ui/` + `blocks/`. Until then the current workflow pages run unchanged inside the new shell with `LegacyHeader`. One exception: the legacy run/builder pages import chat components (right pane, Changes panel, terminal, browser); when P4 replaces those with `blocks/` versions, P4 also **swaps those imports** in the legacy workflow pages so the old chat files can be deleted. That is an import swap only — no redesign of the workflow pages. Gaps touching run history (stats, runs by project — G-10, G-15) must account for the Workflow Overhaul Plan's migration that drops run history.
- **Required amendment to the Workflow Overhaul Plan** (apply in that artifact; text in `07-phases.md` §Coordination): PD-19 → engine/API work proceeds in parallel; overhaul UI work packages scheduled before the redesign handoff (end of P4, ~week 10 — including WP-1.8, the v2 builder) stay functional-only on existing components; every overhaul UI package after the handoff builds on `apps/web/src/ui` + `blocks/` and rebuilds the functional-only screens once. Parallel-work rules (file ownership, mechanical whole-repo changes, migrations, merge cadence) are in `07-phases.md` §Running in parallel. Share one status vocabulary (D-18). Tokens-only cost display for providers that don't report cost.
- **Fallback:** if the Workflow Overhaul Plan's UI packages have not started when redesign Phase 6 finishes, the redesign ports the current Workflows list, WorkflowDetail and Automations list/detail screens as-is (no new features) so lockdown is not blocked; builder and run page wait.

### D-36 Backend gaps are built API-first in shared packages; no fake data — Final
Designed data with no API today includes the cross-entity **attention feed** (Needs you + Running, for the sidebar and Home — only `chats.ts:1145 GET /:id/interactions` and `workflowRuns.ts:420 GET /:id/pending-interrupts` exist), Home "This week" stats and "Recently finished", Projects columns (active chats, worktrees, last run), ProjectDetail Chats/Runs tabs, ChatsList "Changes ±" column and bulk archive, transcript view mode (Normal/Verbose/Summary), model tier/description in the picker, computer Pause/Take over, live tool-output tails, Tasks-dock wave/worker-limit/review-round data, agent "Used by", worktree sizes, extra health fields, per-chat tool toggles, palette entity search. (Plan revisions with inline comments, computer replay and grants, and most model-picker details **already exist** — verified in code.) The authoritative, verified list is `05-gap-matrix.md` with the endpoint, SSE scope and `packages/client-core` read model to add. A designed element whose data does not exist yet is **not rendered** (no placeholder data) until its API lands. New read models go in `client-core` so mobile gets them in its pass.

### D-37 Platform upgrades — Final
- **Phase 1 (before kit work):** Tailwind 4.2→4.3; tailwind-merge 2.6→3.x; lucide-react 0.460→1.x (with the icon registry); TypeScript 5.8→6.0; **Vite 6.4→7.x** and **Vitest→4** (React Router 8 requires Vite ≥ 7; Storybook 10's browser testing is best supported on Vitest 4); React Router 7→8 (`react-router-dom` removed, import from `react-router`; needs React ≥ 19.2.7). Each is its own PR with the full test suite green before the next, in the order of `07-phases.md` P1-U1…U5 (Tailwind → TypeScript → Vite 7 + Vitest 4 → React Router 8 → lucide + icon registry); tailwind-merge v3 lands with its generated config in P1-T9. Also unify the two disagreeing web vitest configs (jsdom vs happy-dom; different setup files) in the Vitest PR.
- **Deferred to after lockdown:** Vite 7→8 (Rolldown) — only once Storybook, Vitest and `@tailwindcss/vite` declare support; React Compiler 1.0 — `useVirtualizer` is flagged incompatible and changing memo semantics mid-rewrite hides regressions; TypeScript 7 — typescript-eslint cannot run until 7.1's programmatic API.
- **Not adopted:** TanStack Router (migration cost, no product gain), Style Dictionary / Terrazzo (no ANSI emitter; would lose typed `ThemeDef` + WCAG suite).

### D-38 Libraries — Final
| Need | Decision | Replaces |
|---|---|---|
| Split panes / dock resize | react-resizable-panels 4 | `hooks/useResizablePane.ts`, `useResizable.ts`, ChatPage split state |
| Command palette, searchable selects, pickers | Base UI Autocomplete / Combobox | `cmdk` (last release March 2024), `ui/SearchableSelect` |
| Forms with > 5 fields | TanStack Form 1 + zod 4 | `useState` forests (`CreateAutomationPage` has 40) |
| Long lists / transcript | TanStack Virtual 3.14 | — (kept, upgraded) |
| Streaming markdown | Streamdown 2 | react-markdown, rehype-highlight |
| Code highlighting | Shiki 4 | highlight.js |
| Toasts | sonner (kept, restyled) | — |
| Icons | lucide-react 1.x via registry | direct lucide imports; `material-file-icons` (unused) |
| Fonts | Fontsource variable packages | system stacks only |
Kept unchanged: React 19.2, TanStack Query 5, zustand 5, @xyflow/react 12, @dagrejs/dagre, xterm 6 (+addons), @pierre/diffs, @pierre/trees, qrcode, class-variance-authority, clsx.

### D-39 Out of scope for this pass — Final
Internationalisation (no i18n exists; do not start it), device-scoped appearance for desktop remote mode (`06-desktop-and-shell.md` §6.5; appearance stays per server origin), mobile UI implementation (next pass, D-40), Workflow Overhaul Plan backend work (its own plan), relay end-to-end encryption (`packages/relay-protocol/src/e2ee.ts` has no importers — flagged separately), React Compiler and Vite 8 (D-37).

### D-41 Z-index scale — Final
Named layers replace ad hoc values (`z-[1000]`, `z-[1100]`, `z-[1200]`, `z-50` …): `base 0 < sticky 10 < dock 20 < rail/sidebar 30 < dialog 1000 < dropdown/popover 1100 < toast 1150 < tooltip 1200`. Dropdowns and popovers sit **above** dialogs because selects, menus and comboboxes open from inside dialogs. Values in `02-design-system-spec.md` §6.

### D-42 When a board disagrees with the server or the code's real behaviour, the server wins — Final
Boards are the layout and visual reference; the server and working code define behaviour. Examples found: the Pairing board draws a 6-box code but the code format is 12 characters in 3 groups of 4 (`PAIRING_CODE_LENGTH`/`PAIRING_CODE_GROUP_SIZE` in `packages/shared/src/utils/pairingCode.ts`) — `PairingCodeInput` renders from those constants; the Security board offers a "Custom" network exposure the server does not support (not offered); the Settings group is "Agents & models" on the board and "Agents" in `SETTINGS_NAV` (use the board label only if the group really contains both). Each such case is listed in `04-screen-map.md` and `11-design-feedback.md`.

### D-43 P0 guardrail implementation details — Final
Decided while building P0-04 where `09-verification.md` was silent or wrong:
- `check:design` is **one** script: `check-design-system.mjs` runs `check-stories.mjs` itself, because with `a.mjs && b.mjs` pnpm forwards `--strict` only to the last command.
- `legacyTokenUtility` leaves out the `chart-N` and `canvas-*` tokens (they survive P7 per `02` §2.3), so the rule can reach 0.
- `lucideDirectImport` counts every file outside `ui/icons` (148 at P0), not only files outside `components/ui` (135): D-17 bans direct imports everywhere else.
- `arbitraryValue` and `varInClassString` exempt `src/ui/lib/**` (the one sanctioned home of CSS-variable passthroughs, each with a comment), matching the ESLint `ui/lib` block.
- Raw-element rules (`rawButtonElement`, `rawInputElement` …) exempt `src/ui/primitives/**`, where the kit's own Button/Input/Dialog must render the raw element.
- `eslint-plugin-boundaries` v7 (`boundaries/dependencies` policies); loose `src/*.tsx` files are `root` elements and may import each other. The only legacy edges from the `data` layer at P0 (`hooks/queries.ts`, `providers/QueryProvider.tsx` → `components/Toast.tsx`; `hooks/composerQueries.ts` → `components/chat/composer/{builtins,types}.ts`) are allowed **for those target files only**, as migration scaffolding removed by P7.
- ESLint import resolution uses `apps/web/tsconfig.eslint.json` (the web tsconfig without `references`): eslint-import-resolver-typescript v4 ignores `paths` in a tsconfig that has references, so every `@/` import escaped the layer rules.
- better-tailwindcss needs `cwd: apps/web` (from the root `tailwindcss` resolves to the docs site's 3.x) and keeps its default callee matchers (setting `callees` replaces them).
- Vitest: `apps/web/vitest.config.ts` exports its `unit` project and the root config reuses it with `extends`; Vitest ignores a `projects` list nested inside a referenced config.
- Layers fail closed (P0 review R2): `boundaries/no-unknown-dependencies` and `boundaries/no-unknown-files` are errors, so a folder that is not a declared element (`src/services/` …) can be neither created nor imported until it is declared. Tests are `boundaries/ignore`d (they may import any layer); `src/styles` is a `styles` element importable from `root`.
- `features/` may not import `@tanstack/react-query`, `providers/QueryProvider`, `@generatorai/client-runtime`/`client-transport` or `providers/PlatformProvider` (type imports allowed; `@generatorai/client-core` stays importable because it holds the pure helpers and read models features render): "data only via hooks/*Queries.ts or stores" is lint-enforced (R5). "Inline style only for computed geometry" is approximated by the ratchet's `literalInlineStyle` rule (`scope: 'new'`): a `style={{…}}` with a literal string or number value.
- Lint messages in `src/{ui,blocks,features,app}` point at `@/ui/primitives` / `@/ui/icons`, never the legacy `@/components/ui`; `src/ui/primitives/**` is exempt from the raw-element lint rule as it is from the ratchet (R12).

### D-44 Isolated test servers use the server's bare env names — Final
The server reads `DB_PATH`, `ARTIFACTS_DIR`, `WORKSPACES_DIR`, `TEMPLATES_DIR`, `EXTENSIONS_DIR` (or `GENERATORAI_EXTENSIONS_DIR`) and `PORT` (`apps/server/src/index.ts`); the `GENERATORAI_`-prefixed names in the old CI e2e job, `AGENTS.md` and an earlier draft of `09` §4.2 were silently ignored, so "isolated" servers opened the default database. Every isolated server (CI e2e, sandbox, VRT, smokes) sets the bare names (including `EXTENSIONS_DIR`, or it loads the developer's `~/.generatorai/extensions`) plus `GENERATORAI_BIND_HOST=127.0.0.1` (required for `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK`), and scripts assert the `dbPath` in the startup log before running tests. Renaming the server's variables to a prefixed form is out of scope (it would touch every deployment doc); if it is ever done, it is a clean rename with no aliases (D-02).

### D-45 Stories: design vocabulary yes, demo scaffolding free — Final
Decided for P0 review R6, where the ratchet and ESLint disagreed. `*.stories.tsx` files show the kit to people and to the Storybook MCP, so they must use real design classes: the Tailwind vocabulary rules (ESLint block (a): D-13 sizes, D-14 radii, palette, white/black, shadows, heights) and the ratchet's vocabulary rules (`defaultTextSize`, `legacyTokenUtility`, `hexOrRgbInTs`, `lucideDirectImport` …) apply to them, hard-zero in `src/{ui,blocks,features,app}`. Exempt in **both** tools, as demo scaffolding only: raw `<button>`/`<input>`/`<textarea>`/`<select>` (ratchet `rawButtonElement`/`rawInputElement`, ESLint `no-restricted-syntax`) and arbitrary values such as a fixed-width frame (ratchet `arbitraryValue`, ESLint `ARBITRARY_VALUE_RESTRICTION`). Layer and import rules apply to stories unchanged. Tests stay exempt from everything, as before. `scripts/__tests__/redesign-rails.test.mjs` pins the split.

---

## F. Mobile readiness

### D-40 Web and mobile share a design contract and logic, not UI components — Final
- **Evidence:** Bluesky (the flagship react-native-web app) still uses Radix and floating-ui on web; Discord shares logic, not UI; Linear's mobile apps are native; react-native-web's last release was October 2025; GeneratorAI's densest web surfaces (xterm, @xyflow, @pierre/diffs, the Electron WebContentsView) are DOM-only.
- **Shared now (this pass):** tokens and the generated class vocabulary (D-08), per-platform geometry schema, `CHROME` constants, icon concept registry (D-17), 8-state status map + labels (D-18), nav destinations (D-22), shortcut/command registry (D-24), attention feed and other new read models in `client-core` (D-36), component *contract* types for shared concepts (status badge, tool block, gate cards, composer states, pane tab set) in `packages/shared/src/ui-contract/` — types only.
- **Next pass (mobile):** Uniwind (Tailwind v4) replacing NativeWind v4 — it consumes the same generated `@theme` vocabulary; React Native Reusables seeded kit; Expo UI native controls; TrueSheet / expo-router form sheets; bundle fonts with the `expo-font` config plugin (JetBrains Mono is referenced in three sheets today but never loaded). Mobile-specific design decisions (ink/neutral vs blue-tinted selected states, pill shapes, builder on phone, multi-server, mobile-only features) are recorded in `08-mobile-readiness.md` and decided at the start of that pass.

## G. As-built details

Decisions made while building, where the plan was silent (one entry per task batch, in build order).

### D-46 P1 registry and router details — Final
Decided while building P1-S3, P1-T10, P1-T11, P1-S1 and P1-S2 where the plan was silent:
- **Status unions.** Client-side status unions (`RunStatus` = `WorkflowRunStatus | 'pending'`, stream/tool/question/permission/hook/widget, `ReviewThreadStatus`) live in `packages/shared/src/status/unions.ts`; `client-core`, `packages/review` and web `types/review.ts` re-export them, so the exhaustive map covers every union.
- **Icons.** `NAV_DESTINATIONS.icon` uses the real `ICON_CONCEPTS` keys (`chats`, `projects` …). The registry names lucide 0.460 glyphs today and records the three 1.x renames in a `lucide1` field for P1-U5.
- **Window size.** `sanitizeBounds` clamps restored windows to `CHROME.minWindow` (860×560), per `06` §3.4.
- **Command host.** `useCommandHost` lives in `hooks/` (the legacy `AppLayout` may not import `app/`); it moves to `app/shell` with the shell in P3. `RendererCommandId` = global commands executed in the renderer; scoped commands (composer, palette) are display-only. On web one rule applies on every OS (a rule, never a platform check; `Mod` is Cmd on macOS and Ctrl elsewhere, where Ctrl+K/Ctrl+B are readline, tmux and editing keys): (1) inside a surface that owns every key — the xterm root `.xterm` or any element under `data-gai-keys="own"` (the terminal container; future code editors must carry it) — the host handles nothing, chords included; (2) in a text field, contenteditable, combobox or menu only chords whose registry entry has `firesInEditable: true` fire, and only `palette.toggle` (`Mod+K`, 06 §5.2 "fires while typing") has it; `Mod+B`, `Mod+Alt+B` and every other chord are left to the field, not prevented; (3) bare keys and sequences never fire in those targets, nor while a dialog/palette overlay is open. (Amended after P1-R1: the first version let every `Mod` chord fire in inputs, which on Windows/Linux took Ctrl+K/Ctrl+B/Ctrl+Alt+B from the terminal and every text field.) Known limit: on **desktop** Windows/Linux the native menu accelerators (`Ctrl+K`, `Ctrl+B`, `Ctrl+Alt+B`) still reach the menu before the page, as they did before P1; recorded as DF-23 and fixed with the terminal/dock port (P4) by applying this same rule there. The browser-reserved list is `BROWSER_RESERVED_CHORDS` (avoids a clash with `CHROME`). Desktop menu section items keep `navigateTo`; both `navigateTo` and `sendCommand` restore, show and focus the window (a minimised or tray-hidden window would otherwise swallow Settings…, New chat or the palette — P1-R2).
- **ShortcutsSheet** is temporary scaffolding on the legacy `components/ui` Modal + Kbd (design class names only) until the kit exists; rebuilt on `ui/` in P3.
- **Router.** `app/router.tsx` keeps `<AppLayout/>` as the shell element until P3-04; the 404, route-error and page-loader markup moved into legacy `components/{NotFoundPage,RouteErrorFallback,PageLoader}.tsx` so `app/**` carries no Tailwind classes; `GaiRouteHandle.nav` (`NavDestinationId`) is set on every area route and agrees with `navDestinationFor(path)` (tested); Settings and the 404 have none. P3's sidebar active state reads it.

### D-47 P1 token-engine details — Final
Decided while building P1-T1…T6 where `02` was silent:
- CLI `accent` setting defaults to `'auto'` (the theme's own default accent), matching how `theme`/`appearance` work in the CLI settings editor.
- Node tools (ratchet, `check:css`, ESLint) read the vocabulary from the generated `packages/design-tokens/generated/vocabulary.json` (`./vocabulary.json` export; covered by `tokens:check`) because they cannot import TypeScript.
- `REQUIRED_UTILITIES` are safelisted with a generated `@source inline(...)` so `check:css` verifies them before any page uses them (built CSS 253 → 334 KB uncompressed while both layers coexist; P7 recovers it). Extras beyond `09` §2.4: `outline-focus`, `bg-run`, `size-control`, `z-dialog`, `z-tooltip`, `w-sidebar`, `max-w-dialog`, `ease-standard`.
- The legacy bridge list lives in `vocabulary.ts` (no imports) to avoid a cycle; `--color-chart-*`/`--color-canvas-*` aliases stay in Layer 3 because hand-written React Flow rules read them.
- Per-theme radius is emitted in the Layer 1b theme blocks (not the legacy chrome block) so P7 can delete Layer 1 wholesale.
- Z-index goes through `--gai-z-*` so `vocabulary.css` stays value-free; `rail`/`sidebar` = 30 per D-41; toasts use `var(--gai-z-toast)`.
- Type steps set weight/tracking only where the step defines them (title/heading/display); `text-ui`/`text-body` inherit.
- `INSTRUMENT_SANS`/`BUNDLED_MONO` stacks exist from T4 (system fallback until T7 bundles the fonts); a temporary pre-paint defaults to `instrument` and sets `data-accent` only when stored (replaced by the generated pre-paint in T8; both CSP pins updated).
- P1-T1 raised `legacyTokenUtility` 2568 → 2622 (+54): the renamed `bg-accent-tint` sites were always legacy but uncountable while named `accent` — a sanctioned ratchet increase (D-02 scaffolding).
- `SHELL_WIDTHS` (T6, `design.ts`) and `SHELL` (S1, `chrome.ts`) are unified into one source in the next P1 task (fonts/theme batch).
- `focus` and every `<state>Text` are clamped against `sunken` too (02 §2.2 steps 9 and 12; §12 rows 7 and 10), because inputs sit on `sunken` and take the focus ring there. No emitted value changed (P1-R6: minimums were 3.21:1 and 5.14:1).

### D-48 Test harness (P2-00) — Final
- The deterministic provider is enabled with `GENERATORAI_TEST_FAUX_HARNESS=true` (renamed from the load-test name, no alias). It reports as a synthetic, always-ready `faux` provider with one model, merged into the registry at read time and never added to `ALL_HARNESS_TYPES`; `HarnessType` includes `'faux'` inside `agent-harness-providers` only, and the two exhaustive sites that never build a faux adapter (`apps/server/src/composition/harnessInstances.ts`, `packages/sdk/src/GeneratorAI.ts`) use `Exclude<HarnessType,'faux'>`. Production is unchanged when the flag is off. CI e2e sets the flag, so provider-catalog tests run in CI.
- `GENERATORAI_TEST_FAUX_SCRIPT=<path.json>` scripts replies per chat name (`text`, `tool_call`, `tool_error`, `file_edit` with real workspace writes, `ask_question`, `permission_request`, terminal states); plan-review and hook-bridge emulation are TODO. Scripts apply lazily on a conversation's first send because the chat row is persisted after `createConversation`.
- `node scripts/redesign/sandbox.mjs` is the one deterministic local environment (server :3197 on a temp DB with the Faux provider, seed, Vite :5197); `agent-tests/vrt/seed.ts` seeds it idempotently.
- Review round 1 (P2-R10, R11, R21, R22): the sandbox spawns no `.cmd` shim on any OS — `scripts/redesign/lib/spawn-node-bin.mjs` runs each tool's JS entry (`vite/bin/vite.js`, `tsx/dist/cli.mjs`, resolved from the package that declares it) with `process.execPath`, and pnpm through `npm_execpath` (bare `pnpm` with a shell only as the documented fallback); `--help`/`--dry-run` print the resolved commands. The seed's main-module guard compares real `file:` URLs (`pathToFileURL(realpathSync(argv[1]))`), so it runs on Windows and under paths with spaces. Faux `file_edit` needs the chat's workspace (no `process.cwd()` fallback) and refuses paths outside it; a denied `permission_request` skips the next scripted edit; added lines are counted without the trailing-newline off-by-one.
- Review round 2 (P2-R29, R43, R44): `npm_execpath` is used only when it points at a pnpm entry (`pnpm.cjs`/`.mjs`/`.js`, or a path segment named `pnpm`, as corepack's shim has), so `npm run` and yarn fall back to bare `pnpm`. That fallback passes one fixed, quoted command string with `shell: true` (no args array, DEP0190). The main-module guard test builds its path mismatch from a directory name with a space, so it holds on Linux and Windows too, not only where `os.tmpdir()` is a symlink. `isolatedProfile()` (desktop smokes) cleans up on SIGINT/SIGTERM, closes the attached Electron app before removing the profile, retries the removal and logs a final failure; `sandbox.mjs --clean` also sweeps leftover `gai-*-smoke-*` / `gai-pairing-diag-*` profile dirs from `os.tmpdir()`.

### D-49 Attention feed (G-01) as built — Final
- `GET /api/attention?projectId=` returns `{ seq, generatedAt, needsYou, running, counts }` (needs `read:activity`); SSE `attention.upsert` / `attention.remove` / `attention.counts` on the `global` scope (lifecycle events). `counts` does not advance `seq` (for counts-only consumers such as the tray, G-05). `ask.detail` and `progress.label` are redacted for callers without `read:chats` / `read:workflows`, on the route, both stream endpoints and `/stream/replay`.
- Events are triggers only: each re-reads its entity and the feed is diffed, so a missed or reordered event cannot leave a stale ask. An entity with an ask appears only under Needs you. Worker chats roll up to their parent (`/chats/<parent>?dock=tasks`). `seq` restarts at `Date.now()×1000` per boot so clients refetch after a server restart.
- Workflow-owned engine code is read, never edited: stage asks come from `IStageRunRepository.getByRunId` per live run (no new `HitlService` API); empty run history (overhaul v55) is tolerated and tested. Streaming chats come from `StreamingChatRegistry` (replaces `activeSubscriptions` in `ChatManagementService`).
- Client: React-free `createAttentionStore` in `packages/client-core/src/attention` (reducer, selectors, gap → refetch) is the ONE implementation: web `useAttention` / `useAttentionCounts` wrap it (shared per platform + project, `useSyncExternalStore`); mobile will wrap it in its own container when it adopts the feed (nothing in `apps/mobile` imports it yet; counts stay `undefined` until loaded — no invented zeros). A snapshot request is never cancelled; deltas that arrive while it is in flight are held and replayed past the response's `seq`. A failed snapshot fetch (including the very first one) is retried by the store itself with backoff (1 s doubling to 30 s, reset on success); while a retry is pending, deltas are held rather than each firing a request, and an explicit `refresh()` fetches at once (P1-review P2-R31).
- Review round 1 (P2-R15…R19): a question's or plan review's free-text `ask.summary` is also redacted (generic text) without the entity's read scope; `attention.counts` only when totals change; a consent prompt with no `chatId` shows on the top-level chat owning its workspace; `GET /attention` is 503 until the service started; the desktop badge feed runs only in the desktop shell.
- Review round 2 (P2-R32): `computer.consent_resolved` (no `chatId`) re-reads every item whose `ask.id` is the resolved request, whichever chat it is keyed on, so a worker-raised consent leaves Needs you once answered; the request's expiry timer is cancelled and does the same.
- Known limits: automation-started runs show as separate Running items (no run → execution link); stage-ask `since` is first-seen time.

### D-50 Overlay contract and icon registry as built (P1-S5, P1-U5) — Final
- `ui/lib/overlay.ts` exports `overlayProps(kind)`, `GAI_OVERLAY_SELECTOR` and `LEGACY_OVERLAY_SELECTOR` (the Radix/role selectors, kept until P7-01; that one file is exempt from `radixOverlaySelector`). The pure `isObscured()` in `components/chat/nativeBrowserOcclusion.ts` implements D-19 including the ancestor exemption. Toasts now hide the native view (the old `.sonner-toast` selector never matched).
- lucide-react 1.48 (web only; mobile keeps `lucide-react-native` until its pass). The six deprecated 0.x aliases were renamed (`Trash2`→`Trash`, `History`→`RotateCcwClock`, `FileCode2`→`FileCodeCorner`, `HelpCircle`→`CircleQuestionMark`, `ShieldQuestion`→`ShieldQuestionMark`, `WrapText`→`TextWrap`); `Github` → `GitHubMark` (vendor). Brand marks live in `ui/icons/vendor/VendorIcons.tsx`.
- `<Icon concept size label className />` (prop `concept`, not `name`), stroke 1.75, sizes 12/14/16/20; a dedicated `loader` concept for Spinner. `ICON_CONCEPTS.lucide` holds 1.x names.

### D-51 Fonts, pre-paint and cn as built (P1-T7…T9) — Final
- **Fonts:** our own `apps/web/src/styles/fonts.css` declares the 4 latin/latin-ext woff2 faces of `@fontsource-variable/instrument-sans` and `jetbrains-mono` (Fontsource's `wght.css` for JetBrains Mono pulls 6 files); weight ranges are the packages' own. 96.8 KB total; budget 104 KB (measured + 10 %). Google Fonts are removed from both CSPs (`style-src`/`font-src 'self'`). Themes whose first-choice font is not installed now render the bundled family instead of a system font (intended; GitHub keeps system stacks).
- **Pre-paint:** the six separate storage keys of `02` §11.1 (not the single JSON key sketched in `06` §6.3); emitted as one line so its CSP hash is identical on every OS; `tokens:write` rewrites both CSP pins and `tokens:check` fails when either is stale. With no stored accent the accent follows the current theme's default in-session; `setAccent` ignores an unknown id rather than storing the fallback as a choice (P1-R5). Desktop `settings.theme` is replaced by `settings.appearance` without migration (an existing desktop user's mode resets to dark once — accepted, no users yet). Desktop chrome classes stay out of the pre-paint until P3.
- **Single writer:** `applyAppearance` (`ui/lib/appearance.ts`) is called only by ThemeProvider (and Storybook); the data layer may import `apps/web/src/ui/lib/*.ts` for this and for `cn`.
- **cn:** tailwind-merge 3.7 extended from the generated vocabulary (`twMergeExtension()` in design-tokens); legacy `lib/utils` re-exports it (all 2,377 legacy call sites merge as before except 4 design-vocabulary cases 2.6 got wrong).
- **SHELL:** one source (`SHELL` in `chrome.ts`); the CSS width variables and the geometry table read a projection of it.

### D-52 Chat list v2 (G-02/G-14) as built — Final
- Migrations **v61** `chat_list_summary_columns` (`last_activity_at`, `last_turn_*`, `changes_*` + indexes; backfilled) and **v62** `chat_list_activity_indexes` (P1-review P2-R30, below) — written as v55/v56 and renumbered when the Workflow Overhaul (v55–v60) merged first (D-81). Numbers must be contiguous (`SchemaConvergence`).
- `GET /chats` → `{ items, nextCursor, total, counts: { all, active, archived } }`; filters `status`, repeatable `projectId`/`agentRef`/`tag`/`state` ("any of"), `q` (also matches tags), `sort=activity|created|name`, `cursor` (bound to its sort; mismatch = 400), `limit` (default 50, max 200), `workers`. `archived=` is removed (D-02). Each item carries `summary: { lastActivityAt, lastTurn, changes, agent, preview }`. Bulk `POST /chats/archive|delete` with `{ ids }` (1–200) → `{ succeeded, failed[] }`. `chat.updated` SSE feeds live lists; `chat.deleted` is now actually emitted.
- Needs you / Running filters reuse the attention feed (worker state counts for its orchestrator). "Changes ±" is recomputed on workspace change, restore/discard and turn end (batched per workspace); a git failure keeps the previous value (never invented zeros). `chatTurn` status is in the shared status map.
- CLI `chat list` without `--limit` returns 50 rows and, when there are more, warns "Showing 50 of N" with the next `--cursor`; `--all` pages through everything. CLI chat refs resolve by one `GET /chats/:id` or the `q=` search, paging every chat only for an id prefix, or for a name the search misses (SQLite `lower()` folds only ASCII, so `Über plan` needs the JS match; P2-R35). `#n` pages as far as it needs, `@active` sees every active chat, `@last` reads every chat (no server sort for "last created or updated"). An unmatched ref says `No chat matches "x".`
- Review round 1 (P2-R1, R2, R9, R20): more than 200 ids in a bulk action are batched **by the client** (`runChatBulk` in `packages/shared`, used by web, client-core → mobile/CLI); `PATCH /chats/:id` emits `chat.updated` for list-visible fields, so no polling safety net is restored; the "Changes ±" backfill runs at most 3 summaries at once; cursor values are type-checked against their sort.
- Review round 2 (P2-R30, R33, R34, R36): the activity sort is index-served without `ANALYZE`, proven with `EXPLAIN QUERY PLAN` on a migrated 5,000-chat DB. v56 adds `idx_chats_list_activity(parent_chat_id, last_activity_at, id)` and `idx_chats_list_status_activity(status, parent_chat_id, last_activity_at, id)`, and replaces `idx_chats_last_activity` with `(last_activity_at, id)` for the workers-included list. The cursor predicate is a row value `(key, id) < (?, ?)`, so a cursor page is an index range. No plan has a temp B-tree for the activity sort; the created and name sorts are unchanged. `last_activity_at` is backfilled from `created_at` and kept non-null by two triggers (SQLite cannot add `NOT NULL` without rebuilding `chats`; `schema.ts` declares it `.notNull()`), so a `{v:null}` cursor cannot occur. `chat.updated` also fires for `model`, for every chat unlinked by a project delete (collected before the delete; attention items drop the project via `AttentionService.refreshProject`), and for every chat bound to a renamed or deleted agent (`ChatListInvalidator` in core). The web list refetch never rides another in-flight fetch (an event during one marks the list dirty and refetches once it settles). A bulk delete that partly fails keeps only the failed ids selected (web and mobile); a total failure is reported on both.

### D-53 Storybook and VRT as built (P1-SB) — Final
- Storybook 10.6.0 (react-vite, addon-docs/a11y/vitest/mcp, storybook-addon-pseudo-states), exact pins. Appearance toolbar drives `applyAppearance`, never localStorage. Titles carry the layer prefix (`ui/Foundations`); the `vrt` tag is on by default. Manifest flag `features.componentsManifest`.
- One Vitest browser project **per appearance combo** (Instrument dark, Instrument light, Solarized light) using per-project `initialGlobals` — replaces the `STORYBOOK_A11Y_GLOBALS` env of `09` §9.1; `test:stories` lists the three projects explicitly (portable to Windows). The Done loop's `--project storybook` covers the dark combo only; `test:stories` covers all three. `.storybook/vitest.setup.ts` only preloads fonts (since 10.3 the addon applies preview annotations itself).
- The web tsconfig turns declaration output off (TS 6 rejects `satisfies Meta` stories with TS2883; the app emits no declarations).
- VRT: `docker/vrt.Dockerfile` builds the static Storybook only (server bundle + app build join in P3-08 with the `routes` project, currently a skeleton behind `GAI_VRT_ROUTES=1`). Baselines are generated only inside the container; this Mac has no Docker, so the CI `vrt` job's first run uploads them as an artifact and fails until they are committed (owner action after the first push).

### D-54 Desktop servers, updates and badge (G-03…G-05) as built — Final
- **Payload types:** every IPC payload (`DesktopServerEntry`, `DesktopUpdateState`, `DesktopShellStatePush`, `DesktopAppearancePush`/`Request`, `ServerReachability`) lives in `packages/shared/src/types/DesktopShell.ts`; desktop (`shared/ipc.ts`, preload) and web (`desktop-bridge.d.ts`, `lib/desktop.ts`) import them (P1-review P2-R24). So do the window-chrome, find-in-page and browser-IPC shapes (`WindowChrome` with `platform: DesktopPlatform`, the three desktop OSes, mapped by `desktopPlatform()` in main; `WindowStateChange`, `FindInPageResult`, `Browser*`, `NativeBrowser*`), which web used to hand-copy (P2-R41).
- **Servers (G-03):** `probeServer(endpoint, { timeoutMs, expectedServerId? })` in `packages/client-runtime/src/connections.ts` (public `GET /api/auth/server-info`): `connected`; `unpaired` for a 4xx other than 429, no `serverId`, or a different `serverId` than expected; `error` for 429/5xx (reachable, not confirmed); `offline` for no answer. Redirects are never followed (`redirect: 'manual'`): a 3xx is `unpaired`, so a stored server cannot bounce the probe to another origin and have that origin's name shown. A timeout after the status line arrived (while reading the body) is `error`, not `unpaired`. `probeServer` takes an injectable `fetch`; desktop main passes Electron's `net.fetch`, so the system proxy and Chromium's certificate policy match what the window can load (P2-R40). Desktop IPC `getServers`/`switchServer`/`addServer` + `serversChanged`. **Main probes, not the renderer:** the app's CSP is `connect-src 'self'` and other servers send no CORS headers, so `getServers` returns each entry's `status` probed with Node `fetch` in parallel (`server-probe.ts`, 2.5 s each), importing the dependency-free `@generatorai/client-runtime/connections` subpath. Plain web lists the client-runtime catalog, probes only the entry on its own origin and marks the rest `unknown`. A servers change also rebuilds the native menu and the tray (P1-review P2-R6, P2-R23).
- **Updates (G-04):** `DesktopUpdateState = { status: idle|checking|downloading|ready|installing, currentVersion, nextVersion?, downloadedVersion?, percent?, error? }` via `getUpdateState`/`installUpdate` + `updateStateChanged`; web `useUpdateState()`/`restartToUpdate()`. `ready` is derived from `downloadedVersion`, so a later check or failure only sets `error`; a failed check is `idle` + `error`; `update-cancelled` is handled. On macOS `ready` waits for Electron's native `autoUpdater` `update-downloaded` (Squirrel.Mac has the update), behind `platform.ts` `updaterHasNativeInstallStage` (P2-R7, P2-R4).
- **Install (P1-review P2-R4, R27, R28):** nothing is stopped until the install is committed, and on Windows and Linux the installer starts only after our shutdown. The sequence per OS (electron-updater 6.8.9 as read in its source; `updater.ts` `installUpdate`):
  - **Windows (NSIS) and Linux (AppImage, deb, rpm, pacman), all `BaseUpdater`: shutdown first, installer last.**
    1. Check the install can go ahead, without side effects: the downloaded file exists, and for an AppImage the app was started from an absolute, existing `$APPIMAGE`. If not: `failed` + `error`, nothing touched, app still running.
    2. Ask about unsaved work (`confirmDiscard`). Declining changes nothing. The answer is remembered for the rest of this quit, so `quitApp` does not ask a second time; an abandoned quit forgets it.
    3. Register an exit hand-off with `quit-coordinator` (`setExitHandoff`) and `app.quit()`. The normal `before-quit` → `quitApp` accepts the quit; that is the commit point (`installing`, outcome `quitting`). It then stops the computer host and the embedded server (bounded 20 s) and destroys the tray.
    4. Right before `app.exit(0)`, the hand-off calls `install(false, autoRunAppAfterInstall)`, the arguments `quitAndInstall()` passes, without its `app.quit()`. NSIS spawns the installer detached with `--updated --force-run`; its `allowOnlyOneInstallerInstance` kill (`Sleep 300` → find → `Sleep 1000` → `Stop-Process` on everything under `$INSTDIR`) finds nothing of ours left to kill. AppImage moves the new file into place and spawns it; our `exit(0)` follows in the same tick, so the single-instance lock is free before the new process reaches it. deb/rpm/pacman run the package manager through pkexec synchronously and queue `app.relaunch()`.
    5. If `install()` returns false, throws, or electron-updater reports `error` within two event-loop turns (NSIS reports a failed spawn asynchronously, `NsisUpdater.js:131-147`), the shutdown has already run, so the app is relaunched on the current version (`app.relaunch()`; an AppImage relaunches `$APPIMAGE`, because its mount goes away with the process). Example: a cancelled pkexec prompt.
  - **macOS (`MacUpdater`, Squirrel.Mac): installer first.** Squirrel.Mac has verified the update before `ready` (`updaterHasNativeInstallStage`), and ShipIt installs only after our process exits, so nothing can race the shutdown. Ask about unsaved work, mark the window manager quitting (Squirrel closes every window before `before-quit`), `quitAndInstall()`. Its `before-quit` is the commit point, and the normal `quitApp` shutdown and `app.exit(0)` follow. An `error` or 60 s without a quit is a failure: back to `ready` + `error`, window restored, app still running.
  - **Idempotent:** once an install is committed, every later `installUpdate` returns `quitting` without touching electron-updater. `BaseUpdater.quitAndInstall` resets its own `quitAndInstallCalled` guard when `install()` refuses a second call, and its quit handler would then install again on exit (P2-R27). A request while an ordinary quit is already shutting down is also `quitting`: `autoInstallOnAppQuit` installs on that quit's exit code 0.
  - **Failures the user asked for are not silent:** "Restart Now" followed by a `failed` install shows an error dialog. Help ▸ Check for Updates with an update already downloaded offers it again instead of checking (the ready dialog fires only on the transition to ready; after "Later" this is the way back). A newer release is picked up by the next launch's check (P2-R37).
  - Two quits at once share one in-flight shutdown (P2-R23). A failed unsaved-work prompt resets it, so a later quit still works; tray Quit and the vault prompt's Quit no longer pre-set the quitting flag (P2-R38).
- **R5 (corrected, P2-R5, P2-R42):** `app.exit(0)` does **not** skip `quit`. Electron documents only `before-quit`/`will-quit` as skipped. In its source, `app.exit` binds to `Browser::Exit`, which destroys the windows (`DestroyAllWindows`) and then runs `Shutdown()`; that notifies `OnQuit`, and `App::OnQuit` emits `quit` with the exit code. electron-updater's `autoInstallOnAppQuit` hook is `app.once('quit')` with exit code 0, so it was never broken by our `before-quit`. The earlier "R5 fixed" wording here was wrong. Per-OS confirmation with `mock-update-server` is still pending (07 R-10 stays open); that run must also check, per OS, that the embedded server stopped gracefully before the installer ran and that the app came back after the install.
- **Update dialog:** the native "update ready" dialog is skipped only when a renderer has subscribed to `updateStateChanged` (the preload's `updates.onChange` reports it over `IPC.watchUpdates`; a renderer reset clears it) **and** the window is visible and not minimised (P2-R37). The preload's unsubscribe is idempotent (P2-R39). No web component subscribes before the P3-06 pill, so until then the dialog always shows (P2-R3).
- **Badge (G-05):** attention counts ride the existing `setMenuState` push into `attention-state.ts`; `badge.ts` sets the macOS dock badge, Linux `setBadgeCount` (no-op where unsupported) and a Windows overlay dot. **The tray** shows the counts (the application menu does not, so a counts-only push does not rebuild it, P2-R16). In remote mode the counts go next to the remote server's name and the embedded server gets its own line (P2-R23). The counts and badge are cleared whenever the page that pushed them is gone: window closed, renderer crashed, or a committed new top-level document such as a backend switch or restart repoint (`WindowManager.onRendererReset` on `did-navigate`, P2-R8). A navigation that never commits (a blocked external link, a download, a 204) keeps them (P2-R39).

---

### D-55 Deep links, model catalog, task cancel and computer control (G-07…G-09, G-20) as built — Final
- **Deep links (G-08):** only `pair`, `dock`, `tab`, `kind`, `run` survive; `generatorai://pair?code=X` → `/?pair=X`. macOS `open-url` is registered before ready and `navigateTo` holds a route until the app page has loaded (cold start). In-app popup routes keep their full query.
- **Model catalog (G-09):** shared `HarnessCatalog` types; `buildModelPickerCatalog` (client-core) orders READY providers first and never defaults to an unready one; web hooks in `hooks/harnessQueries.ts`; the CLI completes only ready providers.
- **Task cancel (G-20):** migration **v63** (written as v57; renumbered, D-81) adds `cancelledBy` (`user` | `orchestrator`) + `cancelledAt` on tasks, worker chats and `chat.background_task.*` events; cancel returns `202 { ok, taskId, cancelledBy, cancelledAt }`, 404 for an unknown task.
- **Computer (G-07):** `computer_run_steps` (one consent for a listed plan via `ComputerService.actPlan`); consent answers take optional `scope: 'app' | 'any'` (`'any'` stored as a `*` grant; denials are always per app); `GET|POST /workspaces/:id/computer/control` with `agent | paused | user`, in-memory per server process, refusing agent desktop actions while paused/taken over, plus `computer.control_changed` SSE.
- Migration numbers taken by the redesign: v61, v62, v63 after the Overhaul merge (D-81); the next migration on either side is v64.

### D-56 Kit conventions as built (P3-01…P3-03) — Final
- **Layout:** `apps/web/src/ui/<layer>/<Name>/<Name>.tsx` + `<Name>.stories.tsx` (not kebab-case single files); hand-written on `@base-ui/react` 1.8 (the shadcn CLI needs the network and is not a dependency). `ui/lib` holds `focus.ts` (focus ring + invisible 24 px hit area with `data-gai-hit`), `popup.ts` (shared popup chrome + the Base UI CSS-variable passthroughs), `avatar.ts`, `test/targetSize.ts`.
- **Behaviour choices:** the kit toaster has its own toaster id (never shows legacy toasts); FilterBar collapses its chips below 1024 px of bar width (at a 1100 window the bar is ~980); PageHeader renders its title as a heading only with `titleIsHeading` (avoids two `h1`s beside PageTitle); `useConfirm()` returns `{ confirm }` (the ratchet flags bare `confirm(`); separators and skeletons use borders / `min-h-*` (the lint bans `h-px` and numeric heights).
- **Status text over hover/selected rows** is clamped to ≥ 4.5:1 too (+0.05 margin on those composited backdrops, `design.ts` step 9); Instrument light run/ok/warn/err and dark err changed accordingly (02 §2.3 updated).
- **Cascade fix:** three legacy `globals.css` rules (`* { border-color }`, the global focus-visible outline, the 150 ms transition) were outside any cascade layer and silently beat every layered utility; they now live in `@layer base`. Consequence: border-colour utilities in ~49 legacy files that were dead now apply as their authors wrote them — an accepted, intended visual change on legacy pages.
- **Storybook tests** run the Tailwind plugin (the vitest config replaces vite.config, so story tests had rendered unstyled before) with a 60 s per-test timeout under load.

### D-57 App shell as built (P3-04) — Final
- `ui/shell` holds AppFrame, Sidebar (+ parts), Rail, MainCard, PageHeaderSlot/LegacyHeaderSlot, TitleStrip, MacTrafficLightRow, ToasterRegion, SidebarFlyout; `ui/templates/Gate` renders 404 and route errors. `app/shell` wires them (`ShellRoute`, `ConnectedSidebar`, `ConnectedRail`, `ConnectedTitleStrip`, `LegacyHeader`, `useSidebarMode`, `useNavHistory`, `useCommandHost`, `useDesktopBridge`); `stores/uiStore` → `stores/shellStore`; the palette mounts in `ShellRoute`.
- Testids follow `09` §7.3 where it and `06` §2.6 disagree; rail children use `06`'s names. `header-toggle-sidebar` is removed.
- No phone drawer: below 768 px the rail stays (`04` §4.1 wins over `06` §2.5). Workflow builder routes set `forceRail` in their route module.
- Needs you / Running sections render only when they have items (D-36). The server switcher and title-strip server chip are static until P3-06 adds the Servers popover (no dead buttons). The legacy header is 44 px on the card background.
- Window chrome (per-OS layout, insets) reaches the renderer through the preload before first paint (launch argument); the `getWindowChrome` IPC is gone; `--titlebar-*` → `--gai-titlebar-*` everywhere; both CSP hashes regenerated.

### D-58 Home and Projects read models (G-10…G-13, G-15) as built — Final
- `GET /system/info` (G-12): server name/version, platform, uptime, running/max agents, database size (main + WAL + SHM) and disk (`fs.promises.statfs`); size/disk are **omitted** when unmeasurable, never 0.
- `GET /projects[/:id]?include=summary` (G-13): `summary { codebases, activeChats, needsYou?, running?, worktrees:{active,orphaned}, runs, lastRun? }`, composed from existing read-only service calls (no SQL, no migration).
- **G-15 moved off the workflow-owned route:** project runs are `GET /projects/:id/runs?status=&cursor=&limit=` on the redesign-owned `projects.ts` (joins definitions → runs read-only), not `GET /workflow-runs?projectId=`, so `workflowRuns.ts` stays untouched.
- `GET /stats/summary` (G-10): aggregated in memory; `successRate` over terminal runs only; rates and durations omitted when their denominator is zero; no `chats.turns` (no data source).
- `GET /activity/recent` (G-11): finished chat turns + terminal runs + terminal automation executions, newest first; pull-request items deferred (the only PR source is a live git-host call per codebase) — revisit with G-16.
- These read models are not added to `IPlatformClient` (precedent: `listProjects`); CLI and mobile use client-core's `api.*`. All tolerate empty run history (the Workflow Overhaul's run-history migration).

### D-59 Chats list as built (P3-07) — Final
- First page on the kit (`features/chats`, T-01, `legacyHeader:false`). `ChatRowModel` lives in `packages/shared/src/ui-contract/chats.ts`, mapped by `toChatRowModel` in client-core. Row unarchive uses a new `unarchiveChat` (`PATCH {status:'active'}`) on IPlatformClient.
- One `MenuButton` per row instead of the board's split archive-icon + "…" pair; no header overflow menu (nothing real to put there, D-36); Tags is a free-text chip until a distinct-tags endpoint exists.
- Accessible names: "New chat" (sentence case, F-chats-01) and tab names carry their live count ("Active 62"); specs updated.

### D-60 Native IA as built (P3-06) — Final
- Application menu, tray, macOS Dock menu, Windows JumpList and Linux `.desktop` actions are generated from `COMMANDS`/`NAV_DESTINATIONS`. Native menus, Dock menu and JumpList use title case; the tray keeps the registry's sentence case (as the board). Tray counts and the badge share one source (`attention-state`).
- `generatorai://command/<id>` runs only allowlisted ids (`chat.new`, `workflow.new`); `WindowManager.sendCommand` holds a command until the page reports ready (cold start, reload, backend switch; last one wins).
- The Servers "popover" is the kit **Menu** (the board draws a `role="menu"` with radio rows), 280 px, controlled so it closes on switch; "Add server…" only on desktop; on web the list includes the page's own server (other origins cannot be probed from a page — no status shown for them).
- "Restart to update" pill: title strip on Windows/Linux-custom, sidebar footer on macOS/Linux-native, a download icon in the rail; only when an update is ready; never on web. `agent-tests/mock-update-server.mjs` (`serve` / `check` / `verify-log`) drives the per-OS install run (R-10), which stays an owner action on real installers.

### D-61 Composer and browser logic extraction as built (P4-02, P4-03) — Final
- Composer state machine: pure reducer `packages/client-core/src/composer/composerMachine.ts` (+ contract types `packages/shared/src/ui-contract/composer.ts`); the two-phase stop rules (400 ms / 15 s) live once as pure functions shared by `StopController` and the reducer. Typing is never blocked (D-29).
- The 8 composer hooks live in `components/chat/composer/hooks/` for now (they still need legacy Toast/builtins/promptHistory; `blocks/` may not import legacy code); P4-08 moves them to `blocks/composer` with the kit toast. Send eligibility copies today's behaviour (a failed prep shows its bar but does not block Send).
- Browser logic lives in `apps/web/src/blocks/browser/` (REST, descriptor polling, stream events, screencast/live stream, viewport, input mapping, native view driver, occlusion, annotations, capture, device emulation, tab state); the interactivity setting moved to `lib/browserInteractivity.ts`. Added testids `browser-toolbar`, `browser-url`, `browser-live-view`, `browser-empty-state` (03 §6.2). Browser events accept `{kind, payload}` (and `data` until P4-10 drops it).
- Known defects #1–#6 fixed (reviews/P4-known-defects.md).

### D-62 Changes and ChatPage logic extraction as built (P4-04) — Final
- Changes logic lives in `apps/web/src/blocks/changes/` (`useChangesModel`, `useChangesViewSettings`, `useCheckpointPanel`, `useFileActions`, `useKeptFiles`, `useChangesNavigation`, `useReviewOverlay`, `useChangesEditor`, `changePaths`, `changeVisibility`, `useDiffSources`, `diffTypes`); Keep/Undo send the summary's repo-relative path unchanged (defect #7); review threads anchor to their own mount's base/head checkpoints (confirmed against the server).
- ChatPage logic is `useChatView` in `features/chat/hooks/` composed of `useChatWorkspace`, `useChatStreamState`, `useChatTranscript`, `useChatGates`, `useChatStopRewind`, `useChatDockRouting` (`CHAT_DOCK_TAB_CAPS`); transport moved to `hooks/chatSessionQueries.ts`, `hooks/changesQueries.ts`, `useFetchChatTranscript`, `useReadFsGitInfo`. No `fetch('/api` in `features/`/`blocks/`.
- Migration exception until P4-12: `pages/ChatPage.tsx` may import `features/chat` (eslint).
- All nine characterization-pinned defects are fixed (reviews/P4-known-defects.md).

### D-63 Kit batch C as built (P4-05) — Final
- Primitives Textarea, Switch, Gauge, Callout, InlineCode, Collapsible, Slider, Combobox, Sheet (with a true non-modal variant, no backdrop, for the narrow dock sheet — D-19/D-27); patterns DockTabStrip (overflowing tabs collapse into the "+" menu), SplitPane (react-resizable-panels 4; collapse via `collapsedSize`, never unmount; layout persisted only after user interaction), CodeBlock (Shiki 4, JS regex engine, one lazy chunk per language, theme maps TextMate scopes to `var(--syntax-*)`), TerminalFrame, StepRail, KbdHintRow, GateCardFrame, FindWidget, DiffStat; template T-04 Workspace (the <1200 px dock→sheet swap belongs to S-08/S-09 in P4-06).
- Callout "info" reuses the `run` pair; Gauge's label sits beside the 14 px ring.
- Solarized `--syntax-function/-type/-string` darkened 1–8 % to reach AA as 13 px text on light ground.
- Initial load after P3 + kit C: 435 KB gzip (budget 800 KB) while both UI layers coexist; P7 removes the legacy layer.

### D-64 Codebase logs, worktree sizes, project customization and entity search (G-16…G-19) as built — Final
- **G-16:** `POST /projects/:id/codebases/:cid/fetch` → `202 { jobId }`; `GET …/logs?limit=` → `{ lines, job? }` from an in-memory ring buffer (`CodebaseLogService`); git `bareClone`/`fetchAll` stream output. A fetch in flight reuses the existing `cloning` status (no new enum value); `codebase.status_changed` SSE (lifecycle).
- **G-17:** `GET …/worktrees?include=usage,link` → `{ items, totalBytes?, reclaimableBytes? }`; sizes measured asynchronously with bounded concurrency and a cache using `fs.promises` only (no `du`), unknown until measured; `link` resolves a chat mount or a workflow/automation run; `expiresAt` reuses `WorktreeCleanupService`'s retention math. Chat-workspace mounts do not write `worktrees` rows today (separate mount model) — `link.entity: 'chat'` appears only once that path is reconciled (follow-up).
- **G-19:** `GET|PUT /projects/:id/artifact-prefs` → `{ disabled: [{type,id}] }` on the project's `settings` JSON (no migration), enforced in `ArtifactCatalog.listSkills/listMcpServers` and `/available-artifacts`. The legacy client-side prefs store stays until P5 replaces the Customization tab.
- **G-18:** `GET /search?q=&types=&limit=` across chats, projects, agents, workflows, automations, scripts — scope-filtered per type before querying, ranked by title match + recency.
- The backend track P2-00…P2-06 is complete; G-21…G-29 belong to the Workflow Overhaul (PW).

### D-65 Dock as built (P4-06) — Final
- One stable surface element: ≥1200 px it tracks an empty SplitPane spacer; <1200 px it becomes the 380 px non-modal sheet (`role=dialog`, `data-gai-overlay=sheet`, no backdrop, no `aria-modal`); full width below 768 px or a host under 760 px. Maximize covers the main card; close = `visibility:hidden` + `inert`, never unmount. `NarrowDockSheet` uses the Sheet variant styles, not a portalled Dialog, so the tree never moves.
- `blocks/dock` registry: pages pass `DockRegistry` (type → `DockTabDef { Component | render, label, icon, pinned, allowMultiple, maxInstances, … }`); panels take `DockPanelProps {id,type,index,active}`, read data from context/stores and gate live work on `active`; a panel mounts on first selection and stays mounted until its tab closes.
- Tab types, pinned set, `DOCK_TAB_CAPS` (browser 5, terminal 4, file 8, widget 6), the `?dock=` parser and storage keys live in `packages/shared/src/ui-contract/pane.ts`; keys `generatorai:dock:<scope>:open|layout|<id>`; `background_tasks` → `tasks`. Collapsed layouts are never saved.
- Browser-host overlays receive an `AnnotationPalette` derived from tokens (in design-tokens to avoid a package cycle); main validates every value before `executeJavaScript`.
- The legacy run page keeps `RightPane` until PW; its panel-import swap moves to P4-12.

### D-66 Composer as built (P4-08) — Final
- `apps/web/src/blocks/composer/` hosts a `chat` and a compact `stage` variant; the 8 hooks moved to `blocks/composer/hooks/` (kit toast, errors only — two former warning toasts are now error toasts per D-30). Slash-command builtins, types and fuzzy matcher live in `packages/client-core/src/composer/slashCommands.ts`; `formatTokenLimit` in client-core. `ChatInput.tsx`, `VoiceRecorder.tsx`, `ComposerMenu.tsx`, `WorkspacePrepBar.tsx` deleted; legacy ModelPicker/AgentPicker/ContextUsageGauge stay while workflow-owned files import them.
- `blocks/model-picker` (ready providers first, never defaults to an unready one) and `blocks/agent-picker`; `ui/primitives/Popover` and a Textarea `inline` variant.
- Composer tool-toggle registry (`blocks/composer/toolToggles.ts`: `registerComposerTool`, `useComposerTools`, `listComposerTools`) ships empty: chat capability overrides freeze at session start, so no toggle is rendered until one can take effect (the Workflow Overhaul registers Workflows).
- Typing is never disabled during a turn (D-29; ChatPage passes `disabled={false}`); ↑ recalls the typed text, not the formatted slash prompt. Per-turn chip menus are hand-built panels (their listbox/option roles and capture-phase Escape are pinned by tests).

### D-67 Transcript as built (P4-07) — Final
- `blocks/transcript` (user message, turn header, thought pill, step list with shared verbs, tool cards, assistant text, gate cards, inline error, delegation group, usage chip); transcript model logic in `packages/client-core/src/transcript/`; `toolVerbs.ts`, `gates.ts` (`GateKind`, actions, keys), `copy.ts` in `packages/shared/src/ui-contract/`. Markdown is the Streamdown 2 `Markdown` pattern with fenced code through the lazy Shiki `CodeBlock`; react-markdown, remark-gfm, highlight.js and the `.hljs` CSS are removed.
- Tool-card registry `registerToolCard({ id, match, icon?, verb?, target?, result?, subject?, Card?, openIn? }) → unregister`: exact match beats a pattern, latest registration wins (the Workflow Overhaul can override built-ins); documented in HANDOFF.md.
- **D-33 outcome: no-go on virtualization → fallback ships.** Every turn stays in the DOM (browser Find, selection and screen readers keep working); long transcripts use `content-visibility`; finished responses older than the last 20 turns start collapsed. Turn-level virtualization + app-level find exist behind `virtualize="auto"` (off); the spike report explains why no trustworthy numbers could be measured.
- View modes Normal/Verbose/Summary are client-side and remembered per chat per device (G-06). No "Always in this chat" permission option, reasoning duration or "asked by" line until data exists. The background-command tail and the computer-consent card are built but not rendered until their data exists.

### D-68 Changes panel as built (P4-09) — Final
- `blocks/changes` `ChangesPanel` (toolbar, compare bar This turn / This chat / Branch + the Compare-against select, list bar with Keep all / Undo all, mount groups, file rows with Keep/Unkeep/Open in editor/Undo, Kept group, review comments, checkpoint scrubber with Compare/Rewind, `CommitBar` commit → push → PR hidden at 0 changes); `blocks/diff` (B-07 on @pierre/diffs, `--diffs-font-family: var(--font-mono)`); `blocks/files/FileTree` (B-08); `blocks/scm` (CommitBar, ScmConflictActions); a Select primitive pulled forward.
- Registered in the dock as `changes` via `ChangesDockPanel` reading `ChangesDockContext`. The legacy run/automation pages import `ChangesPanel` (mechanical swap, COORDINATION.md).
- File-change letter colours follow `03` §2.2 and the boards (M amber, R blue). CommitBar: one primary action, PR base is a text field (readiness returns no branch list), "Open as draft".

### D-69 Tasks, Computer, Plan and Widget panels as built (P4-11) — Final
- Tasks and Computer are chat-only panels in `features/chat/dock/`; Plan is `blocks/plan` (uses the kit Markdown pattern); Widgets are `blocks/widgets` (`WidgetHost`, `WidgetFrame`, same sandbox/origin rules). All four register in the dock and read `ChatDockContext`.
- Tasks sections registry (`features/chat/dock/tasks/tasksSections.ts`): `registerTasksSection({ id, title, order, when?, useCount?, render }, { replace? }) → unregister`; duplicate ids throw unless `replace`; one visible section owns the panel, several stack with titles/counts; registrations live in `app/registries/tasksSections.tsx` (the Workflow Overhaul adds its sections there). The built-in section is "Background tasks" (`background-agents`).
- Not rendered until data exists: wave, worker limit, review-round max, task brief, step rail, "Ask Orchestrator to retry", "See in Changes", fps, "Watching since". Plan approve/edit no longer toast (errors only). Computer consent prompts come from the workspace-level feed; all raw fetches replaced by `hooks/computerQueries.ts`.

### D-70 Kit batch D and settings kit as built (P5-01, P6-01) — Final
- P5-01: Field, Select (the Field-integrated P-17; `aria-label` when no Field label; the Changes CompareBar uses it), RadioGroup (+ swatch), RadioCard, Tabs (children render inside the same Root), ProgressBar/Meter, Card, FileInput; patterns EntityRow, ActivityRow, EntityCard/CardGrid, StatStrip, KeyValueList, FormSection, SummaryAside, ActionBar, Inspector, ChoiceCardGrid, PairingCodeInput (3×4 from the server constants, D-42; wraps its own Field for OTP naming), Banner, Dropzone, ModalForm; templates T-02 DetailPage, T-03 FormWithAside, L-01 Dashboard; empty-state copy in `ui-contract/copy.ts`. New tokens `w-aside`/`w-side-rail`/`w-inspector` (from SHELL) and `h-meter`/`h-tile`.
- P6-01: NumberField (Base UI, Input shell, unit suffix, stepper), C-13 SettingsSection/SettingRow/SettingsTable/SettingsStatusFooter (SettingsTable composes Table in a raised card), C-34 ListPane, S-11 SettingsModalFrame (960×640 Dialog on MasterDetail), T-05 MasterDetail. RadioGroup swatch / RadioCard tile variants for Appearance follow in P6-03.

### D-71 Files, Terminal and Browser panels as built (P4-10) — Final
- `blocks/files` (FilesPanel with Sources block + per-mount B-08 FileTree + preview; B-09 FileViewer; `useFileTabs`: one pinned Files tab + ≤8 file tabs), `blocks/terminal` (TerminalPanel on TerminalFrame; xterm colours from tokens; agent console; Kill confirm Popover; REST in `hooks/terminalQueries.ts`), `blocks/browser` view (toolbar, comments popover, device-emulation bar, empty state, agent strip, status bar; NativeBrowserView moved in; contract strings unchanged). `components/diff/` is gone.
- **Pinned panels do nothing heavy until first shown** (`blocks/dock/useActivated.ts`): no PTY spawn or desktop browser auto-start just for opening a chat; they stay mounted afterwards.
- xterm opens only after the bundled font loads and its box has a size; the unmount kill is sent before the socket closes (the old order only ever killed via the fallback DELETE).
- Kill confirmation names the tab/shell only and the agent console shows no durations (nothing reports them); browser "pool full"/"page failed" show the error + Dismiss only (no data for Retry/Open Terminal).
- The legacy run page imports these blocks (mechanical swap; its Files tab is now single).

### D-72 Chat page on T-04 and the handoff (P4-12) — Final
- `features/chat/ChatPage.tsx` on T-04 (new `bare`/`dockHost` options let the dock keep control of split/sheet/Maximize) with its own ChatHeader (breadcrumb, status badge — nothing while idle, neutral "Archived" chip —, More menu: Open in editor via `blocks/editor` `useEditorActions`, Copy path, Rename…, Copy transcript, Fork, Archive… with confirm), dock toggle `dock-toggle` ("Show side pane"/"Hide side pane"; `header-toggle-right-pane` retired, specs updated), FindBar on FindWidget, status line "Processing… / Generating response… / Paused — waiting for your input". `pages/ChatPage.tsx`, the legacy FindBar, ChatChangesTray, LiveActivityStrip, ScmResultCard, SourcesPanel deleted; the legacy Header lost its chat branch.
- `rightPaneStore` → `stores/dockStore` (still backs `dock.toggle`, the desktop menu checkmark and the legacy run page). `RightPane.tsx`/`useResizablePane` remain only for the legacy workflow run page until PW or the D-35 fallback. "Edit sources" opens through a small store with the dialog mounted in `app/shell`.
- `docs/redesign/HANDOFF.md` is published: the Workflow Overhaul builds its screens on the kit from here.

### D-73 Home and palette search as built (P5-10, P5-12) — Final
- `features/home` on L-01 replaces the Dashboard ("Dashboard" renamed to Home everywhere): H1 "N need you · N running", quick composer (blocks/composer; "More options" carries a shared `CreateChatDraft`), Needs you with inline actions limited to chat tool permission (Allow once), chat plan review (Approve) and workflow stage approval — questions, stage inputs, computer consent and paused runs navigate —, Running (Stop/Cancel), Recently finished (Retry; PR link only when the server sends one), This week (G-10), System (G-12), shortcuts. No automation re-trigger/cancel on Home (no API). Recently finished / This week refetch when an item leaves the attention feed.
- Palette entity search (G-18): entity groups above Go to, ordered by each type's best hit; server-matched hits are `preMatched` (not re-filtered locally); chats already in Recent are not repeated; Recent chats sort by activity.

### D-74 Projects area as built (P5-02…P5-06) — Final
- `features/projects`: ProjectsList (T-01, G-13 columns only where data exists, list/grid, row menu without "Run workflow…" until PW), CreateProject (T-03), ProjectDetail (T-02; tabs Codebases · Chats · Runs · Pull requests · Customization · Settings as path segments `/projects/:id/:tab?`; Customization sub-view via `?kind=`), CodebaseDetail (`/projects/:id/codebases/:cid/:tab?`; Worktrees with G-17 sizes/cleanup, Files with a lazily loaded tree because the file API is one folder per request), PullRequest page (T-02 + DiffView). Legacy pages, ProjectPullRequestsTab, SourceBadge, projectCatalogPrefsStore, CodebaseFileBrowser, FileExplorer, InlineDiff, DirectoryBrowser (→ `blocks/directory-browser`) deleted.
- Customization enable switches are server-persisted (G-19); the tab merges the unfiltered system and project lists (a project item overrides a same-named system item). A codebase in `cloning` that was fetched before shows "Fetching". The shared chats table moved to `blocks/chats-table` (Chats list + project Chats tab). Runs tab has no Trigger column (no field yet).

### D-75 Settings modal as built (P6-02…P6-04) — Final
- The router is a single `'*'` route; the shell renders pages at a "page location" = the URL, except under the Settings modal where it is the page the modal opened over (`state.backgroundLocation`), else the last page shown, else Home (direct load). The page stays mounted under the modal; `useLocation()` inside a page returns the background page while Settings is open (intended). `PageRoutesBoundary` catches page errors inside the main card.
- Settings sections register via `features/settings/settingsSections.ts` (`registerSettingsSection({ id, render, footer? }, { replace? })`), with registrations in `app/registries/settingsSections.tsx` (lazy with the modal); nav/ids/path helpers are shared in `packages/shared/src/ui-contract/settings.ts` (group "Agents & models", DF-21). `isOverlayNavigation` keeps the WorkflowBuilder blocker quiet; `app.settings` command and `generatorai://settings/<section>` open the modal over the current page.
- Appearance: mode, theme gallery (Product/Editor/Low glare tabs, 5-col tiles previewed by scoping `data-theme`/`data-accent` — no inline colour), 7 accent swatches, density, font size, reduce motion. Security & devices: Servers, This server, Network exposure (Loopback only / LAN only — D-42), Pending access requests, Paired devices (capabilities in a per-row menu), Pair a new device (3×4 code, device name required); data in `hooks/securityQueries.ts` (react-query, 30 s poll).

### D-76 Pairing gate as built (P5-11) — Final
- `features/pairing/PairingGate` (L-03: server address with live reachability, PairingCodeInput 3×4, informed consent (server/endpoint/host identity + scope chips), device name, Connect; `?pair=` pre-fills) rendered by `app/shell/AuthGate` (logic in `hooks/authQueries.ts`, `resolveGateOutcome` pure + tested); legacy `components/AuthGate.tsx` deleted.
- The public `server-info` probe bypasses the auth fetch interceptor (`Symbol.for('generatorai.signedRequest')`) so an unpaired device can see reachability. No "Scan QR" link (no camera QR decode exists; D-36).
- Static desktop pages (splash/error/prompt) are generated from tokens (`packages/design-tokens/src/emit/static.ts`), so they follow the persisted theme instead of GitHub dark.

### D-77 Chat creation as built (P5-09) — Final
- `features/chats/create`: `NewChatDialog` (640, mounted once in `app/shell/ShellRoute.tsx`, opened anywhere via `useNewChatStore`) and `ChatCreatePage` at `/chats/new` (T-03, TanStack Form + zod 4 — first use in the app). One canonical `CreateChatDraft` + `chatNameFromPrompt` in `packages/shared/src/ui-contract/chatCreate.ts` (Home's quick composer "More options" → `/chats/new` with the draft); `mapDraftToParams` (unit-tested) turns a draft into `CreateChatParams`. Chat creation sends the first prompt through the chat endpoint (`useSendChatPromptTo`).
- `blocks/sources` (SourcePicker + DirectoryBrowser + model, `compact` mode for the dialog). `components/chat/CreateChatDialog.tsx` and `BrowserVisibilityPicker` deleted. B-03 capability editing is not built (static summary; D-36).
- Known duplicate to reconcile in the final review: `blocks/directory-browser` (P5-03) vs `blocks/sources` DirectoryBrowser (P5-09).

### D-78 Agents area as built (P5-07, P5-08) — Final
- `features/agents`: AgentsListPage (T-01 grid; search; scope tabs All/Built-in/Global/Project with counts; role filter; import/export `.agent.md`; delete with confirm) and AgentEditorPage (T-03; Identity, Instructions, Role, Skills, MCP, Capabilities, Team, Runtime; TanStack Form 1 + zod 4 with reactive `defaultValues`; `agentFormSchema` tested). Kit: `ui/primitives/AgentGlyph` (DF-13), `blocks/capabilities` (CapabilityToggleList B-03, EffectiveCapabilities B-27). `useAgentCatalog` → `hooks/agentQueries.ts`.
- No opacity-based dimming for off/disabled rows (it broke contrast); state is shown by background/badge. A Field around a multi-radio SegmentedControl renames every radio, so those rows use a bare label.
- Agent "Used by" (`GET /api/agents/:id/usage` exists) is not wired yet — follow-up. Legacy `EffectiveCapabilitiesPanel`/`ToolPolicyEditor`/old CapabilityToggleList/`AgentOverridesEditor` remain while legacy importers exist.

### D-79 Settings sections as built (P6-05…P6-11) — Final
- All 15 sections (16 with the Overhaul's Workflow engine, D-81) are `features/settings` components registered in `app/registries/settingsSections.tsx`; `components/settings/` is deleted. A shared `CatalogRow` (on Collapsible with new `endSlot`/`richContent`) serves Providers, Skills and MCP. Provider test/sign-in polling moved to hooks (`useTestAllProviders`, `useTestProviderConnection`, `useSignInProvider`); new `hooks/{audio,extension,storage}Queries.ts`; Diagnostics reads G-12 system info (legacy SystemHealthCard/useTicker deleted).
- No success toasts (D-30): inline `Callout` state instead. Extensions' dead "contributes" chips removed. Source control keeps a "Use heuristic instead" clear action beside the ModelPicker.

### D-80 Scope change: the mobile redesign is built in this effort — Final (owner, 2026-09-27)
Supersedes the "next pass" parts of D-39/D-40: after the web/desktop phases, the mobile app (`apps/mobile`, design https://claude.ai/artifact/3bBuQ3vGwYbJh7A2yX7kqA) is redesigned too, following `08-mobile-readiness.md` §4 (M0 foundations → M1 kit → M2 shell → M3 features → M4 system surfaces). Owner answers to 08 §3:
- **MD-1** selected states match the new desktop (neutral ink wash + chosen accent) — replaces the old blue-tint rule.
- **MD-2** native platform pill shapes as the mobile design draws them (iOS chips/buttons/pane tabs, Android buttons/drawer items) — replaces "never pills".
- **MD-4** the list-based workflow builder and stage editors ship on phone, on the Workflow Overhaul's models.
- **MD-6** mobile-only features only with desktop parity: server-backed ones (Pause agents, notification settings — quiet hours, digest, per-project levels) are built for mobile AND desktop; OS-native integrations (share-to-agent, privacy screen, widgets, Live Activities, tiles, app shortcuts) may be mobile-only.
- MD-3, MD-5, MD-7, MD-8 follow the 08 §3 recommendations (separate composer chips with glass per design; adopt multi-server switching; Keep/Keep all/Undo all on mobile; Material You as an Android runtime accent via `ensureContrast`).

### D-81 Workflow Overhaul merge as built (2026-09-27) — Final
- `origin/desktop_redesign` (Workflow Overhaul P00–P09) is merged into the redesign as a real merge commit; the redesign tip merged after it. Log: COORDINATION.md.
- **Migrations:** the Overhaul's v55–v60 keep their numbers; the redesign's v55/v56/v57 are **v61/v62/v63**. No shim re-runs databases that ran the old numbers: only throwaway temp DBs ever did (D-02). The baseline is v63.
- **Status map:** `workflowRun` gains `waiting` → waiting and `finalizing` → running "Finalizing"; `stageRun` is the v2 instance set (`ready` → queued "Ready", `starting`/`validating` → running, `waiting`/`retry_wait` → waiting); the `legacyWorkflow` map is gone with `WorkflowStateMachine`.
- **Read models on run data (D-49, D-58)** keep their shapes and read the Overhaul's models: definitions come from the paged `WorkflowDefinitionService.list` (`routes/definitionSummaries.ts`) or the definition store's graph (`graph.workflow.name`); runs carry `projectId`; attention treats `starting/running/waiting/paused/finalizing/cancelling` runs as live, counts top-level stages only (body instances of loops/maps carry `scopeId`) and approves/stops through run commands (`approve` on the waiting instance, `cancel`); "Retry failed" on Home is a fork invocation (`target.kind = 'fork'`, pinned definition, fresh workspace).
- **Chat extension points used by the Overhaul (D-35):** the `workflow_run` / `workflow_draft` / `operator` transcript segments render in `TurnBody` — `operator` as a user message, the other two through a new segment-card registry (`blocks/transcript` `registerSegmentCard`) filled by `app/registries/workflowTranscriptCards.tsx` with the Overhaul's legacy cards; "Workflow runs from this chat" is a Tasks-dock section (order 200); the composer takes `manageStream={false}` for a stage; dollars come only from `usage.costUsd` (Copilot's `cost` is a multiplier). Settings gains **Workflow engine** (`workflow-engine`, System group) and an **MCP server** device platform.
- **Not ported (redesign-side follow-ups):** the Overhaul's `SessionSpecEditor` in chat creation (PD-20) — the redesign's create page keeps its own controls, which send the same `CreateChatParams`; the D-35 port of the workflow/automation/script screens (the Overhaul built them on existing components, not on `ui/` + `blocks/`, so the D-35 fallback applies).

### D-82 Workflow Overhaul screens on the kit (PW-a…d, 2026-09-27) — Final
Closes D-81's "not ported" item: every Overhaul screen is on `ui/` + `blocks/` + `features/`; `pages/` and `components/workflow/**`, `components/automation/**`, `components/session/**`, `components/agents/**`, `RightPane`/`useResizablePane` are deleted. No Overhaul feature was dropped; deviations below.
- **Shared WF pieces** in `blocks/workflow`: VersionChip, KeyChip, TriggerChip (WF-01/02/20), `RunDialog` + `RunPlanPreview` (WF-11, on L-05 `ui/templates/ModalWithAside`; used by the list, the detail page and the builder — `prepareTarget` saves first, `testRunTarget` adds "Test run"), ProblemsPanel (WF-03), VersionHistoryPanel (WF-10), CanvasGroupNode (WF-15), StageKindPalette (WF-16, also holds stage templates), ExitRuleTable/CarryTable (WF-18), IterationsTable (WF-19, column-driven; the run page's loop table binds it). New kit: L-04 `CanvasEditor`, L-02 `Wizard`, C-17 `Stepper`; Inspector gains an `eyebrow` row. Run-page pieces live in `features/workflows/run` (StageRow WF-04, BudgetMeter WF-06, DecisionCard WF-08, ReviewCard WF-09); chat run/approval/draft cards (WF-12…14) are `features/workflows/chat/WorkflowRunCards.tsx` via the segment-card registry and the Tasks section. WF-05 RunLifecycleCard is not built (no lifecycle data, D-36).
- **New workflow:** `/workflows/new` is the New workflow page; every start point creates a draft on the server and opens `/workflows/:id/edit`. The builder edits saved definitions only (the unsaved "new" mode is gone).
- **Detail page:** a stages table replaces the read-only DAG canvas; the plan preview refreshes as the dialog is edited (waits for required variables). Not shown for lack of API data: published version number and Needs you/Running/Failed filter on the list, Automation column, median cost, "Duplicate as draft".
- **Builder:** Publish and Run are disabled while there are errors; Save validates first (problems banner copy follows). Hooks tab only for agent stages (only they carry `hooks`). Version history has no author (no API field). Insert variable appends. A plain success edge shows its pill on hover/selection. `RISK_LABELS`/`DANGER` moved to `@generatorai/shared/ui-contract` (`workflowRisk.ts`); icon concepts added: repeat, hourglass, layout, group, ungroup, braces, wand.
- **Run page:** T-04 + the redesign dock (D-27); pinned dock tabs Inspector · Changes · Files · Terminal · Browser, Usage and Widget from "+". The horizontal pipeline strip is dropped (the stage table covers it); the graph moved to the header's More menu. No Agent column, review round or run number/version/clock on the chat card (no data). No success toasts — the stage composer reports inline. Run status badge `run-status-badge` uses the status map label ("Succeeded").
- **Automations / Scripts:** list T-01, detail T-02 with client-computed stats and IterationsTable, create on L-02 Wizard (4 steps, TanStack Form + zod); automation triggers (`manual|schedule|webhook`) use a feature-local `AutomationTriggerBadge` because WF-20's `RUN_TRIGGERS` is run provenance. Input modes use the real API labels (Single run / Each row / Grouped rows / Whole dataset). No automation edit UI, draft state or script load-error row (no API). Scripts is one T-05 MasterDetail page for `/scripts` and `/scripts/:id`.
- **Selectors:** renames are listed per port in COORDINATION.md and applied to the specs in the same commits.

### D-83 Shared mobile state on web and desktop (final review 2, 2026-10-03) — Final
The mobile merges added server state every client sees. Web and desktop follow it (MD-6: parity both ways); the boards predate it, so the plan was silent:
- **Pin / read (MG-02, MD-112):** `GET /chats` lists pinned chats first for every client, so a chat pinned on the phone moved to the top of the desktop list unexplained. The chats table (ChatsList, ProjectDetail Chats tab) shows a pin glyph ("Pinned") and an accent unread dot ("Unread", title semibold) after the title; the ChatsList row menu gains Pin/Unpin and Mark as read/unread. An open chat sets its read mark on open and on leaving (`useMarkChatRead`), as the phone does on focus, so reading on the desktop clears the phone's dot. `StatusDot` gains an `accent` tone.
- **Gate risk (MG-04/05, MD-31):** web and desktop show the server's "Risky" badge — on the gate card (live, after a reload, and on settled cards) and on Home's Needs-you row — and keep answering with a click; only a phone signs.
- **Scope vocabulary (MG-23):** Settings › Security reads `scopeLabel`, `describeScope`, `isSensitiveScope` and the companion/standalone preset scopes from `@generatorai/shared/ui-contract`; every sensitive grant (each `exec:*` but `exec:agent`, each `admin:*`) is confirmed. The board-drawn presets without a server constant (Recommended, Read only, Full workstation) stay on web.
- **Not adopted on web:** the dictation language (MG-17: the only engine reports no forcible languages, so there is nothing to pick — D-36), the shared `deepLinkToRoute` (desktop keeps its own parser: its pairing target is `/?pair=`, the shared one targets mobile's `/pair`).

### D-84 Mount worktrees in the `worktrees` table (final review 2 #21b, 2026-10-03) — Final
Chats and runs work in mounts (`workspace_mounts`); the `worktrees` table, which a codebase's worktree list (G-17), the project counts and the retention sweep read, was only written by the pre-mount `WorktreeService.createWorktree`, which nothing calls any more. So no chat or run worktree ever appeared there.
- `MountService` records every ready **worktree mount of a project codebase** under the **mount's id** (shared key, no migration): chat → `runType: 'manual'`, `runId` = chat id; run → `'workflow'`, `runId` = run id (a map item workspace `<runId>~<instance>-<index>` belongs to its run). In-place and folder mounts get no row: they are the user's own directory, not a worktree.
- One lifecycle: removing the mount, releasing it (archived chat) and deleting its workspace drop the row; removing the row (Remove, Clean up orphans, the retention sweep) releases the mount through `MountService.releaseWorktree` — directory and git registration go, the branch stays, the mount is marked `removed`.
- A person cannot remove an **active** worktree (409; web and mobile hide Remove for it). The retention clock runs from when the worktree stopped being live (`cleanedUpAt` is now set on `orphaned` too, cleared on `active`), and a restored chat's orphaned worktree returns to `active`.
- Pre-existing chats are not back-filled (no backward compatibility).

### D-85 React Compiler 1.0 on web and desktop (P8-02, 2026-10-03) — Final
- **How:** the stable Babel compiler (`babel-plugin-react-compiler` 1.0 through `@rolldown/plugin-babel` and `@vitejs/plugin-react`'s `reactCompilerPreset`), not plugin-react 6's experimental native `compiler` option. It runs wherever the client is built: `vite.config.ts` (dev, production, Storybook) and the web `unit` Vitest project, so unit tests render the compiled components. Desktop renders the web build, so it is covered too. Default `compilationMode: 'infer'`, target React 19.
- **Opt-outs:** `'use no memo'` in the two `useVirtualizer` components (`blocks/transcript/TranscriptView`, `ui/patterns/DataTable`) — TanStack Virtual returns a mutable instance the compiler cannot track (the compiler already skipped DataTable as an incompatible library; the directive makes both explicit). No module is excluded from the compiler.
- **What it skips:** at enablement it left 144 functions as written (refs read during render, `try … finally`, value blocks inside `try`, hooks with a disabled `react-hooks` lint rule, update expressions on captured variables, existing memoisation it could not preserve). Skipping is the safe failure mode; these are candidates for later clean-up, not defects.
- **Measured** (production build, 24-stage workflow, render counts from a commit hook, 3 runs each, stable): builder pan 3,982 → 199 component renders, node drag (40 steps) 5,211 → 1,066, zoom 3,069 → 536, selecting 5 nodes 1,576 → 1,085; run graph open 1,074 → 758, run graph pan 900 → 409. Script time for pan 63–70 → 20 ms, drag ~103 → ~64 ms.
- **Cost:** web build ~3 s → ~21 s (Babel pass), initial-load gzip 458.7 → 498.3 KB (budget 800).

### D-86 Design validation as built (2026-10-03) — Final
- **Key hints follow the host.** A hard-coded chord is never drawn: global commands show `shortcutFor(id)` (D-24
  bindings), page-local Mod chords show `modChord(key)` (`lib/shortcuts.ts`: ⌘ on macOS, Ctrl elsewhere), and every
  advertised chord has a handler.
- **Worker chats are internal.** Every count that sits beside a chat list (project Chats tab, Home This week) counts
  top-level chats only, as the lists do; the server's orchestrator re-prompt (`[system] …`) renders as a system note.
- **A failed turn is part of the transcript.** The server records a turn with a provider error (streamed text +
  `systemMessages`), and replay renders persisted "Error: …" notes as the live error block.
- **Gate inputs are shown as what they name** (the command / path), never the JSON wrapper, on the gate card and on
  Home; tool-permission decisions are persisted as `permissionCards`.
- **Builder Save is disabled while validation has errors**, matching the problems panel (D-82's "Save validates first"
  now shows up front instead of after a click).
- **Disabled workflow scripts are explained**, not shown as "none found": `GET /api/workflow-scripts/status`.
- **Shared layout hooks** used by several features live in `lib/` (`useNarrow`); `DataTable` gains `alwaysShowActions`
  for short tables whose row actions are the point (ProjectDetail codebases).

### D-87 One definition of "running" (desktop orchestrator test, 2026-10-03) — Final
- **Running** = what a person started and is executing now: top-level chats with an active turn, live workflow runs
  and automation executions — the attention feed's Running list. A chat with an ask is under Needs you only.
- **Worker chats roll up** (extends D-86): a working worker is not an item of its own; its orchestrator is listed
  under Running ("2 background tasks running", opened on the Tasks dock, Stop only while the orchestrator's own turn
  runs). A worker that asks is still listed under Needs you.
- **One count:** the Home headline, the Running list, the System card's "Agents · N running" and Settings ›
  Diagnostics all read the feed's `counts.running`. `SystemInfo.agents` keeps only `max`; `/health`'s
  `activeChats` stays a technical in-flight count for diagnostics.
- **A worker in `needs_review` is "In review"** (status `waiting`, board DockTasks): it finished and its orchestrator
  is reading the result. It was mapped to `needs_you` "Needs review" (the hand glyph), which told the person to act
  when nothing waited on them.

### D-88 Transcript rendering budget (desktop orchestrator test, 2026-10-03) — Final
Profiled in the production build (Electron, CDP CPU profiles + Long Animation Frames) on a scripted ~4,000-word,
12-step answer (`agent-tests/perf/fixtures/orchestrator-report.mjs`, Faux `text.delayMs`):
- **Blocks, not the whole answer.** Streamdown keeps a whole document as one block when it sees `[^label]` — and it
  looked inside code, so any regex class like `[^a-z0-9]` re-parsed the full answer every frame. `ui/patterns/Markdown/
  markdownBlocks.ts` masks fenced and inline code before splitting; only real footnotes / link reference definitions
  keep a document whole. After a stream ends the blocks stay (no second whole-document parse).
- **Highlighting off the main thread.** Shiki runs in a module worker (`highlight.worker.ts`, in-thread fallback), with
  a result cache so a remounted code block paints at once.
- **Deferred, interruptible renders:** the transcript's turns at boundaries (the live
  turn stays on screen until its persisted message has rendered) and the view mode use `useDeferredValue`; Summary
  renders through the same `TurnBody`, so a mode switch re-renders the answer instead of remounting it; the digest is
  counted from the derived segments. (A deferred streaming-markdown source was dropped in D-91.)
- **Fences:** `agent-tests/perf/transcript-stream.spec.ts` (reporting, generous limits) and the `markdownBlocks` unit test.

### D-89 Task detail: brief, review rounds, last steps (2026-10-04) — Final
Closes the DockTasks/ChatTasks detail gap (D-36 kept it hidden). `GET /chats/:id/background-tasks/:taskId/detail`
(`BackgroundTaskDetail`, OpenAPI) reads the worker chat's persisted messages — durable across restarts, unlike the
in-memory task record: the **brief** is the first user message (sections Objective / Context / Out of scope parsed
from `renderBriefMessage`); **review rounds** are the later user messages (the orchestrator's follow-ups), so
`reviewRounds` no longer reads 0 after a restart; **last steps** are the latest ≤ 8 tool calls (args clipped to
2 KB, file-op stats without hunks); `outcome` is accepted / in_review / reworking / running / failed / cancelled.
client-core `chats.backgroundTaskDetail`, `queryKeys.chatTaskDetail`, `taskDetailSteps` (the transcript's own
timeline steps) and `taskReviewLine`; web renders Review · Brief · Last steps · Result in the Tasks dock detail (board
order), mobile the same in its task detail. The board's per-round outcome text and "See in Changes" for a step are not
drawn (no per-round verdict is recorded).

### D-90 Provider-neutral composer and empty chat (owner, 2026-10-03) — Final
Overrides the ComposerStates/Main boards' "Message Claude Sonnet 5…" (owner: the box said "Message Copilot…", which
read as if the chat were that product). `composerPromptPlaceholder` (ui-contract, web + mobile): "Reply to <agent>…"
for a bound agent, "Reply to the orchestrator…" in orchestrate mode, else "Ask anything — @ for files, / for skills"
(or "Ask anything — / for skills" without a workspace). The empty chat reads "Type a message below to start." Mobile's
composer accessible name drops the model ("Message", or "Message <agent>"); web keeps its textbox name and testids.

### D-91 Paced streaming and spring follow-scroll (owner, 2026-10-04) — Final
Measured before/after in the desktop app (real Sonnet 5.5 and GPT-5.6-Sol answers, a worker chat, a workflow stage)
and web, at 1440×900 and 1100×760 (`reviews/desktop-orchestrator-test.md`, addendum). Approach after StackBlitz's
`use-stick-to-bottom` (velocity spring + ResizeObserver, user-intent detection) and the AI SDK's `smoothStream`
(word-granular smoothing):
- **Paced reveal** — `client-core` `advancePacer` (web `blocks/transcript` `usePacedText`, mobile `AssistantText`):
  text that arrived is revealed per animation frame at `max(90 chars/s, rate held per burst, backlog / 0.9 s)`, ending
  on a word; it never holds text back: everything shows at once when the page is hidden, the reader scrolled away
  (`pacing: false`) or the view mode changes; after the turn ends the rest catches up within 250 ms; reduced motion
  reveals bursts in 250 ms steps. It lives in `AssistantText`, so every panel that streams an answer (chat, worker
  chats, workflow stages, task detail) uses it.
- **Reveal fade** — the newest words settle in over ~180 ms through three CSS Custom Highlights (`useRevealFade`,
  `::highlight(gai-reveal-*)`): colour only, no element, no layout; off under reduced motion.
- **Spring follow** — `useStickToBottom` follows with `v = (0.7·v + 0.05·gap) / 1.25` per 60 Hz frame from a
  ResizeObserver, one layout read per frame; only a scroll UP by the reader unpins (a clamp from shrinking content
  does not); a reader at the end when content grows starts following; "Jump to latest" rides the same spring. The
  workflow run page follows its stage output the same way once the reader is at the end.
- **Steady tail** — no spinner row under an answer that is itself streaming (its caret shows the activity); the
  streaming markdown is not rendered from a deferred value (that skipped frames and committed bursts — D-88's other
  deferrals stay). The caret is the last element's `::after` (`[data-gai-caret]`), not an element that travels with
  the text, so its motion is not a layout shift.
- **Nothing below the output inside the scroller** — the workflow run's focused-stage composer is pinned under the
  stages (Workspace `bottom`, the chat composer's frame via Composer `docked`, "To stage <name>"), like the chat's;
  the run footer's "Show event timeline" went (the header's More menu keeps it).

### D-92 Activity column as built (Enhancements boards, 2026-10-04) — Final
Boards EnhActivityColumn, EnhSidebarHidden, EnhRailQuickAccess, EnhActivityCards, EnhActivityPopovers. Analysis and
evidence: `reviews/activity-column.md`, `shots/activity/DIFF.md`.
- **Data, no polling.** Live cards = the attention feed (G-01, SSE). Failed + Recent = G-11 `?since=<local midnight>`
  (limit 100), refetched when the feed loses an item plus one follow-up 1.5 s later (a finished turn's list row lands a
  moment after the feed drops the chat). A popover reads the entity's existing endpoints only while open and refetches
  when its card changes (`useWorkflowRun` / `useBackgroundTasks` gain `poll: false`). Items carry `meta` (agent, model,
  an orchestrator's worker tally kept current by `chat.background_task.*`, an automation's trigger) and recent chats
  `unread` — additive, OpenAPI `ActivityMeta` / `RecentActivityItem`.
- **Shared rules** (`client-core` `activity/`, vocabulary in `shared/ui-contract/activity.ts`, for mobile too): one card
  per entity (asks grouped, oldest first; a worker's ask is shown on its orchestrator, which then is not also Running);
  a live entity is never also listed as finished; order **Needs you → Failed → Running → Recent** (the drawing — the
  board's comment said Running before Failed; actionable first wins); the header badges and kind-tab counts count
  cards, before the kind filter; a failure stays until dismissed or the entity runs again, and a dismissal names that
  failure (`key@endedAt`, per device — there is no per-user server store, and the run itself stays failed in its list).
- **Not drawn (D-36):** the server filter and the per-card server name (the feed is the connected server's; other
  origins are unreachable from the page — the slot shows the project instead); the dimmed "server offline" state;
  "Run #248" (no run numbers, D-82); "Mute updates" (no such setting); a chat popover's recent tool steps and context
  gauge; "Switch model" on a failed chat.
- **Geometry.** 288 wide, resizable 248–400 from its right edge (pointer, ←/→ 16 px, Home/End, double-click resets),
  persisted. It docks only at ≥ 1200 px **and** while the main card keeps 720 px (`SHELL.activityColumn`); otherwise it
  opens as an overlay over the card (`data-gai-overlay="sheet"`, closes on Esc, an outside press or opening a card).
  Dragging never undocks it (clamped to the room left). While it is open the sidebar's Needs you / Running move into it.
- **Rail quick access.** When the column is not docked the rail shows live cards as status-tinted kind tiles (amber
  needs you, red failed, blue running) filling only the space the rail has left, then "+N" (opens the column). They
  replace the rail's running counter (`rail-running` / `RailCounterButton` removed). A tile's hover / focus / click
  opens the same popover.
- **Keyboard and screen readers.** `activity.toggle` (web `Mod+.`, ⌘. / Ctrl+.) in the registry, palette and View
  menu; the toggle sits in the sidebar header and the rail. Opening by toggle or command focuses the open page's card;
  one card is in the tab order (roving), ↑/↓/Home/End move, Enter opens, → enters the popover (← or Esc returns to the
  card without reopening it), Esc then closes the column and focus returns to the toggle. The popover also opens on
  keyboard focus (300 ms, like hover). A card is one link named "Kind: Title", described by its status, meta and time;
  the scroller is not a tab stop.
- **Contrast.** On the amber / red tints the card's secondary text is fg-2 / fg (fg-3 fails 4.5:1 there; fg-2 on
  err-bg is 4.49:1 in Solarized light). Kind tabs use `SegmentedControl distribute="content"` so "All 12" never
  truncates beside icon-only tabs.
- **Inline actions** use the existing endpoints (`useAttentionAction` gains `deny`, `reject` and automation stop):
  Allow once / Deny (chat tool gates), Approve / Reject (plans, stage approvals), Stop / Cancel run / Stop all, Retry
  (G-11), Dismiss, Open; a card's context menu adds Pin / Unpin (chats) and Copy link. A computer-consent ask, a
  question and a stage input are opened, never answered inline (as on Home).

### D-93 Back / Forward on desktop (owner, 2026-10-04) — Final
"On the desktop app the user cannot go back": the strip (Windows, Linux custom title bar) and the Linux native sidebar
row had buttons, macOS and every rail had none, and nothing handled mouse buttons.
- **Buttons** (desktop only; a browser tab has its own, so the web draws none): macOS — at the end of the 44 px
  traffic-light row (drag region, buttons no-drag) and, with the sidebar collapsed, in the rail under Expand; Windows /
  Linux custom title bar — the strip (unchanged, visible in both sidebar modes); Linux native frame — the sidebar's
  top row and the rail. Disabled from Chromium's session history (main pushes `canGoBack/canGoForward`); tooltips name
  the host chord.
- **Keys.** `nav.back` / `nav.forward` become renderer commands (the palette lists them; web binding stays null).
  macOS ⌘[ / ⌘] stay menu accelerators (no surface uses them). Windows / Linux Alt+← / Alt+→ are shown in the View
  menu but not registered (`registerAccelerator: false`): the renderer handles them, so a key-owning surface
  (`data-gai-keys="own"`, the terminal's word-back) keeps them; they fire in text fields, as in Chrome.
- **Mouse and gestures.** Windows / Linux: `app-command` `browser-backward` / `browser-forward` (mouse buttons 4/5 and
  keyboard Browser keys) in main. macOS: mouse buttons 4/5 reach the page and are handled in the renderer; the trackpad
  `swipe` event in main (only when "Swipe between pages" is set to two/three fingers). All of them step the same
  session history as the menu (`navigateHistory`). Known limit: `app-command` with the pointer over the dock's native
  browser view moves the app, not that view.

### D-94 Attention feed corrections from the desktop activity test (2026-10-04) — Final
Found while driving real chats, an orchestrator, workflow runs and automations in the Electron app:
- **Approval waits wait on a person.** An approval `wait` stage parks as `waiting` with `{kind:'wait',type:'approval'}`;
  the feed listed its run as Running "Waiting" and Home never showed it. It is now a Needs you `stage_approval`
  (Approve / Reject through the run's `approve` command).
- **Stage position.** Instances created together were ordered alphabetically by path ("Stage 2 of 6" for the 4th
  stage); creation time, then graph order, decides. Stage asks carry `progress {step, of}` (card meta and stage bar).
- **An automation's run rolls up into its execution** (one Running item, one count, like workers into their
  orchestrator — D-87); its asks are still listed. G-11 does the same for finished runs, and a failed run or execution
  without an error names its failed stage and why ("Typecheck: pnpm typecheck exited 2"). Run titles drop the minted
  "- Run <epoch>" suffix in G-11 as they already did in the feed. Live automation executions are `stoppable` (the cancel
  endpoint exists).

### D-95 Create flows from the desktop end-to-end build test (2026-10-04) — Final
Found while building a full-stack app through the desktop app (`reviews/desktop-e2e-build.md`).
- **The chosen agent's model and effort fill the form.** The session's own model outranks the agent's at run time
  (AgentResolver: most specific wins), and both create flows always sent their default model — an Opus/High agent ran
  on the default Sonnet/Medium while the dialog showed nothing wrong. Picking an agent now sets Model and Effort to its
  runtime values (when it has them); the person can still change them before starting.
- **Plan first.** Neither create flow could start in plan mode: the first message always ran in `auto`, so "plan the
  architecture, then I review" was impossible from the start. Options (dialog) and the Agent section (page) gain
  "Plan first": the first message is sent with the per-turn `mode: 'plan'` (the chat's `defaultAgentMode` is not
  changed, so later messages use the composer's mode). Not on the boards; a switch in the existing options block.
- **One effort vocabulary.** "Low · Medium · High · Extra high · Max · Ultra" everywhere (`reasoningEffortLabel` in
  `ui-contract/composer.ts`); the dialog showed "xhigh" / "max" and the composer "Xhigh".

### D-96 Chat approvals in the composer (2026-10-04) — Final
No surface let a chat ask before tools run: chats are created in `bypassPermissions` and the client's
`setChatPermissionMode` had no caller (legacy had none either), so permission gates were reachable only through the
API. The composer's Agent mode menu gains an **Approvals** group — Ask before tools run · Accept edits, ask for the
rest · Full access (never ask) — for root chats (workers follow their orchestrator). It applies from the next message
(the turn pins its mode; the session rebinds on the new key). The chip names a gated policy after the mode
("Auto · Ask first"); full access shows nothing extra. Labels are shared with the run header's W-65 control
(`APPROVAL_MODE_LABELS` in `ui-contract/composer.ts`). Turning approvals off still needs `admin:settings` (server).

### D-97 Orchestrations may run dependent waves (2026-10-04) — Final
Found building an app through an orchestrator (`reviews/desktop-e2e-build.md`): after the foundation worker (WP1)
finished, every further `spawn_background_agent` was refused with "Convergence threshold met (1/1 workers in wave 1
converged)", so the packages that depend on WP1 could never start; the orchestrator asked the user whether to do the
work itself. Cause: the worker prompt told every finished worker to report `converged: true`, and the guard's default
threshold of 1.0 read that as "stop the whole orchestration".
- **Convergence is opt-in.** `convergenceThreshold` defaults to 0 (off); `GENERATORAI_ORCH_CONVERGENCE_THRESHOLD`
  turns it on for iterative "until nothing new" loops. The worker prompt says to report `converged` only when its
  brief asks for it — finishing is `status: "completed"`, not convergence.
- **Time budget 120 min** per request (was 30): a multi-wave build (foundation → parallel packages → reviews → docs)
  ran past 30 min and later spawns were refused. `maxWaves` (10) and the time budget stay the runaway guards.

### D-98 Who decides a worker's model (2026-10-04) — Final
Found in the same build: the person bound Frontend Dev to GPT-5.6-Terra ("it runs on Codex") and Reviewer to
GPT-5.6-Luna, yet every worker ran on Sonnet — the orchestrator prompt said to pass `model` on every spawn, the
spawn's model outranked the agent's, and `list_available_agents` never said an agent had a model. The Tech Lead's own
"Max concurrent workers" and "Default worker model" were saved by the agent editor and read by nothing.
- A worker bound to an agent that sets a model **runs on that model**; a different `model` on the spawn is ignored
  and the spawn result says so (`note`). `list_available_agents` returns `model` for such agents, and the ROUTE step
  tells the orchestrator to omit `model` for them and to route the rest by cost as before.
- Unbound (or model-less) workers: the spawn's `model`, else the orchestrator agent's **Default worker model**, else
  `GENERATORAI_ORCH_DEFAULT_WORKER_MODEL`, else the medium-tier heuristic.
- The orchestrator agent's **Max concurrent workers** caps running workers (else `GENERATORAI_ORCH_MAX_WORKERS`).

### D-99 A failing check fails its stage by default (2026-10-05) — Final
Found with a nightly automation (Install → `npm test`): both checks exited 127 (`vitest: command not found`), each
completed with `passed: false` (the schema default `failOnNonZero: false`), the run "completed" and the automation
listed the execution as Succeeded. The builder's **new** check stage now has "Fail the stage on a non-zero exit" on; a
check wrapped into a **loop** gets it turned off, since the loop's exit rules read `passed` (test-until-green). The
schema default stays `false` (existing definitions and the bundled templates are unchanged; they set it explicitly
where it matters).

### D-100 Orchestrator workers across a restart: interrupted, then Resume (2026-10-06) — Final
A worker's turn is fire-and-forget in the server process; a quit or restart killed it and the worker was shown
"Failed — Interrupted by a server restart" with no way on. Its chat, transcript and provider session are durable, so:
- On the first list after a restart a worker the DB still calls running/spawned becomes **`interrupted`** (a new
  `BackgroundTaskStatus`; status map `paused "Interrupted"`; counts with failed in the dock and Attention).
- **Resume** (Tasks dock row and task detail; `POST /chats/:id/background-tasks/:taskId/resume`) re-attaches it and
  prompts it with a restart note and its brief repeated (a provider that lost its session starts from that message),
  told to check the files first and finish, not restart. It rejoins its wave (no new wave counted); when it settles,
  the wave-complete nudge wakes the orchestrator to collect the result.
- The orchestrator's `send_to_background_agent` on an interrupted worker resumes it with the follow-up.
- Not automatic on boot: resuming spends provider tokens, so a person (or the orchestrator, when asked to continue)
  decides.

### D-101 Codex sandbox commands may use the network (2026-10-06) — Final
In the build the Reviewer (Codex GPT-5.6-Luna, Write files off) could not run the server's supertest suite: Codex's
`workspace-write` sandbox denies every socket by default, so `listen()` on localhost failed with EPERM and reviews fell
back to typecheck. Codex has no loopback-only setting (`networkAccess` is a boolean), and Claude / Copilot shell
commands already run with the network, so the Codex sandbox now allows it by default (thread config
`sandbox_workspace_write.network_access` and every turn's `sandboxPolicy.networkAccess`; `harness.codex.networkAccess:
false` turns it off). Write access is unchanged: what may be written is still the sandbox's roots and the bound
agent's `fileWrite` group, enforced at the permission gate.

### D-102 "Ask before tools run" asks for the browser and widget tools too (2026-10-06) — Final
D-96's Approvals menu made a chat ask before shell and file tools, but the platform's own tools ran unasked: providers
pre-approve host tools (Claude lists them in `allowedTools`, Codex runs dynamic tools client-side). In a turn whose
mode is `default` ("Ask before tools run") or `acceptEdits` ("Accept edits, ask for the rest") the integrated
browser's and widget tools now ask through the session's permission gate first (`askBeforeRunning`, bound by the
session composer, the bound agent's tool groups applied first); denied, the tool fails with the reason. The wrapped
tools set `skipPermission`, so a provider that would prompt natively (Copilot) asks once. Full access, plan turns and
unattended runs are unchanged. Computer-use tools keep their own consent flow.

### D-103 An automation picks its codebases and their branches (2026-10-06) — Final
In the build the nightly automation could only run the workflow's lifecycle codebases on their default branches
(the Run dialog could pick a branch, an automation could not). An automation now stores `codebases: [{ alias,
baseRef? }]` (migration v66): its runs mount exactly those project codebases, each cut from `baseRef` (omitted: the
default branch), always as worktrees — an unattended run never edits a checkout in place (that needs
`admin:settings`). None stored: the workflow's own codebases, as before. Codebases need a project scope (create and
update refuse otherwise; aliases are unique). The wizard's Workflow step lists the project's codebases with the Run
dialog's row (`blocks/workflow/CodebaseMountRow`, branch suggestions from the codebase, no checkout-mode control); the
detail page shows "alias @ branch".

### D-104 Wrapping in a loop rewrites the references to the wrapped stages (2026-10-06) — Final
Outside a loop's body a body stage's output is read through the loop: `stages.<loop>.output.last.<key>` is what
`stages.<key>.output` was (the validator's scope rule). "Wrap in loop" used to leave every `{{ stages.test.output.passed }}` and edge `when` elsewhere in the
graph pointing at the old path, so the workflow failed validation until each was fixed by hand. Wrapping now
rewrites, in every string of the stages and edges outside the body, `stages.<key>.output` →
`stages.<loop>.output.last.<key>` for each wrapped key (other fields such as `.status` have no equivalent and are left
to the validator), and moves a context source on a wrapped stage to the loop (as its edges move); unwrapping does
the reverse (references through the loop become direct, the loop as a context source becomes the body's leaves).
Map containers are not rewritten: a map body's outputs are a list (`stages.<map>.output.results`), with no
single-value equivalent. The rewrite lives in `@generatorai/workflow-spec` (`qualifyBodyRefs` / `unqualifyBodyRefs`).

### D-105 An agent's browser call opens its own tab when the Browser dock is closed (2026-10-06) — Final
In the desktop app the agent's browser drives the scoped CDP endpoint of the workspace's active Browser tab, which
only exists once the person opens a Browser dock tab; with the dock closed `open_browser_page` waited 10 s and failed
("waiting for a scoped CDP endpoint … Ensure the desktop app has an active browser tab"). Now the server asks the
desktop main process over the existing server IPC channel (`browser.ensure-tab`) and main creates an **agent tab**
(`agent-<workspaceId>`) in a never-shown window of its own (`show: false`, `paintWhenInitiallyHidden`), shown there at
1280×800 — a view hidden in, or placed outside, the app window renders at 0×0, so pages had no layout and screenshots
failed — makes it active and pushes its endpoint; the call proceeds. The hidden window closes with its last agent tab
and with the app window. When the person later opens a Browser tab for that workspace and it becomes
active, it takes over the agent tab's page (navigates to its URL when blank) and the agent tab is destroyed, so agent
and person keep looking at one page. A workspace that already has a tab is used as it is.

### D-106 Only risky shell commands are "Risky" (2026-10-06) — Final
`classifyPermissionRisk` (MG-04) marked every shell gate risky, so `ls` and `npm test` carried the same "Risky" badge
as `git push` and a phone had to sign them. A shell gate is now risky only when its command uses the network (curl,
ssh, git fetch/pull/clone…), downloads or publishes packages (npm install, npx, pip install…), pushes to a git
remote, deletes or overwrites data (rm -r/-f, git reset --hard, git clean -f, a force push, dd, kill…), needs elevated
rights (sudo, chown, chmod -R), pipes into a shell or evals, or writes outside the workspace (a redirect or a writing
command targeting `..`, `~` or an absolute path other than `/dev/null`) — or when its command cannot be read. The
command is read out of the server's input summary (raw, or the `command` / `cmd` field of the input as JSON, also when
cut off). Network gates and file writes that leave the workspace stay risky. The verdict is still stamped once on
the server and copied to the attention ask and the push, and mobile computes it with the same shared function, so a
truly risky gate still needs a signed answer.

### D-107 A permission gate says what it will do (2026-10-06) — Final
Every tool-permission card read "Allow this command?" with the raw permission type (`other`) in its corner, and the
Needs you list said "Allow open_browser_page?". The shared `permissionWording(toolName, type)` (ui-contract, built on
the tool-verb registry) gives a title and a kind label: "Run this command?" · Shell command; "Create / Change this
file?" · File change; "Read this file?"; "Fetch this page?" / "Search the web?" · Network; the browser tools by action
("Open a page in the browser?", "Take a screenshot of the page?") · Browser; "Show a widget?" · Widget; an MCP
connector's tool as "Allow github: Create issue?" · MCP · github (the platform's own in-process server is not a
connector); else "Allow <tool in words>?" · Tool. The server stamps `title` / `kindLabel` on the gate payload (so the
attention ask, the push and mobile read the same words); client-core carries them on the permission block, worded
locally for older gates; the web card and the Activity band show them, and an Activity status line reads
"Run <command>?". `PERMISSION_GATE_COPY.title` stays only as a fallback.

### D-108 A project's only codebase is included in a new chat by default (2026-10-06) — Final
In the build every chat started in a one-codebase project ran in an empty managed workspace until the person ticked
the codebase (New chat dialog and page). When a project is picked and its codebases load, the only codebase is now
included (once per project, so unticking it sticks; never with two or more codebases, never on top of sources
already chosen). The Run dialog keeps its rule — it pre-selects the workflow's `lifecycle.codebaseAliases`, and none
when the workflow names none — because the workflow author decides what a run mounts.

### D-109 One motion system for expand / collapse and show / hide (owner, 2026-10-06) — Final
Supersedes D-20's "the design has no motion" (the reduced-motion half stands). The owner found every expand/collapse
(the changes tray, step rows, tool output) and every panel show/hide (dock, sidebar, Activity) jittery. Evidence and
inventory: `reviews/motion.md`. (The three `redesign(motion)` commits 26ec3054 · 2fcd5320 · f5dfcd2d say D-108 — that
number was taken concurrently; this is the decision they implement.)
- **Tokens.** `--gai-ease-in-out` `cubic-bezier(0.4, 0, 0.2, 1)` joins `--gai-ease-standard`; the durations become
  design utilities `duration-fast` 120 · `duration-normal` 180 · `duration-slow` 220 and `ease-in-out` (vocabulary,
  tailwind-merge groups). Hover / press keeps `transition-control` (≤ 120 ms, ease-standard).
- **One mechanism.** Base UI's enter / exit states (`data-starting-style` / `data-ending-style`, unmount after the
  exit transition) and its measured Collapsible size, through hand-written utilities in globals.css: `motion-collapse`
  / `motion-accordion` (height + fade, 180 ms), `motion-reveal-x` (a docked side panel's width), `motion-slide-start`
  (a floating side panel: 12 px + fade), `motion-pop` (popups: 97 % scale + fade from `--transform-origin`, 120 ms, none
  between tooltips), `motion-dialog`, `motion-fade` (backdrops), `motion-sheet-start/-end` (220 ms), `motion-size`
  (sidebar ↔ rail width, the sheet gutter), `motion-dock`, `motion-split` (flex-grow).
- **Kit.** `Collapsible` / `Accordion` panels animate; `CollapsiblePanel` is the styled panel inside a caller's root
  (StepRail); `Reveal open motion="height|width|slide-start" gap?` replaces every `{open && …}` toggle — mounted only
  while open or closing, inert while closing, unmounted once closed. Spacing lives inside the moving panel; in a
  gapped column `gap` moves the gap with the panel (negative margin + padding), so the open is one motion. A panel is
  clipped while it moves (no paint or scroll overflow — a step opening at the bottom of a streaming transcript must not
  grow the scroller before it is visible) and unclipped at rest (`data-settled`, ui/lib/motion `settleOnOpen`), so
  focus rings and hit slop show.
- **Panels.** AppFrame owns the shell motion: the sidebar slot eases its width (the card flexes), Activity opens from
  0 to its width when docked (the column keeps its width, so cards never reflow) and slides in as the overlay, the
  flyout slides in. SplitPane eases collapse / re-open but never a separator drag (`:has([data-separator=active])`)
  or the first layout; the dock surface keeps `visibility` until its close has finished and slides as the narrow sheet;
  a dock tab fades in (the one left hides at once). Resizing the Activity column never animates (the panel's width is
  `auto` at rest).
- **Streaming.** A height panel is `auto` once open, so a step opened while its turn streams keeps growing; the
  follow-scroll spring (D-91) tracks the panel frame by frame (measured: ≤ 7 px per frame, no jump).
- **Reduced motion.** The setting or the OS: durations are 0 and the global rule cuts transitions to 0.01 ms — every
  change lands at once, Base UI still unmounts on transitionend. `useStickToBottom` reads the setting too.
- **Not animated (by design):** rows of the virtualized diff list (fixed row heights), the Changes "Kept" group (a
  flex share of the diff panel), the variables table's edit row (a CSS-grid row group), the version list's "older"
  rows (list items), the composer's `/` and `@` menu (typeahead stays instant), toasts (sonner animates them).

### D-110 Built-in HTTPS for Network exposure: a per-install local CA and a leaf for this machine (owner, 2026-10-07) — Final
A browser on another device opened `http://<lan-ip>:<port>`, which is not a secure context, so `crypto.subtle` was
missing and pairing failed ("WebCrypto is unavailable"); the native app's LAN traffic was unencrypted. Pairing is not
weakened (no non-DPoP fallback). Evidence: `reviews/lan-https.md`.
- **Certificates.** On first need the server generates a **local CA** (ECDSA P-256, 10 years, `pathLen 0`, critical
  Name Constraints: 10/8, 172.16/12, 192.168/16, 127/8, 100.64/10, fc00::/7, ::1, `.local`, `localhost` — a user who
  installs it has not trusted a CA that could vouch for any public name) and a **leaf** it signs (ECDSA P-256,
  397 days, serverAuth, SANs = private IPv4 + unique-local IPv6 addresses on this machine, `<hostname>.local`,
  `localhost`, 127.0.0.1, ::1). Chosen over a bare self-signed leaf so the thing that is pinned or installed (the CA)
  never changes when the leaf is re-issued. Library: `@peculiar/x509` (MIT, already in the lockfile via selfsigned)
  over Node WebCrypto; inspection, key matching and host checks use Node's `X509Certificate`.
- **Storage.** Key material only in the encrypted vault, namespace `system/tls` (`local-ca`, `leaf`, `custom`); never a
  plaintext file.
- **Renewal.** A 60 s timer (and every start) re-issues the leaf when the machine's addresses or hostname change,
  within 30 days of expiry, or when it was not issued by the current CA. The new `SecureContext` applies to the next
  handshake; open connections are untouched. The CA is never re-issued.
- **Only when exposed.** Loopback-only servers do not generate anything (the same machine is a secure context over
  plain HTTP). `GENERATORAI_LAN_TLS=0` opts an exposed server out; a failure to prepare the certificate is logged and
  shown in the posture, and the server still starts.
- **Shown to people.** `GET /api/auth/server-info`, `POST /api/auth/pair`, `/pair/preview` and
  `GET /api/security/network-access` carry `tls` (leaf SHA-256 — what a browser's certificate viewer shows — CA SHA-256,
  names, expiry). Settings › Security & devices and the pairing panel show the `https://` address and the fingerprint
  (first 8 bytes in pairs, full value copied) with "compare this with the certificate warning on the other device".
  The joining device's gate does not show a fingerprint it got from the server: a man in the middle would relay the
  real one. `GET /api/auth/tls/ca.crt` (public) serves the CA for a user who wants the warning gone for good.

### D-111 One port answers HTTPS and plain HTTP; plain HTTP from another device is the native lane only (2026-10-07) — Final
- **Listener.** With exposure on, a TCP listener on `0.0.0.0:<port>` reads the first byte (0x16 = TLS ClientHello)
  and hands the socket — wrapped in a server-side `TLSSocket` or as is — to the one `http.Server`. Every WebSocket
  `upgrade` handler, timeout and `closeAllConnections` applies to both; `req.socket.encrypted` makes `req.secure`
  true. One port keeps the desktop window, local CLI, port identity probe and loop-turn prober on
  `http://127.0.0.1:<port>`, and keeps the remembered port and the firewall rule a user already accepted. A client
  that sends nothing for 10 s, or stalls a handshake for 10 s, is dropped; a refused handshake (a browser that has not
  accepted the certificate yet) is debug noise, not a fault.
- **Transport policy** (`middleware/transportPolicy.ts`, mirrored in the WebSocket upgrade check): HTTPS and this
  machine always pass. Plain HTTP from another device: a page request is redirected 308 to the same path on
  `https://`; a request whose `Origin` is anything but this server's own `http://<host>` gets 403 `HTTPS_REQUIRED`
  naming the https address; `/api/*` with no `Origin`, or with the server's own `http://<host>` (React Native's
  WebSocket default on iOS and Android — no page can carry it, because the page would have been redirected), is the
  native lane (D-112).
- **Scheme-aware checks.** DPoP `htu` is rebuilt from the socket (`https://` over TLS) in the REST middleware, the
  WebSocket upgrade and the pairing/refresh routes (one helper, `network/requestOrigin.ts`); the CORS allowlist is
  consulted per request and holds the `https://` LAN and `<host>.local` origins (re-derived when the addresses change);
  advertised endpoints for browsers are `https://`; HSTS only over HTTPS and never for an IP literal or `localhost`.
  There are no cookies. Stream tickets and signed links are bound to a scope, not a URL, so they need no change; the
  widget-asset origin stays a loopback-only listener (a remote browser cannot reach it before or after this change).

### D-112 The mobile app keeps a plain-HTTP LAN lane until it can pin the certificate (2026-10-07) — Superseded by D-127
Pinning a self-signed certificate in React Native needs native work on both platforms (an `NSURLSession` challenge
handler on iOS and an OkHttp trust manager on Android, for `fetch`, the streaming transport and WebSockets) — more than
a contained change. So, for now:
- a **mobile** (and CLI / MCP / other native) pairing offer lists the plain-HTTP LAN addresses first, as before; web
  and desktop offers list `https://`. Every offer carries `certificateFingerprint` = the local CA's SHA-256 as base64url
  (43 characters, to keep the QR small; absent for a custom certificate), so the app can pin it when MV-44 lands without a new QR format;
- the server answers the native lane (D-111) on the LAN. DPoP is still required on every non-public route, and the
  pairing grant still needs a DPoP proof of the device key. What the lane does not have is confidentiality or
  protection from an active attacker on the LAN during pairing — the risk MV-44 closes;
- a browser can never use the lane: it has no secure context there, and the policy redirects or refuses it.
MV-44 (`mobile/reviews/PENDING.md`) is the pinning work; when it lands, native offers switch to `https://` and the lane
is removed.

### D-113 Bring your own certificate (2026-10-07) — Final
Settings › Security & devices › "Use your own certificate" (`PUT/DELETE /api/security/tls/certificate`,
`admin:settings`) loads a PEM certificate (chain allowed, any order — the one matching the key is moved first) and an
unencrypted PEM key — e.g. `tailscale cert`, mkcert, a company CA. Validated before storing: it matches the key, is
not a CA, is valid now, and names this computer — a LAN address, `<hostname>.local`, `localhost`, an advertised URL's
host, or a DNS name whose first label is this hostname (`<host>.<tailnet>.ts.net`; such names are advertised as
https endpoints). Errors name what the certificate covers and what was expected. Stored in the vault; on a restart it
is re-loaded without the name check (an IP-only certificate whose address moved is the admin's to replace), and an
expired one falls back to the generated certificate with the reason shown. Its expiry is shown; no CA fingerprint is
offered for pinning (it is trusted through its own CA).

### D-114 Forwarded headers are honoured only from a proxy the operator names (2026-10-07) — Final
Three copies of the request-URL logic trusted `X-Forwarded-Proto` from any client, so a request could choose the scheme
its DPoP proof was checked against, and `isHttpsRequest` (HSTS) did the same. `GENERATORAI_TRUST_PROXY` now decides:
unset / `0` → never; `1` / `true` / `loopback` → a proxy on this machine (Tailscale Serve, Caddy, nginx forwarding to
127.0.0.1); a comma-separated list of IPs → exactly those peers. Only then are `X-Forwarded-Proto` and
`X-Forwarded-Host` used for `htu`, the transport policy and HSTS. A forwarded request is never "loopback" for the
unauthenticated-loopback check (unchanged). Set `GENERATORAI_ADVERTISED_URL` to the proxy's public origin so pairing
offers and CORS know it. Documented in the docs site (Guides › Remote access over HTTPS).

### D-115 The route→scope policy matches the canonical path; non-canonical paths are refused (2026-10-09) — Final
Audit F-1: Express 5 routes case-insensitively and tolerates one trailing slash, but the policy compared segments
case-sensitively, so `/api/auth/Devices` ran under the weaker `/auth` entry. The policy (`@generatorai/auth`
`canonicalApiPathSegments`) now lower-cases, decodes only percent-escapes of RFC 3986 unreserved characters (`%64` →
`d`; `%2F` stays encoded and cannot split a segment), drops one trailing slash, and compares segment by segment. A
path with no canonical form — a `.`/`..` segment (literal or escaped), an empty interior segment (`//`) or a malformed
escape — resolves to `DEFAULT_POLICY`, and the `/api` auth middleware refuses it first with 400 `NON_CANONICAL_PATH`.
WebSocket upgrades apply the same check and require the union of the handler's scopes and the policy entry's. Express
case-sensitive/strict routing stays OFF: `express.Router()` instances do not inherit the app setting (every router
would need the option), and with a case-insensitive policy the router and the policy already agree on which entry a
spelling belongs to. Regression: every `ROUTE_POLICIES` entry is checked under mixed case, trailing slash and escaped
letters (`routePolicyCanonical.test.ts`), plus an HTTP test on the real auth router.

### D-116 Revocation, rotation and scope cuts end a device's open streams (2026-10-09) — Final
Audit F-2: a stream is authorised once, so a revoked device kept its SSE stream. `DeviceService.onAccessChanged`
announces `revoked`, `credentials-rotated` and `scopes-changed` (with the removed scopes); the server's
`liveConnections` registry indexes every live SSE stream (single-scope and multiplexed) and WebSocket (terminal,
browser, STT, TTS) by device id. Revocation and rotation close all of the device's streams; a scope change closes only
the streams that rely on a removed scope (`stream:events`, the feed's read scope, `admin:settings` for an unrestricted
`global` feed, the WebSocket's upgrade scope). SSE ends with an `access-ended` frame and a destroyed socket; a
WebSocket closes with 4401. Relay-bridged streams end with their loopback socket, and a revocation drains the relay
revoke outbox immediately instead of on the 30 s sweep.

### D-117 Pairing throttle: per source first, a high server ceiling, this machine exempt (2026-10-09) — Final
Audit F-3: one process-wide bucket (60/min) counted every attempt, so one LAN host spamming `/pair/preview` locked
pairing out for everyone. Now the per-source budget (10/min) is checked first and is the primary limit; the
server-wide ceiling (600/min) counts only attempts a source's own budget admitted, so exhausting it takes ≥60
distinct sources. A genuinely local request (`isLoopbackRequest`: both socket ends loopback, no forwarded headers —
the desktop window completing its admin-token-minted grant, the owner's local browser) has its own budget and is
exempt from the ceiling. The exemption is by source, not by grant: exempting a valid code after looking it up would
let throttled guesses keep being evaluated. Guessing stays bounded by the code (60 bits, single-use, 10 minutes,
5 redemption attempts; preview still burns none). A throttled call answers 429 `THROTTLED` with `Retry-After`,
`retryAfterSeconds`, `limit: 'source' | 'server'` and a message the UI shows as-is ("Too many pairing attempts from
this network address — try again in N s.").

### D-118 A pairing grant's platform is authoritative; the joining device may only refine it (2026-10-09) — Final
Audit F-5: `completePairing` stored the body's `platform` over the grant's, so an MCP grant completed as `cli` escaped
the MCP forbidden scopes (no admin, no terminal) and the person/agent predicate; a `mobile` grant completed as `web`
would also escape the approval-proof requirement. `pairedPlatform(grant, claimed)`: no claim or the same platform →
the grant's; a grant for `mcp` or `mobile` cannot be moved to anything else (400 `PLATFORM_MISMATCH`, audited as
`pairing.failed` / `platform_mismatch`, severity critical); a general-purpose grant (web, desktop, cli, other) may be
refined to another label (honest device list) or into `mobile` / `mcp`. The grant's scopes are re-checked against
the recorded platform before the grant is consumed, and every later scope change checks the device's (now pinned)
platform as before.

### D-119 Every listener refuses a Host that is not one of this server's names (DNS rebinding) (2026-10-09) — Final
There was no `Host` validation: a page on `evil.example` re-pointed at 127.0.0.1 could read `server-info`, drive
`/pair/preview` / `/pair/complete` and open upgrades as a same-origin page (and in unauthenticated-loopback dev mode,
everything). `middleware/hostAllowlist.ts` runs first on the main app and the widget-asset listener, and inside
`authorizeWebSocketUpgrade` for every WebSocket. Allowed: no Host (not a browser), any IP literal (rebinding needs a
DNS name), `localhost`/`*.localhost`, the OS hostname, its first label and `<label>.local`; with Network exposure on
(bind beyond loopback) also any name whose first label is the hostname (`<host>.lan`, `<host>.<tailnet>.ts.net` — the
D-113 rule); the hosts of `GENERATORAI_ADVERTISED_URL(S)`; the served certificate's DNS names (generated or BYO); a
request from a trusted proxy (D-114, it does its own host routing); and `GENERATORAI_ALLOWED_HOSTS` (comma list,
`.suffix`, `*` = off). Anything else: 421 `HOST_NOT_ALLOWED` with a message naming the variable (WS: `421 Misdirected
Request`). The desktop window (127.0.0.1), the Vite dev proxy (`changeOrigin:false`, Host `localhost:5173` or an IP),
LAN HTTPS (IPs, `.local`) and Docker (`localhost:3100`) need no configuration.

### D-120 Public server-info names nothing about the machine; security reads have a limited view (2026-10-09) — Final
Audit F-6. `GET /api/auth/server-info` (public) keeps what identifying a server needs — `serverId`, keys, protocol,
`authentication.required`, transports, scopes — but `serverName` is only the operator-set `GENERATORAI_SERVER_NAME`
(absent otherwise; never `os.hostname()`), `endpoints` lists only the endpoint the request used, `tls` carries the
fingerprints and expiry but not the certificate's names or issuer, and `legacyApiKeyAccepted` is gone. The code
holder still gets the friendly name, every endpoint and the full certificate from the pairing offer / preview.
`GET /api/security/posture` and `/network-access` stay `read:status` but answer `detail: 'limited'` unless the caller
holds `admin:settings`: posture → host id, loopback-only, authentication required, relay availability, scopes;
network → mode, active, pending restart, `blockers: []` (only an admin can act on them). Bind address, secret
backend, legacy key, device counts, warnings, every address, certificate names and proxy trust are admin-only and
absent — not invented — in the limited view. Wire types moved to `@generatorai/shared` (`SecurityPosture.ts`); the
web Settings view renders the limited view; mobile already reads those fields optionally (COORDINATION.md). The
served certificate still shows its names in the TLS handshake — inherent to TLS, out of scope here.

### D-121 A refused CORS origin is a 403 policy answer; no response body carries a stack (2026-10-09) — Final
Audit F-9: the `cors` origin callback threw, so a disallowed origin reached the generic error handler as 502
`UNKNOWN_ERROR`, with a stack (absolute paths) in development. The CORS middleware now answers it directly: 403
`{ code: 'ORIGIN_NOT_ALLOWED', message, requestId }`, preflight included, with no CORS headers. The error handler
never puts `stack` in a response body in any environment; it stays in the server log under the request id.

### D-122 Hosts are compared lower-cased in the DPoP `htu` and the rebuilt request URL; paths stay exact (2026-10-09) — Final
Audit F-7. `canonicalHtu` lower-cases the host explicitly (the WHATWG parser already does for http(s)) and
`requestOrigin` lower-cases the `Host` / trusted `X-Forwarded-Host`, so the URL the server rebuilds and the one the
client signed agree on host case; the native-lane own-origin check compares case-insensitively. The path stays
byte-exact in `htu`: DPoP binds exactly the path that was signed, and which policy a path spelling falls under is the
route policy's job (D-115), not DPoP's.

### D-123 "Connect with Tailscale": one click, `tailscale serve` to loopback, no LAN exposure (owner, 2026-10-09) — Final
The decided default for "use it from my other devices" without hosting anything (security-analysis S4,
seamless-connections Option 1). Settings › Security & devices › **Access from other devices** › Connect with Tailscale
runs `tailscale serve --bg --https=443 http://127.0.0.1:<port>`: every device signed in to the same tailnet (Personal
plan: free, up to 6 users, unlimited devices) opens `https://<machine>.<tailnet>.ts.net` with a publicly trusted
certificate Tailscale provisions, over WireGuard. The server stays bound to 127.0.0.1; Network exposure (LAN) moves under
**Advanced** and is not needed.
- **Server-side, so desktop and headless agree.** `network/tailscale/`: the CLI is found in `GENERATORAI_TAILSCALE_CLI`,
  `PATH`, then the OS install path (macOS `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, Windows
  `%ProgramFiles%\Tailscale\tailscale.exe`, Linux `/usr/bin`, `/usr/sbin`, `/usr/local/bin`, `/snap/bin`); always an
  argument array with `shell: false` and a timeout (`serve` blocks while waiting for HTTPS to be enabled). State from
  `tailscale status --json` (BackendState, Self.DNSName, CertDomains / the `https` capability, MagicDNS) and
  `tailscale serve status --json`, parsed defensively: not installed · not running · needs login (its AuthURL, only a
  tailscale.com link) · HTTPS off (Tailscale's own `login.tailscale.com/f/serve?node=…` link when the CLI printed one,
  else the DNS admin page) · ready · on · error.
- **Persisted and re-applied.** `tailscale-access.json` (0600, next to the DB) holds the choice, the name and the last
  port. The server re-applies Serve after `listen` (the desktop's embedded server may move port) and every 60 s while on
  (Tailscale started later, Serve cleared by hand). Off removes the 443 root handler only when it still points at this
  server; another app's handler is never replaced without `replace: true` (the UI says whose it is).
- **Same gates as LAN exposure.** Unauthenticated loopback mode or a weak vault blocks Connect (409 `TAILSCALE_BLOCKED`)
  and pauses a persisted choice at start. While on, the server counts as reachable beyond loopback for the agent
  permission default (`acceptEdits`, plan G14), at start and live.
- **API.** `GET /api/security/tailscale` (read:status; limited view `{detail, enabled, state, origin: null}` without
  admin:settings, D-120), `POST /api/security/tailscale {enabled, replace?}` (admin:settings, audited; 409 codes in the
  OpenAPI spec carry the status for the UI). Wire type `TailscaleAccessStatus` in `@generatorai/shared`.
- **Offers.** The ts.net origin is the first endpoint for every audience (reachability `private-network`): web/desktop
  `joinUrl`, the QR, `pair/preview`. The pairing panel says "Works on any network where your devices are signed in to
  Tailscale".
- Not done: Funnel (public internet) is never turned on; the status reports it if the owner enabled it by hand.

### D-124 `tailscale serve`'s forwarded headers are trusted for its name only, from loopback (2026-10-09) — Final
`tailscale serve` keeps the client's Host (`r.Out.Host = r.In.Host`), sets `X-Forwarded-Host` = Host,
`X-Forwarded-Proto: https`, `X-Forwarded-For` = the tailnet peer, and strips client-sent copies (Go `ReverseProxy`
`Rewrite`; `ipn/ipnlocal/serve.go addProxyForwardedHeaders`). The DPoP `htu`, CORS and HSTS need the `https://<name>`
origin, but D-114's `GENERATORAI_TRUST_PROXY=loopback` would also make every loopback peer bypass the D-119 Host check —
undoing the DNS-rebinding defence. So `requestOrigin` has a narrow lane: honoured only when the peer is loopback,
Tailscale access is on, and `Host` and `X-Forwarded-Host` (if sent) are exactly the ts.net name. It never bypasses the
Host allow-list (the name is simply on it), so a rebinding page (its Host is its own name) is refused as before; a local
process forging the lane only makes its request non-loopback (forwarded), never more privileged. Per-source pairing limits
use the left-most `X-Forwarded-For` behind a trusted proxy or the lane (`requestClientAddress`), so tailnet devices do not
share 127.0.0.1's budget. `Tailscale-User-*` / `Tailscale-Headers-Info` are never read: device pairing (DPoP) stays the
only authority.

### D-125 One endpoint-trust rule for every client: install CA for private names, system trust for the rest (2026-10-09) — Final
`@generatorai/shared` `endpointTrust(origin)`: `install-ca` for https to a private/loopback/100.64 IP literal, `.local`,
`localhost` — the only names the D-110 local CA (name-constrained) can vouch for, so a native client pins
`certificateFingerprint` for them; `system` for every other https name (ts.net, a reverse proxy, a custom domain), which
is verified normally and never pinned; `none` for http. The mobile pinning work (MV-44) and the desktop client (D-126)
apply the same split, so a ts.net endpoint from an offer works with ordinary HTTPS on every client.

### D-126 The desktop app as a client pins the other server's CA for that host only (G-4, 2026-10-09) — Final
Remote mode refused another machine's built-in HTTPS (the `certificate-error` handler trusts loopback only), so a
desktop could not use a LAN server at all. **Connect to a server…** now takes an address or that server's pairing link
/ code (Settings › Security & devices › Pair a new device, platform Desktop) and decides trust before the window loads
it (`remote-connect.ts`, `pinnedTrust.ts`):
- **Offer.** Its addresses are tried in order (loopback skipped, a native-lane `http://` tried as `https://` on the same
  port). One TLS connection without trust reads the chain; a publicly trusted certificate (ts.net) is used as is;
  otherwise the CA that signed the leaf must hash to the offer's `certificateFingerprint`, and `server-info` over that
  pin must answer the offer's `serverId`. A mismatch is refused ("does not match this pairing code").
- **Typed address.** A public certificate needs nothing; a self-signed one shows **Trust this server?** with the
  served certificate's SHA-256 (what that server's Settings shows) and the CA's, defaulting to Cancel.
- **Pin.** `serverConnections[].pinnedCa = { sha256 (base64url, the offer format), pem, trustedAt }`, sanitised on load;
  re-adding a server never swaps its CA (`PinMismatchError` → forget it first).
- **Verify proc.** `session.defaultSession.setCertificateVerifyProc`: Chromium's `net::OK` is kept; otherwise accept
  (0) only a leaf that is signed by the pinned CA (whose stored DER still hashes to the pin), is valid now, is not a CA,
  and names the host being verified — for a saved server whose host is that host; anything else returns -3. Browser
  tabs use their own partitions and are unaffected. The same rule checks `server-info` before trusting (OpenSSL's
  chain builder rejects the D-110 CA's name-constraint encoding, so it is not used).
- The remote page's first load is `/?pair=<offer>`; the pairing screen keeps a linked code in memory across its own
  remounts. **The desktop's `requestPairingCode` bridge now answers only a page of the embedded server's origin**: a
  remote server shown in the main window could otherwise mint an all-scope grant for this computer.
- Not done: the native browser-tab and other bridge calls a remote page can still reach are unchanged (pre-existing
  remote-mode surface; follow-up).

### D-127 The plain-HTTP LAN lane is gone: every other device uses HTTPS; offers carry a standby CA (MV-44, 2026-10-09) — Final
Supersedes D-112. The mobile app now pins the local CA natively for fetch, the stream and WebSockets (mobile MD-199…MD-202),
so nothing needs plain HTTP from another device.
- **Offers.** One endpoint list for every platform (`serverEndpoints` lost its `audience`): with TLS on, every network
  address is `https://` (plus `<host>.local`), the ts.net origin first when Tailscale serves (D-123), loopback stays
  `http://127.0.0.1`. `server-info` and `pair/preview` answer the same list whoever asks.
- **Transport policy.** Lanes are `https`, `loopback` (plain HTTP from this machine) and `lan-http` (plain HTTP from
  another device). While TLS is on, `lan-http` is refused for everyone — a page GET is redirected 308 to `https://`,
  anything else is 403 `HTTPS_REQUIRED` ("Use https://… instead"), a WebSocket upgrade is 403. The own-`http://<host>`
  Origin allowance for React Native's WebSocket is removed (RN sends `https://<host>` over `wss://`, which the
  reachable-origin allowlist already holds). With `GENERATORAI_LAN_TLS=0` (or a certificate that failed) the server
  still speaks plain HTTP on the network and the app refuses to pair with it: the operator chose that.
- **Standby CA.** `TlsManager` generates a second, never-served CA with the first (`system/tls/local-ca-standby`, same
  profile and name constraints) and every offer carries its fingerprint as `backupCertificateFingerprint` (relay-protocol
  schema, additive). The app pins both, so a future rotation (promote the standby, make a new one, re-issue the leaf)
  will not force a re-pair. The rotation itself is not built. A custom certificate (D-113) offers neither.
- **Other native clients.** A CLI or MCP client on another machine now needs TLS too: Connect with Tailscale (publicly
  trusted) or `NODE_EXTRA_CA_CERTS=<ca.crt from GET /api/auth/tls/ca.crt>`. On this machine nothing changes.
- **Migration.** None (pre-release): a phone paired over the lane shows "Pair again for an encrypted connection" and
  never sends plain HTTP; pairing again replaces the session.
Evidence: `agent-tests/lan-pairing-e2e.mjs` (29 checks: https-only mobile offer, CA + standby fingerprints, pinned
pairing and DPoP over https, plain-HTTP API / server-info / ws:// refused from the LAN), `lanTransport.test.ts`,
`lanTls.test.ts`; device evidence in `docs/redesign/mobile/reviews/mv44-pinning.md`.

### D-128 The packaged app runs its server in a utility process, ships hardened fuses, and hands the vault key over the channel (F-4, F-8, 2026-10-09) — Final
- **Process.** Packaged: `utilityProcess.fork(resources/server/server.mjs)` (Electron's Node, `serviceName`
  "GeneratorAI Server", stdout/stderr piped to the main log). Unpackaged/dev and `GENERATORAI_DESKTOP_NODE`: the Node child
  as before (system-Node ABI, tsx). Both behind `ServerChild` (`apps/desktop/src/main/server-child.ts`); lifecycle unchanged:
  graceful `{type:'shutdown'}` message on every OS, SIGTERM / `taskkill /t` fallback, force kill after 15 s, bounded
  restart with backoff, no restart on an unreadable vault. The server speaks either channel through
  `apps/server/src/parentChannel.ts`; a utility process gets no `disconnect`, so it polls its parent (2 s) and shuts down
  when it is gone. The server environment is this process's minus `ELECTRON_RUN_AS_NODE` (agent children keep their own
  allowlist).
- **Fuses** (electron-builder `electronFuses`, flipped after afterPack, before signing): `RunAsNode`,
  `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `GrantFileProtocolExtraPrivileges` off;
  `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`, `EnableCookieEncryption` on; an unsigned macOS build
  resets its ad-hoc signature. The splash/error/prompt `file://` pages load their same-directory fonts without the file
  privileges (checked on a fused Electron).
- **Nothing runs Electron as Node any more.** The bundled Codex launcher is replaced by the native binary it would exec
  (`nativeCodexForScript`, same `CODEX_MANAGED_*` env); a `.js`/shim Codex in Electron without a native binary is not
  offered; the script sandbox never falls back to `process.execPath` inside Electron. The opt-in agent-host / pty-host
  (`child_process.fork`) are not shipped in the packaged app; enabling them there would need a utility process too.
- **Vault key (F-8).** The shell sets `GENERATORAI_SECRET_KEY_HANDOFF=parent`; the server sends `secret-key-request`
  before building the container and the shell answers `{type:'secret-key', key}` on that child's channel; the key goes to
  `EnvKeyProvider` in memory (`createSecretStore({ suppliedKey })`, backend still `env-key`). It is never in the server's
  environment (`ps eww`, `/proc/<pid>/environ`, inherited by children). A headless server keeps
  `GENERATORAI_SECRET_KEY`; an operator key in the shell's own environment still passes through.
- **Testing a fused build.** Playwright's `_electron` needs the Node inspector, so `packaged-app-smoke` and
  `GENERATORAI_SMOKE_EXECUTABLE=<binary>` smokes start the binary with Chromium's renderer-only `--remote-debugging-port`
  and connect over CDP. Signing and notarization still need release credentials (`resolveSigning`).
Evidence: `agent-tests/packaged-app-smoke.mjs` 32/32 on the fused macOS arm64 build, `terminal-desktop-smoke` against the
packaged app, `desktop-security-smoke` 17/17; `server-child.test.ts`, `parentChannel.test.ts`, `suppliedKey.test.ts`,
`resolveCodexBinary.test.ts`, `build-config.test.mjs`.

### D-129 A plain sandbox runs the whole e2e suite: its Faux script includes every e2e fixture (2026-10-09) — Final
`scripts/redesign/sandbox.mjs` writes one Faux script per sandbox: `agent-tests/vrt/fixtures/sandbox.faux.json` plus every
`agent-tests/e2e/fixtures/faux-*.json` (plus an explicit `GENERATORAI_TEST_FAUX_SCRIPT`); a conversation scripted twice is an
error. `GENERATORAI_SANDBOX_FAUX_SCRIPT` still replaces it as-is (the mobile sandbox). The composer and changes-dock specs no
longer read `GENERATORAI_TEST_FAUX_SCRIPT` on the test-runner side (setting it there only stopped them skipping while the
sandbox served its own fixture — the "regression" seen after aa5cd74b); they skip only when no Faux provider is ready and
name the missing script when the scripted turn never comes. `GENERATORAI_SANDBOX_BUNDLE` runs another server bundle, because
`build:server` stages Electron-ABI native modules into `dist-bundle/node_modules`.

### D-130 Bridge channels are local-only by default; a remote server's page keeps window-level calls only (2026-10-09) — Final
The preload bridge is the same for every page in the main window, including another machine's server (D-126). The IPC
guard's scope (`apps/desktop/src/main/ipc-scope.ts`) is default-deny: a channel not on the remote allowlist requires the
sending frame to be this computer's server (embedded, or the dev server; never while in remote mode). Allowlisted for
remote pages: window chrome, find, appearance and menu state, reload / devtools, `openExternal` (validated), the server
list / switch / add (the way back to this computer), update state (not install), `browser.available` (false while remote),
and a redacted `getAppInfo` (no data dir, log file or server URL). Local-only: server status / restart, file and directory
dialogs, save-to-disk, reveal-in-folder, desktop settings, update install, pairing, every native-browser tab operation.
Evidence: `agent-tests/desktop-remote-ipc-smoke.mjs` (14/14; 9 of its checks failed before), `ipc-guard.test.ts`.

### D-131 Model lists come only from each provider's own API; experimental providers are hidden by the server (2026-10-10) — Final
Owner override of the ComposerModelPicker / ChatCreateModel boards (no tier groups, no "Recommended"/"Default" rows).
- **Source.** Claude Code: `query().supportedModels()` (SDK 0.3.220, CLI 2.1.291); Codex: app-server `model/list`
  (paginated, rows flagged `hidden` left out exactly as Codex's own picker does); Copilot: `CopilotClient.listModels()`;
  OpenCode: `GET /config/providers`; ACP has no listing call outside a session (empty, never faked). An adapter copies
  only returned fields (`HarnessModel`: description, `isDefault`, `resolvedModel`, `inputModalities`, `features`,
  efforts, limits, Copilot's own `category`/billing). Nothing is inferred: Claude's invented tier and 200K/1M context
  windows are gone (real limits arrive from a turn's `modelUsage`); its `default` alias is folded into the row it
  resolves to, which is flagged `isDefault`. One exception, kept because it is what runs: a model's
  `defaultReasoningEffort` for Claude is the server's runtime default (Codex returns its own). The orchestrator keeps a
  routing-only Claude family cost hint (opus/fable high, haiku low) that is never displayed.
- **The "two Codex models".** The backend filters `model/list` by plan AND client version: the pinned codex 0.154.0
  got GPT-5.6-Terra/Luna only; 0.160.1+ gets GPT-6-Luna too (same free ChatGPT account). `@openai/codex` is pinned to
  0.162.1 (schema re-captured; `thread/rollback` is gone, so a count-only rewind looks the turn up with
  `thread/turns/list`). Models beyond that (Sol, Astra …) are plan-gated: this account's plan is `free`.
- **Cache.** Registry snapshot TTL 5 min + disk cache; `?refresh=1` / Refresh models forces a probe and drops a
  provider's own cache (Claude's 5-min catalog); sign-in / sign-out `invalidate(type)` first. A failed listing shows
  the provider's reason (e.g. Copilot "Not authenticated") and no models.
- **Picker.** One plain list per provider in the provider's order; a small "default" badge only when the provider
  flags it; hover / keyboard highlight shows client-core `modelDetails()` — only fields present.
- **Visibility.** `HARNESS_PROVIDER_STABILITY` (shared): claude-agent, codex, copilot `stable` (dedicated adapter
  suites — claude-*, CodexProvider*, copilot-* — plus the conformance test; Claude and Codex verified live on the
  owner's logins; Copilot is the historical primary); opencode, acp `experimental` (fake-server tests only, never
  configured by the server, no e2e). Hidden by default; `GET/PUT /api/harness/visibility` (PUT: admin:harnesses,
  persisted to `<dataDir>/provider-visibility.json`) and `GENERATORAI_EXPERIMENTAL_PROVIDERS=opencode,acp|all` reveal
  them. Enforced in `HarnessRegistry.setHiddenTypes`: a hidden provider is absent from every status/model API, never
  probed, cannot be brought up (`ProviderHiddenError`), and its sign-in/out/switch answer like an unknown provider.
Evidence: docs/redesign/reviews/models-and-providers.md; `HarnessRegistry.visibility.test.ts`,
`providerVisibility.test.ts`, `claude-model-catalog.test.ts`, `modelPickerCatalog.test.ts`.

### D-132 Provider logos come from one registry (2026-10-10) — Final
`PROVIDER_LOGOS` (packages/design-tokens/src/provider-logos.ts) holds each provider's mark as 24×24 path data with its
source and licence (Simple Icons 16.34.0 CC0 for Claude and OpenCode, Simple Icons/Primer MIT for GitHub Copilot, Lobe
Icons 1.95.1 MIT for Codex since Simple Icons dropped OpenAI); unknown ids get a neutral mark. Web
`ui/primitives/ProviderLogo` and mobile `ui/primitives/ProviderLogo` draw it: sizes, `color` (brand colour where the
brand has one — Claude's D97757 — else the text colour) and `mono`. This overrides mobile MP-52's "never a brand hex
in-app" for provider marks only; BrandMark keeps the app and GitHub marks, VendorIcons keeps AppMark/GitHubMark.
Adding a provider = one registry entry. Kit additions: Badge `size="sm"`, Select item `leading`, ListRow `leading`.
Transcript (owner report, 2026-10-10): a chat with no named agent heads each response with its provider's logo in
place of initials; each assistant message stores the `model`/`provider` its usage report named (TurnRecorder →
`ChatMessageMetadata`), so a past turn shows the logo + model too. Turns saved before this show the chat's provider logo
and no model. Mobile's reply header leads with the chat's provider logo.

### D-133 New chat: one form structure, and a name is all a chat needs (2026-10-10) — Final
Owner review of the New chat dialog and `/chats/new`. Both now share one structure: the chat (Name, an optional **First
message**; the page adds Description), Who (agent, then Model · Reasoning effort · Context), Where, Behaviour (Orchestrate
mode, Plan first as label + hint + switch rows), More (tags, browser) — the dialog folds Behaviour and More into a
collapsed Options section whose summary lists only non-default values. Labels sit above every control (vertical `Field`)
on one left edge; the dialog's horizontal 64px label column is gone, and so is the compact SourcePicker's indent.
Sections are rule-separated: `ModalForm.Section` (C-35) gains `first` and draws a `line` rule — not `line-soft`, which
equals the dialog's `overlay` surface and vanishes; the compact source list inside the dialog uses `line` for the same
reason. The start rule is `chatCreateBlockingReason`: a name, or a first message to derive one from — the task is no
longer required, overriding F-create-01/02's "gated on the Task". With no first message the chat opens empty for the user
to type or dictate; Plan first then has nothing to apply to and is disabled with a pointer to the composer's Plan mode.

### D-134 Home starts work from quick-action tiles, not a chat box (2026-10-10) — Final
Owner review: the Home quick composer (F-home-02) and the header's Run workflow / New workflow buttons are replaced by
one "Start" row — C-40 `QuickActions`, a 2-column grid of P-55 `ActionTile`s: New chat (opens the New chat dialog, D-133),
Run workflow (→ /workflows, where each workflow runs), New workflow, New agent. Each tile is a card-sized button (icon
well · title · one-line description · the command's own chord from `shortcutFor`, D-24). The Dashboard template's
`composer` slot is renamed `start`. Writing the first message now happens in the dialog or the chat itself.

### D-135 A mount reads as what the agent works in; no-source chats say "Empty workspace" (2026-10-10) — Final
Owner report: a chat with no sources showed a "main" chip and an app-data path
(`…/workspaces/executions/<id>/source/main`). Root cause: with no sources `MountService.plan` creates a `generated`
mount aliased `GENERATED_MOUNT_ALIAS = 'main'` under the managed workspace and `prepareMount` runs `git init -b main`
there, so the chip named the alias "main" (and, once a re-prepare records the branch, "main main") and the popover printed the managed
path. The server stays as it is (the managed folder is a real git repo so checkpoints and Changes work); every surface
reads a mount through client-core `describeMount` instead: `empty` (generated) → "Empty workspace", no branch, no path;
`folder` (in place, not git) → its name, no branch, its path; `repo` (in place, git) → name + branch + path; `worktree`
→ name + the worktree's branch + "from <the user's repo>" (no path for a project codebase, whose origin may be the app's
clone). A managed directory is never shown as the user's folder — this overrides ComposerStates' sample worktree path
under `.generatorai/worktrees`. The chip stays visible when empty (it is the composer's way into Edit sources), in
`fg-2`; hiding it would remove that entry point. Consumers: composer SourcesChip + popover, ChatHeader's branch chip,
the Files dock SourcesBlock (mobile can adopt the same helper). `pathTail` shortens a path from the left, keeping the
server's own separator (Windows backslashes stay). Chrome: the Sources and Skills · MCP chips are P-09 `Chip` (Rosetta
`.chip`; `dropdown` keeps a Popover trigger's `aria-haspopup="dialog"`), mount cards use `line` (not `line-soft`, which
vanishes on the popover's `overlay`), and "Edit sources…" closes the popover as the dialog opens.

### D-136 "Add local folder" opens the OS folder dialog in the desktop app; web keeps a streamlined server-side browser (2026-10-10) — Final
In the desktop app showing this computer's own server, "Add local folder" (SourcePicker) and a codebase's Browse
(`CodebaseDraftFields`) call `useFolderPicker`, which opens Electron `dialog.showOpenDialog({ properties:
['openDirectory', 'createDirectory'] })` (macOS, Windows and Linux; `createDirectory` is macOS-only and ignored
elsewhere) and adds the absolute path directly — no in-app modal. Path: `lib/desktop.ts` `desktopFolders`
(`canPickNatively()` = bridge has `selectDirectory` + `getAppInfo().localServer`, cached per page load since a server
switch reloads the window; `pick(defaultPath?)`) → preload `selectDirectory(opts)` → the existing `desktop:selectDirectory`
channel, which stays local-only (not in `ipc-scope.ts`'s remote allowlist, D-130): a remote server's page is refused by
the guard and its `getAppInfo()` now answers `localServer: false`. `defaultPath` is honoured only when absolute. The old
`__generatoraiNativePickers` / `window.showDirectoryPicker` shim (injected by `executeJavaScript`, unused) and the dead
`IPlatformClient.selectDirectory` are deleted. Fallback — the server-side `DirectoryBrowser` — when the native picker
cannot apply: a plain browser has no absolute paths (the File System Access API yields a name only), and the desktop
app showing a remote server would pick a path on the wrong machine. It opens at the server user's home with shortcuts
(`GET /api/fs/dirs` with an empty path now adds `home` and `places`: Desktop, Documents, Downloads, Projects… matched
case-insensitively against what exists, then the drives); clicking a folder opens it, its "Use" button picks it
without opening, "Use this folder" picks the one on screen, a pasted path still works. Verified by
`agent-tests/desktop-folder-picker-smoke.mjs` (main-process `dialog` stub, no production hook) and the remote case in
`desktop-remote-ipc-smoke.mjs`. Edit sources follows D-133: ModalForm sections Where (full SourcePicker) and Source
control (label + hint + switch rows); the full SourcePicker uses the compact layout's single `line` list, each row
adding rename, reorder/remove, the user's folder + copy and "Make working directory"; a plain folder shows no branch
controls (the server refuses branches on it).

### D-137 A live conversation follows Edit sources (2026-10-10) — Final
Found while verifying D-135/D-136 with the Faux harness: after "Edit sources" the next turn still ran in the OLD
folder. `updateChatSources` drops the conversation binding so the next turn calls `resumeConversation(id, cfg)` with
the new roots, but every provider returned early for a live conversation (Claude unless the model changed; Codex,
Faux, OpenCode, ACP always). Now: Claude rebinds when cwd or extra directories differ (`sameRoots`; the rebuilt config
changes `sessionFingerprint`, so the CLI session is rebuilt with `resume`, history kept); Codex adopts the new roots
on the live conversation and sends `cwd` with every `turn/start` ("this turn and subsequent turns") next to the
writable-roots sandbox policy; Faux adopts them too. Copilot (a CLI client per cwd) and the experimental OpenCode/ACP
are not changed yet — open item in `reviews/chat-sources.md`.

### D-138 Form-dialog section hints sit behind an info icon; the Sources popover is one surface (2026-10-11) — Final
Owner feedback: a grey sentence under every dialog section heading ("Where — What this chat works on…") read as noise,
and the composer's Sources popover mixed a sunken header band with boxed mount cards on the overlay. `ModalForm.Section`
now renders `hint` as a Tooltip on an `info` icon beside the title (hover + keyboard focus; the text stays in the
accessibility tree via `sr-only`), so every form dialog (New chat, Edit sources) gets it at once. Section titles say what
the user picks, not interrogatives: "Agent and model", "Folders and codebases", "After each turn" (the git switches:
Commit changes / Push the branch / Open a pull request). The popover keeps the `overlay` surface throughout — header,
divided source rows and footer split by `line` rules. A folder that is not a git repository shows neither Mode nor
branch controls (it can only be edited in place). Page forms (`FormSection` on ChatCreate) keep visible hints: a page
has the room and no hover-only text.

### D-139 A removed mount takes its checkpoints with it; a plain folder reads unchanged until its baseline lands (2026-10-11) — Final
Found by the real-user pass on the installed app. (1) A plain folder linked in place showed "1 file changed · Undo all"
on a brand-new chat: the tray read the summary while the mount was still being prepared, before its baseline existed,
and `resolveBaseline` fell through to the empty tree — every file the user already had read as added by the agent, and
Undo all would have deleted them. A shadow-tracked mount with no baseline and no base commit now anchors on its own
working tree (no changes). (2) Edit sources Empty workspace → folder → Empty workspace: `MountService.remove` deleted the
shadow store but left its checkpoint rows, so the re-added `main` chained every capture onto a commit git could not find
and never checkpointed again. `remove` now forgets the rows of each alias whose store it deletes
(`CheckpointService.forgetRepo`, late-wired like the baseline capture). Also: the Sources popover header names the
chat's project.

### D-140 Browser comments: one Annotate mode, a tray under the page, one file per send (2026-10-11) — Final
Owner: hover elements, comment, send one or many to the chat for a fix, drag for a screenshot. Modelled on the Codex
in-app browser (Annotate: click an element or drag an area, comments go with the message), Cursor's browser Design
Mode (point, describe, send) and Agentation (structured Markdown per annotation). The toolbar's Comment toggle,
"Comments ▾" popover and region-comment camera become **Annotate** (count on the button) and **Screenshot ▾**
(Visible area · Full page · Select an area…). In the page (`apps/desktop/src/main/annotate-overlay.ts`): hover shows an
outline and a `tag.class W×H` chip; click selects an element, a drag ≥ 6px selects an area; either opens an anchored
card — ↵ adds, ⇧↵ new line, ⌘/Ctrl↵ adds and sends everything, Esc cancels (a cancelled draft leaves no pin); a pin
reopens its card; Esc with no card leaves the mode; leaving hides the pins and keeps the comments. The list is a
**tray under the view** (`CommentTray`), never an overlay on it (an overlay hides the WebContentsView, D-19): numbered
rows open their comment in the page; **Send to agent** sends a message now (a busy chat attaches it to the next one —
no queue, D-29), **Add to message** puts it in the composer. A send is ONE `browser-comments-<stamp>.md` (page, then
each numbered comment with element label, selector, text, size, HTML, computed CSS — or the area's box) plus one PNG
per comment captured in context: scrolled into view, padded 32px, only its own pin and outline showing. Full page is
CDP `captureBeyondViewport` (≤ 16k px tall), falling back to the viewport and saying so. Where there is no chat
(workflow run page) Annotate and Screenshot are hidden. Removed: `pickElement` and `annotateRegion` IPC, the
CommentsPopover, the 2-files-per-comment naming. Web (screencast) keeps the one-shot inspector pick and the dragged
area capture under the same two buttons.

## Evidence sources
- shadcn: [Base UI default (Jul 2026)](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default) · [monorepo](https://ui.shadcn.com/docs/monorepo) · [forms / TanStack Form](https://ui.shadcn.com/docs/forms/tanstack-form)
- Base UI: [releases](https://base-ui.com/react/overview/releases) · [v1 (InfoQ)](https://www.infoq.com/news/2026/02/baseui-v1-accessible/) · [Autocomplete](https://base-ui.com/react/components/autocomplete) · Radix: [commits](https://github.com/radix-ui/primitives/commits) · cmdk: [releases](https://github.com/pacocoursey/cmdk/releases)
- Tailwind: [v4.3](https://tailwindcss.com/blog/tailwindcss-v4-3) · [theme variables](https://tailwindcss.com/docs/theme) · [source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files) · [tailwind-merge](https://github.com/dcastil/tailwind-merge) · [cva discussion](https://github.com/joe-bell/cva/discussions/205)
- Lint: [eslint-plugin-better-tailwindcss](https://github.com/schoero/eslint-plugin-better-tailwindcss) · [no-unknown-classes](https://github.com/schoero/eslint-plugin-better-tailwindcss/blob/main/docs/rules/no-unknown-classes.md) · [JS Boundaries](https://www.jsboundaries.dev/docs/quick-start/)
- Workshop / VRT: [Storybook 10](https://storybook.js.org/blog/storybook-10/) · [Storybook MCP](https://storybook.js.org/docs/ai/mcp/overview) · [addon-vitest](https://www.npmjs.com/package/@storybook/addon-vitest) · [Argos on Lost Pixel](https://argos-ci.com/blog/lost-pixel-alternatives)
- Libraries: [react-resizable-panels 4](https://github.com/bvaughn/react-resizable-panels/releases/tag/4.0.0) · [TanStack Virtual chat](https://tanstack.com/blog/tanstack-virtual-chat) · [TanStack Form v1](https://tanstack.com/blog/announcing-tanstack-form-v1) · [react-hook-form v8 migration](https://react-hook-form.com/migrate-v7-to-v8) · [Streamdown](https://github.com/vercel/streamdown) · [Shiki performance](https://shiki.style/guide/best-performance) · [lucide v1](https://www.infoq.com/news/2026/06/lucide-v1-icons/) · [Fontsource variable](https://fontsource.org/docs/getting-started/variable)
- Platform: [React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1) · [incompatible-library lint](https://react.dev/reference/eslint-plugin-react-hooks/lints/incompatible-library) · [Vite 8](https://vite.dev/blog/announcing-vite8) · [React Router v8](https://remix.run/blog/react-router-v8) · [TypeScript 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) · [Style Dictionary DTCG](https://styledictionary.com/info/dtcg/)
- Cross-platform: [Bluesky package.json](https://github.com/bluesky-social/social-app/blob/main/package.json) · [Discord on RN](https://discord.com/blog/how-discord-achieves-native-ios-performance-with-react-native) · [Linear mobile](https://linear.app/mobile) · [Sora Android with Codex](https://openai.com/index/shipping-sora-for-android-with-codex/) · [Uniwind](https://docs.uniwind.dev/) · [NativeWind v5 RC](https://github.com/nativewind/nativewind/releases/tag/5.0.0-rc.0) · [RN Reusables](https://github.com/founded-labs/react-native-reusables) · [Expo UI stable](https://expo.dev/blog/expo-ui-stable-sdk-56)
