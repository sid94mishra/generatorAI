import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { Count } from '../Count/Count.js';
import { StatusDot } from '../StatusDot/StatusDot.js';
import { IconButton, type IconButtonSize } from './IconButton.js';

const SIZES: IconButtonSize[] = ['sm', 'md', 'lg'];

const meta = {
  component: IconButton,
  tags: ['vrt-themes'],
  args: { icon: 'more', label: 'More actions', onClick: fn() },
  argTypes: { size: { control: 'inline-radio', options: SIZES } },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'More actions' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

/** size × variant × state (Components board: `.ib`, `.ib-sm`, `.ib.on`, Send). */
export const Matrix: Story = {
  render: () => (
    <div className="grid grid-cols-6 items-center gap-3">
      {SIZES.map((size) => (
        <div key={size} className="contents">
          <span className="text-small text-fg-3">{size}</span>
          <IconButton size={size} icon="more" label="More" />
          <IconButton size={size} icon="dock" label="Toggle dock" pressed />
          <IconButton size={size} icon="copy" label="Copy" disabled />
          <IconButton size={size} icon="send" label="Send" variant="primary" />
          <IconButton size={size} icon="x" label="Close" />
        </div>
      ))}
    </div>
  ),
};

/** Rail counters: tone + a corner badge (dot ring or count bubble). */
export const WithBadge: Story = {
  render: () => (
    <div className="flex items-center gap-3 bg-ground p-2">
      <IconButton size="lg" icon="home" label="Home, something needs you" badge={<StatusDot tone="warn" ring />} />
      <IconButton size="lg" icon="hand" label="Needs you, 2" tone="warn" badge={<Count tone="warn" bubble>2</Count>} />
      <IconButton size="lg" icon="status-running" label="Running, 3" tone="run" badge={<Count tone="run" bubble>3</Count>} />
    </div>
  ),
};

export const Hover: Story = { parameters: { pseudo: { hover: true } }, render: Matrix.render };

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'More actions' })).toHaveFocus();
  },
};

export const Pressed: Story = {
  args: { icon: 'dock', label: 'Toggle dock', pressed: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Toggle dock' })).toHaveAttribute('aria-pressed', 'true');
  },
};

export const Disabled: Story = { args: { disabled: true } };

/** Per-row busy state: the Spinner replaces the glyph inside a status region. */
export const Loading: Story = {
  args: { icon: 'check', label: 'Keep src/app.ts', size: 'sm', loading: true, disabled: true },
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'Keep src/app.ts' });
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(within(button).getByRole('status')).toBeInTheDocument();
  },
};

/** Compact density draws sm at 20px; the hit area stays 24×24 (`data-gai-hit`). */
export const Compact: Story = {
  globals: { density: 'compact' },
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};
