// ────────────────────────────────────────────────────────────────
// DeltaLog — W07's durable delta path.
//
// What matters here is exactly what could be silently wrong: rotation keeps
// the live edge readable, a torn last line does not poison the file before
// it, per-scope eviction never touches a sibling scope, and the global
// ceiling never deletes a scope's live tail.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync, appendFileSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ILogger } from '@generatorai/shared';

import { DeltaLog, type DeltaLogEntry } from '../src/services/DeltaLog.js';

function mockLogger(): ILogger {
  return { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-deltalog-'));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

function entry(seq: number, kind = 'harness.token'): DeltaLogEntry {
  return { seq, kind, payload: { delta: `t${seq}` }, ts: seq * 1000 };
}

describe('DeltaLog — basic durability', () => {
  it('writes what was appended, in order, readable back by scope', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger() });
    log.append('session', 's1', entry(1));
    log.append('session', 's1', entry(2));
    log.append('session', 's1', entry(3));
    await log.flush();

    const back = await log.readTail('session', 's1');
    expect(back.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('keeps scopes on separate files', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger() });
    log.append('session', 's1', entry(1));
    log.append('session', 's2', entry(1));
    await log.flush();

    expect(await log.readTail('session', 's1')).toHaveLength(1);
    expect(await log.readTail('session', 's2')).toHaveLength(1);
    // Different scope KIND is a different subdirectory, not a collision.
    expect(await log.readTail('run', 's1')).toHaveLength(0);
  });

  it('never mixes two scope ids that differ only in a disallowed character (collision-free sanitize)', async () => {
    // △ Phase 1 review — the previous sanitize mapped every disallowed
    // character to `_`, so `abc:def` and `abc/def` sanitized to the SAME
    // filename and silently shared one file, mixing two sessions' streams.
    const log = new DeltaLog({ dir, logger: mockLogger() });
    log.append('session', 'abc:def', entry(1));
    log.append('session', 'abc/def', entry(2));
    await log.flush();

    const a = await log.readTail('session', 'abc:def');
    const b = await log.readTail('session', 'abc/def');
    expect(a.map((e) => e.seq)).toEqual([1]);
    expect(b.map((e) => e.seq)).toEqual([2]);
  });

  it('falls back to a bounded hash for a pathologically long or heavily-escaped id, still without colliding', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger() });
    const long1 = ':'.repeat(200) + 'a';
    const long2 = ':'.repeat(200) + 'b';
    log.append('session', long1, entry(1));
    log.append('session', long2, entry(2));
    await log.flush();

    expect((await log.readTail('session', long1)).map((e) => e.seq)).toEqual([1]);
    expect((await log.readTail('session', long2)).map((e) => e.seq)).toEqual([2]);
  });

  it('an empty log returns an empty array, not an error', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger() });
    expect(await log.readTail('session', 'never-written')).toEqual([]);
  });

  it('flush() is idempotent and safe with nothing pending', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger() });
    await log.flush();
    await log.flush();
  });
});

describe('DeltaLog — rotation', () => {
  it('rotates the live file once it crosses the size threshold, oldest content still readable', async () => {
    // Generous generation count: this test is about rotation happening and
    // staying readable across the boundary, not about eviction — that is
    // covered separately below. `maxFileBytes` is picked to force at least
    // one rotation within 12 small lines without outrunning `maxGenerations`.
    const log = new DeltaLog({ dir, logger: mockLogger(), maxFileBytes: 200, maxGenerations: 10 });

    // Each flush is its own file-size check, so multiple small flushes are
    // needed to actually cross the threshold and trigger a rotation.
    for (let i = 1; i <= 12; i += 1) {
      log.append('session', 's1', entry(i));
      // eslint-disable-next-line no-await-in-loop -- deliberately sequential so each flush sees the file grow
      await log.flush();
    }

    const back = await log.readTail('session', 's1');
    // Oldest-first across generations: nothing skipped, nothing duplicated.
    expect(back.map((e) => e.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));

    const scopeDir = join(dir, 'session');
    const files = await readdir(scopeDir);
    expect(files).toContain('s1.jsonl');
    expect(files).toContain('s1.jsonl.1');
  });

  it('keeps only maxGenerations rotated files, dropping the oldest', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger(), maxFileBytes: 60, maxGenerations: 1 });

    for (let i = 1; i <= 20; i += 1) {
      log.append('session', 's1', entry(i));
      // eslint-disable-next-line no-await-in-loop
      await log.flush();
    }

    const scopeDir = join(dir, 'session');
    const files = await readdir(scopeDir);
    expect(files.sort()).toEqual(['s1.jsonl', 's1.jsonl.1']);
    // The oldest entries are gone; readTail must not throw over the missing
    // generation, it just returns what survived.
    const back = await log.readTail('session', 's1');
    expect(back.length).toBeGreaterThan(0);
    expect(back.length).toBeLessThan(20);
    // What remains is still a contiguous, ordered tail — no gap in the middle.
    for (let i = 1; i < back.length; i += 1) {
      expect(back[i]!.seq).toBeGreaterThan(back[i - 1]!.seq);
    }
  });
});

describe('DeltaLog — torn-tail repair', () => {
  it('treats an unparseable last line as end of file, not a fatal error', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger() });
    log.append('session', 's1', entry(1));
    log.append('session', 's1', entry(2));
    await log.flush();

    // Simulate a crash mid-`appendFile`: a truncated JSON line at the end.
    const filePath = join(dir, 'session', 's1.jsonl');
    appendFileSync(filePath, '{"seq":3,"kind":"harn');

    const back = await log.readTail('session', 's1');
    expect(back.map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe('DeltaLog — per-scope in-memory bound', () => {
  it('drops the oldest buffered line for a flooding scope without touching a sibling scope', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger(), maxBufferedBytesPerScope: 200 });

    for (let i = 1; i <= 50; i += 1) log.append('session', 'flood', entry(i));
    log.append('session', 'quiet', entry(1));
    await log.flush();

    const flooded = await log.readTail('session', 'flood');
    const quiet = await log.readTail('session', 'quiet');

    expect(flooded.length).toBeLessThan(50); // some were dropped before ever reaching disk
    expect(flooded.at(-1)?.seq).toBe(50); // the NEWEST survives — that's the point of dropping oldest
    expect(quiet).toHaveLength(1); // unaffected by the sibling's flood
  });
});

describe('DeltaLog — global on-disk ceiling', () => {
  it('prunes rotated backlog first and leaves the live file alone when that alone meets the budget', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger(), maxTotalBytes: 25 });
    const scopeDir = join(dir, 'session');
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(join(scopeDir, 's1.jsonl'), 'x'.repeat(20)); // live: 20 bytes, fits alone
    writeFileSync(join(scopeDir, 's1.jsonl.1'), 'y'.repeat(30)); // rotated: 30 bytes, over budget alone

    const deleted = await log.enforceGlobalCeiling();

    expect(deleted).toBe(1);
    const after = await readdir(scopeDir);
    expect(after).toEqual(['s1.jsonl']); // rotated backlog gone, live tail untouched
  });

  it('evicts an entire cold scope\'s live file once rotated backlog cannot meet the budget (D15)', async () => {
    // No rotated candidates exist at all — this can only be satisfied by
    // oldest-session eviction, the phase D15 added to (b).
    const log = new DeltaLog({ dir, logger: mockLogger(), maxTotalBytes: 5 });
    const scopeDir = join(dir, 'session');
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(join(scopeDir, 's1.jsonl'), 'x'.repeat(20));

    const deleted = await log.enforceGlobalCeiling();

    expect(deleted).toBe(1);
    const after = await readdir(scopeDir);
    expect(after).toEqual([]);

    // Evicting the live file must not poison the scope going forward — the
    // next append recreates it cleanly, same as a scope never seen before.
    log.append('session', 's1', entry(99));
    await log.flush();
    expect(await log.readTail('session', 's1')).toEqual([entry(99)]);
  });

  it('evicts the oldest scope first, sparing a scope that is still busy', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger(), maxTotalBytes: 25 });
    const scopeDir = join(dir, 'session');
    mkdirSync(scopeDir, { recursive: true });
    const past = new Date(Date.now() - 60_000);
    writeFileSync(join(scopeDir, 'cold.jsonl'), 'x'.repeat(20));
    utimesSync(join(scopeDir, 'cold.jsonl'), past, past);
    writeFileSync(join(scopeDir, 'hot.jsonl'), 'y'.repeat(20)); // now — newer mtime

    const deleted = await log.enforceGlobalCeiling();

    expect(deleted).toBe(1);
    const after = await readdir(scopeDir);
    expect(after).toEqual(['hot.jsonl']);
  });

  it('respects a deletion limit, matching the RetentionSweeper contract', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger(), maxTotalBytes: 1 });
    const scopeDir = join(dir, 'session');
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(join(scopeDir, 'a.jsonl'), 'x'.repeat(20));
    writeFileSync(join(scopeDir, 'b.jsonl'), 'y'.repeat(20));

    const deleted = await log.enforceGlobalCeiling(1);

    expect(deleted).toBe(1); // stopped at the cap even though still over budget
    const after = await readdir(scopeDir);
    expect(after).toHaveLength(1);
  });

  it('deletes older-mtime rotated files before newer ones, across scopes', async () => {
    // Budgeted to fit exactly one of the two ~70-byte single-line files, so
    // the sweep must choose, not merely delete everything in sight.
    const log = new DeltaLog({ dir, logger: mockLogger(), maxTotalBytes: 100 });
    log.append('session', 'a', entry(1));
    await log.flush();
    log.append('session', 'b', entry(1));
    await log.flush();

    // Promote both live files to "rotated" generations by hand so the ceiling
    // sweep has two real candidates with a known age order, independent of
    // this test's own wall-clock timing.
    const aOld = join(dir, 'session', 'a.jsonl.1');
    const bNew = join(dir, 'session', 'b.jsonl.1');
    const { renameSync } = await import('node:fs');
    renameSync(join(dir, 'session', 'a.jsonl'), aOld);
    renameSync(join(dir, 'session', 'b.jsonl'), bNew);
    const past = new Date(Date.now() - 60_000);
    const recent = new Date();
    utimesSync(aOld, past, past);
    utimesSync(bNew, recent, recent);

    const deleted = await log.enforceGlobalCeiling();
    expect(deleted).toBeGreaterThanOrEqual(1);
    await expect(stat(aOld)).rejects.toThrow(); // older one went first
    await expect(stat(bNew)).resolves.toBeDefined();
  });

  it('reports 0 deleted and does nothing when already under budget', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger(), maxTotalBytes: 1024 * 1024 });
    log.append('session', 's1', entry(1));
    await log.flush();
    expect(await log.enforceGlobalCeiling()).toBe(0);
  });
});

describe('DeltaLog — sizeOnDisk', () => {
  it('reflects what has actually been flushed to disk', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger() });
    expect(await log.sizeOnDisk()).toBe(0);
    log.append('session', 's1', entry(1));
    await log.flush();
    expect(await log.sizeOnDisk()).toBeGreaterThan(0);
  });
});

describe('DeltaLog — bounded scope-buffer map (P1-37)', () => {
  it('does not retain a Map entry for a scope once its buffer is flushed and idle', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger() });
    log.append('session', 's1', entry(1));
    await log.flush();

    const internals = log as unknown as { buffers: Map<string, unknown> };
    expect(internals.buffers.has('session:s1')).toBe(false);
    // The data itself is still there — only the in-memory bookkeeping is gone.
    expect(await log.readTail('session', 's1')).toHaveLength(1);
  });

  it('re-creates the buffer cleanly for a scope that goes quiet and then resumes', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger() });
    log.append('session', 's1', entry(1));
    await log.flush();
    log.append('session', 's1', entry(2));
    await log.flush();

    expect(await log.readTail('session', 's1')).toEqual([entry(1), entry(2)]);
  });
});

describe('DeltaLog — lifecycle', () => {
  it('stops accepting appends after close()', async () => {
    const log = new DeltaLog({ dir, logger: mockLogger() });
    log.append('session', 's1', entry(1));
    await log.flush();
    log.close();
    log.append('session', 's1', entry(2)); // silently ignored, not thrown
    await log.flush();
    expect(await log.readTail('session', 's1')).toHaveLength(1);
  });
});
