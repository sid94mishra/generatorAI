// ────────────────────────────────────────────────────────────────
// Activity entry → what the kit draws (D-92). The words come from the shared
// read model (`@generatorai/client-core` activity: describeActivityNow /
// describeActivityMeta / activityStages); this maps them onto ActivityCard
// and RailLiveTile props and picks the inline actions an entry offers.
// ────────────────────────────────────────────────────────────────

import {
  activityStages,
  describeActivityMeta,
  describeActivityNow,
  type ActivityEntry,
} from '@generatorai/client-core';
import { ACTIVITY_KIND_META } from '@generatorai/shared/ui-contract';
import type { IconConcept } from '@generatorai/design-tokens';
import type { ActivityCardLine, ActivityCardTone, ActivityStageState } from '@/ui/patterns/ActivityCard/ActivityCard.js';

export function kindIcon(entry: Pick<ActivityEntry, 'kind'>): IconConcept {
  return ACTIVITY_KIND_META[entry.kind].icon as IconConcept;
}

export function kindLabel(entry: Pick<ActivityEntry, 'kind'>): string {
  return ACTIVITY_KIND_META[entry.kind].label;
}

export function cardTone(entry: Pick<ActivityEntry, 'group'>): ActivityCardTone {
  return entry.group === 'needs_you' ? 'ask' : entry.group === 'failed' ? 'fail' : 'default';
}

export function cardLine(entry: ActivityEntry): ActivityCardLine {
  const now = describeActivityNow(entry);
  return {
    tone: now.tone,
    icon: now.icon as IconConcept,
    text: now.text,
    mono: now.mono,
    spin: now.icon === 'status-running',
  };
}

export function cardStages(entry: ActivityEntry): ActivityStageState[] | undefined {
  return activityStages(entry);
}

export function cardMeta(entry: ActivityEntry, modelLabel: (id: string) => string): string[] {
  return describeActivityMeta(entry, modelLabel);
}

/** The rail tile's tone: amber needs you, red failed, blue running (board EnhRailQuickAccess). */
export function tileTone(entry: Pick<ActivityEntry, 'group'>): 'warn' | 'err' | 'run' {
  return entry.group === 'needs_you' ? 'warn' : entry.group === 'failed' ? 'err' : 'run';
}

const GROUP_WORD: Record<ActivityEntry['group'], string> = {
  needs_you: 'needs you',
  failed: 'failed',
  running: 'running',
  recent: 'finished',
};

export function tileLabel(entry: ActivityEntry): string {
  return `${entry.title} · ${GROUP_WORD[entry.group]}`;
}

/** The verb on a live entry's Stop: a run is cancelled, an orchestrator stops everything it runs. */
export function stopLabel(entry: Pick<ActivityEntry, 'kind'>): string {
  if (entry.kind === 'workflow') return 'Cancel run';
  if (entry.kind === 'orchestrator') return 'Stop all';
  return 'Stop';
}

/** An inline answer the popover can give, from the ask's own action list (05 §G-01). */
export interface AskAnswer {
  approve?: { action: 'allow_once' | 'approve'; label: string };
  decline?: { action: 'deny' | 'reject'; label: string };
}

export function askAnswers(entry: ActivityEntry): AskAnswer {
  const ask = entry.ask;
  const item = entry.asks[0];
  if (!ask || !item) return {};
  const can = (a: string) => ask.actions.includes(a as never);
  switch (ask.kind) {
    case 'tool_permission':
      // A chat gate; a computer consent needs the app identity only the computer panel holds.
      return item.entity === 'chat'
        ? {
            ...(can('allow_once') ? { approve: { action: 'allow_once' as const, label: 'Allow once' } } : {}),
            ...(can('deny') ? { decline: { action: 'deny' as const, label: 'Deny' } } : {}),
          }
        : {};
    case 'plan_review':
    case 'stage_approval':
      return {
        ...(can('approve') ? { approve: { action: 'approve' as const, label: 'Approve' } } : {}),
        ...(can('reject') ? { decline: { action: 'reject' as const, label: 'Reject' } } : {}),
      };
    default:
      return {};
  }
}

/** What "Open" says for an ask that is answered where it was asked. */
export function openLabel(entry: ActivityEntry): string {
  switch (entry.ask?.kind) {
    case 'question':
    case 'stage_input':
      return 'Answer';
    case 'plan_review':
    case 'stage_approval':
      return 'Review';
    default:
      return entry.kind === 'workflow' ? 'Open run' : 'Open';
  }
}

/**
 * What Stop acts on: the running item, else (a run or chat parked on an ask) the
 * asking item itself when the entity is stoppable — a waiting run can be cancelled.
 */
export function stopTarget(entry: ActivityEntry): ActivityEntry['live'] {
  if (entry.live?.stoppable) return entry.live;
  const ask = entry.asks[0];
  // A worker's ask: Stop would stop the worker, not the card's orchestrator — not offered.
  return ask && ask.stoppable && !entry.worker ? ask : undefined;
}
