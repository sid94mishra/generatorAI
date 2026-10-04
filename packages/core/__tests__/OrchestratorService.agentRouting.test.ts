import { describe, expect, it } from 'vitest';
import type { ChatManagementService } from '../src/services/ChatManagementService.js';
import { OrchestratorService, DEFAULT_ORCHESTRATOR_CONFIG, type OrchestratorConfig } from '../src/services/orchestrator/OrchestratorService.js';
import { EventBus } from '../src/events/EventBus.js';
import { MockChatRepository } from './MockRepositories.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type { Chat, ChatMessage, Session, TaskBrief } from '@generatorai/shared';

// ── Minimal fakes for the dependencies spawnBackgroundAgent touches ──

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

/** Assistant message carrying a <TASK_RESULT> digest, as a worker would end its turn. */
function digestMessage(json: Record<string, unknown>): ChatMessage {
  return {
    id: `msg-${Math.random()}`,
    role: 'assistant',
    content: `Done.\n<TASK_RESULT>\n${JSON.stringify(json)}\n</TASK_RESULT>`,
    createdAt: new Date(),
  } as ChatMessage;
}

/** messageRepo.getByChatId returns whatever digest this test registered for a taskId. */
function fakeMessageRepo(digestsByTaskId: Map<string, Record<string, unknown>>): IChatMessageRepository {
  return {
    async create(m) { return m; },
    async getBySessionId() { return []; },
    async getBySessionAndStageRunId() { return []; },
    async getByChatId(chatId) {
      const digest = digestsByTaskId.get(chatId);
      return digest ? [digestMessage(digest)] : [];
    },
    async countByChatId() { return 0; },
    async deleteBySession() {},
  };
}

/** Only `getModels()` could ever be called (skipped entirely when config.defaultWorkerModel is set). */
function fakeHarness(): IAgentHarness {
  return { getModels: async () => [] } as unknown as IAgentHarness;
}

/** Deterministic worker chatId/sessionId so tests can drive events without reaching into service internals. */
const created: Array<Record<string, unknown>> = [];
function fakeChatManagementService(): ChatManagementService {
  let counter = 0;
  return {
    async createChat(opts: { name: string }) {
      created.push(opts as unknown as Record<string, unknown>);
      counter += 1;
      const id = `worker-${counter}`;
      return { id, sessionId: `${id}-session`, name: opts.name } as unknown as Chat;
    },
    async sendPrompt() { /* fire-and-forget in real code; no-op here */ },
    async cancelTurn() {},
  } as unknown as ChatManagementService;
}

interface Harness {
  orchestrator: OrchestratorService;
  chatRepo: MockChatRepository;
  eventBus: EventBus;
  digests: Map<string, Record<string, unknown>>;
  parentChatId: string;
}

async function makeHarness(config: Partial<OrchestratorConfig> = {}, chatRepo = new MockChatRepository()): Promise<Harness> {
  const eventBus = new EventBus();
  const digests = new Map<string, Record<string, unknown>>();
  const parentChatId = 'parent-1';
  await chatRepo.create({
    id: parentChatId,
    name: 'Orchestrator',
    sessionId: 'parent-1-session',
    status: 'active',
    orchestratorMode: true,
    agentRef: 'global:lead',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Chat);

  const orchestrator = new OrchestratorService(
    chatRepo,
    fakeSessionRepo(),
    fakeMessageRepo(digests),
    fakeHarness(),
    eventBus,
    { ...DEFAULT_ORCHESTRATOR_CONFIG, defaultWorkerModel: 'test-model', warmFirst: false, ...config },
  );
  orchestrator.setChatManagementService(fakeChatManagementService());

  return { orchestrator, chatRepo, eventBus, digests, parentChatId };
}


const AGENTS = [
  { ref: 'global:lead', name: 'Tech Lead', description: 'leads', role: 'orchestrator', runtime: { model: 'sonnet' }, orchestration: { teamAgentRefs: ['global:frontend-dev', 'global:backend-dev'], maxWorkers: 2, defaultWorkerModel: 'haiku' } },
  { ref: 'global:frontend-dev', name: 'Frontend Dev', description: 'web', role: 'agent', runtime: { model: 'gpt-5.6-terra' } },
  { ref: 'global:backend-dev', name: 'Backend Dev', description: 'api', role: 'agent', runtime: {} },
];

async function withAgents() {
  created.length = 0;
  const h = await makeHarness({ defaultWorkerModel: undefined, warmFirst: false });
  h.orchestrator.setAgentService({
    listSelectable: async () => AGENTS as never,
    getByRef: async (ref: string) => (AGENTS.find((a) => a.ref === ref) ?? null) as never,
  });
  return h;
}

describe('OrchestratorService — the bound agent and the orchestrator agent decide the worker (D-98)', () => {
  it('a bound agent with its own model runs on it, whatever model the spawn asked for', async () => {
    const h = await withAgents();
    const r = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, { taskName: 'web', objective: 'x', agentRef: 'global:frontend-dev', model: 'sonnet' } as unknown as TaskBrief);
    expect(r.ok).toBe(true);
    expect(r.model).toBe('gpt-5.6-terra');
    expect(r.note).toMatch(/Frontend Dev runs on its own model "gpt-5.6-terra"/);
    expect(created.at(-1)?.['model']).toBe('gpt-5.6-terra');
  });

  it("an agent without a model takes the spawn's model, else the orchestrator agent's default worker model", async () => {
    const h = await withAgents();
    const a = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, { taskName: 'api', objective: 'x', agentRef: 'global:backend-dev', model: 'sonnet' } as unknown as TaskBrief);
    expect(a.model).toBe('sonnet');
    const b = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, { taskName: 'api2', objective: 'x', agentRef: 'global:backend-dev' } as unknown as TaskBrief);
    expect(b.model).toBe('haiku');
  });

  it("the orchestrator agent's max concurrent workers caps the running workers", async () => {
    const h = await withAgents();
    for (const n of ['a', 'b']) expect((await h.orchestrator.spawnBackgroundAgent(h.parentChatId, { taskName: n, objective: 'x', model: 'sonnet' } as unknown as TaskBrief)).ok).toBe(true);
    const third = await h.orchestrator.spawnBackgroundAgent(h.parentChatId, { taskName: 'c', objective: 'x', model: 'sonnet' } as unknown as TaskBrief);
    expect(third.ok).toBe(false);
    expect(third.error).toMatch(/Worker limit reached \(2\)/);
  });

  it('list_available_agents tells the orchestrator which agents bring their own model', async () => {
    const h = await withAgents();
    const agents = await h.orchestrator.listAssignableAgents(h.parentChatId);
    expect(agents.find((a) => a.ref === 'global:frontend-dev')?.model).toBe('gpt-5.6-terra');
    expect(agents.find((a) => a.ref === 'global:backend-dev')?.model).toBeUndefined();
  });
});
