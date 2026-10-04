import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Button } from '../../primitives/Button/Button.js';
import { StatusBadge } from '../../primitives/StatusBadge/StatusBadge.js';
import { ActivityStageBar } from '../ActivityCard/ActivityCard.js';
import { DiffStat } from '../DiffStat/DiffStat.js';
import {
  ActivityListRow,
  ActivityPopoverBand,
  ActivityPopoverBody,
  ActivityPopoverCode,
  ActivityPopoverSection,
} from './ActivityPopover.js';

/**
 * The popover beside an Activity card or rail tile (D-92; board EnhActivityPopovers): what it is, what it
 * needs, where and how it runs, then actions. Shown here in the popup box the app gives it.
 */
const meta = {
  component: ActivityPopoverBody,
  tags: ['vrt-themes'],
  args: { kindIcon: 'chats', kindLabel: 'Chat', title: 'Upgrade React Flow to v12' },
  decorators: [(Story) => <div className="w-aside overflow-hidden rounded-panel border border-line bg-overlay shadow-pop">{Story()}</div>],
} satisfies Meta<typeof ActivityPopoverBody>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Chat · running. */
export const ChatRunning: Story = {
  args: {
    context: 'payments-web',
    status: <StatusBadge state="running" context="chat" />,
    band: <ActivityPopoverBand title="Editing src/graph/Canvas.tsx" />,
    details: [
      { label: 'Running for', value: '4m 12s', mono: true, meta: 'since 14:20' },
      { label: 'Agent', value: 'Frontend Dev' },
      { label: 'Model', value: 'Claude Opus 5.5' },
      { label: 'Effort', value: 'High' },
      { label: 'Workspace', value: 'feat/react-flow-12', mono: true, meta: 'worktree' },
    ],
    footerStart: <Button size="sm" shortcut={['↵']}>Open</Button>,
    footerEnd: <Button size="sm" variant="danger-ghost" icon="stop">Stop</Button>,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Stop' })).toBeVisible();
  },
};

/** Orchestrator · a worker asks: the gate inline (Deny / Allow once) and the workers. */
export const OrchestratorAsk: Story = {
  args: {
    kindIcon: 'users',
    kindLabel: 'Orchestrator',
    context: 'payments-service',
    title: 'Release 4.2 rollout',
    status: <StatusBadge state="needs_you" />,
    band: (
      <ActivityPopoverBand tone="warn" title="Worker api-migrator asks">
        <ActivityPopoverCode>pnpm db:migrate --env staging</ActivityPopoverCode>
        <div className="flex items-center gap-1.5">
          <span className="ml-auto flex gap-1.5">
            <Button size="sm">Deny</Button>
            <Button size="sm" variant="primary">Allow once</Button>
          </span>
        </div>
      </ActivityPopoverBand>
    ),
    details: [
      { label: 'Waiting', value: '1m 04s', meta: 'since 13:52' },
      { label: 'Agent', value: 'Release Captain' },
      { label: 'Model', value: 'Claude Opus 5.5' },
    ],
    sections: (
      <ActivityPopoverSection title="Workers" count={4}>
        <ActivityListRow icon="status-needs-you" tone="warn" name="api-migrator" detail="Sonnet 5" end="needs you" endTone />
        <ActivityListRow icon="status-running" tone="run" spin name="web-bundle" detail="Sonnet 5" end="running" />
        <ActivityListRow icon="status-succeeded" tone="ok" name="docs-writer" detail="Haiku 4.5" end="done" />
        <ActivityListRow icon="status-queued" name="smoke-tests" detail="Sonnet 5" end="queued" />
      </ActivityPopoverSection>
    ),
    footerStart: <Button size="sm" shortcut={['↵']}>Open</Button>,
    footerEnd: <Button size="sm" variant="danger-ghost" icon="stop">Stop all</Button>,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Workers' })).toBeVisible();
  },
};

/** Workflow run · stage approval (Review / Reject / Approve). */
export const WorkflowApproval: Story = {
  args: {
    kindIcon: 'workflows',
    kindLabel: 'Workflow run',
    context: 'platform-deps',
    title: 'Nightly dependency audit',
    status: <StatusBadge state="needs_you" />,
    band: (
      <ActivityPopoverBand tone="warn" title="Approve “Apply upgrades”" aside="stage 4 of 6">
        <ActivityStageBar stages={['done', 'done', 'done', 'ask', 'pending', 'pending']} />
        <p className="text-small text-fg-2">Upgrades 14 packages, 2 of them major (vite, zod).</p>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost">Review</Button>
          <span className="ml-auto flex gap-1.5">
            <Button size="sm">Reject</Button>
            <Button size="sm" variant="primary">Approve</Button>
          </span>
        </div>
      </ActivityPopoverBand>
    ),
    details: [
      { label: 'Waiting', value: '12m', meta: 'since 02:00' },
      { label: 'Trigger', value: 'Schedule' },
    ],
    footerStart: <Button size="sm" shortcut={['↵']}>Open run</Button>,
    footerEnd: <Button size="sm" variant="danger-ghost" icon="stop">Cancel run</Button>,
  },
};

/** Automation run · running. */
export const AutomationRunning: Story = {
  args: {
    kindIcon: 'automations',
    kindLabel: 'Automation run',
    context: 'ops',
    title: 'Hourly log triage',
    status: <StatusBadge state="running" />,
    band: (
      <ActivityPopoverBand title="Summarising 214 new errors" aside="step 2 of 3">
        <ActivityStageBar stages={['done', 'current', 'pending']} />
      </ActivityPopoverBand>
    ),
    details: [
      { label: 'Running for', value: '38s', mono: true, meta: 'since 14:00' },
      { label: 'Schedule', value: 'every hour' },
      { label: 'Today', value: '14 runs · 1 failed' },
    ],
    footerStart: <Button size="sm" shortcut={['↵']}>Open</Button>,
    footerEnd: <Button size="sm" variant="danger-ghost" icon="stop">Stop</Button>,
  },
};

/** Workflow run · failed: the error excerpt, Full log, Retry run, the stages. */
export const WorkflowFailed: Story = {
  args: {
    kindIcon: 'workflows',
    kindLabel: 'Workflow run',
    context: 'web-app',
    title: 'Deploy preview',
    status: <StatusBadge state="failed" />,
    band: (
      <ActivityPopoverBand tone="err" title="Stage · Typecheck" aside="exit 2">
        <ActivityPopoverCode tone="err">{"src/routes/preview.ts:41:7\nerror TS2322: Type 'string | undefined' is not assignable to type 'string'.\n\nFound 1 error."}</ActivityPopoverCode>
        <div className="flex items-center gap-1.5">
          <Button size="sm" icon="file-text">Full log</Button>
          <Button size="sm" variant="primary" icon="retry" className="ml-auto">Retry run</Button>
        </div>
      </ActivityPopoverBand>
    ),
    details: [
      { label: 'Failed', value: '13:33', mono: true },
      { label: 'Trigger', value: 'Manual' },
    ],
    sections: (
      <ActivityPopoverSection title="Stages" count={5}>
        <ActivityListRow icon="status-succeeded" tone="ok" name="Install" end="succeeded" />
        <ActivityListRow icon="status-failed" tone="err" name="Typecheck" end="failed" endTone />
        <ActivityListRow icon="status-skipped" name="Build" end="skipped" />
        <ActivityListRow icon="status-skipped" name="Deploy" end="skipped" />
        <ActivityListRow icon="status-skipped" name="Smoke test" end="skipped" />
      </ActivityPopoverSection>
    ),
    footerStart: <Button size="sm" shortcut={['↵']}>Open run</Button>,
    footerEnd: <Button size="sm" variant="ghost">Dismiss</Button>,
  },
};

/** Chat · failed: the provider error and Retry last prompt. */
export const ChatFailed: Story = {
  args: {
    context: 'auth-service',
    title: 'Refactor auth middleware',
    status: <StatusBadge state="failed" />,
    band: (
      <ActivityPopoverBand tone="err" title="Error">
        <ActivityPopoverCode tone="err">overloaded_error: the API is temporarily overloaded</ActivityPopoverCode>
        <div className="flex items-center gap-1.5">
          <Button size="sm" icon="file-text">Open</Button>
          <Button size="sm" variant="primary" icon="retry" className="ml-auto">Retry last prompt</Button>
        </div>
      </ActivityPopoverBand>
    ),
    details: [
      { label: 'Failed', value: '12:02', mono: true },
      { label: 'Agent', value: 'Backend Dev' },
      { label: 'Model', value: 'Claude Opus 5.5' },
      { label: 'Changes', value: <DiffStat added={40} removed={12} files={3} /> },
    ],
    footerStart: <Button size="sm" shortcut={['↵']}>Open</Button>,
    footerEnd: <Button size="sm" variant="ghost">Dismiss</Button>,
  },
};

/** Done: details only. */
export const Done: Story = {
  args: {
    title: 'Audit IAM policies',
    status: <StatusBadge state="succeeded" context="chat" />,
    details: [
      { label: 'Finished', value: '13:05', mono: true },
      { label: 'Agent', value: 'Security Bot' },
      { label: 'Changes', value: <DiffStat added={212} removed={48} files={9} /> },
    ],
    footerStart: <Button size="sm" shortcut={['↵']}>Open</Button>,
  },
};
