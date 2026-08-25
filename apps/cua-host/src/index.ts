/**
 * W17 — CUA Host entry point.
 *
 * Started by a gateway-side CuaHostSupervisor as a child process.
 * Owns the computer-use driver; the gateway reads the descriptor file and
 * passes spawn params — it never calls the driver directly (L5).
 *
 * Parent-PID heartbeat: every 5 s we send signal 0 to the parent. If the
 * parent is gone, we exit and clean up the descriptor file.
 */

import { CuaHostServer } from './CuaHostServer.js';

const server = new CuaHostServer();

const PARENT_PID = process.env['GENERATORAI_PARENT_PID']
  ? parseInt(process.env['GENERATORAI_PARENT_PID'], 10)
  : undefined;

// ── Parent-PID heartbeat ─────────────────────────────────────────────────────
if (PARENT_PID !== undefined && !Number.isNaN(PARENT_PID)) {
  const heartbeat = setInterval(() => {
    try {
      process.kill(PARENT_PID, 0);
    } catch {
      console.log('[cua-host] Parent process gone — exiting');
      clearInterval(heartbeat);
      void server.shutdown().finally(() => process.exit(0));
    }
  }, 5_000);
  heartbeat.unref();
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[cua-host] SIGTERM received — shutting down');
  void server.shutdown().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[cua-host] SIGINT received — shutting down');
  void server.shutdown().finally(() => process.exit(0));
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.start();
