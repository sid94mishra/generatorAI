// ────────────────────────────────────────────────────────────────
// WorkflowRun Routes (v2) — Run lifecycle + stage controls.
//
// CLN-12 / STR-04 — the `GET /:id/stream` endpoint + its per-run ring
// buffer, session-id routing map, and EventBus bridge were removed in
// Phase 4. Web clients now connect to the unified `/api/stream?scope=run&id=<runId>`
// which is backed by the persistent `stream_cursors` log, so the
// transient in-memory ring buffer was redundant (and had known bugs —
// see STR-07's 30s auto-clear gotcha).
// ────────────────────────────────────────────────────────────────

import { orderStageRuns } from './workflowRunOrder.js';
import { Router } from 'express';
import type { Container } from '../composition-root.js';
import { validate } from '../middleware/validate.js';
import { CreateWorkflowRunSchema, isStageReviewOutcome } from '@generatorai/shared';
import type { StageReviewOutcome } from '@generatorai/shared';

export function createWorkflowRunRoutes(container: Container): Router {
  const router = Router();
  const {
    workflowRunService,
    stageExecutionService,
    stageRunRepo,
    workflowRunRepo,
    hitlService,
    durableSleepService,
    logger,
  } = container;

  // ═══════════════════════════════════════════════════════════
  // WorkflowRun CRUD + Lifecycle
  // ═══════════════════════════════════════════════════════════

  // POST /workflow-runs — Create a new workflow run
  router.post('/', validate(CreateWorkflowRunSchema), async (req, res, next) => {
    try {
      const run = await workflowRunService.createRun(req.body);
      logger.info(`[WorkflowRunRoutes] Created run ${run.id}`, {
        requestId: req.requestId,
      });
      res.status(201).json(run);
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-runs — List runs with optional ?status and ?definitionId filters
  router.get('/', async (req, res, next) => {
    try {
      const statusFilter = req.query['status'] as string | undefined;
      const definitionIdFilter = req.query['definitionId'] as string | undefined;

      let runs;
      if (definitionIdFilter) {
        runs = await workflowRunRepo.getByDefinitionId(definitionIdFilter);
      } else if (statusFilter) {
        const validStatuses = ['created', 'starting', 'running', 'paused', 'cancelling', 'completed', 'failed', 'cancelled'];
        const statuses = statusFilter.split(',').map((s) => s.trim());
        const invalidStatuses = statuses.filter((s) => !validStatuses.includes(s));
        if (invalidStatuses.length > 0) {
          res.status(400).json({
            error: { code: 'VALIDATION_ERROR', message: `Invalid status values: ${invalidStatuses.join(', ')}` },
          });
          return;
        }
        runs = await workflowRunRepo.getByStatus(statuses as Array<
          'created' | 'starting' | 'running' | 'paused' | 'cancelling' | 'completed' | 'failed' | 'cancelled'
        >);
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
      res.json({ ...run, stageRuns: orderStageRuns(stageRuns, run.definitionSnapshot?.stages) });
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-runs/:id/scratchpad — Read the per-run scratchpad JSON file
  router.get('/:id/scratchpad', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const run = await workflowRunRepo.getById(runId);

      // Resolve scratchpad path from run variables
      const artifactsDir = run.variables?.['__artifactsDirectory'];
      if (typeof artifactsDir !== 'string') {
        res.json({ workflowRunId: runId, entries: [], lastUpdated: null });
        return;
      }

      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const scratchpadPath = join(artifactsDir, '..', 'scratchpad.json');

      try {
        const content = await readFile(scratchpadPath, 'utf-8');
        res.json(JSON.parse(content));
      } catch {
        // File doesn't exist yet — return empty scratchpad
        res.json({ workflowRunId: runId, entries: [], lastUpdated: null });
      }
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:id/start — Start a workflow run (202 Accepted)
  router.post('/:id/start', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);

      // Fire and forget — run is started asynchronously.
      // WorkflowRunService.startRun() handles workspace directory setup
      // (via WorkspaceManager when available, legacy fallback otherwise).
      workflowRunService.startRun(runId).catch((err) => {
        logger.error(`[WorkflowRunRoutes] Run start failed for ${runId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      logger.info(`[WorkflowRunRoutes] Started run ${runId}`, {
        requestId: req.requestId,
      });
      res.status(202).json({ message: 'Workflow run start initiated', runId });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:id/pause — Pause a running workflow
  router.post('/:id/pause', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      await workflowRunService.pauseRun(runId);
      logger.info(`[WorkflowRunRoutes] Paused run ${runId}`, {
        requestId: req.requestId,
      });
      res.json({ message: 'Workflow run paused', runId });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:id/resume — Resume a paused workflow
  router.post('/:id/resume', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      await workflowRunService.resumeRun(runId);
      logger.info(`[WorkflowRunRoutes] Resumed run ${runId}`, {
        requestId: req.requestId,
      });
      res.json({ message: 'Workflow run resumed', runId });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:id/retry — User-initiated retry of a failed run (2.4)
  // Walks the state machine via `user:retry` (failed → created), resets
  // failed stages, then fires startRun asynchronously. Returns 202.
  router.post('/:id/retry', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      // `retryRun` creates a NEW run carrying `ancestorRunId` (W23 lineage) —
      // the ancestor stays terminal. Starting `runId` here started the OLD,
      // already-failed run (a no-op) and left the new one parked in `created`
      // forever, so the button appeared to do nothing and every press
      // orphaned another run.
      const retried = await workflowRunService.retryRun(runId);
      // Fire-and-forget the start so the retry endpoint returns quickly.
      workflowRunService.startRun(retried.id).catch((err) => {
        logger.error(`[WorkflowRunRoutes] Retry-start failed for ${retried.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      logger.info(`[WorkflowRunRoutes] Retried run ${runId} as ${retried.id}`, {
        requestId: req.requestId,
      });
      res.status(202).json({
        message: 'Workflow run retry initiated',
        runId: retried.id,
        ancestorRunId: runId,
        status: retried.status,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:id/cancel — Cancel a running workflow
  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      await workflowRunService.cancelRun(runId);
      logger.info(`[WorkflowRunRoutes] Cancelled run ${runId}`, {
        requestId: req.requestId,
      });
      res.json({ message: 'Workflow run cancelled', runId });
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

  // POST /workflow-runs/:runId/stages/:stageId/pause — Pause a stage
  router.post('/:runId/stages/:stageId/pause', async (req, res, next) => {
    try {
      const stageId = String(req.params['stageId']);
      await stageExecutionService.pauseStage(stageId);
      logger.info(`[WorkflowRunRoutes] Paused stage ${stageId}`, {
        requestId: req.requestId,
      });
      res.json({ message: 'Stage paused', stageId });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:runId/stages/:stageId/resume — Resume a stage
  router.post('/:runId/stages/:stageId/resume', async (req, res, next) => {
    try {
      const runId = String(req.params['runId']);
      const stageId = String(req.params['stageId']);
      const run = await workflowRunRepo.getById(runId);

      // Resume fires execution asynchronously
      stageExecutionService
        .resumeStage(stageId, runId, run.sessionMode)
        .then(() => workflowRunService.onStageCompleted(runId, stageId))
        .catch((err) => workflowRunService.onStageFailed(runId, stageId, err));

      logger.info(`[WorkflowRunRoutes] Resumed stage ${stageId}`, {
        requestId: req.requestId,
      });
      res.status(202).json({ message: 'Stage resume initiated', stageId });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:runId/stages/:stageId/wake — Wake a sleeping stage now
  //
  // The stage timeline has shown a "Wake now" button beside every sleeping
  // stage for a while with nothing behind it (review 6.x / D14). This is the
  // missing half: it takes the same atomic claim + resume path the timed
  // sweeper takes, so an early wake and an expiry are indistinguishable
  // downstream.
  router.post('/:runId/stages/:stageId/wake', async (req, res, next) => {
    try {
      const runId = String(req.params['runId']);
      const stageId = String(req.params['stageId']);

      // The stage must belong to the run in the path. Without this, any run
      // id would serve as a cover for waking any stage in the system.
      //
      // `getById` rejects on an unknown id rather than resolving undefined,
      // so the lookup is guarded and both shapes end at the same 404.
      const stage = await stageRunRepo.getById(stageId).catch(() => undefined);
      if (!stage || stage.workflowRunId !== runId) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Stage run not found' } });
        return;
      }

      const outcome = await durableSleepService.wakeNow(stageId);
      if (outcome === 'not_found') {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Stage run not found' } });
        return;
      }
      if (outcome === 'not_sleeping') {
        // 409, not 404: the row exists, it just is not parked. A double-click
        // on the button lands here and must not read as a broken link.
        res.status(409).json({
          error: { code: 'STAGE_NOT_SLEEPING', message: 'Stage is not sleeping' },
        });
        return;
      }

      logger.info(`[WorkflowRunRoutes] Woke stage ${stageId} early`, {
        requestId: req.requestId,
      });
      res.status(202).json({ message: 'Stage woken', stageId });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:runId/stages/:stageId/retry — Retry a failed stage
  router.post('/:runId/stages/:stageId/retry', async (req, res, next) => {
    try {
      const runId = String(req.params['runId']);
      const stageId = String(req.params['stageId']);
      const run = await workflowRunRepo.getById(runId);

      // Reset stage status — use resetForRetry to clear error/timestamps via SQL NULL
      await stageRunRepo.resetForRetry(stageId);
      await stageRunRepo.incrementRetryCount(stageId);

      const stageRun = await stageRunRepo.getById(stageId);

      // Fire and forget — stage execution is async
      stageExecutionService
        .executeStage(stageRun, runId, run.sessionMode)
        .then(() => workflowRunService.onStageCompleted(runId, stageId))
        .catch((err) => workflowRunService.onStageFailed(runId, stageId, err));

      logger.info(`[WorkflowRunRoutes] Retrying stage ${stageId}`, {
        requestId: req.requestId,
      });
      res.status(202).json({ message: 'Stage retry initiated', stageId });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:runId/stages/:stageId/cancel — Cancel a stage
  router.post('/:runId/stages/:stageId/cancel', async (req, res, next) => {
    try {
      const stageId = String(req.params['stageId']);
      await stageExecutionService.cancelStage(stageId);
      logger.info(`[WorkflowRunRoutes] Cancelled stage ${stageId}`, {
        requestId: req.requestId,
      });
      res.json({ message: 'Stage cancelled', stageId });
    } catch (err) {
      next(err);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // HITL — Human-in-the-Loop (HITL-04)
  //
  // Every endpoint below is opt-in. A newly-created run has
  // `permission_mode = 'bypassPermissions'` which means no stage will
  // ever enter `awaiting_input` unless either (a) the operator flips
  // the mode via `PATCH /:runId/permission-mode`, or (b) a stage body
  // calls `hitl.interrupt(...)` explicitly. The surface is always
  // mounted so the UI/CLI can render mode selectors + pending queues
  // uniformly — it just returns empty lists until someone opts in.
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
      await workflowRunService.setPermissionMode(runId, mode);
      logger.info(`[WorkflowRunRoutes] Permission mode for run ${runId} set to ${mode}`, {
        requestId: req.requestId,
      });
      res.json({ runId, mode });
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-runs/:id/pending-interrupts — List stages awaiting input
  router.get('/:id/pending-interrupts', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const pending = await hitlService.listPending(runId);
      res.json(pending);
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:runId/stages/:stageId/interrupt — Force a stage
  // into `awaiting_input` for manual approval testing.
  //
  // The default `bypassPermissions` mode never auto-blocks tool calls, so
  // this endpoint exists so operators (and E2E tests) can drive a stage
  // through the HITL approve/reject loop without writing custom hooks.
  // The interrupt fires fire-and-forget — we don't await the resolution
  // promise here; the row is flipped to `awaiting_input` and the approver
  // later resolves it via POST /stages/:stageId/approve (HITL approval).
  //
  // Body: { data?: unknown, prompt?: string }
  router.post('/:runId/stages/:stageId/interrupt', async (req, res, next) => {
    try {
      const runId = String(req.params['runId']);
      const stageId = String(req.params['stageId']);
      const body = (req.body ?? {}) as { data?: unknown; prompt?: unknown };
      const interruptData = body.data ?? { type: 'manual', source: 'api' };
      const prompt = typeof body.prompt === 'string' ? body.prompt : undefined;
      // Fire-and-forget — interrupt() returns the resolution promise that
      // would be awaited by the stage body in a fully wired flow.
      void hitlService
        .interrupt(stageId, runId, interruptData, prompt ? { prompt } : undefined)
        .catch((err) => {
          logger.warn(`[WorkflowRunRoutes] HITL interrupt failed for ${stageId}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      logger.info(`[WorkflowRunRoutes] Triggered HITL interrupt on stage ${stageId}`, {
        requestId: req.requestId,
      });
      res.status(202).json({ message: 'Stage interrupted', stageId, runId });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-runs/:runId/stages/:stageId/approve — Approver resume (HITL)
  //
  // Renamed from /resume to avoid colliding with the pause/resume route
  // at /workflow-runs/:runId/stages/:stageId/resume (Express picks the
  // first matching route). The /approve verb also reads more naturally
  // for HITL approval flows.
  //
  // Body: { approved: boolean, value?: unknown, reason?: string }
  // Response: 202 on success, 409 if the stage wasn't awaiting_input
  // (already resumed by another approver / cancelled / never interrupted).
  router.post('/:runId/stages/:stageId/approve', async (req, res, next) => {
    try {
      const runId = String(req.params['runId']);
      const stageId = String(req.params['stageId']);
      const body = (req.body ?? {}) as {
        approved?: unknown;
        outcome?: unknown;
        value?: unknown;
        reason?: unknown;
        followUpPrompt?: unknown;
      };
      // Tri-state verdict. `outcome` wins when present; otherwise the legacy
      // boolean is mapped (true → approved, false → changes_requested).
      // `rejected` is only reachable via `outcome` because it terminates the
      // run — it must never be the fallback meaning of "not approved".
      const outcome: StageReviewOutcome = isStageReviewOutcome(body.outcome)
        ? body.outcome
        : body.approved === false
          ? 'changes_requested'
          : 'approved';
      const approved = outcome === 'approved';
      // Optional free-text follow-up the operator wants the stage to act on as
      // the HITL response (e.g. "also handle the empty-input case"). Stored as
      // the resume value AND injected into the stage's live conversation below.
      const followUpPrompt =
        typeof body.followUpPrompt === 'string' && body.followUpPrompt.trim().length > 0
          ? body.followUpPrompt.trim()
          : undefined;
      // Detect the stage-completion review flow — for that kind, the stage
      // executor is already awaiting the resume resolution in its own loop
      // (it sends the feedback as a follow-up prompt itself and re-parks).
      // Calling sendStageFollowUp here would race with that loop, so we
      // short-circuit and route the feedback through the resolution value
      // only.
      let isCompletionReview = false;
      try {
        const stageRow = await hitlService
          .listPending(runId)
          .then((rows) => rows.find((r) => r.id === stageId));
        const kind = (stageRow?.interruptData as { kind?: unknown } | undefined)?.kind;
        if (kind === 'stage_completion_review') isCompletionReview = true;
      } catch {
        // Non-fatal — falls through to the legacy behaviour.
      }
      // If a follow-up is queued (legacy HITL flow only), reserve the stage
      // BEFORE resuming HITL so the natural per-stage session release is
      // skipped and the follow-up can be injected on the still-live
      // conversation.
      if (!isCompletionReview && approved && followUpPrompt) {
        stageExecutionService.markFollowUpPending(stageId);
      }
      const result = await hitlService.resume(stageId, runId, {
        approved,
        outcome,
        value: followUpPrompt ? { followUpPrompt } : body.value,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      });
      if (!result.ok) {
        res.status(409).json({
          error: {
            code: 'STAGE_NOT_AWAITING_INPUT',
            message: result.reason ?? 'Stage was not awaiting_input',
          },
        });
        return;
      }
      // Legacy HITL flow only: on approval with a follow-up, inject it into
      // the stage's session and stream the agent's response. The
      // stage-completion review flow handles this itself inside
      // StageExecutionService.executeStage, so we skip it here.
      if (!isCompletionReview && approved && followUpPrompt) {
        void stageExecutionService
          .sendStageFollowUp(stageId, runId, followUpPrompt)
          .catch((err: unknown) => {
            logger.warn(`[WorkflowRunRoutes] HITL follow-up injection failed for ${stageId}`, {
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }
      logger.info(`[WorkflowRunRoutes] Resumed stage ${stageId} (outcome=${outcome}, followUp=${!!followUpPrompt})`, {
        requestId: req.requestId,
      });
      res.status(202).json({ message: 'Stage resumed', stageId, outcome, approved, followUp: !!followUpPrompt });
    } catch (err) {
      next(err);
    }
  });

  // SSE: use GET /api/stream?scope=run&id=<runId> (unified endpoint, CLN-12).

  return router;
}
