// ────────────────────────────────────────────────────────────────
// computerModel — the pure half of the Computer pane.
//
// Shapes mirror `apps/server/src/routes/computer.ts` and the web
// `ComputerPanel.tsx` that reads them:
//   GET  /computer/frames     { enabled, frames: [{id, createdAt, width?, height?}] } newest first
//   GET  /computer/activity   { entries: [{action, appLabel, target, path, verified, refusalCode, artifactId, createdAt}] } oldest first
//   GET  /computer/consent    { pending: PendingConsent[] }
//   POST /computer/consent    { requestId, appIdentity, decision } → 409 NOT_PENDING when gone
//   GET  /computer/grants     { grants: Grant[] }
//   DELETE /computer/grants/:appIdentity
// ────────────────────────────────────────────────────────────────

export interface ComputerFrame {
  id: string;
  createdAt: string;
  width?: number;
  height?: number;
}

export interface ComputerActivityEntry {
  action: string;
  appLabel: string;
  target: string | null;
  path: string | null;
  verified?: boolean;
  refusalCode: string | null;
  artifactId: string | null;
  createdAt: string;
}

export interface PendingConsent {
  requestId: string;
  appIdentity: string;
  appLabel: string;
  action: string;
  summary: string;
  path: string;
  expiresAt: number;
}

export interface ComputerGrant {
  appIdentity: string;
  appLabel: string;
  decision: 'always_allow' | 'deny';
  scope: string;
  grantedAt: string;
}

export type ConsentDecision = 'allow_once' | 'allow_run' | 'always_allow' | 'deny';

/** Synthetic input and the clipboard tier take over the real keyboard and mouse. */
export function tookScreen(path: string | null | undefined): boolean {
  return path === 'synthetic' || path === 'clipboard';
}

/** The prompt to show: the oldest one that has not expired. */
export function activeConsent(pending: readonly PendingConsent[] | undefined, now = Date.now()): PendingConsent | null {
  const live = (pending ?? []).filter((p) => p.expiresAt > now);
  live.sort((a, b) => a.expiresAt - b.expiresAt);
  return live[0] ?? null;
}

export interface ConsentOption {
  decision: ConsentDecision;
  label: string;
  tone: 'primary' | 'secondary' | 'danger';
  /** Allowing hands the agent the desktop; those answers need a step-up. */
  needsStepUp: boolean;
}

/**
 * The answers on offer, in web's order. "Always allow" is withheld for
 * synthetic input: the server never persists that as a standing grant, so
 * offering it would promise something it deliberately downgrades.
 */
export function consentOptions(consent: Pick<PendingConsent, 'path'>): ConsentOption[] {
  const out: ConsentOption[] = [
    { decision: 'allow_once', label: 'Allow once', tone: 'primary', needsStepUp: true },
    { decision: 'allow_run', label: 'Allow all this run', tone: 'secondary', needsStepUp: true },
  ];
  if (!tookScreen(consent.path)) {
    out.push({ decision: 'always_allow', label: 'Always allow this app', tone: 'secondary', needsStepUp: true });
  }
  out.push({ decision: 'deny', label: 'Deny', tone: 'danger', needsStepUp: false });
  return out;
}

export interface ActivityRow {
  key: string;
  title: string;
  subtitle: string | null;
  tone: 'neutral' | 'warning' | 'danger';
  createdAt: string;
  artifactId: string | null;
}

/** Newest first, capped, with a readable title per audit row. */
export function activityRows(entries: readonly ComputerActivityEntry[] | undefined, max = 30): ActivityRow[] {
  const list = [...(entries ?? [])].reverse().slice(0, max);
  return list.map((e, i) => {
    const verb = e.action.replace(/^computer_/, '').replace(/_/g, ' ');
    const refused = Boolean(e.refusalCode);
    const parts: string[] = [];
    if (e.target) parts.push(e.target);
    if (refused) parts.push(`refused: ${e.refusalCode}`);
    else if (tookScreen(e.path)) parts.push('took over keyboard and mouse');
    return {
      key: `${e.createdAt}:${i}`,
      title: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} · ${e.appLabel || 'desktop'}`,
      subtitle: parts.length > 0 ? parts.join(' · ') : null,
      tone: refused ? 'danger' : tookScreen(e.path) ? 'warning' : 'neutral',
      createdAt: e.createdAt,
      artifactId: e.artifactId,
    };
  });
}

/** Seconds left on a prompt, for "expires in 42s". */
export function secondsLeft(consent: Pick<PendingConsent, 'expiresAt'>, now = Date.now()): number {
  return Math.max(0, Math.ceil((consent.expiresAt - now) / 1000));
}
