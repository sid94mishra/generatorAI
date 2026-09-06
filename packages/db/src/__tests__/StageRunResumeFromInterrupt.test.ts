// ────────────────────────────────────────────────────────────────
// DrizzleStageRunRepository.resumeFromInterrupt — P0-a.
//
// The method always wrote `awaiting_input → running`. That is only correct
// while the `interrupt()` frame is alive to be resumed by the resolved
// promise; after a restart it is a permanent wedge, because nothing in the
// system relaunches a `running` stage — `DAGScheduler.getReadyStages` looks
// at `pending` only. It now takes the destination status, and both
// transitions stay one conditional write so two approvers still cannot both
// win.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';

import { createDB, type AppDatabase } from '../index.js';
import { migrateDB } from '../migrations/index.js';
import { DrizzleStageRunRepository } from '../repositories/StageRunRepository.js';

let dir: string;
let db: AppDatabase;
let repo: DrizzleStageRunRepository;

function rawClient(database: AppDatabase): Database.Database {
  return (database as unknown as { session: { client: Database.Database } }).session.client;
}

/** Minimal definition/run rows so the stage_runs foreign keys are satisfiable. */
function seedParents(): void {
  const now = Date.now();
  const client = rawClient(db);
  client
    .prepare(`INSERT INTO workflow_definitions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run('def-1', 'def', now, now);
  client
    .prepare(`INSERT INTO stage_definitions (id, workflow_definition_id, name, created_at) VALUES (?, ?, ?, ?)`)
    .run('sd-1', 'def-1', 'stage', now);
  client
    .prepare(
      `INSERT INTO workflow_runs (id, workflow_definition_id, name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('wr-1', 'def-1', 'run', 'running', now, now);
}

async function createParkedStage(id: string): Promise<void> {
  await repo.create({
    id,
    workflowRunId: 'wr-1',
    stageDefinitionId: 'sd-1',
    name: 'stage',
    status: 'running',
    currentStep: 0,
    totalSteps: 1,
    retryCount: 0,
    version: 0,
    createdAt: new Date(),
  });
  await repo.interrupt(id, { kind: 'stage_completion_review' });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-stage-resume-'));
  db = createDB(join(dir, 'd.db'));
  migrateDB(db);
  repo = new DrizzleStageRunRepository(db);
  seedParents();
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

describe('resumeFromInterrupt — destination status (P0-a)', () => {
  it('defaults to `running` for the in-process resume', async () => {
    await createParkedStage('s1');

    expect(await repo.resumeFromInterrupt('s1')).toBe(true);

    const row = await repo.getById('s1');
    expect(row.status).toBe('running');
    expect(row.interruptData).toBeUndefined();
    // Two mutations since the row was created at version 0: `interrupt` parked
    // it, `resumeFromInterrupt` released it. Every status write bumps the
    // version now, which is what makes the optimistic-lock checks meaningful.
    expect(row.version).toBe(2);
  });

  it('parks the stage in `pending` when asked, so the DAG scheduler can relaunch it', async () => {
    await createParkedStage('s2');

    expect(await repo.resumeFromInterrupt('s2', 'pending')).toBe(true);

    const row = await repo.getById('s2');
    expect(row.status).toBe('pending');
    // The launch claim only fires from `pending` — this is what makes the
    // stage reachable again rather than a permanent zombie.
    expect(await repo.claimForExecution('s2')).toBe(true);
  });

  it('is still a single conditional write — the second approver loses either way', async () => {
    await createParkedStage('s3');

    expect(await repo.resumeFromInterrupt('s3', 'pending')).toBe(true);
    expect(await repo.resumeFromInterrupt('s3', 'pending')).toBe(false);
    expect(await repo.resumeFromInterrupt('s3')).toBe(false);
    expect((await repo.getById('s3')).status).toBe('pending');
  });

  it('refuses a stage that is not awaiting_input', async () => {
    await repo.create({
      id: 's4',
      workflowRunId: 'wr-1',
      stageDefinitionId: 'sd-1',
      name: 'stage',
      status: 'running',
      currentStep: 0,
      totalSteps: 1,
      retryCount: 0,
      version: 0,
      createdAt: new Date(),
    });

    expect(await repo.resumeFromInterrupt('s4', 'pending')).toBe(false);
    expect((await repo.getById('s4')).status).toBe('running');
  });
});
