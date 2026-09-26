import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Sidebar } from './Sidebar.js';
import { demoSidebar, type DemoOptions } from './Sidebar.fixtures.js';

/** The 232px sidebar per layout (boards Main, DesktopMac, DesktopWindows). */
const meta = {
  component: Sidebar,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  render: (_args, { parameters }) => (
    <div className="flex h-[760px] bg-ground">{demoSidebar(parameters['demo'] as DemoOptions)}</div>
  ),
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// The render ignores args; these satisfy the component's required props.
const args = { layout: 'native' as const, header: null, nav: null, footer: null };

/** Plain web and Linux native: switcher row first (pad-top 10). */
export const Web: Story = {
  args,
  parameters: { demo: { layout: 'native' } },
  play: async ({ canvas }) => {
    const nav = canvas.getByRole('navigation', { name: 'Main' });
    await expect(nav.querySelectorAll('a')).toHaveLength(7);
    await expect(canvas.getByRole('link', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
    await expect(canvas.getByRole('region', { name: 'Needs you' })).toBeVisible();
  },
};

/** macOS: the 44px traffic-light drag row on top. */
export const Mac: Story = { args, parameters: { demo: { layout: 'mac' } } };

/** Windows / Linux custom: logo + New chat; search and servers live in the strip. */
export const WindowsStrip: Story = {
  args,
  parameters: { demo: { layout: 'strip', active: 'home' } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: /Search/ })).toBeNull();
  },
};

/** Linux native frame in the desktop app: the 36px Back / Forward row. */
export const LinuxDesktop: Story = { args, parameters: { demo: { layout: 'native', desktop: true } } };

/** The attention feed has not loaded: no Needs you / Running lists (D-36). */
export const FeedNotLoaded: Story = {
  args,
  parameters: { demo: { live: false } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('region', { name: 'Needs you' })).toBeNull();
  },
};

/** Reconnecting, with the missing-events notice. */
export const ConnectionTrouble: Story = {
  args,
  parameters: { demo: { connection: 'warn', gap: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('may be missing');
    await expect(canvas.getByRole('status')).toHaveTextContent('Reconnecting…');
  },
};

export const Disconnected: Story = { args, parameters: { demo: { connection: 'err' } } };

export const Compact: Story = { args, globals: { density: 'compact' }, parameters: { demo: {} } };
