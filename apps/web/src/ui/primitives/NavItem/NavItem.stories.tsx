import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { Count } from '../Count/Count.js';
import { Icon } from '../../icons/Icon.js';
import { NavItem } from './NavItem.js';

const meta = {
  component: NavItem,
  tags: ['vrt-themes'],
  args: { icon: 'chats', label: 'Chats', href: '#chats' },
  decorators: [(Story) => <div className="w-58 bg-ground p-2">{Story()}</div>],
} satisfies Meta<typeof NavItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Active: Story = {
  args: { active: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
  },
};

/** The sidebar: nav rows, a count, two-line Needs you rows, dense settings rows. */
export const Matrix: Story = {
  render: () => (
    <nav aria-label="Main" className="flex flex-col gap-px">
      <NavItem icon="home" label="Home" href="#home" />
      <NavItem icon="chats" label="Chats" href="#chats" active />
      <NavItem icon="workflows" label="Workflows" href="#wf" count={<Count>12</Count>} />
      <NavItem label="Nightly dependency audit" subtitle="Approve “Apply upgrades”" dot="needs_you" href="#n1" />
      <NavItem label="Fix flaky checkout test" subtitle="Allow git push?" dot="needs_you" href="#n2" />
      <NavItem icon="status-running" label="Upgrade React Flow to v12" count={<Count>4:12</Count>} href="#r1" />
      <NavItem
        leading={<Icon concept="status-running" size={16} className="text-run" />}
        label="PR review pipeline 311"
        count={<Count>1:05</Count>}
        href="#r2"
      />
      <NavItem label="Appearance" dense href="#s1" active />
      <NavItem label="Security" dense href="#s2" />
    </nav>
  ),
};

export const Hover: Story = { parameters: { pseudo: { hover: true } } };

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: 'Chats' })).toHaveFocus();
  },
};

export const LongText: Story = { args: { label: 'Review dark-mode token PR 1176 for the payments dashboard' } };

export const Compact: Story = { globals: { density: 'compact' }, render: Matrix.render };
