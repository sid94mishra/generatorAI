// RunLogger — the P0-15 rewrite.
//
// The original contract is covered by RunLogger.test.ts and still passes
// unchanged. This file covers what the rewrite added: that the hot path no
// longer blocks, that the buffer is bounded and says so when it overflows, and
// that a second live run costs nothing per event.

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventBus } from '../src/events/EventBus.js';
import { RunLogger } from '../src/events/StreamLogger.js';

function mockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
}

function readLines(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

let dir: string;
let bus: EventBus;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runlogger2-'));
  bus = new EventBus();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('RunLogger — non-blocking hot path (P0-15)', () => {
  it('does not write to disk on every event', async () => {
    const rl = new RunLogger('r1', dir, mockLogger());
    rl.attach(bus);

    const sizeAfterHeader = statSync(rl.logFilePath).size;

    for (let i = 0; i < 50; i += 1) {
      await bus.emit('s1', {
        kind: 'harness.token',
        data: { workflowRunId: 'r1', token: `t${i}` },
      });
    }

    // Still only the header: 50 events produced zero additional syscalls,
    // which is the whole point. The old implementation would have written 50
    // times, synchronously, on the event loop.
    expect(statSync(rl.logFilePath).size).toBe(sizeAfterHeader);

    rl.close();
    const kinds = readLines(rl.logFilePath).filter((l) => l.kind === 'harness.token');
    expect(kinds).toHaveLength(50); // and nothing was lost by buffering
  });

  it('flushes asynchronously once the window elapses', async () => {
    const rl = new RunLogger('r1', dir, mockLogger());
    rl.attach(bus);
    const before = statSync(rl.logFilePath).size;

    await bus.emit('s1', { kind: 'harness.token', data: { workflowRunId: 'r1', token: 'x' } });
    await new Promise((r) => setTimeout(r, 120));

    expect(statSync(rl.logFilePath).size).toBeGreaterThan(before);
    rl.close();
  });

  it('close() is synchronous and leaves a complete file', async () => {
    const rl = new RunLogger('r1', dir, mockLogger());
    rl.attach(bus);
    await bus.emit('s1', { kind: 'harness.token', data: { workflowRunId: 'r1', token: 'x' } });

    rl.close(); // no await

    // Readable immediately — WorkflowRunService closes from a synchronous path
    // and the file has to be whole the moment it returns.
    const lines = readLines(rl.logFilePath);
    expect(lines.some((l) => l.kind === 'harness.token')).toBe(true);
    expect(lines.at(-1)).toMatchObject({ kind: '__run_log.closed' });
  });
});

describe('RunLogger — bounded buffer (L2)', () => {
  it('drops the oldest lines and records that it did', async () => {
    const rl = new RunLogger('r1', dir, mockLogger());
    rl.attach(bus);

    // 4 MB ceiling; ~40 KB per event forces eviction well before any flush.
    const fat = 'x'.repeat(40_000);
    for (let i = 0; i < 200; i += 1) {
      await bus.emit('s1', {
        kind: 'harness.token',
        data: { workflowRunId: 'r1', token: fat, i },
      });
    }
    rl.close();

    const lines = readLines(rl.logFilePath);
    const marker = lines.find((l) => l.kind === '__run_log.dropped');
    expect(marker, 'overflow must be visible, not silent').toBeDefined();
    expect((marker?.data as { lines: number }).lines).toBeGreaterThan(0);

    // And the newest events survived — dropping the oldest is what makes a
    // truncated diagnostic log still useful.
    const tokens = lines.filter((l) => l.kind === 'harness.token');
    const last = tokens.at(-1)?.data as { i: number } | undefined;
    expect(last?.i).toBe(199);
  });
});

describe('RunLogger — shared dispatcher', () => {
  it('routes each event only to the matching run', async () => {
    const a = new RunLogger('runA', join(dir, 'a'), mockLogger());
    const b = new RunLogger('runB', join(dir, 'b'), mockLogger());
    a.attach(bus);
    b.attach(bus);

    await bus.emit('s1', { kind: 'harness.token', data: { workflowRunId: 'runA', token: '1' } });
    await bus.emit('s1', { kind: 'harness.token', data: { workflowRunId: 'runB', token: '2' } });
    await bus.emit('s1', { kind: 'harness.token', data: { workflowRunId: 'runC', token: '3' } });

    a.close();
    b.close();

    expect(readLines(a.logFilePath).filter((l) => l.kind === 'harness.token')).toHaveLength(1);
    expect(readLines(b.logFilePath).filter((l) => l.kind === 'harness.token')).toHaveLength(1);
  });

  it('an event with no workflowRunId reaches nobody', async () => {
    const rl = new RunLogger('r1', dir, mockLogger());
    rl.attach(bus);

    await bus.emit('s1', { kind: 'harness.token', data: { token: 'orphan' } });
    rl.close();

    expect(readLines(rl.logFilePath).filter((l) => l.kind === 'harness.token')).toHaveLength(0);
  });

  it('a closed logger stops receiving, and does not disturb its siblings', async () => {
    const a = new RunLogger('runA', join(dir, 'a'), mockLogger());
    const b = new RunLogger('runB', join(dir, 'b'), mockLogger());
    a.attach(bus);
    b.attach(bus);

    a.close();

    await bus.emit('s1', { kind: 'harness.token', data: { workflowRunId: 'runA', token: 'x' } });
    await bus.emit('s1', { kind: 'harness.token', data: { workflowRunId: 'runB', token: 'y' } });
    b.close();

    expect(readLines(a.logFilePath).filter((l) => l.kind === 'harness.token')).toHaveLength(0);
    expect(readLines(b.logFilePath).filter((l) => l.kind === 'harness.token')).toHaveLength(1);
  });

  it('auto-close from a terminal event does not corrupt the iteration', async () => {
    // `handleEvent` can close, which unregisters and mutates the set being
    // iterated. Two loggers on one run make that mutation observable.
    const a = new RunLogger('runA', join(dir, 'a'), mockLogger());
    const b = new RunLogger('runA', join(dir, 'b'), mockLogger());
    a.attach(bus);
    b.attach(bus);

    await bus.emitGlobal({ kind: 'workflow_run.completed', data: { workflowRunId: 'runA' } });

    for (const rl of [a, b]) {
      const lines = readLines(rl.logFilePath);
      expect(lines.some((l) => l.kind === 'workflow_run.completed')).toBe(true);
      expect(lines.some((l) => l.kind === '__run_log.closed')).toBe(true);
    }
  });

  it('survives a payload that cannot be serialised', async () => {
    const rl = new RunLogger('r1', dir, mockLogger());
    rl.attach(bus);

    const cyclic: Record<string, unknown> = { workflowRunId: 'r1' };
    cyclic['self'] = cyclic;
    await bus.emit('s1', { kind: 'harness.token', data: cyclic as never });
    rl.close();

    // A cycle in one payload must not take the run down or truncate the log.
    const lines = readLines(rl.logFilePath);
    expect(lines.some((l) => l.data === '<unserialisable>')).toBe(true);
    expect(lines.at(-1)).toMatchObject({ kind: '__run_log.closed' });
  });
});
