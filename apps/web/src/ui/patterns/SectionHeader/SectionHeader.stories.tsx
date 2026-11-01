import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { SectionHeader } from './SectionHeader.js';

const meta = {
  component: SectionHeader,
  tags: ['vrt-themes'],
  args: { title: 'Needs you', count: 2 },
  decorators: [(Story) => <div className="w-100">{Story()}</div>],
} satisfies Meta<typeof SectionHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { action: <Button size="sm" variant="ghost">View all</Button> },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Needs you' })).toBeVisible();
  },
};

/** label · title · form. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="w-58 bg-ground p-2">
        <SectionHeader variant="label" title="Needs you" count={2} countTone="warn" />
        <SectionHeader variant="label" title="Running" count={3} />
      </div>
      <SectionHeader title="Recently finished" count={12} action={<Button size="sm" variant="ghost">View all</Button>} />
      <SectionHeader title="Paired devices" hint="Devices that can reach this server" />
      <SectionHeader variant="form" title="Schedule" hint="Times are in your time zone" />
    </div>
  ),
};

export const Compact: Story = { globals: { density: 'compact' }, render: Matrix.render };

/** A flush label lines up with content that starts at the edge; a long hint wraps under the title instead of truncating. */
export const FlushAndLongHint: Story = {
  render: () => (
    <div className="flex w-120 flex-col gap-3">
      <div>
        <SectionHeader variant="label" flush title="Experimental providers" />
        <p className="text-small text-fg-3">Content that starts at the edge, like the caption above it.</p>
      </div>
      <SectionHeader
        title="Accounts"
        hint="Used to push branches and open pull requests. The account for a repository is picked by matching its remote host."
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/matching its remote host\./)).toBeVisible();
  },
};
