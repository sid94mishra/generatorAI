// ────────────────────────────────────────────────────────────────
// Chat Routes (v2) — first-class Chat entity management
// 7 endpoints for Chat lifecycle, prompts, history, and SSE streaming
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import multer from 'multer';
import type { Container } from '../composition-root.js';
import { validate } from '../middleware/validate.js';
import {
  CreateChatSchema,
  SendChatPromptSchema,
  UpdatePlanContentSchema,
  CreatePlanCommentSchema,
  PlanDecisionSchema,
  AnswerQuestionSchema,
  SetChatPermissionModeSchema,
  coerceAgentMode,
} from '@generatorai/shared';
import type { PlanDocument } from '@generatorai/shared';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // 10MB max per file, 5 files max
});

// CLN-12 / STR-04 — the `GET /:id/stream` endpoint and its per-chat
// ring-buffer subscription bridge were removed. Web clients now use the
// unified `/api/stream?scope=chat&id=<chatId>` endpoint backed by the
// persistent `stream_cursors` log.

export function createChatApiRoutes(container: Container): Router {
  const router = Router();
  const {
    chatManagementService,
    artifactService,
    eventBus,
    logger,
    planService,
    agentInteractionService,
  } = container;

  /**
   * Plan mode is optional wiring, so every plan route has to answer honestly
   * when it is absent rather than throwing an unhandled TypeError — which is
   * exactly what these routes did while they pointed at methods that had
   * never been implemented.
   */
  const plans = planService;

  /** Wire shape the clients expect from the plan list/summary routes. */
  const toPlanSummary = (plan: PlanDocument): Record<string, unknown> => ({
    planId: plan.id,
    revision: plan.currentRevision,
    title: plan.title,
    summary: plan.revisions.find((r) => r.revision === plan.currentRevision)?.summary ?? '',
    status: plan.status,
    actions: plan.status === 'awaiting_review' ? plan.availableActions : [],
    fileName: plan.fileName,
  });

  // POST /chats — Create a new chat
  router.post('/', validate(CreateChatSchema), async (req, res, next) => {
    try {
      // Apply default harness config: all tools enabled, no session timeout
      const params = { ...req.body };
      if (!params.harnessConfig) {
        params.harnessConfig = {};
      }
      // Ensure all tools available and session stays open indefinitely
      if (!params.harnessConfig.availableTools) {
        params.harnessConfig.availableTools = ['*'];
      }
      if (params.harnessConfig.streaming === undefined) {
        params.harnessConfig.streaming = true;
      }

      const chat = await chatManagementService.createChat(params);
      logger.info(`[ChatRoutes] Created chat ${chat.id}`, { requestId: req.requestId });
      res.status(201).json(chat);
    } catch (err) {
      next(err);
    }
  });

  // GET /chats — List chats with optional ?status and ?projectId filter
  router.get('/', async (req, res, next) => {
    try {
      const statusFilter = req.query['status'] as string | undefined;
      const projectId = req.query['projectId'] as string | undefined;
      if (statusFilter && !['active', 'archived'].includes(statusFilter)) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Invalid status. Must be "active" or "archived"' },
        });
        return;
      }
      const chats = await chatManagementService.listChats(
        statusFilter as 'active' | 'archived' | undefined,
        projectId,
      );
      res.json(chats);
    } catch (err) {
      next(err);
    }
  });

  // GET /chats/:id — Get chat details
  router.get('/:id', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const chat = await container.chatEntityRepo.getById(chatId);
      res.json(chat);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /chats/:id — Permanently delete a chat (hard delete)
  router.delete('/:id', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      await chatManagementService.deleteChat(chatId);
      logger.info(`[ChatRoutes] Permanently deleted chat ${chatId}`, { requestId: req.requestId });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // PATCH /chats/:id — Update chat metadata (name, description, model, tags, status, projectId, harnessConfig)
  router.patch('/:id', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const {
        name,
        description,
        model,
        tags,
        status,
        projectId,
        harnessConfig,
        defaultAgentMode,
        permissionMode,
        agentRef,
        agentOverrides,
        orchestratorMode,
      } = req.body ?? {};

      // Archive via PATCH { status: 'archived' }
      if (status === 'archived') {
        await chatManagementService.archiveChat(chatId);
        logger.info(`[ChatRoutes] Archived chat ${chatId}`, { requestId: req.requestId });
        const updated = await container.chatEntityRepo.getById(chatId);
        res.json(updated);
        return;
      }

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (model !== undefined) updates.model = model;
      if (tags !== undefined) updates.tags = tags;
      if (projectId !== undefined) updates.projectId = projectId;
      if (harnessConfig !== undefined) updates.harnessConfig = harnessConfig;
      if (status !== undefined && status !== 'archived') updates.status = status;
      // PLN-01 — sticky per-chat composer defaults. `coerceAgentMode` also
      // folds the pre-rename `interactive` alias onto `auto`.
      const coercedMode = coerceAgentMode(defaultAgentMode);
      if (coercedMode) {
        updates.defaultAgentMode = coercedMode;
      }
      if (
        permissionMode === 'bypassPermissions' ||
        permissionMode === 'default' ||
        permissionMode === 'acceptEdits' ||
        permissionMode === 'plan'
      ) {
        updates.permissionMode = permissionMode;
      }
      // Binding an agent is a RUN-TIME act (covered by `write:chats`), unlike
      // authoring one, which needs `admin:settings`.
      if (agentRef !== undefined) {
        updates.agentRef = agentRef || null;
        if (agentRef) {
          const agent = await container.agentService?.getByRef(String(agentRef));
          if (agent) {
            updates.agentId = agent.id;
            updates.agentVersion = agent.version;
          }
        } else {
          updates.agentId = null;
          updates.agentVersion = null;
        }
      }
      if (agentOverrides !== undefined) updates.agentOverrides = agentOverrides ?? null;
      if (orchestratorMode !== undefined) updates.orchestratorMode = !!orchestratorMode;

      const updated = await container.chatEntityRepo.update(chatId, updates);
      if (agentRef !== undefined || agentOverrides !== undefined) {
        // Other clients (a second tab, a paired phone) must see the rebind.
        await eventBus.emit(updated.sessionId, {
          kind: 'chat.agent_changed',
          data: {
            chatId,
            ...(updated.agentRef ? { agentRef: updated.agentRef } : {}),
            ...(updated.agentVersion ? { agentVersion: updated.agentVersion } : {}),
          },
        });
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // POST /chats/:id/cancel — Stop the in-flight turn (abort SDK, emit idle)
  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      await chatManagementService.cancelTurn(chatId);
      logger.info(`[ChatRoutes] Cancelled turn for chat ${chatId}`, { requestId: req.requestId });
      res.json({ status: 'cancelled' });
    } catch (err) {
      next(err);
    }
  });

  // POST /chats/:id/prompt — Send a prompt (multipart: prompt text + optional attachments)
  router.post(
    '/:id/prompt',
    upload.array('attachments', 10),
    async (req, res, next) => {
      try {
        const chatId = String(req.params['id']);

        // Support both JSON body and form-data
        const promptText = req.body?.['prompt'];
        const prompt = typeof promptText === 'string' ? promptText : '';

        if (!prompt) {
          res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: 'Prompt text is required' },
          });
          return;
        }

        // Validate prompt against schema (C2 fix — enforces max length)
        // PLN-01 — `mode` selects the per-turn agent mode from the composer.
        const rawMode = req.body?.['mode'];
        const promptValidation = SendChatPromptSchema.safeParse({
          prompt,
          ...(typeof rawMode === 'string' && rawMode.length > 0 ? { mode: rawMode } : {}),
        });
        if (!promptValidation.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Prompt validation failed',
              fields: promptValidation.error.flatten().fieldErrors,
            },
          });
          return;
        }
        const mode = promptValidation.data.mode;

        // PLN-01 — refuse while a human gate is open. Sending a second prompt
        // during a plan review would leave the first SDK turn blocked and
        // mis-attribute its late events to the new turn.
        const pendingGates = agentInteractionService
          ? await agentInteractionService.listPendingByChat(chatId)
          : [];
        const openGate = pendingGates[0];
        if (openGate) {
          res.status(409).json({
            error: {
              code: 'INTERACTION_PENDING',
              message:
                'This chat is waiting on your response. Resolve or cancel it before sending a new message.',
              details: { interactionId: openGate.id, kind: openGate.kind },
            },
          });
          return;
        }

        // Store uploaded files as artifacts
        const files = (req.files ?? []) as Express.Multer.File[];
        const attachmentRefs: Array<{ type: 'file'; path: string; displayName?: string }> = [];

        // Look up the chat to get sessionId for artifact creation
        const chat = await container.chatEntityRepo.getById(chatId);

        for (const file of files) {
          const artifact = await artifactService.createArtifact({
            sessionId: chat.sessionId,
            name: file.originalname,
            mimeType: file.mimetype,
            content: file.buffer,
          });
          attachmentRefs.push({
            type: 'file',
            path: artifact.path,
            displayName: file.originalname,
          });
        }

        // Send prompt asynchronously (fire and forget, events stream via SSE)
        chatManagementService
          .sendPrompt(chatId, prompt, attachmentRefs, mode ? { mode } : undefined)
          .catch((err) => {
            logger.error(`[ChatRoutes] Prompt send failed for chat ${chatId}`, {
              error: err instanceof Error ? err.message : String(err),
            });
            // Emit error event on the SSE stream so clients are notified (M6 fix)
            eventBus.emitGlobal({
              kind: 'chat.prompt_failed',
              data: {
                chatId,
                error: err instanceof Error ? err.message : String(err),
              },
            });
          });

        logger.info(`[ChatRoutes] Prompt submitted for chat ${chatId}`, { requestId: req.requestId });
        res.status(202).json({ message: 'Prompt submitted', chatId, ...(mode ? { mode } : {}) });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /chats/:id/messages — Get chat message history (paginated).
  // P0#5 — bounded by default (latest page) so a multi-thousand-message chat
  // never ships its full history in one response. The body stays a plain
  // ChatMessage[] (backward-compatible); total/hasMore travel as headers.
  router.get('/:id/messages', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const limitParam = req.query['limit'];
      const offsetParam = req.query['offset'];
      const limit = limitParam !== undefined ? parseInt(String(limitParam), 10) : undefined;
      const offset = offsetParam !== undefined ? parseInt(String(offsetParam), 10) : undefined;

      // Validate parsed values are valid numbers (I4 fix)
      if ((limit !== undefined && (Number.isNaN(limit) || limit < 0)) ||
          (offset !== undefined && (Number.isNaN(offset) || offset < 0))) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Invalid limit or offset — must be non-negative integers' },
        });
        return;
      }

      const page = await chatManagementService.getChatHistoryPage(chatId, limit ?? 50, offset);
      res.setHeader('X-Total-Count', String(page.total));
      res.setHeader('X-Has-More', page.hasMore ? 'true' : 'false');
      res.setHeader('X-Page-Offset', String(page.offset));
      res.setHeader('X-Page-Limit', String(page.limit));
      res.json(page.messages);
    } catch (err) {
      next(err);
    }
  });

  // SSE: use GET /api/stream?scope=chat&id=<chatId> (unified endpoint, CLN-12).

  // ── Orchestrator background tasks ──

  // GET /chats/:id/background-tasks — list background workers for an orchestrator chat.
  router.get('/:id/background-tasks', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const tasks = await container.orchestratorService.listBackgroundAgents(chatId);
      res.json({ tasks });
    } catch (err) {
      next(err);
    }
  });

  // GET /chats/:id/background-tasks/:taskId — digest for one worker.
  router.get('/:id/background-tasks/:taskId', async (req, res, next) => {
    try {
      const taskId = String(req.params['taskId']);
      const digest = await container.orchestratorService.checkBackgroundAgent(taskId, { wait: false });
      res.json(digest);
    } catch (err) {
      next(err);
    }
  });

  // POST /chats/:id/background-tasks/:taskId/cancel — abort a running worker.
  router.post('/:id/background-tasks/:taskId/cancel', async (req, res, next) => {
    try {
      const taskId = String(req.params['taskId']);
      await container.orchestratorService.cancelBackgroundAgent(taskId);
      res.status(202).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ══════════════════════════════════════════════════════════════
  // PLN-01 — Plan mode
  //
  // The server has API-key auth, not per-user authz, so every handler below
  // verifies the plan/interaction actually belongs to the `:id` chat. That
  // ownership check is the only thing preventing cross-chat mutation.
  // ══════════════════════════════════════════════════════════════

  // GET /chats/:id/plans — plan documents for a chat (newest first).
  router.get('/:id/plans', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const documents = await plans!.listByChat(chatId);
      res.json(documents.map(toPlanSummary));
    } catch (err) {
      next(err);
    }
  });

  // GET /chats/:id/plans/:planId — one plan with all revisions + comments.
  router.get('/:id/plans/:planId', async (req, res, next) => {
    try {
      const plan = await plans!.findById(String(req.params['planId']));
      if (!plan) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
        return;
      }
      res.json(plan);
    } catch (err) {
      next(err);
    }
  });

  // GET /chats/:id/plans/:planId/content?revision=n — raw markdown.
  router.get('/:id/plans/:planId/content', async (req, res, next) => {
    try {
      const plan = await plans!.findById(String(req.params['planId']));
      if (!plan) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
        return;
      }
      const requested = req.query['revision'];
      const revision = requested !== undefined ? parseInt(String(requested), 10) : plan.currentRevision;
      if (Number.isNaN(revision)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid revision' } });
        return;
      }
      const found = plan.revisions.find((r) => r.revision === revision);
      if (!found) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Revision not found' } });
        return;
      }
      res.json({ revision: found.revision, content: found.content, summary: found.summary, authoredBy: found.authoredBy });
    } catch (err) {
      next(err);
    }
  });

  // PUT /chats/:id/plans/:planId/content — user edit → new revision.
  router.put('/:id/plans/:planId/content', validate(UpdatePlanContentSchema), async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const planId = String(req.params['planId']);
      const plan = await plans!.findById(planId);
      if (!plan) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
        return;
      }
      const body = req.body as { content: string; summary?: string; expectedRevision: number };
      const revision = await plans!.addRevision({
        planId,
        content: body.content,
        summary: body.summary ?? plan.title,
        authoredBy: 'user',
        expectedRevision: body.expectedRevision,
        ...(await resolvePlanWorkspaceRoot(container, chatId)),
      });
      if (!revision) {
        // Optimistic-concurrency loss: another tab (or the agent) revised it.
        res.status(409).json({
          error: {
            code: 'REVISION_CONFLICT',
            message: 'The plan changed since you loaded it. Reload and re-apply your edits.',
            details: { currentRevision: plan.currentRevision },
          },
        });
        return;
      }
      res.json(revision);
    } catch (err) {
      next(err);
    }
  });

  // POST /chats/:id/plans/:planId/comments — inline review comment.
  router.post('/:id/plans/:planId/comments', validate(CreatePlanCommentSchema), async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const planId = String(req.params['planId']);
      const plan = await plans!.findById(planId);
      if (!plan) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
        return;
      }
      const body = req.body as {
        body: string;
        revision: number;
        anchor?: { startLine: number; endLine: number; quotedText: string; contentHash: string };
      };
      const comment = await plans!.addComment({
        planId,
        revision: body.revision,
        body: body.body,
        ...(body.anchor ? { anchor: body.anchor } : {}),
      });
      res.status(201).json(comment);
    } catch (err) {
      next(err);
    }
  });

  // POST /chats/:id/plans/:planId/decision — approve / request changes.
  router.post('/:id/plans/:planId/decision', validate(PlanDecisionSchema), async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const planId = String(req.params['planId']);
      const body = req.body as {
        approved: boolean;
        action?: 'exit_only' | 'implement_interactive' | 'implement_autopilot';
        feedback?: string;
        useEditedContent?: boolean;
        expectedRevision?: number;
      };

      const plan = await plans!.findById(planId);
      if (!plan) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
        return;
      }
      if (plan.status !== 'awaiting_review') {
        // Already-settled decisions are a conflict, not a server error.
        res.status(409).json({
          error: { code: 'DECISION_CONFLICT', message: `Plan is already ${plan.status}` },
        });
        return;
      }

      // The service owns the decision: it composes unresolved inline comments
      // into the feedback message, honours `useEditedContent`, and — critically
      // — releases the gate as `changes_requested` rather than `rejected`, so
      // the agent is told to revise instead of to stop.
      const outcome = await chatManagementService.decidePlan(chatId, planId, body);
      if (!outcome.ok) {
        const reason = outcome.reason ?? 'Decision not recorded';
        const code = /revised/i.test(reason) ? 'REVISION_CONFLICT' : 'DECISION_CONFLICT';
        res.status(409).json({ error: { code, message: reason } });
        return;
      }

      logger.info(`[ChatRoutes] Plan decision recorded for ${planId}`, { requestId: req.requestId });
      res.status(202).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /chats/:id/plans/:planId/save-to-workspace — promote to a tracked path.
  router.post('/:id/plans/:planId/save-to-workspace', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const planId = String(req.params['planId']);
      const plan = await plans!.findById(planId);
      if (!plan) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
        return;
      }
      const roots = await resolvePlanWorkspaceRoot(container, chatId);
      if (!roots.workspaceRoot) {
        res.status(400).json({
          error: { code: 'NO_WORKSPACE', message: 'This chat has no workspace to save into' },
        });
        return;
      }
      const savedPath = await plans!.saveToWorkspace(planId, roots.workspaceRoot);
      res.json({ ok: !!savedPath, path: savedPath ?? null });
    } catch (err) {
      next(err);
    }
  });

  // GET /chats/:id/interactions?status=pending — reconnect recovery.
  router.get('/:id/interactions', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const pending = agentInteractionService
        ? await agentInteractionService.listPendingByChat(chatId)
        : [];
      res.json(
        pending.map((i) => ({
          interactionId: i.id,
          kind: i.kind,
          status: i.status,
          ...(i.payload ? { payload: i.payload } : {}),
        })),
      );
    } catch (err) {
      next(err);
    }
  });

  // POST /chats/:id/interactions/:interactionId/respond — answer a question.
  router.post(
    '/:id/interactions/:interactionId/respond',
    validate(AnswerQuestionSchema),
    async (req, res, next) => {
      try {
        // Delegate: the service checks the interaction belongs to THIS chat and
        // emits `chat.question.answered`. Resolving the gate here instead left
        // no event behind, so a reload replayed the card as still-pending and
        // the reconciliation pass then marked it expired.
        const result = await chatManagementService.answerQuestion(
          String(req.params['id']),
          String(req.params['interactionId']),
          req.body as { answers: Record<string, string[]>; freeformResponse?: string },
        );
        if (!result.ok) {
          const reason = result.reason ?? 'Already resolved';
          if (/not enabled/i.test(reason)) {
            res.status(503).json({ error: { code: 'UNAVAILABLE', message: reason } });
            return;
          }
          const status = /not found/i.test(reason) ? 404 : 409;
          res.status(status).json({
            error: { code: status === 404 ? 'NOT_FOUND' : 'INTERACTION_CONFLICT', message: reason },
          });
          return;
        }
        res.status(202).json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // PATCH /chats/:id/permission-mode — change the chat's permission policy.
  router.patch('/:id/permission-mode', validate(SetChatPermissionModeSchema), async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const { mode } = req.body as { mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan' };
      const chat = await container.chatEntityRepo.update(chatId, { permissionMode: mode });
      res.json({ chatId, mode: chat.permissionMode });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Resolves the workspace working directory for plan projection.
 * Returns `{}` when the chat has no workspace so callers can spread it.
 */
async function resolvePlanWorkspaceRoot(
  container: Container,
  chatId: string,
): Promise<{ workspaceRoot?: string }> {
  try {
    const chat = await container.chatEntityRepo.getById(chatId);
    if (!chat.workspaceId) return {};
    const workspace = await container.workspaceManager.getExecutionWorkspace(chat.workspaceId);
    if (!workspace) return {};
    return { workspaceRoot: container.workspaceManager.getWorkingDirectory(workspace) };
  } catch {
    return {};
  }
}

