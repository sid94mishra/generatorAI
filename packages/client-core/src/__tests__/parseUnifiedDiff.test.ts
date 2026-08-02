import { describe, expect, it } from 'vitest';

import { countRows, parseUnifiedDiff, toDiffList } from '../diff/parseUnifiedDiff.js';

// Header counts are the SPAN of each side, not the row count:
//   old side: `const a`, `const b = 2`, `export`      -> 3
//   new side: `const a`, `const b = 3`, `const c`, `export` -> 4
const simple = `diff --git a/src/a.ts b/src/a.ts
index 1234567..89abcde 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a };
`;

describe('parseUnifiedDiff — structure', () => {
  it('extracts hunks, rows and counts', () => {
    const d = parseUnifiedDiff(simple);
    expect(d.hunks).toHaveLength(1);
    expect(d.additions).toBe(2);
    expect(d.deletions).toBe(1);
    expect(d.truncated).toBe(false);
    expect(d.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 });
  });

  it('numbers both sides correctly across an edit', () => {
    // Off-by-one here is the classic diff bug: a comment posted against the
    // wrong line is worse than no comment at all.
    const rows = parseUnifiedDiff(simple).hunks[0]!.rows;
    expect(rows.map((r) => [r.kind, r.oldNumber, r.newNumber])).toEqual([
      ['context', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['add', undefined, 3],
      ['context', 3, 4],
    ]);
  });

  it('strips the marker but preserves leading whitespace', () => {
    const d = parseUnifiedDiff('@@ -1,1 +1,2 @@\n' + ' function f() {\n' + '+    return 1;\n');
    // Losing indentation makes the diff unreadable for every indented language.
    expect(d.hunks[0]!.rows[1]!.content).toBe('    return 1;');
  });

  it('captures the section heading after the closing @@', () => {
    const d = parseUnifiedDiff('@@ -10,2 +10,2 @@ function doThing() {\n context\n-a\n+b\n');
    expect(d.hunks[0]!.section).toBe('function doThing() {');
  });

  it('treats an omitted count as exactly one line', () => {
    // `@@ -5 +5 @@` is legal shorthand; defaulting to 0 would mark the hunk
    // truncated and hide the change behind a warning.
    const d = parseUnifiedDiff('@@ -5 +5 @@\n-old\n+new\n');
    expect(d.hunks[0]).toMatchObject({ oldStart: 5, oldLines: 1, newStart: 5, newLines: 1 });
    expect(d.truncated).toBe(false);
  });

  it('parses multiple hunks with independent numbering', () => {
    const d = parseUnifiedDiff(
      '@@ -1,2 +1,2 @@\n a\n-b\n+B\n' + '@@ -50,2 +50,2 @@\n x\n-y\n+Y\n',
    );
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[1]!.rows[0]).toMatchObject({ oldNumber: 50, newNumber: 50 });
    expect(d.additions).toBe(2);
    expect(d.deletions).toBe(2);
  });
});

describe('parseUnifiedDiff — edge cases that corrupt line numbers', () => {
  it('treats a bare empty line as an empty context row', () => {
    // Git emits '' (not ' ') for an empty context line. Dropping it shifts
    // every subsequent line number by one.
    const d = parseUnifiedDiff('@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n');
    const rows = d.hunks[0]!.rows;
    expect(rows[1]).toMatchObject({ kind: 'context', content: '', oldNumber: 2, newNumber: 2 });
    expect(rows[2]).toMatchObject({ kind: 'del', oldNumber: 3 });
  });

  it('attaches "no newline at end of file" to the preceding row', () => {
    const d = parseUnifiedDiff('@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n');
    const rows = d.hunks[0]!.rows;
    expect(rows[0]).toMatchObject({ kind: 'del', noNewline: true });
    // It must NOT become a row of its own.
    expect(rows).toHaveLength(2);
  });

  it('preserves content that itself starts with +, - or @', () => {
    // Only the FIRST character is the marker. Mis-handling this mangles diffs
    // of diffs, changelogs and decorator-heavy code.
    const d = parseUnifiedDiff('@@ -1,3 +1,3 @@\n+++a\n---b\n @@ c\n');
    expect(d.hunks[0]!.rows.map((r) => [r.kind, r.content])).toEqual([
      ['add', '++a'],
      ['del', '--b'],
      ['context', '@@ c'],
    ]);
  });

  it('tolerates CRLF line endings', () => {
    const d = parseUnifiedDiff('@@ -1,1 +1,1 @@\r\n-old\r\n+new\r\n');
    expect(d.hunks[0]!.rows.map((r) => r.content)).toEqual(['old', 'new']);
  });

  it('does not emit a phantom row for the final newline', () => {
    expect(countRows(parseUnifiedDiff('@@ -1,1 +1,1 @@\n-a\n+b\n'))).toBe(2);
  });
});

describe('parseUnifiedDiff — file headers', () => {
  it('ignores git metadata rather than rendering it as content', () => {
    const d = parseUnifiedDiff(simple);
    const contents = d.hunks[0]!.rows.map((r) => r.content);
    expect(contents.some((c) => c.includes('diff --git'))).toBe(false);
    expect(contents.some((c) => c.startsWith('index '))).toBe(false);
  });

  it('handles rename metadata', () => {
    const d = parseUnifiedDiff(
      'diff --git a/old.ts b/new.ts\nsimilarity index 95%\nrename from old.ts\nrename to new.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n',
    );
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0]!.rows).toHaveLength(2);
  });

  it('closes a hunk when the next file header appears', () => {
    const d = parseUnifiedDiff(
      '@@ -1,1 +1,1 @@\n-a\n+b\n' +
        'diff --git a/second.ts b/second.ts\n--- a/second.ts\n+++ b/second.ts\n@@ -1,1 +1,1 @@\n-c\n+d\n',
    );
    expect(d.hunks).toHaveLength(2);
    expect(d.truncated).toBe(false);
  });

  it('does not crash on a binary-file patch', () => {
    const d = parseUnifiedDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n');
    expect(d.hunks).toEqual([]);
    expect(d.truncated).toBe(false);
  });
});

describe('parseUnifiedDiff — resilience', () => {
  it('returns an empty result for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual({
      hunks: [],
      additions: 0,
      deletions: 0,
      truncated: false,
    });
  });

  it('flags a hunk cut short by server truncation', () => {
    // The server caps patches at 512KB, so a half-hunk is expected, not
    // exceptional. It must be reported rather than shown as complete.
    const d = parseUnifiedDiff('@@ -1,10 +1,10 @@\n a\n-b\n+B\n');
    expect(d.truncated).toBe(true);
    // Whatever WAS readable is still returned.
    expect(d.hunks[0]!.rows).toHaveLength(3);
  });

  it('stops cleanly on a malformed marker instead of throwing', () => {
    const d = parseUnifiedDiff('@@ -1,2 +1,2 @@\n a\n?corrupt\n');
    expect(d.truncated).toBe(true);
    expect(d.hunks[0]!.rows).toHaveLength(1);
  });

  it('never throws on arbitrary text', () => {
    for (const junk of ['not a diff', '@@@', '@@ bad header @@', '\\', '---', '+++']) {
      expect(() => parseUnifiedDiff(junk)).not.toThrow();
    }
  });
});

describe('toDiffList', () => {
  it('interleaves hunk headers with their rows', () => {
    const list = toDiffList(parseUnifiedDiff(simple));
    expect(list[0]!.type).toBe('hunk');
    expect(list.slice(1).every((i) => i.type === 'row')).toBe(true);
    expect(list).toHaveLength(1 + 5);
  });

  it('produces unique keys across hunks', () => {
    // Line numbers repeat between hunks and are absent on additions, so a
    // key derived from them silently collides and React reuses the wrong row.
    const list = toDiffList(
      parseUnifiedDiff('@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n'),
    );
    expect(new Set(list.map((i) => i.key)).size).toBe(list.length);
  });
});
