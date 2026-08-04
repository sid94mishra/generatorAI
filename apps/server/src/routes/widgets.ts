// ────────────────────────────────────────────────────────────────
// Widget Routes — REST surface for the widget iframe → server bridge.
//
//   GET    /api/widgets                                  — list active instances (filter by chat/run/session)
//   GET    /api/widgets/:id                              — read one
//   POST   /api/widgets                                  — create (used by extension-authoring tools)
//   PATCH  /api/widgets/:id/state                        — widget → server state sync
//   POST   /api/widgets/:id/actions                      — widget → server user action
//   DELETE /api/widgets/:id                              — close a widget
//
// All these endpoints emit the appropriate `harness.widget.*` event so
// SSE subscribers receive the same updates whether the change came from
// the agent (via ui.render tool) or the widget (via postMessage → REST).
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';
import type { WidgetInstance } from '@generatorai/shared';
import {
  CreateWidgetInstanceSchema,
  DispatchWidgetActionSchema,
  UpdateWidgetStateSchema,
  WidgetInvokeResultSchema,
} from '@generatorai/shared';

export function createWidgetRoutes(container: Container): Router {
  const router = Router({ mergeParams: true });
  const { widgetService } = container;

  router.get('/', async (req, res) => {
    const chatId = typeof req.query['chatId'] === 'string' ? req.query['chatId'] : undefined;
    const workflowRunId =
      typeof req.query['workflowRunId'] === 'string' ? req.query['workflowRunId'] : undefined;
    const sessionId = typeof req.query['sessionId'] === 'string' ? req.query['sessionId'] : undefined;
    let items: WidgetInstance[] = [];
    if (chatId) items = await widgetService.listByChat(chatId);
    else if (workflowRunId) items = await widgetService.listByRun(workflowRunId);
    else if (sessionId) items = await widgetService.listBySession(sessionId);
    // Enrich each instance with its render payload (descriptor fields +
    // assetsBase) so the web client can RECONSTITUTE widgets on chat mount
    // straight from the DB — independent of the SSE event-replay window.
    const render = items
      .map((inst) => widgetService.buildRenderPayload(inst))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    res.json({ instances: items, render });
  });

  router.get('/:id', async (req, res) => {
    const inst = await widgetService.getInstance(String(req.params['id']));
    if (!inst) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Widget instance not found' } });
      return;
    }
    res.json({ instance: inst });
  });

  router.post('/', async (req, res, next) => {
    try {
      const parsed = CreateWidgetInstanceSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'VALIDATION', message: parsed.error.message, issues: parsed.error.issues },
        });
        return;
      }
      const instance = await widgetService.createInstance({
        descriptorId: parsed.data.descriptorId,
        sessionId: parsed.data.sessionId,
        chatId: parsed.data.chatId,
        workflowRunId: parsed.data.workflowRunId,
        stageRunId: parsed.data.stageRunId,
        messageId: parsed.data.messageId,
        surface: parsed.data.surface,
        props: parsed.data.props,
        state: parsed.data.state,
      });
      res.status(201).json({ instance });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id/state', async (req, res, next) => {
    try {
      const parsed = UpdateWidgetStateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'VALIDATION', message: parsed.error.message, issues: parsed.error.issues },
        });
        return;
      }
      const updated = await widgetService.updateState(
        String(req.params['id']),
        parsed.data.state,
        parsed.data.patch,
        'user',
      );
      if (!updated) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Widget instance not found' } });
        return;
      }
      res.json({ instance: updated });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/actions', async (req, res, next) => {
    try {
      const parsed = DispatchWidgetActionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'VALIDATION', message: parsed.error.message, issues: parsed.error.issues },
        });
        return;
      }
      const instance = await widgetService.dispatchAction(
        String(req.params['id']),
        parsed.data.action,
        parsed.data.payload,
        parsed.data.from,
      );
      if (!instance) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Widget instance not found' } });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Client bridge posts the result of a `widget:invoke` round-trip so the
  // server-side `widget_action` / `widget_exec` pending promise resolves.
  router.post('/:id/invoke-result', async (req, res, next) => {
    try {
      const parsed = WidgetInvokeResultSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'VALIDATION', message: parsed.error.message, issues: parsed.error.issues },
        });
        return;
      }
      const ok = widgetService.resolveInvoke(
        parsed.data.invokeId,
        parsed.data.result,
        parsed.data.error,
      );
      res.json({ ok });
    } catch (err) {
      next(err);
    }
  });

  // Widget → agent: buffer a model-visible context note (the
  // `sendWidgetContext` / MCP-Apps `ui/update-model-context` path). Does NOT
  // wake the agent; surfaced into the LLM at the next turn.
  router.post('/:id/context', async (req, res, next) => {
    try {
      const content = typeof req.body?.['content'] === 'string' ? (req.body['content'] as string) : '';
      if (!content.trim()) {
        res.status(400).json({ error: { code: 'VALIDATION', message: 'content (string) is required' } });
        return;
      }
      const ok = await widgetService.recordContext(String(req.params['id']), content.slice(0, 2000));
      if (!ok) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Widget instance not found' } });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Client bridge posts this after a widget commits its final state in
  // response to a `harness.widget.teardown` request, so the server-side
  // close() promise resolves and the instance is marked closed with fresh
  // state.
  router.post('/:id/teardown-ack', async (req, res, next) => {
    try {
      const teardownId = typeof req.body?.['teardownId'] === 'string' ? (req.body['teardownId'] as string) : '';
      if (!teardownId) {
        res.status(400).json({ error: { code: 'VALIDATION', message: 'teardownId is required' } });
        return;
      }
      const ok = widgetService.resolveTeardown(teardownId);
      res.json({ ok });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const closed = await widgetService.close(String(req.params['id']));
      if (!closed) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Widget instance not found' } });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
