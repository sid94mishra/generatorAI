import { describe, it, expect, vi, afterEach } from 'vitest';

import { DirectTransport } from '../DirectTransport.js';

/**
 * Regression coverage for "Failed to execute 'fetch' on 'Window':
 * Illegal invocation".
 *
 * `DirectTransport` used to capture `globalThis.fetch` and store it on the
 * instance, then call it as `this.fetchImpl(...)`. Browsers implement `fetch`
 * as a method of the global object and throw when it is invoked with any
 * other receiver, so every request failed the moment the reference was
 * detached.
 *
 * It went unnoticed because the two environments that were exercised do not
 * reproduce it: React Native's `fetch` is a plain function, and unit tests
 * inject their own `fetchImpl`. Only a real browser (the Expo web build)
 * fails — where it broke device pairing outright with
 * "No reachable endpoint. Tried: loopback (Illegal invocation)".
 */

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

/** A `fetch` that throws unless its `this` is the global object, like a browser's. */
function installBrowserLikeFetch(): { calls: number } {
  const state = { calls: 0 };
  function browserFetch(this: unknown): Promise<Response> {
    if (this !== globalThis && this !== undefined) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    state.calls++;
    return Promise.resolve(new Response('{}', { status: 200 }));
  }
  // Emulate the browser's own guard: a detached call has `this === undefined`
  // in strict mode, which real implementations reject.
  const guarded = function (this: unknown, ...args: unknown[]): Promise<Response> {
    if (this === undefined) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return browserFetch.apply(this, args as []);
  };
  globalThis.fetch = guarded as unknown as typeof fetch;
  return state;
}

describe('DirectTransport fetch binding', () => {
  it('does not detach the ambient fetch from the global object', async () => {
    const state = installBrowserLikeFetch();
    const transport = new DirectTransport({ kind: 'loopback', endpoint: 'http://127.0.0.1:3100' });

    await expect(transport.fetch('/api/chats')).resolves.toBeInstanceOf(Response);
    expect(state.calls).toBe(1);
  });

  it('probes health on open() without an illegal invocation', async () => {
    installBrowserLikeFetch();
    const transport = new DirectTransport({ kind: 'loopback', endpoint: 'http://127.0.0.1:3100' });

    await expect(transport.open()).resolves.not.toThrow();
  });

  it('still prefers an explicitly injected fetch', async () => {
    installBrowserLikeFetch();
    const injected = vi.fn(async () => new Response('{}', { status: 200 }));
    const transport = new DirectTransport({
      kind: 'loopback',
      endpoint: 'http://127.0.0.1:3100',
      fetchImpl: injected as unknown as typeof fetch,
    });

    await transport.fetch('/api/chats');
    expect(injected).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when no fetch exists at all', () => {
    // @ts-expect-error — deliberately removing the global for this case.
    globalThis.fetch = undefined;
    expect(
      () => new DirectTransport({ kind: 'loopback', endpoint: 'http://127.0.0.1:3100' }),
    ).toThrow(/requires a fetch implementation/i);
  });
});
