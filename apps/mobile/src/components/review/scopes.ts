// ────────────────────────────────────────────────────────────────
// Review / workspace scope gating — pure.
//
// `featureGate.ts` covers the Phase-5 features (terminal, browser, voice…).
// The workbench needs three more answers, taken from the server's route
// policy (`packages/auth/src/routePolicy.ts`):
//
//   /workspaces/:id/review   read: read:reviews     write: write:reviews
//   /workspaces/**           read: read:workspaces  write: write:workspaces
//   /chats/**                read: read:chats       write: write:chats
//
// Every control that would 403 is gated here and says why, instead of
// rendering a button that fails. Written for a person, not a log line.
// ────────────────────────────────────────────────────────────────

export type WorkbenchCapability =
  | 'readReviews'
  | 'writeReviews'
  | 'restoreCheckpoints'
  | 'commit'
  | 'decidePlan'
  | 'cancelTask';

interface Requirement {
  scopes: readonly string[];
  reason: string;
}

export const WORKBENCH_REQUIREMENTS: Record<WorkbenchCapability, Requirement> = {
  readReviews: {
    scopes: ['read:reviews'],
    reason: 'Reading review comments needs the review-read permission, which this device was not granted.',
  },
  writeReviews: {
    scopes: ['write:reviews'],
    reason: 'Leaving review comments needs the review-write permission. Grant it from a trusted device.',
  },
  restoreCheckpoints: {
    scopes: ['write:workspaces'],
    reason: 'Discarding files and rewinding change the workspace on your machine, which needs workspace-write permission.',
  },
  commit: {
    scopes: ['write:workspaces'],
    reason: 'Committing and opening pull requests needs workspace-write permission.',
  },
  decidePlan: {
    scopes: ['write:chats'],
    reason: 'Deciding on a plan sends a message to the agent, which needs chat-write permission.',
  },
  cancelTask: {
    scopes: ['write:chats'],
    reason: 'Cancelling a worker stops its turn, which needs chat-write permission.',
  },
};

export interface CapabilityCheck {
  available: boolean;
  missing: string[];
  reason: string | null;
}

export function checkCapability(
  capability: WorkbenchCapability,
  grantedScopes: readonly string[],
): CapabilityCheck {
  const requirement = WORKBENCH_REQUIREMENTS[capability];
  const granted = new Set(grantedScopes);
  const missing = requirement.scopes.filter((scope) => !granted.has(scope));
  return missing.length === 0
    ? { available: true, missing: [], reason: null }
    : { available: false, missing, reason: requirement.reason };
}
