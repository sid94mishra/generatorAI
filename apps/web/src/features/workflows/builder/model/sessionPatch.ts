// ────────────────────────────────────────────────────────────────
// sessionPatch — edit a (partial) `SessionSpec` with patch semantics: a key
// set to undefined is removed, and an emptied stage session is dropped, so
// clearing a picker really clears it when the graph is saved.
// ────────────────────────────────────────────────────────────────

import type { AgentStage, SessionSpec } from '@generatorai/workflow-spec';

/** Merge a patch into a session; keys set to undefined are removed. */
export function applySessionPatch(session: SessionSpec | undefined, updates: Partial<SessionSpec>): SessionSpec {
  const next: Record<string, unknown> = { ...(session ?? {}), ...updates };
  for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
  return next as SessionSpec;
}

/** The stage update that applies `updates` to a stage's session (dropping an emptied session). */
export function patchStageSession(stage: AgentStage, updates: Partial<SessionSpec>): Partial<AgentStage> {
  const next = applySessionPatch(stage.session, updates);
  return { session: Object.keys(next).length > 0 ? next : undefined };
}
