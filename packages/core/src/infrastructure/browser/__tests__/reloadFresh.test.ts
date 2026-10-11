import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { reloadFresh } from '../reloadFresh.js';

function fakePage(session: { send: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> } | Error) {
  return {
    context: () => ({
      newCDPSession: vi.fn(async () => {
        if (session instanceof Error) throw session;
        return session;
      }),
    }),
    waitForEvent: vi.fn(async () => undefined),
    reload: vi.fn(async () => null),
  } as unknown as Page & { reload: ReturnType<typeof vi.fn> };
}

describe('reloadFresh', () => {
  it('reloads through CDP ignoring the cache, and detaches the session', async () => {
    const session = { send: vi.fn(async () => ({})), detach: vi.fn(async () => undefined) };
    const page = fakePage(session);
    await reloadFresh(page);
    expect(session.send).toHaveBeenCalledWith('Page.reload', { ignoreCache: true });
    expect(session.detach).toHaveBeenCalled();
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('falls back to a plain reload when no CDP session can be opened', async () => {
    const page = fakePage(new Error('proxy allows one client'));
    await reloadFresh(page);
    expect(page.reload).toHaveBeenCalledWith({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  });
});
