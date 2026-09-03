// ────────────────────────────────────────────────────────────────
// N4 — a resume that has to skip past a hole is data loss, and it now says so.
//
// The clamp itself is unavoidable: `seenSequenceIds` only retains a window
// below the tip, so refetching from further back would re-process events we
// can no longer recognise as duplicates. What was wrong is that it happened in
// silence — no counter, no marker, nothing in front of the user.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveGapResume } from '@/stores/sseManager.js';
import { useConnectionStore } from '@/stores/connectionStore.js';
import { clientMetrics, _resetClientMetrics } from '@/lib/clientMetrics.js';

describe('resolveGapResume', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
    _resetClientMetrics();
  });

  it('resumes from the contiguous frontier when the hole is inside the window', () => {
    // A single dropped frame just below the tip is fully recoverable.
    expect(resolveGapResume(1_200, 1_400, 's1')).toBe(1_200);
    expect(clientMetrics.streamGapSkippedEvents).toBe(0);
    expect(useConnectionStore.getState().getConnection('s1').unrecoverableEvents).toBe(0);
  });

  it('clamps when the hole predates the dedup window', () => {
    // Frontier stuck at 10 while the tip ran to 5000: everything from 11 to
    // 3000 is unreachable.
    expect(resolveGapResume(10, 5_000, 's1')).toBe(3_000);
  });

  it('counts the skipped sequences instead of dropping them silently', () => {
    resolveGapResume(10, 5_000, 's1');
    expect(clientMetrics.streamGapSkippedEvents).toBe(2_990);
  });

  it('records the loss against the connection so the UI can surface it', () => {
    resolveGapResume(10, 5_000, 's1');
    const conn = useConnectionStore.getState().getConnection('s1');
    expect(conn.unrecoverableEvents).toBe(2_990);
    expect(conn.lastGapAt).toBeGreaterThan(0);
  });

  it('accumulates across repeated gaps on the same connection', () => {
    resolveGapResume(10, 5_000, 's1');
    resolveGapResume(3_000, 8_000, 's1');
    expect(useConnectionStore.getState().getConnection('s1').unrecoverableEvents).toBe(2_990 + 3_000);
  });

  it('keeps connections independent', () => {
    resolveGapResume(10, 5_000, 's1');
    expect(useConnectionStore.getState().getConnection('s2').unrecoverableEvents).toBe(0);
  });
});
