import type { Meta, StoryObj } from '@storybook/react-vite';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { CanvasGroupNode } from './CanvasGroupNode.js';

function BodyStage({ name }: { name: string }) {
  return (
    <div className="flex min-h-24 w-48 flex-col rounded-card border border-line bg-raised p-3 text-ui">
      <span className="font-semibold">{name}</span>
      <span className="font-mono text-micro text-fg-3">{name.toLowerCase()}</span>
    </div>
  );
}

const LOOP_FOOTER = (
  <>
    <Icon concept="status-queued" size={12} />
    <span>until</span>
    <span className="font-mono text-fg-2">verdict == &apos;approve&apos;</span>
    <span>·</span>
    <span>stall</span>
    <span className="font-mono text-fg-2">no_changes</span>
    <span>×2</span>
    <span className="ml-auto font-mono">250 turns · $12</span>
  </>
);

const meta = {
  component: CanvasGroupNode,
  args: {
    kind: 'loop',
    name: 'Fix and review',
    stageKey: 'fix_review',
    badge: 'Loop · max',
    badgeValue: '5',
    actions: <IconButton icon="more" size="sm" label="Stage actions" />,
    footer: LOOP_FOOTER,
    children: (
      <div className="flex gap-14 px-7 pt-5">
        <BodyStage name="Fix" />
        <BodyStage name="Review" />
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="grid min-h-75 w-135 bg-sunken p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CanvasGroupNode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const MapNode: Story = {
  name: 'Map',
  args: {
    kind: 'map',
    name: 'Migrate files',
    stageKey: 'migrate_files',
    badge: 'Map',
    badgeValue: '×4 · ≤50',
    footer: (
      <>
        <span>for each in</span>
        <span className="font-mono text-fg-2">stages.scan.output.files</span>
        <span>·</span>
        <span>mount per item · merge</span>
      </>
    ),
  },
};

export const Selected: Story = {
  args: {
    selected: true,
    headerExtras: (
      <Badge tone="err" icon="status-failed">
        1
      </Badge>
    ),
  },
};
