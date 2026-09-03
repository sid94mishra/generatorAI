import { describe, expect, it } from 'vitest';
import type { Api } from '@generatorai/cli-core';
import { openerFor } from '../open.js';

// Phase 7 item 2 — the `workspaces` opener parsed the real `changes`
// response (`ChangeSummary`, `client.ts:423-428`) as if it were a bare
// array with a top-level `files`, neither of which the server ever sends —
// files are always grouped one level down, per repo/worktree (`.repos[].files`).
// Every workspace opened from the TUI showed "No changes" regardless of the
// workspace's actual state until this was fixed to flatten `repos` the same
// way `workspace.changes`'s own CLI handler already does.
describe('workspaces opener', () => {
  const opener = openerFor('workspaces')!;

  function fakeApi(repos: Array<{ alias: string; files: Array<Record<string, unknown>> }>): Api {
    return {
      workspaces: {
        changes: async () => ({
          workspaceId: 'w1',
          hasGit: true,
          repos,
          stats: { files: 0, additions: 0, deletions: 0 },
        }),
      },
    } as unknown as Api;
  }

  it('flattens repos[].files into one flat file list, tagging each with its repo alias', async () => {
    const content = await opener.build(
      { id: 'w1', name: 'My workspace' },
      fakeApi([
        { alias: 'main', files: [{ path: 'a.ts', status: 'modified', additions: 3, deletions: 1 }] },
        { alias: 'sub-worktree', files: [{ path: 'b.ts', status: 'added', additions: 10, deletions: 0 }] },
      ]),
    );
    const files = (content.state as { files: Array<Record<string, unknown>> }).files;
    expect(files).toEqual([
      { alias: 'main', path: 'a.ts', status: 'modified', additions: 3, deletions: 1 },
      { alias: 'sub-worktree', path: 'b.ts', status: 'added', additions: 10, deletions: 0 },
    ]);
  });

  it('is an empty list, not a crash, when the workspace has no repos', async () => {
    const content = await opener.build({ id: 'w1', name: 'My workspace' }, fakeApi([]));
    expect((content.state as { files: unknown[] }).files).toEqual([]);
  });

  it('degrades to an empty list rather than throwing when the fetch fails', async () => {
    const api = {
      workspaces: {
        changes: async () => {
          throw new Error('network error');
        },
      },
    } as unknown as Api;
    const content = await opener.build({ id: 'w1', name: 'My workspace' }, api);
    expect((content.state as { files: unknown[] }).files).toEqual([]);
  });
});
