// ────────────────────────────────────────────────────────────────
// Project Routes — CRUD for Projects, Codebases, Configs, Worktrees
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Response } from 'express';
import multer from 'multer';
import { McpServerBodySchema, mcpCredentialNamespace } from '@generatorai/shared';
import {
  McpCredentialVault,
  buildPullRequestReviewPrompt,
  parseRepoSlug,
  redactTokens,
  toMcpServerEntry,
} from '@generatorai/core';
import type {
  CatalogMcpServer,
  ISourceControlProvider,
  PullRequestRef,
} from '@generatorai/core';
import type { ProjectCodebase, ProjectPullRequest, ScmPullRequestState } from '@generatorai/shared';
import type { Container } from '../composition-root.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

export function createProjectRoutes(container: Container): Router {
  const router = Router();
  const {
    projectService,
    codebaseService,
    worktreeService,
    worktreeCleanupService,
    projectConfigService,
    systemArtifactService,
    artifactCatalog,
    security,
    sourceControlRegistry,
    repoReadinessService,
    chatManagementService,
    gitManager,
    logger,
  } = container;

  const mcpVault = new McpCredentialVault(security.secretStore);

  // ════════════════════════════════════════════════════════════════
  // Project CRUD
  // ════════════════════════════════════════════════════════════════

  // POST /projects — Create project
  router.post('/', async (req, res, next) => {
    try {
      const { name, description, settings } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Project name is required' } });
        return;
      }
      const project = await projectService.createProject({ name: name.trim(), description, settings });
      logger.info(`[ProjectRoutes] Created project ${project.id}`);
      res.status(201).json(project);
    } catch (err) {
      next(err);
    }
  });

  // GET /projects — List projects
  router.get('/', async (req, res, next) => {
    try {
      const status = req.query['status'] as string | undefined;
      const filter = status ? { status: status as 'active' | 'archived' } : undefined;
      const projects = await projectService.listProjects(filter);
      res.json(projects);
    } catch (err) {
      next(err);
    }
  });

  // GET /projects/:id — Get project details
  router.get('/:id', async (req, res, next) => {
    try {
      const project = await projectService.getProjectWithCodebases(String(req.params['id']));
      res.json(project);
    } catch (err) {
      next(err);
    }
  });

  // PUT /projects/:id — Update project
  router.put('/:id', async (req, res, next) => {
    try {
      const { name, description, settings, status } = req.body;
      const updated = await projectService.updateProject(String(req.params['id']), {
        name, description, settings, status,
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /projects/:id — Delete (archive) project
  router.delete('/:id', async (req, res, next) => {
    try {
      const projectId = String(req.params['id']);
      const force = req.query['force'] === 'true';
      if (force) {
        await projectService.deleteProject(projectId);
      } else {
        await projectService.archiveProject(projectId);
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Codebase Management
  // ════════════════════════════════════════════════════════════════

  // POST /projects/:id/codebases — Link codebase
  router.post('/:id/codebases', async (req, res, next) => {
    try {
      const projectId = String(req.params['id']);
      const { alias, type, url, localPath, defaultBranch, subdirectory, settings } = req.body;

      if (!alias || !type) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'alias and type are required' },
        });
        return;
      }

      if (type === 'git-remote' && !url) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'url is required for git-remote type' },
        });
        return;
      }

      if ((type === 'git-local' || type === 'local-dir') && !localPath) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'localPath is required for local types' },
        });
        return;
      }

      const codebase = await codebaseService.linkCodebase(projectId, {
        alias, type, url, localPath, defaultBranch, subdirectory, settings,
      });
      res.status(201).json(codebase);
    } catch (err) {
      next(err);
    }
  });

  // GET /projects/:id/codebases — List codebases
  router.get('/:id/codebases', async (req, res, next) => {
    try {
      const codebases = await codebaseService.getByProjectId(String(req.params['id']));
      res.json(codebases);
    } catch (err) {
      next(err);
    }
  });

  // PUT /projects/:id/codebases/:cid — Update codebase config
  router.put('/:id/codebases/:cid', async (req, res, next) => {
    try {
      // `url` / `localPath` are accepted so a codebase linked with a wrong
      // location can be corrected in place — before this the only way out of
      // `status: 'error'` was to delete and re-add it.
      const { alias, defaultBranch, subdirectory, settings, url, localPath } = req.body;
      const updated = await codebaseService.updateCodebase(String(req.params['cid']), {
        alias, defaultBranch, subdirectory, settings, url, localPath,
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /projects/:id/codebases/:cid — Unlink codebase and delete worktrees
  router.delete('/:id/codebases/:cid', async (req, res, next) => {
    try {
      const codebaseId = String(req.params['cid']);

      // First delete all worktrees associated with this codebase
      try {
        const worktrees = await worktreeService.listWorktreesByCodebase(codebaseId);
        for (const wt of worktrees) {
          try {
            await worktreeService.removeWorktree(wt.id);
            logger.info(`[ProjectRoutes] Removed worktree ${wt.id} during codebase deletion`);
          } catch (wtErr) {
            logger.warn(`[ProjectRoutes] Failed to remove worktree ${wt.id}: ${wtErr}`);
          }
        }
      } catch (listErr) {
        logger.warn(`[ProjectRoutes] Failed to list worktrees for codebase ${codebaseId}: ${listErr}`);
      }

      await codebaseService.unlinkCodebase(codebaseId);

      // API-3: Verify deletion with an explicit not-found check rather than
      // treating *any* thrown error as success. `getCodebaseStatus` resolves
      // when the row still exists (→ deletion failed) and throws a not-found
      // StorageError when it's gone (→ success). Any OTHER error (DB failure,
      // etc.) must NOT be silently read as a successful delete — surface it.
      let stillExists = false;
      try {
        await codebaseService.getCodebaseStatus(codebaseId);
        stillExists = true; // row still present → delete did not take effect
      } catch (verifyErr) {
        const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
        if (!/not found/i.test(msg)) {
          // Unexpected error — don't pretend the delete succeeded.
          throw verifyErr;
        }
        // not-found → expected, deletion confirmed.
      }
      if (stillExists) {
        res.status(500).json({
          error: { code: 'DELETE_FAILED', message: 'Codebase record was not deleted' },
        });
        return;
      }

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // POST /projects/:id/codebases/:cid/fetch — Trigger git fetch
  router.post('/:id/codebases/:cid/fetch', async (req, res, next) => {
    try {
      const codebaseId = String(req.params['cid']);
      await codebaseService.fetchCodebase(codebaseId);
      const status = await codebaseService.getCodebaseStatus(codebaseId);
      res.json({
        success: true,
        status: status.status,
        lastFetchedAt: status.lastFetchedAt,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`[ProjectRoutes] Fetch failed for codebase ${req.params['cid']}: ${errMsg}`);
      res.status(500).json({
        error: {
          code: 'FETCH_FAILED',
          message: errMsg,
          details: 'Check if the repository is accessible and there are no authentication issues or conflicts.',
        },
      });
    }
  });

  // GET /projects/:id/codebases/:cid/branches — List branches
  router.get('/:id/codebases/:cid/branches', async (req, res, next) => {
    try {
      const branches = await codebaseService.listBranches(String(req.params['cid']));
      res.json(branches);
    } catch (err) {
      next(err);
    }
  });

  // GET /projects/:id/codebases/:cid/status — Get codebase status
  router.get('/:id/codebases/:cid/status', async (req, res, next) => {
    try {
      const status = await codebaseService.getCodebaseStatus(String(req.params['cid']));
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Config Management (Agents, Prompts, Skills)
  // ════════════════════════════════════════════════════════════════

  // POST /projects/:id/configs — Upload agent/prompt/skill
  router.post('/:id/configs', upload.single('file'), async (req, res, next) => {
    try {
      const projectId = String(req.params['id']);
      const { type, description } = req.body;
      // Derive name and filePath from uploaded file if not explicitly provided
      const fileName = req.file?.originalname ?? req.body.filePath ?? req.body.name;
      const name = req.body.name ?? (fileName ? fileName.replace(/\.[^.]+$/, '') : undefined);
      const filePath = req.body.filePath ?? fileName;

      if (!type || !name || !filePath) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'type, name, and filePath are required (or upload a file)' },
        });
        return;
      }

      if (!['agent', 'prompt', 'skill'].includes(type)) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'type must be agent, prompt, or skill' },
        });
        return;
      }

      const content = req.file?.buffer ?? Buffer.from(req.body.content ?? '', 'utf-8');
      const config = await projectConfigService.uploadConfig(
        projectId,
        { type, name, description, filePath },
        content,
      );
      res.status(201).json(config);
    } catch (err) {
      next(err);
    }
  });

  // GET /projects/:id/configs — List project configs
  router.get('/:id/configs', async (req, res, next) => {
    try {
      const type = req.query['type'] as string | undefined;
      const validTypes = ['agent', 'prompt', 'skill'];
      const configType = type && validTypes.includes(type) ? type as 'agent' | 'prompt' | 'skill' : undefined;
      const configs = await projectConfigService.listConfigs(String(req.params['id']), configType);
      res.json(configs);
    } catch (err) {
      next(err);
    }
  });

  // GET /projects/:id/configs/:cid — Get config content
  router.get('/:id/configs/:cid', async (req, res, next) => {
    try {
      const content = await projectConfigService.getConfigContent(String(req.params['cid']));
      res.json({ content });
    } catch (err) {
      next(err);
    }
  });

  // PUT /projects/:id/configs/:cid — Update config content
  router.put('/:id/configs/:cid', async (req, res, next) => {
    try {
      const { content } = req.body;
      if (typeof content !== 'string') {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'content is required' } });
        return;
      }
      await projectConfigService.updateConfigContent(String(req.params['cid']), content);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // DELETE /projects/:id/configs/:cid — Delete config
  router.delete('/:id/configs/:cid', async (req, res, next) => {
    try {
      await projectConfigService.deleteConfig(String(req.params['cid']));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // MCP Server Configs (project-level)
  // ════════════════════════════════════════════════════════════════

  // GET /projects/:id/mcp-servers — List project MCP server configs.
  // Routed through ArtifactCatalog + toMcpServerEntry so a project server
  // gets the same needsConfiguration gating and credential REDACTION as
  // every other registry — a GET here must never be able to return a value,
  // only the redaction marker + which credential names are stored.
  router.get('/:id/mcp-servers', async (req, res, next) => {
    try {
      const servers = await artifactCatalog.listMcpServers(String(req.params['id']));
      const entries = servers.filter((s) => s.source === 'project').map(toMcpServerEntry);
      res.json(entries);
    } catch (err) {
      next(err);
    }
  });

  // POST /projects/:id/mcp-servers — Create a project MCP server config.
  // `headers` (http/sse) / `env` (stdio) credential VALUES are written to the
  // secrets vault under mcp/project/<id>; only their NAMES land on the row
  // (`credential_refs`, migration 48) and in the JSON file on disk.
  router.post('/:id/mcp-servers', async (req, res, next) => {
    try {
      const parsed = McpServerBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid MCP server' } });
        return;
      }
      const { name, description, serverType, url, command, args, timeoutMs, headers, env } = parsed.data;
      const projectId = String(req.params['id']);
      const content = JSON.stringify({
        serverType,
        ...(url ? { url } : {}),
        ...(command ? { command } : {}),
        args: args ?? [],
        ...(timeoutMs ? { timeoutMs } : {}),
        enabled: true,
      });
      const cfg = await projectConfigService.createJsonConfig(
        projectId,
        { type: 'mcp', name, description, filePath: `${name.replace(/[^a-z0-9-_]/gi, '_')}.json` },
        content,
      );
      if ((headers && Object.keys(headers).length) || (env && Object.keys(env).length)) {
        const refs = await mcpVault.save(mcpCredentialNamespace('project', cfg.id), { headers, env });
        await projectConfigService.setCredentialRefs(cfg.id, refs);
      }
      const servers = await artifactCatalog.listMcpServers(projectId);
      const created = servers.find((s) => s.id === cfg.id) as CatalogMcpServer | undefined;
      res.status(201).json(created ? toMcpServerEntry(created) : { id: cfg.id, name, source: 'project' });
    } catch (err) {
      next(err);
    }
  });

  // PUT /projects/:id/mcp-servers/:mid — Replace a project MCP server config.
  // Same shared schema as POST, so a token submitted here is vaulted the same
  // way; `McpCredentialVault.save` treats the body as the FULL desired
  // credential set (a stored key omitted from the body is deleted, and the
  // redaction marker echoed back for an untouched field keeps its value).
  router.put('/:id/mcp-servers/:mid', async (req, res, next) => {
    try {
      const parsed = McpServerBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid MCP server' } });
        return;
      }
      const { name, description, serverType, url, command, args, timeoutMs, enabled, headers, env } = parsed.data;
      const mid = String(req.params['mid']);
      const content = JSON.stringify({
        serverType,
        ...(url ? { url } : {}),
        ...(command ? { command } : {}),
        args: args ?? [],
        ...(timeoutMs ? { timeoutMs } : {}),
        enabled: enabled !== false,
      });
      await projectConfigService.updateConfigContent(mid, content);
      await projectConfigService.patchConfigMeta(mid, { name, description });

      const existing = await projectConfigService.getConfig(mid);
      const refs = await mcpVault.save(mcpCredentialNamespace('project', mid), { headers, env }, existing.credentialRefs ?? {});
      await projectConfigService.setCredentialRefs(mid, refs);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // DELETE /projects/:id/mcp-servers/:mid — Delete MCP server config + its vaulted credentials.
  router.delete('/:id/mcp-servers/:mid', async (req, res, next) => {
    try {
      const mid = String(req.params['mid']);
      await mcpVault.remove(mcpCredentialNamespace('project', mid));
      await projectConfigService.deleteConfig(mid);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Available Artifacts (system + project merged)
  // ════════════════════════════════════════════════════════════════

  // GET /projects/:id/available-artifacts — Merged system + project artifacts
  router.get('/:id/available-artifacts', async (req, res, next) => {
    try {
      const projectId = String(req.params['id']);
      const type = req.query['type'] as string | undefined;
      const validTypes = ['agent', 'prompt', 'skill'];
      const configType = type && validTypes.includes(type) ? type as 'agent' | 'prompt' | 'skill' : undefined;
      const projectConfigs = await projectConfigService.listConfigs(projectId, configType);
      const merged = await systemArtifactService.getAvailableArtifacts(projectConfigs, configType);
      res.json(merged);
    } catch (err) {
      next(err);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Codebase-level Worktree Management
  // ════════════════════════════════════════════════════════════════

  // GET /projects/:id/codebases/:cid/worktrees — List worktrees for codebase
  router.get('/:id/codebases/:cid/worktrees', async (req, res, next) => {
    try {
      const worktrees = await worktreeService.listWorktreesByCodebase(String(req.params['cid']));
      res.json(worktrees);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /projects/:id/codebases/:cid/worktrees/:wid — Remove worktree
  router.delete('/:id/codebases/:cid/worktrees/:wid', async (req, res, next) => {
    try {
      await worktreeService.removeWorktree(String(req.params['wid']));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // POST /projects/:id/codebases/:cid/worktrees/cleanup — Cleanup orphaned worktrees
  router.post('/:id/codebases/:cid/worktrees/cleanup', async (req, res, next) => {
    try {
      // Scope cleanup to THIS project only. runCleanupForProject performs both
      // stale-record deletion and smart (owner-terminal) orphan detection.
      // Previously this also called the global runCleanup(), which swept EVERY
      // project from a project-scoped endpoint.
      const result = await worktreeCleanupService.runCleanupForProject(String(req.params['id']));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Codebase File Browser
  // ════════════════════════════════════════════════════════════════

  // GET /projects/:id/codebases/:cid/files — List files with .gitignore filtering
  router.get('/:id/codebases/:cid/files', async (req, res, next) => {
    try {
      const codebaseId = String(req.params['cid']);
      const subPath = (req.query['path'] as string) || '';
      const files = await codebaseService.listCodebaseFiles(codebaseId, subPath);
      res.json(files);
    } catch (err) {
      next(err);
    }
  });

  // GET /projects/:id/codebases/:cid/files/content — Read file content
  router.get('/:id/codebases/:cid/files/content', async (req, res, next) => {
    try {
      const codebaseId = String(req.params['cid']);
      const filePath = req.query['path'] as string;
      if (!filePath) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'path query param is required' } });
        return;
      }
      const content = await codebaseService.getCodebaseFileContent(codebaseId, filePath);
      res.json({ content });
    } catch (err) {
      next(err);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Worktree Management (project-level — legacy, kept for compat)
  // ════════════════════════════════════════════════════════════════

  // GET /projects/:id/worktrees — List active worktrees
  router.get('/:id/worktrees', async (req, res, next) => {
    try {
      const worktrees = await worktreeService.listWorktrees(String(req.params['id']));
      res.json(worktrees);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /projects/:id/worktrees/:wid — Remove specific worktree
  router.delete('/:id/worktrees/:wid', async (req, res, next) => {
    try {
      await worktreeService.removeWorktree(String(req.params['wid']));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // POST /projects/:id/worktrees/cleanup — Trigger orphan cleanup
  router.post('/:id/worktrees/cleanup', async (req, res, next) => {
    try {
      // Scope cleanup to THIS project only. runCleanupForProject performs both
      // stale-record deletion and smart (owner-terminal) orphan detection.
      // Previously this also called the global runCleanup(), which swept EVERY
      // project from a project-scoped endpoint.
      const result = await worktreeCleanupService.runCleanupForProject(String(req.params['id']));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // Pull requests under a project (doc §6) + codebase readiness (doc §3)
  // ════════════════════════════════════════════════════════════════

  /** Where a codebase's git repository actually lives on this host. */
  function codebaseRepoDir(codebase: ProjectCodebase): string | null {
    return codebase.clonePath || codebase.localPath || null;
  }

  /**
   * Resolve `{ slug, provider }` for a codebase, or the user-facing reason
   * why there is none. Every failure mode here is something the user can act
   * on (link a remote, connect an account), so it is phrased for them and
   * never swallowed into a generic 500.
   */
  async function resolveCodebaseRemote(
    codebase: ProjectCodebase,
  ): Promise<
    | { ok: true; repoDir: string; slug: { owner: string; repo: string; host: string }; provider: ISourceControlProvider }
    | { ok: false; reason: string; host?: string }
  > {
    const repoDir = codebaseRepoDir(codebase);
    if (!repoDir) return { ok: false, reason: 'This codebase has no local checkout yet' };

    let remoteUrl: string | null = null;
    try {
      remoteUrl = await gitManager.getRemoteUrl(repoDir);
    } catch (err) {
      return { ok: false, reason: redactTokens(err instanceof Error ? err.message : String(err)) };
    }
    if (!remoteUrl) return { ok: false, reason: 'No git remote configured' };

    const slug = parseRepoSlug(remoteUrl);
    if (!slug) return { ok: false, reason: 'The git remote is not a recognisable repository URL' };

    const provider = sourceControlRegistry.providerFor(slug.host);
    if (!provider) {
      return {
        ok: false,
        host: slug.host,
        reason: `Remote host ${slug.host} is not connected — connect it in Settings → Source Control`,
      };
    }
    return { ok: true, repoDir, slug, provider };
  }

  /**
   * Resolve the codebase + provider for a single-PR route, or send the right
   * error. `409 SCM_NOT_CONNECTED` specifically, rather than a 404, because
   * the PR exists — the server just has no credentials to read it with.
   */
  async function loadPullRequestTarget(
    codebaseId: string,
    numberRaw: string,
    res: Response,
  ): Promise<
    | { codebase: ProjectCodebase; repoDir: string; provider: ISourceControlProvider; ref: PullRequestRef }
    | null
  > {
    const number = Number(numberRaw);
    if (!Number.isInteger(number) || number <= 0) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Pull request number must be a positive integer' },
      });
      return null;
    }
    const codebase = await codebaseService.getCodebaseStatus(codebaseId);
    const resolved = await resolveCodebaseRemote(codebase);
    if (!resolved.ok) {
      if (resolved.host) {
        res.status(409).json({ error: { code: 'SCM_NOT_CONNECTED', message: resolved.reason } });
      } else {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: resolved.reason } });
      }
      return null;
    }
    return {
      codebase,
      repoDir: resolved.repoDir,
      provider: resolved.provider,
      ref: {
        owner: resolved.slug.owner,
        repo: resolved.slug.repo,
        number,
        host: resolved.slug.host,
      },
    };
  }

  // GET /projects/:id/pull-requests — every codebase's PRs in one list.
  //
  // One unreachable codebase must never blank the page, so each is resolved
  // independently and its failure becomes an `unavailable` row carrying the
  // reason; the codebases are walked concurrently because each is a network
  // round trip to the host.
  router.get('/:id/pull-requests', async (req, res, next) => {
    try {
      const stateRaw = req.query['state'];
      const state: ScmPullRequestState | 'all' =
        stateRaw === 'closed' || stateRaw === 'all' ? stateRaw : 'open';

      const codebases = await codebaseService.getByProjectId(String(req.params['id']));
      const items: ProjectPullRequest[] = [];
      const unavailable: Array<{ codebaseId: string; alias: string; reason: string }> = [];

      await Promise.all(
        codebases.map(async (codebase) => {
          const resolved = await resolveCodebaseRemote(codebase);
          if (!resolved.ok) {
            unavailable.push({ codebaseId: codebase.id, alias: codebase.alias, reason: resolved.reason });
            return;
          }
          try {
            const prs = await resolved.provider.listPullRequests({
              owner: resolved.slug.owner,
              repo: resolved.slug.repo,
              state,
              host: resolved.slug.host,
            });
            for (const pr of prs) {
              items.push({ ...pr, codebaseId: codebase.id, codebaseAlias: codebase.alias });
            }
          } catch (err) {
            unavailable.push({
              codebaseId: codebase.id,
              alias: codebase.alias,
              reason: redactTokens(err instanceof Error ? err.message : String(err)),
            });
          }
        }),
      );

      res.json({ items, unavailable });
    } catch (err) {
      next(err);
    }
  });

  // GET /projects/:id/codebases/:cid/pull-requests/:number — PR detail.
  // Checks are composed in here (the provider port keeps them separate) and
  // dropped silently when the host cannot answer — a PR is still readable
  // without its CI state.
  router.get('/:id/codebases/:cid/pull-requests/:number', async (req, res, next) => {
    try {
      const target = await loadPullRequestTarget(
        String(req.params['cid']),
        String(req.params['number']),
        res,
      );
      if (!target) return;

      const detail = await target.provider.getPullRequestDetail(target.ref);
      try {
        const checks = await target.provider.getStatusChecks(target.ref);
        res.json({ ...detail, checks });
      } catch (err) {
        logger.debug(
          `[ProjectRoutes] Could not read checks for PR #${target.ref.number}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        res.json(detail);
      }
    } catch (err) {
      next(err);
    }
  });

  // GET …/pull-requests/:number/files — changed files with unified diffs.
  router.get('/:id/codebases/:cid/pull-requests/:number/files', async (req, res, next) => {
    try {
      const target = await loadPullRequestTarget(
        String(req.params['cid']),
        String(req.params['number']),
        res,
      );
      if (!target) return;
      res.json(await target.provider.listPullRequestFiles(target.ref));
    } catch (err) {
      next(err);
    }
  });

  // GET …/pull-requests/:number/comments — review + issue comments.
  router.get('/:id/codebases/:cid/pull-requests/:number/comments', async (req, res, next) => {
    try {
      const target = await loadPullRequestTarget(
        String(req.params['cid']),
        String(req.params['number']),
        res,
      );
      if (!target) return;
      res.json(await target.provider.listPullRequestComments(target.ref));
    } catch (err) {
      next(err);
    }
  });

  // POST …/pull-requests/:number/review-chat — "Review in chat" (doc §6).
  //
  // The chat's workspace is the codebase in worktree mode on the PR's head
  // branch, so the agent reads the surrounding repository rather than judging
  // a diff in isolation.
  router.post('/:id/codebases/:cid/pull-requests/:number/review-chat', async (req, res, next) => {
    try {
      const projectId = String(req.params['id']);
      const codebaseId = String(req.params['cid']);
      const target = await loadPullRequestTarget(codebaseId, String(req.params['number']), res);
      if (!target) return;

      const instructions = typeof req.body?.instructions === 'string' ? req.body.instructions : undefined;
      const model = typeof req.body?.model === 'string' ? req.body.model : undefined;
      const agentRef = typeof req.body?.agentRef === 'string' ? req.body.agentRef : undefined;

      const [detail, files] = await Promise.all([
        target.provider.getPullRequestDetail(target.ref),
        target.provider.listPullRequestFiles(target.ref),
      ]);

      // Fetch the head first so the worktree can be cut from it. A failure
      // here is not fatal: the branch may already be local, and worktree
      // creation reports its own, better error if it is not.
      try {
        await gitManager.fetch(target.repoDir, 'origin', detail.head);
      } catch (err) {
        logger.warn(
          `[ProjectRoutes] Could not fetch ${detail.head} for PR #${detail.number}: ${
            err instanceof Error ? redactTokens(err.message) : String(err)
          }`,
        );
      }

      const prompt = buildPullRequestReviewPrompt({
        pr: detail,
        files,
        ...(instructions ? { instructions } : {}),
      });

      const chat = await chatManagementService.createChat({
        name: `Review PR #${detail.number}: ${detail.title}`,
        projectId,
        sources: [
          {
            kind: 'codebase',
            codebaseId,
            mode: 'worktree',
            // A dedicated review branch cut from the fetched head, rather
            // than the head branch itself: the PR branch may not exist
            // locally (fresh clone), or may already be checked out in the
            // user's own worktree, where `git worktree add` refuses it. The
            // review never pushes, so the name is local-only (doc §6).
            newBranch: `generatorai/review-pr-${detail.number}-${Math.random().toString(16).slice(2, 8)}`,
            baseRef: `origin/${detail.head}`,
          },
        ],
        ...(model ? { model } : {}),
        ...(agentRef ? { agentRef } : {}),
      });

      // The chat is the deliverable. If seeding the review turn fails the
      // user still has a workspace on the PR branch and can retry from the
      // composer — losing the chat to report that would be strictly worse.
      try {
        await chatManagementService.sendPrompt(chat.id, prompt);
      } catch (err) {
        logger.error(
          `[ProjectRoutes] Review chat ${chat.id} was created but the prompt could not be sent: ${
            err instanceof Error ? redactTokens(err.message) : String(err)
          }`,
        );
      }

      res.status(201).json({ chat });
    } catch (err) {
      next(err);
    }
  });

  // GET /projects/:id/codebases/:cid/readiness — the doc §3 shape for a
  // codebase checkout (the workspace route answers the same for a mount).
  router.get('/:id/codebases/:cid/readiness', async (req, res, next) => {
    try {
      const codebase = await codebaseService.getCodebaseStatus(String(req.params['cid']));
      const repoDir = codebaseRepoDir(codebase);
      if (!repoDir) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'This codebase has no local checkout yet' },
        });
        return;
      }
      res.json(await repoReadinessService.readiness({ repoDir, alias: codebase.alias }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
