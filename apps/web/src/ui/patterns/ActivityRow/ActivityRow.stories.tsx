import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { ActivityRow } from './ActivityRow.js';

const meta = {
  component: ActivityRow,
  tags: ['vrt-themes'],
  args: { status: 'running', title: 'Nightly dependency audit', context: 'agents-repo', time: '2m' },
} satisfies Meta<typeof ActivityRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Nightly dependency audit')).toBeInTheDocument();
  },
};

/** every status glyph, one-line and two-line (Home "Needs you") layouts. */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-120 flex-col rounded-card border border-line-soft">
      <ActivityRow status="needs_you" title="Approve plan" context="release-agent" detail="Waiting for your review" time="4m" actions={<IconButton icon="more" label="More" size="sm" />} />
      <ActivityRow status="running" title="Nightly dependency audit" context="agents-repo" detail="Updating 12 packages" time="2m" />
      <ActivityRow status="succeeded" title="Deploy staging" context="web-app" time="1h" />
      <ActivityRow status="failed" title="Migration check" context="db-service" time="3h" />
      <ActivityRow
        status="needs_you"
        title="Review pull request"
        context="release-agent"
        detail="3 files changed, waiting on your approval before it merges"
        time="6m"
        twoLine
        actions={<IconButton icon="more" label="More" size="sm" />}
      />
    </div>
  ),
};
