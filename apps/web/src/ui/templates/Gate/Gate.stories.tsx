import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { Gate } from './Gate.js';

/** L-03 Gate: the centred 420px card (404, route errors; Pairing in P5). */
const meta = {
  component: Gate,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: {
    icon: 'info',
    title: 'Page not found',
    description: 'There is nothing at this address. It may have moved, or the link is wrong.',
    actions: <Button variant="primary">Go home</Button>,
  },
  decorators: [(Story) => <div className="flex h-[640px] bg-surface">{Story()}</div>],
} satisfies Meta<typeof Gate>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotFound: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  },
};

/** A route error: the real message verbatim, Reload and Go home. */
export const RouteError: Story = {
  args: {
    icon: 'status-failed',
    tone: 'err',
    title: 'Something went wrong',
    description: 'This page failed to load. Reloading usually fixes it; the error is below.',
    detail: "Failed to fetch dynamically imported module: /assets/ChatPage-3f2a.js",
    actions: (
      <>
        <Button>Reload</Button>
        <Button variant="primary">Go home</Button>
      </>
    ),
  },
};

/** Full window (the shell itself failed), with the note under the card. */
export const Window: Story = {
  args: { placement: 'window', note: 'If this keeps happening, restart the server from the tray menu.' },
  decorators: [(Story) => <div className="h-[640px] [&>div]:h-full">{Story()}</div>],
};
