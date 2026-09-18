import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RUN_PERMISSION_MODE,
  RUN_PERMISSION_MODES,
  isLoosening,
  permissionModeOf,
  permissionModeTone,
} from '../components/runs/permissionMode';

describe('run permission mode', () => {
  it('lists every server-accepted mode, strictest first', () => {
    expect(RUN_PERMISSION_MODES).toEqual(['plan', 'default', 'acceptEdits', 'bypassPermissions']);
  });

  it('reads the GET response and falls back to the server default', () => {
    expect(permissionModeOf({ runId: 'r', mode: 'plan' })).toBe('plan');
    expect(permissionModeOf({ mode: 'askOnce' })).toBe(DEFAULT_RUN_PERMISSION_MODE);
    expect(permissionModeOf(null)).toBe('bypassPermissions');
  });

  it('treats fewer prompts as loosening', () => {
    expect(isLoosening('plan', 'bypassPermissions')).toBe(true);
    expect(isLoosening('default', 'acceptEdits')).toBe(true);
    expect(isLoosening('bypassPermissions', 'plan')).toBe(false);
    expect(isLoosening('default', 'default')).toBe(false);
  });

  it('only warns for auto-approve', () => {
    expect(permissionModeTone('bypassPermissions')).toBe('warning');
    expect(permissionModeTone('plan')).toBe('neutral');
  });
});
