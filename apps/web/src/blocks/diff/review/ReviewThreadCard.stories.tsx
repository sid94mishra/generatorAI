import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { ReviewComment, ReviewThread, ReviewThreadStatus } from '@/types/review.js';
import { ReviewThreadCard } from './ReviewThreadCard.js';

function comment(id: string, author: ReviewComment['author'], body: string, intent?: ReviewComment['intent']): ReviewComment {
  return { id, threadId: 't1', author, body, ...(intent ? { intent } : {}), createdAt: '', updatedAt: '' };
}

function thread(status: ReviewThreadStatus, comments: ReviewComment[], extra: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: `t-${status}`,
    workspaceId: 'ws-1',
    scope: 'chat',
    scopeId: 'chat-1',
    repoAlias: 'app',
    path: 'src/cart/applyCoupon.ts',
    baseCheckpointId: 'cp-1',
    headCheckpointId: 'cp-2',
    side: 'additions',
    startLine: 20,
    endLine: 20,
    anchorText: 'setTotals(recalculate(cart, discount));',
    anchorHash: 'h',
    status,
    reviewRound: 0,
    createdAt: '',
    updatedAt: '',
    comments,
    ...extra,
  };
}

const USER_COMMENT = comment(
  'c1',
  'user',
  'Keep d = 0, but assert on it in recalculate.test.ts so a missing coupon fails loudly.',
  'fix',
);

const meta = {
  component: ReviewThreadCard,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-120">
        <Story />
      </div>
    ),
  ],
  args: {
    thread: thread('pending', [USER_COMMENT]),
    onReply: fn(),
    onEdit: fn(),
    onResolve: fn(),
    onDelete: fn(),
    onSend: fn(),
  },
} satisfies Meta<typeof ReviewThreadCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Collapsed: a one-line marker on the code. The FIRST button toggles the thread. */
export const Collapsed: Story = {
  play: async ({ canvas }) => {
    const toggle = canvas.getAllByRole('button')[0]!;
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('button', { name: 'Resolve thread' })).toBeVisible();
  },
};

/** The board's inline card (DockChanges "Review"): Resolve, delete, body, Reply, Send. */
export const Expanded: Story = {
  args: { defaultExpanded: true },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await expect(args.onSend).toHaveBeenCalledWith('t-pending');
  },
};

/** A conversation: only the user's own words get an Edit button. */
export const WithReplies: Story = {
  args: {
    defaultExpanded: true,
    thread: thread(
      'addressed',
      [USER_COMMENT, comment('c2', 'agent', 'Added an assertion for d = 0 in recalculate.test.ts.'), comment('c3', 'user', 'Thanks — looks right.', 'note')],
      { reviewRound: 2, startLine: 18, endLine: 21 },
    ),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('button', { name: 'Edit comment' })).toHaveLength(2);
  },
};

/** Editing a comment: Mod+Enter or the check saves, Escape cancels. */
export const Editing: Story = {
  args: { defaultExpanded: true },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Edit comment' }));
    const box = canvas.getByRole('textbox', { name: 'Edit comment' });
    await waitFor(() => expect(box).toHaveFocus());
    await userEvent.type(box, ' Please.');
    await userEvent.click(canvas.getByRole('button', { name: 'Save edit' }));
    await expect(args.onEdit).toHaveBeenCalledWith('t-pending', 'c1', `${USER_COMMENT.body} Please.`);
  },
};

/** Replying opens a field; Escape closes it without posting. */
export const Replying: Story = {
  args: { defaultExpanded: true },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Reply' }));
    const box = canvas.getByRole('textbox', { name: 'Reply' });
    await userEvent.type(box, 'Also cover the zero-discount case.');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await expect(args.onReply).toHaveBeenCalledWith('t-pending', 'Also cover the zero-discount case.');
  },
};

/** Every thread status, collapsed (status words from the shared D-18 map). */
export const Statuses: Story = {
  render: (args) => (
    <div className="flex flex-col gap-1">
      {(['draft', 'pending', 'submitted', 'addressed', 'resolved', 'outdated'] as const).map((status) => (
        <ReviewThreadCard key={status} {...args} thread={thread(status, [USER_COMMENT])} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const word of ['Draft', 'Pending', 'Sent', 'Addressed', 'Resolved', 'Outdated']) {
      await expect(canvas.getByText(word)).toBeVisible();
    }
  },
};

/** Resolved: flatter surface, read-only (no Resolve, Reply, Send or Edit). */
export const Resolved: Story = {
  args: { defaultExpanded: true, thread: thread('resolved', [USER_COMMENT]) },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Resolve thread' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Reply' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Edit comment' })).toBeNull();
  },
};

/** Sending: the Send button spins and ignores clicks. */
export const Busy: Story = {
  args: { defaultExpanded: true, busy: true },
};
