// ────────────────────────────────────────────────────────────────
// Run-time stage overrides — ONE encoding for every client.
//
// A start-run form lets the operator skip stages or give one stage extra
// variables for this run only. The server reads those in two different
// places depending on how the run is started:
//
//   • Orchestrated runs (`POST /orchestrator/runs`) take a top-level
//     `stageOverrides` array; the orchestrator copies it into the run's
//     resolved variables itself.
//   • Plain runs (`POST /workflow-runs`) and script runs
//     (`POST /workflow-scripts/:id/run`) have no such field — the runner
//     reads them from the run's own `__stageOverrides` variable
//     (`WorkflowRunService.findStageOverride`, matched by name, then index).
//
// Web grew the split twice (definition page and builder) and mobile would
// have been the third copy, so the rule lives here.
// ────────────────────────────────────────────────────────────────

/** What a start-run form edits for one stage. */
export interface StageOverrideDraft {
  stageName: string;
  stageIndex: number;
  skip: boolean;
  variables: Record<string, unknown>;
}

/** The wire shape (`StageRunOverride` in @generatorai/shared), minus fields no form edits. */
export interface StageOverrideWire {
  stageName: string;
  stageIndex: number;
  skip?: true;
  variables?: Record<string, unknown>;
}

/** The variable key plain and script runs carry overrides under. */
export const STAGE_OVERRIDES_VARIABLE = '__stageOverrides';

/** One untouched draft per stage, in order. */
export function blankStageOverrides(stageNames: readonly string[]): StageOverrideDraft[] {
  return stageNames.map((stageName, stageIndex) => ({ stageName, stageIndex, skip: false, variables: {} }));
}

/**
 * Only the overrides that change something, in wire shape. `skip: false` and
 * empty `variables` are omitted rather than sent, so an untouched form sends
 * nothing at all.
 */
export function activeStageOverrides(
  drafts: readonly StageOverrideDraft[] | undefined,
): StageOverrideWire[] {
  const out: StageOverrideWire[] = [];
  for (const d of drafts ?? []) {
    const hasVars = Object.keys(d.variables ?? {}).length > 0;
    if (!d.skip && !hasVars) continue;
    out.push({
      stageName: d.stageName,
      stageIndex: d.stageIndex,
      ...(d.skip ? { skip: true as const } : {}),
      ...(hasVars ? { variables: d.variables } : {}),
    });
  }
  return out;
}

/**
 * Split the start payload for the route that will receive it.
 *
 * `orchestrated: true` → `{ variables, stageOverrides? }` (top-level array);
 * otherwise → `{ variables }` with `__stageOverrides` folded in when any are
 * active. The input `variables` object is never mutated.
 */
export function encodeStageOverrides(
  variables: Record<string, unknown>,
  drafts: readonly StageOverrideDraft[] | undefined,
  options: { orchestrated: boolean },
): { variables: Record<string, unknown>; stageOverrides?: StageOverrideWire[] } {
  const active = activeStageOverrides(drafts);
  if (active.length === 0) return { variables };
  if (options.orchestrated) return { variables, stageOverrides: active };
  return { variables: { ...variables, [STAGE_OVERRIDES_VARIABLE]: active } };
}
