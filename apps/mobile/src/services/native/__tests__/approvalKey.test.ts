import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

import { approvalErrorCode, withPromptTimeout } from '../approvalKey';

afterEach(() => vi.useRealTimers());

describe('approval prompt timeout (MD-155)', () => {
  it('rejects with a timeout code and cancels the native prompt when it never settles', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const pending = withPromptTimeout(new Promise<string>(() => undefined), 60_000, cancel);
    const outcome = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    const error = await outcome;
    expect(cancel).toHaveBeenCalledOnce();
    expect(approvalErrorCode(error)).toBe('timeout');
  });

  it('passes a settled prompt through untouched and never cancels it', async () => {
    const cancel = vi.fn();
    await expect(withPromptTimeout(Promise.resolve('sig'), 60_000, cancel)).resolves.toBe('sig');
    await expect(withPromptTimeout(Promise.reject(Object.assign(new Error('x'), { code: 'ERR_APPROVAL_KEY_CANCELLED' })), 60_000, cancel)).rejects.toMatchObject({ code: 'ERR_APPROVAL_KEY_CANCELLED' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('maps every native code from either platform', () => {
    const code = (c: string) => approvalErrorCode({ code: c });
    expect(['ERR_APPROVAL_KEY_CANCELLED', 'ERR_APPROVAL_KEY_UNSUPPORTED', 'ERR_APPROVAL_KEY_MISSING', 'ERR_APPROVAL_KEY_INVALIDATED', 'ERR_APPROVAL_KEY_FAILED', 'ERR_APPROVAL_KEY_TIMEOUT', 'E_OTHER'].map(code)).toEqual([
      'cancelled',
      'unsupported',
      'missing',
      'invalidated',
      'failed',
      'timeout',
      'failed',
    ]);
  });
});
