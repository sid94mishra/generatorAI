import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { SplitPane } from './SplitPane.js';

// Fixed-pixel demo frame (arbitrary story scaffolding, D-45) — matches
// ListPage.stories.tsx's FRAME_1440 convention: Storybook's preview root
// does not reliably stretch a `w-full` child to the viewport, so demo
// containers here use an explicit box instead.
const FRAME = 'h-[400px] w-[900px]';

const meta = {
  component: SplitPane,
  tags: ['vrt-themes'],
  args: { id: 'meta', children: [null, null] },
} satisfies Meta<typeof SplitPane>;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo(props: { collapsed?: boolean }) {
  return (
    <div className={`${FRAME} flex border border-line-soft`}>
      <SplitPane id="storybook-split" defaultSize={320} minSize={200} maxSize="70%" collapsed={props.collapsed}>
        <div className="flex h-full items-center justify-center bg-surface text-ui text-fg-2">Main</div>
        <div className="flex h-full items-center justify-center bg-raised text-ui text-fg-2">Side (dock)</div>
      </SplitPane>
    </div>
  );
}

/** Draggable, keyboard-resizable main + side split. */
export const Default: Story = {
  render: () => <Demo />,
};

/** The side pane collapses to 0 without unmounting (Main/Side both stay in the DOM). */
export const Collapsed: Story = {
  render: () => <Demo collapsed />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Main')).toBeInTheDocument();
    await expect(canvas.getByText('Side (dock)')).toBeInTheDocument();
  },
};

/** The separator is a keyboard-operable role="separator" with the WAI-ARIA value attributes. */
export const KeyboardResize: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const separator = canvas.getByRole('separator');
    await expect(separator).toHaveAttribute('aria-valuenow');
    separator.focus();
    await expect(separator).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
  },
};

/** Vertical orientation (stacked main/side). */
export const Vertical: Story = {
  render: () => (
    <div className={`${FRAME} flex border border-line-soft`}>
      <SplitPane id="storybook-split-v" orientation="vertical" defaultSize={120} minSize={60}>
        <div className="flex h-full items-center justify-center bg-surface text-ui text-fg-2">Main</div>
        <div className="flex h-full items-center justify-center bg-raised text-ui text-fg-2">Side</div>
      </SplitPane>
    </div>
  ),
};
