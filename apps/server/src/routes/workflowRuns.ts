// ────────────────────────────────────────────────────────────────
// WorkflowRun Routes — runs, their instances and the commands API.
//
// Every operator action on a run or one of its instances is ONE route,
// `POST /:id/commands` (P03 WP-3.6/3.7, G5 §3.7): pause, resume, cancel,
// retry, skip, fail and approve (which also answers a stage's in-turn
// tool permission, question or plan review). Re-running a terminal run is
// `POST /:id/fork` (G5 §3.8). Pending approvals are the `awaiting_input`
// instances of `GET /:id` (their `interruptData`).
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
import { StageKeySchema, UserVariablesSchema } from '@generatorai/workflow-spec';
import { ForkRunRequestSchema, RunCommandSchema, WORKFLOW_RUN_STATES, type RunCommand } from '@generatorai/workflow-spec';
import { RunCommandRefusedError } from '@generatorai/core';
import { validate } from '../middleware/validate.js';

/** `POST /workflow-runs`. A draft can only start as a test run. */
const StageOverrideSchema = z
  .object({ stageKey: StageKeySchema, skip: z.boolean().optional(), variables: UserVariablesSchema.optional() })
  .strict();

const CreateWorkflowRunSchema = z.object({
  workflowDefinitionId: z.string().uuid(),
  // Engine-reserved names (__*, repo_path_*, repo_branch_*) are refused (R-8).
  variables: UserVariablesSchema.default({}),
  projectId: z.string().uuid().optional(),
  testRun: z.boolean().optional(),
  stageOverrides: z.array(StageOverrideSchema).max(100).optional(),
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
  const { workflowRunService, stageRunRepo, workflowRunRepo, runDefinitionReader, logger } = container;

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

  // POST /workflow-runs/:id/start — Start a created run (202 Accepted). The
  // PD-17 check refuses it synchronously; the prepare phases run in the engine.
  router.post('/:id/start', async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      await workflowRunService.startRun(runId);
      logger.info(`[WorkflowRunRoutes] Started run ${runId}`, { requestId: req.requestId });
      res.status(202).json({ message: 'Workflow run start initiated', runId });
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

  // POST /workflow-runs/:id/fork — re-run a terminal run as a NEW run
  // (G5 §3.8); the source stays terminal. 201 with the fork.
  router.post('/:id/fork', validate(ForkRunRequestSchema), async (req, res, next) => {
    try {
      const runId = String(req.params['id']);
      const fork = await workflowRunService.forkRun(runId, req.body);
      logger.info(`[WorkflowRunRoutes] Forked run ${runId} as ${fork.id}`, { requestId: req.requestId });
      res.status(201).json(fork);
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
