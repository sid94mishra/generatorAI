import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { MountGroupsBar } from './MountGroupsBar.js';

const meta = {
  component: MountGroupsBar,
  tags: ['vrt-themes'],
  args: {
    groups: [
      { alias: 'api', stats: { files: 1, additions: 3, deletions: 1 }, firstId: 'api::src/a.ts', path: '/work/api', branch: 'feat/api' },
      { alias: 'web', stats: { files: 2, additions: 22, deletions: 8 }, firstId: 'web::src/x.ts', path: '/work/web' },
      { alias: '.', stats: { files: 1, additions: 4, deletions: 0 }, firstId: '.::NOTES.md' },
    ],
    onJump: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-120 border border-line-soft bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MountGroupsBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One button per mount: alias, branch, file count, ±; the workspace root reads "workspace". */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const bar = within(canvasElement).getByTestId('mount-groups');
    const buttons = within(bar).getAllByRole('button');
    await expect(buttons).toHaveLength(3);
    await expect(buttons[0]).toHaveTextContent('feat/api');
    await expect(buttons[2]).toHaveTextContent('workspace');
    await userEvent.click(buttons[1]!);
    await expect(args.onJump).toHaveBeenCalledWith('web::src/x.ts');
  },
};
