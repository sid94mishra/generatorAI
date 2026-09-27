// ────────────────────────────────────────────────────────────────
// A run's user variables (P01 WP-1.7; P04).
//
// Since P04 a run's variables are the caller's inputs only: the engine's
// own values (working directory, codebases, uploads, the trigger's
// permission ceiling) live in the run's `system_vars` and reach templates
// as `run.codebases.<alias>` through the scheduler's expression scope.
// `userVariables` still drops engine-reserved names defensively, so nothing
// a hook or a step writes under such a name can surface as a variable.
// ────────────────────────────────────────────────────────────────

import { FORBIDDEN_VARIABLE_NAME_PATTERN } from '@generatorai/workflow-spec';

/** The run's user variables. */
export function userVariables(variables: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(variables ?? {})) {
    if (!FORBIDDEN_VARIABLE_NAME_PATTERN.test(k)) out[k] = v;
  }
  return out;
}
