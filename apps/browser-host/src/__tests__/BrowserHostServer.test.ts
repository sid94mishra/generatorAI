// ────────────────────────────────────────────────────────────────
// BrowserHostServer — first-ever test coverage.
//
// Spawns the REAL built `apps/browser-host` process and drives it over its
// real IPC protocol against a REAL headless Chromium (Playwright) — not a
// mock. Skips gracefully (with a clear reason) if Playwright's Chromium
// binary isn't installed in this environment, matching how other tests in
// this repo handle an optional real dependency.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import type { BrowserHostRequest, BrowserHostResponse } from '@generatorai/shared';
import { isBrowserHostResponse } from '@generatorai/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST_ENTRY = join(__dirname, '..', '..', 'dist', 'index.js');

// Determined at module-eval time (top-level await) because `describe.runIf`'s
// condition must be known synchronously when the file is collected — a
// `beforeAll` runs too late to gate which `describe` block even registers.
let chromiumAvailable = true;
try {
  const b = await chromium.launch({ headless: true });
  await b.close();
} catch {
  chromiumAvailable = false;
}

class RawBrowserHostTestClient {
  private child: ChildProcess;
  private pending = new Map<string, { resolve: (r: BrowserHostResponse) => void; reject: (e: Error) => void }>();
  /** Every notification the host pushed without being asked (frames, destroys). */
  readonly notifications: BrowserHostResponse[] = [];

  constructor(env: NodeJS.ProcessEnv = {}) {
    // See PtyHostClient.spawn()'s comment: plain `node <entry>` cannot
    // resolve `@generatorai/shared`'s workspace exports without a
    // TS-aware loader hooked in.
    this.child = fork(HOST_ENTRY, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, ...env },
    });
    this.child.on('message', (raw: unknown) => {
      if (!isBrowserHostResponse(raw)) return;
      const reqId = (raw as { reqId?: string }).reqId;
      if (reqId && this.pending.has(reqId)) {
        this.pending.get(reqId)!.resolve(raw);
        this.pending.delete(reqId);
        return;
      }
      if (!reqId) this.notifications.push(raw);
    });
  }

  /** Waits until `predicate` matches a pushed notification, or times out. */
  async waitForNotification(
    predicate: (r: BrowserHostResponse) => boolean,
    timeoutMs: number,
  ): Promise<BrowserHostResponse> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.notifications.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error('notification never arrived');
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      const handler = (raw: unknown) => {
        if (isBrowserHostResponse(raw) && raw.type === 'pong' && raw.reqId === '__ready__') {
          this.child.off('message', handler);
          resolve();
        }
      };
      this.child.on('message', handler);
    });
  }

  // Plain `Record<...>`, not `Omit<BrowserHostRequest, 'reqId'>` — `Omit` does
  // not distribute over a union, so it would collapse every discriminated
  // variant down to only the fields common to all of them (losing
  // `contextId`/`url`/`action`/etc.). Same shape `PtyHostClient.send()` uses.
  send(req: Record<string, unknown> & { type: string; reqId?: string }): Promise<BrowserHostResponse> {
    const reqId = req.reqId ?? randomUUID();
    const full = { ...req, reqId } as BrowserHostRequest;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out')), 20_000);
      this.pending.set(reqId, {
        resolve: (r) => { clearTimeout(timeout); resolve(r); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });
      this.child.send(full);
    });
  }

  kill(): void {
    this.child.kill('SIGTERM');
  }
}

describe.runIf(chromiumAvailable)('apps/browser-host — real process, real Chromium', () => {
  const clients: RawBrowserHostTestClient[] = [];

  afterEach(() => {
    for (const c of clients.splice(0)) c.kill();
  });

  function makeClient(env: NodeJS.ProcessEnv = {}): RawBrowserHostTestClient {
    const c = new RawBrowserHostTestClient(env);
    clients.push(c);
    return c;
  }

  it('responds to ping', async () => {
    const client = makeClient();
    await client.waitForReady();
    await expect(client.send({ type: 'ping' })).resolves.toMatchObject({ type: 'pong' });
  }, 15_000);

  it('creates a context, navigates a REAL headless Chromium to a data: URL, and reads back a screenshot', async () => {
    const client = makeClient();
    await client.waitForReady();
    const contextId = randomUUID();

    await expect(client.send({ type: 'create_context', contextId })).resolves.toMatchObject({ type: 'ack', ok: true });

    const navResp = await client.send({
      type: 'navigate',
      contextId,
      url: 'data:text/html,<html><body><h1 id="marker">BROWSER_HOST_TEST</h1></body></html>',
    });
    expect(navResp).toMatchObject({ type: 'ack', ok: true });

    const snap = await client.send({ type: 'snapshot', contextId, mode: 'screenshot' });
    expect(snap.type).toBe('snapshot_result');
    if (snap.type === 'snapshot_result') {
      expect(snap.format).toBe('jpeg');
      expect(snap.data.length).toBeGreaterThan(100); // real, non-trivial base64 image data
    }

    await client.send({ type: 'destroy_context', contextId });
  }, 20_000);

  it('accessibility snapshot mode returns real page structure, not a screenshot', async () => {
    const client = makeClient();
    await client.waitForReady();
    const contextId = randomUUID();
    await client.send({ type: 'create_context', contextId });
    await client.send({
      type: 'navigate',
      contextId,
      url: 'data:text/html,<html><body><button>Click me</button></body></html>',
    });

    const snap = await client.send({ type: 'snapshot', contextId, mode: 'accessibility' });
    expect(snap.type).toBe('snapshot_result');
    if (snap.type === 'snapshot_result') {
      expect(snap.format).toBe('json');
      // Tag names are uppercase DOM tagNames, not the HTML source spelling.
      // The real, meaningful assertion here is that a CHILD element shows up
      // at all — this is the exact bug this fix closed: the recursion never
      // walked children, so nothing below <body> was ever visible.
      expect(snap.data).toContain('"tag":"BUTTON"');
      expect(snap.data).toContain('Click me');
    }

    await client.send({ type: 'destroy_context', contextId });
  }, 20_000);

  it('performs a REAL click action on a page and observes its real effect', async () => {
    const client = makeClient();
    await client.waitForReady();
    const contextId = randomUUID();
    await client.send({ type: 'create_context', contextId });
    await client.send({
      type: 'navigate',
      contextId,
      // Clicking the button changes its own text — a change only the real
      // click handler, not a mocked transport, could have produced. Verified
      // via a second, real accessibility snapshot.
      url: 'data:text/html,<html><body><button id="btn" onclick="this.textContent=\'CLICKED\'">Toggle</button></body></html>',
    });

    const actionResp = await client.send({ type: 'action', contextId, action: { action: 'click', selector: '#btn' } });
    expect(actionResp).toMatchObject({ type: 'action_result', success: true });

    const snap = await client.send({ type: 'snapshot', contextId, mode: 'accessibility' });
    if (snap.type === 'snapshot_result') {
      expect(snap.data).toContain('CLICKED');
    }

    await client.send({ type: 'destroy_context', contextId });
  }, 20_000);

  it('errors on an operation against an unknown contextId', async () => {
    const client = makeClient();
    await client.waitForReady();
    const resp = await client.send({ type: 'navigate', contextId: 'does-not-exist', url: 'about:blank' });
    expect(resp).toMatchObject({ type: 'error', ok: false });
  }, 15_000);

  it('rejects creating a context with a contextId that already exists', async () => {
    const client = makeClient();
    await client.waitForReady();
    const contextId = randomUUID();
    await client.send({ type: 'create_context', contextId });
    const dup = await client.send({ type: 'create_context', contextId });
    expect(dup).toMatchObject({ type: 'error', ok: false });
    await client.send({ type: 'destroy_context', contextId });
  }, 20_000);

  // ── Idle lifecycle ────────────────────────────────────────────────────────
  //
  // The defect: `BrowserContextManager`'s idle timer called `destroy()` but the
  // server's `contexts` map was never told, so the entry outlived the context
  // forever. Ten idle contexts and `create_context` refused for the life of the
  // host, while the gateway — never sent `context_destroyed` — went on
  // addressing contexts whose Playwright handles were already closed.
  //
  // Driven with a short idle timeout because the shipped one is five minutes.

  it('announces an idle auto-close to the gateway', async () => {
    const client = makeClient({ GENERATORAI_BROWSER_HOST_IDLE_MS: '500' });
    await client.waitForReady();
    const contextId = randomUUID();
    await client.send({ type: 'create_context', contextId });

    const destroyed = await client.waitForNotification(
      (r) => r.type === 'context_destroyed' && (r as { contextId?: string }).contextId === contextId,
      15_000,
    );
    expect(destroyed.type).toBe('context_destroyed');
  }, 25_000);

  // Split into two tests on purpose. Combining them made the whole thing
  // depend on the fill loop OUTRUNNING the idle timeout: ten contexts in a
  // cold Chromium takes longer than any timeout short enough to be worth
  // waiting for, so the first context idled out mid-fill and freed the very
  // slot the cap assertion was about. The test then failed on its own setup
  // while reporting the cap as broken. Neither half below has a race:
  // the cap test cannot idle out, and the recycle test never asserts the cap.

  it('refuses an 11th context while ten are live', async () => {
    // An hour: nothing can idle out during this test, however slow the fill.
    const client = makeClient({ GENERATORAI_BROWSER_HOST_IDLE_MS: '3600000' });
    await client.waitForReady();

    // MAX_CONTEXTS is 10.
    for (let i = 0; i < 10; i++) {
      expect(await client.send({ type: 'create_context', contextId: randomUUID() }))
        .toMatchObject({ type: 'ack', ok: true });
    }
    expect(await client.send({ type: 'create_context', contextId: randomUUID() })).toMatchObject({
      type: 'error',
      ok: false,
    });
  }, 90_000);

  it('an idle auto-close frees its MAX_CONTEXTS slot instead of wedging the host', async () => {
    const client = makeClient({ GENERATORAI_BROWSER_HOST_IDLE_MS: '4000' });
    await client.waitForReady();

    // Fill the cap, tolerating a context that idles out before the fill ends:
    // whether the tenth `create_context` is refused is the OTHER test's
    // subject, and asserting it here is what made this one flaky.
    const ids = Array.from({ length: 10 }, () => randomUUID());
    for (const id of ids) {
      await client.send({ type: 'create_context', contextId: id });
    }

    // Every context that was actually created must announce its own idle
    // close — the defect was that they closed silently and never left the map.
    for (const id of ids) {
      await client.waitForNotification(
        (r) => r.type === 'context_destroyed' && (r as { contextId?: string }).contextId === id,
        20_000,
      );
    }

    // THE regression: this used to fail forever, because ten idled-out
    // contexts still occupied ten slots.
    const after = await client.send({ type: 'create_context', contextId: randomUUID() });
    expect(after).toMatchObject({ type: 'ack', ok: true });
  }, 90_000);

  it('bounds an accessibility snapshot of a very wide page', async () => {
    // A depth-10 guard says nothing about width; this JSON crosses
    // `process.send`, which serialises synchronously on the sending side.
    const client = makeClient();
    await client.waitForReady();
    const contextId = randomUUID();
    await client.send({ type: 'create_context', contextId });
    // Written out rather than generated by an inline script: the assertion is
    // about the SERIALISER's budget, and a page that failed to build its own
    // DOM would pass the size check for entirely the wrong reason.
    const wide = Array.from({ length: 6000 }, (_, i) => `<div>node ${i}</div>`).join('');
    await client.send({
      type: 'navigate',
      contextId,
      url: `data:text/html,<html><body>${wide}</body></html>`,
    });

    const snap = await client.send({ type: 'snapshot', contextId, mode: 'accessibility' });
    expect(snap.type).toBe('snapshot_result');
    if (snap.type === 'snapshot_result') {
      // Says so, rather than silently returning a partial tree the caller
      // would read as "this page has 1500 elements and none is the button".
      expect(snap.data).toContain('"clipped":true');
      expect(snap.data.length).toBeLessThan(600_000);
    }

    await client.send({ type: 'destroy_context', contextId });
  }, 30_000);

  it('destroy_context is idempotent — destroying twice does not error', async () => {
    const client = makeClient();
    await client.waitForReady();
    const contextId = randomUUID();
    await client.send({ type: 'create_context', contextId });
    await expect(client.send({ type: 'destroy_context', contextId })).resolves.toMatchObject({ type: 'ack', ok: true });
    await expect(client.send({ type: 'destroy_context', contextId })).resolves.toMatchObject({ type: 'ack', ok: true });
  }, 20_000);
});
