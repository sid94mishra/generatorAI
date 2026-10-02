// MB-32 CheckpointScrubber model, pure: the turn stops of a workspace's checkpoints (one per turn, oldest first, the
// session start leading), which stop is selected, and the words the card and its accessibility actions say.
import type { WorkspaceCheckpoint } from '@generatorai/client-core';

import { checkpointTime, describePrompt, groupCheckpoints, type CheckpointGroup } from './checkpointGroups';

export interface ScrubberStop {
  key: string;
  /** `turn:<id>` — the compare selector for this point. */
  compareValue: string;
  turnId?: string;
  time: number;
  prompt: string | null;
  fileCount: number;
  additions: number;
  deletions: number;
}

/** Turn groups oldest first (manual snapshots and redo points are not turns). */
export function scrubberStops(checkpoints: readonly WorkspaceCheckpoint[]): ScrubberStop[] {
  return groupCheckpoints(checkpoints)
    .filter((g: CheckpointGroup) => Boolean(g.turnId))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((g) => ({
      key: g.key,
      compareValue: g.compareValue,
      ...(g.turnId ? { turnId: g.turnId } : {}),
      time: g.createdAt,
      prompt: g.promptExcerpt ? describePrompt(g.promptExcerpt) : null,
      fileCount: g.fileCount,
      additions: g.additions,
      deletions: g.deletions,
    }));
}

/** The stop a base selector points at, else the newest. */
export function selectedStop(stops: readonly ScrubberStop[], base: string): number {
  const at = stops.findIndex((s) => s.compareValue === base);
  return at >= 0 ? at : stops.length - 1;
}

/** "14:02" in the device's 24 / 12 hour preference. */
export function stopTime(time: number): string {
  if (!time) return '';
  return new Date(checkpointTime(time)).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function stopTitle(index: number, total: number): string {
  return `Turn ${index + 1} of ${total}`;
}
