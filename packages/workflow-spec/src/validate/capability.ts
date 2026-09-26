// ────────────────────────────────────────────────────────────────
// Engine capability gate (P01 design decision 3).
//
// The v1 engine runs v2 documents but cannot execute every v2 feature.
// Rather than translating back or silently ignoring a field, validation
// rejects the field until the engine that executes it ships (P03 flips
// ENGINE_LEVEL to v2). The builder disables the same controls. A field
// with a default is gated only when it differs from the default.
// ────────────────────────────────────────────────────────────────

import type { EngineLevel } from '../constants.js';
import type { WorkflowGraph } from '../schemas/graph.js';
import { ApprovalSpecSchema, RetryPolicySchema } from '../schemas/stage.js';
import type { ValidationIssue } from './issues.js';

const RETRY_DEFAULTS = RetryPolicySchema.parse({});
const APPROVAL_DEFAULTS = ApprovalSpecSchema.parse({});

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
    if (s.kind !== 'agent') {
      add(`${p}/kind`, `A ${s.kind} stage`, s.key);
      return;
    }
    if (s.repair !== undefined) add(`${p}/repair`, 'repair', s.key);
    if (s.onExhausted === 'pause') add(`${p}/onExhausted`, "onExhausted 'pause'", s.key);
    if (s.sessionReuse === 'continue') add(`${p}/sessionReuse`, "sessionReuse 'continue'", s.key);
    if (s.sessionGroup !== undefined) add(`${p}/sessionGroup`, 'sessionGroup', s.key);
    if (s.budget !== undefined) add(`${p}/budget`, 'A stage budget', s.key);
    for (const t of ['queueMs', 'idleMs', 'totalMs'] as const) {
      if (s.timeouts?.[t] !== undefined) add(`${p}/timeouts/${t}`, `timeouts.${t}`, s.key);
    }
    if (s.output.extraction !== 'auto') add(`${p}/output/extraction`, `output.extraction '${s.output.extraction}'`, s.key);
    // Retry and approval fields the v1 executor has no reader for: only their
    // defaults are accepted (P01 review R5).
    const r = s.retry;
    if (r) {
      if (r.maxDelayMs !== RETRY_DEFAULTS.maxDelayMs) add(`${p}/retry/maxDelayMs`, 'retry.maxDelayMs', s.key);
      if (r.jitter !== RETRY_DEFAULTS.jitter) add(`${p}/retry/jitter`, `retry.jitter '${r.jitter}'`, s.key);
      if (r.retryOn !== undefined) add(`${p}/retry/retryOn`, 'retry.retryOn', s.key);
      if (r.mode !== RETRY_DEFAULTS.mode) add(`${p}/retry/mode`, `retry.mode '${r.mode}'`, s.key);
      if (r.restoreCheckpointOnRestart !== RETRY_DEFAULTS.restoreCheckpointOnRestart) {
        add(`${p}/retry/restoreCheckpointOnRestart`, 'retry.restoreCheckpointOnRestart', s.key);
      }
    }
    const a = s.approval;
    if (a) {
      if (a.allowChanges !== APPROVAL_DEFAULTS.allowChanges) add(`${p}/approval/allowChanges`, 'approval.allowChanges', s.key);
      if (a.maxRounds !== APPROVAL_DEFAULTS.maxRounds) add(`${p}/approval/maxRounds`, 'approval.maxRounds', s.key);
    }
  });

  if (wf.outputs !== undefined) add('/workflow/outputs', 'workflow outputs');

  graph.edges.forEach((e, i) => {
    if (e.handlesFailure !== undefined) add(`/edges/${i}/handlesFailure`, 'handlesFailure', undefined);
  });
  return out;
}
