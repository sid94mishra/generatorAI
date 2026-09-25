// ────────────────────────────────────────────────────────────────
// Type environments for expressions and templates, per place of use.
//
//   guard, prompts, hooks   variables, run, stages (upstream only)
//   edge when               the same, from the source's view, plus parent
//   workflow outputs,
//   post-processing         variables, run, every stage
//   preprocessing           variables, run
//
// `loop`, `loops`, `item`, `map`, `maps` and `child` are reserved for
// container stages and report `expr-scope-unavailable` until P05 binds
// them inside container bodies.
// ────────────────────────────────────────────────────────────────

import type { TypeEnv } from '../expr/typecheck.js';
import { T, nullable, typeFromJsonSchema, type ExprType } from '../expr/types.js';
import { STAGE_RUN_STATES } from '../state/stageRun.js';
import type { VariableDefinition } from '../schemas/common.js';
import type { StageSpec } from '../schemas/stage.js';
import type { WorkflowGraph } from '../schemas/graph.js';
import type { PreprocessingStep } from '../schemas/workflow.js';

export function variableType(v: VariableDefinition): ExprType {
  let t: ExprType;
  switch (v.type) {
    case 'number':
      t = T.number;
      break;
    case 'boolean':
      t = T.boolean;
      break;
    case 'choice':
      t = v.options && v.options.length ? T.enumOf(v.options) : T.string;
      break;
    default:
      t = T.string;
  }
  return v.required || v.defaultValue !== undefined ? t : nullable(t);
}

/** Names set by `set_variable` preprocessing steps, recursively. */
export function preprocessingVariableNames(steps: readonly PreprocessingStep[]): string[] {
  const out: string[] = [];
  const visit = (list: readonly PreprocessingStep[]) => {
    for (const s of list) {
      if (s.config.type === 'set_variable') out.push(s.config.variableName);
      if (s.config.type === 'conditional') {
        visit(s.config.thenSteps);
        visit(s.config.elseSteps ?? []);
      }
    }
  };
  visit(steps);
  return out;
}

export function stageOutputType(stage: StageSpec): ExprType {
  if (stage.output.format === 'json') return stage.output.schema ? typeFromJsonSchema(stage.output.schema) : T.any;
  return T.string;
}

export function stageType(stage: StageSpec): ExprType {
  return T.object({
    status: T.enumOf(STAGE_RUN_STATES),
    output: nullable(stageOutputType(stage)),
    summary: nullable(T.string),
    attempts: T.number,
    usage: T.object({ turns: T.number, costUsd: nullable(T.number), tokens: nullable(T.number) }),
  });
}

const CONTAINER_ROOTS: Record<string, string> = {
  loop: 'loop is only available inside a loop body',
  loops: 'loops is only available inside a nested loop body',
  item: 'item is only available inside a map body',
  map: 'map is only available inside a map body',
  maps: 'maps is only available inside a nested map body',
  child: 'child is only available in a sub-workflow stage',
};

export interface ScopeContext {
  graph: WorkflowGraph;
  /** Stage keys an expression here may read; `null` means every stage. */
  visibleStages: ReadonlySet<string> | null;
  /** Whether `parent.status` is bound (edge `when`). */
  parent: boolean;
  /** Whether `stages` is bound at all (preprocessing has no stages yet). */
  stages: boolean;
  /** Extra variable names (set by preprocessing), typed as nullable strings. */
  extraVariables: readonly string[];
}

export function buildTypeEnv(ctx: ScopeContext): TypeEnv {
  const { graph } = ctx;
  const vars: Record<string, ExprType> = {};
  for (const v of graph.workflow.variables) vars[v.name] = variableType(v);
  for (const name of ctx.extraVariables) if (!vars[name]) vars[name] = nullable(T.string);

  const aliases = graph.workflow.lifecycle.codebaseAliases;
  const codebase = T.object({ path: T.string, branch: nullable(T.string), baseRef: nullable(T.string) });
  const codebases: Record<string, ExprType> = {};
  for (const a of aliases) codebases[a] = codebase;

  const roots: Record<string, ExprType> = {
    variables: T.object(vars),
    run: T.object({ id: T.string, name: T.string, codebases: T.object(codebases, nullable(codebase)) }),
  };

  if (ctx.stages) {
    const fields: Record<string, ExprType> = {};
    for (const s of graph.stages) {
      fields[s.key] =
        ctx.visibleStages === null || ctx.visibleStages.has(s.key)
          ? stageType(s)
          : T.unavailable(
              'expr-stage-not-upstream',
              `Stage '${s.key}' has not run yet here: only stages upstream of this point can be read`,
              'Add an edge so that it runs first',
            );
    }
    // A key that is not a stage at all gets its own code.
    roots['stages'] = { kind: 'object', fields, unknown: { code: 'expr-unknown-stage', noun: 'stage' } };
  } else {
    roots['stages'] = T.unavailable('expr-scope-unavailable', 'Stages have not run yet during preprocessing');
  }
  roots['parent'] = ctx.parent
    ? T.object({ status: T.enumOf(STAGE_RUN_STATES) })
    : T.unavailable('expr-scope-unavailable', 'parent is only available in an edge `when` expression');
  for (const [root, message] of Object.entries(CONTAINER_ROOTS)) {
    roots[root] = T.unavailable('expr-scope-unavailable', message);
  }
  return { roots, variableNames: new Set(Object.keys(vars)) };
}
