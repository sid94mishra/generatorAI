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

/** Repositories inside one folder: each with its own next step; the folder itself, no repository, says so. */
export const PerRepositoryActions: Story = {
  args: {
    groups: [
      { alias: 'acme/api', stats: { files: 2, additions: 12, deletions: 3 }, firstId: 'acme/api::src/a.ts', branch: 'generatorai/fix', action: { label: 'Commit', onClick: fn() } },
      { alias: 'acme/web', stats: { files: 1, additions: 1, deletions: 0 }, firstId: 'acme/web::x.ts', branch: 'main', action: { label: 'Push', onClick: fn() } },
      { alias: 'acme', stats: { files: 1, additions: 2, deletions: 0 }, firstId: 'acme::docker-compose.yml', note: 'not a git repository' },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const bar = within(canvasElement).getByTestId('mount-groups');
    await expect(within(bar).getAllByTestId('mount-group-ship')).toHaveLength(2);
    await expect(bar).toHaveTextContent('not a git repository');
    await userEvent.click(within(bar).getByRole('button', { name: 'Commit acme/api' }));
    await expect(args.groups[0]!.action!.onClick).toHaveBeenCalled();
  },
};
