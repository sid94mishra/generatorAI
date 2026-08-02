// ────────────────────────────────────────────────────────────────
// Template Routes — list and get workflow templates
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';

export function createTemplateRoutes(container: Container): Router {
  const router = Router();
  const { templateRegistry } = container;

  // GET /templates — List all templates with optional ?category filter
  router.get('/', async (_req, res, next) => {
    try {
      let templates = templateRegistry.getAllWorkflowTemplates();

      const categoryFilter = _req.query['category'] as string | undefined;
      if (categoryFilter) {
        templates = templates.filter((t) => t.category === categoryFilter);
      }

      res.json(templates);
    } catch (err) {
      next(err);
    }
  });

  // GET /templates/:id — Get a single template by ID
  router.get('/:id', async (req, res, next) => {
    try {
      const template = templateRegistry.getWorkflowTemplate(String(req.params['id']));
      if (!template) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Template ${String(req.params['id'])} not found` },
        });
        return;
      }
      res.json(template);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
