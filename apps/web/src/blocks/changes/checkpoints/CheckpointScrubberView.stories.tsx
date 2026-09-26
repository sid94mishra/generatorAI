import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import type { CheckpointRecord, RestoreCheckpointResult } from '@/types/changes.js';
import { groupCheckpoints } from './checkpointGroups.js';
import { CheckpointScrubberView } from './CheckpointScrubberView.js';

let seq = 0;
function cp(over: Partial<CheckpointRecord>): CheckpointRecord {
  seq += 1;
  return {
    id: `c${String(seq)}`,
    workspaceId: 'ws-1',
    repoAlias: 'app',
    seq,
    kind: 'turn',
    refKind: 'git_tree',
    refValue: 'refs/generatorai/checkpoints/x',
    treeSha: 'deadbeef',
    fileCount: 0,
    additions: 0,
    deletions: 0,
    createdAt: '2026-09-06T14:00:00.000Z',
    ...over,
  };
}

/** A turn as the server writes it: a `before` and an `after` snapshot per mount. */
function turn(id: string, at: string, prompt: string, stats: Pick<CheckpointRecord, 'fileCount' | 'additions' | 'deletions'>, aliases = ['app']) {
  return aliases.flatMap((alias) => [
    cp({ id: `${id}-before-${alias}`, turnId: id, phase: 'before', repoAlias: alias, createdAt: at, promptExcerpt: prompt }),
    cp({ id: `${id}-after-${alias}`, turnId: id, phase: 'after', repoAlias: alias, createdAt: at, promptExcerpt: prompt, ...stats }),
  ]);
}

// Server order: newest first.
const FOUR_TURNS = groupCheckpoints([
  ...turn('t4', '2026-09-06T14:05:41.000Z', 'Run the checkout spec again.', { fileCount: 1, additions: 4, deletions: 2 }),
  ...turn('t3', '2026-09-06T14:02:18.000Z', 'Also cover the zero-discount case in a unit test.', { fileCount: 2, additions: 14, deletions: 6 }),
  ...turn('t2', '2026-09-06T14:01:07.000Z', 'Derive the total from the coupon response.', { fileCount: 2, additions: 9, deletions: 11 }),
  ...turn('t1', '2026-09-06T14:00:12.000Z', 'Fix the coupon/total race in checkout.', { fileCount: 3, additions: 22, deletions: 9 }),
  cp({ id: 'base', kind: 'baseline', createdAt: '2026-09-06T13:59:30.000Z' }),
]);

const TWO_MOUNTS = groupCheckpoints(
  turn('t1', '2026-09-06T14:02:18.000Z', 'Rename the order total in both services.', { fileCount: 2, additions: 8, deletions: 8 }, ['api', 'web']),
);

const REVIEW_TURN = groupCheckpoints(
  turn(
    'r1',
    '2026-09-06T14:02:18.000Z',
    '<review_feedback><file path="src/cart/applyCoupon.ts"><comment line="20">Keep d = 0, but assert on it</comment>',
    { fileCount: 1, additions: 3, deletions: 1 },
  ),
);

const restored = (restoredPaths: string[], skipped: RestoreCheckpointResult['skipped'] = []): RestoreCheckpointResult => ({
  workspaceId: 'ws-1',
  checkpointId: 'x',
  preRestoreCheckpointId: 'pre-1',
  restoredPaths,
  deletedPaths: ['src/cart/legacyTotals.ts'],
  skipped,
});

const meta = {
  component: CheckpointScrubberView,
  tags: ['vrt-themes'],
  args: {
    groups: FOUR_TURNS,
    onClose: fn(),
    onCompare: fn(),
    onRewind: fn(),
    onDismissReport: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-120 border border-line-soft">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CheckpointScrubberView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The board's Review strip: newest turn selected; the slider steps between stops. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('Turn 4 of 4')).toBeVisible();
    const slider = canvas.getByRole('slider', { name: 'Checkpoint' });
    slider.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(canvas.getByText('Turn 3 of 4')).toBeVisible();
    await expect(canvas.getByText(/Also cover the zero-discount case/)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Compare' }));
    await expect(args.onCompare).toHaveBeenCalledWith('turn:t3');
    slider.focus();
    await userEvent.keyboard('{Home}');
    await expect(canvas.getByText('Session start')).toBeVisible();
  },
};

/** A turn across two mounts: the confirm names both and restores both. */
export const ConfirmMultiMount: Story = {
  args: { groups: TWO_MOUNTS },
  play: async ({ canvas, args }) => {
    await expect(canvas.queryByRole('slider')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Rewind' }));
    await expect(canvas.getByText('Rewind api and web to before this turn?')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Rewind 2 sources' }));
    await expect(args.onRewind).toHaveBeenCalledWith(TWO_MOUNTS[0]);
  },
};

/** One mount: the confirm button says "Confirm rewind"; Cancel closes it. */
export const ConfirmSingleMount: Story = {
  args: { groups: REVIEW_TURN },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText(/Review: Keep d = 0, but assert on it/)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Rewind' }));
    await expect(canvas.getByRole('button', { name: 'Confirm rewind' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(canvas.queryByRole('button', { name: 'Confirm rewind' })).toBeNull();
    await expect(args.onRewind).not.toHaveBeenCalled();
  },
};

export const Loading: Story = {
  args: { groups: [], loading: true },
};

export const Empty: Story = {
  args: { groups: [] },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('No checkpoints yet.')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Close checkpoints' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

export const RewoundAll: Story = {
  args: {
    groups: TWO_MOUNTS,
    report: {
      group: TWO_MOUNTS[0]!,
      perMount: [
        { alias: 'api', result: restored(['src/order.ts']) },
        { alias: 'web', result: restored(['src/cart/total.ts', 'src/cart/view.tsx']) },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Rewound api and web');
  },
};

/** One mount failed, one skipped a symlink: both are named. */
export const RewoundPartly: Story = {
  args: {
    groups: TWO_MOUNTS,
    report: {
      group: TWO_MOUNTS[0]!,
      perMount: [
        { alias: 'api', result: restored(['src/order.ts'], [{ path: 'config/link.json', reason: 'symlink outside the workspace' }]) },
        { alias: 'web', error: 'The working tree changed while rewinding.' },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Rewound 1 of 2 sources');
    await expect(canvas.getByText(/api\/config\/link\.json/)).toBeVisible();
  },
};

export const RewindFailed: Story = {
  args: {
    groups: TWO_MOUNTS,
    report: {
      group: TWO_MOUNTS[0]!,
      perMount: [
        { alias: 'api', error: 'Checkpoint not found.' },
        { alias: 'web', error: 'Checkpoint not found.' },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('The rewind failed');
  },
};
