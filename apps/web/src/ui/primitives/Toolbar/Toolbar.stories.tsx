import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { IconButton } from '../IconButton/IconButton.js';
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator } from './Toolbar.js';

const meta = {
  component: Toolbar,
  subcomponents: { ToolbarGroup, ToolbarButton, ToolbarSeparator },
  tags: ['vrt-themes'],
  args: { label: 'Bulk actions' },
  render: (args) => (
    <Toolbar {...args}>
      <ToolbarGroup>
        <ToolbarButton render={<Button variant="ghost" size="sm" icon="archive" />}>Archive</ToolbarButton>
        <ToolbarButton render={<Button variant="danger-ghost" size="sm" icon="trash" />}>Delete</ToolbarButton>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarButton render={<IconButton size="sm" icon="more" label="More" />} />
    </Toolbar>
  ),
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One tab stop; arrow keys move between items (roving focus). */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('toolbar', { name: 'Bulk actions' })).toBeVisible();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Archive' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('button', { name: 'Delete' })).toHaveFocus();
  },
};

export const Compact: Story = { globals: { density: 'compact' } };
