// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'],
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
    // React hooks rules for the web app. Registered mainly so the
    // `eslint-disable-next-line react-hooks/exhaustive-deps` suppressions
    // scattered through the components refer to a rule that actually exists —
    // without the plugin every one of them is itself a lint error.
    //
    // `exhaustive-deps` stays a warning: the existing suppressions are
    // deliberate, and promoting it to an error would block the build on
    // judgement calls rather than defects.
    files: ['apps/web/src/**/*.{ts,tsx}'],
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
  prettierConfig,
];
