import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { StatStrip } from './StatStrip.js';

const meta = {
  component: StatStrip,
  tags: ['vrt-themes'],
  args: {
    items: [
      { value: 3, label: 'Needs you', tone: 'warn' },
      { value: 5, label: 'Running', tone: 'run' },
      { value: 42, label: 'Succeeded today' },
    ],
  },
} satisfies Meta<typeof StatStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => <StatStrip {...args} className="w-96" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Needs you')).toBeInTheDocument();
  },
};

/** strip layout (Workflows) vs the Home "This week" 2×2 grid, with a linked tile. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <StatStrip
        className="w-96"
        items={[
          { value: 3, label: 'Needs you', tone: 'warn' },
          { value: 5, label: 'Running', tone: 'run' },
          { value: 42, label: 'Succeeded today' },
        ]}
      />
      <StatStrip
        className="w-56"
        layout="grid"
        items={[
          { value: 12, label: 'Chats' },
          { value: 4, label: 'Runs' },
          { value: '2h 14m', label: 'Agent time', numeric: false },
          { value: 1, label: 'Failures', tone: 'err', href: '#' },
        ]}
      />
    </div>
  ),
};
