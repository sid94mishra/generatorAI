// ────────────────────────────────────────────────────────────────
// W13 — per-record byte cap with DROP-on-exceed.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import {
  ByteCapper,
  DEFAULT_RECORD_BYTE_CAP,
  renderRecord,
} from '../../src/hardening/byteCap.js';

describe('W13 — per-record byte cap', () => {
  it('leaves a record inside the cap completely untouched', () => {
    const capper = new ByteCapper({ capBytes: 1_000 });
    const r = capper.apply('hello world', 'Read');
    expect(r.capped).toBe(false);
    expect(r.value).toBe('hello world');
    expect(r.bytes).toBe(11);
    expect(capper.stats.cappedCount).toBe(0);
  });

  it('DROPS an oversized record instead of truncating it', () => {
    const capper = new ByteCapper({ capBytes: 100 });
    const huge = JSON.stringify({ files: Array.from({ length: 500 }, (_v, i) => `file-${i}.ts`) });
    const r = capper.apply(huge, 'Glob');

    expect(r.capped).toBe(true);
    // The defining assertion: the result is NOT a prefix of the original.
    // A prefix of that JSON is invalid JSON, and the model would parse it wrong
    // with full confidence (X-2).
    expect(huge.startsWith(r.value)).toBe(false);
    expect(r.value).not.toContain('file-0.ts');
  });

  it('the replacement is model-legible: what happened, how big, what to do', () => {
    const capper = new ByteCapper({ capBytes: 64 });
    const r = capper.apply('x'.repeat(5_000), 'Bash');
    expect(r.value).toContain('Bash');
    expect(r.value).toContain('5000 bytes');
    expect(r.value).toMatch(/exceeds the 64-byte per-record limit/);
    expect(r.value).toMatch(/rather than truncated/);
    expect(r.value).toMatch(/narrower scope/);
  });

  it('measures BYTES, not characters — multi-byte content is not undercounted', () => {
    const capper = new ByteCapper({ capBytes: 10 });
    // 6 characters, 18 bytes in UTF-8.
    const r = capper.apply('日本語テスト', 'Read');
    expect(r.bytes).toBe(18);
    expect(r.capped).toBe(true);
  });

  it('serialises non-string records before measuring them', () => {
    const capper = new ByteCapper({ capBytes: 10_000 });
    const r = capper.apply({ a: 1, b: [1, 2, 3] }, 'Tool');
    expect(r.value).toBe('{"a":1,"b":[1,2,3]}');
    expect(r.capped).toBe(false);
  });

  it('survives a cyclic record rather than throwing on the tool-result path', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;
    expect(() => renderRecord(cyclic)).not.toThrow();
    const capper = new ByteCapper({ capBytes: 10_000 });
    expect(() => capper.apply(cyclic, 'Tool')).not.toThrow();
  });

  it('reports capping — a silent cap is indistinguishable from a broken tool', () => {
    const seen: Array<{ label: string; bytes: number }> = [];
    const capper = new ByteCapper({
      capBytes: 10,
      onExceeded: (info) => seen.push({ label: info.label, bytes: info.bytes }),
    });
    capper.apply('x'.repeat(100), 'Read');
    capper.apply('ok', 'Read');
    capper.apply('y'.repeat(50), 'Write');

    expect(seen).toEqual([{ label: 'Read', bytes: 100 }, { label: 'Write', bytes: 50 }]);
    expect(capper.stats.cappedCount).toBe(2);
    expect(capper.stats.droppedBytes).toBe(90 + 40);
  });

  it('head-tail mode keeps both ends with an explicit elision marker', () => {
    const capper = new ByteCapper({ capBytes: 2_000, mode: 'head-tail' });
    const log = `START${'-'.repeat(20_000)}END`;
    const r = capper.apply(log, 'Bash');
    expect(r.capped).toBe(true);
    expect(r.value.startsWith('START')).toBe(true);
    expect(r.value.endsWith('END')).toBe(true);
    expect(r.value).toMatch(/bytes elided/);
    // Still bounded: the elided form is far smaller than the original.
    expect(Buffer.byteLength(r.value)).toBeLessThan(log.length);
  });

  it('a cap of 0 or less disables capping entirely', () => {
    const capper = new ByteCapper({ capBytes: 0 });
    const huge = 'z'.repeat(10_000_000);
    const r = capper.apply(huge, 'Read');
    expect(r.capped).toBe(false);
    expect(r.value).toBe(huge);
  });

  it('defaults to 1 MiB', () => {
    expect(DEFAULT_RECORD_BYTE_CAP).toBe(1_048_576);
    const capper = new ByteCapper();
    expect(capper.apply('a'.repeat(1_000_000), 'Read').capped).toBe(false);
    expect(capper.apply('a'.repeat(2_000_000), 'Read').capped).toBe(true);
  });
});
