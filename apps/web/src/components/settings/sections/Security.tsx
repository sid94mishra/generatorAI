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
  Globe, Trash2, RefreshCw, Copy, Check, QrCode, KeyRound, AlertTriangle,
} from 'lucide-react';
import { SectionHeader, SettingsCard, InfoRow } from '../shared.js';
import { apiFetch, ApiError } from '@/platform/apiFetch.js';
import { cn } from '@/lib/utils.js';

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
    <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] uppercase', TONE[tone])}>
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
  platform: 'web' | 'desktop' | 'cli' | 'mobile' | 'other';
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
  relay: { enabled: boolean; state: string; hostId: string | null };
  warnings: { code: string; severity: 'warn' | 'critical'; message: string }[];
}

const PLATFORM_ICON: Record<string, React.ElementType> = {
  web: Globe,
  desktop: Monitor,
  cli: TerminalIcon,
  mobile: Smartphone,
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
      'read:workflows', 'read:files', 'read:reviews', 'stream:events',
    ],
  },
  companion: {
    label: 'Mobile companion',
    hint: 'Read, chat, approve and review. No terminal, browser or admin access.',
    scopes: [
      'read:status', 'read:projects', 'read:workspaces', 'read:chats',
      'read:workflows', 'read:files', 'read:reviews', 'write:chats',
      'write:reviews', 'stream:events', 'exec:agent',
    ],
  },
  workstation: {
    label: 'Full workstation',
    hint: 'Everything except administration — including terminal and browser control.',
    scopes: [
      'read:status', 'read:projects', 'read:workspaces', 'read:chats',
      'read:workflows', 'read:files', 'read:reviews', 'write:projects',
      'write:workspaces', 'write:chats', 'write:workflows', 'write:files',
      'write:reviews', 'stream:events', 'exec:agent', 'exec:terminal', 'exec:browser',
    ],
  },
};

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

export function SecuritySection() {
  const [posture, setPosture] = useState<SecurityPosture | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [pending, setPending] = useState<PendingPairing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState<PairingResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [platform, setPlatform] = useState<'mobile' | 'web' | 'cli' | 'desktop'>('mobile');
  const [preset, setPreset] = useState<keyof typeof SCOPE_PRESETS>('default');
  const [includeRelay, setIncludeRelay] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [p, d, q] = await Promise.all([
        apiFetch<SecurityPosture>('/api/security/posture'),
        apiFetch<{ devices: DeviceSummary[] }>('/api/auth/devices?includeRevoked=true'),
        apiFetch<{ pending: PendingPairing[] }>('/api/auth/pair/pending'),
      ]);
      setPosture(p);
      setDevices(d.devices);
      setPending(q.pending);
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
        ...(includeRelay ? { includeRelay: true } : {}),
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
  }, [platform, deviceName, preset, includeRelay, refresh]);

  const revokeDevice = useCallback(
    async (deviceId: string, name: string) => {
      if (!window.confirm(
        `Revoke "${name}"?\n\nIt will lose access immediately and must be paired again. ` +
        `If it is currently connected through the relay, the revocation is queued and ` +
        `delivered as soon as the relay is reachable.`,
      )) return;
      try {
        await apiFetch(`/api/auth/devices/${deviceId}`, { method: 'DELETE' });
        void refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
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
    await navigator.clipboard.writeText(pairing.pairingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [pairing]);

  const activeDevices = useMemo(() => devices.filter((d) => !d.revokedAt), [devices]);
  const revokedDevices = useMemo(() => devices.filter((d) => d.revokedAt), [devices]);

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

      {/* ── Posture ───────────────────────────────────────────── */}
      <SettingsCard
        title="Server security posture"
        description="What is actually protecting this server right now."
        action={
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
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
                    label={posture.authentication.required ? 'device credentials' : 'DISABLED'}
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
                    label={posture.secretStore.kind}
                  />
                </span>
              }
            />
            <InfoRow
              label="Listening on"
              value={
                <span className="flex items-center gap-2 font-mono text-xs">
                  {posture.server.bindHost}
                  <StatusPill
                    tone={posture.server.loopbackOnly ? 'success' : 'warning'}
                    label={posture.server.loopbackOnly ? 'loopback only' : 'network exposed'}
                  />
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
                    posture.relay.enabled
                      ? posture.relay.state === 'attached'
                        ? 'success'
                        : 'warning'
                      : 'neutral'
                  }
                  label={posture.relay.enabled ? posture.relay.state : 'disabled'}
                />
              }
            />
            {posture.warnings.length > 0 && (
              <ul className="mt-3 space-y-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5">
                {posture.warnings.map((w) => (
                  <li key={w.code} className="flex items-start gap-2 text-xs text-foreground">
                    <ShieldAlert
                      className={cn(
                        'mt-0.5 h-3.5 w-3.5 shrink-0',
                        w.severity === 'critical' ? 'text-destructive' : 'text-warning',
                      )}
                    />
                    {w.message}
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

      {/* ── Pair a new device ─────────────────────────────────── */}
      <SettingsCard
        title="Pair a new device"
        description="Generates a single-use code that expires in 10 minutes. Show it only to the device you are pairing."
      >
        {pairing ? (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-subtle/40 p-5">
              <PairingQr text={pairing.pairingUrl} />
              <code className="max-w-full break-all rounded-md bg-card px-3 py-2 text-center font-mono text-[11px] text-muted-foreground">
                {pairing.pairingUrl}
              </code>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyCode()}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-subtle"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => void cancelPairing(pairing.grantId)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Expires in {Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000))}s ·{' '}
                {pairing.requestedScopes.length} scope
                {pairing.requestedScopes.length === 1 ? '' : 's'}
              </p>
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
                <input
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g. Pixel 9"
                  className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            {posture?.relay.enabled && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeRelay}
                  onChange={(e) => setIncludeRelay(e.target.checked)}
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
            <button
              type="button"
              disabled={creating}
              onClick={() => void createPairing()}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <QrCode className="h-4 w-4" />
              {creating ? 'Generating…' : 'Generate pairing code'}
            </button>
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
                <button
                  type="button"
                  onClick={() => void cancelPairing(p.grantId)}
                  className="text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

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
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void revokeDevice(d.deviceId, d.name)}
                    title="Revoke this device"
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/5 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Revoke
                  </button>
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
