import { describe, it, expect, afterEach } from 'vitest';
import { workflow } from '@generatorai/workflow-spec/builders';
import { createTestGeneratorAI } from '../testing/helpers.js';
import { MockHarness } from '../testing/MockHarness.js';
import type { GeneratorAI } from '../GeneratorAI.js';
import { resolveConfig } from '../config.js';

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
  ai = await createTestGeneratorAI({ harness: new MockHarness() as never });
  return ai;
}

describe('config: harness selection', () => {
  it('still honours the deprecated `provider` alias', async () => {
    const sdk = await createTestGeneratorAI({ provider: new MockHarness() as never });
    ai = sdk;
    expect(typeof sdk.config.harness).toBe('object');
  });

  it('prefers `harness` when both are given', async () => {
    const chosen = new MockHarness();
    const sdk = await createTestGeneratorAI({
      harness: chosen as never,
      provider: new MockHarness() as never,
    });
    ai = sdk;
    expect(sdk.config.harness).toBe(chosen);
  });

  it('refuses a config with neither, naming the field to set', () => {
    expect(() => resolveConfig({})).toThrow(/`harness`/);
  });
});

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
    const def = await sdk.workflows.create(
      workflow('SDK Smoke WF')
        .stage('build', (s) => s.name('Build').prompt('build it'))
        .stage('test', (s) => s.name('Test').prompt('test it'))
        .edge('build', 'test'),
    );
    expect(def.id).toBeTruthy();
    expect(def.status).toBe('published');
    expect(def.graph.stages).toHaveLength(2);

    const list = await sdk.workflows.list();
    expect(list.some((w) => w.id === def.id)).toBe(true);

    const fetched = await sdk.workflows.get(def.id);
    expect(fetched.graph.stages.map((s) => s.name).sort()).toEqual(['Build', 'Test']);
    expect(fetched.graph.edges).toEqual([{ from: 'build', to: 'test', on: 'success' }]);
  });

  it('createRun produces a run in the created state without executing', async () => {
    const sdk = await make();
    const def = await sdk.workflows.create({
      formatVersion: 2,
      workflow: { name: 'SDK Run WF' },
      stages: [{ kind: 'agent', key: 'only', name: 'Only', prompts: [{ label: 'p', text: 'ok' }] }],
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
