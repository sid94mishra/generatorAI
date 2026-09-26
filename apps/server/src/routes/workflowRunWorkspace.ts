// ────────────────────────────────────────────────────────────────
// A run's workspace, read-only (P04 WP-4.1 step 5: moved from the deleted
// orchestrator routes). Mounted under `/workflow-runs`:
//
//   GET /:id/workspace                   the managed root, artifacts,
//                                        uploads (`config/`) and every
//                                        mount (codebase worktrees and
//                                        in-place checkouts, the generated
//                                        directory) with its files
//   GET /:id/workspace/download?path&source[&worktreeAlias]
//   GET /:id/workspace/content?path&source[&worktreeAlias]
//   GET /:id/workspace/diff              every mount's change set
//
// `source` is `workspace` (default), `artifacts`, `uploads` or `worktree`
// (with `worktreeAlias`, a mount alias). Paths are resolved inside their
// base, symlinks included.
// ────────────────────────────────────────────────────────────────

import { Router, type Response } from 'express';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExecutionWorkspace, WorkspaceMount } from '@generatorai/shared';
import type { Container } from '../composition-root.js';

/**
 * Resolve `userPath` inside `baseDir`, following symlinks on both sides, so a
 * planted symlink cannot point a read outside the base. `null` when it escapes.
 */
async function resolveWithinBase(baseDir: string, userPath: string): Promise<string | null> {
  const realBase = await fs.realpath(baseDir).catch(() => path.resolve(baseDir));
  const joined = path.resolve(baseDir, userPath);
  let realTarget: string;
  try {
    realTarget = await fs.realpath(joined);
  } catch {
    let ancestor = joined;
    const tail: string[] = [];
    for (let i = 0; i < 64; i += 1) {
      try {
        ancestor = await fs.realpath(ancestor);
        break;
      } catch {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        tail.unshift(path.basename(ancestor));
        ancestor = parent;
      }
    }
    realTarget = tail.length > 0 ? path.join(ancestor, ...tail) : ancestor;
  }
  if (realTarget !== realBase && !realTarget.startsWith(realBase + path.sep)) return null;
  return realTarget;
}

export function createWorkflowRunWorkspaceRoutes(container: Container): Router {
  const router = Router();
  const { workflowRunRepo, workspaceManager, gitManager, changeSetService } = container;

  async function workspaceOf(runId: string, res: Response): Promise<{ ws: ExecutionWorkspace; mounts: WorkspaceMount[] } | null> {
    const run = await workflowRunRepo.getById(runId);
    const ws = run.workspaceId ? await workspaceManager.getExecutionWorkspace(run.workspaceId) : await workspaceManager.findWorkspaceByOwner(runId);
    if (!ws) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: `Run ${runId} has no workspace yet` } });
      return null;
    }
    const mounts = (await workspaceManager.listMounts(ws)).filter((m) => m.status !== 'removed');
    return { ws, mounts };
  }

  const dirsOf = (ws: ExecutionWorkspace) => ({
    workspaceDir: ws.rootPath,
    artifactsDir: path.join(ws.rootPath, 'artifacts'),
    uploadsDir: path.join(ws.rootPath, 'config'),
  });

  /** Tracked files (honours .gitignore), else a walk without vendored/build noise. */
  async function listFiles(dir: string): Promise<string[]> {
    try {
      await fs.access(dir);
    } catch {
      return [];
    }
    if (await gitManager.isGitRepo(dir)) {
      const tracked = await gitManager.lsFiles(dir);
      if (tracked.length > 0) return tracked;
    }
    try {
      const entries = (await fs.readdir(dir, { recursive: true })) as unknown as string[];
      const files: string[] = [];
      for (const entry of entries) {
        const norm = entry.replace(/\\/g, '/');
        if (norm === '.git' || norm.startsWith('.git/') || norm.startsWith('.checkpoints/')) continue;
        if (/(^|\/)(node_modules|dist|build|coverage|\.next|\.turbo|\.cache)(\/|$)/.test(norm)) continue;
        const stat = await fs.stat(path.join(dir, entry)).catch(() => null);
        if (stat?.isFile()) files.push(entry);
      }
      return files;
    } catch {
      return [];
    }
  }

  async function baseDirFor(
    source: string,
    alias: string,
    ws: ExecutionWorkspace,
    mounts: WorkspaceMount[],
    res: Response,
  ): Promise<string | null> {
    const dirs = dirsOf(ws);
    if (source === 'artifacts') return dirs.artifactsDir;
    if (source === 'uploads') return dirs.uploadsDir;
    if (source === 'worktree') {
      const mount = mounts.find((m) => m.alias === alias);
      if (!mount) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Mount '${alias}' not found` } });
        return null;
      }
      return mount.path;
    }
    return dirs.workspaceDir;
  }

  // GET /workflow-runs/:id/workspace
  router.get('/:id/workspace', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const loaded = await workspaceOf(runId, res);
      if (!loaded) return;
      const dirs = dirsOf(loaded.ws);
      const worktrees = await Promise.all(
        loaded.mounts.map(async (m) => ({
          alias: m.alias,
          worktreePath: m.path,
          files: await listFiles(m.path),
          kind: (m.originKind === 'generated' ? 'generated' : 'linked') as 'linked' | 'generated',
        })),
      );
      const [workspaceFiles, artifactFiles, uploadFiles] = await Promise.all([
        listFiles(dirs.workspaceDir),
        listFiles(dirs.artifactsDir),
        listFiles(dirs.uploadsDir),
      ]);
      res.json({ runId, ...dirs, workspaceFiles, artifactFiles, uploadFiles, worktrees });
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-runs/:id/workspace/download
  router.get('/:id/workspace/download', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const filePath = String(req.query['path'] ?? '');
      if (!filePath) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing path query parameter' } });
        return;
      }
      const loaded = await workspaceOf(runId, res);
      if (!loaded) return;
      const baseDir = await baseDirFor(String(req.query['source'] ?? 'workspace'), String(req.query['worktreeAlias'] ?? ''), loaded.ws, loaded.mounts, res);
      if (!baseDir) return;
      const resolved = await resolveWithinBase(baseDir, filePath);
      if (!resolved) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Path traversal not allowed' } });
        return;
      }
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat?.isFile()) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        return;
      }
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resolved)}"`);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Type', 'application/octet-stream');
      const { createReadStream } = await import('node:fs');
      const stream = createReadStream(resolved);
      stream.pipe(res);
      stream.on('error', () => {
        if (!res.headersSent) res.status(500).json({ error: { code: 'STREAM_ERROR', message: 'Failed to read file' } });
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-runs/:id/workspace/content — a text file (up to 1 MB)
  router.get('/:id/workspace/content', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const filePath = String(req.query['path'] ?? '');
      if (!filePath) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing path query parameter' } });
        return;
      }
      const loaded = await workspaceOf(runId, res);
      if (!loaded) return;
      const baseDir = await baseDirFor(String(req.query['source'] ?? 'workspace'), String(req.query['worktreeAlias'] ?? ''), loaded.ws, loaded.mounts, res);
      if (!baseDir) return;
      const resolved = await resolveWithinBase(baseDir, filePath);
      if (!resolved) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Path traversal not allowed' } });
        return;
      }
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat?.isFile()) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        return;
      }
      if (stat.size > 1_048_576) {
        res.json({ path: filePath, content: null, truncated: true, size: stat.size });
        return;
      }
      res.json({ path: filePath, content: await fs.readFile(resolved, 'utf-8'), truncated: false, size: stat.size });
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-runs/:id/workspace/diff — each mount's change set (the chat's per-mount stores)
  router.get('/:id/workspace/diff', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const loaded = await workspaceOf(runId, res);
      if (!loaded) return;
      const changeSet = await changeSetService.getChangeSet({
        rootPath: loaded.ws.codeRoot ?? loaded.ws.rootPath,
        worktrees: [],
        mounts: await workspaceManager.toMountRefs(loaded.ws),
        autoInit: false,
      });
      res.json({
        hasGit: changeSet.hasGit,
        repos: changeSet.repos.map((r) => ({
          alias: r.alias,
          files: r.files.map((f) => ({ path: f.path, status: f.status, diff: f.diff })),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
