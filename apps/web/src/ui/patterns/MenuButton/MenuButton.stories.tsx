import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { MenuButton, type MenuButtonItem } from './MenuButton.js';

const onRename = fn();
const onPrimary = fn();

const ITEMS: MenuButtonItem[] = [
  { type: 'label', label: 'Fix flaky checkout test' },
  { id: 'rename', label: 'Rename', icon: 'edit', shortcut: ['F2'], onSelect: onRename },
  { id: 'pin', label: 'Pin to sidebar', icon: 'pin', onSelect: () => undefined },
  { id: 'archive', label: 'Archive', icon: 'archive', shortcut: ['E'], onSelect: () => undefined },
  { type: 'separator' },
  { id: 'delete', label: 'Delete…', icon: 'trash', danger: true, onSelect: () => undefined },
];

const meta = {
  component: MenuButton,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  args: { label: 'Actions', items: ITEMS },
  decorators: [(Story) => <div className="min-h-80">{Story()}</div>],
} satisfies Meta<typeof MenuButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Button + chevron; the menu is a D-19 overlay and runs the item's onSelect. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Actions' });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    await expect(onRename).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  },
};

/** Row "More" menus: icon-only trigger. */
export const IconOnly: Story = {
  args: { label: 'More actions', iconOnly: true, icon: 'more' },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'More actions' }));
    await screen.findByRole('menu');
    await expect(document.querySelector('[data-gai-overlay="menu"]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  },
};

/** Split: the main part acts, the chevron opens the menu (Pause · drain / interrupt). */
export const Split: Story = {
  args: {
    split: true,
    label: 'Pause',
    icon: 'pause',
    onPrimary,
    menuLabel: 'Pause options',
    items: [
      { id: 'drain', label: 'Pause after current step', onSelect: () => undefined },
      { id: 'interrupt', label: 'Interrupt now', danger: true, onSelect: () => undefined },
    ],
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Pause' }));
    await expect(onPrimary).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: 'Pause options' }));
    await screen.findByRole('menu');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  },
};

export const Ghost: Story = { args: { variant: 'ghost', size: 'sm', label: 'Last activity', icon: 'sort' } };
