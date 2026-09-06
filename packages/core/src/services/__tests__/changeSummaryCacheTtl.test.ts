// ────────────────────────────────────────────────────────────────
// Review 3.5 — the working-tree cache that could never hit.
//
// During a turn a "live" checkpoint is captured every
// `WorkspaceCheckpointService.LIVE_DEBOUNCE_MS` (2 s), and each one rebuilds
// the change summary. `ChangeSummaryService` caches the materialised working
// tree to make the second and later rebuilds cheap — but its TTL was 1.5 s,
// so the entry had ALWAYS just expired by the time the next snapshot asked
// for it. The cache never hit on the one path it exists to serve, and every
// live snapshot re-ran a full rebuild plus a re-anchoring pass over every
// review comment.
//
// The two constants live in different packages, which is how they drifted
// apart unnoticed. This is the relationship stated as a test rather than as a
// comment, so the next person to tune either one is told immediately.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { ChangeSummaryService } from '@generatorai/changes';
import { WorkspaceCheckpointService } from '../WorkspaceCheckpointService.js';

describe('working-tree cache TTL vs live snapshot interval (review 3.5)', () => {
  it('keeps a cached working tree alive at least until the next live snapshot', () => {
    expect(ChangeSummaryService.WORKING_TREE_TTL_MS).toBeGreaterThanOrEqual(
      WorkspaceCheckpointService.LIVE_DEBOUNCE_MS,
    );
  });

  it('does not cache so long that a manual refresh shows stale state', () => {
    // The cache exists to span one snapshot cycle, not to outlive a user's
    // "refresh" click. Twice the interval is the outer bound.
    expect(ChangeSummaryService.WORKING_TREE_TTL_MS).toBeLessThanOrEqual(
      WorkspaceCheckpointService.LIVE_DEBOUNCE_MS * 2,
    );
  });
});
