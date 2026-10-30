import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { Callout } from '../../primitives/Callout/Callout.js';
import { PageHeader } from '../../patterns/PageHeader/PageHeader.js';
import { Inspector } from '../../patterns/Inspector/Inspector.js';
import { CanvasEditor } from './CanvasEditor.js';

const meta = {
  component: CanvasEditor,
  tags: ['vrt-themes'],
  args: { header: null, canvas: null },
} satisfies Meta<typeof CanvasEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

// Demo frame size: fixed story scaffolding (a named constant, not a literal style).
const FRAME = { height: 640, width: 1200 };

function Canvas() {
  return (
    <div className="flex h-full items-center justify-center gap-10">
      {['Scan dependencies', 'Assess risk', 'Apply upgrades'].map((name) => (
        <div key={name} className="w-58 rounded-card border border-line bg-raised px-3 py-2.5 text-ui font-semibold text-fg">
          {name}
        </div>
      ))}
    </div>
  );
}

function Demo({ withProblems = false, withBanner = false }: { withProblems?: boolean; withBanner?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-panel border border-line-soft" style={FRAME}>
      <CanvasEditor
        header={
          <PageHeader
            title="Nightly dependency audit"
            titleIsHeading
            actions={<Button size="sm">Save</Button>}
            dockToggle={<IconButton icon="dock" label="Toggle inspector" pressed={open} onClick={() => setOpen((v) => !v)} />}
          />
        }
        canvas={<Canvas />}
        banner={withBanner ? <Callout tone="neutral" title="Drafted by Orchestrator in chat" /> : undefined}
        problems={withProblems ? <div className="p-3 text-small text-fg-2">3 errors · 1 warning</div> : undefined}
        inspector={
          open ? (
            <Inspector title="Assess risk" subtitle="assess_risk · Agent stage · 2 of 6">
              <div className="text-small text-fg-2">Inspector body</div>
            </Inspector>
          ) : undefined
        }
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Inspector body')).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Toggle inspector' }));
    await expect(c.queryByText('Inspector body')).not.toBeInTheDocument();
  },
};

export const WithProblems: Story = { render: () => <Demo withProblems /> };

export const WithBanner: Story = { render: () => <Demo withBanner /> };
