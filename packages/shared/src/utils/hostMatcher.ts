// ────────────────────────────────────────────────────────────────
// hostMatcher — shared glob-style host matching for BrowserConfig.
// allowedHosts. One implementation used both where the enforcement
// decision is made (BrowserService, pre-navigation) and where it's
// actually enforced at the network level (bridges' page.route handlers) —
// see the "why" note on matchesAnyHostPattern for why both are needed.
// ────────────────────────────────────────────────────────────────

/** `*` matches any host. `*.example.com` matches `example.com` and any
 *  subdomain. Anything else must match exactly.
 *
 *  Both sides are lower-cased first: DNS is case-insensitive, so a user
 *  who writes `*.GitHub.com` in an allowlist means the same thing as
 *  `*.github.com`. Comparing raw would silently never match — and because
 *  an allowlist that matches nothing blocks everything, that failure mode
 *  is the confusing kind (the feature looks broken rather than strict). */
export function matchesHostPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p === '*' || p === h) return true;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".example.com"
    return h.endsWith(suffix) || h === suffix.slice(1);
  }
  return false;
}

/**
 * `patterns` empty/undefined means "allow all" (BrowserConfig's documented
 * default). Otherwise `host` must match at least one pattern.
 *
 * This is host matching ONLY. Navigation decisions go through
 * {@link isNavigationAllowed}, which also refuses non-http(s) schemes and, when
 * no allow-list is configured, the hosts that must never be reachable by
 * default (loopback, link-local, cloud metadata).
 */
export function matchesAnyHostPattern(host: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => matchesHostPattern(host, pattern));
}

/** Well-known cloud metadata endpoints — reading them hands out the host's credentials. */
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
  '100.100.100.200', // Alibaba Cloud
  'fd00:ec2::254', // AWS IMDS over IPv6
]);

/** Link-local: IPv4 169.254.0.0/16, IPv6 fe80::/10. */
export function isLinkLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) return Number(v4[1]) === 169 && Number(v4[2]) === 254;
  return /^fe[89ab][0-9a-f]:/i.test(h);
}

/** Hosts that are blocked unless an allow-list names them explicitly. */
export function isDefaultBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h.length === 0) return true;
  if (h === '0.0.0.0' || h === '::' ) return true;
  return METADATA_HOSTS.has(h) || isLoopbackHost(h) || isLinkLocalHost(h);
}

export type NavigationVerdict = { ok: true } | { ok: false; reason: string };

/**
 * The single navigation-policy decision for the integrated browser.
 *
 *  1. Only `http:` / `https:` (and `about:blank`, which is what a blocked
 *     page is replaced with) may load. `file:`, `data:`, `javascript:`,
 *     `chrome:` … are refused regardless of configuration — `file:///etc/passwd`
 *     has no host, so a host allow-list alone could never catch it.
 *  2. With an allow-list configured, the host must match an explicit pattern.
 *     A bare `*` is treated as "no list" for the purpose of step 3 — writing
 *     `*` should not silently unlock the metadata service.
 *  3. Without an allow-list every public host is reachable, but loopback,
 *     link-local and cloud-metadata hosts are blocked; naming them (e.g.
 *     `localhost`, `127.0.0.1`) in `allowedHosts` is how a user opts a local
 *     dev server in.
 */
export function isNavigationAllowed(url: string, allowedHosts: string[] | undefined): NavigationVerdict {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `not a valid URL: ${url}` };
  }
  if (parsed.protocol === 'about:' && parsed.href === 'about:blank') return { ok: true };
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `scheme "${parsed.protocol}" is not allowed; only http(s) pages may load` };
  }
  const host = parsed.hostname.toLowerCase();
  const patterns = (allowedHosts ?? []).filter((p) => p.trim().length > 0);
  const explicit = patterns.filter((p) => p.trim() !== '*');
  if (explicit.some((p) => matchesHostPattern(host, p))) return { ok: true };
  if (explicit.length > 0) {
    return { ok: false, reason: `host "${host}" is not in browserConfig.allowedHosts` };
  }
  if (isDefaultBlockedHost(host)) {
    return {
      ok: false,
      reason:
        `host "${host}" is loopback, link-local or a cloud metadata endpoint and is blocked by default; ` +
        'add it to browserConfig.allowedHosts to allow it',
    };
  }
  return { ok: true };
}

/**
 * True for hosts that never leave the machine: `localhost`, the IPv4
 * loopback block (`127.0.0.0/8`) and IPv6 `::1`. Used to scope the
 * self-signed-certificate exemption to a developer's own dev server —
 * accepting a bad cert is only defensible when the traffic cannot have
 * been intercepted in transit, which is exactly the loopback case.
 *
 * Accepts a bare host, a `host:port`, or a full URL.
 */
export function isLoopbackHost(hostOrUrl: string): boolean {
  let host = hostOrUrl.trim().toLowerCase();
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname.toLowerCase();
    } catch {
      return false;
    }
  } else {
    // Strip a :port, but not the colons inside a bracketed IPv6 literal.
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
    if (bracketed) host = bracketed[1]!;
    else if (host.includes(':') && host.split(':').length === 2) host = host.split(':')[0]!;
  }
  host = host.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  // 127.0.0.0/8 — the whole block is loopback, not just 127.0.0.1.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const octets = v4.slice(1, 5).map(Number);
    return octets[0] === 127 && octets.every((o) => o >= 0 && o <= 255);
  }
  return false;
}
