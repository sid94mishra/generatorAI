// ────────────────────────────────────────────────────────────────
// The workspace directory tree (open question #26).
//
// The pane was a flat list because "`workspace.tree`'s real data has no
// directory-entry concept server-side". True of the RESPONSE and irrelevant
// to the question: a path is `a/b/c.ts` and the directories are in it, which
// is how every editor's file browser builds one — no server sends directory
// rows either.
//
// What these pin is the part that goes silently wrong: a tree whose row
// ORDER does not match what the cursor is sized against leaves rows
// unreachable, which is exactly the bug the `changes` pane had.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { buildWorkspaceTree, collapseTargetFor } from '../workspaceTree.js';
import type { WorkspaceRow } from '../panes.js';

const file = (alias: string, relPath: string): WorkspaceRow => ({ alias, relPath, kind: 'file' });
const artifact = (relPath: string): WorkspaceRow => ({ alias: 'artifacts', relPath, kind: 'artifact' });

describe('buildWorkspaceTree', () => {
  it('derives directories from the path segments', () => {
    const tree = buildWorkspaceTree([file('.', 'src/app/main.ts')]);
    expect(tree.map((r) => [r.label, r.depth, r.kind])).toEqual([
      ['main', 0, 'repo'],
      ['src', 1, 'directory'],
      ['app', 2, 'directory'],
      ['main.ts', 3, 'file'],
    ]);
  });

  it('keeps each repo alias a separate root', () => {
    // Merging them would put two different `src/index.ts` files on one line.
    const tree = buildWorkspaceTree([file('.', 'src/index.ts'), file('feature-x', 'src/index.ts')]);
    const repos = tree.filter((r) => r.kind === 'repo');
    expect(repos.map((r) => r.label)).toEqual(['main', 'feature-x']);
    expect(tree.filter((r) => r.kind === 'file')).toHaveLength(2);
  });

  it('renames the `.` alias to something a human recognises', () => {
    expect(buildWorkspaceTree([file('.', 'a.ts')])[0]?.label).toBe('main');
  });

  it('puts directories before files, each alphabetically', () => {
    const tree = buildWorkspaceTree([
      file('.', 'zebra.ts'),
      file('.', 'alpha.ts'),
      file('.', 'src/b.ts'),
      file('.', 'lib/a.ts'),
    ]);
    expect(tree.slice(1).map((r) => r.label)).toEqual([
      'lib',
      'a.ts',
      'src',
      'b.ts',
      'alpha.ts',
      'zebra.ts',
    ]);
  });

  it('hides a collapsed directory\'s contents and reports the count instead', () => {
    const rows = [file('.', 'src/a.ts'), file('.', 'src/b.ts'), file('.', 'top.ts')];
    const collapsed = buildWorkspaceTree(rows, new Set(['./src']));
    expect(collapsed.map((r) => r.label)).toEqual(['main', 'src', 'top.ts']);
    expect(collapsed.find((r) => r.label === 'src')?.fileCount).toBe(2);
    expect(collapsed.find((r) => r.label === 'src')?.collapsed).toBe(true);
  });

  it('counts files at every depth beneath a collapsed directory', () => {
    const tree = buildWorkspaceTree([file('.', 'a/b/c/d.ts'), file('.', 'a/e.ts')], new Set(['./a']));
    expect(tree.find((r) => r.label === 'a')?.fileCount).toBe(2);
  });

  it('collapses a whole repo root', () => {
    const tree = buildWorkspaceTree([file('.', 'src/a.ts')], new Set(['.']));
    expect(tree).toHaveLength(1);
    expect(tree[0]?.fileCount).toBe(1);
  });

  it('expands everything by default — a workspace that opens closed hides its own point', () => {
    const tree = buildWorkspaceTree([file('.', 'a/b.ts')]);
    expect(tree.some((r) => r.collapsed)).toBe(false);
  });

  it('tags artifacts distinctly, so generated output is not mistaken for source', () => {
    const tree = buildWorkspaceTree([artifact('report.pdf')]);
    expect(tree.find((r) => r.kind === 'artifact')?.label).toBe('report.pdf');
  });

  it('carries the original row on every file, which is what actions operate on', () => {
    const row = file('.', 'src/a.ts');
    const leaf = buildWorkspaceTree([row]).find((r) => r.kind === 'file');
    expect(leaf?.row).toBe(row);
    // Directories carry none — there is nothing to edit or download.
    expect(buildWorkspaceTree([row]).find((r) => r.kind === 'directory')?.row).toBeUndefined();
  });

  it('gives every row a unique id, since ids drive the collapse set', () => {
    const tree = buildWorkspaceTree([
      file('.', 'src/index.ts'),
      file('feature-x', 'src/index.ts'),
      file('.', 'lib/index.ts'),
    ]);
    expect(new Set(tree.map((r) => r.id)).size).toBe(tree.length);
  });

  it('returns nothing for an empty workspace', () => {
    expect(buildWorkspaceTree([])).toEqual([]);
  });

  it('skips a row with no path at all rather than emitting a nameless leaf', () => {
    expect(buildWorkspaceTree([file('.', '')])).toEqual([
      { id: '.', label: 'main', depth: 0, kind: 'repo', collapsed: false, fileCount: 0 },
    ]);
  });

  it('treats a trailing slash as a filename, matching how the paths actually arrive', () => {
    // `workspace.tree` returns file paths, never directory entries — a
    // trailing slash is not a directory marker here, so inventing one would
    // hide a real (if oddly named) file.
    const tree = buildWorkspaceTree([file('.', 'trailing/')]);
    expect(tree.map((r) => [r.label, r.kind])).toEqual([
      ['main', 'repo'],
      ['trailing', 'file'],
    ]);
  });
});

describe('collapseTargetFor', () => {
  const rows = [file('.', 'src/app/main.ts'), file('.', 'src/other.ts')];
  const tree = buildWorkspaceTree(rows);
  // main / src / app / main.ts / other.ts
  const indexOf = (label: string): number => tree.findIndex((r) => r.label === label);

  it('collapses the directory the cursor is ON', () => {
    expect(collapseTargetFor(tree, indexOf('src'))).toBe('./src');
    expect(collapseTargetFor(tree, indexOf('app'))).toBe('./src/app');
  });

  it('collapses the PARENT when the cursor is on a file', () => {
    // Otherwise `←` does nothing on three quarters of the rows, where every
    // file browser walks out of the tree.
    expect(collapseTargetFor(tree, indexOf('main.ts'))).toBe('./src/app');
    expect(collapseTargetFor(tree, indexOf('other.ts'))).toBe('./src');
  });

  it('walks up to the repo root from a top-level file', () => {
    const flat = buildWorkspaceTree([file('.', 'top.ts')]);
    expect(collapseTargetFor(flat, 1)).toBe('.');
  });

  it('returns null for an out-of-range cursor rather than throwing', () => {
    expect(collapseTargetFor(tree, 999)).toBeNull();
    expect(collapseTargetFor([], 0)).toBeNull();
  });
});
