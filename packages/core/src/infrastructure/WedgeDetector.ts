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
//   wedgeDetector.start()   — spawn the worker thread, begin ticking
//   wedgeDetector.stop()    — terminate the worker, cancel any alert
//   wedgeDetector.tick()    — expose for testing; normally called internally
//
// The worker code is inlined as a string and loaded via Node's
// `worker_threads` `eval` mode so no extra build artefact is needed.
// ────────────────────────────────────────────────────────────────

import { Worker } from 'node:worker_threads';

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

  private worker: Worker | undefined;
  private tickTimer: ReturnType<typeof setInterval> | undefined;

  constructor(cfg: WedgeDetectorConfig) {
    this.tickIntervalMs = cfg.tickIntervalMs ?? 1_000;
    this.alertThresholdMs = cfg.alertThresholdMs ?? 5_000;
    this.onWedge = cfg.onWedge;
    this.killOnWedge = cfg.killOnWedge ?? false;
  }

  /**
   * Spawn the monitor worker and begin sending ticks. Idempotent — calling
   * start() while already running is a no-op.
   */
  start(): void {
    if (this.worker) return;

    this.worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        alertThresholdMs: this.alertThresholdMs,
        killOnWedge: this.killOnWedge,
        mainPid: process.pid,
      },
    });

    this.worker.on('message', (msg: { type: string; overdueMsApprox?: number }) => {
      if (msg?.type === 'wedge') {
        this.onWedge(msg.overdueMsApprox ?? this.alertThresholdMs);
      }
    });

    this.worker.on('error', () => {
      // Worker crash — stop ticking and clean up. A crashed detector is
      // better than a crashing server: degrade silently.
      this._stopTicker();
    });

    this.worker.on('exit', () => {
      this._stopTicker();
      this.worker = undefined;
    });

    // Start ticking
    this.tick(); // immediate first tick
    this.tickTimer = setInterval(() => this.tick(), this.tickIntervalMs);
    if (typeof this.tickTimer.unref === 'function') this.tickTimer.unref();
  }

  /**
   * Stop sending ticks and terminate the worker. Safe to call multiple times.
   */
  stop(): void {
    this._stopTicker();
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

  private _stopTicker(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
  }
}
