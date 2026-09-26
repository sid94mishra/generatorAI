// ────────────────────────────────────────────────────────────────
// Stats summary (G-10, docs/redesign/05-gap-matrix.md §G-10).
//
// GET /api/stats/summary?from=&to=&projectId=&definitionId=&automationId=
// &groupBy=definition — Home "This week", the Workflows stat strip,
// AutomationDetail's stat row, WorkflowDetail's rail.
//
// Every source below is an EXISTING read-only repository/service call
// already exposed on `Container` — no new engine code, no SQL aggregate,
// no migration. `workflowRunRepo` / `workflowDefinitionService` /
// `automationService` are Workflow-Overhaul-owned engine code
// (07-phases.md §"Running in parallel"): only their existing read methods
// are called here, from a route this redesign track owns; nothing was
// added to them. Tolerates zero definitions / zero runs cleanly (05-gap-
// matrix.md §P2 note: the Workflow Overhaul's migration drops run history).
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type {
  Automation,
  AutomationExecution,
  StatsByDefinitionRow,
  StatsSummary,
  WorkflowDefinition,
  WorkflowRun,
} from '@generatorai/shared';
import type { Container } from '../composition-root.js';

function parseRangeBoundary(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function runOccurredAt(run: WorkflowRun): number {
  return (run.startedAt ?? run.createdAt).getTime();
}

function runDurationMs(run: WorkflowRun): number | undefined {
  return run.startedAt && run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : undefined;
}

function executionOccurredAt(execution: AutomationExecution): number {
  return (execution.startedAt ?? execution.createdAt).getTime();
}

function executionDurationMs(execution: AutomationExecution): number | undefined {
  return execution.startedAt && execution.completedAt
    ? execution.completedAt.getTime() - execution.startedAt.getTime()
    : undefined;
}

export function createStatsRoutes(container: Container): Router {
  const router = Router();
  const { chatEntityRepo, workflowDefinitionService, workflowRunRepo, automationService } = container;

  // GET /stats/summary
  router.get('/summary', async (req, res, next) => {
    try {
      const from = parseRangeBoundary(req.query['from']);
      const to = parseRangeBoundary(req.query['to']);
      if (!from || !to) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: '`from` and `to` are required ISO timestamps' },
        });
        return;
      }
      const fromMs = from.getTime();
      const toMs = to.getTime();
      const projectId = req.query['projectId'] as string | undefined;
      const definitionId = req.query['definitionId'] as string | undefined;
      const automationId = req.query['automationId'] as string | undefined;
      const groupByDefinition = req.query['groupBy'] === 'definition';

      // ── chats.created ──
      const chats = projectId ? await chatEntityRepo.getByProjectId(projectId) : await chatEntityRepo.getAll();
      const created = chats.filter((c) => {
        const t = c.createdAt.getTime();
        return t >= fromMs && t <= toMs;
      }).length;

      // ── runs (joined through the definition) ──
      let definitions: WorkflowDefinition[] = projectId
        ? await workflowDefinitionService.listDefinitions(projectId)
        : await workflowDefinitionService.listDefinitions();
      if (definitionId) definitions = definitions.filter((d) => d.id === definitionId);

      const runsByDefinition = await Promise.all(
        definitions.map(async (d) => ({ definition: d, runs: await workflowRunRepo.getByDefinitionId(d.id) })),
      );

      const allRunsInRange: WorkflowRun[] = [];
      for (const { runs } of runsByDefinition) {
        for (const run of runs) {
          const t = runOccurredAt(run);
          if (t >= fromMs && t <= toMs) allRunsInRange.push(run);
        }
      }
      const succeededRuns = allRunsInRange.filter((r) => r.status === 'completed');
      const failedRuns = allRunsInRange.filter((r) => r.status === 'failed');
      const cancelledRuns = allRunsInRange.filter((r) => r.status === 'cancelled');
      const terminalCount = succeededRuns.length + failedRuns.length + cancelledRuns.length;
      const durations = allRunsInRange.map(runDurationMs).filter((d): d is number => d !== undefined);

      const runs: StatsSummary['runs'] = {
        total: allRunsInRange.length,
        succeeded: succeededRuns.length,
        failed: failedRuns.length,
        cancelled: cancelledRuns.length,
        ...(terminalCount > 0 ? { successRate: succeededRuns.length / terminalCount } : {}),
        ...(durations.length > 0 ? { avgDurationMs: average(durations), medianDurationMs: median(durations) } : {}),
      };

      // ── byDefinition (only when asked for) ──
      let byDefinition: StatsByDefinitionRow[] | undefined;
      if (groupByDefinition) {
        byDefinition = runsByDefinition.map(({ definition, runs: defRuns }) => {
          const inRange = defRuns.filter((r) => {
            const t = runOccurredAt(r);
            return t >= fromMs && t <= toMs;
          });
          const defSucceeded = inRange.filter((r) => r.status === 'completed').length;
          const defTerminal =
            defSucceeded +
            inRange.filter((r) => r.status === 'failed').length +
            inRange.filter((r) => r.status === 'cancelled').length;

          const latest = defRuns.reduce<WorkflowRun | undefined>(
            (acc, r) => (!acc || runOccurredAt(r) > runOccurredAt(acc) ? r : acc),
            undefined,
          );

          return {
            definitionId: definition.id,
            ...(latest
              ? {
                  lastRun: {
                    id: latest.id,
                    status: latest.status,
                    ...(latest.startedAt ? { startedAt: latest.startedAt.toISOString() } : {}),
                  },
                }
              : {}),
            ...(defTerminal > 0 ? { successRate: defSucceeded / defTerminal } : {}),
          };
        });
      }

      // ── automations (optional; scoped the same way) ──
      let automationsSummary: StatsSummary['automations'];
      const automations: Automation[] = await automationService.listAutomations(projectId);
      const relevantAutomations = automationId ? automations.filter((a) => a.id === automationId) : automations;
      if (relevantAutomations.length > 0) {
        const executionLists = await Promise.all(
          relevantAutomations.map((a) => automationService.getExecutionsByAutomation(a.id)),
        );
        const executionsInRange = executionLists.flat().filter((e) => {
          const t = executionOccurredAt(e);
          return t >= fromMs && t <= toMs;
        });
        const succeededExecutions = executionsInRange.filter((e) => e.status === 'completed').length;
        const executionDurations = executionsInRange
          .map(executionDurationMs)
          .filter((d): d is number => d !== undefined);
        automationsSummary = {
          executions: executionsInRange.length,
          succeeded: succeededExecutions,
          ...(executionDurations.length > 0 ? { avgDurationMs: average(executionDurations) } : {}),
        };
      }

      const body: StatsSummary = {
        range: { from: from.toISOString(), to: to.toISOString() },
        chats: { created },
        runs,
        ...(automationsSummary ? { automations: automationsSummary } : {}),
        ...(byDefinition ? { byDefinition } : {}),
      };
      res.set('Cache-Control', 'no-store').json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
