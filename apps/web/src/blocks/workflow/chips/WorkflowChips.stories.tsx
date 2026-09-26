import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { KeyChip, RUN_TRIGGERS, TriggerChip, VersionChip } from './WorkflowChips.js';

const meta = {
  title: 'blocks/workflow/Chips',
  component: VersionChip,
  tags: ['vrt-themes'],
  args: { status: 'published', version: 7 },
} satisfies Meta<typeof VersionChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const All: Story = {
  render: () => (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <VersionChip status="published" version={7} />
        <VersionChip status="published" />
        <VersionChip status="draft" revision={13} />
        <VersionChip status="draft" />
      </div>
      <div className="flex items-center gap-2">
        <KeyChip stageKey="assess_risk" />
        <KeyChip stageKey="run_tests" outlined />
        <KeyChip stageKey="open_pr" outlined hint="from name" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {RUN_TRIGGERS.map((t) => (
          <TriggerChip key={t.kind} kind={t.kind} />
        ))}
        <TriggerChip kind={undefined} />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('v7')).toBeInTheDocument();
    await expect(canvas.getByText('rev 13')).toBeInTheDocument();
    await expect(canvas.getByText('assess_risk')).toBeInTheDocument();
    await expect(canvas.getAllByText('Manual')).toHaveLength(2);
  },
};
