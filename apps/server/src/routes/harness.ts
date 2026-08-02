// ────────────────────────────────────────────────────────────────
// Harness Routes — multi-provider status, live model catalogs, primary
// provider selection.
//
// Every installed provider runs side by side, so these routes report each
// one's live readiness (installed → connected → authenticated) together with
// the model catalog that provider actually serves for the logged-in account.
// The UI uses that to show real models and lock providers that aren't usable.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';
import { ALL_HARNESS_TYPES, type HarnessType } from '@generatorai/agent-harness-providers';

export function createHarnessRoutes(container: Container): Router {
  const router = Router();
  const { harnessRegistry, logger } = container;

  // GET /harness — primary provider + which types this build knows about.
  router.get('/', async (_req, res) => {
    const statuses = harnessRegistry.getStatuses();
    res.json({
      type: harnessRegistry.primary,
      availableTypes: statuses.filter((s) => s.ready).map((s) => s.type),
      knownTypes: [...ALL_HARNESS_TYPES],
    });
  });

  // GET /harness/providers — live readiness + model catalog per provider.
  // `?refresh=1` forces a re-probe (otherwise results are cached, because a
  // cold probe spawns a provider CLI and can take several seconds).
  router.get('/providers', async (req, res, next) => {
    try {
      const force = req.query['refresh'] === '1' || req.query['refresh'] === 'true';
      const statuses = await harnessRegistry.refresh(force);
      res.json({
        primary: harnessRegistry.primary,
        providers: statuses.map((s) => ({
          type: s.type,
          label: s.label,
          installed: s.installed,
          connected: s.connected,
          authenticated: s.authenticated,
          ready: s.ready,
          error: s.error,
          checkedAt: s.checkedAt,
          modelCount: s.models.length,
          models: s.models,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /harness/models — flat live catalog across every ready provider,
  // each model tagged with the provider that owns it.
  //
  // This is the canonical model-catalog endpoint. Each entry carries
  // everything the picker needs — reasoning-effort levels + default,
  // `promptTokenLimit` (the context-gauge denominator), `totalContextWindow`,
  // `maxOutputTokens`, the `longContext` tier when offered, and pricing.
  //   ?provider=copilot  restrict to one provider
  //   ?refresh=1         force a re-probe instead of using the cached catalog
  router.get('/models', async (req, res, next) => {
    try {
      const force = req.query['refresh'] === '1' || req.query['refresh'] === 'true';
      const all = await harnessRegistry.getAllModels(force);
      const provider = req.query['provider'];
      if (typeof provider === 'string' && provider.length > 0) {
        res.json(all.filter((m) => m.provider === provider));
        return;
      }
      res.json(all);
    } catch (err) {
      next(err);
    }
  });

  // POST /harness/switch — change the DEFAULT provider.
  //
  // This no longer tears anything down: every provider stays live, so this
  // only decides which one handles requests that don't name a provider.
  // Existing conversations keep running on the provider that created them.
  router.post('/switch', async (req, res, next) => {
    try {
      const { type } = req.body as { type?: string };
      if (!type || !ALL_HARNESS_TYPES.includes(type as HarnessType)) {
        res.status(400).json({
          error: {
            code: 'INVALID_HARNESS_TYPE',
            message: `Invalid harness type '${type ?? ''}'. Valid types: ${ALL_HARNESS_TYPES.join(', ')}`,
          },
        });
        return;
      }
      const targetType = type as HarnessType;

      if (targetType === harnessRegistry.primary) {
        res.json({ message: `Already using '${targetType}'`, type: targetType, switched: false });
        return;
      }

      // Refuse to make an unusable provider the default — otherwise every
      // request that omits a provider would start failing.
      const statuses = await harnessRegistry.refresh();
      const target = statuses.find((s) => s.type === targetType);
      if (!target?.ready) {
        res.status(409).json({
          error: {
            code: 'HARNESS_NOT_READY',
            message: `Provider '${targetType}' is not ready: ${target?.error ?? 'not authenticated'}`,
          },
        });
        return;
      }

      harnessRegistry.setPrimary(targetType);
      logger.info(`[Harness] Default provider set to '${targetType}'`);
      res.json({ message: `Switched to '${targetType}'`, type: targetType, switched: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
