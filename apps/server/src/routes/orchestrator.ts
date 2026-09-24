// ────────────────────────────────────────────────────────────────
// Orchestrator Routes (v2) — System workflows + orchestrated runs
// 8 endpoints for orchestrator management + upload support
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import multer from 'multer';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Container } from '../composition-root.js';

/**
 * Resolve `userPath` relative to `baseDir` and guarantee the real target
 * stays within `baseDir` even across symlinks.
 *
 * `path.resolve` alone does NOT follow symlinks, so an attacker-planted
 * symlink inside `baseDir` pointing at `/etc/passwd` would pass a naive
 * `resolved.startsWith(base)` check. This helper uses `fs.realpath` on
 * both sides so the comparison reflects the actual filesystem target.
 *
 * Returns the canonical absolute path on success, or `null` if the target
 * escapes the base (path traversal attempt, or symlink escape).
 *
 * For file operations that must succeed on NOT-yet-existing paths (e.g.
 * writing a new artifact), the deepest existing ancestor is resolved and
 * the remaining untraversed segments are appended.
 */
async function resolveWithinBase(
  baseDir: string,
  userPath: string,
): Promise<string | null> {
  const realBase = await fs.realpath(baseDir).catch(() => path.resolve(baseDir));
  const joined = path.resolve(baseDir, userPath);

  // Try to realpath the full target first (handles existing files + symlinks).
  let realTarget: string;
  try {
    realTarget = await fs.realpath(joined);
  } catch {
    // Target doesn't exist yet — walk up to deepest existing ancestor and
    // concat the remaining tail, then re-check containment.
    let ancestor = joined;
    const tail: string[] = [];
    // Cap iterations defensively (shouldn't hit the cap for any real path).
    for (let i = 0; i < 64; i += 1) {
      try {
        ancestor = await fs.realpath(ancestor);
        break;
      } catch {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break; // reached filesystem root
        tail.unshift(path.basename(ancestor));
        ancestor = parent;
      }
    }
    realTarget = tail.length > 0 ? path.join(ancestor, ...tail) : ancestor;
  }

  const sep = path.sep;
  if (realTarget !== realBase && !realTarget.startsWith(realBase + sep)) {
    return null;
  }
  return realTarget;
}

/** Reject writes whose target path is itself a symbolic link. */
async function rejectIfSymlink(p: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(p);
    return stat.isSymbolicLink();
  } catch {
    // ENOENT / missing is fine — nothing to reject.
    return false;
  }
}

export function createOrchestratorRoutes(container: Container): Router {
  const router = Router();
  const { workflowOrchestrator, gitManager, worktreeService, changeSetService, logger } = container;

  // Multer for file uploads (10MB limit, memory storage)
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  // Allowed upload file extensions (security: prevent executable uploads)
  const ALLOWED_EXTENSIONS = new Set([
    '.md', '.txt', '.json', '.yaml', '.yml', '.toml',
    '.ts', '.js', '.py', '.sh', '.prompt',
  ]);

  // ═══════════════════════════════════════════════════════════
  // Orchestrated Runs
  // ═══════════════════════════════════════════════════════════

  // POST /orchestrator/runs — Start an orchestrated workflow run
  router.post('/runs', upload.fields([
    { name: 'skills', maxCount: 20 },
    { name: 'agents', maxCount: 20 },
    { name: 'prompts', maxCount: 20 },
  ]), async (req, res, next) => {
    try {
      let config: unknown = req.body;
      if (req.is('multipart/form-data')) {
        try { config = JSON.parse(req.body.config); } catch {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid run configuration' } });
          return;
        }
      }
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid run configuration' } });
        return;
      }
      const files = Object.values((req.files ?? {}) as Record<string, Express.Multer.File[]>).flat();
      for (const file of files) {
        if (!ALLOWED_EXTENSIONS.has(path.extname(file.originalname).toLowerCase()) ||
            path.basename(file.originalname) !== file.originalname || /\.\.|[\\/]/.test(file.originalname)) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Invalid upload filename: ${file.originalname}` } });
          return;
        }
      }
      const { workflowDefinitionId, variables, projectId, selectedCodebases, stageOverrides } = config as {
        workflowDefinitionId: string;
        variables?: Record<string, unknown>;
        projectId?: string;
        selectedCodebases?: string[];
        stageOverrides?: Array<{ stageName?: string; stageIndex?: number; agentName?: string; contextFilter?: 'full' | 'summary-only' | 'none'; timeoutMs?: number; variables?: Record<string, unknown>; skip?: boolean }>;
      };

      if (!workflowDefinitionId) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'workflowDefinitionId is required' },
        });
        return;
      }

      const context = await workflowOrchestrator.startOrchestratedRun({
        workflowDefinitionId,
        variables,
        projectId,
        selectedCodebases,
        stageOverrides,
      }, files.length ? async (runId) => {
        const uploadsDir = await workflowOrchestrator.getRunUploadsDir(runId);
        for (const file of files) {
          // Providers discover a skill as <name>/SKILL.md, not a loose .md file.
          const relative = file.fieldname === 'skills'
            ? path.join('skills', path.parse(file.originalname).name, 'SKILL.md')
            : path.join(file.fieldname, file.originalname);
          const target = await resolveWithinBase(uploadsDir, relative);
          if (!target || await rejectIfSymlink(target)) throw new Error('Invalid upload destination');
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, file.buffer);
        }
      } : undefined);

      logger.info(`[OrchestratorRoutes] Started orchestrated run ${context.workflowRunId}`, {
        requestId: req.requestId,
      });
      res.status(201).json(context);
    } catch (err) {
      next(err);
    }
  });

  // POST /orchestrator/runs/:id/cancel — Cancel an orchestrated run
  router.post('/runs/:id/cancel', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      await workflowOrchestrator.cancelOrchestratedRun(id);

      logger.info(`[OrchestratorRoutes] Cancelled orchestrated run ${id}`, {
        requestId: req.requestId,
      });
      res.json({ success: true, runId: id });
    } catch (err) {
      next(err);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Workflow-Level File Management (shared across all runs)
  // ═══════════════════════════════════════════════════════════

  // POST /orchestrator/workflows/:id/uploads — Upload files at workflow level
  router.post('/workflows/:id/uploads', upload.array('files', 20), async (req, res, next) => {
    try {
      const definitionId = String(req.params['id']);
      const { category } = req.body as { category?: string };

      if (!category || !['skills', 'agents', 'prompts'].includes(category)) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'category must be one of: skills, agents, prompts' },
        });
        return;
      }

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No files uploaded' } });
        return;
      }

      for (const file of files) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: `File type '${ext}' not allowed.` },
          });
          return;
        }
        const safeName = path.basename(file.originalname);
        if (safeName !== file.originalname || safeName.includes('..')) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Invalid filename: ${file.originalname}` } });
          return;
        }
      }

      const uploadsDir = await workflowOrchestrator.getWorkflowUploadsDir(definitionId);
      const categoryDir = path.join(uploadsDir, category);
      await fs.mkdir(categoryDir, { recursive: true });

      const uploadedPaths: string[] = [];
      for (const file of files) {
        const safeName = path.basename(file.originalname);
        const filePath = path.join(categoryDir, safeName);
        // Reject writes to a pre-existing symlink (would escape uploads dir).
        if (await rejectIfSymlink(filePath)) {
          res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: `Refusing to overwrite symlink: ${safeName}` },
          });
          return;
        }
        await fs.writeFile(filePath, file.buffer);
        uploadedPaths.push(filePath);
      }

      logger.info(`[OrchestratorRoutes] Uploaded ${files.length} ${category} files for workflow ${definitionId}`);
      res.status(201).json({
        success: true,
        definitionId,
        category,
        files: uploadedPaths.map((p) => ({ path: p, name: path.basename(p) })),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /orchestrator/workflows/:id/files — List workflow-level files
  router.get('/workflows/:id/files', async (req, res, next) => {
    try {
      const definitionId = String(req.params['id']);
      const uploadsDir = await workflowOrchestrator.getWorkflowUploadsDir(definitionId);

      async function listFiles(dir: string): Promise<string[]> {
        try {
          const entries = await fs.readdir(dir, { recursive: true }) as unknown as string[];
          const files: string[] = [];
          for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = await fs.stat(fullPath);
            if (stat.isFile()) files.push(entry);
          }
          return files;
        } catch {
          return [];
        }
      }

      const uploadFiles = await listFiles(uploadsDir);
      res.json({ definitionId, uploadsDir, files: uploadFiles });
    } catch (err) {
      next(err);
    }
  });

  // GET /orchestrator/workflows/:id/files/download — Download a workflow file
  router.get('/workflows/:id/files/download', async (req, res, next) => {
    try {
      const definitionId = String(req.params['id']);
      const filePath = String(req.query['path'] ?? '');

      if (!filePath) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing path query parameter' } });
        return;
      }

      const baseDir = await workflowOrchestrator.getWorkflowUploadsDir(definitionId);
      const resolved = await resolveWithinBase(baseDir, filePath);
      if (!resolved) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Path traversal not allowed' } });
        return;
      }

      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not a file' } });
          return;
        }
        const filename = path.basename(resolved);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Type', 'application/octet-stream');
        const { createReadStream } = await import('node:fs');
        const stream = createReadStream(resolved);
        stream.pipe(res);
        stream.on('error', () => {
          if (!res.headersSent) {
            res.status(500).json({ error: { code: 'STREAM_ERROR', message: 'Failed to read file' } });
          }
        });
      } catch {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
      }
    } catch (err) {
      next(err);
    }
  });

  // DELETE /orchestrator/workflows/:id/files — Delete a workflow file
  router.delete('/workflows/:id/files', async (req, res, next) => {
    try {
      const definitionId = String(req.params['id']);
      const filePath = String(req.query['path'] ?? '');

      if (!filePath) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing path query parameter' } });
        return;
      }

      const baseDir = await workflowOrchestrator.getWorkflowUploadsDir(definitionId);
      const resolved = await resolveWithinBase(baseDir, filePath);
      if (!resolved) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Path traversal not allowed' } });
        return;
      }

      await fs.unlink(resolved);
      logger.info(`[OrchestratorRoutes] Deleted workflow file: ${filePath} from ${definitionId}`);
      res.json({ success: true, deleted: filePath });
    } catch (err) {
      next(err);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Upload Custom Content (Prompts, Skills, Agents) per-run
  // ═══════════════════════════════════════════════════════════

  // POST /orchestrator/runs/:id/uploads — Upload custom prompts/skills/agents for a run
  // Files are stored in the per-run uploads directory and made available
  // to the Copilot SDK via skillDirectories and customAgents.
  router.post('/runs/:id/uploads', upload.array('files', 20), async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const { category } = req.body as { category?: string };

      if (!category || !['skills', 'agents', 'prompts'].includes(category)) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'category must be one of: skills, agents, prompts' },
        });
        return;
      }

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'No files uploaded' },
        });
        return;
      }

      // Validate file extensions
      for (const file of files) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: `File type '${ext}' not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
            },
          });
          return;
        }
        // Prevent path traversal in filenames
        const safeName = path.basename(file.originalname);
        if (safeName !== file.originalname || safeName.includes('..')) {
          res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: `Invalid filename: ${file.originalname}` },
          });
          return;
        }
      }

      const uploadsDir = await workflowOrchestrator.getRunUploadsDir(runId);
      const categoryDir = path.join(uploadsDir, category);
      await fs.mkdir(categoryDir, { recursive: true });

      const uploadedPaths: string[] = [];
      for (const file of files) {
        const safeName = path.basename(file.originalname);
        const filePath = path.join(categoryDir, safeName);
        if (await rejectIfSymlink(filePath)) {
          res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: `Refusing to overwrite symlink: ${safeName}` },
          });
          return;
        }
        await fs.writeFile(filePath, file.buffer);
        uploadedPaths.push(filePath);
      }

      logger.info(`[OrchestratorRoutes] Uploaded ${files.length} ${category} files for run ${runId}`, {
        requestId: req.requestId,
      });

      res.status(201).json({
        success: true,
        runId,
        category,
        files: uploadedPaths.map((p) => ({
          path: p,
          name: path.basename(p),
        })),
        directory: categoryDir,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /orchestrator/runs/:id/workspace — Get workspace directory info for a run
  router.get('/runs/:id/workspace', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const dirs = await workflowOrchestrator.getRunWorkspaceDirs(runId);

      // Recursive file walker that skips .git internals *and* common
      // vendored / build folders. Used when a directory has no git repo.
      // (When a git repo is present, we prefer `git ls-files` further down
      // so `.gitignore` is honored.)
      async function walkFiles(dir: string): Promise<string[]> {
        try {
          const entries = await fs.readdir(dir, { recursive: true }) as unknown as string[];
          const files: string[] = [];
          for (const entry of entries) {
            const norm = entry.replace(/\\/g, '/');
            // Skip .git internals + hard-coded noise (safety net when no git).
            if (norm === '.git' || norm.startsWith('.git/')) continue;
            if (/(^|\/)(node_modules|dist|build|coverage|\.next|\.turbo|\.cache)(\/|$)/.test(norm)) continue;
            const fullPath = path.join(dir, entry);
            try {
              const stat = await fs.stat(fullPath);
              if (stat.isFile()) files.push(entry);
            } catch {
              /* ignore stat errors */
            }
          }
          return files;
        } catch {
          return [];
        }
      }

      // Prefer git-tracked listing (respects .gitignore automatically);
      // fall back to a filesystem walk when the directory has no git repo.
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
        return walkFiles(dir);
      }

      // Look up worktrees (linked codebases explicitly registered for this run)
      const worktrees = worktreeService
        ? await worktreeService.listWorktrees(undefined, runId)
        : [];

      const worktreeEntries: Array<{ alias: string; worktreePath: string; files: string[]; kind: 'linked' | 'generated' }> = [];
      const seenAliases = new Set<string>();
      for (const wt of worktrees) {
        const alias = path.basename(wt.worktreePath);
        seenAliases.add(alias);
        const files = await listFiles(wt.worktreePath);
        worktreeEntries.push({ alias, worktreePath: wt.worktreePath, files, kind: 'linked' });
      }

      // Also detect workspace subdirectories that are git repos but *not*
      // linked worktrees — these are codebases the agent generated during
      // the run (e.g. via `git init`). Show them alongside linked codebases
      // so users can see change sets for newly-generated code too.
      // Reserved names are managed by the runtime and never treated as
      // codebases (workflow metadata, uploads, caches, hidden dirs).
      const RESERVED_WS_DIRS = new Set([
        '.git', 'artifacts', 'uploads',
        'node_modules', 'dist', 'build', '.cache', '.next', '.turbo', 'coverage',
      ]);
      try {
        const wsEntries = await fs.readdir(dirs.workspaceDir, { withFileTypes: true });
        for (const e of wsEntries) {
          if (!e.isDirectory()) continue;
          if (seenAliases.has(e.name)) continue;
          if (RESERVED_WS_DIRS.has(e.name)) continue;
          if (e.name.startsWith('.')) continue;
          const subDir = path.join(dirs.workspaceDir, e.name);
          if (await gitManager.isGitRepo(subDir)) {
            const files = await listFiles(subDir);
            worktreeEntries.push({ alias: e.name, worktreePath: subDir, files, kind: 'generated' });
            seenAliases.add(e.name);
          }
        }
      } catch {
        /* workspace may not exist yet */
      }

      const [workspaceFiles, artifactFiles, uploadFiles] = await Promise.all([
        listFiles(dirs.workspaceDir),
        listFiles(dirs.artifactsDir),
        listFiles(dirs.uploadsDir),
      ]);

      res.json({
        runId,
        workspaceDir: dirs.workspaceDir,
        artifactsDir: dirs.artifactsDir,
        uploadsDir: dirs.uploadsDir,
        workspaceFiles,
        artifactFiles,
        uploadFiles,
        worktrees: worktreeEntries,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /orchestrator/runs/:id/workspace/download — Download a file from workspace/artifacts/uploads
  router.get('/runs/:id/workspace/download', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const filePath = String(req.query['path'] ?? '');
      const source = String(req.query['source'] ?? 'workspace'); // workspace | artifacts | uploads

      if (!filePath) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing path query parameter' } });
        return;
      }

      // Resolve base directory
      const dirs = await workflowOrchestrator.getRunWorkspaceDirs(runId);
      let baseDir: string;
      if (source === 'artifacts') {
        baseDir = dirs.artifactsDir;
      } else if (source === 'uploads') {
        baseDir = dirs.uploadsDir;
      } else if (source === 'worktree' && worktreeService) {
        const wtAlias = String(req.query['worktreeAlias'] ?? '');
        const worktrees = await worktreeService.listWorktrees(undefined, runId);
        const wt = worktrees.find(w => path.basename(w.worktreePath) === wtAlias);
        if (!wt) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: `Worktree '${wtAlias}' not found` } });
          return;
        }
        baseDir = wt.worktreePath;
      } else {
        baseDir = dirs.workspaceDir;
      }

      // Resolve and validate path to prevent directory traversal + symlink escape
      const resolved = await resolveWithinBase(baseDir, filePath);
      if (!resolved) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Path traversal not allowed' } });
        return;
      }

      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not a file' } });
          return;
        }

        const filename = path.basename(resolved);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Type', 'application/octet-stream');

        const { createReadStream } = await import('node:fs');
        const stream = createReadStream(resolved);
        stream.pipe(res);
        stream.on('error', () => {
          if (!res.headersSent) {
            res.status(500).json({ error: { code: 'STREAM_ERROR', message: 'Failed to read file' } });
          }
        });
      } catch {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
      }
    } catch (err) {
      next(err);
    }
  });

  // GET /orchestrator/runs/:id/workspace/content — Read file content as text
  router.get('/runs/:id/workspace/content', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const filePath = String(req.query['path'] ?? '');
      const source = String(req.query['source'] ?? 'workspace');

      if (!filePath) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing path query parameter' } });
        return;
      }

      const contentDirs = await workflowOrchestrator.getRunWorkspaceDirs(runId);
      let baseDir: string;
      if (source === 'artifacts') {
        baseDir = contentDirs.artifactsDir;
      } else if (source === 'uploads') {
        baseDir = contentDirs.uploadsDir;
      } else if (source === 'worktree' && worktreeService) {
        const wtAlias = String(req.query['worktreeAlias'] ?? '');
        const worktrees = await worktreeService.listWorktrees(undefined, runId);
        const wt = worktrees.find(w => path.basename(w.worktreePath) === wtAlias);
        if (!wt) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: `Worktree '${wtAlias}' not found` } });
          return;
        }
        baseDir = wt.worktreePath;
      } else {
        baseDir = contentDirs.workspaceDir;
      }

      const resolved = await resolveWithinBase(baseDir, filePath);
      if (!resolved) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Path traversal not allowed' } });
        return;
      }

      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not a file' } });
          return;
        }
        // Limit to 1MB for content viewing
        if (stat.size > 1_048_576) {
          res.json({ path: filePath, content: null, truncated: true, size: stat.size });
          return;
        }
        const content = await fs.readFile(resolved, 'utf-8');
        res.json({ path: filePath, content, truncated: false, size: stat.size });
      } catch {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
      }
    } catch (err) {
      next(err);
    }
  });

  // GET /orchestrator/runs/:id/workspace/diff — Get git diff for workspace repos
  // Delegates to the centralized ChangeSetService (@generatorai/changes) so
  // chat / workflow / automation all compute change sets identically.
  router.get('/runs/:id/workspace/diff', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const diffDirs = await workflowOrchestrator.getRunWorkspaceDirs(runId);
      const autoInit = String(req.query['autoInit'] ?? 'true') !== 'false';

      const worktrees = worktreeService
        ? (await worktreeService.listWorktrees(undefined, runId)).map((wt) => ({
            alias: path.basename(wt.worktreePath),
            worktreePath: wt.worktreePath,
          }))
        : [];

      const changeSet = await changeSetService.getChangeSet({
        rootPath: diffDirs.workspaceDir,
        worktrees,
        autoInit,
      });

      // Preserve the existing wire shape: { hasGit, repos: [{ alias, files }] }.
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
