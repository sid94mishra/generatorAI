// ────────────────────────────────────────────────────────────────
// The canonical text of a graph (the export format) and its content hash.
// Versions are deduplicated by this hash: publishing identical content
// reuses the existing version.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { exportGraph, type WorkflowGraph } from '@generatorai/workflow-spec';

export function canonicalGraph(graph: WorkflowGraph): { text: string; hash: string } {
  const text = exportGraph(graph);
  return { text, hash: createHash('sha256').update(text).digest('hex') };
}
