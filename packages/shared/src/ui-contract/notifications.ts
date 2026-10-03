// ────────────────────────────────────────────────────────────────
// Notification vocabulary v2 (mobile MX-07, 06 §7.2, MG-06 part B, MD-183).
//
// One table for the server (`packages/core` notification policy and Expo
// provider) and the phone (category registration, Android channels, the
// response mapper): category ids, their actions, the iOS interruption level,
// the Android channel and the lock-screen-safe copy.
//
// Types and constants only, dependency-free: never import the shared root.
// ────────────────────────────────────────────────────────────────

export const NOTIFICATION_CATEGORY_IDS = [
  'approval',
  'approval.risky',
  'question',
  'plan',
  'run.approval',
  'done',
  'failed',
  'scope_request',
] as const;
export type NotificationCategoryId = (typeof NOTIFICATION_CATEGORY_IDS)[number];

export function isNotificationCategoryId(value: unknown): value is NotificationCategoryId {
  return typeof value === 'string' && (NOTIFICATION_CATEGORY_IDS as readonly string[]).includes(value);
}

/** Action identifiers a response can carry (`approve` / `deny` are the server's push `actions`). */
export const NOTIFICATION_ACTIONS = {
  approve: 'approve',
  deny: 'deny',
  open: 'open',
  review: 'review',
  reply: 'reply',
} as const;
export type NotificationActionId = (typeof NOTIFICATION_ACTIONS)[keyof typeof NOTIFICATION_ACTIONS];

/**
 * - `background`: answered without opening the app; the device must be unlocked first (MD-31: ordinary approvals only).
 * - `foreground`: opens the app on the item.
 * - `text`: a text field (iOS text input, Android RemoteInput), answered in the background after unlock.
 */
export type NotificationActionKind = 'background' | 'foreground' | 'text';

export interface NotificationActionDef {
  id: NotificationActionId;
  title: string;
  kind: NotificationActionKind;
  destructive?: boolean;
  /** `text` only. */
  submitTitle?: string;
  placeholder?: string;
}

export type NotificationChannelId = 'approvals' | 'failed' | 'general' | 'done';
/** iOS `interruptionLevel` as the app and the policy name it (Expo Push spells it `time-sensitive`). */
export type NotificationInterruption = 'passive' | 'active' | 'timeSensitive';

export interface NotificationChannelDef {
  id: NotificationChannelId;
  name: string;
  description: string;
  importance: 'max' | 'high' | 'default' | 'low';
}

/** Android channels, created before the permission request. Importance is fixed once a channel exists. */
export const NOTIFICATION_CHANNELS: readonly NotificationChannelDef[] = [
  { id: 'approvals', name: 'Needs you', description: 'Permissions, questions, plans and run approvals your agent is waiting on.', importance: 'max' },
  { id: 'failed', name: 'Failures', description: 'Runs, automations and chats that stopped with an error.', importance: 'high' },
  { id: 'general', name: 'Activity', description: 'Device access requests and other account activity.', importance: 'default' },
  { id: 'done', name: 'Done', description: 'Runs and chats that finished.', importance: 'low' },
];

/** Channels earlier builds created; the app deletes them (pre-release cleanup, 06 §7.2). */
export const RETIRED_NOTIFICATION_CHANNELS: readonly string[] = ['approval', 'completed'];

export interface NotificationCategoryDef {
  id: NotificationCategoryId;
  interruption: NotificationInterruption;
  channel: NotificationChannelId;
  actions: readonly NotificationActionDef[];
  /**
   * Lock-screen-safe title (MD-33): what the iOS service extension shows while previews are hidden. Never
   * names a command, a path or message text.
   */
  redactedTitle: string;
}

const open: NotificationActionDef = { id: 'open', title: 'Open', kind: 'foreground' };
const review = (title: string): NotificationActionDef => ({ id: 'review', title, kind: 'foreground' });

export const NOTIFICATION_CATEGORIES: Readonly<Record<NotificationCategoryId, NotificationCategoryDef>> = {
  approval: {
    id: 'approval',
    interruption: 'timeSensitive',
    channel: 'approvals',
    actions: [
      { id: 'approve', title: 'Allow once', kind: 'background' },
      { id: 'deny', title: 'Deny', kind: 'background', destructive: true },
      open,
    ],
    redactedTitle: 'Permission needed',
  },
  // MD-31 / MG-04: a risky gate is signed in the app with the biometric key; no lock-screen answer.
  'approval.risky': { id: 'approval.risky', interruption: 'timeSensitive', channel: 'approvals', actions: [review('Review in app')], redactedTitle: 'Permission needed' },
  question: {
    id: 'question',
    interruption: 'timeSensitive',
    channel: 'approvals',
    actions: [{ id: 'reply', title: 'Reply', kind: 'text', submitTitle: 'Send', placeholder: 'Reply to your agent' }, open],
    redactedTitle: 'Your agent has a question',
  },
  plan: { id: 'plan', interruption: 'timeSensitive', channel: 'approvals', actions: [open], redactedTitle: 'A plan needs review' },
  'run.approval': { id: 'run.approval', interruption: 'timeSensitive', channel: 'approvals', actions: [review('Review')], redactedTitle: 'A run needs you' },
  done: { id: 'done', interruption: 'passive', channel: 'done', actions: [], redactedTitle: 'Finished' },
  failed: { id: 'failed', interruption: 'active', channel: 'failed', actions: [open], redactedTitle: 'Something failed' },
  scope_request: { id: 'scope_request', interruption: 'active', channel: 'general', actions: [open], redactedTitle: 'A device asks for access' },
};

/** iOS groups a category's notifications under "%u more" (06 §7.2). */
export const NOTIFICATION_SUMMARY_FORMAT = '%u more';

/** The lock-screen body under every redacted title. */
export const NOTIFICATION_REDACTED_BODY = 'Open GeneratorAI to see it.';

/** Notification bodies stay one line (06 §6.5). */
export const NOTIFICATION_BODY_MAX = 180;

/** At most this many question options travel in a push (MG-06). */
export const NOTIFICATION_MAX_OPTIONS = 4;
