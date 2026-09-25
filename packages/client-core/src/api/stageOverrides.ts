// ────────────────────────────────────────────────────────────────
// Run-time stage overrides — ONE encoding for every client.
//
// A start-run form lets the operator skip stages or give one stage extra
// variables for this run only. Every start route (`POST /workflow-runs`,
// `POST /orchestrator/runs`, `POST /workflow-scripts/:id/run`) takes them as
// a typed top-level `stageOverrides` array, matched by stage KEY. Variables
// never carry them: engine-reserved names are refused (R-8).
// ────────────────────────────────────────────────────────────────

/** What a start-run form edits for one stage. */
export interface StageOverrideDraft {
  /** Stable stage key: overrides match stages by key. */
  stageKey: string;
  /** Display name, for the form only. */
  stageName: string;
  skip: boolean;
  variables: Record<string, unknown>;
}

/** The wire shape (`StageRunOverride` in @generatorai/shared). */
export interface StageOverrideWire {
  stageKey: string;
  skip?: true;
  variables?: Record<string, unknown>;
}

/** One untouched draft per stage, in order. */
export function blankStageOverrides(stages: ReadonlyArray<{ key: string; name: string }>): StageOverrideDraft[] {
  return stages.map((s) => ({ stageKey: s.key, stageName: s.name, skip: false, variables: {} }));
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
      stageKey: d.stageKey,
      ...(d.skip ? { skip: true as const } : {}),
      ...(hasVars ? { variables: d.variables } : {}),
    });
  }
  return out;
}

/**
 * The start payload: `{ variables, stageOverrides? }`. Both start routes take
 * the overrides as a typed top-level array; the input `variables` object is
 * never mutated.
 */
export function encodeStageOverrides(
  variables: Record<string, unknown>,
  drafts: readonly StageOverrideDraft[] | undefined,
): { variables: Record<string, unknown>; stageOverrides?: StageOverrideWire[] } {
  const active = activeStageOverrides(drafts);
  if (active.length === 0) return { variables };
  return { variables, stageOverrides: active };
}
