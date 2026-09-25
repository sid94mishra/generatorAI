// WP-2.8 — the SessionComposer: one code path for chats and stages.
//
// Includes the W-19 check at composer level (P02-perm): a run's permission
// mode reaches Claude and Codex stages turn by turn and their gates park;
// a provider that never asks is refused.

import { describe, expect, it } from 'vitest';
import { AgentResolver } from '../../src/services/AgentResolver.js';
import type { HitlService } from '../../src/services/HitlService.js';
import { SessionComposer, type ComposeInput } from '../../src/services/session/SessionComposer.js';
import { StageGatePort } from '../../src/services/session/StageGatePort.js';
import { TurnContextRegistry } from '../../src/services/session/gates.js';
import type { SessionComposerDeps, SessionOwner } from '../../src/services/session/types.js';
import type { ComputerService } from '../../src/services/ComputerService.js';
import type { WorkspaceManager } from '../../src/services/WorkspaceManager.js';
import type { EventBus } from '../../src/events/EventBus.js';
import type { PermissionRequest } from '../../src/domain/ports/IAgentHarness.js';
import { CustomToolRegistry } from '../../src/tools/CustomToolRegistry.js';
import { spyHarness } from './boot.js';

const stage: SessionOwner = {
  kind: 'stage',
  stageRunId: 'sr-1',
  workflowRunId: 'run-1',
  workflowDefinitionId: 'def-1',
  sessionId: 'sess-1',
};

const eventBus = { emit: async () => undefined, emitGlobal: async () => undefined } as unknown as EventBus;

function fakeHitl(parked: Array<{ stageRunId: string; kind: string }>): HitlService {
  return {
    interrupt: async (stageRunId: string, _run: string, data: { kind: string }) => {
      parked.push({ stageRunId, kind: data.kind });
      return { outcome: 'approved' };
    },
  } as unknown as HitlService;
}

function composer(deps: SessionComposerDeps = {}): SessionComposer {
  return new SessionComposer(deps, spyHarness(), new TurnContextRegistry());
}

function stageInput(over: Partial<ComposeInput> & { mode?: string; parked?: Array<{ stageRunId: string; kind: string }> } = {}): ComposeInput {
  const { mode, parked = [], ...rest } = over;
  return {
    owner: stage,
    conversationId: 'conv-1',
    mode: 'create',
    spec: {},
    attended: true,
    gates: new StageGatePort({
      hitl: fakeHitl(parked),
      eventBus,
      harnessTypeOf: () => 'claude-agent',
      readPermissionMode: async () => mode,
    }),
    permission: { source: { kind: 'run', read: async () => mode as never } },
    platform: { browser: { autoStart: true }, computerUse: 'opt_in', orchestrator: false },
    ...rest,
  };
}

const call = (params: unknown, type: PermissionRequest['type']) =>
  (params as { onPermissionRequest: (r: PermissionRequest) => Promise<{ granted: boolean }> }).onPermissionRequest({
    type,
    description: type,
  });

describe('W-19 — the run permission mode reaches Claude and Codex stages (P02-perm)', () => {
  it("claude-agent on 'default' parks on its first write tool", async () => {
    const parked: Array<{ stageRunId: string; kind: string }> = [];
    const c = composer();
    const r = await c.compose(stageInput({ spec: { harnessType: 'claude-agent' }, mode: 'default', parked }));
    const options = await r.turnOptions('auto');
    expect(options).toEqual({ agentMode: 'auto', permissionMode: 'default' });
    c.beginTurn(stage, 'conv-1', options);
    await call(r.params, 'file_write');
    expect(parked).toEqual([{ stageRunId: 'sr-1', kind: 'tool_permission' }]);
    expect(r.warnings.map((w) => w.code)).not.toContain('permission_gating_exec_and_patch');
  });

  it("codex on 'default' asks per command/patch (with the PD-17 warning) and parks on the first one", async () => {
    const parked: Array<{ stageRunId: string; kind: string }> = [];
    const c = composer();
    const r = await c.compose(stageInput({ spec: { harnessType: 'codex' }, mode: 'default', parked }));
    expect(r.warnings.map((w) => w.code)).toContain('permission_gating_exec_and_patch');
    const options = await r.turnOptions('auto');
    expect(options.permissionMode).toBe('default'); // Codex maps it to on-request approvals
    c.beginTurn(stage, 'conv-1', options);
    await call(r.params, 'shell_exec');
    expect(parked).toEqual([{ stageRunId: 'sr-1', kind: 'tool_permission' }]);
  });

  it("opencode on 'default' is refused at compose (PD-17)", async () => {
    await expect(composer().compose(stageInput({ spec: { harnessType: 'opencode' }, mode: 'default' }))).rejects.toMatchObject({
      code: 'PERMISSION_GATING_UNSUPPORTED',
    });
    await expect(composer().compose(stageInput({ spec: { harnessType: 'opencode' }, mode: 'acceptEdits' }))).resolves.toBeDefined();
  });

  it("'acceptEdits' lets edits through and parks the rest; the mode is re-read every turn", async () => {
    const parked: Array<{ stageRunId: string; kind: string }> = [];
    let mode = 'acceptEdits';
    const c = composer();
    const input = stageInput({ spec: { harnessType: 'claude-agent' }, parked });
    input.permission = { source: { kind: 'run', read: async () => mode as never } };
    const r = await c.compose(input);
    c.beginTurn(stage, 'conv-1', await r.turnOptions());
    expect(await call(r.params, 'file_write')).toEqual({ granted: true });
    await call(r.params, 'shell_exec');
    expect(parked).toHaveLength(1);
    mode = 'bypassPermissions';
    expect((await r.turnOptions()).permissionMode).toBe('bypassPermissions');
  });
});

describe('composer platform gating', () => {
  const computerService = { isEnabled: () => true } as unknown as ComputerService;
  const workspaceManager = {
    getExecutionWorkspace: async (id: string) => ({ id, rootPath: 'C:/gaiwf/tmp-ws' }),
  } as unknown as WorkspaceManager;
  const workspace = { id: 'ws-1', rootPath: 'C:/gaiwf/tmp-ws' } as never;
  const toolNames = (p: unknown) => ((p as { tools?: Array<{ name: string }> }).tools ?? []).map((t) => t.name);

  it('computer use for a stage is opt-in and refused on a bypass run (PD-5)', async () => {
    const deps = { computerService, workspaceManager };
    const off = await composer(deps).compose(stageInput({ workspace, mode: 'acceptEdits' }));
    expect(toolNames(off.params).some((n) => n.startsWith('computer'))).toBe(false);
    const on = await composer(deps).compose(stageInput({ workspace, spec: { computerUse: true }, mode: 'acceptEdits' }));
    expect(toolNames(on.params).some((n) => n.startsWith('computer'))).toBe(true);
    const bypass = await composer(deps).compose(stageInput({ workspace, spec: { computerUse: true }, mode: 'bypassPermissions' }));
    expect(toolNames(bypass.params).some((n) => n.startsWith('computer'))).toBe(false);
    expect(bypass.warnings.map((w) => w.code)).toContain('computer_use_blocked_bypass');
  });

  it('custom tools reach a stage without the extension-authoring pair; widgets obey the spec switch', async () => {
    const registry = new CustomToolRegistry();
    for (const name of ['lookup', 'write_extension', 'reload_extension']) {
      registry.register({ name, description: name, parametersSchema: {}, handler: async () => null });
    }
    const r = await composer({ customToolRegistry: registry }).compose(stageInput({ mode: 'acceptEdits' }));
    expect(toolNames(r.params)).toContain('lookup');
    expect(toolNames(r.params)).not.toContain('write_extension');
    expect(toolNames(r.params)).not.toContain('reload_extension');
  });

  it('a provider without host tools is reported, not silently stripped (C-11)', async () => {
    const registry = new CustomToolRegistry();
    registry.register({ name: 'lookup', description: 'l', parametersSchema: {}, handler: async () => null });
    const r = await composer({ customToolRegistry: registry }).compose(
      stageInput({ spec: { harnessType: 'acp' }, mode: 'acceptEdits' }),
    );
    expect(r.warnings.map((w) => w.code)).toContain('host_tools_unsupported');
  });

  it('a BYOK provider key is resolved from the secret store, and an unresolved one fails the compose', async () => {
    const provider = { name: 'p', baseUrl: 'https://api.example.com', apiKey: 'secretref:byok/openai' };
    const ok = await composer({ resolveSecretRef: async () => 'sk-real' }).compose(stageInput({ spec: { provider }, mode: 'acceptEdits' }));
    expect((ok.params as unknown as { provider: { apiKey: string } }).provider.apiKey).toBe('sk-real');
    await expect(
      composer({ resolveSecretRef: async () => null }).compose(stageInput({ spec: { provider }, mode: 'acceptEdits' })),
    ).rejects.toMatchObject({ code: 'secret_unresolved' });
  });

  it('a stage whose agent is missing fails with agent_not_found (C-12)', async () => {
    const agentResolver = {
      resolve: async () => ({ ...AgentResolver.empty(), warnings: [{ code: 'AGENT_NOT_FOUND', params: {} }] }),
    } as unknown as AgentResolver;
    await expect(
      composer({ agentResolver }).compose(stageInput({ spec: { agentRef: 'global:gone' }, mode: 'acceptEdits' })),
    ).rejects.toMatchObject({ code: 'agent_not_found' });
  });
});
