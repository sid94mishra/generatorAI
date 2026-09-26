// ────────────────────────────────────────────────────────────────
// checkpointGroups — one scrubber stop per turn, not per mount
// ────────────────────────────────────────────────────────────────
//
// A checkpoint belongs to exactly ONE mount: a turn that touches three
// mounts writes three checkpoints, and writes them twice (before and after).
// Listed raw that is six stops for one prompt, all with the same excerpt and
// the same clock time — the timeline stopped being readable the moment a
// chat had more than one source.
//
// So the scrubber groups by `turnId`: one stop per turn, saying which mounts
// it touched, and rewinding restores every mount that turn moved.
//
// Lives in blocks/ rather than client-core: client-core's only checkpoint
// shape (`WorkspaceCheckpoint`: epoch-ms `createdAt`, no turn / phase / seq)
// lacks the fields this grouping needs, while web's `CheckpointRecord`
// mirrors the server row.

import type { CheckpointRecord } from '@/types/changes.js';

/** Snapshots that exist for bookkeeping rather than as rewind targets. */
const NOISE_KINDS = new Set(['live']);

export interface CheckpointGroup {
  /** Stable React key. */
  key: string;
  turnId?: string;
  kind: CheckpointRecord['kind'];
  label: string | undefined;
  /** Earliest creation time in the group — when the turn started. */
  createdAt: string;
  promptExcerpt: string | undefined;
  phase?: 'before' | 'after';
  /** Mount aliases this turn touched, in first-seen order. */
  aliases: string[];
  /**
   * What "Rewind" restores: one checkpoint per mount.
   *
   * The `before` snapshot when the turn has one, because rewinding to a turn
   * means "put things back the way they were when I wrote that prompt". A
   * group with only `after` snapshots (a stage, a manual checkpoint) restores
   * those instead.
   */
  restoreTargets: CheckpointRecord[];
  /** True when `restoreTargets` are `before` snapshots — i.e. this undoes the turn. */
  undoesTurn: boolean;
  fileCount: number;
  additions: number;
  deletions: number;
  /** Selector for the compare picker. */
  compareValue: string;
}

/**
 * Human label for a checkpoint kind.
 *
 * `pre_restore` is deliberately "Redo point": it is written automatically
 * just before a rewind, and its only purpose is to be the way back. Calling
 * it "Before rewind" described its provenance; this describes what it is for.
 */
export const CHECKPOINT_KIND_LABEL: Record<string, string> = {
  baseline: 'Session start',
  turn: 'Chat turn',
  stage: 'Stage',
  autorun: 'Automation',
  live: 'Auto-save',
  manual: 'Manual snapshot',
  pre_restore: 'Redo point',
};

export function checkpointLabel(record: Pick<CheckpointRecord, 'kind' | 'label'>): string {
  return record.label ?? CHECKPOINT_KIND_LABEL[record.kind] ?? record.kind;
}

export function groupCheckpoints(records: readonly CheckpointRecord[]): CheckpointGroup[] {
  const groups = new Map<string, CheckpointRecord[]>();
  const order: string[] = [];

  for (const record of records) {
    if (NOISE_KINDS.has(record.kind)) continue;
    // A checkpoint with no turn is its own row: manual snapshots, baselines
    // and redo points are single moments, not multi-mount events.
    const key = record.turnId ? `turn:${record.turnId}` : `cp:${record.id}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else {
      groups.set(key, [record]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const members = groups.get(key)!;
    const first = members[0]!;

    const befores = members.filter((m) => m.phase === 'before');
    const afters = members.filter((m) => m.phase === 'after');
    const undoesTurn = befores.length > 0;
    const preferred = undoesTurn ? befores : members;

    // One target per mount. Lowest `seq` wins a tie so the target is the
    // earliest state that side of the turn, never a later re-capture.
    const byAlias = new Map<string, CheckpointRecord>();
    for (const record of preferred) {
      const existing = byAlias.get(record.repoAlias);
      if (!existing || record.seq < existing.seq) byAlias.set(record.repoAlias, record);
    }

    // Counts describe what the turn PRODUCED, so they come from the `after`
    // side when there is one — a `before` snapshot's own delta is noise here.
    const counted = afters.length > 0 ? afters : members;

    const createdAt = members.reduce(
      (min, m) => (m.createdAt < min ? m.createdAt : min),
      first.createdAt,
    );

    return {
      key,
      ...(first.turnId ? { turnId: first.turnId } : {}),
      kind: first.kind,
      label: first.label,
      createdAt,
      promptExcerpt: members.find((m) => m.promptExcerpt)?.promptExcerpt,
      ...(first.phase && members.length === 1 ? { phase: first.phase } : {}),
      aliases: [...new Set(members.map((m) => m.repoAlias))],
      restoreTargets: [...byAlias.values()],
      undoesTurn,
      fileCount: counted.reduce((n, m) => n + m.fileCount, 0),
      additions: counted.reduce((n, m) => n + m.additions, 0),
      deletions: counted.reduce((n, m) => n + m.deletions, 0),
      compareValue: first.turnId ? `turn:${first.turnId}` : `checkpoint:${first.id}`,
    } satisfies CheckpointGroup;
  });
}

/** `frontend and backend`, `frontend, backend and docs`. */
export function formatAliasList(aliases: readonly string[]): string {
  const names = aliases.map((a) => (a === '.' ? 'the workspace' : a));
  if (names.length === 0) return 'this workspace';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

/** `.` is the workspace-root mount. */
export function mountName(alias: string): string {
  return alias === '.' ? 'workspace' : alias;
}

/** A group laid out on the scrubber track. */
export interface CheckpointStop {
  group: CheckpointGroup;
  /** "Turn 3 of 4" for a chat turn; the label or kind otherwise ("Session start"). */
  title: string;
}

function isChatTurn(group: CheckpointGroup): boolean {
  return group.kind === 'turn' && group.turnId !== undefined;
}

/**
 * The scrubber's stops, oldest → newest.
 *
 * The server lists newest first (by per-mount `seq`), so groups are sorted by
 * start time; equal or unparsable times keep the reverse of the server order.
 * Chat turns are numbered among themselves — a baseline or a redo point is
 * not "a turn".
 */
export function checkpointStops(groups: readonly CheckpointGroup[]): CheckpointStop[] {
  const ordered = groups
    .map((group, index) => ({ group, index, time: Date.parse(group.createdAt) }))
    .sort((a, b) => {
      const byTime = a.time - b.time;
      return Number.isFinite(byTime) && byTime !== 0 ? byTime : b.index - a.index;
    })
    .map((entry) => entry.group);
  const turns = ordered.filter(isChatTurn);
  return ordered.map((group) => ({
    group,
    title: isChatTurn(group)
      ? `Turn ${String(turns.indexOf(group) + 1)} of ${String(turns.length)}`
      : checkpointLabel(group),
  }));
}

/**
 * Human-readable one-liner for the prompt that produced a checkpoint.
 *
 * Review submissions are machine-formatted XML, so showing the excerpt raw
 * fills the caption with `<review_feedback …>` noise. Surface the reviewer's
 * actual comments instead — that is what identifies the checkpoint.
 *
 * The excerpt is truncated server-side (200 chars), so the markup is usually
 * cut mid-tag: the closing `</comment>` is treated as optional and the file
 * path is used as a fallback when the excerpt ends before any comment body.
 */
export function describePrompt(excerpt: string): string {
  if (!excerpt.includes('<review_feedback')) return excerpt;

  const comments = [...excerpt.matchAll(/<comment\b[^>]*>([\s\S]*?)(?:<\/comment>|$)/g)]
    .map((m) => (m[1] ?? '').trim())
    .filter(Boolean);
  if (comments.length > 0) return `Review: ${comments.join(' · ')}`;

  const path = /<file\b[^>]*\bpath="([^"]+)"/.exec(excerpt)?.[1];
  return path ? `Review on ${path}` : 'Review feedback';
}
