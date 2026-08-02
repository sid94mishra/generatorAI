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
  /** Compiled server entry (packaged installs). */
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

  const serverDist = packaged
    ? path.join(base, 'server', 'dist')
    : path.join(root, 'apps', 'server', 'dist');

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
    serverEntry: path.join(serverDist, 'index.js'),
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
