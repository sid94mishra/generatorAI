// ────────────────────────────────────────────────────────────────
// Security & devices — pure helpers and the static tables the section
// renders (moved from the legacy components/settings/sections/Security.tsx).
// ────────────────────────────────────────────────────────────────

import type { IconConcept } from '@generatorai/design-tokens';
import type { BadgeTone } from '@/ui/primitives/Badge/Badge.js';
import type { NetworkEndpoint } from '@/hooks/securityQueries.js';

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
    scopes: [...READ, 'write:chats', 'write:reviews', 'stream:events', 'exec:agent'],
  },
  // Mirrors STANDALONE_MOBILE_SCOPES in packages/auth/src/scopes.ts.
  {
    id: 'standalone',
    label: 'Mobile standalone',
    hint: 'Full client on a phone you hold: workspaces, files, workflows, terminal and browser control; no admin.',
    scopes: [
      ...READ,
      'write:chats',
      'write:reviews',
      'stream:events',
      'exec:agent',
      'write:workspaces',
      'write:files',
      'write:workflows',
      'write:projects',
      'exec:terminal',
      'exec:browser',
    ],
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

/** Short label for a scope; the raw id otherwise. */
export function scopeLabel(scope: string): string {
  return GRANTABLE_CAPABILITIES.find((cap) => cap.scope === scope)?.label ?? scope;
}

/** A scope whose grant is confirmed explicitly (the server audits it as critical). */
export function isSensitiveScope(scope: string): boolean {
  return scope === 'exec:terminal' || scope === 'admin:devices';
}

/** What granting `scopes` lets a device do, for the confirmation title. */
export function sensitiveGrantText(scopes: readonly string[]): string {
  return scopes
    .filter(isSensitiveScope)
    .map((s) => (s === 'exec:terminal' ? 'run shell commands on this machine' : 'pair and revoke other devices'))
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
 * development the SPA and the API sit on different ports, so the host comes
 * from the endpoint and the scheme and port from where this page was served
 * (identical to the server's own origin in production).
 */
export function browserAddressFor(endpointOrigin: string, pageOrigin: string): string {
  try {
    const here = new URL(pageOrigin);
    here.hostname = new URL(endpointOrigin).hostname;
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
 * The address to read out to the joining device: this page's origin, with a
 * loopback hostname swapped for the first routable endpoint.
 */
export function joinAddress(serverJoinUrl: string, endpoints: readonly NetworkEndpoint[] | undefined, pageOrigin: string): string {
  const here = new URL(pageOrigin);
  if (!/^(localhost|127\.|\[?::1)/i.test(here.hostname)) return here.origin;
  const routable = endpoints?.find((e) => e.reachability !== 'loopback');
  if (!routable) return serverJoinUrl;
  here.hostname = new URL(routable.origin).hostname;
  return here.origin;
}

/** `m:ss` until `expiresAt`. */
export function countdown(expiresAt: number, now: number): string {
  const s = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
