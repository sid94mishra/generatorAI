// WP-2.7 — PermissionModeSource, unattended defaults, PD-17 refusals.

import { afterEach, describe, expect, it } from 'vitest';
import { CreateAutomationSchema } from '@generatorai/shared';
import { getDefaultChatPermissionMode, setDefaultChatPermissionMode } from '../../src/services/agentModePolicy.js';
import {
  checkPermissionGating,
  runPermissionMode,
  runPermissionSource,
  turnOptionsFrom,
} from '../../src/services/session/permissionSource.js';

const posture = getDefaultChatPermissionMode();
afterEach(() => {
  setDefaultChatPermissionMode(posture);
});

describe('run permission layers (W-07, PD-18)', () => {
  it('run row → stage → workflow (under the trigger ceiling) → trigger → posture; never a bypass default', () => {
    const trigger = { triggerPermissionMode: 'acceptEdits' as const };
    expect(runPermissionMode({ permissionMode: 'plan', systemVars: trigger }, { permissionMode: 'default' }, { permissionMode: 'bypassPermissions' })).toBe('plan');
    expect(runPermissionMode({ systemVars: trigger }, { permissionMode: 'default' }, { permissionMode: 'bypassPermissions' })).toBe('default');
    // R5 — the automation's mode is a ceiling: a bypass definition cannot widen it.
    expect(runPermissionMode({ systemVars: trigger }, undefined, { permissionMode: 'bypassPermissions' })).toBe('acceptEdits');
    expect(runPermissionMode({ systemVars: {} }, undefined, { permissionMode: 'bypassPermissions' })).toBe('bypassPermissions');
    expect(runPermissionMode({ systemVars: trigger }, undefined, undefined)).toBe('acceptEdits');
    // Nothing declared: undefined, which the turn resolves to the posture.
    expect(runPermissionMode({ systemVars: {} }, undefined, undefined)).toBeUndefined();
  });

  it('the source is re-read every turn, and a NULL run resolves to the deployment posture', async () => {
    setDefaultChatPermissionMode('acceptEdits'); // an off-loopback posture
    const run: { permissionMode?: 'default' | 'bypassPermissions'; systemVars: Record<string, unknown> } = { systemVars: {} };
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
  it('per-call providers (OpenCode 2 among them) hold every mode; Codex warns', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', 'bypassPermissions']) {
      expect(checkPermissionGating('claude-agent', mode)).toEqual({});
      expect(checkPermissionGating('opencode', mode)).toEqual({});
    }
    expect(checkPermissionGating('codex', 'default').warning?.code).toBe('permission_gating_exec_and_patch');
    expect(checkPermissionGating('codex', 'plan')).toEqual({});
  });
});

