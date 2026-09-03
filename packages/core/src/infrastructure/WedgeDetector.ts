// ────────────────────────────────────────────────────────────────
// WedgeDetector — W21 event-loop wedge detection.
//
// Architecture law L6: the detector must NOT be downstream of the
// failure it is detecting. Running inside the main event loop means
// a fully wedged loop can never fire the alarm — the detector itself
// is blocked. This implementation uses a `worker_thread` as the
// monitor: the main thread sends periodic ticks into the worker; if
// the worker doesn't receive a tick within `alertThresholdMs` it
// concludes the main loop is wedged and invokes `onWedge`.
//
// Lifecycle
//   wedgeDetector.start()   — replay any prior report, spawn the worker
//                             thread, begin ticking
//   wedgeDetector.stop()    — terminate the worker, cancel any alert
//   wedgeDetector.tick()    — expose for testing; normally called internally
//
// On trip the detector writes a diagnostic report to disk and replays
// it on the NEXT boot — a wedge that ends in SIGKILL leaves nothing in
// the logs of the process that died, so the evidence has to outlive it.
//
// The worker code is inlined as a string and loaded via Node's
// `worker_threads` `eval` mode so no extra build artefact is needed.
// ────────────────────────────────────────────────────────────────

import { Worker } from 'node:worker_threads';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Minimal logger shape — avoids coupling this file to a logger implementation. */
export interface WedgeLogger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

/**
 * What gets written on trip and replayed on the next boot. Deliberately small
 * and JSON-only: it is written from a process that may be seconds from death,
 * so anything that could itself block or fail is left out.
 */
export interface WedgeDiagnosticReport {
  /** ISO time the wedge was detected. */
  at: string;
  /** Approximate ms since the main loop last ticked. */
  overdueMsApprox: number;
  /** Configured alert threshold, so a replayed report is self-describing. */
  alertThresholdMs: number;
  pid: number;
  /** Process uptime in seconds when the wedge tripped. */
  uptimeSec: number;
  /** RSS/heap at trip time — the usual suspect is a runaway allocation. */
  memory: { rss: number; heapUsed: number; heapTotal: number };
  /**
   * Snapshot of the loop-turn prober at trip time, when a prober is attached.
   * "The HTTP probe was already failing for 12 s" is the difference between a
   * wedged loop and a merely slow one.
   */
  probe?: { consecutiveFailures: number; lastLatencyMs?: number; lastError?: string };
}

/** Default file name inside `diagnosticsDir`. */
const REPORT_FILENAME = 'wedge-report.json';

/** How many times a crashed monitor worker is respawned before giving up. */
const MAX_WORKER_RESTARTS = 5;
const WORKER_RESTART_DELAY_MS = 1_000;

export interface WedgeDetectorConfig {
  /**
   * How often the main thread pings the worker (ms). Must be well under
   * `alertThresholdMs`. Default: 1 000 ms.
   */
  tickIntervalMs?: number;
  /**
   * If the worker has not received a tick for this long, it fires the
   * alarm. Should be several multiples of `tickIntervalMs` to tolerate
   * transient GC pauses. Default: 5 000 ms.
   */
  alertThresholdMs?: number;
  /**
   * Called from the worker's `message` handler on the main thread when
   * the worker detects a wedge. The argument is the approximate number
   * of milliseconds since the last received tick.
   *
   * IMPORTANT: this callback is invoked from the main thread's message
   * port handler, which IS the main event loop. If the loop is merely
   * slow (not fully wedged) the callback fires. If it is truly wedged,
   * the worker will still detect the gap — but the callback will not run
   * until the main loop un-wedges. For truly fatal cases, operators
   * should configure the worker to send a signal to the process:
   * pass `killOnWedge: true` to have the worker send SIGTERM itself.
   */
  onWedge: (overdueMsApprox: number) => void;
  /**
   * When `true`, the worker sends `process.kill(pid, 'SIGTERM')` on a
   * wedge so the process manager (systemd, Docker) can restart it.
   * Default: false.
   */
  killOnWedge?: boolean;
  /**
   * Directory for the on-trip diagnostic report. When unset no report is
   * written and nothing is replayed — the detector still alerts, it just
   * leaves no evidence behind for the next boot.
   */
  diagnosticsDir?: string;
  /**
   * Invoked on `start()` with a report left by a PREVIOUS process that
   * wedged. Defaults to logging it; the report file is deleted afterwards so
   * it is replayed exactly once.
   */
  onPriorWedge?: (report: WedgeDiagnosticReport) => void;
  /**
   * Attached prober whose state is captured into the diagnostic report. See
   * `LoopTurnProber`.
   */
  probe?: { snapshot: () => { consecutiveFailures: number; lastLatencyMs?: number; lastError?: string } };
  logger?: WedgeLogger;
}

// ── Worker source (eval mode) ────────────────────────────────────
// The worker runs outside the main event loop. It keeps the last-tick
// timestamp and alerts when the gap exceeds `alertThresholdMs`.
const WORKER_SOURCE = /* javascript */ `
const { workerData, parentPort } = require('node:worker_threads');

const { alertThresholdMs, killOnWedge, mainPid } = workerData;

let lastTick = Date.now();
let alerted = false;

// Receive ticks from the main thread
parentPort.on('message', (msg) => {
  if (msg && msg.type === 'tick') {
    lastTick = Date.now();
    alerted = false; // reset if we get a tick after wedge clears
  }
});

// Monitor loop — runs entirely in the worker thread, outside the main loop
setInterval(() => {
  const now = Date.now();
  const gap = now - lastTick;
  if (gap > alertThresholdMs && !alerted) {
    alerted = true;
    parentPort.postMessage({ type: 'wedge', overdueMsApprox: gap });
    if (killOnWedge) {
      try {
        // Best-effort signal the main process; the OS delivers SIGTERM
        // even if the main event loop is stuck.
        process.kill(mainPid, 'SIGTERM');
      } catch (_) {
        // Ignore — the process may have already exited.
      }
    }
  }
}, Math.min(500, Math.floor(alertThresholdMs / 4)));
`;

export class WedgeDetector {
  private readonly tickIntervalMs: number;
  private readonly alertThresholdMs: number;
  private readonly onWedge: (overdueMsApprox: number) => void;
  private readonly killOnWedge: boolean;
  private readonly reportPath: string | undefined;
  private readonly onPriorWedge: ((report: WedgeDiagnosticReport) => void) | undefined;
  private readonly probe: WedgeDetectorConfig['probe'];
  private readonly logger: WedgeLogger;

  private worker: Worker | undefined;
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  /** Set by stop(); distinguishes an intentional exit from a crash. */
  private stopping = false;
  private workerRestarts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(cfg: WedgeDetectorConfig) {
    this.tickIntervalMs = cfg.tickIntervalMs ?? 1_000;
    this.alertThresholdMs = cfg.alertThresholdMs ?? 5_000;
    this.onWedge = cfg.onWedge;
    this.killOnWedge = cfg.killOnWedge ?? false;
    this.reportPath = cfg.diagnosticsDir ? path.join(cfg.diagnosticsDir, REPORT_FILENAME) : undefined;
    this.onPriorWedge = cfg.onPriorWedge;
    this.probe = cfg.probe;
    this.logger = cfg.logger ?? {};
  }

  /**
   * Replay any report left by a previous process, spawn the monitor worker and
   * begin ticking. Idempotent — calling start() while already running is a
   * no-op.
   */
  start(): void {
    if (this.worker) return;
    this.stopping = false;
    this.replayPriorReport();
    this.spawnWorker();
  }

  /**
   * Stop sending ticks and terminate the worker. Safe to call multiple times.
   */
  stop(): void {
    this.stopping = true;
    this._stopTicker();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    if (this.worker) {
      void this.worker.terminate();
      this.worker = undefined;
    }
  }

  /**
   * Send a tick to the worker. Called automatically by the internal timer;
   * exposed for testing.
   */
  tick(): void {
    this.worker?.postMessage({ type: 'tick' });
  }

  /** True while a monitor worker is alive. Exposed for health and tests. */
  isMonitoring(): boolean {
    return this.worker !== undefined;
  }

  // ── Internals ──────────────────────────────────────────────────

  private spawnWorker(): void {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        alertThresholdMs: this.alertThresholdMs,
        killOnWedge: this.killOnWedge,
        mainPid: process.pid,
      },
    });
    this.worker = worker;

    worker.on('message', (msg: { type: string; overdueMsApprox?: number }) => {
      if (msg?.type === 'wedge') {
        const overdue = msg.overdueMsApprox ?? this.alertThresholdMs;
        // Write the report BEFORE the callback: `onWedge` typically requests a
        // shutdown, and `killOnWedge` may already have sent SIGTERM, so this
        // is the last moment the evidence can be captured.
        this.writeReport(overdue);
        this.onWedge(overdue);
      }
    });

    worker.on('error', (err: Error) => {
      // △ A crashed worker used to be swallowed: `on('error')` only stopped the
      // ticker and `on('exit')` nulled the worker with no log and no restart,
      // so the detector disabled itself permanently and SILENTLY. The one
      // component whose job is to notice that things stopped working is the
      // worst possible place for a silent failure.
      this.logger.error?.(`[WedgeDetector] Monitor worker error: ${String(err)}`);
    });

    worker.on('exit', (code: number) => {
      this._stopTicker();
      if (this.worker === worker) this.worker = undefined;
      if (this.stopping) return;
      this.scheduleWorkerRestart(code);
    });

    // Start ticking
    this.tick(); // immediate first tick
    this.tickTimer = setInterval(() => this.tick(), this.tickIntervalMs);
    if (typeof this.tickTimer.unref === 'function') this.tickTimer.unref();
  }

  private scheduleWorkerRestart(exitCode: number): void {
    if (this.workerRestarts >= MAX_WORKER_RESTARTS) {
      this.logger.error?.(
        `[WedgeDetector] Monitor worker exited (code=${exitCode}) and has already been restarted ` +
          `${this.workerRestarts} times — giving up. Event-loop wedge detection is now OFF.`,
      );
      return;
    }
    this.workerRestarts++;
    this.logger.warn?.(
      `[WedgeDetector] Monitor worker exited (code=${exitCode}) — restarting ` +
        `(attempt ${this.workerRestarts}/${MAX_WORKER_RESTARTS})`,
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.stopping || this.worker) return;
      try {
        this.spawnWorker();
      } catch (err: unknown) {
        this.logger.error?.(`[WedgeDetector] Monitor worker respawn failed: ${String(err)}`);
      }
    }, WORKER_RESTART_DELAY_MS);
    if (typeof this.restartTimer.unref === 'function') this.restartTimer.unref();
  }

  /**
   * Write the on-trip diagnostic. Synchronous on purpose: the process may be
   * about to be SIGTERM'd or SIGKILL'd, and an async write would never flush.
   * Every failure is swallowed — a detector must never be the thing that
   * crashes the process it is watching.
   */
  private writeReport(overdueMsApprox: number): void {
    if (!this.reportPath) return;
    try {
      const mem = process.memoryUsage();
      const report: WedgeDiagnosticReport = {
        at: new Date().toISOString(),
        overdueMsApprox,
        alertThresholdMs: this.alertThresholdMs,
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
        ...(this.probe ? { probe: this.probe.snapshot() } : {}),
      };
      mkdirSync(path.dirname(this.reportPath), { recursive: true });
      writeFileSync(this.reportPath, JSON.stringify(report, null, 2), 'utf8');
    } catch (err: unknown) {
      this.logger.warn?.(`[WedgeDetector] Failed to write diagnostic report: ${String(err)}`);
    }
  }

  /**
   * Replay a report written by a previous process, then delete it so it is
   * replayed exactly once.
   */
  private replayPriorReport(): void {
    if (!this.reportPath) return;
    let report: WedgeDiagnosticReport;
    try {
      report = JSON.parse(readFileSync(this.reportPath, 'utf8')) as WedgeDiagnosticReport;
    } catch {
      // Missing (the normal case) or unparseable — nothing to replay.
      return;
    }
    try {
      if (this.onPriorWedge) {
        this.onPriorWedge(report);
      } else {
        this.logger.error?.(
          `[WedgeDetector] PREVIOUS RUN WEDGED at ${report.at}: the event loop had not ticked for ` +
            `~${report.overdueMsApprox}ms (threshold ${report.alertThresholdMs}ms), pid=${report.pid}, ` +
            `uptime=${report.uptimeSec}s, rss=${report.memory?.rss}`,
        );
      }
    } finally {
      try {
        rmSync(this.reportPath, { force: true });
      } catch {
        // Best effort. A report we cannot delete replays again next boot,
        // which is noisy but not harmful.
      }
    }
  }

  private _stopTicker(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
  }
}

// ────────────────────────────────────────────────────────────────
// LoopTurnProber — W21 liveness probing against a LOOP-TURNING endpoint.
//
// Probing the socket only proves the kernel accepted a connection; the
// listener can be accepting while the event loop is frozen and no handler
// ever runs. `/api/health/loop-turn` is answered from the loop itself, so a
// slow or absent response is direct evidence that the loop is not turning.
//
// Two properties the spec calls out by name:
//   in-flight guard  — never more than one probe outstanding, so a stalled
//                      loop cannot accumulate a probe per interval and turn
//                      the detector into the load
//   once per episode — the callback fires on the transition into a bad state,
//                      not once per interval for as long as it lasts
// ────────────────────────────────────────────────────────────────

export interface LoopTurnProberConfig {
  /** Full URL of the loop-turn endpoint. */
  url: string;
  /** How often to probe. Default: 10 000 ms. */
  intervalMs?: number;
  /** Per-probe timeout. Default: 5 000 ms. */
  timeoutMs?: number;
  /**
   * Consecutive failures (timeout, transport error, non-200) before the
   * endpoint is declared unresponsive. Default: 3 — a single failure is a
   * blip, and the spec is explicit that one failing sub-request must not be
   * treated as a system failure.
   */
  failureThreshold?: number;
  /** Fired ONCE when the threshold is crossed. */
  onUnresponsive: (info: { consecutiveFailures: number; lastError?: string }) => void;
  /** Fired ONCE when a probe succeeds after an unresponsive episode. */
  onRecovered?: (info: { downForMs: number }) => void;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;
  logger?: WedgeLogger;
}

export class LoopTurnProber {
  private readonly url: string;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly failureThreshold: number;
  private readonly onUnresponsive: (info: { consecutiveFailures: number; lastError?: string }) => void;
  private readonly onRecovered: ((info: { downForMs: number }) => void) | undefined;
  private readonly fetchImpl: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;
  private readonly logger: WedgeLogger;

  private timer: ReturnType<typeof setInterval> | undefined;
  /** In-flight guard: exactly one probe may be outstanding at a time. */
  private inFlight = false;
  private consecutiveFailures = 0;
  /** Once-per-episode latch: true between crossing the threshold and recovery. */
  private episodeOpen = false;
  private episodeStartedAt = 0;
  private lastLatencyMs: number | undefined;
  private lastError: string | undefined;

  constructor(cfg: LoopTurnProberConfig) {
    this.url = cfg.url;
    this.intervalMs = cfg.intervalMs ?? 10_000;
    this.timeoutMs = cfg.timeoutMs ?? 5_000;
    this.failureThreshold = cfg.failureThreshold ?? 3;
    this.onUnresponsive = cfg.onUnresponsive;
    this.onRecovered = cfg.onRecovered;
    this.fetchImpl = cfg.fetchImpl ?? ((url, init) => fetch(url, init));
    this.logger = cfg.logger ?? {};
  }

  /** Begin probing. Idempotent. The timer is unref'd — an idle system pays nothing. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.probeOnce();
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Current state, folded into the wedge diagnostic report. */
  snapshot(): { consecutiveFailures: number; lastLatencyMs?: number; lastError?: string } {
    return {
      consecutiveFailures: this.consecutiveFailures,
      ...(this.lastLatencyMs !== undefined ? { lastLatencyMs: this.lastLatencyMs } : {}),
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
    };
  }

  /** Run one probe. Exposed for tests; returns whether it succeeded. */
  async probeOnce(): Promise<boolean> {
    // In-flight guard. A wedged loop never answers, so without this every
    // interval would stack another pending request on the process we already
    // believe is in trouble.
    if (this.inFlight) return false;
    this.inFlight = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timeout.unref === 'function') timeout.unref();
    const startedAt = Date.now();

    try {
      const res = await this.fetchImpl(this.url, { signal: controller.signal });
      if (!res.ok) throw new Error(`loop-turn probe returned HTTP ${res.status}`);
      this.lastLatencyMs = Date.now() - startedAt;
      this.lastError = undefined;
      this.recordSuccess();
      return true;
    } catch (err: unknown) {
      this.lastError = String(err);
      this.lastLatencyMs = Date.now() - startedAt;
      this.recordFailure();
      return false;
    } finally {
      clearTimeout(timeout);
      this.inFlight = false;
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.episodeOpen || this.consecutiveFailures < this.failureThreshold) return;
    // Threshold crossed for the first time in this episode — fire once.
    this.episodeOpen = true;
    this.episodeStartedAt = Date.now();
    this.logger.error?.(
      `[LoopTurnProber] ${this.url} unresponsive after ${this.consecutiveFailures} consecutive ` +
        `failures (last: ${this.lastError})`,
    );
    try {
      this.onUnresponsive({
        consecutiveFailures: this.consecutiveFailures,
        ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
      });
    } catch (err: unknown) {
      this.logger.warn?.(`[LoopTurnProber] onUnresponsive handler threw: ${String(err)}`);
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (!this.episodeOpen) return;
    const downForMs = Date.now() - this.episodeStartedAt;
    this.episodeOpen = false;
    this.logger.info?.(`[LoopTurnProber] ${this.url} recovered after ${downForMs}ms`);
    try {
      this.onRecovered?.({ downForMs });
    } catch (err: unknown) {
      this.logger.warn?.(`[LoopTurnProber] onRecovered handler threw: ${String(err)}`);
    }
  }
}
