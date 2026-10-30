import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckpointRecord } from '@/types/changes.js';
import { CheckpointScrubber } from './CheckpointScrubber.js';

const state = vi.hoisted(() => ({
  checkpoints: [] as CheckpointRecord[],
  isLoading: false,
  mutateAsync: vi.fn(),
}));

vi.mock('@/hooks/queries.js', () => ({
  useWorkspaceCheckpoints: () => ({ data: { checkpoints: state.checkpoints }, isLoading: state.isLoading }),
  useRestoreWorkspaceCheckpoint: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
}));

function cp(id: string, over: Partial<CheckpointRecord>): CheckpointRecord {
  return {
    id,
    workspaceId: 'ws-1',
    repoAlias: 'app',
    seq: 1,
    kind: 'turn',
    refKind: 'git_tree',
    refValue: 'r',
    treeSha: 't',
    fileCount: 1,
    additions: 2,
    deletions: 1,
    createdAt: '2026-09-06T14:00:00.000Z',
    ...over,
  };
}

const ok = (checkpointId: string) => ({
  workspaceId: 'ws-1',
  checkpointId,
  preRestoreCheckpointId: 'pre-1',
  restoredPaths: ['a.ts'],
  deletedPaths: [],
  skipped: [],
});

beforeEach(() => {
  state.checkpoints = [];
  state.isLoading = false;
  state.mutateAsync.mockReset();
});

describe('CheckpointScrubber', () => {
  it('keeps Close checkpoints → header row → root, so a host wrapper is its grandparent', () => {
    render(
      <div data-testid="wrapper">
        <CheckpointScrubber workspaceId="ws-1" onClose={vi.fn()} />
      </div>,
    );
    const close = screen.getByRole('button', { name: 'Close checkpoints' });
    expect(close.parentElement!.parentElement!.parentElement).toBe(screen.getByTestId('wrapper'));
  });

  it('shows the newest stop’s actions and compares by turn selector', async () => {
    state.checkpoints = [
      cp('new', { turnId: 't2', createdAt: '2026-09-06T14:05:00.000Z' }),
      cp('old', { turnId: 't1', createdAt: '2026-09-06T14:01:00.000Z' }),
    ];
    const onCompare = vi.fn();
    render(<CheckpointScrubber workspaceId="ws-1" onClose={vi.fn()} onCompare={onCompare} />);

    expect(screen.getByText('Turn 2 of 2')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Compare' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Rewind' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(onCompare).toHaveBeenCalledWith('turn:t2');
  });

  it('rewinds every mount the turn touched, one request each in order, and reports per mount', async () => {
    state.checkpoints = [
      cp('before-api', { turnId: 't1', repoAlias: 'api', phase: 'before' }),
      cp('before-web', { turnId: 't1', repoAlias: 'web', phase: 'before' }),
    ];
    state.mutateAsync.mockResolvedValueOnce(ok('before-api')).mockRejectedValueOnce(new Error('Tree changed.'));
    render(<CheckpointScrubber workspaceId="ws-1" onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Rewind' }));
    expect(state.mutateAsync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Rewind 2 sources' }));

    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledTimes(2));
    expect(state.mutateAsync).toHaveBeenNthCalledWith(1, { checkpointId: 'before-api' });
    expect(state.mutateAsync).toHaveBeenNthCalledWith(2, { checkpointId: 'before-web' });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Rewound 1 of 2 sources');
    expect(status).toHaveTextContent('Tree changed.');
    expect(screen.queryByRole('button', { name: 'Rewind 2 sources' })).toBeNull();
  });

  it('says "Confirm rewind" for a single mount', async () => {
    state.checkpoints = [cp('only', { turnId: 't1', phase: 'before' })];
    render(<CheckpointScrubber workspaceId="ws-1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Rewind' }));
    expect(screen.getByRole('button', { name: 'Confirm rewind' })).toBeInTheDocument();
  });

  it('has an empty state', () => {
    render(<CheckpointScrubber workspaceId="ws-1" onClose={vi.fn()} />);
    expect(screen.getByText('No checkpoints yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rewind' })).toBeNull();
  });
});
