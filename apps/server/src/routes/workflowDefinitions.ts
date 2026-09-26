// ────────────────────────────────────────────────────────────────
// Workflow definition routes (P01 WP-1.7) — definitions as versioned v2
// documents. There are no per-stage or per-edge routes: a client reads
// the whole `WorkflowGraph` and saves it back with `PUT /:id/graph`
// (optimistic concurrency on `revision`); runs pin published versions.
//
//   GET    /workflow-definitions?projectId&status&q&cursor&limit&includeArchived
//   POST   /workflow-definitions                 a draft from a graph
//   POST   /workflow-definitions/validate        stateless validation
//   POST   /workflow-definitions/import          graph | {templateId}; ?publish=true
//   GET    /workflow-definitions/:id
//   PUT    /workflow-definitions/:id/graph       {graph, expectedRevision}
//   POST   /workflow-definitions/:id/publish
//   GET    /workflow-definitions/:id/versions[/:versionId]
//   GET    /workflow-definitions/:id/export      the canonical document
//   DELETE /workflow-definitions/:id             hard delete, or archive when runs exist
// ────────────────────────────────────────────────────────────────

import { Router, type Request } from 'express';
import {
  ImportTemplateRequestSchema,
  SaveGraphRequestSchema,
  DEFINITION_STATUSES,
  type DefinitionStatus,
} from '@generatorai/workflow-spec';
import { COMMAND_EDIT_SCOPE } from '@generatorai/core';
import type { Container } from '../composition-root.js';

/** Principals that may publish on import: humans, not integrations. */
const HUMAN_PRINCIPALS = new Set(['local-desktop', 'paired-device', 'user-session']);

/** Whether the caller may add or change command-bearing fields (W-34). */
function canEditCommands(req: Request): boolean {
  // No principal means authentication is not in play (tests, embedded).
  return !req.principal || (req.principal.scopes as readonly string[]).includes(COMMAND_EDIT_SCOPE);
}

const first = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export function createWorkflowDefinitionRoutes(container: Container): Router {
  const router = Router();
  const { workflowDefinitionService, logger } = container;

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
      const record = await workflowDefinitionService.create(req.body, { canEditCommands: canEditCommands(req) });
      logger.info(`[WorkflowDefRoutes] Created draft ${record.id}`, { requestId: req.requestId });
      res.status(201).json(record);
    } catch (err) {
      next(err);
    }
  });

  // Stateless: returns the ValidationResult (200 whether or not it is valid).
  router.post('/validate', async (req, res, next) => {
    try {
      const { valid, issues } = await workflowDefinitionService.validate(req.body);
      res.json({ valid, issues });
    } catch (err) {
      next(err);
    }
  });

  router.post('/import', async (req, res, next) => {
    try {
      const wantsPublish = String(req.query['publish'] ?? '') === 'true';
      if (wantsPublish && req.principal && !HUMAN_PRINCIPALS.has(req.principal.type)) {
        res.status(403).json({
          error: { code: 'PUBLISH_NOT_ALLOWED', message: 'Only a person can publish on import; import as a draft instead.' },
        });
        return;
      }
      const opts = { canEditCommands: canEditCommands(req), publish: wantsPublish };
      const template = ImportTemplateRequestSchema.safeParse(req.body);
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
      const record = await workflowDefinitionService.publish(id);
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
