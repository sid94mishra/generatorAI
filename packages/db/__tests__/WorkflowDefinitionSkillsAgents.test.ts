// ────────────────────────────────────────────────────────────────
// DrizzleWorkflowDefinitionRepository — G8 fix.
//
// `WorkflowDefinition.skills` / `.agents` are populated by real callers
// (WorkflowDefinitionService, the PWS materializer in
// apps/server/src/routes/workflowScripts.ts) but had NO column at all —
// `create()`/`update()` silently dropped them, `getById()` always returned
// `undefined` for both fields regardless of what was set. Migration 39 adds
// the columns; this test pins the round trip.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDB, migrateDB, type AppDatabase } from '../src/index.js';
import { DrizzleWorkflowDefinitionRepository } from '../src/repositories/WorkflowDefinitionRepository.js';
import type { WorkflowDefinition } from '@generatorai/shared';

let dir: string;
let db: AppDatabase;
let repo: DrizzleWorkflowDefinitionRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-wfdef-'));
  db = createDB(join(dir, 'w.db'));
  migrateDB(db);
  repo = new DrizzleWorkflowDefinitionRepository(db);
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

function baseDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'wf-1',
    name: 'Test workflow',
    version: 1,
    sessionMode: 'auto',
    variables: [],
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('WorkflowDefinition.skills / .agents round trip (G8)', () => {
  it('survives create → getById unchanged', async () => {
    const skills = [{ name: 'reviewer', directory: '.skills/reviewer', description: 'reviews code' }];
    const agents = [{ name: 'planner', description: 'plans work', tools: ['read', 'write'] }];

    await repo.create(baseDefinition({ skills, agents }));
    const fetched = await repo.getById('wf-1');

    expect(fetched.skills).toEqual(skills);
    expect(fetched.agents).toEqual(agents);
  });

  it('is undefined (not an empty array) when never set', async () => {
    await repo.create(baseDefinition());
    const fetched = await repo.getById('wf-1');

    expect(fetched.skills).toBeUndefined();
    expect(fetched.agents).toBeUndefined();
  });

  it('survives update()', async () => {
    await repo.create(baseDefinition());
    const skills = [{ name: 'linter' }];
    await repo.update('wf-1', { skills });

    const fetched = await repo.getById('wf-1');
    expect(fetched.skills).toEqual(skills);
    expect(fetched.agents).toBeUndefined(); // untouched field stays untouched
  });

  it('getAll() also carries skills/agents through', async () => {
    const agents = [{ name: 'triager' }];
    await repo.create(baseDefinition({ agents }));

    const all = await repo.getAll();
    expect(all[0]?.agents).toEqual(agents);
  });
});
