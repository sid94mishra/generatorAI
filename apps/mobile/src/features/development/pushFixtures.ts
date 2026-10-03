// Push fixtures for the notification surface smoke (08 §6 "Notification categories + routing", M9-02): one per
// shared category, in the exact v2 shape the server sends (PushDispatcher + ExpoPushProvider). Used two ways:
//   • `generatorai:///notify?case=<case>&chat=…&interaction=…&workflow=…&run=…&stage=…` (dev builds) schedules
//     it as a local notification on both platforms, with the ids of a real sandbox gate and the active server;
//   • `apps/mobile/e2e/push/<case>.json` is the same payload APNs-shaped for `xcrun simctl push` / `agent-device
//     push`, with `${…}` placeholders the runner fills (the files are checked against this module by a test).
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_REDACTED_BODY,
  type NotificationCategoryId,
} from '@generatorai/shared/ui-contract';

export const PUSH_CASES = ['approval', 'approval.risky', 'question', 'plan', 'run.approval', 'done', 'failed'] as const;
export type PushCase = (typeof PUSH_CASES)[number];

export function isPushCase(value: unknown): value is PushCase {
  return typeof value === 'string' && (PUSH_CASES as readonly string[]).includes(value);
}

export interface PushIds {
  server: string;
  chat: string;
  interaction: string;
  workflow: string;
  run: string;
  stage: string;
}

/** The runner's placeholders (scripts/mobile/lib/sandbox-maestro.mjs fills them). */
export const PLACEHOLDER_IDS: PushIds = {
  server: '${SERVER_ID}',
  chat: '${CHAT_ID}',
  interaction: '${INTERACTION_ID}',
  workflow: '${WORKFLOW_ID}',
  run: '${RUN_ID}',
  stage: '${STAGE_RUN_ID}',
};

export interface PushFixture {
  title: string;
  body: string;
  categoryId: NotificationCategoryId;
  threadId: string;
  data: Record<string, unknown>;
}

const redacted = (category: NotificationCategoryId) => ({ title: NOTIFICATION_CATEGORIES[category].redactedTitle, body: NOTIFICATION_REDACTED_BODY });

export function pushFixture(kind: PushCase, ids: PushIds): PushFixture {
  const chatThread = `chat:${ids.chat}`;
  const runThread = `run:${ids.run}`;
  const scope = { v: 2, serverId: ids.server, counts: { needsYou: 1, running: 1 } };
  const chat = (gate: boolean) => ({ entity: 'chat', entityId: ids.chat, chatId: ids.chat, ...(gate ? { interactionId: ids.interaction } : {}) });
  const run = { entity: 'workflow_run', entityId: ids.run, runId: ids.run, workflowDefinitionId: ids.workflow };
  const gateHref = `/chats/${ids.chat}/gate/${ids.interaction}`;
  const runHref = `/workflows/${ids.workflow}/runs/${ids.run}`;
  const make = (category: NotificationCategoryId, title: string, body: string, threadId: string, href: string, extra: Record<string, unknown>): PushFixture => ({
    title, body, categoryId: category, threadId,
    data: { ...scope, route: href, href, category, threadId, redacted: redacted(category), ...extra },
  });
  switch (kind) {
    case 'approval':
      return make('approval', 'Allow Bash: pnpm test?', 'Run the unit tests', chatThread, gateHref, { ...chat(true), kind: 'permission', actions: ['approve', 'deny'], risk: 'standard' });
    case 'approval.risky':
      return make('approval.risky', 'Allow Bash?', 'git push -u origin fix/checkout-flake', chatThread, gateHref, { ...chat(true), kind: 'permission', risk: 'risky' });
    case 'question':
      return make('question', 'Your agent has a question', 'Migrate all 9 custom edge types now, or keep a v11 shim for this PR?', chatThread, gateHref, {
        ...chat(true), kind: 'question',
        question: { id: 'q1', options: ['Migrate them now', 'Keep a v11 shim'], multiSelect: false, freeText: true, count: 1 },
      });
    case 'plan':
      return make('plan', 'A plan needs review', 'Fix flaky checkout test', chatThread, gateHref, { ...chat(true), kind: 'plan' });
    case 'run.approval':
      return make('run.approval', 'Waiting for your approval', 'Apply upgrades: 14 packages, 3 majors', runThread, `${runHref}/approval/${ids.stage}`, { ...run, stageRunId: ids.stage });
    case 'done':
      return make('done', 'Workflow run finished', 'Nightly dependency audit', runThread, runHref, run);
    case 'failed':
      return make('failed', 'Workflow run failed', 'typecheck failed in payments-service', runThread, runHref, run);
  }
}

/** The APNs payload Expo Push would deliver for a fixture (data under `body`, as expo-notifications reads it). */
export function apnsPayload(f: PushFixture): Record<string, unknown> {
  const def = NOTIFICATION_CATEGORIES[f.categoryId];
  const level = def.interruption === 'timeSensitive' ? 'time-sensitive' : def.interruption;
  return {
    aps: {
      alert: { title: f.title, body: f.body },
      ...(def.interruption === 'passive' ? {} : { sound: 'default' }),
      category: f.categoryId,
      'thread-id': f.threadId,
      'interruption-level': level,
      'mutable-content': 1,
      badge: 1,
    },
    body: f.data,
  };
}
