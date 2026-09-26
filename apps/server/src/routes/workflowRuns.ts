// ────────────────────────────────────────────────────────────────
// WorkflowRun Routes — runs, their instances and the commands API.
//
// A run starts through ONE route, `POST /workflow-invocations` (P04), and
// so does a re-run of a terminal run (`target: {kind: 'fork'}`, G5 §3.8).
// Every operator action on a run or one of its instances is ONE route,
// `POST /:id/commands` (P03 WP-3.6/3.7, G5 §3.7): pause, resume, cancel,
// retry, skip, fail and approve (which also answers a stage's in-turn
// tool permission, question or plan review). Pending approvals are the
// `awaiting_input` instances of `GET /:id` (their `interruptData`). The
// run's workspace is read under `/:id/workspace*` (workflowRunWorkspace.ts).
//
// A stage is a compact chat (P03b, `StageConversationService`):
// `/:id/instances/:instanceId/messages` sends an operator message (queued
// between turns, an amendment of a completed stage, a retry of a paused
// one; 409 STAGE_BUSY mid-turn), `…/turn/cancel` stops the turn in flight,
// `…/interactions/:interactionId/{permission|answer|plan}` answers an
// in-turn gate in the chat's body shapes, `…/attachments/:artifactId`
// serves an attached file.
//
// CLN-12 / STR-04 — the `GET /:id/stream` endpoint + its per-run ring
// buffer, session-id routing map, and EventBus bridge were removed in
// Phase 4. Web clients now connect to the unified `/api/stream?scope=run&id=<runId>`
// which is backed by the persistent `stream_cursors` log, so the
// transient in-memory ring buffer was redundant (and had known bugs —
// see STR-07's 30s auto-clear gotcha).
// ────────────────────────────────────────────────────────────────

import { orderStageRuns } from './workflowRunOrder.js';
import { canBypassPermissions } from './permissionScope.js';
import { Router } from 'express';
import type { Container } from '../composition-root.js';
import { z } from 'zod';
import { RunCommandSchema, WORKFLOW_RUN_STATES, type RunCommand } from '@generatorai/workflow-spec';
import { RunCommandRefusedError, type StageGateAnswer } from '@generatorai/core';
import { AgentModeSchema, AnswerQuestionSchema, PlanDecisionSchema, ResolveToolPermissionSchema } from '@generatorai/shared';
import multer from 'multer';
import { validate } from '../middleware/validate.js';

/** An operator message to a stage (the multipart fields, as strings). */
const StageMessageSchema = z.object({
  prompt: z.string().trim().min(1).max(100_000),
  mode: AgentModeSchema.optional(),
});

const CancelStageTurnSchema = z.object({ force: z.boolean().optional() }).strict();

/** A stage's plan review: the chat's decision minus the chat-only edited-content fields. */
const StagePlanDecisionSchema = PlanDecisionSchema.pick({ approved: true, action: true, feedback: true });

/** Files attached to a stage message: the chat's limits. */
const stageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

/**
 * Every command but `approve` is a run-control act (`write:workflows`).
 * Answering a stage's gate is `exec:agent` only (the route policy), so a
 * paired phone can approve without being able to edit or steer workflows.
 */
function mayControlRuns(req: { principal?: { scopes?: readonly string[] } }): boolean {
  const scopes = req.principal?.scopes;
  return !scopes || scopes.includes('write:workflows');
}

export function createWorkflowRunRoutes(container: Container): Router {
  const router = Router();
  const { workflowRunService, stageConversationService, artifactService, stageRunRepo, workflowRunRepo, runDefinitionReader, logger } = container;

  // ═══════════════════════════════════════════════════════════
  // WorkflowRun CRUD + Lifecycle
  // ═══════════════════════════════════════════════════════════

  // GET /workflow-runs — List runs with optional ?status and ?definitionId filters
  router.get('/', async (req, res, next) => {
    try {
      const statusFilter = req.query['status'] as string | undefined;
      const definitionIdFilter = req.query['definitionId'] as string | undefined;

      let runs;
      if (definitionIdFilter) {
        runs = await workflowRunRepo.getByDefinitionId(definitionIdFilter);
      } else if (statusFilter) {
        const validStatuses: readonly string[] = WORKFLOW_RUN_STATES;
        const statuses = statusFilter.split(',').map((s) => s.trim());
        const invalidStatuses = statuses.filter((s) => !validStatuses.includes(s));
        if (invalidStatuses.length > 0) {
          res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: `Invalid status values: ${invalidStatuses.join(', ')}` },
          });
          return;
        }
        runs = await workflowRunRepo.getByStatus(statuses as Array<(typeof WORKFLOW_RUN_STATES)[number]>);
      } else {
        runs = await workflowRunRepo.getAll();
      }

      res.json(runs);
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-runs/:id — Get run with stage runs
  router.get('/:id', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const run = await workflowRunRepo.getById(runId);
      const stageRuns = await stageRunRepo.getByRunId(runId);
      const graph = await runDefinitionReader.get(run.definitionVersionId);
      res.json({ ...run, stageRuns: orderStageRuns(stageRuns, graph.stages.map((s) => s.key)) });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:id/commands — every operator action (RunCommand).
  // 202 when the engine accepted it; 404 unknown run or instance; 409 a state
  // or version conflict; 400 an invalid command; 503 no engine in this process.
  router.post('/:id/commands', validate(RunCommandSchema), async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const command = req.body as RunCommand;
      if (command.command !== 'approve' && !mayControlRuns(req)) {
        res.status(403).json({
          error: { code: 'FORBIDDEN', message: `The ${command.command} command requires the write:workflows scope.` },
        });
        return;
      }
      const r = await workflowRunService.command(runId, command);
      if (!r.ok) throw new RunCommandRefusedError(r);
      logger.info(`[WorkflowRunRoutes] ${command.command} on run ${runId}${command.instanceId ? ` / ${command.instanceId}` : ''}`, {
        requestId: req.requestId,
      });
      res.status(202).json({ runId, command: command.command });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /workflow-runs/:id — Delete a workflow run
  router.delete('/:id', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      await workflowRunService.deleteRun(runId);

      logger.info(`[WorkflowRunRoutes] Deleted run ${runId}`, {
        requestId: req.requestId,
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Stage Run Queries + Controls
  // ═══════════════════════════════════════════════════════════

  // GET /workflow-runs/:id/stages — List stage runs for a workflow run
  router.get('/:id/stages', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const stages = await stageRunRepo.getByRunId(runId);
      res.json(stages);
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-runs/:id/instances/:instanceId/iterations — a loop's
  // finished iterations (carry, exit-rule values, streaks, signals, score,
  // checkpoint, usage), oldest first (P05).
  router.get('/:id/instances/:instanceId/iterations', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const inst = await stageRunRepo.getById(String(req.params['instanceId']));
      if (inst.workflowRunId !== runId) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `No instance ${inst.id} in run ${runId}` } });
        return;
      }
      res.json(await stageRunRepo.getLoopIterations(inst.id));
    } catch (err) {
      next(err);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // The stage conversation (P03b): a stage is a compact chat.
  // ═══════════════════════════════════════════════════════════

  // POST /workflow-runs/:id/instances/:instanceId/messages — an operator
  // message (multipart: `prompt`, `attachments[]`, `mode`; or JSON). 202 with
  // how it was taken: `queued` (the next turn), `amending` (a completed stage,
  // PD-4) or `retrying` (a paused stage). 409 STAGE_BUSY mid-turn (PD-3),
  // INTERACTION_PENDING on an open gate.
  router.post('/:id/instances/:instanceId/messages', stageUpload.array('attachments', 10), async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const instanceId = String(req.params['instanceId']);
      const parsed = StageMessageSchema.safeParse({
        prompt: req.body?.['prompt'],
        ...(typeof req.body?.['mode'] === 'string' && req.body['mode'] ? { mode: req.body['mode'] } : {}),
      });
      if (!parsed.success) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Message validation failed', fields: parsed.error.flatten().fieldErrors },
        });
        return;
      }
      const files = (req.files ?? []) as Express.Multer.File[];
      const attachmentIds: string[] = [];
      if (files.length > 0) {
        const sessionId = stageConversationService.attachmentSession(runId, instanceId);
        for (const file of files) {
          const artifact = await artifactService.createArtifact({
            sessionId,
            workflowRunId: runId,
            stageRunId: instanceId,
            name: file.originalname,
            mimeType: file.mimetype,
            content: file.buffer,
          });
          attachmentIds.push(artifact.id);
        }
      }
      const r = await stageConversationService.send(runId, instanceId, {
        prompt: parsed.data.prompt,
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(parsed.data.mode ? { agentMode: parsed.data.mode } : {}),
      });
      logger.info(`[WorkflowRunRoutes] Message to ${runId} / ${instanceId}: ${r.outcome}`, { requestId: req.requestId });
      res.status(202).json({ runId, instanceId, outcome: r.outcome, attachmentIds });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:id/instances/:instanceId/turn/cancel {force?} —
  // stop the turn in flight; the stage carries on (a stage cancel is the
  // `cancel` command). 409 NO_ACTIVE_TURN when nothing is in flight.
  router.post('/:id/instances/:instanceId/turn/cancel', validate(CancelStageTurnSchema), async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const instanceId = String(req.params['instanceId']);
      const force = (req.body as z.infer<typeof CancelStageTurnSchema>).force === true;
      stageConversationService.cancelTurn(runId, instanceId, { force });
      logger.info(`[WorkflowRunRoutes] Turn stopped on ${runId} / ${instanceId}`, { requestId: req.requestId, force });
      res.json({ status: 'cancelled', force });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:id/instances/:instanceId/interactions/:interactionId/{permission|answer|plan}
  // — answer the stage's in-turn gate, in the chat's body shapes. The route
  // policy admits these on `exec:agent` (answering the agent), like `approve`.
  const gateRoute = <S extends z.ZodTypeAny>(verb: string, schema: S, toAnswer: (body: z.infer<S>) => StageGateAnswer) =>
    router.post(`/:id/instances/:instanceId/interactions/:interactionId/${verb}`, validate(schema), async (req, res, next) => {
      try {
        const runId = String(req.params['id']);
        const instanceId = String(req.params['instanceId']);
        const interactionId = String(req.params['interactionId']);
        await stageConversationService.resolveInteraction(runId, instanceId, interactionId, toAnswer(req.body as z.infer<S>));
        logger.info(`[WorkflowRunRoutes] ${verb} answered on ${runId} / ${instanceId}`, { requestId: req.requestId });
        res.status(202).json({ runId, instanceId, interactionId });
      } catch (err) {
        next(err);
      }
    });
  gateRoute('permission', ResolveToolPermissionSchema, (b) => ({ kind: 'permission', behavior: b.behavior, ...(b.message ? { message: b.message } : {}) }));
  gateRoute('answer', AnswerQuestionSchema, (b) => ({
    kind: 'answer',
    answers: b.answers,
    ...(b.freeformResponse ? { freeformResponse: b.freeformResponse } : {}),
  }));
  gateRoute('plan', StagePlanDecisionSchema, (b) => ({
    kind: 'plan',
    approved: b.approved,
    ...(b.action ? { action: b.action } : {}),
    ...(b.feedback ? { feedback: b.feedback } : {}),
  }));

  // GET /workflow-runs/:id/instances/:instanceId/attachments/:artifactId —
  // the bytes of a file an operator attached to a stage message. Addressed by
  // artifact id, scoped to the instance (a mismatch is a 404, not a leak).
  router.get('/:id/instances/:instanceId/attachments/:artifactId', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const instanceId = String(req.params['instanceId']);
      const artifact = await artifactService.getArtifact(String(req.params['artifactId']));
      if (!artifact || artifact.stageRunId !== instanceId || artifact.workflowRunId !== runId) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
        return;
      }
      const content = await artifactService.readArtifactContent(artifact.id);
      const mime = artifact.mimeType || 'application/octet-stream';
      const inline = /^image\/|^text\/plain$|^application\/pdf$/.test(mime);
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

  // ═══════════════════════════════════════════════════════════
  // Permission mode (HITL-04): the run row's own layer.
  // ═══════════════════════════════════════════════════════════

  // GET /workflow-runs/:id/permission-mode — Read active mode
  router.get('/:id/permission-mode', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const mode = await workflowRunService.getPermissionMode(runId);
      res.json({ runId, mode });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /workflow-runs/:id/permission-mode — Flip mode mid-run
  router.patch('/:id/permission-mode', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const mode = req.body?.['mode'];
      const allowed = ['bypassPermissions', 'default', 'acceptEdits', 'plan'];
      if (!allowed.includes(mode)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid permission mode. Allowed: ${allowed.join(', ')}`,
          },
        });
        return;
      }
      // Raising a run to bypass turns its approval gate off for every later
      // tool call: an administrative act, like a chat's (review 5.2).
      if (mode === 'bypassPermissions' && !canBypassPermissions(req)) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Turning off tool approvals requires the admin:settings scope.',
          },
        });
        return;
      }
      await workflowRunService.setPermissionMode(runId, mode);
      logger.info(`[WorkflowRunRoutes] Permission mode for run ${runId} set to ${mode}`, {
        requestId: req.requestId,
      });
      res.json({ runId, mode });
    } catch (err) {
      next(err);
    }
  });

  // SSE: use GET /api/stream?scope=run&id=<runId> (unified endpoint, CLN-12).

  return router;
}
