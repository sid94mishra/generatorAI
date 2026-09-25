// ────────────────────────────────────────────────────────────────
// AgentResolver — the union algebra is the whole point of the feature, so
// it gets the most direct coverage: 5 agent skills + 2 stage skills = 7.
// ────────────────────────────────────────────────────────────────

import { MCP_REDACTED_VALUE } from '@generatorai/shared';
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentResolver, redactProjection } from '../src/services/AgentResolver.js';
import type { ArtifactCatalog, CatalogMcpServer, CatalogSkill } from '../src/services/ArtifactCatalog.js';
import type { IAgentRepository } from '../src/domain/ports/IAgentRepository.js';
import type { Agent } from '@generatorai/shared';

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Parameters<typeof AgentResolver.prototype.constructor>[2];

function makeAgent(over: Partial<Agent> = {}): Agent {
  const now = new Date();
  return {
    id: 'a1',
    scope: 'global',
    projectId: '',
    slug: 'reviewer',
    ref: 'global:reviewer',
    name: 'Reviewer',
    description: 'Reviews code carefully',
    instructions: 'You review code.',
    role: 'agent',
    projection: 'append',
    tags: [],
    enabled: true,
    skillIds: [],
    mcpServerIds: [],
    tools: {},
    runtime: {},
    version: 3,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function makeCatalog(skills: CatalogSkill[], servers: CatalogMcpServer[] = []): ArtifactCatalog {
  return {
    listSkills: async () => skills,
    listMcpServers: async () => servers,
  } as unknown as ArtifactCatalog;
}

function makeRepo(agents: Agent[]): IAgentRepository {
  return {
    create: async (a) => a,
    getById: async (id) => agents.find((a) => a.id === id)!,
    getByRef: async (ref) => agents.find((a) => a.ref === ref) ?? null,
    list: async () => agents,
    update: async (_id, u) => ({ ...agents[0]!, ...u }) as Agent,
    delete: async () => {},
    countUsage: async () => ({ chats: [], stages: [], workflows: [] }),
  };
}

const skill = (id: string): CatalogSkill => ({
  id,
  name: id.replace('skill-', ''),
  filePath: `/skills/${id}.md`,
  source: 'system',
});

describe('AgentResolver — capability union', () => {
  let catalog: ArtifactCatalog;

  beforeEach(() => {
    catalog = makeCatalog(['skill-1', 'skill-2', 'skill-3', 'skill-4', 'skill-5', 'skill-6', 'skill-7'].map(skill));
  });

  it('unions the agent skills with the binding-site additions (5 + 2 = 7)', async () => {
    const agent = makeAgent({
      skillIds: ['skill-1', 'skill-2', 'skill-3', 'skill-4', 'skill-5'],
    });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      overrides: { addSkillIds: ['skill-6', 'skill-7'] },
      harnessType: 'copilot',
      scope: 'stage',
    });

    expect(p.skills.ids).toHaveLength(7);
    expect(p.skills.ids).toEqual(
      expect.arrayContaining(['skill-1', 'skill-5', 'skill-6', 'skill-7']),
    );
  });

  it('subtracts removals after the union, and removal wins over an add', async () => {
    const agent = makeAgent({ skillIds: ['skill-1', 'skill-2'] });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      overrides: { addSkillIds: ['skill-3'], removeSkillIds: ['skill-1', 'skill-3'] },
      harnessType: 'copilot',
      scope: 'chat',
    });

    expect(p.skills.ids.sort()).toEqual(['skill-2']);
  });

  it('does not duplicate a skill listed at two levels', async () => {
    const agent = makeAgent({ skillIds: ['skill-1'] });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      overrides: { addSkillIds: ['skill-1'] },
      harnessType: 'copilot',
      scope: 'chat',
    });

    expect(p.skills.ids).toEqual(['skill-1']);
  });

  it('warns rather than throwing when a referenced skill no longer exists', async () => {
    const agent = makeAgent({ skillIds: ['skill-gone'] });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      harnessType: 'copilot',
      scope: 'chat',
    });

    expect(p.skills.ids).toEqual([]);
    expect(p.warnings.map((w) => w.code)).toContain('SKILL_NOT_FOUND');
  });

  // Guards the stage wiring: `StageExecutionService` hands the stage's own
  // `harnessConfigOverrides` in as `runtimeOverrides`, which is the ONLY level
  // that carries `excludedMcpServerIds`. Before that, a stage-level MCP
  // exclusion silently did nothing.
  it('honours excludedMcpServerIds from the most specific harness config', async () => {
    const servers: CatalogMcpServer[] = ['mcp-a', 'mcp-b'].map((id) => ({
      id,
      name: id,
      config: { type: 'http', url: `https://example.test/${id}` },
      source: 'system' as const,
      enabled: true,
      userEnabled: true,
    }));
    const agent = makeAgent({ mcpServerIds: ['mcp-a', 'mcp-b'] });
    const resolver = new AgentResolver(makeRepo([agent]), makeCatalog([], servers), logger);

    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      runtimeOverrides: { excludedMcpServerIds: ['mcp-b'] },
      harnessType: 'copilot',
      scope: 'stage',
    });

    expect(Object.keys(p.mcpServers)).toEqual(['mcp-a']);
  });

  // W48 — `AgentResolver.empty()` (no MCP servers at all) is a synchronous
  // fallback for callers with no resolver wired; a caller that HAS a
  // resolver must call `resolve()` even with no `agentRef`, and the baseline
  // (every enabled system/custom + project server) must still come back.
  // This was the exact bug: a chat with no agent bound forwarded nothing.
  it('a chat with NO agent bound still receives the enabled project + system baseline', async () => {
    const servers: CatalogMcpServer[] = [
      { id: 'sys-1', name: 'system-server', config: { type: 'http', url: 'https://sys.test' }, source: 'system', enabled: true, userEnabled: true },
      { id: 'proj-1', name: 'project-server', config: { type: 'http', url: 'https://proj.test' }, source: 'project', enabled: true, userEnabled: true },
      // A DISABLED entry must never reach the map, agent-bound or not.
      { id: 'off-1', name: 'off-server', config: { type: 'http', url: 'https://off.test' }, source: 'system', enabled: false, userEnabled: false },
    ];
    const resolver = new AgentResolver(makeRepo([]), makeCatalog([], servers), logger);

    const p = await resolver.resolve({ projectId: 'p1', harnessType: 'copilot', scope: 'chat' });

    expect(p.driving).toBeNull();
    expect(Object.keys(p.mcpServers).sort()).toEqual(['project-server', 'system-server']);
  });

  // The stage passes its delta ONCE (as runtimeOverrides). If it were also
  // passed as `overrides`, the resolved instructions would carry two copies of
  // the same appended text.
  it('does not duplicate appended instructions when only one level supplies them', async () => {
    const agent = makeAgent({ instructions: 'Base instructions.' });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      runtimeOverrides: { agentOverrides: { appendInstructions: 'Extra rule.' } },
      harnessType: 'copilot',
      scope: 'stage',
    });

    const occurrences = p.driving!.instructions.split('Extra rule.').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('AgentResolver — tool policy', () => {
  const catalog = makeCatalog([]);

  it('lets an explicit false at a higher level beat the agent\'s true', async () => {
    const agent = makeAgent({ tools: { shell: true, browser: true } });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      overrides: { tools: { shell: false } },
      harnessType: 'copilot',
      scope: 'chat',
    });

    expect(p.toolPolicy.groups.shell).toBe(false);
    expect(p.toolPolicy.groups.browser).toBe(true);
  });

  it('expands a disabled group into provider-specific deny entries', async () => {
    const agent = makeAgent({ tools: { fileWrite: false } });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const copilot = await resolver.resolve({
      agentRef: 'global:reviewer',
      harnessType: 'copilot',
      scope: 'chat',
    });
    const claude = await resolver.resolve({
      agentRef: 'global:reviewer',
      harnessType: 'claude-agent',
      scope: 'chat',
    });

    expect(copilot.toolPolicy.deny).toContain('edit_file');
    expect(claude.toolPolicy.deny).toContain('Edit');
  });

  it('makes deny beat allow for the same tool name', async () => {
    const agent = makeAgent();
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      overrides: { extraAllow: ['dangerous'], extraDeny: ['dangerous'] },
      harnessType: 'copilot',
      scope: 'chat',
    });

    expect(p.toolPolicy.deny).toContain('dangerous');
    expect(p.toolPolicy.allow).not.toContain('dangerous');
  });

  it('forces orchestration on for an orchestrator agent', async () => {
    const agent = makeAgent({ role: 'orchestrator', tools: { orchestration: false } });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      harnessType: 'copilot',
      scope: 'chat',
    });

    expect(p.toolPolicy.groups.orchestration).toBe(true);
  });

  // Regression: a live run showed the Copilot CLI's shell tool is `powershell`
  // on Windows and its write tool is `create`. A name missing from the
  // expansion table does not fail — it silently GRANTS the capability the
  // agent was configured to refuse, which is the worst possible failure mode.
  it('denies every known alias of a disabled capability', async () => {
    const agent = makeAgent({ tools: { shell: false, fileWrite: false, web: false } });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const copilot = await resolver.resolve({
      agentRef: 'global:reviewer',
      harnessType: 'copilot',
      scope: 'stage',
    });
    for (const name of ['bash', 'shell', 'powershell', 'pwsh', 'create', 'create_file', 'edit_file', 'fetch', 'web_search']) {
      expect(copilot.toolPolicy.deny).toContain(name);
    }

    const claude = await resolver.resolve({
      agentRef: 'global:reviewer',
      harnessType: 'claude-agent',
      scope: 'stage',
    });
    for (const name of ['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'WebFetch']) {
      expect(claude.toolPolicy.deny).toContain(name);
    }
  });
});

describe('AgentResolver — runtime scalars and instructions', () => {
  const catalog = makeCatalog([]);

  it('applies most-specific-wins across levels', async () => {
    const agent = makeAgent({ runtime: { model: 'agent-model', reasoningEffort: 'low' } });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      baseHarnessConfig: { model: 'workflow-model', maxTurns: 5 },
      overrides: { runtime: { reasoningEffort: 'high' } },
      harnessType: 'copilot',
      scope: 'stage',
    });

    expect(p.runtime.model).toBe('agent-model');
    expect(p.runtime.reasoningEffort).toBe('high');
    expect(p.runtime.maxTurns).toBe(5);
  });

  it('concatenates appended instructions after the agent body', async () => {
    const agent = makeAgent({ instructions: 'BASE' });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);

    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      overrides: { appendInstructions: 'EXTRA' },
      harnessType: 'copilot',
      scope: 'chat',
    });

    expect(p.driving?.instructions).toBe('BASE\n\nEXTRA');
  });
});

describe('AgentResolver — binding failures', () => {
  const catalog = makeCatalog([]);

  it('degrades to no agent with a warning when the ref is unknown', async () => {
    const resolver = new AgentResolver(makeRepo([]), catalog, logger);
    const p = await resolver.resolve({
      agentRef: 'global:missing',
      harnessType: 'copilot',
      scope: 'chat',
    });

    expect(p.driving).toBeNull();
    expect(p.warnings.map((w) => w.code)).toContain('AGENT_NOT_FOUND');
  });

  it('degrades when the agent is disabled', async () => {
    const agent = makeAgent({ enabled: false });
    const resolver = new AgentResolver(makeRepo([agent]), catalog, logger);
    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      harnessType: 'copilot',
      scope: 'chat',
    });

    expect(p.driving).toBeNull();
    expect(p.warnings.map((w) => w.code)).toContain('AGENT_DISABLED');
  });

  it('returns the snapshot verbatim without touching the repo', async () => {
    const resolver = new AgentResolver(
      { getByRef: async () => { throw new Error('must not be called'); } } as unknown as IAgentRepository,
      catalog,
      logger,
    );
    const snapshot = AgentResolver.empty();
    const p = await resolver.resolve({
      agentRef: 'global:reviewer',
      harnessType: 'copilot',
      scope: 'chat',
      snapshot,
    });
    expect(p).toBe(snapshot);
  });
});

describe('AgentResolver — orchestrator team', () => {
  it('projects enabled non-orchestrator members and skips the rest', async () => {
    const member = makeAgent({
      id: 'm1',
      slug: 'worker',
      ref: 'global:worker',
      name: 'Worker',
      instructions: 'do work',
    });
    const disabled = makeAgent({
      id: 'm2',
      slug: 'off',
      ref: 'global:off',
      enabled: false,
    });
    const nested = makeAgent({
      id: 'm3',
      slug: 'nested',
      ref: 'global:nested',
      role: 'orchestrator',
    });
    const lead = makeAgent({
      id: 'lead',
      slug: 'lead',
      ref: 'global:lead',
      role: 'orchestrator',
      orchestration: { teamAgentRefs: ['global:worker', 'global:off', 'global:nested', 'global:ghost'] },
    });

    const resolver = new AgentResolver(
      makeRepo([lead, member, disabled, nested]),
      makeCatalog([]),
      logger,
    );
    const p = await resolver.resolve({
      agentRef: 'global:lead',
      harnessType: 'claude-agent',
      scope: 'chat',
    });

    expect(p.team.map((t) => t.ref)).toEqual(['global:worker']);
    expect(p.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['TEAM_AGENT_DISABLED', 'TEAM_AGENT_NOT_FOUND']),
    );
  });
});

describe('redactProjection', () => {
  it('masks literal MCP env and header values and keeps secretref pointers (R2)', () => {
    const p = AgentResolver.empty();
    p.mcpServers = {
      github: { type: 'stdio', command: 'npx', env: { TOKEN: 'ghp_secret', REF: 'secretref:mcp-gh/token' } },
      api: { type: 'http', url: 'https://x', headers: { Authorization: 'Bearer secret' } },
    };
    const out = redactProjection(p);
    expect(JSON.stringify(out)).not.toContain('ghp_secret');
    expect(JSON.stringify(out)).not.toContain('Bearer secret');
    expect((out.mcpServers['github'] as { env: Record<string, string> }).env).toEqual({
      TOKEN: MCP_REDACTED_VALUE,
      REF: 'secretref:mcp-gh/token',
    });
  });
});
