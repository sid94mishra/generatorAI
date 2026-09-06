// ────────────────────────────────────────────────────────────────
// safeFetch — SSRF-resistant HTTP(S) client for user-supplied URLs.
//
// The previous defence (`DataSourceResolver.validateHttpUrl`) was a regex
// over the hostname STRING. It could be bypassed three independent ways:
//   1. numeric hosts (`http://2130706433/`, `0x7f000001`, `0177.0.0.1`)
//      that never look like `127.` until the socket layer decodes them;
//   2. a public URL that 30x-redirects to `http://169.254.169.254/`
//      (`fetch` follows redirects by default and nothing re-checked);
//   3. any hostname that RESOLVES to an internal address — the check
//      never did a DNS lookup, so `internal.corp.example` or an
//      attacker-controlled name pointing at 10.0.0.1 sailed through
//      (and DNS rebinding between check and connect was moot because
//      there was no check to rebind around).
//
// This module closes all three: the URL parser canonicalises numeric
// hosts, every hop's hostname is resolved FIRST and every returned
// address must be public, the socket is then PINNED to the vetted
// address (the connection cannot be re-resolved by the runtime), and
// redirects are followed manually so each hop is vetted the same way.
// Response size and total time are capped.
// ────────────────────────────────────────────────────────────────

import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns';
import * as net from 'node:net';
import type { LookupFunction } from 'node:net';

export class SsrfBlockedError extends Error {
  readonly code = 'SSRF_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Deadline for the WHOLE operation including redirects (default 30 s). */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Default 5. */
  maxRedirects?: number;
  /** Default 5 MiB. */
  maxResponseBytes?: number;
  /**
   * Development opt-in: skip the address policy entirely (loopback dev
   * servers). Never set this from user input.
   */
  allowPrivate?: boolean;
  /**
   * Hostnames (exact, case-insensitive) an operator has explicitly
   * allow-listed even though they resolve to private space, e.g. an
   * on-prem Jira. Redirect targets are NOT inherited into the allowlist.
   */
  allowedHosts?: readonly string[];
  /** DNS seam for tests. Must return every address the name resolves to. */
  lookup?: (hostname: string) => Promise<string[]>;
}

export interface SafeFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Final URL after redirects. */
  url: string;
  redirects: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);

// ── Address classification ─────────────────────────────────────

function parseIPv4(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** Expand an IPv6 literal (optionally with an embedded dotted IPv4 tail) to 8 hextets. */
function parseIPv6(ip: string): number[] | null {
  let s = ip;
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (!net.isIPv6(s)) return null;

  // Embedded IPv4 tail → two hextets.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 && missing < 1) return null;
  if (halves.length === 1 && missing !== 0) return null;
  const parts = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const out = parts.map((p) => parseInt(p || '0', 16));
  return out.length === 8 && out.every((n) => Number.isFinite(n) && n >= 0 && n <= 0xffff) ? out : null;
}

function isPrivateIPv4(o: number[]): boolean {
  const [a, b] = o as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 shared/CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0 && o[2] === 0) return true; // 192.0.0.0/24 IETF
  if (a === 192 && b === 0 && o[2] === 2) return true; // TEST-NET-1
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && o[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && o[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/**
 * True for loopback, private, link-local, metadata, multicast, unspecified,
 * documentation and any IPv6 form that EMBEDS such an IPv4 address
 * (`::ffff:127.0.0.1`, NAT64 `64:ff9b::7f00:1`, 6to4 `2002:7f00:1::`).
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPrivateIPv4(v4);
  const v6 = parseIPv6(ip);
  if (!v6) return true; // unparseable → fail closed
  const [h0, h1, h2, h3, h4, h5, h6, h7] = v6 as [number, number, number, number, number, number, number, number];
  const allZero = v6.every((h) => h === 0);
  if (allZero) return true; // ::
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0 && h7 === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && (h5 === 0xffff || h5 === 0)) {
    return isPrivateIPv4([h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff]);
  }
  // NAT64 well-known prefix 64:ff9b::/96
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return isPrivateIPv4([h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff]);
  }
  // 6to4 2002:V4ADDR::/48
  if (h0 === 0x2002) return isPrivateIPv4([h1 >> 8, h1 & 0xff, h2 >> 8, h2 & 0xff]);
  if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (h0 === 0x2001 && h1 === 0x0db8) return true; // documentation
  if (h0 === 0x0100 && h1 === 0 && h2 === 0 && h3 === 0) return true; // 100::/64 discard
  return false;
}

/** Hostname → literal IP (brackets stripped), or null when it is a DNS name. */
function literalIp(hostname: string): string | null {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return net.isIP(bare) ? bare : null;
}

/**
 * Parse + protocol/host sanity checks that need no network. The WHATWG
 * parser canonicalises decimal / hex / octal IPv4 forms to dotted quad,
 * which is what makes the literal-IP check below sound.
 */
export function parseTargetUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`URL must use http or https (got ${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError('URL must not embed credentials');
  }
  if (!url.hostname) throw new SsrfBlockedError('URL has no host');
  return url;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

/**
 * Resolve `url.hostname` and enforce the address policy on EVERY returned
 * address (a name that resolves to one public and one private address is
 * rejected — that is what a rebinding / split-horizon attack looks like).
 * Returns the address the socket will be pinned to.
 */
async function vetHost(url: URL, opts: SafeFetchOptions): Promise<{ address: string; family: 4 | 6 } | null> {
  const host = url.hostname.toLowerCase();
  const exempt = opts.allowPrivate === true
    || (opts.allowedHosts ?? []).some((h) => h.toLowerCase() === host || `[${h.toLowerCase()}]` === host);
  if (host === 'localhost' || host.endsWith('.localhost')) {
    if (!exempt) throw new SsrfBlockedError('URL targets localhost');
  }
  const literal = literalIp(url.hostname);
  if (literal) {
    if (!exempt && isPrivateAddress(literal)) {
      throw new SsrfBlockedError(`URL targets a private or internal address (${literal})`);
    }
    return { address: literal, family: net.isIPv6(literal) ? 6 : 4 };
  }
  const lookup = opts.lookup ?? defaultLookup;
  let addresses: string[];
  try {
    addresses = await lookup(url.hostname);
  } catch (err) {
    throw new SsrfBlockedError(
      `Could not resolve host ${url.hostname}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (addresses.length === 0) throw new SsrfBlockedError(`Host ${url.hostname} did not resolve to any address`);
  if (!exempt) {
    const bad = addresses.find((a) => isPrivateAddress(a));
    if (bad) {
      throw new SsrfBlockedError(
        `Host ${url.hostname} resolves to a private or internal address (${bad})`,
      );
    }
  }
  if (exempt && opts.lookup === undefined && opts.allowPrivate) {
    // Dev opt-in with real DNS: let Node resolve normally (no pinning).
    return null;
  }
  const address = addresses[0]!;
  return { address, family: net.isIPv6(address) ? 6 : 4 };
}

/** A `lookup` implementation that always answers with the vetted address. */
function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  const fn = (
    _hostname: string,
    options: unknown,
    callback: (...args: unknown[]) => void,
  ): void => {
    const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true;
    if (all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
  return fn as unknown as LookupFunction;
}

function normaliseHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

interface HopResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

function performHop(
  url: URL,
  pin: { address: string; family: 4 | 6 } | null,
  method: string,
  headers: Record<string, string>,
  body: string | Buffer | undefined,
  signal: AbortSignal,
  maxBytes: number,
): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method,
      headers,
      signal,
      ...(pin ? { lookup: pinnedLookup(pin.address, pin.family) } : {}),
    });
    req.on('error', reject);
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      let received = 0;
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBytes) {
          const err = new Error(`Response exceeds maximum size of ${maxBytes} bytes`);
          res.destroy(err);
          req.destroy(err);
          reject(err);
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: normaliseHeaders(res.headers),
          body: Buffer.concat(chunks),
        });
      });
    });
    if (body !== undefined && body.length > 0) req.write(body);
    req.end();
  });
}

/**
 * Fetch a user-supplied URL with the address policy above. Throws
 * `SsrfBlockedError` for any hop that targets private space, a plain
 * `Error` for size / time / network failures.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = opts.maxResponseBytes ?? DEFAULT_MAX_BYTES;

  const controller = new AbortController();
  const onExternalAbort = (): void => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    opts.signal.addEventListener('abort', onExternalAbort);
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let url = parseTargetUrl(rawUrl);
  let method = (opts.method ?? 'GET').toUpperCase();
  let headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;
  let body: string | Buffer | undefined = opts.body;
  let redirects = 0;

  try {
    for (;;) {
      const pin = await vetHost(url, opts);
      let hop: HopResult;
      try {
        hop = await performHop(url, pin, method, headers, body, controller.signal, maxBytes);
      } catch (err) {
        if (controller.signal.aborted) {
          throw new Error(
            timedOut ? `HTTP request timed out after ${timeoutMs}ms` : 'HTTP request aborted by caller',
          );
        }
        throw err;
      }

      const location = hop.headers['location'];
      if (REDIRECT_STATUSES.has(hop.status) && location) {
        if (redirects >= maxRedirects) {
          throw new Error(`Too many redirects (limit ${maxRedirects})`);
        }
        redirects++;
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new SsrfBlockedError(`Redirect to an invalid URL: ${location}`);
        }
        // Each hop is re-parsed (protocol / credentials / literal IP) and
        // re-resolved by `vetHost` at the top of the loop. Per fetch spec
        // semantics 303 always becomes GET; 301/302 do for non-GET/HEAD.
        next = parseTargetUrl(next.toString());
        if (hop.status === 303 || ((hop.status === 301 || hop.status === 302) && method !== 'GET' && method !== 'HEAD')) {
          method = 'GET';
          body = undefined;
          delete headers['content-type'];
          delete headers['content-length'];
        }
        if (next.origin !== url.origin) {
          // Never forward credentials across origins.
          headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.has(k)));
        }
        url = next;
        continue;
      }

      return {
        status: hop.status,
        headers: hop.headers,
        body: hop.body.toString('utf8'),
        url: url.toString(),
        redirects,
      };
    }
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort);
  }
}
