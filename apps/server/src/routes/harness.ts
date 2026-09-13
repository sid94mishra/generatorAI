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
  //
  // `?refresh=1` forces a blocking re-probe. Everything else is served from
  // the cached snapshot and refreshed in the BACKGROUND.
  //
  // This used to `await refresh(false)` unconditionally. That looks cached,
  // but the TTL is 5 minutes and the disk cache restores each provider's
  // `checkedAt` from the PREVIOUS run — which is essentially always older than
  // that — so the first request after every boot missed the freshness check
  // and blocked on a full cold probe. A cold probe spawns each provider's CLI
  // and measured ~22 s here. The composer holds a skeleton until this resolves
  // (`ChatInput` gates on `modelsPending`), so for ~22 s after every restart
  // the chat could not be typed into at all.
  //
  // The registry was already built for this — `statusSnapshot` is a
  // synchronous read, `requestRefresh()` is fire-and-forget, and the disk
  // cache exists precisely so "a cold boot returns stale-but-useful data
  // instantly rather than blocking". This route simply wasn't using any of it.
  //
  // We block in exactly one case: a genuinely first-ever boot with nothing
  // cached, where returning immediately would mean returning nothing.
  router.get('/providers', async (req, res, next) => {
    try {
      const force = req.query['refresh'] === '1' || req.query['refresh'] === 'true';
      const servedFromCache = !force && harnessRegistry.hasProbedStatuses;

      let statuses;
      if (servedFromCache) {
        statuses = harnessRegistry.getStatuses();
        // Fire-and-forget; no-op if a refresh is already running.
        if (harnessRegistry.statusesAreStale) harnessRegistry.requestRefresh();
      } else {
        statuses = await harnessRegistry.refresh(force);
      }

      res.json({
        primary: harnessRegistry.primary,
        // `stale` tells the client this is last-known-good and a fresher
        // answer is being fetched, so it can poll briefly and converge rather
        // than sit on cache until its own staleTime expires.
        stale: servedFromCache && harnessRegistry.statusesAreStale,
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
          // The provider can sign the user in from the app (see POST
          // /providers/:type/login). Read off the live adapter when it is
          // up; a provider that has not been brought up yet reports false
          // and flips once the probe has run.
          supportsLogin: typeof harnessRegistry.peek?.(s.type as HarnessType)?.startLogin === 'function',
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /harness/providers/:type/login — start the provider's own sign-in
  // flow. Answers `{ authUrl }` for a browser flow; the client opens it and
  // re-probes until the provider reports authenticated.
  router.post('/providers/:type/login', async (req, res, next) => {
    try {
      const type = String(req.params['type']) as HarnessType;
      if (!ALL_HARNESS_TYPES.includes(type)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Unknown provider "${type}"` } });
        return;
      }
      const adapter = await harnessRegistry.get(type);
      if (typeof adapter.startLogin !== 'function') {
        res.status(409).json({ error: { code: 'UNSUPPORTED', message: `${type} has no in-app sign-in; use its own CLI to sign in.` } });
        return;
      }
      const result = await adapter.startLogin();
      logger.info(`[HarnessRoutes] ${type} sign-in started`, { requestId: req.requestId, browser: !!result.authUrl });
      if (result.completed) harnessRegistry.requestRefresh();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /harness/providers/:type/logout — sign the provider's account out.
  router.post('/providers/:type/logout', async (req, res, next) => {
    try {
      const type = String(req.params['type']) as HarnessType;
      if (!ALL_HARNESS_TYPES.includes(type)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Unknown provider "${type}"` } });
        return;
      }
      const adapter = harnessRegistry.peek(type);
      if (!adapter || typeof adapter.logout !== 'function') {
        res.status(409).json({ error: { code: 'UNSUPPORTED', message: `${type} has no in-app sign-out.` } });
        return;
      }
      await adapter.logout();
      harnessRegistry.requestRefresh();
      logger.info(`[HarnessRoutes] ${type} signed out`, { requestId: req.requestId });
      res.json({ ok: true });
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
