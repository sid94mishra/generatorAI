// ────────────────────────────────────────────────────────────────
// changePaths — one definition of "how a changed file is named in the chat".
//
// The provider reports absolute paths (`C:\…\executions\<chat>\source\todo-api\src\x.js`);
// the Changes tab names the same file `todo-api/src/x.js` (repo alias + repo-relative
// path, alias `.` for the workspace root). Every surface that shows a changed file
// in the transcript — the per-op chips, the end-of-turn summary, the composer tray —
// goes through `toDisplayPath` so a click in one lands on the same row in the other.
// ────────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react';
import type { ToolFileOp, ToolFileOpHunk } from '@generatorai/client-core';

/** Managed workspaces live at `…/workspaces/executions/<ownerId>/`. */
const EXECUTION_MARKER = '/workspaces/executions/';
/** Legacy layout: linked codebases were checked out under `source/<alias>/`. */
const SOURCE_PREFIX = 'source/';

export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * One mounted directory, as the naming layer needs it: where it lives on
 * disk and what the chat calls it.
 */
export interface MountRoot {
  alias: string;
  path: string;
}

/** A bare string root is a mount with no alias (legacy local-folder chats). */
export type PathRoot = MountRoot | string;

function asMountRoot(root: PathRoot): MountRoot {
  return typeof root === 'string' ? { alias: '', path: root } : root;
}

/**
 * The chat's mounts, in workspace order, so an absolute path the agent
 * reported can be named the way the Changes tab names it. Provided by the
 * page via `PathRootsContext` from `GET /api/workspaces/:id` (`mounts`).
 */
export const PathRootsContext = createContext<readonly PathRoot[]>([]);
export function usePathRoots(): readonly PathRoot[] {
  return useContext(PathRootsContext);
}

/**
 * Should a displayed path carry its mount alias?
 *
 * Only when there is more than one mount. With a single mount the alias is
 * the same word on every row — pure noise that also makes the path wrong to
 * copy into a terminal.
 */
export function shouldPrefixAlias(mountCount: number): boolean {
  return mountCount > 1;
}

/**
 * `<alias>/<path>` or `<path>`, by the rule above. The workspace root
 * (alias `.`) is never prefixed.
 */
export function withAliasPrefix(alias: string, path: string, multi: boolean): string {
  if (!multi || !alias || alias === '.') return path;
  return `${alias}/${path}`;
}

/**
 * Display path for a file the agent touched, in the Changes tab's own naming.
 *
 * The mounts are the authority: a path under a mount is that mount's
 * repo-relative path, prefixed with the alias only when the chat has more
 * than one mount. The managed-workspace and last-three-segments rules below
 * are fallbacks for chats whose mounts we have not loaded (or that predate
 * them).
 *
 *   <mount todo-api>/src/a.js  (2 mounts)  → todo-api/src/a.js
 *   <mount todo-api>/src/a.js  (1 mount)   → src/a.js
 *   …/executions/<id>/notes.md             → notes.md
 *   anything else                          → last three segments
 */
export function toDisplayPath(raw: string, roots: readonly PathRoot[] = []): string {
  const norm = normalizeSlashes(raw);
  const lower = norm.toLowerCase();
  const mounts = roots.map(asMountRoot).filter((m) => m.path);
  const multi = shouldPrefixAlias(mounts.length);
  // Longest root first: a nested mount (`repo/packages/ui`) must win over the
  // parent it sits inside, or every one of its files is named after the parent.
  const ordered = [...mounts].sort(
    (a, b) => normalizeSlashes(b.path).length - normalizeSlashes(a.path).length,
  );
  for (const mount of ordered) {
    const r = normalizeSlashes(mount.path).replace(/\/+$/, '');
    if (!r) continue;
    if (lower.startsWith(`${r.toLowerCase()}/`)) {
      return withAliasPrefix(mount.alias, norm.slice(r.length + 1), multi);
    }
  }
  const i = norm.indexOf(EXECUTION_MARKER);
  if (i !== -1) {
    const rest = norm.slice(i + EXECUTION_MARKER.length);
    const slash = rest.indexOf('/');
    if (slash !== -1) {
      const inside = rest.slice(slash + 1);
      return inside.startsWith(SOURCE_PREFIX) ? inside.slice(SOURCE_PREFIX.length) : inside;
    }
  }
  if (!/^([a-z]:)?\//i.test(norm)) return norm; // already relative
  const parts = norm.split('/').filter(Boolean);
  return parts.length > 3 ? parts.slice(-3).join('/') : parts.join('/');
}

/**
 * The path a checkpoint restore takes: REPO-RELATIVE, never alias-prefixed.
 *
 * A checkpoint belongs to exactly one mount and its git tree IS that mount's
 * tree, so `<alias>/<path>` names a file that does not exist in it — a
 * discard sent that way restored nothing at all, silently. Callers that hold
 * a display path (the tray, the transcript) get the prefix stripped here
 * rather than each having to know the rule.
 */
export function toRestorePath(pathOrDisplayPath: string, alias: string): string {
  if (!alias || alias === '.') return pathOrDisplayPath;
  return pathOrDisplayPath.startsWith(`${alias}/`)
    ? pathOrDisplayPath.slice(alias.length + 1)
    : pathOrDisplayPath;
}

export interface InlineHunks {
  hunks: ToolFileOpHunk[];
  truncated: boolean;
}

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
  const hunks: ToolFileOpHunk[] = [];
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
export function resolveInlineHunks(
  fileOp: ToolFileOp | undefined,
  tool: string,
  args: unknown,
): InlineHunks | null {
  if (fileOp?.hunks && fileOp.hunks.length > 0) {
    return { hunks: fileOp.hunks, truncated: fileOp.hunksTruncated === true };
  }
  return hunksFromArgs(tool, args);
}

export type ChangeStatusLetter = 'A' | 'M' | 'D' | 'R';

export function statusFromOpKind(kind: ToolFileOp['kind']): ChangeStatusLetter {
  if (kind === 'create') return 'A';
  if (kind === 'delete') return 'D';
  return 'M';
}
