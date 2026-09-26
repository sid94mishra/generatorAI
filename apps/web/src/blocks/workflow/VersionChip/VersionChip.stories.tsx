import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DraftChip, LiveChip, VersionChip } from './VersionChip.js';

const meta = {
  component: VersionChip,
  args: { version: 7 },
} satisfies Meta<typeof VersionChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <VersionChip version={7} />
      <VersionChip version={7} hasUnpublishedChanges />
      <DraftChip />
      <DraftChip revision={13} />
      <LiveChip />
    </div>
  ),
};

export const Clickable: Story = {
  args: { version: 7, onClick: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Published/ }));
    await expect(args.onClick).toHaveBeenCalled();
  },
};
