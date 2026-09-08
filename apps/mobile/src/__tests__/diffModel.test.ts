import { describe, expect, it } from 'vitest';

import {
  anchorFor,
  anchorText,
  buildRows,
  clampFont,
  contentWidthFor,
  gutterWidthFor,
  hunkHeaderIndices,
  hunkLabel,
  languageForPath,
  longestLine,
  maxLineNumber,
  normalizeEol,
  parsePatch,
  prefersSplit,
  rowHeightFor,
  toSplitRows,
} from '../components/changes/diffModel';

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@ function a()',
  ' const x = 1;',
  '-const y = 2;',
  '+const y = 3;',
  '+const z = 4;',
  ' export {};',
  '@@ -10,2 +11,1 @@',
  ' tail',
  '-gone',
  '',
].join('\n');

describe('diffModel', () => {
  describe('normalizeEol', () => {
    it('strips CRLF and bare CR to LF', () => {
      expect(normalizeEol('a\r\nb\rc\n')).toBe('a\nb\nc\n');
    });
    it('returns the same string when there is nothing to do', () => {
      const s = 'a\nb';
      expect(normalizeEol(s)).toBe(s);
    });
    it('parses a CRLF patch to the same rows as an LF patch', () => {
      const lf = parsePatch(PATCH);
      const crlf = parsePatch(PATCH.replace(/\n/g, '\r\n'));
      expect(crlf).toEqual(lf);
      // No phantom \r on any row content.
      for (const hunk of crlf.hunks) for (const row of hunk.rows) expect(row.content).not.toMatch(/\r/);
    });
  });

  describe('buildRows', () => {
    it('emits a header per hunk followed by its lines, typed and numbered', () => {
      const rows = buildRows(parsePatch(PATCH));
      expect(rows.map((r) => r.type)).toEqual([
        'hunk', 'line', 'line', 'line', 'line', 'line',
        'hunk', 'line', 'line',
      ]);
      const first = rows[1]!;
      expect(first.type === 'line' && first.row.kind).toBe('context');
      expect(first.type === 'line' && first.anchor).toEqual({ side: 'additions', line: 1 });
      const del = rows[2]!;
      expect(del.type === 'line' && del.row.kind).toBe('del');
      expect(del.type === 'line' && del.anchor).toEqual({ side: 'deletions', line: 2 });
      const add = rows[3]!;
      expect(add.type === 'line' && add.row.kind).toBe('add');
      expect(add.type === 'line' && add.anchor).toEqual({ side: 'additions', line: 2 });
    });

    it('labels hunks with the section and hides collapsed lines', () => {
      const parsed = parsePatch(PATCH);
      expect(hunkLabel(parsed.hunks[0]!)).toBe('@@ -1,3 +1,4 @@ function a()');
      const rows = buildRows(parsed, { collapsed: new Set([0]) });
      expect(rows[0]).toMatchObject({ type: 'hunk', collapsed: true, hiddenCount: 5 });
      expect(rows[1]!.type).toBe('hunk');
      expect(hunkHeaderIndices(rows)).toEqual([0, 1]);
    });

    it('appends a truncation notice when the server cut the patch', () => {
      const rows = buildRows(parsePatch(PATCH), { truncated: true });
      expect(rows.at(-1)).toMatchObject({ type: 'notice', tone: 'warning' });
    });

    it('keys rows uniquely across hunks', () => {
      const keys = buildRows(parsePatch(PATCH)).map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe('anchors', () => {
    it('anchors deletions on the old side and everything else on the new side', () => {
      expect(anchorFor({ kind: 'del', oldNumber: 7, content: '' })).toEqual({ side: 'deletions', line: 7 });
      expect(anchorFor({ kind: 'add', newNumber: 9, content: '' })).toEqual({ side: 'additions', line: 9 });
      expect(anchorFor({ kind: 'context', oldNumber: 1, newNumber: 2, content: '' })).toEqual({ side: 'additions', line: 2 });
    });
    it('extracts the anchor text for a range on a side, LF-joined', () => {
      const parsed = parsePatch(PATCH);
      expect(anchorText(parsed, 'additions', 2, 3)).toBe('const y = 3;\nconst z = 4;');
      expect(anchorText(parsed, 'deletions', 2, 2)).toBe('const y = 2;');
    });
  });

  describe('geometry', () => {
    it('clamps the font size to 10–18 and rounds', () => {
      expect(clampFont(3)).toBe(10);
      expect(clampFont(40)).toBe(18);
      expect(clampFont(13.6)).toBe(14);
    });
    it('derives a fixed row height from the font size', () => {
      expect(rowHeightFor(12)).toBe(20);
      expect(rowHeightFor(18)).toBe(29);
    });
    it('sizes the gutter for the largest line number', () => {
      expect(gutterWidthFor(9, 12)).toBe(Math.ceil(2 * 12 * 0.6) + 8);
      expect(gutterWidthFor(12345, 12)).toBe(Math.ceil(5 * 12 * 0.6) + 8);
    });
    it('measures the longest line and the max line number', () => {
      const parsed = parsePatch(PATCH);
      expect(longestLine(parsed)).toBe('const y = 3;'.length);
      expect(maxLineNumber(parsed)).toBe(12);
    });
    it('never sizes the surface narrower than the viewport, and grows with the longest line', () => {
      expect(contentWidthFor({ longest: 10, gutter: 30, fontSize: 12, viewport: 390 })).toBe(390);
      const wide = contentWidthFor({ longest: 200, gutter: 30, fontSize: 12, viewport: 390 });
      expect(wide).toBeGreaterThan(390);
      expect(wide).toBe(30 + 16 + Math.ceil(200 * 12 * 0.6) + 24);
    });
    it('prefers split from 700pt unless overridden', () => {
      expect(prefersSplit(390)).toBe(false);
      expect(prefersSplit(700)).toBe(true);
      expect(prefersSplit(1024, 'unified')).toBe(false);
      expect(prefersSplit(390, 'split')).toBe(true);
    });
  });

  describe('toSplitRows', () => {
    it('zips a deletion run with the addition run that follows it', () => {
      const split = toSplitRows(buildRows(parsePatch(PATCH)));
      const pairs = split.filter((r) => r.type === 'split');
      // context | del+add | add-only | context | context | del-only
      expect(pairs.map((p) => (p.type === 'split' ? [p.left?.kind ?? null, p.right?.kind ?? null] : null))).toEqual([
        ['context', 'context'],
        ['del', 'add'],
        [null, 'add'],
        ['context', 'context'],
        ['context', 'context'],
        ['del', null],
      ]);
    });
    it('keeps hunk headers and notices in place', () => {
      const split = toSplitRows(buildRows(parsePatch(PATCH), { truncated: true }));
      expect(split[0]!.type).toBe('hunk');
      expect(split.at(-1)!.type).toBe('notice');
    });
  });

  describe('languageForPath', () => {
    it('prefers the server hint, then the extension', () => {
      expect(languageForPath('a.ts', 'python')).toBe('python');
      expect(languageForPath('src/x.tsx')).toBe('tsx');
      expect(languageForPath('Makefile')).toBeNull();
    });
  });
});
