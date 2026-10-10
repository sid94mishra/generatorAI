import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge, type BadgeTone } from './Badge.js';

const TONES: BadgeTone[] = ['neutral', 'run', 'ok', 'warn', 'err'];

const meta = {
  component: Badge,
  tags: ['vrt-themes'],
  args: { children: 'Draft' },
  argTypes: { tone: { control: 'inline-radio', options: TONES }, size: { control: 'inline-radio', options: ['md', 'sm'] } },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every tone, plain / with icon / with a mono suffix. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {TONES.map((tone) => (
        <div key={tone} className="flex items-center gap-2">
          <Badge tone={tone}>Agent</Badge>
          <Badge tone={tone} icon="hand">
            1
          </Badge>
          <Badge tone={tone} suffix="v7">
            Published
          </Badge>
          <Badge tone={tone} size="sm">
            default
          </Badge>
        </div>
      ))}
    </div>
  ),
};

/** `size="sm"` next to a list row's name (the model picker's provider-flagged default). */
export const SmallInRow: Story = {
  render: () => (
    <span className="flex items-center gap-1.5 text-ui text-fg">
      GPT-6-Luna
      <Badge size="sm">default</Badge>
    </span>
  ),
};

export const LongText: Story = {
  args: { children: 'Worker for the nightly dependency audit', className: 'max-w-40 truncate' },
};
