// ────────────────────────────────────────────────────────────────
// checkpointGroups — one timeline row per turn, not per mount.
//
// A checkpoint belongs to exactly ONE mount: a turn that touches three
// mounts writes three checkpoints, and writes them twice (before and after).
// Listed raw that is six rows for one prompt. So the sheet groups by
// `turnId`, the way web's `checkpointGroups.ts` does, and rewinding a group
// restores every mount that turn moved.
//
// Pure port of the web module so both apps make the same rows from the
// same rows.
// ────────────────────────────────────────────────────────────────

import type { CheckpointRow } from '../changes/api';
import { CHECKPOINT_LABEL } from '../changes/statusStyle';

/** Snapshots that exist for bookkeeping rather than as rewind targets. */
const NOISE_KINDS = new Set(['live']);

export interface CheckpointGroup {
  key: string;
  turnId?: string;
  kind: string;
  label: string;
  /** Earliest creation time in the group — when the turn started. */
  createdAt: number;
  promptExcerpt?: string;
  /** Mount aliases this turn touched, in first-seen order. */
  aliases: string[];
  /** One checkpoint per mount: the `before` snapshots when the turn has them. */
  restoreTargets: CheckpointRow[];
  /** True when rewinding undoes the turn (targets are `before` snapshots). */
  undoesTurn: boolean;
  fileCount: number;
  additions: number;
  deletions: number;
  /** Revision selector for "compare against this point". */
  compareValue: string;
}

/**
 * Checkpoint times as epoch milliseconds.
 *
 * The server holds `createdAt` as a `Date`, so it arrives over the wire as an
 * ISO string even though the client type says `number`. `Math.min` and `a - b`
 * on that string produce NaN, which is how every row in the Checkpoints sheet
 * came to read "Invalid Date" and why the list was not actually sorted.
 * A value that looks like epoch SECONDS (the shape of the `created_at`
 * column) is widened to milliseconds; anything smaller is passed through so
 * relative fixtures keep their own scale.
 */
const SECONDS_FLOOR = 1e9;
const MILLIS_FLOOR = 1e12;

function widen(n: number): number {
  return n >= SECONDS_FLOOR && n < MILLIS_FLOOR ? n * 1000 : n;
}

export function checkpointTime(value: string | number | Date | null | undefined): number {
  if (value == null) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return widen(value);
  const numeric = Number(value);
  if (value.trim() !== '' && Number.isFinite(numeric)) return widen(numeric);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function groupCheckpoints(records: readonly CheckpointRow[]): CheckpointGroup[] {
  const groups = new Map<string, CheckpointRow[]>();
  const order: string[] = [];

  for (const record of records) {
    if (NOISE_KINDS.has(record.kind)) continue;
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

    const byAlias = new Map<string, CheckpointRow>();
    for (const record of preferred) {
      const existing = byAlias.get(record.repoAlias);
      if (!existing || (record.seq ?? 0) < (existing.seq ?? 0)) byAlias.set(record.repoAlias, record);
    }

    const counted = afters.length > 0 ? afters : members;
    const createdAt = members.reduce(
      (min, m) => Math.min(min, checkpointTime(m.createdAt)),
      checkpointTime(first.createdAt),
    );

    return {
      key,
      ...(first.turnId ? { turnId: first.turnId } : {}),
      kind: first.kind,
      label: first.label ?? CHECKPOINT_LABEL[first.kind] ?? first.kind,
      createdAt,
      ...(members.find((m) => m.promptExcerpt)?.promptExcerpt
        ? { promptExcerpt: members.find((m) => m.promptExcerpt)!.promptExcerpt! }
        : {}),
      aliases: [...new Set(members.map((m) => m.repoAlias))],
      restoreTargets: [...byAlias.values()],
      undoesTurn,
      fileCount: counted.reduce((n, m) => n + (m.fileCount ?? 0), 0),
      additions: counted.reduce((n, m) => n + (m.additions ?? 0), 0),
      deletions: counted.reduce((n, m) => n + (m.deletions ?? 0), 0),
      compareValue: first.turnId ? `turn:${first.turnId}` : `checkpoint:${first.id}`,
    };
  });
}

/** `frontend and backend`, `frontend, backend and docs`. */
export function formatAliasList(aliases: readonly string[]): string {
  const names = aliases.map((a) => (a === '.' ? 'the workspace' : a));
  if (names.length === 0) return 'this workspace';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

/**
 * Human one-liner for the prompt that produced a checkpoint. Review
 * submissions are machine-formatted XML; surface the reviewer's comments.
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
