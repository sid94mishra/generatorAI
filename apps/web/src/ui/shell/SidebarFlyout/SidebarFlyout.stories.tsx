import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { demoRail, demoSidebar } from '../Sidebar/Sidebar.fixtures.js';
import { SidebarFlyout } from './SidebarFlyout.js';

function Demo({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="relative flex h-[760px] bg-ground">
      {demoRail({ covered: open })}
      <div className="m-2 ml-0 flex-1 rounded-panel border border-line-soft bg-surface p-6">
        <IconButton icon="sidebar" label="Show sidebar" data-sidebar-toggle="" onClick={() => setOpen((o) => !o)} />
      </div>
      {open ? <SidebarFlyout onClose={() => setOpen(false)}>{demoSidebar()}</SidebarFlyout> : null}
    </div>
  );
}

/** The full sidebar over a forced rail (window < 1200px): non-modal, closes on Esc / outside. */
const meta = {
  component: SidebarFlyout,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: { onClose: () => undefined },
  render: () => <Demo />,
} satisfies Meta<typeof SidebarFlyout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async ({ canvas }) => {
    const flyout = canvas.getByRole('dialog', { name: 'Sidebar' });
    await expect(flyout).toHaveAttribute('data-gai-overlay', 'sheet');
    await expect(flyout).not.toHaveAttribute('aria-modal');
  },
};

export const ClosesOnEscape: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('dialog', { name: 'Sidebar' })).toBeNull());
  },
};
