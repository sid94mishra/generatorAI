// ────────────────────────────────────────────────────────────────
// WorkflowDefinition Routes (v2) — CRUD + stages + edges + validation
// 13 endpoints for workflow definition management
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';
import { validate } from '../middleware/validate.js';
import {
  CreateWorkflowDefinitionSchema,
  UpdateWorkflowDefinitionSchema,
  CreateStageSchema,
  CreateEdgeSchema,
  ImportWorkflowJsonSchema,
} from '@generatorai/shared';

export function createWorkflowDefinitionRoutes(container: Container): Router {
  const router = Router();
  const { workflowDefinitionService, logger } = container;

  // ═══════════════════════════════════════════════════════════
  // Definition CRUD
  // ═══════════════════════════════════════════════════════════

  // POST /workflow-definitions — Create a new workflow definition
  router.post('/', validate(CreateWorkflowDefinitionSchema), async (req, res, next) => {
    try {
      // Apply default harness config: all tools enabled, infinite session
      const params = { ...req.body };
      if (!params.harnessConfig) {
        params.harnessConfig = {};
      }
      if (!params.harnessConfig.availableTools) {
        params.harnessConfig.availableTools = ['*'];
      }
      if (params.harnessConfig.streaming === undefined) {
        params.harnessConfig.streaming = true;
      }

      const definition = await workflowDefinitionService.createDefinition(params);
      logger.info(`[WorkflowDefRoutes] Created definition ${definition.id}`, {
        requestId: req.requestId,
      });
      res.status(201).json(definition);
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-definitions — List all definitions
  router.get('/', async (req, res, next) => {
    try {
      const projectId = req.query['projectId'] as string | undefined;
      const definitions = await workflowDefinitionService.listDefinitions(projectId);
      res.json(definitions);
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-definitions/:id — Get definition with stages and edges
  router.get('/:id', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const definition = await workflowDefinitionService.getDefinitionWithStages(id);
      res.json(definition);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /workflow-definitions/:id — Update a definition (partial update)
  router.patch('/:id', validate(UpdateWorkflowDefinitionSchema), async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const updated = await workflowDefinitionService.updateDefinition(id, req.body);
      logger.info(`[WorkflowDefRoutes] Updated definition ${id}`, {
        requestId: req.requestId,
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /workflow-definitions/:id — Delete a definition (cascade).
   *
   * Item 9 — refuses with 409 when the definition still has runs, naming how
   * many. `?force=true` deletes those runs too. Without `force`, the client
   * error message names the exact blocker so the UI can offer "delete the
   * N runs first" instead of a generic failure.
   */
  router.delete('/:id', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const force = String(req.query['force'] ?? '').toLowerCase() === 'true';
      await workflowDefinitionService.deleteDefinition(id, { force });
      logger.info(`[WorkflowDefRoutes] Deleted definition ${id}`, {
        requestId: req.requestId,
        force,
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Stage CRUD (nested under definition)
  // ═══════════════════════════════════════════════════════════

  // POST /workflow-definitions/:id/stages — Add a stage
  router.post('/:id/stages', validate(CreateStageSchema.omit({ workflowDefinitionId: true })), async (req, res, next) => {
    try {
      const definitionId = String(req.params['id']);
      const stage = await workflowDefinitionService.addStage({
        ...req.body,
        workflowDefinitionId: definitionId,
      });
      logger.info(`[WorkflowDefRoutes] Added stage ${stage.id} to definition ${definitionId}`, {
        requestId: req.requestId,
      });
      res.status(201).json(stage);
    } catch (err) {
      next(err);
    }
  });

  // PUT /workflow-definitions/:id/stages/:stageId — Update a stage
  router.put('/:id/stages/:stageId', validate(CreateStageSchema.omit({ workflowDefinitionId: true }).partial()), async (req, res, next) => {
    try {
      const stageId = String(req.params['stageId']);
      const updated = await workflowDefinitionService.updateStage(stageId, req.body);
      logger.info(`[WorkflowDefRoutes] Updated stage ${stageId}`, {
        requestId: req.requestId,
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /workflow-definitions/:id/stages/:stageId — Delete a stage
  router.delete('/:id/stages/:stageId', async (req, res, next) => {
    try {
      const stageId = String(req.params['stageId']);
      await workflowDefinitionService.deleteStage(stageId);
      logger.info(`[WorkflowDefRoutes] Deleted stage ${stageId}`, {
        requestId: req.requestId,
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Edge CRUD (nested under definition)
  // ═══════════════════════════════════════════════════════════

  // POST /workflow-definitions/:id/edges — Add an edge
  router.post('/:id/edges', validate(CreateEdgeSchema.omit({ workflowDefinitionId: true })), async (req, res, next) => {
    try {
      const definitionId = String(req.params['id']);
      const edge = await workflowDefinitionService.addEdge({
        ...req.body,
        workflowDefinitionId: definitionId,
      });
      logger.info(`[WorkflowDefRoutes] Added edge ${edge.id} to definition ${definitionId}`, {
        requestId: req.requestId,
      });
      res.status(201).json(edge);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /workflow-definitions/:id/edges/:edgeId — Delete an edge
  router.delete('/:id/edges/:edgeId', async (req, res, next) => {
    try {
      const edgeId = String(req.params['edgeId']);
      await workflowDefinitionService.deleteEdge(edgeId);
      logger.info(`[WorkflowDefRoutes] Deleted edge ${edgeId}`, {
        requestId: req.requestId,
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Validation + Import/Export
  // ═══════════════════════════════════════════════════════════

  // POST /workflow-definitions/:id/validate — Validate the DAG structure
  router.post('/:id/validate', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const result = await workflowDefinitionService.validateDefinition(id);
      const statusCode = result.valid ? 200 : 422;
      res.status(statusCode).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-definitions/import — Import from a template
  router.post('/import', async (req, res, next) => {
    try {
      const { templateId, name } = req.body as { templateId: string; name?: string };
      if (!templateId) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'templateId is required' },
        });
        return;
      }
      const definition = await workflowDefinitionService.importFromTemplate(templateId, name);
      logger.info(`[WorkflowDefRoutes] Imported definition from template ${templateId}`, {
        requestId: req.requestId,
      });
      res.status(201).json(definition);
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-definitions/import-json — Import from a full JSON configuration
  router.post('/import-json', validate(ImportWorkflowJsonSchema), async (req, res, next) => {
    try {
      const definition = await workflowDefinitionService.importFromJSON(req.body);
      logger.info(`[WorkflowDefRoutes] Imported definition from JSON: ${definition.id}`, {
        requestId: req.requestId,
      });
      res.status(201).json(definition);
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-definitions/:id/export — Export as a template
  router.get('/:id/export', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const template = await workflowDefinitionService.exportAsTemplate(id);
      res.json(template);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
