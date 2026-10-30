import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { ToolbarButton } from '../../primitives/Toolbar/Toolbar.js';
import { BulkActionBar } from './BulkActionBar.js';

const actions = (
  <>
    <ToolbarButton render={<Button variant="ghost" size="sm" icon="archive" />}>Archive</ToolbarButton>
    <ToolbarButton render={<Button variant="danger-ghost" size="sm" icon="trash" />}>Delete</ToolbarButton>
  </>
);

function Demo() {
  const [count, setCount] = useState(2);
  return (
    <div className="relative h-[200px] w-[900px] rounded-panel border border-line-soft bg-surface">
      <p className="p-4 text-small text-fg-3">{count === 0 ? 'Selection cleared' : 'Rows are selected'}</p>
      <BulkActionBar count={count} total={48} actions={actions} onSelectAll={() => setCount(48)} onClear={() => setCount(0)} />
    </div>
  );
}

const meta = {
  component: BulkActionBar,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  args: { count: 2, total: 48, actions, onSelectAll: fn(), onClear: fn() },
  render: () => <Demo />,
} satisfies Meta<typeof BulkActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** "2 selected · Archive · Delete · Select all 48 · Clear Esc" (ChatsList board); Escape clears. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const bar = canvas.getByRole('toolbar', { name: 'Bulk actions' });
    await expect(bar).toHaveTextContent('2 selected');
    await userEvent.click(canvas.getByRole('button', { name: /Select all/ }));
    await expect(bar).toHaveTextContent('48 selected');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.getByText('Selection cleared')).toBeVisible());
  },
};

/** Arrow keys move between the bar's buttons (one tab stop). */
export const Keyboard: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Archive' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('button', { name: 'Delete' })).toHaveFocus();
  },
};

export const Compact: Story = { globals: { density: 'compact' } };
