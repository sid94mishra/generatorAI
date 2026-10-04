// ────────────────────────────────────────────────────────────────
// Activity vocabulary (D-92; boards EnhActivityColumn, EnhActivityCards,
// EnhActivityPopovers, EnhRailQuickAccess). React-free, dependency-free
// contract data shared by web, desktop and mobile: the four kinds a person
// tells apart, the four groups of the Activity column, their labels and the
// icon concept each kind / ask draws. The grouping and ordering rules live in
// `@generatorai/client-core` (`activity/`).
// ────────────────────────────────────────────────────────────────

/** What an activity card is: the icon tile, never a colour (EnhActivityCards ①). */
export type ActivityKind = 'chat' | 'orchestrator' | 'workflow' | 'automation';

export const ACTIVITY_KINDS: readonly ActivityKind[] = ['chat', 'orchestrator', 'workflow', 'automation'];

/** The column's sections, in display order (D-92: actionable first). */
export type ActivityGroup = 'needs_you' | 'failed' | 'running' | 'recent';

export const ACTIVITY_GROUPS: readonly ActivityGroup[] = ['needs_you', 'failed', 'running', 'recent'];

export const ACTIVITY_KIND_META: Record<ActivityKind, { label: string; plural: string; icon: string }> = {
  chat: { label: 'Chat', plural: 'Chats', icon: 'chats' },
  orchestrator: { label: 'Orchestrator', plural: 'Orchestrators', icon: 'users' },
  workflow: { label: 'Workflow run', plural: 'Workflows', icon: 'workflows' },
  automation: { label: 'Automation run', plural: 'Automations', icon: 'automations' },
};

export const ACTIVITY_GROUP_LABELS: Record<ActivityGroup, string> = {
  needs_you: 'Needs you',
  failed: 'Failed',
  running: 'Running',
  recent: 'Recent',
};

/** The glyph in front of an ask's line (EnhActivityCards "Needs you · every ask"). */
export const ACTIVITY_ASK_ICONS: Record<string, string> = {
  tool_permission: 'hand',
  question: 'info',
  plan_review: 'plan',
  stage_approval: 'hand',
  stage_input: 'edit',
  computer_consent: 'pointer',
  run_paused: 'pause',
};

/** Copy for the column's empty state and its toggle (EnhActivityCards "Header, server filter, empty"). */
export const ACTIVITY_COPY = {
  title: 'Activity',
  emptyTitle: 'Nothing running',
  emptyDescription:
    'Chats, workflow runs and automations show up here while they work and for the rest of the day after they finish.',
  filteredEmpty: 'Nothing of this kind today.',
  show: 'Show activity',
  hide: 'Hide activity',
} as const;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isInt(field: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(field)) return false;
  const n = Number(field);
  return n >= min && n <= max;
}

/**
 * A cron expression in words for the common shapes ("every hour", "every 15
 * min", "daily at 02:00", "weekdays at 09:00", "Mondays at 09:00"); anything
 * else is returned as written, never guessed (D-36).
 */
export function describeSchedule(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return cron.trim();
  const [min, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const anyDay = dom === '*' && month === '*';
  if (!anyDay) return cron.trim();
  if (hour === '*' && dow === '*') {
    if (min === '*') return 'every minute';
    if (isInt(min, 0, 59)) return 'every hour';
    const step = /^\*\/(\d+)$/.exec(min);
    if (step) return `every ${step[1]} min`;
    return cron.trim();
  }
  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (everyHours && isInt(min, 0, 59) && dow === '*') return `every ${everyHours[1]} h`;
  if (!isInt(min, 0, 59) || !isInt(hour, 0, 23)) return cron.trim();
  const time = `${pad2(Number(hour))}:${pad2(Number(min))}`;
  if (dow === '*') return `daily at ${time}`;
  if (dow === '1-5') return `weekdays at ${time}`;
  if (isInt(dow, 0, 7)) return `${WEEKDAYS[Number(dow) % 7]}s at ${time}`;
  return cron.trim();
}
