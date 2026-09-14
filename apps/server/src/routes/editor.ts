// ────────────────────────────────────────────────────────────────
// Editor Routes — "Open in editor" (doc §7)
//
// `POST /api/editor/open` launches a desktop editor on the SERVER host with
// a caller-supplied path, so the path check below is the security boundary of
// this file, not a convenience: without it the endpoint is "open any file on
// the machine running the server in an editor that will happily execute the
// workspace's tasks.json".
//
// The rule is that the resolved, symlink-followed target must be a known root
// or live underneath one — every workspace mount, every project codebase
// checkout, every worktree. Two mistakes are specifically avoided:
//
//   * a bare `startsWith` on the raw strings, which lets `/repo-evil` through
//     for root `/repo` (the check compares resolved paths and requires either
//     equality or a `root + path.sep` prefix); and
//   * checking the path the caller wrote rather than the one the OS ends up
//     at, which a symlink inside a workspace defeats (the candidate is
//     `realpath`d, and so is every root).
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveWorktreePath } from '@generatorai/core';
import type { Container } from '../composition-root.js';

/**
 * How long the root list is reused.
 *
 * "Open in editor" is clicked from a file list, so the roots would otherwise
 * be rebuilt — several repository queries each — once per click. Ten seconds
 * is short enough that a workspace created moments ago becomes openable
 * without a restart, and long enough that a burst of clicks costs one query.
 */
const ROOTS_TTL_MS = 10_000;

/** Resolve + follow symlinks; falls back to the resolved path when it does not exist. */
async function realResolve(target: string): Promise<string> {
  const resolved = path.resolve(target);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

/** True when `target` IS `root` or lies underneath it. Both must already be resolved. */
export function isInsideRoot(target: string, root: string): boolean {
  if (target === root) return true;
  return target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

export function createEditorRoutes(container: Container): Router {
  const router = Router();
  const {
    editorLauncherService,
    workspaceManager,
    projectService,
    codebaseService,
    worktreeService,
    logger,
  } = container;

  let cachedRoots: { at: number; roots: string[] } | null = null;

  /**
   * Every directory a caller is allowed to open a file from, resolved and
   * symlink-followed.
   *
   * Each source is collected independently and its failure logged rather than
   * thrown: a broken worktree row must not make workspace files unopenable —
   * but it must not widen the set either, so a failure only ever REMOVES
   * roots.
   */
  async function knownRoots(): Promise<string[]> {
    const now = Date.now();
    if (cachedRoots && now - cachedRoots.at < ROOTS_TTL_MS) return cachedRoots.roots;

    const raw: string[] = [];

    try {
      for (const ws of await workspaceManager.listWorkspaces({})) {
        raw.push(ws.rootPath, ws.workingDirectory);
        for (const mount of ws.mounts ?? []) raw.push(mount.path);
        for (const wt of ws.worktrees ?? []) {
          raw.push(resolveWorktreePath(ws.rootPath, wt.worktreePath));
        }
      }
    } catch (err) {
      logger.warn(`[EditorRoutes] Could not list workspaces: ${String(err)}`);
    }

    try {
      for (const project of await projectService.listProjects()) {
        for (const codebase of await codebaseService.getByProjectId(project.id)) {
          if (codebase.clonePath) raw.push(codebase.clonePath);
          if (codebase.localPath) raw.push(codebase.localPath);
        }
      }
    } catch (err) {
      logger.warn(`[EditorRoutes] Could not list project codebases: ${String(err)}`);
    }

    try {
      for (const wt of await worktreeService.listWorktrees()) {
        if (wt.worktreePath) raw.push(wt.worktreePath);
      }
    } catch (err) {
      logger.warn(`[EditorRoutes] Could not list worktrees: ${String(err)}`);
    }

    const roots = [
      ...new Set(await Promise.all(raw.filter(Boolean).map((r) => realResolve(r)))),
    ];
    cachedRoots = { at: now, roots };
    return roots;
  }

  // GET /editor/editors — which editors this host can launch.
  router.get('/editors', async (_req, res, next) => {
    try {
      res.json(await editorLauncherService.listEditors());
    } catch (err) {
      next(err);
    }
  });

  // POST /editor/open — launch an editor at a path (optionally at a line).
  //
  // A 200 with `ok: false` is normal, not an error: `fallbackUrl` is the
  // browser's next move when the server could not launch anything (it may be
  // running headless, or on another machine entirely).
  router.post('/open', async (req, res, next) => {
    try {
      const target = req.body?.path;
      if (typeof target !== 'string' || !target.trim()) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'path is required' } });
        return;
      }

      for (const key of ['line', 'column'] as const) {
        const value = req.body?.[key];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
          res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: `${key} must be a positive integer` },
          });
          return;
        }
      }

      const editor = req.body?.editor;
      if (editor !== undefined && typeof editor !== 'string') {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'editor must be a string' } });
        return;
      }

      const candidate = await realResolve(target.trim());
      const roots = await knownRoots();
      if (!roots.some((root) => isInsideRoot(candidate, root))) {
        // Deliberately does not name the roots — that would turn a rejected
        // request into a directory-layout oracle.
        logger.warn('[EditorRoutes] Refused to open a path outside every known root', {
          requestId: req.requestId,
        });
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Path is not inside a known workspace, codebase or worktree',
          },
        });
        return;
      }

      const result = await editorLauncherService.open({
        path: target.trim(),
        ...(typeof req.body?.line === 'number' ? { line: req.body.line } : {}),
        ...(typeof req.body?.column === 'number' ? { column: req.body.column } : {}),
        ...(editor !== undefined ? { editor } : {}),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
