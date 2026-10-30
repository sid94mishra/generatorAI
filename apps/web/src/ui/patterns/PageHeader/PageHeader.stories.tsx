import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { Chip } from '../../primitives/Chip/Chip.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { Separator } from '../../primitives/Separator/Separator.js';
import { StatusBadge } from '../../primitives/StatusBadge/StatusBadge.js';
import { Breadcrumb } from '../Breadcrumb/Breadcrumb.js';
import { PageHeader } from './PageHeader.js';

const meta = {
  component: PageHeader,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: { title: 'Chats', actions: <IconButton icon="more" label="More" /> },
  decorators: [(Story) => <div className="bg-surface">{Story()}</div>],
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** List page: plain title + More (ChatsList board). */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('banner')).toBeVisible();
    await expect(canvas.getByText('Chats')).toBeVisible();
  },
};

/** A page without a PageTitle (the chat workspace): the header title is the h1. */
export const TitleAsHeading: Story = {
  args: { title: 'Fix flaky checkout test', titleIsHeading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Fix flaky checkout test' })).toBeVisible();
  },
};

/** Detail page: breadcrumb, status, meta chips, actions and the dock toggle. */
export const Detail: Story = {
  args: {
    title: undefined,
    breadcrumb: (
      <Breadcrumb
        items={[
          { label: 'Automations', href: '#a' },
          { label: 'Nightly audit', href: '#n' },
          { label: 'Run 248', mono: true },
        ]}
      />
    ),
    status: <StatusBadge state="running" phase="Finalizing" />,
    meta: (
      <>
        <Chip mono icon="branch" size="sm">
          fix/checkout-flake
        </Chip>
        <span>Unsaved changes</span>
      </>
    ),
    actions: (
      <>
        <Button size="sm" variant="ghost" icon="stop">
          Stop
        </Button>
        <Separator orientation="vertical" tone="default" />
        <IconButton icon="more" label="More" />
      </>
    ),
    dockToggle: <IconButton icon="dock" label="Toggle dock" pressed shortcut={['Ctrl', 'B']} />,
  },
};

/** With the 38h second row (run header). */
export const WithSubbar: Story = {
  args: {
    subbar: (
      <span className="text-small text-fg-3">
        Triggered by <span className="font-mono">cron 0 2 * * *</span> · budget 42%
      </span>
    ),
  },
};
