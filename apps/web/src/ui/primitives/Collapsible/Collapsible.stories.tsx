import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { assertTargetSize } from '../../lib/test/targetSize.js';
import { Accordion, Collapsible, type CollapsibleVariant } from './Collapsible.js';

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
    await expect(canvas.getByText(/traced the null/)).toBeVisible();
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
