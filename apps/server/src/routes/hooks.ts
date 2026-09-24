// ────────────────────────────────────────────────────────────────
// Hooks Routes — hook phases, session hooks, and dry-run testing
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';
import { HOOK_PHASE_INFO, HookDefinitionSchema, type HookDefinition } from '@generatorai/shared';

/** Every hook phase the schema accepts, in schema order, with its catalogue entry. */
const HOOK_PHASES = HookDefinitionSchema.shape.phase.options.map((phase) => ({
  phase,
  ...HOOK_PHASE_INFO[phase],
}));

export function createHooksRoutes(container: Container): Router {
  const router = Router();
  const { hookExecutor, configResolver, logger } = container;

  // GET /hooks/phases — List every available hook phase
  router.get('/phases', (_req, res) => {
    // Organize by category
    const byCategory: Record<string, typeof HOOK_PHASES> = {};
    for (const phase of HOOK_PHASES) {
      if (!byCategory[phase.category]) {
        byCategory[phase.category] = [];
      }
      byCategory[phase.category]!.push(phase);
    }

    res.json({
      totalPhases: HOOK_PHASES.length,
      categories: byCategory,
      phases: HOOK_PHASES,
    });
  });

  // GET /sessions/:id/hooks — Get hooks configured for a session
  router.get('/sessions/:id/hooks', async (req, res, next) => {
    try {
      const sessionId = String(req.params['id']);
      // Read workflows directly from repository (stable ordering by execution order)
      const workflows = (await container.workflowRepo.getBySessionId(sessionId))
        .sort((a, b) => a.order - b.order);

      const sessionHooks: Array<{
        workflowId: string;
        workflowName: string;
        hooks: Record<string, unknown>;
      }> = [];

      for (const wf of workflows) {
        const hookOverrides = wf.hookOverrides ?? {};
        sessionHooks.push({
          workflowId: wf.id,
          workflowName: wf.name,
          hooks: hookOverrides,
        });
      }

      // Also include global lifecycle hooks
      const globalHooks = configResolver.resolveGlobalHooks();

      res.json({
        sessionId,
        workflowHooks: sessionHooks,
        globalHooks,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /sessions/:id/hooks/test — Dry-run a hook definition.
  //
  // This does NOT dispatch. `HookExecutor.planPhase` resolves whether the
  // hook would fire for its phase, renders its command line / URL / module
  // path with the same interpolation the real path uses, and runs every
  // policy check (script allow-list, URL validity, handler registration) —
  // then returns that plan. The previous implementation set a `__dryRun`
  // variable nothing read and called `executePhase` for real, so "testing"
  // a hook spawned its process / made its HTTP call and reported
  // "executed successfully in dry-run mode".
  router.post('/sessions/:id/hooks/test', async (req, res, next) => {
    try {
      const sessionId = String(req.params['id']);
      const body = (req.body ?? {}) as Partial<HookDefinition> & { variables?: Record<string, unknown> };

      if (!body.phase || !body.type || !body.config || typeof body.config !== 'object') {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Hook config must include phase, type and config' },
        });
        return;
      }
      if ((body.config as { type?: unknown }).type !== body.type) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: '`type` and `config.type` must agree' },
        });
        return;
      }

      // Fill the optional scheduling fields with the same defaults a stored
      // hook gets, so a partial body from the UI plans like a real hook.
      const hook: HookDefinition = {
        id: body.id ?? '__test__',
        name: body.name ?? `${body.phase}:${body.type}`,
        phase: body.phase,
        type: body.type,
        priority: body.priority ?? 0,
        enabled: body.enabled ?? true,
        failurePolicy: body.failurePolicy ?? 'continue',
        timeoutMs: body.timeoutMs ?? 30_000,
        retries: body.retries ?? 0,
        config: body.config as HookDefinition['config'],
      };

      // Caller-supplied variables let the UI preview `{{var}}` interpolation
      // against realistic values; everything is stringified the way the run
      // path stringifies its variables.
      const variables: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.variables ?? {})) {
        variables[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }

      const plan = await hookExecutor.planPhase(hook.phase, [hook], {
        sessionId,
        workflowId: '__test__',
        workspacePath: process.cwd(),
        variables,
      });

      logger.info(`[HooksRoutes] Dry-run planned hook for session ${sessionId}`, {
        phase: hook.phase,
        type: hook.type,
        valid: plan.valid,
      });

      res.json({
        success: plan.valid,
        dryRun: true,
        message: plan.valid
          ? 'Hook is valid and would dispatch (nothing was executed)'
          : 'Hook would be refused (nothing was executed)',
        plan,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
