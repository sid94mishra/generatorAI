// ────────────────────────────────────────────────────────────────
// ArtifactCatalog — MCP registries end to end:
//   bundled catalog + prefs → placeholders/credentials gating
//   project rows + credential_refs → secretref pointers
//   catalog → hub → harness receives VALUES, GET wire shape never does
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySecretStore } from '@generatorai/secrets';
import { MCP_REDACTED_VALUE, mcpCredentialNamespace } from '@generatorai/shared';
import type { ProjectConfig } from '@generatorai/shared';
import { ArtifactCatalog } from '../../services/ArtifactCatalog.js';
import type { SystemArtifactService } from '../../services/SystemArtifactService.js';
import { McpSettingsStore } from '../McpSettingsStore.js';
import { McpCredentialVault } from '../McpCredentialVault.js';
import { InMemoryMcpHub } from '../IMcpHub.js';
import { toMcpServerEntry } from '../mcpWire.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} } as never;
const systemArtifacts = { listSystemArtifacts: async () => [] } as unknown as SystemArtifactService;

const BUNDLED = [
  {
    id: 'system-mcp-filesystem', name: 'Filesystem', serverType: 'stdio', command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '{{allowedDirectory}}'],
    inputs: [{ key: 'allowedDirectory', label: 'Allowed directory', kind: 'path' }],
  },
  {
    id: 'system-mcp-github', name: 'GitHub', serverType: 'stdio', command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    credentials: { env: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'Token' }] },
  },
  { id: 'system-mcp-puppeteer', name: 'Puppeteer', serverType: 'stdio', command: 'npx', args: ['-y', 'x'] },
];

describe('ArtifactCatalog — MCP', () => {
  let dir: string;
  let templates: string;
  let settings: McpSettingsStore;
  let projectConfigs: ProjectConfig[];

  const catalog = () =>
    new ArtifactCatalog(
      systemArtifacts,
      { getByProjectId: async (_p, type) => (type === 'mcp' ? projectConfigs : []) },
      templates,
      logger,
      { mcpSettings: settings },
    );

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'catalog-mcp-'));
    templates = join(dir, 'templates');
    mkdirSync(templates);
    writeFileSync(join(templates, 'mcp-servers.json'), JSON.stringify(BUNDLED), 'utf8');
    settings = new McpSettingsStore(join(dir, 'data'));
    projectConfigs = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('a bundled server with an unfilled {{input}} is NOT enabled and says which input is missing', async () => {
    const servers = await catalog().listMcpServers();
    const fs = servers.find((s) => s.id === 'system-mcp-filesystem')!;
    expect(fs.userEnabled).toBe(true);
    expect(fs.enabled).toBe(false);
    expect(fs.needsConfiguration).toEqual({ missingInputs: ['allowedDirectory'], missingCredentials: [] });
    // The example value must never leak into the config.
    expect(fs.config.args?.join(' ')).not.toContain('/tmp');
  });

  it('filling the input substitutes it and enables the server', async () => {
    settings.setSystemPrefs('system-mcp-filesystem', { inputs: { allowedDirectory: 'D:/work' } });
    const fs = (await catalog().listMcpServers()).find((s) => s.id === 'system-mcp-filesystem')!;
    expect(fs.enabled).toBe(true);
    expect(fs.needsConfiguration).toBeUndefined();
    expect(fs.config.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', 'D:/work']);
  });

  it('a bundled server that needs a credential is gated until one is stored, then carries a POINTER', async () => {
    let gh = (await catalog().listMcpServers()).find((s) => s.id === 'system-mcp-github')!;
    expect(gh.enabled).toBe(false);
    expect(gh.needsConfiguration?.missingCredentials).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN']);

    const vault = new McpCredentialVault(new MemorySecretStore());
    const refs = await vault.save(mcpCredentialNamespace('system', 'system-mcp-github'), {
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_live' },
    });
    settings.setSystemPrefs('system-mcp-github', { credentialRefs: refs });

    gh = (await catalog().listMcpServers()).find((s) => s.id === 'system-mcp-github')!;
    expect(gh.enabled).toBe(true);
    expect(gh.config.env?.['GITHUB_PERSONAL_ACCESS_TOKEN']).toMatch(/^secretref:mcp\/system\/system-mcp-github\//);
    expect(JSON.stringify(gh)).not.toContain('ghp_live');
  });

  it('the Settings off-switch disables a fully-configured server', async () => {
    settings.setSystemPrefs('system-mcp-puppeteer', { enabled: false });
    const p = (await catalog().listMcpServers()).find((s) => s.id === 'system-mcp-puppeteer')!;
    expect(p.userEnabled).toBe(false);
    expect(p.enabled).toBe(false);
  });

  it('custom servers from Settings appear with source=custom', async () => {
    settings.addCustom({ name: 'Internal', serverType: 'sse', url: 'https://mcp.internal/sse' });
    const c = (await catalog().listMcpServers()).find((s) => s.source === 'custom')!;
    expect(c.name).toBe('Internal');
    expect(c.config).toEqual({ type: 'sse', url: 'https://mcp.internal/sse' });
    expect(c.enabled).toBe(true);
  });

  it('project servers forward headers/env as pointers built from credential_refs (not from the file)', async () => {
    const file = join(dir, 'jira.json');
    writeFileSync(file, JSON.stringify({ serverType: 'http', url: 'https://jira/mcp', enabled: true }), 'utf8');
    projectConfigs = [{
      id: 'cfg-jira', projectId: 'p1', type: 'mcp', name: 'Jira', filePath: file, metadata: {},
      credentialRefs: { headers: ['Authorization'] }, createdAt: new Date(), updatedAt: new Date(),
    }];
    const j = (await catalog().listMcpServers('p1')).find((s) => s.id === 'cfg-jira')!;
    expect(j.source).toBe('project');
    expect(j.config.headers).toEqual({
      Authorization: 'secretref:mcp/project/cfg-jira/header:Authorization',
    });
  });

  it('END TO END: token stored → harness config receives the value → wire entry does not', async () => {
    const store = new MemorySecretStore();
    const vault = new McpCredentialVault(store);
    const file = join(dir, 'jira.json');
    writeFileSync(file, JSON.stringify({ serverType: 'http', url: 'https://jira/mcp' }), 'utf8');
    const refs = await vault.save(mcpCredentialNamespace('project', 'cfg-jira'), {
      headers: { Authorization: 'Bearer live-token' },
    });
    projectConfigs = [{
      id: 'cfg-jira', projectId: 'p1', type: 'mcp', name: 'Jira', filePath: file, metadata: {},
      credentialRefs: refs, createdAt: new Date(), updatedAt: new Date(),
    }];

    const servers = await catalog().listMcpServers('p1');
    const jira = servers.find((s) => s.id === 'cfg-jira')!;

    // What the harness gets (via the hub):
    const hub = new InMemoryMcpHub({ vault });
    const forHarness = await hub.resolveForRun({
      workflowDefinitionId: 'chat:c', workflowRunId: 'r', declared: { [jira.name]: jira.config },
    });
    expect(forHarness.servers['Jira']?.headers).toEqual({ Authorization: 'Bearer live-token' });

    // What a client gets (GET):
    const wire = toMcpServerEntry(jira);
    expect(wire.headers).toEqual({ Authorization: MCP_REDACTED_VALUE });
    expect(wire.hasCredentials).toBe(true);
    expect(JSON.stringify(wire)).not.toContain('live-token');
    expect(JSON.stringify(wire)).not.toContain('secretref:');
  });
});
