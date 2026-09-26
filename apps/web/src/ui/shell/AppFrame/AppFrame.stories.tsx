import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
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
