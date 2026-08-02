import { describe, it, expect, afterEach } from 'vitest';
import { createTestGeneratorAI } from '../testing/helpers.js';
import { MockHarness } from '../testing/MockHarness.js';
import type { GeneratorAI } from '../GeneratorAI.js';

// SDK smoke tests — exercise the public facade surface against an in-memory
// temp DB with a stubbed harness (no real model calls). Covers the DB-backed
// CRUD paths; live execution is covered by the Web E2E run specs.

let ai: GeneratorAI | undefined;

afterEach(async () => {
  if (ai) {
    await ai.shutdown();
    ai = undefined;
  }
});

async function make(): Promise<GeneratorAI> {
  // Inject the stub harness so create() does not spin up a real provider.
  ai = await createTestGeneratorAI({ provider: new MockHarness() as never });
  return ai;
}

describe('GeneratorAI lifecycle', () => {
  it('creates and shuts down cleanly (idempotent shutdown)', async () => {
    const sdk = await make();
    expect(sdk.workflows).toBeDefined();
    expect(sdk.chat).toBeDefined();
    await sdk.shutdown();
    await sdk.shutdown(); // second shutdown must not throw
    ai = undefined;
  });
});

describe('WorkflowFacade', () => {
  it('creates a workflow with stages + edges and reads it back', async () => {
    const sdk = await make();
    const def = await sdk.workflows.create({
      name: 'SDK Smoke WF',
      stages: [
        { localId: 'a', name: 'Build', prompt: 'build it' },
        { localId: 'b', name: 'Test', prompt: 'test it' },
      ],
      edges: [{ fromStageLocalId: 'a', toStageLocalId: 'b', edgeType: 'on_success' }],
    });
    expect(def.id).toBeTruthy();
    expect(def.stages).toHaveLength(2);

    const list = await sdk.workflows.list();
    expect(list.some((w) => w.id === def.id)).toBe(true);

    const fetched = await sdk.workflows.get(def.id);
    expect(fetched.stages.map((s) => s.name).sort()).toEqual(['Build', 'Test']);
    expect(fetched.edges).toHaveLength(1);
  });

  it('createRun produces a run in the created state without executing', async () => {
    const sdk = await make();
    const def = await sdk.workflows.create({
      name: 'SDK Run WF',
      stages: [{ localId: 's', name: 'Only', prompt: 'ok' }],
      edges: [],
    });
    const run = await sdk.workflows.createRun(def.id);
    expect(run.id).toBeTruthy();
    expect(run.status).toBe('created');
    const status = await sdk.workflows.status(run.id);
    expect(status.status).toBe('created');
  });
});

describe('ChatFacade', () => {
  it('creates and lists a chat', async () => {
    const sdk = await make();
    const chat = await sdk.chat.create({ name: 'SDK Smoke Chat', tags: ['smoke'] });
    expect(chat.id).toBeTruthy();
    const list = await sdk.chat.list();
    expect(list.some((c) => c.id === chat.id)).toBe(true);
  });
});

describe('ProjectFacade', () => {
  it('creates and retrieves a project', async () => {
    const sdk = await make();
    const project = await sdk.projects.create({ name: 'SDK Smoke Project' });
    expect(project.id).toBeTruthy();
    const fetched = await sdk.projects.get(project.id);
    expect(fetched.name).toBe('SDK Smoke Project');
  });
});
