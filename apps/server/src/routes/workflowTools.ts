// ────────────────────────────────────────────────────────────────
// Workflow tool routes (P06 WP-6.8) — the workflow tools of chats and
// stages, for an agent OUTSIDE the server (an MCP client through
// `generatorai-mcp`, a script). The same `buildWorkflowToolSet` handlers run
// here for an `external` caller, so the description text, the limits and
// the refusals are the ones an in-app agent gets.
//
//   GET  /workflow-tools          [{name, description, parametersSchema, readOnly}]
//   POST /workflow-tools/:name    {arguments, idempotencyKey?, clientName?} → the tool's result
//
// The caller is the authenticated principal; the trigger is
// `external_agent` (via `mcp` for an MCP device, else `http`). Each tool
// checks its own scope: running needs `exec:agent`, a draft
// `write:workflows`. `idempotencyKey` is the tool call id (MCP calls carry
// no headers): a retried call answers the same run.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { buildWorkflowToolSet, describeWorkflowTools, type WorkflowToolCaller } from '@generatorai/core';
import type { Container } from '../composition-root.js';
import { isLoopbackRequest } from '../middleware/auth.js';
import { invocationPrincipal } from './workflowInvocations.js';

const GROUPS = { run: true, authoring: true } as const;

export function createWorkflowToolRoutes(container: Container): Router {
  const router = Router();
  const host = container.workflowToolHost;

  router.get('/', (_req, res) => {
    res.json({ tools: describeWorkflowTools(host, GROUPS) });
  });

  router.post('/:name', async (req, res, next) => {
    try {
      const name = String(req.params['name']);
      const body = (req.body ?? {}) as { arguments?: unknown; idempotencyKey?: unknown; clientName?: unknown };
      const principal = invocationPrincipal(req);
      const device = req.principal?.deviceId ? await container.security.devices.getDevice(req.principal.deviceId).catch(() => null) : null;
      const caller: WorkflowToolCaller = {
        kind: 'external',
        principal,
        via: device?.platform === 'mcp' ? 'mcp' : 'http',
        ...(typeof body.clientName === 'string' && body.clientName ? { clientName: body.clientName.slice(0, 200) } : {}),
        loopback: isLoopbackRequest(req),
      };
      const tool = buildWorkflowToolSet(host, caller, GROUPS).find((t) => t.name === name);
      if (!tool) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `No workflow tool "${name}"` } });
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
