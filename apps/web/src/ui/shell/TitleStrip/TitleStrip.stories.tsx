import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { Button } from '../../primitives/Button/Button.js';
import { TitleStrip, TitleStripSearch, TitleStripServerChip } from './TitleStrip.js';

const start = (
  <>
    <IconButton icon="back" label="Back" size="sm" tooltipSide="bottom" />
    <IconButton icon="forward" label="Forward" size="sm" tooltipSide="bottom" disabled />
    <IconButton icon="sidebar" label="Toggle sidebar" size="sm" tooltipSide="bottom" className="ml-1" />
  </>
);

/** The Windows / Linux-custom 36px title strip (board DesktopWindows). */
const meta = {
  component: TitleStrip,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: {
    start,
    search: <TitleStripSearch shortcut={['Ctrl', 'K']} />,
    end: <TitleStripServerChip label="This computer" tone="ok" toneLabel="Connected" />,
  },
  decorators: [(Story) => <div className="w-[1440px] max-w-full bg-ground">{Story()}</div>],
} satisfies Meta<typeof TitleStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('button', { name: /Search/ })).toBeVisible();
    const strip = canvasElement.querySelector('[data-slot="title-strip"]');
    await expect(strip?.getBoundingClientRect().height).toBe(36);
  },
};

/** An update is ready: the pill sits before the server chip (P3-06). */
export const UpdateReady: Story = {
  args: {
    end: (
      <>
        <Button size="sm" icon="download" className="bg-run-bg text-run">
          Restart to update
        </Button>
        <TitleStripServerChip label="This computer" tone="ok" toneLabel="Connected" />
      </>
    ),
  },
};

/** The server is unreachable. */
export const Offline: Story = {
  args: { end: <TitleStripServerChip label="build-box" tone="err" toneLabel="Disconnected" /> },
};

/** A narrow window: the search shrinks toward 200px and stays centred. */
export const Narrow: Story = {
  decorators: [(Story) => <div className="w-[860px] bg-ground">{Story()}</div>],
};
