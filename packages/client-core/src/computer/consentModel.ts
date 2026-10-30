// ────────────────────────────────────────────────────────────────
// Computer consent + control read model (G-07).
//
// What a Computer panel / consent card draws for one workspace: the prompts
// still awaiting an answer (with the batch `plan` when one request carries
// several actions), who drives the desktop (`agent | paused | user`), and
// which answers — and which "this app / any app" reach — a prompt may be
// given. Seeded from `GET /workspaces/:id/computer/consent` and `/control`,
// kept live by the workspace-scope events `computer.consent_required`,
// `computer.consent_resolved` and `computer.control_changed`.
//
// React-free: web wraps it in hooks, mobile in its own container.
// ────────────────────────────────────────────────────────────────

import type {
  ComputerConsentDecision,
  ComputerConsentReach,
  ComputerControlMode,
  ComputerControlState,
  ComputerPendingConsent,
} from '@generatorai/shared';

export interface ComputerDeskState {
  workspaceId: string;
  /** Prompts awaiting an answer, oldest first. */
  pending: ComputerPendingConsent[];
  /** Null until the control state has been read (unknown, not "agent"). */
  control: ComputerControlState | null;
}

export function initialComputerDeskState(workspaceId: string): ComputerDeskState {
  return { workspaceId, pending: [], control: null };
}

/** Seed from the two REST reads; either may be absent. */
export function seedComputerDesk(
  state: ComputerDeskState,
  seed: { pending?: ComputerPendingConsent[]; control?: ComputerControlState },
): ComputerDeskState {
  return {
    ...state,
    ...(seed.pending ? { pending: [...seed.pending].sort((a, b) => a.expiresAt - b.expiresAt) } : {}),
    ...(seed.control ? { control: seed.control } : {}),
  };
}

/** The workspace-scope event kinds this model folds (for a stream filter). */
export const COMPUTER_DESK_EVENT_KINDS = [
  'computer.consent_required',
  'computer.consent_resolved',
  'computer.control_changed',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMode(value: unknown): value is ComputerControlMode {
  return value === 'agent' || value === 'paused' || value === 'user';
}

/** Fold one stream event. Unknown kinds, other workspaces and malformed payloads are ignored. */
export function applyComputerEvent(
  state: ComputerDeskState,
  event: { kind: string; data?: unknown },
): ComputerDeskState {
  const data = event.data;
  if (!isRecord(data) || data['workspaceId'] !== state.workspaceId) return state;
  switch (event.kind) {
    case 'computer.consent_required': {
      if (typeof data['requestId'] !== 'string' || typeof data['expiresAt'] !== 'number') return state;
      const prompt = data as unknown as ComputerPendingConsent;
      const rest = state.pending.filter((p) => p.requestId !== prompt.requestId);
      return { ...state, pending: [...rest, prompt].sort((a, b) => a.expiresAt - b.expiresAt) };
    }
    case 'computer.consent_resolved': {
      const requestId = data['requestId'];
      if (!state.pending.some((p) => p.requestId === requestId)) return state;
      return { ...state, pending: state.pending.filter((p) => p.requestId !== requestId) };
    }
    case 'computer.control_changed': {
      if (!isMode(data['mode'])) return state;
      const changedAt = typeof data['changedAt'] === 'number' ? data['changedAt'] : null;
      return { ...state, control: { workspaceId: state.workspaceId, mode: data['mode'], changedAt } };
    }
    default:
      return state;
  }
}

/** Prompts still answerable at `now`, optionally only those raised by one chat. */
export function selectPendingConsent(
  state: ComputerDeskState,
  opts: { now?: number; chatId?: string } = {},
): ComputerPendingConsent[] {
  const now = opts.now ?? Date.now();
  return state.pending.filter((p) => p.expiresAt > now && (!opts.chatId || !p.chatId || p.chatId === opts.chatId));
}

/** True only when the control state is known and is `agent`. */
export function agentHasControl(state: ComputerDeskState): boolean {
  return state.control?.mode === 'agent';
}

/** One answer a consent card may offer, with the reaches it can be given. */
export interface ConsentAnswerOption {
  decision: ComputerConsentDecision;
  /** First entry is the default; one entry = no Scope segment for this answer. */
  scopes: ComputerConsentReach[];
}

/**
 * The answers a prompt may be given, mirroring the server's rules: a
 * synthetic (pointer/keyboard) prompt can never be answered `always_allow`,
 * and a deny or a one-off allow is always for this app.
 */
export function consentAnswerOptions(prompt: Pick<ComputerPendingConsent, 'path'>): ConsentAnswerOption[] {
  const options: ConsentAnswerOption[] = [
    { decision: 'allow_once', scopes: ['app'] },
    { decision: 'allow_run', scopes: ['app', 'any'] },
  ];
  if (prompt.path !== 'synthetic') options.push({ decision: 'always_allow', scopes: ['app', 'any'] });
  options.push({ decision: 'deny', scopes: ['app'] });
  return options;
}
