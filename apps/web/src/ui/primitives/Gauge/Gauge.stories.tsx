import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { Gauge } from './Gauge.js';

const meta = {
  component: Gauge,
  tags: ['vrt-themes'],
  args: { value: 42, label: 'Context window', showLabel: true },
  argTypes: {
    size: { control: 'inline-radio', options: [14, 16] },
    tone: { control: 'inline-radio', options: [undefined, 'warn', 'err'] },
  },
} satisfies Meta<typeof Gauge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const meter = canvas.getByRole('meter', { name: 'Context window' });
    await expect(meter).toHaveAttribute('aria-valuenow', '42');
    await expect(meter).toHaveAttribute('aria-valuemax', '100');
    await expect(meter.getAttribute('aria-valuetext')).toMatch(/42/);
  },
};

/** value × tone × size, with and without the percentage. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-fg-2">
      {([14, 16] as const).map((size) => (
        <div key={size} className="flex items-center gap-4">
          <Gauge size={size} value={0} label={`Empty ${size}`} showLabel />
          <Gauge size={size} value={42} label={`Used ${size}`} showLabel />
          <Gauge size={size} value={81} tone="warn" label={`Warn ${size}`} showLabel />
          <Gauge size={size} value={96} tone="err" label={`Err ${size}`} showLabel />
          <Gauge size={size} value={100} tone="err" label={`Full ${size}`} />
          <Gauge size={size} value={120} max={100} label={`Clamped ${size}`} />
        </div>
      ))}
    </div>
  ),
};

/** The usual host: a ghost sm Button (the Popover belongs to the consumer). */
export const InButton: Story = {
  render: () => (
    <Button variant="ghost" size="sm" aria-label="Context usage 64%">
      <Gauge value={64} label="Context window" showLabel />
    </Button>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('meter', { name: 'Context window' })).toBeInTheDocument();
  },
};

/** A meter is not focusable: Tab reaches the host button instead. */
export const FocusVisible: Story = {
  render: InButton.render,
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Context usage 64%' })).toHaveFocus();
  },
};
