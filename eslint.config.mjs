// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

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
    // Design-system enforcement for the web app (see apps/web/DESIGN_SYSTEM.md).
    // `warn` during the migration phases; flipped to `error` in the final
    // lock-in phase once counts hit ~0. The primitives themselves are exempt.
    files: ['apps/web/src/**/*.tsx'],
    ignores: [
      'apps/web/src/components/ui/**',
      'apps/web/src/**/__tests__/**',
      'apps/web/src/**/*.test.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: "JSXOpeningElement[name.name='button']",
          message: 'Use <Button> from @/components/ui instead of a raw <button>.',
        },
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Use <Select> from @/components/ui instead of a raw <select>.',
        },
      ],
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: 'lucide-react',
              importNames: ['Loader2'],
              message: 'Use <Spinner> from @/components/ui instead of raw Loader2.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'warn',
        { name: 'confirm', message: 'Use <ConfirmDialog> from @/components/ui.' },
      ],
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
