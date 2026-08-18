// ────────────────────────────────────────────────────────────────
// Live preview — what the agent is doing, in a form that survives a lock.
//
// Two sources, both from the driver's own recorder:
//
//   • Per-turn window PNGs, captured through Windows Graphics Capture. These
//     keep working when the session is locked or an RDP client disconnects —
//     measured against the same run whose whole-screen video was nothing but
//     the lock screen.
//   • `cursor.jsonl`, which the recorder appends to live (~30 ms samples) with
//     the agent cursor's screen position.
//
// The cursor overlay is its own window, so it never appears in a window
// capture. That is why the position is carried as DATA and drawn by the client
// instead: it is the only way to show the cursor in the two cases that matter —
// a locked workstation and a headless VPS.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface CursorSample {
  /** Milliseconds since the recorder started. */
  t: number;
  x: number;
  y: number;
}

export interface PreviewFrame {
  turn: string;
  /** Newest capture for the turn: `after` once it exists, else `before`. */
  kind: 'before' | 'click' | 'after';
  tool: string | null;
  /** Screen coordinates of the click, when the turn was a click. */
  point?: { x: number; y: number };
}

/**
 * Reads new cursor samples appended since `offset`.
 *
 * A partial trailing line is normal — the recorder is writing as we read — so
 * the returned offset stops at the last newline rather than the file end.
 */
export async function readCursorSince(
  runDir: string,
  offset: number,
): Promise<{ samples: CursorSample[]; offset: number }> {
  const file = path.join(runDir, 'cursor.jsonl');
  let size: number;
  try {
    size = (await fs.stat(file)).size;
  } catch {
    return { samples: [], offset };
  }
  if (size <= offset) return { samples: [], offset: Math.min(offset, size) };

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, 'r');
    const length = size - offset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    const text = buffer.toString('utf8');
    const lastBreak = text.lastIndexOf('\n');
    if (lastBreak < 0) return { samples: [], offset };

    const samples: CursorSample[] = [];
    for (const line of text.slice(0, lastBreak).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { t_ms?: number; x?: number; y?: number };
        if (typeof parsed.t_ms === 'number' && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          samples.push({ t: parsed.t_ms, x: parsed.x, y: parsed.y });
        }
      } catch {
        // A line torn by a concurrent write — the next read picks it up.
      }
    }
    return { samples, offset: offset + lastBreak + 1 };
  } catch {
    return { samples: [], offset };
  } finally {
    await handle?.close();
  }
}

/**
 * Whether a turn's captures are scoped to a target window.
 *
 * The recorder falls back to grabbing the WHOLE DISPLAY when an action has no
 * target process — `launch_app` is the common case, since the app it is asked
 * to start does not exist yet. Those frames show whatever the operator had on
 * screen, including the lock screen, which breaks the promise the preview makes
 * about capturing only the agent's window.
 *
 * The driver says so itself in `evidence.json`: a real capture is
 * `{status: 'captured'}`, a fallback is
 * `{status: 'not_applicable', classification: 'no_target_pid'}`. Missing or
 * unreadable evidence counts as unscoped, so this fails closed.
 */
export async function isWindowScopedTurn(turnDir: string): Promise<boolean> {
  try {
    const evidence = JSON.parse(await fs.readFile(path.join(turnDir, 'evidence.json'), 'utf8')) as Record<
      string,
      { state?: { status?: unknown } } | undefined
    >;
    return (['after', 'before'] as const).some((phase) => evidence[phase]?.state?.status === 'captured');
  } catch {
    return false;
  }
}

/**
 * Turn folders that have appeared since we last looked.
 *
 * A turn is only reported once it has a readable `action.json`, so a folder
 * caught mid-write is picked up on the next pass instead of streaming a frame
 * with no idea what produced it.
 */
export async function readFramesSince(
  runDir: string,
  seen: Set<string>,
): Promise<PreviewFrame[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(runDir);
  } catch {
    return [];
  }

  const frames: PreviewFrame[] = [];
  for (const name of entries.filter((e) => e.startsWith('turn-')).sort()) {
    if (seen.has(name)) continue;
    let action: Record<string, unknown>;
    try {
      action = JSON.parse(await fs.readFile(path.join(runDir, name, 'action.json'), 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      continue;
    }

    if (!(await isWindowScopedTurn(path.join(runDir, name)))) {
      seen.add(name);
      continue;
    }

    let kind: PreviewFrame['kind'] | null = null;
    for (const candidate of ['after', 'click', 'before'] as const) {
      try {
        await fs.access(path.join(runDir, name, `${candidate}.png`));
        kind = candidate;
        break;
      } catch {
        // Try the next one.
      }
    }
    if (!kind) continue;

    seen.add(name);
    const point = action['click_point'] as { x?: number; y?: number } | undefined;
    frames.push({
      turn: name,
      kind,
      tool: typeof action['tool'] === 'string' ? action['tool'] : null,
      ...(point && typeof point.x === 'number' && typeof point.y === 'number'
        ? { point: { x: point.x, y: point.y } }
        : {}),
    });
  }
  return frames;
}
