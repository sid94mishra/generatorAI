// WP-2.7 — PermissionModeSource, unattended defaults, PD-17 refusals.

import { afterEach, describe, expect, it } from 'vitest';
import { CreateAutomationSchema } from '@generatorai/shared';
import { getDefaultChatPermissionMode, setDefaultChatPermissionMode } from '../../src/services/agentModePolicy.js';
import {
  checkPermissionGating,
  runPermissionMode,
  runPermissionSource,
  turnOptionsFrom,
  TRIGGER_PERMISSION_MODE_KEY,
} from '../../src/services/session/permissionSource.js';
import { bootCore, type TestEnv } from './boot.js';
import { AgentResolver } from '../../src/services/AgentResolver.js';

const envs: TestEnv[] = [];
const posture = getDefaultChatPermissionMode();
afterEach(() => {
  for (const e of envs.splice(0)) e.dispose();
  setDefaultChatPermissionMode(posture);
});

describe('run permission layers (W-07, PD-18)', () => {
  it('run row → stage → workflow (under the trigger ceiling) → trigger → posture; never a bypass default', () => {
    const trigger = { [TRIGGER_PERMISSION_MODE_KEY]: 'acceptEdits' };
    expect(runPermissionMode({ permissionMode: 'plan', variables: trigger }, { permissionMode: 'default' }, { permissionMode: 'bypassPermissions' })).toBe('plan');
    expect(runPermissionMode({ variables: trigger }, { permissionMode: 'default' }, { permissionMode: 'bypassPermissions' })).toBe('default');
    // R5 — the automation's mode is a ceiling: a bypass definition cannot widen it.
    expect(runPermissionMode({ variables: trigger }, undefined, { permissionMode: 'bypassPermissions' })).toBe('acceptEdits');
    expect(runPermissionMode({ variables: {} }, undefined, { permissionMode: 'bypassPermissions' })).toBe('bypassPermissions');
    expect(runPermissionMode({ variables: trigger }, undefined, undefined)).toBe('acceptEdits');
    // Nothing declared: undefined, which the turn resolves to the posture.
    expect(runPermissionMode({ variables: {} }, undefined, undefined)).toBeUndefined();
  });

  it('the source is re-read every turn, and a NULL run resolves to the deployment posture', async () => {
    setDefaultChatPermissionMode('acceptEdits'); // an off-loopback posture
    const run: { permissionMode?: 'default' | 'bypassPermissions'; variables: Record<string, unknown> } = { variables: {} };
    const source = runPermissionSource(async () => run, undefined, undefined);
    expect(await turnOptionsFrom('auto', source)).toEqual({ agentMode: 'auto', permissionMode: 'acceptEdits' });
    run.permissionMode = 'default'; // PATCH …/permission-mode mid-run
    expect(await turnOptionsFrom('auto', source)).toEqual({ agentMode: 'auto', permissionMode: 'default' });
    // Plan mode is read-only whatever the run allows.
    run.permissionMode = 'bypassPermissions';
    expect((await turnOptionsFrom('plan', source)).permissionMode).toBe('plan');
  });

  it('an automation cannot be saved without a permission mode (PD-18)', () => {
    const base = { name: 'nightly', triggerType: 'manual', workflowIds: ['6f2e1b3c-1a2b-4c3d-8e9f-0a1b2c3d4e5f'] };
    expect(CreateAutomationSchema.safeParse(base).success).toBe(false);
    expect(CreateAutomationSchema.safeParse({ ...base, permissionMode: 'acceptEdits' }).success).toBe(true);
  });
});

describe('PD-17 — gating level vs run mode', () => {
  it('a provider that never asks refuses default and plan; Codex warns; per-call allows all', () => {
    expect(() => checkPermissionGating('opencode', 'default')).toThrow(/cannot run under the 'default'/);
    expect(() => checkPermissionGating('opencode', 'plan')).toThrow(expect.objectContaining({ code: 'PERMISSION_GATING_UNSUPPORTED' }));
    expect(checkPermissionGating('opencode', 'acceptEdits')).toEqual({});
    expect(checkPermissionGating('codex', 'default').warning?.code).toBe('permission_gating_exec_and_patch');
    expect(checkPermissionGating('codex', 'plan')).toEqual({});
    for (const mode of ['default', 'acceptEdits', 'plan', 'bypassPermissions']) {
      expect(checkPermissionGating('claude-agent', mode)).toEqual({});
    }
  });

  it('a run is refused at start when a stage provider cannot hold its mode', async () => {
    const env = bootCore();
    envs.push(env);
    const def = await env.services.workflowDefinitionService.createFromSpec(
      {
        formatVersion: 2,
        workflow: { name: 'refused', session: { harnessType: 'opencode', permissionMode: 'default' } },
        stages: [{ kind: 'agent', key: 's', name: 'Build', prompts: [{ label: 'p', text: 'x' }] }],
        edges: [],
      },
      { canEditCommands: true, status: 'published' },
    );
    const run = await env.services.workflowRunService.createRun({ workflowDefinitionId: def.id });
    await expect(env.services.workflowRunService.startRun(run.id)).rejects.toMatchObject({
      code: 'PERMISSION_GATING_UNSUPPORTED',
    });
    // The same run on accept-edits (the run row) is allowed through the check.
    const ok = await env.services.workflowRunService.createRun({ workflowDefinitionId: def.id, permissionMode: 'acceptEdits' });
    expect(await env.services.workflowRunService.getPermissionMode(ok.id)).toBe('acceptEdits');
    // R8 — and cannot be switched to a mode the provider cannot hold mid-run.
    await expect(env.services.workflowRunService.setPermissionMode(ok.id, 'default')).rejects.toMatchObject({
      code: 'PERMISSION_GATING_UNSUPPORTED',
    });
  });

  it("R8 — the bound agent's runtime harness is what the start check judges", async () => {
    const env = bootCore({
      agentResolver: {
        resolve: async () => ({ ...AgentResolver.empty(), runtime: { harnessType: 'opencode' } }),
      } as unknown as AgentResolver,
    });
    envs.push(env);
    const def = await env.services.workflowDefinitionService.createFromSpec(
      {
        formatVersion: 2,
        workflow: { name: 'agent-bound', session: { agentRef: 'global:oc', permissionMode: 'default' } },
        stages: [{ kind: 'agent', key: 's', name: 'Build', prompts: [{ label: 'p', text: 'x' }] }],
        edges: [],
      },
      { canEditCommands: true, status: 'published' },
    );
    const run = await env.services.workflowRunService.createRun({ workflowDefinitionId: def.id });
    await expect(env.services.workflowRunService.startRun(run.id)).rejects.toMatchObject({
      code: 'PERMISSION_GATING_UNSUPPORTED',
    });
  });
});

