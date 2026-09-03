// ────────────────────────────────────────────────────────────────
// Shared value formatting (Phase 9 item 5).
//
// This module had NO tests and is used by every surface — the binary's
// tables, the TUI's panes, and the generated docs. Its contract is that all
// three read the SAME, which is exactly what nothing was checking.
//
// The cases below are the ones that go wrong quietly: an ISO string
// subtracted raw yields NaN, a status with no glyph makes colour the only
// carrier of meaning (invisible to roughly 1 in 12 men and to any pipe), and
// `padEnd` alone lets an over-long cell run into the next column.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  epochOr,
  fit,
  formatBytes,
  formatCell,
  formatDuration,
  formatRelative,
  readPath,
  shortId,
  singleLine,
  statusGlyph,
  statusTone,
  toEpoch,
} from '../format.js';

describe('statusTone', () => {
  it('buckets the statuses each service actually emits', () => {
    expect(statusTone('running')).toBe('running');
    expect(statusTone('completed')).toBe('success');
    expect(statusTone('failed')).toBe('failure');
    expect(statusTone('awaiting_input')).toBe('warning');
    expect(statusTone('pending')).toBe('idle');
    expect(statusTone('skipped')).toBe('neutral');
  });

  it('treats both spellings of cancelled the same', () => {
    // The server uses one, several SDKs use the other.
    expect(statusTone('cancelled')).toBe(statusTone('canceled'));
  });

  it('is case-insensitive and safe on absent values', () => {
    expect(statusTone('COMPLETED')).toBe('success');
    expect(statusTone(null)).toBe('neutral');
    expect(statusTone(undefined)).toBe('neutral');
    expect(statusTone('')).toBe('neutral');
  });

  it('falls back to neutral for a status it has never seen', () => {
    expect(statusTone('quantum')).toBe('neutral');
  });
});

describe('statusGlyph', () => {
  it('gives every tone a distinct glyph in both alphabets', () => {
    // Colour alone must never carry meaning; a duplicate glyph would make two
    // states indistinguishable in a pipe.
    for (const unicode of [true, false]) {
      const glyphs = ['running', 'completed', 'failed', 'paused', 'pending', 'skipped'].map((s) =>
        statusGlyph(s, unicode),
      );
      expect(new Set(glyphs).size).toBe(glyphs.length);
    }
  });

  it('uses only ASCII when unicode is off', () => {
    for (const status of ['running', 'completed', 'failed', 'paused', 'pending', 'skipped']) {
      expect(statusGlyph(status, false)).toMatch(/^[\x20-\x7e]$/);
    }
  });
});

describe('toEpoch / epochOr', () => {
  it('parses an ISO string, which subtracting raw would turn into NaN', () => {
    expect(toEpoch('2026-01-02T03:04:05.000Z')).toBe(Date.parse('2026-01-02T03:04:05.000Z'));
  });

  it('passes a finite number through and rejects a non-finite one', () => {
    expect(toEpoch(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toEpoch(Number.NaN)).toBeNull();
    expect(toEpoch(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('returns null rather than NaN for anything unparseable', () => {
    expect(toEpoch('not a date')).toBeNull();
    expect(toEpoch(null)).toBeNull();
    expect(toEpoch(undefined)).toBeNull();
  });

  it('sorts unparseable values last through epochOr, without poisoning the comparator', () => {
    // A NaN in a comparator makes the sort order undefined for the WHOLE
    // array, not just the bad row.
    const rows = ['2026-01-02T00:00:00Z', 'garbage', '2026-01-01T00:00:00Z'];
    const sorted = [...rows].sort((a, b) => epochOr(b) - epochOr(a));
    expect(sorted[2]).toBe('garbage');
    expect(epochOr('garbage', -1)).toBe(-1);
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z');
  const ago = (ms: number) => formatRelative(now - ms, now);

  it('collapses anything under five seconds to "just now"', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(4_999)).toBe('just now');
  });

  it('steps through seconds, minutes, hours and days', () => {
    expect(ago(30_000)).toBe('30s ago');
    expect(ago(5 * 60_000)).toBe('5m ago');
    expect(ago(3 * 3_600_000)).toBe('3h ago');
    expect(ago(2 * 86_400_000)).toBe('2d ago');
  });

  it('switches to an absolute date beyond thirty days', () => {
    // "1200d ago" tells nobody anything.
    expect(ago(60 * 86_400_000)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reads a future timestamp as future rather than as a negative age', () => {
    expect(formatRelative(now + 120_000, now)).toBe('in 2m');
  });

  it('renders an unparseable timestamp as a dash, not as NaN', () => {
    expect(formatRelative('nonsense', now)).toBe('—');
    expect(formatRelative(null, now)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('uses the largest two units that carry information', () => {
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3 * 3_600_000 + 4 * 60_000)).toBe('3h 4m');
  });

  it('renders nothing measurable as a dash', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('formatBytes', () => {
  it('scales to the largest unit that keeps the number readable', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(2048)).toBe('2.0KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0MB');
  });

  it('stops at the largest unit it knows rather than inventing one', () => {
    expect(formatBytes(1024 ** 6)).toContain('TB');
  });

  it('renders a missing size as a dash', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('shortId', () => {
  it('shortens a UUID to its first segment', () => {
    expect(shortId('9f8e7d6c-1234-5678-9abc-def012345678')).toBe('9f8e7d6c');
  });

  it('leaves a non-UUID identifier alone — truncating it would break a lookup', () => {
    expect(shortId('acme.charts')).toBe('acme.charts');
    expect(shortId('short')).toBe('short');
  });

  it('renders an absent id as a dash', () => {
    expect(shortId(null)).toBe('—');
    expect(shortId('')).toBe('—');
  });
});

describe('readPath', () => {
  it('reads a dotted path, so a column can render a nested payload', () => {
    expect(readPath({ definition: { name: 'ship it' } }, 'definition.name')).toBe('ship it');
  });

  it('returns undefined instead of throwing when the path runs off the object', () => {
    expect(readPath({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(readPath(null, 'a')).toBeUndefined();
    expect(readPath({ a: null }, 'a.b')).toBeUndefined();
  });
});

describe('formatCell', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z');

  it('renders each declared format', () => {
    expect(formatCell('9f8e7d6c-1234-5678-9abc-def012345678', 'id')).toBe('9f8e7d6c');
    expect(formatCell(now - 60_000, 'relative', { now })).toBe('1m ago');
    expect(formatCell(2048, 'bytes')).toBe('2.0KB');
    expect(formatCell(90_000, 'duration')).toBe('1m 30s');
    expect(formatCell(['a', 'b'], 'list')).toBe('a, b');
    expect(formatCell(1234, 'number')).toBe((1234).toLocaleString());
    expect(formatCell('completed', 'status')).toContain('completed');
  });

  it('renders a missing value as a dash for every format', () => {
    for (const format of ['id', 'relative', 'bytes', 'duration', 'list', 'number', 'status']) {
      expect(formatCell(null, format)).toBe('—');
      expect(formatCell(undefined, format)).toBe('—');
    }
  });

  it('uses words rather than glyphs for booleans when unicode is off', () => {
    expect(formatCell(true, 'boolean', { unicode: false })).toBe('yes');
    expect(formatCell(false, 'boolean', { unicode: false })).toBe('no');
  });

  it('serialises an object rather than printing [object Object]', () => {
    expect(formatCell({ a: 1 }, undefined)).toBe('{"a":1}');
  });

  it('renders an unparseable date as a dash', () => {
    expect(formatCell('nonsense', 'date')).toBe('—');
  });
});

describe('singleLine and fit', () => {
  it('collapses newlines so a multi-line field cannot break a table row', () => {
    expect(singleLine('one\n  two\t three ')).toBe('one two three');
  });

  it('truncates with an ellipsis past the maximum', () => {
    expect(singleLine('abcdefghij', 5)).toBe('abcd…');
  });

  it('both pads AND truncates to exactly the requested width', () => {
    // `padEnd` alone only ever grows a string, so an over-long value silently
    // runs into whatever column comes after it.
    expect(fit('ab', 5)).toBe('ab   ');
    expect(fit('abcdefgh', 5)).toBe('abcd…');
    expect(fit('abcdefgh', 5)).toHaveLength(5);
    expect(fit('ab', 5)).toHaveLength(5);
  });

  it('returns nothing for a non-positive width instead of throwing', () => {
    expect(fit('abc', 0)).toBe('');
    expect(fit('abc', -3)).toBe('');
  });
});
