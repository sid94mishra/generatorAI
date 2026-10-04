import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, screen } from 'storybook/test';
import { demoRail, type DemoOptions } from '../Sidebar/Sidebar.fixtures.js';
import { Rail, RailLiveOverflow, RailLiveTile } from './Rail.js';

/** The 48px rail (board ChatNarrow): below 1200px, collapsed, or the builder. */
const meta = {
  component: Rail,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  render: (_args, { parameters }) => <div className="flex h-[760px] bg-ground">{demoRail(parameters['demo'] as DemoOptions)}</div>,
} satisfies Meta<typeof Rail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Web / Linux: app mark, Expand, Search, New chat, nav, Activity + live tiles (D-92), connection, Settings. */
export const Default: Story = {
  parameters: { demo: {} },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
    await expect(canvas.getByRole('button', { name: 'Upgrade React Flow to v12 · running' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /2 more live items/ })).toBeVisible();
  },
};

/** The live tiles: every tone, a count, the hover ring, the overflow (board EnhRailQuickAccess). */
export const LiveTiles: Story = {
  render: () => (
    <div className="flex gap-4 bg-ground p-4">
      <RailLiveTile icon="chats" tone="warn" label="Chat · needs you" />
      <RailLiveTile icon="users" tone="warn" count={3} label="Orchestrator · 3 need you" />
      <RailLiveTile icon="workflows" tone="warn" active label="Workflow · needs you, popover open" />
      <RailLiveTile icon="workflows" tone="err" label="Workflow · failed" />
      <RailLiveTile icon="chats" tone="run" label="Chat · running" />
      <RailLiveTile icon="automations" tone="run" label="Automation · running" />
      <RailLiveOverflow count={2} />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Workflow · failed' })).toHaveAttribute('data-tone', 'err');
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

/** The attention feed has not loaded: no dot, no live tiles (D-36). */
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

/** An update is ready (macOS, Linux native, collapsed): a run-toned download icon above the connection dot. */
export const UpdateReady: Story = {
  parameters: { demo: { layout: 'mac', update: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Restart to update' })).toBeVisible();
  },
};

export const Compact: Story = { globals: { density: 'compact' }, parameters: { demo: {} } };
