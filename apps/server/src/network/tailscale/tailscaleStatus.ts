// ────────────────────────────────────────────────────────────────
// Reading what the Tailscale CLI reports (D-123). Pure: every input is
// untrusted JSON/text from another program, so nothing here throws, every
// field is type-checked before use and unknown shapes degrade to "unknown".
//
// `tailscale status --json` (ipnstate.Status) — the fields used:
//   BackendState     "Running" | "NeedsLogin" | "NeedsMachineAuth" | "Stopped" | "Starting" | "NoState"
//   AuthURL          the sign-in link while NeedsLogin (may be empty)
//   Self.DNSName     "<machine>.<tailnet>.ts.net." (trailing dot)
//   Self.CapMap / Self.Capabilities   contain "https" once HTTPS certificates are on
//   CertDomains      the names this node can get certificates for (HTTPS on)
//   CurrentTailnet   { Name, MagicDNSSuffix, MagicDNSEnabled }
//   Version          "1.88.3-t…"
//
// `tailscale serve status --json` (ipn.ServeConfig):
//   { "TCP": { "443": { "HTTPS": true } },
//     "Web": { "<name>:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3100" } } } },
//     "AllowFunnel": { "<name>:443": true } }
// and `{}` when nothing is served.
// ────────────────────────────────────────────────────────────────

export type TailscaleBackend = 'running' | 'needs-login' | 'stopped' | 'starting' | 'unknown';

export interface ParsedTailscaleStatus {
  backend: TailscaleBackend;
  /** `<machine>.<tailnet>.ts.net`, lower-case, no trailing dot; null when MagicDNS gives none. */
  dnsName: string | null;
  tailnet: string | null;
  magicDnsEnabled: boolean;
  /** HTTPS certificates are enabled for this tailnet (needed by `tailscale serve --https`). */
  httpsEnabled: boolean;
  /** Where to sign in, while the backend needs it. */
  loginUrl: string | null;
  version: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** `Name.Tailnet.ts.net.` → `name.tailnet.ts.net`; anything that is not a plain DNS name → null. */
export function normaliseDnsName(value: unknown): string | null {
  const raw = str(value)?.toLowerCase().replace(/\.$/, '') ?? null;
  if (!raw || raw.length > 253) return null;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(raw) ? raw : null;
}

/** Only Tailscale's own sign-in / admin links are ever shown to the user as something to open. */
export function isTailscaleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'login.tailscale.com' || url.hostname === 'tailscale.com' || url.hostname.endsWith('.tailscale.com'));
  } catch {
    return false;
  }
}

function backendOf(state: string | null): TailscaleBackend {
  switch (state) {
    case 'Running':
      return 'running';
    case 'NeedsLogin':
    case 'NeedsMachineAuth':
      return 'needs-login';
    case 'Stopped':
      return 'stopped';
    case 'Starting':
    case 'NoState':
      return 'starting';
    default:
      return 'unknown';
  }
}

function hasHttpsCapability(self: Record<string, unknown> | null): boolean {
  if (!self) return false;
  const capMap = record(self['CapMap']);
  if (capMap && Object.prototype.hasOwnProperty.call(capMap, 'https')) return true;
  const caps = self['Capabilities'];
  return Array.isArray(caps) && caps.some((cap) => cap === 'https');
}

export function parseTailscaleStatus(stdout: string): ParsedTailscaleStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const root = record(parsed);
  if (!root) return null;
  const self = record(root['Self']);
  const tailnet = record(root['CurrentTailnet']);
  const dnsName = normaliseDnsName(self?.['DNSName']);
  const certDomains = Array.isArray(root['CertDomains'])
    ? root['CertDomains'].map(normaliseDnsName).filter((d): d is string => d !== null)
    : [];
  const magicDnsEnabled = typeof tailnet?.['MagicDNSEnabled'] === 'boolean' ? tailnet['MagicDNSEnabled'] : dnsName !== null;
  const loginUrl = str(root['AuthURL']);
  return {
    backend: backendOf(str(root['BackendState'])),
    dnsName,
    tailnet: str(tailnet?.['Name']) ?? str(tailnet?.['MagicDNSSuffix']) ?? null,
    magicDnsEnabled,
    // A node whose own name is a certificate domain can serve HTTPS; the
    // capability covers versions that report it there instead.
    httpsEnabled: (dnsName !== null && certDomains.includes(dnsName)) || hasHttpsCapability(self),
    loginUrl: loginUrl && isTailscaleUrl(loginUrl) ? loginUrl : null,
    version: str(root['Version']),
  };
}

export interface ParsedServeStatus {
  /** Where `https://<name>:443/` is proxied, or null when nothing is served there. */
  proxyTarget: string | null;
  /** True when the same handler is also published to the internet (Funnel). */
  funnel: boolean;
}

/** The root handler for `<dnsName>:443` in `tailscale serve status --json`. */
export function parseServeStatus(stdout: string, dnsName: string): ParsedServeStatus | null {
  const trimmed = stdout.trim();
  // An empty config prints `{}`; some versions print nothing at all.
  if (!trimmed) return { proxyTarget: null, funnel: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const root = record(parsed);
  if (!root) return null;
  const web = record(root['Web']) ?? {};
  const key = Object.keys(web).find((k) => k.toLowerCase().replace(/\.:/, ':') === `${dnsName}:443`);
  const handlers = key ? record(record(web[key])?.['Handlers']) : null;
  const proxyTarget = str(record(handlers?.['/'])?.['Proxy']);
  const funnelMap = record(root['AllowFunnel']) ?? {};
  const funnel = Object.entries(funnelMap).some(([k, v]) => k.toLowerCase() === `${dnsName}:443` && v === true);
  return { proxyTarget, funnel };
}

/**
 * The link the CLI prints when HTTPS (or Serve) still has to be enabled for
 * the tailnet: "…To enable, visit: https://login.tailscale.com/f/serve?node=…".
 */
export function extractEnableUrl(output: string): string | null {
  for (const match of output.matchAll(/https:\/\/[^\s"'<>]+/g)) {
    const candidate = match[0].replace(/[.,)]+$/, '');
    if (isTailscaleUrl(candidate) && /login\.tailscale\.com/.test(candidate)) return candidate;
  }
  return null;
}

/** Plain-language cause for a failed `tailscale` call, from its stderr/stdout. */
export function describeCliFailure(output: string): { code: 'not-running' | 'permission' | 'needs-login' | 'failed'; message: string } {
  const text = output.toLowerCase();
  if (/failed to connect to local tailscale|is tailscale running|tailscaled.*not running|connection refused/.test(text)) {
    return { code: 'not-running', message: 'Tailscale is installed but not running. Open Tailscale and connect, then try again.' };
  }
  if (/access denied|permission denied|operator/.test(text)) {
    return {
      code: 'permission',
      message:
        'Tailscale refused to change Serve for your user. On Linux run "sudo tailscale set --operator=$USER" once, then try again.',
    };
  }
  if (/needslogin|logged out|not logged in|log in/.test(text)) {
    return { code: 'needs-login', message: 'Sign in to Tailscale on this computer, then try again.' };
  }
  const line = output.split('\n').map((l) => l.trim()).find(Boolean) ?? 'no output';
  return { code: 'failed', message: `Tailscale reported: ${line.slice(0, 300)}` };
}
