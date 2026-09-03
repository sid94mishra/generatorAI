// ────────────────────────────────────────────────────────────────
// Project Routes — CRUD for Projects, Codebases, Configs, Worktrees
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import multer from 'multer';
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
    logger,
  } = container;

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

  // GET /projects/:id/mcp-servers — List project MCP server configs
  router.get('/:id/mcp-servers', async (req, res, next) => {
    try {
      const configs = await projectConfigService.listConfigs(String(req.params['id']), 'mcp');
      // Parse JSON content to return structured McpServerEntry objects
      const entries = await Promise.all(
        configs.map(async (cfg) => {
          try {
            const content = await projectConfigService.getConfigContent(cfg.id);
            const parsed = JSON.parse(content) as Record<string, unknown>;
            return {
              id: cfg.id,
              name: cfg.name,
              description: cfg.description,
              serverType: parsed['serverType'] ?? parsed['type'] ?? 'http',
              url: parsed['url'],
              command: parsed['command'],
              args: parsed['args'],
              source: 'project',
              enabled: parsed['enabled'] !== false,
            };
          } catch {
            return { id: cfg.id, name: cfg.name, source: 'project', serverType: 'http', enabled: true };
          }
        }),
      );
      res.json(entries);
    } catch (err) {
      next(err);
    }
  });

  // POST /projects/:id/mcp-servers — Create a project MCP server config
  router.post('/:id/mcp-servers', async (req, res, next) => {
    try {
      const { name, description, serverType, url, command, args } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
        return;
      }
      if (serverType === 'http' && !url) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'url required for http type' } });
        return;
      }
      if (serverType === 'stdio' && !command) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'command required for stdio type' } });
        return;
      }
      const content = JSON.stringify({ serverType, url, command, args: args ?? [], enabled: true });
      const cfg = await projectConfigService.createJsonConfig(
        String(req.params['id']),
        { type: 'mcp', name, description, filePath: `${name.replace(/[^a-z0-9-_]/gi, '_')}.json` },
        content,
      );
      res.status(201).json({ id: cfg.id, name: cfg.name, description, serverType, url, command, args, source: 'project', enabled: true });
    } catch (err) {
      next(err);
    }
  });

  // PUT /projects/:id/mcp-servers/:mid — Update MCP server config
  router.put('/:id/mcp-servers/:mid', async (req, res, next) => {
    try {
      const { name, description, serverType, url, command, args, enabled } = req.body;
      const content = JSON.stringify({ serverType, url, command, args: args ?? [], enabled: enabled !== false });
      await projectConfigService.updateConfigContent(String(req.params['mid']), content);
      if (name !== undefined || description !== undefined) {
        await projectConfigService.patchConfigMeta(String(req.params['mid']), { name, description });
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // DELETE /projects/:id/mcp-servers/:mid — Delete MCP server config
  router.delete('/:id/mcp-servers/:mid', async (req, res, next) => {
    try {
      await projectConfigService.deleteConfig(String(req.params['mid']));
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

  return router;
}
