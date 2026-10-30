// ────────────────────────────────────────────────────────────────
// Computer action log (P4-11) — pure folding for the Computer dock tab.
//
// The log is seeded from `GET …/computer/activity` and kept live from the
// `session` scope `computer:<workspaceId>` (`computer.*` events). React-free
// so the fold is testable on its own; `useComputerActivity` in
// computerQueries.ts owns the subscription.
// ────────────────────────────────────────────────────────────────

import type { ComputerActivityRow } from '../platform/HttpPlatformClient.js';

export interface ComputerTimelineEntry {
  id: string;
  /** Epoch ms. */
  at: number;
  kind: 'action' | 'refusal' | 'consent';
  action: string;
  appLabel: string;
  target?: string;
  /** Input tier: `synthetic` and `clipboard` take over the screen. */
  path?: string;
  verified?: boolean;
  message?: string;
  /** The window capture taken for this entry, when one was taken. */
  artifactId?: string;
}

export interface ComputerTimelineState {
  /** Newest first, at most {@link COMPUTER_TIMELINE_MAX}. */
  entries: ComputerTimelineEntry[];
  /** Title of the window the agent last read. */
  windowTitle: string;
  /** Artifact id of the newest snapshot frame. */
  latestFrameId: string | null;
}

export const COMPUTER_TIMELINE_MAX = 60;

export const EMPTY_COMPUTER_TIMELINE: ComputerTimelineState = { entries: [], windowTitle: '', latestFrameId: null };

/** Synthetic input and clipboard paste are the tiers that take over the keyboard and mouse. */
export function tookScreen(path?: string): boolean {
  return path === 'synthetic' || path === 'clipboard';
}

/** Activity rows (oldest first) → entries (newest first). */
export function seedComputerTimeline(rows: readonly ComputerActivityRow[]): ComputerTimelineEntry[] {
  return rows
    .map((e, i): ComputerTimelineEntry => ({
      id: `seed-${i}`,
      at: new Date(e.createdAt).getTime(),
      kind: e.refusalCode ? 'refusal' : 'action',
      action: e.action,
      appLabel: e.appLabel,
      ...(e.target ? { target: e.target } : {}),
      ...(e.path ? { path: e.path } : {}),
      verified: e.verified,
      ...(e.refusalCode ? { message: e.refusalCode } : {}),
      ...(e.artifactId ? { artifactId: e.artifactId } : {}),
    }))
    .reverse()
    .slice(0, COMPUTER_TIMELINE_MAX);
}

function payloadOf(frame: { payload?: unknown; data?: unknown }): Record<string, unknown> {
  // The unified stream wraps events as `{kind, payload}`; `data` is the
  // EventBus's own shape. Either may arrive as a JSON string.
  const raw = frame.payload ?? frame.data;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/**
 * Fold one `computer.*` event. Unknown kinds return the same state object.
 * `id` / `now` are injectable so the fold stays deterministic in tests.
 */
export function foldComputerTimeline(
  state: ComputerTimelineState,
  frame: { kind?: string; payload?: unknown; data?: unknown },
  now: number = Date.now(),
  id: string = `${now}-${Math.random()}`,
): ComputerTimelineState {
  const d = payloadOf(frame);
  const push = (entry: Omit<ComputerTimelineEntry, 'id' | 'at'>, patch: Partial<ComputerTimelineState> = {}) => ({
    ...state,
    ...patch,
    entries: [{ ...entry, id, at: now }, ...state.entries].slice(0, COMPUTER_TIMELINE_MAX),
  });
  const artifactId = typeof d['artifactId'] === 'string' ? d['artifactId'] : undefined;

  switch (frame.kind) {
    case 'computer.session_started':
      return push({ kind: 'action', action: 'session started', appLabel: str(d['provider']) });
    case 'computer.snapshot':
      return push(
        {
          kind: 'action',
          action: 'snapshot',
          appLabel: str(d['appLabel']),
          target: `${str(d['elementCount'] ?? 0)} elements`,
          ...(artifactId ? { artifactId } : {}),
        },
        { windowTitle: str(d['windowTitle']), ...(artifactId ? { latestFrameId: artifactId } : {}) },
      );
    case 'computer.action':
      return push({
        kind: 'action',
        action: str(d['action']),
        appLabel: str(d['appLabel']),
        ...(typeof d['target'] === 'string' ? { target: d['target'] } : {}),
        ...(typeof d['path'] === 'string' ? { path: d['path'] } : {}),
        ...(artifactId ? { artifactId } : {}),
        verified: d['verified'] === true,
      });
    case 'computer.refusal':
      return push({
        kind: 'refusal',
        action: str(d['action']),
        appLabel: str(d['appLabel']),
        message: `${str(d['code'])} — ${str(d['message'])}`,
      });
    case 'computer.consent_required':
      return push({
        kind: 'consent',
        action: str(d['action']),
        appLabel: str(d['appLabel']),
        message: str(d['summary']),
      });
    default:
      return state;
  }
}

/**
 * The frame to show for a log entry. Only snapshots carry a frame of their
 * own (capturing one per action would replace the driver's element index), so
 * an action falls back to the last window the agent read before it.
 */
export function frameForEntry(
  entries: readonly ComputerTimelineEntry[],
  entryId: string,
): { artifactId: string; fallback: boolean } | null {
  const index = entries.findIndex((e) => e.id === entryId);
  if (index < 0) return null;
  const source = entries.slice(index).find((e) => e.artifactId);
  return source?.artifactId ? { artifactId: source.artifactId, fallback: source.id !== entryId } : null;
}
