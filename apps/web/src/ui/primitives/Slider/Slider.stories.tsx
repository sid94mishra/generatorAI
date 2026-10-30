import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { Slider, type SliderProps } from './Slider.js';

const TURNS = [1, 2, 3, 4].map((turn) => ({ value: turn, label: `T${turn}` }));
const turnText = (value: number) => `Turn ${value} of 4`;

function Controlled(props: SliderProps) {
  const [value, setValue] = useState(typeof props.defaultValue === 'number' ? props.defaultValue : 0);
  return (
    <div className="flex w-96 flex-col gap-2">
      <Slider {...props} defaultValue={undefined} value={value} onValueChange={setValue} />
      <span className="text-small text-fg-3">value: {value}</span>
    </div>
  );
}

const meta = {
  component: Slider,
  tags: ['vrt-themes'],
  args: { label: 'Replay position', defaultValue: 30 },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Computer replay scrubber (20h, no ticks). */
export const Default: Story = {
  play: async ({ canvas }) => {
    const slider = canvas.getByRole('slider', { name: 'Replay position' });
    await expect(slider).toHaveAttribute('aria-valuenow', '30');
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(slider).toHaveAttribute('aria-valuenow', '31');
    await expect(canvas.getByText('value: 31')).toBeVisible();
  },
};

/** The Changes checkpoint scrubber: turn ticks and "Turn n of 4". */
export const CheckpointTicks: Story = {
  args: { label: 'Checkpoint', min: 1, max: 4, step: 1, defaultValue: 3, ticks: TURNS, getAriaValueText: turnText },
  play: async ({ canvas }) => {
    const slider = canvas.getByRole('slider', { name: 'Checkpoint' });
    await expect(slider).toHaveAttribute('aria-valuetext', 'Turn 3 of 4');
    slider.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(slider).toHaveAttribute('aria-valuetext', 'Turn 2 of 4');
  },
};

/** start / middle / end / ticks / disabled. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-4">
      <Slider label="At start" defaultValue={0} />
      <Slider label="Middle" defaultValue={50} />
      <Slider label="At end" defaultValue={100} />
      <Slider label="Turns" min={1} max={4} step={1} defaultValue={2} ticks={TURNS} getAriaValueText={turnText} />
      <Slider label="Disabled" defaultValue={40} disabled />
      <Slider label="Disabled with ticks" min={1} max={4} step={1} defaultValue={4} ticks={TURNS} disabled />
    </div>
  ),
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('slider', { name: 'Replay position' })).toHaveFocus();
  },
};

/** The 12px thumb sits in a 24×24 box, so the focusable input is 24×24. */
export const TargetSize: Story = {
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};

export const Compact: Story = { globals: { density: 'compact' }, render: Matrix.render };
