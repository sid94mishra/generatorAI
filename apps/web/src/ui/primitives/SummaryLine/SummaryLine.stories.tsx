import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { DiffStat } from '../../patterns/DiffStat/DiffStat.js';
import { SummaryLine } from './SummaryLine.js';

const FAVICON =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="%23e2553c"/></svg>';

const meta = {
  component: SummaryLine,
  tags: ['vrt-themes'],
  args: { icon: 'changes', title: '3 files changed', detail: 'Not committed yet', onClick: fn() },
  decorators: [(Story) => <div className="w-72 bg-raised p-1.5">{Story()}</div>],
} satisfies Meta<typeof SummaryLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A line that opens a tab: one button, with a chevron. */
export const Opens: Story = {
  args: { trailing: <DiffStat added={42} removed={7} /> },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /3 files changed/ }));
    await expect(args.onClick).toHaveBeenCalled();
  },
};

/** A line that only says something: no button, no chevron. */
export const Static: Story = {
  args: { icon: 'branch', title: 'generatorai/git-cycle', mono: true, detail: 'pulse · from develop · Worktree', onClick: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull();
  },
};

/** A page: its favicon in place of the icon; a favicon that fails to load falls back to the icon. */
export const Favicon: Story = {
  render: (args) => (
    <div className="flex flex-col">
      <SummaryLine {...args} icon="browser" image={FAVICON} title="Example Domain" detail="example.com/docs" />
      <SummaryLine {...args} icon="browser" image="data:image/png;base64,broken" title="Broken icon" detail="example.org" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: /Example Domain/ }).querySelector('img')).not.toBeNull();
    await waitFor(() => expect(canvas.getByRole('button', { name: /Broken icon/ }).querySelector('img')).toBeNull());
  },
};

export const LongText: Story = {
  args: {
    title: 'A page title long enough to truncate on one line in a narrow card',
    detail: 'a-very-long-host-name.example.com/with/a/deep/path/that/truncates',
  },
};

/** A command: runs something rather than opening a view — no chevron. */
export const Command: Story = {
  args: { icon: 'terminal', title: 'Open a terminal', detail: undefined, chevron: false },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', { name: /Open a terminal/ });
    await expect(button.querySelectorAll('svg')).toHaveLength(1);
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalled();
  },
};

/** A custom glyph (an editor's mark) in place of the icon. */
export const CustomGlyph: Story = {
  args: {
    icon: 'file',
    glyph: <span className="size-3.5 rounded-badge bg-accent" />,
    title: 'Open in VS Code',
    detail: undefined,
    chevron: false,
  },
};
