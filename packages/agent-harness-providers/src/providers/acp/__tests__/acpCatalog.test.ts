// docs/acp ACP-4/5 — the registry catalogue: bundled snapshot first, network refresh with
// If-None-Match and an hourly throttle, an atomic disk cache read back by a new process, icons
// fetched and sanitised once per URL, and a failed refresh keeping what it had.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AcpRegistryCatalog, loadBundledSnapshot } from '../registry/catalog.js';

const INDEX = {
  version: '1.0.0',
  agents: [
    { id: 'alpha', name: 'Alpha', version: '1.0.0', description: 'a', icon: 'https://cdn.test/alpha.svg', distribution: { npx: { package: 'alpha@1.0.0' } } },
    { id: 'beta', name: 'Beta', version: '2.0.0', description: 'b', distribution: { npx: { package: 'beta@2.0.0' } } },
  ],
};
const SVG = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16z"/></svg>';

function fakeFetch(opts: { etag?: string; fail?: boolean } = {}) {
  const calls: Array<{ url: string; ifNoneMatch?: string }> = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, ...(headers['if-none-match'] ? { ifNoneMatch: headers['if-none-match'] } : {}) });
    if (opts.fail) throw new Error('offline');
    if (url.endsWith('.svg')) return new Response(SVG, { status: 200 });
    if (opts.etag && headers['if-none-match'] === opts.etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(INDEX), { status: 200, headers: opts.etag ? { etag: opts.etag } : {} });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'gai-acp-catalog-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const snapshot = async () => ({ fetchedAt: 1, registry: { version: '1.0.0', agents: [INDEX.agents[1]] }, icons: {} });

describe('AcpRegistryCatalog', () => {
  it('the bundled snapshot parses and has a mark for its agents', async () => {
    const snap = await loadBundledSnapshot();
    const catalog = new AcpRegistryCatalog({ cacheDir: dir, loadSnapshot: async () => snap });
    const state = await catalog.load();
    expect(state.source).toBe('snapshot');
    expect(state.index.agents.length).toBeGreaterThan(20);
    expect(Object.keys(state.marks).length).toBeGreaterThan(20);
    expect(state.marks['goose']?.nodes.length).toBeGreaterThan(0);
  });

  it('refreshes from the network, caches atomically, sends If-None-Match next time and throttles', async () => {
    const { impl, calls } = fakeFetch({ etag: '"v1"' });
    const catalog = new AcpRegistryCatalog({ cacheDir: dir, url: 'https://cdn.test/registry.json', fetchImpl: impl, loadSnapshot: snapshot });
    expect((await catalog.load()).index.agents.map((a) => a.id)).toEqual(['beta']);
    const fresh = await catalog.refresh();
    expect(fresh).toMatchObject({ source: 'network', etag: '"v1"' });
    expect(fresh.index.agents.map((a) => a.id)).toEqual(['alpha', 'beta']);
    expect(fresh.marks['alpha']).toEqual({ viewBox: '0 0 16 16', nodes: [{ tag: 'path', attrs: { fill: 'currentColor', d: 'M0 0h16v16z' } }] });
    expect(JSON.parse(await readFile(path.join(dir, 'registry.json'), 'utf8'))).toEqual(INDEX);

    // Within the hour nothing is asked; a forced refresh revalidates and gets a 304.
    await catalog.refresh();
    expect(calls.filter((c) => c.url.endsWith('registry.json'))).toHaveLength(1);
    const revalidated = await catalog.refresh(true);
    expect(calls.at(-1)).toEqual({ url: 'https://cdn.test/registry.json', ifNoneMatch: '"v1"' });
    expect(revalidated.source).toBe('cache');
    expect(revalidated.index.agents).toHaveLength(2);
    // The icon was fetched once.
    expect(calls.filter((c) => c.url.endsWith('.svg'))).toHaveLength(1);

    // A new process reads the cache back (no network).
    const again = new AcpRegistryCatalog({ cacheDir: dir, url: 'https://cdn.test/registry.json', fetchImpl: fakeFetch({ fail: true }).impl, loadSnapshot: snapshot });
    const loaded = await again.load();
    expect(loaded).toMatchObject({ source: 'cache', etag: '"v1"' });
    expect(loaded.marks['alpha']).toBeDefined();
    expect(again.isStale()).toBe(false);
  });

  it('a failed refresh keeps the catalogue and reports the error; a cache for another URL is ignored', async () => {
    const ok = new AcpRegistryCatalog({ cacheDir: dir, url: 'https://cdn.test/registry.json', fetchImpl: fakeFetch().impl, loadSnapshot: snapshot });
    await ok.refresh(true);
    const failing = new AcpRegistryCatalog({ cacheDir: dir, url: 'https://cdn.test/registry.json', fetchImpl: fakeFetch({ fail: true }).impl, loadSnapshot: snapshot });
    const state = await failing.refresh(true);
    expect(state.index.agents).toHaveLength(2);
    expect(state.error).toMatch(/offline/);
    const other = new AcpRegistryCatalog({ cacheDir: dir, url: 'https://mirror.test/registry.json', loadSnapshot: snapshot });
    expect((await other.load()).source).toBe('snapshot');
  });
});
