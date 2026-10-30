// ────────────────────────────────────────────────────────────────
// What a permission card shows for a file edit.
//
// The server sends a tool's input as bounded, secret-redacted JSON text. For a
// file edit that is an absolute workspace path plus `old_string` / `new_string`
// with every newline escaped as `\n` — legible on a desktop, a wall of noise
// in a phone-width card, and the one decision where the reader most needs to
// see WHAT will change. This turns it into a path and a short before/after.
// Anything it does not recognise (other tools, input the server truncated so
// it no longer parses) returns null and the card shows the raw text as before.
// Pure: tested without a renderer.
// ────────────────────────────────────────────────────────────────

export interface EditPreview {
  path: string;
  removed: string[];
  added: string[];
  /** Lines not shown because the preview is capped. */
  hidden: number;
}

/** Lines of each side shown before "+N more". */
export const PREVIEW_LINES = 10;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'str_replace_based_edit_tool', 'create_file', 'write_file', 'edit_file']);

/** A workspace path from a chat's mount root down: `…/source/<alias>/src/a.ts` → `src/a.ts`. */
export function workspaceRelative(path: string): string {
  const clean = path.replace(/\\/g, '/');
  const m = /\/source\/[^/]+\/(.+)$/.exec(clean);
  if (m) return m[1]!;
  const parts = clean.split('/').filter(Boolean);
  return parts.length > 3 ? parts.slice(-3).join('/') : clean;
}

function lines(text: unknown): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out = text.replace(/\r\n/g, '\n').split('\n');
  if (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

/** Drop the lines both sides share at the start and end, so the change stands out. */
function trimCommon(before: string[], after: string[]): { removed: string[]; added: string[] } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) end += 1;
  return { removed: before.slice(start, before.length - end), added: after.slice(start, after.length - end) };
}

export function editPreview(toolName: string, inputSummary: string | null | undefined): EditPreview | null {
  if (!EDIT_TOOLS.has(toolName) || !inputSummary) return null;
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(inputSummary);
    if (!parsed || typeof parsed !== 'object') return null;
    input = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const rawPath = input['file_path'] ?? input['path'] ?? input['filePath'];
  if (typeof rawPath !== 'string' || !rawPath) return null;

  let removed: string[] = [];
  let added: string[] = [];
  if (Array.isArray(input['edits'])) {
    for (const edit of input['edits'] as Array<Record<string, unknown>>) {
      const d = trimCommon(lines(edit?.['old_string']), lines(edit?.['new_string']));
      removed.push(...d.removed);
      added.push(...d.added);
    }
  } else if ('old_string' in input || 'new_string' in input) {
    ({ removed, added } = trimCommon(lines(input['old_string']), lines(input['new_string'])));
  } else if ('content' in input || 'file_text' in input) {
    added = lines(input['content'] ?? input['file_text']);
  } else {
    return null;
  }

  const hidden = Math.max(0, removed.length - PREVIEW_LINES) + Math.max(0, added.length - PREVIEW_LINES);
  return {
    path: workspaceRelative(rawPath),
    removed: removed.slice(0, PREVIEW_LINES),
    added: added.slice(0, PREVIEW_LINES),
    hidden,
  };
}

/** What a permission card shows for a shell command. */
export interface CommandPreview {
  command: string;
  /** The agent's own note on why, when it gave one. */
  note: string | null;
}

/**
 * A shell command, or null for any other tool.
 *
 * The card used to print the command as its description and then again as
 * `{ "command": "…" }` under INPUT. Keyed off the input's shape rather than
 * a tool list, so every provider's shell tool (Bash, shell, run_command…)
 * gets it; input with anything beyond a command and its note stays raw, so
 * nothing the user should see is hidden.
 */
export function commandPreview(inputSummary: string): CommandPreview | null {
  let input: unknown;
  try {
    input = JSON.parse(inputSummary);
  } catch {
    return null;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const command = record['command'] ?? record['cmd'];
  if (typeof command !== 'string' || !command.trim()) return null;
  const known = new Set(['command', 'cmd', 'description', 'timeout']);
  if (Object.keys(record).some((key) => !known.has(key))) return null;
  const note = typeof record['description'] === 'string' && record['description'].trim() ? record['description'].trim() : null;
  return { command: command.trim(), note };
}
