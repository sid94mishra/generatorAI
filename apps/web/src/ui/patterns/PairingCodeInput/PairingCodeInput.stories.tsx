import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { PairingCodeInput } from './PairingCodeInput.js';

function Controlled() {
  const [value, setValue] = useState('');
  return <PairingCodeInput value={value} onValueChange={setValue} />;
}

const meta = {
  component: PairingCodeInput,
  tags: ['vrt-themes'],
  args: { value: '', onValueChange: () => {} },
} satisfies Meta<typeof PairingCodeInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Typing fills each cell in order; the group has one accessible name. */
export const Default: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('group', { name: 'Pairing code' })).toBeInTheDocument();
    const inputs = canvas.getAllByRole('textbox');
    await userEvent.type(inputs[0]!, '4H7K2M9PXQ3T');
    await expect(inputs[11]).toHaveValue('T');
  },
};

/** default, invalid (Field wraps the error line) and read-only (a generated code on display). */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <PairingCodeInput value="4H7K2M9PXQ3T" onValueChange={() => {}} />
      <PairingCodeInput value="4H7K" onValueChange={() => {}} invalid />
      <PairingCodeInput value="4H7K2M9PXQ3T" onValueChange={() => {}} readOnly />
    </div>
  ),
};

/** Read-only: the code shows in every cell and typing does not change it. */
export const ReadOnly: Story = {
  render: () => <PairingCodeInput value="4H7K2M9PXQ3T" onValueChange={() => {}} readOnly />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const inputs = canvas.getAllByRole('textbox');
    await expect(inputs[0]).toHaveValue('4');
    await userEvent.type(inputs[0]!, 'Z');
    await expect(inputs[0]).toHaveValue('4');
    await expect(inputs[11]).toHaveValue('T');
  },
};
