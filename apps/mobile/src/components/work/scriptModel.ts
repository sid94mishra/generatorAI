// ────────────────────────────────────────────────────────────────
// Workflow scripts — pure view logic for the Scripts segment and screen.
//
// The admin client types these routes loosely (`ScriptSummary`,
// `RunSummary`) but the server actually returns:
//   GET  /workflow-scripts          ScriptMetadata[]
//   GET  /workflow-scripts/:id      { metadata, definition, stages, edges }
//   GET  /workflow-scripts/:id/profiles  RunProfileConfig[]
//   POST /workflow-scripts/:id/run  { definitionId, runId, status }
// so every read here is defensive.
//
// Tested in src/__tests__/scriptModel.test.ts.
// ────────────────────────────────────────────────────────────────

export interface ScriptRowView {
  id: string;
  name: string;
  description: string | null;
  stageCount: number;
  profileCount: number;
  tags: string[];
}

export interface ScriptProfileView {
  name: string;
  description: string | null;
  /** Variables the profile pre-fills. */
  variables: Record<string, unknown>;
  permissionMode: string | null;
  skippedStages: number;
}

export interface ScriptDetailView extends ScriptRowView {
  /** Raw declared variables, fed to `parseVariables`. */
  variables: unknown;
  stages: Array<{ id: string; name: string; description: string | null }>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function parseScriptRow(raw: unknown): ScriptRowView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r['id']);
  if (!id) return null;
  return {
    id,
    name: str(r['name']) ?? id,
    description: str(r['description']),
    stageCount: num(r['stageCount']),
    profileCount: num(r['profileCount']) || (Array.isArray(r['profiles']) ? r['profiles'].length : 0),
    tags: strings(r['tags']),
  };
}

export function parseScriptRows(raw: unknown): ScriptRowView[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseScriptRow).filter((r): r is ScriptRowView => r !== null);
}

/** "3 stages · 2 profiles" */
export function scriptSubtitle(row: Pick<ScriptRowView, 'stageCount' | 'profileCount' | 'description'>): string {
  const parts = [`${row.stageCount} stage${row.stageCount === 1 ? '' : 's'}`];
  if (row.profileCount > 0) parts.push(`${row.profileCount} profile${row.profileCount === 1 ? '' : 's'}`);
  if (row.description) parts.push(row.description);
  return parts.join(' · ');
}

export function parseScriptDetail(raw: unknown, fallbackId: string): ScriptDetailView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // New shape nests metadata; an older/flat payload is the metadata itself.
  const meta = (r['metadata'] && typeof r['metadata'] === 'object' ? r['metadata'] : r) as Record<string, unknown>;
  const definition = (r['definition'] && typeof r['definition'] === 'object' ? r['definition'] : {}) as Record<string, unknown>;
  const row = parseScriptRow({ id: fallbackId, ...meta });
  if (!row) return null;
  const rawStages = Array.isArray(r['stages']) ? r['stages'] : [];
  const stages = rawStages.map((s, index) => {
    const stage = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const config = (stage['config'] && typeof stage['config'] === 'object' ? stage['config'] : stage) as Record<string, unknown>;
    const id = str(stage['localId']) ?? str(stage['id']) ?? `${index}`;
    return { id, name: str(config['name']) ?? id, description: str(config['description']) };
  });
  return {
    ...row,
    stageCount: row.stageCount || stages.length,
    variables: definition['variables'] ?? meta['variables'],
    stages,
  };
}

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
      permissionMode: str(r['permissionMode']),
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

/**
 * Variable defaults for the run form: the declared defaults with the chosen
 * profile's values on top (the server merges request variables over the
 * profile's, so pre-filling shows the user what will actually be sent).
 */
export function applyProfileDefaults(rawVariables: unknown, profile: ScriptProfileView | null): unknown {
  if (!profile || !Array.isArray(rawVariables)) return rawVariables;
  return rawVariables.map((v) => {
    if (!v || typeof v !== 'object') return v;
    const name = (v as { name?: unknown }).name;
    return typeof name === 'string' && name in profile.variables
      ? { ...(v as object), defaultValue: profile.variables[name] }
      : v;
  });
}

/** The run id a `POST /workflow-scripts/:id/run` response names. */
export function scriptRunIdOf(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as { runId?: unknown; id?: unknown };
  return str(r.runId) ?? str(r.id);
}
