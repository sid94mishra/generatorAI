import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import type { PermissionBlock } from '@generatorai/client-core';
import { PermissionCard } from './PermissionCard.js';

// Demo gates (D-45 scaffolding): a shell command, a multi-command line, a risky push, a tool.
const base: PermissionBlock = {
  type: 'permission',
  blockId: 1,
  interactionId: 'p1',
  toolName: 'Bash',
  permissionType: 'shell_exec',
  description: 'Lint the workspace before committing.',
  inputSummary: '{"command":"pnpm lint"}',
  permissionMode: 'acceptEdits',
  status: 'pending',
  risk: 'standard',
  title: 'Run this command?',
  kindLabel: 'Shell command',
  rememberRules: [{ kind: 'command', match: 'pnpm lint' }],
};

const chain: PermissionBlock = {
  ...base,
  interactionId: 'p2',
  description: 'Check the tree, test, then lint.',
  inputSummary: '{"command":"git status --short && pnpm -r test 2>&1 | tail -20 && pnpm lint"}',
  rememberRules: [
    { kind: 'command', match: 'git status' },
    { kind: 'command', match: 'pnpm test' },
    { kind: 'command', match: 'tail' },
    { kind: 'command', match: 'pnpm lint' },
  ],
};

const risky: PermissionBlock = {
  ...base,
  interactionId: 'p3',
  description: 'Publishes the branch so the agent can open a PR.',
  inputSummary: '{"command":"git push -u origin fix/checkout-flake"}',
  risk: 'risky',
  rememberRules: [],
  rememberRefusal: 'Risky requests always ask (uses the network, pushes to a git remote).',
};

const tool: PermissionBlock = {
  ...base,
  interactionId: 'p4',
  toolName: 'github_comment_issue',
  permissionType: 'other',
  description: 'Comment on a GitHub issue.',
  inputSummary: '{"number":12,"body":"Fixed in #14."}',
  title: 'Comment on a GitHub issue?',
  kindLabel: 'GitHub',
  rememberRules: [{ kind: 'tool', match: 'github_comment_issue' }],
};

const answer = fn();

const meta = {
  component: PermissionCard,
  tags: ['vrt-themes'],
  args: { permission: base, onAnswer: answer, rememberScope: 'chat' },
  decorators: [(Story) => <div className="w-160">{Story()}</div>],
} satisfies Meta<typeof PermissionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Pending in a chat: Deny · Allow pnpm lint for this chat · Allow once (↵). The scoped action remembers the rule. */
export const PendingChat: Story = {
  play: async ({ canvas }) => {
    answer.mockClear();
    const scoped = canvas.getByTestId('permission-allow-scope');
    await expect(scoped).toHaveTextContent('Allow pnpm lint for this chat');
    await expect(scoped).toHaveAccessibleName('Always allow pnpm lint in this chat');
    await userEvent.click(scoped);
    await expect(answer).toHaveBeenCalledWith('p1', 'allow', undefined, { remember: 'owner' });
    // ↵ stays Allow once.
    await userEvent.click(canvas.getByRole('button', { name: 'Allow once Bash' }));
    await expect(answer).toHaveBeenLastCalledWith('p1', 'allow');
  },
};

/** In a project: a second action remembers the rule for the whole project (every chat and run in it). */
export const PendingInProject: Story = {
  args: { projectScope: true },
  play: async ({ canvas }) => {
    answer.mockClear();
    const project = canvas.getByTestId('permission-allow-project');
    await expect(project).toHaveTextContent('Allow pnpm lint for this project');
    await expect(project).toHaveAccessibleName('Always allow pnpm lint in this project');
    await userEvent.click(project);
    await expect(answer).toHaveBeenCalledWith('p1', 'allow', undefined, { remember: 'project' });
  },
};

/** Allowed by a project rule: the outcome names the project, not the chat. */
export const AllowedForProject: Story = {
  args: {
    permission: { ...base, status: 'allowed', remembered: [{ kind: 'command', match: 'pnpm lint', scope: 'project' }] },
    onAnswer: undefined,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('permission-outcome')).toHaveTextContent('Allowed for this project: pnpm lint');
  },
};

/** Pending in a workflow run with a multi-command line: the label counts the rest; the name lists every rule. */
export const PendingRunChain: Story = {
  args: { permission: chain, rememberScope: 'run' },
  play: async ({ canvas }) => {
    const scoped = canvas.getByTestId('permission-allow-scope');
    await expect(scoped).toHaveTextContent('Allow git status +3 for this run');
    await expect(scoped).toHaveAccessibleName('Always allow git status, pnpm test, tail, pnpm lint in this run');
  },
};

/** A tool gate remembers the tool by name. */
export const PendingTool: Story = {
  args: { permission: tool, rememberScope: 'run' },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('permission-allow-scope')).toHaveTextContent('Allow github_comment_issue for this run');
  },
};

/** Risky (MG-04): never remembered — no scoped action, the reason is shown instead. */
export const PendingRisky: Story = {
  args: { permission: risky },
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId('permission-allow-scope')).toBeNull();
    await expect(canvas.getByTestId('permission-remember-refusal')).toHaveTextContent(/Risky requests always ask/);
    await expect(canvas.getByText('Risky')).toBeVisible();
  },
};

/** A host with no owner to remember for: Allow once only. */
export const PendingNoScope: Story = {
  args: { rememberScope: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId('permission-allow-scope')).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Allow once Bash' })).toBeVisible();
  },
};

/** Deny asks for an optional reason first (Esc cancels, ↵ confirms). */
export const Denying: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Deny Bash' }));
    await expect(canvas.getByRole('textbox')).toBeVisible();
    await expect(canvas.queryByTestId('permission-allow-scope')).toBeNull();
  },
};

/** Busy while an answer is in flight: every action is disabled. */
export const Busy: Story = {
  args: { busy: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('permission-allow-scope')).toBeDisabled();
  },
};

/** Settled by "Allow for this chat": the outcome names what was remembered. */
export const AllowedRemembered: Story = {
  args: { permission: { ...base, status: 'allowed', remembered: [{ kind: 'command', match: 'pnpm lint' }] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('permission-outcome')).toHaveTextContent('Allowed for this chat: pnpm lint');
  },
};

/** Settled states: allowed once, denied with a reason, expired. */
export const Settled: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      <PermissionCard {...args} permission={{ ...base, status: 'allowed' }} />
      <PermissionCard {...args} permission={{ ...base, interactionId: 'p5', status: 'denied', message: 'Run the tests first' }} />
      <PermissionCard {...args} permission={{ ...base, interactionId: 'p6', status: 'expired' }} />
    </div>
  ),
};
