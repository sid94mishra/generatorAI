/**
 * W15 — Browser Host entry point.
 *
 * Started by a gateway-side BrowserHostSupervisor as a child process.
 * Owns the single Chromium instance with N browser contexts (L5).
 *
 * Parent-PID heartbeat: every 5 s we send signal 0 to the parent. If the
 * parent is gone, we exit. This prevents orphaned Chromium processes.
 */

import { BrowserHostServer } from './BrowserHostServer.js';

const server = new BrowserHostServer();

const PARENT_PID = process.env['GENERATORAI_PARENT_PID']
  ? parseInt(process.env['GENERATORAI_PARENT_PID'], 10)
  : undefined;

// ── Parent-PID heartbeat ─────────────────────────────────────────────────────
if (PARENT_PID !== undefined && !Number.isNaN(PARENT_PID)) {
  const heartbeat = setInterval(() => {
    try {
      process.kill(PARENT_PID, 0);
    } catch {
      console.log('[browser-host] Parent process gone — exiting');
      clearInterval(heartbeat);
      void server.shutdown().finally(() => process.exit(0));
    }
  }, 5_000);
  heartbeat.unref();
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[browser-host] SIGTERM received — shutting down');
  void server.shutdown().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[browser-host] SIGINT received — shutting down');
  void server.shutdown().finally(() => process.exit(0));
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.start();
