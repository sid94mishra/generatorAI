import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { AgentGlyph } from './AgentGlyph.js';

const SIZES = [12, 14, 16] as const;

const meta = {
  component: AgentGlyph,
  tags: ['vrt-themes'],
  argTypes: { size: { control: 'inline-radio', options: SIZES } },
} satisfies Meta<typeof AgentGlyph>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Icon-only — the EntityCard leading slot. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'Agent' })).toBeInTheDocument();
  },
};

/** With a trailing name — the workflow-surface form ("Bug Fixer"). */
export const WithName: Story = {
  args: { name: 'Bug Fixer' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Bug Fixer')).toBeInTheDocument();
  },
};

/** Every size, icon-only and with a name. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {SIZES.map((size) => (
        <div key={size} className="flex items-center gap-4">
          <AgentGlyph size={size} />
          <AgentGlyph size={size} name="Orchestrator" />
        </div>
      ))}
    </div>
  ),
};
