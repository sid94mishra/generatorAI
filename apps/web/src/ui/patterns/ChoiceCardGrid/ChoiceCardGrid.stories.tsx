import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { ChoiceCardGrid } from './ChoiceCardGrid.js';

const OPTIONS = [
  { value: 'you', icon: 'user' as const, title: 'You', description: 'Drive the chat yourself' },
  { value: 'agent', icon: 'agents' as const, title: 'An agent', description: 'Runs autonomously' },
  { value: 'team', icon: 'users' as const, title: 'A team', description: 'Orchestrates several agents' },
];

function Controlled() {
  const [value, setValue] = useState('you');
  return <ChoiceCardGrid label="Who works on this" value={value} onValueChange={setValue} options={OPTIONS} columns={3} className="w-140" />;
}

const meta = {
  component: ChoiceCardGrid,
  tags: ['vrt-themes'],
  args: { label: 'Who works on this', value: 'you', onValueChange: () => {}, options: OPTIONS },
} satisfies Meta<typeof ChoiceCardGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('An agent'));
    await expect(canvas.getByRole('radio', { name: /An agent/ })).toHaveAttribute('aria-checked', 'true');
  },
};

/** fixed grid-cols vs the flex-wrap even row. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <ChoiceCardGrid label="Grid of 3" value="you" onValueChange={() => {}} options={OPTIONS} columns={3} className="w-140" />
      <ChoiceCardGrid label="Even row" value="agent" onValueChange={() => {}} options={OPTIONS} className="w-140" />
    </div>
  ),
};
