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
 */
export function matchesAnyHostPattern(host: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => matchesHostPattern(host, pattern));
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
