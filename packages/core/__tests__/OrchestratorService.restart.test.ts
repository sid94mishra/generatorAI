import { describe, expect, it } from 'vitest';
import type { ChatManagementService } from '../src/services/ChatManagementService.js';
import { OrchestratorService, DEFAULT_ORCHESTRATOR_CONFIG } from '../src/services/orchestrator/OrchestratorService.js';
import { renderResumeMessage } from '../src/services/orchestrator/prompts.js';
import { EventBus } from '../src/events/EventBus.js';
import { MockChatRepository } from './MockRepositories.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type { BackgroundTaskStatus, Chat, ChatMessage, Session } from '@generatorai/shared';

// D-100: a worker whose turn died with the previous server process is `interrupted` and resumes from its chat.

const BRIEF = '# Task: api\nBuild the notes API.';

function sessionRepo(): ISessionRepository {
  return { async getById(id: string) { return { id, status: 'active' } as Session; } } as unknown as ISessionRepository;
}

function messageRepo(): IChatMessageRepository {
  return {
    async getByChatId(chatId: string) {
      return chatId.startsWith('worker') ? [{ id: 'm1', role: 'user', content: BRIEF, timestamp: new Date() } as unknown as ChatMessage] : [];
    },
    async countByChatId() { return 1; },
  } as unknown as IChatMessageRepository;
}

async function setup(workerStatus: BackgroundTaskStatus) {
  const chatRepo = new MockChatRepository();
  const eventBus = new EventBus();
  await chatRepo.create({ id: 'parent-1', name: 'Lead', sessionId: 'parent-1-session', status: 'active', orchestratorMode: true, createdAt: new Date(), updatedAt: new Date() } as unknown as Chat);
  await chatRepo.create({
    id: 'worker-1',
    name: 'api',
    sessionId: 'worker-1-session',
    parentChatId: 'parent-1',
    model: 'gpt-5.6-terra',
    status: 'active',
    backgroundTask: { orchestratorChatId: 'parent-1', taskName: 'api', status: workerStatus },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Chat);
  const prompts: Array<{ chatId: string; text: string }> = [];
  // A fresh service: the previous process's live records are gone, as after a restart.
  const orchestrator = new OrchestratorService(chatRepo, sessionRepo(), messageRepo(), { getModels: async () => [] } as unknown as IAgentHarness, eventBus, {
    ...DEFAULT_ORCHESTRATOR_CONFIG,
    defaultWorkerModel: 'test-model',
    warmFirst: false,
  });
  orchestrator.setChatManagementService({
    async sendPrompt(chatId: string, text: string) { prompts.push({ chatId, text }); },
    getStreamingChatIds: () => [],
  } as unknown as ChatManagementService);
  return { orchestrator, chatRepo, eventBus, prompts };
}

describe('OrchestratorService — workers across a restart (D-100)', () => {
  it('a worker the DB still calls running is listed and stored as interrupted, not failed', async () => {
    const h = await setup('running');
    const [task] = await h.orchestrator.listBackgroundAgents('parent-1');
    expect(task?.status).toBe('interrupted');
    expect((await h.chatRepo.getById('worker-1'))?.backgroundTask?.status).toBe('interrupted');
  });

  it('Resume re-attaches the worker, prompts it with its brief and settles it like any worker', async () => {
    const h = await setup('interrupted');
    const r = await h.orchestrator.resumeBackgroundAgent('worker-1', { parentChatId: 'parent-1' });
    expect(r).toEqual({ ok: true });
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]!.chatId).toBe('worker-1');
    expect(h.prompts[0]!.text).toContain('The app restarted');
    expect(h.prompts[0]!.text).toContain(BRIEF);
    const listed = await h.orchestrator.listBackgroundAgents('parent-1');
    expect(listed).toEqual([expect.objectContaining({ taskId: 'worker-1', status: 'running', model: 'gpt-5.6-terra' })]);

    await h.eventBus.emit('worker-1-session', { kind: 'harness.message_complete', data: { content: 'Done.\n<TASK_RESULT>{"status":"completed","summary":"ok"}</TASK_RESULT>' } } as never);
    await h.eventBus.emit('worker-1-session', { kind: 'harness.idle' } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await h.orchestrator.listBackgroundAgents('parent-1'))[0]?.status).toBe('needs_review');
    expect((await h.chatRepo.getById('worker-1'))?.backgroundTask?.status).toBe('needs_review');
  });

  it('a follow-up from the orchestrator resumes an interrupted worker with the follow-up in the message', async () => {
    const h = await setup('interrupted');
    const r = await h.orchestrator.sendToBackgroundAgent('worker-1', 'Also add pagination.');
    expect(r.ok).toBe(true);
    expect(h.prompts[0]!.text).toContain('Also add pagination.');
  });

  it('only an interrupted worker resumes, and only under its own orchestrator', async () => {
    const done = await setup('completed');
    expect((await done.orchestrator.resumeBackgroundAgent('worker-1')).ok).toBe(false);
    expect(done.prompts).toHaveLength(0);
    const other = await setup('interrupted');
    expect(await other.orchestrator.resumeBackgroundAgent('worker-1', { parentChatId: 'someone-else' })).toMatchObject({ ok: false, notFound: true });
    const twice = await setup('interrupted');
    await twice.orchestrator.resumeBackgroundAgent('worker-1');
    expect((await twice.orchestrator.resumeBackgroundAgent('worker-1')).ok).toBe(false);
    expect(twice.prompts).toHaveLength(1);
  });
});

describe('renderResumeMessage', () => {
  it('asks the worker to check its files first and repeats the brief', () => {
    const text = renderResumeMessage(BRIEF);
    expect(text).toMatch(/check the current state of the files/i);
    expect(text).toContain('## Your brief (repeated)');
    expect(text).toContain(BRIEF);
  });

  it('without a brief it still asks for the digest', () => {
    expect(renderResumeMessage(undefined)).toContain('<TASK_RESULT>');
  });
});
