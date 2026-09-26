import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { DiffStat } from './DiffStat.js';

const meta = {
  component: DiffStat,
  tags: ['vrt-themes'],
  args: { added: 14, removed: 6 },
} satisfies Meta<typeof DiffStat>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `+14 −6` with a real minus sign (U+2212); screen readers hear words, not glyphs. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('+14')).toHaveClass('text-ok');
    await expect(canvas.getByText('−6')).toHaveClass('text-err');
    await expect(canvas.queryByText('-6')).toBeNull();
    await expect(canvas.getByText('14 added, 6 removed')).toBeInTheDocument();
  },
};

/** known · with files · zero (shown, not hidden) · only one side known · unknown (em dash) · unknown + files. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <DiffStat added={14} removed={6} />
      <DiffStat added={128} removed={37} files={5} />
      <DiffStat added={0} removed={0} files={1} />
      <DiffStat added={3} />
      <DiffStat />
      <DiffStat files={2} />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('+0')).toBeVisible();
    await expect(canvas.getByText('−0')).toBeVisible();
    await expect(canvas.getByText('5 files')).toBeVisible();
    await expect(canvas.getAllByText('—')).toHaveLength(2);
    await expect(canvas.getAllByText(/^Changes unknown/)).toHaveLength(2);
  },
};

/** Text only: nothing takes focus. */
export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(canvasElement.contains(document.activeElement)).toBe(false);
  },
};
