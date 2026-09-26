// ────────────────────────────────────────────────────────────────
// Transcript read model — shared types (03-domain §2.4; moved from
// apps/web/src/components/chat/redesign/types.ts in P4-07).
//
// A turn's blocks become TIMELINE STEPS (the step rail) and SEGMENTS (steps ↔
// prose ↔ cards in the order the agent produced them). Web renders these in
// `blocks/transcript`; mobile renders the same model next pass.
// ────────────────────────────────────────────────────────────────

import type { StepKind } from '@generatorai/shared/ui-contract';

export type { StepKind };

/** `waiting` = the call is still open but blocked on the human, not the model. */
export type StepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'failed';

/** One unified-diff hunk as the inline diff renders it. */
export interface InlineHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface InlineHunks {
  hunks: InlineHunk[];
  truncated: boolean;
}

export interface TimelineStep {
  id: string;
  kind: StepKind;
  /** Short verb, e.g. "Read", "Searched", "Explore". */
  verb: string;
  /** The target of the verb, rendered mono if `mono` is true. */
  target: string;
  mono?: boolean;
  status: StepStatus;
  /** Short right-aligned metadata: "lines 3–9", "1 match", "+14 −6". */
  meta?: string;
  /** Duration in ms (optional). */
  durationMs?: number;
  /** The raw tool name of a tool-call step (the tool-card registry matches on it). */
  tool?: string;
  /** The tool call's arguments and result, for tool-card renderers (never serialised eagerly). */
  args?: unknown;
  result?: unknown;
  /**
   * Details revealed on expand. May be a thunk so expensive serialisation
   * (pretty-printing multi-MB tool args/results) is deferred until the row is
   * actually expanded.
   */
  detail?: string | (() => string);
  children?: TimelineStep[];
  /** The provider tool callId — lets action buttons address this call. */
  callId?: string;
  /** Per-op +/− line stats for file write/edit tools. */
  fileOp?: { kind: string; filePath: string; additions: number; deletions: number };
  /** Inline unified diff for a file op, resolved lazily; `null` when unavailable. */
  diff?: () => InlineHunks | null;
  /** True for shell-command tools (Bash / PowerShell) — enables "open in terminal". */
  isShell?: boolean;
  /** Error text of a failed tool call (the result envelope's `error`, or its text) for the inline error. */
  errorText?: string;
  /** The chat id of an orchestrator background WORKER this step stands for ("Open worker chat"). */
  workerChatId?: string;
  /** An image this step produced (a browser screenshot the agent took); workspace-relative. */
  image?: { relativePath: string; label: string };
}

export interface UsageInfo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** Tokens read from the prompt cache. */
  cacheReadTokens?: number;
  /** Tokens written to the prompt cache this turn. */
  cacheWriteTokens?: number;
  /** Turn cost — copilot: billing multiplier; claude-agent: USD. */
  cost?: number;
  /** Harness provider that produced this usage. */
  provider?: string;
}
