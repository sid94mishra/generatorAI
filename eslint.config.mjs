// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
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
  prettierConfig,
];
