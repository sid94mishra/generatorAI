import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ChangeFileRow, type ChangeFileRowProps } from './ChangeFileRow.js';

const FILE = { status: 'modified', additions: 14, deletions: 6, isBinary: false, isTooLarge: false } as const;

const meta = {
  component: ChangeFileRow,
  tags: ['vrt-themes'],
  args: {
    path: 'src/cart/applyCoupon.ts',
    alias: 'app',
    showAlias: false,
    displayPath: 'src/cart/applyCoupon.ts',
    file: FILE,
    height: 28,
    expanded: false,
    active: false,
    loading: false,
    kept: false,
    busy: false,
    confirmingUndo: false,
    commentCount: 0,
    onToggle: fn(),
    onKeep: fn(),
    onUnkeep: fn(),
    onOpenInEditor: fn(),
    onRequestUndo: fn(),
    onConfirmUndo: fn(),
    onCancelUndo: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-115 border border-line-soft">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChangeFileRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Collapsed modified file; actions appear on hover / focus. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByTitle('src/cart/applyCoupon.ts'));
    await expect(args.onToggle).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByTestId('keep-file'));
    await expect(args.onKeep).toHaveBeenCalledTimes(1);
    // Actions never toggle the row.
    await expect(args.onToggle).toHaveBeenCalledTimes(1);
  },
};

/** Every status letter (shared CHANGE_KIND: A ok · M warn · D err · R run). */
export const Statuses: Story = {
  render: (args) => (
    <div className="flex flex-col">
      {(
        [
          ['src/cart/recalculate.test.ts', { ...FILE, status: 'added', additions: 22, deletions: 0 }],
          ['src/cart/applyCoupon.ts', FILE],
          ['src/cart/legacyTotals.ts', { ...FILE, status: 'deleted', additions: 0, deletions: 19 }],
          ['src/cart/cartTotals.ts', { ...FILE, status: 'renamed', oldPath: 'totals.ts', additions: 1, deletions: 1 }],
          ['assets/logo.png', { ...FILE, status: 'added', isBinary: true }],
          ['data/big.json', { ...FILE, status: 'modified', isTooLarge: true }],
        ] as const
      ).map(([path, file]) => (
        <ChangeFileRow key={path} {...args} path={path} displayPath={path} file={file} />
      ))}
    </div>
  ),
  play: async ({ canvas }) => {
    // Two rows are added (a test file and a binary): every A carries the ok tone.
    for (const added of canvas.getAllByText('A')) await expect(added).toHaveClass('text-ok');
    await expect(canvas.getByText('D')).toHaveClass('text-err');
    await expect(canvas.getByText('R')).toHaveClass('text-run');
    await expect(canvas.getByRole('button', { name: 'Expand assets/logo.png' })).toBeDisabled();
    await expect(canvas.getByText('too large')).toBeInTheDocument();
  },
};

/** Expanded + active (the row the transcript focused), with a comment badge and the review Comment control. */
export const ActiveWithComments: Story = {
  args: { expanded: true, active: true, commentCount: 2, onComment: fn() } satisfies Partial<ChangeFileRowProps>,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Collapse src/cart/applyCoupon.ts' })).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByTitle('2 comments on this file')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Comment on src/cart/applyCoupon.ts' })).toBeEnabled();
  },
};

/** Several mounts: the alias prefixes the path. */
export const MultiMount: Story = {
  args: { showAlias: true, alias: 'api', displayPath: 'api/src/cart/applyCoupon.ts' },
  play: async ({ canvas }) => {
    await expect(canvas.getByTitle('api/src/cart/applyCoupon.ts')).toHaveTextContent('api/src/cart/applyCoupon.ts');
  },
};

/** Keep in flight: a spinner on this row only. */
export const Busy: Story = {
  args: { busy: true },
  play: async ({ canvas }) => {
    const keep = canvas.getByTestId('keep-file');
    await expect(keep).toBeDisabled();
    await expect(within(keep).getByRole('status')).toBeInTheDocument();
  },
};

/** A kept row offers Unkeep instead of Keep, always visible. */
export const Kept: Story = {
  args: { kept: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('unkeep-file')).toBeInTheDocument();
    await expect(canvas.queryByTestId('keep-file')).toBeNull();
  },
};

/** Undo asks inline first. */
export const ConfirmUndo: Story = {
  args: { confirmingUndo: true },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByTestId('confirm-undo-file'));
    await expect(args.onConfirmUndo).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(args.onCancelUndo).toHaveBeenCalledTimes(1);
  },
};

/** No editor and no base to restore from: Open in editor and Undo are not offered. */
export const NoEditorNoBase: Story = {
  args: { onOpenInEditor: undefined, onRequestUndo: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId('open-file-in-editor')).toBeNull();
    await expect(canvas.queryByTestId('undo-file')).toBeNull();
  },
};
