// ────────────────────────────────────────────────────────────────
// The canonical document format: import and export are exact inverses.
// `exportGraph` writes the parsed form (defaults applied, keys in schema
// order), so `importGraph(exportGraph(g))` returns `g` unchanged.
// ────────────────────────────────────────────────────────────────

import { WorkflowGraphSchema, type WorkflowGraph } from './schemas/graph.js';
import { validateWorkflow, type ValidateOptions, type ValidationResult } from './validate/validateWorkflow.js';

/** Strict parse; throws a ZodError on an invalid document. */
export function parseGraph(input: unknown): WorkflowGraph {
  return WorkflowGraphSchema.parse(input);
}

/** Canonical JSON text of a graph. */
export function exportGraph(graph: WorkflowGraph): string {
  return `${JSON.stringify(WorkflowGraphSchema.parse(graph), null, 2)}\n`;
}

/** Parse JSON text and validate it. */
export function importGraph(json: string, opts: ValidateOptions = {}): ValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return {
      valid: false,
      issues: [{ code: 'schema', severity: 'error', path: '', message: `Invalid JSON: ${(err as Error).message}` }],
    };
  }
  return validateWorkflow(data, opts);
}
