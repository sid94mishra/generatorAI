import { describe, expect, it } from 'vitest';
import { hunksFromArgs, INLINE_DIFF_MAX_LINES, resolveInlineHunks } from '../transcript/inlineHunks.js';

// Moved from apps/web blocks/changes/__tests__/changePaths.test.ts (P4-07).
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

