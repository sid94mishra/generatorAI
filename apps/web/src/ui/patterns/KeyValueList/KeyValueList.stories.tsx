import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { KeyValueList } from './KeyValueList.js';

const meta = {
  component: KeyValueList,
  tags: ['vrt-themes'],
  args: {
    items: [
      { label: 'Status', value: 'Running' },
      { label: 'Started', value: '2m ago', mono: true },
      { label: 'Worktree', value: '/tmp/wt-4f2', mono: true, meta: '1.2 GB' },
    ],
  },
} satisfies Meta<typeof KeyValueList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => <KeyValueList {...args} className="w-80" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Running')).toBeInTheDocument();
  },
};

/** default vs dense rows, and different label-column widths. */
export const Matrix: Story = {
  render: () => (
    <div className="flex gap-8">
      <KeyValueList
        className="w-72"
        labelWidth={92}
        items={[
          { label: 'Server', value: 'GeneratorAI', mono: true },
          { label: 'Platform', value: 'macOS 15.2' },
        ]}
      />
      <KeyValueList
        dense
        className="w-72"
        labelWidth={110}
        items={[
          { label: 'Agent stage', value: 'reviewer' },
          { label: 'Attempts', value: '2 of 3', mono: true },
        ]}
      />
    </div>
  ),
};
