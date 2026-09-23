// ────────────────────────────────────────────────────────────────
// paneModel — the Computer tool's scope and feature check.
//
// Which tools a session offers, and in what order, now lives in
// `components/workbench/workbenchModel.ts`: the tools left the chat's pager
// for the workbench panel + sheet, and the availability rules moved with them.
// ────────────────────────────────────────────────────────────────

import { checkFeature, type FeatureAvailability } from '../../../auth/featureGate';

export const COMPUTER_SCOPE = 'exec:computer';

/**
 * The Computer pane: latest window frame, activity, consent answers and
 * standing grants (ComputerPane.tsx). Kept as a switch so the pane can be
 * withdrawn in one place if the server surface changes under it.
 */
export const COMPUTER_PANE_IMPLEMENTED = true;

/**
 * `exec:computer` as a feature check. Local rather than in featureGate.ts
 * (owned elsewhere) — same shape, so `LockedPane` renders it unchanged.
 * Grantable: it is a per-device opt-in, requested like terminal/browser.
 */
export function computerFeature(scopes: readonly string[]): FeatureAvailability {
  // Single source of truth for the requirement and its reason copy.
  return checkFeature('computer', scopes);
}
