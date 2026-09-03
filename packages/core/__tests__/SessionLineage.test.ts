// ────────────────────────────────────────────────────────────────
// X-13 — session lineage, so "why did it forget X?" is answerable.
//
// A stage's conversation can be replaced without a trace: a restart nulls
// `stage_runs.session_id` so the relaunch allocates a fresh one, and a
// per-stage release destroys the old conversation outright. The only thing
// left behind was `sessions.status = 'closed'` on a row nothing pointed at any
// more — no back-pointer, no reason, no time. There was no `parentSessionId`,
// no `ancestorSessionId` and no lineage symbol anywhere in the repo.
//
// The chain is appended to the durable artifact channel rather than a new
// column: `releaseJournal` keeps artifacts, so the lineage outlives the stage
// it explains.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDB, migrateDB, EntryRepository, RegisterRepository } from '@generatorai/db';
import { DurableExecutionEngine } from '../src/services/DurableExecutionEngine.js';
import { StartupRecoveryService } from '../src/services/StartupRecoveryService.js';
import {
  SESSION_LINEAGE_ARTIFACT,
  recordSessionLineage,
  type SessionLineageEvent,
} from '../src/services/StageExecutionService.js';
import { EventBus } from '../src/events/EventBus.js';
import { MockStageRunRepository } from './MockRepositories.js';
import type { ISessionRepository } from '../src/domain/ports/IRepositories.js';
import type { IWorkflowRunRepository } from '../src/domain/ports/IWorkflowRunRepository.js';
import type { IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type { ILogger, StageRun, WorkflowRun } from '@generatorai/shared';

function mockLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;
}

/** Parse the artifact back into the chain it encodes. */
function readLineage(repo: EntryRepository, stageRunId: string): SessionLineageEvent[] {
  const artifact = repo.getArtifact('stage_run', stageRunId, SESSION_LINEAGE_ARTIFACT);
  if (!artifact) return [];
  return artifact.text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as SessionLineageEvent);
}

describe('X-13 — session lineage', () => {
  let db: ReturnType<typeof createDB>;
  let entryRepo: EntryRepository;
  let engine: DurableExecutionEngine;

  beforeEach(() => {
    db = createDB(':memory:');
    migrateDB(db);
    entryRepo = new EntryRepository(db);
    engine = new DurableExecutionEngine(new RegisterRepository(db), entryRepo, mockLogger());
  });

  it('appends links in order and keeps them readable', () => {
    recordSessionLineage(engine, 'sr-1', {
      event: 'allocated', sessionId: 'ses-1', conversationId: 'conv-1', at: 1,
    });
    recordSessionLineage(engine, 'sr-1', {
      event: 'lost', sessionId: 'ses-1', reason: 'process restart', at: 2,
    });
    recordSessionLineage(engine, 'sr-1', {
      event: 'allocated', sessionId: 'ses-2', conversationId: 'conv-2',
      reason: 'replaces session ses-1', at: 3,
    });

    const chain = readLineage(entryRepo, 'sr-1');
    expect(chain.map((e) => e.event)).toEqual(['allocated', 'lost', 'allocated']);
    // This is the answer to "why did it forget what I told it earlier?".
    expect(chain[1]!.reason).toBe('process restart');
    expect(chain[2]!.reason).toBe('replaces session ses-1');
  });

  it('is a no-op without a durable engine — no crash, no record', () => {
    expect(() =>
      recordSessionLineage(undefined, 'sr-1', { event: 'allocated', at: 1 }),
    ).not.toThrow();
    expect(readLineage(entryRepo, 'sr-1')).toEqual([]);
  });

  it('survives the journal retention sweep that clears everything else', () => {
    recordSessionLineage(engine, 'sr-1', { event: 'allocated', sessionId: 'ses-1', at: 1 });
    entryRepo.create({
      scope: 'stage_run', scopeId: 'sr-1', kind: 'tool_result', key: 'op', payload: '"x"',
    });

    engine.releaseJournal({ scope: 'stage_run', scopeId: 'sr-1' });

    // The lineage explains a stage AFTER it finishes; retention that took it
    // with the journal would answer the question by deleting it.
    expect(readLineage(entryRepo, 'sr-1')).toHaveLength(1);
    expect(entryRepo.listByScope('stage_run', 'sr-1').map((e) => e.kind)).toEqual(['artifact']);
  });

  // ── The real writer: crash recovery ────────────────────────────

  it('StartupRecoveryService records which session an interrupted stage lost', async () => {
    const stageRunRepo = new MockStageRunRepository();
    const interrupted: StageRun = {
      id: 'sr-1',
      workflowRunId: 'run-1',
      stageDefinitionId: 'sd-1',
      name: 'Stage One',
      status: 'running',
      sessionId: 'ses-dead',
      currentStep: 0,
      totalSteps: 1,
      retryCount: 0,
      createdAt: new Date(),
    };
    await stageRunRepo.create(interrupted);

    const workflowRunRepo = {
      getByStatus: async (statuses: string[]) =>
        statuses.includes('running')
          ? [{ id: 'run-1', status: 'running' } as unknown as WorkflowRun]
          : [],
      updateStatus: async () => {},
      update: async () => ({}) as WorkflowRun,
    } as unknown as IWorkflowRunRepository;

    const sessionRepo = {
      getByStatus: async () => [],
      updateStatus: async () => {},
    } as unknown as ISessionRepository;

    const eventBus = new EventBus();
    const recovery = new StartupRecoveryService(
      sessionRepo,
      { resumeConversation: async () => {}, destroyConversation: async () => {} } as unknown as IAgentHarness,
      eventBus,
      mockLogger(),
      workflowRunRepo,
      stageRunRepo,
      undefined,
      undefined,
      // No re-drive wired — recovery parks the run, which is the branch that
      // still drops the session handle.
      undefined,
    );
    recovery.setDurableEngine(engine);

    await recovery.recover();

    const chain = readLineage(entryRepo, 'sr-1');
    expect(chain).toHaveLength(1);
    expect(chain[0]!.event).toBe('lost');
    expect(chain[0]!.sessionId).toBe('ses-dead');
    expect(chain[0]!.reason).toContain('process restart');
    // …and the handle really is gone, which is why the record had to be
    // written before the update rather than after it.
    expect((await stageRunRepo.getById('sr-1')).sessionId).toBeFalsy();
  });
});
