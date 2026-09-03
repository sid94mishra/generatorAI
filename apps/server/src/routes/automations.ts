// ────────────────────────────────────────────────────────────────
// Automation Routes — REST endpoints for automation management
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { Container } from '../composition-root.js';
import { validate } from '../middleware/validate.js';
import {
  CreateAutomationSchema,
  UpdateAutomationSchema,
  TestDataSourceSchema,
  TriggerAutomationBodySchema,
  PreviewIterationsBodySchema,
  ValidationError,
} from '@generatorai/shared';
import { previewIterations } from '@generatorai/core';

/** Idempotency-key TTL — 5 minutes covers typical webhook retry windows. */
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const IDEMPOTENCY_MAX_KEY_LEN = 200;

export function createAutomationRoutes(container: Container): Router {
  const router = Router();
  const { automationService, idempotencyKeyRepo, logger } = container;

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

  /** POST /api/automations — Create a new automation */
  router.post('/', validate(CreateAutomationSchema), async (req, res, next) => {
    try {
      const automation = await automationService.createAutomation(req.body);
      res.status(201).json(automation);
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/automations — List all automations */
  router.get('/', async (req, res, next) => {
    try {
      const projectId = req.query['projectId'] as string | undefined;
      const automations = await automationService.listAutomations(projectId);
      res.json(automations);
    } catch (err) {
      next(err);
    }
  });

  // ── Data Source Testing (E1) — MUST be before /:id routes ──

  /** POST /api/automations/test-data-source — Test a data source configuration */
  router.post('/test-data-source', validate(TestDataSourceSchema), async (req, res, next) => {
    try {
      const result = await automationService.testDataSource(req.body);
      res.json(result);
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

  /** GET /api/automations/:id — Get automation with recent executions */
  router.get('/:id', async (req, res, next) => {
    try {
      const automation = await automationService.getAutomationWithExecutions(param(req, 'id'));
      res.json(automation);
    } catch (err) {
      next(err);
    }
  });

  /** PATCH /api/automations/:id — Update automation */
  router.patch('/:id', validate(UpdateAutomationSchema), async (req, res, next) => {
    try {
      const automation = await automationService.updateAutomation(param(req, 'id'), req.body);
      res.json(automation);
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
      res.json(automation);
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/automations/:id/disable — Disable automation */
  router.post('/:id/disable', async (req, res, next) => {
    try {
      const automation = await automationService.disableAutomation(param(req, 'id'));
      res.json(automation);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/automations/:id/rotate-webhook-token — Regenerate the webhook
   * token. Phase 2, 2.10 — use when a leaked token needs to be invalidated
   * without recreating the automation.
   */
  router.post('/:id/rotate-webhook-token', async (req, res, next) => {
    try {
      const automation = await automationService.rotateWebhookToken(param(req, 'id'));
      res.json(automation);
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

  /** POST /api/automations/webhooks/:token — Webhook trigger endpoint */
  router.post('/webhooks/:token', async (req, res, next) => {
    try {
      const token = param(req, 'token');
      const scope = `webhook:${token}`;
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
