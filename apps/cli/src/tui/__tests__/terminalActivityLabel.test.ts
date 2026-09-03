import { describe, expect, it, vi } from 'vitest';
import { terminalActivityLabel } from '../panes.js';

// Phase 5 item 6 — idle-state display. The server already computes and
// enforces an idle timeout (`TerminalService.reapIdle`) but no client had
// ever surfaced elapsed-since-last-activity as live UI state before this.
describe('terminalActivityLabel', () => {
  it('reports "active" when nothing has happened yet (no lastActivityAt at all)', () => {
    expect(terminalActivityLabel({})).toBe('active');
  });

  it('reports "active" for activity in the last few seconds ("just now")', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(terminalActivityLabel({ lastActivityAt: 999_000 })).toBe('just now');
    vi.useRealTimers();
  });

  it('reports elapsed time via the same formatRelative convention used elsewhere in the app', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(terminalActivityLabel({ lastActivityAt: 1_000_000 - 5 * 60_000 })).toBe('5m ago');
    expect(terminalActivityLabel({ lastActivityAt: 1_000_000 - 2 * 3_600_000 })).toBe('2h ago');
    vi.useRealTimers();
  });

  it("prefers 'exited' over the idle clock once the process has a real exit code — including 0", () => {
    expect(terminalActivityLabel({ exitCode: 0, lastActivityAt: Date.now() })).toBe('exited (0)');
    expect(terminalActivityLabel({ exitCode: 137, lastActivityAt: Date.now() - 60_000 })).toBe(
      'exited (137)',
    );
  });

  it('treats a still-running terminal (exitCode: null) as not exited', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(terminalActivityLabel({ exitCode: null, lastActivityAt: 1_000_000 - 5 * 60_000 })).toBe(
      '5m ago',
    );
    vi.useRealTimers();
  });
});
