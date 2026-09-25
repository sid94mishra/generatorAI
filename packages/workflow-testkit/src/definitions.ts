// ────────────────────────────────────────────────────────────────
// Definition specs for tests.
//
// A test writes a workflow the way a person reads one — stages by name,
// edges as `[from, to, type]` — and `toImportJson` turns it into the
// canonical import document today's `POST /workflow-definitions/import-json`
// accepts, parsed through the SAME zod schema the route validates with (so
// defaults apply exactly as they do live).
// A document that already uses index edges passes through unchanged.
// ────────────────────────────────────────────────────────────────

import { ImportWorkflowJsonSchema, type ImportWorkflowJson } from '@generatorai/shared';

export type EdgeType = 'on_success' | 'on_failure' | 'on_completion' | 'always';

export interface StageSpec {
  name: string;
  /** Shorthand for one prompt labelled with the stage name. */
  prompt?: string;
  prompts?: Array<{ label?: string; text: string }>;
  order?: number;
  /** Any other import-schema stage field (retryPolicy, condition, …). */
  [field: string]: unknown;
}

export type EdgeSpec =
  | readonly [from: string, to: string, type?: EdgeType]
  | { from: string; to: string; edgeType?: EdgeType };

export interface WorkflowSpecJson {
  name?: string;
  stages: StageSpec[];
  edges?: EdgeSpec[] | ImportWorkflowJson['edges'];
  /** Any other import-schema definition field (sessionMode, variables, …). */
  [field: string]: unknown;
}

function isIndexEdge(e: unknown): e is { fromStageIndex: number; toStageIndex: number } {
  return !!e && typeof e === 'object' && 'fromStageIndex' in (e as Record<string, unknown>);
}

/** Convert a name-based spec into a parsed `ImportWorkflowJson`. */
export function toImportJson(spec: WorkflowSpecJson): ImportWorkflowJson {
  const { stages, edges = [], name, ...rest } = spec;
  const indexByName = new Map<string, number>();
  stages.forEach((s, i) => indexByName.set(s.name, i));

  const importStages = stages.map((s, i) => {
    const { prompt, prompts, order, ...fields } = s;
    return {
      ...fields,
      name: s.name,
      order: order ?? i,
      prompts: prompts
        ? prompts.map((p, j) => ({ label: p.label ?? `${s.name} ${j + 1}`, ...p }))
        : prompt !== undefined
          ? [{ label: s.name, text: prompt }]
          : [],
    };
  });

  const importEdges = (edges as unknown[]).map((e) => {
    if (isIndexEdge(e)) return e;
    const [from, to, edgeType] = Array.isArray(e)
      ? (e as [string, string, EdgeType?])
      : [(e as { from: string }).from, (e as { to: string }).to, (e as { edgeType?: EdgeType }).edgeType];
    const fromStageIndex = indexByName.get(from);
    const toStageIndex = indexByName.get(to);
    if (fromStageIndex === undefined) throw new Error(`edge ${from} -> ${to}: unknown stage "${from}"`);
    if (toStageIndex === undefined) throw new Error(`edge ${from} -> ${to}: unknown stage "${to}"`);
    return { fromStageIndex, toStageIndex, edgeType: edgeType ?? 'on_success' };
  });

  return ImportWorkflowJsonSchema.parse({
    ...rest,
    name: name ?? 'testkit workflow',
    stages: importStages,
    edges: importEdges,
  });
}
