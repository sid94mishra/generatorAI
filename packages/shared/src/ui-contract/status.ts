// ────────────────────────────────────────────────────────────────
// Status badge contract (D-18, D-40; 07 M-11). Types only: web
// (apps/web/src/ui/primitives/StatusBadge) and, next pass, mobile render the
// same props. Imports the state list from ../status/states.ts directly, never
// the package root, so the Electron main bundle stays clean.
// ────────────────────────────────────────────────────────────────

import type { StatusState } from '../status/states.js';

/** Which vocabulary the word comes from: chats say "Done", runs say "Succeeded". */
export type StatusContext = 'chat' | 'run';

export interface StatusBadgeProps {
  /** One of the 8 visual states. Callers map server values with `resolveStatus` / `toStatus`. */
  state: StatusState;
  /** Default `run`. `chat` renders `succeeded` as "Done". */
  context?: StatusContext;
  /** Overrides the word (a mapping's label: "Cancelled", "Needs review" …). */
  label?: string;
  /** Running sub-phase, rendered "Running · Finalizing". */
  phase?: string;
}
