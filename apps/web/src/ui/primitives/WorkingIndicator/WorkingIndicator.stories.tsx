import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { WorkingIndicator } from './WorkingIndicator.js';

const meta = {
  component: WorkingIndicator,
  tags: ['vrt-themes'],
  args: { 'aria-label': 'Generating' },
} satisfies Meta<typeof WorkingIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status', { name: 'Generating' })).toBeVisible();
  },
};

export const WithLabel: Story = {
  args: { label: 'Working · 3 steps' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Working · 3 steps')).toBeVisible();
  },
};

/** "Reduce motion": still dots and a muted label without the sweep. */
export const ReducedMotion: Story = { args: { label: 'Claude is thinking' }, globals: { reduceMotion: 'on' } };
