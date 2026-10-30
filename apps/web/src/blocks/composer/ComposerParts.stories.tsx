// The composer's presentational parts (board ComposerStates). The connected
// `Composer` needs a server; each panel of the board is reproduced here from
// its pure parts, and the characterization suites cover the host.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within, waitFor } from 'storybook/test';
import type { ResolvedContextUsage } from '@generatorai/client-core';
import type { WorkspaceMount } from '@generatorai/shared';
import { AttachingChip, ComposerChip } from './parts/AttachmentChips.js';
import { AgentChip, OrchestratingChip, SkillsMcpChip, TeamRow } from './parts/Binding.js';
import { BlockingBar } from './parts/BlockingBar.js';
import { ComposerMenu } from './parts/ComposerMenu.js';
import { ComposerSkeleton } from './parts/ComposerSkeleton.js';
import { ContextGauge, ContextUsageDetails } from './parts/ContextGauge.js';
import { PopoverRoot } from '@/ui/primitives/Popover/Popover.js';
import { DictationControl } from './parts/DictationControl.js';
import { SendStopButton } from './parts/SendStopButton.js';
import { SourcesChipView } from './parts/SourcesChip.js';
import { ToolbarChip, ToolbarOption, ToolbarPopup, ToolbarPopupHeader } from './parts/ToolbarMenu.js';
import { ToolsPopover } from './parts/ToolsPopover.js';

const meta = {
  title: 'blocks/composer/Parts',
  tags: ['vrt-themes'],
  decorators: [(Story) => <div className="w-190 bg-surface p-6">{Story()}</div>],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const file = (name: string, type = 'text/plain') => new File(['x'], name, { type });

export const Skeleton: Story = { render: () => <ComposerSkeleton /> };

/** Blocking states, one bar at a time (prep_failed > preparing > waiting_on_you). */
export const BlockingBars: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <BlockingBar blocking="preparing" />
      <BlockingBar blocking="prep_failed" prepError="fix/checkout-flake is checked out elsewhere" onRetryPrep={fn()} onEditSources={fn()} />
      <BlockingBar blocking="waiting_on_you" waitingLabel="The agent is waiting for you to allow or deny a tool call." onCancelWaiting={fn()} />
      <BlockingBar blocking="running" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('workspace-prep-bar')).toHaveAttribute('role', 'status');
    await expect(canvas.getByTestId('workspace-prep-error')).toHaveTextContent('checked out elsewhere');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Cancel and send' })).toBeVisible());
  },
};

/** Send → Stop → Stopping… → Force reset (D-29: no queue). */
export const PrimaryControl: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <SendStopButton primaryAction="send" canSend={false} sending={false} onSend={fn()} />
      <SendStopButton primaryAction="send" canSend sending={false} onSend={fn()} />
      <SendStopButton primaryAction="send" canSend sending onSend={fn()} />
      <SendStopButton primaryAction="stop" canSend={false} sending={false} stopState={{ label: 'Stop', enabled: true, forceAvailable: false }} onSend={fn()} onStop={fn()} />
      <SendStopButton primaryAction="stopping" canSend={false} sending={false} stopState={{ label: 'Stopping…', enabled: false, forceAvailable: false }} onSend={fn()} onStop={fn()} />
      <SendStopButton primaryAction="force_reset" canSend={false} sending={false} stopState={{ label: 'Force reset', enabled: true, forceAvailable: true }} onSend={fn()} onStop={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('button', { name: 'Send message' })[0]).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Force reset' })).toBeEnabled();
  },
};

export const SlashMenu: Story = {
  render: () => (
    <div className="relative mt-80">
      <ComposerMenu
        open
        kind="slash"
        activeIndex={0}
        onSelect={fn()}
        onHover={fn()}
        footerNote="Then: Describe what to open, click, or verify in the browser…"
        items={[
          { id: 'b', title: '/browser', subtitle: 'Drive the integrated browser to test or verify a flow', icon: 'browser', badge: 'tool', group: 'Tools', monoTitle: true },
          { id: 't', title: '/terminal', subtitle: 'Run commands in the integrated terminal', icon: 'terminal', badge: 'tool', monoTitle: true },
          { id: 's', title: '/triage-flake', subtitle: 'Reproduce and isolate a flaky test', icon: 'skills', badge: 'skill', group: 'Skills', monoTitle: true },
          { id: 'p', title: '/release-notes', subtitle: 'Draft release notes from merged PRs', icon: 'file-text', badge: 'prompt', group: 'Prompts', monoTitle: true },
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText('Commands & skills')).toBeVisible());
    await waitFor(() => expect(canvas.getByRole('button', { name: /^\/browser/ })).toBeVisible());
  },
};

export const MentionMenu: Story = {
  render: () => (
    <div className="relative mt-60">
      <ComposerMenu
        open
        kind="mention"
        activeIndex={0}
        onSelect={fn()}
        onHover={fn()}
        items={[
          { id: '1', title: 'applyCoupon.ts', subtitle: 'src/cart/applyCoupon.ts', icon: 'file', badge: 'payments-api' },
          { id: '2', title: 'applyPromo.ts', subtitle: 'src/promo/applyPromo.ts', icon: 'file', badge: 'checkout-web' },
          { id: '3', title: 'apply-discount.md', subtitle: 'docs/pricing/apply-discount.md', icon: 'file' },
        ]}
      />
    </div>
  ),
};

export const Attachments: Story = {
  render: () => (
    <div className="flex flex-wrap gap-1.5">
      <ComposerChip file={file('ci-log-4412.txt')} label="ci-log-4412.txt" onRemove={fn()} />
      <ComposerChip file={file('checkout-error.png', 'image/png')} label="checkout-error.png" onRemove={fn()} />
      <ComposerChip file={file('applyCoupon.ts')} label="src/cart/applyCoupon.ts" kind="mention" onRemove={fn()} />
      <ComposerChip file={file('element-buy-1789123456789.md')} label="localhost:5173/checkout" kind="capture" icon="browser" onRemove={fn()} />
      <AttachingChip />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('composer-attachment')).toHaveLength(4);
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Remove ci-log-4412.txt' })).toBeVisible());
  },
};

export const Dictation: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <DictationControl isSupported status="idle" error={null} amplitude={0} onStart={fn()} onResume={fn()} onStop={fn()} onCancel={fn()} />
      <DictationControl isSupported status="listening" error={null} amplitude={0.6} onStart={fn()} onResume={fn()} onStop={fn()} onCancel={fn()} />
      <DictationControl isSupported status="paused" error={null} amplitude={0.2} onStart={fn()} onResume={fn()} onStop={fn()} onCancel={fn()} />
      <DictationControl isSupported status="connecting" error={null} amplitude={0} onStart={fn()} onResume={fn()} onStop={fn()} onCancel={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Start voice input' })).toBeEnabled();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Resume dictation' })).toBeVisible());
  },
};

/** Per-turn chips with the Agent mode list open above its chip. */
export const PerTurnMenus: Story = {
  render: () => (
    <div className="mt-40 flex items-center gap-1">
      <span className="relative inline-flex">
        <ToolbarChip icon="zap" aria-haspopup="listbox" aria-expanded aria-label="Agent mode: Auto">
          Auto
        </ToolbarChip>
        <ToolbarPopup widthClass="w-64" role="listbox" aria-label="Agent mode">
          <ToolbarPopupHeader>Agent mode</ToolbarPopupHeader>
          <ToolbarOption selected description="Works autonomously and applies changes directly.">
            Auto
          </ToolbarOption>
          <ToolbarOption selected={false} description="Proposes a plan and waits for your approval before implementing.">
            Plan
          </ToolbarOption>
        </ToolbarPopup>
      </span>
      <ToolbarChip title="Reasoning effort">Effort: <span className="capitalize">medium</span></ToolbarChip>
      <ToolbarChip title="Context window" className="font-mono">200K</ToolbarChip>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('option', { name: /Auto/ })).toHaveAttribute('aria-selected', 'true');
  },
};

const usage: ResolvedContextUsage = {
  used: 84_200,
  limit: 200_000,
  pct: 0.421,
  remaining: 115_800,
  source: 'provider',
  compactionThreshold: 160_000,
  breakdown: { system: 6120, tools: 14380, mcpTools: 3210, skills: 2940, conversation: 57550 },
} as ResolvedContextUsage;

export const GaugePopover: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <ContextGauge model={{ id: 'claude-sonnet-5', promptTokenLimit: 200_000 }} />
      {/* The details are the popover's body; its title needs the Popover root's context. */}
      <PopoverRoot>
        <div className="w-72 rounded-card border border-line bg-overlay p-3">
          <ContextUsageDetails resolved={usage} model={{ id: 'claude-sonnet-5', promptTokenLimit: 200_000, maxOutputTokens: 64_000 }} usage={null} />
        </div>
      </PopoverRoot>
    </div>
  ),
};

const mounts = [
  {
    id: 'm1',
    alias: 'payments-api',
    mode: 'worktree',
    originKind: 'folder',
    originPath: '/src/acme/payments-api',
    path: '/Users/sid/Library/Application Support/GeneratorAI/workspaces/executions/c1/source/payments-api',
    git: { isRepo: true, branch: 'fix/checkout-flake' },
  },
  { id: 'm2', alias: 'checkout-web', mode: 'in-place', originKind: 'folder', path: '/src/acme/checkout-web', git: { isRepo: true, branch: 'main' } },
  { id: 'm3', alias: 'notes', mode: 'in-place', originKind: 'folder', path: '/src/acme/notes', git: { isRepo: false } },
] as unknown as WorkspaceMount[];

/** A chat with no sources: the server's managed `main` mount (`git init -b main`). */
const emptyMount = [
  {
    id: 'g1',
    alias: 'main',
    mode: 'generated',
    originKind: 'generated',
    path: '/Users/sid/Library/Application Support/GeneratorAI/workspaces/executions/c2/source/main',
    git: { isRepo: true, branch: 'main' },
  },
] as unknown as WorkspaceMount[];

/** D-135: no "main" chip, no branch, no app-data path. */
export const SourcesEmptyWorkspace: Story = {
  render: () => (
    <div className="mt-60 flex items-center gap-2">
      <SourcesChipView
        mounts={emptyMount}
        fallback={{ projectLinked: false, codebases: [], codebasesLoading: false, folders: [], count: 0 }}
        onEditSources={fn()}
        onCopyPath={fn()}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Empty workspace/ }));
    const body = within(canvasElement.ownerDocument.body);
    await body.findByText(/The agent works in an empty folder of its own/);
    await expect(body.queryByText(/source\/main/)).toBeNull();
  },
};

export const SourcesAndSkills: Story = {
  render: () => (
    <div className="mt-60 flex items-center gap-2">
      <SourcesChipView
        mounts={mounts}
        projectName="payments-service"
        fallback={{ projectLinked: true, codebases: [], codebasesLoading: false, folders: [], count: 2 }}
        onEditSources={fn()}
        onCopyPath={fn()}
      />
      <SkillsMcpChip skills={['triage-flake', 'write-tests', 'git-hygiene', 'browser-verify']} mcpServers={['github', 'playwright']} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /payments-api/ }));
    const body = within(canvasElement.ownerDocument.body);
    const note = await body.findByText('Changes take effect from your next message.');
    await waitFor(() => expect(note).toBeVisible());
  },
};

export const Binding: Story = {
  render: () => (
    <div className="flex w-150 flex-col gap-3">
      <div className="flex items-center gap-2">
        <AgentChip name="Bug Fixer" />
        <OrchestratingChip running={3} onOpenTasks={fn()} />
      </div>
      <div className="rounded-dialog border border-line bg-raised">
        <TeamRow
          team={[
            { ref: 'a', name: 'Bug Fixer', model: 'claude-sonnet-5' },
            { ref: 'b', name: 'Code Reviewer', model: 'claude-sonnet-5' },
            { ref: 'c', name: 'Test Writer' },
          ]}
          running={3}
          onOpenTasks={fn()}
        />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('chat-agent-chip')).toHaveTextContent('Bug Fixer');
  },
};

export const ToolToggles: Story = {
  render: () => (
    <div className="mt-40">
      <ToolsPopover
        onToggle={fn()}
        items={[
          { id: 'workflows', label: 'Workflows', hint: 'Let this chat run workflows · off by default', icon: 'workflows', on: false, pending: false },
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Tools in this chat' }));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(async () => expect(await body.findByRole('switch', { name: 'Workflows' })).toBeVisible());
  },
};
