// ────────────────────────────────────────────────────────────────
// Hooks Routes — hook phases, session hooks, and test execution
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';
import type { HookPhase } from '@generatorai/shared';

/** All 22 available hook phases organized by category. */
const HOOK_PHASES: Array<{ phase: HookPhase; category: string; description: string }> = [
  // Workflow lifecycle
  { phase: 'pre_run', category: 'workflow', description: 'Before workflow execution starts' },
  { phase: 'post_run', category: 'workflow', description: 'After workflow execution completes' },
  // Git operations
  { phase: 'pre_clone', category: 'git', description: 'Before repository clone' },
  { phase: 'post_clone', category: 'git', description: 'After repository clone' },
  // Prompt lifecycle
  { phase: 'pre_prompt', category: 'prompt', description: 'Before sending a prompt to Copilot' },
  { phase: 'post_prompt', category: 'prompt', description: 'After receiving prompt response' },
  // Commit operations
  { phase: 'pre_commit', category: 'git', description: 'Before git commit' },
  { phase: 'post_commit', category: 'git', description: 'After git commit' },
  // Error handling
  { phase: 'on_error', category: 'error', description: 'When a workflow error occurs' },
  { phase: 'on_cancel', category: 'lifecycle', description: 'When workflow is cancelled' },
  // Tool usage
  { phase: 'pre_tool_use', category: 'tool', description: 'Before a Copilot tool is invoked' },
  { phase: 'post_tool_use', category: 'tool', description: 'After a Copilot tool completes' },
  // Message events
  { phase: 'on_message', category: 'message', description: 'When a message is received from Copilot' },
  { phase: 'on_reasoning', category: 'message', description: 'When reasoning content is received' },
  // Session lifecycle
  { phase: 'on_session_start', category: 'session', description: 'When a session starts' },
  { phase: 'on_session_idle', category: 'session', description: 'When a session becomes idle' },
  { phase: 'on_session_error', category: 'session', description: 'When a session error occurs' },
  // Client lifecycle
  { phase: 'on_client_start', category: 'client', description: 'When the Copilot client starts' },
  { phase: 'on_client_stop', category: 'client', description: 'When the Copilot client stops' },
  { phase: 'on_client_error', category: 'client', description: 'When the Copilot client encounters an error' },
  { phase: 'on_client_restart', category: 'client', description: 'When the Copilot client restarts' },
  // Permission
  { phase: 'on_permission', category: 'security', description: 'When a permission request is made' },
];

export function createHooksRoutes(container: Container): Router {
  const router = Router();
  const { hookExecutor, configResolver, logger } = container;

  // GET /hooks/phases — List all 22 available hook phases
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

  // POST /sessions/:id/hooks/test — Test a hook in dry-run mode
  router.post('/sessions/:id/hooks/test', async (req, res, next) => {
    try {
      const sessionId = String(req.params['id']);
      const hookConfig = req.body;

      if (!hookConfig || !hookConfig['phase'] || !hookConfig['type']) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Hook config must include phase and type' },
        });
        return;
      }

      // Create synthetic context for testing
      const testContext = {
        sessionId,
        workflowId: '__test__',
        workspacePath: '/tmp/test',
        variables: { __dryRun: 'true' } as Record<string, string>,
        eventBus: container.eventBus,
      };

      logger.info(`[HooksRoutes] Testing hook for session ${sessionId}`, {
        phase: hookConfig['phase'],
        type: hookConfig['type'],
      });

      try {
        await hookExecutor.executePhase(hookConfig['phase'], [hookConfig], testContext);
        res.json({ success: true, message: 'Hook executed successfully in dry-run mode' });
      } catch (hookErr) {
        res.json({
          success: false,
          message: 'Hook execution failed',
          error: hookErr instanceof Error ? hookErr.message : String(hookErr),
        });
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}
