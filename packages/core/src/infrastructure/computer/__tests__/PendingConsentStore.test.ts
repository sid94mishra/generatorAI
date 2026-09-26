import { describe, it, expect, vi } from 'vitest';
import type { AgentEvent, ILogger } from '@generatorai/shared';
import { PendingConsentStore } from '../PendingConsentStore.js';
import type { IComputerGrantRepository } from '../PendingConsentStore.js';
import type { ComputerConsentPrompt } from '../../../services/ComputerService.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;

function makeRepo(): IComputerGrantRepository & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    async findGrant() { return null; },
    async saveGrant(workspaceId, appIdentity, appLabel, decision, scope) {
      saved.push({ workspaceId, appIdentity, appLabel, decision, scope });
    },
  };
}

function makeStore(emit?: (event: AgentEvent) => void | Promise<void>) {
  const events: AgentEvent[] = [];
  const repo = makeRepo();
  const eventBus = {
    emit: async (_scope: string, event: AgentEvent) => {
      events.push(event);
      await emit?.(event);
      return event;
    },
  };
  return { store: new PendingConsentStore(repo, eventBus as never, logger), events, repo };
}

function prompt(overrides: Partial<ComputerConsentPrompt> = {}): ComputerConsentPrompt {
  return {
    requestId: 'req-1',
    workspaceId: 'ws-1',
    app: { appId: 'com.example.app', name: 'Example', pid: 1 },
    action: 'click',
    summary: 'click in Example',
    scope: 'mutate',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe('PendingConsentStore', () => {
  it('emits a consent_required event and parks until answered', async () => {
    const { store, events } = makeStore();
    const pending = store.prompt(prompt());
    expect(events[0]?.kind).toBe('computer.consent_required');
    expect(store.resolve('req-1', 'allow_once', 'com.example.app')).toBe(true);
    await expect(pending).resolves.toMatchObject({ decision: 'allow_once' });
  });

  it('denies when the prompt cannot be delivered', async () => {
    // Nobody can see the prompt, so nobody can approve it — a broken event
    // pipeline must not read as approval.
    const { store } = makeStore(() => { throw new Error('stream down'); });
    await expect(store.prompt(prompt())).resolves.toMatchObject({ decision: 'deny' });
  });

  it('reports false for a replayed or unknown answer', async () => {
    const { store } = makeStore();
    const pending = store.prompt(prompt());
    expect(store.resolve('req-1', 'deny', 'com.example.app')).toBe(true);
    expect(store.resolve('req-1', 'allow_once', 'com.example.app')).toBe(false);
    expect(store.resolve('never-issued', 'always_allow', 'com.example.app')).toBe(false);
    await expect(pending).resolves.toMatchObject({ decision: 'deny' });
  });

  it('downgrades always_allow to allow_once for synthetic prompts', async () => {
    const { store } = makeStore();
    const pending = store.prompt(prompt({ scope: 'synthetic' }));
    store.resolve('req-1', 'always_allow', 'com.example.app');
    await expect(pending).resolves.toMatchObject({ decision: 'allow_once' });
  });

  it('marks synthetic prompts as such in the event payload', async () => {
    const { store, events } = makeStore();
    void store.prompt(prompt({ scope: 'synthetic' }));
    const event = events[0];
    if (event?.kind !== 'computer.consent_required') throw new Error('unexpected event');
    expect(event.data.path).toBe('synthetic');
    store.resolve('req-1', 'deny', 'com.example.app');
  });

  it('rejects an answer that names a different application', async () => {
    // The requestId travels over SSE to every subscriber; the app identity is
    // what proves the answerer knew what it was approving.
    const { store } = makeStore();
    const pending = store.prompt(prompt());
    expect(store.resolve('req-1', 'always_allow', 'com.other.app')).toBe(false);
    expect(store.resolve('req-1', 'allow_once', 'com.example.app')).toBe(true);
    await expect(pending).resolves.toMatchObject({ decision: 'allow_once' });
  });

  it('refuses to answer a prompt that already expired', async () => {
    const { store } = makeStore();
    const pending = store.prompt(prompt({ expiresAt: Date.now() - 1 }));
    expect(store.resolve('req-1', 'always_allow', 'com.example.app')).toBe(false);
    await expect(pending).resolves.toMatchObject({ decision: 'deny' });
  });

  it('denies every outstanding prompt on cancelAll', async () => {
    const { store } = makeStore();
    const a = store.prompt(prompt({ requestId: 'a' }));
    const b = store.prompt(prompt({ requestId: 'b', workspaceId: 'ws-2' }));
    store.cancelAll();
    await expect(a).resolves.toMatchObject({ decision: 'deny' });
    await expect(b).resolves.toMatchObject({ decision: 'deny' });
  });

  it('cancelAll can be scoped to one workspace', async () => {
    const { store } = makeStore();
    const a = store.prompt(prompt({ requestId: 'a', workspaceId: 'ws-1' }));
    void store.prompt(prompt({ requestId: 'b', workspaceId: 'ws-2' }));
    store.cancelAll('ws-1');
    await expect(a).resolves.toMatchObject({ decision: 'deny' });
    expect(store.resolve('b', 'allow_once', 'com.example.app')).toBe(true);
  });

  it('persists grants through the repository', async () => {
    const { store, repo } = makeStore();
    await store.save('ws-1', 'com.example.app', 'Example', 'always_allow', 'mutate');
    expect(repo.saved).toEqual([
      { workspaceId: 'ws-1', appIdentity: 'com.example.app', appLabel: 'Example', decision: 'always_allow', scope: 'mutate' },
    ]);
  });
});

describe('PendingConsentStore — G-07 reach and plan', () => {
  it('answers carry their reach; omitted, each decision keeps its own', async () => {
    const { store } = makeStore();
    const a = store.prompt(prompt({ requestId: 'a' }));
    const b = store.prompt(prompt({ requestId: 'b' }));
    const c = store.prompt(prompt({ requestId: 'c' }));
    const d = store.prompt(prompt({ requestId: 'd' }));
    expect(store.resolve('a', 'always_allow', 'com.example.app', 'any')).toBe(true);
    expect(store.resolve('b', 'allow_run', 'com.example.app')).toBe(true);
    expect(store.resolve('c', 'always_allow', 'com.example.app')).toBe(true);
    expect(store.resolve('d', 'deny', 'com.example.app', 'any')).toBe(true);
    await expect(a).resolves.toEqual({ decision: 'always_allow', reach: 'any' });
    await expect(b).resolves.toEqual({ decision: 'allow_run', reach: 'any' });
    await expect(c).resolves.toEqual({ decision: 'always_allow', reach: 'app' });
    // A deny is always for the app it named.
    await expect(d).resolves.toEqual({ decision: 'deny', reach: 'app' });
  });

  it('puts the batch plan on the event and on the pending row', async () => {
    const { store, events } = makeStore();
    const plan = [{ action: 'clickPoint', target: '(10, 20)' }, { action: 'typeText' }];
    void store.prompt(prompt({ plan, summary: '2 actions in Example' }));
    await Promise.resolve();
    expect(events[0]).toMatchObject({ kind: 'computer.consent_required', data: { plan, workspaceId: 'ws-1' } });
    expect(store.listPending('ws-1')).toEqual([
      expect.objectContaining({ requestId: 'req-1', workspaceId: 'ws-1', plan, path: 'accessibility' }),
    ]);
    expect(store.listAllPending()[0]).toMatchObject({ plan });
  });
});

