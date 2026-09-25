// ────────────────────────────────────────────────────────────────
// ResultValidator — shared-session scoping (WS-D1 hardening).
//
// `WorkflowRunService.startRun` auto-resolves `sessionMode: 'single'` for
// every purely linear workflow, so every stage in the run talks through the
// SAME conversation. `validateStageResult` must therefore validate only the
// messages the stage UNDER TEST produced, not every assistant message the
// shared session has ever emitted (which would include every prior stage's
// output too).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { ResultValidator } from '../src/services/ResultValidator.js';
import { MockStageRunRepository } from './MockRepositories.js';
import { EventBus } from '../src/events/EventBus.js';
import type { IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { ChatMessage, ILogger, StageRun } from '@generatorai/shared';

function makeMessage(sessionId: string, stageRunId: string, content: string): ChatMessage {
  return {
    id: `${stageRunId}-${Math.random().toString(36).slice(2)}`,
    sessionId,
    role: 'assistant',
    content,
    metadata: { stageRunId },
    timestamp: new Date(),
  } as ChatMessage;
}

/**
 * A message repo that actually filters by BOTH sessionId and
 * `metadata.stageRunId` for `getBySessionAndStageRunId` — mirroring
 * `DrizzleChatMessageRepository`'s real `json_extract(metadata, '$.stageRunId')`
 * filter — while `getBySessionId` returns every message in the session
 * regardless of which stage produced it (the old, buggy source of data for
 * validation).
 */
function createScopedMessageRepo(messages: ChatMessage[]): IChatMessageRepository {
  return {
    create: vi.fn(async (msg: ChatMessage) => { messages.push({ ...msg }); return { ...msg }; }),
    getBySessionId: vi.fn(async (sessionId: string) =>
      messages.filter((m) => m.sessionId === sessionId)),
    getBySessionAndStageRunId: vi.fn(async (sessionId: string, stageRunId: string) =>
      messages.filter((m) => m.sessionId === sessionId && m.metadata?.['stageRunId'] === stageRunId)),
    getByChatId: vi.fn(async () => []),
    deleteBySession: vi.fn(async () => {}),
  } as unknown as IChatMessageRepository;
}

function makeStageRun(id: string, name: string, sessionId: string): StageRun {
  return {
    id,
    workflowRunId: 'run-1',
    stageDefinitionId: `def-${id}`,
    name,
    status: 'completed',
    currentStep: 0,
    totalSteps: 1,
    retryCount: 0,
    sessionId,
    createdAt: new Date(),
  };
}

const noopLogger: ILogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
} as unknown as ILogger;

describe('ResultValidator — shared-session scoping', () => {
  it('validates only the stage under test, not every prior stage sharing the session', async () => {
    const SESSION = 'shared-ses-1';
    const stage1 = makeStageRun('sr-1', 'Stage One', SESSION);
    const stage2 = makeStageRun('sr-2', 'Stage Two', SESSION);

    const messages: ChatMessage[] = [
      makeMessage(SESSION, 'sr-1', 'Stage one output contains SECRET_MARKER_1'),
      makeMessage(SESSION, 'sr-2', 'Stage two output has nothing special'),
    ];

    const messageRepo = createScopedMessageRepo(messages);
    const stageRunRepo = new MockStageRunRepository();
    await stageRunRepo.create(stage1);
    await stageRunRepo.create(stage2);

    const eventBus = new EventBus();
    const validator = new ResultValidator(messageRepo, stageRunRepo, eventBus, noopLogger);

    // A rule that only passes if validation saw ONLY stage 2's output. Before
    // the fix, `getBySessionId` concatenated every assistant message in the
    // shared session, so this rule would fail against stage 1's leaked text.
    const result = await validator.validateStageResult(
      'run-1',
      'sr-2',
      {
        stageIndex: 1,
        rules: [{ type: 'not_contains', value: 'SECRET_MARKER_1', message: 'must not contain stage 1 marker' }],
      },
    );

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(messageRepo.getBySessionAndStageRunId).toHaveBeenCalledWith(SESSION, 'sr-2');
    expect(messageRepo.getBySessionId).not.toHaveBeenCalled();
  });

  it('still validates against the stage own output (rule failure is not masked)', async () => {
    const SESSION = 'shared-ses-2';
    const stage1 = makeStageRun('sr-a', 'Stage A', SESSION);

    const messages: ChatMessage[] = [
      makeMessage(SESSION, 'sr-a', 'nothing relevant here'),
    ];
    const messageRepo = createScopedMessageRepo(messages);
    const stageRunRepo = new MockStageRunRepository();
    await stageRunRepo.create(stage1);

    const eventBus = new EventBus();
    const validator = new ResultValidator(messageRepo, stageRunRepo, eventBus, noopLogger);

    const result = await validator.validateStageResult(
      'run-1',
      'sr-a',
      { stageIndex: 0, rules: [{ type: 'contains', value: 'REQUIRED_MARKER', message: 'needs REQUIRED_MARKER' }] },
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(['needs REQUIRED_MARKER']);
  });
});

describe('ResultValidator — regex rules run on the linear-time engine (RV-21)', () => {
  async function check(pattern: string, output: string) {
    const stage = makeStageRun('sr-r', 'Regex', 'ses-r');
    const messageRepo = createScopedMessageRepo([makeMessage('ses-r', 'sr-r', output)]);
    const stageRunRepo = new MockStageRunRepository();
    await stageRunRepo.create(stage);
    const validator = new ResultValidator(messageRepo, stageRunRepo, new EventBus(), noopLogger);
    return validator.validateStageResult('run-1', 'sr-r', { stageIndex: 0, rules: [{ type: 'regex', value: pattern, message: 'no match' }] });
  }

  it('matches like a regular expression', async () => {
    expect((await check('^DONE: \\d+ files$', 'DONE: 12 files')).passed).toBe(true);
    expect((await check('^DONE: \\d+ files$', 'done')).passed).toBe(false);
  });

  it('cannot be stalled by a catastrophic pattern', async () => {
    const start = Date.now();
    expect((await check('^(a+)+$', `${'a'.repeat(5000)}!`)).passed).toBe(false);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('fails a rule whose pattern the engine cannot run', async () => {
    expect((await check('(a)\\1', 'aa')).passed).toBe(false);
  });
});
