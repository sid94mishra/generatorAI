import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ProblemsPanel, type ProblemRow } from './ProblemsPanel.js';

const ROWS: ProblemRow[] = [
  {
    id: '1',
    severity: 'error',
    target: 'Assess risk',
    code: 'undeclared-variable',
    message: "'risk_threshold' is not a declared variable",
    hint: 'Used in prompt 1, line 7.',
    fix: { label: 'Declare', title: "Declare variable 'risk_threshold'", onApply: fn() },
    onGoTo: fn(),
  },
  {
    id: '2',
    severity: 'error',
    target: 'Notify owner',
    code: 'unknown-stage-key',
    message: 'Guard reads stages.run_test.output. No stage has key run_test.',
    hint: 'Did you mean run_tests?',
    onGoTo: fn(),
  },
  {
    id: '3',
    severity: 'error',
    target: 'Run test suite → Open PR',
    code: 'edge-pair',
    message: 'Two edges join the same pair of stages.',
    hint: 'Keep one and delete the other.',
    onGoTo: fn(),
  },
  {
    id: '4',
    severity: 'warning',
    target: 'Run test suite',
    code: 'permission-gating',
    message: 'Codex asks per command, not per tool, in Default mode.',
    onGoTo: fn(),
  },
];

const meta = {
  component: ProblemsPanel,
  args: { rows: ROWS, checkedAt: new Date(2026, 8, 27, 14, 7), onCheckAgain: fn(), onClose: fn() },
  decorators: [
    (Story) => (
      <div className="w-full max-w-240 border-t border-line-soft bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProblemsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ErrorsAndWarnings: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('3 errors')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Declare' }));
    await expect(args.rows[0]!.fix!.onApply).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'Go to Notify owner' }));
    await expect(args.rows[1]!.onGoTo).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'Check again' }));
    await expect(args.onCheckAgain).toHaveBeenCalled();
  },
};

export const WarningsOnly: Story = { args: { rows: ROWS.filter((r) => r.severity === 'warning') } };

export const WorkflowLevel: Story = {
  args: {
    rows: [{ id: 'w', severity: 'error', code: 'schema', message: 'Workflow name is required' }],
    onClose: undefined,
  },
};

export const Clean: Story = { args: { rows: [] } };
