// ────────────────────────────────────────────────────────────────
// Unified diff parser.
//
// The changes API (`GET /workspaces/:id/changes/file?form=patch`) returns a
// RAW unified diff string. Every client that wants to render a diff as rows —
// with line numbers, per-line status and virtualization — has to turn that
// text into structure first.
//
// Doing it here rather than server-side is deliberate:
//   * no new endpoint, no new response shape to version
//   * the same parser can back the web app, so the two cannot disagree about
//     what line 40 of a hunk is
//   * it is pure text→structure, so it can be tested exhaustively without a
//     server, a repo, or a fixture checkout
//
// ── What this handles ────────────────────────────────────────────
//   * multiple hunks, `@@ -a,b +c,d @@` with optional counts and section text
//   * added / deleted / context rows with correct old+new line numbering
//   * `\ No newline at end of file` (attached to the preceding row)
//   * `diff --git`, `index`, `---`, `+++`, `similarity index`, `rename …`
//     headers, which are skipped rather than mistaken for content
//   * truncated patches (the server caps at 512KB) — parsing stops cleanly
//
// ── What it deliberately does NOT do ─────────────────────────────
//   * combined/merge diffs (`@@@`) — the API never emits them
//   * word-level intra-line diffing — that is a rendering concern, computed
//     lazily for the visible window only
// ────────────────────────────────────────────────────────────────

export type DiffRowKind = 'add' | 'del' | 'context';

export interface DiffRow {
  kind: DiffRowKind;
  /** 1-based line number on the base side; absent for additions. */
  oldNumber?: number;
  /** 1-based line number on the head side; absent for deletions. */
  newNumber?: number;
  /** Line content WITHOUT the leading +/-/space marker. */
  content: string;
  /**
   * True when this is the last line of its side and the file has no trailing
   * newline. Rendering it silently loses a real, reviewable difference.
   */
  noNewline?: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Optional text after the closing `@@` — usually the enclosing function. */
  section?: string;
  rows: DiffRow[];
}

export interface ParsedDiff {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** True when the input ended mid-hunk (server truncation). */
  truncated: boolean;
}

const HUNK_HEADER =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Header lines that carry no row content. */
function isFileHeader(line: string): boolean {
  return (
    line.startsWith('diff --git ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('new file mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('dissimilarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('copy from ') ||
    line.startsWith('copy to ') ||
    line.startsWith('Binary files ') ||
    line.startsWith('GIT binary patch')
  );
}

/**
 * Parse a unified diff into hunks and rows.
 *
 * Never throws: a malformed patch yields the hunks understood so far with
 * `truncated: true`. A diff viewer that explodes on one odd file is worse
 * than one that shows what it could read and says so.
 */
export function parseUnifiedDiff(patch: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  let truncated = false;

  if (!patch) return { hunks, additions, deletions, truncated };

  // Split on \n and tolerate \r\n. A trailing empty element from a final
  // newline is dropped so it does not become a phantom context row.
  const lines = patch.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    const header = HUNK_HEADER.exec(line);
    if (header) {
      current = {
        oldStart: Number.parseInt(header[1]!, 10),
        // An omitted count means exactly one line, per the unified format.
        oldLines: header[2] === undefined ? 1 : Number.parseInt(header[2], 10),
        newStart: Number.parseInt(header[3]!, 10),
        newLines: header[4] === undefined ? 1 : Number.parseInt(header[4], 10),
        ...(header[5] ? { section: header[5] } : {}),
        rows: [],
      };
      hunks.push(current);
      oldNo = current.oldStart;
      newNo = current.newStart;
      continue;
    }

    // Anything before the first hunk header is file metadata.
    if (!current) {
      if (!isFileHeader(line) && line.trim() !== '') {
        // Unrecognised preamble: not fatal, but worth not silently eating.
        continue;
      }
      continue;
    }

    if (line.startsWith('\\')) {
      // "\ No newline at end of file" — belongs to the row just emitted.
      const last = current.rows[current.rows.length - 1];
      if (last) last.noNewline = true;
      continue;
    }

    if (line.startsWith('+')) {
      current.rows.push({ kind: 'add', newNumber: newNo, content: line.slice(1) });
      newNo += 1;
      additions += 1;
      continue;
    }

    if (line.startsWith('-')) {
      current.rows.push({ kind: 'del', oldNumber: oldNo, content: line.slice(1) });
      oldNo += 1;
      deletions += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      current.rows.push({
        kind: 'context',
        oldNumber: oldNo,
        newNumber: newNo,
        content: line.slice(1),
      });
      oldNo += 1;
      newNo += 1;
      continue;
    }

    if (line === '') {
      // Git emits a bare empty line for an empty context line. Treating it as
      // a terminator would drop a real line and shift every number after it.
      current.rows.push({ kind: 'context', oldNumber: oldNo, newNumber: newNo, content: '' });
      oldNo += 1;
      newNo += 1;
      continue;
    }

    if (isFileHeader(line)) {
      // A new file's header inside the same patch: close the current hunk.
      current = null;
      continue;
    }

    // Unknown marker mid-hunk: the patch was cut off or is malformed.
    truncated = true;
    break;
  }

  // A hunk that yielded fewer rows than its header promised was cut short.
  if (!truncated) {
    for (const hunk of hunks) {
      const seenOld = hunk.rows.filter((r) => r.kind !== 'add').length;
      const seenNew = hunk.rows.filter((r) => r.kind !== 'del').length;
      if (seenOld < hunk.oldLines || seenNew < hunk.newLines) {
        truncated = true;
        break;
      }
    }
  }

  return { hunks, additions, deletions, truncated };
}

/** Total rows across all hunks — used to size a virtualized list. */
export function countRows(parsed: ParsedDiff): number {
  return parsed.hunks.reduce((n, h) => n + h.rows.length, 0);
}

/**
 * Flatten hunks into a single render list, inserting a separator before each
 * hunk so a virtualized list can render headers and rows uniformly.
 */
export type DiffListItem =
  | { type: 'hunk'; hunk: DiffHunk; key: string }
  | { type: 'row'; row: DiffRow; key: string };

export function toDiffList(parsed: ParsedDiff): DiffListItem[] {
  const items: DiffListItem[] = [];
  parsed.hunks.forEach((hunk, hi) => {
    items.push({ type: 'hunk', hunk, key: `h${hi}` });
    hunk.rows.forEach((row, ri) => {
      // Keys include the hunk index because line numbers repeat across files
      // and `oldNumber` is absent on additions.
      items.push({ type: 'row', row, key: `h${hi}r${ri}` });
    });
  });
  return items;
}
