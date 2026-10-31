// ────────────────────────────────────────────────────────────────
// Platform tool routes (D-181) — the platform tools of chats and stages
// (chats, projects, agents, automations, Needs you, chat files), for an agent
// OUTSIDE the server (an MCP client through `generatorai-mcp`, a script).
// The same `buildPlatformToolSet` handlers run here for an `external`
// caller, so the descriptions, the limits and the refusals are the ones an
// in-app agent gets.
//
//   GET  /platform-tools          {tools: [{name, description, parametersSchema, toolset, readOnly, destructive, idempotent, scopes}]}
//   POST /platform-tools/:name    {arguments, idempotencyKey?, clientName?} → {result}
//
// The caller is the authenticated principal. The route policy only asks for
// `read:chats`; each tool checks its own scopes (writing a chat needs
// `write:chats`, triggering an automation `exec:agent`, …). An external
// caller is capped at acceptEdits whatever it holds. `idempotencyKey` is the
// tool call id (MCP calls carry no headers): a retried call answers the
// first result.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { buildPlatformToolSet, describePlatformTools, type PlatformToolCaller } from '@generatorai/core';
import type { Container } from '../composition-root.js';
import { invocationPrincipal } from './workflowInvocations.js';

export function createPlatformToolRoutes(container: Container): Router {
  const router = Router();
  const host = container.platformToolHost;

  router.get('/', (_req, res) => {
    res.json({ tools: describePlatformTools() });
  });

  router.post('/:name', async (req, res, next) => {
    try {
      const name = String(req.params['name']);
      const body = (req.body ?? {}) as { arguments?: unknown; idempotencyKey?: unknown; clientName?: unknown };
      const device = req.principal?.deviceId ? await container.security.devices.getDevice(req.principal.deviceId).catch(() => null) : null;
      const caller: PlatformToolCaller = {
        kind: 'external',
        principal: invocationPrincipal(req),
        via: device?.platform === 'mcp' ? 'mcp' : 'http',
        ...(typeof body.clientName === 'string' && body.clientName ? { clientName: body.clientName.slice(0, 200) } : {}),
      };
      const tool = buildPlatformToolSet(host, caller).find((t) => t.name === name);
      if (!tool) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `No platform tool "${name}"` } });
        return;
      }
      const args = body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments) ? (body.arguments as Record<string, unknown>) : {};
      const key = typeof body.idempotencyKey === 'string' && /^[!-~]{1,200}$/.test(body.idempotencyKey) ? body.idempotencyKey : undefined;
      res.json({ result: await tool.handler(args, key ? { toolCallId: key } : {}) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
