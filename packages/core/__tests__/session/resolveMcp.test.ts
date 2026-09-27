// W-18 — MCP for stages: one merge, then the hub (secretref + disable flags).

import { describe, expect, it } from 'vitest';
import { MemorySecretStore, setSecretString } from '@generatorai/secrets';
import { mcpSecretRef } from '@generatorai/shared';
import { InMemoryMcpHub } from '../../src/mcp/IMcpHub.js';
import { McpCredentialVault } from '../../src/mcp/McpCredentialVault.js';
import { resolveMcp } from '../../src/services/session/resolveMcp.js';
import type { SessionOwner } from '../../src/services/session/types.js';

const stage: SessionOwner = {
  kind: 'stage',
  stageRunId: 'sr-1',
  workflowRunId: 'run-1',
  workflowDefinitionId: 'def-1',
  sessionId: 'sess-1',
};

async function hubWithSecret() {
  const secrets = new MemorySecretStore();
  await setSecretString(secrets, 'mcp/custom/gh', 'header:Authorization', 'Bearer real-token');
  const seen: Array<{ workflowDefinitionId: string; workflowRunId: string }> = [];
  const hub = new InMemoryMcpHub({ vault: new McpCredentialVault(secrets) });
  const spy = {
    resolveForRun: async (input: Parameters<InMemoryMcpHub['resolveForRun']>[0]) => {
      seen.push({ workflowDefinitionId: input.workflowDefinitionId, workflowRunId: input.workflowRunId });
      return hub.resolveForRun(input);
    },
  };
  return { hub, spy, seen };
}

describe('resolveMcp (W-18)', () => {
  it('resolves secretref headers for a stage, keyed by its definition and run', async () => {
    const { spy, seen } = await hubWithSecret();
    const cfg: Record<string, unknown> = {};
    const warnings = await resolveMcp(
      cfg,
      {
        github: {
          type: 'http',
          url: 'https://mcp.example/gh',
          headers: { Authorization: mcpSecretRef('mcp/custom/gh', 'header:Authorization') },
        },
      },
      stage,
      'conv-1',
      spy,
    );
    expect(warnings).toEqual([]);
    expect((cfg['mcpServers'] as Record<string, { headers: Record<string, string> }>)['github']!.headers['Authorization']).toBe(
      'Bearer real-token',
    );
    expect(seen).toEqual([{ workflowDefinitionId: 'def-1', workflowRunId: 'run-1' }]);
  });

  it('drops hub-disabled servers and servers whose secret is missing, with a warning; no pointer survives', async () => {
    const { hub } = await hubWithSecret();
    hub.disable('off');
    const cfg: Record<string, unknown> = {
      // The agent projection's map, with a pointer the vault cannot resolve.
      mcpServers: {
        lost: { type: 'http', url: 'https://x', headers: { Authorization: mcpSecretRef('mcp/custom/none', 'header:A') } },
      },
    };
    const warnings = await resolveMcp(cfg, { off: { type: 'http', url: 'https://y' } }, stage, 'conv-1', hub);
    expect(warnings.map((w) => [w.code, w.params?.['server']])).toEqual([['mcp_dropped', 'lost']]);
    expect(cfg['mcpServers']).toBeUndefined();
  });

  it('an explicit server beats the agent default of the same name', async () => {
    const cfg: Record<string, unknown> = { mcpServers: { docs: { type: 'http', url: 'https://agent-default' } } };
    await resolveMcp(cfg, { docs: { type: 'http', url: 'https://explicit' } }, stage, 'conv-1', undefined);
    expect((cfg['mcpServers'] as Record<string, { url: string }>)['docs']!.url).toBe('https://explicit');
  });
});
