import { describe, expect, it } from 'vitest';

import {
  KEEP_ALIVE_LIMIT,
  changedFilesGlimpse,
  nextKeepAlive,
  planStatusLabel,
  toolForSection,
  workbenchBadge,
  workbenchTools,
} from '../components/workbench/workbenchModel';

const ids = (tools: ReturnType<typeof workbenchTools>): string[] => tools.map((t) => t.id);

describe('workbenchTools', () => {
  it('offers only the session tools until the agent has a workspace', () => {
    expect(ids(workbenchTools({ workspaceId: null }))).toEqual(['plan', 'session']);
  });

  it('has no Source control tool: commit, push and PR live in Changes, as on desktop', () => {
    expect(ids(workbenchTools({ workspaceId: 'w1' }))).not.toContain('scm');
    expect(toolForSection('scm')).toBe('changes');
  });

  it('lists review first, then the workspace, then the session', () => {
    const tools = workbenchTools({
      workspaceId: 'w1',
      tasks: { orchestrator: true, total: 0, running: 0 },
      computer: { enabled: true, locked: false, needsAnswer: false },
    });
    expect(ids(tools)).toEqual(['changes', 'files', 'terminal', 'browser', 'computer', 'tasks', 'plan', 'session']);
  });

  it('keeps chat-only tools off a workflow run', () => {
    const tools = workbenchTools({ surface: 'run', workspaceId: 'w1', tasks: { orchestrator: true, total: 3, running: 1 } });
    expect(ids(tools)).toEqual(['changes', 'files', 'terminal', 'browser']);
  });

  it('only offers Tasks to an orchestrator or a chat that spawned one', () => {
    expect(ids(workbenchTools({ workspaceId: null, tasks: { orchestrator: false, total: 0, running: 0 } }))).not.toContain('tasks');
    expect(ids(workbenchTools({ workspaceId: null, tasks: { orchestrator: false, total: 2, running: 0 } }))).toContain('tasks');
  });

  it('summarises a change set: count, line stats and the first file names', () => {
    const [changes] = workbenchTools({
      workspaceId: 'w1',
      changes: { files: 4, additions: 73, deletions: 2, firstPaths: ['src/pricing.test.ts', 'src/pricing.ts'] },
    });
    expect(changes).toMatchObject({
      id: 'changes',
      count: 4,
      stats: { additions: 73, deletions: 2 },
      glimpse: 'pricing.test.ts, pricing.ts +2',
    });
  });

  it('says so when nothing changed, with no badge', () => {
    const [changes] = workbenchTools({ workspaceId: 'w1', changes: { files: 0, additions: 0, deletions: 0, firstPaths: [] } });
    expect(changes?.glimpse).toBe('No changes yet');
    expect(changes?.count).toBeUndefined();
  });

  it('lists the changed files first, then the branch state', () => {
    const [changes] = workbenchTools({
      workspaceId: 'w1',
      changes: { files: 2, additions: 5, deletions: 1, firstPaths: ['a.ts', 'b.ts'] },
      scm: { branch: 'feat/coupons', ahead: 2, behind: 1, openPullRequest: { number: 41 }, conflicts: 0, repoCount: 1 },
    });
    expect(changes?.glimpse).toBe('a.ts, b.ts · feat/coupons · ↑2 · ↓1 · PR #41');
  });

  it('tells a detached HEAD from a repository with no branch yet', () => {
    const glimpse = (scm: { branch: string | null; detached?: boolean }): string | undefined =>
      workbenchTools({
        workspaceId: 'w1',
        scm: { ahead: null, behind: null, openPullRequest: null, conflicts: 0, repoCount: 1, ...scm },
      }).find((t) => t.id === 'changes')?.glimpse;
    expect(glimpse({ branch: null, detached: true })).toBe('No changes yet · detached HEAD');
    expect(glimpse({ branch: null })).toBe('No changes yet · no branch');
  });

  it('flags conflicts as needing the person', () => {
    const scm = workbenchTools({
      workspaceId: 'w1',
      scm: { branch: 'main', ahead: 0, behind: 0, openPullRequest: null, conflicts: 3, repoCount: 1 },
    }).find((t) => t.id === 'changes');
    expect(scm).toMatchObject({ attention: true, tone: 'danger' });
    expect(scm?.glimpse).toContain('3 conflicts');
  });

  it('lists a tool the device cannot use as locked rather than hiding it', () => {
    const tools = workbenchTools({ workspaceId: 'w1', terminalLocked: true, browserLocked: true, browser: { ready: true, url: 'http://x' } });
    expect(tools.find((t) => t.id === 'terminal')).toMatchObject({ locked: true });
    // A locked browser is never reported live, even if one is running.
    expect(tools.find((t) => t.id === 'browser')).toMatchObject({ locked: true });
    expect(tools.find((t) => t.id === 'browser')?.live).toBeUndefined();
  });

  it('shows the host the browser is on', () => {
    const browser = workbenchTools({ workspaceId: 'w1', browser: { ready: true, url: 'http://localhost:5173/cart?x=1' } }).find(
      (t) => t.id === 'browser',
    );
    expect(browser).toMatchObject({ live: true, glimpse: 'localhost:5173' });
  });

  it('puts a plan awaiting review ahead of everything else it could say', () => {
    const plan = workbenchTools({ workspaceId: null, plan: { title: 'Add coupons', status: 'awaiting_review' } }).find(
      (t) => t.id === 'plan',
    );
    expect(plan).toMatchObject({ attention: true, glimpse: 'Waiting for your review · Add coupons' });
  });

  it('warns when the context window is nearly full', () => {
    const session = workbenchTools({ workspaceId: null, session: { model: 'Sonnet 5', contextPercent: 91.4 } }).find(
      (t) => t.id === 'session',
    );
    expect(session).toMatchObject({ glimpse: 'Sonnet 5 · 91% context', tone: 'warning' });
  });
});

describe('workbenchBadge', () => {
  it('prefers attention, then the change count, then a live dot', () => {
    const base = { workspaceId: 'w1' } as const;
    expect(workbenchBadge(workbenchTools(base))).toBeNull();
    expect(workbenchBadge(workbenchTools({ ...base, browser: { ready: true, url: null } }))).toEqual({ kind: 'live' });
    const changed = { ...base, changes: { files: 3, additions: 1, deletions: 1, firstPaths: ['a.ts'] } };
    expect(workbenchBadge(workbenchTools(changed))).toEqual({ kind: 'count', count: 3 });
    expect(workbenchBadge(workbenchTools({ ...changed, plan: { title: 'p', status: 'awaiting_review' } }))).toEqual({
      kind: 'attention',
    });
  });
});

describe('keep-alive', () => {
  it('never keeps a cheap tool mounted', () => {
    expect(nextKeepAlive([], 'changes')).toEqual([]);
    expect(nextKeepAlive(['terminal'], 'files')).toEqual(['terminal']);
  });

  it('keeps the most recent heavy tools, newest first, within the cap', () => {
    let alive = nextKeepAlive([], 'terminal');
    alive = nextKeepAlive(alive, 'browser');
    expect(alive).toEqual(['browser', 'terminal']);
    alive = nextKeepAlive(alive, 'computer');
    expect(alive).toHaveLength(KEEP_ALIVE_LIMIT);
    expect(alive[0]).toBe('computer');
    expect(alive).not.toContain('terminal');
    // Re-opening moves a tool to the front without duplicating it.
    expect(nextKeepAlive(['browser', 'terminal'], 'terminal')).toEqual(['terminal', 'browser']);
  });
});

describe('helpers', () => {
  it('names files, not paths, and counts the rest', () => {
    expect(changedFilesGlimpse(['a/b/c.ts'], 1)).toBe('c.ts');
    expect(changedFilesGlimpse(['a\\b\\c.ts', 'd.ts', 'e.ts'], 9)).toBe('c.ts, d.ts +7');
    expect(changedFilesGlimpse([], 0)).toBe('');
  });

  it('reads plan statuses as sentences', () => {
    expect(planStatusLabel('awaiting_review')).toBe('Waiting for your review');
    expect(planStatusLabel('some_new_state')).toBe('some new state');
  });

  it('routes composer sections to tools', () => {
    expect(toolForSection('terminal')).toBe('terminal');
    expect(toolForSection('inspector')).toBe('session');
    expect(toolForSection('nonsense')).toBeNull();
  });
});
