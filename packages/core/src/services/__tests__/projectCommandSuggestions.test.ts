import { describe, expect, it } from 'vitest';
import { commandSuggestions, packageManagerOf } from '../projectCommandSuggestions.js';

const PKG = JSON.stringify({ scripts: { test: 'vitest run', 'test:e2e': 'playwright test', lint: 'eslint .', dev: 'vite', typecheck: 'tsc', release: 'np' } });

describe('commandSuggestions', () => {
  it('offers the test, lint and typecheck scripts with the lockfile\'s package manager', () => {
    expect(commandSuggestions(PKG, packageManagerOf(['package.json', 'pnpm-lock.yaml']), 'app/package.json').map((s) => s.command)).toEqual([
      'pnpm lint',
      'pnpm test',
      'pnpm test:e2e',
      'pnpm typecheck',
    ]);
    expect(commandSuggestions(PKG, packageManagerOf(['yarn.lock']), 'app/package.json')[0]).toEqual({ command: 'yarn lint', source: 'app/package.json' });
  });

  it('offers npm only `npm test`: `npm run lint` would allow every script', () => {
    expect(commandSuggestions(PKG, packageManagerOf([]), 'p').map((s) => s.command)).toEqual(['npm test']);
  });

  it('offers nothing for a package.json it cannot read', () => {
    expect(commandSuggestions('{', 'pnpm', 'p')).toEqual([]);
  });
});
