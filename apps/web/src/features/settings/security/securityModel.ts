// ────────────────────────────────────────────────────────────────
// Security & devices — pure helpers and the static tables the section
// renders (moved from the legacy components/settings/sections/Security.tsx).
// Scope words, sensitivity and the server-constant presets come from the
// shared vocabulary (`@generatorai/shared/ui-contract` scopes, MG-23), so web,
// desktop and mobile name and guard a grant the same way.
// ────────────────────────────────────────────────────────────────

import type { IconConcept } from '@generatorai/design-tokens';
import { describeScope, isSensitiveScope, SCOPE_PRESETS as SHARED_SCOPE_PRESETS } from '@generatorai/shared/ui-contract';
import type { BadgeTone } from '@/ui/primitives/Badge/Badge.js';
import type { NetworkEndpoint, TailscaleState } from '@/hooks/securityQueries.js';

export const PLATFORM_ICON: Record<string, IconConcept> = {
  web: 'browser',
  desktop: 'computer',
  cli: 'terminal',
  mobile: 'device',
  // An MCP server paired as a device (Workflow Overhaul PD-22).
  mcp: 'mcp',
  other: 'key',
};

export const PLATFORM_LABEL: Record<string, string> = {
  web: 'Web',
  desktop: 'Desktop',
  cli: 'CLI',
  mobile: 'Mobile',
  mcp: 'MCP server',
  other: 'Other',
};

export type PairingPlatform = 'mobile' | 'web' | 'desktop' | 'cli';

export const PAIRING_PLATFORMS: readonly { value: PairingPlatform; label: string }[] = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'web', label: 'Web browser' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'cli', label: 'CLI' },
];

export interface ScopePreset {
  id: string;
  label: string;
  hint: string;
  /** null: the server picks the least-privilege default for the platform. */
  scopes: string[] | null;
}

/** A server-constant preset's scopes (`DEFAULT_MOBILE_SCOPES`, `STANDALONE_MOBILE_SCOPES`), from the shared vocabulary. */
function sharedPresetScopes(id: 'companion' | 'standalone'): string[] {
  return [...(SHARED_SCOPE_PRESETS.find((preset) => preset.id === id)?.scopes ?? [])];
}

const READ = ['read:status', 'read:projects', 'read:workspaces', 'read:chats', 'read:workflows', 'read:files', 'read:reviews', 'read:activity'];

/** Permission presets offered when generating a pairing code. */
export const SCOPE_PRESETS: readonly ScopePreset[] = [
  { id: 'default', label: 'Recommended for platform', hint: 'The server picks the least-privilege default for the device type.', scopes: null },
  {
    id: 'readonly',
    label: 'Read only',
    hint: 'Can view projects, chats, workflows and diffs. Cannot run anything.',
    scopes: [...READ, 'stream:events'],
  },
  {
    id: 'companion',
    label: 'Mobile companion',
    hint: 'Read, chat, approve and review. No terminal, browser or admin access.',
    scopes: sharedPresetScopes('companion'),
  },
  {
    id: 'standalone',
    label: 'Mobile standalone',
    hint: 'Full client on a phone you hold: workspaces, files, workflows, terminal and browser control; no admin.',
    scopes: sharedPresetScopes('standalone'),
  },
  {
    id: 'workstation',
    label: 'Full workstation',
    hint: 'Everything except administration — including terminal and browser control.',
    scopes: [
      ...READ,
      'write:projects',
      'write:workspaces',
      'write:chats',
      'write:workflows',
      'write:files',
      'write:reviews',
      'stream:events',
      'exec:agent',
      'exec:terminal',
      'exec:browser',
    ],
  },
];

/**
 * Capabilities a paired device can be granted after the fact
 * (`PUT /devices/:id/scopes`). Terminal and browser control are withheld from
 * every default grant, so this is the only way to add them without pairing again.
 */
export const GRANTABLE_CAPABILITIES: readonly { scope: string; label: string; hint: string }[] = [
  { scope: 'exec:terminal', label: 'Terminal', hint: 'Run shell commands in a workspace — remote code execution.' },
  { scope: 'exec:browser', label: 'Browser', hint: "View and drive the agent's browser session." },
  { scope: 'write:files', label: 'Write files', hint: 'Upload attachments and edit workspace files.' },
  { scope: 'write:workflows', label: 'Control runs', hint: 'Start, pause and cancel workflow runs, and edit definitions.' },
  { scope: 'write:projects', label: 'Edit projects', hint: 'Create projects and link codebases.' },
  { scope: 'admin:devices', label: 'Manage devices', hint: 'Pair and revoke other devices from this one.' },
];

/** What granting the sensitive ones of `scopes` lets a device do, for the confirmation title ("run terminal commands on your machine"). */
export function sensitiveGrantText(scopes: readonly string[]): string {
  return scopes
    .filter(isSensitiveScope)
    .map((s) => {
      const text = describeScope(s);
      return text.charAt(0).toLowerCase() + text.slice(1);
    })
    .join(' and ');
}

export function relativeTime(ts: number | null, now = Date.now()): string {
  if (!ts) return 'never';
  const delta = now - ts;
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

/** "just now" / "3m ago". */
export function ago(ts: number | null, now = Date.now()): string {
  const t = relativeTime(ts, now);
  return t === 'now' ? 'just now' : t === 'never' ? 'never' : `${t} ago`;
}

/** Short, human-comparable form of a key fingerprint. */
export function shortFingerprint(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-8)}`;
}

/** One-word verdict on what a device can do. */
export function accessLevel(scopes: readonly string[]): { label: string; tone: BadgeTone } {
  if (scopes.some((s) => s.startsWith('admin:'))) return { label: 'Full access', tone: 'err' };
  if (scopes.some((s) => s.startsWith('exec:') || s.startsWith('write:'))) return { label: 'Can make changes', tone: 'warn' };
  return { label: 'Read only', tone: 'neutral' };
}

/**
 * An endpoint rewritten to the address a second device should open. In
 * production the server serves this page, so the endpoint — `https://` once
 * the server speaks TLS to other devices (D-110) — is used as it is. In
 * development the SPA and the API sit on different ports, so the host comes
 * from the endpoint and the scheme and port from where this page was served.
 */
export function browserAddressFor(endpointOrigin: string, pageOrigin: string): string {
  try {
    const endpoint = new URL(endpointOrigin);
    const here = new URL(pageOrigin);
    // An address on the default port is a proxy's — `https://<name>.ts.net`
    // from Tailscale (D-123), a reverse proxy — never the dev API port.
    if (endpoint.port === '' || endpoint.port === here.port) return endpoint.origin;
    here.hostname = endpoint.hostname;
    return here.origin;
  } catch {
    return endpointOrigin;
  }
}

/** The endpoints another device can actually route to (not loopback, not host-only adapters). */
export function usableEndpoints(endpoints: readonly NetworkEndpoint[]): NetworkEndpoint[] {
  return endpoints.filter((e) => e.reachability !== 'loopback' && !e.virtual);
}

/**
 * The address to read out to the joining device. The server picks it per
 * platform (`https://` for a browser, the native lane for the mobile app,
 * D-112), so it is used as it is unless this page is the dev server, where
 * only its host carries over.
 */
export function joinAddress(serverJoinUrl: string, pageOrigin: string): string {
  return browserAddressFor(serverJoinUrl, pageOrigin);
}

/**
 * A certificate fingerprint as people compare it: the first 8 bytes as
 * upper-case pairs, the way Chrome, Safari and Firefox print SHA-256
 * fingerprints in their certificate viewers (`3F A9 1C 07 88 2B D4 E1 …`).
 */
export function shortCertificateFingerprint(fingerprintSha256: string): string {
  const pairs = fingerprintSha256.toUpperCase().split(/[:\s]+/).filter(Boolean);
  return pairs.length > 8 ? `${pairs.slice(0, 8).join(' ')} …` : pairs.join(' ');
}

/** `12 Mar 2027` — a certificate's expiry. */
export function certificateDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** `m:ss` until `expiresAt`. */
export function countdown(expiresAt: number, now: number): string {
  const s = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Connect with Tailscale" (D-123): the badge for each state the server reports. */
export const TAILSCALE_STATE_BADGE: Record<TailscaleState, { label: string; tone: BadgeTone }> = {
  on: { label: 'On', tone: 'ok' },
  ready: { label: 'Ready', tone: 'neutral' },
  'not-installed': { label: 'Not installed', tone: 'neutral' },
  'not-running': { label: 'Not running', tone: 'warn' },
  'needs-login': { label: 'Signed out', tone: 'warn' },
  'https-disabled': { label: 'HTTPS off', tone: 'warn' },
  error: { label: 'Error', tone: 'err' },
};

/** Tailscale's own download pages (the Personal plan is free). */
export const TAILSCALE_DOWNLOADS: readonly { label: string; href: string }[] = [
  { label: 'macOS', href: 'https://tailscale.com/download/mac' },
  { label: 'Windows', href: 'https://tailscale.com/download/windows' },
  { label: 'Linux', href: 'https://tailscale.com/download/linux' },
  { label: 'iPhone and iPad', href: 'https://tailscale.com/download/ios' },
  { label: 'Android', href: 'https://tailscale.com/download/android' },
];

export const TAILSCALE_HTTPS_HELP = 'https://tailscale.com/docs/how-to/set-up-https-certificates';
