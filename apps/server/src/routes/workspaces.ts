// ────────────────────────────────────────────────────────────────
// Workspace Routes — workspace management API
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Response } from 'express';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Container } from '../composition-root.js';
import { resolveWorktreePath, type WorkspaceTreeRepo } from '@generatorai/core';
import {
  stripAliasPrefix,
  type ChangeSummary,
  type MountRef,
} from '@generatorai/changes';
import type { WorkspaceFileReviewRow } from '@generatorai/core';
import type { WorkspaceFilters, WorkspaceInfo, WorkspaceOwnerType, WorkspaceStatus } from '@generatorai/shared';

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
    workspaceFileReviewRepo,
    sourceControlService,
    eventBus,
    logger,
  } = container;

  /** Key a review row is stored under. NUL cannot occur in a path. */
  const reviewKey = (alias: string, filePath: string): string => `${alias}\u0000${filePath}`;

  /**
   * Overlay per-file review state onto a change summary.
   *
   * `kept` is deliberately NOT a stored boolean: a row records the blob sha
   * the user accepted, and a file counts as kept only while its CURRENT head
   * blob still equals that sha. So the agent editing a kept file un-keeps it
   * automatically, with no invalidation step to forget — and a file that was
   * discarded (or edited back to its base, and so is no longer in the
   * summary at all) leaves a row that can never match again.
   *
   * Those dead rows are swept here, on read, because this is the only place
   * that knows the full current change set. `cleanupStale` gates it: a
   * summary narrowed to one alias, or taken against a different base, does
   * not list files that are legitimately kept elsewhere.
   */
  async function applyKeptState(
    workspaceId: string,
    summary: ChangeSummary,
    cleanupStale: boolean,
  ): Promise<ChangeSummary> {
    let rows: WorkspaceFileReviewRow[];
    try {
      rows = await workspaceFileReviewRepo.list(workspaceId);
    } catch (err) {
      // Review state is an aid, not the answer to "what changed?" — never
      // fail the summary over it.
      logger.warn(`[WorkspaceRoutes] Could not read review rows for ${workspaceId}: ${err}`);
      return summary;
    }
    if (rows.length === 0) {
      return {
        ...summary,
        repos: summary.repos.map((r) => ({ ...r, keptCount: 0 })),
        keptCount: 0,
      };
    }

    const accepted = new Map(rows.map((r) => [reviewKey(r.alias, r.path), r.acceptedBlob]));
    const matched = new Set<string>();
    let total = 0;

    const repos = summary.repos.map((repo) => {
      let keptCount = 0;
      const files = repo.files.map((file) => {
        const key = reviewKey(repo.alias, file.path);
        const acceptedBlob = accepted.get(key);
        if (acceptedBlob === undefined) return file;
        // A deleted file has no head object; `''` is the sha we store for it.
        if (acceptedBlob !== (file.newBlob ?? '')) return file;
        matched.add(key);
        keptCount += 1;
        return { ...file, kept: true };
      });
      total += keptCount;
      return { ...repo, files, keptCount };
    });

    if (cleanupStale && matched.size !== rows.length) {
      const stale = rows
        .filter((r) => !matched.has(reviewKey(r.alias, r.path)))
        .map((r) => ({ alias: r.alias, path: r.path }));
      // Best effort and off the response path: a failed sweep only means the
      // row is retried on the next read.
      void workspaceFileReviewRepo
        .deleteMany(workspaceId, stale)
        .catch((err) =>
          logger.warn(`[WorkspaceRoutes] Stale review sweep failed for ${workspaceId}: ${err}`),
        );
    }

    return { ...summary, repos, keptCount: total };
  }

  /** Tell every client viewing this workspace that `kept` moved. */
  async function announceReviewChanged(workspaceId: string): Promise<void> {
    try {
      await eventBus.emitGlobal({ kind: 'workspace.review_changed', data: { workspaceId } });
    } catch (err) {
      logger.warn(`[WorkspaceRoutes] review_changed emit failed for ${workspaceId}: ${err}`);
    }
  }

  /** `{ alias, path }` pairs off a request body, normalised and validated. */
  function readFileRefs(value: unknown): Array<{ alias: string; path: string }> {
    if (!Array.isArray(value)) return [];
    const out: Array<{ alias: string; path: string }> = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const raw = entry as Record<string, unknown>;
      const alias = typeof raw['alias'] === 'string' && raw['alias'].trim() ? raw['alias'].trim() : '.';
      const filePath = typeof raw['path'] === 'string' ? raw['path'].trim() : '';
      if (!filePath) continue;
      // Repo-relative, never alias-prefixed — the same rule checkpoint
      // restore paths follow, since both index into ONE mount's tree.
      out.push({ alias, path: stripAliasPrefix(filePath, alias) });
    }
    return out;
  }

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
        // A turn writes two checkpoints (before/after) sharing the id; the
        // base of "what did this turn change?" is the BEFORE one.
        const rows = await checkpointService.list({ workspaceId, limit: 500 });
        const match =
          rows.find((c) => c.turnId === id && c.phase === 'before') ??
          rows.find((c) => c.turnId === id);
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

  /**
   * Resolve a workspace + the mounts the change engine tracks, or send a 404.
   *
   * The mounts (each with its shadow store) are the ONE definition of "which
   * directories are tracked", shared with checkpoint capture — the two must
   * never disagree, or a repo gets diffed against a baseline that was never
   * captured for it.
   */
  async function loadWorkspace(id: string, res: Response) {
    const ws = await workspaceManager.getExecutionWorkspace(id);
    const info = ws ? await workspaceManager.getWorkspaceInfo(id) : null;
    if (!ws || !info) {
      res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${id}` } });
      return null;
    }
    const mounts: MountRef[] = await workspaceManager.toMountRefs(ws);
    const worktrees = (info.worktrees ?? []).map((wt) => ({
      alias: wt.alias,
      worktreePath: resolveWorktreePath(info.rootPath, wt.worktreePath),
    }));
    return { info, worktrees, mounts, rootPath: ws.codeRoot ?? ws.rootPath };
  }

  /** Directory behind a mount alias (nested `<alias>/<sub>` included). */
  function mountDir(info: WorkspaceInfo, alias: string): string | null {
    if (!alias || alias === '.') return info.workingDirectory;
    const direct = info.mounts.find((m) => m.alias === alias);
    if (direct) return direct.path;
    const slash = alias.indexOf('/');
    if (slash > 0) {
      const parent = info.mounts.find((m) => m.alias === alias.slice(0, slash));
      if (parent) return path.join(parent.path, alias.slice(slash + 1));
    }
    return null;
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
      const { worktrees, mounts, rootPath } = loaded;
      // Reads never mutate the workspace; `autoInit` is legacy and off.
      const autoInit = false;

      if (String(req.query['v'] ?? '2') === '1') {
        const changeSet = await changeSetService.getChangeSet({
          rootPath,
          worktrees,
          mounts,
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
      const aliasFilter =
        typeof req.query['alias'] === 'string' && req.query['alias']
          ? String(req.query['alias'])
          : undefined;
      const summary = await changeSummaryService.getSummary({
        workspaceId: id,
        rootPath,
        worktrees,
        mounts,
        base,
        head,
        autoInit,
        includeTree: String(req.query['includeTree'] ?? '') === 'true',
        ...(aliasFilter ? { repoAlias: aliasFilter } : {}),
      });
      // Only the default view (every mount, session start → working tree) is
      // the complete picture, so only it may sweep rows it cannot account for.
      const isFullDefaultView =
        !aliasFilter && base.kind === 'baseline' && head.kind === 'working';
      res.json(await applyKeptState(id, summary, isFullDefaultView));
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
      const { worktrees, mounts, rootPath } = loaded;

      const alias = String(req.query['alias'] ?? '.');
      const base = await parseRevision(req.query['base'], 'baseline', id);
      const head = await parseRevision(req.query['head'], 'working', id);
      const form = String(req.query['form'] ?? 'versions');

      // A renamed file lives under its OLD name on the base side. Without
      // this the base blob lookup misses and the rename renders as a pure
      // addition — the one case where the expanded diff contradicted the
      // summary, which already knew the old path.
      const oldPath = typeof req.query['oldPath'] === 'string' ? req.query['oldPath'].trim() : '';

      const common = {
        workspaceId: id,
        rootPath,
        worktrees,
        mounts,
        base,
        head,
        autoInit: false,
        filePath,
        alias,
        ...(oldPath ? { oldPath } : {}),
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

  // ── Per-file review (Keep / Undo) ────────────────────────────

  // POST /workspaces/:id/changes/review — record what the user has accepted
  //
  //   { keep:   [{ alias, path, blob }] }  accept these files AT THIS content
  //   { unkeep: [{ alias, path }] }        drop the acceptance
  //   { keepAll: true }                    accept every currently changed file
  //
  // `blob` is the head blob sha the client saw (`''` for a deleted file).
  // Storing the content identity rather than a flag is what makes the state
  // self-correcting: a later edit moves the head blob and the file is simply
  // no longer kept. Unkeep wins over keep for the same file in one request,
  // since it is applied first.
  router.post('/:id/changes/review', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const loaded = await loadWorkspace(id, res);
      if (!loaded) return;
      const { worktrees, mounts, rootPath } = loaded;

      const now = new Date();
      const keepRows: WorkspaceFileReviewRow[] = [];
      const seen = new Set<string>();
      const pushKeep = (alias: string, filePath: string, blob: string): void => {
        const key = reviewKey(alias, filePath);
        if (seen.has(key)) return;
        seen.add(key);
        keepRows.push({
          workspaceId: id,
          alias,
          path: filePath,
          acceptedBlob: blob,
          acceptedAt: now,
        });
      };

      if (req.body?.keepAll === true) {
        // Resolved server-side rather than trusting a client-supplied list:
        // the blob each file is accepted AT must be the one on disk right
        // now, or a race with the agent would record an acceptance of
        // content nobody reviewed.
        const summary = await changeSummaryService.getSummary({
          workspaceId: id,
          rootPath,
          worktrees,
          mounts,
          base: { kind: 'baseline' },
          head: { kind: 'working' },
          autoInit: false,
        });
        for (const repo of summary.repos) {
          for (const file of repo.files) {
            pushKeep(repo.alias, file.path, file.newBlob ?? '');
          }
        }
      }

      for (const entry of Array.isArray(req.body?.keep) ? (req.body.keep as unknown[]) : []) {
        if (!entry || typeof entry !== 'object') continue;
        const raw = entry as Record<string, unknown>;
        const alias =
          typeof raw['alias'] === 'string' && raw['alias'].trim() ? raw['alias'].trim() : '.';
        const filePath =
          typeof raw['path'] === 'string' ? stripAliasPrefix(raw['path'].trim(), alias) : '';
        if (!filePath) continue;
        const blob = typeof raw['blob'] === 'string' ? raw['blob'].trim() : '';
        // Anything that is not a plain object id (or the deleted-file
        // sentinel) could never match a head blob, so a row built from it
        // would be permanently stale.
        if (blob && !/^[0-9a-f]{40}$/i.test(blob)) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Not a blob sha: ${blob}`,
            },
          });
          return;
        }
        pushKeep(alias, filePath, blob.toLowerCase());
      }

      const unkeep = readFileRefs(req.body?.unkeep);

      if (keepRows.length === 0 && unkeep.length === 0) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Nothing to do: supply keep, unkeep or keepAll',
          },
        });
        return;
      }

      // Unkeep first so a request carrying both for one file ends up kept.
      if (unkeep.length > 0) await workspaceFileReviewRepo.deleteMany(id, unkeep);
      if (keepRows.length > 0) await workspaceFileReviewRepo.upsertMany(keepRows);

      const keptCount = (await workspaceFileReviewRepo.list(id)).length;
      await announceReviewChanged(id);
      logger.info(
        `[WorkspaceRoutes] Review ${id}: +${keepRows.length} kept, -${unkeep.length} unkept`,
        { requestId: req.requestId },
      );
      res.json({ workspaceId: id, kept: keepRows.length, unkept: unkeep.length, keptCount });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/changes/discard — undo files, per mount
  //
  //   { files: [{ alias, path }] }   discard exactly these
  //   { all: true }                  discard every changed file, every mount
  //
  // Each mount is restored from ITS OWN base, which is the whole point: the
  // per-file "Undo" used to go through the first mount's checkpoint id, so
  // it was wrong on a second mount and unavailable entirely on any mount
  // whose base is a bare commit (a linked worktree's branch base, a git
  // folder's first commit). `restoreFromRevision` covers those, so every
  // mount kind can be undone.
  //
  // Always undoable in turn: each mount gets a `pre_restore` checkpoint
  // before anything is written.
  router.post('/:id/changes/discard', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const loaded = await loadWorkspace(id, res);
      if (!loaded) return;
      const { worktrees, mounts, rootPath } = loaded;

      const all = req.body?.all === true;
      const requested = readFileRefs(req.body?.files);
      if (!all && requested.length === 0) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Supply files: [{ alias, path }] or all: true',
          },
        });
        return;
      }

      // The summary is what defines "changed", carries each mount's own base
      // (repos[].base), and knows which files were renamed.
      const summary = await changeSummaryService.getSummary({
        workspaceId: id,
        rootPath,
        worktrees,
        mounts,
        base: { kind: 'baseline' },
        head: { kind: 'working' },
        autoInit: false,
      });

      const results: Array<{
        alias: string;
        ok: boolean;
        restored: number;
        deleted: number;
        preRestoreCheckpointId?: string | null;
        error?: string;
      }> = [];
      const skipped: Array<{ alias: string; path: string; reason: string }> = [];
      const discarded: Array<{ alias: string; path: string }> = [];

      for (const repo of summary.repos) {
        const wanted = new Set(
          all
            ? repo.files.map((f) => f.path)
            : requested.filter((r) => r.alias === repo.alias).map((r) => r.path),
        );
        if (wanted.size === 0) continue;

        // A rename needs both halves in the pathspec: the new path to delete,
        // the old one to put back. Without the old path the file would simply
        // vanish instead of returning to its previous name.
        const pathspec = new Set(wanted);
        for (const file of repo.files) {
          if (file.oldPath && wanted.has(file.path)) pathspec.add(file.oldPath);
        }

        const repoDir = await workspaceCheckpointService.resolveRepoDir(id, repo.alias);
        if (!repoDir) {
          results.push({
            alias: repo.alias,
            ok: false,
            restored: 0,
            deleted: 0,
            error: `Repository "${repo.alias}" is no longer present in this workspace`,
          });
          continue;
        }
        const treeish = repo.base.treeish;
        if (!treeish) {
          results.push({
            alias: repo.alias,
            ok: false,
            restored: 0,
            deleted: 0,
            error: `No base revision for mount "${repo.alias}"`,
          });
          continue;
        }

        try {
          // Prefer the checkpoint row when the base IS one — the label it
          // carries is what the rewind timeline shows for the undo snapshot.
          const baseCheckpoint = repo.base.id
            ? await checkpointService.getById(repo.base.id)
            : null;
          const result =
            baseCheckpoint && baseCheckpoint.repoAlias === repo.alias
              ? await checkpointService.restore(baseCheckpoint, repoDir, [...pathspec])
              : await checkpointService.restoreFromRevision(
                  id,
                  repo.alias,
                  repoDir,
                  treeish,
                  [...pathspec],
                  repo.base.label ?? 'the base revision',
                );

          // Drop the memoised working tree BEFORE announcing: clients refetch
          // the instant they see the event, well inside the cache TTL.
          changeSummaryService.invalidateWorkingTree(repoDir);
          await workspaceCheckpointService.announceRestore(
            id,
            baseCheckpoint?.id ?? treeish,
            repo.alias,
            result,
          );

          for (const entry of result.skipped) {
            skipped.push({ alias: repo.alias, path: entry.path, reason: entry.reason });
          }
          for (const filePath of wanted) discarded.push({ alias: repo.alias, path: filePath });
          results.push({
            alias: repo.alias,
            ok: true,
            restored: result.restoredPaths.length,
            deleted: result.deletedPaths.length,
            preRestoreCheckpointId: result.preRestoreCheckpointId,
          });
        } catch (err) {
          results.push({
            alias: repo.alias,
            ok: false,
            restored: 0,
            deleted: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // A discarded file is no longer changed, so its acceptance is moot.
      if (discarded.length > 0) {
        await workspaceFileReviewRepo.deleteMany(id, discarded).catch((err) => {
          logger.warn(`[WorkspaceRoutes] Could not clear review rows for ${id}: ${err}`);
        });
        await announceReviewChanged(id);
      }

      logger.info(
        `[WorkspaceRoutes] Discarded ${discarded.length} file(s) across ${results.length} mount(s) in ${id}`,
        { requestId: req.requestId },
      );
      res.json({
        workspaceId: id,
        mounts: results,
        restoredCount: results.reduce((n, r) => n + r.restored, 0),
        deletedCount: results.reduce((n, r) => n + r.deleted, 0),
        discardedCount: discarded.length,
        skipped,
      });
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

      let checkpoint = await checkpointService.getById(checkpointId);
      if (!checkpoint || checkpoint.workspaceId !== id) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Checkpoint not found: ${checkpointId}` },
        });
        return;
      }

      // A checkpoint belongs to ONE mount. When the caller names a different
      // mount (`alias`), swap in that mount's equivalent snapshot: the same
      // turn+phase, or its baseline — otherwise a discard on the second mount
      // of a workspace would silently restore nothing.
      const wantedAlias = typeof req.body?.alias === 'string' ? req.body.alias.trim() : '';
      if (wantedAlias && wantedAlias !== checkpoint.repoAlias) {
        const rows = await checkpointService.list({ workspaceId: id, repoAlias: wantedAlias, limit: 500, excludeLive: false });
        const match =
          (checkpoint.turnId
            ? rows.find((c) => c.turnId === checkpoint!.turnId && (c.phase ?? null) === (checkpoint!.phase ?? null))
            : undefined) ??
          (checkpoint.kind === 'baseline' ? rows.find((c) => c.kind === 'baseline') : undefined) ??
          rows.find((c) => Math.abs(c.createdAt.getTime() - checkpoint!.createdAt.getTime()) < 15_000 && c.kind === checkpoint!.kind);
        if (!match) {
          res.status(409).json({
            error: { code: 'CONFLICT', message: `No matching checkpoint for mount "${wantedAlias}"` },
          });
          return;
        }
        checkpoint = match;
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

      // Paths are repo-relative. An `<alias>/` prefix is stripped so a client
      // passing tree ids verbatim still restores the right file — before this
      // the pathspec matched nothing inside the repo and the discard was a
      // silent no-op that still wrote a pre_restore checkpoint.
      const paths = Array.isArray(req.body?.paths)
        ? (req.body.paths as unknown[])
            .filter((p): p is string => typeof p === 'string')
            .map((p) => stripAliasPrefix(p, checkpoint.repoAlias))
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
      res.json({ workspaceId: id, checkpointId: checkpoint.id, repoAlias: checkpoint.repoAlias, ...result });
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
      const { worktrees, mounts, rootPath } = loaded;

      const tree = await workspaceTreeService.listTree({
        workspaceId: id,
        rootPath,
        worktrees,
        mounts,
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
      const { worktrees, mounts, rootPath } = loaded;

      const file = await workspaceTreeService.readFile({
        rootPath,
        worktrees,
        mounts,
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
      const repoDir = mountDir(info, alias) ?? info.workingDirectory;
      const fileRel = stripAliasPrefix(relPath, alias);
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
      const repoDir = mountDir(info, alias) ?? info.workingDirectory;
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
      const repoDir = mountDir(info, alias) ?? info.workingDirectory;
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

  // GET /workspaces/:id/files — every file the composer can @-mention
  //
  // One entry per MOUNT (in-place folders included), listed through the same
  // tree service the Files tab uses (git ls-files via the mount's shadow
  // store), so .gitignore is honoured and the answer costs one subprocess per
  // mount instead of a stat per file. `workspaceFiles` are the managed
  // root's scratch/plans files; `sourceFiles` is kept (empty) for older
  // clients.
  router.get('/:id/files', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const loaded = await loadWorkspace(id, res);
      if (!loaded) return;
      const { info, mounts, rootPath } = loaded;

      const tree = await workspaceTreeService.listTree({ workspaceId: id, rootPath, mounts });
      const byAlias = new Map(tree.repos.map((r) => [r.alias, r.paths]));
      const worktreeEntries = info.mounts
        .filter((m) => m.status !== 'removed')
        .map((m) => {
          // Nested repos are listed under their parent mount with a prefix.
          const own = byAlias.get(m.alias) ?? [];
          const nested = (m.git?.nested ?? []).flatMap((sub) =>
            (byAlias.get(`${m.alias}/${sub}`) ?? []).map((p) => `${sub}/${p}`),
          );
          return { alias: m.alias, worktreePath: m.path, mode: m.mode, files: [...own, ...nested] };
        });

      // Managed-root files a person might reference: scratch and plans.
      async function listManaged(sub: string): Promise<string[]> {
        const dir = path.join(info.rootPath, sub);
        try {
          const entries = (await fs.readdir(dir, { recursive: true })) as unknown as string[];
          const out: string[] = [];
          for (const entry of entries) {
            if (entry === '.git' || entry.startsWith('.git/') || entry.startsWith('.git\\')) continue;
            if (entry.includes('node_modules')) continue;
            const full = path.join(dir, entry);
            const stat = await fs.stat(full).catch(() => null);
            if (stat?.isFile()) out.push(path.posix.join(sub, entry.split(path.sep).join('/')));
            if (out.length >= 2000) break;
          }
          return out;
        } catch {
          return [];
        }
      }
      const [scratchFiles, planFiles, artifactFiles] = await Promise.all([
        listManaged('scratch'),
        listManaged('plans'),
        listManaged('artifacts'),
      ]);

      res.json({
        workspaceId: id,
        rootPath: info.rootPath,
        scratchPath: info.scratchPath,
        codeRoot: info.workingDirectory,
        mounts: info.mounts.map((m) => ({ alias: m.alias, path: m.path, mode: m.mode })),
        workspaceFiles: [...scratchFiles, ...planFiles],
        artifactFiles: artifactFiles.map((f) => f.replace(/^artifacts\//, '')),
        sourceFiles: [],
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
        const dir = mountDir(info, worktreeAlias);
        if (!dir) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: `Mount not found: ${worktreeAlias}` } });
          return;
        }
        baseDir = dir;
      } else if (source === 'artifacts') {
        baseDir = path.join(info.rootPath, 'artifacts');
      } else if (source === 'source') {
        baseDir = path.join(info.rootPath, 'source');
      } else {
        // 'workspace' source — the managed root (scratch, plans). Code lives
        // in mounts and is addressed by alias above.
        baseDir = info.rootPath;
      }

      // Prevent path traversal
      const resolvedBase = path.resolve(baseDir);
      const fullPath = path.resolve(resolvedBase, filePath);
      if (fullPath !== resolvedBase && !fullPath.startsWith(resolvedBase + path.sep)) {
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

  // PUT /workspaces/:id/files/content — write a file into the workspace.
  //
  // Open question #24: there was NO write route at all. A client could read
  // every file in a workspace and create none, so "add a file to this
  // workspace" was reachable only by having the agent do it, or by having
  // filesystem access to the server. The CLI's `$EDITOR` handoff sidesteps
  // it for EDITING (it opens the real path on a shared filesystem) but that
  // is not available to a remote client, and it cannot create.
  //
  // Deliberately the mirror image of the GET above — same `source`/
  // `worktreeAlias` resolution, same traversal guard, same size ceiling —
  // so the two cannot disagree about which directory a path means. A second,
  // differently-resolved base directory would be a path-traversal bug
  // waiting to happen.
  router.put('/:id/files/content', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const body = (req.body ?? {}) as {
        path?: unknown;
        content?: unknown;
        source?: unknown;
        worktreeAlias?: unknown;
        createDirectories?: unknown;
      };
      const filePath = typeof body.path === 'string' ? body.path : '';
      const content = typeof body.content === 'string' ? body.content : null;
      const source = typeof body.source === 'string' ? body.source : 'workspace';
      const worktreeAlias = typeof body.worktreeAlias === 'string' ? body.worktreeAlias : undefined;

      if (!filePath || content === null) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'path and content are required' },
        });
        return;
      }
      const MAX_SIZE = 512 * 1024;
      if (Buffer.byteLength(content, 'utf-8') > MAX_SIZE) {
        // The same ceiling the read path truncates at. Accepting a larger
        // write would create a file this API can never read back whole.
        res.status(413).json({
          error: { code: 'PAYLOAD_TOO_LARGE', message: `Content exceeds ${MAX_SIZE} bytes` },
        });
        return;
      }

      const info = await workspaceManager.getWorkspaceInfo(id);
      if (!info) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Workspace not found: ${id}` } });
        return;
      }

      let baseDir: string;
      if (source === 'worktree' && worktreeAlias) {
        const dir = mountDir(info, worktreeAlias);
        if (!dir) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: `Mount not found: ${worktreeAlias}` } });
          return;
        }
        baseDir = dir;
      } else if (source === 'artifacts') {
        baseDir = path.join(info.rootPath, 'artifacts');
      } else if (source === 'source') {
        baseDir = path.join(info.rootPath, 'source');
      } else {
        baseDir = info.rootPath;
      }

      const resolvedBase = path.resolve(baseDir);
      const fullPath = path.resolve(resolvedBase, filePath);
      // `startsWith` on the base alone would accept a sibling directory whose
      // name merely begins with it (`/w/ws` vs `/w/ws-evil`), so the
      // separator is part of the comparison.
      if (fullPath !== resolvedBase && !fullPath.startsWith(resolvedBase + path.sep)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid file path' } });
        return;
      }

      if (body.createDirectories !== false) {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
      }
      const existed = await fs
        .stat(fullPath)
        .then(() => true)
        .catch(() => false);
      await fs.writeFile(fullPath, content, 'utf-8');

      res.status(existed ? 200 : 201).json({
        path: filePath,
        size: Buffer.byteLength(content, 'utf-8'),
        created: !existed,
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The parent directory does not exist. Omit createDirectories:false to create it.',
          },
        });
        return;
      }
      next(err);
    }
  });

  return router;
}
