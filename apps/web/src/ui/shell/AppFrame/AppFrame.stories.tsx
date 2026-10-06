import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { ActivityColumn, ActivityColumnHeader } from '../ActivityColumn/ActivityColumn.js';
import { SidebarFlyout } from '../SidebarFlyout/SidebarFlyout.js';
import { PageHeader } from '../../patterns/PageHeader/PageHeader.js';
import { MainCard, MainCardBody } from '../MainCard/MainCard.js';
import { demoRail, demoSidebar } from '../Sidebar/Sidebar.fixtures.js';
import { TitleStrip, TitleStripSearch, TitleStripServerChip } from '../TitleStrip/TitleStrip.js';
import { AppFrame, type ShellLayout, type SidebarMode } from './AppFrame.js';

function frame(layout: ShellLayout, sidebarMode: SidebarMode) {
  return {
    layout,
    sidebarMode,
    titleStrip: (
      <TitleStrip
        start={
          <>
            <IconButton icon="back" label="Back" size="sm" tooltipSide="bottom" />
            <IconButton icon="forward" label="Forward" size="sm" tooltipSide="bottom" />
            <IconButton icon="sidebar" label="Toggle sidebar" size="sm" tooltipSide="bottom" className="ml-1" />
          </>
        }
        search={<TitleStripSearch shortcut={['Ctrl', 'K']} />}
        end={<TitleStripServerChip label="This computer" tone="ok" />}
      />
    ),
    sidebar: sidebarMode === 'rail' ? demoRail({ layout }) : demoSidebar({ layout }),
    children: (
      <MainCard underStrip={layout === 'strip'}>
        <PageHeader title="Home" actions={<IconButton icon="more" label="More" />} />
        <MainCardBody className="p-7 text-ui text-fg-2">Page content</MainCardBody>
      </MainCard>
    ),
  };
}

/** The window: [title strip] · sidebar or rail · main card (boards Main, DesktopMac, DesktopWindows, ChatNarrow). */
const meta = {
  component: AppFrame,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: frame('native', 'expanded'),
  decorators: [(Story) => <div className="h-[760px] [&>div]:h-full">{Story()}</div>],
} satisfies Meta<typeof AppFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Web and Linux native. */
export const Web: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('app-frame')).toHaveAttribute('data-layout', 'native');
    await expect(canvas.getByRole('main')).toBeVisible();
  },
};

export const Mac: Story = { args: frame('mac', 'expanded') };

export const WindowsStrip: Story = { args: frame('strip', 'expanded') };

/** Below 1200px: the rail (ChatNarrow). */
export const Rail: Story = {
  args: frame('native', 'rail'),
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('app-frame')).toHaveAttribute('data-sidebar', 'rail');
  },
};

export const MacRail: Story = { args: frame('mac', 'rail') };

export const StripRail: Story = { args: frame('strip', 'rail') };

function MotionHarness() {
  const [mode, setMode] = useState<SidebarMode>('expanded');
  const [activity, setActivity] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [flyout, setFlyout] = useState(false);
  const base = frame('native', mode);
  return (
    <AppFrame
      {...base}
      activityOpen={activity}
      activityOverlay={overlay}
      activity={
        <ActivityColumn
          variant={overlay ? 'overlay' : 'docked'}
          width={288}
          minWidth={248}
          maxWidth={400}
          defaultWidth={288}
          offsetLeft={mode === 'expanded' ? 232 : 48}
          onWidthChange={() => undefined}
          header={<ActivityColumnHeader>Activity</ActivityColumnHeader>}
        >
          <p className="p-2 text-small text-fg-3">Cards</p>
        </ActivityColumn>
      }
      flyoutOpen={flyout}
      flyout={<SidebarFlyout onClose={() => setFlyout(false)}>{demoSidebar({ layout: 'native' })}</SidebarFlyout>}
    >
      <MainCard>
        <PageHeader title="Motion" />
        <MainCardBody className="flex flex-wrap items-start gap-2 p-7">
          <Button size="sm" onClick={() => setMode((m) => (m === 'expanded' ? 'rail' : 'expanded'))}>
            {mode === 'expanded' ? 'Collapse to rail' : 'Expand sidebar'}
          </Button>
          <Button size="sm" onClick={() => setActivity((v) => !v)}>
            {activity ? 'Hide activity' : 'Show activity'}
          </Button>
          <Button size="sm" pressed={overlay} onClick={() => setOverlay((v) => !v)}>
            Overlay
          </Button>
          <Button size="sm" disabled={mode !== 'rail'} onClick={() => setFlyout(true)}>
            Open flyout
          </Button>
        </MainCardBody>
      </MainCard>
    </AppFrame>
  );
}

/** D-109: the sidebar slot eases between sidebar and rail, Activity eases open docked or slides in as an overlay, the flyout slides in. */
export const Motion: Story = {
  render: () => <MotionHarness />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Show activity' }));
    await expect(canvas.getByTestId('activity-column')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Hide activity' }));
    // Inert while it eases shut, gone once closed.
    await waitFor(() => expect(canvas.queryByTestId('activity-column')).toBeNull());
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse to rail' }));
    await expect(canvas.getByTestId('app-frame')).toHaveAttribute('data-sidebar', 'rail');
    await userEvent.click(canvas.getByRole('button', { name: 'Open flyout' }));
    await expect(canvas.getByTestId('sidebar-flyout')).toBeInTheDocument();
    // Escape slides it out (the demo flyout repeats the rail's landmarks, so it must be gone for axe).
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByTestId('sidebar-flyout')).toBeNull());
  },
};

export const MotionReduced: Story = { globals: { reduceMotion: 'on' }, render: () => <MotionHarness /> };
