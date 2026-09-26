// ────────────────────────────────────────────────────────────────
// Workflow invocation routes — THE way a run starts over HTTP (P04 WP-4.3;
// G4 §1.3.6). Every client (web, desktop, mobile, CLI, TUI, the MCP server
// in remote mode) calls these; there is no other run-start route.
//
//   POST /workflow-invocations          JSON `InvocationRequest`, or
//                                       multipart with a `request` field and
//                                       `skills|agents|prompts` files (staged
//                                       as upload ids first) → 202 result
//   POST /workflow-invocations/uploads  multipart → {uploads: [{uploadId,
//                                       category, name}]} (TTL 1 h)
//   POST /workflow-invocations/plan     same body → `InvocationPlan` (no rows)
//   GET  /workflow-invocations/:runId/digest?wait=30
//                                       the run digest; `wait` long-polls up
//                                       to that many seconds for `finalized`
//                                       (or an approval with `stopOnApproval`)
//
// ONE error envelope: `{error: {code, message, issues[]}}`. The trigger is
// derived from the authenticated principal, never read from the body:
// a paired device or the local owner is `user`, a service account or an
// MCP client is `external_agent`. Scopes (PD-6): the route policy admits
// `exec:agent` + `read:workflows`; the service demands `write:workflows`
// for a script target and `admin:settings` for bypass off loopback or an
// in-place codebase.
// ────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { ALL_SCOPES } from '@generatorai/auth';
import { InvocationError, type InvocationContext, type InvocationPrincipal } from '@generatorai/core';
import { NotFoundError } from '@generatorai/shared';
import type { InvocationTrigger } from '@generatorai/workflow-spec';
import type { Container } from '../composition-root.js';
import { isLoopbackRequest } from '../middleware/auth.js';

const CATEGORIES = ['skills', 'agents', 'prompts'] as const;
type Category = (typeof CATEGORIES)[number];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 60 } });

/** Who asks, as the invocation sees it. No principal is unauthenticated loopback development: the owner. */
export function invocationPrincipal(req: Request): InvocationPrincipal {
  const p = req.principal;
  if (!p) return { kind: 'local', id: 'local', scopes: ALL_SCOPES };
  const kind: InvocationPrincipal['kind'] =
    p.type === 'service-account' ? 'service_account' : p.type === 'paired-device' || p.type === 'user-session' ? 'device' : 'local';
  return { kind, id: p.deviceId ?? p.id, scopes: p.scopes };
}

/** The server-derived trigger (G4 §1.3.3): never from the body; the body's `client` is a label only. */
export function invocationTrigger(req: Request, principal: InvocationPrincipal, client: string | undefined): InvocationTrigger {
  if (principal.kind === 'service_account') return { kind: 'external_agent', via: 'http', principalId: principal.id };
  if (client === 'mcp') return { kind: 'external_agent', via: 'mcp', principalId: principal.id };
  return { kind: 'user', client: client ?? 'http', principalId: principal.id };
}

function contextOf(req: Request, body: unknown): InvocationContext {
  const principal = invocationPrincipal(req);
  const client = body && typeof body === 'object' ? (body as { client?: unknown }).client : undefined;
  const key = String(req.header('idempotency-key') ?? '').trim();
  return {
    principal,
    trigger: invocationTrigger(req, principal, typeof client === 'string' ? client : undefined),
    loopback: isLoopbackRequest(req),
    ...(key ? { idempotencyKey: key } : {}),
  };
}

/** The one error envelope of these routes. */
function sendError(res: Response, err: unknown, next: (err: unknown) => void): void {
  if (err instanceof InvocationError) {
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message, issues: err.issues } });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: err.message, issues: [] } });
    return;
  }
  next(err);
}

/** Files of a multipart request, by category field. */
function filesOf(req: Request): Array<{ category: Category; name: string; data: Uint8Array }> {
  const raw = (req.files as Express.Multer.File[] | undefined) ?? [];
  const out: Array<{ category: Category; name: string; data: Uint8Array }> = [];
  for (const f of raw) {
    const category = (CATEGORIES as readonly string[]).includes(f.fieldname) ? (f.fieldname as Category) : undefined;
    if (!category) throw new InvocationError('VALIDATION_ERROR', `Unknown upload field "${f.fieldname}" (use skills, agents or prompts)`);
    out.push({ category, name: f.originalname, data: f.buffer });
  }
  return out;
}

export function createWorkflowInvocationRoutes(container: Container): Router {
  const router = Router();
  const { workflowInvocationService: invocations } = container;

  // POST /workflow-invocations/uploads — stage files for a run that has not started
  router.post('/uploads', upload.any(), async (req, res, next) => {
    try {
      const files = filesOf(req);
      if (files.length === 0) throw new InvocationError('VALIDATION_ERROR', 'No files: send them in the skills, agents or prompts fields');
      const principal = invocationPrincipal(req);
      res.status(201).json({ uploads: await invocations.stageUploads(files, principal.id) });
    } catch (err) {
      sendError(res, err, next);
    }
  });

  // POST /workflow-invocations/plan — what an invocation would do
  router.post('/plan', async (req, res, next) => {
    try {
      res.json(await invocations.plan(req.body, contextOf(req, req.body)));
    } catch (err) {
      sendError(res, err, next);
    }
  });

  // POST /workflow-invocations — start a run (JSON, or multipart `request` + files)
  router.post('/', upload.any(), async (req, res, next) => {
    try {
      let body: unknown = req.body;
      if (req.is('multipart/form-data')) {
        const text = (req.body as { request?: unknown }).request;
        if (typeof text !== 'string') throw new InvocationError('VALIDATION_ERROR', 'A multipart invocation carries its request as JSON in the `request` field');
        try {
          body = JSON.parse(text);
        } catch {
          throw new InvocationError('VALIDATION_ERROR', 'The `request` field is not valid JSON');
        }
        const files = filesOf(req);
        if (files.length > 0) {
          const staged = await invocations.stageUploads(files, invocationPrincipal(req).id);
          const prior = Array.isArray((body as { uploads?: unknown }).uploads) ? ((body as { uploads: unknown[] }).uploads) : [];
          body = { ...(body as object), uploads: [...prior, ...staged.map((u) => ({ uploadId: u.uploadId, category: u.category }))] };
        }
      }
      const result = await invocations.invoke(body, contextOf(req, body));
      if (result.replayed) res.setHeader('X-Idempotent-Replay', 'true');
      res.status(202).json(result);
    } catch (err) {
      sendError(res, err, next);
    }
  });

  // GET /workflow-invocations/:runId/digest?wait=30&stopOnApproval=true&detail=full
  router.get('/:runId/digest', async (req, res, next) => {
    try {
      const runId = String(req.params['runId']);
      const wait = Math.min(Math.max(Number(req.query['wait'] ?? 0) || 0, 0), 60);
      const detail = req.query['detail'] === 'full' ? 'full' : 'brief';
      if (wait <= 0) {
        res.json(await invocations.digest(runId, { detail }));
        return;
      }
      const ac = new AbortController();
      req.on('close', () => ac.abort());
      const digest = await invocations.waitFor(runId, {
        timeoutMs: wait * 1000,
        stopOnApproval: req.query['stopOnApproval'] === 'true',
        signal: ac.signal,
      });
      res.json(detail === 'full' ? await invocations.digest(runId, { detail }).then((d) => ({ ...d, waited: digest.waited })) : digest);
    } catch (err) {
      sendError(res, err, next);
    }
  });

  return router;
}
