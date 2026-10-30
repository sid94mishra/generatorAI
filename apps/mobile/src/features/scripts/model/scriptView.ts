// Scripts rules (MScripts, MScriptDetail; M7-04): the file name, the stage outline from the compiled graph (loops as
// groups, children indented), the edges line, and the run form's variables pre-filled from the chosen profile.
// Pure, unit-tested.

export interface ScriptMeta {
  id: string;
  name: string;
  description?: string;
  filePath?: string;
  stageCount?: number;
  profileCount?: number;
  tags?: string[];
  variables?: Array<{ name: string; type: string; label?: string; required?: boolean }>;
}

export function fileName(meta: Pick<ScriptMeta, 'filePath' | 'id'>): string {
  return meta.filePath?.split(/[\\/]/).pop() || `${meta.id}.workflow.mjs`;
}

export interface StageLine {
  key: string;
  name: string;
  kind: string;
  depth: number;
  index: number | null;
  agent: string | null;
  approval: boolean;
  /** Loops: "max 3". */
  detail: string | null;
}

type RawStage = { key?: unknown; name?: unknown; kind?: unknown; parentKey?: unknown; approval?: unknown; session?: { agentRef?: unknown } | null; loop?: { maxIterations?: unknown } | null };

/** Top-level stages numbered; a container's children follow it, indented (depth 1). */
export function stageOutline(graph: unknown): StageLine[] {
  const stages = (graph && typeof graph === 'object' && Array.isArray((graph as { stages?: unknown }).stages) ? (graph as { stages: RawStage[] }).stages : []).filter((s) => typeof s.key === 'string');
  const line = (s: RawStage, depth: number, index: number | null): StageLine => ({
    key: String(s.key),
    name: typeof s.name === 'string' ? s.name : String(s.key),
    kind: typeof s.kind === 'string' ? s.kind : 'agent',
    depth,
    index,
    agent: typeof s.session?.agentRef === 'string' ? s.session.agentRef : null,
    approval: Boolean(s.approval),
    detail: s.kind === 'loop' && typeof s.loop?.maxIterations === 'number' ? `Loop · max ${s.loop.maxIterations}` : null,
  });
  const out: StageLine[] = [];
  let n = 0;
  for (const s of stages.filter((x) => typeof x.parentKey !== 'string')) {
    n += 1;
    out.push(line(s, 0, n));
    for (const child of stages.filter((x) => x.parentKey === s.key)) out.push(line(child, 1, null));
  }
  return out;
}

/** "scan → assess_risk → open_pr" chains plus loose edges, from the graph's edges. */
export function edgeChips(graph: unknown): string[] {
  const edges = graph && typeof graph === 'object' && Array.isArray((graph as { edges?: unknown }).edges) ? (graph as { edges: Array<{ from?: unknown; to?: unknown }> }).edges : [];
  return edges.filter((e) => typeof e.from === 'string' && typeof e.to === 'string').map((e) => `${String(e.from)} → ${String(e.to)}`);
}

export interface VariableField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  value: string;
}

/** The declared inputs, each pre-filled with the profile's value (the server merges request values over it). */
export function variableFields(meta: Pick<ScriptMeta, 'variables'>, profileValues: Record<string, unknown> = {}): VariableField[] {
  return (meta.variables ?? []).map((v) => {
    const preset = profileValues[v.name];
    return { name: v.name, label: v.label || v.name, type: v.type, required: Boolean(v.required), value: preset === undefined || preset === null ? '' : typeof preset === 'string' ? preset : JSON.stringify(preset) };
  });
}

export function missingRequired(fields: readonly VariableField[]): string[] {
  return fields.filter((f) => f.required && !f.value.trim()).map((f) => f.label);
}

/** Typed request variables (numbers and booleans parsed; blanks left out so the profile's value stands). */
export function variablesBody(fields: readonly VariableField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = f.value.trim();
    if (!raw) continue;
    if (f.type === 'number' && !Number.isNaN(Number(raw))) out[f.name] = Number(raw);
    else if (f.type === 'boolean') out[f.name] = raw === 'true';
    else if (f.type === 'json' || f.type === 'object' || f.type === 'array') {
      try {
        out[f.name] = JSON.parse(raw);
      } catch {
        out[f.name] = raw;
      }
    } else out[f.name] = raw;
  }
  return out;
}
