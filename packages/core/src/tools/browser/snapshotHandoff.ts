// ────────────────────────────────────────────────────────────────
// snapshotHandoff — W16 / X-17: an accessibility snapshot is handed off ON
// DISK, never auto-attached to a tool result.
//
// X-17 was applied to `read_page` and stopped there, which missed the call
// that actually dominates the cost. `open_browser_page` is the FIRST tool of
// every browser loop and it inlined the entire tree (`snapshot:
// snapshot?.snapshot ?? ''`), so every session paid the full a11y-tree token
// bill before the model had asked for a single element — and then paid it
// again on the first `read_page`. Both tools now share this one code path.
//
// The file goes inside the workspace tree, not `os.tmpdir()`: the harness's
// Read tool is confined to the workspace, so a temp-dir path is a path the
// model cannot open — which is how X-17 was silently non-functional the first
// time. Living in the workspace also means workspace deletion cleans it up,
// with no separate reaper to get wrong.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserToolContext } from './browserToolTypes.js';

export interface SnapshotHandoff {
  /** Absolute path the model can pass to its Read tool. */
  snapshotFile: string;
  /** Size on disk, so the model can judge whether reading it is worth it. */
  bytes: number;
}

/**
 * Write `snapshot` under `<workspaceRoot>/browser/snapshots/` and return the
 * path. Returns `null` when there is no workspace root or the write failed —
 * callers fall back to an inline snapshot rather than returning nothing, since
 * a tool that silently loses its payload is worse than an expensive one.
 */
export async function writeSnapshotHandoff(
  ctx: BrowserToolContext,
  snapshot: string,
): Promise<SnapshotHandoff | null> {
  const workspaceRoot = ctx.browserService.getWorkspaceRoot(ctx.workspaceId);
  if (!workspaceRoot) return null;
  try {
    const snapshotsDir = path.join(workspaceRoot, 'browser', 'snapshots');
    await fs.mkdir(snapshotsDir, { recursive: true });
    const snapshotFile = path.join(snapshotsDir, `snap-${randomUUID().slice(0, 8)}.txt`);
    await fs.writeFile(snapshotFile, snapshot, 'utf-8');
    return { snapshotFile, bytes: Buffer.byteLength(snapshot, 'utf-8') };
  } catch {
    return null;
  }
}

/** The one hint string both tools use, so the model learns a single habit. */
export const SNAPSHOT_HANDOFF_HINT =
  'Read snapshotFile with the Read tool to inspect element refs. Most steps need only the url and title returned here.';
