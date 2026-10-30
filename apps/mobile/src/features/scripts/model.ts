// ────────────────────────────────────────────────────────────────
// Workflow scripts — pure view logic for the Scripts segment and screen.
//
// The admin client types these routes loosely (`ScriptSummary`) but the
// server actually returns:
//   GET  /workflow-scripts          ScriptMetadata[]
//   GET  /workflow-scripts/:id      { metadata, graph }   (graph: WorkflowGraph)
//   GET  /workflow-scripts/:id/profiles  RunProfile[] (stageOverrides by key,
//        permission mode at `overrides.permissionMode`)
// so every read here is defensive. A script runs through
// `workflows.invoke({ target: { kind: 'script', scriptId }, profile })`.
//
// Tested in src/__tests__/scriptModel.test.ts.
// ────────────────────────────────────────────────────────────────

export interface ScriptProfileView {
  name: string;
  description: string | null;
  /** Variables the profile pre-fills. */
  variables: Record<string, unknown>;
  permissionMode: string | null;
  skippedStages: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);





export function parseScriptProfiles(raw: unknown): ScriptProfileView[] {
  if (!Array.isArray(raw)) return [];
  const out: ScriptProfileView[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const name = str(r['name']);
    if (!name) continue;
    const vars = r['variables'];
    const overrides = Array.isArray(r['stageOverrides']) ? r['stageOverrides'] : [];
    out.push({
      name,
      description: str(r['description']),
      variables: vars && typeof vars === 'object' && !Array.isArray(vars) ? (vars as Record<string, unknown>) : {},
      permissionMode: str(obj(r['overrides'])['permissionMode']),
      skippedStages: overrides.filter((o) => o && typeof o === 'object' && (o as { skip?: unknown }).skip === true).length,
    });
  }
  return out;
}

/** "Pre-fills 2 inputs · skips 1 stage" */
export function profileSummary(profile: ScriptProfileView): string | null {
  const parts: string[] = [];
  const n = Object.keys(profile.variables).length;
  if (n > 0) parts.push(`pre-fills ${n} input${n === 1 ? '' : 's'}`);
  if (profile.skippedStages > 0) parts.push(`skips ${profile.skippedStages} stage${profile.skippedStages === 1 ? '' : 's'}`);
  if (profile.permissionMode) parts.push(`permissions: ${profile.permissionMode}`);
  if (parts.length === 0) return null;
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
