// Fixture scripts for the live-state dev route (`generatorai:///live?script=<id>`, 08 §6 system-surface smoke): the
// events a real run or chat would produce, fed one step at a time into the live store under a fixture server, so the
// Live Activity / Live Update (M9-03 / M9-04) can be walked through without a sandbox run. Development builds only.
import type { LiveEvent, LiveServer } from '@generatorai/client-core';
import type { AttentionItem } from '@generatorai/shared';

export const FIXTURE_SERVER: LiveServer = { id: 'dev-fixture', name: 'Fixture server' };

export const LIVE_SCRIPT_IDS = ['run-needs-you', 'run-fails', 'chat-permission'] as const;
export type LiveScriptId = (typeof LIVE_SCRIPT_IDS)[number];

export function isLiveScriptId(value: unknown): value is LiveScriptId {
  return typeof value === 'string' && (LIVE_SCRIPT_IDS as readonly string[]).includes(value);
}

export interface LiveRun {
  script?: string;
  step?: string;
  n: number;
}

/** `generatorai:///live?script=…&step=…` → the run it asks for; null for any other link. */
export function parseLiveLink(url: string): Omit<LiveRun, 'n'> | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*\/live(?:\?([^#]*))?(?:#.*)?$/i.exec(url);
  if (!match) return null;
  const query = new URLSearchParams(match[1] ?? '');
  return { script: query.get('script') ?? undefined, step: query.get('step') ?? undefined };
}

export interface LiveScriptStep {
  label: string;
  event: (now: Date) => LiveEvent;
}

const RUN = 'fixture-run';
const CHAT = 'fixture-chat';
const runKey = `${FIXTURE_SERVER.id}:workflow_run:${RUN}`;
const chatKey = `${FIXTURE_SERVER.id}:chat:${CHAT}`;

function runItem(since: Date, progress: AttentionItem['progress']): AttentionItem {
  return {
    key: `workflow_run:${RUN}`, entity: 'workflow_run', entityId: RUN, title: 'Nightly dependency audit',
    href: `/workflows/fixture-workflow/runs/${RUN}`, state: 'running', since: since.toISOString(), stoppable: true,
    ...(progress ? { progress } : {}),
  };
}

function stageAsk(since: Date): AttentionItem {
  return {
    key: `workflow_run:${RUN}:stage-3`, entity: 'workflow_run', entityId: RUN, title: 'Nightly dependency audit',
    href: `/workflows/fixture-workflow/runs/${RUN}/stages/stage-3/approval`, state: 'needs_you', since: since.toISOString(),
    stoppable: true, ask: { kind: 'stage_approval', id: 'stage-3', summary: 'Approve “Apply upgrades”', actions: ['approve', 'reject'] },
  };
}

const attention = (items: (now: Date) => AttentionItem[]) => (now: Date): LiveEvent => ({ type: 'attention', items: items(now), server: FIXTURE_SERVER, now });

/** One script = the steps the dev route plays, a few seconds apart. `start` is the run's start time. */
export function liveScript(id: LiveScriptId, start: Date): LiveScriptStep[] {
  if (id === 'chat-permission') {
    const chat = (state: 'running' | 'needs_you'): AttentionItem[] => {
      const base: AttentionItem = {
        key: `chat:${CHAT}`, entity: 'chat', entityId: CHAT, title: 'Fix flaky checkout test', href: `/chats/${CHAT}`,
        state: 'running', since: start.toISOString(), stoppable: true, progress: { label: 'Running pnpm test' },
      };
      if (state === 'running') return [base];
      return [base, { ...base, key: `chat:${CHAT}:perm-1`, href: `/chats/${CHAT}/gate/perm-1`, state: 'needs_you',
        ask: { kind: 'tool_permission', id: 'perm-1', summary: 'Allow Bash: git push -u origin fix/checkout-flake?', actions: ['allow_once', 'deny'], risk: 'risky' } }];
    };
    return [
      { label: 'Chat running', event: attention(() => chat('running')) },
      { label: 'Permission needed', event: attention(() => chat('needs_you')) },
      { label: 'Answered, running', event: attention(() => chat('running')) },
      { label: 'Turn finished (no outcome API: the surface ends)', event: attention(() => []) },
      { label: 'Swept', event: (now) => ({ type: 'sweep', now: new Date(now.getTime() + 61_000) }) },
    ];
  }
  const failing = id === 'run-fails';
  return [
    { label: 'Run started', event: attention(() => [runItem(start, { label: 'Install', step: 1, of: 4 })]) },
    { label: 'Stage 2 of 4', event: (now) => ({ type: 'progress', key: runKey, step: { index: 2, count: 4, label: 'Typecheck' }, segments: ['done', 'current', 'pending', 'pending'], next: 'Apply upgrades', now }) },
    ...(failing
      ? [{ label: 'Stage 2 failed', event: attention(() => []) }]
      : [
          { label: 'Needs you: stage approval', event: attention((now) => [runItem(start, { label: 'Apply upgrades', step: 3, of: 4 }), stageAsk(now)]) },
          { label: 'Approved, stage 3 of 4', event: attention(() => [runItem(start, { label: 'Apply upgrades', step: 3, of: 4 })]) },
          { label: 'Run left the feed', event: attention(() => []) },
        ]),
    { label: failing ? 'Ended: failed (dismissed in 30 min)' : 'Ended: succeeded (dismissed in 15 min)', event: (now) => ({ type: 'ended', key: runKey, outcome: failing ? 'failed' : 'succeeded', now }) },
  ];
}

/** Every key a script touches, so the route can follow and forget them. */
export const FIXTURE_KEYS = { run: runKey, chat: chatKey } as const;
