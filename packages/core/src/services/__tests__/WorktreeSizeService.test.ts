// ────────────────────────────────────────────────────────────────
// WorktreeSizeService (G-17) — async, cached, bounded-concurrency disk
// usage over REAL temp directories (plain `fs.promises`, cross-platform —
// never a shelled-out `du`).
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorktreeSizeService } from '../WorktreeSizeService.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} } as never;

/** Polls until `getCachedSizeBytes` has a value (or times out). */
async function waitForSize(svc: WorktreeSizeService, id: string, timeoutMs = 5_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const size = svc.getCachedSizeBytes(id);
    if (size !== undefined) return size;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`size for ${id} was never measured within ${timeoutMs}ms`);
}

describe('WorktreeSizeService', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wt-size-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is undefined (never a fake 0) before anything has been measured', () => {
    const svc = new WorktreeSizeService(logger);
    expect(svc.getCachedSizeBytes('wt1')).toBeUndefined();
  });

  it('measures the real byte size of files recursively', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x'.repeat(100));
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'b.txt'), 'y'.repeat(50));

    const svc = new WorktreeSizeService(logger);
    svc.requestMeasurement('wt1', dir);
    const size = await waitForSize(svc, 'wt1');
    expect(size).toBe(150);
  });

  it('does not follow symlinks (avoids cycles / escaping the worktree)', async () => {
    writeFileSync(join(dir, 'real.txt'), 'z'.repeat(40));
    const outside = mkdtempSync(join(tmpdir(), 'wt-size-outside-'));
    writeFileSync(join(outside, 'huge.txt'), 'w'.repeat(10_000));
    try {
      symlinkSync(outside, join(dir, 'escape-link'));
      const svc = new WorktreeSizeService(logger);
      svc.requestMeasurement('wt1', dir);
      const size = await waitForSize(svc, 'wt1');
      expect(size).toBe(40); // the symlinked 10,000 bytes must NOT be counted
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('caches: a second call within the TTL does not remeasure', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x'.repeat(10));
    const svc = new WorktreeSizeService(logger, 60_000); // long TTL
    svc.requestMeasurement('wt1', dir);
    await waitForSize(svc, 'wt1');

    writeFileSync(join(dir, 'b.txt'), 'y'.repeat(1000)); // grow the dir
    svc.requestMeasurement('wt1', dir); // within TTL — should be a no-op
    await new Promise((r) => setTimeout(r, 50));
    expect(svc.getCachedSizeBytes('wt1')).toBe(10); // stale cached value, not the new size
  });

  it('remeasures once the TTL has elapsed', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x'.repeat(10));
    const svc = new WorktreeSizeService(logger, 20); // very short TTL
    svc.requestMeasurement('wt1', dir);
    await waitForSize(svc, 'wt1');
    expect(svc.getCachedSizeBytes('wt1')).toBe(10);

    writeFileSync(join(dir, 'b.txt'), 'y'.repeat(1000));
    await new Promise((r) => setTimeout(r, 30)); // let the TTL expire
    svc.requestMeasurement('wt1', dir);
    await new Promise((r) => {
      const check = (): void => {
        if (svc.getCachedSizeBytes('wt1') === 1010) return r(undefined);
        setTimeout(check, 10);
      };
      check();
    });
    expect(svc.getCachedSizeBytes('wt1')).toBe(1010);
  });

  it('bounded concurrency: a request beyond the limit is simply skipped this round', async () => {
    const dirs = [dir, mkdtempSync(join(tmpdir(), 'wt-size-b-')), mkdtempSync(join(tmpdir(), 'wt-size-c-'))];
    try {
      const svc = new WorktreeSizeService(logger, 10_000, 1); // concurrency 1
      svc.requestMeasurement('wt1', dirs[0]!);
      svc.requestMeasurement('wt2', dirs[1]!); // over the limit — dropped, not queued
      svc.requestMeasurement('wt3', dirs[2]!); // also dropped
      await waitForSize(svc, 'wt1');
      // The other two never even started this round.
      expect(svc.getCachedSizeBytes('wt2')).toBeUndefined();
      expect(svc.getCachedSizeBytes('wt3')).toBeUndefined();
    } finally {
      rmSync(dirs[1]!, { recursive: true, force: true });
      rmSync(dirs[2]!, { recursive: true, force: true });
    }
  });

  it('a missing directory resolves to size 0 rather than throwing', async () => {
    const svc = new WorktreeSizeService(logger);
    svc.requestMeasurement('wt1', join(dir, 'does-not-exist'));
    const size = await waitForSize(svc, 'wt1');
    expect(size).toBe(0);
  });

  it('invalidate() drops the cached value', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x'.repeat(10));
    const svc = new WorktreeSizeService(logger);
    svc.requestMeasurement('wt1', dir);
    await waitForSize(svc, 'wt1');
    svc.invalidate('wt1');
    expect(svc.getCachedSizeBytes('wt1')).toBeUndefined();
  });
});
