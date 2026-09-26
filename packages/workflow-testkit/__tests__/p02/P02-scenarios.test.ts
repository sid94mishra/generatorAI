// ────────────────────────────────────────────────────────────────
// P02 whole-run scenarios (P02 review R9), on the fake model:
//   P02-perm       — the run's permission mode reaches Claude and Codex
//                    stages turn by turn, with a permission gate installed;
//   P02-mcp-secret — a stage's `secretref:` MCP header reaches the provider
//                    as the stored value, never as the pointer.
// The widgets, skills and question scenarios are covered by unit tests
// (DEVIATIONS).
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

describe('P02 whole-run scenarios', () => {
  it('P02-perm: the run permission mode reaches claude-agent and codex stages', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow(
      {
        name: 'p02-perm',
        stages: [
          { name: 'Claude', prompt: 'Edit a file.', session: { harnessType: 'claude-agent' } },
          { name: 'Codex', prompt: 'Run a command.', session: { harnessType: 'codex' } },
        ],
        edges: [['Claude', 'Codex']],
      },
      {},
      { permissionMode: 'default' },
    );
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    for (const stageName of ['Claude', 'Codex']) {
      const prompts = snap.calls.filter((c) => c.stageName === stageName && c.kind === 'prompt');
      expect(prompts.length).toBeGreaterThan(0);
      expect(prompts.every((c) => c.options?.permissionMode === 'default')).toBe(true);
      const params = engine.harness.conversationParams.get(prompts[0]!.conversationId)!;
      expect(params.harnessType).toBe(stageName === 'Claude' ? 'claude-agent' : 'codex');
      expect(typeof params.onPermissionRequest).toBe('function');
    }
  });

  it('P02-mcp-secret: a secretref MCP header reaches the provider as the stored value', async () => {
    engine = await createTestEngine({ secrets: { 'mcp/custom/tracker/header:Authorization': 'tk-real-value' } });
    const run = await engine.runWorkflow(
      {
        name: 'p02-mcp-secret',
        stages: [
          {
            name: 'Uses_mcp',
            prompt: 'Call the tracker.',
            session: {
              mcp: { servers: { tracker: { type: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'secretref:mcp/custom/tracker/header:Authorization' } } } },
            },
          },
        ],
      },
      {},
      { permissionMode: 'acceptEdits' },
    );
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    const call = snap.calls.find((c) => c.stageName === 'Uses_mcp')!;
    const params = engine.harness.conversationParams.get(call.conversationId)! as unknown as {
      mcpServers?: Record<string, { headers?: Record<string, string> }>;
    };
    expect(params.mcpServers?.['tracker']?.headers).toEqual({ Authorization: 'tk-real-value' });
    expect(JSON.stringify(params.mcpServers)).not.toContain('secretref:');
  });
});
