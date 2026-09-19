// ────────────────────────────────────────────────────────────────
// StageExecutionService Tests  (P3.16)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StageExecutionService } from '../src/services/StageExecutionService.js';
import { MockStageRunRepository, MockStageDefinitionRepository } from './MockRepositories.js';
import { MockCopilotPort } from './MockAgentHarness.js';
import { EventBus } from '../src/events/EventBus.js';
import type { IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { SessionAllocator } from '../src/services/SessionAllocator.js';
import type { HookExecutor } from '../src/services/HookExecutor.js';
import type { StageRun, StageDefinition, ChatMessage, Session } from '@generatorai/shared';

// ── Helpers ──

function createMockMessageRepo(): IChatMessageRepository {
  const messages: ChatMessage[] = [];
  return {
    create: vi.fn(async (msg: ChatMessage) => { messages.push({ ...msg }); return { ...msg }; }),
    getBySessionId: vi.fn(async () => messages),
    getByChatId: vi.fn(async () => []),
    deleteBySession: vi.fn(async () => {}),
  };
}

function createMockSessionAllocator(): SessionAllocator {
  const fakeSession: Session = {
    id: 'ses-1',
    name: 'Mock Session',
    status: 'running',
    conversationId: 'conv-1',
    tags: [],
    requiresCodebase: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    allocateSession: vi.fn(async () => fakeSession),
    releaseSession: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
  } as unknown as SessionAllocator;
}

function createMockHookExecutor(): HookExecutor {
  return {
    executePhase: vi.fn(async () => true),
  } as unknown as HookExecutor;
}

function makeStageDef(
  id: string,
  prompts: StageDefinition['prompts'],
  opts?: Partial<StageDefinition>,
): StageDefinition {
  return {
    id,
    workflowDefinitionId: 'def-1',
    name: `Stage ${id}`,
    order: 0,
    prompts,
    variables: {},
    hooks: [],
    createdAt: new Date(),
    ...opts,
  };
}

function makeStageRun(
  id: string,
  stageDefId: string,
  status: StageRun['status'] = 'pending',
): StageRun {
  return {
    id,
    workflowRunId: 'run-1',
    stageDefinitionId: stageDefId,
    name: `SR ${stageDefId}`,
    status,
    currentStep: 0,
    totalSteps: 1,
    retryCount: 0,
    createdAt: new Date(),
  };
}

describe('StageExecutionService', () => {
  let service: StageExecutionService;
  let stageRunRepo: MockStageRunRepository;
  let stageDefRepo: MockStageDefinitionRepository;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let copilot: MockCopilotPort;
  let eventBus: EventBus;
  let sessionAllocator: ReturnType<typeof createMockSessionAllocator>;
  let hookExecutor: ReturnType<typeof createMockHookExecutor>;

  beforeEach(() => {
    stageRunRepo = new MockStageRunRepository();
    stageDefRepo = new MockStageDefinitionRepository();
    messageRepo = createMockMessageRepo();
    copilot = new MockCopilotPort();
    eventBus = new EventBus();
    sessionAllocator = createMockSessionAllocator();
    hookExecutor = createMockHookExecutor();

    service = new StageExecutionService(
      stageRunRepo,
      stageDefRepo,
      messageRepo,
      copilot,
      eventBus,
      sessionAllocator,
      hookExecutor,
    );
  });

  // ── executeStage ──

  describe('executeStage', () => {
    it('should run all prompts and mark stage completed', async () => {
      const sDef = makeStageDef('sd-1', [
        { label: 'P1', text: 'First prompt', waitForCompletion: true },
        { label: 'P2', text: 'Second prompt', waitForCompletion: true },
      ]);
      await stageDefRepo.create(sDef);

      const sr = makeStageRun('sr-1', 'sd-1');
      await stageRunRepo.create(sr);

      await service.executeStage(sr, 'run-1', 'per-stage');

      // Stage run should be completed
      const updated = await stageRunRepo.getById('sr-1');
      expect(updated.status).toBe('completed');

      // Both prompts + summary generation should have been sent
      expect(copilot.getCallCount('sendPromptAndWait')).toBe(3);
    });

    it('should allocate and release sessions', async () => {
      const sDef = makeStageDef('sd-2', [
        { label: 'P1', text: 'Go', waitForCompletion: true },
      ]);
      await stageDefRepo.create(sDef);
      const sr = makeStageRun('sr-2', 'sd-2');
      await stageRunRepo.create(sr);

      await service.executeStage(sr, 'run-1', 'per-stage');

      expect(sessionAllocator.allocateSession).toHaveBeenCalledTimes(1);
      expect(sessionAllocator.releaseSession).toHaveBeenCalledWith('sr-2');
    });

    it('should persist user messages', async () => {
      const sDef = makeStageDef('sd-3', [
        { label: 'P1', text: 'Do it', waitForCompletion: true },
      ]);
      await stageDefRepo.create(sDef);
      const sr = makeStageRun('sr-3', 'sd-3');
      await stageRunRepo.create(sr);

      await service.executeStage(sr, 'run-1', 'per-stage');

      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'user', content: expect.stringContaining('Do it') }),
      );
    });

    it('should mark stage failed on error when no retry policy', async () => {
      const sDef = makeStageDef('sd-4', [
        { label: 'Fail', text: 'crash', waitForCompletion: true },
      ]);
      await stageDefRepo.create(sDef);
      const sr = makeStageRun('sr-4', 'sd-4');
      await stageRunRepo.create(sr);

      // Make sendPromptAndWait throw
      copilot.setCannedResponses([]);
      const origMethod = copilot.sendPromptAndWait.bind(copilot);
      copilot.sendPromptAndWait = async () => { throw new Error('SDK error'); };

      await service.executeStage(sr, 'run-1', 'per-stage');

      const updated = await stageRunRepo.getById('sr-4');
      expect(updated.status).toBe('failed');
      expect(updated.error).toContain('SDK error');

      // Restore
      copilot.sendPromptAndWait = origMethod;
    });

    // ── Race: a stage settled elsewhere while this turn was finishing ──
    // (liveness monitor fails/aborts a stale stage; the aborted turn then
    // returns normally). The final completion write must re-check the row
    // and skip resurrecting it if it already landed on a terminal status.

    it('should not resurrect a stage already failed elsewhere before the final completed write', async () => {
      const sDef = makeStageDef('sd-race-1', [
        { label: 'P1', text: 'Do work', waitForCompletion: true },
      ]);
      await stageDefRepo.create(sDef);
      const sr = makeStageRun('sr-race-1', 'sd-race-1');
      await stageRunRepo.create(sr);

      // The mid-loop pause/cancel check (before the prompt runs) must still
      // see 'running' so the stage actually executes; only the final settled
      // check — read right before the completed write — should observe that
      // the liveness monitor has since failed the row.
      let getByIdCalls = 0;
      const originalGetById = stageRunRepo.getById.bind(stageRunRepo);
      vi.spyOn(stageRunRepo, 'getById').mockImplementation(async (id: string) => {
        getByIdCalls += 1;
        const real = await originalGetById(id);
        if (getByIdCalls > 1) {
          return { ...real, status: 'failed' as const, error: 'stale heartbeat' };
        }
        return real;
      });

      const updateSpy = vi.spyOn(stageRunRepo, 'update');
      const emitSpy = vi.spyOn(eventBus, 'emit');

      await service.executeStage(sr, 'run-1', 'per-stage');

      expect(updateSpy).not.toHaveBeenCalledWith(
        'sr-race-1',
        expect.objectContaining({ status: 'completed' }),
      );
      expect(emitSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ kind: 'stage_run.completed' }),
      );
    });

    it('should still mark the stage completed when it is still running at the final check (control)', async () => {
      const sDef = makeStageDef('sd-race-2', [
        { label: 'P1', text: 'Do work', waitForCompletion: true },
      ]);
      await stageDefRepo.create(sDef);
      const sr = makeStageRun('sr-race-2', 'sd-race-2');
      await stageRunRepo.create(sr);

      // Same plumbing as above, but the row is still 'running' at the final
      // settled check — completion must proceed as before.
      const originalGetById = stageRunRepo.getById.bind(stageRunRepo);
      vi.spyOn(stageRunRepo, 'getById').mockImplementation(async (id: string) => {
        return originalGetById(id);
      });

      const updateSpy = vi.spyOn(stageRunRepo, 'update');
      const emitSpy = vi.spyOn(eventBus, 'emit');

      await service.executeStage(sr, 'run-1', 'per-stage');

      const updated = await originalGetById('sr-race-2');
      expect(updated.status).toBe('completed');
      expect(updateSpy).toHaveBeenCalledWith(
        'sr-race-2',
        expect.objectContaining({ status: 'completed' }),
      );
      expect(emitSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ kind: 'stage_run.completed' }),
      );
    });
  });

  // ── pauseStage ──

  describe('pauseStage', () => {
    it('should transition running stage to paused', async () => {
      const sDef = makeStageDef('sd-p', [{ label: 'P', text: 'x', waitForCompletion: true }]);
      await stageDefRepo.create(sDef);
      const sr = makeStageRun('sr-p', 'sd-p', 'running');
      sr.sessionId = 'ses-1';
      await stageRunRepo.create(sr);

      await service.pauseStage('sr-p');
      const updated = await stageRunRepo.getById('sr-p');
      expect(updated.status).toBe('paused');
    });

    it('should no-op if stage is not running', async () => {
      const sDef = makeStageDef('sd-p2', [{ label: 'P', text: 'x', waitForCompletion: true }]);
      await stageDefRepo.create(sDef);
      const sr = makeStageRun('sr-p2', 'sd-p2', 'completed');
      await stageRunRepo.create(sr);

      await service.pauseStage('sr-p2');
      const updated = await stageRunRepo.getById('sr-p2');
      expect(updated.status).toBe('completed'); // unchanged
    });
  });

  // ── cancelStage ──

  describe('cancelStage', () => {
    it('should transition running stage to cancelled', async () => {
      const sDef = makeStageDef('sd-c', [{ label: 'P', text: 'x', waitForCompletion: true }]);
      await stageDefRepo.create(sDef);
      const sr = makeStageRun('sr-c', 'sd-c', 'running');
      sr.sessionId = 'ses-1';
      await stageRunRepo.create(sr);

      await service.cancelStage('sr-c');
      const updated = await stageRunRepo.getById('sr-c');
      expect(updated.status).toBe('cancelled');
    });

    it('should no-op for already-terminal stages', async () => {
      const sDef = makeStageDef('sd-c2', [{ label: 'P', text: 'x', waitForCompletion: true }]);
      await stageDefRepo.create(sDef);
      const sr = makeStageRun('sr-c2', 'sd-c2', 'completed');
      await stageRunRepo.create(sr);

      await service.cancelStage('sr-c2');
      const updated = await stageRunRepo.getById('sr-c2');
      expect(updated.status).toBe('completed');
    });

    it('should release session on cancel', async () => {
      const sDef = makeStageDef('sd-c3', [{ label: 'P', text: 'x', waitForCompletion: true }]);
      await stageDefRepo.create(sDef);
      const sr = makeStageRun('sr-c3', 'sd-c3', 'running');
      sr.sessionId = 'ses-1';
      await stageRunRepo.create(sr);

      await service.cancelStage('sr-c3');
      expect(sessionAllocator.releaseSession).toHaveBeenCalledWith('sr-c3');
    });
  });
});

