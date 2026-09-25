// ────────────────────────────────────────────────────────────────
// StageExecutionService Tests  (P3.16)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentResolver } from '../src/services/AgentResolver.js';
import { StageExecutionService } from '../src/services/StageExecutionService.js';
import { RunDefinitionReader } from '../src/services/definitions/RunDefinitionReader.js';
import {
  MockStageRunRepository,
  MockWorkflowDefinitionStore,
  MockWorkflowRunRepository,
  createFakeWorkspaceManager,
  createTestComposer,
  seedDefinition,
  testGraph,
} from './MockRepositories.js';
import type { HitlService } from '../src/services/HitlService.js';
import { MockCopilotPort } from './MockAgentHarness.js';
import { EventBus } from '../src/events/EventBus.js';
import type { IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { SessionAllocator } from '../src/services/SessionAllocator.js';
import type { HookExecutor } from '../src/services/HookExecutor.js';
import type { StageRun, WorkflowRun, ChatMessage, Session } from '@generatorai/shared';

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
    allocateSession: vi.fn(async (_run: string, _stage: string, _mode: string, build: (id: { sessionId: string; conversationId: string; op: 'create' }) => Promise<unknown>) => {
      await build({ sessionId: fakeSession.id, conversationId: fakeSession.conversationId!, op: 'create' });
      return fakeSession;
    }),
    releaseSession: vi.fn(async () => {}),
    rememberProviderSession: vi.fn(async () => {}),
    releaseAll: vi.fn(async () => {}),
  } as unknown as SessionAllocator;
}

function createMockHookExecutor(): HookExecutor {
  return {
    executePhase: vi.fn(async () => true),
  } as unknown as HookExecutor;
}

type Prompt = { label: string; text: string };

function makeRun(id: string, definitionId: string, versionId: string): WorkflowRun {
  return {
    id,
    workflowDefinitionId: definitionId,
    definitionVersionId: versionId,
    name: 'Run',
    status: 'running',
    sessionMode: 'per-stage',
    variables: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeStageRun(
  id: string,
  stageKey: string,
  status: StageRun['status'] = 'pending',
): StageRun {
  return {
    id,
    workflowRunId: 'run-1',
    stageKey,
    name: `SR ${stageKey}`,
    status,
    currentStep: 0,
    totalSteps: 1,
    retryCount: 0,
    version: 0,
    createdAt: new Date(),
  };
}

describe('StageExecutionService', () => {
  let service: StageExecutionService;
  let stageRunRepo: MockStageRunRepository;
  let definitionStore: MockWorkflowDefinitionStore;
  let runRepo: MockWorkflowRunRepository;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let copilot: MockCopilotPort;
  let eventBus: EventBus;
  let sessionAllocator: ReturnType<typeof createMockSessionAllocator>;
  let hookExecutor: ReturnType<typeof createMockHookExecutor>;

  beforeEach(() => {
    stageRunRepo = new MockStageRunRepository();
    definitionStore = new MockWorkflowDefinitionStore();
    runRepo = new MockWorkflowRunRepository(stageRunRepo);
    messageRepo = createMockMessageRepo();
    copilot = new MockCopilotPort();
    eventBus = new EventBus();
    sessionAllocator = createMockSessionAllocator();
    hookExecutor = createMockHookExecutor();

    service = new StageExecutionService(
      stageRunRepo,
      new RunDefinitionReader(definitionStore),
      messageRepo,
      copilot,
      eventBus,
      sessionAllocator,
      hookExecutor,
      createFakeWorkspaceManager(),
      runRepo,
      {} as HitlService,
      createTestComposer(copilot),
    );
  });

  /** Publish a one-stage definition and pin run 'run-1' to it. */
  async function seedStage(key: string, prompts: Prompt[], extra: Record<string, unknown> = {}): Promise<void> {
    const { definitionId, versionId } = await seedDefinition(definitionStore, testGraph([{ key, prompts, ...extra }]));
    await runRepo.create(makeRun('run-1', definitionId, versionId));
  }

  it('resolves stage capability additions even without a bound reusable agent', async () => {
    await seedStage('skill_stage', [{ label: 'Review', text: 'Review' }], {
      session: { agentOverrides: { addSkillIds: ['skill-a'] } },
    });
    const run = makeStageRun('skill-run', 'skill_stage');
    await stageRunRepo.create(run);
    const resolve = vi.fn(async () => AgentResolver.empty());
    service = new StageExecutionService(
      stageRunRepo,
      new RunDefinitionReader(definitionStore),
      messageRepo,
      copilot,
      eventBus,
      sessionAllocator,
      hookExecutor,
      createFakeWorkspaceManager(),
      runRepo,
      {} as HitlService,
      createTestComposer(copilot, { agentResolver: { resolve } as unknown as AgentResolver }),
    );
    await service.executeStage(run, 'run-1', 'per-stage');
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      runtimeOverrides: expect.objectContaining({ agentOverrides: { addSkillIds: ['skill-a'] } }),
      scope: 'stage',
    }));
  });

  // ── executeStage ──

  describe('executeStage', () => {
    it('persists a shorter final answer instead of longer preceding commentary', async () => {
      await copilot.createConversation({ conversationId: 'conv-1' });
      const final = 'Verified uploaded marker: PLAIN_UPLOAD_OK. The requested file was read successfully.';
      vi.spyOn(copilot, 'sendPromptAndWait').mockImplementation(async () => {
        copilot.simulateConversationEvent('conv-1', {
          kind: 'harness.message_complete', data: { content: 'I will inspect the uploaded file carefully. '.repeat(12) },
        });
        copilot.simulateConversationEvent('conv-1', { kind: 'harness.message_complete', data: { content: final } });
        copilot.simulateConversationEvent('conv-1', { kind: 'harness.idle', data: {} });
        return { content: final };
      });
      await seedStage('sd_final', [{ label: 'Read', text: 'Read the uploaded marker' }]);
      const sr = makeStageRun('sr-final', 'sd_final');
      await stageRunRepo.create(sr);
      await service.executeStage(sr, 'run-1', 'per-stage');
      const assistantMessages = vi.mocked(messageRepo.create).mock.calls.map(([m]) => m).filter(m => m.role === 'assistant');
      expect(assistantMessages.length).toBeGreaterThan(0);
      expect(assistantMessages.every(m => m.content === final)).toBe(true);
      expect((await stageRunRepo.getById(sr.id)).status).toBe('completed');
    });

    it('records a stage turn the way a chat turn is recorded (P02 WP-2.9)', async () => {
      await copilot.createConversation({ conversationId: 'conv-1' });
      vi.spyOn(copilot, 'sendPromptAndWait').mockImplementation(async () => {
        const emit = (kind: string, data: Record<string, unknown>) =>
          copilot.simulateConversationEvent('conv-1', { kind, data } as never);
        emit('harness.message_complete', { content: 'Editing the file.' });
        emit('harness.tool_start', { callId: 'c1', tool: 'edit', args: {} });
        emit('harness.tool_start', { callId: 'c1', tool: 'edit', args: { path: 'a.ts' } });
        emit('harness.tool_complete', { callId: 'c1', tool: 'edit', result: 'no', success: false, fileOp: { added: 1, removed: 0 } });
        emit('harness.message_complete', { content: 'Done.' });
        emit('harness.idle', {});
        return { content: 'Done.' };
      });
      await seedStage('sd_rec', [{ label: 'Edit', text: 'Edit a.ts' }]);
      const sr = makeStageRun('sr-rec', 'sd_rec');
      await stageRunRepo.create(sr);
      await service.executeStage(sr, 'run-1', 'per-stage');
      const [first] = vi.mocked(messageRepo.create).mock.calls.map(([m]) => m).filter((m) => m.role === 'assistant');
      expect(first).toMatchObject({ content: 'Done.', complete: true, metadata: { stageRunId: 'sr-rec' } });
      expect(first!.metadata!.turnId).toEqual(expect.any(String));
      expect(first!.metadata!.textSegments!.map((t) => t.content)).toEqual(['Editing the file.', 'Done.']);
      expect(first!.metadata!.toolCalls).toEqual([
        expect.objectContaining({ id: 'c1', args: { path: 'a.ts' }, success: false, fileOp: { added: 1, removed: 0 }, sequence: expect.any(Number) }),
      ]);
      // F-3b: the provider session handle is remembered for stages too.
      expect(sessionAllocator.rememberProviderSession).toHaveBeenCalled();
    });

    it('delivers uploaded prompt files to the harness without following symlinks', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'gai-stage-prompts-'));
      try {
        const prompts = join(dir, 'prompts');
        await mkdir(prompts);
        await writeFile(join(prompts, 'audit.md'), 'FILE_ONLY_MARKER');
        await writeFile(join(dir, 'outside.txt'), 'not uploaded');
        await symlink(join(dir, 'outside.txt'), join(prompts, 'linked.txt'));
        await symlink(prompts, join(dir, 'linked-dir'));
        await seedStage('sd_upload', [{ label: 'Read', text: 'Read audit.md' }]);
        const sr = makeStageRun('sr-upload', 'sd_upload');
        await stageRunRepo.create(sr);
        const send = vi.spyOn(copilot, 'sendPromptAndWait');
        await service.executeStage(sr, 'run-1', 'per-stage', undefined, {
          __promptDirectories: [prompts, prompts, join(dir, 'missing'), join(dir, 'linked-dir')],
        });
        expect(send).toHaveBeenCalledWith('conv-1', expect.stringContaining('Read audit.md'), [
          { type: 'file', path: join(prompts, 'audit.md'), displayName: 'audit.md' },
        ], expect.any(AbortSignal), expect.anything());
        expect((await stageRunRepo.getById(sr.id)).status).toBe('completed');
      } finally { await rm(dir, { recursive: true, force: true }); }
    });

    it('should run all prompts and mark stage completed', async () => {
      await seedStage('sd_1', [
        { label: 'P1', text: 'First prompt' },
        { label: 'P2', text: 'Second prompt' },
      ]);

      const sr = makeStageRun('sr-1', 'sd_1');
      await stageRunRepo.create(sr);

      await service.executeStage(sr, 'run-1', 'per-stage');

      // Stage run should be completed
      const updated = await stageRunRepo.getById('sr-1');
      expect(updated.status).toBe('completed');

      // Both prompts + summary generation should have been sent
      expect(copilot.getCallCount('sendPromptAndWait')).toBe(3);
    });

    it('should allocate and release sessions', async () => {
      await seedStage('sd_2', [
        { label: 'P1', text: 'Go' },
      ]);
      const sr = makeStageRun('sr-2', 'sd_2');
      await stageRunRepo.create(sr);

      await service.executeStage(sr, 'run-1', 'per-stage');

      expect(sessionAllocator.allocateSession).toHaveBeenCalledTimes(1);
      expect(sessionAllocator.releaseSession).toHaveBeenCalledWith('sr-2');
    });

    it('should persist user messages', async () => {
      await seedStage('sd_3', [
        { label: 'P1', text: 'Do it' },
      ]);
      const sr = makeStageRun('sr-3', 'sd_3');
      await stageRunRepo.create(sr);

      await service.executeStage(sr, 'run-1', 'per-stage');

      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'user', content: expect.stringContaining('Do it') }),
      );
    });

    it.each(['SDK error', 'The Codex thread entered a system error state.'])(
      'marks provider failure as failed without emitting completion: %s', async (message) => {
      await seedStage('sd_4', [
        { label: 'Fail', text: 'crash' },
      ]);
      const sr = makeStageRun('sr-4', 'sd_4');
      await stageRunRepo.create(sr);

      // Make sendPromptAndWait throw
      copilot.setCannedResponses([]);
      const origMethod = copilot.sendPromptAndWait.bind(copilot);
      copilot.sendPromptAndWait = async () => { throw new Error(message); };
      const emit = vi.spyOn(eventBus, 'emit');

      await service.executeStage(sr, 'run-1', 'per-stage');

      const updated = await stageRunRepo.getById('sr-4');
      expect(updated.status).toBe('failed');
      expect(updated.error).toContain(message);
      expect(emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: 'stage_run.failed' }));
      expect(emit).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: 'stage_run.completed' }));

      // Restore
      copilot.sendPromptAndWait = origMethod;
    });

    // ── Race: a stage settled elsewhere while this turn was finishing ──
    // (liveness monitor fails/aborts a stale stage; the aborted turn then
    // returns normally). The final completion write must re-check the row
    // and skip resurrecting it if it already landed on a terminal status.

    it('should not resurrect a stage already failed elsewhere before the final completed write', async () => {
      await seedStage('sd_race_1', [
        { label: 'P1', text: 'Do work' },
      ]);
      const sr = makeStageRun('sr-race-1', 'sd_race_1');
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
      await seedStage('sd_race_2', [
        { label: 'P1', text: 'Do work' },
      ]);
      const sr = makeStageRun('sr-race-2', 'sd_race_2');
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
      await seedStage('sd_p', [{ label: 'P', text: 'x' }]);
      const sr = makeStageRun('sr-p', 'sd_p', 'running');
      sr.sessionId = 'ses-1';
      await stageRunRepo.create(sr);

      await service.pauseStage('sr-p');
      const updated = await stageRunRepo.getById('sr-p');
      expect(updated.status).toBe('paused');
    });

    it('should no-op if stage is not running', async () => {
      await seedStage('sd_p2', [{ label: 'P', text: 'x' }]);
      const sr = makeStageRun('sr-p2', 'sd_p2', 'completed');
      await stageRunRepo.create(sr);

      await service.pauseStage('sr-p2');
      const updated = await stageRunRepo.getById('sr-p2');
      expect(updated.status).toBe('completed'); // unchanged
    });
  });

  // ── cancelStage ──

  describe('cancelStage', () => {
    it('should transition running stage to cancelled', async () => {
      await seedStage('sd_c', [{ label: 'P', text: 'x' }]);
      const sr = makeStageRun('sr-c', 'sd_c', 'running');
      sr.sessionId = 'ses-1';
      await stageRunRepo.create(sr);

      await service.cancelStage('sr-c');
      const updated = await stageRunRepo.getById('sr-c');
      expect(updated.status).toBe('cancelled');
    });

    it('should no-op for already-terminal stages', async () => {
      await seedStage('sd_c2', [{ label: 'P', text: 'x' }]);
      const sr = makeStageRun('sr-c2', 'sd_c2', 'completed');
      await stageRunRepo.create(sr);

      await service.cancelStage('sr-c2');
      const updated = await stageRunRepo.getById('sr-c2');
      expect(updated.status).toBe('completed');
    });

    it('should release session on cancel', async () => {
      await seedStage('sd_c3', [{ label: 'P', text: 'x' }]);
      const sr = makeStageRun('sr-c3', 'sd_c3', 'running');
      sr.sessionId = 'ses-1';
      await stageRunRepo.create(sr);

      await service.cancelStage('sr-c3');
      expect(sessionAllocator.releaseSession).toHaveBeenCalledWith('sr-c3');
    });
  });
});
