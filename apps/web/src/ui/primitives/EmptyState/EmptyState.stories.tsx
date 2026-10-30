import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { EmptyState } from './EmptyState.js';

const meta = {
  component: EmptyState,
  tags: ['vrt-themes'],
  args: {
    icon: 'workflows',
    title: 'No runs yet',
    description: 'Runs appear here when you start this workflow or an automation triggers it.',
    action: <Button icon="play">Run workflow</Button>,
  },
  decorators: [(Story) => <div className="w-100">{Story()}</div>],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Framed: the Components board "Empty state" card. */
export const Framed: Story = { args: { framed: true } };

/** The real error in mono err text + Retry; announced as an alert. */
export const ErrorTone: Story = {
  args: {
    tone: 'error',
    icon: 'warning',
    title: 'Could not load runs',
    description: 'GET /api/workflows/wf_12/runs → 503 Service Unavailable',
    action: <Button icon="refresh">Retry</Button>,
    framed: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('503 Service Unavailable');
  },
};

export const NoAction: Story = { args: { action: undefined, title: 'Nothing matches', description: 'Try another filter.' } };
