import { describe, expect, it } from 'vitest';
import {
  shouldPrefixAlias,
  statusFromOpKind,
  toDisplayPath,
  joinPath,
  withAliasPrefix,
} from '../changePaths.js';

describe('toDisplayPath', () => {
  it('maps a linked-codebase file inside a managed workspace to <alias>/<path>', () => {
    expect(
      toDisplayPath(
        'C:\\Users\\me\\.generatorai\\workspaces\\executions\\chat-1\\source\\todo-api\\src\\lib\\store.js',
      ),
    ).toBe('todo-api/src/lib/store.js');
  });

  it('maps a workspace-root file to its bare relative path', () => {
    expect(toDisplayPath('/home/me/.generatorai/workspaces/executions/chat-1/notes.md')).toBe('notes.md');
  });

  it('strips a local-folder root when one is supplied', () => {
    expect(toDisplayPath('C:/gaitest/sample-app/src/a.ts', ['C:\\gaitest\\sample-app\\'])).toBe('src/a.ts');
  });

  it('leaves an already-relative path alone', () => {
    expect(toDisplayPath('todo-api/src/a.ts')).toBe('todo-api/src/a.ts');
  });

  it('falls back to the last three segments of an unknown absolute path', () => {
    expect(toDisplayPath('/var/tmp/deep/tree/of/dirs/file.txt')).toBe('of/dirs/file.txt');
  });
});

describe('alias prefixing', () => {
  it('prefixes only when there is more than one mount', () => {
    expect(shouldPrefixAlias(0)).toBe(false);
    expect(shouldPrefixAlias(1)).toBe(false);
    expect(shouldPrefixAlias(2)).toBe(true);
  });

  it('never prefixes the workspace root', () => {
    expect(withAliasPrefix('.', 'notes.md', true)).toBe('notes.md');
    expect(withAliasPrefix('frontend', 'src/a.ts', true)).toBe('frontend/src/a.ts');
    expect(withAliasPrefix('frontend', 'src/a.ts', false)).toBe('src/a.ts');
  });
});

describe('toDisplayPath with mounts', () => {
  // Windows separators, built rather than escaped so the intent stays legible.
  const win = (...segments: string[]) => segments.join(String.fromCharCode(92));
  const frontend = { alias: 'frontend', path: win('C:', 'src', 'frontend') };
  const backend = { alias: 'backend', path: win('C:', 'src', 'backend') };

  it('names a file after its mount when the chat has several', () => {
    expect(
      toDisplayPath(win('C:', 'src', 'frontend', 'src', 'App.tsx'), [frontend, backend]),
    ).toBe('frontend/src/App.tsx');
    expect(toDisplayPath('C:/src/backend/api/index.ts', [frontend, backend])).toBe(
      'backend/api/index.ts',
    );
  });

  it('drops the alias when there is only one mount', () => {
    expect(toDisplayPath(win('C:', 'src', 'frontend', 'src', 'App.tsx'), [frontend])).toBe(
      'src/App.tsx',
    );
  });

  it('prefers the deepest mount when one is nested inside another', () => {
    const parent = { alias: 'repo', path: '/src/repo' };
    const child = { alias: 'ui', path: '/src/repo/packages/ui' };
    expect(toDisplayPath('/src/repo/packages/ui/Button.tsx', [parent, child])).toBe(
      'ui/Button.tsx',
    );
  });

  it('falls back to the managed-workspace shape when no mount matches', () => {
    expect(
      toDisplayPath('/home/me/.generatorai/workspaces/executions/chat-1/plans/p.md', [
        frontend,
        backend,
      ]),
    ).toBe('plans/p.md');
  });
});

describe('joinPath', () => {
  it('joins with the mount’s own separator', () => {
    expect(joinPath('/repo/app', 'src/a.ts')).toBe('/repo/app/src/a.ts');
    expect(joinPath('C:\\repo\\app', 'src/a.ts')).toBe('C:\\repo\\app\\src/a.ts');
  });

  it('drops a trailing separator and a leading one on the file', () => {
    expect(joinPath('/repo/app/', '/src/a.ts')).toBe('/repo/app/src/a.ts');
  });

  it('returns the relative path when there is no root', () => {
    expect(joinPath('', 'src/a.ts')).toBe('src/a.ts');
  });
});

describe('statusFromOpKind', () => {
  it('maps op kinds to the Changes tab letters', () => {
    expect(statusFromOpKind('create')).toBe('A');
    expect(statusFromOpKind('delete')).toBe('D');
    expect(statusFromOpKind('edit')).toBe('M');
    expect(statusFromOpKind('update')).toBe('M');
  });
});
