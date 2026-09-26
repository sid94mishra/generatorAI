import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { RadioGroup } from '../RadioGroup/RadioGroup.js';
import { RadioCard } from './RadioCard.js';

function Controlled() {
  const [value, setValue] = useState('you');
  return (
    <RadioGroup aria-label="Who works on this" value={value} onValueChange={(next) => setValue(next as string)} orientation="horizontal">
      <RadioCard value="you" icon="user" title="You" description="Drive the chat yourself" className="w-44" />
      <RadioCard value="agent" icon="agents" title="An agent" description="Runs autonomously" className="w-44" />
      <RadioCard value="team" icon="users" title="A team" description="Orchestrates several agents" className="w-44" />
    </RadioGroup>
  );
}

const meta = {
  component: RadioCard,
  tags: ['vrt-themes'],
  args: { value: 'you', title: 'You' },
} satisfies Meta<typeof RadioCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Clicking a card selects it (ChatCreate "Who works" grid). */
export const Default: Story = {
  render: () => <Controlled />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText('An agent'));
    await expect(canvas.getByRole('radio', { name: /An agent/ })).toHaveAttribute('aria-checked', 'true');
  },
};

/** card variant (default) and the tile variant (SettingsAppearance theme picker, P6). */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <RadioGroup aria-label="Card variant" value="you" onValueChange={() => {}} orientation="horizontal">
        <RadioCard value="you" icon="user" title="You" description="Drive the chat yourself" className="w-44" />
        <RadioCard value="agent" icon="agents" title="An agent" description="Runs autonomously" disabled className="w-44" />
      </RadioGroup>
      <RadioGroup aria-label="Tile variant" value="instrument" onValueChange={() => {}} orientation="horizontal">
        <RadioCard value="instrument" title="Instrument" variant="tile" preview={<div className="size-full bg-ground" />} className="w-28" />
        <RadioCard value="rose-pine" title="Rosé Pine" variant="tile" preview={<div className="size-full bg-raised" />} className="w-28" />
      </RadioGroup>
    </div>
  ),
};
