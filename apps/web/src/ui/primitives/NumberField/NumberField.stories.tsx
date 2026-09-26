import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { NumberField } from './NumberField.js';

function Controlled(props: { initial?: number | null }) {
  const [value, setValue] = useState<number | null>(props.initial ?? 3);
  return <NumberField aria-label="Max attempts" min={0} max={10} value={value} onValueChange={setValue} />;
}

const meta = {
  component: NumberField,
  tags: ['vrt-themes'],
  // Every auto-rendered story (no `render` override, e.g. FocusVisible) needs a real
  // accessible name — the control has no visible label of its own.
  args: { 'aria-label': 'Value', defaultValue: 5 },
} satisfies Meta<typeof NumberField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The stepper buttons and the arrow keys both clamp to min/max. */
export const Default: Story = {
  render: () => <Controlled />,
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Max attempts' });
    await expect(input).toHaveValue('3');
    await userEvent.click(canvas.getByRole('button', { name: 'Increase' }));
    await expect(input).toHaveValue('4');
    await userEvent.click(canvas.getByRole('button', { name: 'Decrease' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Decrease' }));
    await expect(input).toHaveValue('2');
  },
};

/** sm/md × unit suffix × with/without steppers × invalid × disabled. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <NumberField aria-label="Delay (sm)" size="sm" defaultValue={30} unit="s" />
        <NumberField aria-label="Delay (md)" size="md" defaultValue={30} unit="s" />
      </div>
      <div className="flex items-center gap-3">
        <NumberField aria-label="Budget" defaultValue={5000} unit="tokens" min={0} step={100} />
        <NumberField aria-label="No steppers" defaultValue={4} steppers={false} />
      </div>
      <div className="flex items-center gap-3">
        <NumberField aria-label="Invalid retention" defaultValue={-1} min={0} invalid />
        <NumberField aria-label="Disabled retention" defaultValue={30} unit="days" disabled />
      </div>
    </div>
  ),
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('textbox')).toHaveFocus();
  },
};

/** The stepper chevrons keep a 24×24 target below their 10×16 visible box. */
export const TargetSize: Story = {
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};

export const Compact: Story = { globals: { density: 'compact' }, render: Matrix.render };
