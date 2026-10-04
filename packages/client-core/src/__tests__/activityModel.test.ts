import { describe, expect, it } from 'vitest';
import type { AttentionItem, RecentActivityItem } from '@generatorai/shared';
import {
  askDetailLine,
  activityDismissKey,
  activityMatchesPath,
  activityStages,
  activityTimeLabel,
  buildActivityModel,
  describeActivityMeta,
  describeActivityNow,
  flattenActivity,
  workerTallyLine,
} from '../activity/index.js';

const T = (min: number) => new Date(Date.UTC(2026, 9, 4, 10, min)).toISOString();

function live(over: Partial<AttentionItem> & Pick<AttentionItem, 'key' | 'entity' | 'entityId'>): AttentionItem {
  return { title: over.entityId, href: `/x/${over.entityId}`, state: 'running', since: T(0), stoppable: false, ...over };
}

function ask(over: Partial<AttentionItem> & Pick<AttentionItem, 'key' | 'entity' | 'entityId'>): AttentionItem {
  return live({
    state: 'needs_you',
    ask: { kind: 'tool_permission', id: `${over.entityId}-g`, summary: 'Allow Bash?', actions: ['allow_once', 'deny', 'open'] },
    ...over,
  });
}

function done(over: Partial<RecentActivityItem> & Pick<RecentActivityItem, 'key' | 'entity' | 'entityId'>): RecentActivityItem {
  return { title: over.entityId, href: `/x/${over.entityId}`, endedAt: T(0), outcome: 'succeeded', summary: 'Turn completed', ...over };
}

const tally = { total: 4, running: 2, queued: 1, inReview: 0, done: 1, failed: 0 };

describe('buildActivityModel — groups and order', () => {
  it('orders Needs you oldest first, Failed and Recent newest first, Running longest first', () => {
    const model = buildActivityModel({
      attention: {
        needsYou: [
          ask({ key: 'chat:b:g', entity: 'chat', entityId: 'b', since: T(5) }),
          ask({ key: 'chat:a:g', entity: 'chat', entityId: 'a', since: T(1) }),
        ],
        running: [
          live({ key: 'workflow_run:r1', entity: 'workflow_run', entityId: 'r1', since: T(2) }),
          live({ key: 'chat:c', entity: 'chat', entityId: 'c', since: T(7) }),
        ],
      },
      recent: [
        done({ key: 'chat:d', entity: 'chat', entityId: 'd', endedAt: T(9) }),
        done({ key: 'run:f1', entity: 'run', entityId: 'f1', endedAt: T(4), outcome: 'failed', summary: 'pnpm typecheck exited 2' }),
        done({ key: 'run:f2', entity: 'run', entityId: 'f2', endedAt: T(8), outcome: 'failed', summary: 'boom' }),
        done({ key: 'chat:e', entity: 'chat', entityId: 'e', endedAt: T(3), outcome: 'cancelled' }),
      ],
    });
    expect(model.groups.needs_you.map((e) => e.entityId)).toEqual(['a', 'b']);
    expect(model.groups.failed.map((e) => e.entityId)).toEqual(['f2', 'f1']);
    expect(model.groups.running.map((e) => e.entityId)).toEqual(['r1', 'c']);
    expect(model.groups.recent.map((e) => e.entityId)).toEqual(['d', 'e']);
    expect(model.groups.recent[1]).toMatchObject({ state: 'skipped', outcome: 'cancelled' });
    expect(model.groups.failed[0]).toMatchObject({ kind: 'workflow', entity: 'workflow_run', key: 'workflow_run:f2' });
    expect(model.header).toEqual({ needsYou: 2, running: 2, failed: 2 });
    expect(flattenActivity(model).map((e) => e.entityId)).toEqual(['a', 'b', 'f2', 'f1', 'r1', 'c', 'd', 'e']);
  });

  it('shows several asks of one chat as one card, oldest ask first', () => {
    const model = buildActivityModel({
      attention: {
        needsYou: [
          ask({ key: 'chat:a:g2', entity: 'chat', entityId: 'a', since: T(4), ask: { kind: 'question', id: 'g2', summary: 'Which?', actions: ['answer', 'open'] } }),
          ask({ key: 'chat:a:g1', entity: 'chat', entityId: 'a', since: T(2) }),
        ],
        running: [],
      },
      recent: [],
    });
    expect(model.groups.needs_you).toHaveLength(1);
    expect(model.groups.needs_you[0]!.ask?.id).toBe('a-g');
    expect(model.groups.needs_you[0]!.asks.map((i) => i.key)).toEqual(['chat:a:g1', 'chat:a:g2']);
    expect(model.header.needsYou).toBe(1);
  });

  it('shows a worker\'s ask on its orchestrator, which then leaves Running', () => {
    const model = buildActivityModel({
      attention: {
        needsYou: [
          ask({
            key: 'chat:w1:g',
            entity: 'chat',
            entityId: 'w1',
            title: 'api-migrator',
            href: '/chats/orch?dock=tasks',
            parent: { entity: 'chat', id: 'orch', title: 'Release 4.2 rollout' },
            ask: { kind: 'tool_permission', id: 'g', summary: 'Allow Bash?', detail: 'pnpm db:migrate --env staging', actions: ['allow_once', 'deny', 'open'] },
          }),
        ],
        running: [live({ key: 'chat:orch', entity: 'chat', entityId: 'orch', meta: { workers: tally }, stoppable: true })],
      },
      recent: [],
    });
    expect(model.groups.running).toEqual([]);
    const card = model.groups.needs_you[0]!;
    expect(card).toMatchObject({
      key: 'chat:orch',
      kind: 'orchestrator',
      entityId: 'orch',
      title: 'Release 4.2 rollout',
      worker: { id: 'w1', title: 'api-migrator' },
      meta: { workers: tally },
      stoppable: true,
    });
    expect(card.live?.key).toBe('chat:orch');
    expect(describeActivityNow(card)).toEqual({
      tone: 'warn',
      icon: 'hand',
      text: 'api-migrator: Allow pnpm db:migrate --env staging?',
      mono: true,
    });
    expect(model.counts).toMatchObject({ all: 1, orchestrator: 1, chat: 0 });
  });

  it('never lists a live entity as finished, and keeps one finished card per entity', () => {
    const model = buildActivityModel({
      attention: { needsYou: [], running: [live({ key: 'chat:a', entity: 'chat', entityId: 'a' })] },
      recent: [
        done({ key: 'chat:a', entity: 'chat', entityId: 'a', outcome: 'failed' }),
        done({ key: 'automation_execution:x', entity: 'automation_execution', entityId: 'x', endedAt: T(9) }),
        done({ key: 'automation_execution:x', entity: 'automation_execution', entityId: 'x', endedAt: T(2) }),
      ],
    });
    expect(model.groups.failed).toEqual([]);
    expect(model.groups.recent.map((e) => e.key)).toEqual(['automation_execution:x']);
    expect(model.groups.recent[0]!.kind).toBe('automation');
  });

  it('hides a dismissed failure, but a newer failure of the same entity shows again', () => {
    const first = done({ key: 'run:r', entity: 'run', entityId: 'r', outcome: 'failed', endedAt: T(1) });
    const dismissed = new Set([activityDismissKey(first)]);
    expect(buildActivityModel({ attention: null, recent: [first], dismissed }).groups.failed).toEqual([]);
    const again = { ...first, endedAt: T(30) };
    expect(buildActivityModel({ attention: null, recent: [again], dismissed }).groups.failed).toHaveLength(1);
  });

  it('counts per kind before the kind filter; the filter narrows the groups only', () => {
    const input = {
      attention: {
        needsYou: [ask({ key: 'workflow_run:r:s', entity: 'workflow_run' as const, entityId: 'r' })],
        running: [
          live({ key: 'chat:c', entity: 'chat', entityId: 'c' }),
          live({ key: 'chat:o', entity: 'chat', entityId: 'o', meta: { workers: tally } }),
          live({ key: 'automation_execution:e', entity: 'automation_execution', entityId: 'e' }),
        ],
      },
      recent: [done({ key: 'chat:d', entity: 'chat', entityId: 'd' })],
    };
    const all = buildActivityModel(input);
    expect(all.counts).toEqual({ all: 5, chat: 2, orchestrator: 1, workflow: 1, automation: 1 });
    const chats = buildActivityModel({ ...input, kind: 'chat' });
    expect(chats.counts).toEqual(all.counts);
    expect(chats.header).toEqual(all.header);
    expect(flattenActivity(chats).map((e) => e.entityId)).toEqual(['c', 'd']);
    // "Show finished" off drops Recent from the groups AND the counts; failures stay.
    expect(buildActivityModel({ ...input, showRecent: false }).counts.all).toBe(4);
  });

  it('filters by project and is empty only when nothing at all is listed', () => {
    const input = {
      attention: { needsYou: [], running: [live({ key: 'chat:c', entity: 'chat', entityId: 'c', project: { id: 'p1', name: 'Web' } })] },
      recent: [done({ key: 'chat:d', entity: 'chat', entityId: 'd', project: { id: 'p2', name: 'Api' } })],
    };
    expect(flattenActivity(buildActivityModel({ ...input, projectId: 'p2' })).map((e) => e.entityId)).toEqual(['d']);
    expect(buildActivityModel({ attention: null, recent: null }).empty).toBe(true);
    expect(buildActivityModel({ ...input, kind: 'automation' }).empty).toBe(false);
  });
});

describe('what a card says', () => {
  const runCard = (over: Partial<AttentionItem> = {}) =>
    buildActivityModel({
      attention: { needsYou: [], running: [live({ key: 'workflow_run:r', entity: 'workflow_run', entityId: 'r', ...over })] },
      recent: [],
    }).groups.running[0]!;

  it('names what a gate asks for: a command as "Allow …?", a path after the summary', () => {
    const card = (detail: string) =>
      buildActivityModel({
        attention: {
          needsYou: [ask({ key: 'chat:a:g', entity: 'chat', entityId: 'a', ask: { kind: 'tool_permission', id: 'g', summary: 'Allow file_write?', detail, actions: ['allow_once'] } })],
          running: [],
        },
        recent: [],
      }).groups.needs_you[0]!;
    expect(describeActivityNow(card('{ "path": "src/config.ts" }'))).toMatchObject({ text: 'Allow file_write? · src/config.ts', mono: false });
    expect(describeActivityNow(card('{ "command": "git push -u origin main" }'))).toMatchObject({ text: 'Allow git push -u origin main?', mono: true });
  });

  it('describes running work by kind', () => {
    expect(describeActivityNow(runCard({ progress: { label: 'Review diff', step: 2, of: 4 } }))).toEqual({
      tone: 'run',
      icon: 'status-running',
      text: 'Review diff',
      mono: false,
    });
    expect(describeActivityNow(runCard({ state: 'queued' })).text).toBe('Queued');
    const orch = buildActivityModel({
      attention: { needsYou: [], running: [live({ key: 'chat:o', entity: 'chat', entityId: 'o', meta: { workers: tally }, progress: { label: 'Running ls' } })] },
      recent: [],
    }).groups.running[0]!;
    expect(describeActivityNow(orch).text).toBe('2 running · 1 done · 1 queued');
    expect(describeActivityMeta(orch)).toEqual(['Orchestrator', '4 workers']);
  });

  it('describes meta: agent · model, the stage, the trigger', () => {
    const chat = buildActivityModel({
      attention: { needsYou: [], running: [live({ key: 'chat:c', entity: 'chat', entityId: 'c', meta: { agent: 'Bug Fixer', model: 'claude-sonnet-5' } })] },
      recent: [],
    }).groups.running[0]!;
    expect(describeActivityMeta(chat, (id) => (id === 'claude-sonnet-5' ? 'Sonnet 5' : id))).toEqual(['Bug Fixer', 'Sonnet 5']);
    expect(describeActivityMeta(runCard({ progress: { step: 4, of: 6 } }))).toEqual(['Stage 4 of 6']);
    const auto = buildActivityModel({
      attention: null,
      recent: [
        done({
          key: 'automation_execution:e',
          entity: 'automation_execution',
          entityId: 'e',
          meta: { automation: { id: 'a', triggerType: 'schedule', cronExpression: '0 * * * *' } },
        }),
      ],
    }).groups.recent[0]!;
    expect(describeActivityMeta(auto)).toEqual(['Automation', 'every hour']);
  });

  it('draws the stage bar for workflow runs only, short enough to read', () => {
    expect(activityStages(runCard({ progress: { step: 2, of: 4 } }))).toEqual(['done', 'current', 'pending', 'pending']);
    expect(activityStages(runCard({ progress: { step: 3, of: 40 } }))).toBeUndefined();
    expect(activityStages({ kind: 'workflow', group: 'needs_you', progress: { step: 1, of: 3 } })).toEqual(['ask', 'pending', 'pending']);
    expect(activityStages({ kind: 'chat', group: 'running', progress: { step: 1, of: 3 } })).toBeUndefined();
  });

  it('tallies workers in words', () => {
    expect(workerTallyLine({ total: 3, running: 0, queued: 0, inReview: 1, done: 1, failed: 1 })).toBe('1 in review · 1 done · 1 failed');
    expect(workerTallyLine({ total: 0, running: 0, queued: 0, inReview: 0, done: 0, failed: 0 })).toBe('No workers yet');
  });

  it('formats the time by group', () => {
    const now = Date.parse(T(0)) + 4 * 60_000 + 12_000;
    expect(activityTimeLabel({ group: 'running', at: T(0) }, now)).toBe('4:12');
    expect(activityTimeLabel({ group: 'running', at: T(0) }, Date.parse(T(0)) + 3_930_000)).toBe('1:05:30');
    expect(activityTimeLabel({ group: 'needs_you', at: T(0) }, now)).toBe('4m');
    expect(activityTimeLabel({ group: 'needs_you', at: T(0) }, Date.parse(T(0)) + 20_000)).toBe('now');
    expect(activityTimeLabel({ group: 'failed', at: T(0) }, now)).toBe('4m ago');
    expect(activityTimeLabel({ group: 'recent', at: T(0) }, now, 'en-GB')).toMatch(/^\d\d:\d\d$/);
  });

  it('matches the open page by path, ignoring the dock query', () => {
    expect(activityMatchesPath({ href: '/chats/orch?dock=tasks' }, '/chats/orch')).toBe(true);
    expect(activityMatchesPath({ href: '/chats/orch' }, '/chats/other')).toBe(false);
  });
});

describe('askDetailLine (moved from Home, D-86)', () => {
  it('shows the command or path a clipped JSON detail names', () => {
    expect(askDetailLine('{ "path": "src/config.ts" }')).toBe('src/config.ts');
    expect(askDetailLine('{\n  "command": "git push -u origin fix/checkout-fl')).toBe('git push -u origin fix/checkout-fl');
    expect(askDetailLine('{ "command": "echo \\"hi\\"" }')).toBe('echo "hi"');
  });
  it('keeps anything else as given', () => {
    expect(askDetailLine('Approve "Apply upgrades"')).toBe('Approve "Apply upgrades"');
    expect(askDetailLine('{ "count": 3 }')).toBe('{ "count": 3 }');
    expect(askDetailLine(undefined)).toBeUndefined();
  });
});
