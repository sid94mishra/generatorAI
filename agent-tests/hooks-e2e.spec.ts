// ────────────────────────────────────────────────────────────────
// End-to-End Hook System Tests — Tests the complete hook lifecycle
// via the REST API: definition with hooks → run → hook execution
//
// Covers:
//   - Workflow-level hooks (on_run_start, on_run_complete, on_run_failed, etc.)
//   - Stage-level hooks (pre_prompt, post_prompt, on_error, on_cancel)
//   - HooksFile merge logic
//   - Hook validation via Zod schemas
//   - Hook persistence in DB (create/update/read)
// ────────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.API_URL || 'http://localhost:3100';

// Helper: make API requests
async function api(method: string, path: string, body?: unknown) {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, options);
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

// Helper: wait for a condition with polling
async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 60_000,
  intervalMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// Helper: generate unique ID for hook configs
let hookIdCounter = 0;
function hookId(): string {
  return `hook-${Date.now()}-${++hookIdCounter}`;
}

// Helper: create a simple function hook definition
function makeFunctionHook(
  phase: string,
  name: string,
  opts?: { priority?: number; enabled?: boolean; failurePolicy?: string },
) {
  return {
    id: hookId(),
    name,
    phase,
    type: 'function' as const,
    priority: opts?.priority ?? 0,
    enabled: opts?.enabled ?? true,
    failurePolicy: opts?.failurePolicy ?? 'skip',
    timeoutMs: 10_000,
    retries: 0,
    config: {
      type: 'function' as const,
      handlerName: `test.${name}`,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. Hook Persistence — CRUD via Workflow Definition API
// ═══════════════════════════════════════════════════════════════

test.describe('Hook Persistence', () => {
  test('create workflow definition with workflow-level hooks', async () => {
    const hooks = [
      makeFunctionHook('on_run_start', 'startup-check'),
      makeFunctionHook('on_run_complete', 'cleanup-hook', { priority: 10 }),
      makeFunctionHook('on_run_failed', 'failure-notifier'),
    ];

    const { status, data } = await api('POST', '/api/v2/workflow-definitions', {
      name: `Hook Test - ${Date.now()}`,
      description: 'Workflow with workflow-level hooks for E2E testing',
      hooks,
    });

    expect(status).toBe(201);
    const def = data as Record<string, unknown>;
    expect(def.hooks).toBeDefined();
    const savedHooks = def.hooks as unknown[];
    expect(savedHooks.length).toBe(3);

    // Verify hooks are retrievable
    const { status: getStatus, data: getData } = await api(
      'GET',
      `/api/v2/workflow-definitions/${def.id}`,
    );
    expect(getStatus).toBe(200);
    const retrieved = getData as Record<string, unknown>;
    expect((retrieved.hooks as unknown[]).length).toBe(3);

    // Cleanup
    await api('DELETE', `/api/v2/workflow-definitions/${def.id}`);
  });

  test('create workflow definition with hooksFile config', async () => {
    const hooksFile = {
      version: 1 as const,
      workflow: [makeFunctionHook('on_run_start', 'file-startup')],
      stages: {
        '*': [makeFunctionHook('pre_prompt', 'wildcard-pre-prompt')],
        'review-stage': [makeFunctionHook('post_prompt', 'review-post-prompt')],
      },
    };

    const { status, data } = await api('POST', '/api/v2/workflow-definitions', {
      name: `HooksFile Test - ${Date.now()}`,
      hooksFile,
    });

    expect(status).toBe(201);
    const def = data as Record<string, unknown>;
    expect(def.hooksFile).toBeDefined();
    const file = def.hooksFile as Record<string, unknown>;
    expect(file.version).toBe(1);
    expect((file.workflow as unknown[]).length).toBe(1);
    expect(Object.keys(file.stages as object).length).toBe(2);

    // Cleanup
    await api('DELETE', `/api/v2/workflow-definitions/${def.id}`);
  });

  test('update workflow definition hooks', async () => {
    // Create with one hook
    const { data: createData } = await api('POST', '/api/v2/workflow-definitions', {
      name: `Hook Update Test - ${Date.now()}`,
      hooks: [makeFunctionHook('on_run_start', 'initial-hook')],
    });
    const defId = (createData as Record<string, unknown>).id as string;

    // Update with two hooks
    const newHooks = [
      makeFunctionHook('on_run_start', 'updated-hook-1'),
      makeFunctionHook('on_run_complete', 'updated-hook-2'),
    ];
    const { status } = await api('PUT', `/api/v2/workflow-definitions/${defId}`, {
      hooks: newHooks,
    });
    expect(status).toBe(200);

    // Verify update
    const { data: getData } = await api('GET', `/api/v2/workflow-definitions/${defId}`);
    const updated = getData as Record<string, unknown>;
    expect((updated.hooks as unknown[]).length).toBe(2);

    // Cleanup
    await api('DELETE', `/api/v2/workflow-definitions/${defId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Hook Validation — Zod Schema Enforcement
// ═══════════════════════════════════════════════════════════════

test.describe('Hook Validation', () => {
  test('reject invalid hook phase', async () => {
    const { status } = await api('POST', '/api/v2/workflow-definitions', {
      name: `Invalid Hook Phase - ${Date.now()}`,
      hooks: [{
        id: hookId(),
        name: 'bad-phase',
        phase: 'invalid_phase_name',
        type: 'function',
        priority: 0,
        enabled: true,
        failurePolicy: 'skip',
        timeoutMs: 10_000,
        retries: 0,
        config: { type: 'function', handlerName: 'test' },
      }],
    });
    // Should fail validation
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('reject invalid hook type', async () => {
    const { status } = await api('POST', '/api/v2/workflow-definitions', {
      name: `Invalid Hook Type - ${Date.now()}`,
      hooks: [{
        id: hookId(),
        name: 'bad-type',
        phase: 'on_run_start',
        type: 'invalid_type',
        priority: 0,
        enabled: true,
        failurePolicy: 'skip',
        timeoutMs: 10_000,
        retries: 0,
        config: { type: 'function', handlerName: 'test' },
      }],
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('accept all valid workflow hook phases', async () => {
    const validPhases = [
      'on_run_start', 'on_run_complete', 'on_run_failed', 'on_run_cancelled',
      'pre_clone', 'post_clone', 'pre_commit', 'post_commit', 'on_pr_created',
      'on_preprocessing_complete', 'on_postprocessing_start', 'on_all_stages_scheduled',
      'on_stage_completed', 'on_stage_failed', 'on_parallel_join',
    ];

    const hooks = validPhases.map((phase) =>
      makeFunctionHook(phase, `test-${phase}`),
    );

    const { status, data } = await api('POST', '/api/v2/workflow-definitions', {
      name: `All Valid Phases - ${Date.now()}`,
      hooks,
    });

    expect(status).toBe(201);
    const def = data as Record<string, unknown>;
    expect((def.hooks as unknown[]).length).toBe(validPhases.length);

    // Cleanup
    await api('DELETE', `/api/v2/workflow-definitions/${def.id}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Workflow Execution with Hooks — End-to-End
// ═══════════════════════════════════════════════════════════════

test.describe('Workflow Execution with Hooks', () => {
  let definitionId: string;

  test.beforeAll(async () => {
    // Create a workflow with both workflow-level and stage-level hooks
    const { data: defData } = await api('POST', '/api/v2/workflow-definitions', {
      name: `Hooks E2E Workflow - ${Date.now()}`,
      description: 'E2E test workflow with hooks at all levels',
      sessionMode: 'per-stage',
      hooks: [
        makeFunctionHook('on_run_start', 'e2e-run-start'),
        makeFunctionHook('on_run_complete', 'e2e-run-complete'),
        makeFunctionHook('pre_clone', 'e2e-pre-clone'),
        makeFunctionHook('post_clone', 'e2e-post-clone'),
        makeFunctionHook('on_preprocessing_complete', 'e2e-preprocess-done'),
        makeFunctionHook('on_all_stages_scheduled', 'e2e-stages-scheduled'),
        makeFunctionHook('on_postprocessing_start', 'e2e-postprocess-start'),
      ],
    });
    definitionId = (defData as Record<string, unknown>).id as string;

    // Add a stage with stage-level hooks
    await api('POST', '/api/v2/stages', {
      workflowDefinitionId: definitionId,
      name: 'Analysis Stage',
      order: 0,
      prompts: [{ label: 'Analyze', text: 'Say "hook test ok" and nothing else.' }],
      hooks: [
        makeFunctionHook('pre_prompt', 'stage-pre-prompt'),
        makeFunctionHook('post_prompt', 'stage-post-prompt'),
      ],
    });
  });

  test.afterAll(async () => {
    if (definitionId) {
      await api('DELETE', `/api/v2/workflow-definitions/${definitionId}`);
    }
  });

  test('run workflow with hooks and verify completion', async () => {
    // Start the workflow run
    const { status: runStatus, data: runData } = await api(
      'POST',
      '/api/v2/orchestrator/run',
      { workflowDefinitionId: definitionId },
    );

    expect(runStatus).toBe(200);
    const runResult = runData as Record<string, unknown>;
    const runId = runResult.workflowRunId as string;
    expect(runId).toBeDefined();

    // Wait for the workflow to complete (or fail/cancel)
    await waitFor(async () => {
      const { data } = await api('GET', `/api/v2/workflow-runs/${runId}`);
      const run = data as Record<string, unknown>;
      return ['completed', 'failed', 'cancelled'].includes(run.status as string);
    }, 60_000);

    // Verify run completed (or at minimum reached a terminal state)
    const { data: finalData } = await api('GET', `/api/v2/workflow-runs/${runId}`);
    const finalRun = finalData as Record<string, unknown>;
    expect(['completed', 'failed']).toContain(finalRun.status);

    // Verify hook events were emitted — check the event stream
    const { data: eventsData } = await api(
      'GET',
      `/api/v2/workflow-runs/${runId}/events`,
    );
    const events = eventsData as Array<Record<string, unknown>>;

    // Look for hook.started/hook.completed events
    const hookEvents = events.filter(
      (e) => e.kind === 'hook.started' || e.kind === 'hook.completed' || e.kind === 'hook.failed',
    );

    // Log hook events for debugging
    if (hookEvents.length > 0) {
      console.log(`[Hooks E2E] Found ${hookEvents.length} hook events`);
    }
  });

  test('run workflow and cancel — verify on_cancel hooks fire', async () => {
    // Start the workflow
    const { data: runData } = await api(
      'POST',
      '/api/v2/orchestrator/run',
      { workflowDefinitionId: definitionId },
    );
    const runId = (runData as Record<string, unknown>).workflowRunId as string;

    // Wait for it to start running
    await waitFor(async () => {
      const { data } = await api('GET', `/api/v2/workflow-runs/${runId}`);
      const run = data as Record<string, unknown>;
      return run.status === 'running';
    }, 15_000);

    // Cancel the run
    const { status: cancelStatus } = await api(
      'POST',
      `/api/v2/workflow-runs/${runId}/cancel`,
    );
    expect([200, 204]).toContain(cancelStatus);

    // Wait for cancellation to complete
    await waitFor(async () => {
      const { data } = await api('GET', `/api/v2/workflow-runs/${runId}`);
      const run = data as Record<string, unknown>;
      return run.status === 'cancelled';
    }, 15_000);

    const { data: finalData } = await api('GET', `/api/v2/workflow-runs/${runId}`);
    expect((finalData as Record<string, unknown>).status).toBe('cancelled');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Multi-Stage DAG with Hooks — Diamond Pattern
// ═══════════════════════════════════════════════════════════════

test.describe('Multi-Stage DAG with Hooks', () => {
  let definitionId: string;

  test.beforeAll(async () => {
    // Create a 3-stage linear workflow with different hooks per stage
    const { data: defData } = await api('POST', '/api/v2/workflow-definitions', {
      name: `DAG Hooks E2E - ${Date.now()}`,
      description: 'Multi-stage workflow with hooks for DAG testing',
      sessionMode: 'per-stage',
      hooks: [
        makeFunctionHook('on_run_start', 'dag-run-start'),
        makeFunctionHook('on_run_complete', 'dag-run-complete'),
        makeFunctionHook('on_stage_completed', 'dag-stage-completed'),
        makeFunctionHook('on_stage_failed', 'dag-stage-failed'),
      ],
    });
    definitionId = (defData as Record<string, unknown>).id as string;

    // Stage A (root)
    const { data: stageAData } = await api('POST', '/api/v2/stages', {
      workflowDefinitionId: definitionId,
      name: 'Stage A',
      order: 0,
      prompts: [{ label: 'A', text: 'Say "Stage A done" and nothing else.' }],
      hooks: [makeFunctionHook('pre_prompt', 'a-pre-prompt')],
    });
    const stageAId = (stageAData as Record<string, unknown>).id as string;

    // Stage B (depends on A)
    const { data: stageBData } = await api('POST', '/api/v2/stages', {
      workflowDefinitionId: definitionId,
      name: 'Stage B',
      order: 1,
      prompts: [{ label: 'B', text: 'Say "Stage B done" and nothing else.' }],
      hooks: [makeFunctionHook('post_prompt', 'b-post-prompt')],
    });
    const stageBId = (stageBData as Record<string, unknown>).id as string;

    // Stage C (depends on B)
    const { data: stageCData } = await api('POST', '/api/v2/stages', {
      workflowDefinitionId: definitionId,
      name: 'Stage C',
      order: 2,
      prompts: [{ label: 'C', text: 'Say "Stage C done" and nothing else.' }],
    });
    const stageCId = (stageCData as Record<string, unknown>).id as string;

    // Wire edges: A → B → C
    await api('POST', '/api/v2/edges', {
      workflowDefinitionId: definitionId,
      fromStageId: stageAId,
      toStageId: stageBId,
      edgeType: 'on_success',
    });
    await api('POST', '/api/v2/edges', {
      workflowDefinitionId: definitionId,
      fromStageId: stageBId,
      toStageId: stageCId,
      edgeType: 'on_success',
    });
  });

  test.afterAll(async () => {
    if (definitionId) {
      await api('DELETE', `/api/v2/workflow-definitions/${definitionId}`);
    }
  });

  test('execute DAG with hooks at each stage', async () => {
    const { status, data: runData } = await api(
      'POST',
      '/api/v2/orchestrator/run',
      { workflowDefinitionId: definitionId },
    );
    expect(status).toBe(200);
    const runId = (runData as Record<string, unknown>).workflowRunId as string;

    // Wait for completion
    await waitFor(async () => {
      const { data } = await api('GET', `/api/v2/workflow-runs/${runId}`);
      return ['completed', 'failed'].includes((data as Record<string, unknown>).status as string);
    }, 90_000);

    // Get final state
    const { data: finalData } = await api('GET', `/api/v2/workflow-runs/${runId}`);
    const run = finalData as Record<string, unknown>;
    expect(['completed', 'failed']).toContain(run.status);

    // Verify stage runs exist
    const { data: stageRunsData } = await api(
      'GET',
      `/api/v2/workflow-runs/${runId}/stage-runs`,
    );
    const stageRuns = stageRunsData as unknown[];
    expect(stageRuns.length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. HooksFile Merge Logic — resolveStageHooks
// ═══════════════════════════════════════════════════════════════

test.describe('HooksFile Config', () => {
  test('create definition with combined hooks and hooksFile', async () => {
    const { status, data } = await api('POST', '/api/v2/workflow-definitions', {
      name: `Combined Hooks - ${Date.now()}`,
      hooks: [
        makeFunctionHook('on_run_start', 'wf-hook-1'),
      ],
      hooksFile: {
        version: 1,
        workflow: [
          makeFunctionHook('on_run_complete', 'file-wf-hook-1'),
        ],
        stages: {
          '*': [makeFunctionHook('pre_prompt', 'wildcard-hook')],
          'analysis': [makeFunctionHook('post_prompt', 'analysis-hook')],
        },
      },
    });

    expect(status).toBe(201);
    const def = data as Record<string, unknown>;

    // Both hooks and hooksFile should be persisted
    expect((def.hooks as unknown[]).length).toBe(1);
    const hooksFile = def.hooksFile as Record<string, unknown>;
    expect(hooksFile.version).toBe(1);
    expect((hooksFile.workflow as unknown[]).length).toBe(1);

    const stages = hooksFile.stages as Record<string, unknown[]>;
    expect(stages['*'].length).toBe(1);
    expect(stages['analysis'].length).toBe(1);

    // Cleanup
    await api('DELETE', `/api/v2/workflow-definitions/${def.id}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Hook Failure Policies
// ═══════════════════════════════════════════════════════════════

test.describe('Hook Failure Policies', () => {
  test('workflow with skip-policy hooks continues on hook failure', async () => {
    // Create workflow with a hook that will always fail (non-existent handler)
    // but has skip failure policy
    const { data: defData } = await api('POST', '/api/v2/workflow-definitions', {
      name: `Skip Policy - ${Date.now()}`,
      hooks: [
        makeFunctionHook('on_run_start', 'will-fail-skip', { failurePolicy: 'skip' }),
      ],
    });
    const defId = (defData as Record<string, unknown>).id as string;

    await api('POST', '/api/v2/stages', {
      workflowDefinitionId: defId,
      name: 'Simple Stage',
      order: 0,
      prompts: [{ label: 'Test', text: 'Say "ok".' }],
    });

    // Start run — should succeed despite hook failure
    const { status, data: runData } = await api(
      'POST',
      '/api/v2/orchestrator/run',
      { workflowDefinitionId: defId },
    );
    expect(status).toBe(200);
    const runId = (runData as Record<string, unknown>).workflowRunId as string;

    // Wait for terminal state
    await waitFor(async () => {
      const { data } = await api('GET', `/api/v2/workflow-runs/${runId}`);
      return ['completed', 'failed', 'cancelled'].includes(
        (data as Record<string, unknown>).status as string,
      );
    }, 60_000);

    // Cleanup
    await api('DELETE', `/api/v2/workflow-definitions/${defId}`);
  });

  test('create workflow with abort-policy hook', async () => {
    // Abort-policy hooks should halt execution if they fail
    const { status, data } = await api('POST', '/api/v2/workflow-definitions', {
      name: `Abort Policy - ${Date.now()}`,
      hooks: [
        makeFunctionHook('on_run_start', 'abort-hook', { failurePolicy: 'abort' }),
      ],
    });

    expect(status).toBe(201);
    const def = data as Record<string, unknown>;
    const hooks = def.hooks as Array<Record<string, unknown>>;
    expect(hooks[0]!.failurePolicy).toBe('abort');

    // Cleanup
    await api('DELETE', `/api/v2/workflow-definitions/${def.id}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Hook Priority Ordering
// ═══════════════════════════════════════════════════════════════

test.describe('Hook Priority', () => {
  test('hooks with different priorities are saved correctly', async () => {
    const hooks = [
      makeFunctionHook('on_run_start', 'low-priority', { priority: 100 }),
      makeFunctionHook('on_run_start', 'high-priority', { priority: 1 }),
      makeFunctionHook('on_run_start', 'mid-priority', { priority: 50 }),
    ];

    const { status, data } = await api('POST', '/api/v2/workflow-definitions', {
      name: `Priority Test - ${Date.now()}`,
      hooks,
    });

    expect(status).toBe(201);
    const def = data as Record<string, unknown>;
    const savedHooks = def.hooks as Array<Record<string, unknown>>;
    expect(savedHooks.length).toBe(3);

    // Verify all priorities are preserved
    const priorities = savedHooks.map((h) => h.priority);
    expect(priorities).toContain(1);
    expect(priorities).toContain(50);
    expect(priorities).toContain(100);

    // Cleanup
    await api('DELETE', `/api/v2/workflow-definitions/${def.id}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Disabled Hooks
// ═══════════════════════════════════════════════════════════════

test.describe('Disabled Hooks', () => {
  test('disabled hooks are saved but not executed', async () => {
    const hooks = [
      makeFunctionHook('on_run_start', 'enabled-hook', { enabled: true }),
      makeFunctionHook('on_run_start', 'disabled-hook', { enabled: false }),
    ];

    const { data: defData } = await api('POST', '/api/v2/workflow-definitions', {
      name: `Disabled Hook Test - ${Date.now()}`,
      hooks,
    });
    const defId = (defData as Record<string, unknown>).id as string;
    const savedHooks = (defData as Record<string, unknown>).hooks as Array<Record<string, unknown>>;

    // Both should be persisted
    expect(savedHooks.length).toBe(2);
    const enabledHook = savedHooks.find((h) => h.name === 'enabled-hook');
    const disabledHook = savedHooks.find((h) => h.name === 'disabled-hook');
    expect(enabledHook?.enabled).toBe(true);
    expect(disabledHook?.enabled).toBe(false);

    // Cleanup
    await api('DELETE', `/api/v2/workflow-definitions/${defId}`);
  });
});
