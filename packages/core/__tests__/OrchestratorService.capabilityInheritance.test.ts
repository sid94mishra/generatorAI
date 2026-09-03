// ────────────────────────────────────────────────────────────────
// G15 — worker capability inheritance.
//
// The plan lists "Capability inheritance for workers (G15)" under W24; the
// audit found zero references to it repo-wide. What actually happened was
// worse than "not implemented": `spawnBackgroundAgent` built the worker's
// `harnessConfig` from scratch with two fields, passed no `agentRef`, and so
// `applyAgentProjection` fell through to `AgentResolver.empty()` — whose tool
// groups are `DEFAULT_AGENT_TOOL_POLICY`. A worker spawned by a deliberately
// locked-down orchestrator ran with FULL platform defaults.
//
// These tests pin the ceiling semantics: a worker inherits the parent's
// restrictions and can never exceed them.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import type { ChatManagementService } from '../src/services/ChatManagementService.js';
import {
  OrchestratorService,
  DEFAULT_ORCHESTRATOR_CONFIG,
  inheritWorkerCapabilities,
} from '../src/services/orchestrator/OrchestratorService.js';
import { EventBus } from '../src/events/EventBus.js';
import { MockChatRepository } from './MockRepositories.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type { Chat, CreateChatParams, Session } from '@generatorai/shared';

function fakeSessionRepo(): ISessionRepository {
  return {
    async create(s) { return s; },
    async getById(id) { return { id, status: 'active' } as Session; },
    async getAll() { return []; },
    async getByStatus() { return []; },
    async countByStatus() { return 0; },
    async getByOwner() { return []; },
    async update(id, u) { return { id, ...u } as Session; },
    async updateStatus() {},
    async delete() {},
  };
}

function fakeMessageRepo(): IChatMessageRepository {
  return {
    async create(m) { return m; },
    async getBySessionId() { return []; },
    async getBySessionAndStageRunId() { return []; },
    async getByChatId() { return []; },
    async countByChatId() { return 0; },
    async deleteBySession() {},
  } as unknown as IChatMessageRepository;
}

// ── The pure inheritance rule ────────────────────────────────────

describe('G15 — inheritWorkerCapabilities', () => {
  it('carries every capability-bearing harnessConfig field down to the worker', () => {
    const parent = {
      id: 'p', name: 'O', sessionId: 's', status: 'active', tags: [],
      createdAt: new Date(), updatedAt: new Date(),
      harnessConfig: {
        mcpServers: { linear: { command: 'x' } },
        skillDirectories: ['/skills'],
        disabledSkills: ['dangerous'],
        customAgents: [{ name: 'a', description: 'd', instructions: 'i' }],
        excludedMcpServerIds: ['github'],
        configDir: '/cfg',
        harnessType: 'claude-agent',
        reasoningEffort: 'high',
        contextTier: 'long_context',
        maxTurns: 12,
      },
    } as unknown as Chat;

    const { harnessConfig } = inheritWorkerCapabilities(parent);

    expect(harnessConfig.mcpServers).toEqual({ linear: { command: 'x' } });
    expect(harnessConfig.skillDirectories).toEqual(['/skills']);
    expect(harnessConfig.disabledSkills).toEqual(['dangerous']);
    expect(harnessConfig.customAgents).toHaveLength(1);
    expect(harnessConfig.excludedMcpServerIds).toEqual(['github']);
    expect(harnessConfig.configDir).toBe('/cfg');
    expect(harnessConfig.harnessType).toBe('claude-agent');
    expect(harnessConfig.reasoningEffort).toBe('high');
    expect(harnessConfig.contextTier).toBe('long_context');
    expect(harnessConfig.maxTurns).toBe(12);
  });

  it('unions the parent’s exclusions with its resolved agent deny list', () => {
    const parent = {
      id: 'p', name: 'O', sessionId: 's', status: 'active', tags: [],
      createdAt: new Date(), updatedAt: new Date(),
      harnessConfig: { excludedTools: ['Bash'] },
      agentSnapshot: {
        toolPolicy: { allow: [], deny: ['Write', 'Edit'], groups: {} },
      },
    } as unknown as Chat;

    const { harnessConfig } = inheritWorkerCapabilities(parent);

    // A tool the orchestrator was denied must stay denied for the worker.
    expect(new Set(harnessConfig.excludedTools)).toEqual(new Set(['Bash', 'Write', 'Edit']));
  });

  it('inherits an allow-list, because an allow-list is a restriction', () => {
    const parent = {
      id: 'p', name: 'O', sessionId: 's', status: 'active', tags: [],
      createdAt: new Date(), updatedAt: new Date(),
      harnessConfig: { availableTools: ['Read', 'Grep'] },
    } as unknown as Chat;

    expect(inheritWorkerCapabilities(parent).harnessConfig.availableTools).toEqual(['Read', 'Grep']);
  });

  it('falls back to the resolved agent allow-list when the config declares none', () => {
    const parent = {
      id: 'p', name: 'O', sessionId: 's', status: 'active', tags: [],
      createdAt: new Date(), updatedAt: new Date(),
      agentSnapshot: { toolPolicy: { allow: ['Read'], deny: [], groups: {} } },
    } as unknown as Chat;

    expect(inheritWorkerCapabilities(parent).harnessConfig.availableTools).toEqual(['Read']);
  });

  it('inherits permissionMode, defaultAgentMode and browserConfig', () => {
    const parent = {
      id: 'p', name: 'O', sessionId: 's', status: 'active', tags: [],
      createdAt: new Date(), updatedAt: new Date(),
      permissionMode: 'approve',
      defaultAgentMode: 'plan',
      browserConfig: { enabled: false },
    } as unknown as Chat;

    const inherited = inheritWorkerCapabilities(parent);
    expect(inherited.permissionMode).toBe('approve');
    expect(inherited.defaultAgentMode).toBe('plan');
    expect(inherited.browserConfig).toEqual({ enabled: false });
  });

  it('does NOT inherit agentRef — that would grant the worker the orchestrator role', () => {
    const parent = {
      id: 'p', name: 'O', sessionId: 's', status: 'active', tags: [],
      createdAt: new Date(), updatedAt: new Date(),
      agentRef: 'project:lead',
      harnessConfig: { agentRef: 'project:lead' },
    } as unknown as Chat;

    const { harnessConfig } = inheritWorkerCapabilities(parent);
    // `role: 'orchestrator'` forces `orchestration: true` in AgentResolver,
    // which is exactly the tool set `orchestratorMode: false` exists to deny.
    expect(harnessConfig.agentRef).toBeUndefined();
  });

  it('returns an empty clamp for a parent that declares nothing', () => {
    const parent = {
      id: 'p', name: 'O', sessionId: 's', status: 'active', tags: [],
      createdAt: new Date(), updatedAt: new Date(),
    } as unknown as Chat;

    expect(inheritWorkerCapabilities(parent).harnessConfig).toEqual({});
  });
});

// ── The wiring: spawnBackgroundAgent must apply the clamp ────────

describe('G15 — spawnBackgroundAgent applies the inherited clamp', () => {
  it('passes the parent’s restrictions to createChat, with the worker prompt still winning', async () => {
    const chatRepo = new MockChatRepository();
    await chatRepo.create({
      id: 'parent-1',
      name: 'Orchestrator',
      sessionId: 'parent-1-session',
      status: 'active',
      orchestratorMode: true,
      permissionMode: 'approve',
      harnessConfig: {
        excludedTools: ['Bash'],
        mcpServers: { linear: { command: 'x' } },
        maxTurns: 7,
        systemMessage: { mode: 'append', content: 'ORCHESTRATOR PROMPT' },
      },
      agentSnapshot: { toolPolicy: { allow: [], deny: ['Write'], groups: {} } },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Chat);

    const created: CreateChatParams[] = [];
    const chatMgmt = {
      async createChat(params: CreateChatParams) {
        created.push(params);
        return { id: 'worker-1', sessionId: 'worker-1-session', name: params.name } as unknown as Chat;
      },
      async sendPrompt() {},
      async cancelTurn() {},
    } as unknown as ChatManagementService;

    const orchestrator = new OrchestratorService(
      chatRepo,
      fakeSessionRepo(),
      fakeMessageRepo(),
      { getModels: async () => [] } as unknown as IAgentHarness,
      new EventBus(),
      { ...DEFAULT_ORCHESTRATOR_CONFIG, defaultWorkerModel: 'test-model', warmFirst: false },
    );
    orchestrator.setChatManagementService(chatMgmt);

    const result = await orchestrator.spawnBackgroundAgent('parent-1', {
      taskName: 'do a thing',
      objective: 'objective',
    } as never);
    expect(result.ok).toBe(true);

    expect(created).toHaveLength(1);
    const cfg = created[0]!.harnessConfig!;
    // The clamp travelled…
    expect(new Set(cfg.excludedTools)).toEqual(new Set(['Bash', 'Write']));
    expect(cfg.mcpServers).toEqual({ linear: { command: 'x' } });
    expect(cfg.maxTurns).toBe(7);
    expect(created[0]!.permissionMode).toBe('approve');
    // …but the constant worker prompt still wins over the parent's, or the
    // shared prompt-cache prefix every worker depends on would be broken.
    expect(cfg.systemMessage?.content).not.toContain('ORCHESTRATOR PROMPT');
    // And the orchestrator role is never handed down.
    expect(created[0]!.agentRef).toBeUndefined();
    expect(created[0]!.orchestratorMode).toBe(false);
  });

  it('CONTROL: a parent with no restrictions still produces an unclamped worker', async () => {
    const chatRepo = new MockChatRepository();
    await chatRepo.create({
      id: 'parent-1', name: 'Orchestrator', sessionId: 'parent-1-session',
      status: 'active', orchestratorMode: true,
      createdAt: new Date(), updatedAt: new Date(),
    } as unknown as Chat);

    const created: CreateChatParams[] = [];
    const orchestrator = new OrchestratorService(
      chatRepo,
      fakeSessionRepo(),
      fakeMessageRepo(),
      { getModels: async () => [] } as unknown as IAgentHarness,
      new EventBus(),
      { ...DEFAULT_ORCHESTRATOR_CONFIG, defaultWorkerModel: 'test-model', warmFirst: false },
    );
    orchestrator.setChatManagementService({
      async createChat(params: CreateChatParams) {
        created.push(params);
        return { id: 'w', sessionId: 'w-s', name: params.name } as unknown as Chat;
      },
      async sendPrompt() {},
      async cancelTurn() {},
    } as unknown as ChatManagementService);

    await orchestrator.spawnBackgroundAgent('parent-1', {
      taskName: 't', objective: 'o',
    } as never);

    expect(created[0]!.harnessConfig!.excludedTools).toBeUndefined();
    expect(created[0]!.harnessConfig!.availableTools).toBeUndefined();
  });
});
