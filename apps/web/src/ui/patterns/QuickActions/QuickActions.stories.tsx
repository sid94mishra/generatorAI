import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { QuickActions, type QuickAction } from './QuickActions.js';

const onNewChat = fn();

const actions: QuickAction[] = [
  { id: 'new-chat', icon: 'chats', title: 'New chat', description: 'Ask an agent to do something', shortcut: ['⌘', 'N'], onSelect: onNewChat },
  { id: 'run-workflow', icon: 'play', title: 'Run workflow', description: 'Start a saved workflow', onSelect: fn() },
  { id: 'new-workflow', icon: 'workflows', title: 'New workflow', description: 'Chain agents into stages', shortcut: ['⌘', '⇧', 'N'], onSelect: fn() },
  { id: 'new-agent', icon: 'agents', title: 'New agent', description: 'Reusable instructions and skills', onSelect: fn() },
];

const meta = {
  component: QuickActions,
  tags: ['vrt-themes'],
  args: { actions, label: 'Start' },
  decorators: [(Story) => <div className="w-180">{Story()}</div>],
} satisfies Meta<typeof QuickActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoColumns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('group', { name: 'Start' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /New chat/ }));
    await expect(onNewChat).toHaveBeenCalled();
  },
};

export const FourColumns: Story = { args: { columns: 4 } };

export const WithoutDescriptions: Story = {
  args: { actions: actions.map(({ description: _d, ...a }) => a), columns: 4 },
};
