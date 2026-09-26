import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { STATUS_STATES, resolveStatus } from '@generatorai/shared';
import { StatusBadge } from './StatusBadge.js';

const meta = {
  component: StatusBadge,
  tags: ['vrt-themes'],
  args: { state: 'running' },
  argTypes: {
    state: { control: 'select', options: STATUS_STATES },
    context: { control: 'inline-radio', options: ['run', 'chat'] },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The 8 visual states (D-18): glyph + word, never colour alone. */
export const Matrix: Story = {
  render: () => (
    <div className="flex max-w-80 flex-wrap gap-1.5">
      {STATUS_STATES.map((state) => (
        <StatusBadge key={state} state={state} />
      ))}
    </div>
  ),
  play: async ({ canvas }) => {
    for (const word of ['Queued', 'Running', 'Waiting', 'Needs you', 'Paused', 'Succeeded', 'Failed', 'Skipped']) {
      await expect(canvas.getByText(word)).toBeVisible();
    }
  },
};

/** Chats say "Done"; runs say "Succeeded". */
export const ChatContext: Story = {
  args: { state: 'succeeded', context: 'chat' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Done')).toBeVisible();
  },
};

/** A running sub-phase and a mapped label from the shared status map. */
export const PhaseAndLabel: Story = {
  render: () => {
    const cancelled = resolveStatus('workflowRun', 'cancelled');
    return (
      <div className="flex gap-1.5">
        <StatusBadge state="running" phase="Finalizing" />
        {cancelled ? <StatusBadge state={cancelled.state} label={cancelled.label} /> : null}
        <StatusBadge state="needs_you" label="Needs review" />
      </div>
    );
  },
};

/** Under "Reduce motion" the Running glyph stops. */
export const ReducedMotion: Story = { globals: { reduceMotion: 'on' } };
