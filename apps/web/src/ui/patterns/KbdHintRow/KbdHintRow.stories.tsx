import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { KbdHintRow, KbdHintStatus } from './KbdHintRow.js';

const HINTS = [
  { keys: '↵', label: 'Send' },
  { keys: ['Shift', '↵'], label: 'New line' },
  { keys: '/', label: 'Commands' },
  { keys: '@', label: 'Mention' },
];

const meta = {
  component: KbdHintRow,
  tags: ['vrt-themes'],
  args: { hints: HINTS },
  decorators: [(Story) => <div className="w-150">{Story()}</div>],
} satisfies Meta<typeof KbdHintRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { end: <KbdHintStatus tone="ok">Connected</KbdHintStatus> },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Send')).toBeVisible();
    await expect(canvas.getByText('Shift ↵')).toBeVisible();
    await expect(canvas.getByText('Connected')).toBeVisible();
  },
};

/** row (gap 14) · box (gap 12, inside a bordered footer) · with and without a status. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <KbdHintRow hints={HINTS} />
      <KbdHintRow hints={HINTS} end={<KbdHintStatus tone="run">Agent is working</KbdHintStatus>} />
      <div className="rounded-card border border-line bg-raised px-3 py-2">
        <KbdHintRow
          variant="box"
          hints={[
            { keys: '↑', label: 'Previous' },
            { keys: '↓', label: 'Next' },
            { keys: 'Esc', label: 'Close' },
          ]}
        />
      </div>
      <KbdHintRow hints={HINTS.slice(0, 2)} end={<KbdHintStatus tone="err">Disconnected</KbdHintStatus>} />
    </div>
  ),
};

export const Compact: Story = { globals: { density: 'compact' }, render: Matrix.render };

/** Purely descriptive: nothing in the row takes focus. */
export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(canvasElement.contains(document.activeElement)).toBe(false);
  },
};
