// ────────────────────────────────────────────────────────────────
// Workflow authoring + diff-navigation bounds (Phase 7 items 2/4/5/6).
//
// Two things are covered here, both of which are silent-wrong-answer bugs
// rather than crashes:
//
//  1. `paneListRows` — the array a pane's cursor is sized against. A diff
//     pane was sized against the WORKSPACE list cache, so `diff.nextFile`
//     could not reach files past the number of workspaces that happened to
//     exist.
//  2. `workflowPaneContent` — the rebuild every authoring action ends with.
//     A rebuild that dropped the cursor would send it back to stage one
//     after every single edit.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import type { Api, PaneContent } from '@generatorai/cli-core';
import { paneListRows } from '../App.js';
import { workflowPaneContent } from '../open.js';
import type { DataCache } from '../store.js';

const emptyCache: DataCache = {
  chats: [],
  workflows: [],
  runs: [],
  automations: [],
  projects: [],
  workspaces: [],
  agents: [],
  scripts: [],
  extensions: [],
};

describe('paneListRows', () => {
  it('sizes a diff pane against its own files, not the workspace list cache', () => {
    // The bug: `dataKeysFor('changes')` is `'workspaces'`, so a workspace
    // list with ONE entry capped a five-file diff's cursor at index 0 and
    // `diff.nextFile` could never reach files 2-5.
    const content: PaneContent = {
      kind: 'changes',
      entityId: 'ws-1',
      title: 'changes',
      state: { files: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }] },
    };
    const data: DataCache = { ...emptyCache, workspaces: [{ id: 'ws-1' }] };

    expect(paneListRows(content, data)).toHaveLength(3);
    expect(paneListRows(content, data)[2]).toEqual({ path: 'c.ts' });
  });

  it('returns a stable empty array for a diff pane with no files yet', () => {
    // `useSyncExternalStore` compares snapshots by reference: a fresh `[]`
    // per call reports a change every render and spins until React throws
    // "Maximum update depth exceeded".
    const content: PaneContent = { kind: 'changes', entityId: 'ws-1', title: 'changes' };
    expect(paneListRows(content, emptyCache)).toBe(paneListRows(content, emptyCache));
  });

  it('sizes a workspace tree pane against the rows it DRAWS, not its file list', () => {
    // In tree mode (the default) the drawn rows include a repo root and any
    // directories, so the cursor bound is the tree's length — sizing against
    // the flat file list would leave the bottom of a deep tree unreachable,
    // the same class of bug the `changes` pane had.
    const content: PaneContent = {
      kind: 'workspace',
      entityId: 'ws-1',
      title: 'workspace',
      state: {
        rows: [
          { alias: '.', relPath: 'a', kind: 'file' },
          { alias: '.', relPath: 'b', kind: 'file' },
        ],
      },
    };
    // repo root + two files.
    expect(paneListRows(content, { ...emptyCache, workspaces: [{ id: 'x' }] })).toHaveLength(3);
  });

  it('sizes a workspace pane in FLAT mode against its file list', () => {
    const content: PaneContent = {
      kind: 'workspace',
      entityId: 'ws-1',
      title: 'workspace',
      state: {
        view: 'flat',
        rows: [
          { alias: '.', relPath: 'a', kind: 'file' },
          { alias: '.', relPath: 'b', kind: 'file' },
        ],
      },
    };
    expect(paneListRows(content, { ...emptyCache, workspaces: [{ id: 'x' }] })).toHaveLength(2);
  });

  it('still reads the shared cache for every other pane kind', () => {
    const content: PaneContent = { kind: 'chats', title: 'Chats' };
    const data: DataCache = { ...emptyCache, chats: [{ id: 'c1' }, { id: 'c2' }] };
    expect(paneListRows(content, data)).toHaveLength(2);
  });

  it('is empty for a pane kind with no data key at all', () => {
    expect(paneListRows({ kind: 'terminal', title: 't' }, emptyCache)).toHaveLength(0);
    expect(paneListRows(undefined, emptyCache)).toHaveLength(0);
  });
});

describe('workflowPaneContent', () => {
  const stages = [
    { kind: 'agent', key: 'plan', name: 'plan', prompts: [], hooks: [] },
    { kind: 'agent', key: 'build', name: 'build', prompts: [], hooks: [] },
  ];
  const edges = [{ from: 'plan', to: 'build', on: 'success' }];
  const variables = [{ name: 'env', type: 'string', label: 'Env', required: false }];

  const apiWith = (withStages: Array<Record<string, unknown>>, name = 'ship it'): Api =>
    ({
      definitions: {
        get: vi.fn(async () => ({
          id: 'wf-1',
          status: 'draft',
          revision: 3,
          graph: { formatVersion: 2, workflow: { name, variables }, stages: withStages, edges },
        })),
      },
    }) as unknown as Api;

  const selectedKey = (content: PaneContent) =>
    (content.state as { selectedStageKey?: string | null }).selectedStageKey;

  it('carries the graph stages, edges and workflow variables into pane state', async () => {
    const content = await workflowPaneContent('wf-1', 'fallback', apiWith(stages));

    expect(content.kind).toBe('workflow');
    expect(content.title).toBe('ship it');
    expect(content.state).toMatchObject({ stages, edges, variables, status: 'draft', revision: 3 });
  });

  it('selects the first stage when nothing was selected before', async () => {
    expect(selectedKey(await workflowPaneContent('wf-1', 'fallback', apiWith(stages)))).toBe('plan');
  });

  it('keeps the cursor on the same stage key across a reload', async () => {
    // Every authoring action ends in a reload; a cursor that reset would
    // make editing two stages in a row unusable.
    expect(selectedKey(await workflowPaneContent('wf-1', 'fallback', apiWith(stages), 'build'))).toBe('build');
  });

  it('falls back to the first stage when the kept one was just removed', async () => {
    expect(selectedKey(await workflowPaneContent('wf-1', 'fallback', apiWith([stages[1]!]), 'plan'))).toBe('build');
  });

  it('selects nothing for an empty workflow rather than a key that does not exist', async () => {
    expect(selectedKey(await workflowPaneContent('wf-1', 'fallback', apiWith([]), 'plan'))).toBeNull();
  });

  it('falls back to the given title when the workflow has no name', async () => {
    expect((await workflowPaneContent('wf-1', 'wf-1 fallback', apiWith([], ''))).title).toBe('wf-1 fallback');
  });
});
