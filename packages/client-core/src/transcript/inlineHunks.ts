// ────────────────────────────────────────────────────────────────
// Inline diff hunks for a file-op step (moved from apps/web
// blocks/changes/changePaths.ts in P4-07 so the transcript model is
// React-free and shared).
// ────────────────────────────────────────────────────────────────

import type { ToolFileOp } from '../stream/types.js';
import type { InlineHunk, InlineHunks } from './types.js';

/** Keep inline diffs readable: the Changes tab has the full thing. */
export const INLINE_DIFF_MAX_LINES = 160;

function splitLines(s: string): string[] {
  const lines = s.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Best-effort hunks for a file op whose provider did not ship a structured
 * patch (older messages, other providers): rebuilt from the tool's own
 * arguments. `Edit` carries the exact before/after text; `Write` carries the
 * whole new content. Line numbers are unknown, so `oldStart`/`newStart` are 0
 * and the renderer hides the gutter.
 */
export function hunksFromArgs(tool: string, args: unknown): InlineHunks | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  const name = tool.toLowerCase();
  const hunks: InlineHunk[] = [];
  let budget = INLINE_DIFF_MAX_LINES;
  let truncated = false;

  const push = (oldText: string | undefined, newText: string | undefined): void => {
    if (budget <= 0) {
      truncated = true;
      return;
    }
    const lines: string[] = [];
    const oldLines = oldText != null ? splitLines(oldText) : [];
    const newLines = newText != null ? splitLines(newText) : [];
    for (const l of oldLines) lines.push(`-${l}`);
    for (const l of newLines) lines.push(`+${l}`);
    if (lines.length === 0) return;
    if (lines.length > budget) {
      lines.length = budget;
      truncated = true;
    }
    budget -= lines.length;
    hunks.push({ oldStart: 0, oldLines: oldLines.length, newStart: 0, newLines: newLines.length, lines });
  };

  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

  if (name.endsWith('multiedit') && Array.isArray(a['edits'])) {
    for (const e of a['edits'] as Array<Record<string, unknown>>) {
      push(str(e['old_string']), str(e['new_string']));
    }
  } else if (typeof a['old_string'] === 'string' || typeof a['new_string'] === 'string') {
    push(str(a['old_string']), str(a['new_string']));
  } else if (typeof a['content'] === 'string') {
    push(undefined, a['content']);
  } else {
    return null;
  }
  return hunks.length > 0 ? { hunks, truncated } : null;
}

/** Hunks for a file op: the provider's structured patch when present, else rebuilt from args. */
export function resolveInlineHunks(fileOp: ToolFileOp | undefined, tool: string, args: unknown): InlineHunks | null {
  if (fileOp?.hunks && fileOp.hunks.length > 0) {
    return { hunks: fileOp.hunks, truncated: fileOp.hunksTruncated === true };
  }
  return hunksFromArgs(tool, args);
}
