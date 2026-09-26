import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { NarrowDockSheet } from './NarrowDockSheet.js';

// Fixed demo frame (story scaffolding, D-45): the main card of an 1100px window.
const FRAME = 'relative h-[600px] w-[860px] overflow-hidden rounded-panel border border-line-soft bg-surface';

/** S-09: the dock below a 1200px window — a non-modal 380px sheet inside the main card. */
const meta = {
  component: NarrowDockSheet,
  tags: ['vrt-themes'],
  parameters: { layout: 'centered' },
  args: { active: true },
  render: (args) => (
    <div className={FRAME}>
      <div className="p-7 text-body text-fg-2">The chat keeps a 404px gutter beside the sheet.</div>
      <NarrowDockSheet {...args} className={`flex flex-col ${args.className ?? ""}`} data-testid="dock-sheet">
        <div className="flex h-bar items-center border-b border-line-soft px-3 text-ui text-fg">Changes</div>
        <div className="p-4 text-ui text-fg-2">Dock body</div>
      </NarrowDockSheet>
    </div>
  ),
} satisfies Meta<typeof NarrowDockSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sheet mode: role dialog without aria-modal, `data-gai-overlay="sheet"`, 380 wide. */
export const Active: Story = {
  play: async ({ canvas }) => {
    const sheet = canvas.getByTestId('dock-sheet');
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(sheet).toHaveAccessibleName('Side pane');
    await expect(sheet).toHaveAttribute('data-gai-overlay', 'sheet');
    await expect(sheet).not.toHaveAttribute('aria-modal');
    await expect(Math.round(sheet.getBoundingClientRect().width)).toBe(380);
  },
};

/** Viewport < 768: the whole host width. */
export const FullWidth: Story = {
  args: { fullWidth: true },
};

/** Collapsed (dock closed): visibility hidden and inert, still in the DOM. */
export const Closed: Story = {
  args: { open: false },
  play: async ({ canvas }) => {
    const sheet = canvas.getByTestId('dock-sheet');
    await expect(getComputedStyle(sheet).visibility).toBe('hidden');
    await expect(sheet).toHaveAttribute('inert');
  },
};

/** Inactive (window ≥ 1200): a plain surface, no dialog semantics; DockFrame places it. */
export const Inactive: Story = {
  args: { active: false, className: 'absolute inset-y-0 right-0 w-dock border-l border-line-soft bg-surface' },
  play: async ({ canvas }) => {
    const surface = canvas.getByTestId('dock-sheet');
    await expect(surface).not.toHaveAttribute('role');
    await expect(surface).not.toHaveAttribute('data-gai-overlay');
  },
};
