// ────────────────────────────────────────────────────────────────
// End-to-End Workflow Tests — Tests the complete workflow lifecycle
// via the REST API: definition → run → stage execution → streaming
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
  timeoutMs = 30_000,
  intervalMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// ═══════════════════════════════════════════════════════════════
// 1. Health & Server
// ═══════════════════════════════════════════════════════════════

test.describe('Health & Server', () => {
  test('server health check returns ok', async () => {
    const { status, data } = await api('GET', '/api/health');
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.status).toBe('ok');
    expect(d.copilot).toBe(true);
    expect(d.db).toBe(true);
    expect(typeof d.uptime).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Template System
// ═══════════════════════════════════════════════════════════════

test.describe('Template System', () => {
  test('list system workflow templates', async () => {
    const { status, data } = await api('GET', '/api/orchestrator/system-workflows');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test('list user templates', async () => {
    const { status, data } = await api('GET', '/api/templates');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Workflow Definition CRUD
// ═══════════════════════════════════════════════════════════════

test.describe('Workflow Definition CRUD', () => {
  let definitionId: string;

  test('create workflow definition', async () => {
    const { status, data } = await api('POST', '/api/workflow-definitions', {
      name: 'E2E Test Workflow',
      description: 'A test workflow for end-to-end validation',
      sessionMode: 'single',
      copilotConfig: {
        model: 'gpt-4.1',
      },
      variables: [
        {
          name: 'language',
          type: 'string',
          label: 'Programming Language',
          required: true,
          defaultValue: 'TypeScript',
        },
      ],
      tags: ['e2e-test'],
    });

    expect(status).toBe(201);
    const d = data as Record<string, unknown>;
    expect(d.id).toBeTruthy();
    expect(d.name).toBe('E2E Test Workflow');
    expect(d.sessionMode).toBe('single');
    definitionId = d.id as string;
  });

  test('get workflow definition with embedded stages and edges', async () => {
    const { status, data } = await api('GET', `/api/workflow-definitions/${definitionId}`);
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.id).toBe(definitionId);
    expect(d.name).toBe('E2E Test Workflow');
    // Initially no stages or edges
    expect(Array.isArray(d.stages)).toBe(true);
    expect(Array.isArray(d.edges)).toBe(true);
    expect((d.stages as unknown[]).length).toBe(0);
  });

  test('add stage: Code Generation', async () => {
    const { status, data } = await api('POST', `/api/workflow-definitions/${definitionId}/stages`, {
      name: 'Code Generation',
      description: 'Generate code based on requirements',
      order: 0,
      prompts: [
        {
          label: 'Generate Code',
          text: 'Write a simple hello world function in {{language}}. Just output the code.',
          waitForCompletion: true,
        },
      ],
    });
    expect(status).toBe(201);
    const d = data as Record<string, unknown>;
    expect(d.id).toBeTruthy();
    expect(d.name).toBe('Code Generation');
  });

  test('add stage: Code Review', async () => {
    const { status, data } = await api('POST', `/api/workflow-definitions/${definitionId}/stages`, {
      name: 'Code Review',
      description: 'Review the generated code',
      order: 1,
      prompts: [
        {
          label: 'Review Code',
          text: 'Review the code generated in the previous stage. Provide a brief, one-paragraph review.',
          waitForCompletion: true,
        },
      ],
    });
    expect(status).toBe(201);
    const d = data as Record<string, unknown>;
    expect(d.id).toBeTruthy();
  });

  test('verify stages embedded in definition', async () => {
    const { status, data } = await api('GET', `/api/workflow-definitions/${definitionId}`);
    expect(status).toBe(200);
    const d = data as { stages: Array<{ id: string; name: string; order: number }>; edges: unknown[] };
    expect(d.stages.length).toBe(2);
    // Stages are ordered
    const names = d.stages.map((s) => s.name);
    expect(names).toContain('Code Generation');
    expect(names).toContain('Code Review');
  });

  test('add DAG edge between stages', async () => {
    // Get stages from embedded definition
    const { data: defData } = await api('GET', `/api/workflow-definitions/${definitionId}`);
    const def = defData as { stages: Array<{ id: string; name: string }> };
    expect(def.stages.length).toBe(2);

    const codeGenStage = def.stages.find((s) => s.name === 'Code Generation')!;
    const codeRevStage = def.stages.find((s) => s.name === 'Code Review')!;

    const { status, data } = await api('POST', `/api/workflow-definitions/${definitionId}/edges`, {
      fromStageId: codeGenStage.id,
      toStageId: codeRevStage.id,
      edgeType: 'on_success',
    });
    expect(status).toBe(201);
    const d = data as Record<string, unknown>;
    expect(d.id).toBeTruthy();
  });

  test('verify edges embedded in definition', async () => {
    const { status, data } = await api('GET', `/api/workflow-definitions/${definitionId}`);
    expect(status).toBe(200);
    const d = data as { edges: Array<{ fromStageId: string; toStageId: string }> };
    expect(d.edges.length).toBe(1);
  });

  test('validate DAG structure', async () => {
    const { status, data } = await api('POST', `/api/workflow-definitions/${definitionId}/validate`);
    expect(status).toBe(200);
    const d = data as { valid: boolean };
    expect(d.valid).toBe(true);
  });

  test('list workflow definitions includes new one', async () => {
    const { status, data } = await api('GET', '/api/workflow-definitions');
    expect(status).toBe(200);
    const definitions = data as Array<{ id: string }>;
    expect(definitions.some((d) => d.id === definitionId)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Workflow Run Lifecycle
// ═══════════════════════════════════════════════════════════════

test.describe('Workflow Run Lifecycle', () => {
  let definitionId: string;
  let runId: string;

  test.beforeAll(async () => {
    // Create a simple workflow definition for run tests
    const { data } = await api('POST', '/api/workflow-definitions', {
      name: 'Run Lifecycle Test',
      sessionMode: 'single',
      copilotConfig: { model: 'gpt-4.1' },
      variables: [],
      tags: ['run-test'],
    });
    definitionId = (data as Record<string, unknown>).id as string;

    // Add a single stage
    await api('POST', `/api/workflow-definitions/${definitionId}/stages`, {
      name: 'Quick Task',
      order: 0,
      prompts: [
        {
          label: 'Hello',
          text: 'Say "Hello World" and nothing else.',
          waitForCompletion: true,
        },
      ],
    });
  });

  test('create workflow run', async () => {
    const { status, data } = await api('POST', '/api/workflow-runs', {
      workflowDefinitionId: definitionId,
      variables: {},
    });
    expect(status).toBe(201);
    const d = data as Record<string, unknown>;
    expect(d.id).toBeTruthy();
    expect(d.status).toBe('created');
    runId = d.id as string;
  });

  test('get workflow run shows created status', async () => {
    const { status, data } = await api('GET', `/api/workflow-runs/${runId}`);
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.status).toBe('created');
    expect(d.workflowDefinitionId).toBe(definitionId);
  });

  test('list workflow runs includes new run', async () => {
    const { status, data } = await api('GET', '/api/workflow-runs');
    expect(status).toBe(200);
    const runs = data as Array<{ id: string }>;
    expect(runs.some((r) => r.id === runId)).toBe(true);
  });

  test('start workflow run manually', async () => {
    const { status, data } = await api('POST', `/api/workflow-runs/${runId}/start`);
    expect(status).toBe(202);
    const d = data as Record<string, unknown>;
    expect(d.runId).toBe(runId);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Orchestrated Run (E2E)
// ═══════════════════════════════════════════════════════════════

test.describe('Orchestrated Run (E2E)', () => {
  let definitionId: string;

  test.beforeAll(async () => {
    // Create a simple workflow definition
    const { data } = await api('POST', '/api/workflow-definitions', {
      name: 'Orchestrated E2E Test',
      sessionMode: 'single',
      copilotConfig: { model: 'gpt-4.1' },
      variables: [],
      tags: ['e2e-orchestrated'],
    });
    definitionId = (data as Record<string, unknown>).id as string;

    await api('POST', `/api/workflow-definitions/${definitionId}/stages`, {
      name: 'Generate',
      order: 0,
      prompts: [
        {
          label: 'Generate',
          text: 'Output exactly: "Generated OK"',
          waitForCompletion: true,
        },
      ],
    });
  });

  test('start orchestrated run and check progress', async () => {
    // Start orchestrated run
    const { status, data } = await api('POST', '/api/orchestrator/runs', {
      workflowDefinitionId: definitionId,
      variables: {},
    });
    expect(status).toBe(201);
    const context = data as { workflowRunId: string };
    expect(context.workflowRunId).toBeTruthy();

    // Wait for run to reach a non-created status
    await waitFor(async () => {
      const { data: runData } = await api('GET', `/api/workflow-runs/${context.workflowRunId}`);
      const run = runData as { status: string };
      return ['running', 'completed', 'failed'].includes(run.status);
    }, 30_000);

    // Verify run is at least running
    const { data: runData } = await api('GET', `/api/workflow-runs/${context.workflowRunId}`);
    const run = runData as { status: string; stageRuns?: Array<{ status: string; stageName: string }> };
    expect(['running', 'completed'].includes(run.status)).toBe(true);

    // If it has stageRuns, at least one should be non-pending
    if (run.stageRuns && run.stageRuns.length > 0) {
      const hasProgress = run.stageRuns.some((sr) =>
        ['queued', 'running', 'completed', 'failed'].includes(sr.status),
      );
      expect(hasProgress).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Streaming (SSE)
// ═══════════════════════════════════════════════════════════════

test.describe('Streaming (SSE)', () => {
  test('multiplexed SSE stream is accessible', async () => {
    const res = await fetch(`${BASE_URL}/api/events/stream`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // Close immediately
    if (res.body) {
      const reader = res.body.getReader();
      await reader.cancel();
    }
  });

  test('global SSE stream is accessible', async () => {
    const res = await fetch(`${BASE_URL}/api/events/global`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    if (res.body) {
      const reader = res.body.getReader();
      await reader.cancel();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Upload Custom Content
// ═══════════════════════════════════════════════════════════════

test.describe('Upload Custom Content', () => {
  let definitionId: string;
  let runId: string;

  test.beforeAll(async () => {
    // Create definition and run for upload tests
    const { data } = await api('POST', '/api/workflow-definitions', {
      name: 'Upload Test Workflow',
      sessionMode: 'single',
      copilotConfig: { model: 'gpt-4.1' },
      variables: [],
      tags: ['upload-test'],
    });
    definitionId = (data as Record<string, unknown>).id as string;

    await api('POST', `/api/workflow-definitions/${definitionId}/stages`, {
      name: 'Test Stage',
      order: 0,
      prompts: [{ label: 'Test', text: 'Say hello.', waitForCompletion: true }],
    });

    const { data: runData } = await api('POST', '/api/workflow-runs', {
      workflowDefinitionId: definitionId,
    });
    runId = (runData as Record<string, unknown>).id as string;
  });

  test('upload skill files to run', async () => {
    const formData = new FormData();
    formData.append('category', 'skills');
    const skillContent = '# My Custom Skill\n\nThis skill does something useful.';
    formData.append('files', new Blob([skillContent], { type: 'text/markdown' }), 'SKILL.md');

    const res = await fetch(`${BASE_URL}/api/orchestrator/runs/${runId}/uploads`, {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.success).toBe(true);
    expect(data.category).toBe('skills');
    expect(Array.isArray(data.files)).toBe(true);
  });

  test('upload agent files to run', async () => {
    const formData = new FormData();
    formData.append('category', 'agents');
    const agentContent = JSON.stringify({
      name: 'test-agent',
      description: 'A test agent',
      instructions: 'You are a test agent.',
    });
    formData.append('files', new Blob([agentContent], { type: 'application/json' }), 'test-agent.json');

    const res = await fetch(`${BASE_URL}/api/orchestrator/runs/${runId}/uploads`, {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.success).toBe(true);
    expect(data.category).toBe('agents');
  });

  test('upload prompt files to run', async () => {
    const formData = new FormData();
    formData.append('category', 'prompts');
    const promptContent = 'You are an expert code reviewer. Focus on security and performance.';
    formData.append('files', new Blob([promptContent], { type: 'text/plain' }), 'review-prompt.txt');

    const res = await fetch(`${BASE_URL}/api/orchestrator/runs/${runId}/uploads`, {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.success).toBe(true);
    expect(data.category).toBe('prompts');
  });

  test('reject invalid category upload', async () => {
    const formData = new FormData();
    formData.append('category', 'malware');
    formData.append('files', new Blob(['test'], { type: 'text/plain' }), 'test.txt');

    const res = await fetch(`${BASE_URL}/api/orchestrator/runs/${runId}/uploads`, {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(400);
  });

  test('reject disallowed file extension', async () => {
    const formData = new FormData();
    formData.append('category', 'skills');
    formData.append('files', new Blob(['MZ...'], { type: 'application/octet-stream' }), 'evil.exe');

    const res = await fetch(`${BASE_URL}/api/orchestrator/runs/${runId}/uploads`, {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(400);
  });

  test('get workspace info for run', async () => {
    const { status, data } = await api('GET', `/api/orchestrator/runs/${runId}/workspace`);
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.runId).toBe(runId);
    expect(d.workspaceDir).toBeTruthy();
    expect(d.artifactsDir).toBeTruthy();
    expect(d.uploadsDir).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Chat System
// ═══════════════════════════════════════════════════════════════

test.describe('Chat System', () => {
  let chatId: string;

  test('create a new chat', async () => {
    const { status, data } = await api('POST', '/api/chats', {
      name: 'E2E Test Chat',
      description: 'Testing chat creation',
    });
    expect(status).toBe(201);
    const d = data as Record<string, unknown>;
    expect(d.id).toBeTruthy();
    chatId = d.id as string;
  });

  test('get chat details', async () => {
    const { status, data } = await api('GET', `/api/chats/${chatId}`);
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.id).toBe(chatId);
    expect(d.name).toBe('E2E Test Chat');
  });

  test('list chats includes new chat', async () => {
    const { status, data } = await api('GET', '/api/chats');
    expect(status).toBe(200);
    const chats = data as Array<{ id: string }>;
    expect(chats.some((c) => c.id === chatId)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Copilot SDK Endpoints
// ═══════════════════════════════════════════════════════════════

test.describe('Copilot SDK Endpoints', () => {
  test('copilot models endpoint responds', async () => {
    const { status } = await api('GET', '/api/copilot/models');
    // 200 if copilot connected, 503 if not — both are valid responses
    expect([200, 503].includes(status)).toBe(true);
  });

  test('copilot state endpoint responds', async () => {
    const { status } = await api('GET', '/api/copilot/state');
    expect([200, 503].includes(status)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. Artifact Endpoints
// ═══════════════════════════════════════════════════════════════

test.describe('Artifact Endpoints', () => {
  test('artifacts endpoint returns list for a session id', async () => {
    const { status, data } = await api('GET', '/api/sessions/nonexistent-id/artifacts');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. Error Handling
// ═══════════════════════════════════════════════════════════════

test.describe('Error Handling', () => {
  test('unknown API route returns 404', async () => {
    const { status, data } = await api('GET', '/api/nonexistent-endpoint');
    expect(status).toBe(404);
    const d = data as { error: { code: string } };
    expect(d.error.code).toBe('NOT_FOUND');
  });

  test('invalid workflow definition ID returns error', async () => {
    const { status } = await api('GET', '/api/workflow-definitions/00000000-0000-0000-0000-000000000000');
    // Should be 404 or similar error
    expect([404, 500].includes(status)).toBe(true);
  });

  test('create definition with missing name returns 400', async () => {
    const { status } = await api('POST', '/api/workflow-definitions', {
      description: 'Missing the required name field',
    });
    expect(status).toBe(400);
  });
});
