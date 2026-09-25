// ────────────────────────────────────────────────────────────────
// Chat Routes (v2) — first-class Chat entity management
// 7 endpoints for Chat lifecycle, prompts, history, and SSE streaming
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { canBypassPermissions } from './permissionScope.js';
import multer from 'multer';
import { z } from 'zod';
import type { Container } from '../composition-root.js';
import { validate } from '../middleware/validate.js';
import {
  CreateChatSchema,
  SendChatPromptSchema,
  UpdatePlanContentSchema,
  CreatePlanCommentSchema,
  PlanDecisionSchema,
  AnswerQuestionSchema,
  ResolveToolPermissionSchema,
  UpdateChatSchema,
  UpdateChatSourcesSchema,
  SetChatPermissionModeSchema,
  isAgentMode,
} from '@generatorai/shared';
import type { ChatMessage, ChatSourceControlOptions, PlanDocument } from '@generatorai/shared';

/**
 * Body of `POST /chats/:id/cancel`. The budget is clamped, not rejected: the
 * client's `StopController` already clamps to the same [0.5, 60] window, so a
 * value outside it is a client bug to tolerate, not a request to refuse.
 */
const CancelTurnBodySchema = z
  .object({
    force: z.boolean().optional(),
    budgetSeconds: z
      .number()
      .finite()
      .transform((s) => Math.min(60, Math.max(0.5, s)))
      .optional(),
  })
  .strip();

/** Map the chat service's coded errors onto HTTP; false when not coded. */
function sendCodedError(res: { status: (n: number) => { json: (b: unknown) => void } }, err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const message = (err as Error)?.message ?? 'Request failed';
  if (code === 'CHAT_BUSY') {
    res.status(409).json({ error: { code, message } });
    return true;
  }
  if (code === 'NOT_FOUND') {
    res.status(404).json({ error: { code, message } });
    return true;
  }
  return false;
}

/**
 * Validate + normalise the per-chat agent-native source-control option.
 *
 * The three flags are a LADDER, not three independent switches: you cannot
 * open a pull request without pushing, and you cannot push without having
 * committed. Rather than 400-ing a caller that asks for `autoPullRequest`
 * alone — which is unambiguous about what it wants — the weaker flags are
 * forced on ("normalised upward"), so what is stored can never describe a
 * turn the post-turn hook is unable to carry out.
 *
 * Returns the value to persist, or a message for the route's 400.
 */
function normaliseSourceControl(
  input: unknown,
): { ok: true; value: ChatSourceControlOptions } | { ok: false; message: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, message: '`sourceControl` must be an object' };
  }
  const raw = input as Record<string, unknown>;

  const flag = (key: 'autoCommit' | 'autoPush' | 'autoPullRequest'): boolean | string => {
    const v = raw[key];
    // Absent means "off" — a partial object is a legitimate way to ask for
    // just one rung of the ladder.
    if (v === undefined) return false;
    if (typeof v !== 'boolean') return `\`sourceControl.${key}\` must be a boolean`;
    return v;
  };

  const flags: Record<string, boolean> = {};
  for (const key of ['autoCommit', 'autoPush', 'autoPullRequest'] as const) {
    const v = flag(key);
    if (typeof v === 'string') return { ok: false, message: v };
    flags[key] = v;
  }

  if (raw['base'] !== undefined && (typeof raw['base'] !== 'string' || raw['base'].trim() === '')) {
    return { ok: false, message: '`sourceControl.base` must be a non-empty string' };
  }
  if (raw['draft'] !== undefined && typeof raw['draft'] !== 'boolean') {
    return { ok: false, message: '`sourceControl.draft` must be a boolean' };
  }

  const autoPullRequest = flags['autoPullRequest']!;
  const autoPush = flags['autoPush']! || autoPullRequest;
  const autoCommit = flags['autoCommit']! || autoPush;

  return {
    ok: true,
    value: {
      autoCommit,
      autoPush,
      autoPullRequest,
      ...(raw['base'] !== undefined ? { base: (raw['base'] as string).trim() } : {}),
      ...(raw['draft'] !== undefined ? { draft: raw['draft'] as boolean } : {}),
    },
  };
}

const RewindChatSchema = z
  .object({
    turnId: z.string().min(1),
    scope: z.enum(['all', 'code', 'conversation']).optional(),
  })
  .strip();

const ForkChatSchema = z
  .object({
    turnId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .strip();

/**
 * Markdown rendering of a transcript for "Copy transcript". Kept small and
 * deterministic: prompts and answers verbatim, the agent's actions as a
 * compact list, thinking left out.
 */
function formatTranscriptMarkdown(name: string, messages: ChatMessage[]): string {
  const out: string[] = [`# ${name}`, ''];
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'tool') continue;
    const when = new Date(m.timestamp).toISOString();
    if (m.role === 'user') {
      out.push(`## You  <sub>${when}</sub>`, '');
      out.push(m.content.trim(), '');
      if (m.attachments?.length) {
        out.push(`*Attachments:* ${m.attachments.map((a) => `\`${a.name}\``).join(', ')}`, '');
      }
      continue;
    }
    out.push(`## Assistant  <sub>${when}</sub>`, '');
    const tools = m.metadata?.toolCalls ?? [];
    if (tools.length > 0) {
      out.push('<details><summary>Actions (' + tools.length + ')</summary>', '');
      for (const tc of tools) {
        const args = (tc.args ?? {}) as Record<string, unknown>;
        const target =
          (typeof args['file_path'] === 'string' && args['file_path']) ||
          (typeof args['path'] === 'string' && args['path']) ||
          (typeof args['command'] === 'string' && args['command']) ||
          '';
        const op = tc.fileOp ? ` (+${tc.fileOp.additions ?? 0} −${tc.fileOp.deletions ?? 0})` : '';
        out.push(`- \`${tc.tool}\`${target ? ` ${String(target).slice(0, 200)}` : ''}${op}${tc.success === false ? ' — failed' : ''}`);
      }
      out.push('', '</details>', '');
    }
    const segments = m.metadata?.textSegments?.length ? m.metadata.textSegments.map((s) => s.content) : [m.content];
    out.push(segments.map((t) => t.trim()).filter(Boolean).join('\n\n'), '');
    if (m.metadata?.partial) out.push('*Stopped before the response finished.*', '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // 10MB max per file, 5 files max
});

// CLN-12 / STR-04 — the `GET /:id/stream` endpoint and its per-chat
// ring-buffer subscription bridge were removed. Web clients now use the
// unified `/api/stream?scope=chat&id=<chatId>` endpoint backed by the
// persistent `stream_cursors` log.


/**
 * Attach `workspacePrep` (mount readiness) to a chat DTO. The composer gates
 * Send on it and shows the preparation error, so it travels with the chat
 * rather than requiring a second request.
 */
/**
 * A message rendered as one line of catalogue text.
 *
 * Fenced code, images and long tool output all collapse: the row has ~40
 * characters of usable width on a phone, and a preview that starts with
 * ```ts tells the reader nothing about the conversation.
 */
function previewText(content: string): string {
  const flat = content
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [image] ')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
}

async function withWorkspacePrep<T extends { workspaceId?: string; conversationSeed?: string }>(
  container: Container,
  input: T,
): Promise<T> {
  // The synthetic-rewind seed is server-internal: it is the model's context,
  // not the user's transcript, and it can be long.
  const { conversationSeed: _seed, ...rest } = input;
  const chat = rest as T;
  if (!chat.workspaceId) return chat;
  try {
    const ws = await container.workspaceManager.getExecutionWorkspace(chat.workspaceId);
    if (!ws) return chat;
    return {
      ...chat,
      workspacePrep: {
        status: ws.prepStatus ?? 'ready',
        ...(ws.prepError ? { error: ws.prepError } : {}),
      },
    };
  } catch {
    return chat;
  }
}

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

      if (params.sourceControl !== undefined) {
        const sc = normaliseSourceControl(params.sourceControl);
        if (!sc.ok) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: sc.message } });
          return;
        }
        params.sourceControl = sc.value;
      }

      // Creation is the front door, and it takes `permissionMode` directly.
      // Gating only the two update routes left a caller free to ask for
      // approvals-off on the way in, which is the same escalation by another
      // name. Same rule: raising needs the admin scope, lowering is free.
      if (params.permissionMode === 'bypassPermissions' && !canBypassPermissions(req)) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message:
              'Creating a chat with tool approvals off requires the admin:settings scope.',
          },
        });
        return;
      }
      // No mode asked for: choose the gated default rather than inheriting
      // the service's historical `bypassPermissions`. A caller that wants
      // unattended execution has to say so, and hold the scope to say it.
      if (params.permissionMode === undefined && !canBypassPermissions(req)) {
        params.permissionMode = 'default';
      }

      const chat = await chatManagementService.createChat(params);
      logger.info(`[ChatRoutes] Created chat ${chat.id}`, { requestId: req.requestId });
      res.status(201).json(await withWorkspacePrep(container, chat));
    } catch (err) {
      next(err);
    }
  });

  // GET /chats — List chats with optional ?status and ?projectId filter
  router.get('/', async (req, res, next) => {
    try {
      const projectId = req.query['projectId'] as string | undefined;

      // Two spellings of the same filter reach this route. The shared client
      // (web, mobile, CLI) sends `archived=true|false`; older callers and the
      // OpenAPI surface send `status=active|archived`. The route understood
      // only `status`, so every `--status` filter from the terminal was
      // silently ignored and the full list came back regardless.
      let statusFilter = req.query['status'] as string | undefined;
      const archivedParam = req.query['archived'];
      if (statusFilter === undefined && archivedParam !== undefined) {
        statusFilter = String(archivedParam) === 'true' ? 'archived' : 'active';
      }
      if (statusFilter && !['active', 'archived'].includes(statusFilter)) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Invalid status. Must be "active" or "archived"' },
        });
        return;
      }

      // `limit` was documented on the terminal's `chat list`, accepted by the
      // client, and dropped here — so "give me 3" returned all 343, and every
      // client paid for the whole table on every list.
      const limitParam = req.query['limit'];
      let limit: number | undefined;
      if (limitParam !== undefined) {
        const parsed = Number(limitParam);
        if (!Number.isInteger(parsed) || parsed < 1) {
          res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: '`limit` must be a positive integer' },
          });
          return;
        }
        limit = Math.min(parsed, 500);
      }

      const chats = await chatManagementService.listChats(
        statusFilter as 'active' | 'archived' | undefined,
        projectId,
      );
      const page = limit === undefined ? chats : chats.slice(0, limit);
      // One-line preview per row, in ONE extra query for the whole page. The
      // catalogue is the phone's main navigation surface and a title plus a
      // relative time is not enough to tell two chats apart.
      //
      // Best-effort: a preview is a nicety, and a catalogue that fails
      // outright because the preview query did is worse than one without.
      let previews = new Map<string, ChatMessage>();
      try {
        previews = await container.chatMessageRepo.latestBySessionIds(
          page.map((c) => c.sessionId).filter((id): id is string => Boolean(id)),
        );
      } catch (previewErr) {
        logger.warn(
          `[ChatRoutes] Could not load list previews: ${
            previewErr instanceof Error ? previewErr.message : String(previewErr)
          }`,
        );
      }
      const withPreview = page.map((c) => {
        const last = c.sessionId ? previews.get(c.sessionId) : undefined;
        if (!last) return c;
        return {
          ...c,
          preview: previewText(last.content),
          previewRole: last.role,
          previewAt: last.timestamp,
        };
      });
      res.json(await Promise.all(withPreview.map((c) => withWorkspacePrep(container, c))));
    } catch (err) {
      next(err);
    }
  });

  // GET /chats/:id — Get chat details
  router.get('/:id', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const chat = await container.chatEntityRepo.getById(chatId);
      res.json(await withWorkspacePrep(container, chat));
    } catch (err) {
      next(err);
    }
  });

  // PUT /chats/:id/sources — replace what the chat works on.
  //
  // Validated against the filesystem and git before anything changes;
  // unchanged mounts keep their checkpoints, new ones are prepared in the
  // background and the next prompt waits for them.
  router.put('/:id/sources', validate(UpdateChatSourcesSchema), async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const { sources, primary } = req.body as { sources: Parameters<typeof chatManagementService.updateChatSources>[1]; primary?: string };
      const chat = await chatManagementService.updateChatSources(chatId, sources, primary);
      res.json(await withWorkspacePrep(container, chat));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'CHAT_BUSY') {
        res.status(409).json({ error: { code, message: (err as Error).message } });
        return;
      }
      next(err);
    }
  });

  // POST /chats/:id/workspace/prepare — re-run mount preparation after an
  // error (a folder that was unreachable, a dirty checkout since committed).
  router.post('/:id/workspace/prepare', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const chat = await container.chatEntityRepo.getById(chatId);
      if (!chat.workspaceId) {
        res.status(409).json({ error: { code: 'CONFLICT', message: 'This chat has no workspace' } });
        return;
      }
      void container.mountService.prepare(chat.workspaceId, { sessionId: chat.sessionId, chatId });
      res.status(202).json({ status: 'preparing' });
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
  router.patch('/:id', validate(UpdateChatSchema), async (req, res, next) => {
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
        sourceControl,
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
      // PLN-01 — sticky per-chat composer defaults.
      if (isAgentMode(defaultAgentMode)) {
        updates.defaultAgentMode = defaultAgentMode;
      }
      if (permissionMode !== undefined) {
        // Raising a chat to `bypassPermissions` turns the approval gate OFF
        // for every later tool call, so it needs more than `write:chats` —
        // which is the DEFAULT grant on every paired device, phones included.
        // Lowering into a gated mode stays free: making a chat safer must
        // never need an administrator.
        if (permissionMode === 'bypassPermissions' && !canBypassPermissions(req)) {
          res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message:
                'Turning off tool approvals requires the admin:settings scope. ' +
                'This device can lower a chat into a gated mode, but not raise it.',
            },
          });
          return;
        }
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
      if (sourceControl !== undefined) {
        // `null` turns agent-native source control back off for this chat.
        if (sourceControl === null) {
          updates.sourceControl = null;
        } else {
          const sc = normaliseSourceControl(sourceControl);
          if (!sc.ok) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: sc.message } });
            return;
          }
          updates.sourceControl = sc.value;
        }
      }

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
  //
  // Body (optional): `{ force?: boolean, budgetSeconds?: number }` — what the
  // two-phase Stop control (`StopController` in client-core) computes for the
  // press. Both web and mobile were computing these and then sending `{}`;
  // the route ignored the body anyway. See `cancelTurn` for what each does.
  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      // `req.body` is undefined when no JSON body was sent (a bare POST), so
      // parse the fallback rather than failing a body-less stop.
      const parsed = CancelTurnBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Cancel body validation failed',
            fields: parsed.error.flatten().fieldErrors,
          },
        });
        return;
      }
      const { force, budgetSeconds } = parsed.data;
      await chatManagementService.cancelTurn(chatId, {
        ...(force !== undefined ? { force } : {}),
        ...(budgetSeconds !== undefined ? { budgetSeconds } : {}),
      });
      logger.info(`[ChatRoutes] Cancelled turn for chat ${chatId}`, {
        requestId: req.requestId,
        force: force ?? false,
        budgetSeconds: budgetSeconds ?? null,
      });
      res.json({ status: 'cancelled', force: force ?? false });
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

        // Review 6.1 — one turn at a time. A second prompt used to detach the
        // first turn's listener without aborting it, so the first response was
        // produced, had nowhere to go, and was lost. The web client disables
        // Send while streaming; the API, terminal and SDK did not.
        if (chatManagementService.isTurnActive(chatId)) {
          res.status(409).json({
            error: {
              code: 'CHAT_BUSY',
              message:
                'This chat is still generating a response. Wait for it to finish, or stop it first.',
            },
          });
          return;
        }

        // Store uploaded files as artifacts
        const files = (req.files ?? []) as Express.Multer.File[];
        const attachmentRefs: Array<{ type: 'file'; path: string; displayName?: string; artifactId?: string; mimeType?: string }> = [];

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
            artifactId: artifact.id,
            mimeType: file.mimetype,
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
  // GET /chats/:id/attachments/:artifactId — the bytes of a file the user
  // attached to a prompt. Addressed by artifact id (already scoped to the
  // chat's session — a mismatch is a 404, not a leak) so no client-supplied
  // path is ever resolved. Images render inline; everything else downloads.
  router.get('/:id/attachments/:artifactId', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const artifactId = String(req.params['artifactId']);
      const chat = await container.chatEntityRepo.getById(chatId);
      const artifact = await artifactService.getArtifact(artifactId);
      if (!chat || !artifact || artifact.sessionId !== chat.sessionId) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
        return;
      }
      const content = await artifactService.readArtifactContent(artifactId);
      const mime = artifact.mimeType || 'application/octet-stream';
      const inline = /^image\/|^text\/plain$|^application\/pdf$/.test(mime);
      // Filename goes through RFC 5987 encoding — originals can carry
      // anything the user's OS allowed.
      const safeName = encodeURIComponent(artifact.name).replace(/['()]/g, escape);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', String(content.length));
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${safeName}`);
      res.end(content);
    } catch (err) {
      next(err);
    }
  });

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

  // GET /chats/:id/transcript — the WHOLE transcript, oldest first.
  // `?format=markdown` renders it for the clipboard; default is JSON rows.
  router.get('/:id/transcript', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const chat = await container.chatEntityRepo.getById(chatId);
      const messages = await chatManagementService.getTranscript(chatId);
      if (String(req.query['format'] ?? 'json') === 'markdown') {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.send(formatTranscriptMarkdown(chat.name, messages));
        return;
      }
      res.json({ chatId, name: chat.name, messages });
    } catch (err) {
      next(err);
    }
  });

  // POST /chats/:id/rewind — back to the START of a turn (files / conversation / both).
  router.post('/:id/rewind', validate(RewindChatSchema), async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      const { turnId, scope } = req.body as { turnId: string; scope?: 'all' | 'code' | 'conversation' };
      const result = await chatManagementService.rewindChat(chatId, turnId, scope ?? 'all');
      logger.info(`[ChatRoutes] Rewound chat ${chatId} to turn ${turnId} (${scope ?? 'all'}, ${result.conversation})`, {
        requestId: req.requestId,
      });
      res.json(result);
    } catch (err) {
      if (sendCodedError(res, err)) return;
      next(err);
    }
  });

  // POST /chats/:id/fork — branch the conversation after a turn into a new chat.
  router.post('/:id/fork', async (req, res, next) => {
    try {
      const chatId = String(req.params['id']);
      // A bare POST (no body) forks after the last turn, like a bare cancel.
      const parsed = ForkChatSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Fork body validation failed', fields: parsed.error.flatten().fieldErrors },
        });
        return;
      }
      const { turnId, name } = parsed.data;
      const result = await chatManagementService.forkChat(chatId, {
        ...(turnId ? { turnId } : {}),
        ...(name ? { name } : {}),
      });
      logger.info(`[ChatRoutes] Forked chat ${chatId} → ${result.chat.id} (${result.conversation})`, {
        requestId: req.requestId,
      });
      res.status(201).json({
        ...result,
        chat: await withWorkspacePrep(container, result.chat),
      });
    } catch (err) {
      if (sendCodedError(res, err)) return;
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
      const chatId = String(req.params['id']);
      const plan = await plans!.findById(String(req.params['planId']));
      if (!plan) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
        return;
      }
      // The plan must belong to THIS chat. Without this, any caller holding
      // `read:chats`/`write:chats` — the default grant for every paired
      // device, phones included — could read, comment on, overwrite or export
      // another chat's plan just by naming its id under a different chat.
      // 404 rather than 403: a wrong-chat id must not confirm the plan exists.
      if (plan.chatId !== chatId) {
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
      const chatId = String(req.params['id']);
      const plan = await plans!.findById(String(req.params['planId']));
      if (!plan) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
        return;
      }
      // The plan must belong to THIS chat. Without this, any caller holding
      // `read:chats`/`write:chats` — the default grant for every paired
      // device, phones included — could read, comment on, overwrite or export
      // another chat's plan just by naming its id under a different chat.
      // 404 rather than 403: a wrong-chat id must not confirm the plan exists.
      if (plan.chatId !== chatId) {
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
      // The plan must belong to THIS chat. Without this, any caller holding
      // `read:chats`/`write:chats` — the default grant for every paired
      // device, phones included — could read, comment on, overwrite or export
      // another chat's plan just by naming its id under a different chat.
      // 404 rather than 403: a wrong-chat id must not confirm the plan exists.
      if (plan.chatId !== chatId) {
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
      // The plan must belong to THIS chat. Without this, any caller holding
      // `read:chats`/`write:chats` — the default grant for every paired
      // device, phones included — could read, comment on, overwrite or export
      // another chat's plan just by naming its id under a different chat.
      // 404 rather than 403: a wrong-chat id must not confirm the plan exists.
      if (plan.chatId !== chatId) {
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
      // The plan must belong to THIS chat. Without this, any caller holding
      // `read:chats`/`write:chats` — the default grant for every paired
      // device, phones included — could read, comment on, overwrite or export
      // another chat's plan just by naming its id under a different chat.
      // 404 rather than 403: a wrong-chat id must not confirm the plan exists.
      if (plan.chatId !== chatId) {
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
      // The plan must belong to THIS chat. Without this, any caller holding
      // `read:chats`/`write:chats` — the default grant for every paired
      // device, phones included — could read, comment on, overwrite or export
      // another chat's plan just by naming its id under a different chat.
      // 404 rather than 403: a wrong-chat id must not confirm the plan exists.
      if (plan.chatId !== chatId) {
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

  // POST /chats/:id/interactions/:interactionId/permission — allow or deny a
  // tool call the agent is blocked on (review finding 5.1).
  router.post(
    '/:id/interactions/:interactionId/permission',
    validate(ResolveToolPermissionSchema),
    async (req, res, next) => {
      try {
        // Delegated for the same reason as the question gate: the service owns
        // the ownership check and emits the resolution event, so a reconnecting
        // client replays a settled card rather than a pending one.
        const result = await chatManagementService.resolveToolPermission(
          String(req.params['id']),
          String(req.params['interactionId']),
          req.body as { behavior: 'allow' | 'deny'; message?: string },
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
      // Same rule as the general PATCH: the schema validates the SHAPE, it
      // cannot say who may choose which value. Turning approvals off is the
      // privileged direction; turning them on is not.
      if (mode === 'bypassPermissions' && !canBypassPermissions(req)) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message:
              'Turning off tool approvals requires the admin:settings scope. ' +
              'This device can lower a chat into a gated mode, but not raise it.',
          },
        });
        return;
      }
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

