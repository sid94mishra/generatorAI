import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { Sheet, SheetBody, SheetClose, SheetFooter, type SheetProps } from './Sheet.js';

const body = (
  <>
    <SheetBody>
      <p className="text-ui text-fg-2">Changes, files, terminals and browsers for this chat live here while the window is narrow.</p>
      <p className="text-ui text-fg-2">The chat beside the sheet stays usable.</p>
    </SheetBody>
    <SheetFooter hint="Applies to this chat">
      <SheetClose render={<Button shortcut={['Esc']} />}>Cancel</SheetClose>
      <Button variant="primary">Save</Button>
    </SheetFooter>
  </>
);

const meta = {
  component: Sheet,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'Workspace',
    trigger: <Button>Open workspace</Button>,
    onOpenChange: fn(),
    children: body,
  },
  decorators: [(Story) => <div className="p-4">{Story()}</div>],
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Modal (default): scrim backdrop + sheet, both D-19 overlays; focus trapped; Escape closes and returns focus. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    const trigger = canvas.getByRole('button', { name: 'Open workspace' });
    await userEvent.click(trigger);
    const sheet = await screen.findByRole('dialog', { name: 'Workspace' });
    await expect(sheet).toHaveAttribute('data-gai-overlay', 'sheet');
    await expect(document.querySelector('[data-gai-overlay="backdrop"]')).not.toBeNull();
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    for (let i = 0; i < 4; i++) {
      await userEvent.tab();
      await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    }
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await expect(trigger).toHaveFocus();
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(false, expect.anything());
  },
};

/**
 * The narrow dock sheet (D-19 / D-27): non-modal, so NO backdrop element is
 * rendered at all, focus is not trapped, and pressing outside does not close it.
 */
function NonModalDemo(props: Partial<SheetProps>) {
  const [open, setOpen] = useState(true);
  const [clicks, setClicks] = useState(0);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={() => setClicks((n) => n + 1)}>Chat action</Button>
      <span className="text-small text-fg-3">Clicked {clicks}</span>
      <Sheet {...props} title="Dock" modal={false} open={open} onOpenChange={setOpen}>
        <SheetBody>
          <Button>Inside the sheet</Button>
        </SheetBody>
      </Sheet>
    </div>
  );
}

export const NonModal: Story = {
  args: { trigger: undefined },
  render: (args) => <NonModalDemo {...args} />,
  play: async ({ canvas }) => {
    const sheet = await screen.findByRole('dialog', { name: 'Dock' });
    await expect(sheet).toHaveAttribute('data-gai-overlay', 'sheet');
    await expect(sheet).not.toHaveAttribute('aria-modal');
    // No scrim of any kind: neither the kit backdrop nor Base UI's internal one.
    await expect(document.querySelector('[data-gai-overlay="backdrop"]')).toBeNull();
    await expect(document.querySelector('[role="presentation"][data-base-ui-inert]')).toBeNull();
    // The page beside it stays usable, and the sheet stays open.
    await userEvent.click(canvas.getByRole('button', { name: 'Chat action' }));
    await expect(canvas.getByText('Clicked 1')).toBeVisible();
    await expect(screen.getByRole('dialog', { name: 'Dock' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};

/** Portalled into a container (the main card) at `top-11` (below the 44px header), absolute inside it. */
function ContainedDemo({ side = 'right', ...props }: Partial<SheetProps>) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setContainer} className="relative min-h-100 w-180 overflow-hidden rounded-panel border border-line bg-surface">
      <div className="flex h-bar items-center border-b border-line-soft px-4 text-ui text-fg">Header</div>
      {container ? (
        <Sheet
          {...props}
          title="Dock"
          side={side}
          modal={false}
          defaultOpen
          container={container}
          className="top-11"
          data-testid={`sheet-${side}`}
        >
          <SheetBody>
            <p className="text-ui text-fg-2">Sheet content</p>
          </SheetBody>
        </Sheet>
      ) : null}
    </div>
  );
}

export const InContainer: Story = {
  args: { trigger: undefined },
  render: (args) => <ContainedDemo {...args} />,
  play: async ({ canvasElement }) => {
    const sheet = await screen.findByTestId('sheet-right');
    await expect(canvasElement.contains(sheet)).toBe(true);
    await expect(sheet).toHaveAttribute('data-gai-overlay', 'sheet');
    await expect(getComputedStyle(sheet).position).toBe('absolute');
  },
};

/** side right (border-l) · side left (border-r), both non-modal in containers. */
export const Matrix: Story = {
  args: { trigger: undefined },
  render: () => (
    <div className="flex flex-col gap-4">
      <ContainedDemo side="right" />
      <ContainedDemo side="left" />
    </div>
  ),
  play: async () => {
    await expect(await screen.findByTestId('sheet-right')).toHaveClass('border-l');
    await expect(await screen.findByTestId('sheet-left')).toHaveClass('border-r');
  },
};

/** Keyboard: the trigger takes focus, Enter opens, focus moves into the sheet. */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Open workspace' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const sheet = await screen.findByRole('dialog', { name: 'Workspace' });
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
  },
};

/** Open for the visual baseline: modal, 380 wide, header + body + footer. */
export const Open: Story = { args: { defaultOpen: true } };

export const Left: Story = { args: { defaultOpen: true, side: 'left' } };

export const CustomWidth: Story = { args: { defaultOpen: true, width: 480 } };
