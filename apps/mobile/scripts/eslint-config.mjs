import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import design, { classRules } from './design-rules.mjs';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const mobile = `${root}apps/mobile/`;
const tests = ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/*.generated.ts', 'apps/mobile/src/theme/palettes/**', 'apps/mobile/src/theme/uniwind-*', 'apps/mobile/src/ui/primitives/Icon/material-filled/**'];
// Hard zero everywhere since M10-01 deleted the legacy layer (02 §9.8): every rule is an error in src/ and app/.
const strictFiles = ['apps/mobile/{src,app}/**/*.{ts,tsx}'];
const all = ['apps/mobile/{src,app}/**/*.{ts,tsx}'];
const hookRules = Object.fromEntries(Object.keys(reactHooks.configs.recommended.rules).map((key) => [key, 'warn']));
const toTypes = (...types) => ({ to: { element: { type: types } } });
const namespaces = JSON.parse(readFileSync(new URL('../../../packages/design-tokens/generated/vocabulary.json', import.meta.url), 'utf8')).namespaces;
const vocabulary = namespaces.flatMap((ns) => ns.prefixes.flatMap((p) => ns.names.map((n) => `${p}-${n}`)));
/** Class restrictions for better-tailwindcss; `skip` lifts rules per scope. */
const restrictions = (skip = []) => Object.entries(classRules)
  .filter(([id]) => !['arbitraryValue', 'varInClassString', ...skip].includes(id))
  .map(([id, pattern]) => ({ pattern: pattern.source.replace(/^\^/, '^(?:.*:)?'), message: `${id}: use the mobile vocabulary.` }));
export default [
  {
    files: all, ignores: tests,
    plugins: { 'mobile-design': design, 'react-hooks': reactHooks, 'better-tailwindcss': betterTailwind },
    settings: { 'better-tailwindcss': { entryPoint: `${mobile}src/theme/global.css`, cwd: mobile } },
    rules: {
      ...hookRules,
      'mobile-design/design': 'warn',
      'better-tailwindcss/no-restricted-classes': ['warn', { restrict: restrictions() }],
      'better-tailwindcss/no-unknown-classes': ['warn', { ignore: ['^group(/.+)?$', '^peer(/.+)?$', `^(?:${vocabulary.join('|')})$`] }],
    },
  },
  {
    files: strictFiles, ignores: tests,
    rules: { ...Object.fromEntries(Object.keys(hookRules).map((key) => [key, 'error'])), 'mobile-design/design': 'error', 'better-tailwindcss/no-unknown-classes': 'error', 'better-tailwindcss/no-restricted-classes': 'error' },
  },
  {
    // Gate A (MD-115): platform classes (ios:/android:/native:/web:/tv:) are allowed inside the kit only.
    files: ['apps/mobile/src/ui/**/*.{ts,tsx}'], ignores: tests,
    rules: { 'better-tailwindcss/no-restricted-classes': ['error', { restrict: restrictions(['platformClassVariant']) }] },
  },
  {
    files: all, ignores: tests,
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: `${mobile}tsconfig.json` } },
      'boundaries/root-path': root,
      'boundaries/include': ['apps/mobile/src/**/*', 'apps/mobile/app/**/*'],
      'boundaries/ignore': tests,
      'boundaries/dependency-nodes': ['import', 'dynamic-import', 'export'],
      'boundaries/elements': [
        { type: 'ui', pattern: 'apps/mobile/src/ui', partialMatch: false },
        { type: 'blocks', pattern: 'apps/mobile/src/blocks', partialMatch: false },
        { type: 'feature', pattern: 'apps/mobile/src/features/*', partialMatch: false, capture: ['domain'] },
        { type: 'service', pattern: 'apps/mobile/src/services', partialMatch: false },
        { type: 'theme', pattern: 'apps/mobile/src/theme', partialMatch: false },
        { type: 'route', pattern: 'apps/mobile/app', partialMatch: false },
        // Ambient declarations (`src/assets.d.ts`) only; there is no legacy layer any more.
        { type: 'ambient', pattern: 'apps/mobile/src/*.d.ts', mode: 'file' },
      ],
    },
    rules: {
      'boundaries/dependencies': ['warn', { default: 'disallow', policies: [
        { from: { element: { type: 'ui' } }, allow: toTypes('ui', 'theme') },
        { from: { element: { type: 'blocks' } }, allow: toTypes('ui', 'blocks', 'service', 'theme') },
        { from: { element: { type: 'feature' } }, allow: toTypes('ui', 'blocks', 'service', 'theme') },
        { from: { element: { type: 'feature' } }, allow: { to: { element: { type: 'feature', captured: { domain: '{{ from.element.captured.domain }}' } } } } },
        { from: { element: { type: 'service' } }, allow: toTypes('service', 'theme') },
        { from: { element: { type: 'theme' } }, allow: toTypes('theme', 'service', 'ui') },
        { from: { element: { type: 'route' } }, allow: toTypes('route', 'feature', 'blocks', 'ui', 'service', 'theme') },
      ] }],
      'boundaries/no-unknown-files': 'warn',
      'boundaries/no-unknown-dependencies': 'warn',
    },
  },
  {
    files: strictFiles, ignores: tests,
    rules: { 'boundaries/dependencies': 'error', 'boundaries/no-unknown-files': 'error', 'boundaries/no-unknown-dependencies': 'error' },
  },
];
