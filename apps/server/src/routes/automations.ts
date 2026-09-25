// ────────────────────────────────────────────────────────────────
// Automation Routes — REST endpoints for automation management
// ────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { Automation, AutomationWithExecutions } from '@generatorai/shared';
import type { Container } from '../composition-root.js';
import { validate } from '../middleware/validate.js';
import {
  CreateAutomationSchema,
  UpdateAutomationSchema,
  TriggerAutomationBodySchema,
  PreviewIterationsBodySchema,
  ValidationError,
} from '@generatorai/shared';
import { previewIterations, hashWebhookToken, toPublicAutomation } from '@generatorai/core';
import { getSecretString, setSecretString } from '@generatorai/secrets';
import { verifySignedPayload, AUTOMATION_SIGNATURE_HEADER } from '../middleware/webhookAuth.js';

/** Idempotency-key TTL — 5 minutes covers typical webhook retry windows. */
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const IDEMPOTENCY_MAX_KEY_LEN = 200;

/** Header a caller may use instead of embedding the token in the URL path. */
const WEBHOOK_TOKEN_HEADER = 'x-webhook-token';

/**
 * Vault namespace for per-automation webhook HMAC signing secrets.
 *
 * Keyed by `hashWebhookToken(rawToken)` — the SAME lookup key the automation
 * itself is stored under — rather than the automation id, so this route
 * never needs to resolve an automation before deciding whether to demand a
 * signature: the token IS the lookup. Rotating the token orphans the old
 * entry (harmless: it is unreachable without the old token) and mints a
 * fresh one under the new hash.
 */
const WEBHOOK_SIGNING_NAMESPACE = 'automation-webhook';

export function createAutomationRoutes(container: Container): Router {
  const router = Router();
  const { automationService, idempotencyKeyRepo, logger } = container;
  const secretStore = container.security.secretStore;

  /**
   * Mint and vault a fresh HMAC signing secret for a JUST-CREATED-OR-ROTATED
   * webhook automation. Returns the raw secret (shown once, same as the raw
   * token) or `undefined` when `automation` isn't a webhook automation with a
   * fresh raw token to key the vault entry on.
   */
  const mintWebhookSigningSecret = async (automation: Automation): Promise<string | undefined> => {
    if (automation.triggerType !== 'webhook' || !automation.webhookToken) return undefined;
    const secret = randomBytes(32).toString('hex');
    const tokenHash = hashWebhookToken(automation.webhookToken);
    await setSecretString(secretStore, WEBHOOK_SIGNING_NAMESPACE, tokenHash, secret);
    return secret;
  };

  /** Best-effort removal of a superseded signing secret (e.g. on rotation). */
  const forgetWebhookSigningSecret = async (tokenHash: string | undefined): Promise<void> => {
    if (!tokenHash) return;
    try {
      await secretStore.remove(WEBHOOK_SIGNING_NAMESPACE, tokenHash);
    } catch {
      /* best-effort cleanup only */
    }
  };

  // Helper to safely extract route params
  const param = (req: Request, name: string): string => {
    const val = req.params[name];
    if (typeof val !== 'string') throw new Error(`Missing route parameter: ${name}`);
    return val;
  };

  /**
   * Try to reserve an idempotency key for `scope`. When a fresh key,
   * `execute` runs, receives the fresh execution id, and the id is
   * persisted so subsequent replays return the same id.
   *
   * On replay (same key seen within TTL), the previous execution id is
   * returned via `onReplay` and `execute` is NOT invoked.
   *
   * Track A3: to avoid a "both requests execute" race, we CLAIM the key
   * with a placeholder id first. If the claim succeeds, we execute and
   * finalize by rewriting the row to the real id. If the claim shows a
   * replay hit, we return the winning id without spawning any work.
   */
  const runWithIdempotency = async (
    req: Request,
    res: Response,
    scope: string,
    execute: () => Promise<{ executionId: string; body: unknown; status: number }>,
    onReplay: (executionId: string) => void,
    onFresh: (executionId: string, body: unknown, status: number) => void,
  ): Promise<void> => {
    const key = String(req.header('idempotency-key') ?? req.header('x-idempotency-key') ?? '').trim();

    // Fast path: no key → always a fresh run.
    if (!key) {
      const result = await execute();
      onFresh(result.executionId, result.body, result.status);
      return;
    }
    if (key.length > IDEMPOTENCY_MAX_KEY_LEN) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: `Idempotency-Key exceeds ${IDEMPOTENCY_MAX_KEY_LEN} chars` },
      });
      return;
    }
    // Restrict key to printable ASCII (RFC 7230 tokens) so binary/control
    // characters can't be smuggled into a scope's key space.
    if (!/^[!-~]+$/.test(key)) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Idempotency-Key must contain only printable ASCII (no control chars)' },
      });
      return;
    }

    // Claim first with a temporary placeholder so a concurrent second
    // request sees the row and treats itself as a replay. This
    // *provisionally* returns the placeholder id — we swap it to the
    // real execution id once the caller has produced one.
    const now = new Date();
    const placeholderId = `pending-${scope}-${key}`.slice(0, 200);
    let claim: { executionId: string; replay: boolean };
    try {
      claim = await idempotencyKeyRepo.claim({
        key,
        scope,
        executionId: placeholderId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      });
    } catch {
      // Any unexpected storage error → fall back to a fresh (unclaimed)
      // run so we don't block legitimate traffic on a transient DB blip.
      const result = await execute();
      onFresh(result.executionId, result.body, result.status);
      return;
    }
    if (claim.replay && claim.executionId !== placeholderId) {
      // Genuine replay — return the winner's id without doing any work.
      // 202 Accepted matches the fresh-path status so clients can treat
      // both cases identically (X-Idempotent-Replay header signals dedup).
      onReplay(claim.executionId);
      return;
    }

    // We hold the claim. Execute + upgrade the placeholder to the real id.
    const result = await execute();
    try {
      await idempotencyKeyRepo.updateExecutionId(key, scope, result.executionId);
    } catch {
      /* best-effort finalize; replays fall back to placeholder id */
    }
    onFresh(result.executionId, result.body, result.status);
  };

  // ── CRUD ──

  /**
   * POST /api/automations — Create a new automation.
   *
   * Webhook-triggered automations get a raw token AND a raw HMAC signing
   * secret in THIS response only — never again. Every subsequent read
   * (GET /, GET /:id, PATCH /:id, enable/disable) goes through
   * `toPublicAutomation`, which masks the token entirely.
   */
  router.post('/', validate(CreateAutomationSchema), async (req, res, next) => {
    try {
      const automation = await automationService.createAutomation(req.body);
      const webhookSigningSecret = await mintWebhookSigningSecret(automation);
      res.status(201).json(
        webhookSigningSecret ? { ...automation, webhookSigningSecret } : automation,
      );
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/automations — List all automations (token/credentials redacted) */
  router.get('/', async (req, res, next) => {
    try {
      const projectId = req.query['projectId'] as string | undefined;
      const automations = await automationService.listAutomations(projectId);
      res.json(automations.map(toPublicAutomation));
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/automations/preview-iterations — Track C.
   * Preview how a schema + iteration mode + dataset would fan out
   * into iterations (returns first 5). Purely functional; safe to
   * call from the UI while the user is authoring an automation.
   */
  router.post(
    '/preview-iterations',
    validate(PreviewIterationsBodySchema),
    async (req, res, next) => {
      try {
        const result = previewIterations({
          schema: req.body.dataSchema,
          mode: req.body.iterationMode,
          dataset: req.body.dataset,
        });
        res.json(result);
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
          return;
        }
        next(err);
      }
    },
  );

  /** GET /api/automations/:id — Get automation with recent executions (token/credentials redacted) */
  router.get('/:id', async (req, res, next) => {
    try {
      const automation = await automationService.getAutomationWithExecutions(param(req, 'id'));
      // `toPublicAutomation` spreads its input then overwrites the sensitive
      // fields, so the `executions` array carried by `AutomationWithExecutions`
      // survives the round trip even though the function's declared return
      // type is the narrower `Automation`.
      res.json(toPublicAutomation(automation) as AutomationWithExecutions);
    } catch (err) {
      next(err);
    }
  });

  /** PATCH /api/automations/:id — Update automation (token/credentials redacted) */
  router.patch('/:id', validate(UpdateAutomationSchema), async (req, res, next) => {
    try {
      const automation = await automationService.updateAutomation(param(req, 'id'), req.body);
      res.json(toPublicAutomation(automation));
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/automations/:id — Delete automation */
  router.delete('/:id', async (req, res, next) => {
    try {
      await automationService.deleteAutomation(param(req, 'id'));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // ── Enable / Disable ──

  /** POST /api/automations/:id/enable — Enable automation */
  router.post('/:id/enable', async (req, res, next) => {
    try {
      const automation = await automationService.enableAutomation(param(req, 'id'));
      res.json(toPublicAutomation(automation));
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/automations/:id/disable — Disable automation */
  router.post('/:id/disable', async (req, res, next) => {
    try {
      const automation = await automationService.disableAutomation(param(req, 'id'));
      res.json(toPublicAutomation(automation));
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/automations/:id/rotate-webhook-token — Regenerate the webhook
   * token AND its HMAC signing secret. Phase 2, 2.10 — use when a leaked
   * token needs to be invalidated without recreating the automation.
   *
   * Response is `{ token, signingSecret? }`, NOT the full automation — this
   * is the one other place (besides create) the raw token is ever shown, so
   * it is scoped tightly rather than echoing the whole record.
   */
  router.post('/:id/rotate-webhook-token', async (req, res, next) => {
    try {
      const id = param(req, 'id');
      // Read the pre-rotation hash so the OLD signing secret (keyed on the
      // token this is about to replace) doesn't linger in the vault forever.
      const before = await automationService.getAutomation(id).catch(() => undefined);
      const automation = await automationService.rotateWebhookToken(id);
      await forgetWebhookSigningSecret(before?.webhookTokenHash);
      const signingSecret = await mintWebhookSigningSecret(automation);
      res.json({ token: automation.webhookToken, signingSecret });
    } catch (err) {
      next(err);
    }
  });

  // ── Trigger ──

  /**
   * POST /api/automations/:id/trigger — Manually trigger an automation.
   *
   * Body (all optional):
   *   { dataset?: AutomationDataset, saveAsDefault?: boolean }
   *
   * Headers:
   *   Idempotency-Key — dedup replays within 5 min.
   */
  router.post(
    '/:id/trigger',
    validate(TriggerAutomationBodySchema),
    async (req, res, next) => {
      try {
        const automationId = param(req, 'id');
        const scope = `automation:${automationId}`;
        // `validate(TriggerAutomationBodySchema)` above already replaced
        // `req.body` with its parsed, stripped output — this names that
        // real type instead of re-widening to `unknown` and casting past
        // it, which hid that the body was validated at all.
        const body: z.infer<typeof TriggerAutomationBodySchema> = req.body ?? {};

        await runWithIdempotency(
          req,
          res,
          scope,
          async () => {
            const exec = await automationService.triggerManual(automationId, {
              dataset: body.dataset,
              saveAsDefault: body.saveAsDefault,
            });
            return { executionId: exec.id, body: exec, status: 202 };
          },
          (executionId) => {
            res.setHeader('X-Idempotent-Replay', 'true');
            res.status(202).json({ id: executionId, status: 'pending', replay: true });
          },
          (executionId, body, status) => {
            void executionId;
            res.status(status).json(body);
          },
        );
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
          return;
        }
        next(err);
      }
    },
  );

  // ── Webhook trigger — public endpoint, authenticated by token ──

  /**
   * POST /api/automations/webhooks/:token — Webhook trigger endpoint.
   *
   * Public in `routePolicy` (no scope requirement) — GitHub, Stripe, a cron
   * pinger, whatever — none of them can hold `write:workflows` + `exec:agent`.
   * Authentication is per-delivery:
   *   1. The token itself (path segment, or the `X-Webhook-Token` header —
   *      preferred when present, since it keeps the secret out of the URL and
   *      therefore out of `req.path`-based logging).
   *   2. If a signing secret is configured for this token (minted at
   *      create/rotate time), the body must carry a valid
   *      `X-Signature-256: sha256=<hex>` HMAC over the raw request body.
   *      Missing or invalid → 401, computed BEFORE the automation lookup so
   *      an unsigned request never reaches `triggerWebhook`.
   */
  router.post('/webhooks/:token', async (req, res, next) => {
    try {
      const headerToken = req.header(WEBHOOK_TOKEN_HEADER);
      const token = headerToken && headerToken.trim().length > 0
        ? headerToken.trim()
        : param(req, 'token');
      const tokenHash = hashWebhookToken(token);

      // Optional per-automation HMAC verification. Enforced only when a
      // secret has actually been configured for this token, so automations
      // created before signing existed keep working unsigned.
      const signingSecret = await getSecretString(secretStore, WEBHOOK_SIGNING_NAMESPACE, tokenHash);
      if (signingSecret) {
        const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
        const signatureHeader = req.header(AUTOMATION_SIGNATURE_HEADER);
        if (!verifySignedPayload(signingSecret, signatureHeader, rawBody)) {
          res.status(401).json({
            error: { code: 'UNAUTHORIZED', message: 'Missing or invalid webhook signature' },
          });
          return;
        }
      }

      // Item 4 — the idempotency scope is keyed on the TOKEN HASH, not the
      // raw token, so a 4th plaintext copy never lands in `idempotency_keys`.
      const scope = `webhook:${tokenHash}`;
      const contentType = String(req.header('content-type') ?? '');

      await runWithIdempotency(
        req,
        res,
        scope,
        async () => {
          const exec = await automationService.triggerWebhook(token, req.body, contentType);
          return {
            executionId: exec.id,
            body: { executionId: exec.id, status: exec.status },
            status: 202,
          };
        },
        (executionId) => {
          res.setHeader('X-Idempotent-Replay', 'true');
          res.status(202).json({ executionId, status: 'pending', replay: true });
        },
        (executionId, body, status) => {
          void executionId;
          res.status(status).json(body);
        },
      );
    } catch (err) {
      // Schema mismatch → 400 so the caller sees the problem instead
      // of a silently-failed execution.
      if (err instanceof ValidationError) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
        return;
      }
      // Return 404 for invalid webhooks (don't reveal existence)
      if (err instanceof Error && err.message.includes('Invalid or disabled webhook')) {
        res.status(404).json({ error: 'Webhook not found' });
        return;
      }
      next(err);
    }
  });

  // ── Execution Queries ──

  /** GET /api/automations/:id/executions — List executions for an automation */
  router.get('/:id/executions', async (req, res, next) => {
    try {
      const executions = await automationService.getExecutionsByAutomation(param(req, 'id'));
      res.json(executions);
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/automations/:id/executions/:execId — Get execution with runs */
  router.get('/:id/executions/:execId', async (req, res, next) => {
    try {
      const execution = await automationService.getExecutionWithRuns(param(req, 'execId'));
      if (execution.automationId !== param(req, 'id')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Execution not found' } });
        return;
      }
      res.json(execution);
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/automations/:id/executions/:execId/cancel — Cancel running execution */
  router.post('/:id/executions/:execId/cancel', async (req, res, next) => {
    try {
      const execution = await automationService.getExecution(param(req, 'execId'));
      if (execution.automationId !== param(req, 'id')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Execution not found' } });
        return;
      }
      await automationService.cancelExecution(param(req, 'execId'));
      res.json({ status: 'cancelled' });
    } catch (err) {
      next(err);
    }
  });

  // Kept for future observability hooks.
  void logger;

  return router;
}
