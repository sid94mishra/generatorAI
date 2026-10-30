import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Spinner } from './Spinner.js';

const meta = {
  component: Spinner,
  tags: ['vrt-themes'],
  args: { label: 'Loading', className: 'text-run' },
  argTypes: { size: { control: 'inline-radio', options: [12, 14, 16] } },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'Loading' })).toBeVisible();
  },
};

export const Matrix: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {([12, 14, 16] as const).map((size) => (
        <Spinner key={size} size={size} className="text-run" />
      ))}
      {([12, 14, 16] as const).map((size) => (
        <Spinner key={`fg-${size}`} size={size} className="text-fg-3" />
      ))}
    </div>
  ),
};

/** "Reduce motion": the glyph renders static. */
export const ReducedMotion: Story = { globals: { reduceMotion: 'on' } };
