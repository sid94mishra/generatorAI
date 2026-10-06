import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { DiffStat } from '../DiffStat/DiffStat.js';
import { ActivityListRow } from '../ActivityPopover/ActivityPopover.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { ActivityCard, ActivityStageBar, type ActivityCardProps } from './ActivityCard.js';

/** One Activity column row (D-92; board EnhActivityCards): kind tile, title + time, status line, stages, meta. */
const meta = {
  component: ActivityCard,
  tags: ['vrt-themes'],
  args: {
    kindIcon: 'workflows',
    kindLabel: 'Workflow run',
    title: 'PR review pipeline',
    time: '1:05',
    line: { tone: 'run', icon: 'status-running', text: 'Review diff', spin: true },
    stages: ['done', 'current', 'pending', 'pending'],
    meta: ['Stage 2 of 4'],
    metaEnd: 'payments-service',
    link: <a href="#run" />,
  },
  decorators: [(Story) => <div className="w-72 bg-ground p-2">{Story()}</div>],
} satisfies Meta<typeof ActivityCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: /PR review pipeline/ });
    await expect(link).toHaveAccessibleName('Workflow run: PR review pipeline');
    await expect(link).toHaveAccessibleDescription(/Review diff/);
    await expect(within(canvasElement).getByRole('img', { name: '1 of 4 stages done' })).toBeVisible();
  },
};

const card = (props: Partial<ActivityCardProps> & Pick<ActivityCardProps, 'title' | 'line' | 'kindIcon' | 'kindLabel'>) => (
  <ActivityCard link={<a href={`#${props.title}`} />} {...props} />
);

/** Running · every kind (blue = working, the icon says what it is). */
export const Running: Story = {
  render: () => (
    <div className="flex flex-col gap-0.5">
      {card({ kindIcon: 'chats', kindLabel: 'Chat', title: 'Upgrade React Flow to v12', time: '4:12', line: { tone: 'run', icon: 'status-running', text: 'Editing src/graph/Canvas.tsx', spin: true }, meta: ['Frontend Dev', 'Opus 5.5'], metaEnd: 'web' })}
      {card({ kindIcon: 'users', kindLabel: 'Orchestrator', title: 'Migrate billing to Stripe v3', time: '6:05', line: { tone: 'run', icon: 'status-running', text: '2 running · 1 done · 1 queued', spin: true }, meta: ['Orchestrator', '4 workers'] })}
      {card({ kindIcon: 'workflows', kindLabel: 'Workflow run', title: 'PR review pipeline', time: '1:05', line: { tone: 'run', icon: 'status-running', text: 'Review diff', spin: true }, stages: ['done', 'current', 'pending', 'pending'], meta: ['Stage 2 of 4'] })}
      {card({ kindIcon: 'automations', kindLabel: 'Automation run', title: 'Hourly log triage', time: '0:38', line: { tone: 'run', icon: 'status-running', text: 'Iteration 2 of 3', spin: true }, meta: ['Automation', 'every hour'] })}
      {card({ kindIcon: 'chats', kindLabel: 'Chat', title: 'Write migration guide', line: { tone: 'muted', icon: 'status-queued', text: 'Queued' }, meta: ['Docs Writer', 'Haiku 4.5'] })}
      {card({ kindIcon: 'workflows', kindLabel: 'Workflow run', title: 'Weekly dependency bump', time: '9:30', line: { tone: 'muted', icon: 'status-paused', text: 'Paused' }, stages: ['done', 'done', 'current', 'pending', 'pending'], meta: ['Stage 3 of 5'] })}
    </div>
  ),
};

/** Needs you · every ask (amber card; the line says what it wants). */
export const NeedsYou: Story = {
  render: () => (
    <div className="flex flex-col gap-0.5">
      {card({ tone: 'ask', kindIcon: 'chats', kindLabel: 'Chat', title: 'Fix flaky checkout test', time: '3m', line: { tone: 'warn', icon: 'hand', text: 'Allow git push?', mono: true }, meta: ['Bug Fixer', 'Sonnet 5'] })}
      {card({ tone: 'ask', kindIcon: 'chats', kindLabel: 'Chat', title: 'Set up preview deploys', time: '5m', line: { tone: 'warn', icon: 'info', text: 'Which region: eu-west or us-east?' }, meta: ['Infra Helper', 'Opus 5.5'] })}
      {card({ tone: 'ask', kindIcon: 'chats', kindLabel: 'Chat', title: 'Split the payments monolith', time: '8m', line: { tone: 'warn', icon: 'plan', text: 'Review plan “7 steps”' }, meta: ['Architect', 'Opus 5.5'] })}
      {card({ tone: 'ask', kindIcon: 'users', kindLabel: 'Orchestrator', title: 'Release 4.2 rollout', time: '1m', line: { tone: 'warn', icon: 'hand', text: 'api-migrator: Allow pnpm db:migrate?', mono: true }, lineExtra: <span>+1</span>, meta: ['Orchestrator', '4 workers'] })}
      {card({ tone: 'ask', kindIcon: 'workflows', kindLabel: 'Workflow run', title: 'Nightly dependency audit', time: '12m', line: { tone: 'warn', icon: 'hand', text: 'Approve “Apply upgrades”' }, stages: ['done', 'done', 'done', 'ask', 'pending', 'pending'], meta: ['Stage 4 of 6'] })}
      {card({ tone: 'ask', kindIcon: 'chats', kindLabel: 'Chat', title: 'Fill in the vendor form', time: '30s', line: { tone: 'warn', icon: 'pointer', text: 'Allow Safari?' }, meta: ['Operator', 'Sonnet 5'] })}
      {card({ tone: 'ask', kindIcon: 'workflows', kindLabel: 'Workflow run', title: 'Rotate staging secrets', time: '4m', line: { tone: 'warn', icon: 'pause', text: 'Paused — waiting for a decision' }, meta: ['Workflow run'] })}
    </div>
  ),
};

/** Finished today: grey once done, red until dismissed or retried; the blue dot = not opened yet. */
export const Finished: Story = {
  render: () => (
    <div className="flex flex-col gap-0.5">
      {card({ kindIcon: 'chats', kindLabel: 'Chat', title: 'Audit IAM policies', time: '13:05', line: { tone: 'ok', icon: 'status-succeeded', text: 'Done' }, lineExtra: <DiffStat added={212} removed={48} files={9} />, meta: ['Security Bot', 'Sonnet 5'] })}
      {card({ kindIcon: 'users', kindLabel: 'Orchestrator', title: 'Translate docs to 4 languages', time: '12:10', unread: true, line: { tone: 'ok', icon: 'status-succeeded', text: 'Done' }, lineExtra: <DiffStat added={1840} removed={22} />, meta: ['Orchestrator', '4 workers'] })}
      {card({ tone: 'fail', kindIcon: 'chats', kindLabel: 'Chat', title: 'Refactor auth middleware', time: '12m ago', line: { tone: 'err', icon: 'status-failed', text: '529 overloaded · provider error' }, meta: ['Backend Dev', 'Opus 5.5'] })}
      {card({ tone: 'fail', kindIcon: 'workflows', kindLabel: 'Workflow run', title: 'Deploy preview', time: '18m ago', line: { tone: 'err', icon: 'status-failed', text: 'pnpm typecheck exited 2', mono: true }, meta: ['Workflow run'] })}
      {card({ kindIcon: 'chats', kindLabel: 'Chat', title: 'Investigate memory leak', time: '11:20', line: { tone: 'muted', icon: 'status-skipped', text: 'Stopped' }, meta: ['Perf Analyst', 'Sonnet 5'] })}
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(', not opened yet')).toBeInTheDocument();
  },
};

/** States: selected (the open page), selected ask, long title, workers expanded inline. */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-0.5">
      {card({ selected: true, kindIcon: 'chats', kindLabel: 'Chat', title: 'Upgrade React Flow to v12', time: '4:12', line: { tone: 'run', icon: 'status-running', text: 'Editing src/graph/Canvas.tsx', spin: true }, meta: ['Frontend Dev', 'Opus 5.5'] })}
      {card({ selected: true, tone: 'ask', kindIcon: 'chats', kindLabel: 'Chat', title: 'Fix flaky checkout test', time: '3m', line: { tone: 'warn', icon: 'hand', text: 'Allow git push?', mono: true }, meta: ['Bug Fixer', 'Sonnet 5'] })}
      {card({ kindIcon: 'chats', kindLabel: 'Chat', title: 'Investigate why the nightly Playwright shard 3 of 4 times out on CI', time: '22:41', line: { tone: 'run', icon: 'status-running', text: 'Running pnpm e2e --shard 3/4', mono: true, spin: true }, meta: ['QA Agent', 'Sonnet 5'] })}
      {card({
        kindIcon: 'users',
        kindLabel: 'Orchestrator',
        title: 'Migrate billing to Stripe v3',
        time: '6:05',
        line: { tone: 'run', icon: 'status-running', text: '2 running · 1 needs you', spin: true },
        meta: ['Orchestrator', 'Sonnet 5'],
        trailing: <IconButton icon="chevron-up" label="Hide workers" size="sm" aria-expanded />,
        children: (
          <div className="mt-1.5 flex flex-col border-l border-line pl-2">
            <ActivityListRow icon="status-succeeded" tone="ok" name="schema-writer" end="done" />
            <ActivityListRow icon="status-running" tone="run" spin name="api-port" detail="billing/client.ts" end="2:10" />
            <ActivityListRow icon="status-needs-you" tone="warn" name="webhooks" detail="Allow curl?" end="needs you" endTone />
            <ActivityListRow icon="status-queued" name="e2e-runner" end="queued" />
          </div>
        ),
      })}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const links = within(canvasElement).getAllByRole('link');
    await expect(links[0]).toHaveAttribute('aria-current', 'page');
    await expect(within(canvasElement).getByRole('button', { name: 'Hide workers' })).toHaveAttribute('aria-expanded', 'true');
  },
};

/** Keyboard focus shows on the card (the link inside carries it). */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link');
    link.focus();
    await expect(link).toHaveFocus();
  },
};

/** The stage bar alone: done · current · ask · failed · pending. */
export const StageBar: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <ActivityStageBar stages={['done', 'current', 'pending', 'pending']} />
      <ActivityStageBar stages={['done', 'done', 'done', 'ask', 'pending', 'pending']} />
      <ActivityStageBar stages={['done', 'failed', 'pending', 'pending', 'pending']} />
    </div>
  ),
};

export const Compact: Story = { globals: { density: 'compact' } };
