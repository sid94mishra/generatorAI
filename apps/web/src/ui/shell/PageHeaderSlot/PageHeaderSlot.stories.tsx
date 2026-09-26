import { useEffect, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { PageHeader } from '../../patterns/PageHeader/PageHeader.js';
import { LegacyHeaderSlot, PageHeaderSlot } from './PageHeaderSlot.js';

/** The main card's first row: a page's own header, or the legacy Header (D-21). */
const meta = {
  component: PageHeaderSlot,
  tags: ['vrt-themes'],
  decorators: [(Story) => <div className="w-[960px] max-w-full rounded-panel border border-line-soft bg-surface">{Story()}</div>],
} satisfies Meta<typeof PageHeaderSlot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: <PageHeader title="Projects" actions={<IconButton icon="more" label="More" />} /> },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-slot="page-header-slot"][data-drag-region="mac"]')).not.toBeNull();
  },
};

/** The legacy branch: the old Header inside `legacy-header` (a stand-in here). */
export const Legacy: Story = {
  render: () => (
    <LegacyHeaderSlot>
      <header className="flex h-bar items-center border-b border-line-soft px-3 text-ui font-medium">Home</header>
    </LegacyHeaderSlot>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('legacy-header')).toBeVisible();
  },
};

/** Puts `<html>` in the macOS chrome (what lib/desktop.ts does in the app) while mounted. */
function MacChrome({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('titlebar-inset');
    root.style.setProperty('--gai-titlebar-inset-left', '78px');
    return () => {
      root.classList.remove('titlebar-inset');
      root.style.removeProperty('--gai-titlebar-inset-left');
    };
  }, []);
  return children;
}

/** macOS rail mode: the leading inset that clears the traffic lights (30px). */
export const MacRailInset: Story = {
  render: () => (
    <MacChrome>
      <div data-testid="app-frame" data-sidebar="rail">
        <PageHeaderSlot>
          <PageHeader title="Fix flaky checkout test" />
        </PageHeaderSlot>
      </div>
    </MacChrome>
  ),
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector('[data-slot="page-header"] > div');
    await waitFor(() => expect(row && getComputedStyle(row).paddingInlineStart).toBe('30px'));
  },
};
