import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Skeleton, SkeletonRows } from './Skeleton.js';

const meta = {
  component: Skeleton,
  subcomponents: { SkeletonRows },
  tags: ['vrt-themes'],
  args: { width: 240 },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** line / meta / block. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-72 items-center gap-3">
      <Skeleton shape="block" className="size-6" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton width="70%" />
        <Skeleton shape="meta" width="35%" />
      </div>
    </div>
  ),
};

/** The loaded-row shape (Components board "Skeleton rows"); the container is busy. */
export const Rows: Story = {
  render: () => (
    <div className="w-120 rounded-card border border-line-soft">
      <SkeletonRows rows={3} label="Loading runs" />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status', { name: 'Loading runs' })).toHaveAttribute('aria-busy', 'true');
  },
};

export const Compact: Story = { globals: { density: 'compact' }, render: Rows.render };
