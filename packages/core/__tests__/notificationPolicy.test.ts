import { describe, expect, it } from 'vitest';

import {
  isMutable,
  planNotification,
  type NotifiableEvent,
} from '../src/services/push/notificationPolicy.js';

const event = (kind: string, data?: Record<string, unknown>): NotifiableEvent => ({ kind, data });

describe('planNotification — what earns an interruption', () => {
  it('notifies when a stage is blocked on a human', () => {
    // The flagship case: a blocked run costs seconds to unblock but stalls
    // everything downstream until someone notices.
    const plan = planNotification(
      event('stage_run.awaiting_input', {
        workflowRunId: 'run-1',
        name: 'Deploy',
        prompt: 'Approve deployment to production?',
      }),
    );
    expect(plan).toMatchObject({
      category: 'approval',
      route: '/runs/run-1',
      requiredScope: 'read:workflows',
      interruption: 'timeSensitive',
    });
    expect(plan!.body).toContain('Approve deployment');
  });

  it('notifies on an agent question and a plan review', () => {
    expect(planNotification(event('chat.question_asked', { chatId: 'c1' }))).toMatchObject({
      category: 'approval',
      route: '/chats/c1',
      requiredScope: 'read:chats',
    });
    expect(
      planNotification(event('chat.plan.review_requested', { chatId: 'c1', summary: 'Refactor' })),
    ).toMatchObject({ category: 'approval', route: '/chats/c1' });
  });

  it('notifies on failure and completion', () => {
    expect(
      planNotification(event('workflow_run.failed', { workflowRunId: 'r1', error: 'boom' })),
    ).toMatchObject({ category: 'failed', route: '/runs/r1', interruption: 'active' });

    expect(planNotification(event('workflow_run.completed', { workflowRunId: 'r1' }))).toMatchObject(
      { category: 'completed', interruption: 'active' },
    );

    expect(
      planNotification(event('automation_execution.failed', { automationId: 'a1' })),
    ).toMatchObject({ category: 'failed', route: '/automations/a1' });
  });
});

describe('planNotification — what must NOT interrupt', () => {
  it('stays silent for high-frequency stream events', () => {
    // Notifying on these trains the user to dismiss without reading, which
    // destroys the value of the ones that matter.
    for (const kind of [
      'harness.token',
      'harness.tool_start',
      'harness.tool_complete',
      'harness.thinking',
      'harness.idle',
      'harness.usage',
      'harness.context_usage',
      'stage_run.running',
      'stage_run.queued',
      'stage_run.step_started',
      'stage_run.completed',
      'workflow_run.running',
      'workflow_run.starting',
      'automation_execution.progress',
      'workspace.changed',
      'checkpoint.created',
    ]) {
      expect(planNotification(event(kind, { workflowRunId: 'r1' })), kind).toBeNull();
    }
  });

  it('stays silent for an unknown event kind', () => {
    // A newer server emitting a kind this build does not know must not
    // produce a notification with an empty body.
    expect(planNotification(event('something.invented.later', { workflowRunId: 'r1' }))).toBeNull();
  });
});

describe('planNotification — robustness', () => {
  it('refuses to notify without a deep-link target', () => {
    // A notification that cannot navigate anywhere is worse than none: the
    // user is interrupted and then has to go hunting.
    expect(planNotification(event('stage_run.awaiting_input', { name: 'Deploy' }))).toBeNull();
    expect(planNotification(event('workflow_run.failed', { error: 'boom' }))).toBeNull();
    expect(planNotification(event('chat.question_asked', {}))).toBeNull();
  });

  it('tolerates missing or wrongly-typed data', () => {
    expect(() => planNotification(event('stage_run.awaiting_input', undefined))).not.toThrow();
    expect(
      planNotification(event('workflow_run.failed', { workflowRunId: 42 as unknown as string })),
    ).toBeNull();
  });

  it('falls back to a useful body when the detail is missing', () => {
    const plan = planNotification(event('workflow_run.failed', { workflowRunId: 'r1' }));
    expect(plan!.body.length).toBeGreaterThan(10);
  });

  it('clips a long body at a word boundary', () => {
    const error = `${'alpha bravo charlie delta echo foxtrot golf hotel '.repeat(5)}END`;
    const plan = planNotification(event('workflow_run.failed', { workflowRunId: 'r1', error }));

    expect(plan!.body.length).toBeLessThanOrEqual(121);
    expect(plan!.body.endsWith('…')).toBe(true);

    // The real property: the visible text is a PREFIX of the original that
    // ends where a word ended. Cutting mid-word ("alpha bra…") looks like
    // corruption on a lock screen.
    const visible = plan!.body.slice(0, -1);
    expect(error.startsWith(visible)).toBe(true);
    const nextChar = error.charAt(visible.length);
    expect(nextChar === ' ' || nextChar === '').toBe(true);
  });

  it('does not clip a body that already fits', () => {
    const plan = planNotification(event('workflow_run.failed', { workflowRunId: 'r1', error: 'Short.' }));
    expect(plan!.body).toBe('Short.');
  });
});

describe('planNotification — security', () => {
  it('declares a required scope on every notification', () => {
    // The body carries content (run names, error text). A device without
    // read access must never be told about it.
    for (const e of [
      event('stage_run.awaiting_input', { workflowRunId: 'r1' }),
      event('workflow_run.failed', { workflowRunId: 'r1' }),
      event('workflow_run.completed', { workflowRunId: 'r1' }),
      event('automation_execution.failed', { automationId: 'a1' }),
      event('chat.question_asked', { chatId: 'c1' }),
    ]) {
      const plan = planNotification(e);
      expect(plan!.requiredScope, e.kind).toMatch(/^read:/);
    }
  });

  it('routes chat notifications behind read:chats, not read:workflows', () => {
    // Getting this backwards leaks chat titles to a workflow-only device.
    expect(planNotification(event('chat.question_asked', { chatId: 'c1' }))!.requiredScope).toBe(
      'read:chats',
    );
  });
});

describe('notification muting', () => {
  it('never allows approvals to be muted', () => {
    // A user who mutes approvals silently blocks their own agents and then
    // wonders why nothing progresses.
    expect(isMutable('approval')).toBe(false);
    expect(isMutable('completed')).toBe(true);
    expect(isMutable('failed')).toBe(true);
  });
});

describe('notification threading', () => {
  it('groups by subject so a busy run collapses into one stack', () => {
    const a = planNotification(event('stage_run.awaiting_input', { workflowRunId: 'r1' }));
    const b = planNotification(event('workflow_run.failed', { workflowRunId: 'r1' }));
    expect(a!.threadId).toBe(b!.threadId);
    expect(a!.threadId).toBe('run:r1');
  });

  it('does not group unrelated subjects', () => {
    const run = planNotification(event('workflow_run.failed', { workflowRunId: 'r1' }));
    const chat = planNotification(event('chat.question_asked', { chatId: 'r1' }));
    expect(run!.threadId).not.toBe(chat!.threadId);
  });
});
