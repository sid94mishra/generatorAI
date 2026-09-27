// ────────────────────────────────────────────────────────────────
// Boot housekeeping — what a process does once at startup that is not the
// workflow engine's recovery (the engine's `RunSupervisor.recover()` owns
// runs, instances and their sessions, G5 §3.10):
//   1. restore the EventBus sequence counters from the database;
//   2. finish closing sessions a crash left in `closing`;
//   3. reap sandbox containers a crash left behind.
// Chat sessions are never eagerly resumed here: a chat conversation must be
// resumed WITH its tool set, which only the chat service builds on the next
// prompt (a tool-less resume poisons the provider session).
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { IAgentHarness } from '../domain/ports/IAgentHarness.js';
import type { ISessionRepository } from '../domain/ports/IRepositories.js';
import type { EventBus } from '../events/EventBus.js';

/** Reaps orphaned sandbox containers (`SandboxLifecycleManager`). */
export interface ISandboxCleaner {
  cleanupOrphans(): Promise<{ destroyed: string[]; failed: string[] }>;
}

export interface BootHousekeepingDeps {
  eventBus: EventBus;
  sessionRepo: ISessionRepository;
  harness: IAgentHarness;
  /** The sandbox lifecycle, whose orphaned containers are reaped. */
  orphanReaper?: ISandboxCleaner | undefined;
  logger: ILogger;
}

export interface BootHousekeepingSummary {
  closingSessionsClosed: number;
  sandboxOrphansDestroyed: number;
  sandboxOrphansFailed: number;
  failures: string[];
  durationMs: number;
}

export async function runBootHousekeeping(deps: BootHousekeepingDeps): Promise<BootHousekeepingSummary> {
  const start = Date.now();
  const summary: BootHousekeepingSummary = { closingSessionsClosed: 0, sandboxOrphansDestroyed: 0, sandboxOrphansFailed: 0, failures: [], durationMs: 0 };

  await deps.eventBus.restoreCounters();

  for (const session of await deps.sessionRepo.getByStatus(['closing'])) {
    if (session.conversationId) await deps.harness.destroyConversation(session.conversationId).catch(() => undefined);
    await deps.sessionRepo.updateStatus(session.id, 'closed');
    summary.closingSessionsClosed += 1;
  }

  if (deps.orphanReaper) {
    try {
      const r = await deps.orphanReaper.cleanupOrphans();
      summary.sandboxOrphansDestroyed = r.destroyed.length;
      summary.sandboxOrphansFailed = r.failed.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.failures.push(`sandbox: ${msg}`);
      deps.logger.warn(`[BootHousekeeping] sandbox cleanup failed: ${msg}`);
    }
  }

  summary.durationMs = Date.now() - start;
  deps.logger.info('[BootHousekeeping] complete', { ...summary });
  return summary;
}
