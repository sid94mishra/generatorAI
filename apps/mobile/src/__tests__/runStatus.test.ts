import { describe, expect, it } from 'vitest';

import { formatDuration, relativeTime, runElapsed } from '../components/runs/formatTime';
import {
  isActive,
  isTerminal,
  needsAttention,
  statusLabel,
  statusStyle,
} from '../components/runs/statusStyle';

const NOW = 1_700_000_000_000;

describe('relativeTime', () => {
  it('reports a missing timestamp honestly', () => {
    expect(relativeTime(null, NOW)).toBe('not started');
    expect(relativeTime(undefined, NOW)).toBe('not started');
  });

  it('clamps a future timestamp instead of saying "in 3 seconds"', () => {
    // Phone and server clocks differ. A run that just started must not render
    // as happening in the future — that reads as a bug, not a clock skew.
    expect(relativeTime(NOW + 60_000, NOW)).toBe('just now');
  });

  it('scales through the units', () => {
    expect(relativeTime(NOW - 1_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 44_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 90_000, NOW)).toBe('1m ago');
    expect(relativeTime(NOW - 3_600_000, NOW)).toBe('1h ago');
    expect(relativeTime(NOW - 90_000_000, NOW)).toBe('1d ago');
  });

  it('falls back to a date beyond a week', () => {
    const result = relativeTime(NOW - 20 * 86_400_000, NOW);
    expect(result).not.toMatch(/ago/);
    expect(result.length).toBeGreaterThan(0);
  });

  it('treats 0 as a real timestamp, not as missing', () => {
    // `at ?? fallback` would wrongly treat epoch 0 as absent. The check must
    // be against null/undefined specifically.
    expect(relativeTime(0, NOW)).not.toBe('not started');
  });
});

describe('formatDuration', () => {
  it('formats across unit boundaries', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(3_600_000)).toBe('1h 0m');
    expect(formatDuration(5_430_000)).toBe('1h 30m');
  });

  it('never renders a negative or non-finite duration', () => {
    // Clock skew can make completedAt < startedAt.
    expect(formatDuration(-5_000)).toBe('0s');
    expect(formatDuration(Number.NaN)).toBe('0s');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s');
  });
});

describe('runElapsed', () => {
  it('returns null when the run never started', () => {
    // Callers omit the element entirely rather than showing a false "0s".
    expect(runElapsed({}, NOW)).toBeNull();
    expect(runElapsed({ startedAt: null }, NOW)).toBeNull();
  });

  it('measures to now while running', () => {
    expect(runElapsed({ startedAt: NOW - 5_000 }, NOW)).toBe(5_000);
  });

  it('freezes at completion once finished', () => {
    // A completed run must not keep ticking.
    expect(runElapsed({ startedAt: NOW - 10_000, completedAt: NOW - 4_000 }, NOW)).toBe(6_000);
  });
});

describe('status classification', () => {
  it('flags exactly the statuses that block on a human', () => {
    // This drives the "Needs attention" grouping — the single most valuable
    // thing a phone surfaces, because a blocked run stalls everything
    // downstream until someone notices.
    for (const status of ['paused', 'awaiting_input', 'failed']) {
      expect(needsAttention(status), status).toBe(true);
    }
    for (const status of ['running', 'completed', 'ready', 'skipped', 'cancelled']) {
      expect(needsAttention(status), status).toBe(false);
    }
  });

  it('classifies in-flight statuses', () => {
    for (const status of ['running', 'starting', 'ready', 'validating', 'retry_wait', 'finalizing']) {
      expect(isActive(status), status).toBe(true);
    }
    expect(isActive('completed')).toBe(false);
    expect(isActive('paused')).toBe(false);
  });

  it('classifies terminal statuses', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'skipped']) {
      expect(isTerminal(status), status).toBe(true);
    }
    // Polling is driven off this: a paused run must keep polling because it
    // can still be resumed, but a completed one must not hold the radio open.
    expect(isTerminal('paused')).toBe(false);
    expect(isTerminal('running')).toBe(false);
  });

  it('never leaves a status without a style', () => {
    // An unstyled pill renders as invisible text on an invisible background.
    for (const status of ['running', 'completed', 'failed', 'a-status-from-a-newer-server', '']) {
      const [bg, fg] = statusStyle(status);
      expect(bg.length).toBeGreaterThan(0);
      expect(fg.length).toBeGreaterThan(0);
    }
  });

  it('uses status-semantic colours, never accent colours', () => {
    // "Failed" must read as failure whatever accent the user picked.
    expect(statusStyle('failed')).toEqual(['bg-danger-muted', 'text-danger']);
    expect(statusStyle('completed')).toEqual(['bg-success-muted', 'text-success']);
    expect(statusStyle('paused')).toEqual(['bg-warning-muted', 'text-warning']);
    for (const status of ['failed', 'completed', 'paused', 'running']) {
      expect(statusStyle(status).join(' ')).not.toContain('primary');
      expect(statusStyle(status).join(' ')).not.toContain('accent');
    }
  });

  it('humanises wire names', () => {
    expect(statusLabel('awaiting_input')).toBe('Needs you');
    expect(statusLabel('changes_requested')).toBe('Changes requested');
    expect(statusLabel('running')).toBe('Running');
    expect(statusLabel('')).toBe('Unknown');
  });
});

describe('newestRun', () => {
  it('picks the latest update regardless of list order', async () => {
    const { newestRun } = await import('../components/runs/runModel');
    const runs = [
      { id: 'old', status: 'failed', updatedAt: '2026-09-22T10:00:00Z' },
      { id: 'new', status: 'completed', updatedAt: '2026-09-22T12:00:00Z' },
      { id: 'mid', status: 'cancelled', updatedAt: '2026-09-22T11:00:00Z' },
    ];
    expect(newestRun(runs)?.id).toBe('new');
    expect(newestRun([])).toBeUndefined();
  });
});
