// ────────────────────────────────────────────────────────────────
// The expression scope of a v1 run (P01 WP-1.7): what guards, edge
// `when` and prompt templates read.
//
//   variables  the run's user variables (system `__*` values and the
//              engine's codebase bookkeeping are not variables)
//   run        { id, name, codebases.<alias>.{path, branch, baseRef} },
//              read-only (RV-16); the v1 engine records worktrees in its
//              run state, the lifecycle upgrade (PHASE-04) moves them to
//              mounts
//   stages     { <key>: { status, output, summary } } of the run's stages
// ────────────────────────────────────────────────────────────────

import type { StageRun, WorkflowRun } from '@generatorai/shared';

/** Engine-internal run-state keys: `__*` system values and codebase checkouts. */
const SYSTEM_KEY = /^__/;
const CODEBASE_KEY = /^repo_(path|branch)_(.+)$/;

export interface CodebaseScope {
  path: string;
  branch: string | null;
  baseRef: string | null;
}

export interface RunScope {
  id: string;
  name: string;
  codebases: Record<string, CodebaseScope>;
}

export interface StageScope {
  status: string;
  output: unknown;
  summary: string | null;
}

/** The run's user variables. */
export function userVariables(variables: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(variables ?? {})) {
    if (!SYSTEM_KEY.test(k) && !CODEBASE_KEY.test(k)) out[k] = v;
  }
  return out;
}

/** `run.codebases`, from the checkouts the engine recorded for the run. */
export function codebasesOf(variables: Record<string, unknown> | undefined): Record<string, CodebaseScope> {
  const out: Record<string, CodebaseScope> = {};
  for (const [k, v] of Object.entries(variables ?? {})) {
    const m = CODEBASE_KEY.exec(k);
    if (!m || typeof v !== 'string') continue;
    const alias = m[2]!;
    const entry = (out[alias] ??= { path: '', branch: null, baseRef: null });
    if (m[1] === 'path') entry.path = v;
    else entry.branch = v;
  }
  for (const [alias, c] of Object.entries(out)) if (!c.path) delete out[alias];
  return out;
}

export function runScope(run: Pick<WorkflowRun, 'id' | 'name' | 'variables'>): RunScope {
  return { id: run.id, name: run.name, codebases: codebasesOf(run.variables) };
}

/** `stages.<key>` for every stage run of the run. */
export function stagesScope(stageRuns: readonly StageRun[]): Record<string, StageScope> {
  const out: Record<string, StageScope> = {};
  for (const sr of stageRuns) {
    out[sr.stageKey] = {
      status: sr.status,
      output: sr.outputData ?? sr.outputText ?? null,
      summary: sr.summary ?? null,
    };
  }
  return out;
}

/** The whole scope a stage's templates render with. */
export function templateScope(
  run: Pick<WorkflowRun, 'id' | 'name' | 'variables'>,
  variables: Record<string, unknown> | undefined,
  stageRuns: readonly StageRun[],
): { variables: Record<string, unknown>; run: RunScope; stages: Record<string, StageScope> } {
  return { variables: userVariables(variables ?? run.variables), run: runScope(run), stages: stagesScope(stageRuns) };
}
