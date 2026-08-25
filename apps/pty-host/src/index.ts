/**
 * W14 — PTY Host entry point.
 *
 * Started by a gateway-side PtyHostSupervisor as a child process via
 * child_process.fork(). Owns all node-pty handles; the gateway never holds
 * PTY file descriptors directly (L5).
 *
 * Parent-PID heartbeat: every 5 s we send signal 0 to the parent. If the
 * parent is gone, we exit. This prevents orphaned host processes.
 */

import { PtyHostServer } from './PtyHostServer.js';

const server = new PtyHostServer();

const PARENT_PID = process.env['GENERATORAI_PARENT_PID']
  ? parseInt(process.env['GENERATORAI_PARENT_PID'], 10)
  : undefined;

// ── Parent-PID heartbeat ─────────────────────────────────────────────────────
if (PARENT_PID !== undefined && !Number.isNaN(PARENT_PID)) {
  const heartbeat = setInterval(() => {
    try {
      process.kill(PARENT_PID, 0);
    } catch {
      console.log('[pty-host] Parent process gone — exiting');
      clearInterval(heartbeat);
      void server.shutdown().finally(() => process.exit(0));
    }
  }, 5_000);
  heartbeat.unref();
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[pty-host] SIGTERM received — shutting down');
  void server.shutdown().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[pty-host] SIGINT received — shutting down');
  void server.shutdown().finally(() => process.exit(0));
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.start();
