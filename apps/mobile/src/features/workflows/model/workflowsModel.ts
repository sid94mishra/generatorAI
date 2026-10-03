// Workflows list and detail rules (M8-01; MWorkflows, MWorkflowDetail(+More); 04 §2.4; MD-25, MD-27): the scope
// filter (All / Published / Drafts), search over name, description and tags, the sort, the row's words, the
// detail's version chip, facts, setup rows and variables, and a duplicate's graph. A field the server does not send
// is not shown (no run number until MG-29). Pure, unit-tested.
import type { StatsByDefinitionRow, StatsSummary } from '@generatorai/shared';
import type {
  VariableDefinition,
  WorkflowDefinitionRecord,
  WorkflowDefinitionSummary,
  WorkflowDefinitionVersionSummary,
  WorkflowGraph,
} from '@generatorai/workflow-spec';

export type WorkflowScope = 'all' | 'published' | 'drafts';
export type WorkflowSort = 'updated' | 'name' | 'lastRun';

export const SORT_LABEL: Record<WorkflowSort, string> = { updated: 'Updated', name: 'Name', lastRun: 'Last run' };

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function scopeCounts(list: readonly WorkflowDefinitionSummary[]): Record<WorkflowScope, number> {
  const live = list.filter((w) => !w.archivedAt);
  return { all: live.length, published: live.filter((w) => w.status === 'published').length, drafts: live.filter((w) => w.status === 'draft').length };
}

export function filterWorkflows(
  list: readonly WorkflowDefinitionSummary[],
  scope: WorkflowScope,
  query: string,
  sort: WorkflowSort,
  stats?: ReadonlyMap<string, StatsByDefinitionRow>,
): WorkflowDefinitionSummary[] {
  const q = query.trim().toLowerCase();
  const rows = list.filter((w) => {
    if (w.archivedAt) return false;
    if (scope === 'published' && w.status !== 'published') return false;
    if (scope === 'drafts' && w.status !== 'draft') return false;
    if (!q) return true;
    return [w.name, w.description ?? '', ...w.tags].some((s) => s.toLowerCase().includes(q));
  });
  const lastRun = (w: WorkflowDefinitionSummary): number => {
    const at = stats?.get(w.id)?.lastRun?.startedAt;
    return at ? Date.parse(at) : 0;
  };
  return rows.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'lastRun') return lastRun(b) - lastRun(a) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

/** "212 runs in 30 days · 93.4% succeeded" (the rate only when the server has one). */
export function listSummary(summary: StatsSummary | undefined): string | null {
  if (!summary) return null;
  const runs = `${plural(summary.runs.total, 'run')} in 30 days`;
  if (summary.runs.successRate === undefined) return runs;
  return `${runs} · ${(summary.runs.successRate * 100).toFixed(1)}% succeeded`;
}

/** 0.943 → "94%". */
export const percent = (rate: number): string => `${Math.round(rate * 100)}%`;

/** The neutral version chip (WF-01, MD-25): "Published v7", "Draft", "Draft · rev 13". */
export function versionChip(record: Pick<WorkflowDefinitionRecord, 'status' | 'currentVersionId' | 'revision' | 'hasUnpublishedChanges'>, versions?: readonly WorkflowDefinitionVersionSummary[]): { label: string; suffix?: string } {
  if (record.status === 'draft') return { label: 'Draft', suffix: `rev ${record.revision}` };
  const v = versions?.find((x) => x.id === record.currentVersionId)?.version;
  return v ? { label: 'Published', suffix: `v${v}` } : { label: 'Published' };
}

/** Version labels by version id ("v7"; a test run pins a `test` version). */
export function versionLabels(versions: readonly WorkflowDefinitionVersionSummary[] | undefined): Map<string, string> {
  return new Map((versions ?? []).map((v) => [v.id, v.kind === 'published' ? `v${v.version}` : 'test']));
}

export function approvalCount(graph: Pick<WorkflowGraph, 'stages'>): number {
  return graph.stages.filter((s) => (s.kind === 'agent' && Boolean(s.approval)) || (s.kind === 'wait' && s.wait.type === 'approval')).length;
}

/** The detail's fact chips: "6 stages", "1 approval gate", the tags. */
export function definitionFacts(graph: WorkflowGraph): { id: string; label: string; icon: 'workflows' | 'hand' | 'tag' }[] {
  const facts: { id: string; label: string; icon: 'workflows' | 'hand' | 'tag' }[] = [{ id: 'stages', label: plural(graph.stages.filter((s) => !s.parentKey).length, 'stage'), icon: 'workflows' }];
  const approvals = approvalCount(graph);
  if (approvals) facts.push({ id: 'approvals', label: plural(approvals, 'approval gate'), icon: 'hand' });
  if (graph.workflow.tags.length) facts.push({ id: 'tags', label: graph.workflow.tags.join(' · '), icon: 'tag' });
  return facts;
}

/** "Commit → Push → PR", or null when nothing runs after the stages. */
export function postProcessingLine(graph: WorkflowGraph): string | null {
  const pp = graph.workflow.lifecycle.postProcessing;
  const parts: string[] = [];
  if (pp.autoCommit || pp.autoPush || pp.autoCreatePR) parts.push('Commit');
  if (pp.autoPush || pp.autoCreatePR) parts.push('Push');
  if (pp.autoCreatePR) parts.push('PR');
  const extra = pp.steps.length;
  if (extra) parts.push(plural(extra, 'step'));
  return parts.length ? parts.join(' → ') : null;
}

/** The default session in words: "Claude Sonnet 5 · Bug Fixer · high · Accept edits" (only what is set). */
export function sessionLine(session: WorkflowGraph['workflow']['session'], modelName?: (id: string) => string | undefined): string | null {
  const parts = [
    session.model ? (modelName?.(session.model) ?? session.model) : null,
    session.agentRef ?? null,
    session.reasoningEffort ?? null,
    session.permissionMode ? PERMISSION_WORD[session.permissionMode] ?? session.permissionMode : null,
  ].filter((x): x is string => Boolean(x));
  return parts.length ? parts.join(' · ') : null;
}

export const PERMISSION_WORD: Record<string, string> = {
  plan: 'Plan',
  default: 'Default',
  acceptEdits: 'Accept edits',
  bypassPermissions: 'Bypass',
  dontAsk: "Don't ask",
};

const HOOK_TYPE: Record<string, string> = { script: 'Script', http: 'HTTP', function: 'Function' };

/** Workflow hooks in a line: "on_failure → HTTP", the first hook's name, "+2 more". */
export function hooksLine(graph: WorkflowGraph): { title: string; detail: string } | null {
  const hooks = graph.workflow.hooks;
  if (!hooks.length) return null;
  const first = hooks[0]!;
  const more = hooks.length > 1 ? ` · +${hooks.length - 1} more` : '';
  return { title: `${first.phase} → ${HOOK_TYPE[first.type] ?? first.type}`, detail: `${first.name}${first.enabled ? '' : ' · off'}${more}` };
}

export interface VariableRow {
  name: string;
  /** "String · Required". */
  detail: string;
  /** The default as text; null when none. */
  defaultText: string | null;
  description?: string;
}

export const TYPE_WORD: Record<string, string> = { string: 'String', text: 'Text', number: 'Number', boolean: 'Boolean', choice: 'Choice', list: 'List', json: 'JSON' };

export function variableRows(variables: readonly VariableDefinition[]): VariableRow[] {
  return variables.map((v) => {
    const def = v.defaultValue;
    const defaultText = def === undefined || def === null || def === '' ? null : typeof def === 'string' ? def : JSON.stringify(def);
    return {
      name: v.name,
      detail: [TYPE_WORD[v.type] ?? v.type, v.required ? 'Required' : null].filter(Boolean).join(' · '),
      defaultText,
      ...(v.description ? { description: v.description } : {}),
    };
  });
}

/** A copy of the graph as a new draft ("<name> copy"). */
export function duplicateGraph(graph: WorkflowGraph): WorkflowGraph {
  const name = `${graph.workflow.name} copy`.slice(0, 200);
  return { ...graph, workflow: { ...graph.workflow, name } };
}

/** The file name an export shares under. */
export function exportFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${slug || 'workflow'}.workflow.json`;
}
