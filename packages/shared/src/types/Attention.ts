// ────────────────────────────────────────────────────────────────
// Attention feed (G-01, docs/redesign/05-gap-matrix.md §G-01).
//
// One cross-entity read model: everything that is waiting for a person
// ("Needs you") and everything that is executing right now ("Running"),
// across chats, workflow runs and automation executions.
//
// The server holds the snapshot in memory (`AttentionService`) and streams
// deltas on the `global` scope (`attention.upsert` / `attention.remove` /
// `attention.counts`). Clients fold the deltas into the snapshot with the
// pure reducer in `@generatorai/client-core` (`attention/`).
//
// React-free wire types only; web, desktop, CLI and mobile share them.
// ────────────────────────────────────────────────────────────────

import type { GateRisk } from '../security/gateRisk.js';
import type { StatusState } from '../status/states.js';

export type AttentionEntity = 'chat' | 'workflow_run' | 'automation_execution';

export const ATTENTION_ENTITIES: readonly AttentionEntity[] = [
  'chat',
  'workflow_run',
  'automation_execution',
];

/** The subset of the D-18 visual states an attention item can be in. */
export type AttentionItemState = Extract<StatusState, 'needs_you' | 'running' | 'waiting' | 'paused' | 'queued'>;

export type AttentionAskKind =
  | 'tool_permission'
  | 'question'
  | 'plan_review'
  | 'stage_approval'
  | 'stage_input'
  | 'computer_consent'
  | 'run_paused';

/**
 * Quick actions a client may offer inline. Each maps to an EXISTING endpoint
 * (05 §G-01 "Quick actions reuse existing endpoints"); `open` navigates to
 * `href`.
 */
export type AttentionAction = 'allow_once' | 'deny' | 'approve' | 'reject' | 'answer' | 'open';

export interface AttentionAsk {
  kind: AttentionAskKind;
  /** interactionId | stageRunId | consent requestId | runId (run_paused). */
  id: string;
  /** One line, e.g. "Run this command?", "Approve “Apply upgrades”". */
  summary: string;
  /**
   * Command, file or stage context. Stripped for principals without
   * `read:chats` (chat items) or `read:workflows` (run and automation items).
   */
  detail?: string;
  actions: AttentionAction[];
  /** MG-04 — the gate's risk verdict; a client falls back to MD-31's default when absent. */
  risk?: GateRisk;
}

export interface AttentionProgress {
  /**
   * The latest step title: "Running pnpm build", "Apply upgrades". Omitted
   * when there is none, and stripped like `ask.detail`.
   */
  label?: string;
  step?: number;
  of?: number;
}

/**
 * An orchestrator's workers by lifecycle (D-92): "2 running · 1 done · 1 queued"
 * on the Activity card. `queued` = spawned, not started; `inReview` = finished,
 * the orchestrator is reading the result (D-87). Cancelled workers count in
 * `total` only.
 */
export interface ActivityWorkerTally {
  total: number;
  running: number;
  queued: number;
  inReview: number;
  done: number;
  failed: number;
}

/**
 * What runs an item, for a card's meta line without a second request (D-92).
 * Every field is optional and omitted when unknown — never invented (D-36).
 */
export interface ActivityMeta {
  /** Chats: the bound agent's name ("Bug Fixer"). */
  agent?: string;
  /** Chats: the model id the chat runs on (clients map it to a label). */
  model?: string;
  /** Orchestrator chats (orchestrator mode, or any worker spawned). */
  workers?: ActivityWorkerTally;
  /** Automation executions: the automation and how it is triggered. */
  automation?: { id: string; triggerType: 'manual' | 'schedule' | 'webhook'; cronExpression?: string };
}

export interface AttentionItem {
  /** `${entity}:${entityId}`, plus `:${ask.id}` for asks. */
  key: string;
  entity: AttentionEntity;
  entityId: string;
  /** Chat name, workflow name, automation name. */
  title: string;
  /** In-app route (04-screen-map §1), including `?dock=` (R-4). */
  href: string;
  project?: { id: string; name: string };
  /** A worker chat rolls up to its orchestrator chat. */
  parent?: { entity: 'chat'; id: string; title: string };
  state: AttentionItemState;
  /** ISO time the item started needing you / started running. */
  since: string;
  ask?: AttentionAsk;
  progress?: AttentionProgress;
  /** A Stop endpoint exists for this item right now. */
  stoppable: boolean;
  /** Who/what runs it (D-92). */
  meta?: ActivityMeta;
}

export interface AttentionEntityCounts {
  needsYou: number;
  running: number;
}

export interface AttentionCounts {
  needsYou: number;
  running: number;
  byEntity: Record<AttentionEntity, AttentionEntityCounts>;
}

export interface AttentionSnapshot {
  /** Monotonic; every SSE delta carries the next value. */
  seq: number;
  generatedAt: string;
  /** Oldest ask first. */
  needsYou: AttentionItem[];
  /** Longest-running first. */
  running: AttentionItem[];
  counts: AttentionCounts;
}

export interface AttentionFilter {
  projectId?: string;
}

// ── SSE payloads (`global` scope) ─────────────────────────────────

export interface AttentionUpsertEventData {
  seq: number;
  item: AttentionItem;
}

export interface AttentionRemoveEventData {
  seq: number;
  key: string;
}

/**
 * Totals after the delta carrying the same `seq`. It does not advance `seq`:
 * it exists for counts-only consumers (tray, menu bar, badge — G-05) that
 * never hold the items.
 */
export interface AttentionCountsEventData {
  seq: number;
  counts: AttentionCounts;
}

export const ATTENTION_EVENT_KINDS = ['attention.upsert', 'attention.remove', 'attention.counts'] as const;
export type AttentionEventKind = (typeof ATTENTION_EVENT_KINDS)[number];

/** Whether an item is in the Needs you list (else Running). */
export function isAttentionAsk(item: Pick<AttentionItem, 'ask'>): boolean {
  return item.ask !== undefined;
}

/** Zeroed counts, for an empty snapshot. */
export function emptyAttentionCounts(): AttentionCounts {
  return {
    needsYou: 0,
    running: 0,
    byEntity: {
      chat: { needsYou: 0, running: 0 },
      workflow_run: { needsYou: 0, running: 0 },
      automation_execution: { needsYou: 0, running: 0 },
    },
  };
}

/** Counts derived from the two lists. The server and every client use this one rule. */
export function countAttention(needsYou: readonly AttentionItem[], running: readonly AttentionItem[]): AttentionCounts {
  const counts = emptyAttentionCounts();
  counts.needsYou = needsYou.length;
  counts.running = running.length;
  for (const item of needsYou) counts.byEntity[item.entity].needsYou += 1;
  for (const item of running) counts.byEntity[item.entity].running += 1;
  return counts;
}

/** Sort order for both lists: oldest `since` first, key as the tie-break. */
export function compareAttentionItems(a: AttentionItem, b: AttentionItem): number {
  const d = Date.parse(a.since) - Date.parse(b.since);
  if (d !== 0 && Number.isFinite(d)) return d;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
