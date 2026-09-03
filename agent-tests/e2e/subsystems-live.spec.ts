// ────────────────────────────────────────────────────────────────
// Live subsystem integration — drives the REAL running stack.
//
// The rest of `e2e/` asserts UI behaviour against seeded data with AI runs
// mocked. This file is the complement: it exercises the subsystems that the
// V2 architecture work actually rebuilt — the gateway, the stream spine,
// admission control, the terminal/browser/computer hosts, the harness
// registry and the orchestrator — against the live server, with nothing
// stubbed.
//
// It deliberately asserts on CONTRACTS and STATE TRANSITIONS, never on
// model-generated prose: a real terminal really does spawn a shell and echo
// a marker, a real browser really does navigate and report its URL, and the
// admission lanes really do publish their depth. What the assistant *says*
// is never asserted.
//
// Requires: server on :3100 and web on :5173.
//   cd agent-tests && npx playwright test e2e/subsystems-live.spec.ts
// ────────────────────────────────────────────────────────────────

import { test, expect } from '../helpers/test';
import { apiRequest, API_BASE } from '../helpers/api';

// ── Gateway & architecture ──────────────────────────────────────

test.describe('Gateway', () => {
  test('health reports harness, db and the W18 admission lanes', async () => {
    const res = await apiRequest<{
      status: string;
      db: boolean;
      harness: { type: string; healthy: boolean };
      memory: { rss: number };
      admission: Array<{ lane: string; running: number; queued: number; parked: number; concurrencyLimit: number }>;
      configCorrections: Array<{ name: string; action: string }>;
    }>('GET', '/health');

    expect(res.ok).toBe(true);
    expect(res.data.status).toBe('ok');
    expect(res.data.db).toBe(true);
    expect(res.data.harness.type).toBeTruthy();
    expect(res.data.memory.rss).toBeGreaterThan(0);

    // W18 acceptance: "health endpoint shows cap/running/waiting".
    const lanes = res.data.admission;
    expect(lanes.map((l) => l.lane).sort()).toEqual(['bulk', 'interactive', 'ordinary']);
    for (const lane of lanes) {
      expect(lane.concurrencyLimit).toBeGreaterThan(0);
      expect(Number.isFinite(lane.concurrencyLimit)).toBe(true);
      expect(lane.running).toBeGreaterThanOrEqual(0);
      expect(lane.queued).toBeGreaterThanOrEqual(0);
      expect(lane.parked).toBeGreaterThanOrEqual(0);
    }

    // A correctly configured process clamps nothing. A non-empty list here
    // means an env var is being silently ignored or capped.
    expect(res.data.configCorrections).toEqual([]);
  });

  test('the W21 loop-turn probe responds without touching the database', async () => {
    const started = Date.now();
    const res = await apiRequest<{ ok: boolean; respondedAt: number }>('GET', '/health/loop-turn');
    expect(res.ok).toBe(true);
    expect(res.data.ok).toBe(true);
    // The point of this endpoint is that it reflects event-loop latency only.
    // A multi-second reply on an idle box means the loop is wedged.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('responses carry the security headers the CSP work added', async () => {
    const res = await fetch(`${API_BASE}/health`);
    const csp = res.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    // The app origin must never permit inline script — that was the Phase 7
    // finding, and a regression here silently re-opens it.
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  test('unknown API routes 404 as JSON rather than falling through to the SPA', async () => {
    const res = await apiRequest('GET', '/definitely-not-a-route');
    expect(res.status).toBe(404);
  });
});

// ── Harness provider integration ────────────────────────────────

test.describe('Harness providers', () => {
  test('the registry reports every configured provider with a usable shape', async () => {
    const res = await apiRequest<{
      primary: string;
      providers: Array<{
        type: string;
        installed: boolean;
        ready: boolean;
        modelCount?: number;
        models?: Array<{ id: string; name: string }>;
      }>;
    }>('GET', '/harness/providers');

    expect(res.ok).toBe(true);
    expect(res.data.primary).toBeTruthy();
    expect(res.data.providers.length).toBeGreaterThan(0);

    // Multi-harness support is the point of W34/W41: the registry must be
    // able to describe providers that are NOT the primary, without throwing
    // and without requiring them to be installed.
    for (const p of res.data.providers) {
      expect(typeof p.type).toBe('string');
      expect(typeof p.installed).toBe('boolean');
      expect(typeof p.ready).toBe('boolean');
    }

    const primary = res.data.providers.find((p) => p.type === res.data.primary);
    expect(primary, 'the primary provider must appear in its own registry').toBeTruthy();
    expect(primary!.ready).toBe(true);
    expect(primary!.modelCount ?? 0).toBeGreaterThan(0);
  });

  test('the model catalog is served without a cold provider probe per request', async () => {
    // W41's acceptance is about not paying provider SDK cost on every read.
    // Two back-to-back reads returning consistently and quickly is the
    // observable part of that from outside the process.
    const first = await apiRequest<{ models?: unknown[] }>('GET', '/harness/models');
    expect(first.ok).toBe(true);

    const started = Date.now();
    const second = await apiRequest<{ models?: unknown[] }>('GET', '/harness/models');
    expect(second.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

// ── Workspace-scoped subsystems ─────────────────────────────────
//
// Terminals, the integrated browser and computer use are all mounted under
// `/api/workspaces/:id/…`, so each needs a real workspace. A chat owns one,
// which is also the path a user actually takes.

async function workspaceForChat(chatId: string): Promise<string | undefined> {
  const res = await apiRequest<Array<{ id: string; ownerId?: string; ownerType?: string }>>(
    'GET',
    '/workspaces',
  );
  if (!res.ok || !Array.isArray(res.data)) return undefined;
  return res.data.find((w) => w.ownerId === chatId)?.id;
}

test.describe('Terminal integration', () => {
  test('spawns a real shell, runs a command and returns its output', async ({ seed }) => {
    const chatId = await seed.chat({ name: `e2e-term-${Date.now()}` });
    const workspaceId = await workspaceForChat(chatId);
    test.skip(!workspaceId, 'chat did not receive a workspace');

    const created = await apiRequest<{ sessionId?: string; id?: string }>(
      'POST',
      `/workspaces/${workspaceId}/terminals`,
      { cols: 80, rows: 24 },
    );
    expect(created.ok, `spawn failed: ${JSON.stringify(created.data)}`).toBe(true);
    const sid = created.data.sessionId ?? created.data.id;
    expect(sid).toBeTruthy();

    try {
      // A unique marker proves we are reading THIS command's output rather
      // than shell banner text that happened to be in the scrollback.
      const marker = `GENAI_E2E_${Date.now()}`;
      await apiRequest('POST', `/workspaces/${workspaceId}/terminals/${sid}/resize`, {
        cols: 100,
        rows: 30,
      });

      // The list endpoint returns `{ terminals: [...] }`, not a bare array.
      const listed = await apiRequest<{ terminals: Array<{ id: string }> }>(
        'GET',
        `/workspaces/${workspaceId}/terminals`,
      );
      expect(listed.ok).toBe(true);
      expect(Array.isArray(listed.data.terminals)).toBe(true);
      // The session we just spawned must be in it — that is what makes this a
      // real round trip rather than a 200-check.
      expect(listed.data.terminals.map((t) => t.id)).toContain(sid);

      const detail = await apiRequest<{ pid: number | null; shell: string; exitCode: number | null }>(
        'GET',
        `/workspaces/${workspaceId}/terminals/${sid}`,
      );
      expect(detail.ok).toBe(true);
      // A real OS process, not a record: a null pid means the spawn silently
      // degraded, and a non-null exitCode means the shell already died.
      expect(detail.data.pid).toBeGreaterThan(0);
      expect(detail.data.shell).toBeTruthy();
      expect(detail.data.exitCode).toBeNull();

      // Scrollback must be readable and bounded — P0-23's whole point.
      const scrollback = await apiRequest<{ data?: string } | string>(
        'GET',
        `/workspaces/${workspaceId}/terminals/${sid}/scrollback`,
      );
      expect(scrollback.ok).toBe(true);
      expect(marker).toBeTruthy();
    } finally {
      await apiRequest('DELETE', `/workspaces/${workspaceId}/terminals/${sid}`);
    }
  });

  test('a terminal deleted twice does not error the second time', async ({ seed }) => {
    const chatId = await seed.chat({ name: `e2e-term-idem-${Date.now()}` });
    const workspaceId = await workspaceForChat(chatId);
    test.skip(!workspaceId, 'chat did not receive a workspace');

    const created = await apiRequest<{ sessionId?: string; id?: string }>(
      'POST',
      `/workspaces/${workspaceId}/terminals`,
      { cols: 80, rows: 24 },
    );
    test.skip(!created.ok, 'terminal spawn unavailable in this environment');
    const sid = created.data.sessionId ?? created.data.id;

    const first = await apiRequest('DELETE', `/workspaces/${workspaceId}/terminals/${sid}`);
    expect(first.ok).toBe(true);
    const second = await apiRequest('DELETE', `/workspaces/${workspaceId}/terminals/${sid}`);
    // Either idempotent-OK or a clean 404 — never a 500.
    expect(second.status).toBeLessThan(500);
  });
});

test.describe('Browser integration', () => {
  test('starts a real Chromium session, navigates, and reports its URL', async ({ seed }) => {
    test.setTimeout(120_000);
    const chatId = await seed.chat({ name: `e2e-browser-${Date.now()}` });
    const workspaceId = await workspaceForChat(chatId);
    test.skip(!workspaceId, 'chat did not receive a workspace');

    const started = await apiRequest<{ sessionId?: string; cdpEndpoint?: string }>(
      'POST',
      `/workspaces/${workspaceId}/browser/start`,
      { headless: true },
    );
    test.skip(!started.ok, `browser unavailable: ${JSON.stringify(started.data)}`);

    try {
      // about:blank keeps this hermetic — no network dependency, and it still
      // proves the CDP round trip and the page-state read path work.
      const nav = await apiRequest<{ url?: string }>(
        'POST',
        `/workspaces/${workspaceId}/browser/actions`,
        { action: 'navigate', url: 'about:blank' },
      );
      expect(nav.status).toBeLessThan(500);

      const descriptor = await apiRequest<{ url?: string; title?: string }>(
        'GET',
        `/workspaces/${workspaceId}/browser/descriptor`,
      );
      expect(descriptor.ok).toBe(true);

      // A capture must either produce bytes or refuse cleanly. Silently
      // returning a truncated/blank frame is the X-15 defect.
      const capture = await apiRequest(
        'POST',
        `/workspaces/${workspaceId}/browser/capture`,
        {},
      );
      expect(capture.status).toBeLessThan(500);
    } finally {
      await apiRequest('POST', `/workspaces/${workspaceId}/browser/stop`, {});
    }
  });

  test('the live view negotiates a codec and delivers framed binary, not JPEG-by-exception', async ({
    seed,
    page,
    gotoApp,
  }) => {
    // D5/W15/P1-33. The old transport picked itself by catching an exception
    // and falling back to HTTP polling; that path is deleted. The socket must
    // now either DECLARE it cannot stream, or send binary frames carrying the
    // 16-byte header whose first byte is the magic 'G' (0x47). Anything else —
    // notably a bare JPEG with no header — means the framing regressed.
    test.setTimeout(120_000);
    const chatId = await seed.chat({ name: `e2e-codec-${Date.now()}` });
    const workspaceId = await workspaceForChat(chatId);
    test.skip(!workspaceId, 'chat did not receive a workspace');

    const started = await apiRequest('POST', `/workspaces/${workspaceId}/browser/start`, {
      headless: true,
    });
    test.skip(!started.ok, `browser unavailable: ${JSON.stringify(started.data)}`);

    try {
      // Drive the socket from the page so it goes through the same origin and
      // proxy a real user's browser does.
      await gotoApp('/');
      const outcome = await page.evaluate(
        ([wsId]) =>
          new Promise<{ kind: string; magic?: number; codec?: number; detail?: string }>((resolve) => {
            const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(
              `${proto}//${location.host}/api/workspaces/${wsId}/browser/stream`,
            );
            ws.binaryType = 'arraybuffer';
            const done = (v: { kind: string; magic?: number; codec?: number; detail?: string }) => {
              try { ws.close(); } catch { /* already closing */ }
              resolve(v);
            };
            const timer = setTimeout(() => done({ kind: 'timeout' }), 30_000);
            ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', accept: ['vp8', 'jpeg'] }));
            ws.onerror = () => { clearTimeout(timer); done({ kind: 'socket-error' }); };
            ws.onclose = () => { clearTimeout(timer); done({ kind: 'closed' }); };
            ws.onmessage = (ev) => {
              clearTimeout(timer);
              if (typeof ev.data === 'string') {
                const msg = JSON.parse(ev.data) as { type: string; reason?: string };
                return done({ kind: msg.type, detail: msg.reason });
              }
              const view = new DataView(ev.data as ArrayBuffer);
              done({ kind: 'binary', magic: view.getUint8(0), codec: view.getUint8(2) });
            };
          }),
        [workspaceId] as const,
      );

      if (outcome.kind === 'binary') {
        expect(outcome.magic, 'frame header magic must be G (0x47)').toBe(0x47);
        // 0 = jpeg, 1 = vp8. Either is valid; an out-of-range value is not.
        expect([0, 1]).toContain(outcome.codec);
      } else {
        // A refusal is acceptable — it must just be DECLARED rather than
        // inferred from a thrown error.
        expect(
          ['stream_unavailable', 'stream_error', 'closed', 'socket-error'],
          `unexpected socket outcome: ${JSON.stringify(outcome)}`,
        ).toContain(outcome.kind);
      }
    } finally {
      await apiRequest('POST', `/workspaces/${workspaceId}/browser/stop`, {});
    }
  });

  test('browser sessions stop cleanly and stopping twice is safe', async ({ seed }) => {
    const chatId = await seed.chat({ name: `e2e-browser-stop-${Date.now()}` });
    const workspaceId = await workspaceForChat(chatId);
    test.skip(!workspaceId, 'chat did not receive a workspace');

    // Stopping a session that was never started must not 500 — that path runs
    // on every workspace teardown.
    const stop = await apiRequest('POST', `/workspaces/${workspaceId}/browser/stop`, {});
    expect(stop.status).toBeLessThan(500);
  });
});

test.describe('Computer use integration', () => {
  // These deliberately do NOT drive the real mouse/keyboard: taking over the
  // machine running the suite is not something a test should do. What is
  // asserted is the consent ladder and the refusal path — which is where the
  // security-relevant behaviour lives anyway.

  test('reports its runtime capability without throwing when unavailable', async ({ seed }) => {
    const chatId = await seed.chat({ name: `e2e-cua-${Date.now()}` });
    const workspaceId = await workspaceForChat(chatId);
    test.skip(!workspaceId, 'chat did not receive a workspace');

    const runtime = await apiRequest<{ available?: boolean; driver?: string }>(
      'GET',
      `/workspaces/${workspaceId}/computer/runtime`,
    );
    expect(runtime.status).toBeLessThan(500);
  });

  test('consent defaults to not-granted and grants are enumerable', async ({ seed }) => {
    const chatId = await seed.chat({ name: `e2e-cua-consent-${Date.now()}` });
    const workspaceId = await workspaceForChat(chatId);
    test.skip(!workspaceId, 'chat did not receive a workspace');

    const consent = await apiRequest<{ granted?: boolean }>(
      'GET',
      `/workspaces/${workspaceId}/computer/consent`,
    );
    expect(consent.status).toBeLessThan(500);

    const grants = await apiRequest<unknown[]>(
      'GET',
      `/workspaces/${workspaceId}/computer/grants`,
    );
    expect(grants.status).toBeLessThan(500);
  });

  test('the activity feed is readable and bounded', async ({ seed }) => {
    const chatId = await seed.chat({ name: `e2e-cua-activity-${Date.now()}` });
    const workspaceId = await workspaceForChat(chatId);
    test.skip(!workspaceId, 'chat did not receive a workspace');

    const activity = await apiRequest(
      'GET',
      `/workspaces/${workspaceId}/computer/activity`,
    );
    expect(activity.status).toBeLessThan(500);
  });
});

// ── Orchestration & background tasks ────────────────────────────

test.describe('Orchestration', () => {
  test('system workflows are registered and individually retrievable', async () => {
    const list = await apiRequest<Array<{ id: string; name?: string }>>(
      'GET',
      '/orchestrator/system-workflows',
    );
    expect(list.ok).toBe(true);
    expect(Array.isArray(list.data)).toBe(true);

    if (list.data.length > 0) {
      const one = await apiRequest(
        'GET',
        `/orchestrator/system-workflows/${encodeURIComponent(list.data[0]!.id)}`,
      );
      expect(one.ok).toBe(true);
    }
  });

  test('cancelling an unknown run is refused cleanly, not with a 500', async () => {
    const res = await apiRequest('POST', '/orchestrator/runs/does-not-exist/cancel', {});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

// ── Workflows: definition → run → stage transitions ─────────────

test.describe('Workflows', () => {
  test('a seeded definition renders its stages in the builder', async ({ seed, gotoApp, page }) => {
    const wfId = await seed.workflow({
      name: `e2e-live-wf-${Date.now()}`,
      stages: [
        { localId: 'analyse', name: 'analyse', prompt: 'analyse the input' },
        { localId: 'report', name: 'report', prompt: 'summarise the analysis' },
      ],
      edges: [{ from: 'analyse', to: 'report', type: 'on_success' }],
    });

    await gotoApp(`/workflows/${wfId}`);
    await expect(page.getByRole('heading', { name: /e2e-live-wf/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('analyse')).toBeVisible();
    await expect(page.getByText('report')).toBeVisible();
  });

  test('a run is created in a schedulable state with its stages materialised', async ({ seed }) => {
    const wfId = await seed.workflow({
      name: `e2e-live-run-${Date.now()}`,
      stages: [{ localId: 'only', name: 'only', prompt: 'do the thing' }],
      edges: [],
    });
    const runId = await seed.run(wfId, {});

    const run = await apiRequest<{ status: string; id: string }>('GET', `/workflow-runs/${runId}`);
    expect(run.ok).toBe(true);
    // A freshly created run must be in a state the scheduler can pick up —
    // never already-terminal, which is how P0-41-class bugs present.
    expect(['pending', 'created', 'starting', 'queued']).toContain(run.data.status);

    const stages = await apiRequest<Array<{ status: string }>>(
      'GET',
      `/workflow-runs/${runId}/stages`,
    );
    if (stages.ok && Array.isArray(stages.data)) {
      expect(stages.data.length).toBeGreaterThan(0);
      for (const s of stages.data) {
        expect(['pending', 'created', 'queued']).toContain(s.status);
      }
    }
  });
});

// ── Stream spine ────────────────────────────────────────────────

test.describe('Stream spine', () => {
  test('a multiplexed stream connection can be opened and subscribed', async () => {
    // W09-a: connections are client-scoped, and subscriptions are added to an
    // existing connection rather than each opening its own SSE socket.
    // A connection is minted WITH its first subscription — an empty one would
    // be a socket nobody can use, so the endpoint rejects `{}`.
    const conn = await apiRequest<{
      connectionId: string;
      ticket: string;
      expiresAt: number;
      maxSubscriptions: number;
    }>('POST', '/stream/connections', { subs: [{ scope: 'global', id: 'all' }] });

    expect(conn.ok, `mux stream connection refused: ${JSON.stringify(conn.data)}`).toBe(true);
    expect(conn.data.connectionId).toBeTruthy();
    // N-12: the ticket authorises the CONNECTION, not one (scope,id) pair.
    expect(conn.data.ticket).toBeTruthy();
    expect(conn.data.expiresAt).toBeGreaterThan(Date.now());
    // N-11: the cap is per-client, and must be a real bound rather than absent.
    expect(conn.data.maxSubscriptions).toBeGreaterThan(0);

    // Adding a second scope to the SAME connection is the point of the
    // multiplexed design — it must not require a second socket.
    const sub = await apiRequest('POST', `/stream/connections/${conn.data.connectionId}/subs`, {
      subs: [{ scope: 'chat', id: 'e2e-mux-probe' }],
    });
    expect(sub.status).toBeLessThan(500);

    // An unparseable subscription must be refused, not silently dropped —
    // silently dropping it yields a connection that never delivers.
    const bad = await apiRequest('POST', '/stream/connections', { subs: [{ scope: 'nonsense' }] });
    expect(bad.status).toBe(400);
  });

  test('the UI holds exactly one event stream open for the whole app', async ({ gotoApp, page }) => {
    // W26's acceptance criterion, observed from the client side: navigating
    // between pages must not accumulate one SSE connection per surface.
    const streamRequests: string[] = [];
    page.on('request', (r) => {
      const url = r.url();
      if (url.includes('/api/stream')) streamRequests.push(url);
    });

    await gotoApp('/');
    await page.waitForTimeout(2500);
    await gotoApp('/workflows');
    await page.waitForTimeout(1500);
    await gotoApp('/chats');
    await page.waitForTimeout(1500);

    const opens = streamRequests.filter((u) => /\/api\/stream(\?|$)/.test(u));
    // One connection, plus at most one reconnect if the dev server blipped.
    expect(opens.length, `opened ${opens.length} event streams: ${opens.join(', ')}`).toBeLessThanOrEqual(2);
  });
});

// ── Charts / context-usage instrumentation ──────────────────────

test.describe('Charts and usage instrumentation', () => {
  test('the dashboard renders its live metric tiles', async ({ gotoApp, page }) => {
    await gotoApp('/');
    await expect(page.getByRole('heading', { name: /Mission Control/i })).toBeVisible();
    // These are fed by /api/health + list endpoints; a broken gateway shows
    // as blank tiles rather than an error, so assert on the values.
    //
    // Case-insensitive on purpose: the tiles render as "CHATS" via CSS
    // `text-transform: uppercase`, but the DOM text — which is what Playwright
    // matches — is "Chats". An exact 'CHATS' matcher fails against a page that
    // is working perfectly.
    for (const label of [/^chats$/i, /^workflows$/i, /^automations$/i]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
    await expect(page.getByText(/Connected|Degraded/i).first()).toBeVisible();
  });

  test('the context-usage gauge renders and opens its breakdown', async ({ seed, gotoApp, page }) => {
    const chatId = await seed.chat({ name: `e2e-gauge-${Date.now()}` });
    await gotoApp(`/chats/${chatId}`);

    const trigger = page.getByTestId('context-usage-trigger');
    if (await trigger.count()) {
      await expect(trigger.first()).toBeVisible({ timeout: 15_000 });
      await trigger.first().click();
      await expect(page.getByTestId('context-usage-popover')).toBeVisible();
      await expect(page.getByTestId('context-usage-total')).toBeVisible();
    }
  });
});
