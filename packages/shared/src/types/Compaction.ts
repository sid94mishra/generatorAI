// ────────────────────────────────────────────────────────────────
// Conversation compaction — one vocabulary for every provider
// (docs/compaction/README.md).
//
// Each provider summarises a long conversation in its own way (Claude
// `/compact` and `compact_boundary`, Codex `thread/compact/start` and the
// `contextCompaction` item, Copilot `history.compact` and
// `session.compaction_*`, OpenCode `summarize`, ACP `compaction_update`).
// Every adapter maps its own events onto the three `harness.session_info`
// types below, so the server, the transcript and the gauge treat them alike.
// ────────────────────────────────────────────────────────────────

/** `harness.session_info` info types of a compaction. */
export const COMPACTION_INFO = {
  /** A compaction began. */
  start: 'compaction_start',
  /** A compaction finished: the provider continues from a summary. */
  boundary: 'compact_boundary',
  /** A compaction failed; the conversation is unchanged. */
  failed: 'compaction_failed',
} as const;

export type CompactionInfoType = (typeof COMPACTION_INFO)[keyof typeof COMPACTION_INFO];

/** Who started it: the user (button, command) or the provider (its window filled up). */
export type CompactionTrigger = 'manual' | 'auto';

/** The `data` of a compaction `harness.session_info` event, beyond `infoType` and `message`. */
export interface CompactionInfo {
  trigger: CompactionTrigger;
  /** Context tokens before, when the provider reports them. */
  preTokens?: number;
  /** Context tokens after, when the provider reports them. */
  postTokens?: number;
  /** The summary the conversation continues from, when the provider exposes it. */
  summary?: string;
  /** Why it failed (`compaction_failed`). */
  error?: string;
  provider?: string;
}

/**
 * A finished compaction as the transcript keeps it (`ChatMessage.metadata.compaction` on a `system` row): the
 * divider a reload shows, and where a handoff to another provider starts from (`summary`).
 */
export interface CompactionRecord extends CompactionInfo {
  model?: string;
  /**
   * Done by the app rather than the provider: the provider had no compaction of its own, so the app summarised the
   * chat and the next prompt starts a fresh provider session from the summary.
   */
  synthetic?: boolean;
}

/** One-line description, the same everywhere: "Conversation compacted · 152K → 21K tokens". */
export function describeCompaction(record: Pick<CompactionInfo, 'trigger' | 'preTokens' | 'postTokens'>): string {
  const head = record.trigger === 'auto' ? 'Conversation compacted automatically' : 'Conversation compacted';
  if (record.preTokens != null && record.postTokens != null) {
    return `${head} · ${formatCompactTokens(record.preTokens)} → ${formatCompactTokens(record.postTokens)} tokens`;
  }
  if (record.preTokens != null) return `${head} · from ${formatCompactTokens(record.preTokens)} tokens`;
  return head;
}

function formatCompactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}
