import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ActionTile } from './ActionTile.js';

const meta = {
  component: ActionTile,
  tags: ['vrt-themes'],
  args: { icon: 'chats', title: 'New chat', description: 'Ask an agent to work on something', onClick: fn() },
  decorators: [(Story) => <div className="w-90">{Story()}</div>],
} satisfies Meta<typeof ActionTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /New chat/ }));
    await expect(args.onClick).toHaveBeenCalled();
  },
};

export const WithShortcut: Story = { args: { shortcut: ['⌘', 'N'] } };

export const TitleOnly: Story = { args: { description: undefined, icon: 'workflows', title: 'New workflow' } };

export const LongText: Story = {
  args: {
    title: 'Run a workflow that has a very long name indeed',
    description: 'A description long enough to truncate on one line instead of wrapping under the icon',
    shortcut: ['⌘', '⇧', 'N'],
  },
};
