import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Breadcrumb } from './Breadcrumb.js';

const meta = {
  component: Breadcrumb,
  tags: ['vrt-themes'],
  args: {
    items: [
      { label: 'Automations', href: '#automations' },
      { label: 'Nightly audit', href: '#nightly' },
      { label: 'Run 248', mono: true },
    ],
  },
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Automations' })).toBeVisible();
    await expect(canvas.getByText('Run 248')).toHaveAttribute('aria-current', 'page');
  },
};

export const TwoLevels: Story = {
  args: { items: [{ label: 'Projects', href: '#p' }, { label: 'payments-service' }] },
};

/** The current page truncates first. */
export const LongText: Story = {
  args: {
    items: [
      { label: 'Projects', href: '#p' },
      { label: 'payments-service', href: '#ps' },
      { label: 'Fix the coupon/total race in checkout and add a regression test for rounding' },
    ],
  },
  render: (args) => (
    <div className="w-96">
      <Breadcrumb {...args} />
    </div>
  ),
};

/** A breadcrumb-only page header: the current item is the page's h1, same look. */
export const CurrentIsHeading: Story = {
  args: { currentIsHeading: true, items: [{ label: 'Chats', href: '#c' }, { label: 'New chat' }] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'New chat' })).toHaveAttribute('aria-current', 'page');
  },
};
