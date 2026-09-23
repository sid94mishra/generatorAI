import { describe, expect, it } from 'vitest';

import { PREVIEW_LINES, editPreview, workspaceRelative } from '../components/chat/permissionPreview';

const edit = (input: Record<string, unknown>) => JSON.stringify(input, null, 2);

describe('editPreview', () => {
  it('turns an Edit into a relative path and the changed lines only', () => {
    const p = editPreview(
      'Edit',
      edit({
        file_path: '/tmp/gaimob/ws/executions/8f92/source/shopkit/src/pricing/discounts.js',
        old_string: '  if (x) return 0;\n  // BUG: can exceed subtotal\n  return rule.value;',
        new_string: '  if (x) return 0;\n  return Math.min(rule.value, subtotalCents);',
      }),
    );
    expect(p).toEqual({
      path: 'src/pricing/discounts.js',
      removed: ['  // BUG: can exceed subtotal', '  return rule.value;'],
      added: ['  return Math.min(rule.value, subtotalCents);'],
      hidden: 0,
    });
  });

  it('shows a new file as added lines', () => {
    const p = editPreview('Write', edit({ file_path: '/a/b/source/app/test/x.test.js', content: 'line 1\nline 2\n' }));
    expect(p).toMatchObject({ path: 'test/x.test.js', removed: [], added: ['line 1', 'line 2'] });
  });

  it('merges a MultiEdit', () => {
    const p = editPreview(
      'MultiEdit',
      edit({ file_path: '/w/source/r/a.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] }),
    );
    expect(p).toMatchObject({ removed: ['a', 'c'], added: ['b', 'd'] });
  });

  it('caps each side and counts what it hid', () => {
    const many = Array.from({ length: PREVIEW_LINES + 4 }, (_, i) => `l${i}`).join('\n');
    const p = editPreview('Write', edit({ file_path: '/w/source/r/big.txt', content: many }));
    expect(p?.added).toHaveLength(PREVIEW_LINES);
    expect(p?.hidden).toBe(4);
  });

  it('falls back (null) for other tools, truncated input and missing paths', () => {
    expect(editPreview('Bash', edit({ command: 'ls' }))).toBeNull();
    expect(editPreview('Edit', '{"file_path": "/w/a.ts", "old_string": "abc')).toBeNull();
    expect(editPreview('Edit', edit({ old_string: 'a', new_string: 'b' }))).toBeNull();
    expect(editPreview('Edit', null)).toBeNull();
  });
});

describe('workspaceRelative', () => {
  it('cuts to the mount root, or to the last three segments', () => {
    expect(workspaceRelative('/x/ws/executions/id/source/shopkit/src/a.ts')).toBe('src/a.ts');
    expect(workspaceRelative('C:\\x\\source\\app\\lib\\b.ts')).toBe('lib/b.ts');
    expect(workspaceRelative('/home/me/project/deep/dir/file.ts')).toBe('deep/dir/file.ts');
    expect(workspaceRelative('file.ts')).toBe('file.ts');
  });
});

describe('commandPreview', () => {
  it('reads a shell call as its command and note', async () => {
    const { commandPreview } = await import('../components/chat/permissionPreview');
    expect(commandPreview('{\n "command": "npm test 2>&1 | tail -30"\n}')).toEqual({ command: 'npm test 2>&1 | tail -30', note: null });
    expect(commandPreview(JSON.stringify({ command: 'ls', description: 'List files', timeout: 5 }))).toEqual({
      command: 'ls',
      note: 'List files',
    });
  });

  it('stays raw for anything else', async () => {
    const { commandPreview } = await import('../components/chat/permissionPreview');
    expect(commandPreview('{"path":"a.ts"}')).toBeNull();
    expect(commandPreview('{"command":"ls","cwd":"/elsewhere"}')).toBeNull();
    expect(commandPreview('{"command":"ls", "trunc')).toBeNull();
    expect(commandPreview('"ls"')).toBeNull();
  });
});
