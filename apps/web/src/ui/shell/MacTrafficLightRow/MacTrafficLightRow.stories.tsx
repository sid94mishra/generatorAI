import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { MacTrafficLightRow } from './MacTrafficLightRow.js';

/** The 44px macOS drag row; the OS paints the traffic lights over its left end. */
const meta = {
  component: MacTrafficLightRow,
  tags: ['vrt-themes'],
  decorators: [(Story) => <div className="w-58 bg-ground px-2">{Story()}</div>],
} satisfies Meta<typeof MacTrafficLightRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty; a drag region only under the desktop's `.titlebar-inset` chrome. */
export const Default: Story = {
  args: { 'aria-hidden': true },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector('[data-drag-region="mac"]');
    await expect(row).not.toBeNull();
    await expect(row?.getBoundingClientRect().height).toBe(44);
  },
};

/** With the "Restart to update" pill right-aligned (P3-06 wires it). */
export const WithUpdatePill: Story = {
  args: {
    children: (
      <Button size="sm" icon="download" className="bg-run-bg text-run">
        Restart to update
      </Button>
    ),
  },
};
