// ────────────────────────────────────────────────────────────────
// Run-start form helpers — ONE set for every client's run dialog (P04).
//
// A run starts through `workflows.invoke` with an `InvocationRequest`. These
// helpers turn what a start form edits into the request's pieces: the
// per-stage overrides (skip, variables, model; by stage KEY), the codebases
// a run mounts (defaulting to the workflow's `lifecycle.codebaseAliases`),
// and the idempotency key each "Start" press carries.
// ────────────────────────────────────────────────────────────────

import type { InvocationRequest, WorkflowGraph } from '@generatorai/workflow-spec';

/** What a start-run form edits for one stage. */
export interface StageOverrideDraft {
  /** Stable stage key: overrides match stages by key. */
  stageKey: string;
  /** Display name, for the form only. */
  stageName: string;
  skip: boolean;
  variables: Record<string, unknown>;
  /** A model for this stage in this run ('' = the stage's own). */
  model?: string;
}

/** The request's per-stage override. */
export type StageOverrideWire = NonNullable<InvocationRequest['stageOverrides']>[number];

/** One untouched draft per stage, in order. */
export function blankStageOverrides(stages: ReadonlyArray<{ key: string; name: string }>): StageOverrideDraft[] {
  return stages.map((s) => ({ stageKey: s.key, stageName: s.name, skip: false, variables: {} }));
}

/**
 * Only the overrides that change something. `skip: false`, empty
 * `variables` and an empty model are omitted rather than sent, so an
 * untouched form sends nothing at all.
 */
export function activeStageOverrides(drafts: readonly StageOverrideDraft[] | undefined): StageOverrideWire[] {
  const out: StageOverrideWire[] = [];
  for (const d of drafts ?? []) {
    const hasVars = Object.keys(d.variables ?? {}).length > 0;
    const model = d.model?.trim();
    if (!d.skip && !hasVars && !model) continue;
    out.push({
      stageKey: d.stageKey,
      ...(d.skip ? { skip: true } : {}),
      ...(hasVars ? { variables: d.variables } : {}),
      ...(model ? { model } : {}),
    });
  }
  return out;
}

/** What a start form edits for one codebase. */
export interface CodebaseDraft {
  alias: string;
  selected: boolean;
  /** Branch or ref the checkout is cut from ('' = the codebase default). */
  baseRef: string;
  mode: 'worktree' | 'in_place';
}

/**
 * One draft per project codebase, pre-selected from the workflow's
 * `lifecycle.codebaseAliases` (none selected when it names none: a run
 * never mounts "all codebases").
 */
export function codebaseDrafts(
  aliases: readonly string[],
  lifecycle: Pick<WorkflowGraph['workflow']['lifecycle'], 'codebaseAliases' | 'useWorktree'> | undefined,
): CodebaseDraft[] {
  const wanted = new Set(lifecycle?.codebaseAliases ?? []);
  const mode = lifecycle?.useWorktree === false ? 'in_place' : 'worktree';
  return aliases.map((alias) => ({ alias, selected: wanted.has(alias), baseRef: '', mode }));
}

/** The request's `codebases` for the selected drafts. */
export function selectedCodebases(drafts: readonly CodebaseDraft[]): NonNullable<InvocationRequest['codebases']> {
  return drafts
    .filter((d) => d.selected)
    .map((d) => ({ alias: d.alias, mode: d.mode, ...(d.baseRef.trim() ? { baseRef: d.baseRef.trim() } : {}) }));
}

/** A fresh idempotency key for one "Start" press. */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
