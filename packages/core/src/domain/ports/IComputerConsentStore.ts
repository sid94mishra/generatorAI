// ────────────────────────────────────────────────────────────────
// IComputerConsentStore — Port for computer-use consent grants + prompts.
//
// These types used to be declared inside `services/ComputerService.ts`,
// which forced the infrastructure implementation (`PendingConsentStore`) to
// import FROM the application layer — a layering inversion the boundary
// lint (APPLICATION-REVIEW-2026-09 plan item 30) now rejects. They live
// here so both the service and its infrastructure adapters depend on the
// domain, not on each other. `ComputerService.ts` re-exports them, so
// existing importers (`@generatorai/core`, `packages/db`) are unaffected.
// ────────────────────────────────────────────────────────────────

import type { ComputerConsentDecision } from '@generatorai/shared';
import type { ComputerAppIdentity } from './IComputerBridge.js';

/**
 * Privilege tiers a consent grant can cover, in increasing order.
 *
 * A grant carries its scope so approving a prompt that read "snapshot in
 * Slack" cannot silently authorise every future click and keystroke in Slack.
 * Widening requires a fresh prompt.
 */
export type ComputerConsentScope = 'read' | 'mutate' | 'synthetic';

export interface ComputerStoredGrant {
  decision: 'always_allow' | 'deny';
  scope: ComputerConsentScope;
}

export interface ComputerConsentPrompt {
  requestId: string;
  workspaceId: string;
  chatId?: string;
  app: ComputerAppIdentity;
  action: string;
  summary: string;
  scope: ComputerConsentScope;
  /** The exact element this approval covers, when the action is fenced. */
  target?: { snapshotId: string; elementIndex: number; elementLabel: string };
  expiresAt: number;
}

/** Persistence + prompting seam. Backed by SQLite + the UI in Phase 5. */
export interface IComputerConsentStore {
  find(workspaceId: string, appIdentity: string): Promise<ComputerStoredGrant | null>;
  save(
    workspaceId: string,
    appIdentity: string,
    appLabel: string,
    decision: 'always_allow' | 'deny',
    scope: ComputerConsentScope,
  ): Promise<void>;
  /** Ask the user. The service enforces its own deadline on top of this. */
  prompt(request: ComputerConsentPrompt): Promise<ComputerConsentDecision>;
}
