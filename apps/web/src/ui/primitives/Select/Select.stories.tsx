import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Select, type SelectItem } from './Select.js';

const AGENTS: SelectItem[] = [
  { value: 'reviewer', label: 'Reviewer', meta: 'gpt' },
  { value: 'writer', label: 'Writer', meta: 'claude' },
  { value: 'planner', label: 'Planner', meta: 'claude', disabled: true },
];

function Controlled(props: { placeholder?: string; invalid?: boolean }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Select
      aria-label="Agent"
      items={AGENTS}
      value={value}
      onValueChange={setValue}
      placeholder={props.placeholder ?? 'Choose an agent'}
      invalid={props.invalid}
      className="w-56"
    />
  );
}

const meta = {
  component: Select,
  tags: ['vrt-themes'],
  args: { value: null, onValueChange: () => {}, items: AGENTS },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens the popup and picks an option. */
export const Default: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('combobox', { name: 'Agent' }));
    const option = await waitFor(() => within(document.body).getByRole('option', { name: /Writer/ }));
    await userEvent.click(option);
    await expect(canvas.getByRole('combobox', { name: 'Agent' })).toHaveTextContent('Writer');
  },
};

/** sm/md sizes, placeholder, invalid, disabled. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Select aria-label="Agent md" items={AGENTS} value="reviewer" onValueChange={() => {}} size="md" className="w-56" />
      <Select aria-label="Agent sm" items={AGENTS} value="reviewer" onValueChange={() => {}} size="sm" className="w-56" />
      <Select aria-label="Agent placeholder" items={AGENTS} value={null} onValueChange={() => {}} className="w-56" />
      <Select aria-label="Agent invalid" items={AGENTS} value={null} onValueChange={() => {}} invalid className="w-56" />
      <Select aria-label="Agent disabled" items={AGENTS} value="reviewer" onValueChange={() => {}} disabled className="w-56" />
    </div>
  ),
};
