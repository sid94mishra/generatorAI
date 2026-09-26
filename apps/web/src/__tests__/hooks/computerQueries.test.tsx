// ────────────────────────────────────────────────────────────────
// Computer consent / control hooks — the G-07 web hooks.
//
// Pinned: `useComputerDesk` stays undefined until both reads land, then folds
// the workspace-scope events (one subscription, filtered to the three kinds)
// through client-core's reducer; a resync refetches. Mutations delegate to the
// platform client: answering trims the prompt at once, set-control writes the
// new state into the cache.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComputerPendingConsent, IPlatformClient } from '@generatorai/shared';
import type { MuxHandlers } from '@/platform/muxStream.js';

const subs: Array<{ scope: string; id: string; handlers: MuxHandlers; filter?: readonly string[]; closed: boolean }> = [];
vi.mock('@/platform/muxStream.js', () => ({
  openMultiplexedStream: (scope: string, id: string, handlers: MuxHandlers, filter?: readonly string[]) => {
    const sub = { scope, id, handlers, filter, closed: false };
    subs.push(sub);
    return {
      close: () => {
        sub.closed = true;
      },
    };
  },
}));

import { PlatformContext } from '@/providers/PlatformProvider.js';
import {
  useAnswerComputerConsent,
  useComputerDesk,
  useComputerGrants,
  useRevokeComputerGrant,
  useSetComputerControl,
} from '@/hooks/computerQueries.js';
import { MockPlatformClient } from '../helpers/MockPlatformClient.js';

const WS = 'ws-1';
const PROMPT: ComputerPendingConsent = {
  requestId: 'r1',
  workspaceId: WS,
  appIdentity: 'com.example.inspector',
  appLabel: 'Queue Inspector',
  action: 'plan',
  summary: '2 actions in Queue Inspector',
  path: 'synthetic',
  plan: [{ action: 'clickPoint' }, { action: 'typeText' }],
  expiresAt: Date.now() + 60_000,
};

function setup() {
  const platform = new MockPlatformClient();
  platform.getComputerConsent.mockResolvedValue([PROMPT]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>{children}</PlatformContext.Provider>
    </QueryClientProvider>
  );
  return { platform, queryClient, wrapper };
}

function emit(kind: string, payload: unknown) {
  for (const sub of subs.filter((s) => !s.closed)) sub.handlers.onMessage?.({ data: JSON.stringify({ kind, payload }) } as never);
}

afterEach(() => {
  subs.length = 0;
});

describe('useComputerDesk', () => {
  it('reads pending + control, then follows the workspace stream', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useComputerDesk(WS), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.pending.map((p) => p.requestId)).toEqual(['r1']);
    expect(result.current.data!.control).toEqual({ workspaceId: WS, mode: 'agent', changedAt: null });
    expect(platform.getComputerConsent).toHaveBeenCalledWith(WS);

    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ scope: 'workspace', id: WS });
    expect(subs[0]!.filter).toEqual(['computer.consent_required', 'computer.consent_resolved', 'computer.control_changed']);

    act(() => emit('computer.consent_required', { ...PROMPT, requestId: 'r2', expiresAt: PROMPT.expiresAt + 1 }));
    await waitFor(() => expect(result.current.data!.pending.map((p) => p.requestId)).toEqual(['r1', 'r2']));
    act(() => emit('computer.consent_resolved', { workspaceId: WS, requestId: 'r1', decision: 'allow_once' }));
    await waitFor(() => expect(result.current.data!.pending.map((p) => p.requestId)).toEqual(['r2']));
    act(() => emit('computer.control_changed', { workspaceId: WS, mode: 'paused', previous: 'agent', changedAt: 7 }));
    await waitFor(() => expect(result.current.data!.control?.mode).toBe('paused'));
    // Another workspace's events are not ours.
    act(() => emit('computer.control_changed', { workspaceId: 'ws-2', mode: 'user', previous: 'agent', changedAt: 8 }));
    expect(result.current.data!.control?.mode).toBe('paused');
  });

  it('refetches both reads after a resync', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useComputerDesk(WS), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    act(() => subs[0]!.handlers.onResync?.('gap'));
    await waitFor(() => expect(platform.getComputerControl).toHaveBeenCalledTimes(2));
    expect(platform.getComputerConsent).toHaveBeenCalledTimes(2);
  });

  it('stays unknown without a workspace', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useComputerDesk(undefined), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(subs).toHaveLength(0);
  });
});

describe('computer mutations', () => {
  it('answers with a scope and trims the prompt at once', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => ({ desk: useComputerDesk(WS), answer: useAnswerComputerConsent(WS) }), { wrapper });
    await waitFor(() => expect(result.current.desk.data).toBeDefined());
    await act(() =>
      result.current.answer.mutateAsync({ requestId: 'r1', appIdentity: PROMPT.appIdentity, decision: 'allow_run', scope: 'app' }),
    );
    expect(platform.answerComputerConsent).toHaveBeenCalledWith(WS, {
      requestId: 'r1',
      appIdentity: PROMPT.appIdentity,
      decision: 'allow_run',
      scope: 'app',
    });
    await waitFor(() => expect(result.current.desk.data!.pending).toEqual([]));
  });

  it('pause / take over writes the new control state; grants list and revoke delegate', async () => {
    const { platform, wrapper } = setup();
    platform.listComputerGrants.mockResolvedValue([
      { appIdentity: '*', appLabel: 'Any app', decision: 'always_allow', scope: 'mutate', grantedAt: 'x', lastUsedAt: null },
    ]);
    const { result } = renderHook(
      () => ({
        desk: useComputerDesk(WS),
        control: useSetComputerControl(WS),
        grants: useComputerGrants(WS),
        revoke: useRevokeComputerGrant(WS),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.desk.data).toBeDefined());
    await act(() => result.current.control.mutateAsync('user'));
    expect(platform.setComputerControl).toHaveBeenCalledWith(WS, 'user');
    await waitFor(() => expect(result.current.desk.data!.control?.mode).toBe('user'));

    await waitFor(() => expect(result.current.grants.data?.[0]?.appIdentity).toBe('*'));
    await act(() => result.current.revoke.mutateAsync('*'));
    expect(platform.revokeComputerGrant).toHaveBeenCalledWith(WS, '*');
  });
});
