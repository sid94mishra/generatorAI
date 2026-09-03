/**
 * W21 — WedgeDetector and LoopTurnProber.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WedgeDetector, LoopTurnProber, type WedgeDiagnosticReport } from '../WedgeDetector.js';

const REPORT = 'wedge-report.json';
const detectors: WedgeDetector[] = [];
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'wedge-'));
  dirs.push(dir);
  return dir;
}

function track(d: WedgeDetector): WedgeDetector {
  detectors.push(d);
  return d;
}

afterEach(() => {
  for (const d of detectors.splice(0)) d.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function recorder() {
  const lines: string[] = [];
  const push = (level: string) => (m: string) => { lines.push(`${level}: ${m}`); };
  return { lines, info: push('info'), warn: push('warn'), error: push('error') };
}

describe('WedgeDetector', () => {
  it('trips on a wedge and writes a diagnostic report', async () => {
    const dir = tempDir();
    const onWedge = vi.fn();
    const detector = track(new WedgeDetector({
      alertThresholdMs: 120,
      // Never tick, so the worker sees a gap immediately.
      tickIntervalMs: 60_000,
      diagnosticsDir: dir,
      onWedge,
    }));
    detector.start();

    await vi.waitFor(() => expect(onWedge).toHaveBeenCalled(), { timeout: 5_000 });
    await vi.waitFor(() => expect(existsSync(path.join(dir, REPORT))).toBe(true), { timeout: 5_000 });

    const report = JSON.parse(readFileSync(path.join(dir, REPORT), 'utf8')) as WedgeDiagnosticReport;
    expect(report.pid).toBe(process.pid);
    expect(report.alertThresholdMs).toBe(120);
    expect(report.overdueMsApprox).toBeGreaterThan(0);
    expect(report.memory.rss).toBeGreaterThan(0);
  }, 15_000);

  it('replays a prior report on the next boot and consumes it exactly once', () => {
    const dir = tempDir();
    const prior: WedgeDiagnosticReport = {
      at: '2026-08-01T00:00:00.000Z',
      overdueMsApprox: 9_000,
      alertThresholdMs: 5_000,
      pid: 1234,
      uptimeSec: 42,
      memory: { rss: 1, heapUsed: 1, heapTotal: 1 },
    };
    writeFileSync(path.join(dir, REPORT), JSON.stringify(prior), 'utf8');

    const onPriorWedge = vi.fn();
    const first = track(new WedgeDetector({ alertThresholdMs: 60_000, diagnosticsDir: dir, onWedge: () => {}, onPriorWedge }));
    first.start();

    expect(onPriorWedge).toHaveBeenCalledTimes(1);
    expect(onPriorWedge.mock.calls[0]![0]).toMatchObject({ pid: 1234, overdueMsApprox: 9_000 });
    // Consumed — a report must not be replayed on every boot forever.
    expect(existsSync(path.join(dir, REPORT))).toBe(false);
    first.stop();

    const second = track(new WedgeDetector({ alertThresholdMs: 60_000, diagnosticsDir: dir, onWedge: () => {}, onPriorWedge }));
    second.start();
    expect(onPriorWedge).toHaveBeenCalledTimes(1);
  });

  it('tolerates a missing or corrupt prior report', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, REPORT), 'not json at all', 'utf8');
    const onPriorWedge = vi.fn();
    const d = track(new WedgeDetector({ alertThresholdMs: 60_000, diagnosticsDir: dir, onWedge: () => {}, onPriorWedge }));
    expect(() => d.start()).not.toThrow();
    expect(onPriorWedge).not.toHaveBeenCalled();
  });

  it('restarts its monitor worker when it dies instead of disabling itself silently', async () => {
    // Regression: on('exit') nulled the worker with no log and no restart, so
    // the one component whose job is to notice failures failed silently and
    // permanently.
    const logger = recorder();
    const detector = track(new WedgeDetector({ alertThresholdMs: 60_000, tickIntervalMs: 60_000, onWedge: () => {}, logger }));
    detector.start();
    expect(detector.isMonitoring()).toBe(true);

    // Kill the worker out from under the detector.
    const worker = (detector as unknown as { worker: { terminate(): Promise<number> } }).worker;
    await worker.terminate();

    await vi.waitFor(() => expect(detector.isMonitoring()).toBe(true), { timeout: 5_000 });
    expect(logger.lines.some((l) => l.includes('restarting'))).toBe(true);
  }, 15_000);

  it('stop() does not trigger a restart', async () => {
    const logger = recorder();
    const detector = new WedgeDetector({ alertThresholdMs: 60_000, tickIntervalMs: 60_000, onWedge: () => {}, logger });
    detector.start();
    detector.stop();
    await new Promise((r) => setTimeout(r, 300));
    expect(detector.isMonitoring()).toBe(false);
    expect(logger.lines.some((l) => l.includes('restarting'))).toBe(false);
  }, 15_000);
});

describe('LoopTurnProber (W21)', () => {
  it('fires onUnresponsive ONCE per episode, not once per failed probe', async () => {
    const onUnresponsive = vi.fn();
    const onRecovered = vi.fn();
    let fail = true;
    const prober = new LoopTurnProber({
      url: 'http://example.invalid/api/health/loop-turn',
      failureThreshold: 2,
      onUnresponsive,
      onRecovered,
      fetchImpl: async () => {
        if (fail) throw new Error('timeout');
        return { ok: true, status: 200 };
      },
    });

    await prober.probeOnce();
    expect(onUnresponsive).not.toHaveBeenCalled();
    await prober.probeOnce();
    expect(onUnresponsive).toHaveBeenCalledTimes(1);
    await prober.probeOnce();
    await prober.probeOnce();
    expect(onUnresponsive).toHaveBeenCalledTimes(1);

    fail = false;
    await prober.probeOnce();
    expect(onRecovered).toHaveBeenCalledTimes(1);

    // A NEW episode fires again.
    fail = true;
    await prober.probeOnce();
    await prober.probeOnce();
    expect(onUnresponsive).toHaveBeenCalledTimes(2);
  });

  it('treats a non-200 as a failure', async () => {
    const onUnresponsive = vi.fn();
    const prober = new LoopTurnProber({
      url: 'http://example.invalid/x',
      failureThreshold: 1,
      onUnresponsive,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    });
    await prober.probeOnce();
    expect(onUnresponsive).toHaveBeenCalledTimes(1);
    expect(prober.snapshot().lastError).toContain('503');
  });

  it('never has more than one probe in flight', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const prober = new LoopTurnProber({
      url: 'http://example.invalid/x',
      onUnresponsive: () => {},
      fetchImpl: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await gate;
        concurrent--;
        return { ok: true, status: 200 };
      },
    });

    const first = prober.probeOnce();
    // A wedged loop never answers; without the guard every interval would
    // stack another request on the process we already think is in trouble.
    const second = await prober.probeOnce();
    expect(second).toBe(false);
    expect(maxConcurrent).toBe(1);

    release();
    await expect(first).resolves.toBe(true);
  });

  it('is a no-op cost when idle — start/stop leaves no live timer', () => {
    const prober = new LoopTurnProber({ url: 'http://x/y', onUnresponsive: () => {}, fetchImpl: async () => ({ ok: true, status: 200 }) });
    prober.start();
    prober.start(); // idempotent
    prober.stop();
    expect((prober as unknown as { timer: unknown }).timer).toBeUndefined();
  });

  it('snapshot() feeds the wedge diagnostic', async () => {
    const prober = new LoopTurnProber({
      url: 'http://example.invalid/x',
      failureThreshold: 1,
      onUnresponsive: () => {},
      fetchImpl: async () => { throw new Error('econnrefused'); },
    });
    await prober.probeOnce();
    const snap = prober.snapshot();
    expect(snap.consecutiveFailures).toBe(1);
    expect(snap.lastError).toContain('econnrefused');
  });
});
