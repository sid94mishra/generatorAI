import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { StageKindPalette, type StageKindOption, type StageTemplateOption } from './StageKindPalette.js';

const KINDS: StageKindOption[] = [
  { kind: 'agent', icon: 'agents', name: 'Agent', hint: 'An agent turn (the default)' },
  { kind: 'check', icon: 'terminal', name: 'Check', hint: 'Runs one allowlisted command, no LLM', admin: true },
  { kind: 'loop', icon: 'repeat', name: 'Loop', hint: 'Repeats its body until a rule fires' },
  { kind: 'map', icon: 'layers', name: 'Map', hint: 'Runs its body once per item of a list' },
  { kind: 'subworkflow', icon: 'workflows', name: 'Sub-workflow', hint: 'Runs another published workflow' },
  { kind: 'wait', icon: 'hourglass', name: 'Wait', hint: 'Approval form, external event or timer' },
];

const TEMPLATES: StageTemplateOption[] = [
  { id: 'fixReviewLoop', title: 'Fix and review loop', description: 'A fixer and a reviewer repeat until the review approves' },
  { id: 'perFileMigration', title: 'Per-file migration', description: 'Migrate every file of a list, one mount per file' },
];

const meta = {
  component: StageKindPalette,
  args: { kinds: KINDS, templates: TEMPLATES, onPick: fn() },
  decorators: [
    (Story) => (
      <div className="w-97.5 rounded-card border border-line bg-overlay p-1 shadow-pop">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StageKindPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('option', { name: /Loop/ }));
    await expect(args.onPick).toHaveBeenCalledWith({ type: 'kind', kind: 'loop' });
  },
};

export const Filtered: Story = {
  args: { query: 'wait', onQueryChange: fn() },
};

export const LoadingTemplates: Story = {
  args: { templates: null },
};
