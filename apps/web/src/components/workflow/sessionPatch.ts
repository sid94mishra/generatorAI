// ────────────────────────────────────────────────────────────────
// sessionPatch — edit a stage's partial `session` (merged over the
// workflow session at run time). Keys set to undefined are removed and
// an emptied session is dropped, so clearing a picker really clears it
// when the graph is saved.
// ────────────────────────────────────────────────────────────────

import type { AgentStage, SessionSpec } from '@generatorai/workflow-spec';

export function patchSession(stage: AgentStage, updates: Partial<SessionSpec>): Partial<AgentStage> {
  const next: Record<string, unknown> = { ...(stage.session ?? {}), ...updates };
  for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
  return { session: Object.keys(next).length > 0 ? (next as SessionSpec) : undefined };
}
