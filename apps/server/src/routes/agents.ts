// ────────────────────────────────────────────────────────────────
// Agent Routes — CRUD, import/export, usage and capability preview for the
// first-class Agent entity.
//
// Scopes (see packages/auth/src/routePolicy.ts): reading the catalog needs
// `read:workflows`; authoring an agent grants capability (skills, MCP servers,
// tool policy) and therefore needs `admin:settings`. BINDING an existing agent
// to a chat is a run-time act and goes through PATCH /chats/:id instead, so a
// paired device can choose an agent without being able to author one.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';
import { validate } from '../middleware/validate.js';
import {
  CreateAgentSchema,
  UpdateAgentSchema,
  ImportAgentSchema,
  ResolvePreviewSchema,
  NotFoundError,
  ValidationError,
} from '@generatorai/shared';
import { redactProjection } from '@generatorai/core';

export function createAgentApiRoutes(container: Container): Router {
  const router = Router();
  const { agentService, agentResolver, logger } = container;

  const requireService = () => {
    if (!agentService) {
      throw new ValidationError('Agents are not enabled on this server');
    }
    return agentService;
  };

  // GET /agents — list, optionally filtered
  router.get('/', async (req, res, next) => {
    try {
      const svc = requireService();
      const scope = req.query['scope'] as string | undefined;
      const role = req.query['role'] as string | undefined;
      const projectId = req.query['projectId'] as string | undefined;
      const q = req.query['q'] as string | undefined;

      // `selectable=1` returns the shadow-resolved picker list rather than the
      // raw rows, so a project agent hides the global one with the same slug.
      if (req.query['selectable'] === '1') {
        res.json(await svc.listSelectable(projectId));
        return;
      }

      res.json(
        await svc.list({
          ...(scope === 'system' || scope === 'global' || scope === 'project' ? { scope } : {}),
          ...(role === 'agent' || role === 'orchestrator' ? { role } : {}),
          ...(projectId !== undefined ? { projectId } : {}),
          ...(q ? { query: q } : {}),
          ...(req.query['enabledOnly'] === '1' ? { enabledOnly: true } : {}),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  // POST /agents — create
  router.post('/', validate(CreateAgentSchema), async (req, res, next) => {
    try {
      const svc = requireService();
      const { agent, warnings } = await svc.create(req.body);
      logger.info(`[AgentRoutes] Created agent ${agent.ref}`, { requestId: req.requestId });
      res.status(201).json({ ...agent, warnings });
    } catch (err) {
      next(err);
    }
  });

  // GET /agents/:id
  router.get('/:id', async (req, res, next) => {
    try {
      res.json(await requireService().get(String(req.params['id'])));
    } catch (err) {
      next(err);
    }
  });

  // PUT /agents/:id — update (bumps version)
  router.put('/:id', validate(UpdateAgentSchema), async (req, res, next) => {
    try {
      const svc = requireService();
      const { agent, warnings } = await svc.update(String(req.params['id']), req.body);
      logger.info(`[AgentRoutes] Updated agent ${agent.ref} → v${agent.version}`, {
        requestId: req.requestId,
      });
      res.json({ ...agent, warnings });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /agents/:id — 409 when bound unless ?force=1 (soft-delete)
  router.delete('/:id', async (req, res, next) => {
    try {
      const result = await requireService().delete(
        String(req.params['id']),
        req.query['force'] === '1',
      );
      res.json({ deleted: true, soft: result.soft });
    } catch (err) {
      next(err);
    }
  });

  // GET /agents/:id/usage — where this agent is bound
  router.get('/:id/usage', async (req, res, next) => {
    try {
      const svc = requireService();
      const agent = await svc.get(String(req.params['id']));
      res.json(await svc.usage(agent.ref));
    } catch (err) {
      next(err);
    }
  });

  // POST /agents/:id/export — `.agent.md`, credential-free
  router.post('/:id/export', async (req, res, next) => {
    try {
      const markdown = await requireService().exportToMarkdown(String(req.params['id']));
      res.json({ markdown });
    } catch (err) {
      next(err);
    }
  });

  // POST /agents/import — parse a `.agent.md` document
  router.post('/import', validate(ImportAgentSchema), async (req, res, next) => {
    try {
      const svc = requireService();
      const { agent, warnings } = await svc.importFromMarkdown(req.body.markdown, {
        scope: req.body.scope,
        ...(req.body.projectId ? { projectId: req.body.projectId } : {}),
        overwrite: req.body.overwrite,
      });
      logger.info(`[AgentRoutes] Imported agent ${agent.ref}`, { requestId: req.requestId });
      res.status(201).json({ ...agent, warnings });
    } catch (err) {
      next(err);
    }
  });

  // POST /agents/resolve-preview — effective capabilities for the editor
  router.post('/resolve-preview', validate(ResolvePreviewSchema), async (req, res, next) => {
    try {
      if (!agentResolver) throw new ValidationError('Agents are not enabled on this server');
      const body = req.body as {
        agentRef?: string;
        overrides?: Record<string, unknown>;
        projectId?: string;
        harnessType?: 'copilot' | 'claude-agent';
        scope: 'chat' | 'stage' | 'worker';
        draft?: Record<string, unknown>;
      };

      // A draft is previewed WITHOUT persisting, so the editor can show
      // effective capabilities before the agent exists.
      if (body.draft && !body.agentRef) {
        const svc = requireService();
        const projection = await svc.previewDraft(body.draft, {
          ...(body.projectId ? { projectId: body.projectId } : {}),
          harnessType: body.harnessType ?? 'copilot',
          scope: body.scope,
          ...(body.overrides ? { overrides: body.overrides } : {}),
        });
        res.json(redactProjection(projection));
        return;
      }

      const projection = await agentResolver.resolve({
        ...(body.agentRef ? { agentRef: body.agentRef } : {}),
        ...(body.overrides ? { overrides: body.overrides as never } : {}),
        ...(body.projectId ? { projectId: body.projectId } : {}),
        harnessType: body.harnessType ?? 'copilot',
        scope: body.scope,
      });
      res.json(redactProjection(projection));
    } catch (err) {
      if (err instanceof NotFoundError) {
        next(err);
        return;
      }
      next(err);
    }
  });

  return router;
}
