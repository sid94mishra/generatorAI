// ────────────────────────────────────────────────────────────────
// changeTree — changed files as a folder tree, flattened for a list.
//
// A port of desktop's ChatChangesTray tree model: files grouped under their
// folders, folders first and sorted, and a chain of single-child folders
// collapsed into one row (`src/pricing`) so a deep path does not cost a row
// per segment. Pure, so the shape is unit-testable.
// ────────────────────────────────────────────────────────────────

export interface TreeFile {
  /** Display path — alias-prefixed when the chat has more than one mount. */
  path: string;
}

export interface ChangeTreeRow<F extends TreeFile> {
  key: string;
  depth: number;
  kind: 'dir' | 'file';
  label: string;
  file?: F;
}

interface TreeDir<F extends TreeFile> {
  name: string;
  dirs: Map<string, TreeDir<F>>;
  files: F[];
}

function buildTree<F extends TreeFile>(files: readonly F[]): TreeDir<F> {
  const root: TreeDir<F> = { name: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const seg = parts[i]!;
      let next = node.dirs.get(seg);
      if (!next) {
        next = { name: seg, dirs: new Map(), files: [] };
        node.dirs.set(seg, next);
      }
      node = next;
    }
    node.files.push(f);
  }
  return root;
}

function flatten<F extends TreeFile>(dir: TreeDir<F>, depth: number, prefix: string, out: ChangeTreeRow<F>[]): void {
  const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirs) {
    let label = d.name;
    let node = d;
    while (node.files.length === 0 && node.dirs.size === 1) {
      const only = [...node.dirs.values()][0]!;
      label = `${label}/${only.name}`;
      node = only;
    }
    const key = `${prefix}${label}/`;
    out.push({ key, depth, kind: 'dir', label });
    flatten(node, depth + 1, key, out);
  }
  const files = [...dir.files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of files) {
    out.push({ key: f.path, depth, kind: 'file', label: f.path.split('/').pop() ?? f.path, file: f });
  }
}

export function changeTreeRows<F extends TreeFile>(files: readonly F[]): ChangeTreeRow<F>[] {
  const out: ChangeTreeRow<F>[] = [];
  flatten(buildTree(files), 0, '', out);
  return out;
}
