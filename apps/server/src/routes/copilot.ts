// ────────────────────────────────────────────────────────────────
// Copilot Routes — model discovery, state, conversations, ping
// Uses harness methods through the IAgentHarness abstraction
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';

export function createCopilotRoutes(container: Container): Router {
  const router = Router();
  const { harness, logger } = container;

  // GET /copilot/models — DEPRECATED alias for GET /harness/models.
  //
  // Despite the name this has always returned the merged multi-provider
  // catalog, not just Copilot's. Kept so older clients keep working; new
  // callers should use /harness/models (which also supports ?provider=).
  router.get('/models', async (req, res, next) => {
    try {
      const models = await harness.getModels();
      res.setHeader('Deprecation', 'true');
      res.setHeader('Link', '</api/harness/models>; rel="successor-version"');
      logger.info(`[CopilotRoutes] Retrieved ${models.length} models (deprecated route)`, { requestId: req.requestId });
      res.json(models);
    } catch (err) {
      next(err);
    }
  });

  // GET /copilot/state — Get current Copilot client state via SDK
  router.get('/state', (req, res) => {
    const state = harness.getClientState();
    logger.info(`[CopilotRoutes] Client state: ${state}`, { requestId: req.requestId });
    res.json({ state });
  });

  // GET /copilot/conversations — List active conversations via SDK
  router.get('/conversations', async (req, res, next) => {
    try {
      const conversations = await harness.listConversations();
      logger.info(`[CopilotRoutes] Listed ${conversations.length} conversations`, { requestId: req.requestId });
      res.json(conversations);
    } catch (err) {
      next(err);
    }
  });

  // GET /copilot/conversations/:id/messages — Get conversation messages via SDK
  router.get('/conversations/:id/messages', async (req, res, next) => {
    try {
      const conversationId = String(req.params['id']);
      const messages = await harness.getMessages(conversationId);
      res.json(messages);
    } catch (err) {
      next(err);
    }
  });

  // POST /copilot/ping — Health ping returning alive status
  router.post('/ping', async (req, res, next) => {
    try {
      const alive = await harness.ping();
      logger.info(`[CopilotRoutes] Ping result: ${alive}`, { requestId: req.requestId });
      res.json({ alive });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
