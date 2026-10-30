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

/**
 * The cells share their container's width (`@container/code`): a 360-wide
 * phone gate (256), a 390-wide one (288), the desktop gate (364), a wide
 * column (560) — and the read-only code in a narrow settings row. No width
 * may overflow its container.
 */
export const Widths: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {['w-64', 'w-72', 'w-91', 'w-140'].map((width) => (
        <div key={width} data-testid={`code-width-${width}`} className={`${width} border border-dashed border-line p-0`}>
          <PairingCodeInput value="4H7K2M9PXQ3T" onValueChange={() => {}} />
        </div>
      ))}
      <div data-testid="code-width-readonly" className="flex w-64 items-center gap-2 border border-dashed border-line">
        <PairingCodeInput value="4H7K2M9PXQ3T" onValueChange={() => {}} readOnly className="flex-1" />
        <span className="shrink-0 text-small text-fg-3">copy</span>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const boxes = canvasElement.querySelectorAll<HTMLElement>('[data-testid^="code-width-"]');
    await expect(boxes.length).toBe(5);
    for (const box of boxes) {
      const group = within(box).getByRole('group', { name: 'Pairing code' });
      const boxRect = box.getBoundingClientRect();
      const inputs = within(box).getAllByRole('textbox');
      const last = inputs[inputs.length - 1]!.getBoundingClientRect();
      // Every cell sits inside the container, and nothing scrolls sideways.
      await expect(last.right).toBeLessThanOrEqual(boxRect.right + 0.5);
      await expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth + 1);
    }
  },
};
