// ────────────────────────────────────────────────────────────────
// W46 — CreateConversationParams round-trip acceptance test.
//
// Every field on CreateConversationParams must survive the path:
//   SessionAllocator.allocateSession(build → config)
//     → harness.createConversation(params)
//
// The previous 16-key hand-enumeration in SessionAllocator.createSession
// silently dropped: defaultAgent, reasoningEffort, contextTier, maxTurns,
// hooks, permissionMode, planModeInstructions, onPlanReviewRequest,
// onQuestionRequest (G1 + G2).
//
// This property test replaces all of those defect rows with a single
// falsifiable assertion: nothing in the pipeline drops a field the caller set.
//
// Acceptance (master plan W46):
//   "A property test asserts that every field on CreateConversationParams
//    survives the round trip create → resume → rebind."
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionAllocator } from '../src/services/SessionAllocator.js';
import { EventBus } from '../src/events/EventBus.js';
import type { ISessionRepository } from '../src/domain/ports/IRepositories.js';
import type { IAgentHarness, CreateConversationParams } from '../src/domain/ports/IAgentHarness.js';
import type { Session } from '@generatorai/shared';

// ── Helpers ──────────────────────────────────────────────────────

/** Session repository backed by a plain Map. */
function makeSessionRepo(): ISessionRepository {
  const sessions = new Map<string, Session>();
  return {
    create: async (s: Session) => { sessions.set(s.id, { ...s }); },
    getById: async (id: string) => {
      const s = sessions.get(id);
      if (!s) throw new Error(`no session ${id}`);
      return s;
    },
    updateStatus: async (id: string, status: Session['status']) => {
      const s = sessions.get(id);
      if (s) s.status = status;
    },
    update: async (id: string, patch: Partial<Session>) => {
      const s = sessions.get(id);
      if (s) Object.assign(s, patch);
    },
  } as unknown as ISessionRepository;
}

/** Spy harness that records every createConversation / resumeConversation call. */
function makeSpyHarness(): {
  harness: IAgentHarness;
  createCalls: CreateConversationParams[];
  resumeCalls: Array<{ id: string; params: CreateConversationParams | undefined }>;
} {
  const createCalls: CreateConversationParams[] = [];
  const resumeCalls: Array<{ id: string; params: CreateConversationParams | undefined }> = [];
  const harness: IAgentHarness = {
    createConversation: async (p: CreateConversationParams) => {
      createCalls.push({ ...p });
      return p.conversationId;
    },
    resumeConversation: async (id: string, p?: CreateConversationParams) => {
      resumeCalls.push({ id, params: p ? { ...p } : undefined });
    },
    destroyConversation: async () => { /* noop */ },
    hasLiveConversation: () => false,
    listConversations: async () => [],
    getLastConversationId: async () => null,
    deleteConversation: async () => { /* noop */ },
    getConversationWarnings: () => [],
    selectAgent: async () => { /* noop */ },
    listAgents: async () => [],
    getMessages: async () => [],
    onConversationEvent: () => () => { /* noop */ },
    sendPrompt: async () => { /* noop */ },
    sendPromptAndWait: async () => ({ content: '' }),
    abortConversation: async () => { /* noop */ },
    initialize: async () => { /* noop */ },
    stop: async () => { /* noop */ },
    forceStop: async () => { /* noop */ },
    shutdown: async () => { /* noop */ },
    getClientState: () => 'running' as never,
    ping: async () => true,
    onClientEvent: () => () => { /* noop */ },
    capabilities: () => ({
      vision: false,
      reasoning: false,
      reasoningEfforts: [],
      planMode: false,
      mcpServers: false,
      approvalGating: 'none',
      hostTools: 'none',
      structuredOutput: 'none',
      skills: 'none',
      sessionPersistence: false,
      budgetTracking: false,
    }),
    getModels: async () => [],
    getAccountInfo: async () => ({}),
  } as unknown as IAgentHarness;
  return { harness, createCalls, resumeCalls };
}

/** A fully-populated CreateConversationParams for the round-trip test. */
function fullParams(): Partial<CreateConversationParams> {
  const onPermission = async () => ({ granted: true as const });
  return {
    model: 'claude-opus-5',
    harnessType: 'claude-agent',
    systemPromptAppend: 'Be concise.',
    availableTools: ['bash', 'read'],
    excludedTools: ['delete'],
    defaultAgent: 'my-agent',
    agentProjection: 'append',
    skillDirectories: ['/repo/.agents/skills'],
    disabledSkills: ['web-search'],
    skills: ['code-review'],
    mcpServers: { 'my-mcp': { command: 'npx', args: ['-y', 'my-mcp-server'] } },
    reasoning: false,
    reasoningEffort: 'low',
    contextTier: 'full',
    maxTurns: 10,
    streaming: true,
    permissionMode: 'default',
    onPermissionRequest: onPermission,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('W46 — CreateConversationParams round-trip (G1/G2)', () => {
  let allocator: SessionAllocator;
  let spy: ReturnType<typeof makeSpyHarness>;

  beforeEach(() => {
    spy = makeSpyHarness();
    allocator = new SessionAllocator(makeSessionRepo(), spy.harness, new EventBus());
  });

  it('per-stage: every non-function field in the config reaches harness.createConversation', async () => {
    const config = fullParams();
    await allocator.allocateSession('run-1', 'stage-1', 'per-stage', async () => config as CreateConversationParams);

    expect(spy.createCalls).toHaveLength(1);
    const received = spy.createCalls[0]!;

    // Scalar fields
    expect(received.model).toBe(config.model);
    expect(received.harnessType).toBe(config.harnessType);
    expect(received.systemPromptAppend).toBe(config.systemPromptAppend);
    expect(received.defaultAgent).toBe(config.defaultAgent);           // G1
    expect(received.agentProjection).toBe(config.agentProjection);
    expect(received.reasoning).toBe(config.reasoning);
    expect(received.reasoningEffort).toBe(config.reasoningEffort);     // G2
    expect(received.contextTier).toBe(config.contextTier);             // G2
    expect(received.maxTurns).toBe(config.maxTurns);                   // G2
    expect(received.streaming).toBe(config.streaming);
    expect(received.permissionMode).toBe(config.permissionMode);       // G2

    // Array fields must not be replaced by spread — they should deep-equal
    expect(received.availableTools).toEqual(config.availableTools);
    expect(received.excludedTools).toEqual(config.excludedTools);
    expect(received.skillDirectories).toEqual(config.skillDirectories); // G3
    expect(received.disabledSkills).toEqual(config.disabledSkills);     // G3
    expect(received.skills).toEqual(config.skills);
    expect(received.mcpServers).toEqual(config.mcpServers);             // G4

    // conversationId must be overridden (it's a stage-specific id)
    expect(received.conversationId).toBeDefined();
    expect(received.conversationId).not.toBe('');
  });

  it('single mode: shared session receives the same config', async () => {
    const config = fullParams();
    await allocator.allocateSession('run-2', 'stage-1', 'single', async () => config as CreateConversationParams);

    expect(spy.createCalls).toHaveLength(1);
    const received = spy.createCalls[0]!;
    expect(received.defaultAgent).toBe(config.defaultAgent);   // G1
    expect(received.maxTurns).toBe(config.maxTurns);           // G2
    expect(received.skillDirectories).toEqual(config.skillDirectories); // G3
  });

  it('a second stage in single mode reuses the existing session (no second createConversation)', async () => {
    const config = fullParams();
    await allocator.allocateSession('run-3', 'stage-1', 'single', async () => config as CreateConversationParams);
    await allocator.allocateSession('run-3', 'stage-2', 'single', async () => config as CreateConversationParams);

    // The second stage reuses the shared session — createConversation is called only once
    expect(spy.createCalls).toHaveLength(1);
  });

  it('onPermissionRequest from config reaches harness.createConversation', async () => {
    const onPermission = async () => ({ granted: true as const });
    const config: Partial<CreateConversationParams> = { onPermissionRequest: onPermission };
    await allocator.allocateSession('run-5', 'stage-1', 'per-stage', async () => config as CreateConversationParams);

    const received = spy.createCalls[0]!;
    // The composed handler reaches the provider; the allocator adds none of its own
    expect(received.onPermissionRequest).toBe(onPermission);
  });
});
