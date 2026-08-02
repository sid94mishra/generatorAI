// ────────────────────────────────────────────────────────────────
// Source Control Routes — provider selection + credentials + config
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';
import type { ActiveProvider } from '@generatorai/core';

export function createSourceControlRoutes(container: Container): Router {
  const router = Router();
  const { sourceControlConfigService, sourceControlService, logger } = container;

  // GET /source-control/config — current provider selection (token never returned)
  router.get('/config', (_req, res, next) => {
    try {
      res.json(sourceControlConfigService.getConfig());
    } catch (err) {
      next(err);
    }
  });

  // PUT /source-control/config — update provider selection / credentials
  router.put('/config', async (req, res, next) => {
    try {
      const activeProvider = req.body?.activeProvider as ActiveProvider | undefined;
      if (activeProvider && activeProvider !== 'github' && activeProvider !== 'none') {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: `Unknown provider: ${activeProvider}` },
        });
        return;
      }
      const updated = await sourceControlConfigService.setConfig({
        activeProvider,
        github: req.body?.github,
      });
      logger.info(`[SCM] Config updated — active=${updated.activeProvider}`, { requestId: req.requestId });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // GET /source-control/status — whether the active provider is usable
  router.get('/status', async (_req, res, next) => {
    try {
      const enabled = await sourceControlService.isEnabled();
      res.json({ activeProvider: sourceControlService.getActiveProviderId(), enabled });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
