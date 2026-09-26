import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { Banner } from './Banner.js';

const meta = {
  component: Banner,
  tags: ['vrt-themes'],
  args: { tone: 'warn', lead: '3 need you', detail: 'Approve a plan, answer a question or review a change' },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => <Banner {...args} action={<Button size="sm">Review</Button>} className="w-140" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('3 need you')).toBeInTheDocument();
  },
};

/** every tone. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-140 flex-col gap-2">
      <Banner tone="info" lead="Syncing" detail="Fetching the latest commits" />
      <Banner tone="warn" lead="3 need you" detail="Approve a plan, answer a question or review a change" action={<Button size="sm">Review</Button>} />
      <Banner tone="err" lead="Fetch failed" detail="Could not reach the remote" action={<Button size="sm" variant="danger">Retry</Button>} />
      <Banner tone="ok" lead="Up to date" />
    </div>
  ),
};
