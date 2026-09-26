import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { Link } from './Link.js';

const meta = {
  component: Link,
  tags: ['vrt-themes'],
  args: { href: '#automations', children: 'Automations' },
  argTypes: { variant: { control: 'inline-radio', options: ['muted', 'default', 'external'] } },
} satisfies Meta<typeof Link>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Matrix: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-ui">
      <Link variant="muted" href="#a">
        Automations
      </Link>
      <Link href="#b">Fix flaky checkout test</Link>
      <Link variant="external" href="https://example.com">
        Changelog
      </Link>
    </div>
  ),
};

export const External: Story = {
  args: { variant: 'external', href: 'https://example.com', children: 'Changelog' },
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: /Changelog/ });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  },
};

export const Hover: Story = { parameters: { pseudo: { hover: true } }, render: Matrix.render };

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: 'Automations' })).toHaveFocus();
  },
};

/** `render` swaps the element — a router link in the app. */
export const WithRender: Story = {
  args: { render: <a href="#chats" data-router="true" />, children: 'Chats', variant: 'muted' },
};
