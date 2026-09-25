import type { WorkflowGraphInput } from '../src/index.js';

type StageIn = WorkflowGraphInput['stages'][number];

/** An agent stage with one prompt. */
export function agent(key: string, extra: Partial<Record<string, unknown>> = {}): StageIn {
  return { key, name: key, kind: 'agent', prompts: [{ label: 'p', text: `Do ${key}.` }], ...extra } as StageIn;
}

/** A graph document: `workflow` fields merge over a minimal workflow. */
export function graph(
  stages: StageIn[],
  edges: Array<[string, string] | Record<string, unknown>> = [],
  workflow: Record<string, unknown> = {},
): WorkflowGraphInput {
  return {
    formatVersion: 2,
    workflow: { name: 'wf', ...workflow },
    stages,
    edges: edges.map((e) => (Array.isArray(e) ? { from: e[0], to: e[1] } : e)) as WorkflowGraphInput['edges'],
  } as WorkflowGraphInput;
}

export function codes(result: { issues: Array<{ code: string; severity: string }> }, severity?: 'error' | 'warning'): string[] {
  return result.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
}
