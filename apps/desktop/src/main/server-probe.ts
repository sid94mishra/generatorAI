// ────────────────────────────────────────────────────────────────
// Reachability for the server switcher (G-03), probed from main.
//
// The renderer cannot do this: the app's CSP is `connect-src 'self'` (the
// server's `csp.ts` and this shell's CSP floor, `session-hardening.ts`) and
// other servers send no CORS headers for this origin, so every server but the
// page's own showed "offline" and logged a CSP violation (P1-review P2-R6).
// Node's `fetch` in main has neither restriction. Same probe as everywhere
// else (`probeServer`, `@generatorai/client-runtime/connections`); that
// subpath has no runtime imports, so bundling it does not pull any package
// root into main (06 §3.2).
//
// P2-R40 — probeServer is called with Electron's `net.fetch`, not Node's
// global `fetch`: Node's fetch (undici) ignores the OS proxy configuration
// and applies its own certificate policy, so it can disagree with what the
// renderer's window would actually be able to load at that URL. `net.fetch`
// uses Chrome's network stack (proxy-aware, same cert policy as the window)
// and, like the DOM fetch it mirrors, supports `redirect: 'manual'` and an
// `AbortSignal` — both of which `probeServer` relies on.
// ────────────────────────────────────────────────────────────────

import { net } from 'electron';
import { probeServer } from '@generatorai/client-runtime/connections';
import type { DesktopServerEntry } from '../shared/ipc';

/** A server entry before probing, plus the identity to expect when one is known. */
export type KnownServer = Omit<DesktopServerEntry, 'status' | 'serverName' | 'latencyMs'> & {
  expectedServerId?: string;
};

/** Per-probe budget. Probes run in parallel, so this bounds the whole call. */
export const SERVER_PROBE_TIMEOUT_MS = 2500;

// Not a bound method reference: keeps `net.fetch`'s internal `this` intact
// and gives `probeServer` a plain `typeof fetch`-shaped function. `net.fetch`
// only accepts `string | Request` (not a `URL`), unlike the DOM `fetch` this
// aliases — `probeServer` always calls it with a template-string URL, but
// normalize defensively rather than assume that never changes.
const netFetch: typeof fetch = (input, init) =>
  net.fetch(input instanceof Request ? input : String(input), init);

/** Probes every entry in parallel; never throws. An entry with no URL (embedded server not started) is `offline`. */
export async function probeKnownServers(
  servers: KnownServer[],
  probe: typeof probeServer = probeServer,
): Promise<DesktopServerEntry[]> {
  return Promise.all(
    servers.map(async ({ expectedServerId, ...entry }): Promise<DesktopServerEntry> => {
      if (!entry.url) return { ...entry, status: 'offline' };
      const result = await probe(entry.url, {
        timeoutMs: SERVER_PROBE_TIMEOUT_MS,
        fetch: netFetch,
        ...(expectedServerId ? { expectedServerId } : {}),
      });
      return { ...entry, ...result };
    }),
  );
}
