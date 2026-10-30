import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Avatar } from '../../primitives/Avatar/Avatar.js';
import { Badge } from '../../primitives/Badge/Badge.js';
import { Chip } from '../../primitives/Chip/Chip.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { CardGrid, EntityCard } from './EntityCard.js';

const meta = {
  component: EntityCard,
  tags: ['vrt-themes'],
  args: { title: 'Code reviewer', description: 'Reviews pull requests for style, tests and risky changes before they merge.' },
} satisfies Meta<typeof EntityCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <EntityCard {...args} leading={<Avatar name="Code reviewer" size={32} />} className="w-72" />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Code reviewer')).toBeInTheDocument();
  },
};

/** a CardGrid of full cards: leading avatar, badge, meta, footer tags, selected. */
export const Matrix: Story = {
  render: () => (
    <CardGrid columns={3} className="w-220">
      <EntityCard
        title="Code reviewer"
        leading={<Avatar name="Code reviewer" size={32} />}
        badge={<Badge tone="neutral">Agent</Badge>}
        description="Reviews pull requests for style, tests and risky changes before they merge."
        meta="reviewer.agent.md"
        footer={
          <>
            <span className="text-small text-fg-3">Shared</span>
            <Chip size="sm">code</Chip>
            <Chip size="sm">review</Chip>
          </>
        }
        actions={<IconButton icon="more" label="More" size="sm" />}
      />
      <EntityCard
        selected
        title="Release writer"
        leading={<Avatar name="Release writer" size={32} />}
        badge={<Badge tone="neutral">Agent</Badge>}
        description="Drafts changelog entries and release notes from merged pull requests."
        meta="release-writer.agent.md"
      />
    </CardGrid>
  ),
};
