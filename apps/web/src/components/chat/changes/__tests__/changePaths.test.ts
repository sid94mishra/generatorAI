import { describe, expect, it } from 'vitest';
import {
  hunksFromArgs,
  INLINE_DIFF_MAX_LINES,
  resolveInlineHunks,
  shouldPrefixAlias,
  statusFromOpKind,
  toDisplayPath,
  toRestorePath,
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

describe('toRestorePath', () => {
  it('strips an alias prefix — a checkpoint tree is repo-relative', () => {
    expect(toRestorePath('frontend/src/a.ts', 'frontend')).toBe('src/a.ts');
  });

  it('leaves an already repo-relative path alone', () => {
    expect(toRestorePath('src/a.ts', 'frontend')).toBe('src/a.ts');
    // A directory that merely starts with the alias is not a prefix.
    expect(toRestorePath('frontend-utils/a.ts', 'frontend')).toBe('frontend-utils/a.ts');
  });

  it('is a no-op for the workspace root', () => {
    expect(toRestorePath('notes.md', '.')).toBe('notes.md');
  });
});

describe('hunksFromArgs', () => {
  it('rebuilds an Edit as one hunk of - then + lines', () => {
    const r = hunksFromArgs('Edit', { old_string: 'a\nb', new_string: 'a\nc\nd' });
    expect(r).not.toBeNull();
    expect(r!.truncated).toBe(false);
    expect(r!.hunks).toHaveLength(1);
    expect(r!.hunks[0]!.lines).toEqual(['-a', '-b', '+a', '+c', '+d']);
    expect(r!.hunks[0]!.oldLines).toBe(2);
    expect(r!.hunks[0]!.newLines).toBe(3);
    // Line numbers are unknown for an argument-derived diff.
    expect(r!.hunks[0]!.oldStart).toBe(0);
  });

  it('renders a Write as an all-+ hunk', () => {
    const r = hunksFromArgs('Write', { file_path: 'x.js', content: 'one\ntwo\n' });
    expect(r!.hunks[0]!.lines).toEqual(['+one', '+two']);
  });

  it('emits one hunk per MultiEdit entry', () => {
    const r = hunksFromArgs('MultiEdit', {
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'd' },
      ],
    });
    expect(r!.hunks).toHaveLength(2);
  });

  it('caps the total at INLINE_DIFF_MAX_LINES and flags truncation', () => {
    const content = Array.from({ length: INLINE_DIFF_MAX_LINES + 40 }, (_, i) => `l${i}`).join('\n');
    const r = hunksFromArgs('Write', { content });
    expect(r!.truncated).toBe(true);
    expect(r!.hunks[0]!.lines).toHaveLength(INLINE_DIFF_MAX_LINES);
  });

  it('returns null for tools without diffable arguments', () => {
    expect(hunksFromArgs('Read', { file_path: 'x' })).toBeNull();
    expect(hunksFromArgs('Bash', null)).toBeNull();
  });
});

describe('resolveInlineHunks', () => {
  it('prefers the provider hunks when present', () => {
    const hunks = [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 2, lines: [' x', '+y'] }];
    const r = resolveInlineHunks(
      { kind: 'edit', filePath: 'a', additions: 1, deletions: 0, hunks, hunksTruncated: true },
      'Edit',
      { old_string: 'ignored', new_string: 'ignored' },
    );
    expect(r).toEqual({ hunks, truncated: true });
  });

  it('falls back to the arguments when the provider shipped none', () => {
    const r = resolveInlineHunks(
      { kind: 'edit', filePath: 'a', additions: 1, deletions: 1 },
      'Edit',
      { old_string: 'p', new_string: 'q' },
    );
    expect(r!.hunks[0]!.lines).toEqual(['-p', '+q']);
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
