// ────────────────────────────────────────────────────────────────
// mountNested — the repositories inside a mount, and the separate copy
// ────────────────────────────────────────────────────────────────
//
// A linked folder can hold repositories of its own (`acme/api`, `acme/web`).
// Each is set up on its own: in place (the user's checkout, on its current
// branch or a new / existing one) or as a git worktree. A worktree needs a
// place to live where the agent sees it at the same path, so a folder with
// any worktree inside is a SEPARATE COPY under the workspace:
//
//   <workspace>/source/<alias>/        a worktree of the folder's own repo,
//                                      or a copy of a plain folder's files
//     api/   → git worktree of acme/api on its own branch
//     web/   → link to acme/web (in place: the user's checkout)
//
// Links are junctions on Windows (no privilege needed) and symlinks elsewhere.
// Every removal unlinks them FIRST, so nothing recursive ever walks into the
// user's checkout.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';

/** The absolute directory of a nested repository (`rel` is `/`-separated). */
export function nestedDir(dir: string, rel: string): string {
  return path.join(dir, ...rel.split('/'));
}

/** Link `at` to the directory `target`: a junction on Windows, a symlink elsewhere. */
export async function linkDir(target: string, at: string): Promise<void> {
  await fs.mkdir(path.dirname(at), { recursive: true });
  await fs.symlink(target, at, process.platform === 'win32' ? 'junction' : 'dir');
}

export async function isLink(p: string): Promise<boolean> {
  try {
    return (await fs.lstat(p)).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Remove the links at `rels` inside `dir` without following them. Called before
 * anything deletes `dir` recursively.
 */
export async function unlinkNested(dir: string, rels: readonly string[]): Promise<void> {
  for (const rel of rels) {
    const at = nestedDir(dir, rel);
    if (await isLink(at)) await fs.unlink(at).catch(() => fs.rmdir(at).catch(() => undefined));
  }
}

/** Never copied into a separate copy: dependencies, build output and caches (rebuilt there). */
const COPY_SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.cache', '.DS_Store', 'Thumbs.db']);

/** Files a separate copy of a plain folder takes at most, outside its repositories. */
export const COPY_MAX_FILES = 20_000;

export class CopyTooLargeError extends Error {}

/**
 * Copy `src` into `dest` except the repositories at `exclude` (relative paths)
 * and the build/dependency folders in `COPY_SKIP`. Symlinks are copied as links.
 * Returns how many files were copied; throws `CopyTooLargeError` past `cap`.
 */
export async function copyFolderExcept(src: string, dest: string, exclude: readonly string[], cap = COPY_MAX_FILES): Promise<number> {
  const skip = new Set(exclude);
  let files = 0;
  const walk = async (rel: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(rel ? nestedDir(src, rel) : src, { withFileTypes: true });
    } catch {
      return;
    }
    await fs.mkdir(rel ? nestedDir(dest, rel) : dest, { recursive: true });
    for (const entry of entries) {
      if (COPY_SKIP.has(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (skip.has(child)) continue;
      const from = nestedDir(src, child);
      const to = nestedDir(dest, child);
      if (entry.isSymbolicLink()) {
        const target = await fs.readlink(from).catch(() => null);
        if (target) await fs.symlink(target, to).catch(() => undefined);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!entry.isFile()) continue;
      if (++files > cap) throw new CopyTooLargeError(`more than ${cap} files outside its repositories`);
      await fs.copyFile(from, to);
    }
  };
  await walk('');
  return files;
}

/**
 * Make `dest` hold what `src` holds, as `copyFolderExcept` takes it (the same skips, the repositories at
 * `exclude` left alone on both sides): every file copied over, anything `src` no longer has removed. A
 * fork of a chat that works in a separate copy starts from the parent's copy this way. Returns the
 * number of files written or removed.
 */
export async function mirrorFolder(src: string, dest: string, exclude: readonly string[]): Promise<number> {
  const skip = new Set(exclude);
  let changed = 0;
  const list = (dir: string): Promise<Dirent[]> => fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const walk = async (rel: string): Promise<void> => {
    const from = rel ? nestedDir(src, rel) : src;
    const to = rel ? nestedDir(dest, rel) : dest;
    const [have, had] = await Promise.all([list(from), list(to)]);
    const kept = (name: string) => !COPY_SKIP.has(name) && !skip.has(rel ? `${rel}/${name}` : name);
    const kind = (e: Dirent) => (e.isSymbolicLink() ? 'link' : e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other');
    const wanted = new Map(have.filter((e) => kept(e.name)).map((e) => [e.name, kind(e)] as const));
    for (const e of had) {
      if (!kept(e.name) || wanted.get(e.name) === kind(e)) continue;
      await fs.rm(path.join(to, e.name), { recursive: true, force: true });
      changed += 1;
    }
    await fs.mkdir(to, { recursive: true });
    for (const e of have) {
      if (!kept(e.name)) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) {
        const target = await fs.readlink(path.join(from, e.name)).catch(() => null);
        if (!target) continue;
        await fs.rm(path.join(to, e.name), { force: true });
        await fs.symlink(target, path.join(to, e.name)).catch(() => undefined);
      } else if (e.isDirectory()) {
        await walk(child);
      } else if (e.isFile()) {
        await fs.copyFile(path.join(from, e.name), path.join(to, e.name));
        changed += 1;
      }
    }
  };
  await walk('');
  return changed;
}
