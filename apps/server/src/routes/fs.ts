// ────────────────────────────────────────────────────────────────
// Filesystem routes — directory browsing for the source picker
// ────────────────────────────────────────────────────────────────
//
// Lets the create-chat dialog pick a local folder instead of typing a path,
// and tells it whether the folder is a git repository (branches, dirty
// state, nested repos) so the mode/branch controls can be offered up front.
//
// Directories only, never file contents. Gated to loopback or an
// administrative principal: a paired mobile device should not be able to
// walk the host's filesystem.

import { Router } from 'express';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Container } from '../composition-root.js';
import { isLoopbackRequest } from '../middleware/auth.js';

function allowed(req: { principal?: { scopes?: readonly string[] }; socket: { remoteAddress?: string; localAddress?: string }; headers: Record<string, unknown> }): boolean {
  const scopes = req.principal?.scopes;
  if (!scopes) return true; // unauthenticated loopback development mode
  if (scopes.includes('admin:settings')) return true;
  return isLoopbackRequest(req as never);
}

async function windowsDrives(): Promise<string[]> {
  const out: string[] = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`;
    try {
      await fs.access(root);
      out.push(root);
    } catch {
      /* not mounted */
    }
  }
  return out;
}

export function createFsRoutes(container: Container): Router {
  const router = Router();
  const { gitManager } = container;

  // GET /fs/dirs?path=<abs> — child directories (empty path → roots)
  router.get('/dirs', async (req, res, next) => {
    try {
      if (!allowed(req as never)) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Filesystem browsing is limited to local or administrative sessions' } });
        return;
      }
      const raw = typeof req.query['path'] === 'string' ? req.query['path'].trim() : '';
      if (!raw) {
        const roots = process.platform === 'win32' ? await windowsDrives() : ['/'];
        const home = os.homedir();
        res.json({ path: '', parent: null, roots: [home, ...roots.filter((r) => r !== home)], entries: [] });
        return;
      }
      if (!path.isAbsolute(raw)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'path must be absolute' } });
        return;
      }
      const dir = path.resolve(raw);
      const stat = await fs.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Not a directory: ${dir}` } });
        return;
      }
      const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      const entries: Array<{ name: string; path: string; isGit: boolean }> = [];
      for (const d of dirents) {
        if (!d.isDirectory()) continue;
        if (d.name === '.git' || d.name === 'node_modules' || d.name === '$RECYCLE.BIN' || d.name === 'System Volume Information') continue;
        const full = path.join(dir, d.name);
        const isGit = await fs
          .access(path.join(full, '.git'))
          .then(() => true)
          .catch(() => false);
        entries.push({ name: d.name, path: full, isGit });
        if (entries.length >= 500) break;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      const parent = path.dirname(dir);
      const isGit = await fs
        .access(path.join(dir, '.git'))
        .then(() => true)
        .catch(() => false);
      res.json({ path: dir, parent: parent === dir ? null : parent, isGit, entries });
    } catch (err) {
      next(err);
    }
  });

  // GET /fs/git-info?path=<abs> — repository facts for the source picker
  router.get('/git-info', async (req, res, next) => {
    try {
      if (!allowed(req as never)) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Filesystem browsing is limited to local or administrative sessions' } });
        return;
      }
      const raw = typeof req.query['path'] === 'string' ? req.query['path'].trim() : '';
      if (!raw || !path.isAbsolute(raw)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'path must be absolute' } });
        return;
      }
      const dir = path.resolve(raw);
      const stat = await fs.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Not a directory: ${dir}` } });
        return;
      }
      const isRepo = await fs
        .access(path.join(dir, '.git'))
        .then(() => true)
        .catch(() => false);
      const nestedRepos = await gitManager.nestedRepos(dir);
      if (!isRepo) {
        res.json({ path: dir, isRepo: false, currentBranch: null, branches: [], dirty: false, nestedRepos });
        return;
      }
      const [currentBranch, branches, clean] = await Promise.all([
        gitManager.currentBranch(dir),
        gitManager.getBranches(dir),
        gitManager.isClean(dir).catch(() => true),
      ]);
      res.json({
        path: dir,
        isRepo: true,
        currentBranch,
        branches: branches.filter((b) => !b.startsWith('origin/HEAD')).slice(0, 1000),
        dirty: !clean,
        nestedRepos,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /fs/scrub-legacy-refs { path, dryRun? } — remove the checkpoint refs
  // and index files earlier versions wrote into a repository's own .git.
  router.post('/scrub-legacy-refs', async (req, res, next) => {
    try {
      if (!allowed(req as never)) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Filesystem maintenance is limited to local or administrative sessions' } });
        return;
      }
      const body = (req.body ?? {}) as { path?: unknown; dryRun?: unknown };
      const raw = typeof body.path === 'string' ? body.path.trim() : '';
      if (!raw || !path.isAbsolute(raw)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'path must be absolute' } });
        return;
      }
      const dir = path.resolve(raw);
      if (!(await gitManager.isGitRepo(dir))) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Not a git repository: ${dir}` } });
        return;
      }
      const result = await gitManager.scrubLegacyCheckpointData(dir, { dryRun: body.dryRun === true });
      res.json({ path: dir, dryRun: body.dryRun === true, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
