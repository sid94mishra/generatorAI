// ────────────────────────────────────────────────────────────────
// graphDiff — a readable structural diff of two workflow graphs (the
// builder's version history, P07 WP-7.6): stages added, removed and
// changed (with the fields that changed), edges added, removed and
// changed, and the workflow settings that changed. Canvas positions are
// layout, not behaviour, and are left out.
// ────────────────────────────────────────────────────────────────

import type { EdgeSpec, StageSpec, WorkflowGraph } from '@generatorai/workflow-spec';

export interface FieldChange {
  /** Dotted path of the changed field (`output.schema`, `prompts`). */
  path: string;
  before: unknown;
  after: unknown;
}

export interface StageChange {
  key: string;
  name: string;
  kind: string;
  fields: FieldChange[];
}

export interface GraphDiff {
  stagesAdded: StageSpec[];
  stagesRemoved: StageSpec[];
  stagesChanged: StageChange[];
  edgesAdded: EdgeSpec[];
  edgesRemoved: EdgeSpec[];
  edgesChanged: Array<{ from: string; to: string; fields: FieldChange[] }>;
  workflow: FieldChange[];
}

const IGNORED_STAGE_FIELDS = new Set(['position']);

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The changed fields of two values, descending into objects up to `depth`
 * levels (deeper differences are reported at that level as a whole).
 */
function fieldChanges(before: unknown, after: unknown, prefix: string, depth: number, ignored?: ReadonlySet<string>): FieldChange[] {
  if (stable(before) === stable(after)) return [];
  if (depth > 0 && isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys
      .filter((k) => !ignored?.has(k))
      .flatMap((k) => fieldChanges(before[k], after[k], prefix ? `${prefix}.${k}` : k, depth - 1));
  }
  return [{ path: prefix || '(value)', before, after }];
}

const edgeKey = (e: EdgeSpec) => `${e.from}\u0000${e.to}`;

/** What changed from `before` to `after`. */
export function diffGraphs(before: WorkflowGraph, after: WorkflowGraph): GraphDiff {
  const oldStages = new Map(before.stages.map((s) => [s.key, s]));
  const newStages = new Map(after.stages.map((s) => [s.key, s]));
  const stagesChanged: StageChange[] = [];
  for (const [key, s] of newStages) {
    const old = oldStages.get(key);
    if (!old) continue;
    const fields = fieldChanges(old, s, '', 2, IGNORED_STAGE_FIELDS);
    if (fields.length > 0) stagesChanged.push({ key, name: s.name, kind: s.kind, fields });
  }

  const oldEdges = new Map(before.edges.map((e) => [edgeKey(e), e]));
  const newEdges = new Map(after.edges.map((e) => [edgeKey(e), e]));
  const edgesChanged: GraphDiff['edgesChanged'] = [];
  for (const [k, e] of newEdges) {
    const old = oldEdges.get(k);
    if (!old) continue;
    const fields = fieldChanges(old, e, '', 1);
    if (fields.length > 0) edgesChanged.push({ from: e.from, to: e.to, fields });
  }

  return {
    stagesAdded: after.stages.filter((s) => !oldStages.has(s.key)),
    stagesRemoved: before.stages.filter((s) => !newStages.has(s.key)),
    stagesChanged,
    edgesAdded: after.edges.filter((e) => !oldEdges.has(edgeKey(e))),
    edgesRemoved: before.edges.filter((e) => !newEdges.has(edgeKey(e))),
    edgesChanged,
    workflow: fieldChanges(before.workflow, after.workflow, '', 2),
  };
}

export function isEmptyDiff(d: GraphDiff): boolean {
  return (
    d.stagesAdded.length === 0 &&
    d.stagesRemoved.length === 0 &&
    d.stagesChanged.length === 0 &&
    d.edgesAdded.length === 0 &&
    d.edgesRemoved.length === 0 &&
    d.edgesChanged.length === 0 &&
    d.workflow.length === 0
  );
}

/** A short, one-line rendering of a field value. */
export function previewValue(value: unknown, max = 80): string {
  if (value === undefined) return '(unset)';
  const text = typeof value === 'string' ? JSON.stringify(value) : (JSON.stringify(value) ?? String(value));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
