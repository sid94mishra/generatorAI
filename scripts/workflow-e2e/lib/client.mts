// ────────────────────────────────────────────────────────────────
// Authenticated API client for the isolated E2E server (P00 WP-0.3).
//
// Ported from the live-test recipe in docs/workflow-audit/evidence/
// F_live_tests.md §0. It imports the repo's own client-runtime (DPoP) and
// keeps credentials in a FILE-backed SecretSink (`CREDS`), so nothing ever
// touches ~/.generatorai. Rules the recipe learned the hard way:
//   - one creds file per concurrent process (the resume secret rotates on
//     refresh; two processes sharing a file get CREDENTIAL_SUPERSEDED);
//   - never pair two processes at the same moment (a new recovery grant
//     revokes the outstanding one).
// Credential files live under C:/gaiwf/creds/ and are never committed.
// ────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const rt = await import(pathToFileURL(path.join(REPO, 'packages', 'client-runtime', 'src', 'index.ts')).href);
const { AuthenticatedClientRuntime, SecretSinkDeviceKeyStore, SecretSinkSessionStore, parsePairingCode } = rt as any;

// The URL comes from server.mjs (E2E_PORT, default 3111), never from a
// generic env var: a stray SERVER_URL must not point the harness — and the
// pairing it performs with the local-admin token — at the developer's :3100.
import { BASE_URL, DEV_PORT } from '../server.mjs';

export const BASE: string = BASE_URL;
if (new URL(BASE).port === String(DEV_PORT)) throw new Error(`refusing to run the E2E harness against :${DEV_PORT}`);
export const DATA_DIR = process.env.E2E_DATA_DIR ?? 'C:/gaiwf/data';
const CREDS = process.env.CREDS ?? 'C:/gaiwf/creds/e2e.json';

class FileSink {
  read(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(CREDS, 'utf8'));
    } catch {
      return {};
    }
  }
  write(d: Record<string, string>) {
    fs.mkdirSync(path.dirname(CREDS), { recursive: true });
    fs.writeFileSync(CREDS, JSON.stringify(d));
  }
  async get(n: string) {
    return this.read()[n] ?? null;
  }
  async set(n: string, v: string) {
    const d = this.read();
    d[n] = v;
    this.write(d);
  }
  async remove(n: string) {
    const d = this.read();
    delete d[n];
    this.write(d);
  }
}

const sink = new FileSink();
export const runtime = new AuthenticatedClientRuntime({
  endpoint: BASE,
  keyStore: new SecretSinkDeviceKeyStore(sink),
  sessionStore: new SecretSinkSessionStore(sink),
});

/** Pair through the loopback recovery channel unless the creds file already authenticates. */
export async function ensurePaired(deviceName = 'workflow-e2e'): Promise<void> {
  const st = await runtime.initialize();
  if (st.status === 'authenticated') return;
  const tok = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'local-admin.json'), 'utf8')).token;
  const r = await fetch(`${BASE}/internal/desktop/pairing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: JSON.stringify({ deviceName }),
  });
  if (!r.ok) throw new Error(`recovery pairing failed ${r.status} ${await r.text()}`);
  const body = (await r.json()) as any;
  const consent = parsePairingCode(body.pairingUrl ?? body.pairingCode);
  await runtime.completePairing({
    endpoint: consent.endpoint,
    endpoints: consent.endpoints,
    serverId: consent.serverId,
    pairingToken: consent.pairingGrant,
    deviceName,
    platform: 'cli',
  });
}

export async function api(method: string, p: string, body?: unknown): Promise<{ status: number; body: any; ms: number }> {
  const t = Date.now();
  const res: Response = await runtime.fetch('/api' + p, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* raw */
  }
  return { status: res.status, body: parsed, ms: Date.now() - t };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Subscribe to the run SSE stream (`buildStreamUrl('run', id)`); returns collected events + stop(). */
export async function subscribeRun(runId: string) {
  const url = await runtime.buildStreamUrl('run', runId);
  const events: any[] = [];
  const ac = new AbortController();
  const t0 = Date.now();
  const done = (async () => {
    try {
      const res = await fetch(url, { signal: ac.signal, headers: { accept: 'text/event-stream' } });
      if (!res.ok || !res.body) {
        events.push({ error: `sse ${res.status} ${await res.text()}` });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev: any = { rel: Date.now() - t0 };
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) ev.event = line.slice(6).trim();
            else if (line.startsWith('id:')) ev.id = line.slice(3).trim();
            else if (line.startsWith('data:')) ev.data = (ev.data ?? '') + line.slice(5).trim();
          }
          if (ev.data) {
            try {
              ev.json = JSON.parse(ev.data);
            } catch {
              /* keep raw */
            }
          }
          events.push(ev);
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') events.push({ error: String(e) });
    }
  })();
  return {
    events,
    stop: async () => {
      ac.abort();
      await done.catch(() => {});
    },
  };
}

export interface StageSpec {
  name: string;
  prompt?: string;
  [k: string]: unknown;
}

/** Create a definition, its stages (by name) and edges (`[from, to, type?]`) through the REST API. */
export async function createWorkflow(def: Record<string, unknown>, stages: StageSpec[], edges: Array<[string, string, string?]>) {
  const d = await api('POST', '/workflow-definitions', def);
  if (d.status >= 300) throw new Error(`create def ${d.status} ${JSON.stringify(d.body)}`);
  const id = d.body.id ?? d.body.data?.id;
  const ids: Record<string, string> = {};
  let order = 0;
  for (const s of stages) {
    const { name, prompt, ...rest } = s;
    const body: any = { name, order: order++, prompts: prompt ? [{ label: name, text: prompt }] : [], ...rest };
    const r = await api('POST', `/workflow-definitions/${id}/stages`, body);
    if (r.status >= 300) throw new Error(`create stage ${name} ${r.status} ${JSON.stringify(r.body)}`);
    ids[name] = r.body.id ?? r.body.data?.id;
  }
  for (const [from, to, type] of edges) {
    const r = await api('POST', `/workflow-definitions/${id}/edges`, {
      fromStageId: ids[from],
      toStageId: ids[to],
      edgeType: type ?? 'on_success',
    });
    if (r.status >= 300) throw new Error(`edge ${from}->${to} ${r.status} ${JSON.stringify(r.body)}`);
  }
  return { id, stageIds: ids };
}

export async function createRun(defId: string, variables: Record<string, unknown> = {}): Promise<string> {
  const c = await api('POST', '/workflow-runs', { workflowDefinitionId: defId, variables });
  if (c.status >= 300) throw new Error(`create run ${c.status} ${JSON.stringify(c.body)}`);
  return (c.body.id ?? c.body.data?.id) as string;
}

export const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export async function waitRun(runId: string, timeoutMs: number, pollMs = 1000, onPoll?: (run: any, stages: any[]) => void) {
  const t = Date.now();
  let run: any;
  let stages: any[] = [];
  while (Date.now() - t < timeoutMs) {
    run = (await api('GET', `/workflow-runs/${runId}`)).body;
    run = run?.data ?? run;
    const s = (await api('GET', `/workflow-runs/${runId}/stages`)).body;
    stages = s?.data ?? s ?? [];
    onPoll?.(run, stages);
    if (TERMINAL.has(run?.status)) break;
    await sleep(pollMs);
  }
  return { run, stages, waitedMs: Date.now() - t };
}
