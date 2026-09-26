import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import { Select, type SelectItem } from './Select.js';

const COMPARE: SelectItem[] = [
  { value: 'baseline', label: 'Since session start' },
  { value: 'ref:7be0d15', label: 'Branch base (main)', meta: '7be0d15' },
  { value: 'turn:t3', label: 'Also cover the zero-discount case · 14:02' },
  { value: 'turn:t2', label: 'Fix coupon/total race · 14:01' },
  { value: 'checkpoint:m1', label: 'Snapshot · 13:58', disabled: true },
];

const onValueChange = fn();

function Controlled({ initial = 'baseline', ...rest }: { initial?: string } & Partial<Parameters<typeof Select>[0]>) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <div className="w-64">
      <Select
        label="Compare against"
        items={COMPARE}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onValueChange(next);
        }}
        {...rest}
      />
    </div>
  );
}

const meta = {
  component: Select,
  args: { label: 'Compare against', items: COMPARE, value: 'baseline', onValueChange },
  render: (args) => <Controlled initial={args.value ?? 'baseline'} size={args.size} disabled={args.disabled} invalid={args.invalid} />,
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Medium: Story = {};

export const Small: Story = { args: { size: 'sm' } };

export const WithMeta: Story = { args: { value: 'ref:7be0d15' } };

export const Placeholder: Story = {
  render: () => (
    <div className="w-64">
      <Select label="Base branch" placeholder="Choose a branch" items={COMPARE} value={null} onValueChange={onValueChange} />
    </div>
  ),
};

export const Invalid: Story = { args: { invalid: true } };

export const Disabled: Story = { args: { disabled: true } };

/** Opens with the keyboard, lists every option, picks one. */
export const PickWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Compare against' });
    await expect(trigger).toHaveTextContent('Since session start');
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    const listbox = await screen.findByRole('listbox');
    await expect(within(listbox).getAllByRole('option')).toHaveLength(COMPARE.length);
    await userEvent.click(within(listbox).getByRole('option', { name: /Branch base/ }));
    await waitFor(() => expect(trigger).toHaveTextContent('Branch base (main)'));
    await expect(onValueChange).toHaveBeenLastCalledWith('ref:7be0d15');
  },
};
