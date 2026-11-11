// ────────────────────────────────────────────────────────────────
// ACP agent routes (docs/acp/README.md › API) — the catalogue of every ACP
// Registry agent and custom agent, with install / update / uninstall,
// enable / disable, per-agent env, sign-in and connection tests.
//
// Reads need `read:status`, everything else `admin:harnesses` (the `/acp`
// route policy, like `/harness`). Every mutation answers the full
// `AcpAgentsResponse`, so a client replaces its list in one step; an install
// answers 202 at once and `GET /agents` reports `installing` until it is done.
// ────────────────────────────────────────────────────────────────

import { Router, type NextFunction, type Response } from 'express';
import { z } from 'zod';
import type { Container } from '../composition-root.js';
import { AcpAgentsError } from '../settings/acpAgents.js';

const IdParam = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const EnabledBody = z.object({ enabled: z.boolean() }).strict();
const EnvBody = z
  .object({
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), z.string().max(16_384).nullable()),
  })
  .strict();
const MethodBody = z.object({ methodId: z.string().min(1).max(256) }).strict();
const CustomBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    command: z.string().trim().min(1).max(4096),
    args: z.array(z.string().max(4096)).max(64).optional(),
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), z.string().max(16_384)).optional(),
  })
  .strict();

const STATUS: Record<AcpAgentsError['code'], number> = { NOT_FOUND: 404, CONFLICT: 409, INVALID: 400, UNAVAILABLE: 409 };

export function createAcpRoutes(container: Container): Router {
  const router = Router();
  const { acpAgents, logger } = container;

  const fail = (err: unknown, res: Response, next: NextFunction): void => {
    if (err instanceof AcpAgentsError) {
      res.status(STATUS[err.code]).json({ error: { code: err.code, message: err.message } });
      return;
    }
    next(err);
  };
  const idOf = (raw: unknown, res: Response): string | null => {
    const parsed = IdParam.safeParse(raw);
    if (!parsed.success) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: `Unknown ACP agent "${String(raw)}"` } });
      return null;
    }
    return parsed.data;
  };
  const body = <T>(schema: z.ZodType<T>, raw: unknown, res: Response): T | null => {
    const parsed = schema.safeParse(raw ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return null;
    }
    return parsed.data;
  };

  // GET /acp/agents — the catalogue with each agent's install, enable and sign-in state.
  router.get('/agents', async (_req, res, next) => {
    try {
      res.json(await acpAgents.list());
    } catch (err) {
      fail(err, res, next);
    }
  });

  // POST /acp/registry/refresh — fetch the registry now (If-None-Match), not waiting for the hourly refresh.
  router.post('/registry/refresh', async (_req, res, next) => {
    try {
      res.json(await acpAgents.refresh());
    } catch (err) {
      fail(err, res, next);
    }
  });

  // POST /acp/agents/:id/install (and /update) — download/npm-install the registry version in the background.
  for (const action of ['install', 'update'] as const) {
    router.post(`/agents/:id/${action}`, async (req, res, next) => {
      const id = idOf(req.params['id'], res);
      if (!id) return;
      try {
        const out = await acpAgents.install(id);
        logger.info(`[AcpRoutes] ${action} ${id} requested`, { requestId: req.requestId });
        res.status(202).json(out);
      } catch (err) {
        fail(err, res, next);
      }
    });
  }

  // DELETE /acp/agents/:id/install — stop, disable and remove an installed agent.
  router.delete('/agents/:id/install', async (req, res, next) => {
    const id = idOf(req.params['id'], res);
    if (!id) return;
    try {
      res.json(await acpAgents.uninstall(id));
    } catch (err) {
      fail(err, res, next);
    }
  });

  // PUT /acp/agents/:id/enabled { enabled } — in or out of the model picker, live.
  router.put('/agents/:id/enabled', async (req, res, next) => {
    const id = idOf(req.params['id'], res);
    const b = id ? body(EnabledBody, req.body, res) : null;
    if (!id || !b) return;
    try {
      res.json(await acpAgents.setEnabled(id, b.enabled));
    } catch (err) {
      fail(err, res, next);
    }
  });

  // PUT /acp/agents/:id/env { env: { NAME: value | null } } — per-agent variables, kept in the secret store.
  router.put('/agents/:id/env', async (req, res, next) => {
    const id = idOf(req.params['id'], res);
    const b = id ? body(EnvBody, req.body, res) : null;
    if (!id || !b) return;
    try {
      res.json(await acpAgents.setEnv(id, b.env));
    } catch (err) {
      fail(err, res, next);
    }
  });

  // POST /acp/agents/:id/authenticate { methodId } — an `agent` sign-in method; resolves when the agent is done.
  router.post('/agents/:id/authenticate', async (req, res, next) => {
    const id = idOf(req.params['id'], res);
    const b = id ? body(MethodBody, req.body, res) : null;
    if (!id || !b) return;
    try {
      res.json(await acpAgents.authenticate(id, b.methodId));
    } catch (err) {
      fail(err, res, next);
    }
  });

  // POST /acp/agents/:id/logout — when the agent advertises it.
  router.post('/agents/:id/logout', async (req, res, next) => {
    const id = idOf(req.params['id'], res);
    if (!id) return;
    try {
      res.json(await acpAgents.logout(id));
    } catch (err) {
      fail(err, res, next);
    }
  });

  // POST /acp/agents/:id/terminal-auth { methodId } — the exact command/args/env of a terminal sign-in.
  // POST (not GET): the env carries the user's per-agent secrets.
  router.post('/agents/:id/terminal-auth', async (req, res, next) => {
    const id = idOf(req.params['id'], res);
    const b = id ? body(MethodBody, req.body, res) : null;
    if (!id || !b) return;
    try {
      res.json(await acpAgents.terminalAuth(id, b.methodId));
    } catch (err) {
      fail(err, res, next);
    }
  });

  // POST /acp/agents/:id/reinitialize — restart the agent and re-probe (after a terminal sign-in exited 0).
  router.post('/agents/:id/reinitialize', async (req, res, next) => {
    const id = idOf(req.params['id'], res);
    if (!id) return;
    try {
      res.json(await acpAgents.reinitialize(id));
    } catch (err) {
      fail(err, res, next);
    }
  });

  // POST /acp/agents/:id/test — a separate fresh connection: starts? signed in? how many models?
  router.post('/agents/:id/test', async (req, res, next) => {
    const id = idOf(req.params['id'], res);
    if (!id) return;
    try {
      res.json(await acpAgents.test(id));
    } catch (err) {
      fail(err, res, next);
    }
  });

  // POST /acp/custom { name, command, args?, env? } — a custom agent (ACP-10), enabled at once.
  router.post('/custom', async (req, res, next) => {
    const b = body(CustomBody, req.body, res);
    if (!b) return;
    try {
      res.status(201).json(await acpAgents.addCustom(b));
    } catch (err) {
      fail(err, res, next);
    }
  });

  // DELETE /acp/custom/:id
  router.delete('/custom/:id', async (req, res, next) => {
    const id = idOf(req.params['id'], res);
    if (!id) return;
    try {
      res.json(await acpAgents.removeCustom(id));
    } catch (err) {
      fail(err, res, next);
    }
  });

  return router;
}
