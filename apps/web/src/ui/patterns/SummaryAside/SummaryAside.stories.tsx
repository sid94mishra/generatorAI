import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { SummaryAside } from './SummaryAside.js';

const meta = {
  component: SummaryAside,
  tags: ['vrt-themes'],
  args: { sections: [] },
} satisfies Meta<typeof SummaryAside>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <SummaryAside
      hint="3 sections"
      sections={[
        { label: 'Who works', content: 'An agent' },
        { label: 'Model', content: 'claude-opus-5' },
        { label: 'Sources', content: '2 codebases' },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Summary')).toBeInTheDocument();
  },
};

export const Matrix: Story = {
  render: () => (
    <div className="flex gap-6">
      <SummaryAside
        title="Summary"
        hint="Draft"
        sections={[
          { label: 'Agent', content: 'reviewer-01' },
          { label: 'Budget', content: <span className="font-mono">200K tokens</span> },
        ]}
      />
    </div>
  ),
};
