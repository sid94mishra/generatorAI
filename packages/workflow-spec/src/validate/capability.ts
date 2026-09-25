// ────────────────────────────────────────────────────────────────
// Engine capability gate (P01 design decision 3).
//
// The v1 engine runs v2 documents but cannot execute every v2 feature.
// Rather than translating back or silently ignoring a field, validation
// rejects the field until the engine that executes it ships (P03 flips
// ENGINE_LEVEL to v2). The builder hides the same controls.
// ────────────────────────────────────────────────────────────────

import type { EngineLevel } from '../constants.js';
import type { WorkflowGraph } from '../schemas/graph.js';
import type { ValidationIssue } from './issues.js';

const HINT = 'Available after the engine upgrade (engine v2)';

export function engineIssues(graph: WorkflowGraph, engine: EngineLevel): ValidationIssue[] {
  if (engine === 'v2') return [];
  const out: ValidationIssue[] = [];
  const add = (path: string, what: string, stageKey?: string) =>
    out.push({
      code: 'engine-unsupported',
      severity: 'error',
      path,
      ...(stageKey ? { stageKey } : {}),
      message: `${what} is not supported by the current engine`,
      hint: HINT,
    });

  const wf = graph.workflow;
  if (wf.onExit !== undefined) add('/workflow/onExit', 'onExit');
  if (wf.onFailure !== undefined) add('/workflow/onFailure', 'onFailure');
  if (wf.maxParallel !== undefined) add('/workflow/maxParallel', 'maxParallel');
  if (wf.budget !== undefined) add('/workflow/budget', 'A workflow budget');

  graph.stages.forEach((s, i) => {
    const p = `/stages/${i}`;
    if (s.join.mode !== 'all') add(`${p}/join/mode`, `join mode '${s.join.mode}'`, s.key);
    if (s.compensate !== undefined) add(`${p}/compensate`, 'compensate', s.key);
    if (s.repair !== undefined) add(`${p}/repair`, 'repair', s.key);
    if (s.onExhausted === 'pause') add(`${p}/onExhausted`, "onExhausted 'pause'", s.key);
    if (s.sessionReuse === 'continue') add(`${p}/sessionReuse`, "sessionReuse 'continue'", s.key);
    if (s.sessionGroup !== undefined) add(`${p}/sessionGroup`, 'sessionGroup', s.key);
    if (s.budget !== undefined) add(`${p}/budget`, 'A stage budget', s.key);
    for (const t of ['queueMs', 'idleMs', 'totalMs'] as const) {
      if (s.timeouts?.[t] !== undefined) add(`${p}/timeouts/${t}`, `timeouts.${t}`, s.key);
    }
    if (s.output.extraction !== 'auto') add(`${p}/output/extraction`, `output.extraction '${s.output.extraction}'`, s.key);
  });

  graph.edges.forEach((e, i) => {
    if (e.handlesFailure !== undefined) add(`/edges/${i}/handlesFailure`, 'handlesFailure', undefined);
  });
  return out;
}
