/**
 * W12 — Agent Host entry point.
 *
 * Started by HostSupervisor (in packages/core) as a child process via
 * child_process.fork(). Boots the provider harnesses, then starts the IPC
 * server loop.
 *
 * Parent-PID heartbeat: every 5 s we send signal 0 to the parent. If the
 * parent is gone, we exit. This prevents orphaned host processes.
 */

import { createLogger } from '@generatorai/shared';
import { createHarnessProvider } from '@generatorai/agent-harness-providers';
import { AgentHostServer } from './AgentHostServer.js';

const logger = createLogger({ level: process.env['LOG_LEVEL'] ?? 'info', service: 'agent-host' });

const primaryType = (process.env['GENERATORAI_PRIMARY_HARNESS'] as 'copilot' | 'claude-agent') ?? 'claude-agent';

/**
 * Builds a fully initialized harness. Used both for the boot runtime and, by
 * `RuntimeSupervisor`, to stand up the replacement during an age/RSS recycle —
 * without a factory the supervisor has nothing to swap TO and (correctly)
 * refuses to recycle at all.
 */
async function buildHarness() {
  const harness = await createHarnessProvider({ type: primaryType });
  await harness.initialize();
  return harness;
}

/**
 * Concurrency bounds. Turn permits are the gateway's: it admits every turn on
 * its `provider:<id>` flow key and sends it `admitted` (P07 WP-7.2, RV-26),
 * so the host's own turn semaphore only bounds a turn sent without the flag:
 * a backstop of 4 (`GENERATORAI_AGENT_HOST_TURN_LIMIT` overrides it; the
 * gateway does not set it, and Settings → Workflow engine does not reach it).
 * Cold starts stay a host bound.
 */
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const server = new AgentHostServer({
  logger,
  createHarness: buildHarness,
  maxConcurrentExecutions: intFromEnv('GENERATORAI_AGENT_HOST_TURN_LIMIT', 4),
  maxConcurrentColdStarts: intFromEnv('GENERATORAI_MAX_CONCURRENT_COLD_STARTS', 2),
});

const PARENT_PID = process.env['GENERATORAI_PARENT_PID']
  ? parseInt(process.env['GENERATORAI_PARENT_PID'], 10)
  : undefined;

// ── Parent-PID heartbeat (W12 / W20 — D-1 resolved for cooperating children) ─
if (PARENT_PID !== undefined && !Number.isNaN(PARENT_PID)) {
  const heartbeat = setInterval(() => {
    try {
      process.kill(PARENT_PID, 0);
    } catch {
      // Parent is gone — exit cleanly
      logger.info('[agent-host] Parent process gone — exiting');
      clearInterval(heartbeat);
      void server.shutdown().finally(() => process.exit(0));
    }
  }, 5_000);
  heartbeat.unref();
}

// ── Boot provider harnesses ──────────────────────────────────────────────────
async function boot(): Promise<void> {
  logger.info(`[agent-host] Booting with primary harness type: ${primaryType}`);

  try {
    server.registerHarness(await buildHarness());
    logger.info(`[agent-host] ${primaryType} harness initialized`);
  } catch (err: unknown) {
    logger.warn(`[agent-host] Failed to initialize ${primaryType} harness: ${String(err)} — host will retry on demand`);
    // Non-fatal: the host still starts; sessions will fail with a useful error
  }

  server.start();
}

// ── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  logger.info('[agent-host] SIGTERM received — shutting down');
  void server.shutdown().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('[agent-host] SIGINT received — shutting down');
  void server.shutdown().finally(() => process.exit(0));
});

// ── Start ────────────────────────────────────────────────────────────────────
boot().catch((err: unknown) => {
  logger.error(`[agent-host] Fatal boot error: ${String(err)}`);
  process.exit(1);
});
