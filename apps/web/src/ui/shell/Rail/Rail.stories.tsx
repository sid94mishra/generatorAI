import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, screen } from 'storybook/test';
import { demoRail, type DemoOptions } from '../Sidebar/Sidebar.fixtures.js';
import { Rail } from './Rail.js';

/** The 48px rail (board ChatNarrow): below 1200px, collapsed, or the builder. */
const meta = {
  component: Rail,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  render: (_args, { parameters }) => <div className="flex h-[760px] bg-ground">{demoRail(parameters['demo'] as DemoOptions)}</div>,
} satisfies Meta<typeof Rail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Web / Linux: app mark, Expand, Search, New chat, nav, running counter, connection, Settings. */
export const Default: Story = {
  parameters: { demo: {} },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
    await expect(canvas.getByRole('button', { name: '3 running' })).toBeVisible();
  },
};

/** macOS: the empty 44px drag row the traffic lights sit over. */
export const Mac: Story = { parameters: { demo: { layout: 'mac' } } };

/** Windows strip: no app mark and no Search (the strip holds them). */
export const Strip: Story = {
  parameters: { demo: { layout: 'strip' } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Search' })).toBeNull();
  },
};

/** The attention feed has not loaded: no dot, no counter (D-36). */
export const FeedNotLoaded: Story = {
  parameters: { demo: { live: false } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: /running/ })).toBeNull();
  },
};

/** Every rail icon names itself in a tooltip. */
export const Tooltips: Story = {
  parameters: { demo: {} },
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('button', { name: 'Show sidebar' }));
    await waitFor(() => expect(screen.getByText('Show sidebar', { selector: 'span' })).toBeVisible());
    await expect(document.querySelector('[data-gai-overlay="tooltip"]')).not.toBeNull();
  },
};

export const Compact: Story = { globals: { density: 'compact' }, parameters: { demo: {} } };
