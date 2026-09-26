// ────────────────────────────────────────────────────────────────
// Workflow definition routes (P01 WP-1.7) — definitions as versioned v2
// documents. There are no per-stage or per-edge routes: a client reads
// the whole `WorkflowGraph` and saves it back with `PUT /:id/graph`
// (optimistic concurrency on `revision`); runs pin published versions.
//
//   GET    /workflow-definitions?projectId&status&q&cursor&limit&includeArchived
//   POST   /workflow-definitions                 a draft from a graph
//   POST   /workflow-definitions/validate        stateless validation, the server's checks included (P06)
//   POST   /workflow-definitions/plan            {graph | workflowId, variables?, stageOverrides?} -> the plan, nothing written (P06)
//   GET    /workflow-definitions/schema          {version, hash, jsonSchema} (P06)
//   GET    /workflow-definitions/authoring/skill            the authoring skill bundle's files (P06)
//   GET    /workflow-definitions/authoring/skill/file?path= one file of it
//   POST   /workflow-definitions/import          graph | {templateId}; ?publish=true
//   GET    /workflow-definitions/:id
//   PUT    /workflow-definitions/:id/graph       {graph, expectedRevision}
//   POST   /workflow-definitions/:id/publish     a person's act (PD-14; `allowAgentPublish`)
//   GET    /workflow-definitions/:id/versions[/:versionId]
//   GET    /workflow-definitions/:id/export      the canonical document
//   DELETE /workflow-definitions/:id             hard delete, or archive when runs exist
//
// An agent (a service account, an MCP device) that creates or imports a
// definition gets an agent-authored DRAFT (tagged, its author recorded);
// only a person publishes, unless the operator allows agents to.
// ────────────────────────────────────────────────────────────────

import { Router, type Request } from 'express';
import {
  ImportTemplateRequestSchema,
  SaveGraphRequestSchema,
  DEFINITION_STATUSES,
  type DefinitionStatus,
} from '@generatorai/workflow-spec';
import { COMMAND_EDIT_SCOPE, InvocationError } from '@generatorai/core';
import type { Container } from '../composition-root.js';
import { invocationPrincipal, invocationTrigger } from './workflowInvocations.js';
import { isLoopbackRequest } from '../middleware/auth.js';

/**
 * Whether a person made the request (PD-14): the local owner, a signed-in
 * user, a paired device that is not an MCP server (its device record says
 * which). Service accounts, internal services and MCP devices are agents.
 */
export async function isPersonRequest(req: Request, container: Container): Promise<boolean> {
  const p = req.principal;
  if (!p) return true; // unauthenticated loopback development: the owner
  if (p.type === 'local-desktop' || p.type === 'user-session') return true;
  if (p.type !== 'paired-device') return false;
  const device = p.deviceId ? await container.security.devices.getDevice(p.deviceId).catch(() => null) : null;
  return device?.platform !== 'mcp';
}

/** The agent author of a definition an agent principal submits over HTTP. */
async function agentAuthorOf(
  req: Request,
  container: Container,
): Promise<{ kind: 'external_agent'; via: 'mcp' | 'http'; principalId: string } | null> {
  if (await isPersonRequest(req, container)) return null;
  const p = req.principal!;
  const device = p.deviceId ? await container.security.devices.getDevice(p.deviceId).catch(() => null) : null;
  return { kind: 'external_agent', via: device?.platform === 'mcp' ? 'mcp' : 'http', principalId: p.deviceId ?? p.id };
}

/** Whether the caller may add or change command-bearing fields (W-34). */
function canEditCommands(req: Request): boolean {
  // No principal means authentication is not in play (tests, embedded).
  return !req.principal || (req.principal.scopes as readonly string[]).includes(COMMAND_EDIT_SCOPE);
}

const first = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export function createWorkflowDefinitionRoutes(container: Container): Router {
  const router = Router();
  const { workflowDefinitionService, workflowAuthoringService: authoring, logger } = container;

  router.get('/', async (req, res, next) => {
    try {
      const projectId = first(req.query['projectId']);
      const status = first(req.query['status']);
      const limit = first(req.query['limit']);
      const page = await workflowDefinitionService.list({
        // `global` asks for definitions without a project.
        ...(projectId !== undefined ? { projectId: projectId === 'global' ? null : projectId } : {}),
        ...(status && (DEFINITION_STATUSES as readonly string[]).includes(status) ? { status: status as DefinitionStatus } : {}),
        ...(first(req.query['q']) ? { q: first(req.query['q'])! } : {}),
        ...(first(req.query['cursor']) ? { cursor: first(req.query['cursor'])! } : {}),
        ...(limit && Number.isFinite(Number(limit)) ? { limit: Number(limit) } : {}),
        includeArchived: req.query['includeArchived'] === 'true',
      });
      res.json(page);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const author = await agentAuthorOf(req, container);
      if (author) {
        // An agent's definition is an agent-authored draft (PD-14).
        const draft = await authoring.createDraft(req.body, { authoredBy: author, canEditCommands: canEditCommands(req) });
        logger.info(`[WorkflowDefRoutes] Created agent draft ${draft.workflowId}`, { requestId: req.requestId });
        res.status(201).json(await workflowDefinitionService.get(draft.workflowId));
        return;
      }
      const record = await workflowDefinitionService.create(req.body, { canEditCommands: canEditCommands(req) });
      logger.info(`[WorkflowDefRoutes] Created draft ${record.id}`, { requestId: req.requestId });
      res.status(201).json(record);
    } catch (err) {
      next(err);
    }
  });

  // Stateless (200 whether or not it is valid): the spec's rules plus the
  // server's (agents, models, provider capabilities, command fields).
  router.post('/validate', async (req, res, next) => {
    try {
      res.json(await authoring.validate(req.body, { canEditCommands: canEditCommands(req) }));
    } catch (err) {
      next(err);
    }
  });

  // What a run of a graph (unsaved) or a saved definition would do; nothing is written.
  router.post('/plan', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as {
        graph?: unknown;
        workflowId?: unknown;
        variables?: unknown;
        stageOverrides?: unknown;
        codebases?: unknown;
        projectId?: unknown;
      };
      const principal = invocationPrincipal(req);
      const result = await authoring.plan(
        {
          ...(body.graph !== undefined ? { graph: body.graph } : {}),
          ...(typeof body.workflowId === 'string' ? { workflowId: body.workflowId } : {}),
          ...(body.variables && typeof body.variables === 'object' ? { variables: body.variables as Record<string, unknown> } : {}),
          ...(Array.isArray(body.stageOverrides) ? { stageOverrides: body.stageOverrides } : {}),
          ...(Array.isArray(body.codebases) ? { codebases: body.codebases } : {}),
          ...(typeof body.projectId === 'string' ? { projectId: body.projectId } : {}),
        },
        { principal, trigger: invocationTrigger(req, principal, undefined), loopback: isLoopbackRequest(req) },
      );
      res.json(result);
    } catch (err) {
      if (err instanceof InvocationError) {
        res.status(err.httpStatus).json({ error: { code: err.code, message: err.message, issues: err.issues } });
        return;
      }
      next(err);
    }
  });

  // The workflow JSON Schema and its hash: an agent holding an older skill sees the hash differ.
  router.get('/schema', async (_req, res, next) => {
    try {
      res.json(await authoring.schema());
    } catch (err) {
      next(err);
    }
  });

  // The generated authoring skill (the same files the guide tool and the MCP resources serve).
  router.get('/authoring/skill', async (_req, res, next) => {
    try {
      const schema = await authoring.schema();
      res.json({ name: 'generatorai-workflow-author', schemaHash: schema.hash, files: await authoring.bundleFiles() });
    } catch (err) {
      next(err);
    }
  });

  router.get('/authoring/skill/file', async (req, res, next) => {
    try {
      const rel = first(req.query['path']);
      if (!rel) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'path is required' } });
        return;
      }
      const text = await authoring.bundleFile(rel);
      res.type(rel.endsWith('.json') ? 'application/json' : rel.endsWith('.mjs') ? 'text/javascript' : 'text/markdown').send(text);
    } catch (err) {
      next(err);
    }
  });

  router.post('/import', async (req, res, next) => {
    try {
      const wantsPublish = String(req.query['publish'] ?? '') === 'true';
      const person = await isPersonRequest(req, container);
      if (wantsPublish && !person && !authoring.agentsMayPublish()) {
        res.status(403).json({
          error: { code: 'PUBLISH_NOT_ALLOWED', message: 'Only a person can publish on import; import as a draft instead.' },
        });
        return;
      }
      const opts = { canEditCommands: canEditCommands(req), publish: wantsPublish };
      const template = ImportTemplateRequestSchema.safeParse(req.body);
      const author = person ? null : await agentAuthorOf(req, container);
      if (author && !template.success) {
        // An agent's import is an agent-authored draft (published only when the operator allows it).
        const draft = await authoring.createDraft(req.body, { authoredBy: author, canEditCommands: opts.canEditCommands });
        const record = wantsPublish
          ? await authoring.publish(draft.workflowId, { person: false, canEditCommands: opts.canEditCommands })
          : await workflowDefinitionService.get(draft.workflowId);
        logger.info(`[WorkflowDefRoutes] Imported agent draft ${record.id}`, { requestId: req.requestId });
        res.status(201).json(record);
        return;
      }
      const record = template.success
        ? await workflowDefinitionService.importTemplate(template.data.templateId, {
            ...opts,
            ...(template.data.name ? { name: template.data.name } : {}),
            ...(template.data.projectId !== undefined ? { projectId: template.data.projectId } : {}),
          })
        : await workflowDefinitionService.import(req.body, opts);
      logger.info(`[WorkflowDefRoutes] Imported definition ${record.id}`, { requestId: req.requestId });
      res.status(201).json(record);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      res.json(await workflowDefinitionService.get(String(req.params['id'])));
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id/graph', async (req, res, next) => {
    try {
      const parsed = SaveGraphRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Body must be { graph, expectedRevision }', issues: parsed.error.issues },
        });
        return;
      }
      const id = String(req.params['id']);
      const record = await workflowDefinitionService.saveGraph(id, parsed.data.graph, parsed.data.expectedRevision, {
        canEditCommands: canEditCommands(req),
      });
      logger.info(`[WorkflowDefRoutes] Saved definition ${id} at revision ${record.revision}`, { requestId: req.requestId });
      res.json(record);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/publish', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const record = await authoring.publish(id, { person: await isPersonRequest(req, container), canEditCommands: canEditCommands(req) });
      logger.info(`[WorkflowDefRoutes] Published definition ${id} as version ${record.currentVersionId}`, {
        requestId: req.requestId,
      });
      res.json(record);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/versions', async (req, res, next) => {
    try {
      res.json(await workflowDefinitionService.listVersions(String(req.params['id'])));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/versions/:versionId', async (req, res, next) => {
    try {
      res.json(await workflowDefinitionService.getVersion(String(req.params['id']), String(req.params['versionId'])));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/export', async (req, res, next) => {
    try {
      const text = await workflowDefinitionService.exportGraph(String(req.params['id']));
      res.type('application/json').send(text);
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE — hard delete when nothing ran the definition; otherwise it is
   * archived (runs pin its versions and their history stays readable).
   */
  router.delete('/:id', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const outcome = await workflowDefinitionService.delete(id);
      logger.info(`[WorkflowDefRoutes] ${'deleted' in outcome ? 'Deleted' : 'Archived'} definition ${id}`, {
        requestId: req.requestId,
      });
      res.json(outcome);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
