import type { Meta, StoryObj } from '@storybook/react-vite';
import { STATUS_STATES } from '@generatorai/shared';
import { StatusDot, type DotTone } from './StatusDot.js';

const TONES: DotTone[] = ['neutral', 'muted', 'run', 'ok', 'warn', 'err'];

const meta = {
  component: StatusDot,
  tags: ['vrt-themes'],
  args: { state: 'running', label: 'Running' },
  argTypes: { state: { control: 'select', options: STATUS_STATES } },
} satisfies Meta<typeof StatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every state (md 8px) and tone at sm 6px, plus the rail ring form. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-small text-fg-2">
      <div className="flex items-center gap-3">
        {STATUS_STATES.map((state) => (
          <StatusDot key={state} state={state} label={state} />
        ))}
        <span>8px dots for dense rows</span>
      </div>
      <div className="flex items-center gap-3">
        {TONES.map((tone) => (
          <StatusDot key={tone} tone={tone} size="sm" />
        ))}
        <span>6px inline</span>
      </div>
      <div className="flex items-center gap-3 bg-ground p-2">
        <StatusDot tone="warn" ring label="Something needs you" />
        <span>7px with ground ring</span>
      </div>
    </div>
  ),
};

/** Decorative (no label): the text next to it carries the meaning. */
export const WithText: Story = {
  render: () => (
    <span className="inline-flex items-center gap-1.5 text-small text-fg-2">
      <StatusDot tone="ok" size="sm" /> Connected
    </span>
  ),
};
