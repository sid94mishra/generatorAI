import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import type { AvatarSize } from '../../lib/avatar.js';
import { Avatar, initialsOf } from './Avatar.js';

const SIZES: AvatarSize[] = [18, 20, 24, 32];

const meta = {
  component: Avatar,
  tags: ['vrt-themes'],
  args: { name: 'Bug Fixer' },
  argTypes: { size: { control: 'inline-radio', options: SIZES } },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'Bug Fixer' })).toHaveTextContent('BF');
  },
};

/** Every size with a few names (initials are derived). */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {SIZES.map((size) => (
        <div key={size} className="flex items-center gap-2">
          {['Bug Fixer', 'Orchestrator', 'Security Auditor', 'test-writer'].map((name) => (
            <Avatar key={name} name={name} size={size} />
          ))}
        </div>
      ))}
    </div>
  ),
};

/** Next to its name the tile is decorative (ChatsList agent column). */
export const WithName: Story = {
  render: () => (
    <span className="inline-flex items-center gap-2 text-ui text-fg">
      <Avatar name="Release Scribe" size={20} decorative /> Release Scribe
    </span>
  ),
  play: async () => {
    await expect(initialsOf('Release Scribe')).toBe('RS');
    await expect(initialsOf('')).toBe('?');
  },
};
