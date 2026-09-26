// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import boundaries from 'eslint-plugin-boundaries';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Absolute paths: turbo runs `eslint src/` from apps/web while `pnpm lint`'s
// check:syncio runs `eslint .` from the repo root, and both must resolve the
// same files.
const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIR = fileURLToPath(new URL('./apps/web', import.meta.url));
const WEB_CSS = fileURLToPath(new URL('./apps/web/src/styles/globals.css', import.meta.url));
const WEB_TSCONFIG = fileURLToPath(new URL('./apps/web/tsconfig.eslint.json', import.meta.url));

// ── Web design-system restrictions shared by every block that re-declares ──
// `no-restricted-imports` / `no-restricted-syntax` for apps/web/src (see the
// flat-config trap at the bottom of this file: a later block REPLACES a rule
// for the files it matches, it does not merge with it).
const WEB_RESTRICTED_IMPORT_PATHS = [
  {
    name: 'lucide-react',
    importNames: ['Loader2'],
    message: 'Use <Spinner> from @/components/ui instead of raw Loader2.',
  },
];
const WEB_RESTRICTED_SYNTAX = [
  {
    selector: "JSXOpeningElement[name.name='button']",
    message: 'Use <Button> from @/components/ui instead of a raw <button>.',
  },
  {
    selector: "JSXOpeningElement[name.name='select']",
    message: 'Use <Select> from @/components/ui instead of a raw <select>.',
  },
];

// ── Redesign layers (docs/redesign/09-verification.md §2.3, D-04) ──────────
const WEB_NEW_CODE = 'apps/web/src/{ui,blocks,features,app}/**/*.{ts,tsx}';
const WEB_TEST_FILES = ['apps/web/src/**/__tests__/**', 'apps/web/src/**/*.test.{ts,tsx}'];
const WEB_STORIES = '**/*.stories.tsx';

// The same raw-element / confirm rules for the redesign folders, pointing at the
// new kit: `ui/` may not import @/components/*, so the legacy messages above
// would steer a session the wrong way (P0 review R12). Loader2 needs no entry
// here: every lucide import outside ui/icons is already banned (LUCIDE below).
const NEW_CODE_RESTRICTED_SYNTAX = [
  {
    selector: "JSXOpeningElement[name.name='button']",
    message: 'Use <Button> / <IconButton> from @/ui/primitives instead of a raw <button>.',
  },
  {
    selector: "JSXOpeningElement[name.name='select']",
    message: 'Use <Select> from @/ui/primitives instead of a raw <select>.',
  },
];

const LUCIDE = { name: 'lucide-react', message: 'Import icons from @/ui/icons by concept (D-17).' };
const HEADLESS = {
  group: ['@radix-ui/*', 'radix-ui', '@base-ui/*', '@base-ui-components/*', 'cmdk'],
  message: 'Headless primitives are wrapped in @/ui/primitives (D-05).',
};
const UI_LAYER = [
  {
    group: ['@tanstack/react-query', 'react-router', 'react-router-dom', 'zustand', 'zustand/*', '@generatorai/client-core', '@generatorai/client-runtime'],
    message: 'ui/ is presentational: pass data and callbacks in as props.',
  },
  {
    group: ['@/stores/*', '@/platform/*', '@/hooks/*', '@/features/*', '@/blocks/*', '@/components/*', '@/pages/*'],
    message: 'ui/ may import only ui/ (D-04).',
  },
];

// features/ get data only through hooks/*Queries.ts or stores (D-04), never the
// query client, the platform client or the client packages directly. Type
// imports stay allowed: sharing a type is not reaching the data.
const FEATURES_DATA = [
  {
    group: ['@tanstack/react-query', '@tanstack/react-query/*'],
    allowTypeImports: true,
    message: 'features/ read data through hooks/*Queries.ts or stores, not react-query directly (D-04).',
  },
  {
    // client-core stays allowed: it holds pure, React-free helpers and read
    // models (runTitle, parseUnifiedDiff, status map …) that features render.
    group: ['@generatorai/client-runtime', '@generatorai/client-runtime/*', '@generatorai/client-transport', '@generatorai/client-transport/*'],
    allowTypeImports: true,
    message: 'features/ reach the client runtime/transport through hooks/*Queries.ts or stores (D-04). Type imports are fine.',
  },
  {
    group: ['@/providers/PlatformProvider', '@/providers/PlatformProvider.js', '**/providers/PlatformProvider', '**/providers/PlatformProvider.js'],
    allowTypeImports: true,
    message: 'features/ never hold the platform client (usePlatform); add a hook in hooks/ instead (D-04).',
  },
  {
    group: ['@/providers/QueryProvider', '@/providers/QueryProvider.js', '**/providers/QueryProvider', '**/providers/QueryProvider.js'],
    allowTypeImports: true,
    message: 'features/ never touch the query client directly; add a hook in hooks/*Queries.ts instead (D-04).',
  },
];

// LEGACY_UTILITY_NAMES from packages/design-tokens (src/vocabulary.ts), via the
// JSON `pnpm tokens:write` generates next to it (a config cannot import TS).
const LEGACY_UTILITY_NAMES = JSON.parse(
  readFileSync(new URL('./packages/design-tokens/generated/vocabulary.json', import.meta.url), 'utf8'),
).legacyUtilityNames;
const LEGACY_UTILITY_RESTRICTION = {
  pattern: `^(.*:)?!?(bg|text|border|ring|fill|stroke|outline|divide|from|to|via|shadow|accent|caret|decoration|placeholder)-(${LEGACY_UTILITY_NAMES.join('|')})(/\\d+)?$`,
  message: 'Legacy token utility (D-06). Use the design vocabulary: bg-surface, text-fg-2, border-line … (02 §2.3).',
};
const ARBITRARY_VALUE_RESTRICTION = { pattern: '\\[.+\\]', message: 'No arbitrary values. Add a token or a kit variant.' };
const NEW_CODE_RESTRICTED_CLASSES = [
  { pattern: '^(.*:)?text-(xs|sm|base|lg|xl|\\d?xl)$', message: 'Use the D-13 scale: text-micro|small|ui|body|title|heading|display.' },
  { pattern: '^(.*:)?(bg|text|border|ring|fill|stroke|outline|divide|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d+(/\\d+)?$', message: 'Palette classes are off-system. Use design tokens (D-08).' },
  { pattern: '^(.*:)?(bg|text|border|ring|fill|stroke)-(white|black)(/\\d+)?$', message: 'Use fg/surface/on-accent tokens.' },
  { pattern: '^(.*:)?rounded(-[trblxyse]{1,2})?(-(xs|sm|md|lg|xl|\\dxl))?$', message: 'Use rounded-badge|control-sm|control|seg|card|panel|dialog (D-14).' },
  { pattern: '^(.*:)?shadow(-(2xs|xs|sm|md|lg|xl|2xl|inner))?$', message: 'Only shadow-pop / shadow-none exist.' },
  ARBITRARY_VALUE_RESTRICTION,
  { pattern: '^(.*:)?h-(\\d+(\\.\\d+)?|px)$', message: 'Heights come from density variables: h-control-sm|h-control|h-control-lg|h-row|h-bar|h-tab|h-nav (D-15).' },
  // Legacy semantic utilities are banned in new code (09 §2.3).
  LEGACY_UTILITY_RESTRICTION,
];

/** Allow imports into the given element types (eslint-plugin-boundaries v7 policy selector). */
const toTypes = (...types) => ({ to: { element: { type: types } } });

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      '**/dist/**',
      '**/dist-bundle/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      // Claude Code's own skill scripts and sub-agent worktrees (gitignored).
      // Linting them added ~30 MB of files to every run and pushed the JSON
      // report past the sync-IO budget script's buffer, which then failed with
      // "did not produce parseable JSON output". Same exclusion vitest uses.
      '**/.claude/**',
      '**/.expo/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended?.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': 'warn',
    },
  },
  {
    // React hooks rules for every surface that actually uses React hooks —
    // the web app AND the CLI's Ink-based TUI (`apps/cli/src/tui`). Registered
    // mainly so the `eslint-disable-next-line react-hooks/exhaustive-deps`
    // suppressions scattered through the components refer to a rule that
    // actually exists — without the plugin every one of them is itself a
    // lint error. △ Fixed during end-to-end review: this used to cover only
    // `apps/web`, so the exact failure the comment above warns about was
    // happening for `apps/cli/src/tui/App.tsx`'s own suppression comment.
    //
    // `exhaustive-deps` stays a warning: the existing suppressions are
    // deliberate, and promoting it to an error would block the build on
    // judgement calls rather than defects.
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/cli/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Code generators and CLI entry points report progress on stdout; that is
    // their interface, not a stray debug statement.
    files: ['packages/*/bin/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Design-system enforcement for the LEGACY web code (see apps/web/DESIGN_SYSTEM.md).
    // `warn` during the migration phases (the ratchet holds the counts). The
    // primitives themselves are exempt; stories may use raw elements (D-45).
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/components/ui/**', WEB_NEW_CODE, WEB_STORIES, ...WEB_TEST_FILES],
    rules: {
      'no-restricted-syntax': ['warn', ...WEB_RESTRICTED_SYNTAX],
      'no-restricted-imports': ['warn', { paths: WEB_RESTRICTED_IMPORT_PATHS }],
      'no-restricted-globals': [
        'warn',
        { name: 'confirm', message: 'Use <ConfirmDialog> from @/components/ui.' },
      ],
    },
  },
  {
    // The same for the redesign folders, with messages that point at the new
    // kit. `error`: the ratchet already hard-zeros these there. ui/primitives
    // render the raw elements by design (D-43), and stories may (D-45).
    files: [WEB_NEW_CODE],
    ignores: ['apps/web/src/ui/primitives/**', WEB_STORIES, ...WEB_TEST_FILES],
    rules: {
      'no-restricted-syntax': ['error', ...NEW_CODE_RESTRICTED_SYNTAX],
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: 'Use useConfirm() / <AlertDialog> from @/ui/primitives (P-32).' },
      ],
    },
  },
  // ── Redesign guardrails (D-03; docs/redesign/09-verification.md §2.3) ──────
  //
  // (a) Tailwind vocabulary, new code only. `error` from P0: the folders start
  // empty. Legacy code is held by the check-design-system.mjs ratchet instead.
  //
  // `cwd` is not optional: from the repo root `tailwindcss` resolves to the
  // hoisted 3.x (docs site), and the plugin would then lint v4 code against v3.
  // `callees` is left at the plugin default on purpose: it already covers cn,
  // cva, clsx and twMerge (including cva `variants` values), and setting the
  // option replaces those matchers instead of extending them.
  //
  // Stories are linted too (D-45): they must show real classes, so the
  // vocabulary applies; only arbitrary values are free (demo frames), below.
  {
    files: [WEB_NEW_CODE],
    ignores: WEB_TEST_FILES,
    plugins: { 'better-tailwindcss': betterTailwind },
    settings: { 'better-tailwindcss': { entryPoint: WEB_CSS, cwd: WEB_DIR } },
    rules: {
      'better-tailwindcss/no-unknown-classes': ['error', { ignore: ['^app-drag-region$', '^no-drag$', '^group(/.+)?$', '^peer(/.+)?$'] }],
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-deprecated-classes': 'error',
      'better-tailwindcss/no-unnecessary-whitespace': 'warn',
      'better-tailwindcss/no-restricted-classes': ['error', { restrict: NEW_CODE_RESTRICTED_CLASSES }],
    },
  },
  {
    // ui/lib is the one sanctioned home of arbitrary values in product code
    // (Base UI CSS-variable passthroughs, each with a comment), and stories may
    // use them as demo scaffolding (D-45) — the same exemptions the ratchet's
    // `arbitraryValue` rule gives. Everything else in (a) still applies.
    files: ['apps/web/src/ui/lib/**/*.{ts,tsx}', `apps/web/src/{ui,blocks,features,app}/${WEB_STORIES}`],
    ignores: WEB_TEST_FILES,
    rules: {
      'better-tailwindcss/no-restricted-classes': [
        'error',
        { restrict: NEW_CODE_RESTRICTED_CLASSES.filter((r) => r !== ARBITRARY_VALUE_RESTRICTION) },
      ],
    },
  },
  // (b) Layer boundaries (D-04), over all of apps/web/src.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: WEB_TSCONFIG } },
      'boundaries/root-path': REPO_ROOT,
      'boundaries/include': ['apps/web/src/**/*'],
      // Tests are not a layer: they may import any layer, and nothing but
      // tests imports them. Ignoring them keeps no-unknown-files quiet for
      // src/__tests__ without inventing a policy-free element.
      'boundaries/ignore': WEB_TEST_FILES,
      // Lazy route modules and barrel re-exports cross layers too.
      'boundaries/dependency-nodes': ['import', 'dynamic-import', 'export'],
      'boundaries/elements': [
        // Storybook-only design-foundations showcase (D-04): not a kit folder.
        // It may use ui/, and nothing may import it. Listed before `ui` so it
        // matches first.
        { type: 'foundations', pattern: 'apps/web/src/ui/foundations', partialMatch: false },
        { type: 'ui', pattern: 'apps/web/src/ui', partialMatch: false },
        { type: 'blocks', pattern: 'apps/web/src/blocks', partialMatch: false },
        { type: 'features', pattern: 'apps/web/src/features/*', partialMatch: false, capture: ['domain'] },
        { type: 'app', pattern: 'apps/web/src/app', partialMatch: false },
        { type: 'platform', pattern: 'apps/web/src/platform', partialMatch: false },
        { type: 'data', pattern: 'apps/web/src/{stores,hooks,lib,utils,providers,types,audio}', partialMatch: false },
        { type: 'legacy', pattern: 'apps/web/src/{components,pages}', partialMatch: false },
        // Stylesheets (globals.css), imported for their side effect by the entry.
        { type: 'styles', pattern: 'apps/web/src/styles', partialMatch: false },
        // The loose files at the top of src (App, main, router). v7 has no
        // non-deprecated way to make a single file an element; `mode: 'file'`
        // is it.
        { type: 'root', pattern: 'apps/web/src/*.{ts,tsx}', mode: 'file' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            { from: { element: { type: 'ui' } }, allow: toTypes('ui') },
            // No policy allows any element INTO foundations.
            { from: { element: { type: 'foundations' } }, allow: toTypes('ui', 'foundations') },
            { from: { element: { type: 'blocks' } }, allow: toTypes('ui', 'blocks', 'data', 'platform') },
            { from: { element: { type: 'features' } }, allow: toTypes('ui', 'blocks', 'data') },
            {
              from: { element: { type: 'features' } },
              allow: { to: { element: { type: 'features', captured: { domain: '{{ from.element.captured.domain }}' } } } },
            },
            { from: { element: { type: 'app' } }, allow: toTypes('ui', 'blocks', 'features', 'data', 'platform', 'legacy') },
            { from: { element: { type: 'data' } }, allow: toTypes('data', 'platform') },
            // Migration scaffolding; removed in P7. The only data → legacy edge
            // left (hooks/queries.ts, providers/QueryProvider.tsx → the legacy
            // Toast), allowed to that target file only so no new edge can
            // appear. It goes when those callers move to the kit toast. (The
            // composer builtins moved to packages/client-core in P4-08.)
            {
              from: { element: { type: 'data' } },
              allow: {
                to: {
                  element: { type: 'legacy' },
                  file: { path: ['apps/web/src/components/Toast.tsx'] },
                },
              },
            },
            // The kit's pure helpers in ui/lib (applyAppearance, cn) are shared
            // with the data layer: ThemeProvider (providers/) writes the
            // appearance through applyAppearance (D-25, 09 §3.3), and the
            // legacy lib/utils `cn` re-exports ui/lib/cn. Only ui/lib; never
            // components.
            {
              from: { element: { type: 'data' } },
              allow: { to: { element: { type: 'ui' }, file: { path: ['apps/web/src/ui/lib/*.ts'] } } },
            },
            { from: { element: { type: 'platform' } }, allow: toTypes('platform', 'data') },
            // Migration scaffolding; deleted in P7.
            { from: { element: { type: 'legacy' } }, allow: toTypes('legacy', 'ui', 'blocks', 'data', 'platform') },
            // `root` too: each loose file is its own element, and main.tsx imports App.tsx.
            { from: { element: { type: 'root' } }, allow: toTypes('root', 'app', 'ui', 'data', 'platform', 'legacy', 'styles') },
          ],
        },
      ],
      // Fail closed (D-03): a folder that is not declared above (src/services,
      // src/queries …) is neither importable nor allowed to exist, so it cannot
      // sidestep the policies. Declare it as an element first.
      'boundaries/no-unknown-dependencies': 'error',
      'boundaries/no-unknown-files': 'error',
    },
  },
  // (c) no-restricted-imports per layer. The file sets are DISJOINT, so no
  // block replaces another's rule; each legacy block repeats
  // WEB_RESTRICTED_IMPORT_PATHS because it replaces the design-system block's
  // rule above (the new folders are outside that block).
  {
    // Legacy code (everything outside the redesign folders and components/ui):
    // `warn` until P7, ratcheted by check-design-system.mjs (lucideDirectImport,
    // rawHeadlessImport).
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: [WEB_NEW_CODE, 'apps/web/src/components/ui/**', ...WEB_TEST_FILES],
    rules: {
      'no-restricted-imports': ['warn', { paths: [...WEB_RESTRICTED_IMPORT_PATHS, LUCIDE], patterns: [HEADLESS] }],
    },
  },
  {
    // blocks/ and app/: icons by concept, headless only through the kit. `error`:
    // the ratchet already hard-zeros both in the new folders.
    files: ['apps/web/src/{blocks,app}/**/*.{ts,tsx}'],
    ignores: WEB_TEST_FILES,
    rules: {
      'no-restricted-imports': ['error', { paths: [LUCIDE], patterns: [HEADLESS] }],
    },
  },
  {
    // features/: the same, plus data only through hooks or stores (D-04).
    files: ['apps/web/src/features/**/*.{ts,tsx}'],
    ignores: WEB_TEST_FILES,
    rules: {
      'no-restricted-imports': ['error', { paths: [LUCIDE], patterns: [HEADLESS, ...FEATURES_DATA] }],
    },
  },
  {
    // The legacy components/ui primitives wrap Radix by design and own the
    // Spinner, so they were never under the Loader2 path or a headless ban;
    // they are held to the D-17 lucide rule only (deleted in P7).
    files: ['apps/web/src/components/ui/**/*.{ts,tsx}'],
    ignores: WEB_TEST_FILES,
    rules: {
      'no-restricted-imports': ['warn', { paths: [LUCIDE] }],
    },
  },
  {
    // ui/ except the icon registry: headless allowed, lucide and data layers not.
    files: ['apps/web/src/ui/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/ui/icons/**', ...WEB_TEST_FILES],
    rules: {
      'no-restricted-imports': ['error', { paths: [LUCIDE], patterns: UI_LAYER }],
    },
  },
  {
    // The icon registry: the only lucide importer (it maps the loader concept
    // too, so Loader2 is allowed here).
    files: ['apps/web/src/ui/icons/**/*.{ts,tsx}'],
    ignores: WEB_TEST_FILES,
    rules: {
      'no-restricted-imports': ['error', { patterns: UI_LAYER }],
    },
  },
  // ── W33 Layer boundary rules ────────────────────────────────────────────────
  // L1 (shared, db) and L2 (core, agent-harness-providers) packages may NOT
  // import the web framework, Electron, or the database driver. Violations block
  // the build (error, not warn) — the layering rule is a prerequisite for the
  // process split (Phase 3), not a style preference.
  //
  // packages/db is allowed to import better-sqlite3 (it owns the driver);
  // everything else in L1/L2 is forbidden from touching it.
  {
    files: ['packages/core/**/*.ts', 'packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['express', 'express/*'],
              message: 'L1/L2 packages may not import Express. Wire it only in L4 surfaces (apps/server).',
            },
            {
              group: ['electron', 'electron/*'],
              message: 'L1/L2 packages may not import Electron. Wire it only in L4 surfaces (apps/desktop).',
            },
            {
              group: ['better-sqlite3', 'better-sqlite3/*', 'drizzle-orm/better-sqlite3', 'drizzle-orm/better-sqlite3/*'],
              message: 'L1/L2 packages may not import the SQLite driver. Use the IDatabase port injected at the composition root.',
            },
            {
              group: ['node-pty', 'node-pty/*'],
              message: 'L1/L2 packages may not import node-pty. Wire it only in L3 hosts (pty-host).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/agent-harness-providers/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['express', 'express/*'],
              message: 'L2 packages may not import Express. Wire it only in L4 surfaces (apps/server).',
            },
            {
              group: ['electron', 'electron/*'],
              message: 'L2 packages may not import Electron. Wire it only in L4 surfaces (apps/desktop).',
            },
            {
              group: ['node-pty', 'node-pty/*'],
              message: 'L2 packages may not import node-pty. Wire it only in L3 hosts (pty-host).',
            },
          ],
        },
      ],
    },
  },
  {
    // packages/db owns the SQLite driver (L1 foundation), but must not
    // pull in the web framework, Electron, or the PTY library.
    files: ['packages/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['express', 'express/*'],
              message: 'packages/db may not import Express.',
            },
            {
              group: ['electron', 'electron/*'],
              message: 'packages/db may not import Electron.',
            },
            {
              group: ['node-pty', 'node-pty/*'],
              message: 'packages/db may not import node-pty.',
            },
          ],
        },
      ],
    },
  },
  {
    // CLI_TUI_POST_OVERHAUL_PARITY_AUDIT_2026.md §5.3 — every real command
    // bug this audit found at the API boundary had the exact same shape:
    // `as never` on a request body let a wrong or nonexistent field name
    // through, `validate()` silently stripped it server-side, and the
    // command reported success while doing less than asked. Command
    // handlers must use the client method's real parameter type instead —
    // fixing the type error IS fixing the bug.
    //
    // Test files are exempt: `as never` there widens a literal test fixture
    // to a handler's input type, which is not a wire-payload cast.
    //
    // Also covers `apps/server/src/routes` and `apps/web/src/hooks` — the
    // adversarial review of this fix found the identical bug shape in both
    // (an unvalidated-looking `req.body`/mutation-arg cast standing in for a
    // real, often already-validated, type) and both were fixed in the same
    // pass; every remaining `as never` in those two directories was
    // individually re-verified as gone before this glob was widened to them,
    // so widening it further to either directory's siblings needs the same
    // per-file check first, not just a broader glob.
    files: [
      'packages/cli-core/src/commands/**/*.ts',
      'apps/server/src/routes/**/*.ts',
      'apps/web/src/hooks/**/*.ts',
    ],
    ignores: ['packages/cli-core/src/commands/**/__tests__/**', '**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression[typeAnnotation.type='TSNeverKeyword']",
          message:
            'as never erases type checking at exactly the boundary that matters. Fix the client method\'s parameter type (or the call site) instead of casting past the mismatch.',
        },
      ],
    },
  },
  // ── PART 11.1 guardrails ─────────────────────────────────────────────────
  //
  // The plan lists twelve rules that each need an enforcement mechanism, and
  // an audit found only two were actually enforced. These are the three that
  // ESLint can express directly; the rest live in `scripts/check-*.mjs`
  // (security invariants, §1.P doc drift, durability invariants), which the
  // root `lint` script runs.
  //
  // Scoped to the hot paths the plan names rather than applied repo-wide:
  // a rule that fires 500 times is a rule everyone learns to ignore.
  {
    files: [
      'packages/core/src/services/**/*.ts',
      'packages/core/src/events/**/*.ts',
      'packages/core/src/infrastructure/**/*.ts',
      'packages/db/src/**/*.ts',
      'apps/server/src/**/*.ts',
      'apps/agent-host/src/**/*.ts',
      'apps/pty-host/src/**/*.ts',
      'apps/browser-host/src/**/*.ts',
      'apps/cua-host/src/**/*.ts',
    ],
    ignores: ['**/__tests__/**', '**/*.test.ts', '**/__benchmarks__/**'],
    rules: {
      // `warn`, not `error`, and deliberately so.
      //
      // §11.1 asks for a "lint tripwire with a **shrink-only allowance**" for
      // the synchronous-IO rule — not a hard failure, because there are
      // already ~30 legitimate boot-time call sites and failing the build on
      // day one would just get the rule deleted. The allowance is enforced by
      // `scripts/check-sync-io-budget.mjs`, which counts these warnings and
      // fails when the count goes UP. That gives the rule teeth against new
      // violations while letting the existing ones be paid down over time.
      //
      // The backpressure rule below is a genuine `error` because its current
      // violation count is zero — there is nothing to grandfather.
      // All three selectors live in ONE entry on purpose.
      //
      // `no-restricted-syntax` takes a single severity, and in flat config a
      // later block targeting the same files REPLACES the rule rather than
      // merging with it — so splitting the backpressure selector into its own
      // `error` block silently deleted the two synchronous-IO selectors for
      // every file both blocks matched, and the budget script dutifully
      // recorded a baseline of zero. They stay together at `warn`; the hard
      // limits are enforced by `scripts/check-sync-io-budget.mjs`, which
      // ratchets the synchronous-IO count downward and holds the backpressure
      // count at exactly zero.
      'no-restricted-syntax': [
        'warn',
        {
          // §11.1: "No `stream.on('data', d => other.write(d))`".
          // Measured cost of ignoring backpressure, from the plan's own
          // research: ~17× memory for zero throughput gain. `pipe()` and
          // `pipeline()` propagate backpressure; a manual data→write does not.
          //
          // `addListener` is matched too: it is the same call under a different
          // name, and a rule that knows only one spelling is one anybody can
          // step around without meaning to.
          selector:
            "CallExpression[callee.property.name=/^(on|addListener)$/][arguments.0.value='data']" +
            " CallExpression[callee.property.name='write']",
          message:
            "Manual 'data' → write() ignores backpressure (~17x memory for no throughput gain). " +
            'Use pipe()/pipeline(), or await the write and pause the source.',
        },
        {
          // §11.1: "No new synchronous filesystem or process call on the event
          // loop." A shrink-only allowance: existing call sites are grandfathered
          // by their own eslint-disable, and this stops NEW ones appearing.
          selector:
            "CallExpression[callee.object.name=/^(fs|fsSync|nodeFs)$/][callee.property.name=/^(readFileSync|writeFileSync|appendFileSync|readdirSync|statSync|lstatSync|mkdirSync|rmSync|unlinkSync|copyFileSync|renameSync|existsSync)$/]",
          message:
            'Synchronous filesystem call on the event loop. Use the promises API. ' +
            'If this is genuinely boot-only or in a child process, add an eslint-disable with the reason.',
        },
        {
          selector:
            "CallExpression[callee.object.name='child_process'][callee.property.name=/Sync$/]," +
            "CallExpression[callee.name=/^(execSync|execFileSync|spawnSync)$/]",
          message:
            'Synchronous process spawn on the event loop blocks every other request. ' +
            'Use the async form; if this is boot-only, add an eslint-disable with the reason.',
        },
      ],
    },
  },
  prettierConfig,
];
