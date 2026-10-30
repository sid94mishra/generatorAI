# GeneratorAI web stack research (as of 2026-09-24)

Scope: the `apps/web` SPA (also rendered inside Electron 42) and a planned `packages/ui` design-system package. It's written for a solo developer whose code is mostly produced by LLM coding agents. That puts weight on three things: how well the models know a library, how strict its types are, and how little config it needs.

Repo facts checked for this report:
- `apps/web/package.json`: Radix per-package deps (12), `cva` 0.7.1 (installed but unused), `tailwind-merge` ^2.6.1 (a v3-era version), `lucide-react` ^0.460, `react-markdown` ^9, `highlight.js` + `rehype-highlight`, Vite ^6.4, `@vitejs/plugin-react` ^4.7.
- `NativeBrowserView.tsx` finds overlays with `'[data-radix-popper-content-wrapper]'`, `[role=dialog|menu|listbox]`, `.sonner-toast`, `[data-sonner-toaster]` and `[data-modal-open]`.
- `SearchableSelect.tsx` uses `--radix-popover-trigger-width`.
- `globals.css` uses `@custom-variant dark (&:is(.dark *))`.
- `@pierre/diffs` peer-depends on `shiki ^3 || ^4`.
- About 9 usages of the lucide `Github` icon.

---

## 1. Headless primitives

**Recommendation: Base UI (`@base-ui/react`, 1.8.x). Runner-up: stay on Radix (`radix-ui` unified package 1.6.x).**

Evidence
- **Base UI**
  - Stable v1.0.0 shipped 11 Dec 2025. Since then there has been roughly one minor release a month: 1.2 (Feb), 1.3 (Mar), 1.4 (Apr), 1.5 (May), 1.6 (18 Jun), 1.7 (4 Aug), 1.8 (4 Sep 2026). 1.7 cut bundle size and 1.8 added a `createItems` Combobox API. ([releases](https://base-ui.com/react/overview/releases), [InfoQ v1](https://www.infoq.com/news/2026/02/baseui-v1-accessible/))
  - It has 45+ parts, including several this app needs that Radix doesn't have: **Combobox, Autocomplete, Number Field, Menubar, Toolbar, Drawer, Toast** and Context Menu. ([Base UI quick start](https://base-ui.com/react/overview/quick-start))
  - Its Autocomplete docs include an official **command-palette example** (Dialog + Autocomplete). ([Autocomplete](https://base-ui.com/react/components/autocomplete))
  - shadcn/ui made Base UI the **default for new projects in July 2026**. Radix stays "fully supported, not deprecated", and every new shadcn component ships for both. ([shadcn changelog](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default))
  - MUI describes Base UI as its long-term direction, built by a full-time team. ([MUI blog](https://mui.com/blog/2026-and-beyond/))
- **Radix**
  - Still maintained by WorkOS. There were releases on 6 Jun, 30 Jun (React 19 ref-callback infinite-loop fixes), 6 Jul and 20 Jul 2026 (per-primitive subpath entry points, better tree-shaking), and commits up to 31 Jul 2026. ([Radix releases](https://www.radix-ui.com/primitives/docs/overview/releases), [commits](https://github.com/radix-ui/primitives/commits))
  - The unified `radix-ui` package is 1.6.x. It has a known duplicate-dependency issue ([#3854](https://github.com/radix-ui/primitives/issues/3854)).
  - Comparisons in 2026 describe Radix as slower-moving, with complex components (Combobox and others) still pending. ([ShadcnDeck](https://www.shadcndeck.com/blog/radix-vs-base-ui))
- **Bundle size**: in a like-for-like build Base UI comes out about 10 KB gzipped *larger* than Radix. That issue ([mui/base-ui#3688](https://github.com/mui/base-ui/issues/3688)) was opened Jan 2026 and is still open, though 1.7 made reductions since. This doesn't matter for an Electron desktop app.
- **React Aria Components** (1.21.x, Sep 2026)
  - It has the strongest a11y evidence (screen-reader test matrices) and i18n support (34 locales, 13 calendars). ([Untitled UI comparison, Sep 2026](https://www.untitledui.com/blog/base-ui-vs-react-aria))
  - shadcn added it as a third base in July 2026 (`--base aria`). ([shadcn React Aria](https://ui.shadcn.com/docs/changelog/2026-07-react-aria))
  - It loses here on four counts: a more verbose context/render-props API, the heaviest bundle (whole package ~241 KB min+gz; [discussion](https://github.com/adobe/react-spectrum/discussions/5636)), less agent training data in the shadcn idiom, and date/i18n features you don't need.
- **Ark UI** (5.39.x, Zag.js state machines) is actively released ([releases](https://newreleases.io/project/github/chakra-ui/ark/release/@ark-ui/react@5.38.2)). It loses on React mindshare and LLM familiarity and has no shadcn registry path.

Why Base UI over staying on Radix
- The redesign is a full rewrite with no backward-compatibility constraint, so the one-time migration cost gets absorbed anyway.
- It supplies Combobox, Autocomplete, NumberField, Menubar and Toolbar, which you would otherwise hand-roll for the ~40-field forms and the dense chrome. Its Autocomplete also replaces cmdk (see §7).
- It's where shadcn, and therefore most new agent-visible example code, is heading.
- shadcn ships a migration skill (`pnpm dlx skills add shadcn/ui`); one report had a 60+ component migration done in about 25 minutes.

Migration cost and the Electron coupling
- The current kit is 13 primitive files, and about 18 files mention Radix.
- The real coupling is `NativeBrowserView`'s selector list plus `--radix-popover-trigger-width`. **Fix this independently of which library you pick:** have every floating surface in `packages/ui` (popover, menu, select, tooltip, dialog, toast and so on) stamp a library-neutral attribute such as `data-gai-overlay`, and have `NativeBrowserView` query only that attribute. The detection then stops depending on vendor DOM internals, and a later library swap can't silently break the WebContentsView hiding.
- Base UI renders popups as Portal → Positioner → Popup and exposes anchor-size CSS variables on the positioner, so replace `--radix-popover-trigger-width` with the Base UI equivalent (check the exact name in its docs).
- Keep a Playwright test that opens each overlay type over the browser tab and asserts the native view is hidden.

When Radix would still be right: if you want zero relearning risk for agents. Radix has the most training coverage, and it's alive and receiving React 19 fixes. It's a defensible choice, not a trap.

## 2. Component distribution: shadcn CLI vs hand-built

**Recommendation: use shadcn once to *seed* the Base UI source into `packages/ui`, then own it (hybrid). Runner-up: fully hand-built on Base UI.**

- **CLI v4 (Mar 2026)**:
  - `--dry-run`, `--diff` and `--view` let you inspect what a registry change would do before applying it.
  - The new `registry:base` and `registry:font` types, plus presets, carry a whole design system in one payload.
  - `shadcn/skills` gives coding agents component and CLI context.
  - `init` templates cover Vite and monorepos.
  ([CLI v4](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4))
- **Styles**: eight styles (Vega, Nova, Maia, Lyra, Mira, Luma, Sera, Rhea), each prefixed by base (`radix-*`, `base-*`, `aria-*`). ([shadcnblocks note](https://www.shadcnblocks.com/changelog/new-feature-shadcn-cli-style-support))
- **Monorepo support is first-class**:
  - Every workspace needs a `components.json`, and the files must share the same `style`, `iconLibrary` and `baseColor`.
  - For Tailwind v4, leave `tailwind` empty.
  - Running `shadcn add` from `apps/web` installs primitives into `packages/ui` and rewrites imports.
  - `package.json#imports` aliases are supported.
  ([monorepo docs](https://ui.shadcn.com/docs/monorepo))
- **Sep 2026**: components now import `cn` from a new `cn` npm package. ([cn changelog](https://ui.shadcn.com/docs/changelog/2026-09-cn)) See §3 for why not to adopt it yet.

Why hybrid
- Your spec (13px base, 24/28/32px controls, 18 themes × 2 modes × 7 accents, overlay attribute, density) will diverge from every shadcn style within days, so `shadcn add` upgrades become merge work rather than free updates.
- Seeding still buys agent-familiar file shapes and data-attribute styling hooks, and `--diff` makes it cheap to cherry-pick upstream a11y fixes.
- A private registry isn't worth it for one consumer, and the mobile app (React Native) can't consume it anyway.
- Make `packages/ui` a **source-only** workspace package (TS/TSX exports, no build). In the app's CSS, add `@source "../../packages/ui/src"`, because Tailwind's auto-detection ignores `node_modules` and workspace symlinks resolve through it. ([detecting classes](https://tailwindcss.com/docs/detecting-classes-in-source-files))

## 3. Variant API and class merging

**Recommendation: `class-variance-authority` 0.7.1 plus your own `cn` = `clsx` + `extendTailwindMerge` from tailwind-merge **3.7.x**. Runner-up: tailwind-variants v3 (slots).**

- **tailwind-merge**
  - v3 supports Tailwind 4.0–4.3; v2.6 is for Tailwind v3, so your current ^2.6.1 is the wrong major. ([repo](https://github.com/dcastil/tailwind-merge))
  - 3.7.0 was published mid-Sep 2026. 3.6 (May 2026) added `postfixLookupClassGroups` for classes with a slash in the name. ([3.6.0](https://newreleases.io/project/npm/tailwind-merge/release/3.6.0))
- **Custom scales need config**:
  - tailwind-merge classifies `text-*` by value shape. Only t-shirt sizes count as font size, so a custom `text-body` or `text-caption` falls through to the colour catch-all and gets **dropped when it sits next to a text colour** (for example `text-fg-muted`).
  - Fix: `extendTailwindMerge({ extend: { theme: { text: ['body','caption',…], radius: [...] } } })`. Generate that list from `packages/design-tokens` so it can't drift. ([bug writeup](https://github.com/JanProkorat/fitness-platform/issues/1078), [discussion #521](https://github.com/dcastil/tailwind-merge/discussions/521))
- **cva**
  - 0.7.1 hasn't changed in about two years; `cva@1.0` is a long-running beta, not covered by semver. ([npm](https://www.npmjs.com/package/cva/v/1.0.0-beta.4), [discussion](https://github.com/joe-bell/cva/discussions/205))
  - The API is tiny and finished, and it's what every shadcn file (and so every agent) uses.
- **tailwind-variants v3.3.x**
  - TS rewrite, slots, compound slots, and built-in conflict resolution "inspired by" tailwind-merge (no separate install; `/lite` build). ([release notes](https://www.tailwind-variants.org/docs/release-notes))
  - Slots are genuinely nice for composites.
  - It loses for two reasons: (a) seeded shadcn code is all cva, and (b) its built-in merger is a re-implementation. Your custom-scale config would then have to be kept correct in two engines.
- **Skip the new `cn` package for now**: its docs don't say whether it supports theme extension, and without that your custom `text-*` names break. Revisit if it documents `extendTailwindMerge`-style config.

## 4. Tailwind v4 theming for 18 themes × light/dark × 7 accents

**Recommendation: upgrade to Tailwind 4.3.x and use a two-layer variable scheme.**

- Tailwind **v4.3** was released 8 May 2026 (4.3.3 is on npm). ([blog](https://tailwindcss.com/blog/tailwindcss-v4-3))
  - First-party `scrollbar-*` / `scrollbar-thumb-*` / `scrollbar-gutter-*` utilities, which suit a dense desktop UI and can replace hand-written scrollbar CSS.
  - `@container-size` for height-aware container queries (split panes).
  - `tab-*` utilities for code blocks.
  - Stacked and compound `@variant`.
  - `--default()` for functional `@utility`.
- v4.2 added logical-property utilities and `font-features-*`.

Pattern
1. **Runtime layer (generated by `packages/design-tokens`)**: plain CSS custom properties under attribute selectors, e.g. `:root[data-theme="nord"][data-mode="dark"] { --gai-bg: …; }` and `[data-accent="violet"] { --gai-accent: …; }`.
2. **Tailwind layer**: `@theme inline { --color-bg: var(--gai-bg); --text-body: …; --radius-control: …; }`.
   - Use `inline` because the values reference other variables that change per scope; without it, utilities can resolve against the wrong scope. ([theme docs](https://tailwindcss.com/docs/theme))
3. **Reset namespaces**: `--color-*: initial; --text-*: initial; --radius-*: initial; --shadow-*: initial;` (or `--*: initial` then re-add spacing). This removes `bg-red-500` and friends so off-system classes don't exist at all. The linter (§5) then catches them as unknown.
4. **Dark variant**: `@custom-variant dark (&:where([data-mode=dark], [data-mode=dark] *));`. The current `&:is(.dark *)` has higher specificity than `:where` and doesn't match the root element itself. ([dark mode](https://tailwindcss.com/docs/dark-mode))
5. **Density and platform**: custom variants such as `@custom-variant compact (&:where([data-density=compact] *))`. Shared recipes like the focus ring go in `@utility`.
6. **Sharing**: put the generated `theme.css` in `packages/design-tokens` or `packages/ui` and `@import` it, as the docs recommend for monorepos. Use `@source inline()` only for classes built at runtime (avoid those).

## 5. Lint enforcement

**Recommendation: ESLint (flat config) with `eslint-plugin-better-tailwindcss` 4.x, `eslint-plugin-boundaries` and `no-restricted-imports`. Add `dependency-cruiser` in CI only if graph rules are needed.**

- **eslint-plugin-better-tailwindcss** (4.7.x, published ~Jul 2026). Supports v3 and v4 via the CSS `entryPoint` option, and runs on ESLint and Oxlint. ([repo](https://github.com/schoero/eslint-plugin-better-tailwindcss))
  - Correctness rules: `no-unknown-classes` (renamed from `no-unregistered-classes`; [doc](https://github.com/schoero/eslint-plugin-better-tailwindcss/blob/main/docs/rules/no-unknown-classes.md)), `no-conflicting-classes`, `no-restricted-classes`, `no-concatenated-classes`, `no-deprecated-classes`.
  - Stylistic rules: `enforce-consistent-class-order`, `enforce-canonical-classes`, `enforce-shorthand-classes`, and more.
  - There's no dedicated "no arbitrary values" rule. Use `no-restricted-classes` with patterns matching `\[`, which bans `w-[123px]` and the like, and whitelist inside `packages/ui` where needed.
  - Combined with the namespace resets, `no-unknown-classes` becomes a token-compliance check.
- **eslint-plugin-tailwindcss** (francoismassart) reached 4.x, but its v4 support has been partial/beta for most of its life. ([releases](https://github.com/francoismassart/eslint-plugin-tailwindcss/releases)) It loses.
- **Biome**: `useSortedClasses` is still a nursery rule and supports only the default Tailwind config ([rule](https://biomejs.dev/linter/rules/use-sorted-classes/)). It has no token awareness, so it loses. ESLint 10 (Apr 2026) is the stable base. ([InfoQ](https://infoq.com/news/2026/04/eslint-10-release))
- **Architectural boundaries**:
  - Use `eslint-plugin-boundaries` for the layer rules: primitives → composites → templates → shell → features. ([JS Boundaries](https://www.jsboundaries.dev/docs/quick-start/))
  - Use `no-restricted-imports` so that only `packages/ui` may import `@base-ui/react`, `@radix-ui/*`, `lucide-react`, `sonner` or `cmdk`. This is the single most effective guardrail for agent-written code: features can only use the kit.
  - `dependency-cruiser` (release 20 Sep 2026) is the whole-graph option for cycles and orphans. It's the runner-up; add it if cycles appear.
  - Keep `scripts/check-design-system.mjs` for anything ESLint can't express.

## 6. Component workshop and visual regression

**Recommendation: Storybook 10.x (react-vite) with `addon-vitest`, `addon-a11y` and `addon-mcp`. Visual regression runs free, either through Vitest 4 browser-mode screenshots or Playwright `toHaveScreenshot` against the static Storybook. Runner-up: an in-app `/dev/kit` route plus Playwright.**

- **Storybook 10**
  - Released 28 Oct 2025. It's ESM-only, has a 29% smaller install, `sb.mock` module mocking, CSF Factories, and Vitest 4 support. ([blog](https://storybook.js.org/blog/storybook-10/))
  - Current addons are at 10.6.x. ([addon-vitest](https://www.npmjs.com/package/@storybook/addon-vitest))
- **Agent angle, and the deciding factor**:
  - Storybook 10.6+ generates **component manifests** (props, slots, story snippets).
  - `@storybook/addon-mcp` serves an MCP server at `localhost:6006/mcp`. Claude Code can use it to read the kit's API, write stories and run tests. ([MCP docs](https://storybook.js.org/docs/ai/mcp/overview), [blog](https://storybook.js.org/blog/storybook-mcp-for-react/))
  - That directly addresses agents misusing the kit.
- **Vitest 4**: browser mode is stable, and 4.0 added built-in visual regression and Playwright traces. ([Vitest 4](https://vitest.dev/blog/vitest-4)) Your happy-dom unit tests can stay.
- **Ladle** is lighter (fast cold start, tiny output) but has no manifest, no MCP and no vitest addon. It loses. ([comparison](https://www.pkgpulse.com/guides/storybook-8-vs-ladle-vs-histoire-2026))
- **Lost Pixel** is being sunset: the team joined Figma on 22 Apr 2026. ([Argos](https://argos-ci.com/blog/lost-pixel-alternatives)) It loses.
- **Chromatic**: free tier is 5,000 snapshots/month, then $179/month for 35k. ([pricing comparison](https://argos-ci.com/blog/visual-testing-pricing))
  - Your theme matrix (252 combinations per story) would blow through that immediately.
  - Use local screenshots of a **sampled matrix**: default theme × light/dark, the highest- and lowest-contrast themes, and one accent sweep on a "swatch" story.
  - Run them in a pinned Linux container (Playwright Docker image). Font rasterisation differs between macOS, Windows and Linux, and a baseline must come from one OS even though the app targets all three.
- Keep an in-app kit route as well. It's the only place the real Electron overlay/WebContentsView interaction can be verified (with `playwright-cli --browser=chrome --headed`, per the project convention).

## 7. Specific libraries

| Need | Pick | Runner-up | Evidence and why |
|---|---|---|---|
| Resizable split panes | **react-resizable-panels 4.x** (4.13.2, Sep 2026) | hand-rolled (current) | v4 adds px/rem/% constraints, `Group`/`Separator` naming aligned to the ARIA separator role, `useDefaultLayout` persistence, and `data-separator` state attributes. ([v4.0.0](https://github.com/bvaughn/react-resizable-panels/releases/tag/4.0.0)) Used by shadcn Resizable. Pixel minimums matter for a dense dock. |
| Command palette | **Base UI Autocomplete + Dialog** (official example) | cmdk 1.1.1 | cmdk's last release was **14 Mar 2024**. The repo moved to `dip/cmdk` and has 52 open issues and 24 open PRs. ([releases](https://github.com/pacocoursey/cmdk/releases)) It also pulls in Radix internals ([#3854](https://github.com/radix-ui/primitives/issues/3854)), which would mix Radix into a Base UI kit. shadcn's Command still wraps cmdk, so the runner-up works, but it's dormant. |
| Toasts | **sonner 2.0.x** (2.0.8, Aug 2026) | Base UI Toast | Actively maintained, 40M weekly downloads, huge agent familiarity. ([releases](https://github.com/emilkowalski/sonner/releases)) Wrap it in `packages/ui` and add `data-gai-overlay`. |
| Animation | **CSS-first**: Tailwind transitions plus Base UI `data-starting-style` / `data-ending-style` hooks | `motion` 12.x via `LazyMotion` + `m` (~4.6 KB initial) | Needed only for layout/reorder animations such as dock tabs. ([motion bundle docs](https://motion.dev/docs/react-reduce-bundle-size)) Honour `prefers-reduced-motion` in tokens. |
| Virtualization (lists, transcripts) | **@tanstack/react-virtual 3.14.x** | virtua (~3 KB, `shift` prop for prepend) | May 2026 added chat mode: `anchorTo:'end'`, `followOnAppend`, `scrollEndThreshold`, `isAtEnd()`, `scrollToEnd()`, and streaming growth handling. ([TanStack blog](https://tanstack.com/blog/tanstack-virtual-chat)) Caveat: the React Compiler flags `useVirtualizer` as incompatible ([#1119](https://github.com/TanStack/virtual/issues/1119), open), so add `'use no memo'` to virtualized components. |
| Forms (~40 fields) | **TanStack Form 1.x** (1.33+) + zod 4 via Standard Schema | react-hook-form 7.88 + `useWatch` | TanStack Form is stable, needs no zod adapter, has fully typed field paths, and its `createFormHook` lets `packages/ui` pre-register `TextField`/`SelectField`, which agents then just compose. ([v1](https://tanstack.com/blog/announcing-tanstack-form-v1), [shadcn guide](https://ui.shadcn.com/docs/forms/tanstack-form)) RHF has more training data, but v8 is in beta with breaking changes (`fields.id` → `key`), and v7's `watch()` is a React Compiler incompatibility. ([v8 migration](https://react-hook-form.com/migrate-v7-to-v8)) |
| Icons | **lucide-react 1.x** (1.0 on 23 Jun 2026; 1.47 now) | Tabler / Phosphor | 1.0 ships ESM+CJS only, sets `aria-hidden` by default, adds a React context provider for default size/stroke (useful for 14/16px dense icons), and **removes brand icons**. ([InfoQ](https://www.infoq.com/news/2026/06/lucide-v1-icons/)) The ~9 `Github` usages need a local SVG or Simple Icons. Named imports tree-shake. |
| Fonts | **@fontsource-variable/instrument-sans** + **@fontsource-variable/jetbrains-mono** | manual woff2 in `public/` | npm-installed, Vite fingerprints the woff2 as assets, so it works offline in Electron with no CDN. ([instrument-sans](https://www.npmjs.com/package/@fontsource-variable/instrument-sans), [jetbrains-mono](https://www.npmjs.com/package/@fontsource-variable/jetbrains-mono), [variable guide](https://fontsource.org/docs/getting-started/variable)) Import only the latin subset CSS to keep the asset count down. |
| Streaming markdown | **Streamdown 2.x** (Vercel) | react-markdown 10.1 + block memoisation | Drop-in replacement for react-markdown, built for incomplete streamed markdown. Plugins: `@streamdown/code` (Shiki v4), Mermaid, math, CJK. Recent a11y labels and height caps. ([repo](https://github.com/vercel/streamdown), [releases](https://github.com/vercel/streamdown/releases)) It's Tailwind-styled, so add an `@source` for its dist. react-markdown 10.1's last publish was about 2 years ago and it isn't streaming-aware. ([npm](https://www.npmjs.com/package/react-markdown)) |
| Code highlighting | **Shiki 4** with fine-grained imports (`shiki/core` + `shiki/engine/javascript` + per-language) | highlight.js (current) | `@pierre/diffs` already peer-depends on `shiki ^3 \|\| ^4`, so one highlighter serves diffs, markdown and file views. The JS regex engine avoids WASM and shrinks the bundle. ([best performance](https://shiki.style/guide/best-performance), [regex engines](https://shiki.style/guide/regex-engines)) Use a CSS-variables theme mapped to design tokens so all 18 themes recolour code with no extra theme JSON. Remove `highlight.js` and `rehype-highlight`. |

## 8. Platform

- **Vite 6.4 → 8.3.x.**
  - Vite 8 shipped 12 Mar 2026 with Rolldown as the single bundler (10–30× faster builds). `@vitejs/plugin-react` **v6** uses Oxc instead of Babel. Node 20.19+ / 22.12+. ([Vite 8](https://vite.dev/blog/announcing-vite8))
  - 8.1 (23 Jun) added experimental full-bundle mode. ([8.1](https://vite.dev/blog/announcing-vite8-1))
  - Rolldown 1.0 went stable 7 May 2026.
  - "rolldown-vite" is obsolete; it merged into Vite 8.
  - Check `rollup-plugin-visualizer`, `@vitejs/plugin-basic-ssl`, Storybook and Vitest peer ranges at upgrade time.
- **React Compiler 1.0** (stable 7 Oct 2025). ([react.dev](https://react.dev/blog/2025/10/07/react-compiler-1))
  - **Adopt it**, but on Vite 8 the old `react({ babel: { plugins } })` form no longer works. Use `reactCompilerPreset()` from plugin-react v6 with `@rolldown/plugin-babel` + `babel-plugin-react-compiler`. ([setup guide](https://recca0120.github.io/en/2026/04/14/react-compiler-vite-v6/))
  - The officially flagged incompatible APIs are `useVirtualizer`, RHF `watch()` and `useReactTable`. ([incompatible-library lint](https://react.dev/reference/eslint-plugin-react-hooks/lints/incompatible-library))
  - zustand selector hooks and TanStack Query aren't on that list (zustand uses `useSyncExternalStore`). Enable the `eslint-plugin-react-hooks` v7 compiler lints and treat `incompatible-library` as an error, so agents add `'use no memo'` explicitly.
  - Measure `@xyflow/react` canvases before and after enabling.
- **React Router 7 → v8** (8.0 on 17 Jun 2026, 8.2 on 8 Jul). ([InfoQ](https://www.infoq.com/news/2026/08/react-route-v8/), [Remix blog](https://remix.run/blog/react-router-v8))
  - ESM-only, middleware on by default. **`react-router-dom` is removed**; import from `react-router`. Requires React ≥19.2.7 and Vite ≥7.
  - It's a mechanical upgrade for data mode (`createBrowserRouter` plus lazy routes).
  - **Don't switch to TanStack Router.** Its win is typed search params and state-first routing ([comparison](https://www.pkgpulse.com/blog/tanstack-router-vs-react-router-v7-2026)). But the Electron app keeps little state in the URL, and the move would touch every route, loader and link for modest gain. React Router also has more agent familiarity. Wrap route params with zod parsers where typing matters.
- **TypeScript: move to 6.0 now; adopt 7.x for `tsc` once 7.1 lands.**
  - TS 7.0 (Go-native, 8–12× faster) went GA in summer 2026 (reported 8 Jul / 3 Aug). ([InfoQ](https://www.infoq.com/news/2026/08/typescript-7-released/), [MS blog](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/))
  - It has **no programmatic API until 7.1** (beta targeted Oct 2026), so typescript-eslint type-aware rules can't run on it. ([analysis](https://ecorpit.com/typescript-7-migration-readiness-eslint-astro-blockers-2026/))
  - Interim option: use TS 7 `tsc --noEmit` for fast CI typechecks and alias `typescript` → `@typescript/typescript6` for ESLint.
  - 6.0 turns deprecations into errors, so fix them first.
- **Electron 42** ships Chromium 148 (released 7 May 2026). ([Electron 42](https://www.electronjs.org/blog/electron-42-0)) Modern CSS such as `@starting-style`, container queries and `:has` is safe.

## 9. Design-token tooling

**Recommendation: keep the custom TS generator (`packages/design-tokens`). Optionally add a DTCG `.tokens.json` emitter as one more output.**

- Style Dictionary v5 now uses the stable **DTCG 2025.10** format as its default, with `.tokens.json` files. Terrazzo reads the same format, and Figma, Penpot, Sketch and Tokens Studio all interoperate on it. ([Style Dictionary DTCG](https://styledictionary.com/info/dtcg/), [Terrazzo DTCG](https://terrazzo.app/docs/guides/dtcg/), [overview](https://blog.codercops.com/blog/design-tokens-2026-w3c-format-guide))
- Reasons not to switch:
  - The generator already has typed theme definitions, WCAG contrast tests in TS, and custom emitters (CSS, React Native, **ANSI for the TUI**). Neither tool offers an ANSI emitter; you would write custom formats and transforms anyway.
  - Agents edit typed TS definitions more safely than nested JSON.
  - The 18 × 2 × 7 matrix is computed (accents derived), which JSON-first pipelines express poorly.
  - Figma interop is the only thing DTCG buys you, and a single DTCG emitter covers it without migrating.
- Add two emitters: the `@theme inline` CSS layer from §4, and the tailwind-merge scale lists from §3, so class names, merge config and CSS never drift.

---

## Recommended stack table

| Area | Action | Target |
|---|---|---|
| React | Keep (bump) | react / react-dom ≥19.2.7 (required by RR8) |
| Headless primitives | **Replace** Radix → Base UI | `@base-ui/react` ^1.8 |
| Distribution | Add | `shadcn` CLI v4 for seeding into `packages/ui` (base-* style, monorepo `components.json`) |
| Variants | Keep (start using) | `class-variance-authority` 0.7.1 |
| Class merge | **Upgrade** | `tailwind-merge` ^3.7 + `extendTailwindMerge` generated from tokens; `clsx` ^2.1 |
| Tailwind | Upgrade | `tailwindcss` + `@tailwindcss/vite` ^4.3 |
| Tailwind lint | Add | `eslint-plugin-better-tailwindcss` ^4.7 (`no-unknown-classes`, `no-conflicting-classes`, `no-restricted-classes`) |
| Architecture lint | Add | `eslint-plugin-boundaries` + `no-restricted-imports`; `dependency-cruiser` optional |
| Workshop | Add | Storybook ^10.6 (`@storybook/react-vite`, `addon-vitest`, `addon-a11y`, `addon-mcp`) |
| Visual regression | Add | Vitest 4 browser screenshots or Playwright `toHaveScreenshot`, Linux Docker baselines, sampled theme matrix |
| Split panes | Add | `react-resizable-panels` ^4.13 |
| Command palette | **Remove** cmdk | Base UI Autocomplete + Dialog composite |
| Toasts | Keep | `sonner` ^2.0.8 (wrapped) |
| Animation | Keep CSS-only | `motion` ^12 only if layout animations are needed (LazyMotion) |
| Virtualization | Keep (bump) | `@tanstack/react-virtual` ^3.14 (chat anchoring) |
| Forms | Add | `@tanstack/react-form` ^1.33 + `zod` ^4 |
| Icons | **Upgrade** | `lucide-react` ^1.47 (replace `Github` brand icon) |
| Fonts | Add | `@fontsource-variable/instrument-sans`, `@fontsource-variable/jetbrains-mono` |
| Markdown | **Replace** | `streamdown` ^2 + `@streamdown/code` (drop `react-markdown`, `remark-gfm` if covered) |
| Highlighting | **Replace** | `shiki` ^4 fine-grained, JS engine, CSS-var theme; **remove** `highlight.js`, `rehype-highlight` |
| Router | **Upgrade** | `react-router` ^8.2 (remove `react-router-dom`) |
| Build | **Upgrade** | `vite` ^8.3, `@vitejs/plugin-react` ^6 |
| Compiler | Add | `babel-plugin-react-compiler` ^1 via `reactCompilerPreset` + `@rolldown/plugin-babel`; `eslint-plugin-react-hooks` ^7 |
| TypeScript | Upgrade | 6.0 now; 7.x `tsc` after 7.1 (typescript-eslint API) |
| Tests | Keep / upgrade | Vitest ^4 (happy-dom for unit, browser mode for components), Playwright e2e |
| Tokens | Keep | custom generator; add emitters for Tailwind `@theme inline`, tailwind-merge scales, optional DTCG JSON |
| Other deps | Keep | TanStack Query 5, zustand 5, @xyflow/react 12, dagre, xterm 6, @pierre/diffs + trees, qrcode |

## Risks

1. **Agent familiarity with Base UI.** It went v1 in Dec 2025, so models have far less Base UI code than Radix code; expect `asChild` habits where Base UI uses `render`. Mitigations:
   - Agents consume the `packages/ui` API rather than Base UI directly (enforced by `no-restricted-imports`).
   - Install the shadcn skills.
   - Expose the Storybook MCP manifest.
   - Keep a short `packages/ui/AGENTS.md`-style usage guide in CLAUDE.md.
2. **Electron overlay detection regressions.** Any library change breaks selector-based detection silently. Mitigate with the `data-gai-overlay` contract plus a Playwright test per overlay type over the browser tab.
3. **tailwind-merge misclassification** of custom `text-*` / `radius-*` names silently drops classes. Mitigate by generating the merge config from tokens and unit-testing `cn()` against every token name.
4. **React Compiler plus mutable-return libraries** (TanStack Virtual, xyflow internals) can produce stale UI. Mitigate with the `incompatible-library` lint as an error, `'use no memo'` on virtualized/canvas components, and e2e scroll/stream tests.
5. **Toolchain churn in one go** (Vite 8, RR8, TS 6, Tailwind 4.3, Storybook 10). Do the upgrades in order: Vite 8 + plugin-react 6, then RR8, then TS 6, then the compiler. Do them *before* the component rewrite so failures are attributable.
6. **TS 7 / typescript-eslint gap** until 7.1 (beta Oct 2026). Don't make `typescript` 7 the lint dependency yet.
7. **Visual-regression flakiness across OSes.** Baselines must come from one pinned Linux image. Cross-platform correctness has to be checked with real-app runs on each OS, not pixel diffs.
8. **Streamdown maturity and styling coupling.** It's opinionated and Tailwind-class-based, so its classes must pass `no-unknown-classes` or be excluded, and it needs an `@source`. Fallback: react-markdown 10 plus your own incomplete-markdown repair.
9. **cmdk dormancy** if you choose Radix instead: it still works on React 19, but expect no fixes.
10. **Bundle growth** (Base UI about 10 KB gz over Radix, Shiki grammars). Keep `check:bundle` budgets and lazy-load Shiki languages and Mermaid.
