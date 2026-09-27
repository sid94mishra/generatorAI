import { describe, expect, it } from 'vitest';
import type { AutomationExecutionStatus, AutomationRunItemStatus } from '../../types/Automation.js';
import type { AgentInteractionStatus, PlanStatus } from '../../types/AgentMode.js';
import type { BackgroundTaskStatus, ChatStatus } from '../../types/Chat.js';
import type { ChatTurnStatus } from '../../types/ChatList.js';
import type { SessionStatus } from '../../types/Session.js';
import type { CheckConclusion, DeviceLoginStatus, ScmFlowResult, ScmFlowStep } from '../../types/SourceControl.js';
import type { WidgetInstanceStatus } from '../../types/Widget.js';
import type { StageRunStatus } from '../../types/WorkflowRun.js';
import type { BrowserSessionStatus } from '../../types/Workspace.js';
import {
  CHANGE_KIND,
  HEALTH,
  STATUS_MAPS,
  STATUS_STATES,
  STATUS_STATE_DEFS,
  chatActivity,
  isStatusState,
  resolveMapping,
  resolveStatus,
  toStatus,
  toolCallStatus,
  type HookInvocationStatus,
  type PermissionStatus,
  type QuestionStatus,
  type ReviewThreadStatus,
  type RunStatus,
  type StatusDomain,
  type StreamStatus,
  type ToolCallStatus,
  type WidgetBlockStatus,
} from '../index.js';

// Every union value, as a Record so the COMPILER checks the list is complete:
// a value added to a union fails `pnpm typecheck` here as well as in maps.ts.
type Every<U extends string> = Record<U, true>;
const every = <U extends string>(r: Every<U>): string[] => Object.keys(r).sort();

const UNION_VALUES: Record<StatusDomain, string[]> = {
  workflowRun: every<RunStatus>({ created: true, pending: true, starting: true, running: true, waiting: true, paused: true, finalizing: true, cancelling: true, completed: true, failed: true, cancelled: true }),
  stageRun: every<StageRunStatus>({ pending: true, ready: true, starting: true, running: true, validating: true, awaiting_input: true, waiting: true, retry_wait: true, paused: true, completed: true, failed: true, skipped: true, cancelled: true }),
  automationExecution: every<AutomationExecutionStatus>({ pending: true, running: true, completed: true, partial: true, failed: true, cancelled: true }),
  automationRunItem: every<AutomationRunItemStatus>({ pending: true, running: true, completed: true, failed: true, cancelled: true }),
  backgroundTask: every<BackgroundTaskStatus>({ spawned: true, running: true, needs_review: true, completed: true, failed: true, cancelled: true }),
  chat: every<ChatStatus>({ active: true, archived: true }),
  chatTurn: every<ChatTurnStatus>({ succeeded: true, failed: true, cancelled: true }),
  stream: every<StreamStatus>({ idle: true, pending: true, streaming: true, thinking: true, complete: true, error: true }),
  session: every<SessionStatus>({ created: true, active: true, paused: true, closing: true, closed: true, error: true }),
  toolCall: every<ToolCallStatus>({ running: true, complete: true }),
  hook: every<HookInvocationStatus>({ running: true, ok: true, failed: true }),
  question: every<QuestionStatus>({ pending: true, answered: true, expired: true }),
  permission: every<PermissionStatus>({ pending: true, allowed: true, denied: true, expired: true }),
  plan: every<PlanStatus>({ drafting: true, recorded: true, awaiting_review: true, changes_requested: true, approved: true, rejected: true, superseded: true, expired: true }),
  interaction: every<AgentInteractionStatus>({ pending: true, approved: true, changes_requested: true, answered: true, rejected: true, cancelled: true, expired: true, failed: true }),
  reviewThread: every<ReviewThreadStatus>({ draft: true, pending: true, submitted: true, addressed: true, resolved: true, outdated: true }),
  ciCheck: every<CheckConclusion>({ pending: true, success: true, failure: true, neutral: true, cancelled: true, unknown: true }),
  scmStep: every<ScmFlowStep['status']>({ done: true, skipped: true, failed: true, blocked: true }),
  scmResult: every<ScmFlowResult['status']>({ ok: true, conflicts: true, blocked: true, failed: true }),
  deviceLogin: every<DeviceLoginStatus['status']>({ pending: true, complete: true, expired: true, error: true }),
  widget: every<WidgetInstanceStatus>({ active: true, suspended: true, closed: true, error: true }),
  browserSession: every<BrowserSessionStatus>({ off: true, starting: true, active: true, idle: true, terminated: true, error: true }),
};

/**
 * The mapping table of 02-design-system-spec.md §7.3, verbatim:
 * `value → state` or `value → state "Label"`, or `value → null`.
 */
const TABLE: Record<StatusDomain, string> = {
  workflowRun: 'created → queued; pending → queued; starting → running "Starting"; running → running; waiting → waiting; paused → paused; finalizing → running "Finalizing"; cancelling → running "Cancelling"; completed → succeeded; failed → failed; cancelled → skipped "Cancelled"',
  stageRun: 'pending → queued; ready → queued "Ready"; starting → running "Starting"; running → running; validating → running "Validating"; awaiting_input → needs_you; waiting → waiting; retry_wait → waiting "Retrying"; paused → paused; completed → succeeded; failed → failed; skipped → skipped; cancelled → skipped "Cancelled"',
  automationExecution: 'pending → queued; running → running; completed → succeeded; partial → failed "Partly failed"; failed → failed; cancelled → skipped "Cancelled"',
  automationRunItem: 'pending → queued; running → running; completed → succeeded; failed → failed; cancelled → skipped "Cancelled"',
  backgroundTask: 'spawned → queued "Starting"; running → running; needs_review → needs_you "Needs review"; completed → succeeded "Done"; failed → failed; cancelled → skipped "Cancelled"',
  chat: 'active → null; archived → null',
  chatTurn: 'succeeded → succeeded; failed → failed; cancelled → skipped "Cancelled"',
  stream: 'idle → null; pending → running "Starting"; streaming → running; thinking → running "Thinking"; complete → succeeded "Done"; error → failed',
  session: 'created → queued; active → null; paused → paused; closing → running "Closing"; closed → null; error → failed',
  toolCall: 'running → running; complete → succeeded',
  hook: 'running → running; ok → succeeded; failed → failed',
  question: 'pending → needs_you; answered → succeeded "Answered"; expired → skipped "Expired"',
  permission: 'pending → needs_you; allowed → succeeded "Allowed"; denied → skipped "Denied"; expired → skipped "Expired"',
  plan: 'drafting → running "Drafting"; recorded → succeeded "Recorded"; awaiting_review → needs_you "Review"; changes_requested → running "Revising"; approved → succeeded "Approved"; rejected → skipped "Rejected"; superseded → skipped "Superseded"; expired → skipped "Expired"',
  interaction: 'pending → needs_you; approved → succeeded "Approved"; changes_requested → succeeded "Changes requested"; answered → succeeded "Answered"; rejected → skipped "Rejected"; cancelled → skipped "Cancelled"; expired → skipped "Expired"; failed → failed',
  reviewThread: 'draft → queued "Draft"; pending → queued "Pending"; submitted → running "Sent"; addressed → succeeded "Addressed"; resolved → succeeded "Resolved"; outdated → skipped "Outdated"',
  ciCheck: 'pending → running; success → succeeded; failure → failed; neutral → skipped "Neutral"; cancelled → skipped "Cancelled"; unknown → null',
  scmStep: 'done → succeeded; skipped → skipped; failed → failed; blocked → needs_you "Blocked"',
  scmResult: 'ok → succeeded; conflicts → needs_you "Conflicts"; blocked → needs_you "Blocked"; failed → failed',
  deviceLogin: 'pending → needs_you "Enter code"; complete → succeeded "Connected"; expired → skipped "Expired"; error → failed',
  widget: 'active → null; suspended → paused "Suspended"; closed → null; error → failed',
  browserSession: 'off → null; starting → running "Starting"; active → null; idle → null; terminated → skipped "Closed"; error → failed',
};

function render(domain: StatusDomain): string {
  const map = STATUS_MAPS[domain] as Record<string, { state: string; label?: string } | null>;
  return Object.entries(map)
    .map(([value, mapping]) =>
      mapping === null ? `${value} → null` : `${value} → ${mapping.state}${mapping.label ? ` "${mapping.label}"` : ''}`,
    )
    .join('; ');
}

const DOMAINS = Object.keys(STATUS_MAPS) as StatusDomain[];

describe('status states (02 §7.1)', () => {
  it('has the eight states in order with glyph, tone and badge', () => {
    expect(STATUS_STATES).toEqual(['queued', 'running', 'waiting', 'needs_you', 'paused', 'succeeded', 'failed', 'skipped']);
    expect(Object.keys(STATUS_STATE_DEFS)).toEqual([...STATUS_STATES]);
    expect(STATUS_STATE_DEFS.running).toMatchObject({ glyph: 'status-running', tone: 'run', badge: 'run', spin: true });
    expect(STATUS_STATE_DEFS.needs_you).toMatchObject({ label: 'Needs you', glyph: 'status-needs-you', tone: 'warn' });
    expect(STATUS_STATES.filter((s) => STATUS_STATE_DEFS[s].spin)).toEqual(['running']);
  });

  it('isStatusState accepts states only', () => {
    expect(isStatusState('needs_you')).toBe(true);
    expect(isStatusState('completed')).toBe(false);
    expect(isStatusState(undefined)).toBe(false);
  });
});

describe('status maps (02 §7.3)', () => {
  it('covers exactly the values of every union', () => {
    expect(DOMAINS.sort()).toEqual(Object.keys(UNION_VALUES).sort());
    for (const domain of DOMAINS) {
      expect(Object.keys(STATUS_MAPS[domain]).sort(), domain).toEqual(UNION_VALUES[domain]);
    }
  });

  it.each(DOMAINS)('%s matches the spec table', (domain) => {
    expect(render(domain)).toBe(TABLE[domain]);
  });

  it('maps only to known states', () => {
    for (const domain of DOMAINS) {
      for (const mapping of Object.values(STATUS_MAPS[domain] as Record<string, { state: string } | null>)) {
        if (mapping) expect(isStatusState(mapping.state), domain).toBe(true);
      }
    }
  });

  it('transcript widget blocks are a subset of widget instances', () => {
    const block: Record<WidgetBlockStatus, true> = { active: true, closed: true, error: true };
    for (const value of Object.keys(block)) expect(value in STATUS_MAPS.widget).toBe(true);
  });
});

describe('labels', () => {
  it('chat domain says Done for succeeded', () => {
    expect(resolveMapping({ state: 'succeeded' }, 'chat').label).toBe('Done');
    expect(resolveStatus('stream', 'complete')?.label).toBe('Done');
  });

  it('mapping label beats domain label beats default word', () => {
    expect(resolveStatus('workflowRun', 'cancelled')).toMatchObject({ state: 'skipped', label: 'Cancelled' });
    expect(resolveStatus('workflowRun', 'completed')?.label).toBe('Succeeded');
    expect(resolveStatus('stageRun', 'awaiting_input')?.label).toBe('Needs you');
    expect(resolveStatus('chat', 'archived')).toBeNull();
  });

  it('toStatus returns the raw mapping', () => {
    expect(toStatus('plan', 'awaiting_review')).toEqual({ state: 'needs_you', label: 'Review' });
    expect(toStatus('ciCheck', 'unknown')).toBeNull();
  });
});

describe('helpers', () => {
  it('toolCallStatus treats a completed call with error as failed', () => {
    expect(toolCallStatus({ status: 'running' }).state).toBe('running');
    expect(toolCallStatus({ status: 'complete' }).state).toBe('succeeded');
    expect(toolCallStatus({ status: 'complete', error: true }).state).toBe('failed');
    expect(toolCallStatus({ status: 'running', error: true }).state).toBe('running');
  });

  it('chatActivity: a pending interaction outranks the stream', () => {
    expect(chatActivity({ stream: 'streaming', pendingInteraction: true })).toEqual({ state: 'needs_you' });
    expect(chatActivity({ stream: 'idle', pendingInteraction: true })).toEqual({ state: 'needs_you' });
    expect(chatActivity({ stream: 'thinking', pendingInteraction: false })).toEqual({ state: 'running', label: 'Thinking' });
    expect(chatActivity({ stream: 'idle', pendingInteraction: false })).toBeNull();
  });
});

describe('non-run maps', () => {
  it('health tones', () => {
    expect(HEALTH.connection.reconnecting.tone).toBe('warn');
    expect(HEALTH.codebase.cloning.tone).toBe('run');
    expect(HEALTH.computerRuntime.stopped.tone).toBe('idle');
  });

  it('change kinds: removed renders as deleted', () => {
    expect(CHANGE_KIND.removed).toEqual(CHANGE_KIND.deleted);
    expect(Object.values(CHANGE_KIND).map((k) => k.letter)).toEqual(['A', 'M', 'D', 'D', 'R', 'U', 'I']);
  });
});
