// ────────────────────────────────────────────────────────────────
// ComputerPanel — watch what the agent is doing on the desktop.
//
// There is no live video here and there should not be: the driver captures a
// PNG of the TARGET WINDOW each time the agent reads it, never the whole
// screen, so this panel can only ever show what the agent itself looked at.
// That is the point — it is a record of the agent's perception, not a remote
// desktop.
//
// Frames arrive on the `computer.snapshot` event; the timeline is built from
// `computer.action` / `computer.refusal` / `computer.consent_required`.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Ban, Check, Eye, Hand, KeyRound, Keyboard, MonitorCog, ShieldQuestion,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { openAuthenticatedEventSource } from '@/platform/authTransport.js';
import type { ComputerRuntime } from '@/platform/HttpPlatformClient.js';

interface TimelineEntry {
  id: string;
  at: number;
  kind: 'action' | 'refusal' | 'consent';
  action: string;
  appLabel: string;
  target?: string;
  /** `synthetic` and `clipboard` are the tiers that take over the screen. */
  path?: string;
  verified?: boolean;
  message?: string;
}

interface PendingConsent {
  requestId: string;
  appIdentity: string;
  appLabel: string;
  action: string;
  summary: string;
  path: string;
  expiresAt: number;
}

interface Grant {
  appIdentity: string;
  appLabel: string;
  decision: 'always_allow' | 'deny';
  scope: string;
  grantedAt: string;
}

interface Props {
  workspaceId?: string;
  embedded?: boolean;
}

const MAX_ENTRIES = 60;

/** Synthetic input is the only tier that can steal focus — worth calling out. */
function tookScreen(path?: string): boolean {
  return path === 'synthetic' || path === 'clipboard';
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function iconFor(entry: TimelineEntry): React.ReactNode {
  if (entry.kind === 'refusal') return <Ban className="h-3.5 w-3.5 text-destructive" />;
  if (entry.kind === 'consent') return <ShieldQuestion className="h-3.5 w-3.5 text-warning" />;
  if (entry.action === 'snapshot') return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
  if (tookScreen(entry.path)) return <Keyboard className="h-3.5 w-3.5 text-warning" />;
  return <Hand className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function ComputerPanel({ workspaceId, embedded }: Props): React.JSX.Element {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [windowTitle, setWindowTitle] = useState<string>('');
  const [live, setLive] = useState(false);
  const [consent, setConsent] = useState<PendingConsent | null>(null);
  const [answering, setAnswering] = useState(false);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [showGrants, setShowGrants] = useState(false);
  const [runtime, setRuntime] = useState<ComputerRuntime | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  const loadRuntime = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/computer/runtime`, { cache: 'no-store' });
      if (res.ok) setRuntime((await res.json()) as ComputerRuntime);
    } catch {
      // Non-fatal — the panel still works without a status line.
    }
  }, [workspaceId]);

  const controlRuntime = useCallback(
    async (action: 'start' | 'restart' | 'stop') => {
      if (!workspaceId) return;
      setRuntimeBusy(true);
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/computer/runtime`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (res.ok) setRuntime((await res.json()) as ComputerRuntime);
      } catch {
        // Leave the previous status rather than blanking it.
      } finally {
        setRuntimeBusy(false);
      }
    },
    [workspaceId],
  );

  const loadGrants = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/computer/grants`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { grants?: Grant[] };
      setGrants(body.grants ?? []);
    } catch {
      // Non-fatal.
    }
  }, [workspaceId]);

  const revokeGrant = useCallback(
    async (appIdentity: string) => {
      if (!workspaceId) return;
      try {
        await fetch(
          `/api/workspaces/${workspaceId}/computer/grants/${encodeURIComponent(appIdentity)}`,
          { method: 'DELETE' },
        );
      } finally {
        await loadGrants();
      }
    },
    [workspaceId, loadGrants],
  );

  const answerConsent = useCallback(
    async (decision: 'allow_once' | 'always_allow' | 'deny') => {
      if (!workspaceId || !consent) return;
      setAnswering(true);
      try {
        await fetch(`/api/workspaces/${workspaceId}/computer/consent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: consent.requestId,
            appIdentity: consent.appIdentity,
            decision,
          }),
        });
      } catch {
        // The prompt expires into a denial on the server either way.
      } finally {
        setAnswering(false);
        setConsent(null);
        // An `always_allow` just created a standing grant; refresh so the user
        // can see (and undo) what they granted without reopening the panel.
        if (decision === 'always_allow') void loadGrants();
      }
    },
    [workspaceId, consent, loadGrants],
  );

  // A prompt the user never answers is a denial, so the card must disappear on
  // its own rather than sit there offering buttons that no longer do anything.
  useEffect(() => {
    if (!consent) return;
    const remaining = consent.expiresAt - Date.now();
    if (remaining <= 0) {
      setConsent(null);
      return;
    }
    const timer = setTimeout(() => setConsent(null), remaining);
    return () => clearTimeout(timer);
  }, [consent]);

  const loadFrame = useCallback(
    async (artifactId: string) => {
      if (!workspaceId) return;
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/computer/frames/${encodeURIComponent(artifactId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const url = URL.createObjectURL(await res.blob());
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setFrameSrc(url);
      } catch {
        // A missing frame just means the panel keeps the previous one.
      }
    },
    [workspaceId],
  );

  // Seed from history so opening the panel mid-task shows the latest window
  // and what led to it, rather than an empty box until the agent acts again.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [framesRes, activityRes, consentRes] = await Promise.all([
          fetch(`/api/workspaces/${workspaceId}/computer/frames`, { cache: 'no-store' }),
          fetch(`/api/workspaces/${workspaceId}/computer/activity`, { cache: 'no-store' }),
          fetch(`/api/workspaces/${workspaceId}/computer/consent`, { cache: 'no-store' }),
        ]);
        // Seeded FIRST: this panel is usually opened *by* a consent prompt, so
        // it subscribes to the stream a moment after the event it exists for.
        if (consentRes.ok && !cancelled) {
          const body = (await consentRes.json()) as { pending?: PendingConsent[] };
          const first = body.pending?.[0];
          if (first) setConsent(first);
        }
        if (framesRes.ok) {
          const body = (await framesRes.json()) as { frames?: Array<{ id: string }> };
          const newest = body.frames?.[0];
          if (!cancelled && newest) await loadFrame(newest.id);
        }
        if (activityRes.ok && !cancelled) {
          const body = (await activityRes.json()) as {
            entries?: Array<{
              action: string; appLabel: string; target: string | null; path: string | null;
              verified: boolean; refusalCode: string | null; createdAt: string;
            }>;
          };
          const seeded: TimelineEntry[] = (body.entries ?? []).map((e, i) => ({
            id: `seed-${i}`,
            at: new Date(e.createdAt).getTime(),
            kind: e.refusalCode ? 'refusal' : 'action',
            action: e.action,
            appLabel: e.appLabel,
            ...(e.target ? { target: e.target } : {}),
            ...(e.path ? { path: e.path } : {}),
            verified: e.verified,
            ...(e.refusalCode ? { message: e.refusalCode } : {}),
          }));
          setEntries(seeded.reverse().slice(0, MAX_ENTRIES));
        }
      } catch {
        // Non-fatal — the live feed still works.
      }
    })();
    void loadGrants();
    void loadRuntime();
    return () => { cancelled = true; };
  }, [workspaceId, loadFrame, loadGrants, loadRuntime]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    const es = openAuthenticatedEventSource(
      `/api/stream?scope=session&id=${encodeURIComponent('computer:' + workspaceId)}&filter=computer.`,
      { scope: 'session', id: `computer:${workspaceId}` },
      {
        onOpen: () => setLive(true),
        onError: () => setLive(false),
        onMessage: (e) => {
          let frame: { kind?: string; payload?: unknown; data?: unknown };
          try {
            frame = JSON.parse(e.data) as typeof frame;
          } catch {
            return;
          }
          // The unified stream wraps events as `{kind, payload}`; `data` is the
          // shape the EventBus uses internally. Accept both so this keeps
          // working if the panel is ever fed straight off the bus.
          const raw = frame.payload ?? frame.data;
          const d = (typeof raw === 'string' ? safeParse(raw) : raw) as Record<string, unknown> ?? {};
          const push = (entry: Omit<TimelineEntry, 'id' | 'at'>) =>
            setEntries((prev) =>
              [{ ...entry, id: `${Date.now()}-${Math.random()}`, at: Date.now() }, ...prev].slice(0, MAX_ENTRIES),
            );

          switch (frame.kind) {
            case 'computer.session_started':
              push({ kind: 'action', action: 'session started', appLabel: String(d['provider'] ?? '') });
              break;
            case 'computer.snapshot':
              setWindowTitle(String(d['windowTitle'] ?? ''));
              if (typeof d['artifactId'] === 'string') void loadFrame(d['artifactId']);
              push({
                kind: 'action',
                action: 'snapshot',
                appLabel: String(d['appLabel'] ?? ''),
                target: `${String(d['elementCount'] ?? 0)} elements`,
              });
              break;
            case 'computer.action':
              push({
                kind: 'action',
                action: String(d['action'] ?? ''),
                appLabel: String(d['appLabel'] ?? ''),
                ...(typeof d['target'] === 'string' ? { target: d['target'] } : {}),
                ...(typeof d['path'] === 'string' ? { path: d['path'] } : {}),
                verified: d['verified'] === true,
              });
              break;
            case 'computer.refusal':
              push({
                kind: 'refusal',
                action: String(d['action'] ?? ''),
                appLabel: String(d['appLabel'] ?? ''),
                message: `${String(d['code'] ?? '')} — ${String(d['message'] ?? '')}`,
              });
              break;
            case 'computer.consent_required':
              setConsent({
                requestId: String(d['requestId'] ?? ''),
                appIdentity: String(d['appIdentity'] ?? ''),
                appLabel: String(d['appLabel'] ?? ''),
                action: String(d['action'] ?? ''),
                summary: String(d['summary'] ?? ''),
                path: String(d['path'] ?? ''),
                expiresAt: Number(d['expiresAt'] ?? 0),
              });
              push({
                kind: 'consent',
                action: String(d['action'] ?? ''),
                appLabel: String(d['appLabel'] ?? ''),
                message: String(d['summary'] ?? ''),
              });
              break;
            case 'computer.consent_resolved':
              setConsent(null);
              break;
            default:
              break;
          }
        },
      },
    );
    return () => es.close();
  }, [workspaceId, loadFrame]);

  if (!workspaceId) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Computer Use is not available until this chat has a workspace.
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', embedded && 'bg-background')}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <MonitorCog className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate text-xs font-medium text-foreground">
          {windowTitle || 'Computer Use'}
        </span>
        {grants.length > 0 && (
          <button
            type="button"
            onClick={() => setShowGrants((v) => !v)}
            aria-expanded={showGrants}
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground"
          >
            <KeyRound className="h-3 w-3" />
            {grants.length} allowed
          </button>
        )}
        <span
          className={cn(
            'flex items-center gap-1.5 text-[11px]',
            grants.length > 0 ? '' : 'ml-auto',
            live ? 'text-muted-foreground' : 'text-muted-foreground/60',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-success' : 'bg-muted-foreground/40')} />
          {live ? 'Watching' : 'Idle'}
        </span>
      </div>

      {runtime && runtime.enabled && runtime.state !== 'ready' && (
        <div className="shrink-0 border-b border-border bg-subtle/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                runtime.state === 'stopped' ? 'bg-muted-foreground/40' : 'bg-warning',
              )}
            />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              {runtime.state === 'stopped'
                ? 'Desktop driver is not started'
                : runtime.state === 'degraded'
                  ? 'Desktop driver reports problems'
                  : 'Desktop driver unavailable'}
            </span>
            {runtime.state !== 'unavailable' && (
              <button
                type="button"
                disabled={runtimeBusy}
                onClick={() => void controlRuntime(runtime.state === 'stopped' ? 'start' : 'restart')}
                className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-subtle disabled:opacity-50"
              >
                {runtimeBusy ? 'Working…' : runtime.state === 'stopped' ? 'Start' : 'Restart'}
              </button>
            )}
          </div>
          {runtime.detail && (
            <p className="mt-1 text-[11px] text-muted-foreground">{runtime.detail}</p>
          )}
        </div>
      )}

      {showGrants && grants.length > 0 && (
        <div className="shrink-0 border-b border-border bg-subtle/30 px-3 py-2">
          <p className="mb-1.5 text-[11px] text-muted-foreground">
            Apps you told the agent it may always use in this workspace.
          </p>
          <ul className="space-y-1">
            {grants.map((g) => (
              <li key={g.appIdentity} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-foreground" title={g.appIdentity}>
                  {g.appLabel || g.appIdentity}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{g.scope}</span>
                <button
                  type="button"
                  onClick={() => void revokeGrant(g.appIdentity)}
                  className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-subtle"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {consent && (
          <div className="shrink-0 border-b border-warning/40 bg-warning/10 p-3">
            <div className="flex items-start gap-2">
              <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">
                  Allow <span className="font-semibold">{consent.action}</span> on{' '}
                  <span className="font-semibold">{consent.appLabel}</span>?
                </p>
                {consent.summary && (
                  <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{consent.summary}</p>
                )}
                {tookScreen(consent.path) && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-warning">
                    <AlertTriangle className="h-3 w-3" />
                    This takes over your keyboard and mouse.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={answering}
                onClick={() => void answerConsent('allow_once')}
                className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Allow once
              </button>
              {/* Synthetic input is never persisted as a standing grant, so
                  offering the option here would promise something the server
                  deliberately downgrades. */}
              {!tookScreen(consent.path) && (
                <button
                  type="button"
                  disabled={answering}
                  onClick={() => void answerConsent('always_allow')}
                  className="rounded border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-subtle disabled:opacity-50"
                >
                  Always allow this app
                </button>
              )}
              <button
                type="button"
                disabled={answering}
                onClick={() => void answerConsent('deny')}
                className="rounded border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-subtle disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          </div>
        )}

        <div className="flex min-h-[8rem] flex-[3] items-center justify-center overflow-auto bg-subtle/40 p-2">
          {frameSrc ? (
            <img
              src={frameSrc}
              alt="Most recent window the agent read"
              className="max-h-full max-w-full rounded border border-border object-contain shadow-sm"
            />
          ) : (
            <div className="max-w-xs text-center text-xs text-muted-foreground">
              <MonitorCog className="mx-auto mb-2 h-6 w-6 opacity-40" />
              No window captured yet. Frames appear here each time the agent reads a
              window — only the window it targets, never your whole screen.
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-[2] flex-col border-t border-border">
          <div className="shrink-0 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Activity
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {entries.length === 0 ? (
              <p className="px-1 py-3 text-xs text-muted-foreground">
                Nothing yet. Every desktop action the agent takes is listed here as it happens.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-start gap-2 rounded px-1.5 py-1 text-xs hover:bg-subtle"
                  >
                    <span className="mt-0.5 shrink-0">{iconFor(entry)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-foreground">{entry.action}</span>
                      {entry.appLabel && (
                        <span className="text-muted-foreground"> · {entry.appLabel}</span>
                      )}
                      {entry.target && (
                        <span className="text-muted-foreground"> · {entry.target}</span>
                      )}
                      {entry.message && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {entry.message}
                        </span>
                      )}
                      {tookScreen(entry.path) && (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-warning">
                          <AlertTriangle className="h-3 w-3" />
                          took over the screen
                        </span>
                      )}
                    </span>
                    {entry.kind === 'action' && entry.verified && (
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
