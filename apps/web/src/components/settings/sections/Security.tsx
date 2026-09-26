// ────────────────────────────────────────────────────────────────
// Security settings — device pairing, device management, and the live
// security posture of the server this client is talking to.
//
// This is the human-facing half of the auth architecture: the plan's
// "make security behaviour observable" requirement. A user must be able to
// see, at a glance:
//   * which secret backend is protecting their credentials
//   * which transport and host identity they are connected through
//   * exactly which devices can reach this server, and with what scopes
//   * and revoke any of them in one click
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, ShieldAlert, Smartphone, Monitor, Terminal as TerminalIcon,
  Globe, Trash2, RefreshCw, Copy, Check, QrCode, KeyRound, AlertTriangle, Plug,
} from 'lucide-react';
import { SectionHeader, SettingsCard, InfoRow } from '../shared.js';
import { ToggleSwitch, useConfirm, Button, Input, Spinner } from '@/components/ui/index.js';
import { apiFetch, ApiError } from '@/platform/apiFetch.js';
import {
  forgetConnection,
  getActiveConnection,
  listConnections,
  switchConnection,
} from '@/platform/authRuntime.js';
import { cn } from '@/lib/utils.js';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';

/** Compact coloured label used throughout this section. */
function StatusPill({
  tone,
  label,
}: {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  label: string;
}) {
  const TONE = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-destructive/10 text-destructive',
    neutral: 'bg-subtle text-muted-foreground',
  } as const;
  return (
    <span className={cn('inline-block max-w-full shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-right font-mono text-[10px] uppercase leading-tight', TONE[tone])}>
      {label}
    </span>
  );
}

// ── Types mirroring the server's auth/security routes ──────────────

/**
 * Mirrors `GET /api/auth/devices`.
 *
 * Note there is no public key or thumbprint here — the server deliberately
 * omits verification material from list responses, and the UI has no reason
 * to want it.
 */
interface DeviceSummary {
  deviceId: string;
  name: string;
  platform: 'web' | 'desktop' | 'cli' | 'mobile' | 'mcp' | 'other';
  scopes: string[];
  createdAt: number;
  lastSeenAt: number | null;
  lastSeenTransport: string | null;
  revokedAt: number | null;
  revokedReason: string | null;
  credentialVersion: number;
  connectionMode: string;
  relayBound: boolean;
}

interface PendingPairing {
  grantId: string;
  deviceName: string | null;
  platform: string;
  requestedScopes: string[];
  createdAt: number;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
}

interface PairingResponse {
  grantId: string;
  expiresAt: number;
  requestedScopes: string[];
  serverId: string;
  pairingCode: string;
  pairingUrl: string;
  /** Human-typeable code, already grouped for display. */
  shortCode: string;
  /** Origin the joining device should open in its browser. */
  joinUrl: string;
}

/** Mirrors `GET /api/security/network-access` exactly. */
interface NetworkAccess {
  mode: 'local-only' | 'network-accessible';
  /** What the listener is doing now, which lags `mode` until a restart. */
  active: boolean;
  pendingRestart: boolean;
  bindHost: string;
  envOverride: string | null;
  blockers: { code: string; message: string }[];
  endpoints: {
    origin: string;
    reachability: string;
    priority?: number;
    /** Host-only adapter (WSL/Hyper-V/Docker) that nothing off-box can reach. */
    virtual?: boolean;
  }[];
}

/** Mirrors `GET /api/security/posture` exactly. */
interface SecurityPosture {
  server: {
    hostId: string;
    bindHost: string;
    loopbackOnly: boolean;
    production: boolean;
    tokenAudience: string;
  };
  authentication: {
    required: boolean;
    unauthenticatedLoopback: boolean;
    legacyApiKeyActive: boolean;
    dpopRequired: boolean;
  };
  secretStore: {
    kind: string;
    secure: boolean;
    reason: string | null;
    supportsRotation: boolean;
  };
  devices: { active: number; revoked: number; relayBound: number };
  relay: { enabled: boolean; clientAvailable: boolean; state: string; hostId: string | null };
  warnings: { code: string; severity: 'warn' | 'critical'; message: string }[];
}

/** `GET /api/auth/scope-requests?status=pending` row (routes/scopeRequests.ts). */
interface ScopeRequestSummary {
  requestId: string;
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  scopes: string[];
  reason: string | null;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  createdAt: number;
}

const PLATFORM_ICON: Record<string, React.ElementType> = {
  web: Globe,
  desktop: Monitor,
  cli: TerminalIcon,
  mobile: Smartphone,
  mcp: Plug,
  other: KeyRound,
};

/** Scope presets offered when creating a pairing code. */
const SCOPE_PRESETS: Record<string, { label: string; hint: string; scopes: string[] | null }> = {
  default: {
    label: 'Recommended for platform',
    hint: 'Server picks the least-privilege default for the device type.',
    scopes: null,
  },
  readonly: {
    label: 'Read only',
    hint: 'Can view projects, chats, workflows and diffs. Cannot run anything.',
    scopes: [
      'read:status', 'read:projects', 'read:workspaces', 'read:chats',
      'read:workflows', 'read:files', 'read:reviews', 'read:activity', 'stream:events',
    ],
  },
  companion: {
    label: 'Mobile companion',
    hint: 'Read, chat, approve and review. No terminal, browser or admin access.',
    scopes: [
      'read:status', 'read:projects', 'read:workspaces', 'read:chats',
      'read:workflows', 'read:files', 'read:reviews', 'read:activity', 'write:chats',
      'write:reviews', 'stream:events', 'exec:agent',
    ],
  },
  // Mirrors STANDALONE_MOBILE_SCOPES in packages/auth/src/scopes.ts.
  standalone: {
    label: 'Mobile standalone',
    hint: 'Full client on a phone you hold: workspaces, files, workflows, terminal and browser control; no admin.',
    scopes: [
      'read:status', 'read:projects', 'read:workspaces', 'read:chats',
      'read:workflows', 'read:files', 'read:reviews', 'read:activity', 'write:chats',
      'write:reviews', 'stream:events', 'exec:agent', 'write:workspaces', 'write:files',
      'write:workflows', 'write:projects', 'exec:terminal', 'exec:browser',
    ],
  },
  workstation: {
    label: 'Full workstation',
    hint: 'Everything except administration — including terminal and browser control.',
    scopes: [
      'read:status', 'read:projects', 'read:workspaces', 'read:chats',
      'read:workflows', 'read:files', 'read:reviews', 'read:activity', 'write:projects',
      'write:workspaces', 'write:chats', 'write:workflows', 'write:files',
      'write:reviews', 'stream:events', 'exec:agent', 'exec:terminal', 'exec:browser',
    ],
  },
};

/**
 * Capabilities a paired device can be granted after the fact.
 *
 * Terminal and browser control are withheld from every default grant, so
 * without this the only way to give a phone a terminal was to revoke it and
 * pair it again on the "Full workstation" preset — which is why those tabs
 * looked broken rather than locked. `PUT /devices/:id/scopes` has always
 * existed; nothing surfaced it.
 */
const GRANTABLE_CAPABILITIES: Array<{ scope: string; label: string; hint: string }> = [
  {
    scope: 'exec:terminal',
    label: 'Terminal',
    hint: 'Run shell commands in a workspace. This is remote code execution — grant it only to a device you physically hold.',
  },
  {
    scope: 'exec:browser',
    label: 'Browser',
    hint: "View and drive the agent's browser session.",
  },
  {
    scope: 'write:files',
    label: 'Write files',
    hint: 'Upload attachments and edit workspace files.',
  },
  {
    scope: 'write:workflows',
    label: 'Control runs',
    hint: 'Start, pause and cancel workflow runs, and edit definitions.',
  },
  {
    scope: 'write:projects',
    label: 'Edit projects',
    hint: 'Create projects and link codebases.',
  },
  {
    scope: 'admin:devices',
    label: 'Manage devices',
    hint: 'Pair and revoke other devices from this one.',
  },
];

/** Short label for a scope in the access-request card; raw id otherwise. */
function scopeLabel(scope: string): string {
  return GRANTABLE_CAPABILITIES.find((cap) => cap.scope === scope)?.label ?? scope;
}

/** Scopes whose grant is confirmed explicitly, matching `toggleCapability`. */
const CONFIRMED_GRANTS = new Set(['exec:terminal', 'admin:devices']);

function relativeTime(ts: number | null): string {
  if (!ts) return 'never';
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

/** Short, human-comparable form of a key fingerprint. */
function shortFingerprint(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

/**
 * The address to read out to the joining device.
 *
 * Not simply the server's own origin: in development the SPA is served by Vite
 * on a different port than the API, so the server's origin would send the user
 * to a port that serves no app. What the second device actually needs is the
 * place THIS page was served from, with a loopback hostname swapped for a
 * routable one. In production and the desktop shell the two are the same
 * origin, so this collapses to the server address anyway.
 */
function joinAddress(
  serverJoinUrl: string,
  endpoints: NetworkAccess['endpoints'] | undefined,
): string {
  if (typeof window === 'undefined') return serverJoinUrl;

  const here = new URL(window.location.origin);
  const isLoopback = /^(localhost|127\.|\[?::1)/i.test(here.hostname);
  if (!isLoopback) return here.origin;

  const routable = endpoints?.find((endpoint) => endpoint.reachability !== 'loopback');
  if (!routable) return serverJoinUrl;

  here.hostname = new URL(routable.origin).hostname;
  return here.origin;
}

/**
 * Rewrites a server endpoint into the address a second device should open.
 *
 * In development the SPA and the API sit on different ports, so the server's
 * own origin points at a port that serves no app. The host is what varies
 * between endpoints; the scheme and port always come from wherever this page
 * was served, which is by definition reachable — and identical to the server's
 * own origin in production, where the two are the same.
 */
function browserAddressFor(endpointOrigin: string): string {
  if (typeof window === 'undefined') return endpointOrigin;
  try {
    const here = new URL(window.location.origin);
    here.hostname = new URL(endpointOrigin).hostname;
    return here.origin;
  } catch {
    return endpointOrigin;
  }
}

/**
 * One-word verdict on what a device can do, so the list is scannable without
 * reading 22 raw scope strings per row.
 */
function accessLevel(scopes: string[]): { label: string; tone: 'danger' | 'warning' | 'neutral' } {
  if (scopes.some((s) => s.startsWith('admin:'))) return { label: 'full access', tone: 'danger' };
  if (scopes.some((s) => s.startsWith('exec:') || s.startsWith('write:'))) {
    return { label: 'can make changes', tone: 'warning' };
  }
  return { label: 'read only', tone: 'neutral' };
}

export function SecuritySection() {
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirm();
  const [posture, setPosture] = useState<SecurityPosture | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [pending, setPending] = useState<PendingPairing[]>([]);
  const [scopeRequests, setScopeRequests] = useState<ScopeRequestSummary[]>([]);
  /** Per request: the subset of scopes ticked for approval (prefilled: all). */
  const [approveSelection, setApproveSelection] = useState<Record<string, string[]>>({});
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState<PairingResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [platform, setPlatform] = useState<'mobile' | 'web' | 'cli' | 'desktop'>('mobile');
  const [preset, setPreset] = useState<keyof typeof SCOPE_PRESETS>('default');
  const [includeRelay, setIncludeRelay] = useState(false);
  const [network, setNetwork] = useState<NetworkAccess | null>(null);
  const [networkBusy, setNetworkBusy] = useState(false);
  // Read once per mount: the catalog only changes via actions that reload.
  const [connections] = useState(() => listConnections());
  const [active] = useState(() => getActiveConnection());

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [p, d, q, n, r] = await Promise.all([
        apiFetch<SecurityPosture>('/api/security/posture'),
        apiFetch<{ devices: DeviceSummary[] }>('/api/auth/devices?includeRevoked=true'),
        apiFetch<{ pending: PendingPairing[] }>('/api/auth/pair/pending'),
        apiFetch<NetworkAccess>('/api/security/network-access'),
        apiFetch<{ requests: ScopeRequestSummary[] }>('/api/auth/scope-requests?status=pending'),
      ]);
      setPosture(p);
      setDevices(d.devices);
      setPending(q.pending);
      setNetwork(n);
      setScopeRequests(r.requests);
      // Prefill every request with all of its scopes ticked; keep an
      // existing selection so a refetch does not undo the operator's edits.
      setApproveSelection((prev) => {
        const next: Record<string, string[]> = {};
        for (const req of r.requests) next[req.requestId] = prev[req.requestId] ?? [...req.scopes];
        return next;
      });
    } catch (err) {
      // A device without `admin:devices` legitimately cannot list devices —
      // say so plainly instead of rendering an empty table that looks broken.
      setError(
        err instanceof ApiError && err.status === 403
          ? 'This device does not have permission to manage security settings (admin:devices).'
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const setNetworkAccess = useCallback(
    async (mode: NetworkAccess['mode']) => {
      setNetworkBusy(true);
      setError(null);
      try {
        await apiFetch('/api/security/network-access', {
          method: 'POST',
          body: JSON.stringify({ mode }),
        });

        // In the desktop shell the server is a child process we own, so the
        // restart the change requires can just happen — the user should not
        // have to go and restart anything by hand. In a browser against a
        // standalone server we cannot do that, so the card shows a
        // "restart required" notice instead.
        const desktop = window.generatoraiDesktop;
        if (desktop?.isDesktop && typeof desktop.restartServer === 'function') {
          await desktop.restartServer();
        }

        await refresh();
      } catch (err) {
        // The server refuses to expose an unsafe posture (409). Surfacing its
        // message verbatim is the point: it names the exact thing to fix.
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setNetworkBusy(false);
      }
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Access requests arrive from other devices, so this page cannot know
  // about them without asking. It subscribes to nothing today; poll every
  // 30 s while the tab is visible and once more when it becomes visible.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const t = setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  const toggleRequestScope = useCallback((requestId: string, scope: string) => {
    setApproveSelection((prev) => {
      const current = prev[requestId] ?? [];
      const next = current.includes(scope)
        ? current.filter((s) => s !== scope)
        : [...current, scope];
      return { ...prev, [requestId]: next };
    });
  }, []);

  /**
   * Approve the ticked subset. The server clamps the grant to this
   * principal's own scopes and audits high-risk grants as critical, the same
   * path as toggling a capability; a terminal or device-admin grant is
   * confirmed here for the same reason it is there.
   */
  const approveRequest = useCallback(
    async (req: ScopeRequestSummary) => {
      const scopes = (approveSelection[req.requestId] ?? req.scopes).filter((s) => req.scopes.includes(s));
      if (scopes.length === 0) return;
      const sensitive = scopes.filter((s) => CONFIRMED_GRANTS.has(s));
      if (sensitive.length > 0) {
        const what = sensitive
          .map((s) => (s === 'exec:terminal' ? 'run shell commands on this machine' : 'pair and revoke other devices'))
          .join(' and ');
        if (!(await confirmAction({
          title: `Allow "${req.deviceName ?? 'this device'}" to ${what}?`,
          description: 'This takes effect the next time that device refreshes its session.',
          confirmLabel: 'Allow',
        }))) {
          return;
        }
      }
      setRequestBusy(req.requestId);
      setError(null);
      try {
        await apiFetch(`/api/auth/scope-requests/${encodeURIComponent(req.requestId)}/approve`, {
          method: 'POST',
          body: JSON.stringify(scopes.length === req.scopes.length ? {} : { scopes }),
        });
        void refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRequestBusy(null);
      }
    },
    [approveSelection, confirmAction, refresh],
  );

  const denyRequest = useCallback(
    async (req: ScopeRequestSummary) => {
      setRequestBusy(req.requestId);
      setError(null);
      try {
        await apiFetch(`/api/auth/scope-requests/${encodeURIComponent(req.requestId)}/deny`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        void refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRequestBusy(null);
      }
    },
    [refresh],
  );

  // A pairing code is short-lived; tick so the countdown stays honest and the
  // code disappears from the screen the moment it stops working.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pairing]);
  useEffect(() => {
    if (pairing && pairing.expiresAt <= now) {
      setPairing(null);
      void refresh();
    }
  }, [pairing, now, refresh]);

  const createPairing = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const scopes = SCOPE_PRESETS[preset]?.scopes;
      const body = {
        platform,
        ...(deviceName.trim() ? { deviceName: deviceName.trim() } : {}),
        ...(scopes ? { scopes } : {}),
        ...(includeRelay && posture?.relay.clientAvailable ? { includeRelay: true } : {}),
      };
      const result = await apiFetch<PairingResponse>('/api/auth/pair', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setPairing(result);
      setNow(Date.now());
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [platform, deviceName, preset, includeRelay, posture?.relay.clientAvailable, refresh]);

  const revokeDevice = useCallback(
    async (deviceId: string, name: string) => {
      if (!(await confirmAction({
        title: `Revoke "${name}"?`,
        description:
          'It will lose access immediately and must be paired again. If it is currently ' +
          'connected through the relay, the revocation is queued and delivered as soon as ' +
          'the relay is reachable.',
        confirmLabel: 'Revoke',
        variant: 'destructive',
      }))) return;
      try {
        await apiFetch(`/api/auth/devices/${deviceId}`, { method: 'DELETE' });
        void refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh, confirmAction],
  );

  /**
   * Grant or withdraw one capability on an already-paired device.
   *
   * Sends the FULL scope list because the endpoint replaces rather than
   * merges. Granting `exec:terminal` is confirmed explicitly — it is remote
   * code execution, and the server records it as a critical audit event.
   */
  const [scopeBusy, setScopeBusy] = useState<string | null>(null);
  const toggleCapability = useCallback(
    async (device: DeviceSummary, scope: string, grant: boolean) => {
      if (grant && (scope === 'exec:terminal' || scope === 'admin:devices')) {
        const what =
          scope === 'exec:terminal'
            ? 'run shell commands on this machine'
            : 'pair and revoke other devices';
        if (!(await confirmAction({
          title: `Allow "${device.name}" to ${what}?`,
          description: 'This takes effect the next time that device refreshes its session.',
          confirmLabel: 'Allow',
        }))) {
          return;
        }
      }
      const next = grant
        ? [...new Set([...device.scopes, scope])]
        : device.scopes.filter((s) => s !== scope);
      setScopeBusy(`${device.deviceId}:${scope}`);
      setError(null);
      try {
        await apiFetch(`/api/auth/devices/${device.deviceId}/scopes`, {
          method: 'PUT',
          body: JSON.stringify({ scopes: next }),
        });
        void refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setScopeBusy(null);
      }
    },
    [refresh, confirmAction],
  );

  const cancelPairing = useCallback(
    async (grantId: string) => {
      try {
        await apiFetch(`/api/auth/pair/${grantId}`, { method: 'DELETE' });
        if (pairing?.grantId === grantId) setPairing(null);
        void refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [pairing, refresh],
  );

  const copyCode = useCallback(async () => {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.shortCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [pairing]);

  const copyJoinUrl = useCallback(async () => {
    if (!pairing) return;
    await navigator.clipboard.writeText(joinAddress(pairing.joinUrl, network?.endpoints));
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1500);
  }, [pairing, network]);

  const activeDevices = useMemo(() => devices.filter((d) => !d.revokedAt), [devices]);
  const revokedDevices = useMemo(() => devices.filter((d) => d.revokedAt), [devices]);

  // NON_LOOPBACK_BIND fires whenever the server is off loopback — which is the
  // state the Network access toggle exists to produce. Showing it there turns
  // a deliberate, already-explained choice into a standing alarm, and an alarm
  // that is always on for normal usage is one people learn to ignore.
  const visibleWarnings = useMemo(
    () =>
      (posture?.warnings ?? []).filter(
        (w) => !(w.code === 'NON_LOOPBACK_BIND' && network?.mode === 'network-accessible'),
      ),
    [posture, network],
  );

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Security & Devices"
        description="Pair new clients, review what each one can do, and revoke access instantly."
      />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Servers ───────────────────────────────────────────── */}
      {connections.length > 0 && (
        <SettingsCard
          title="Servers"
          description="Each server keeps its own credential, so switching back never needs pairing again."
        >
          <div className="space-y-2">
            {connections.map((connection) => {
              const isActive = connection.serverId === active?.serverId;
              return (
                <div
                  key={connection.serverId}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5',
                    isActive ? 'border-primary/40 bg-primary/5' : 'border-border',
                  )}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {connection.label}
                      {isActive && <StatusPill tone="success" label="connected" />}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {connection.endpoint}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!isActive && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => switchConnection(connection.serverId)}
                      >
                        Switch
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Forget this server"
                      aria-label={`Forget ${connection.label}`}
                      onClick={() => {
                        void (async () => {
                          if (
                            await confirmAction({
                              title: `Forget ${connection.label}?`,
                              description:
                                "This device's credential for it is deleted, and you will need " +
                                'a new pairing code to connect again.',
                              confirmLabel: 'Forget',
                              variant: 'destructive',
                            })
                          ) {
                            forgetConnection(connection.serverId);
                          }
                        })();
                      }}
                      className="rounded-md border border-border text-muted-foreground hover:border-destructive/50 hover:bg-transparent hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              To add another server, open its address in this browser and pair there — it will
              appear in this list.
            </p>
          </div>
        </SettingsCard>
      )}

      {/* ── This server ───────────────────────────────────────── */}
      <SettingsCard
        title="This server"
        description="What is protecting it right now."
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
            leftIcon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}
          >
            Refresh
          </Button>
        }
      >
        {posture ? (
          <div className="space-y-0.5">
            <InfoRow
              label="Authentication"
              value={
                <span className="flex items-center gap-2">
                  <StatusPill
                    tone={posture.authentication.required ? 'success' : 'danger'}
                    label={posture.authentication.required ? 'pairing required' : 'DISABLED'}
                  />
                  {posture.authentication.legacyApiKeyActive && (
                    <StatusPill tone="warning" label="legacy key active" />
                  )}
                </span>
              }
            />
            <InfoRow
              label="Secret storage"
              value={
                <span className="flex items-center gap-2">
                  <StatusPill
                    tone={posture.secretStore.secure ? 'success' : 'danger'}
                    label={posture.secretStore.secure ? 'protected' : 'weak'}
                  />
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {posture.secretStore.kind}
                  </span>
                </span>
              }
            />
            <InfoRow
              label="Host identity"
              value={
                <span className="font-mono text-xs" title={posture.server.hostId}>
                  {shortFingerprint(posture.server.hostId)}
                </span>
              }
            />
            <InfoRow
              label="Relay"
              value={
                <StatusPill
                  tone={
                    posture.relay.clientAvailable && posture.relay.enabled
                      ? posture.relay.state === 'attached'
                        ? 'success'
                        : 'warning'
                      : 'neutral'
                  }
                  label={
                    posture.relay.clientAvailable
                      ? posture.relay.enabled
                        ? posture.relay.state
                        : 'disabled'
                      : posture.relay.enabled
                        ? 'client unavailable'
                        : 'disabled'
                  }
                />
              }
            />
            {visibleWarnings.length > 0 && (
              <ul className="mt-3 space-y-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5">
                {visibleWarnings.map((w) => (
                  <li key={w.code} className="flex min-w-0 items-start gap-2 break-words text-xs text-foreground">
                    <ShieldAlert
                      className={cn(
                        'mt-0.5 h-3.5 w-3.5 shrink-0',
                        w.severity === 'critical' ? 'text-destructive' : 'text-warning',
                      )}
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{w.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading…' : 'Security posture is unavailable.'}
          </p>
        )}
      </SettingsCard>

      {/* ── Network access ────────────────────────────────────── */}
      <SettingsCard
        title="Network access"
        description="Let other devices on this network reach this server, so you can open the app on a phone or a second computer."
      >
        {network ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-subtle/40 p-4">
              <ToggleSwitch
                checked={network.mode === 'network-accessible'}
                disabled={networkBusy || network.envOverride != null}
                onChange={(next) =>
                  void setNetworkAccess(next ? 'network-accessible' : 'local-only')
                }
                label={network.active ? 'Reachable on this network' : 'This computer only'}
                description={
                  network.active
                    ? 'Other devices on the same network can reach this server and pair with it.'
                    : 'The server is bound to loopback, so nothing outside this computer can connect.'
                }
              />
              {networkBusy && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Applying…
                </p>
              )}
            </div>

            {network.envOverride != null && (
              <p className="rounded-md border border-border bg-subtle/40 px-3 py-2 text-xs text-muted-foreground">
                GENERATORAI_BIND_HOST is set to{' '}
                <code className="font-mono">{network.envOverride}</code> in this server's
                environment, so it decides the bind address and this toggle cannot change it.
              </p>
            )}

            {network.blockers.length > 0 && (
              <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  Fix this before enabling network access
                </p>
                {network.blockers.map((blocker) => (
                  <p key={blocker.code} className="text-xs text-muted-foreground">
                    {blocker.message}
                  </p>
                ))}
              </div>
            )}

            {network.pendingRestart && (
              <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
                Saved. Restart the server to apply this change — the bind address is fixed when
                the server starts.
              </p>
            )}

            {network.active && network.endpoints.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">
                  Addresses other devices can use
                </p>
                {(() => {
                  // Virtual adapters (WSL, Hyper-V, Docker) are RFC1918 and so
                  // look like a LAN address, but nothing off this machine can
                  // route to them — listing them sends people to an address
                  // that silently times out.
                  const usable = network.endpoints.filter(
                    (endpoint) => endpoint.reachability !== 'loopback' && !endpoint.virtual,
                  );
                  if (usable.length === 0) {
                    return (
                      <p className="text-xs text-muted-foreground">
                        No routable network address was detected. Connect to Wi-Fi or Ethernet.
                      </p>
                    );
                  }
                  return usable.map((endpoint) => (
                    <code
                      key={endpoint.origin}
                      className="block truncate rounded-md bg-subtle/60 px-2.5 py-1.5 font-mono text-xs text-muted-foreground select-all"
                    >
                      {browserAddressFor(endpoint.origin)}
                    </code>
                  ));
                })()}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {loading ? 'Loading…' : 'Network access settings are unavailable.'}
          </p>
        )}
      </SettingsCard>

      {/* ── Pair a new device ─────────────────────────────────── */}
      <SettingsCard
        title="Pair a new device"
        description="Generates a single-use code that expires in 10 minutes. Show it only to the device you are pairing."
      >
        {pairing ? (
          <div className="space-y-3">
            <div className="space-y-4 rounded-lg border border-border bg-subtle/40 p-5">
              {/* The two things the other device actually needs, in the order
                  they are needed: where to go, then what to type. Everything
                  else on this card is a shortcut for that same pair. */}
              <ol className="space-y-3">
                <li className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    <span className="mr-1.5 font-semibold text-foreground">1.</span>
                    On the other device, open a browser and go to
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md bg-card px-3 py-2 font-mono text-sm text-foreground">
                      {joinAddress(pairing.joinUrl, network?.endpoints)}
                    </code>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      onClick={() => void copyJoinUrl()}
                      title="Copy address"
                      aria-label="Copy address"
                      className="h-9 w-9 rounded-md p-2"
                    >
                      {copiedUrl ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </li>
                <li className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    <span className="mr-1.5 font-semibold text-foreground">2.</span>
                    Enter this code
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-md bg-card px-3 py-3 text-center font-mono text-2xl font-semibold tracking-[0.15em] text-foreground select-all">
                      {pairing.shortCode}
                    </code>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      onClick={() => void copyCode()}
                      title="Copy code"
                      aria-label="Copy code"
                      className="h-9 w-9 rounded-md p-2"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </li>
              </ol>

              <p className="text-center text-xs text-muted-foreground">
                Expires in {Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000))}s ·{' '}
                {pairing.requestedScopes.length} scope
                {pairing.requestedScopes.length === 1 ? '' : 's'}
              </p>

              <details className="group">
                <summary className="cursor-pointer list-none text-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  Or scan a QR code
                </summary>
                <div className="mt-3 flex flex-col items-center gap-2">
                  <PairingQr text={pairing.pairingUrl} />
                  <p className="max-w-xs text-center text-[11px] text-muted-foreground">
                    Scanning also works for a device that cannot reach this server at the
                    address above — the QR carries the full endpoint list.
                  </p>
                </div>
              </details>

              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void cancelPairing(pairing.grantId)}
                >
                  Cancel
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Anyone who sees this code can pair a device with the listed scopes until it is used
              or expires. Do not screenshot or paste it into a chat.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">Device name</span>
                <Input
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g. Pixel 9"
                  className="h-auto bg-card px-2.5 py-1.5"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">Platform</span>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as typeof platform)}
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="mobile">Mobile</option>
                  <option value="web">Web browser</option>
                  <option value="desktop">Desktop</option>
                  <option value="cli">CLI</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">Permissions</span>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as keyof typeof SCOPE_PRESETS)}
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {Object.entries(SCOPE_PRESETS).map(([key, v]) => (
                  <option key={key} value={key}>{v.label}</option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">{SCOPE_PRESETS[preset]?.hint}</span>
            </label>
            {posture?.relay.enabled && posture.relay.clientAvailable && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={includeRelay}
                  onCheckedChange={(v) => setIncludeRelay(v === true)}
                  className="h-3.5 w-3.5"
                />
                <span>
                  Include relay access
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    (lets this device reconnect from outside your network)
                  </span>
                </span>
              </label>
            )}
            <Button
              type="button"
              variant="primary"
              disabled={creating}
              loading={creating}
              onClick={() => void createPairing()}
              leftIcon={!creating ? <QrCode className="h-4 w-4" /> : undefined}
            >
              {creating ? 'Generating…' : 'Generate pairing code'}
            </Button>
          </div>
        )}

        {pending.length > 0 && (
          <div className="mt-4 space-y-1.5 border-t border-border pt-3">
            <span className="text-xs font-medium text-foreground">Awaiting pairing</span>
            {pending.map((p) => (
              <div key={p.grantId} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  {p.deviceName ?? 'Unnamed'} · {p.platform} · {p.attempts}/{p.maxAttempts} attempts ·
                  expires {relativeTime(p.expiresAt)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void cancelPairing(p.grantId)}
                  className="h-auto p-0 text-muted-foreground underline-offset-2 hover:bg-transparent hover:text-destructive hover:underline"
                >
                  Cancel
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      {/* ── Access requests ───────────────────────────────────── */}
      {scopeRequests.length > 0 && (
        <SettingsCard
          title={`Access requests (${scopeRequests.length})`}
          description="A paired device asked for more than it holds. Untick anything you do not want to grant; the rest is refused."
        >
          <div className="space-y-2">
            {scopeRequests.map((req) => {
              const Icon = PLATFORM_ICON[req.platform ?? 'other'] ?? KeyRound;
              const selected = approveSelection[req.requestId] ?? req.scopes;
              const busy = requestBusy === req.requestId;
              return (
                <div
                  key={req.requestId}
                  className="flex items-start justify-between gap-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-subtle text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {req.deviceName ?? 'Unnamed device'}
                        </span>
                        {req.platform && <StatusPill tone="neutral" label={req.platform} />}
                        <span className="text-xs text-muted-foreground">asked {relativeTime(req.createdAt)}</span>
                      </div>
                      {req.reason && (
                        <p className="mt-0.5 text-xs text-muted-foreground">“{req.reason}”</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {req.scopes.map((scope) => {
                          const on = selected.includes(scope);
                          return (
                            <label
                              key={scope}
                              className={cn(
                                'flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]',
                                on
                                  ? 'border-primary/40 bg-primary/10 text-primary'
                                  : 'border-border text-muted-foreground line-through',
                              )}
                              title={scope}
                            >
                              <Checkbox
                                className="h-3 w-3"
                                checked={on}
                                disabled={busy}
                                onCheckedChange={() => toggleRequestScope(req.requestId, scope)}
                              />
                              {scopeLabel(scope)}
                              {(scope.startsWith('exec:') || scope.startsWith('admin:')) && (
                                <AlertTriangle className="h-2.5 w-2.5 text-warning" />
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void denyRequest(req)}
                      className="hover:border-destructive/50 hover:bg-destructive/5 hover:text-destructive"
                    >
                      Deny
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || selected.length === 0}
                      onClick={() => void approveRequest(req)}
                      leftIcon={busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    >
                      Approve{selected.length < req.scopes.length ? ` ${selected.length}/${req.scopes.length}` : ''}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </SettingsCard>
      )}

      {/* ── Devices ───────────────────────────────────────────── */}
      <SettingsCard
        title={`Paired devices (${activeDevices.length})`}
        description="Each device holds its own key. Revoking one never affects the others."
      >
        {activeDevices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No devices are paired yet.</p>
        ) : (
          <div className="space-y-2">
            {activeDevices.map((d) => {
              const Icon = PLATFORM_ICON[d.platform] ?? KeyRound;
              return (
                <div
                  key={d.deviceId}
                  className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-subtle text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{d.name}</span>
                        <StatusPill tone="neutral" label={d.platform} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Last seen {relativeTime(d.lastSeenAt)}
                        {d.lastSeenTransport ? ` over ${d.lastSeenTransport}` : ''} · credential v
                        {d.credentialVersion}
                        {d.relayBound ? ' · relay enabled' : ''}
                      </p>
                      {/* A one-line summary instead of one chip per scope.
                          A full-access device carries 22 scopes; rendering
                          them all turned a list of 16 devices into ~350 chips
                          that nobody reads. The exact grant is still one click
                          away for anyone auditing. */}
                      <details className="mt-1.5 group">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                          <StatusPill
                            tone={accessLevel(d.scopes).tone}
                            label={accessLevel(d.scopes).label}
                          />
                          <span className="underline-offset-2 group-hover:underline">
                            {d.scopes.length} permission{d.scopes.length === 1 ? '' : 's'}
                          </span>
                        </summary>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {d.scopes.map((s) => (
                            <span
                              key={s}
                              className={cn(
                                'rounded px-1.5 py-0.5 font-mono text-[10px]',
                                s.startsWith('admin:')
                                  ? 'bg-destructive/10 text-destructive'
                                  : s.startsWith('exec:')
                                    ? 'bg-warning/10 text-warning'
                                    : 'bg-subtle text-muted-foreground',
                              )}
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </details>

                      {/* Capabilities — the only place a withheld scope can
                          be granted without re-pairing the device. */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Capabilities
                        </span>
                        {GRANTABLE_CAPABILITIES.map((cap) => {
                          const held = d.scopes.includes(cap.scope);
                          const busy = scopeBusy === `${d.deviceId}:${cap.scope}`;
                          return (
                            <Button
                              key={cap.scope}
                              type="button"
                              variant="ghost"
                              role="switch"
                              aria-checked={held}
                              aria-label={`${cap.label}${held ? ', granted' : ', not granted'}`}
                              disabled={busy}
                              title={`${cap.hint}${held ? '' : '\n\nNot granted.'}`}
                              onClick={() => void toggleCapability(d, cap.scope, !held)}
                              className={cn(
                                'h-auto gap-1 rounded-full border px-2 py-0.5 text-[11px] font-normal',
                                // 22.5px tall as drawn, under the 24px target
                                // floor — and these grant a device real
                                // authority, so a near-miss click is the worst
                                // kind. The pseudo-element widens the pointer
                                // target without moving a pixel of the pill.
                                'relative before:absolute before:-inset-y-1 before:inset-x-0 before:content-[""]',
                                held
                                  ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/10'
                                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                              )}
                            >
                              {busy ? (
                                <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                              ) : held ? (
                                <Check className="h-2.5 w-2.5" />
                              ) : null}
                              {cap.label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void revokeDevice(d.deviceId, d.name)}
                    title="Revoke this device"
                    className="shrink-0 hover:border-destructive/50 hover:bg-destructive/5 hover:text-destructive"
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                  >
                    Revoke
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {revokedDevices.length > 0 && (
          <details className="mt-3 border-t border-border pt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {revokedDevices.length} revoked device{revokedDevices.length === 1 ? '' : 's'}
            </summary>
            <div className="mt-2 space-y-1">
              {revokedDevices.map((d) => (
                <div key={d.deviceId} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3 w-3" />
                  <span className="line-through">{d.name}</span>
                  <span>revoked {relativeTime(d.revokedAt)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </SettingsCard>
      {confirmDialog}
    </div>
  );
}

// ── QR rendering ───────────────────────────────────────────────────

/**
 * Renders the pairing URL as a QR code.
 *
 * Deliberately server-free: the pairing code must never leave this machine,
 * so we cannot use a hosted QR image service. `qrcode` draws to a canvas
 * locally and is loaded lazily so it does not weigh on the main bundle.
 */
function PairingQr({ text }: { text: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import('qrcode');
        if (cancelled || !canvasRef.current) return;
        await mod.toCanvas(canvasRef.current, text, {
          width: 220,
          margin: 1,
          errorCorrectionLevel: 'M',
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (failed) {
    return (
      <p className="text-xs text-muted-foreground">
        QR rendering is unavailable — copy the link below instead.
      </p>
    );
  }
  return <canvas ref={canvasRef} className="rounded-md bg-white p-2" />;
}
