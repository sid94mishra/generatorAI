// ────────────────────────────────────────────────────────────────
// Definition specs for tests.
//
// A test writes a workflow the way a person reads one — stages by name,
// edges as `[from, to, on]` — and `toGraph` turns it into the canonical v2
// `WorkflowGraph` (`@generatorai/workflow-spec`) the definition service
// materializes. Stage keys derive from the names (a name that already is a
// key stays as it is); every other stage field is the v2 StageSpec field
// (`guard`, `retry`, `output`, `context`, `approval`, `session`, …).
// ────────────────────────────────────────────────────────────────

import { STAGE_KEY_PATTERN, type EdgeOn, type WorkflowGraphInput } from '@generatorai/workflow-spec';

export type EdgeType = EdgeOn;

export interface StageSpec {
  name: string;
  /** Stage key; defaults to the name when it is a valid key, else a slug of it. */
  key?: string;
  /** Shorthand for one prompt labelled with the stage name. */
  prompt?: string;
  prompts?: Array<{ label?: string; text: string }>;
  /** Any other v2 stage field (guard, retry, output, context, approval, session, …). */
  [field: string]: unknown;
}

export type EdgeSpec =
  | readonly [from: string, to: string, on?: EdgeType]
  | { from: string; to: string; on?: EdgeType; when?: string };

export interface WorkflowSpecJson {
  name?: string;
  stages: StageSpec[];
  edges?: EdgeSpec[];
  /** Any other v2 workflow field (variables, session, lifecycle, hooks, …). */
  [field: string]: unknown;
}

/** The key a stage name maps to (unique within one spec). */
export function stageKeyFor(name: string, taken: Set<string> = new Set()): string {
  let key = STAGE_KEY_PATTERN.test(name)
    ? name
    : name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'stage';
  if (!/^[a-z]/.test(key)) key = `s_${key}`;
  key = key.slice(0, 48);
  let candidate = key;
  for (let n = 2; taken.has(candidate); n++) candidate = `${key.slice(0, 44)}_${n}`;
  taken.add(candidate);
  return candidate;
}

/** Convert a name-based spec into a v2 `WorkflowGraph` document. */
export function toGraph(spec: WorkflowSpecJson): WorkflowGraphInput {
  const { stages, edges = [], name, ...workflowFields } = spec;
  const taken = new Set<string>();
  const keyByName = new Map<string, string>();
  const graphStages = stages.map((s) => {
    const { prompt, prompts, name: stageName, key, ...fields } = s;
    const stageKey = key ?? stageKeyFor(stageName, taken);
    taken.add(stageKey);
    keyByName.set(stageName, stageKey);
    return {
      kind: 'agent' as const,
      ...fields,
      key: stageKey,
      name: stageName,
      prompts: prompts
        ? prompts.map((p, j) => ({ label: p.label ?? `${stageName} ${j + 1}`, text: p.text }))
        : prompt !== undefined
          ? [{ label: stageName, text: prompt }]
          : [],
    };
  });
  const keyOf = (n: string) => keyByName.get(n) ?? n;
  const graphEdges = edges.map((e) => {
    const [from, to, on, when] = Array.isArray(e)
      ? [(e as readonly [string, string, EdgeType?])[0], (e as readonly [string, string, EdgeType?])[1], (e as readonly [string, string, EdgeType?])[2], undefined]
      : [(e as { from: string }).from, (e as { to: string }).to, (e as { on?: EdgeType }).on, (e as { when?: string }).when];
    return { from: keyOf(from as string), to: keyOf(to as string), on: (on as EdgeType | undefined) ?? 'success', ...(when ? { when } : {}) };
  });
  return {
    formatVersion: 2,
    workflow: { name: name ?? 'testkit workflow', ...workflowFields } as WorkflowGraphInput['workflow'],
    stages: graphStages as WorkflowGraphInput['stages'],
    edges: graphEdges,
  };
}
