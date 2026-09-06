// ────────────────────────────────────────────────────────────────
// WorkspacedCopilotPool — the workspace cap
//
// The pool keys one Copilot CLI process per working directory. That was
// written for several conversations sharing a workspace, but this product
// gives every chat its OWN execution workspace, so the key is effectively
// per-chat. `maxWorkspaces` defaulted to `Infinity` and nothing in the tree
// ever set it, so a server that had served N chats held N CLI processes and
// released none — eviction only runs when the cap is exceeded.
//
// These cases pin the bound and, just as importantly, that it never reclaims a
// workspace with a turn in flight.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';

import { WorkspacedCopilotPool } from '../src/providers/copilot/WorkspacedCopilotPool.js';

type Entry = { lastUsedAt: number; activeConversationCount: number; provider: { stop: () => Promise<void> } };
type Internals = {
  maxWorkspaces: number;
  workspaces: Map<string, Entry>;
  conversationWorkspace: Map<string, string>;
  workspaceEventUnsubs: Map<string, () => void>;
  evictLru: () => Promise<void>;
};

function pool(options: Record<string, unknown> = {}): { pool: WorkspacedCopilotPool; internals: Internals } {
  const p = new WorkspacedCopilotPool(options as ConstructorParameters<typeof WorkspacedCopilotPool>[0]);
  return { pool: p, internals: p as unknown as Internals };
}

function entry(lastUsedAt: number, active = 0): Entry {
  return { lastUsedAt, activeConversationCount: active, provider: { stop: async () => {} } };
}

describe('WorkspacedCopilotPool workspace cap', () => {
  it('is bounded by default rather than Infinity', () => {
    const { internals } = pool();
    expect(Number.isFinite(internals.maxWorkspaces)).toBe(true);
    expect(internals.maxWorkspaces).toBeGreaterThan(0);
  });

  it('still honours an explicit cap', () => {
    const { internals } = pool({ maxWorkspaces: 3 });
    expect(internals.maxWorkspaces).toBe(3);
  });

  it('evicts the least recently used idle workspace', async () => {
    const { internals } = pool({ maxWorkspaces: 2 });
    internals.workspaces.set('old', entry(1_000));
    internals.workspaces.set('new', entry(9_000));

    await internals.evictLru();

    expect([...internals.workspaces.keys()]).toEqual(['new']);
  });

  it('never evicts a workspace with a turn in flight, even if it is the oldest', async () => {
    // Stopping the CLI mid-turn aborts the conversation with an error, which
    // is far worse than holding one extra process.
    const { internals } = pool({ maxWorkspaces: 1 });
    internals.workspaces.set('busy-but-old', entry(1_000, 1));
    internals.workspaces.set('idle-but-new', entry(9_000, 0));

    await internals.evictLru();

    expect(internals.workspaces.has('busy-but-old')).toBe(true);
    expect(internals.workspaces.has('idle-but-new')).toBe(false);
  });

  it('does nothing when every workspace is busy', async () => {
    const { internals } = pool({ maxWorkspaces: 1 });
    internals.workspaces.set('a', entry(1_000, 1));
    internals.workspaces.set('b', entry(2_000, 2));

    await internals.evictLru();

    expect(internals.workspaces.size).toBe(2);
  });

  it('drops the conversation mappings of an evicted workspace', async () => {
    // A stale mapping would route a later call to a process that is gone.
    const { internals } = pool({ maxWorkspaces: 1 });
    internals.workspaces.set('gone', entry(1_000));
    internals.conversationWorkspace.set('conv-1', 'gone');
    internals.conversationWorkspace.set('conv-2', 'kept');
    internals.workspaces.set('kept', entry(5_000));

    await internals.evictLru();

    expect(internals.conversationWorkspace.has('conv-1')).toBe(false);
    expect(internals.conversationWorkspace.get('conv-2')).toBe('kept');
  });
});
