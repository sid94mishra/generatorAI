import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { ProgressBar } from './ProgressBar.js';

const meta = {
  component: ProgressBar,
  tags: ['vrt-themes'],
  args: { label: 'Uploading', value: 62 },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('62%')).toBeInTheDocument();
  },
};

/** progress (run fill) vs meter (neutral / warn / err thresholds), block and inline. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-4">
      <ProgressBar label="Cloning" value={62} kind="progress" />
      <ProgressBar label="Working" value={null} kind="progress" />
      <ProgressBar label="Disk" value={40} kind="meter" />
      <ProgressBar label="Disk" value={88} kind="meter" />
      <ProgressBar label="Disk" value={97} kind="meter" />
      <div className="flex items-center gap-2">
        <span className="text-small text-fg-2">Run budget</span>
        <ProgressBar label="Run budget" value={30} kind="progress" size="inline" />
      </div>
    </div>
  ),
};
