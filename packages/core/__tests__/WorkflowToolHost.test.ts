// The workflow tool handler's own limits (P06): who a chat acts for, the
// permission ceiling of stages and external callers, and the caps under
// parallel calls.
import { afterEach, describe, expect, it } from 'vitest';
import { WorkflowToolHost } from '../src/tools/workflows/WorkflowToolHost.js';
import { buildWorkflowToolSet, type WorkflowToolCaller } from '../src/tools/workflows/index.js';
import { checkInvocationScopes } from '../src/services/workflow-invocation/validateInvocation.js';
import { getDefaultChatPermissionMode, setDefaultChatPermissionMode } from '../src/services/agentModePolicy.js';

type Captured = { req: any; ctx: any };

function makeHost(opts: { chat?: Record<string, unknown> | null; runs?: Record<string, any>; invokeDelayMs?: number } = {}) {
  const captured: Captured[] = [];
  const runs: Record<string, any> = { ...(opts.runs ?? {}) };
  const links: any[] = [];
  let n = 0;
  const host = new WorkflowToolHost({
    invocation: {
      invoke: async (req: any, ctx: any) => {
        captured.push({ req, ctx });
        checkInvocationScopes(req, ctx);
        if (ctx.budget?.remainingChildRuns === 0) throw Object.assign(new Error('no child runs left'), { code: 'BUDGET_EXHAUSTED' });
        await new Promise((r) => setTimeout(r, opts.invokeDelayMs ?? 0));
        const id = `run-new-${++n}`;
        runs[id] = { id, status: 'running', workflowDefinitionId: 'wf1', rootRunId: ctx.lineage?.rootRunId };
        return { runId: id, status: 'running', replayed: false, workflowDefinitionId: 'wf1', links: { app: 'x' }, plan: { workflowName: 'W', stages: [], codebases: [], postProcessing: [], permissionMode: 'default', risks: [], warnings: [], lineage: {} } };
      },
    } as any,
    definitions: {
      get: async () => ({ id: 'wf1', status: 'published', graph: { workflow: { name: 'W', projectId: null } } }),
      getVersion: async () => ({ graph: { stages: [{ key: 's', kind: 'agent', session: { permissionMode: 'plan' } }], workflow: {} } }),
    } as any,
    approvals: { listPending: async () => [] } as any,
    runs: {
      getById: async (id: string) => {
        if (!runs[id]) throw new Error('nf');
        return runs[id];
      },
      countDescendantsOfRoot: async (root: string) => Object.values(runs).filter((r) => r.rootRunId === root && r.id !== root).length,
    } as any,
    stageRuns: { getById: async () => ({ stageKey: 's', startedAt: new Date() }) } as any,
    chats: {
      getById: async () => {
        if (opts.chat === null) throw new Error('no chat');
        return { id: 'c1', permissionMode: 'default', ...(opts.chat ?? {}) };
      },
    } as any,
    links: { listByChat: async () => links, chatOf: async () => null, link: async (l: any) => void links.push(l) } as any,
    linker: { link: async (l: any) => void links.push({ chatId: l.chatId, runId: l.runId, toolCallId: l.toolCallId }) },
    command: async () => ({ ok: true }) as any,
  });
  const runTool = (caller: WorkflowToolCaller, turnMode?: string) =>
    buildWorkflowToolSet(host, caller, { run: true, authoring: false }, turnMode ? { turnOf: () => ({ turnId: 't', permissionMode: turnMode }) } : {}).find((t) => t.name === 'run_workflow')!;
  return { captured, runTool };
}

const CHAT: WorkflowToolCaller = { kind: 'chat', chatId: 'c1', sessionId: 's1', conversationId: 'cv', orchestrator: false };

describe('WorkflowToolHost limits', () => {
  const posture = getDefaultChatPermissionMode();
  afterEach(() => setDefaultChatPermissionMode(posture));

  it('a chat without a recorded principal runs as the local owner with the default grant; a missing chat is refused', async () => {
    const { captured, runTool } = makeHost({ chat: {} });
    const out = (await runTool(CHAT).handler({ workflowId: 'wf1', reason: 'r' }, { toolCallId: 'tc1' })) as any;
    expect(out.runId).toBe('run-new-1');
    expect(captured[0]!.ctx.principal.kind).toBe('local');
    expect(captured[0]!.ctx.principal.scopes).toEqual(expect.arrayContaining(['exec:agent', 'read:workflows']));
    expect(captured[0]!.ctx.principal.scopes).not.toContain('admin:settings');

    const missing = makeHost({ chat: null });
    const refused = (await missing.runTool(CHAT).handler({ workflowId: 'wf1', reason: 'r' }, { toolCallId: 'tc2' })) as any;
    expect(refused).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(missing.captured).toHaveLength(0);
  });

  it("a stage's ceiling is its own mode, not the run's", async () => {
    const { captured, runTool } = makeHost({
      runs: { r1: { id: 'r1', status: 'running', workflowDefinitionId: 'wfP', definitionVersionId: 'v', effectivePermissionMode: 'acceptEdits', permissionMode: null, depth: 0, budget: {} } },
    });
    await runTool({ kind: 'stage', runId: 'r1', stageRunId: 'sr1', conversationId: 'cv' }, 'acceptEdits').handler({ workflowId: 'wf1', reason: 'r' }, { toolCallId: 'tc' });
    expect(captured[0]!.ctx.callerPermissionCeiling).toBe('plan');
  });

  it('an external caller without admin:settings is capped at acceptEdits', async () => {
    setDefaultChatPermissionMode('bypassPermissions');
    const { captured, runTool } = makeHost();
    const mcp: WorkflowToolCaller = { kind: 'external', principal: { kind: 'device', id: 'dev-mcp', scopes: ['read:workflows', 'exec:agent'] }, via: 'mcp', loopback: true };
    await runTool(mcp).handler({ workflowId: 'wf1', reason: 'r', permissionMode: 'bypassPermissions' }, { toolCallId: 'k1' });
    expect(captured[0]!.ctx.callerPermissionCeiling).toBe('acceptEdits');
  });

  it('parallel calls cannot pass the per-chat cap or the run tree cap', async () => {
    const chat = makeHost({ chat: { createdByPrincipal: { kind: 'device', id: 'd', scopes: ['exec:agent', 'read:workflows'] } }, invokeDelayMs: 10 });
    const outs = (await Promise.all([1, 2, 3, 4, 5].map((i) => chat.runTool(CHAT).handler({ workflowId: 'wf1', reason: 'r' }, { toolCallId: `p${i}` })))) as any[];
    expect(outs.filter((o) => o.runId)).toHaveLength(3);
    expect(outs.filter((o) => o.code === 'CONCURRENCY_LIMIT')).toHaveLength(2);

    const tree = makeHost({
      runs: { r1: { id: 'r1', status: 'running', workflowDefinitionId: 'wfP', definitionVersionId: 'v', permissionMode: 'acceptEdits', depth: 0, budget: { maxChildRuns: 2 } } },
      invokeDelayMs: 10,
    });
    const stage: WorkflowToolCaller = { kind: 'stage', runId: 'r1', stageRunId: 'sr1', conversationId: 'cv' };
    const started = (await Promise.all([1, 2, 3, 4].map((i) => tree.runTool(stage).handler({ workflowId: 'wf1', reason: 'r' }, { toolCallId: `s${i}` })))) as any[];
    expect(started.filter((o) => o.runId)).toHaveLength(2);
  });
});
