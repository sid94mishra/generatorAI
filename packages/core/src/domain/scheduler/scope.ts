// ────────────────────────────────────────────────────────────────
// The expression scope an instance's templates and guards read (P05 §2.2,
// context T). Pure.
// ────────────────────────────────────────────────────────────────

import type { CompiledWorkflow } from '../workflow-graph/compile.js';
import { expressionScope } from './readiness.js';
import type { InstanceState, RunState } from './types.js';

/** The scope of `instance`'s templates (prompts, check env, guards): context T. */
export function templateScope(
  _graph: CompiledWorkflow,
  state: RunState,
  _instance: InstanceState,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  return expressionScope({ ...state.run, variables }, state.instances);
}
