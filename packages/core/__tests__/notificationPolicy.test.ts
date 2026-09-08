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
    expect(planNotification(event('chat.question.asked', { chatId: 'c1' }))).toMatchObject({
      category: 'approval',
      route: '/chats/c1',
      requiredScope: 'read:chats',
    });
    expect(
      planNotification(event('chat.plan.review_requested', { chatId: 'c1', summary: 'Refactor' })),
    ).toMatchObject({ category: 'approval', route: '/chats/c1' });
  });

  it('notifies on a tool-permission prompt with a human title and lock-screen actions', () => {
    // The most time-critical gate: the agent is idle until someone answers,
    // and the answer is one tap — so the payload carries approve/deny.
    const plan = planNotification(
      event('chat.permission.requested', {
        chatId: 'c1',
        interactionId: 'i1',
        turnId: 't1',
        toolName: 'Bash',
        type: 'tool',
        description: 'Run a shell command',
        inputSummary: 'pnpm test',
        permissionMode: 'default',
      }),
    );
    expect(plan).toMatchObject({
      category: 'approval',
      title: 'Allow Bash: pnpm test?',
      body: 'Run a shell command',
      route: '/chats/c1/gate/i1',
      requiredScope: 'read:chats',
      threadId: 'chat:c1',
      interruption: 'timeSensitive',
      interaction: { chatId: 'c1', interactionId: 'i1', kind: 'permission', actions: ['approve', 'deny'] },
    });
  });

  it('moves a long tool input into the body instead of truncating the title', () => {
    const inputSummary = `cat ${'src/very/deep/path/component.tsx '.repeat(4)}| grep TODO`;
    const plan = planNotification(
      event('chat.permission.requested', {
        chatId: 'c1',
        interactionId: 'i1',
        toolName: 'Bash',
        inputSummary,
        description: 'Run a shell command',
      }),
    );
    expect(plan!.title).toBe('Allow Bash?');
    expect(plan!.body.startsWith('cat src/very/deep')).toBe(true);
  });

  it('collapses a multi-line tool input onto one line', () => {
    const plan = planNotification(
      event('chat.permission.requested', {
        chatId: 'c1',
        interactionId: 'i1',
        toolName: 'Write',
        inputSummary: 'src/a.ts\n\n  (12 lines)',
      }),
    );
    expect(plan!.title).toBe('Allow Write: src/a.ts (12 lines)?');
    expect(plan!.body).toBe('Your agent is waiting for permission to continue.');
  });

  it('refuses a permission prompt it cannot resolve', () => {
    // Without an interactionId there is nothing for Approve/Deny to act on,
    // and a button that fails silently is worse than no notification.
    expect(
      planNotification(event('chat.permission.requested', { chatId: 'c1', toolName: 'Bash' })),
    ).toBeNull();
  });

  it('deep-links a question and a plan review to their gate, without action buttons', () => {
    // A question needs reading before answering, so the notification opens
    // the gate rather than offering a blind approve/deny.
    const question = planNotification(
      event('chat.question.asked', {
        chatId: 'c1',
        interactionId: 'q1',
        questions: [{ id: 'a', header: 'Scope', question: 'Include the docs folder?', options: [] }],
      }),
    );
    expect(question).toMatchObject({
      category: 'approval',
      body: 'Include the docs folder?',
      route: '/chats/c1/gate/q1',
      interaction: { chatId: 'c1', interactionId: 'q1', kind: 'question' },
    });
    expect(question!.interaction!.actions).toBeUndefined();

    const plan = planNotification(
      event('chat.plan.review_requested', {
        chatId: 'c1',
        interactionId: 'p1',
        title: 'Refactor the auth layer',
        summary: 'Long multi-paragraph summary…',
      }),
    );
    expect(plan).toMatchObject({
      body: 'Refactor the auth layer',
      route: '/chats/c1/gate/p1',
      interaction: { chatId: 'c1', interactionId: 'p1', kind: 'plan' },
    });
  });

  it('uses the real event kind for questions (chat.question.asked, not chat.question_asked)', () => {
    // The policy once listened for `chat.question_asked`, which the server
    // never emits — so no phone was ever told about a question.
    expect(planNotification(event('chat.question_asked', { chatId: 'c1' }))).toBeNull();
    expect(planNotification(event('chat.question.asked', { chatId: 'c1' }))).not.toBeNull();
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
    expect(planNotification(event('chat.question.asked', {}))).toBeNull();
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
      event('chat.question.asked', { chatId: 'c1' }),
      event('chat.permission.requested', { chatId: 'c1', interactionId: 'i1', toolName: 'Bash' }),
      event('chat.plan.review_requested', { chatId: 'c1', interactionId: 'p1' }),
    ]) {
      const plan = planNotification(e);
      expect(plan!.requiredScope, e.kind).toMatch(/^read:/);
    }
  });

  it('URL-encodes ids in the gate route so a hostile id cannot escape the path', () => {
    const plan = planNotification(
      event('chat.permission.requested', { chatId: 'c/../x', interactionId: 'i?1', toolName: 'Bash' }),
    );
    expect(plan!.route).toBe('/chats/c%2F..%2Fx/gate/i%3F1');
  });

  it('routes chat notifications behind read:chats, not read:workflows', () => {
    // Getting this backwards leaks chat titles to a workflow-only device.
    expect(planNotification(event('chat.question.asked', { chatId: 'c1' }))!.requiredScope).toBe(
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
    const chat = planNotification(event('chat.question.asked', { chatId: 'r1' }));
    expect(run!.threadId).not.toBe(chat!.threadId);
  });
});
