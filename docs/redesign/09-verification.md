# 09 — Verification, testing and guardrails

How every redesign change is checked: the mechanical guardrails (D-03), the Storybook workshop (D-10), visual regression (D-34), characterization tests before the Phase 4 splits, the per-task verification loop, and the e2e, performance and accessibility checks.

Read `01-decisions.md` first. This document implements D-03, D-10, D-19, D-33 and D-34 and assumes the D-04 folder layout (`apps/web/src/{ui,blocks,features,app}`).

Phase keys used below: **P0** docs & rails · **P1** tokens + registries · **P2** backend track · **P3** Slice A (shell + ChatsList) · **P4** Slice B (chat workspace) · **P5** fan-out · **P6** settings · **P7** lockdown · **PW** workflow surfaces (built by the Workflow Overhaul Plan, D-35).

Owner requirements that apply to every section:
- A feature is verified by **driving the running app in a real browser** with the repo's `playwright-cli` (`node_modules/.bin/playwright-cli --browser=chrome --headed`), as a user would. Unit tests are required as well, but they are not enough on their own.
- Git and source-control features are tested against a **throwaway dummy repo** (§6.6), never against the GeneratorAI checkout.
- **Windows, Linux and macOS are all first-class.** No fix may be correct on only one of them. Scripts in this document are Node (`.mjs`), not bash, and use `path`/`os.tmpdir()`.
- When a walkthrough needs a real Codex model, use **GPT-5.6-Terra or GPT-5.6-Luna**. Never use GPT-5.3-Codex-Spark.

---

## 1. Current test inventory (measured on `desktop_redesign @ a83a7bf`, 2026-09-25)

### 1.1 Unit and component tests (Vitest)

| Area | Files | Notes |
|---|---|---|
| `apps/web` total | **69 files / 650 tests**, all green in about 14 s | `pnpm --filter @generatorai/web test` → `apps/web/vitest.config.ts` (happy-dom, setup `src/__tests__/setup.ts`) |
| `src/__tests__/components` | 19 | BrowserPanel ×3 (WebCodecs, Visibility, Denied), RightPane, RightPanePanels, ChatMessageList, PermissionCard, RewindMenu, ModelPickerUnavailable … |
| `src/__tests__/stores` | 12 | streamStore, sseManager, eventRouting, gapFillLoss, workflowRunStore … |
| `src/__tests__/pages` | 4 | `ChatPage.test.tsx` is a render-isolation harness and never mounts `ChatPage`. Also PullRequestPage, SettingsPage, WorkflowBuilderPage |
| `src/__tests__/{ui,platform,scm,hooks,providers,utils,…}` | 22 | includes `useTwoPhaseStop`, `twoPhaseStopParity`, `SearchableSelect`, `surfaceCapabilities` |
| co-located `components/**/__tests__` | 11 | agent timeline derivations (5), diff helpers (3: `keptFiles`, `changeVisibility`, `checkpointGroups`), chat (3: `promptHistory`, `changePaths`, `sourceModel`) — all pure functions |
| `packages/design-tokens` | 2 | `tokens.test.ts` (WCAG AA suite: every theme × mode × accent) and `emit.test.ts` |
| `apps/desktop` | 15 | node environment, main-process logic |

Helpers: `src/__tests__/helpers/renderWithProviders.tsx` (ThemeProvider + QueryClient with no retry + `PlatformContext` + `MemoryRouter`) and `MockPlatformClient.ts`. The mock is a `vi.fn` implementation of the **legacy** session, workflow and run `IPlatformClient` methods. It has no chats, workspaces, models or SSE, so it cannot drive the app in a browser.

**Config drift to fix in P0.** The root `vitest.config.ts` defines a `web` project that uses **jsdom** and `apps/web/vitest.setup.ts`, which has the stronger shims (storage, `scrollIntoView`, `ResizeObserver`, `Blob.arrayBuffer`). `pnpm turbo test` and CI use `apps/web/vitest.config.ts` instead: **happy-dom** with the weaker `src/__tests__/setup.ts`. The two configs will diverge further once Storybook adds a browser project. P0 makes `apps/web/vitest.config.ts` the single source:
1. Move `apps/web/vitest.setup.ts` into place as the only setup file and delete `src/__tests__/setup.ts`.
2. Keep happy-dom.
3. Change the root config's web project to `extends: './apps/web/vitest.config.ts'`, or drop it and list `apps/web` in the root `projects`.

`@testing-library/user-event` is not installed. P0 adds it as a devDependency of `apps/web`.

### 1.2 End-to-end

- `agent-tests/e2e/*.spec.ts`: **13 specs, 1,957 lines**. Run with `pnpm --filter @generatorai/agent-tests test:e2e` using `agent-tests/playwright.config.ts` (1440×900, chromium, 1 worker, 1 retry on CI). They need web on :5173 and the server on :3100. Selectors: 157 `getByRole`, 48 `getByText`, 10 `getByPlaceholder`, 17 testid (10 `getByTestId` + 7 raw `[data-testid]`), 0 `getByLabel`. Helpers: `helpers/api.ts` (REST seeders + `ResourceTracker` auto-cleanup) and `helpers/test.ts` (`gotoApp` waits for `load`, never `networkidle`; `mockAiStream` replays SSE).
- Legacy root-level specs (`browser-ui-e2e`, `hooks-e2e`, `workflow-*-e2e`, `streaming-automation-e2e`, `error-boundary`) are excluded (`testDir: './e2e'`) and kept for reference only. The root `playwright.config.ts` is an old agent config (`testDir: './agent-tests'`, 1280×720). Nothing in CI uses it, and P0 deletes it.
- About 30 `agent-tests/*.mjs` smokes drive Electron through `playwright-core`'s `_electron`, or drive the server directly. Desktop smokes that touch the UI: `desktop-chrome-smoke`, `desktop-smoke`, `right-pane-desktop-smoke`, `desktop-browser-smoke`, `desktop-p2-browser-smoke`, `terminal-desktop-smoke`, `desktop-diff-review-smoke`, `desktop-diff-render-check`. They run **manually**. Only `concurrent-load-1q.mjs` runs in CI, with `continue-on-error`.
- **Already-stale selectors:** `right-pane-desktop-smoke.mjs` waits for `chat-toggle-right-pane`, `chat-toggle-right-pane-banner` and `right-pane-add-inspector`. None of these exist in `apps/web/src`. P0 repairs them against the current UI so that P3/P4 start from a green baseline.
- Screenshot tests: **0** `toHaveScreenshot` anywhere. Storybook: none. Automated a11y: none.
- Web source carries **209 `data-testid` attributes in 54 files** (184 static, 25 template-literal, e.g. `right-pane-tab-${type}`).

### 1.3 What CI runs (`.github/workflows/ci.yml`)

- `build-and-test`: Ubuntu on PRs; Ubuntu + Windows + `macos-26` on push. Steps: `pnpm turbo build` → `pnpm lint` (turbo lint + security, durability, docs, syncio and `check:tokens`) → **`check:design`** (Ubuntu) → `turbo typecheck` → `turbo test` → **`check:bundle`** (Ubuntu) → CLI docs, schema drift, coverage and the packaged-CLI smoke.
- `e2e`: Ubuntu, a real gate. It runs the bundled server with `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1` and a temp DB, Vite dev on :5173, and then `test:e2e`.
- `concurrent-load-test` and `benchmarks` (both reporting-only), `mobile-bundle`, `container`.
- **Trigger gap:** `on.push/pull_request.branches` is `[main, dev]`. PRs into `arch-redesign` (the default branch) or `desktop_redesign` run **no CI**. P0 adds both branches, or switches to `branches-ignore: []`.

### 1.4 Gaps this plan closes

| Gap | Closed in |
|---|---|
| `ChatInput.tsx` (2,122 lines) has 0 tests. `ChangesSurface.tsx` has only a pure helper test. `NativeBrowserView.tsx` has none. `ChatPage` is never mounted. | §5, before any P4 split |
| No screenshots, Storybook or a11y automation | §3, §4, §9 |
| The design ratchet baseline is stale (`rawButtonElement` 44 → actual 0; `rawInputElement` 40 → 20; palette 314 → 299) and `--update` can **raise** counts | §2.2 |
| No check that Tailwind actually emitted the design utilities | §2.4 |
| `.claude/launch.json` runs `pnpm start:web`, which does not exist | §6.2 |
| No isolated, deterministic app server for screenshots | §4.2 |

---

## 2. Guardrail checks (P0 builds the rails, P1 fills them with the new vocabulary)

### 2.1 Extend `apps/web/scripts/check-design-system.mjs`

Keep the current rules and restructure the rule table so each rule has its own `exempt` list and a `scope`:
- `scope: 'all'` counts everywhere and ratchets downward.
- `scope: 'new'` must be **exactly 0** inside `src/ui`, `src/blocks`, `src/features` and `src/app`.

Every rule gets both treatments: the count over the whole of `src/` ratchets, and the count under the new folders is hard-zero from the day the folder exists. Test files and `src/styles/**` stay exempt. The legacy `src/components/ui/**` stays exempt for the rules it already skips.

New rules. Regexes are JavaScript. Today's counts were measured with these exact patterns and become the P0 baseline.

| Rule | Pattern | Exempt | Today |
|---|---|---|---|
| `defaultTextSize` | `/(?<![\w-])text-(?:xs\|sm\|base\|lg\|xl\|[2-9]xl)(?![\w-])/g` | — | 933 |
| `whiteBlackClass` | `/(?<![\w-])(?:bg\|text\|border\|ring\|fill\|stroke\|from\|to\|via\|outline\|divide\|decoration\|caret\|accent)-(?:white\|black)(?![\w-])/g` | — | 33 |
| `defaultRadius` | `/(?<![\w-])rounded(?:-[trblxyse]{1,2})?(?:-(?:xs\|sm\|md\|lg\|xl\|[234]xl))?(?![\w-])/g` (does not match `rounded-full`, `rounded-none`, `rounded-card`) | — | 733 |
| `defaultShadow` | `/(?<![\w-])shadow(?:-(?:2xs\|xs\|sm\|md\|lg\|xl\|2xl\|inner))?(?![\w-])/g` | — | 82 |
| `hardcodedPaletteClass` | existing | — | 299 |
| `arbitraryValue` | `/(?<=^\|[\s"'\x60{])(?:[\w-]+:)*!?-?[a-z][\w-]*-\[[^\]\s]+\]/gm`. Utility-shaped only, so `arr[0]` is not matched. Also add `/(?<=^\|[\s"'\x60{])\[[a-z-]+:[^\]\s]+\]/gm` (arbitrary properties). | `ui/lib/**` (the one sanctioned place, for Radix/Base UI CSS-variable passthroughs; each one needs a comment) | 2,246 |
| `varInClassString` | `/\[(?:[\w-]+:)?var\(--\|-\(--[\w-]+\)/g` (v3 `-[var(--x)]` and v4 `-(--x)` forms) | — | 1,419 |
| `legacyColorVar` | `/var\(--color-[\w-]+\)/g` (in `.ts/.tsx`; the `.css` layer is exempt) | — | 1,487 |
| `legacyTokenUtility` | built at runtime: `(?<![\w-])(?:bg\|text\|border\|ring\|fill\|stroke\|outline\|divide\|from\|to\|via\|shadow\|accent\|caret\|decoration\|placeholder)-(?:<legacy names>)(?:\/\d+)?(?![\w-])`. `<legacy names>` is read from `packages/design-tokens` (P1 exports `LEGACY_UTILITY_NAMES`; until then, parse the `--color-*` keys of the legacy `@theme inline` block in `globals.css` and subtract the D-08 design names). | — | measure in P1 |
| `hexOrRgbInTs` | `/(?<![&\w])#(?:[0-9a-fA-F]{8}\|[0-9a-fA-F]{6}\|[0-9a-fA-F]{3,4})(?![\w-])/g` plus `/\b(?:rgba?\|hsla?\|oklch\|oklab)\(/g`, `.ts/.tsx` only | `components/shared/VendorIcons.tsx` (brand colours) | 30 |
| `lucideDirectImport` | `/from\s+['"]lucide-react['"]/g` | `src/ui/icons/**` | 135 |
| `rawHeadlessImport` | `/from\s+['"](?:@radix-ui\/[\w-]+\|radix-ui\|@base-ui(?:-components)?\/react[\w/-]*\|cmdk)['"]/g` | `src/ui/**`, legacy `src/components/ui/**` | 2 |
| `unstyledVariant` | `/variant=["']unstyled["']\|variant:\s*['"]unstyled['"]/g` | — | 42 |
| `radixOverlaySelector` (P4) | `/data-radix-popper-content-wrapper\|--radix-/g` | — | count at P4; must reach 0 with D-19 |

Output: keep the current `▲ FAIL / ▼ improved / · unchanged` lines. For every failing rule, print **file:line** for each new occurrence, not only the top 5 files. Compute them by diffing against `design-system-baseline.files.json`, a per-file count map written by `--update`. LLM sessions fix what they can see; a count alone sends them hunting.

### 2.2 Ratchet policy

- Baselines live in `apps/web/design-system-baseline.json` (counts) and `design-system-baseline.files.json` (per-file counts).
- `--update` writes `min(baseline, now)` per rule. **It can never raise a count.** To raise one, edit the JSON by hand in a PR whose description has a "Ratchet increase" section giving the rule, the delta and the reason. The playbook forbids this except in D-02 migration scaffolding.
- CI runs `check:design --strict`. It fails when any count **rises** and also when any count **fell without the baseline being lowered**, so every improvement is locked in by the PR that made it. P0's first commit re-baselines the stale numbers from §1.4.
- `scope: 'new'` counts are not in the baseline. They are always 0.
- When a rule's whole-`src` count reaches 0 it moves to a `locked` array, and from then on any occurrence fails. P7 lockdown requires `defaultTextSize`, `whiteBlackClass`, `defaultRadius`, `defaultShadow`, `hardcodedPaletteClass`, `legacyTokenUtility`, `legacyColorVar` and `varInClassString` to be locked before the D-07 namespace reset and the removal of the D-06 legacy layer.
- CI placement: the existing "Check web design-system ratchet" step in `build-and-test` (Ubuntu), before typecheck. It reads source only.

### 2.3 ESLint additions (root `eslint.config.mjs`)

Add devDependencies at the root: `eslint-plugin-better-tailwindcss`, `eslint-plugin-boundaries` and `eslint-import-resolver-typescript`. Then add three config blocks after the existing web design-system block.

**Flat-config trap (already documented at the bottom of the file):** a later block that matches the same files **replaces** a rule rather than merging it. Every new `no-restricted-imports` or `no-restricted-syntax` block for `apps/web/src/**` must therefore repeat the existing `lucide-react` `Loader2` path and the raw `<button>`/`<select>` selectors. Build them from shared constants (`const WEB_RESTRICTED_IMPORT_PATHS = [...]`) so they are not copy-pasted.

```js
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import boundaries from 'eslint-plugin-boundaries';
import { fileURLToPath } from 'node:url';
const WEB_CSS = fileURLToPath(new URL('./apps/web/src/styles/globals.css', import.meta.url)); // absolute: turbo lints from apps/web

// (a) Tailwind vocabulary, new code only
{
  files: ['apps/web/src/{ui,blocks,features,app}/**/*.{ts,tsx}'],
  ignores: ['**/*.stories.tsx', '**/__tests__/**', '**/*.test.tsx'],
  plugins: { 'better-tailwindcss': betterTailwind },
  settings: { 'better-tailwindcss': { entryPoint: WEB_CSS, callees: ['cn', 'cva', 'clsx', 'twMerge'] } },
  rules: {
    'better-tailwindcss/no-unknown-classes': ['error', { ignore: ['^app-drag-region$', '^no-drag$', '^group(/.+)?$', '^peer(/.+)?$'] }],
    'better-tailwindcss/no-conflicting-classes': 'error',
    'better-tailwindcss/no-duplicate-classes': 'error',
    'better-tailwindcss/no-deprecated-classes': 'error',
    'better-tailwindcss/no-unnecessary-whitespace': 'warn',
    'better-tailwindcss/no-restricted-classes': ['error', { restrict: [
      { pattern: '^(.*:)?text-(xs|sm|base|lg|xl|\\d?xl)$', message: 'Use the D-13 scale: text-micro|small|ui|body|title|heading|display.' },
      { pattern: '^(.*:)?(bg|text|border|ring|fill|stroke|outline|divide|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d+(/\\d+)?$', message: 'Palette classes are off-system. Use design tokens (D-08).' },
      { pattern: '^(.*:)?(bg|text|border|ring|fill|stroke)-(white|black)(/\\d+)?$', message: 'Use fg/surface/on-accent tokens.' },
      { pattern: '^(.*:)?rounded(-[trblxyse]{1,2})?(-(xs|sm|md|lg|xl|\\dxl))?$', message: 'Use rounded-badge|control-sm|control|seg|card|panel|dialog (D-14).' },
      { pattern: '^(.*:)?shadow(-(2xs|xs|sm|md|lg|xl|2xl|inner))?$', message: 'Only shadow-pop / shadow-none exist.' },
      { pattern: '\\[.+\\]', message: 'No arbitrary values. Add a token or a kit variant.' },
      { pattern: '^(.*:)?h-(\\d+(\\.\\d+)?|px)$', message: 'Heights come from density variables: h-control-sm|h-control|h-control-lg|h-row|h-bar|h-tab|h-nav (D-15).' },
      // P1 appends one entry built from LEGACY_UTILITY_NAMES: legacy semantic utilities are banned in new code.
    ] }],
  },
},
```

Pure layout heights (`h-full`, `h-screen`) still pass. The `h-<n>` restriction applies only to fixed heights.

```js
// (b) Boundaries (D-04)
{
  files: ['apps/web/src/**/*.{ts,tsx}'],
  plugins: { boundaries },
  settings: {
    'import/resolver': { typescript: { project: fileURLToPath(new URL('./apps/web/tsconfig.json', import.meta.url)) } },
    'boundaries/include': ['apps/web/src/**/*'],
    'boundaries/elements': [
      { type: 'ui',       pattern: 'apps/web/src/ui/**',              mode: 'full' },
      { type: 'blocks',   pattern: 'apps/web/src/blocks/**',          mode: 'full' },
      { type: 'features', pattern: 'apps/web/src/features/*/**',      mode: 'full', capture: ['domain'] },
      { type: 'app',      pattern: 'apps/web/src/app/**',             mode: 'full' },
      { type: 'platform', pattern: 'apps/web/src/platform/**',        mode: 'full' },
      { type: 'data',     pattern: 'apps/web/src/{stores,hooks,lib,utils,providers,types,audio}/**', mode: 'full' },
      { type: 'legacy',   pattern: 'apps/web/src/{components,pages}/**', mode: 'full' },
      { type: 'root',     pattern: 'apps/web/src/*.{ts,tsx}',         mode: 'full' },
    ],
  },
  rules: {
    'boundaries/element-types': ['error', { default: 'disallow', rules: [
      { from: 'ui',       allow: ['ui'] },
      { from: 'blocks',   allow: ['ui', 'blocks', 'data', 'platform'] },
      { from: 'features', allow: ['ui', 'blocks', 'data', ['features', { domain: '${from.domain}' }]] },
      { from: 'app',      allow: ['ui', 'blocks', 'features', 'data', 'platform', 'legacy'] },
      { from: 'data',     allow: ['data', 'platform'] },
      { from: 'platform', allow: ['platform', 'data'] },
      { from: 'legacy',   allow: ['legacy', 'ui', 'blocks', 'data', 'platform'] },   // migration scaffolding; deleted in P7
      { from: 'root',     allow: ['app', 'ui', 'data', 'platform', 'legacy'] },
    ] }],
  },
},
```

`features` excludes `platform`: D-04 says features reach the platform only through hooks. Allowing `blocks → platform` is a judgment call because some blocks are query-aware. If `03-component-inventory.md` shows no block needs it, remove it. If the installed major of `eslint-plugin-boundaries` renames `element-types` to `dependencies`, use the equivalent rule. The element definitions stay the same.

```js
// (c) no-restricted-imports per layer. The three file sets are DISJOINT, so no block replaces another's rule.
const LUCIDE = { name: 'lucide-react', message: 'Import icons from @/ui/icons by concept (D-17).' };
const HEADLESS = { group: ['@radix-ui/*', 'radix-ui', '@base-ui/*', '@base-ui-components/*', 'cmdk'], message: 'Headless primitives are wrapped in @/ui/primitives (D-05).' };
const UI_LAYER = [
  { group: ['@tanstack/react-query', 'react-router', 'react-router-dom', 'zustand', 'zustand/*', '@generatorai/client-core', '@generatorai/client-runtime'], message: 'ui/ is presentational: pass data and callbacks in as props.' },
  { group: ['@/stores/*', '@/platform/*', '@/hooks/*', '@/features/*', '@/blocks/*', '@/components/*', '@/pages/*'], message: 'ui/ may import only ui/ (D-04).' },
];
// everything outside ui/ (legacy included): warn until P7, ratcheted by §2.1 (135 lucide, 2 headless hits today)
{ files: ['apps/web/src/**/*.{ts,tsx}'], ignores: ['apps/web/src/ui/**'],
  rules: { 'no-restricted-imports': ['warn', { paths: [...WEB_RESTRICTED_IMPORT_PATHS, LUCIDE], patterns: [HEADLESS] }] } },
// ui/ except the icon registry: headless allowed, lucide and data layers not
{ files: ['apps/web/src/ui/**/*.{ts,tsx}'], ignores: ['apps/web/src/ui/icons/**'],
  rules: { 'no-restricted-imports': ['error', { paths: [...WEB_RESTRICTED_IMPORT_PATHS, LUCIDE], patterns: UI_LAYER }] } },
// the icon registry: the only lucide importer
{ files: ['apps/web/src/ui/icons/**/*.{ts,tsx}'],
  rules: { 'no-restricted-imports': ['error', { paths: WEB_RESTRICTED_IMPORT_PATHS.filter((p) => p.name !== 'lucide-react'), patterns: UI_LAYER }] } },
```

`WEB_RESTRICTED_IMPORT_PATHS` holds the existing `lucide-react` `Loader2` → `<Spinner>` entry. Filtering it out of the icon registry is deliberate: the registry maps the loader concept.

Severity: (a), (b) and the two `ui/` blocks of (c) are `error` from P0 because they match only the new folders, which start empty. The outside-`ui/` block of (c) matches legacy code too, so it starts as `warn`, is ratcheted by §2.1, and becomes `error` in P7. In new folders the same imports are already hard-zero through the `scope: 'new'` ratchet.

### 2.4 CSS-emission check (`apps/web/scripts/check-css-emission.mjs`, P0 skeleton, P1 active)

This catches C3/M4 silent breakage: a missing or wrong `@source`, a broken `@theme inline` block, a namespace reset that blanks classes. tsc, ESLint and Vitest cannot see any of these.

1. Runs after `vite build`. It reads every `dist/assets/*.css` into one string.
2. **Required list.** `REQUIRED_UTILITIES` is exported by `packages/design-tokens` (P1), with at least one utility per design namespace: `bg-ground bg-surface bg-raised bg-overlay bg-sunken bg-hover bg-selected border-line border-line-soft border-line-strong text-fg text-fg-2 text-fg-3 bg-accent text-on-accent text-run bg-run-bg text-ok text-warn text-err bg-add-bg bg-del-bg shadow-pop bg-scrim text-micro text-small text-ui text-body text-title text-heading text-display rounded-badge rounded-control-sm rounded-control rounded-seg rounded-card rounded-panel rounded-dialog h-control-sm h-control h-control-lg h-bar h-tab h-row h-nav`. Each must appear as a selector (`.` + CSS-escaped class) **and** its declaration must reference `var(--gai-…)`. That second condition catches an `@theme` mapping that points at a missing variable.
3. **Derived list.** Extract every class token from string literals inside `className=`, `cn(`, `cva(` and `clsx(` in `src/{ui,blocks,features,app}/**`. Keep the tokens whose base utility belongs to the design vocabulary (prefix match against `REQUIRED_UTILITIES` namespaces). Assert each is emitted, including variant forms: `hover:bg-hover` → `.hover\:bg-hover:hover`. If a class is written in a file Tailwind does not scan, it is missing here.
4. **Runtime variables.** For each theme id and each mode, `[data-theme="<id>"]` (or the P1 selector) must define `--gai-ground`, `--gai-fg` and `--gai-accent`. This catches `tokens:write` not having run.
5. It exits non-zero and lists the missing selectors. Script: `"check:css": "node scripts/check-css-emission.mjs"`. CI: `build-and-test` on Ubuntu, right after `check:bundle` (it reuses the same `dist/`).

Before P1 the required list is empty and the script only checks that the CSS parses and that `@theme` variables exist. From P1 it is fully active.

### 2.5 tailwind-merge conflict test (P1, D-09)

`apps/web/src/ui/lib/__tests__/cn.test.ts`. The `cn` built with `extendTailwindMerge` must satisfy, for every density and theme (merging is static, so one run is enough):

| Input | Expected |
|---|---|
| `cn('text-fg-2','text-title')` | both kept (colour vs size) |
| `cn('text-ui','text-title')` | `text-title` |
| `cn('text-fg','text-fg-3')` | `text-fg-3` |
| `cn('text-micro','text-on-accent')` | both kept |
| `cn('bg-surface','bg-raised')` | `bg-raised` |
| `cn('border-line','border-line-strong')` | `border-line-strong` |
| `cn('rounded-control','rounded-card')` | `rounded-card` |
| `cn('rounded-badge','rounded-full')` | `rounded-full` |
| `cn('shadow-pop','shadow-none')` | `shadow-none` |
| `cn('h-control','h-control-sm')` | `h-control-sm` |
| `cn('h-row','h-full')` | `h-full` |
| `cn('px-2','px-3')` | `px-3` (defaults still merge) |
| `cn('text-run','text-ok')` | `text-ok` |

Add a generated case: for every token in `REQUIRED_UTILITIES`, `cn(x)` returns `x` (nothing is dropped as unknown). The theme groups are generated from `packages/design-tokens`, so a new token that is not added to the merge config fails this test.

### 2.6 Tokens check and WCAG suite

- `pnpm check:tokens` (already part of `pnpm lint`) fails when `globals.css` and the mobile tokens are stale against the generator. P1 extends `bin/generate.ts` to emit the `--gai-*` layer, the `@theme inline` design mappings, `REQUIRED_UTILITIES`, `LEGACY_UTILITY_NAMES` and the tailwind-merge groups. The `--check` mode covers all of them.
- `packages/design-tokens/src/__tests__/tokens.test.ts`, extended in P1 for D-11 and D-12: iterate **18 themes × 2 modes × 7 accents (252 combinations)** and assert:
  - `fg`, `fg-2` and `fg-3` ≥ 4.5:1 on ground, surface, raised, overlay and sunken, and on `hover`/`selected` composited over surface;
  - `on-accent` on `accent` ≥ 4.5:1;
  - `line-strong` ≥ 3:1 against surface and raised (inputs, checkbox, switch);
  - `run`, `ok`, `warn` and `err` ≥ 3:1 on surface and ground, and ≥ 4.5:1 where they colour text labels;
  - the **focus ring** colour ≥ 3:1 against ground, surface, raised and overlay;
  - `add-bg`/`del-bg` keep `fg` ≥ 4.5:1;
  - `scrim` + overlay keep dialog text ≥ 4.5:1.

  The test names the failing combination (`theme/mode/accent/token/surface → ratio`).

### 2.7 CI placement summary

| Check | Job | OS | Phase |
|---|---|---|---|
| `check:design --strict` | build-and-test | Ubuntu | P0 |
| ESLint (a)(b)(c) | build-and-test (`pnpm lint`) | all | P0 |
| `check:tokens` + WCAG suite | build-and-test (`pnpm lint`, `turbo test`) | all | exists; extended P1 |
| `check:bundle` (+ font budget §8.1) | build-and-test | Ubuntu | exists; extended P1 |
| `check:css` | build-and-test | Ubuntu | P0 skeleton, P1 active |
| `test:stories` (Storybook + a11y) | new `storybook` job | Ubuntu | P1 |
| VRT (`vrt` stories + routes) | new `vrt` job (Docker) | Ubuntu | P1 (stories), P3 (routes) |
| e2e | `e2e` | Ubuntu | exists |
| desktop smokes | new `desktop-smoke` job, `paths:` filter on shell/dock/overlay/desktop files | Ubuntu (xvfb), Windows, macOS | P3 |

---

## 3. Storybook 10 workshop (D-10)

### 3.1 Location and install (P1-SB; the first primitive stories follow in P3-01)

Storybook lives in `apps/web` because D-04 has one DOM consumer. Install with `pnpm --filter @generatorai/web exec storybook@10 init --type react_vite --no-dev --yes`. Then remove the example stories and add the addons with `storybook add @storybook/addon-a11y`, `storybook add @storybook/addon-vitest` and `storybook add @storybook/addon-mcp`. Pin exact versions in `apps/web/package.json`.

**Vitest version.** `addon-vitest` needs Vitest ≥ 3.2 (the repo has `^3.2.6`). Browser mode on Vitest 4 uses `@vitest/browser-playwright` and is the better-supported path, so this plan uses **Vitest 4 in P1 across the repo** (D-37, task P1-U3). The config below is the Vitest 4 form. On Vitest 3.2, use `provider: 'playwright'` (a string) plus `@vitest/browser` instead.

```
apps/web/.storybook/
  main.ts          framework, stories globs, addons, viteFinal
  preview.tsx      globals toolbar, decorators, a11y parameters, CSS + font imports
  vitest.setup.ts  setProjectAnnotations
  manager.ts       (optional) branding
```

### 3.2 `main.ts`

```ts
import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/ui/**/*.stories.@(ts|tsx)', '../src/blocks/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest', '@storybook/addon-mcp'],
  // react-vite loads apps/web/vite.config.ts automatically: @tailwindcss/vite, react, the '@' alias and define(__APP_VERSION__) come for free.
  async viteFinal(cfg) {
    cfg.plugins = (cfg.plugins ?? []).flat().filter((p) => p && (p as { name?: string }).name !== 'visualizer');
    cfg.server = { ...cfg.server, proxy: undefined };   // stories never call /api
    return cfg;
  },
  // Component manifest for the MCP server. Use the flag documented for the installed 10.x (10.1+: features.experimentalComponentsManifest).
  features: { experimentalComponentsManifest: true },
};
export default config;
```

Stories for `features/` are not allowed. Features are verified by walkthrough and e2e, and stories must not need data. `blocks/` stories pass data through props or a `QueryClient` seeded with `setQueryData` inside a decorator. They never use network mocks.

### 3.3 `preview.tsx`: pipeline, fonts, appearance toolbar

- `import '../src/styles/globals.css'` and the font entry that `main.tsx` uses (P1 adds `src/styles/fonts.ts`, which imports `@fontsource-variable/instrument-sans` and `@fontsource-variable/jetbrains-mono`). This gives stories exactly the app's Tailwind output and fonts.
- **One appearance writer.** P1 (D-25) extracts `applyAppearance({ mode, theme, accent, density, fontSize, reduceMotion })` from `ThemeProvider.tsx` into `src/ui/lib/appearance.ts`. ThemeProvider and the pre-paint logic call it, and the Storybook decorator calls it too. Storybook never writes `localStorage`.
- Toolbar (`globalTypes` + `initialGlobals`), all with `toolbar.dynamicTitle: true`:
  - `mode`: dark | light, default dark.
  - `theme`: all 18 ids from the design-tokens registry, default `instrument`.
  - `accent`: ink | blue | violet | green | orange | rose | teal, default `ink`.
  - `density`: comfortable | compact.
  - `fontSize`: 12 | 13 | 14, default 13.
  - `reduceMotion`: off | on.
- Decorator: `(Story, ctx) => { useLayoutEffect(() => applyAppearance(ctx.globals), [ctx.globals]); return <div className="bg-surface text-fg p-4"><Story/></div>; }`. The wrapper is omitted for `parameters.layout === 'fullscreen'`, which shell and template stories use.
- `parameters: { a11y: { test: 'error' }, layout: 'centered', backgrounds: { disable: true } }`. `a11y.test: 'error'` makes a violation fail the Vitest run. A single story may downgrade a specific rule only with `parameters.a11y.config.rules: [{ id, enabled: false }]` plus a comment linking the reason. Downgrading `color-contrast` is forbidden, because contrast is owned by tokens.
- `tags: ['autodocs']`.

### 3.4 addon-vitest (browser mode)

`apps/web/vitest.config.ts` becomes two projects:

```ts
import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
const dirname = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  resolve: { alias: { '@': `${dirname}src` } },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', globals: true, environment: 'happy-dom', setupFiles: ['./vitest.setup.ts'],
        include: ['src/**/*.test.{ts,tsx}'] } },
      { extends: true, plugins: [storybookTest({ configDir: `${dirname}.storybook`, storybookScript: 'pnpm storybook --ci' })],
        test: { name: 'storybook', setupFiles: ['./.storybook/vitest.setup.ts'],
          browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] } } },
    ],
  },
});
```

`.storybook/vitest.setup.ts`:

```ts
import { setProjectAnnotations } from '@storybook/react-vite';
import * as a11y from '@storybook/addon-a11y/preview';
import * as preview from './preview';
setProjectAnnotations([a11y, preview]);
```

The browser project uses the Chromium that Playwright installs (`pnpm --filter @generatorai/web exec playwright install chromium`). It does **not** use the `--browser=chrome` channel, because CI has no Chrome. Every story is rendered and its `play` function runs as a test. A story without `play` is a smoke test plus an axe test.

### 3.5 MCP server and Claude Code

`@storybook/addon-mcp` serves MCP over HTTP at **`http://localhost:6006/mcp`** while `storybook dev` runs. P1 registers it for the project:

```
claude mcp add --transport http storybook http://localhost:6006/mcp --scope project
```

This writes the repo-root `.mcp.json`. Commit it:

```json
{ "mcpServers": { "storybook": { "type": "http", "url": "http://localhost:6006/mcp" } } }
```

Before building or changing any `ui/`/`blocks/` component, the session starts Storybook (`pnpm --filter @generatorai/web storybook`, or the `storybook` entry in `.claude/launch.json`). It then queries the MCP tools to list existing components and read their props and stories. Run `/mcp` in Claude Code to see the exact tool names of the installed version. `10-llm-playbook.md` makes this the first step of any kit task. If the server is not running, the tools are unavailable and the session must start it. It must not guess.

### 3.6 Story conventions

- One file per component: `src/ui/primitives/Button/Button.stories.tsx`, next to `Button.tsx`. CSF 3: `const meta = { component: Button, … } satisfies Meta<typeof Button>; export default meta; type Story = StoryObj<typeof meta>`.
- Title = folder path (`ui/primitives/Button`). No manual `title`.
- **All variants × all states.** Each cva variant axis gets one `Matrix` story that renders the full cartesian grid (variant × size × tone). States each get a story: `Default`, `Hover` (via the `pseudo` parameter from `storybook-addon-pseudo-states`, added as a devDependency), `FocusVisible` (play: `userEvent.tab()`), `Pressed`, `Disabled`, `Loading`, `Invalid`, `LongText` (overflow and truncation), `Empty` where relevant, and `Compact` (density global forced through `globals: { density: 'compact' }`).
- **Interaction stories use `play`:** open/close, keyboard navigation, and the return of focus to the trigger. Every floating component asserts that `data-gai-overlay` is present on its floating layer (D-19) with `expect(document.querySelector('[data-gai-overlay]')).not.toBeNull()` after opening.
- Stories never fetch. Time comes from `parameters.fixedNow` (a decorator stubs `Date.now`) so relative times are stable.
- Tags: `vrt` is on by default and `!vrt` opts out. `vrt-themes` adds the light and Solarized combinations (§4.3) and is used for every shell part, template, composite and status component.
- A component PR without a story fails review. `check-stories.mjs`, run inside `check:design`, fails when a `*.tsx` under `src/ui/{primitives,patterns,shell,templates}` exports a component and has no sibling `*.stories.tsx`.

### 3.7 Scripts

`apps/web/package.json`:

```json
"storybook": "storybook dev -p 6006 --no-open",
"build-storybook": "storybook build -o storybook-static --quiet",
"test": "vitest run --project unit",
"test:stories": "vitest run --project storybook",
"check:design": "node scripts/check-design-system.mjs && node scripts/check-stories.mjs",
"check:css": "node scripts/check-css-emission.mjs"
```

`turbo.json`:

```json
"build-storybook": { "dependsOn": ["^build"], "outputs": ["storybook-static/**"] },
"test:stories":    { "cache": false },
"check:css":       { "dependsOn": ["build"], "cache": false },
"vrt":             { "cache": false }
```

`.gitignore`: add `apps/web/storybook-static/`. CI adds a `storybook` job on Ubuntu: `pnpm install` → `playwright install --with-deps chromium` → `pnpm --filter @generatorai/web test:stories`.

---

## 4. Visual regression (D-34)

### 4.1 Tooling decision

One tool and one container cover both surfaces: **Playwright Test `toHaveScreenshot`** (`@playwright/test` 1.58.2, already in `agent-tests`). The config is `agent-tests/vrt/playwright.vrt.config.ts`, with two projects:

- **`stories`** screenshots the **static Storybook build** (`storybook-static`, served with `vite preview --outDir storybook-static --port 6007`). The test reads `storybook-static/index.json`, keeps the entries with `type === 'story'` and the `vrt` tag, and for each one opens `iframe.html?id=<id>&viewMode=story&globals=mode:<m>;theme:<t>;accent:ink`. It waits for `document.fonts.ready`, then screenshots `#storybook-root`.
  - Vitest 4 browser-mode screenshots were rejected. They would need a second baseline store and a second pinned environment, and they cannot screenshot app routes.
- **`routes`** screenshots about 12 key routes of the real app, served by a production `vite build` + `vite preview` on :5197 that proxies `/api` to an isolated seeded server on :3197.

### 4.2 Routes: seeded isolated server, not a MockPlatformClient

**Decision: seeded test server.** The app renders against the real bundled server (`apps/server/dist-bundle/server.mjs`), configured as follows:
- a fresh temp DB (`DB_PATH`), artifacts dir (`ARTIFACTS_DIR`) and workspaces dir (`WORKSPACES_DIR`) under `os.tmpdir()/generatorai-vrt-*` — the server reads these **bare** names (`apps/server/src/index.ts`); `GENERATORAI_DB_PATH` is ignored and silently opens the developer's default DB;
- `GENERATORAI_BIND_HOST=127.0.0.1`, `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1`, `NODE_ENV=test`, `PORT=3197`;
- `GENERATORAI_LOAD_TEST_FAUX_HARNESS=true`, so every conversation runs on the deterministic `FauxProvider`.

This is already proven by `concurrent-load-1q.mjs` and the CI `e2e` job.

Justification:
- `MockPlatformClient` is a Vitest-only `vi.fn` object for the legacy session API. The browser app talks to `HttpPlatformClient` over REST plus the SSE mux, and it has chats, workspaces, models, projects, agents and the attention feed (P2). An in-browser mock would be a second backend that drifts from the real one.
- D-36 forbids placeholder data in the app, so the screenshots should show what real API shapes produce.
- A real server also exercises serialization and the SSE paths that the redesign rewires (sidebar Needs you/Running).

Rules:
- It **never uses :3100 or the developer's DB**, matching the Workflow Overhaul Plan's rule for its isolated test server. When that plan's P00 WP-0.3 test server and FauxProvider testkit land, VRT, sandbox and e2e switch to them instead of keeping a parallel setup.
- **Seeding:** `agent-tests/vrt/seed.ts` (Playwright `globalSetup`) reuses the `helpers/api.ts` seeders. It creates fixed-name projects, chats (active, archived, needs-you), agents, workflows and automations, and writes their ids to `agent-tests/vrt/.seed.json` for the specs.
- **Transcript-rich states** (tool cards, diffs, plans) need a scripted Faux run. P2 adds a test-only `GENERATORAI_TEST_FAUX_SCRIPT=<path.json>` that loads `FauxScriptEntry[]` per conversation name. Fixtures live in `agent-tests/vrt/fixtures/*.faux.json`, and file edits happen in a seeded dummy repo (§6.6) so the Changes dock has real diffs. Until P2 lands it, those states are covered by stories only.
- **Determinism:**
  - Call `page.clock.setFixedTime(new Date('2026-09-01T10:00:00Z'))` before navigation.
  - Mask every `[data-gai-time]` (the kit's `<Time>` primitive renders all relative and absolute times with this attribute) and every `[data-gai-volatile]` (ids, temp paths, ports, PIDs).
  - `stylePath: agent-tests/vrt/vrt.css` hides carets and scrollbars and sets `animation: none` and `transition: none`, on top of D-20's `data-motion="reduce"`, which the init script also sets.

### 4.3 Matrix

| Surface | Appearance combos | Viewport |
|---|---|---|
| Stories (tag `vrt`) | Instrument dark | story size |
| Stories (tag `vrt-themes`) | Instrument dark, Instrument light, Solarized light | story size |
| Routes | Instrument dark, Instrument light, **Solarized light** | **1440×900** and **1100×760** (the 1100 width exercises rail mode <1200 and the dock sheet) |
| Routes, full run (`vrt:full`, on merge) | adds Solarized dark to complete D-34's 2×2×2 | same |

The accent is always `ink`. Density is always comfortable, except `Compact` stories. Appearance for routes is set with an init script that calls `localStorage.setItem` on the ThemeProvider keys before load: today `generatorai-theme`, `generatorai-theme-palette` and `generatorai-accent`, plus the P1 density and font-size keys. Screenshot names follow `<route>-<w>-<theme>-<mode>.png`.

Routes (about 12; each is baselined from the moment it exists and re-baselined in the PR that ports it):

| # | Route / state |
|---|---|
| 1 | `/` Home (Dashboard until ported) |
| 2 | `/chats` |
| 3 | `/chats/:id`, dock closed, transcript with tool cards |
| 4 | `/chats/:id`, dock open on Changes |
| 5 | `/chats/:id`, dock on Terminal (xterm mocked blank via `data-gai-volatile`) |
| 6 | `/chats/:id`, composer "waiting on you" state |
| 7 | `/projects` |
| 8 | `/projects/:id` |
| 9 | `/agents` |
| 10 | `/settings/appearance` (modal over Home) |
| 11 | command palette open over `/chats` (Ctrl/Cmd K) |
| 12 | 404 (`/nope`) |

Browser tabs are not screenshotted, because the native view does not exist in a web page. Workflow and automation routes join in PW.

### 4.4 Pinned Linux container: `docker/vrt.Dockerfile`

```dockerfile
# Visual-regression runner. The tag MUST equal @playwright/test in agent-tests/package.json;
# scripts/redesign/vrt.mjs refuses to run when they differ.
FROM mcr.microsoft.com/playwright:v1.58.2-noble
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-color-emoji fontconfig \
 && rm -rf /var/lib/apt/lists/* && fc-cache -f
# UI and mono text come from the app's bundled Fontsource files (D-16); system fonts only back emoji and
# missing glyphs, and are fixed by this image.
ENV TZ=UTC LANG=en_US.UTF-8 GAI_VRT_CONTAINER=1 CI=1
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY agent-tests ./agent-tests
COPY templates ./templates
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @generatorai/server... build && pnpm --filter @generatorai/server bundle \
 && pnpm --filter @generatorai/web build && pnpm --filter @generatorai/web build-storybook
CMD ["pnpm", "--filter", "@generatorai/agent-tests", "exec", "playwright", "test", "-c", "vrt/playwright.vrt.config.ts"]
```

`scripts/redesign/vrt.mjs` is a cross-platform wrapper, run with `pnpm vrt` (root script `"vrt": "node scripts/redesign/vrt.mjs"`). It:
1. checks that the Docker CLI exists and that the Playwright versions match;
2. runs `docker build -f docker/vrt.Dockerfile -t generatorai/vrt .`;
3. runs `docker run --rm --ipc=host -v <repo>/agent-tests/vrt/__screenshots__:/repo/agent-tests/vrt/__screenshots__ -v <repo>/agent-tests/test-results:/repo/agent-tests/test-results generatorai/vrt …`, forwarding `--project`, `--grep` and `--update`.

The bind mounts contain only baselines and results. Host `node_modules` are never mounted, because macOS and Windows native binaries do not run in Linux.

`playwright.vrt.config.ts`:
- `snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}'` (no platform suffix, since there is only one platform);
- `retries: 0`, `workers: 2`, `fullyParallel: true`;
- `use.deviceScaleFactor: 1`;
- `expect.toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', threshold: 0.2, maxDiffPixelRatio: 0.0005 }` for stories and `maxDiffPixelRatio: 0.002` for routes;
- `webServer` entries for the API server, `vite preview` of the app (:5197), and `vite preview --outDir storybook-static` (:6007).

`globalSetup` throws unless `GAI_VRT_CONTAINER === '1'`, so a baseline can never be produced on a developer's host OS.

### 4.5 Baselines, updates, flakes

- Baselines are committed in `agent-tests/vrt/__screenshots__/`. Budget: stories about 20 KB each and routes about 150 KB each. If the folder passes 60 MB, move it to Git LFS.
- **Updating:** `pnpm vrt --update` runs Playwright with `--update-snapshots=changed`. The PR must include a **"VRT changes"** section listing every changed baseline and why ("intended: ChatsList row height 44 (D-15)"). The session opens each changed PNG with the Read tool and compares it with the old one (`git show HEAD:<path> > tmp`) before committing. A change nobody can explain is a regression.
- **Thresholds are not tuned to make a failure pass.** A mismatch is either an intended change (update the baseline) or a bug (fix it).
- **Flakes:** `toHaveScreenshot` already requires two consecutive identical frames. When a snapshot flips between runs, reproduce it with `pnpm vrt --grep "<name>" --repeat-each=10`. Fix the source (unfrozen time, font not awaited, animation, async layout, unmasked volatile text), or tag the story `!vrt` with a TODO naming the cause. Never raise `maxDiffPixelRatio`.
- CI: a `vrt` job on Ubuntu builds the image (with GitHub layer caching) and runs `stories` from P1 and `routes` from P3. On failure it uploads `agent-tests/test-results/` (the expected/actual/diff triplets).

### 4.6 Board renderer and side-by-side review PNGs

The `.dc.html` boards need a runtime (`support.js`) that is not in the repo. All 60 web boards share one structure:
- `<x-dc><helmet>…</helmet>…</x-dc>`, where the helmet holds the Google Fonts `<link>` and the `<style>` with `.t-dark`, `.t-light` and `.acc-*`;
- a single `{{rootClass}}` placeholder on the root `.app` div;
- an inert `<script type="text/x-dc" data-props='{"mode":…,"accent":…,"$preview":{"width":W,"height":H}}'>` whose `renderVals()` returns `'t-' + mode + ' acc-' + accent`.

Only `ChatLight` defaults to light. Preview sizes vary (1440×900 for most; 1100×760, 1280×800, 1600×1024, and tall pages up to 2780).

**`scripts/redesign/render-boards.mjs`** (P0-01):
1. Arguments: `--only=ChatsList,Home` (default all), `--modes=dark,light` (default both), `--accent=ink`, `--out=docs/redesign/boards/png`.
2. For each `docs/redesign/boards/web/*.dc.html`:
   - Parse `data-props` to get `$preview` width and height.
   - Remove `<script src="./support.js"></script>` and the `text/x-dc` script.
   - Move the `<helmet>` contents into `<head>` and unwrap `<x-dc>`.
   - Replace `{{rootClass}}` with `t-<mode> acc-<accent>`.
3. **Fonts:** if `@fontsource-variable/instrument-sans` and `@fontsource-variable/jetbrains-mono` resolve (after P1), replace the Google Fonts `<link>` with inline `@font-face` rules pointing at their `file://` woff2 URLs, under the family names the boards use (`"Instrument Sans"`, `"JetBrains Mono"`). This renders offline with the same bytes as the app. Otherwise keep the link and warn.
4. Validate: fail if any `{{`, `<x-` or `<helmet` remains, or if `data-props` has props other than `mode` and `accent`. That signals a board-format change the script must learn.
5. Write the transformed HTML to `os.tmpdir()/generatorai-boards/`. Open it with `playwright-core` Chromium at viewport = preview size and `deviceScaleFactor: 1`, `await document.fonts.ready`, and screenshot the page clipped to the preview size into `<out>/<Board>.<mode>.png`. Print a table of board → file.

**`scripts/redesign/side-by-side.mjs --board ChatsList --mode dark --shot docs/redesign/shots/chats/1440x900-instrument-dark.png`** makes a small HTML page with the two PNGs side by side at equal height, each labelled "board" and "app", and screenshots it to `docs/redesign/shots/<route>/compare-<w>-<mode>.png`. It uses Playwright, so no image library is added.

`.gitignore` gets `docs/redesign/boards/png/` and `docs/redesign/shots/**/*.png`. PNGs are reproducible. The written diff lists (`docs/redesign/shots/<route>/DIFF.md`) are committed.

---

## 5. Characterization tests (P4, written and green **before** any split)

These tests lock the **current** behaviour. Each is written against the component's public entry point and mocks only the **data layer** (`@/hooks/*Queries`, `@/stores/*`, `@/platform/*`), because those paths do not move during the split. When the component moves to `features/chat/…`, only the import line in the test changes. A test that has to change its assertions during a split is exposing a regression, or an intended change that is recorded in the PR.

Location: `apps/web/src/__tests__/characterization/`. Tooling: Vitest + RTL + `@testing-library/user-event`, with `vi.useFakeTimers({ shouldAdvanceTime: true })` where timing matters. e2e specs go in `agent-tests/e2e/`, and Electron checks go in the smokes. A behaviour that is a known defect is written as `it.fails(...)` with a `// DEFECT:` note, so fixing it later flips the test on purpose.

### 5.1 ChatInput (`ChatInput.characterization.test.tsx`, split into files by area if it passes about 600 lines)

Harness: `renderComposer(props, { slashCommands, fileIndex, models })` wraps `renderWithProviders` and uses `vi.mock('@/hooks/composerQueries')` for `useSlashCommands` and `useWorkspaceFileIndex`. It also stubs `platform.getWorkspaceFileContent` and mocks `useSpeechToText` with a controllable fake. Selectors: `getByRole('textbox', { name: 'Message' })`, the buttons "Send message", "Attach file", "Start voice input", and the testids `composer-attachment`, `chat-agent-chip`, `chat-input-skeleton`.

- **Slash menu.**
  - Opens only when the whole value starts with `/`, the caret is in the first token and no command is active.
  - Fuzzy filter over name and description, capped at 50.
  - ↑/↓ wrap around. Enter or Tab selects.
  - Escape closes the menu only; the text is kept.
  - Selecting turns the command into a pill and clears the text. Backspace on empty text removes the pill.
  - The menu closes 120 ms after blur.
  - On send, `cmd.format(raw, template)` is applied. A template load failure shows the warning toast and sends the raw input.
  - A builtin's `onBuiltinCommand` runs before dispatch, and its failure is swallowed.
- **@ mention.**
  - Triggers only with a `workspaceId` and an `@` at the start or after whitespace, with no whitespace between the `@` and the caret.
  - Selection removes the `@query` text and adds a `text/plain` attachment chip (`source: 'mention'`), showing "Attaching…" while it loads.
  - A duplicate label is not added twice.
  - A fetch failure shows the toast "Could not attach {label}".
- **Prompt history.**
  - ↑ works only with a collapsed selection and the caret on the first line; ↓ only on the last line.
  - From the draft, ↑ goes to the newest entry. Going past the oldest falls through to normal caret movement. ↓ past the newest restores the parked draft, text and attachments included.
  - Recalled attachments are re-fetched. A failed fetch drops only that chip and shows a warning.
  - A stale async recall does not overwrite a newer one.
  - The local history is capped at 50.
- **Draft restore.** The `restoredDraft {text, at}` prop is applied once per `at`. It focuses the input and puts the caret at the end. The same `at` is ignored the second time.
- **Send.**
  - `canSend` truth table (text / pill / attachments / captures × disabled / loading / blocked by an interaction / blocked by workspace prep).
  - Enter sends only when the surface declares `sendShortcut`. Shift/Ctrl/Cmd+Enter inserts a newline at the caret.
  - A rapid double Enter sends once (`sendingRef`).
  - Attachments with an empty prompt auto-fill the canned sentence. The browser-comment variant is used for `element-*`/`region-*` files.
  - A send error restores the text, pill and attachments, and calls `clearStream`.
  - **DEFECT:** Enter during IME composition sends. Write it as `it.fails` and fix it in P4.
- **Stop / two-phase stop** (ChatInput renders; `useTwoPhaseStop` owns the timing):
  - While streaming, the Stop button is shown, with `aria-label` from `stopState.label`, and it is disabled while `!stopState.enabled`.
  - `forceAvailable` renders the "Force reset" pill.
  - An integration test (`ChatComposer.stop.test.tsx`) mounts ChatInput with the real `useTwoPhaseStop`. The first press sends one cancel. A double tap within 400 ms sends nothing more. After 15 s with the turn still live, the label becomes Force reset and the press sends `force: true`. It stands down when `isLive` goes false. D-29 keeps this timing.
- **Attachments.**
  - Picking files works only when `COMPOSER.attachments` is set.
  - A pasted unnamed file becomes `pasted-<ts>.jpg`.
  - Drop always calls `preventDefault`.
  - Removing by id works.
  - An image chip shows a hover preview.
  - Long file names truncate the stem but keep the extension.
  - Pending captures render as muted chips with remove buttons.
- **Dictation.** State labels go idle → connecting → listening → paused → transcribing → error: "Start voice input", "Cancel voice input", "Resume dictation", "Stop and insert text".
  - Partial text is revealed at 70 ms per word and catches up after 6 words.
  - Typing, pasting or clicking pauses dictation.
  - Cancel restores the pre-dictation snapshot only if the user made no manual edit.
  - "scratch that" retracts the last utterance.
  - Errors show the "Voice input" toast.
- **Blocking bars.**
  - Workspace prep `pending`/`preparing` blocks Send but not typing. `error` shows `workspace-prep-error` with Retry and Edit sources.
  - `pendingInteractionLabel` shows the `role="status"` banner. "Cancel and send" calls `onCancelPendingInteraction`.
- **Chips.**
  - A stale `selectedModel` is replaced by the displayed model only when the catalog is conclusive.
  - The mode chip "Agent mode: …" is a listbox that closes on outside click or Escape.
  - Below 420 px of toolbar width, the reasoning and context pills collapse into the ⋯ menu.
  - The skeleton shows while models are pending.
  - The textarea grows automatically up to 200 px.

e2e (`agent-tests/e2e/composer.spec.ts`, real server with FauxProvider): type `/`, pick a builtin, send → the user bubble appears; ↑ recalls it; attach a file via `setInputFiles`; the "waiting on you" banner comes from a Faux script that asks a question (P2 script hook).

### 5.2 BrowserPanel and NativeBrowserView

Neither file has a `data-testid`. **Their aria-labels and titles are the contract and must be kept verbatim:** "Native browser view", "Dismiss", "Add tab", "Integrated browser for this chat", the badge text "Paused (overlay open)".

Vitest (`BrowserPanel.characterization.test.tsx`; mocks `muxStream`, `authTransport` and `fetch`, stubs `window.generatoraiDesktop.browser`, as the existing BrowserPanel tests do):
- **Mode.** With `browser.available()` true, the panel is native and full-interactive. Without it, web interactivity follows `generatorai:browser:webInteractivity`, and toggling it notifies other mounts through the `storage` event.
- On desktop it auto-starts once per workspace.
- **Descriptor polling:** 400 ms while starting or not ready, 4 s otherwise, 2 s after an error. A 401 or 403 stops polling permanently and shows the "isn't granted to this device" copy (the existing test is kept).
- **SSE.** `browser.session_created`, `stopped`, `updated`, `navigation` and `error` each cause a refetch. `browser.selection` attaches a JSON file via `onCapture` and turns Inspect off.
- **URL bar.** A missing scheme gets `https://`. Navigating before the session is ready calls start. Back, forward and reload go to native IPC when available and to REST otherwise. `about:blank*` and `#gai-` URLs are hidden. A fresh native tab shows a blank URL and does not inherit the workspace URL.
- **Screencast.** Resize pushes need a change of at least 256 px, are debounced 400 ms and skipped below 100×100. Scroll polls every 250 ms (not in native mode). Mouse moves are throttled to 100 ms. F5 and F12 are blocked. Drag-capture needs at least 8×8 px and posts `/capture` with a clip. An invisible panel opens 0 sockets (the existing P1-50 test is kept).
- **Native only:** annotate start, stop and poll at 400 ms; device presets and zoom levels `[0.5 … 2]`; the share toggle is disabled while `agentBusy`.

Vitest (`NativeBrowserView.characterization.test.tsx`; stubs the bridge and `getBoundingClientRect`; fake timers):
- **Lifecycle.** `create(tabId, workspaceId, false)` on mount and `destroy` on unmount. `restoreUrl` is used only when the current URL is not `http(s)`.
- **Bounds.** `setBounds` is called on ResizeObserver, window resize and scroll (capture phase), scheduled through rAF and DPR-snapped. It is skipped when the size is under 4 px.
- **Overlay loop, every 100 ms.** `setVisible(false)` when the container is hidden (`visibility:hidden` on an ancestor, or a size under 4 px). `setVisible(false)` when an element matching the current `OVERLAY_SELECTORS` list intersects the container. On the transition back to visible it calls `setVisible(true)` + `setActiveTab`. On unmount it hides.
- **Placeholder.** The screenshot is polled every 2 s while watched and every 1 s otherwise, only while not hidden. Navigation or load events refresh it after 250 ms.

**D-19 tests (written in P4 together with the contract change; they replace the selector-list cases):**
- `data-gai-overlay` overlapping the view hides it.
- An overlay that is an **ancestor** of the container (the narrow dock sheet) does not hide it ("browser tab inside narrow dock sheet stays visible").
- A menu over the browser tab hides it.
- The maximized dock keeps it visible.
- The toast layer hides it only when they overlap.

Desktop smoke `agent-tests/desktop-dock-browser-smoke.mjs` (new in P4-06; one file holding `06-desktop-and-shell.md` §4.5 cases 1–7 and this per-overlay loop — an earlier draft called it `desktop-overlay-smoke.mjs`): open a chat with a Browser tab. Then, for each overlay kind (menu, popover, select, combobox, tooltip, dialog, sheet, toast, command palette), open it over the view and assert the "Paused (overlay open)" badge is visible; close it and assert the badge is gone. Resize the window to 1100 and assert that the dock sheet shows the native view unobscured. Run it on all three OSes (§6.7).

### 5.3 ChangesSurface (`ChangesSurface.characterization.test.tsx`)

Mocks: `@/hooks/queries` (`useWorkspaceChangeSummary`, `useWorkspaceCheckpoints`, `useDiscardWorkspaceChanges`, `useReviewWorkspaceChanges`, `useEditors`, `useOpenInEditor`), `@/hooks/sourceQueries`, `@/hooks/reviewQueries`; `DiffCodeView` is stubbed to a list of rows (Shiki and workers are not needed). Testids (keep verbatim): `keep-file`, `unkeep-file`, `keep-all`, `undo-file`, `confirm-undo-file`, `undo-all`, `kept-group`, `kept-group-toggle`, `changes-count`, `changes-kept-count`, `changes-workspace-files-toggle`, `mount-groups`, `open-file-in-editor`.

- **Keep.** Keep sends `{keep:[{alias,path,blob}]}`, with `blob:''` for a deleted file, and shows a per-row spinner that is not global. Unkeep sends `{unkeep:[…]}`. Keep all sends `{keepAll:true}` without a confirm, and is disabled while busy or when everything is already kept.
- **Undo.** Undo file opens an inline confirm. On confirm it sends `discard {files:[{alias, path}]}` with a **repo-relative** path (this guards a known bug class). It is shown only when the alias has a base treeish. Undo all opens the confirm dialog "Undo all changes?" (destructive) and then sends `{all:true}`. Skipped paths produce a warning toast. A failure shows the dismissible error banner.
- **Kept.** The "Kept (N)" group toggles, and focusing a kept file opens it automatically.
- **Compare against** (`aria-label="Compare against"`): the options are "Since session start", "Branch base (…)" per mount, and turns or checkpoints (at most 30). Choosing one refetches with `{base, head:'working'}`.
- **Tree/list.** "Show/Hide file tree" (default hidden). The tree position comes from the settings popover and opens the tree. The Unified/Split and Wrap toggles are in the "View settings" popover.
- **Expand.** Expand all / collapse all. A change set of 3 files or fewer is auto-expanded. Binary and too-large files cannot be opened.
- **Focus.** The `focusFile` token, a tree click and a mount-group click set the active row and scroll to it.
- **Multi-mount and workspace files.** The mount-groups bar appears only when there is more than one mount. The workspace-files toggle appears only when files are hidden. "Open in editor" appears only when an editor is available or the app is on desktop.
- **Checkpoints.** The panel is an overlay when the **surface** width is below 760 px, and beside the diff otherwise.
- **States.** "No workspace yet — …", "Loading changes…", "No changes detected in this workspace."

e2e (`agent-tests/e2e/changes-dock.spec.ts`, dummy repo + Faux edit script): Keep one file → the Kept count goes up; Undo one file → the file is restored on disk (check with `git status` in the dummy repo); Undo all → the confirm dialog, then a clean tree. Desktop: extend `desktop-diff-review-smoke.mjs`.

### 5.4 ChatPage (`ChatPage.characterization.test.tsx`; the existing render-isolation harness stays)

Mocks: `@/hooks/queries`, `@/hooks/sourceQueries`, `@/stores/*` (use the real `useStreamStore` with actions), `connectChatSession` and `openMultiplexedStream` (fake emitters), and `fetch` for the browser descriptor.

- **Routing.** No `chatId` navigates to `/`. While the chat record loads, the skeleton shows (messages do not gate it). An error or missing chat shows "Chat not found" and "Go back".
- **Paging.** 100 messages are loaded first. "Load earlier messages" is shown when the count equals the limit, and each click adds 100.
- **Composer.** It is rendered only when the chat is active and has a session. An archived chat shows the banner and no composer. `fork-provenance` is shown only when the chat is forked.
- **Optimistic bubble dedup.** Three cases: matched by turnId, by content fallback, and by trimming after the last user message.
- **Right-pane persistence.** Open state: `generatorai:rightPane:chat:open`. Tabs are per chat: `generatorai:rightPane:chat:<chatId>`. Width is global: `generatorai:rightPane:chat:width`. Switching chats resets the browser focus token and the background-tasks auto-open (the file calls out the regression "Background Tasks follows you into a worker chat").
- **Auto-open.** `browser.session_created` opens Browser only when `config.visibility === 'visible'` or it is undefined. `computer.session_started` and `computer.consent_required` always open Computer. A new full-page widget opens once, and a re-render refocuses it rather than duplicating it.
- **Tab caps.** Browser 5, Terminal 4, Widget 6, file tabs 8. Tasks exists only for orchestrator chats and Computer only when enabled. The `addableRightPaneTabsFor` ledger is respected.
- **Pending gates.** Blocks from the polled pending interactions expire only if they were opened before `dataUpdatedAt`. The label differs for plan review, tool permission and generic gates. The working banner reads "Paused — waiting for your input" or "Generating response…".
- **Scroll.** Stick-to-bottom keys on `length:blocks:status` and not on the text. "Jump to latest" appears once the user has scrolled up.

### 5.5 RightPane → dock (`RightPane.characterization.test.tsx`; the existing `RightPane*.test.tsx` stay)

Covered today: one active tab, panels stay mounted, caps and the cap notice, narrow sheet and Escape, the width clamp and keyboard resize, memoised panels. **Add:**
- The default tab is first and cannot be closed. Closing the active tab selects the previous one. `onTabClose` fires after the state update.
- `reconcileState` drops unknown types, reinserts the default and fixes a stale active tab.
- A `storageKey` change paints the new scope's tabs **on the first frame** (no flash of the previous chat's tabs).
- At the cap, the notice clears after 6 s and the **oldest** instance is focused. `focusTabRequest` with an explicit `tabId` focuses that instance.
- Fullscreen exits when the pane closes. Narrow = `(max-width: 767.98px)` **or** host width under 760. In narrow mode there is no resize handle or fullscreen toggle.
- Escape is ignored when the top of `composedPath` is a dialog.
- Inactive panels are `visibility:hidden` (`invisible`) with `aria-hidden`, never `display:none`. `NativeBrowserView.isContainerHidden()` relies on this (D-27).
- The overflow menu `right-pane-tab-overflow` lists tabs clipped by more than 2 px.

P4's dock swaps `useResizablePane` for react-resizable-panels 4 (D-27/D-38). The resize tests are rewritten in that PR against the new handle, which is keyboard-operable with `role="separator"` and aria values. **The dock keeps the `right-pane*` testids** (§7.2).

---

## 6. Per-task verification loop (P0-02 copies §6.1 into `.claude/CLAUDE.md`)

### 6.1 The loop (in order; stop and fix at the first failure)

```text
0. Before a ui/blocks task: start Storybook (launch.json "storybook") and query the storybook MCP for existing components.
1. pnpm --filter @generatorai/web typecheck
2. pnpm --filter @generatorai/web lint
3. pnpm --filter @generatorai/web check:design            # ratchet + stories-present; --strict in CI
4. pnpm --filter @generatorai/web exec vitest related --run --project unit <changed source files>
5. pnpm --filter @generatorai/web exec vitest run --project storybook <touched *.stories.tsx>   # if ui/ or blocks/ changed
6. If tokens/CSS/deps changed: pnpm check:tokens && pnpm --filter @generatorai/design-tokens test
   && pnpm --filter @generatorai/web build && pnpm --filter @generatorai/web check:bundle && pnpm --filter @generatorai/web check:css
7. playwright-cli walkthrough (§6.3) → shots in docs/redesign/shots/<route>/ at 1440×900 and 1100×760,
   Instrument dark + Instrument light + Solarized light; console must show no new errors.
8. node scripts/redesign/render-boards.mjs --only=<Board>  &&  node scripts/redesign/side-by-side.mjs …
   → open each compare PNG (Read tool) → write docs/redesign/shots/<route>/DIFF.md
9. The page's e2e spec: pnpm --filter @generatorai/agent-tests exec playwright test -c playwright.config.ts e2e/<spec>.spec.ts
10. pnpm vrt --grep <route|component>   (Docker); if intended changes: pnpm vrt --update … and list them in the PR
11. If the shell, dock, overlays, title strip or desktop code changed: desktop smokes (§6.5) on this OS,
    and the per-OS matrix (§6.7) before merging a shell or dock PR.
12. If SCM/Changes/diff features changed: repeat step 7 against a dummy repo (§6.6).
```

**When each step becomes available.** Steps 1–4, 6 (minus `check:css`), 7, 9 and 11–12 work from P0. `check:css` and `--project unit` come from P0-04; the step 8 scripts from P0-01; `make-dummy-repo.mjs` (step 12) from P0-02; steps 0, 5 and 10 (Storybook, `test:stories`, `pnpm vrt`) from P1-SB; the sandbox on :5197 from P2-00 — until it lands, walk through against `pnpm dev` (:5173) and do destructive actions only on data you created. A step whose tooling has not landed yet is skipped and the PR says so.

`DIFF.md` has three headings:
- **Matches**;
- **Intentional deviations**, each citing a D-xx (for example sample data, or Keep/Undo per D-28);
- **Defects**, each fixed before merge or listed with its follow-up.

"Looks close" is not an entry. Each line names the element and the property (height, colour token, radius, gap, copy).

### 6.2 Running the app

- **Web + server (normal dev):** from the repo root, `pnpm dev` (turbo: `@generatorai/server` on :3100 + Vite on :5173, `/api` proxied). `pnpm dev:web` starts only Vite; pair it with `GENERATORAI_DEV_API_TARGET=http://localhost:<port>` to use another server.
- **Desktop (dev mode):** keep `pnpm dev` running, then in a second terminal run `pnpm dev:desktop`. `apps/desktop/scripts/dev.mjs` builds main and preload and launches Electron against `DESKTOP_DEV_SERVER_URL` (default `http://localhost:5173`) with HMR. The packaged-mode smokes use `GENERATORAI_DESKTOP_MODE=standalone` after `pnpm --filter @generatorai/desktop build`. Linux custom title bar: `GENERATORAI_LINUX_CUSTOM_TITLEBAR=1 pnpm dev:desktop`.
- **Sandbox (deterministic data, never touches :3100 or the real DB):** `node scripts/redesign/sandbox.mjs` (task P2-00 in `07-phases.md`, together with the Faux-harness rename and `agent-tests/vrt/seed.ts`).
  - It bundles the server if `dist-bundle` is missing.
  - It starts the server on :3197 with a temp DB under `os.tmpdir()/generatorai-sandbox-*` and loopback dev-auth. It uses the Faux harness by default; `--real-harness` switches to real providers.
  - It runs `agent-tests/vrt/seed.ts` and starts Vite on :5197 with `GENERATORAI_DEV_API_TARGET=http://localhost:3197`.
  - Walkthroughs use the sandbox for screenshots and for destructive actions (archive, delete, discard). They use `pnpm dev` when a real provider or the user's real setup is the point of the test.
  - The temp-dir prefix is `generatorai-`, **not** `gai-`/`genai-`, which `scripts/sweep-temp-workspaces.mjs` deletes.
- **`.claude/launch.json`** (P0-02 fixes the broken `start:web` with the `dev` entry; P1-SB adds `storybook`; P2-00 adds `sandbox`). Target state:

```json
{ "version": "0.0.1", "configurations": [
  { "name": "dev",       "runtimeExecutable": "pnpm", "runtimeArgs": ["dev"], "port": 5173 },
  { "name": "sandbox",   "runtimeExecutable": "node", "runtimeArgs": ["scripts/redesign/sandbox.mjs"], "port": 5197 },
  { "name": "storybook", "runtimeExecutable": "pnpm", "runtimeArgs": ["--filter", "@generatorai/web", "storybook"], "port": 6006 }
] }
```

- **Real provider walkthroughs:** Codex uses **GPT-5.6-Terra** or **GPT-5.6-Luna**, never GPT-5.3-Codex-Spark. If the model picker auto-selects an unavailable provider, that is a bug to fix for every OS (select the first *ready* provider), not something to work around locally.

### 6.3 playwright-cli walkthrough (headed Chrome)

Binary: `./node_modules/.bin/playwright-cli` (macOS/Linux) or `.\node_modules\.bin\playwright-cli.cmd` (Windows), from the repo root. Use a named session so parallel work does not collide.

```bash
P=./node_modules/.bin/playwright-cli
$P -s=rd open http://localhost:5197/chats --browser=chrome --headed
$P -s=rd run-code "async page => { await page.setViewportSize({ width: 1440, height: 900 }) }"
$P -s=rd localstorage-set generatorai-theme dark
$P -s=rd localstorage-set generatorai-theme-palette instrument   # key names per ThemeProvider (P1 adds density/font-size keys)
$P -s=rd localstorage-set generatorai-accent ink
$P -s=rd reload
$P -s=rd snapshot                       # read refs; do the task's user flows via click/fill/press as a user would
$P -s=rd screenshot --filename=docs/redesign/shots/chats/1440x900-instrument-dark.png
# repeat: light; palette solarized + light; then viewport 1100×760 for all three
$P -s=rd console error                  # must list no new errors
$P -s=rd close
```

Walkthrough content, per page:
- every designed state reachable by a user (empty, loading, populated, error, hover and menus open, narrow/rail at 1100);
- a keyboard-only pass (§9.2);
- every action the PR touched, performed for real (create, rename, archive … on sandbox data).

File names: `<w>x<h>-<theme>-<mode>[-<state>].png`, with `<route>` as a slug (`chats`, `chat-dock-changes`, `settings-appearance`).

### 6.4 Port PRs

A PR that ports a page flips its `handle.legacyHeader` off, deletes the old files (D-02), updates that page's e2e spec, and follows the selector rule in §7.2.

### 6.5 Desktop smokes

Run from the repo root after `pnpm --filter @generatorai/desktop build` (and the server bundle it stages): `node agent-tests/desktop-chrome-smoke.mjs`, `node agent-tests/right-pane-desktop-smoke.mjs`, `node agent-tests/desktop-browser-smoke.mjs`, `node agent-tests/terminal-desktop-smoke.mjs`, `node agent-tests/desktop-diff-review-smoke.mjs`, and `node agent-tests/desktop-dock-browser-smoke.mjs` (from P4-06). Screenshots go to `agent-tests/test-results/<smoke>/`. Inspect them.

### 6.6 SCM features: dummy repo only

`scripts/redesign/make-dummy-repo.mjs` (P0-02; Node, cross-platform, uses `child_process.execFileSync('git', …)`) creates `os.tmpdir()/generatorai-dummy-repo-<stamp>/`:
- `origin.git`: a bare remote;
- `work/`: a clone with `main` holding 3 commits (`README.md`, `src/app.ts`, `src/util.ts`, `assets/logo.png` binary, `data/big.json` over the diff "too large" threshold);
- a `feature/redesign-test` branch 2 commits ahead, pushed;
- a `conflict-a`/`conflict-b` pair that edits the same line;
- a working tree with one modified, one added, one deleted, one renamed (`git mv`) and one untracked file.

It prints the `work/` path. In the app, add it as a project codebase through the UI, as a user would. `--clean` removes every `generatorai-dummy-repo-*`.

Never point the app's SCM features at `/Users/…/generatorAI`. A walkthrough that finds itself in the real checkout stops and restarts on a dummy repo.

### 6.7 Per-OS matrix (shell, dock, title strip, overlay and theme-writer PRs)

| OS | Configuration | Check |
|---|---|---|
| macOS | default | traffic lights centred in the 44 px sidebar row; rail mode leaves a 44 px drag row and the page header gets the 30 px `--gai-page-inset-left` inset (`06` §3.5); dark/light background at launch (D-25) |
| Windows | default (WCO) | 36 px strip; caption buttons 46×36 not covered; overlay symbol colour follows `--gai-fg` after a theme change; drag regions work, `no-drag` controls click |
| Linux | native frame | strip items in the sidebar header; search stays in the sidebar |
| Linux | `GENERATORAI_LINUX_CUSTOM_TITLEBAR=1` | Windows layout |
| Web | Chrome tab | Linux-native layout; `Ctrl+N`/`Ctrl+1..9` are not bound (D-24) |

For each row: the desktop smokes from §6.5, a playwright-cli walkthrough against the dev renderer (for web), and a screenshot per row saved as `docs/redesign/shots/shell-os/<os>-<variant>.png`.

CI: the `desktop-smoke` job (Ubuntu under `xvfb-run`, `windows-latest`, `macos-26`) runs on PRs whose paths touch `apps/web/src/ui/shell/**`, `apps/web/src/app/**`, `apps/web/src/components/chat/NativeBrowserView.tsx`, the dock, `apps/desktop/**` or `packages/design-tokens/src/chrome*`. The developer covers the OS rows that CI cannot: Linux custom title bar, visual checks of the traffic lights and WCO.

---

## 7. E2E impact plan

### 7.1 What each phase breaks (fix it in the same PR)

| Phase | Specs / smokes affected | Why |
|---|---|---|
| P0 | `right-pane-desktop-smoke.mjs` (already stale: `chat-toggle-right-pane*`, `right-pane-add-inspector`) | Repair against the current UI. Record the green baseline of all 13 specs and the UI smokes in `docs/redesign/shots/BASELINE.md` |
| P1 | usually none; run all | new default theme/accent (D-11/D-25 pre-paint), lucide 1.x icon swaps, tailwind-merge v3, React Router 8 (navigation) |
| P2 | `subsystems-live.spec.ts`, seeding helpers in `helpers/api.ts` | new endpoints and schema changes; seeders gain attention-feed fixtures |
| P3 (shell + ChatsList) | `navigation.spec.ts`: nav roster `Dashboard, Projects, Chats, Agents, Workflows, Scripts, Automations` → `Home, Chats, Projects, Agents, Workflows, Automations, Scripts`; `header-toggle-sidebar`; the "Hide/Show sidebar" pair; `banner` role. `settings-dashboard-templates.spec.ts` (`'Dashboard'`, "Mission Control", `banner`). `subsystems-live.spec.ts` ("Mission Control"). `chats.spec.ts` (ChatsList port). `desktop-chrome-smoke.mjs` (`app-header`, `app-titlebar`, `sidebar-toggle`, header-below-titlebar geometry becomes per-OS chrome). `desktop-smoke.mjs` ("new chat" button) | Shell per D-21/D-22/D-23. The Home heading changes only when Home is ported; until then Dashboard renders "Mission Control" inside `legacy-header` |
| P4 (chat workspace) | `streaming-turn-live.spec.ts`, `context-usage-ui.spec.ts` (`context-usage-trigger/popover`, `chat-input-skeleton`), `subsystems-live.spec.ts` (context usage), `right-pane-desktop-smoke.mjs`, `terminal-desktop-smoke.mjs` (`right-pane-add-terminal`, `terminal-header`, `terminal-container`, "Close Terminal tab"), `desktop-browser-smoke.mjs` ("Show side pane", "Add tab", "Integrated browser for this chat", "Native browser view"), `desktop-diff-review-smoke.mjs` + `desktop-diff-render-check.mjs` ("Show side pane", `/^Changes/`, "Expand all"), `desktop-p2-browser-smoke.mjs` | Composer, transcript, dock and D-19 changes. "Show side pane" becomes the page header's dock toggle, which keeps that accessible name |
| P5 (fan-out) | `projects.spec.ts`, `settings-dashboard-templates.spec.ts` (Home replaces Dashboard), `error-boundary` routes, the Agents pages | ports |
| P6 (settings) | `settings-dashboard-templates.spec.ts` (Settings dialog: banner heading "Settings", "Close"), `navigation.spec.ts` Settings test | D-26 modal addressed by URL: the URL now changes to `/settings/:section`, so the "URL untouched" assertion is updated on purpose |
| P7 (lockdown) | anything still using `app-header` or `legacy-header`; full suite + all smokes on 3 OSes | Header.tsx and the legacy layer are deleted |
| PW | `workflow-builder.spec.ts`, `workflow-run.spec.ts`, `workflows-crud.spec.ts`, `automations.spec.ts`, `widget-designer-layout.spec.ts` | built by the Workflow Overhaul Plan on the kit. Keep `rf__wrapper` (xyflow). Use its isolated server, never :3100 |

### 7.2 Testid and accessible-name preservation rule (goes into `.claude/CLAUDE.md`)

1. A ported element keeps its `data-testid`, its role and its accessible name **verbatim**, including the historical `right-pane*` ids on the new dock (`right-pane`, `right-pane-tab-<type>`, `right-pane-add-tab`, `right-pane-add-<type>`, `right-pane-fullscreen`, `right-pane-close`, `right-pane-cap-notice`, `right-pane-tab-overflow`, `right-pane-overflow-<type>`, `right-pane-panel-<type>`), the Changes ids (§5.3), `composer-attachment`, `chat-agent-chip`, `chat-input-skeleton`, `fork-provenance`, `context-usage-*`, `terminal-*`, `find-bar`, `sidebar-toggle`.
2. A deliberate rename or removal updates every spec and smoke in the same PR and appears in a "Selector changes" table in the PR description. `grep -rn "<old id>" agent-tests apps/web/src` must return nothing afterwards.
3. Specs prefer role and name. New testids are added only where role and name are ambiguous. They are kebab-case and prefixed by the part.

### 7.3 New testids for shell parts (added in P3)

`app-frame`, `app-sidebar` (with `data-collapsed` = `rail|full`), `sidebar-server-switcher`, `sidebar-search`, `sidebar-new-chat`, `sidebar-nav`, `sidebar-nav-<id>` (ids from `NAV_DESTINATIONS`), `sidebar-needs-you`, `sidebar-needs-you-row`, `sidebar-running`, `sidebar-running-row`, `sidebar-connection`, `sidebar-settings`, `sidebar-toggle` (kept), `sidebar-drag-region` (macOS top row), `main-card`, `page-header`, `page-header-breadcrumb`, `page-header-actions`, `dock-toggle` (accessible name "Show side pane"/"Hide side pane", kept), `legacy-header` (wraps the `LegacyHeader` slot; inside it the old `app-header` stays until P7), `app-titlebar` (kept for the Windows/Linux-custom strip), `titlebar-search`, `titlebar-update-pill`, `command-palette`, `dock-sheet` (narrow dock, `role="dialog"`, `data-gai-overlay`).

`desktop-chrome-smoke.mjs` in P3 asserts per platform:
- macOS: `sidebar-drag-region` exists and is draggable, and there is no `app-titlebar`.
- Windows and Linux-custom: `app-titlebar` is 36 px and `main-card` sits below it.
- Linux-native: no `app-titlebar`.

---

## 8. Performance checks

### 8.1 Bundle and fonts (`check-bundle-size.mjs`, extended in P1)

- Kept: an **800 KB gzip initial-load budget** (entry + modulepreload + stylesheets) and a **300 KB gzip per lazy chunk**.
- New: a **font budget**, separate from JS (D-16).
  - Collect every `url(...)` inside `@font-face` in the initial CSS and sum the raw bytes of the referenced files. woff2 is already compressed, so gzip is not applied.
  - Budget **200 KB** for Instrument Sans + JetBrains Mono, latin + latin-ext, variable 400–600. P1 measures the actual total and sets the budget to measured + 10 %, capped at 200 KB.
  - Fail if any font file is not `.woff2`, if more than 6 font files are referenced, or if any font is referenced from outside `dist/assets` (no CDN).
- New: **CSS report.** Print the gzip size of the initial CSS. It grows while two token layers coexist, and P7 records the drop. A reporting line only, no gate.
- Libraries added by D-38 (Streamdown, Shiki languages, react-resizable-panels, Base UI) must stay out of the initial path unless the shell needs them. Shiki grammars load lazily per language, and the per-chunk cap catches a bundled grammar set.

### 8.2 Transcript virtualization acceptance (D-33 spike, P4)

Spec: `agent-tests/perf/transcript.spec.ts`, Playwright project `perf`, run headed in local Chrome: `pnpm --filter @generatorai/agent-tests exec playwright test -c perf/playwright.perf.config.ts --headed`.

- **Fixture.** `agent-tests/perf/fixtures/transcript-2000.ts` generates 2,000 blocks: 400 turns, each with a user message, assistant markdown with a code fence, three 28 px step rows, a tool card and a diff block. It is served by `page.route` on the messages endpoint of a sandbox chat.
- **Scroll smoothness.** An injected rAF recorder collects frame deltas while `page.mouse.wheel` scrolls top → bottom → top over 10 s at 1440×900. Accept if **≥ 95 % of frames ≤ 16.7 ms and p99 ≤ 33 ms**. The DOM never holds more than 3,000 transcript nodes (`querySelectorAll('[data-gai-block]').length` sampled every 250 ms).
- **Streaming anchored.** With the view at the bottom, stream 500 tokens at 20 ms through a mocked chat SSE. After each flush, `scrollHeight − scrollTop − clientHeight ≤ 2`.
- **Not yanked.** After scrolling up 600 px, streaming leaves `scrollTop` unchanged (±1 px) and "Jump to latest" appears. Clicking it lands at the bottom.
- **Stable anchor.** Expanding or collapsing a step row above the viewport keeps the first visible block's offset within ±2 px.
- **Find.** The desktop FindBar (Cmd/Ctrl+F) finds text in a turn that is **not rendered** (see "Issues"). If virtualization cannot satisfy this, the spike fails in favour of the D-33 fallback (collapse finished turns beyond the last 20).
- CI runs `perf` headless as reporting-only (`continue-on-error`, like `benchmarks`). Frame timing on shared runners is not a reliable gate. The spike's go/no-go is decided on the developer's machine, and the numbers are recorded in the P4 PR.

### 8.3 Long lists

Same recorder, with data seeded through the sandbox API (`seed.ts --scale`). "Frame criteria" means ≥ 95 % of frames ≤ 16.7 ms while scrolling.

| Surface | Load | Accept |
|---|---|---|
| ChatsList | 5,000 chats | first rows within 300 ms of the data response (`performance.mark`); frame criteria; rendered rows ≤ visible + 2 × overscan |
| Workflows list | 1,000 | same |
| Sidebar Needs you / Running | 200 items | scrolls within its own region; no re-render on unrelated SSE events (React Profiler count in Vitest) |
| Changes dock | 200 files | auto-expand ≤ 3; tree toggle < 100 ms; frame criteria |
| Command palette | 5,000 entities | keystroke to painted results ≤ 50 ms |
| File tree | 10,000 files | folder expand ≤ 50 ms |

In P4 the existing `ChatPage.test.tsx` render-isolation test moves to the new chat workspace. It must still show one page render for 60 token appends.

---

## 9. Accessibility checks

### 9.1 axe per story

`addon-a11y` with `parameters.a11y.test = 'error'` fails `test:stories` on any violation, in every appearance combination the story is tested in. The `vrt-themes` stories run their a11y test under Instrument dark, Instrument light and Solarized light: `test:stories` runs once per combination with `STORYBOOK_A11Y_GLOBALS`, which the vitest setup maps to `initialGlobals`. The only allowed per-story rule disables are for third-party internals (xterm, xyflow canvas), each with a comment.

For routes, `agent-tests/e2e/a11y.spec.ts` (P3; adds the devDependency `@axe-core/playwright`) runs axe (WCAG 2.2 A/AA tags) on each §4.3 route in dark and light, and fails on violations. Known third-party nodes are excluded with `.exclude('.xterm')` and `.exclude('.react-flow__renderer')`.

### 9.2 Keyboard walkthrough per page (part of every §6.3 walkthrough)

- Tab order follows the visual order: sidebar → page header → content → dock → composer. Nothing interactive is unreachable, and nothing hidden is reachable. Inactive dock panels are `aria-hidden` and `visibility:hidden`.
- Every overlay (menu, popover, select, combobox, dialog, sheet, palette) opens from the keyboard. Arrow keys move within it, Escape closes it, and **focus returns to the trigger**. Dialogs trap focus.
- Roving tabindex in tab strips, segmented controls, menus and the nav list. Home and End work in lists and tab strips.
- Shortcuts from the D-24 registry work per host (web vs desktop) and appear in the palette hints.
- The resizable dock separator is operable with the arrow keys, Home and End.
- The result is written in `DIFF.md` under "Keyboard".

### 9.3 Focus ring

- One token-driven ring (`focus-visible` only, width 2 px, offset 1 px, colour `--gai-focus`, derived per theme and accent and asserted ≥ 3:1 against every surface in §2.6).
- The kit's `focusRing` helper in `ui/lib` is the only way to style focus. `better-tailwindcss/no-restricted-classes` bans ad-hoc `ring-*`/`outline-*` in `features/` (add the pattern `^(.*:)?(ring|outline)-(?!none$)` there).
- Stories include `FocusVisible` for every interactive component, so VRT captures the ring.

### 9.4 Minimum 24 px target size (WCAG 2.2 SC 2.5.8)

- `assertTargetSize(page|canvasElement)`, shared by `a11y.spec.ts` and a Storybook `play` helper in `ui/lib/test/targetSize.ts`. For every visible `button`, `a[href]`, `[role=button|tab|menuitem|option|checkbox|switch|radio]` and `input` not inside running text, the bounding box must be ≥ 24×24 CSS px, **or** its effective hit area must be (the kit expands small controls with a `::before` inset hit-slop, which the check reads from the `data-gai-hit` attribute that the primitive sets).
- It runs for both densities. See "Issues": compact `control-sm` is 20 px.

### 9.5 Contrast

Contrast is owned by the token suite (§2.6, 252 combinations). axe's `color-contrast` rule stays enabled in stories and routes as a second net. It catches off-token composites (text on `hover`/`selected`, text over images). A contrast failure is fixed in tokens or by using a different token, never by overriding a colour locally.

---

## Issues with decisions raised by this document

**Status (final review, 2026-09-25):** all seven are reconciled — 1 → D-34 (6 combinations per PR, Solarized dark on merge); 2 → D-37 (Vitest 4, P1-U3); 3 → D-15 (invisible hit area); 4 → D-33 (Find is part of the spike acceptance); 5 → P0-03; 6 → P2-00; 7 → D-26 and P6-02.

1. **D-34 matrix vs this plan.** D-34 says 2 themes × 2 modes × 2 widths (8 combinations per route). The per-PR run here uses Instrument dark/light + Solarized light (6 combinations), and Solarized dark joins only in `vrt:full` on merge. If D-34 is meant literally per PR, add Solarized dark to the PR run, which costs about 33 % more baselines.
2. **Vitest 4 is not in D-37.** Storybook 10's addon-vitest works on Vitest 3.2, but browser mode is better supported on Vitest 4 (`@vitest/browser-playwright`). Recommend adding "Vitest 3.2 → 4" to D-37's Phase 1 list, or explicitly pinning 3.2 and using the string provider.
3. **Compact density vs WCAG 2.5.8.** D-15 compact makes `control-sm` 20 px, which is below the 24 px minimum target size. The kit needs an invisible hit-slop (a `::before` inset of −2 px) on sub-24 controls, or compact `control-sm` stays at 24. Record this in D-15.
4. **D-33 virtualization vs native find.** The desktop FindBar uses Electron `findInPage`, which cannot find text in turns that are not rendered. The spike's acceptance must include find, or the FindBar must search the transcript model and scroll the virtualizer. Add this to D-33.
5. **CI branch triggers.** `ci.yml` runs only for `main`/`dev`. The redesign branches get no CI until P0 fixes the triggers. This is not a decision conflict, but every D-03 gate depends on it.
6. **`GENERATORAI_LOAD_TEST_FAUX_HARNESS`.** The name and its log say "load test only", but VRT, the sandbox and e2e reuse it. Per `no-backward-compatibility`, P2 should rename it to `GENERATORAI_TEST_FAUX_HARNESS` and add the `GENERATORAI_TEST_FAUX_SCRIPT` hook, or adopt the Workflow Overhaul Plan's WP-0.3 test server if it has landed.
7. **D-26 changes a tested contract.** `navigation.spec.ts` asserts that opening Settings does not change the URL. D-26 makes the URL `/settings/:section`. The P6 PR changes this assertion on purpose.
