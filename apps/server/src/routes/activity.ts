// ────────────────────────────────────────────────────────────────
// Recently finished activity (G-11, docs/redesign/05-gap-matrix.md §G-11).
//
// GET /api/activity/recent?since=&limit=20&projectId= — Home "Recently
// finished". Merges chats' finished turns (G-02), terminal workflow runs
// and terminal automation executions into one feed, newest first.
//
// Every source is an EXISTING read-only repository/service call already
// exposed on `Container` — no new engine code, no SQL, no migration.
// `workflowRunRepo` / `workflowDefinitionService` / `automationService`
// are Workflow-Overhaul-owned engine code (07-phases.md §"Running in
// parallel"): only their existing read methods are called. Pull-request-
// and commit-derived items are deliberately NOT built in this pass — see
// the header of `packages/shared/src/types/RecentActivity.ts` for why.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type {
  Automation,
  RecentActivityItem,
  RecentActivityPage,
  WorkflowRun,
} from '@generatorai/shared';
import type { WorkflowDefinitionSummary } from '@generatorai/workflow-spec';
import { chatActivityMeta, tallyWorkers } from '@generatorai/core';
import type { Container } from '../composition-root.js';
import { listAllDefinitionSummaries } from './definitionSummaries.js';
import { activityScmFields, readScmOutcome } from './scmOutcome.js';

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const TERMINAL_EXECUTION_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);

function runOutcome(status: WorkflowRun['status']): RecentActivityItem['outcome'] | undefined {
  if (status === 'completed') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return undefined;
}

/** `partial` (some iterations failed) reads as `failed` — it never fully succeeded. */
function executionOutcome(status: string): RecentActivityItem['outcome'] | undefined {
  if (status === 'completed') return 'succeeded';
  if (status === 'failed' || status === 'partial') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return undefined;
}

export function createActivityRoutes(container: Container): Router {
  const router = Router();
  const {
    chatEntityRepo,
    workflowDefinitionService,
    workflowRunRepo,
    automationService,
    worktreeService,
    projectService,
    executionWorkspaceRepo,
  } = container;

  // GET /activity/recent
  router.get('/recent', async (req, res, next) => {
    try {
      const sinceRaw = req.query['since'] as string | undefined;
      let sinceMs = 0;
      if (sinceRaw) {
        const parsed = new Date(sinceRaw);
        if (Number.isNaN(parsed.getTime())) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '`since` must be an ISO timestamp' } });
          return;
        }
        sinceMs = parsed.getTime();
      }
      const limitParam = Number(req.query['limit']);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 100) : 20;
      const projectId = req.query['projectId'] as string | undefined;

      const items: RecentActivityItem[] = [];
      /** MG-13: the workspace whose SCM outcome an item may carry, and when the item's work began. */
      const scmSource = new Map<string, { workspaceId: string; sinceMs: number }>();
      /** D-92: chats whose worker tally is read for the final page (orchestrators). */
      const orchestrators = new Set<string>();

      // ── Chats: each chat's most recent FINISHED turn (G-02) ──
      const chatPage = await chatEntityRepo.listPage({
        filter: { projectIds: projectId ? [projectId] : undefined },
        sort: 'activity',
        limit: 200,
      });
      for (const row of chatPage.rows) {
        const lastTurn = row.activity.lastTurn;
        if (!lastTurn) continue;
        const endedAtMs = lastTurn.endedAt.getTime();
        if (endedAtMs < sinceMs) continue;
        items.push({
          key: `chat:${row.chat.id}`,
          entity: 'chat',
          entityId: row.chat.id,
          title: row.chat.name,
          href: `/chats/${row.chat.id}`,
          ...(row.chat.projectId ? { project: { id: row.chat.projectId, name: row.chat.projectId } } : {}),
          endedAt: lastTurn.endedAt.toISOString(),
          outcome: lastTurn.status,
          summary: lastTurn.error ?? (lastTurn.status === 'succeeded' ? 'Turn completed' : `Turn ${lastTurn.status}`),
          ...(row.activity.changes ? { changes: row.activity.changes } : {}),
          ...(lastTurn.status === 'failed' ? { retry: 'chat_prompt' as const } : {}),
          ...(() => {
            const meta = chatActivityMeta(row.chat);
            return meta ? { meta } : {};
          })(),
          // D-83's read mark: finished after the person last opened the chat.
          ...(row.chat.lastReadAt === undefined || row.chat.lastReadAt === null || Date.parse(row.chat.lastReadAt) < endedAtMs
            ? { unread: true }
            : {}),
        });
        if (row.chat.orchestratorMode) orchestrators.add(row.chat.id);
        // A chat's commit / PR follows the turn the user reviewed (MD-164).
        if (row.chat.workspaceId) scmSource.set(`chat:${row.chat.id}`, { workspaceId: row.chat.workspaceId, sinceMs: endedAtMs });
      }

      // ── Workflow runs: joined through the definition ──
      const definitions: WorkflowDefinitionSummary[] = await listAllDefinitionSummaries(workflowDefinitionService, {
        projectId,
      });
      const runsByDefinition = await Promise.all(
        definitions.map(async (d) => ({ definition: d, runs: await workflowRunRepo.getByDefinitionId(d.id) })),
      );
      for (const { definition, runs } of runsByDefinition) {
        for (const run of runs) {
          if (!TERMINAL_RUN_STATUSES.has(run.status)) continue;
          const outcome = runOutcome(run.status);
          if (!outcome) continue;
          const endedAt = run.completedAt ?? run.updatedAt;
          if (endedAt.getTime() < sinceMs) continue;
          items.push({
            key: `run:${run.id}`,
            entity: 'run',
            entityId: run.id,
            title: run.name || definition.name,
            href: `/workflows/${definition.id}/runs/${run.id}`,
            ...(definition.projectId ? { project: { id: definition.projectId, name: definition.projectId } } : {}),
            endedAt: endedAt.toISOString(),
            outcome,
            summary: run.error ?? (outcome === 'succeeded' ? `${definition.name} completed` : `${definition.name} ${outcome}`),
            ...(outcome === 'failed' ? { retry: 'run_retry' as const } : {}),
          });
          if (run.workspaceId) {
            scmSource.set(`run:${run.id}`, {
              workspaceId: run.workspaceId,
              sinceMs: (run.startedAt ?? run.createdAt).getTime(),
            });
          }
        }
      }

      // ── Automation executions ──
      const automations: Automation[] = await automationService.listAutomations(projectId);
      const executionLists = await Promise.all(
        automations.map(async (a) => ({ automation: a, executions: await automationService.getExecutionsByAutomation(a.id) })),
      );
      for (const { automation, executions } of executionLists) {
        for (const execution of executions) {
          if (!TERMINAL_EXECUTION_STATUSES.has(execution.status)) continue;
          const outcome = executionOutcome(execution.status);
          if (!outcome) continue;
          const endedAt = execution.completedAt ?? execution.createdAt;
          if (endedAt.getTime() < sinceMs) continue;
          items.push({
            key: `automation_execution:${execution.id}`,
            entity: 'automation_execution',
            entityId: execution.id,
            title: automation.name,
            href: `/automations/${automation.id}`,
            ...(automation.projectId ? { project: { id: automation.projectId, name: automation.projectId } } : {}),
            endedAt: endedAt.toISOString(),
            outcome,
            summary:
              execution.error ??
              `${execution.completedIterations}/${execution.totalIterations} iteration${execution.totalIterations === 1 ? '' : 's'} completed`,
            meta: {
              automation: {
                id: automation.id,
                triggerType: automation.triggerType,
                ...(automation.triggerType === 'schedule' && automation.cronExpression
                  ? { cronExpression: automation.cronExpression }
                  : {}),
              },
            },
          });
        }
      }

      // ── Merge, sort newest first, take the page ──
      items.sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());
      const page = items.slice(0, limit);

      // ── Enrich the final page only (bounded extra reads) ──
      const projectIds = [...new Set(page.map((i) => i.project?.id).filter((id): id is string => !!id))];
      const projectNames = new Map<string, string>();
      await Promise.all(
        projectIds.map(async (id) => {
          try {
            const project = await projectService.getProject(id);
            projectNames.set(id, project.name);
          } catch {
            // Deleted since the underlying row was read — leave the id as the label.
          }
        }),
      );

      const enriched = await Promise.all(
        page.map(async (item) => {
          const named = item.project
            ? { ...item, project: { id: item.project.id, name: projectNames.get(item.project.id) ?? item.project.id } }
            : item;
          const source = scmSource.get(item.key);
          let withName: RecentActivityItem = named;
          if (source) {
            try {
              const ws = await executionWorkspaceRepo.findById(source.workspaceId);
              withName = { ...named, ...activityScmFields(readScmOutcome(ws?.metadata), source.sinceMs) };
            } catch {
              /* a missing workspace just means no outcome to show */
            }
          }
          if (named.entity === 'chat' && orchestrators.has(named.entityId)) {
            // D-92: an orchestrator's worker tally (one indexed read per orchestrator on the page).
            try {
              const workers = await chatEntityRepo.listBackgroundTasks(named.entityId);
              withName = { ...withName, meta: { ...withName.meta, workers: tallyWorkers(workers) } };
            } catch {
              /* no tally rather than a wrong one */
            }
          }
          if (withName.entity !== 'run' || withName.commit) return withName;
          try {
            const worktrees = await worktreeService.listWorktrees(undefined, withName.entityId);
            const branch = worktrees.find((w) => w.branchName)?.branchName;
            return branch ? { ...withName, commit: { branch } } : withName;
          } catch {
            return withName;
          }
        }),
      );

      const body: RecentActivityPage = { items: enriched };
      res.set('Cache-Control', 'no-store').json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
