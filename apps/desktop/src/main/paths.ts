// ────────────────────────────────────────────────────────────────
// Filesystem path resolution for both `pnpm dev` (run from the monorepo) and
// packaged installs (assets live under process.resourcesPath).
// ────────────────────────────────────────────────────────────────

import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Repo root when running unpackaged. The bundled main lives at
 * apps/desktop/dist/main/index.js → four levels up is the monorepo root.
 */
export function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export interface ResolvedPaths {
  packaged: boolean;
  repoRoot: string;
  /**
   * Server entry to spawn. Packaged: the single-file esbuild bundle
   * (`server.mjs`). Unpackaged: the `tsc` output, which can still resolve
   * its imports from the monorepo's `node_modules`.
   */
  serverEntry: string;
  /** TypeScript server entry run via tsx when unpackaged. */
  serverSrcEntry: string;
  webDist: string;
  templatesDir: string;
  /** Root directory for desktop runtime data (db, workspaces, artifacts). */
  dataDir: string;
  dbPath: string;
  workspacesDir: string;
  artifactsDir: string;
  resourcesDir: string;
}

export function resolvePaths(): ResolvedPaths {
  const packaged = app.isPackaged;
  const root = repoRoot();
  const base = packaged ? process.resourcesPath : root;

  // Packaged builds run the single-file esbuild bundle. The `tsc` output is
  // not usable here: it keeps its imports unresolved, and the installer ships
  // no `node_modules` for them to resolve against.
  const serverEntry = packaged
    ? path.join(base, 'server', 'server.mjs')
    : path.join(root, 'apps', 'server', 'dist', 'index.js');

  const webDist = packaged ? path.join(base, 'web', 'dist') : path.join(root, 'apps', 'web', 'dist');

  const templatesDir = packaged ? path.join(base, 'templates') : path.join(root, 'templates');

  // Runtime data lives in the OS-appropriate per-user app data directory so the
  // desktop app is fully standalone and never collides with a dev server.
  const dataDir = path.join(app.getPath('userData'), 'data');
  const dbPath = path.join(dataDir, 'generatorai.db');
  const workspacesDir = path.join(dataDir, 'workspaces');
  const artifactsDir = path.join(dataDir, 'artifacts');

  return {
    packaged,
    repoRoot: root,
    serverEntry,
    serverSrcEntry: path.join(root, 'apps', 'server', 'src', 'index.ts'),
    webDist,
    templatesDir,
    dataDir,
    dbPath,
    workspacesDir,
    artifactsDir,
    resourcesDir: base,
  };
}

export function ensureDataDirs(p: ResolvedPaths): void {
  for (const dir of [p.dataDir, p.workspacesDir, p.artifactsDir, path.dirname(p.dbPath)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
