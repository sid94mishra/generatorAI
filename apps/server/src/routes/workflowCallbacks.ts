// ────────────────────────────────────────────────────────────────
// Workflow callbacks — POST /api/workflow-callbacks/:token (P05 §4.3).
//
// The per-wait callback of an event wait: an external system (CI, a deploy
// pipeline) delivers the wait's event with NO user credential. The route is
// public in `routePolicy`; the token authenticates the delivery:
//   - it names one run and one wait instance and carries an HMAC over
//     (run, instance, the wait's evaluated event key) under the server's
//     callback key, verified in constant time against the waiting wait;
//   - the event it delivers is that wait's key, nothing else, into that run
//     only (the `deliver_event` run command, idempotent per key).
// Body: `{data?, idempotencyKey?}` (or the `Idempotency-Key` header); a
// delivery without a key is keyed by its wait and its data, so a retried
// POST replays while a second wait on the same event key still gets its
// own delivery. 202 delivered, 200 replayed, 409 the same key with other
// data or the wait is not waiting any more, 404 an unknown or invalid
// token, 429 over the rate limit (per token, and per client address: the
// forwarded client of a proxy on this machine, else the peer).
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { isLoopbackAddress } from '@generatorai/auth';
import { canonicalJson } from '@generatorai/workflow-spec';
import type { Container } from '../composition-root.js';

const CallbackBodySchema = z
  .object({
    data: z.unknown().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();

/** A fixed-window counter per key (process-local; the route is low volume by design). */
class WindowLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || now - h.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: now, count: 1 });
      if (this.hits.size > 10_000) this.sweep(now);
      return true;
    }
    h.count += 1;
    return h.count <= this.limit;
  }

  private sweep(now: number): void {
    for (const [k, h] of this.hits) if (now - h.windowStart >= this.windowMs) this.hits.delete(k);
  }
}

/**
 * The address a delivery is rate limited by: the socket's peer, or — a peer
 * on this machine (a reverse proxy in front of the server) — the client it
 * forwarded for, so every delivery through the proxy does not share one
 * bucket. A remote peer's forwarding headers are ignored (anyone can send
 * them). The relay bridge connects from loopback without them: paired
 * devices share its bucket.
 */
function clientAddress(req: { socket: { remoteAddress?: string | undefined }; header(name: string): string | undefined }): string {
  const peer = req.socket.remoteAddress ?? 'unknown';
  if (!isLoopbackAddress(peer)) return peer;
  const forwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded ? `fwd:${forwarded}` : peer;
}

/**
 * The idempotency key of a delivery that brings none: per wait and data, so
 * a retried POST replays but a second wait on the same event key still gets
 * its own delivery (MAPWAIT-R4).
 */
export function defaultDeliveryKey(instanceId: string, data: unknown): string {
  return `callback:${instanceId}:${createHash('sha256').update(canonicalJson(data)).digest('hex').slice(0, 32)}`;
}

export function createWorkflowCallbackRoutes(container: Container): Router {
  const router = Router();
  const { workflowCallbacks, workflowRunService, stageRunRepo, logger } = container;
  const perToken = new WindowLimiter(20, 60_000);
  const perAddress = new WindowLimiter(60, 60_000);
  const notFound = { error: { code: 'NOT_FOUND', message: 'Unknown or invalid callback' } };

  router.post('/:token', async (req, res, next) => {
    try {
      const token = String(req.params['token'] ?? '');
      if (!perAddress.allow(clientAddress(req)) || !perToken.allow(token)) {
        res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many callback deliveries; retry in a minute' } });
        return;
      }
      const parts = workflowCallbacks.parse(token);
      if (!parts) {
        res.status(404).json(notFound);
        return;
      }
      const inst = await stageRunRepo.getById(parts.instanceId).catch(() => null);
      const wait = inst?.interruptData as { kind?: string; type?: string; eventKey?: string } | undefined;
      if (!inst || inst.workflowRunId !== parts.runId || inst.kind !== 'wait') {
        res.status(404).json(notFound);
        return;
      }
      if (inst.status !== 'waiting' || wait?.kind !== 'wait' || wait.type !== 'event' || wait.eventKey === undefined) {
        // Nothing is delivered either way: the wait resolved (or is not an event wait).
        res.status(409).json({ error: { code: 'NOT_WAITING', message: 'The wait is not waiting for an event' } });
        return;
      }
      if (!workflowCallbacks.verify(token, wait.eventKey)) {
        res.status(404).json(notFound);
        return;
      }
      const parsed = CallbackBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The body is {data?, idempotencyKey?}', fields: parsed.error.flatten().fieldErrors } });
        return;
      }
      const data = parsed.data.data ?? null;
      const header = req.header('idempotency-key')?.trim();
      const idempotencyKey =
        parsed.data.idempotencyKey ??
        (header && header.length <= 200 ? header : defaultDeliveryKey(parts.instanceId, data));
      const r = await workflowRunService.command(parts.runId, { command: 'deliver_event', eventKey: wait.eventKey, idempotencyKey, data }, { actor: 'callback' });
      if (!r.ok) {
        const status = r.code === 'version_conflict' ? 409 : r.code === 'not_found' ? 404 : r.code === 'engine_unavailable' ? 503 : 409;
        res.status(status).json({ error: { code: r.code.toUpperCase(), message: r.message } });
        return;
      }
      logger.info(`[WorkflowCallbacks] event '${wait.eventKey}' delivered to run ${parts.runId}${r.replayed ? ' (replayed)' : ''}`, { requestId: req.requestId });
      res.status(r.replayed ? 200 : 202).json({ runId: parts.runId, eventKey: wait.eventKey, ...(r.replayed ? { replayed: true } : { delivered: true }) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
