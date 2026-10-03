import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import { expect, fn, within } from 'storybook/test';
import { deriveSegments, type StreamBlock } from '@generatorai/client-core';
import { TranscriptProvider } from '../transcriptContext.js';
import { TurnBody } from './TurnBody.js';

// One agent response covering every block kind the transcript draws (demo scaffolding, D-45).
const BLOCKS: StreamBlock[] = [
  { type: 'thinking', blockId: 1, text: 'The test fails 1 in 5 runs: likely a race between the coupon request and the totals fetch.', isComplete: true },
  { type: 'text', blockId: 2, content: 'The race is between `applyCoupon()` and the totals fetch:\n\n```ts\nconst { discount } = await api.applyCoupon(code);\nsetTotals(recalculate(cart, discount));\n```\n' },
  { type: 'tool_call', blockId: 3, callId: 'c1', tool: 'Read', args: { file_path: 'tests/checkout.spec.ts' }, status: 'complete' },
  { type: 'tool_call', blockId: 4, callId: 'c2', tool: 'Grep', args: { pattern: 'applyCoupon' }, status: 'complete' },
  { type: 'tool_call', blockId: 5, callId: 'c3', tool: 'Bash', args: { command: 'pnpm test checkout --repeat 20' }, result: '3 of 20 failed', status: 'complete' },
  {
    type: 'tool_call',
    blockId: 6,
    callId: 'c4',
    tool: 'navigate_page',
    args: { url: 'localhost:5173/checkout' },
    result: { ok: false, error: 'BrowserService: max concurrent sessions (5) reached' },
    status: 'complete',
  },
  {
    type: 'tool_call',
    blockId: 7,
    callId: 'c5',
    tool: 'Edit',
    args: { file_path: 'src/cart/applyCoupon.ts', old_string: 'const totals = await api.getTotals(cart.id);', new_string: 'const { discount } = await api.applyCoupon(code);' },
    status: 'complete',
    fileOp: { kind: 'edit', filePath: 'src/cart/applyCoupon.ts', additions: 14, deletions: 6 },
  },
  { type: 'system', blockId: 8, message: 'MCP server "github" needs credentials; its tools are unavailable this turn.', category: 'warning' },
  {
    type: 'permission',
    blockId: 9,
    interactionId: 'p1',
    toolName: 'Bash',
    permissionType: 'shell_exec',
    description: 'Publishes the branch so the agent can open a PR.',
    inputSummary: 'git push -u origin fix/checkout-flake',
    permissionMode: 'default',
    status: 'pending',
    // MG-04: a push is risky — the card carries the neutral "Risky" badge.
    risk: 'risky',
  },
  {
    type: 'question',
    blockId: 10,
    interactionId: 'q1',
    status: 'pending',
    questions: [
      { id: 'scope', header: 'Scope', question: 'Should the fix also cover the cart page?', options: [{ label: 'Checkout only', description: 'Smallest change' }, { label: 'Checkout and cart' }], multiSelect: false, allowFreeform: true },
    ],
  },
  { type: 'plan', blockId: 11, planId: 'plan-1', revision: 3, title: 'Fix the checkout race', fileName: 'plan-3.md', summary: 'Derive totals from the coupon response.', status: 'awaiting_review', actions: ['implement_interactive', 'implement_autopilot'] },
  { type: 'text', blockId: 12, content: '| Run | Result |\n|---|---|\n| before | 3 of 20 failed |\n| after | 50 of 50 passed |' },
];

const meta = {
  component: TurnBody,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <TranscriptProvider
          value={{
            onOpenChanges: fn(),
            onOpenShell: fn(),
            onOpenPlan: fn(),
            onApprovePlan: fn(),
            onRequestPlanChanges: fn(),
            onAnswerQuestion: fn(),
            onAnswerPermission: fn(),
          }}
        >
          <div className="max-w-190 bg-surface p-5">{Story()}</div>
        </TranscriptProvider>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof TurnBody>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Settled: thinking, prose with code, grouped steps, a failed call with its error, a diff, a warning and the three gates. */
export const EveryBlockKind: Story = {
  args: { segments: deriveSegments(BLOCKS, { active: false }) },
  play: async ({ canvasElement }) => {
    // The risky permission gate shows the server's verdict; answering stays a click.
    await expect(within(canvasElement).getByText('Risky')).toBeInTheDocument();
  },
};

/** Streaming: live steps, the caret on the last answer. */
export const Streaming: Story = {
  args: {
    segments: deriveSegments(
      [...BLOCKS.slice(0, 5), { type: 'tool_call', blockId: 20, callId: 'c9', tool: 'Bash', args: { command: 'pnpm build' }, status: 'running' }, { type: 'text', blockId: 21, content: 'While the build runs: v12 renames the pack' }],
      { active: true },
    ),
    active: true,
    answerStreaming: true,
  },
};

const actionsFor = (viewMode: 'verbose' | 'summary') => ({
  onOpenChanges: fn(),
  onOpenShell: fn(),
  onOpenPlan: fn(),
  onApprovePlan: fn(),
  onRequestPlanChanges: fn(),
  onAnswerQuestion: fn(),
  onAnswerPermission: fn(),
  viewMode,
});

/** Verbose (G-06): every step ungrouped and open, its input and output shown. */
export const Verbose: Story = {
  args: { segments: deriveSegments(BLOCKS.slice(0, 7), { active: false }) },
  decorators: [(Story) => <TranscriptProvider value={actionsFor('verbose')}>{Story()}</TranscriptProvider>],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The Read, Grep, Bash, navigate and Edit steps are all open — none folded into a group.
    await expect(canvas.queryByTestId('step-group')).toBeNull();
    const toggles = canvasElement.querySelectorAll('[data-testid="step-row"] [aria-expanded]');
    for (const toggle of toggles) await expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // Read, Grep, Bash, navigate and Edit: five open panels.
    await expect(canvas.getAllByTestId('step-detail-panel')).toHaveLength(5);
  },
};

/** Summary (G-06) while a gate waits: the gate stays, then the latest answer — no step rows. */
export const SummaryLive: Story = {
  args: {
    segments: deriveSegments(
      [...BLOCKS.slice(0, 9), { type: 'text', blockId: 21, content: 'While the build runs: v12 renames the pack' }],
      { active: true },
    ),
    active: true,
    answerStreaming: true,
  },
  decorators: [(Story) => <TranscriptProvider value={actionsFor('summary')}>{Story()}</TranscriptProvider>],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelector('[data-gai-block="steps"]')).toBeNull();
    await expect(canvas.getByText('Risky')).toBeInTheDocument();
    await expect(canvas.getByText(/While the build runs/)).toBeInTheDocument();
    await expect(canvas.queryByText(/The race is between/)).toBeNull();
  },
};

/** Summary (G-06) while streaming: the latest answer and "Working · N steps" in place of the step rows. */
export const SummaryWorking: Story = {
  args: {
    segments: deriveSegments(
      [...BLOCKS.slice(0, 7), { type: 'text', blockId: 21, content: 'While the build runs: v12 renames the pack' }],
      { active: true },
    ),
    active: true,
    answerStreaming: true,
  },
  decorators: [(Story) => <TranscriptProvider value={actionsFor('summary')}>{Story()}</TranscriptProvider>],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelector('[data-gai-block="steps"]')).toBeNull();
    await expect(canvas.getByText('Working · 5 steps')).toBeInTheDocument();
    await expect(canvas.getByText(/While the build runs/)).toBeInTheDocument();
  },
};
