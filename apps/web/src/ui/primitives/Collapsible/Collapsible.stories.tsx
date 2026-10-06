import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { IconButton } from '../IconButton/IconButton.js';
import { Accordion, Collapsible, Reveal, type CollapsibleVariant, type RevealMotion } from './Collapsible.js';

const VARIANTS: CollapsibleVariant[] = ['disclosure', 'attached', 'section'];

const meta = {
  component: Collapsible,
  tags: ['vrt-themes'],
  args: {
    trigger: 'Thought for 12s',
    icon: 'clock',
    variant: 'disclosure',
    children: <p className="text-small text-fg-2">Checked the failing test, then traced the null to the loader.</p>,
  },
  argTypes: { variant: { control: 'inline-radio', options: VARIANTS } },
  decorators: [(Story) => <div className="w-120">{Story()}</div>],
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Thought for 12s' });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // The panel eases open (D-108).
    await waitFor(() => expect(canvas.getByText(/traced the null/)).toBeVisible());
  },
};

function ControlledPair() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-small text-fg-3">open: {String(open)}</span>
      <Collapsible variant="attached" icon="device" trigger="Pair a new device" open={open} onOpenChange={setOpen}>
        <p className="text-small text-fg-2">Scan the code on your phone, or enter it manually.</p>
      </Collapsible>
    </div>
  );
}

export const Controlled: Story = {
  render: () => <ControlledPair />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Pair a new device' }));
    await expect(canvas.getByText('open: true')).toBeVisible();
  },
};

/** variant × closed / open / disabled (chat disclosure rows, "Pair a new device", settings sections). */
export const Matrix: Story = {
  render: () => (
    <div className="flex w-120 flex-col gap-4">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-col gap-2">
          <Collapsible variant={variant} icon={variant === 'section' ? undefined : 'clock'} trigger={`${variant} closed`}>
            <p className="text-small text-fg-2">Panel content.</p>
          </Collapsible>
          <Collapsible variant={variant} icon={variant === 'section' ? undefined : 'clock'} trigger={`${variant} open`} defaultOpen>
            <p className="text-small text-fg-2">Panel content, shown because the collapsible starts open.</p>
          </Collapsible>
          <Collapsible variant={variant} trigger={`${variant} disabled`} disabled>
            <p className="text-small text-fg-2">Never shown.</p>
          </Collapsible>
        </div>
      ))}
    </div>
  ),
};

const ITEMS = [
  { value: 'general', trigger: 'General', children: <p className="text-small text-fg-2">Name, description, icon.</p> },
  { value: 'tools', trigger: 'Tools', children: <p className="text-small text-fg-2">Allowed tools and MCP servers.</p> },
  { value: 'limits', trigger: 'Limits', disabled: true, children: <p className="text-small text-fg-2">Budgets.</p> },
];

/** Grouped: one open at a time (default) — opening Tools closes General. */
export const AccordionSingle: Story = {
  render: () => <Accordion items={ITEMS} defaultValue={['general']} className="w-120" />,
  play: async ({ canvas }) => {
    const general = canvas.getByRole('button', { name: 'General' });
    const tools = canvas.getByRole('button', { name: 'Tools' });
    await expect(general).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(tools);
    await expect(tools).toHaveAttribute('aria-expanded', 'true');
    await expect(general).toHaveAttribute('aria-expanded', 'false');
  },
};

export const AccordionMultiple: Story = {
  render: () => <Accordion items={ITEMS} multiple variant="attached" className="w-120" />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'General' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Tools' }));
    await expect(canvas.getByRole('button', { name: 'General' })).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-expanded', 'true');
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const trigger = canvas.getByRole('button', { name: 'Thought for 12s' });
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  },
};

/** The 24h (20h compact) disclosure row keeps a 24×24 target. */
export const TargetSize: Story = {
  globals: { density: 'compact' },
  render: Matrix.render,
  play: async ({ canvasElement }) => {
    assertTargetSize(canvasElement);
  },
};

export const Compact: Story = { globals: { density: 'compact' }, render: Matrix.render };

/** The panel eases its height and fades (D-108); once closed it leaves the DOM. */
export const Motion: Story = {
  play: async ({ canvas, canvasElement }) => {
    const trigger = canvas.getByRole('button', { name: 'Thought for 12s' });
    await userEvent.click(trigger);
    const panel = canvasElement.querySelector<HTMLElement>('.motion-collapse');
    await expect(panel).not.toBeNull();
    await waitFor(() => expect(panel).toHaveAttribute('data-settled'));
    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.queryByText(/traced the null/)).toBeNull());
  },
};

/** Reduce motion on: the same toggles land at once. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  render: Matrix.render,
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'disclosure closed' });
    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.getAllByText('Panel content.')[0]).toBeVisible(), { timeout: 100 });
  },
};

function RevealDemo({ motion, defaultOpen = false }: { motion: RevealMotion; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `reveal-${motion}`;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-small text-fg-2">
        <IconButton
          size="sm"
          icon={open ? 'chevron-down' : 'chevron-right'}
          label={`${open ? 'Hide' : 'Show'} ${motion}`}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        />
        {motion}
      </span>
      <div className={motion === 'height' ? 'flex flex-col' : 'relative flex h-tile rounded-card border border-line-soft'}>
        <Reveal id={id} open={open} motion={motion} className={motion === 'slide-start' ? 'absolute inset-y-0 left-0' : undefined}>
          <div
            className={
              motion === 'height'
                ? 'rounded-card border border-line-soft bg-raised p-2.5 text-small text-fg-2'
                : 'h-full w-55 border-r border-line-soft bg-raised p-2.5 text-small text-fg-2'
            }
          >
            Content a control elsewhere shows and hides.
          </div>
        </Reveal>
        {motion === 'height' ? null : <div className="flex-1 p-2.5 text-small text-fg-3">Main column</div>}
      </div>
    </div>
  );
}

/** Reveal: shown / hidden by the caller's own control — height (inline), width (a docked side panel), slide-start (floating). */
export const RevealMotions: Story = {
  render: () => (
    <div className="flex w-120 flex-col gap-4">
      <RevealDemo motion="height" />
      <RevealDemo motion="width" defaultOpen />
      <RevealDemo motion="slide-start" />
    </div>
  ),
  play: async ({ canvas }) => {
    const show = canvas.getByRole('button', { name: 'Show height' });
    await userEvent.click(show);
    const hide = canvas.getByRole('button', { name: 'Hide height' });
    await expect(hide).toHaveAttribute('aria-expanded', 'true');
    const region = document.getElementById('reveal-height');
    await expect(region).not.toBeNull();
    await userEvent.click(hide);
    // Inert while it closes, gone once closed.
    await waitFor(() => expect(document.getElementById('reveal-height')).toBeNull());
  },
};

export const RevealReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  render: RevealMotions.render,
};
