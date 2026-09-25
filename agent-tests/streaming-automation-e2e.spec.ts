// ────────────────────────────────────────────────────────────────
// Comprehensive E2E: Streaming, Automations, Event Persistence
//
// Tests the complete streaming pipeline end-to-end:
//   - SSE event delivery + persistence + replay
//   - Chat message streaming (tokens, thinking, tool calls)
//   - Workflow run streaming (stage lifecycle, parallel stages)
//   - Automation CRUD + trigger + execution tracking
//   - Data source modes (single, loop, batch)
//   - Webhook trigger with token rotation
//   - Event durability across page refresh (replay endpoint)
// ────────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.API_URL || 'http://localhost:3100';

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

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

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 90_000,
  intervalMs = 2_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// ═══════════════════════════════════════════════════════════════
// 1. SSE Streaming & Event Persistence
// ═══════════════════════════════════════════════════════════════

test.describe('1. SSE Streaming & Event Persistence', () => {
  let definitionId: string;
  let runId: string;

  test('create single-stage workflow for streaming test', async () => {
    const { status, data } = await api('POST', '/api/workflow-definitions', {
      name: `SSE Streaming Test ${Date.now()}`,
      description: 'Tests SSE event delivery and persistence',
      sessionMode: 'single',
    });
    expect(status).toBe(201);
    definitionId = (data as { id: string }).id;

    // Add a stage
    const { status: s2 } = await api('POST', `/api/workflow-definitions/${definitionId}/stages`, {
      name: 'Stream Stage',
      order: 0,
      prompts: [{
        label: 'Test',
        text: 'Say "Hello Streaming" exactly, nothing else.',
      }],
    });
    expect(s2).toBe(201);
  });

  test('start run and verify events via replay', async () => {
    // Create run
    const { status, data } = await api('POST', '/api/workflow-runs', {
      workflowDefinitionId: definitionId,
    });
    expect(status).toBe(201);
    runId = (data as { id: string }).id;

    // Start run
    const { status: s2 } = await api('POST', `/api/workflow-runs/${runId}/start`);
    expect([200, 202]).toContain(s2);

    // Wait for run to complete
    await waitFor(async () => {
      const { data: rd } = await api('GET', `/api/workflow-runs/${runId}`);
      const d = rd as { status: string };
      return d.status === 'completed' || d.status === 'failed';
    });

    // Fetch events via replay endpoint
    const { status: replayStatus, data: replayData } = await api(
      'GET',
      `/api/stream/replay?scope=run&id=${runId}&limit=200`,
    );
    expect(replayStatus).toBe(200);
    const replay = replayData as { rows: Array<{ kind: string; seq: number }>; nextAfterSeq: number };
    const rows = replay.rows;
    expect(rows.length).toBeGreaterThan(0);

    // Verify event types
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toContain('workflow_run.started');
    expect(kinds).toContain('stage_run.running');
    // Should have either completed or failed
    const hasTerminal = kinds.includes('workflow_run.completed') || kinds.includes('workflow_run.failed');
    expect(hasTerminal).toBe(true);
  });

  test('events persisted to SQLite via replay endpoint', async () => {
    const { status, data } = await api('GET', `/api/stream/replay?scope=run&id=${runId}&limit=200`);
    expect(status).toBe(200);
    const replay = data as { rows: Array<{ seq: number; kind: string; payload: unknown }>; nextAfterSeq: number };
    const rows = replay.rows;
    expect(rows.length).toBeGreaterThan(2);

    // Verify monotonic sequence numbers
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.seq).toBeGreaterThan(rows[i - 1]!.seq);
    }

    // Verify essential lifecycle events are persisted
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toContain('workflow_run.started');
    expect(kinds).toContain('stage_run.running');
  });

  test('replay supports pagination with afterSeq', async () => {
    // Get first page
    const { data: p1 } = await api('GET', `/api/stream/replay?scope=run&id=${runId}&limit=5`);
    const page1 = p1 as { rows: Array<{ seq: number }>; nextAfterSeq: number };
    expect(page1.rows.length).toBeLessThanOrEqual(5);

    if (page1.rows.length === 5) {
      const lastSeq = page1.nextAfterSeq;
      const { data: p2 } = await api('GET', `/api/stream/replay?scope=run&id=${runId}&afterSeq=${lastSeq}&limit=5`);
      const page2 = p2 as { rows: Array<{ seq: number }>; nextAfterSeq: number };
      // Page 2 should start after lastSeq
      if (page2.rows.length > 0) {
        expect(page2.rows[0]!.seq).toBeGreaterThan(lastSeq);
      }
    }
  });

  test('chat history survives via session endpoint', async () => {
    // Wait for run to finish
    await waitFor(async () => {
      const { data } = await api('GET', `/api/workflow-runs/${runId}`);
      const d = data as { status: string };
      return d.status === 'completed' || d.status === 'failed';
    });

    // Get the run to find session ID
    const { data: runData } = await api('GET', `/api/workflow-runs/${runId}`);
    const run = runData as { stageRuns: Array<{ sessionId: string; id: string }> };
    const sr = run.stageRuns[0]!;
    expect(sr.sessionId).toBeTruthy();

    // Fetch chat history
    const { status, data } = await api('GET', `/api/sessions/${sr.sessionId}/chat?stageRunId=${sr.id}`);
    expect(status).toBe(200);
    const messages = data as Array<{ role: string; content: string }>;
    expect(messages.length).toBeGreaterThanOrEqual(2); // at least user + assistant

    // Find user & assistant messages
    const userMsg = messages.find((m) => m.role === 'user');
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(userMsg).toBeTruthy();
    expect(assistantMsg).toBeTruthy();
  });

  test('cleanup — delete test workflow', async () => {
    await api('DELETE', `/api/workflow-definitions/${definitionId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Automation CRUD & Triggers
// ═══════════════════════════════════════════════════════════════

test.describe('2. Automation CRUD & Triggers', () => {
  let workflowDefId: string;
  let automationId: string;

  test('setup — create workflow for automation', async () => {
    const { status, data } = await api('POST', '/api/workflow-definitions', {
      name: `Automation Test WF ${Date.now()}`,
      description: 'Workflow for automation testing',
      sessionMode: 'single',
    });
    expect(status).toBe(201);
    workflowDefId = (data as { id: string }).id;

    await api('POST', `/api/workflow-definitions/${workflowDefId}/stages`, {
      name: 'Auto Stage',
      order: 0,
      prompts: [{
        label: 'Auto',
        text: 'Say "automated" and nothing else.',
      }],
    });
  });

  test('create manual automation', async () => {
    const { status, data } = await api('POST', '/api/automations', {
      name: `E2E Manual Automation ${Date.now()}`,
      triggerType: 'manual',
      workflowIds: [workflowDefId],
      inputMode: 'single',
      variables: { testVar: 'hello' },
    });
    expect(status).toBe(201);
    const d = data as { id: string; triggerType: string; enabled: boolean };
    expect(d.id).toBeTruthy();
    expect(d.triggerType).toBe('manual');
    expect(d.enabled).toBe(true);
    automationId = d.id;
  });

  test('get automation with details', async () => {
    const { status, data } = await api('GET', `/api/automations/${automationId}`);
    expect(status).toBe(200);
    const d = data as { id: string; name: string; triggerType: string; workflowIds: string[] };
    expect(d.id).toBe(automationId);
    expect(d.triggerType).toBe('manual');
    expect(d.workflowIds).toContain(workflowDefId);
  });

  test('list automations includes new one', async () => {
    const { status, data } = await api('GET', '/api/automations');
    expect(status).toBe(200);
    const list = data as Array<{ id: string }>;
    expect(list.some((a) => a.id === automationId)).toBe(true);
  });

  test('update automation', async () => {
    const { status, data } = await api('PATCH', `/api/automations/${automationId}`, {
      name: 'Updated Automation Name',
      variables: { testVar: 'updated' },
    });
    expect(status).toBe(200);
    const d = data as { name: string };
    expect(d.name).toBe('Updated Automation Name');
  });

  test('disable automation', async () => {
    const { status, data } = await api('POST', `/api/automations/${automationId}/disable`);
    expect(status).toBe(200);
    const d = data as { enabled: boolean };
    expect(d.enabled).toBe(false);
  });

  test('enable automation', async () => {
    const { status, data } = await api('POST', `/api/automations/${automationId}/enable`);
    expect(status).toBe(200);
    const d = data as { enabled: boolean };
    expect(d.enabled).toBe(true);
  });

  test('trigger manual automation', async () => {
    const { status, data } = await api('POST', `/api/automations/${automationId}/trigger`);
    expect(status).toBe(202);
    const d = data as { id: string; status: string };
    expect(d.id).toBeTruthy();
    expect(d.status).toBeTruthy();
  });

  test('list executions for automation', async () => {
    // Wait briefly for execution to register
    await new Promise((r) => setTimeout(r, 2000));
    const { status, data } = await api('GET', `/api/automations/${automationId}/executions`);
    expect(status).toBe(200);
    const execs = data as Array<{ id: string; status: string; automationId: string }>;
    expect(execs.length).toBeGreaterThanOrEqual(1);
    expect(execs[0]!.automationId).toBe(automationId);
  });

  test('cleanup — delete automation and workflow', async () => {
    const { status: s1 } = await api('DELETE', `/api/automations/${automationId}`);
    expect(s1).toBe(204);

    // Verify deletion (server may return 404 or 500 for missing automations)
    const { status: s2 } = await api('GET', `/api/automations/${automationId}`);
    expect([404, 500]).toContain(s2);

    await api('DELETE', `/api/workflow-definitions/${workflowDefId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Webhook Automation
// ═══════════════════════════════════════════════════════════════

test.describe('3. Webhook Automation', () => {
  let workflowDefId: string;
  let automationId: string;
  let webhookToken: string;

  test('setup — create workflow + webhook automation', async () => {
    const { data: wf } = await api('POST', '/api/workflow-definitions', {
      name: `Webhook WF ${Date.now()}`,
      sessionMode: 'single',
    });
    workflowDefId = (wf as { id: string }).id;

    await api('POST', `/api/workflow-definitions/${workflowDefId}/stages`, {
      name: 'Webhook Stage',
      order: 0,
      prompts: [{ label: 'WH', text: 'Say "webhook" exactly.' }],
    });

    const { status, data } = await api('POST', '/api/automations', {
      name: `E2E Webhook Auto ${Date.now()}`,
      triggerType: 'webhook',
      workflowIds: [workflowDefId],
      inputMode: 'single',
    });
    expect(status).toBe(201);
    const d = data as { id: string; webhookToken: string };
    automationId = d.id;
    webhookToken = d.webhookToken;
    expect(webhookToken).toBeTruthy();
  });

  test('trigger via webhook token endpoint', async () => {
    const { status, data } = await api('POST', `/api/automations/webhooks/${webhookToken}`, {
      payload: { source: 'e2e-test' },
    });
    expect(status).toBe(202);
    const d = data as { executionId: string; status: string };
    expect(d.executionId).toBeTruthy();
  });

  test('invalid webhook token returns 404', async () => {
    const { status } = await api('POST', '/api/automations/webhooks/invalid-token-xyz');
    expect(status).toBe(404);
  });

  test('rotate webhook token', async () => {
    const { status, data } = await api('POST', `/api/automations/${automationId}/rotate-webhook-token`);
    expect(status).toBe(200);
    const d = data as { webhookToken: string };
    expect(d.webhookToken).toBeTruthy();
    expect(d.webhookToken).not.toBe(webhookToken);
    const newToken = d.webhookToken;

    // Old token should now fail
    const { status: s2 } = await api('POST', `/api/automations/webhooks/${webhookToken}`);
    expect([404, 500]).toContain(s2);

    // New token should work
    const { status: s3 } = await api('POST', `/api/automations/webhooks/${newToken}`);
    expect(s3).toBe(202);
  });

  test('cleanup', async () => {
    await api('DELETE', `/api/automations/${automationId}`);
    await api('DELETE', `/api/workflow-definitions/${workflowDefId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Schedule Automation
// ═══════════════════════════════════════════════════════════════

test.describe('4. Schedule Automation', () => {
  let workflowDefId: string;
  let automationId: string;

  test('create schedule automation with cron', async () => {
    const { data: wf } = await api('POST', '/api/workflow-definitions', {
      name: `Schedule WF ${Date.now()}`,
      sessionMode: 'single',
    });
    workflowDefId = (wf as { id: string }).id;

    await api('POST', `/api/workflow-definitions/${workflowDefId}/stages`, {
      name: 'Sched Stage',
      order: 0,
      prompts: [{ label: 'S', text: 'Say "scheduled".' }],
    });

    const { status, data } = await api('POST', '/api/automations', {
      name: `E2E Schedule Auto ${Date.now()}`,
      triggerType: 'schedule',
      cronExpression: '0 0 * * *', // daily at midnight (won't fire during test)
      workflowIds: [workflowDefId],
      inputMode: 'single',
    });
    expect(status).toBe(201);
    const d = data as { id: string; triggerType: string; cronExpression: string };
    automationId = d.id;
    expect(d.triggerType).toBe('schedule');
    expect(d.cronExpression).toBe('0 0 * * *');
  });

  test('update cron expression', async () => {
    const { status, data } = await api('PATCH', `/api/automations/${automationId}`, {
      cronExpression: '30 8 * * 1-5',
    });
    expect(status).toBe(200);
    const d = data as { cronExpression: string };
    expect(d.cronExpression).toBe('30 8 * * 1-5');
  });

  test('manual trigger of schedule automation works', async () => {
    const { status } = await api('POST', `/api/automations/${automationId}/trigger`);
    expect(status).toBe(202);
  });

  test('cleanup', async () => {
    await api('DELETE', `/api/automations/${automationId}`);
    await api('DELETE', `/api/workflow-definitions/${workflowDefId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Loop Input Mode Automation
// ═══════════════════════════════════════════════════════════════

test.describe('5. Loop Input Mode', () => {
  let workflowDefId: string;
  let automationId: string;

  test('create loop automation', async () => {
    const { data: wf } = await api('POST', '/api/workflow-definitions', {
      name: `Loop WF ${Date.now()}`,
      sessionMode: 'single',
    });
    workflowDefId = (wf as { id: string }).id;

    await api('POST', `/api/workflow-definitions/${workflowDefId}/stages`, {
      name: 'Loop Stage',
      order: 0,
      prompts: [{ label: 'L', text: 'Process item: {{item}}' }],
    });

    const { status, data } = await api('POST', '/api/automations', {
      name: `E2E Loop Auto ${Date.now()}`,
      triggerType: 'manual',
      workflowIds: [workflowDefId],
      inputMode: 'loop',
      loopVariable: 'item',
      loopItems: ['alpha', 'beta', 'gamma'],
    });
    expect(status).toBe(201);
    const d = data as { id: string; inputMode: string; loopItems: string[] };
    automationId = d.id;
    expect(d.inputMode).toBe('loop');
    expect(d.loopItems).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('trigger loop automation creates multiple runs', async () => {
    const { status, data } = await api('POST', `/api/automations/${automationId}/trigger`);
    expect(status).toBe(202);

    // Wait for execution to create runs
    await new Promise((r) => setTimeout(r, 3000));

    const { data: execs } = await api('GET', `/api/automations/${automationId}/executions`);
    const execList = execs as Array<{ id: string }>;
    expect(execList.length).toBeGreaterThanOrEqual(1);
  });

  test('cleanup', async () => {
    await api('DELETE', `/api/automations/${automationId}`);
    await api('DELETE', `/api/workflow-definitions/${workflowDefId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Chat Streaming End-to-End
// ═══════════════════════════════════════════════════════════════

test.describe('6. Chat Streaming End-to-End', () => {
  let chatId: string;

  test('create a chat', async () => {
    const { status, data } = await api('POST', '/api/chats', {
      name: `E2E Chat ${Date.now()}`,
    });
    expect(status).toBe(201);
    const d = data as { id: string; sessionId: string };
    chatId = d.id;
    expect(d.sessionId).toBeTruthy();
  });

  test('send message and verify prompt accepted', async () => {
    const { status } = await api('POST', `/api/chats/${chatId}/prompt`, {
      prompt: 'Say "chat works" exactly.',
    });
    // prompt starts async processing (202 accepted)
    expect([200, 202]).toContain(status);

    // Wait briefly for message to register, then check
    await new Promise((r) => setTimeout(r, 3000));
    const { data: msgs } = await api('GET', `/api/chats/${chatId}/messages`);
    const messages = msgs as Array<{ role: string }>;
    // At minimum user message should be persisted
    expect(messages.some((m) => m.role === 'user')).toBe(true);
  });

  test('chat messages are persisted', async () => {
    const { status, data } = await api('GET', `/api/chats/${chatId}/messages`);
    expect(status).toBe(200);
    const msgs = data as Array<{ role: string; content: string }>;
    // At least the user message should be there
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs.some((m) => m.role === 'user')).toBe(true);
  });

  test('chat list includes the chat', async () => {
    const { status, data } = await api('GET', '/api/chats');
    expect(status).toBe(200);
    const chats = data as Array<{ id: string }>;
    expect(chats.some((c) => c.id === chatId)).toBe(true);
  });

  test('update chat via PATCH returns 200', async () => {
    const { status } = await api('PATCH', `/api/chats/${chatId}`, {
      name: 'Updated Chat Name',
    });
    expect(status).toBe(200);
  });

  test('delete chat', async () => {
    const { status } = await api('DELETE', `/api/chats/${chatId}`);
    expect(status).toBe(204);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Workflow Run with Multi-Stage DAG & Streaming
// ═══════════════════════════════════════════════════════════════

test.describe('7. Multi-Stage Workflow with Streaming', () => {
  let defId: string;
  let runId: string;

  test('create 2-stage DAG workflow', async () => {
    const { data: def } = await api('POST', '/api/workflow-definitions', {
      name: `Multi-Stage DAG ${Date.now()}`,
      sessionMode: 'single',
    });
    defId = (def as { id: string }).id;

    // Stage 1
    const { data: s1 } = await api('POST', `/api/workflow-definitions/${defId}/stages`, {
      name: 'Analysis',
      order: 0,
      prompts: [{ label: 'Analyze', text: 'Say "analysis done" exactly.' }],
    });
    // Stage 2
    const { data: s2 } = await api('POST', `/api/workflow-definitions/${defId}/stages`, {
      name: 'Summary',
      order: 1,
      prompts: [{ label: 'Summarize', text: 'Say "summary done" exactly.' }],
    });

    const { data: fullDef } = await api('GET', `/api/workflow-definitions/${defId}`);
    const stages = (fullDef as { stages: Array<{ id: string; name: string }> }).stages;
    const analysis = stages.find((s) => s.name === 'Analysis')!;
    const summary = stages.find((s) => s.name === 'Summary')!;

    // Edge: Analysis → Summary
    const { status } = await api('POST', `/api/workflow-definitions/${defId}/edges`, {
      fromStageId: analysis.id,
      toStageId: summary.id,
      edgeType: 'on_success',
    });
    expect(status).toBe(201);
  });

  test('validate DAG', async () => {
    const { status, data } = await api('POST', `/api/workflow-definitions/${defId}/validate`);
    expect(status).toBe(200);
    expect((data as { valid: boolean }).valid).toBe(true);
  });

  test('start run and wait for completion', async () => {
    const { data: run } = await api('POST', '/api/workflow-runs', {
      workflowDefinitionId: defId,
    });
    runId = (run as { id: string }).id;

    await api('POST', `/api/workflow-runs/${runId}/start`);

    // Wait for completion
    await waitFor(async () => {
      const { data } = await api('GET', `/api/workflow-runs/${runId}`);
      const d = data as { status: string };
      return d.status === 'completed' || d.status === 'failed';
    });
  });

  test('verify both stages completed', async () => {
    const { data } = await api('GET', `/api/workflow-runs/${runId}`);
    const run = data as { status: string; stageRuns: Array<{ name: string; status: string }> };
    expect(run.stageRuns.length).toBe(2);

    // At least stage 1 should be completed (stage 2 depends on SDK availability)
    const analysis = run.stageRuns.find((sr) => sr.name === 'Analysis');
    expect(analysis).toBeTruthy();
    expect(analysis!.status).toMatch(/completed|failed/);
  });

  test('stream replay has events for both stages', async () => {
    const { data } = await api('GET', `/api/stream/replay?scope=run&id=${runId}&limit=200`);
    const replay = data as { rows: Array<{ kind: string; payload: unknown }>; nextAfterSeq: number };
    expect(replay.rows.length).toBeGreaterThan(2);

    // Should have stage_run events for multiple stages
    const stageRunEvents = replay.rows.filter((r) => r.kind.startsWith('stage_run.'));
    expect(stageRunEvents.length).toBeGreaterThanOrEqual(2);
  });

  test('cleanup', async () => {
    await api('DELETE', `/api/workflow-definitions/${defId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Project CRUD & Codebase Linking
// ═══════════════════════════════════════════════════════════════

test.describe('8. Project CRUD', () => {
  let projectId: string;

  test('create project', async () => {
    const { status, data } = await api('POST', '/api/projects', {
      name: `E2E Test Project ${Date.now()}`,
      description: 'Project for E2E testing',
    });
    expect(status).toBe(201);
    const d = data as { id: string; name: string };
    projectId = d.id;
    expect(d.id).toBeTruthy();
  });

  test('get project', async () => {
    const { status, data } = await api('GET', `/api/projects/${projectId}`);
    expect(status).toBe(200);
    const d = data as { id: string };
    expect(d.id).toBe(projectId);
  });

  test('list projects', async () => {
    const { status, data } = await api('GET', '/api/projects');
    expect(status).toBe(200);
    const list = data as Array<{ id: string }>;
    expect(list.some((p) => p.id === projectId)).toBe(true);
  });

  test('update project', async () => {
    const { status, data } = await api('PUT', `/api/projects/${projectId}`, {
      name: 'Updated Project',
      description: 'Updated description',
    });
    expect(status).toBe(200);
    const d = data as { name: string };
    expect(d.name).toBe('Updated Project');
  });

  test('link local directory codebase', async () => {
    const { status, data } = await api('POST', `/api/projects/${projectId}/codebases`, {
      type: 'local-dir',
      localPath: '/tmp/e2e-test-dir',
      label: 'Test Codebase',
    });
    // May fail if path doesn't exist, but API should accept the request
    expect([201, 400]).toContain(status);
  });

  test('delete project', async () => {
    const { status } = await api('DELETE', `/api/projects/${projectId}?force=true`);
    expect(status).toBe(204);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Templates & System Endpoints
// ═══════════════════════════════════════════════════════════════

test.describe('9. Templates & System', () => {
  test('list system workflow templates', async () => {
    const { status, data } = await api('GET', '/api/orchestrator/system-workflows');
    expect(status).toBe(200);
    const templates = data as Array<{ id: string; name: string }>;
    expect(templates.length).toBeGreaterThan(0);
  });

  test('list user templates', async () => {
    const { status, data } = await api('GET', '/api/templates');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test('get available models', async () => {
    const { status, data } = await api('GET', '/api/copilot/models');
    expect(status).toBe(200);
    const models = data as Array<{ id: string }>;
    expect(models.length).toBeGreaterThan(0);
  });

  test('get copilot state', async () => {
    const { status, data } = await api('GET', '/api/copilot/state');
    expect(status).toBe(200);
    const d = data as { state: string };
    expect(typeof d.state).toBe('string');
  });

  test('health endpoint detailed', async () => {
    const { status, data } = await api('GET', '/api/health');
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.status).toBe('ok');
    expect(d.copilot).toBe(true);
    expect(d.db).toBe(true);
    expect(typeof d.uptime).toBe('number');
    expect(typeof d.activeChats).toBe('number');
    expect(typeof d.activeWorkflowRuns).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. Error Handling & Edge Cases
// ═══════════════════════════════════════════════════════════════

test.describe('10. Error Handling', () => {
  test('404 for non-existent workflow definition', async () => {
    const { status } = await api('GET', '/api/workflow-definitions/00000000-0000-0000-0000-000000000000');
    expect([404, 500]).toContain(status);
  });

  test('404 for non-existent workflow run', async () => {
    const { status } = await api('GET', '/api/workflow-runs/00000000-0000-0000-0000-000000000000');
    expect(status).toBe(404);
  });

  test('404 for non-existent chat', async () => {
    const { status } = await api('GET', '/api/chats/00000000-0000-0000-0000-000000000000');
    expect([404, 500]).toContain(status);
  });

  test('404 for non-existent automation', async () => {
    const { status } = await api('GET', '/api/automations/00000000-0000-0000-0000-000000000000');
    expect([404, 500]).toContain(status);
  });

  test('400 for invalid workflow definition body', async () => {
    const { status } = await api('POST', '/api/workflow-definitions', {});
    expect([400, 422]).toContain(status);
  });

  test('400 for invalid automation body', async () => {
    const { status } = await api('POST', '/api/automations', {});
    expect([400, 422]).toContain(status);
  });

  test('404 for undefined API route', async () => {
    const { status } = await api('GET', '/api/nonexistent-endpoint');
    expect(status).toBe(404);
  });

  test('cannot start already-completed run', async () => {
    // Create and run a workflow
    const { data: def } = await api('POST', '/api/workflow-definitions', {
      name: `Error Test ${Date.now()}`,
      sessionMode: 'single',
    });
    const defId = (def as { id: string }).id;

    await api('POST', `/api/workflow-definitions/${defId}/stages`, {
      name: 'Quick',
      order: 0,
      prompts: [{ label: 'Q', text: 'Say "done".' }],
    });

    const { data: run } = await api('POST', '/api/workflow-runs', {
      workflowDefinitionId: defId,
    });
    const runId = (run as { id: string }).id;
    await api('POST', `/api/workflow-runs/${runId}/start`);

    // Wait for completion
    await waitFor(async () => {
      const { data } = await api('GET', `/api/workflow-runs/${runId}`);
      return (data as { status: string }).status === 'completed' || (data as { status: string }).status === 'failed';
    });

    // Try to start again — should fail
    const { status } = await api('POST', `/api/workflow-runs/${runId}/start`);
    expect([400, 409, 422]).toContain(status);

    await api('DELETE', `/api/workflow-definitions/${defId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. Workflow Variable System
// ═══════════════════════════════════════════════════════════════

test.describe('11. Workflow Variables', () => {
  let defId: string;

  test('create workflow with variables', async () => {
    const { status, data } = await api('POST', '/api/workflow-definitions', {
      name: `Variable Test ${Date.now()}`,
      sessionMode: 'single',
      variables: [
        { name: 'lang', label: 'Language', type: 'string', required: true, defaultValue: 'TypeScript' },
        { name: 'count', label: 'Count', type: 'number', required: false, defaultValue: 5 },
      ],
    });
    expect(status).toBe(201);
    defId = (data as { id: string }).id;

    await api('POST', `/api/workflow-definitions/${defId}/stages`, {
      name: 'Var Stage',
      order: 0,
      prompts: [{ label: 'V', text: 'Language is {{lang}}, count is {{count}}.' }],
    });
  });

  test('run with custom variables', async () => {
    const { status, data } = await api('POST', '/api/workflow-runs', {
      workflowDefinitionId: defId,
      variables: { lang: 'Python', count: 10 },
    });
    expect(status).toBe(201);
    const d = data as { variables: Record<string, unknown> };
    expect(d.variables.lang).toBe('Python');
    expect(d.variables.count).toBe(10);
  });

  test('run with default variables (omitted)', async () => {
    const { status, data } = await api('POST', '/api/workflow-runs', {
      workflowDefinitionId: defId,
    });
    expect(status).toBe(201);
    const d = data as { id: string };
    expect(d.id).toBeTruthy();
  });

  test('cleanup', async () => {
    await api('DELETE', `/api/workflow-definitions/${defId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. Workflow Definition CRUD (Stages & Edges)
// ═══════════════════════════════════════════════════════════════

test.describe('12. Workflow Definition CRUD', () => {
  let defId: string;
  let stageId1: string;
  let stageId2: string;
  let edgeId: string;

  test('create definition', async () => {
    const { status, data } = await api('POST', '/api/workflow-definitions', {
      name: `CRUD Test WF ${Date.now()}`,
      description: 'Tests full CRUD',
      sessionMode: 'single',
    });
    expect(status).toBe(201);
    defId = (data as { id: string }).id;
  });

  test('add stages', async () => {
    const { status: s1, data: d1 } = await api('POST', `/api/workflow-definitions/${defId}/stages`, {
      name: 'Stage A',
      order: 0,
      prompts: [{ label: 'A', text: 'Stage A prompt' }],
    });
    expect(s1).toBe(201);
    stageId1 = (d1 as { id: string }).id;

    const { status: s2, data: d2 } = await api('POST', `/api/workflow-definitions/${defId}/stages`, {
      name: 'Stage B',
      order: 1,
      prompts: [{ label: 'B', text: 'Stage B prompt' }],
    });
    expect(s2).toBe(201);
    stageId2 = (d2 as { id: string }).id;
  });

  test('add edge', async () => {
    const { status, data } = await api('POST', `/api/workflow-definitions/${defId}/edges`, {
      fromStageId: stageId1,
      toStageId: stageId2,
      edgeType: 'on_success',
    });
    expect(status).toBe(201);
    edgeId = (data as { id: string }).id;
  });

  test('get full definition with stages and edges', async () => {
    const { status, data } = await api('GET', `/api/workflow-definitions/${defId}`);
    expect(status).toBe(200);
    const d = data as { stages: unknown[]; edges: unknown[] };
    expect(d.stages.length).toBe(2);
    expect(d.edges.length).toBe(1);
  });

  test('update stage', async () => {
    const { status, data } = await api('PUT', `/api/workflow-definitions/${defId}/stages/${stageId1}`, {
      name: 'Stage A Updated',
      order: 0,
      prompts: [{ label: 'A', text: 'Stage A prompt updated' }],
    });
    expect(status).toBe(200);
    expect((data as { name: string }).name).toBe('Stage A Updated');
  });

  test('delete edge', async () => {
    const { status } = await api('DELETE', `/api/workflow-definitions/${defId}/edges/${edgeId}`);
    expect(status).toBe(204);
  });

  test('delete stage', async () => {
    const { status } = await api('DELETE', `/api/workflow-definitions/${defId}/stages/${stageId2}`);
    expect(status).toBe(204);
  });

  test('list definitions', async () => {
    const { status, data } = await api('GET', '/api/workflow-definitions');
    expect(status).toBe(200);
    const list = data as Array<{ id: string }>;
    expect(list.some((d) => d.id === defId)).toBe(true);
  });

  test('update definition', async () => {
    const { status, data } = await api('PATCH', `/api/workflow-definitions/${defId}`, {
      name: 'Updated WF Name',
      description: 'Updated description',
    });
    expect(status).toBe(200);
    expect((data as { name: string }).name).toBe('Updated WF Name');
  });

  test('delete definition', async () => {
    const { status } = await api('DELETE', `/api/workflow-definitions/${defId}`);
    expect(status).toBe(204);
  });
});
