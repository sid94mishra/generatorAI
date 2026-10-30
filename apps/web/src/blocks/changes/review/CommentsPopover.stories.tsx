import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import type { ReviewThread, ReviewThreadStatus } from '@/types/review.js';
import { CommentsPopover, type CommentsPopoverProps } from './CommentsPopover.js';

function thread(id: string, status: ReviewThreadStatus, path: string, body: string, lines: [number, number]): ReviewThread {
  return {
    id,
    workspaceId: 'ws-1',
    scope: 'chat',
    scopeId: 'chat-1',
    repoAlias: 'app',
    path,
    baseCheckpointId: 'cp-1',
    headCheckpointId: 'cp-2',
    side: 'additions',
    startLine: lines[0],
    endLine: lines[1],
    anchorText: '',
    anchorHash: 'h',
    status,
    reviewRound: 0,
    createdAt: '',
    updatedAt: '',
    comments: [{ id: `${id}-c1`, threadId: id, author: 'user', body, intent: 'fix', createdAt: '', updatedAt: '' }],
  };
}

const THREADS: ReviewThread[] = [
  thread('t1', 'pending', 'src/cart/applyCoupon.ts', 'Keep d = 0, but assert on it in recalculate.test.ts.', [20, 20]),
  thread('t2', 'draft', 'src/cart/cartTotals.ts', 'Derive the total from the coupon response.', [12, 18]),
  thread('t3', 'submitted', 'tests/checkout.spec.ts', 'Cover the zero-discount case.', [4, 4]),
];

/** Controlled like the Changes toolbar holds it. */
function Harness(props: Omit<CommentsPopoverProps, 'open' | 'onOpenChange'> & { defaultOpen?: boolean }) {
  const { defaultOpen = false, ...rest } = props;
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex min-h-100 w-110 justify-end">
      <CommentsPopover {...rest} open={open} onOpenChange={setOpen} />
    </div>
  );
}

const meta = {
  component: CommentsPopover,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  args: {
    threads: THREADS,
    open: false,
    onOpenChange: fn(),
    onJump: fn(),
    onSendOne: fn(),
    onSendAll: fn(),
    onDelete: fn(),
  },
  render: ({ open: _open, onOpenChange: _onOpenChange, ...args }) => <Harness {...args} />,
} satisfies Meta<typeof CommentsPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Toolbar count → list; "Send N to chat" sends only the threads still waiting (pending + draft). */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Comments (3)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Comments (3)' });
    await expect(document.querySelector('[data-gai-overlay="popover"]')).not.toBeNull();
    // Rows always name the file `<alias>/<path>`.
    await userEvent.click(within(dialog).getByRole('button', { name: /^app\/src\/cart\/cartTotals\.ts/ }));
    await expect(args.onJump).toHaveBeenCalledWith(THREADS[1]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send 2 to chat' }));
    await expect(args.onSendAll).toHaveBeenCalled();
    // Only pending/draft rows can be sent one by one.
    await expect(within(dialog).getAllByRole('button', { name: 'Send this comment to the agent' })).toHaveLength(2);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};

/** Opened for the visual baseline. */
export const Open: Story = {
  render: ({ open: _open, onOpenChange: _onOpenChange, ...args }) => <Harness {...args} defaultOpen />,
};

/** No comments yet: explains how to add one. */
export const Empty: Story = {
  args: { threads: [] },
  render: ({ open: _open, onOpenChange: _onOpenChange, ...args }) => <Harness {...args} defaultOpen />,
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Comments' });
    await expect(within(dialog).getByText(/Select lines in the diff/)).toBeVisible();
    await expect(within(dialog).queryByRole('button', { name: /to chat/ })).toBeNull();
  },
};
