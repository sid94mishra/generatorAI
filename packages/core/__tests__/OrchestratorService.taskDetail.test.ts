// ────────────────────────────────────────────────────────────────
// OrchestratorService — D-89 task detail: the brief, the orchestrator's review
// rounds and the worker's latest steps, read from the worker chat's persisted
// messages (so they survive a restart — no task record is needed).
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { OrchestratorService, DEFAULT_ORCHESTRATOR_CONFIG, parseBrief } from '../src/services/orchestrator/OrchestratorService.js';
import { renderBriefMessage } from '../src/services/orchestrator/prompts.js';
import { EventBus } from '../src/events/EventBus.js';
import { MockChatRepository } from './MockRepositories.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type { Chat, ChatMessage } from '@generatorai/shared';

const T = (s: number) => new Date(Date.UTC(2026, 9, 4, 10, 0, s));

function message(id: string, role: ChatMessage['role'], content: string, at: number, toolCalls?: unknown[]): ChatMessage {
  return {
    id,
    sessionId: 'w-session',
    chatId: 'worker-1',
    role,
    content,
    timestamp: T(at),
    ...(toolCalls ? { metadata: { toolCalls } } : {}),
  } as unknown as ChatMessage;
}

async function setup(messages: ChatMessage[], status: 'completed' | 'needs_review' | 'running' = 'completed') {
  const chatRepo = new MockChatRepository();
  await chatRepo.create({ id: 'parent-1', name: 'Orchestrator', sessionId: 'p-session', status: 'active', createdAt: T(0), updatedAt: T(0) } as unknown as Chat);
  await chatRepo.create({
    id: 'worker-1',
    name: '⚙ slug-guide',
    sessionId: 'w-session',
    status: 'active',
    model: 'gpt-5.6-sol',
    parentChatId: 'parent-1',
    backgroundTask: { orchestratorChatId: 'parent-1', taskName: 'slug-guide', status },
    createdAt: T(0),
    updatedAt: T(0),
  } as unknown as Chat);
  const messageRepo = {
    async countByChatId() {
      return messages.length;
    },
    async getByChatId(_id: string, limit = messages.length, offset = 0) {
      return messages.slice(offset, offset + limit);
    },
  } as unknown as IChatMessageRepository;
  return new OrchestratorService(chatRepo, {} as ISessionRepository, messageRepo, {} as IAgentHarness, new EventBus(), DEFAULT_ORCHESTRATOR_CONFIG);
}

const BRIEF = renderBriefMessage(
  { taskName: 'slug-guide', objective: 'Write src/slugify.ts.', context: 'Tiny repo, no package.json.', boundaries: 'Only src/slugify.ts.' },
  '/tmp/tasks/slug-guide',
);

describe('getBackgroundTaskDetail (D-89)', () => {
  it('reads the brief, the review rounds and the latest steps from the worker chat', async () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, tool: i % 2 ? 'Read' : 'Edit', args: { file_path: `src/f${i}.ts` }, status: 'complete', success: true }));
    const orchestrator = await setup([
      message('m1', 'user', BRIEF, 1),
      message('m2', 'assistant', 'first try', 2, steps.slice(0, 6)),
      message('m3', 'user', 'Handle diacritics too.', 3),
      message('m4', 'assistant', 'second try', 4, [
        ...steps.slice(6),
        { id: 'big', tool: 'Write', args: { content: 'x'.repeat(5000) }, status: 'complete', fileOp: { kind: 'create', filePath: 'src/slugify.ts', additions: 12, deletions: 0, hunks: [] } },
      ]),
    ]);
    const detail = await orchestrator.getBackgroundTaskDetail('parent-1', 'worker-1');
    expect(detail).not.toBeNull();
    expect(detail!).toMatchObject({
      taskId: 'worker-1',
      taskName: 'slug-guide',
      status: 'completed',
      model: 'gpt-5.6-sol',
      outcome: 'accepted',
      reviewRounds: 1,
      maxReviewRounds: DEFAULT_ORCHESTRATOR_CONFIG.maxReviewRounds,
      rounds: [{ round: 1, request: 'Handle diacritics too.' }],
    });
    expect(detail!.brief).toMatchObject({
      objective: 'Write src/slugify.ts.',
      context: 'Tiny repo, no package.json.',
      boundaries: 'Only src/slugify.ts.',
    });
    // At most 8, oldest first, newest last; huge args clipped; fileOp without hunks.
    expect(detail!.lastSteps).toHaveLength(8);
    expect(detail!.lastSteps.at(-1)).toMatchObject({ id: 'big', fileOp: { filePath: 'src/slugify.ts', additions: 12 } });
    expect(JSON.stringify(detail!.lastSteps.at(-1)!.args).length).toBeLessThan(2200);
    expect(detail!.lastSteps.at(-1)!.fileOp).not.toHaveProperty('hunks');
    expect(detail!.lastSteps[0]!.id).toBe('c3');
  });

  it('says the result is in review, and null for a chat that is not this orchestrator’s worker', async () => {
    const orchestrator = await setup([message('m1', 'user', BRIEF, 1)], 'needs_review');
    expect((await orchestrator.getBackgroundTaskDetail('parent-1', 'worker-1'))!.outcome).toBe('in_review');
    expect(await orchestrator.getBackgroundTaskDetail('someone-else', 'worker-1')).toBeNull();
    expect(await orchestrator.getBackgroundTaskDetail('parent-1', 'missing')).toBeNull();
  });

  it('parses a brief without optional sections', () => {
    expect(parseBrief('# Task: x\n\n## Objective\nDo it.\n\n## Where to write\n…')).toEqual({
      text: '# Task: x\n\n## Objective\nDo it.\n\n## Where to write\n…',
      objective: 'Do it.',
    });
  });
});
