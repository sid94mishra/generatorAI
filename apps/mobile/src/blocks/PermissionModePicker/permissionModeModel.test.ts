import { describe, expect, it } from 'vitest';

import { canBypass, isLoosening, isRunPermissionMode, strictness } from './permissionModeModel';

describe('run permission modes (MB-47)', () => {
  it('orders strictest first and knows loosening', () => {
    expect(strictness('plan')).toBe(0);
    expect(isLoosening('default', 'bypassPermissions')).toBe(true);
    expect(isLoosening('acceptEdits', 'plan')).toBe(false);
  });

  it('gates bypass on admin:settings and checks values', () => {
    expect(canBypass(['write:workflows'])).toBe(false);
    expect(canBypass(['admin:settings'])).toBe(true);
    expect(isRunPermissionMode('dontAsk')).toBe(false);
    expect(isRunPermissionMode('acceptEdits')).toBe(true);
  });
});
