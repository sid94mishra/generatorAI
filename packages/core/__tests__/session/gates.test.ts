// WP-2.6 — GatePort, TurnContextRegistry, the tool-policy wrapper, StageGatePort.

import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_TOOL_POLICY, type AgentToolPolicy } from '@generatorai/shared';
import type { PermissionRequest } from '../../src/domain/ports/IAgentHarness.js';
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
    const park = async (t: TurnContext) => {
      parked.push(t.owner.kind === 'stage' ? t.owner.stageRunId : '');
      return { outcome: 'approved' as const };
    };
    const env = bootCore();
    envs.push(env);
    const port = new StageGatePort({
      park,
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

describe('StageGatePort on the engine park', () => {
  const ids = { runId: 'run-1', stageRunId: 'stage-1' };

  const portFor = (env: TestEnv, park = async () => ({ outcome: 'approved' as const, value: undefined as unknown })) =>
    new StageGatePort({
      park,
      eventBus: env.services.eventBus,
      ...(env.services.planService ? { planService: env.services.planService } : {}),
      harnessTypeOf: () => 'claude-agent',
      readPermissionMode: async () => 'default',
    });

  it('a question parks with its questions and returns the answers the approve command delivered', async () => {
    const env = bootCore();
    envs.push(env);
    const questions = [{ question: 'Which DB?', options: [{ label: 'sqlite' }, { label: 'pg' }] }];
    const parked: Array<Record<string, unknown>> = [];
    const port = portFor(env, async (_t: TurnContext, data: Record<string, unknown>) => {
      parked.push(data);
      return { outcome: 'approved' as const, value: { answers: { 'Which DB?': ['sqlite'] } } };
    });
    await expect(port.question({ questions } as never, turn(stageOwner(ids.stageRunId, ids.runId)))).resolves.toEqual({
      answers: { 'Which DB?': ['sqlite'] },
    });
    expect(parked[0]).toMatchObject({ kind: 'question', questions });
  });

  it('a plan review returns the reviewer decision', async () => {
    const env = bootCore();
    envs.push(env);
    const request = { summary: 'Add a cache', planContent: '# Add a cache', actions: ['implement_interactive' as const] };
    const port = portFor(env, async () => ({ outcome: 'changes_requested' as const, value: { feedback: 'use redis' }, reason: 'use redis' }));
    await expect(port.planReview(request, turn(stageOwner(ids.stageRunId, ids.runId), { agentMode: 'plan' }))).resolves.toEqual({
      approved: false,
      feedback: 'use redis',
    });
  });

  it('record_plan files a plan for a stage (T7)', async () => {
    const env = bootCore();
    envs.push(env);
    const { runId, stageRunId } = ids;
    const events: string[] = [];
    env.services.eventBus.subscribeAll((e) => events.push(e.kind), 'test');
    const result = await portFor(env).recordPlan({ title: 'Refactor', content: '# Refactor\n\nSteps.' }, turn(stageOwner(stageRunId, runId)));
    expect(result?.planId).toBeTruthy();
    const plan = await env.services.planService!.findById(result!.planId);
    expect(plan).toMatchObject({ stageRunId, workflowRunId: runId, status: 'recorded' });
    expect(events).toContain('stage.plan.created');
  });
});
