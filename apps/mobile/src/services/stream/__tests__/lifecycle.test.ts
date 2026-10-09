import type * as ReactModule from 'react';
import type * as QueryModule from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({
  cleanup: undefined as (() => void) | undefined,
  change: undefined as ((next: string) => void) | undefined,
  invalidate: vi.fn(),
}));
vi.mock('react', async (original) => ({ ...await original<typeof ReactModule>(), useEffect: (effect: () => () => void) => { harness.cleanup = effect(); } }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: (_: string, change: (next: string) => void) => { harness.change = change; return { remove: vi.fn() }; } } }));
vi.mock('../../native/appLifecyclePolicy', () => ({ BACKGROUND_STREAM_GRACE_MS: 10_000 }));
vi.mock('@tanstack/react-query', async (original) => ({ ...await original<typeof QueryModule>(), useQueryClient: () => ({ invalidateQueries: harness.invalidate }) }));
import { focusManager, onlineManager } from '@tanstack/react-query';
import { initialAttentionState } from '@generatorai/client-core';
import { useLifecycle, resumeApp } from '../lifecycle';
import { useStreamHealth } from '../streamHealth';
const stream = () => ({ subscribe: vi.fn(), disposeAll: vi.fn(), rejectedScopes: () => [], resetRejections: vi.fn(), suspend: vi.fn(), resume: vi.fn(async () => {}), isSuspended: vi.fn(() => true) });
const attention = () => ({ getState: () => initialAttentionState(), subscribe: () => () => {}, start: vi.fn(), stop: vi.fn(), refresh: vi.fn(async () => {}) });
afterEach(() => { harness.cleanup?.(); harness.cleanup = undefined; vi.useRealTimers(); focusManager.setFocused(true); onlineManager.setOnline(true); harness.invalidate.mockClear(); });
it('cancels the Android grace period on a quick return and suspends a longer background stay', async () => {
  vi.useFakeTimers();
  const mux = stream(); const feed = attention();
  useLifecycle(mux, feed);
  await vi.advanceTimersByTimeAsync(0);
  expect(focusManager.isFocused()).toBe(true);
  harness.change?.('background');
  expect(focusManager.isFocused()).toBe(false);
  await vi.advanceTimersByTimeAsync(5000);
  harness.change?.('active');
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mux.suspend).not.toHaveBeenCalled();
  harness.change?.('background');
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mux.suspend).toHaveBeenCalledOnce();
  expect(feed.stop).toHaveBeenCalledOnce();
});
it('backs off failed resumes, declares offline, and allows manual recovery', async () => {
  vi.useFakeTimers();
  const mux = stream(); const feed = attention();
  mux.resume.mockRejectedValue(new Error('unreachable'));
  useLifecycle(mux, feed);
  await vi.runAllTimersAsync();
  expect(mux.resume).toHaveBeenCalledTimes(6);
  expect(useStreamHealth.getState().connection).toBe('offline');
  expect(onlineManager.isOnline()).toBe(false);
  mux.resume.mockImplementation(async () => { useStreamHealth.getState().setConnection('connected'); });
  resumeApp();
  await vi.advanceTimersByTimeAsync(0);
  expect(onlineManager.isOnline()).toBe(true);
  expect(focusManager.isFocused()).toBe(true);
  expect(feed.refresh).toHaveBeenCalledOnce();
});
it('a quick return with the socket still open keeps the connection state', async () => {
  vi.useFakeTimers();
  const mux = stream(); const feed = attention();
  mux.resume.mockImplementation(async () => { useStreamHealth.getState().setConnection('connected'); });
  useLifecycle(mux, feed);
  await vi.advanceTimersByTimeAsync(0);
  expect(useStreamHealth.getState().connection).toBe('connected');
  mux.isSuspended.mockReturnValue(false);
  mux.resume.mockImplementation(async () => {});
  harness.change?.('background');
  await vi.advanceTimersByTimeAsync(3000);
  harness.change?.('active');
  await vi.advanceTimersByTimeAsync(0);
  expect(mux.suspend).not.toHaveBeenCalled();
  expect(useStreamHealth.getState().connection).toBe('connected');
});
