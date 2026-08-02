// ────────────────────────────────────────────────────────────────
// Sessions Routes — chat message history by Copilot session ID.
// Used by WorkflowMessages to load per-stage message history for
// completed stage runs on the workflow run page.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';

export function createSessionRoutes(container: Container): Router {
  const router = Router();
  const { chatMessageRepo } = container;

  // GET /sessions/:sessionId/chat — get messages for a session, optionally
  // filtered to a specific stage run via ?stageRunId=<id>
  router.get('/:sessionId/chat', async (req, res, next) => {
    try {
      const sessionId = String(req.params['sessionId']);
      const stageRunId = req.query['stageRunId'] as string | undefined;

      const messages = stageRunId
        ? await chatMessageRepo.getBySessionAndStageRunId(sessionId, stageRunId)
        : await chatMessageRepo.getBySessionId(sessionId);

      res.json(messages);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
