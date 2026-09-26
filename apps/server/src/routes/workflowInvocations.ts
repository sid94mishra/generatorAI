// ────────────────────────────────────────────────────────────────
// Workflow invocation routes — THE way a run starts over HTTP (P04 WP-4.3;
// G4 §1.3.6). Every client (web, desktop, mobile, CLI, TUI, the MCP server
// in remote mode) calls these; there is no other run-start route.
//
//   POST /workflow-invocations          JSON `InvocationRequest`, or
//                                       multipart with a `request` field and
//                                       `skills|agents|prompts` files (staged
//                                       by the start that claims the
//                                       idempotency key) → 202 result
//   POST /workflow-invocations/uploads  multipart → {uploads: [{uploadId,
//                                       category, name}]} (TTL 1 h)
//   POST /workflow-invocations/plan     same body → `InvocationPlan` (no rows)
//   GET  /workflow-invocations/:runId/digest?wait=30
//                                       the run digest; `wait` long-polls up
//                                       to that many seconds for `finalized`
//                                       (or an approval with `stopOnApproval`)
//
// ONE error envelope: `{error: {code, message, issues[]}}` (a body over the
// upload limits is a 413 in it). The trigger is derived from the
// authenticated principal, never read from the body: a person (the local
// owner, a signed-in user, a paired device that is not an MCP server) is
// `user`; a service account or an `mcp` device is `external_agent`.
// Scopes (PD-6): the route policy admits `exec:agent` + `read:workflows`;
// the service demands `write:workflows` for a script target and
// `admin:settings` for a resolved bypass run (off loopback, or from an
// agent) or an in-place mount. A caller that may not drop the approval
// gate starts runs under an `acceptEdits` ceiling.
// ────────────────────────────────────────────────────────────────

import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ALL_SCOPES } from '@generatorai/auth';
import { InvocationError, MAX_UPLOAD_TOTAL_BYTES, type InvocationContext, type InvocationPrincipal } from '@generatorai/core';
import { NotFoundError } from '@generatorai/shared';
import type { InvocationTrigger } from '@generatorai/workflow-spec';
import type { Container } from '../composition-root.js';
import { isLoopbackRequest } from '../middleware/auth.js';

const CATEGORIES = ['skills', 'agents', 'prompts'] as const;
type Category = (typeof CATEGORIES)[number];

const multerAny = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 60 } }).any();

/**
 * The multipart files, or a 413 in the route's envelope (CONVINV-R19): a
 * declared body over the total cap is refused before anything is buffered,
 * and multer's own limits answer the same way instead of falling through to
 * the generic error handler.
 */
const upload: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const declared = Number(req.header('content-length') ?? 0);
  if (declared > MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024) {
    tooLarge(res, `The request is larger than ${MAX_UPLOAD_TOTAL_BYTES / (1024 * 1024)} MB`);
    return;
  }
  multerAny(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      tooLarge(res, err.code === 'LIMIT_FILE_SIZE' ? 'A file is larger than 10 MB' : err.message, err.code);
      return;
    }
    next(err);
  });
};

function tooLarge(res: Response, message: string, detail?: string): void {
  res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message, issues: detail ? [{ code: detail, path: ['files'], message, severity: 'error' }] : [] } });
}

/** Who asks, as the invocation sees it. No principal is unauthenticated loopback development: the owner. */
export function invocationPrincipal(req: Request): InvocationPrincipal {
  const p = req.principal;
  if (!p) return { kind: 'local', id: 'local', scopes: ALL_SCOPES };
  const kind: InvocationPrincipal['kind'] =
    p.type === 'service-account' ? 'service_account' : p.type === 'paired-device' || p.type === 'user-session' ? 'device' : 'local';
  return { kind, id: p.deviceId ?? p.id, scopes: p.scopes };
}

/** The platform of a paired device's record (`mcp` marks an MCP server). */
async function devicePlatformOf(req: Request, container: Container): Promise<string | undefined> {
  const p = req.principal;
  if (p?.type !== 'paired-device' || !p.deviceId) return undefined;
  const device = await container.security.devices.getDevice(p.deviceId).catch(() => null);
  return device?.platform;
}

/**
 * THE person predicate (PD-14): the local owner, a signed-in user, a paired
 * device that is not an MCP server (its device record says which). Service
 * accounts, internal services and MCP devices are agents.
 */
export async function isPersonRequest(req: Request, container: Container): Promise<boolean> {
  const p = req.principal;
  if (!p) return true; // unauthenticated loopback development: the owner
  if (p.type === 'local-desktop' || p.type === 'user-session') return true;
  if (p.type !== 'paired-device') return false;
  return (await devicePlatformOf(req, container)) !== 'mcp';
}

/**
 * The server-derived trigger (G4 §1.3.3): from the principal and its device
 * record, never from the body; the body's `client` is a label only.
 */
async function invocationTrigger(req: Request, container: Container, principal: InvocationPrincipal, client: string | undefined): Promise<InvocationTrigger> {
  if (await isPersonRequest(req, container)) return { kind: 'user', client: client ?? 'http', principalId: principal.id };
  const via = (await devicePlatformOf(req, container)) === 'mcp' ? 'mcp' : 'http';
  return { kind: 'external_agent', via, principalId: principal.id };
}

/**
 * The trusted context of an HTTP invocation. A caller that may not drop the
 * approval gate (no `admin:settings`, and not a person on loopback) gets an
 * `acceptEdits` ceiling (CONVINV-R1): a bypass it asks for, or a fork
 * inherits, is refused, and a definition's own bypass (workflow or stage) is
 * capped instead of widening what the caller may do.
 */
export async function invocationContext(req: Request, container: Container, body: unknown): Promise<InvocationContext> {
  const principal = invocationPrincipal(req);
  const client = body && typeof body === 'object' ? (body as { client?: unknown }).client : undefined;
  const key = String(req.header('idempotency-key') ?? '').trim();
  const trigger = await invocationTrigger(req, container, principal, typeof client === 'string' ? client : undefined);
  const loopback = isLoopbackRequest(req);
  const mayBypass = principal.scopes.includes('admin:settings') || (trigger.kind === 'user' && loopback);
  return {
    principal,
    trigger,
    loopback,
    ...(mayBypass ? {} : { callerPermissionCeiling: 'acceptEdits' as const }),
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
  router.post('/uploads', upload, async (req, res, next) => {
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
      res.json(await invocations.plan(req.body, await invocationContext(req, container, req.body)));
    } catch (err) {
      sendError(res, err, next);
    }
  });

  // POST /workflow-invocations — start a run (JSON, or multipart `request` + files)
  router.post('/', upload, async (req, res, next) => {
    try {
      let body: unknown = req.body;
      let files: ReturnType<typeof filesOf> = [];
      if (req.is('multipart/form-data')) {
        const text = (req.body as { request?: unknown }).request;
        if (typeof text !== 'string') throw new InvocationError('VALIDATION_ERROR', 'A multipart invocation carries its request as JSON in the `request` field');
        try {
          body = JSON.parse(text);
        } catch {
          throw new InvocationError('VALIDATION_ERROR', 'The `request` field is not valid JSON');
        }
        // Staged by the start that claims the key: a retry replays (CONVINV-R6).
        files = filesOf(req);
      }
      const result = await invocations.invoke(body, await invocationContext(req, container, body), files);
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
