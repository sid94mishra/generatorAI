// ────────────────────────────────────────────────────────────────
// A directory tree, derived from the flat path list (open question #26).
//
// The pane was a flat, filterable list because "`workspace.tree`'s real data
// has no directory-entry concept server-side to build a hierarchy from".
// That is true of the RESPONSE and irrelevant to the question: a path is
// `a/b/c.ts`, and the directories are in it. Every file browser in every
// editor derives its tree exactly this way — the server does not send
// directory rows either.
//
// The flat list stays, as a mode. It is genuinely better for "where is the
// file called X" across a large repo, which is what the filter is for, and a
// tree is genuinely better for "what is in this workspace". Both, with a
// key to switch, is the honest answer rather than picking one.
// ────────────────────────────────────────────────────────────────

import type { WorkspaceRow } from './panes.js';

export interface TreeRow {
  /** Unique within the tree: the alias plus the full path so far. */
  id: string;
  /** What to draw, without indentation. */
  label: string;
  depth: number;
  kind: 'repo' | 'directory' | 'file' | 'artifact';
  /** Set for a file — the row an action operates on. */
  row?: WorkspaceRow;
  /** Directories only. */
  collapsed?: boolean;
  /** Files beneath this directory, at any depth — shown as a count when collapsed. */
  fileCount?: number;
}

interface Node {
  name: string;
  children: Map<string, Node>;
  files: WorkspaceRow[];
}

const emptyNode = (name: string): Node => ({ name, children: new Map(), files: [] });

/**
 * Builds the visible rows for a tree view.
 *
 * `collapsed` is the set of directory ids the user has closed. Everything is
 * expanded by default: a workspace that opens fully collapsed hides the one
 * thing the pane exists to show, and the tree is only ever as deep as the
 * repository is.
 */
export function buildWorkspaceTree(
  rows: readonly WorkspaceRow[],
  collapsed: ReadonlySet<string> = new Set(),
): TreeRow[] {
  // Grouped by alias first: a workspace's main repo and each worktree are
  // separate roots, and merging them would put two different `src/index.ts`
  // files on the same line.
  const byAlias = new Map<string, Node>();
  for (const row of rows) {
    let root = byAlias.get(row.alias);
    if (!root) {
      root = emptyNode(row.alias);
      byAlias.set(row.alias, root);
    }
    const segments = row.relPath.split('/').filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) continue;
    let node = root;
    for (const segment of segments) {
      let child = node.children.get(segment);
      if (!child) {
        child = emptyNode(segment);
        node.children.set(segment, child);
      }
      node = child;
    }
    node.files.push(row);
  }

  const out: TreeRow[] = [];

  const countFiles = (node: Node): number => {
    let total = node.files.length;
    for (const child of node.children.values()) total += countFiles(child);
    return total;
  };

  const walk = (node: Node, prefix: string, depth: number): void => {
    // Directories before files, each alphabetical — the ordering every file
    // browser uses, and the one that makes a tree scannable.
    const directories = [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [name, child] of directories) {
      const id = `${prefix}/${name}`;
      const isCollapsed = collapsed.has(id);
      out.push({
        id,
        label: name,
        depth,
        kind: 'directory',
        collapsed: isCollapsed,
        fileCount: countFiles(child),
      });
      if (!isCollapsed) walk(child, id, depth + 1);
    }
    for (const file of [...node.files].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
      out.push({
        id: `${prefix}/${file.relPath}`,
        // `filter(Boolean)` to match how the tree was BUILT above — a plain
        // `.pop()` on a path with a trailing slash yields an empty label for
        // a node the builder named from the segment before it, so the two
        // would disagree about the same row.
        label: file.relPath.split('/').filter(Boolean).pop() ?? file.relPath,
        depth,
        kind: file.kind === 'artifact' ? 'artifact' : 'file',
        row: file,
      });
    }
  };

  for (const [alias, root] of [...byAlias.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const id = alias;
    const isCollapsed = collapsed.has(id);
    out.push({
      id,
      label: alias === '.' ? 'main' : alias,
      depth: 0,
      kind: 'repo',
      collapsed: isCollapsed,
      fileCount: countFiles(root),
    });
    if (!isCollapsed) walk(root, id, 1);
  }

  return out;
}

/**
 * The directory a collapse action should close when the cursor is on a row.
 *
 * On a directory it is that directory; on a FILE it is its parent, so `left`
 * walks out of the tree the way it does in every file browser rather than
 * doing nothing on three quarters of the rows.
 */
export function collapseTargetFor(tree: readonly TreeRow[], index: number): string | null {
  const current = tree[index];
  if (!current) return null;
  if (current.kind === 'directory' || current.kind === 'repo') return current.id;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = tree[i]!;
    if (candidate.depth < current.depth && (candidate.kind === 'directory' || candidate.kind === 'repo')) {
      return candidate.id;
    }
  }
  return null;
}
