// ────────────────────────────────────────────────────────────────
// Webhook Routes — GitHub and custom webhook handling
//
// @deprecated (Track A4) — the `webhook_registrations` table + these
// routes were the pre-Automation trigger surface. Superseded by
// `POST /api/automations/webhooks/:token` (see routes/automations.ts).
// Kept alive for backwards compatibility; the CLI + web UI don't
// expose creation of new registrations. Runtime deprecation warnings
// are emitted below so operators can see this path is stale.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { Container } from '../composition-root.js';
import { validate } from '../middleware/validate.js';
import { verifyGitHubSignature, verifyWebhookToken } from '../middleware/webhookAuth.js';
import type { WebhookRegistration } from '@generatorai/shared';
import { generateId } from '@generatorai/shared';

const CreateWebhookRegistrationSchema = z.object({
  name: z.string().min(1),
  source: z.enum(['github', 'custom']),
  eventType: z.string().min(1),
  templateId: z.string().min(1),
  autoStart: z.boolean().default(true),
  condition: z.string().optional(),
  sessionConfig: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
});

export function createWebhookRoutes(container: Container): Router {
  const router = Router();
  const { webhookService, config, logger } = container;

  // POST /webhooks/github — Handle GitHub webhook
  router.post('/github', (req, res, next) => {
    // Apply signature verification if secret is configured
    const secret = config.webhooks.githubSecret;
    if (secret) {
      verifyGitHubSignature(secret)(req, res, () => {
        handleGitHub(req, res, next);
      });
    } else {
      // SEC-3 — no secret configured: the endpoint is UNAUTHENTICATED and any
      // caller can spawn/auto-start workflow runs. Surface it loudly so this
      // isn't silently relied on outside a trusted localhost boundary.
      logger.warn(
        '[WebhookRoutes] GitHub webhook processed WITHOUT signature verification ' +
        '(config.webhooks.githubSecret is not set). Set it to authenticate inbound deliveries.',
        { requestId: req.requestId },
      );
      handleGitHub(req, res, next);
    }
  });

  async function handleGitHub(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const headers: Record<string, string> = {
        'x-github-event': String(req.headers['x-github-event'] ?? ''),
        'x-github-delivery': String(req.headers['x-github-delivery'] ?? ''),
        'x-hub-signature-256': String(req.headers['x-hub-signature-256'] ?? ''),
      };

      await webhookService.handleGitHub(headers, req.body);
      logger.info('[WebhookRoutes] GitHub webhook processed', {
        event: headers['x-github-event'],
        delivery: headers['x-github-delivery'],
        requestId: req.requestId,
      });
      res.json({ message: 'Webhook processed' });
    } catch (err) {
      next(err);
    }
  }

  // POST /webhooks/custom/:trigger — Handle custom webhook trigger
  router.post('/custom/:trigger', (req, res, next) => {
    // Apply token verification if webhookToken is configured
    const token = config.webhooks.webhookToken;
    if (token) {
      verifyWebhookToken(token)(req, res, () => {
        void handleCustom(req, res, next);
      });
    } else {
      // SEC-3 — unauthenticated custom webhook (no config.webhooks.webhookToken).
      logger.warn(
        '[WebhookRoutes] Custom webhook processed WITHOUT token verification ' +
        '(config.webhooks.webhookToken is not set). Set it to authenticate inbound triggers.',
        { requestId: req.requestId },
      );
      void handleCustom(req, res, next);
    }
  });

  async function handleCustom(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const trigger = String(req.params['trigger']);
      // Standard HTTP idempotency pattern: clients re-send the same key on
      // retry; the server dedups via the delivery log.
      const idempotencyKey = typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;
      await webhookService.handleCustom(trigger, req.body, idempotencyKey);
      logger.info(`[WebhookRoutes] Custom webhook triggered: ${trigger}`, {
        requestId: req.requestId,
        idempotencyKey,
      });
      res.json({ message: 'Custom webhook processed', trigger });
    } catch (err) {
      next(err);
    }
  }

  // GET /webhooks/registrations — List all webhook registrations
  router.get('/registrations', async (_req, res, next) => {
    try {
      const registrations = await webhookService.getAllRegistrations();
      res.json(registrations);
    } catch (err) {
      next(err);
    }
  });

  // POST /webhooks/registrations — Create a new webhook registration
  //
  // @deprecated (Track A4) — use `POST /api/automations` with
  // `triggerType: 'webhook'` instead. This endpoint stays alive for
  // backwards compatibility but new callers should not use it.
  router.post('/registrations', validate(CreateWebhookRegistrationSchema), async (req, res, next) => {
    try {
      logger.warn(
        `[WebhookRoutes] DEPRECATED: POST /api/webhooks/registrations — use POST /api/automations with triggerType='webhook' instead`,
        { requestId: req.requestId },
      );
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', 'Wed, 01 Jan 2027 00:00:00 GMT');
      res.setHeader('Link', '</api/automations>; rel="successor-version"');
      const registration: WebhookRegistration = {
        id: generateId(),
        ...req.body,
        createdAt: new Date(),
      };
      const created = await webhookService.createRegistration(registration);
      logger.info(`[WebhookRoutes] Created webhook registration ${created.id}`, { requestId: req.requestId });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /webhooks/registrations/:id — Delete a webhook registration
  router.delete('/registrations/:id', async (req, res, next) => {
    try {
      await webhookService.deleteRegistration(String(req.params['id']));
      logger.info(`[WebhookRoutes] Deleted webhook registration ${String(req.params['id'])}`, { requestId: req.requestId });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
