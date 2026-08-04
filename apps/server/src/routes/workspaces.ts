// ────────────────────────────────────────────────────────────────
// Workspace Routes — workspace management API
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Response } from 'express';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Container } from '../composition-root.js';
import type { WorkspaceTreeRepo } from '@generatorai/core';
import type { WorkspaceFilters, WorkspaceOwnerType, WorkspaceStatus } from '@generatorai/shared';

/**
 * Cheap, order-sensitive digest of a tree's path set, used only to build an
 * ETag. A full hash of every path string would cost more than re-sending a
 * small tree; this is enough to notice an add, a delete or a rename.
 */
function hashPaths(repos: WorkspaceTreeRepo[]): string {
  let h = 2166136261;
  for (const repo of repos) {
    for (const p of repo.paths) {
      for (let i = 0; i < p.length; i++) {
        h ^= p.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
    }
  }
  return (h >>> 0).toString(36);
}

export function createWorkspaceRoutes(container: Container): Router {
  const router = Router();
  const {
    workspaceManager,
    changeSetService,
    changeSummaryService,
    workspaceTreeService,
    checkpointService,
    workspaceCheckpointService,
    sourceControlService,
    logger,
  } = container;

  /**
   * Parse a revision selector from a query string.
   *
   *   baseline                → the workspace's first checkpoint
   *   working                 → the live working tree
   *   checkpoint:<id>         → a specific checkpoint
   *   turn:<turnId>           → the checkpoint captured before that turn
   *   stage:<stageRunId>      → the checkpoint captured before that stage
   *   ref:<rev>               → a raw git revision
   */
  async function parseRevision(
    raw: unknown,
    fallback: 'baseline' | 'working',
    workspaceId: string,
  ): Promise<{ kind: 'baseline' | 'working' | 'checkpoint' | 'ref'; id?: string }> {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return { kind: fallback };
    if (value === 'baseline') return { kind: 'baseline' };
    if (value === 'working') return { kind: 'working' };

    const sep = value.indexOf(':');
    if (sep === -1) return { kind: fallback };
    const prefix = value.slice(0, sep);
    const id = value.slice(sep + 1);
    if (!id) return { kind: fallback };

    switch (prefix) {
      case 'checkpoint':
        return { kind: 'checkpoint', id };
      case 'ref':
        return { kind: 'ref', id };
      case 'turn': {
        const rows = await checkpointService.list({ workspaceId, limit: 500 });
        const match = rows.find((c) => c.turnId === id);
        return match ? { kind: 'checkpoint', id: match.id } : { kind: fallback };
      }
      case 'stage': {
        const rows = await checkpointService.list({ workspaceId, limit: 500 });
        const match = rows.find((c) => c.stageRunId === id);
        return match ? { kind: 'checkpoint', id: match.id } : { kind: fallback };
      }
      default:
        return { kind: fallback };
    }
  }

  /** Resolve a workspace + its worktree refs, or send a 404. */
  async function loadWorkspace(id: string, res: Response) {
    const info = await workspaceManager.getWorkspaceInfo(id);
    if (!info) {
      res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${id}` } });
      return null;
    }
    const worktrees = (info.worktrees ?? []).map((wt) => ({
      alias: wt.alias,
      worktreePath: path.join(info.rootPath, wt.worktreePath),
    }));
    return { info, worktrees };
  }

  // GET /workspaces — List workspaces with filters
  router.get('/', async (req, res, next) => {
    try {
      const { projectId, ownerType, status, limit, offset } = req.query;
      // Query params arrive as strings; cast the union-typed fields narrowly
      // (WorkspaceManager validates the actual values downstream).
      const filters: WorkspaceFilters = {};
      if (projectId && typeof projectId === 'string') filters.projectId = projectId;
      if (ownerType && typeof ownerType === 'string') filters.ownerType = ownerType as WorkspaceOwnerType;
      if (status && typeof status === 'string') filters.status = status as WorkspaceStatus;
      if (limit) filters.limit = Number(limit);
      if (offset) filters.offset = Number(offset);

      const workspaces = await workspaceManager.listWorkspaces(filters);
      res.json(workspaces);
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id — Get workspace details
  router.get('/:id', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const workspace = await workspaceManager.getWorkspaceInfo(id);
      if (!workspace) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${id}` } });
        return;
      }
      res.json(workspace);
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/archive — Archive workspace
  router.post('/:id/archive', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      await workspaceManager.archiveWorkspace(id);
      logger.info(`[WorkspaceRoutes] Archived workspace ${id}`, { requestId: req.requestId });
      res.status(200).json({ status: 'archived' });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/commit — Commit workspace changes
  router.post('/:id/commit', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const message = req.body?.message;
      const committed = await workspaceManager.commitWorkspace(id, message);
      res.json({ committed });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/changes — Centralized change set (diff/status)
  //
  // v2 (default): summary-first. Per-file metadata + line counts only; the
  //   client fetches each file's content from /changes/file on demand. This
  //   keeps the payload O(files) instead of O(bytes-changed).
  // v1 (?v=1): legacy shape with every file's full unified diff inline.
  //   Kept for one release so older clients keep working.
  router.get('/:id/changes', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const loaded = await loadWorkspace(id, res);
      if (!loaded) return;
      const { info, worktrees } = loaded;
      const autoInit = String(req.query['autoInit'] ?? 'true') !== 'false';

      if (String(req.query['v'] ?? '2') === '1') {
        const changeSet = await changeSetService.getChangeSet({
          rootPath: info.rootPath,
          worktrees,
          autoInit,
        });
        res.json({
          workspaceId: id,
          hasGit: changeSet.hasGit,
          repos: changeSet.repos.map((r) => ({
            alias: r.alias,
            kind: r.kind,
            files: r.files.map((f) => ({ path: f.path, status: f.status, diff: f.diff })),
          })),
        });
        return;
      }

      const base = await parseRevision(req.query['base'], 'baseline', id);
      const head = await parseRevision(req.query['head'], 'working', id);
      const summary = await changeSummaryService.getSummary({
        workspaceId: id,
        rootPath: info.rootPath,
        worktrees,
        base,
        head,
        autoInit,
        includeTree: String(req.query['includeTree'] ?? '') === 'true',
        ...(typeof req.query['alias'] === 'string' && req.query['alias']
          ? { repoAlias: String(req.query['alias']) }
          : {}),
      });
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/changes/file — one file's content or patch
  //
  //   form=versions (default) → { old, new } full contents; enables
  //     "expand unchanged context" in the renderer.
  //   form=patch              → unified diff only; used when the bodies
  //     exceed the inline budget.
  //
  // ETag is `<oldBlob>:<newBlob>`, so an unchanged file is a 304 and the
  // client's syntax-highlight cache stays warm across refetches.
  router.get('/:id/changes/file', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const filePath = String(req.query['path'] ?? '');
      if (!filePath) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'path query parameter is required' },
        });
        return;
      }
      const loaded = await loadWorkspace(id, res);
      if (!loaded) return;
      const { info, worktrees } = loaded;

      const alias = String(req.query['alias'] ?? '.');
      const base = await parseRevision(req.query['base'], 'baseline', id);
      const head = await parseRevision(req.query['head'], 'working', id);
      const form = String(req.query['form'] ?? 'versions');

      const common = {
        workspaceId: id,
        rootPath: info.rootPath,
        worktrees,
        base,
        head,
        autoInit: false,
        filePath,
        alias,
      };

      /**
       * Blob SHAs the client already learned from the summary. Purely an
       * optimisation — passing them lets the service read the two objects
       * directly instead of re-deriving them, which is the difference
       * between ~2 and ~9 git subprocesses. Anything malformed is dropped
       * here and the service falls back to deriving it.
       */
      const knownBlob = (value: unknown): string | undefined => {
        const sha = typeof value === 'string' ? value.trim() : '';
        return /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
      };
      const blobs = {
        old: knownBlob(req.query['oldBlob']),
        new: knownBlob(req.query['newBlob']),
      };

      const result =
        form === 'patch'
          ? await changeSummaryService.getFilePatch(common)
          : await changeSummaryService.getFileVersions({ ...common, blobs });

      const etag = `"${result.cacheKey}"`;
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.setHeader('ETag', etag);
      // Content is immutable for a given blob pair, but the pair itself
      // changes as the agent works — revalidate every time, serve from cache
      // when unchanged.
      res.setHeader('Cache-Control', 'private, no-cache');
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ── Checkpoints ──────────────────────────────────────────────

  // GET /workspaces/:id/checkpoints — rewind picker / baseline selector
  router.get('/:id/checkpoints', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const rows = await checkpointService.list({
        workspaceId: id,
        ...(typeof req.query['alias'] === 'string' && req.query['alias']
          ? { repoAlias: String(req.query['alias']) }
          : {}),
        excludeLive: String(req.query['includeLive'] ?? '') !== 'true',
        limit: Number(req.query['limit'] ?? 200),
      });
      res.json({ workspaceId: id, checkpoints: rows });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/checkpoints — user-initiated snapshot
  router.post('/:id/checkpoints', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const label = typeof req.body?.label === 'string' ? req.body.label.trim() : undefined;
      const created = await workspaceCheckpointService.capture({
        workspaceId: id,
        kind: 'manual',
        ...(label ? { label } : {}),
        skipIfUnchanged: false,
      });
      res.status(201).json({ workspaceId: id, checkpoints: created });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/checkpoints/:checkpointId/restore — rewind
  //
  // Always writes a `pre_restore` checkpoint first so the operation is
  // undoable, and reports any path it refused to write through (symlinks and
  // hard links can point outside the workspace).
  router.post('/:id/checkpoints/:checkpointId/restore', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const checkpointId = String(req.params['checkpointId']);

      const checkpoint = await checkpointService.getById(checkpointId);
      if (!checkpoint || checkpoint.workspaceId !== id) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Checkpoint not found: ${checkpointId}` },
        });
        return;
      }

      const repoDir = await workspaceCheckpointService.resolveRepoDir(
        id,
        checkpoint.repoAlias,
      );
      if (!repoDir) {
        res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: `Repository "${checkpoint.repoAlias}" is no longer present in this workspace`,
          },
        });
        return;
      }

      const paths = Array.isArray(req.body?.paths)
        ? (req.body.paths as unknown[]).filter((p): p is string => typeof p === 'string')
        : undefined;

      const result = await checkpointService.restore(checkpoint, repoDir, paths);
      // Drop the memoised working-tree snapshot BEFORE announcing. Clients
      // refetch the moment they see the event, and that lands well inside the
      // cache's TTL — without this they would be served the pre-restore tree
      // and then sit on it, showing files that no longer exist until a manual
      // reload.
      changeSummaryService.invalidateWorkingTree(repoDir);
      // Every client viewing this workspace must refetch — the working tree
      // just moved underneath them.
      await workspaceCheckpointService.announceRestore(
        id,
        checkpointId,
        checkpoint.repoAlias,
        result,
        {
          ...(checkpoint.sessionId ? { sessionId: checkpoint.sessionId } : {}),
          ...(checkpoint.chatId ? { chatId: checkpoint.chatId } : {}),
          ...(checkpoint.workflowRunId ? { workflowRunId: checkpoint.workflowRunId } : {}),
        },
      );
      logger.info(
        `[WorkspaceRoutes] Restored checkpoint ${checkpointId} in workspace ${id}`,
        { requestId: req.requestId },
      );
      res.json({ workspaceId: id, checkpointId, ...result });
    } catch (err) {
      next(err);
    }
  });

  // ── File tree (browsing, not diffing) ────────────────────────

  // GET /workspaces/:id/tree — every browsable path, per repo
  //
  // Deliberately NOT part of /changes: the path list only moves when files
  // are created or deleted, whereas the change summary moves on every write.
  // Separate endpoints mean the Files view can toggle "all files" without
  // refetching a single diff.
  router.get('/:id/tree', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const loaded = await loadWorkspace(id, res);
      if (!loaded) return;
      const { info, worktrees } = loaded;

      const tree = await workspaceTreeService.listTree({
        workspaceId: id,
        rootPath: info.rootPath,
        worktrees,
        ...(typeof req.query['alias'] === 'string' && req.query['alias']
          ? { repoAlias: String(req.query['alias']) }
          : {}),
      });

      // Weak ETag over the path set: a browse-only client that re-opens the
      // panel gets a 304 instead of re-shipping tens of thousands of strings.
      const etag = `W/"tree-${tree.totalPaths}-${hashPaths(tree.repos)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, no-cache');
      res.json(tree);
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/tree/file — one file's current content
  //
  // Unlike /changes/file this serves ANY tracked path, not just files that
  // appear in a diff, which is what makes browsing untouched files possible.
  router.get('/:id/tree/file', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const filePath = String(req.query['path'] ?? '');
      if (!filePath) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'path query parameter is required' },
        });
        return;
      }
      const loaded = await loadWorkspace(id, res);
      if (!loaded) return;
      const { info, worktrees } = loaded;

      const file = await workspaceTreeService.readFile({
        rootPath: info.rootPath,
        worktrees,
        alias: String(req.query['alias'] ?? '.'),
        filePath,
      });

      const etag = `"${file.cacheKey}"`;
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, no-cache');
      res.json(file);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        return;
      }
      if (err instanceof Error && err.message.startsWith('Invalid file path')) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
        return;
      }
      next(err);
    }
  });

  // GET /workspaces/:id/changes/content — old vs new content for one file
  // (legacy shape; superseded by /changes/file?form=versions)
  router.get('/:id/changes/content', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const relPath = String(req.query['path'] ?? '');
      const alias = String(req.query['alias'] ?? '.');
      if (!relPath) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'path query parameter is required' } });
        return;
      }
      const info = await workspaceManager.getWorkspaceInfo(id);
      if (!info) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${id}` } });
        return;
      }
      // Resolve repo directory for the alias.
      let repoDir = info.rootPath;
      let fileRel = relPath;
      if (alias && alias !== '.') {
        const wt = (info.worktrees ?? []).find((w) => w.alias === alias);
        repoDir = wt ? path.join(info.rootPath, wt.worktreePath) : path.join(info.rootPath, alias);
        // Strip the alias prefix from the path if present.
        fileRel = relPath.startsWith(`${alias}/`) ? relPath.slice(alias.length + 1) : relPath;
      }
      const versions = await changeSetService.getFileVersions(repoDir, fileRel);
      res.json({ path: relPath, ...versions });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/pull-request — Open a PR via the active provider
  router.post('/:id/pull-request', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const info = await workspaceManager.getWorkspaceInfo(id);
      if (!info) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${id}` } });
        return;
      }
      const title = String(req.body?.title ?? '').trim();
      if (!title) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'title is required' } });
        return;
      }
      const alias = String(req.body?.alias ?? req.query['alias'] ?? '.');
      let repoDir = info.rootPath;
      if (alias && alias !== '.') {
        const wt = (info.worktrees ?? []).find((w) => w.alias === alias);
        repoDir = wt ? path.join(info.rootPath, wt.worktreePath) : path.join(info.rootPath, alias);
      }
      const pr = await sourceControlService.createPullRequest({
        repoDir,
        title,
        body: req.body?.body,
        base: req.body?.base,
        head: req.body?.head,
        draft: req.body?.draft === true,
      });
      res.json(pr);
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/pull-requests — List PRs for the repo(s)
  router.get('/:id/pull-requests', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const info = await workspaceManager.getWorkspaceInfo(id);
      if (!info) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${id}` } });
        return;
      }
      const alias = String(req.query['alias'] ?? '.');
      let repoDir = info.rootPath;
      if (alias && alias !== '.') {
        const wt = (info.worktrees ?? []).find((w) => w.alias === alias);
        repoDir = wt ? path.join(info.rootPath, wt.worktreePath) : path.join(info.rootPath, alias);
      }
      const prs = await sourceControlService.listPullRequests(repoDir);
      res.json({ provider: sourceControlService.getActiveProviderId(), pullRequests: prs });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /workspaces/:id — Delete workspace + cleanup
  router.delete('/:id', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      await workspaceManager.deleteWorkspace(id);
      logger.info(`[WorkspaceRoutes] Deleted workspace ${id}`, { requestId: req.requestId });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/cleanup — Trigger retention-based cleanup
  router.post('/cleanup', async (req, res, next) => {
    try {
      const retentionHours = req.body?.retentionHours ?? 168; // 7 days default
      const cleaned = await workspaceManager.cleanupExpiredWorkspaces({
        completedRetentionHours: retentionHours,
        archiveIfDirty: req.body?.archiveIfDirty ?? true,
        protectUnpushed: req.body?.protectUnpushed ?? true,
        maxTotalDiskMB: req.body?.maxTotalDiskMB ?? 10240,
        respectAutomationRetention: req.body?.respectAutomationRetention ?? true,
      });
      logger.info(`[WorkspaceRoutes] Cleanup removed ${cleaned} expired workspaces`, { requestId: req.requestId });
      res.json({ removed: cleaned });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/worktrees — List worktrees for a workspace
  router.get('/:id/worktrees', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const info = await workspaceManager.getWorkspaceInfo(id);
      if (!info) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${id}` } });
        return;
      }
      res.json(info.worktrees ?? []);
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/files — List all files in workspace (similar to run workspace endpoint)
  router.get('/:id/files', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const info = await workspaceManager.getWorkspaceInfo(id);
      if (!info) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${id}` } });
        return;
      }

      // Helper: list only files (not directories), excluding .git internals
      async function listFiles(dir: string): Promise<string[]> {
        try {
          const entries = await fs.readdir(dir, { recursive: true }) as unknown as string[];
          const files: string[] = [];
          for (const entry of entries) {
            if (entry === '.git' || entry.startsWith('.git/') || entry.startsWith('.git\\')) continue;
            const fullPath = path.join(dir, entry);
            const stat = await fs.stat(fullPath);
            if (stat.isFile()) files.push(entry);
          }
          return files;
        } catch {
          return [];
        }
      }

      // The agent's working directory is the workspace *root* (see
      // WorkspaceManager.getWorkingDirectory), so files it creates land
      // directly under rootPath — NOT under an `output/` subdir. List the
      // top-level workspace files, pruning the structural subdirectories
      // (source / artifacts / config / scripts / output) and internal
      // manifest so they don't show up as user output or get double-listed
      // with artifactFiles / sourceFiles / worktrees below.
      const RESERVED_WS_ENTRIES = new Set([
        '.git', 'source', 'output', 'artifacts', 'scripts', 'config',
        'node_modules', 'dist', 'build', '.cache', '.next', '.turbo', 'coverage',
      ]);
      async function listRootWorkspaceFiles(root: string): Promise<string[]> {
        try {
          const entries = await fs.readdir(root, { withFileTypes: true });
          const files: string[] = [];
          for (const e of entries) {
            if (e.name.startsWith('.')) continue; // hide .workspace.json, .gitignore, etc.
            if (e.isDirectory()) {
              if (RESERVED_WS_ENTRIES.has(e.name)) continue;
              const sub = await listFiles(path.join(root, e.name));
              for (const f of sub) files.push(path.join(e.name, f));
            } else if (e.isFile()) {
              files.push(e.name);
            }
          }
          return files;
        } catch {
          return [];
        }
      }

      const outputDir = path.join(info.rootPath, 'output');
      const artifactsDir = path.join(info.rootPath, 'artifacts');
      const sourceDir = path.join(info.rootPath, 'source');

      // List worktree files
      const worktreeEntries: Array<{ alias: string; worktreePath: string; files: string[] }> = [];
      for (const wt of (info.worktrees ?? [])) {
        const wtPath = path.join(info.rootPath, wt.worktreePath);
        const files = await listFiles(wtPath);
        worktreeEntries.push({ alias: wt.alias, worktreePath: wtPath, files });
      }

      const [rootFiles, legacyOutputFiles, artifactFiles, sourceFiles] = await Promise.all([
        listRootWorkspaceFiles(info.rootPath),
        listFiles(outputDir),
        listFiles(artifactsDir),
        listFiles(sourceDir),
      ]);
      // Merge legacy `output/`-dir files (older workspaces) with top-level
      // root files, de-duplicated. Legacy output files keep an `output/`
      // prefix so the content endpoint (baseDir = rootPath) resolves them.
      const workspaceFiles = Array.from(new Set([
        ...rootFiles,
        ...legacyOutputFiles.map((f) => path.posix.join('output', f.split(path.sep).join('/'))),
      ]));

      res.json({
        workspaceId: id,
        rootPath: info.rootPath,
        workspaceFiles,
        artifactFiles,
        sourceFiles,
        worktrees: worktreeEntries,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /workspaces/:id/files/content — Get a single file's content
  router.get('/:id/files/content', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const filePath = req.query['path'] as string;
      const source = (req.query['source'] as string) ?? 'workspace';
      const worktreeAlias = req.query['worktreeAlias'] as string | undefined;

      if (!filePath) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'path query parameter is required' } });
        return;
      }

      const info = await workspaceManager.getWorkspaceInfo(id);
      if (!info) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${id}` } });
        return;
      }

      let baseDir: string;
      if (source === 'worktree' && worktreeAlias) {
        const wt = (info.worktrees ?? []).find(w => w.alias === worktreeAlias);
        if (!wt) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: `Worktree not found: ${worktreeAlias}` } });
          return;
        }
        baseDir = path.join(info.rootPath, wt.worktreePath);
      } else if (source === 'artifacts') {
        baseDir = path.join(info.rootPath, 'artifacts');
      } else if (source === 'source') {
        baseDir = path.join(info.rootPath, 'source');
      } else {
        // 'workspace' source — the agent's working directory is the
        // workspace root (see WorkspaceManager.getWorkingDirectory), so
        // top-level output files resolve from rootPath, not rootPath/output.
        baseDir = info.rootPath;
      }

      // Prevent path traversal
      const fullPath = path.resolve(baseDir, filePath);
      if (!fullPath.startsWith(path.resolve(baseDir))) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid file path' } });
        return;
      }

      const stat = await fs.stat(fullPath);
      const MAX_SIZE = 512 * 1024; // 512KB
      const truncated = stat.size > MAX_SIZE;
      const content = await fs.readFile(fullPath, 'utf-8');

      res.json({
        path: filePath,
        content: truncated ? content.slice(0, MAX_SIZE) : content,
        truncated,
        size: stat.size,
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        return;
      }
      next(err);
    }
  });

  return router;
}
