// ────────────────────────────────────────────────────────────────
// GET /api/harness/providers must not block on a cold provider probe.
//
// Found at runtime, not by any suite: for ~22 s after every server restart the
// chat composer could not be typed into. `ChatInput` holds a skeleton while
// `useModels()` is pending (`ChatInput.tsx` — `if (modelsPending) return
// <ChatInputSkeleton />`), and `useModels` is backed by this route.
//
// The route awaited `harnessRegistry.refresh(false)`. That reads as "cached",
// but the freshness window is 5 minutes and `loadDiskCache()` restores each
// provider's `checkedAt` from the PREVIOUS process — essentially always older
// than that. So the first request after every boot failed the freshness check
// and blocked on a full cold probe, which spawns each provider's CLI.
//
// The registry already had everything needed to avoid this: `getStatuses()` is
// a synchronous read, `requestRefresh()` is fire-and-forget, and the disk
// cache exists so that "a cold boot returns stale-but-useful data instantly
// rather than blocking". The route just wasn't using it.
//
// These tests pin the contract:
//   1. With cached statuses, the route answers from the snapshot and NEVER
//      awaits a probe — even when the snapshot is stale.
//   2. It kicks off a background refresh when stale, and says `stale: true`
//      so the client can converge instead of sitting on its own cache.
//   3. `?refresh=1` still forces a real blocking re-probe (the Providers
//      settings tab's explicit refresh button depends on it).
//   4. A genuinely first-ever boot — nothing cached at all — still blocks,
//      because returning instantly would mean returning nothing.
// ────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createHarnessRoutes } from '../routes/harness.js';
import type { Container } from '../composition-root.js';

const MODEL = { id: 'sonnet', name: 'Claude Sonnet' };

function statusFor(type: string, checkedAt: number | null) {
  return {
    type,
    label: type,
    installed: true,
    connected: true,
    authenticated: true,
    ready: true,
    checkedAt: checkedAt ?? undefined,
    models: [MODEL],
  };
}

/**
 * A registry stub whose `refresh()` takes real wall-clock time, so "did the
 * route block on it?" is answerable by measuring the response rather than by
 * trusting a spy. `COLD_PROBE_MS` stands in for the ~22 s a real cold probe
 * measured; it only has to be long enough that blocking is unmistakable.
 */
const COLD_PROBE_MS = 500;

function makeRegistry(opts: { hasProbed: boolean; stale: boolean }) {
  const requestRefresh = vi.fn();
  const refresh = vi.fn(
    async () =>
      new Promise((resolve) =>
        setTimeout(() => resolve([statusFor('claude-agent', Date.now())]), COLD_PROBE_MS),
      ),
  );

  const registry = {
    primary: 'claude-agent',
    hasProbedStatuses: opts.hasProbed,
    statusesAreStale: opts.stale,
    getStatuses: () => [statusFor('claude-agent', opts.hasProbed ? Date.now() - 60 * 60_000 : null)],
    getStatusSnapshotForType: () => undefined,
    requestRefresh,
    refresh,
  };

  return { registry, requestRefresh, refresh };
}

function makeApp(registry: unknown) {
  const app = express();
  app.use(
    '/api/harness',
    createHarnessRoutes({ harnessRegistry: registry, logger: undefined } as unknown as Container),
  );
  return app;
}

describe('GET /api/harness/providers — the composer must not wait on a cold probe', () => {
  it('answers from the cached snapshot without awaiting a probe, even when stale', async () => {
    const { registry, refresh } = makeRegistry({ hasProbed: true, stale: true });

    const started = Date.now();
    const res = await request(makeApp(registry)).get('/api/harness/providers').expect(200);
    const elapsed = Date.now() - started;

    // The whole point: the response beat the probe rather than waiting for it.
    expect(elapsed).toBeLessThan(COLD_PROBE_MS);
    // Pre-fix this was called and awaited; the response could not arrive first.
    expect(refresh).not.toHaveBeenCalled();

    expect(res.body.providers).toHaveLength(1);
    expect(res.body.providers[0].models).toEqual([MODEL]);
  });

  it('starts a BACKGROUND refresh and tells the client the answer is stale', async () => {
    const { registry, requestRefresh } = makeRegistry({ hasProbed: true, stale: true });

    const res = await request(makeApp(registry)).get('/api/harness/providers').expect(200);

    expect(requestRefresh).toHaveBeenCalledTimes(1);
    // Without this the client would render the disk-cached catalog and then
    // hold it for its own 5-minute staleTime, never converging on the live one.
    expect(res.body.stale).toBe(true);
  });

  it('does not refresh, and does not report stale, when the snapshot is fresh', async () => {
    const { registry, requestRefresh, refresh } = makeRegistry({ hasProbed: true, stale: false });

    const res = await request(makeApp(registry)).get('/api/harness/providers').expect(200);

    expect(requestRefresh).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(res.body.stale).toBe(false);
  });

  it('still performs a real blocking re-probe for ?refresh=1', async () => {
    const { registry, refresh } = makeRegistry({ hasProbed: true, stale: false });

    const started = Date.now();
    await request(makeApp(registry)).get('/api/harness/providers?refresh=1').expect(200);
    const elapsed = Date.now() - started;

    // The Providers settings tab's refresh button means "go and actually look",
    // so this one is supposed to wait.
    expect(refresh).toHaveBeenCalledWith(true);
    expect(elapsed).toBeGreaterThanOrEqual(COLD_PROBE_MS - 50);
  });

  it('blocks on a genuinely first-ever boot, where there is nothing cached to serve', async () => {
    const { registry, refresh } = makeRegistry({ hasProbed: false, stale: true });

    const res = await request(makeApp(registry)).get('/api/harness/providers').expect(200);

    // Answering instantly here would mean answering with an empty catalog and
    // a composer that believes no models exist.
    expect(refresh).toHaveBeenCalled();
    expect(res.body.stale).toBe(false);
    expect(res.body.providers[0].models).toEqual([MODEL]);
  });
});
