// ────────────────────────────────────────────────────────────────
// Activity read model (D-92; boards EnhActivityColumn / EnhActivityCards).
//
// One list of cards for the Activity column, the rail's quick access and
// (next pass) mobile, built from the two feeds that already exist:
//
//   live      the attention feed (G-01, SSE-fed): Needs you + Running
//   finished  recent activity (G-11) since the start of the day: Failed +
//             Recent — refetched when the attention feed loses an item
//
// The rules every client applies:
//   - one card per entity. Several asks of one chat are one card (the oldest
//     ask shows, `asks` holds them all); a worker's ask is shown on its
//     orchestrator (the worker is internal, D-86/D-87), so the orchestrator
//     is one card under Needs you and is not also listed under Running;
//   - an entity listed live is never also listed as finished (a chat that is
//     running again drops its finished card);
//   - a failed card stays until dismissed or until the entity runs again; a
//     dismissal names that one failure (`dismissKey` carries `endedAt`), so a
//     newer failure of the same entity shows again;
//   - order: Needs you oldest ask first · Failed newest first · Running
//     longest-running first · Recent newest first;
//   - the kind tabs' counts and the header badges count cards, before the
//     kind filter (what each tab would show).
//
// React-free and platform-free.
// ────────────────────────────────────────────────────────────────

import type {
  ActivityMeta,
  ActivityWorkerTally,
  AttentionAsk,
  AttentionEntity,
  AttentionItem,
  AttentionProgress,
  AttentionSnapshot,
  RecentActivityChanges,
  RecentActivityItem,
  StatusState,
} from '@generatorai/shared';
import {
  ACTIVITY_ASK_ICONS,
  ACTIVITY_GROUPS,
  ACTIVITY_KINDS,
  describeSchedule,
  type ActivityGroup,
  type ActivityKind,
} from '@generatorai/shared/ui-contract';

export interface ActivityEntry {
  /** Stable per card: `${entity}:${entityId}` of the entity the card stands for. */
  key: string;
  kind: ActivityKind;
  group: ActivityGroup;
  entity: AttentionEntity;
  entityId: string;
  title: string;
  /** In-app route; a worker's ask opens its orchestrator's Tasks dock. */
  href: string;
  project?: { id: string; name: string };
  state: StatusState;
  /** ISO: started waiting (Needs you), started running (Running) or ended (Failed / Recent). */
  at: string;
  /** The oldest ask of the card (Needs you). */
  ask?: AttentionAsk;
  /** Every ask behind the card, oldest first: inline answers act on `asks[0]`. */
  asks: AttentionItem[];
  /** The worker whose ask is shown on its orchestrator's card. */
  worker?: { id: string; title: string };
  progress?: AttentionProgress;
  meta?: ActivityMeta;
  /** A Stop endpoint exists right now (the live item's own flag). */
  stoppable: boolean;
  /** The running item behind a live card (Stop acts on it), when there is one. */
  live?: AttentionItem;
  /** Finished cards. */
  outcome?: RecentActivityItem['outcome'];
  summary?: string;
  changes?: RecentActivityChanges;
  retry?: RecentActivityItem['retry'];
  recent?: RecentActivityItem;
  /** Finished after the person last read it (chats). */
  unread: boolean;
  /** Failed cards: what "Dismiss" records — this failure, not the entity. */
  dismissKey?: string;
}

export interface ActivityModelInput {
  attention: Pick<AttentionSnapshot, 'needsYou' | 'running'> | null | undefined;
  /** Finished items since the start of the day, newest first (G-11). */
  recent: readonly RecentActivityItem[] | null | undefined;
  /** Dismissed failures (`ActivityEntry.dismissKey`). */
  dismissed?: ReadonlySet<string>;
  /** The kind tab. Default `all`. */
  kind?: ActivityKind | 'all';
  /** The filter menu's "Show finished": the Recent group. Default true. */
  showRecent?: boolean;
  /** Only this project's cards. */
  projectId?: string;
}

export interface ActivityModel {
  groups: Record<ActivityGroup, ActivityEntry[]>;
  /** Cards per kind and in all, before the kind filter (the kind tabs). */
  counts: Record<ActivityKind | 'all', number>;
  /** Header badges, before the kind filter. */
  header: { needsYou: number; running: number; failed: number };
  /** No card at all before the kind filter: the column's empty state. */
  empty: boolean;
}

const ENTITY_OF_RECENT: Record<RecentActivityItem['entity'], AttentionEntity> = {
  chat: 'chat',
  run: 'workflow_run',
  automation_execution: 'automation_execution',
};

const OUTCOME_STATE: Record<RecentActivityItem['outcome'], StatusState> = {
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'skipped',
};

function kindOf(entity: AttentionEntity, meta: ActivityMeta | undefined): ActivityKind {
  if (entity === 'workflow_run') return 'workflow';
  if (entity === 'automation_execution') return 'automation';
  return meta?.workers ? 'orchestrator' : 'chat';
}

function entityKey(entity: AttentionEntity, id: string): string {
  return `${entity}:${id}`;
}

function byTimeAsc(a: ActivityEntry, b: ActivityEntry): number {
  const d = Date.parse(a.at) - Date.parse(b.at);
  if (d !== 0 && Number.isFinite(d)) return d;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function byTimeDesc(a: ActivityEntry, b: ActivityEntry): number {
  return byTimeAsc(b, a);
}

function emptyGroups(): Record<ActivityGroup, ActivityEntry[]> {
  return { needs_you: [], failed: [], running: [], recent: [] };
}

/** The live cards: asks grouped per entity (workers onto their orchestrator), then what runs. */
function liveEntries(attention: ActivityModelInput['attention']): { needsYou: ActivityEntry[]; running: ActivityEntry[] } {
  if (!attention) return { needsYou: [], running: [] };
  const runningByKey = new Map<string, AttentionItem>();
  for (const item of attention.running) runningByKey.set(entityKey(item.entity, item.entityId), item);

  const cards = new Map<string, ActivityEntry>();
  const asks = [...attention.needsYou].sort((a, b) => Date.parse(a.since) - Date.parse(b.since) || (a.key < b.key ? -1 : 1));
  for (const item of asks) {
    const owner = item.parent ? { entity: 'chat' as const, id: item.parent.id, title: item.parent.title } : undefined;
    const key = owner ? entityKey('chat', owner.id) : entityKey(item.entity, item.entityId);
    const existing = cards.get(key);
    if (existing) {
      existing.asks.push(item);
      continue;
    }
    const live = runningByKey.get(key);
    // A worker's ask: the card is its orchestrator (its meta, when it runs, carries the tally).
    const meta = owner ? live?.meta : item.meta;
    cards.set(key, {
      key,
      kind: owner ? 'orchestrator' : kindOf(item.entity, item.meta),
      group: 'needs_you',
      entity: owner ? 'chat' : item.entity,
      entityId: owner ? owner.id : item.entityId,
      title: owner ? owner.title : item.title,
      href: item.href,
      ...(item.project ? { project: item.project } : {}),
      state: item.state,
      at: item.since,
      ...(item.ask ? { ask: item.ask } : {}),
      asks: [item],
      ...(owner ? { worker: { id: item.entityId, title: item.title } } : {}),
      ...(live?.progress ?? item.progress ? { progress: live?.progress ?? item.progress } : {}),
      ...(meta ? { meta } : {}),
      stoppable: owner ? (live?.stoppable ?? false) : item.stoppable,
      ...(live ? { live } : {}),
      unread: false,
    });
  }

  const running: ActivityEntry[] = [];
  for (const item of attention.running) {
    const key = entityKey(item.entity, item.entityId);
    if (cards.has(key)) continue;
    running.push({
      key,
      kind: kindOf(item.entity, item.meta),
      group: 'running',
      entity: item.entity,
      entityId: item.entityId,
      title: item.title,
      href: item.href,
      ...(item.project ? { project: item.project } : {}),
      state: item.state,
      at: item.since,
      asks: [],
      ...(item.progress ? { progress: item.progress } : {}),
      ...(item.meta ? { meta: item.meta } : {}),
      stoppable: item.stoppable,
      live: item,
      unread: false,
    });
  }
  return { needsYou: [...cards.values()].sort(byTimeAsc), running: running.sort(byTimeAsc) };
}

/** A failure's dismissal key: the entity and when this failure ended. */
export function activityDismissKey(item: Pick<RecentActivityItem, 'key' | 'endedAt'>): string {
  return `${item.key}@${item.endedAt}`;
}

function finishedEntry(item: RecentActivityItem): ActivityEntry {
  const entity = ENTITY_OF_RECENT[item.entity];
  const failed = item.outcome === 'failed';
  return {
    key: entityKey(entity, item.entityId),
    kind: kindOf(entity, item.meta),
    group: failed ? 'failed' : 'recent',
    entity,
    entityId: item.entityId,
    title: item.title,
    href: item.href,
    ...(item.project ? { project: item.project } : {}),
    state: OUTCOME_STATE[item.outcome],
    at: item.endedAt,
    asks: [],
    ...(item.meta ? { meta: item.meta } : {}),
    stoppable: false,
    outcome: item.outcome,
    summary: item.summary,
    ...(item.changes ? { changes: item.changes } : {}),
    ...(item.retry ? { retry: item.retry } : {}),
    recent: item,
    unread: item.unread === true,
    ...(failed ? { dismissKey: activityDismissKey(item) } : {}),
  };
}

/** Builds the Activity column's groups, counts and badges (see the file header for the rules). */
export function buildActivityModel(input: ActivityModelInput): ActivityModel {
  const { needsYou, running } = liveEntries(input.attention);
  const liveKeys = new Set([...needsYou, ...running].map((e) => e.key));
  const dismissed = input.dismissed ?? new Set<string>();
  const showRecent = input.showRecent !== false;

  const failed: ActivityEntry[] = [];
  const recent: ActivityEntry[] = [];
  const seenFinished = new Set<string>();
  for (const item of input.recent ?? []) {
    const entry = finishedEntry(item);
    // One card per entity (the newest finish) and never beside its live card.
    if (liveKeys.has(entry.key) || seenFinished.has(entry.key)) continue;
    seenFinished.add(entry.key);
    if (entry.group === 'failed') {
      if (entry.dismissKey && dismissed.has(entry.dismissKey)) continue;
      failed.push(entry);
    } else if (showRecent) {
      recent.push(entry);
    }
  }

  const all = emptyGroups();
  all.needs_you = needsYou;
  all.failed = failed.sort(byTimeDesc);
  all.running = running;
  all.recent = recent.sort(byTimeDesc);

  if (input.projectId) {
    for (const group of ACTIVITY_GROUPS) all[group] = all[group].filter((e) => e.project?.id === input.projectId);
  }

  const counts = { all: 0, chat: 0, orchestrator: 0, workflow: 0, automation: 0 } as Record<ActivityKind | 'all', number>;
  for (const group of ACTIVITY_GROUPS) {
    for (const entry of all[group]) {
      counts.all += 1;
      counts[entry.kind] += 1;
    }
  }
  const header = { needsYou: all.needs_you.length, running: all.running.length, failed: all.failed.length };

  const kind = input.kind ?? 'all';
  const groups = emptyGroups();
  for (const group of ACTIVITY_GROUPS) groups[group] = kind === 'all' ? all[group] : all[group].filter((e) => e.kind === kind);
  return { groups, counts, header, empty: counts.all === 0 };
}

/** The cards in display order (keyboard navigation, the rail's quick access). */
export function flattenActivity(model: Pick<ActivityModel, 'groups'>): ActivityEntry[] {
  return ACTIVITY_GROUPS.flatMap((group) => model.groups[group]);
}

/** Whether a card stands for the page at `pathname` (the selected card: "the page that is open"). */
export function activityMatchesPath(entry: Pick<ActivityEntry, 'href'>, pathname: string): boolean {
  const path = entry.href.split(/[?#]/)[0] ?? entry.href;
  return path === pathname.replace(/\/+$/, '') || path === pathname;
}

export function kindsWithCards(model: Pick<ActivityModel, 'counts'>): ActivityKind[] {
  return ACTIVITY_KINDS.filter((kind) => model.counts[kind] > 0);
}

// ── What a card says ─────────────────────────────────────────────

export type ActivityTone = 'warn' | 'run' | 'err' | 'ok' | 'muted';

export interface ActivityNow {
  tone: ActivityTone;
  /** Icon concept id. */
  icon: string;
  text: string;
  /** Command / file / error text: drawn in the mono face. */
  mono: boolean;
}

/** "2 running · 1 done · 1 queued" (zero parts left out; "No workers yet" for none). */
export function workerTallyLine(tally: ActivityWorkerTally): string {
  const parts = [
    tally.running > 0 ? `${tally.running} running` : null,
    tally.inReview > 0 ? `${tally.inReview} in review` : null,
    tally.done > 0 ? `${tally.done} done` : null,
    tally.failed > 0 ? `${tally.failed} failed` : null,
    tally.queued > 0 ? `${tally.queued} queued` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : 'No workers yet';
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? text).trim();
}

/** The card's status line: the ask, the current step, the error, or the outcome (EnhActivityCards ④). */
export function describeActivityNow(entry: ActivityEntry): ActivityNow {
  if (entry.group === 'needs_you' && entry.ask) {
    const ask = entry.ask;
    const command = ask.kind === 'tool_permission' && ask.detail ? `Allow ${firstLine(ask.detail)}?` : undefined;
    const text = command ?? ask.summary;
    return {
      tone: 'warn',
      icon: ACTIVITY_ASK_ICONS[ask.kind] ?? 'hand',
      text: entry.worker ? `${entry.worker.title}: ${text}` : text,
      mono: command !== undefined,
    };
  }
  if (entry.group === 'failed') {
    return { tone: 'err', icon: 'status-failed', text: firstLine(entry.summary ?? 'Failed'), mono: false };
  }
  if (entry.group === 'recent') {
    if (entry.outcome === 'cancelled') return { tone: 'muted', icon: 'status-skipped', text: 'Stopped', mono: false };
    return { tone: 'ok', icon: 'status-succeeded', text: 'Done', mono: false };
  }
  switch (entry.state) {
    case 'queued':
      return { tone: 'muted', icon: 'status-queued', text: 'Queued', mono: false };
    case 'paused':
      return { tone: 'muted', icon: 'status-paused', text: entry.progress?.label ?? 'Paused', mono: false };
    case 'waiting':
      return { tone: 'run', icon: 'status-waiting', text: entry.progress?.label ?? 'Waiting', mono: false };
    default:
      break;
  }
  if (entry.kind === 'orchestrator' && entry.meta?.workers && entry.meta.workers.total > 0) {
    return { tone: 'run', icon: 'status-running', text: workerTallyLine(entry.meta.workers), mono: false };
  }
  return { tone: 'run', icon: 'status-running', text: entry.progress?.label ?? 'Working…', mono: false };
}

/** The automation's trigger in words: "every hour", "manual", "on webhook". */
export function describeAutomationTrigger(automation: NonNullable<ActivityMeta['automation']>): string {
  if (automation.triggerType === 'schedule') return automation.cronExpression ? describeSchedule(automation.cronExpression) : 'scheduled';
  return automation.triggerType === 'webhook' ? 'on webhook' : 'manual';
}

/**
 * The card's meta line (EnhActivityCards ⑤): agent · model for chats, workers
 * for orchestrators, the stage for runs, the trigger for automations.
 * `modelLabel` maps a model id to its display name.
 */
export function describeActivityMeta(entry: ActivityEntry, modelLabel: (id: string) => string = (id) => id): string[] {
  const meta = entry.meta;
  switch (entry.kind) {
    case 'chat':
      return [meta?.agent, meta?.model ? modelLabel(meta.model) : undefined].filter((p): p is string => !!p);
    case 'orchestrator': {
      const total = meta?.workers?.total ?? 0;
      return ['Orchestrator', total > 0 ? `${total} worker${total === 1 ? '' : 's'}` : undefined].filter(
        (p): p is string => !!p,
      );
    }
    case 'workflow': {
      const p = entry.progress;
      return p?.step !== undefined && p.of !== undefined && p.of > 0 ? [`Stage ${p.step} of ${p.of}`] : ['Workflow run'];
    }
    case 'automation':
      return ['Automation', meta?.automation ? describeAutomationTrigger(meta.automation) : undefined].filter(
        (p): p is string => !!p,
      );
  }
}

export type ActivityStage = 'done' | 'current' | 'ask' | 'pending';

/** Most stages a card draws as segments; a longer run shows only "Stage n of m". */
export const ACTIVITY_MAX_STAGE_SEGMENTS = 12;

/** A workflow card's stage bar (EnhActivityCards ⑦), from the live "stage n of m". */
export function activityStages(entry: Pick<ActivityEntry, 'kind' | 'group' | 'progress'>): ActivityStage[] | undefined {
  if (entry.kind !== 'workflow' || (entry.group !== 'running' && entry.group !== 'needs_you')) return undefined;
  const { step, of } = entry.progress ?? {};
  if (step === undefined || of === undefined || of < 2 || of > ACTIVITY_MAX_STAGE_SEGMENTS) return undefined;
  return Array.from({ length: of }, (_, i) =>
    i < step - 1 ? 'done' : i === step - 1 ? (entry.group === 'needs_you' ? 'ask' : 'current') : 'pending',
  );
}

// ── Time ─────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The card's time (EnhActivityCards ⑧): m:ss while running ("4:12", "1:05:30"),
 * the wait while it needs you ("12m", "now"), "18m ago" for a failure within
 * the hour, else the clock time it finished ("13:05").
 */
export function activityTimeLabel(entry: Pick<ActivityEntry, 'group' | 'at'>, now: number, locale?: string): string {
  const at = Date.parse(entry.at);
  if (!Number.isFinite(at)) return '';
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (entry.group === 'running') {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}:${pad(m)}:${pad(seconds % 60)}` : `${m}:${pad(seconds % 60)}`;
  }
  const minutes = Math.floor(seconds / 60);
  if (entry.group === 'needs_you') {
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
  }
  if (entry.group === 'failed' && minutes < 60) return minutes < 1 ? 'just now' : `${minutes}m ago`;
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(at));
}

/** Local midnight of `now`: the Recent group's `since` (G-11 `?since=`). */
export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
