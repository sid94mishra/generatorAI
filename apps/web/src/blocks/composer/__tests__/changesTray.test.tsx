// The tray above the composer lists what this chat changed that is still
// uncommitted: a commit empties it, a file changed again after the commit is
// pending again.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type File = { path: string; status: string; additions: number; deletions: number; kept?: boolean };
const data: { chat: File[]; uncommitted: File[] | undefined } = { chat: [], uncommitted: [] };
const summary = (files: File[]) => ({
  repos: [{ alias: 'main', kind: 'generated', files, stats: { files: files.length, additions: 0, deletions: 0 } }],
  stats: { files: files.length, additions: 0, deletions: 0 },
});

vi.mock('@/hooks/queries.js', () => ({
  useWorkspaceChangeSummary: (_ws: string | undefined, opts: { base?: string }) =>
    opts.base === 'head'
      ? { data: data.uncommitted ? summary(data.uncommitted) : undefined, dataUpdatedAt: 1 }
      : { data: summary(data.chat), dataUpdatedAt: 1 },
  useReviewWorkspaceChanges: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDiscardWorkspaceChanges: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/changesQueries.js', () => ({ useInvalidateWorkspaceChangeSummary: () => () => undefined }));

const { ChangesTray } = await import('../parts/ChangesTray.js');

const file = (path: string): File => ({ path, status: 'added', additions: 3, deletions: 0 });

function renderTray() {
  return render(<ChangesTray workspaceId="ws" sessionId="s" streaming={false} onOpenChanges={() => undefined} />);
}

describe('ChangesTray', () => {
  beforeEach(() => {
    data.chat = [];
    data.uncommitted = [];
  });

  it('lists only the chat’s changes that are not committed yet', () => {
    data.chat = [file('hello.py'), file('notes.md')];
    data.uncommitted = [file('notes.md')];
    renderTray();
    expect(screen.getByText(/1 file changed/)).toBeInTheDocument();
  });

  it('is empty once everything the chat changed is committed', () => {
    data.chat = [file('hello.py')];
    data.uncommitted = [];
    renderTray();
    expect(screen.queryByText(/files? changed/)).toBeNull();
  });

  it('filters nothing until the uncommitted list has loaded', () => {
    data.chat = [file('hello.py'), file('notes.md')];
    data.uncommitted = undefined;
    renderTray();
    expect(screen.getByText(/2 files changed/)).toBeInTheDocument();
  });
});
