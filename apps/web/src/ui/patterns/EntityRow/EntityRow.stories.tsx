import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { EntityRow } from './EntityRow.js';

const meta = {
  component: EntityRow,
  tags: ['vrt-themes'],
  args: { title: 'API tokens', subtitle: 'Rotate every 90 days', icon: 'key' },
} satisfies Meta<typeof EntityRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('API tokens')).toBeInTheDocument();
  },
};

/** row variant (list, hover reveals actions) vs nav variant (master-detail, selected). */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <div className="flex flex-col rounded-card border border-line-soft">
        <EntityRow icon="key" title="API tokens" subtitle="Rotate every 90 days" actions={<IconButton icon="more" label="More" size="sm" />} />
        <EntityRow icon="webhook" title="Webhooks" subtitle="2 configured" meta="Active" actions={<IconButton icon="edit" label="Edit" size="sm" />} />
      </div>
      <div className="flex flex-col gap-1 rounded-card border border-line-soft p-2">
        <EntityRow variant="nav" icon="server" title="Production" subtitle="api.example.com" selected />
        <EntityRow variant="nav" icon="server" title="Staging" subtitle="staging.example.com" />
      </div>
    </div>
  ),
};
