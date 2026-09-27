// ────────────────────────────────────────────────────────────────
// What a prompt's "Insert variable" menu offers (WorkflowStagePrompt
// board): the workflow variables, the outputs of earlier stages and the
// run paths — read from the expression scope model of the stage, the same
// type environment autocomplete and the validator use, so nothing is
// offered that a save would reject. Pure.
// ────────────────────────────────────────────────────────────────

import type { ExprType, WorkflowGraph } from '@generatorai/workflow-spec';
import { buildScopeModel, fieldsOf, shortType, type ScopeModel } from '../../expression/scopeModel.js';

export interface Insertable {
  /** The path inserted as `{{ path }}` (a bare name for a workflow variable). */
  path: string;
  /** Short type ("string", "list<string>"). */
  type: string;
}

export interface InsertableGroup {
  id: string;
  label: string;
  items: Insertable[];
}

const MAX_PER_GROUP = 60;

/** Leaf paths under `prefix` (objects expanded up to `depth` levels; unavailable parts dropped). */
function leaves(prefix: string, t: ExprType, depth: number, out: Insertable[]): void {
  if (out.length >= MAX_PER_GROUP || t.kind === 'unavailable') return;
  const fields = t.kind === 'object' || t.kind === 'union' ? fieldsOf(t) : {};
  const names = Object.keys(fields);
  if (depth <= 0 || names.length === 0) {
    out.push({ path: prefix, type: shortType(t) });
    return;
  }
  for (const name of names) leaves(`${prefix}.${name}`, fields[name]!, depth - 1, out);
}

const ROOT_LABELS: Record<string, string> = { run: 'Run', loop: 'Loop', item: 'Item', parent: 'Parent', workflow: 'Workflow' };

/** The menu groups of a place's scope: Variables · Earlier stages · Run · (Loop, Item …). */
export function insertableGroups(model: ScopeModel | null): InsertableGroup[] {
  if (!model) return [];
  const roots = model.env.roots;
  const groups: InsertableGroup[] = [];

  const variables = roots.variables ? fieldsOf(roots.variables) : {};
  const varItems = Object.entries(variables)
    .filter(([, t]) => t.kind !== 'unavailable')
    .map(([name, t]) => ({ path: model.variableNames.has(name) ? name : `variables.${name}`, type: shortType(t) }));
  if (varItems.length > 0) groups.push({ id: 'variables', label: 'Variables', items: varItems });

  const stageItems: Insertable[] = [];
  for (const [key, t] of Object.entries(roots.stages ? fieldsOf(roots.stages) : {})) {
    if (t.kind === 'unavailable') continue;
    for (const [field, ft] of Object.entries(fieldsOf(t))) {
      // A stage's output is expanded one level (its schema fields); the rest are leaves.
      leaves(`stages.${key}.${field}`, ft, field === 'output' ? 1 : 0, stageItems);
    }
  }
  if (stageItems.length > 0) groups.push({ id: 'stages', label: 'Earlier stages', items: stageItems.slice(0, MAX_PER_GROUP) });

  for (const [root, t] of Object.entries(roots)) {
    if (root === 'variables' || root === 'stages' || t.kind === 'unavailable') continue;
    const items: Insertable[] = [];
    leaves(root, t, 3, items);
    if (items.length > 0) groups.push({ id: root, label: ROOT_LABELS[root] ?? root, items });
  }
  return groups;
}

/**
 * The scope model of an agent stage over a graph that may be mid-edit. A
 * document that does not parse yields no model; the usual culprit is a
 * prompt just added (its text is still empty), so a second try fills empty
 * prompt texts. Still nothing: null (the menu then lists the declared
 * variables and the other stages' outputs, see `fallbackGroups`).
 */
export function stageScopeModel(graph: WorkflowGraph, stageKey: string, primary: ScopeModel | null): ScopeModel | null {
  if (primary) return primary;
  const filled = {
    ...graph,
    stages: graph.stages.map((s) =>
      s.kind !== 'agent'
        ? s
        : {
            ...s,
            prompts: s.prompts.map((p) => ({ label: p.label || 'prompt', text: p.text || ' ' })),
            ...(s.followUpPrompts ? { followUpPrompts: s.followUpPrompts.map((p) => ({ label: p.label || 'prompt', text: p.text || ' ' })) } : {}),
          },
    ),
  };
  return buildScopeModel(filled, { kind: 'stage', key: stageKey });
}

/** Without a scope model: the declared variables and every other stage's output. */
export function fallbackGroups(graph: WorkflowGraph, stageKey: string): InsertableGroup[] {
  const groups: InsertableGroup[] = [];
  const vars = graph.workflow.variables.map((v) => ({ path: v.name, type: v.type }));
  if (vars.length > 0) groups.push({ id: 'variables', label: 'Variables', items: vars });
  const stages = graph.stages.filter((s) => s.key !== stageKey).map((s) => ({ path: `stages.${s.key}.output`, type: 'output' }));
  if (stages.length > 0) groups.push({ id: 'stages', label: 'Other stages', items: stages });
  return groups;
}

/** `text` with `{{ path }}` appended (separated by a space unless it ends in whitespace). */
export function appendPlaceholder(text: string, path: string): string {
  const sep = text === '' || /\s$/.test(text) ? '' : ' ';
  return `${text}${sep}{{ ${path} }}`;
}

/** "9 lines · 5 refs" of a template. */
export function templateStats(text: string): { lines: number; refs: number } {
  return { lines: text === '' ? 0 : text.split('\n').length, refs: (text.match(/\{\{[^}]*\}\}/g) ?? []).length };
}
