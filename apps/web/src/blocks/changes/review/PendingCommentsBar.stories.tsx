import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { PendingCommentsBar } from './PendingCommentsBar.js';

const meta = {
  component: PendingCommentsBar,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-115 border border-line-soft">
        <Story />
      </div>
    ),
  ],
  args: {
    pendingCount: 2,
    submittedCount: 0,
    addressedCount: 0,
    onReview: fn(),
    onDiscardAll: fn(),
  },
} satisfies Meta<typeof PendingCommentsBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One line over the diff: the count and Review & send, which opens the review dialog (D-164). */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('2 pending comments')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /Review & send/ }));
    await expect(args.onReview).toHaveBeenCalled();
  },
};

/** Sent comments: the agent is working on them, nothing to send. */
export const AwaitingAgent: Story = {
  args: { pendingCount: 0, submittedCount: 2, addressedCount: 1 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('2 awaiting agent')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /Review & send/ })).toBeNull();
  },
};

/** Nothing pending or sent: the bar is gone. */
export const Empty: Story = {
  args: { pendingCount: 0, submittedCount: 0, addressedCount: 0 },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-testid="pending-comments-bar"]')).toBeNull();
  },
};
