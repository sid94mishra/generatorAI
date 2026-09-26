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
    pendingCount: 1,
    submittedCount: 0,
    addressedCount: 0,
    onSendAll: fn(),
    onPreview: fn(),
    onDiscardAll: fn(),
  },
} satisfies Meta<typeof PendingCommentsBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The board's bar (DockChanges "Review"): 1 pending comment · Note · Preview · trash · Send all. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('1 pending comment')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Send all' }));
    await expect(args.onSendAll).toHaveBeenCalledWith('');
  },
};

/** Note adds an extra instruction that rides along with Preview and Send all. */
export const WithNote: Story = {
  args: { pendingCount: 2 },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Note' }));
    await expect(canvas.getByRole('button', { name: 'Note' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(canvas.getByRole('textbox', { name: 'Extra instruction for the agent' }), 'Keep it brief');
    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }));
    await expect(args.onPreview).toHaveBeenCalledWith('Keep it brief');
  },
};

/** Pending, awaiting the agent and addressed threads at once. */
export const Mixed: Story = {
  args: { pendingCount: 2, submittedCount: 1, addressedCount: 1 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('2 pending comments')).toBeVisible();
    await expect(canvas.getByText('1 awaiting agent')).toBeVisible();
    await expect(canvas.getByText('1 addressed')).toBeVisible();
  },
};

/** Nothing pending: status only, no actions. */
export const AwaitingOnly: Story = {
  args: { pendingCount: 0, submittedCount: 3, addressedCount: 2 },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Send all' })).toBeNull();
  },
};

/** No chat to send to: Send all is disabled and the reason is on screen. */
export const NoTarget: Story = {
  args: { pendingCount: 2, onSendAll: undefined, disabledReason: 'No chat to send to' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Send all' })).toBeDisabled();
    await expect(canvas.getByText('No chat to send to')).toBeVisible();
  },
};

/** Sending: Send all spins and ignores clicks. */
export const Busy: Story = {
  args: { busy: true },
};
