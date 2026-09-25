// WP-2.6 — GatePort, TurnContextRegistry, the tool-policy wrapper, StageGatePort.

import { afterEach, describe, expect, it } from 'vitest';
import { DrizzleStageRunRepository } from '@generatorai/db';
import { DEFAULT_AGENT_TOOL_POLICY, type AgentToolPolicy } from '@generatorai/shared';
import type { PermissionRequest } from '../../src/domain/ports/IAgentHarness.js';
import type { HitlService } from '../../src/services/HitlService.js';
import { TurnContextRegistry, type GatePort } from '../../src/services/session/gates.js';
import { applyModeConfig } from '../../src/services/session/modeConfig.js';
import { StageGatePort } from '../../src/services/session/StageGatePort.js';
import type { SessionOwner, TurnContext } from '../../src/services/session/types.js';
import { bootCore, type TestEnv } from './boot.js';

const envs: TestEnv[] = [];
afterEach(() => {
  for (const e of envs.splice(0)) e.dispose();
});

function turn(owner: SessionOwner, over: Partial<TurnContext> = {}): TurnContext {
  return {
    owner,
    sessionId: owner.sessionId,
    turnId: 't1',
    agentMode: 'auto',
    permissionMode: 'default',
    planIds: [],
    interactionIds: [],
    nextSequence: 0,
    cardSequence: new Map(),
    ...over,
  };
}

const stageOwner = (stageRunId: string, workflowRunId = 'run-1'): SessionOwner => ({
  kind: 'stage',
  stageRunId,
  workflowRunId,
  workflowDefinitionId: 'def-1',
  sessionId: `sess-${stageRunId}`,
});

const req = (type: PermissionRequest['type']): PermissionRequest => ({ type, description: `${type} request` });

describe('mode config and the tool-policy wrapper', () => {
  it('a chat enforces the agent tool groups before its gate (W-53)', async () => {
    const turns = new TurnContextRegistry();
    const asked: string[] = [];
    const gates: GatePort = { permission: async (r) => (asked.push(r.type), { granted: true }) };
    const groups: AgentToolPolicy = { ...DEFAULT_AGENT_TOOL_POLICY, fileWrite: false };
    const cfg: Record<string, unknown> = {};
    applyModeConfig(cfg, { conversationId: 'c1', turns, gates, attended: true, groups });
    turns.set('c1', turn({ kind: 'chat', chatId: 'chat-1', sessionId: 's1' }));
    const onPermission = cfg['onPermissionRequest'] as (r: PermissionRequest) => Promise<{ granted: boolean; reason?: string }>;
    await expect(onPermission(req('file_write'))).resolves.toEqual({
      granted: false,
      reason: 'The bound agent is not allowed to write files.',
    });
    await expect(onPermission(req('shell_exec'))).resolves.toEqual({ granted: true });
    expect(asked).toEqual(['shell_exec']);
  });

  it('unattended sessions (workers) get no gates; a call with no turn in flight is denied', async () => {
    const turns = new TurnContextRegistry();
    const worker: Record<string, unknown> = {};
    applyModeConfig(worker, { conversationId: 'w', turns, gates: { permission: async () => ({ granted: true }) }, attended: false, groups: DEFAULT_AGENT_TOOL_POLICY });
    expect(worker['onPermissionRequest']).toBeUndefined();
    const cfg: Record<string, unknown> = {};
    applyModeConfig(cfg, { conversationId: 'c', turns, gates: { permission: async () => ({ granted: true }) }, attended: true, groups: DEFAULT_AGENT_TOOL_POLICY });
    await expect((cfg['onPermissionRequest'] as (r: PermissionRequest) => Promise<unknown>)(req('other'))).resolves.toMatchObject({ granted: false });
  });

  it('a gate on a shared conversation is filed against the stage whose turn is in flight', async () => {
    const turns = new TurnContextRegistry();
    const parked: string[] = [];
    const hitl = {
      interrupt: async (stageRunId: string) => {
        parked.push(stageRunId);
        return { outcome: 'approved' as const };
      },
    } as unknown as HitlService;
    const env = bootCore();
    envs.push(env);
    const port = new StageGatePort({
      hitl,
      eventBus: env.services.eventBus,
      harnessTypeOf: () => 'claude-agent',
      readPermissionMode: async () => 'default',
    });
    const cfg: Record<string, unknown> = {};
    // The conversation was created for stage A …
    applyModeConfig(cfg, { conversationId: 'shared', turns, gates: port, attended: true, groups: DEFAULT_AGENT_TOOL_POLICY });
    // … and stage B's turn is the one running on it now.
    turns.set('shared', turn(stageOwner('stage-B')));
    await (cfg['onPermissionRequest'] as (r: PermissionRequest) => Promise<unknown>)(req('shell_exec'));
    expect(parked).toEqual(['stage-B']);
  });
});

describe('StageGatePort on the durable HITL wait', () => {
  async function stageRun(env: TestEnv): Promise<{ runId: string; stageRunId: string }> {
    const def = await env.services.workflowDefinitionService.createFromSpec(
      {
        formatVersion: 2,
        workflow: { name: 'gates' },
        stages: [{ kind: 'agent', key: 's', name: 's', prompts: [{ label: 'p', text: 'x' }] }],
        edges: [],
      },
      { canEditCommands: true, status: 'published' },
    );
    const run = await env.services.workflowRunService.createRun({ workflowDefinitionId: def.id });
    const [sr] = await new DrizzleStageRunRepository(env.db).getByRunId(run.id);
    return { runId: run.id, stageRunId: sr!.id };
  }

  const portFor = (env: TestEnv) =>
    new StageGatePort({
      hitl: env.services.hitlService,
      eventBus: env.services.eventBus,
      ...(env.services.planService ? { planService: env.services.planService } : {}),
      harnessTypeOf: () => 'claude-agent',
      readPermissionMode: async () => 'default',
    });

  it('a question answered after a restart reaches the relaunched stage without asking again', async () => {
    const first = bootCore();
    envs.push(first);
    const { runId, stageRunId } = await stageRun(first);
    const owner = stageOwner(stageRunId, runId);
    const questions = [{ question: 'Which DB?', options: [{ label: 'sqlite' }, { label: 'pg' }] }];

    // The first process parks the stage on the question, then dies.
    void portFor(first).question({ questions } as never, turn(owner));
    await new Promise((r) => setTimeout(r, 50));
    expect((await new DrizzleStageRunRepository(first.db).getById(stageRunId)).status).toBe('awaiting_input');

    // A new process on the same DB: the approver answers it there.
    const second = bootCore({ db: first.db, workDir: first.workDir });
    const resumed = await second.services.hitlService.resume(stageRunId, runId, {
      outcome: 'approved',
      value: { answers: { 'Which DB?': ['sqlite'] } },
    });
    expect(resumed.ok).toBe(true);

    // The relaunched stage hits the same gate and gets the verdict, not a new wait.
    await expect(portFor(second).question({ questions } as never, turn(owner))).resolves.toEqual({
      answers: { 'Which DB?': ['sqlite'] },
    });
    second.services.automationService.shutdown();
    second.services.workflowRunService.shutdown();
    second.services.agentInteractionService?.dispose();
  });

  it('a plan review decided after a restart returns the decision to the relaunched stage', async () => {
    const first = bootCore();
    envs.push(first);
    const { runId, stageRunId } = await stageRun(first);
    const owner = stageOwner(stageRunId, runId);
    const request = { summary: 'Add a cache', planContent: '# Add a cache', actions: ['implement_interactive' as const] };
    void portFor(first).planReview(request, turn(owner, { agentMode: 'plan' }));
    await new Promise((r) => setTimeout(r, 50));
    const second = bootCore({ db: first.db, workDir: first.workDir });
    await second.services.hitlService.resume(stageRunId, runId, { outcome: 'changes_requested', value: { feedback: 'use redis' } });
    await expect(portFor(second).planReview(request, turn(owner, { agentMode: 'plan' }))).resolves.toEqual({
      approved: false,
      feedback: 'use redis',
    });
    second.services.automationService.shutdown();
    second.services.workflowRunService.shutdown();
    second.services.agentInteractionService?.dispose();
  });

  it('record_plan files a plan for a stage (T7)', async () => {
    const env = bootCore();
    envs.push(env);
    const { runId, stageRunId } = await stageRun(env);
    const events: string[] = [];
    env.services.eventBus.subscribeAll((e) => events.push(e.kind), 'test');
    const result = await portFor(env).recordPlan({ title: 'Refactor', content: '# Refactor\n\nSteps.' }, turn(stageOwner(stageRunId, runId)));
    expect(result?.planId).toBeTruthy();
    const plan = await env.services.planService!.findById(result!.planId);
    expect(plan).toMatchObject({ stageRunId, workflowRunId: runId, status: 'recorded' });
    expect(events).toContain('stage.plan.created');
  });
});
