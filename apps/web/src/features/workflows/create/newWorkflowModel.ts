// ────────────────────────────────────────────────────────────────
// New workflow (board WorkflowNew): the start points and the draft each one
// creates. Blank → an empty graph; a template → the template's graph;
// Import JSON → the document as written. The basics (name, description,
// project, codebases) are applied on top in every case, so what the form
// shows is what the draft gets.
// ────────────────────────────────────────────────────────────────

import { WORKFLOW_FORMAT_VERSION, type WorkflowGraph, type WorkflowGraphInput, type WorkflowTemplate } from '@generatorai/workflow-spec';

export type StartPoint = 'blank' | 'template' | 'import';

export interface DraftBasics {
  name: string;
  description: string;
  /** '' = no project (global). */
  projectId: string;
  /** Codebase aliases the runs mount (`lifecycle.codebaseAliases`). */
  codebaseAliases: readonly string[];
}

export const TEMPLATE_CATEGORY_LABELS: Record<WorkflowTemplate['category'], string> = {
  system: 'System',
  'code-generation': 'Code generation',
  'code-review': 'Review',
  testing: 'Testing',
  'e2e-testing': 'E2E testing',
  refactoring: 'Refactoring',
  documentation: 'Docs',
  deployment: 'Deployment',
  custom: 'Custom',
};

function applyBasics(workflow: Record<string, unknown>, basics: DraftBasics): Record<string, unknown> {
  const lifecycle = (workflow['lifecycle'] as Record<string, unknown> | undefined) ?? {};
  const description = basics.description.trim();
  const rest = { ...workflow };
  delete rest['description'];
  return {
    ...rest,
    name: basics.name.trim(),
    ...(description ? { description } : {}),
    projectId: basics.projectId || null,
    lifecycle: { ...lifecycle, codebaseAliases: [...basics.codebaseAliases] },
  };
}

/** The graph a blank or template start creates. */
export function draftGraph(start: 'blank' | 'template', basics: DraftBasics, template?: WorkflowTemplate): WorkflowGraphInput {
  if (start === 'template' && template) {
    return {
      ...template.graph,
      workflow: applyBasics(template.graph.workflow as unknown as Record<string, unknown>, basics) as WorkflowGraphInput['workflow'],
    };
  }
  return {
    formatVersion: WORKFLOW_FORMAT_VERSION,
    workflow: applyBasics({}, basics) as WorkflowGraphInput['workflow'],
    stages: [],
    edges: [],
  };
}

/** What an imported document holds, for the preview and the basics' defaults; null when it is not a workflow document. */
export function documentSummary(document: unknown): { name: string; description: string; stages: number; projectId: string | null } | null {
  if (!document || typeof document !== 'object') return null;
  const doc = document as { workflow?: { name?: unknown; description?: unknown; projectId?: unknown }; stages?: unknown };
  if (!doc.workflow || typeof doc.workflow !== 'object') return null;
  return {
    name: typeof doc.workflow.name === 'string' ? doc.workflow.name : '',
    description: typeof doc.workflow.description === 'string' ? doc.workflow.description : '',
    stages: Array.isArray(doc.stages) ? doc.stages.length : 0,
    projectId: typeof doc.workflow.projectId === 'string' ? doc.workflow.projectId : null,
  };
}

/**
 * The codebases a template or an imported document names (`lifecycle.codebaseAliases`) that the picked project has —
 * what the Codebases field starts with. The field used to start empty and the create overwrote the document's own
 * list with it, so an imported workflow lost its codebases.
 */
export function startingCodebaseAliases(workflow: unknown, projectAliases: readonly string[]): string[] {
  const lifecycle = workflow && typeof workflow === 'object' ? (workflow as { lifecycle?: { codebaseAliases?: unknown } }).lifecycle : undefined;
  const named = Array.isArray(lifecycle?.codebaseAliases) ? lifecycle.codebaseAliases.filter((a): a is string => typeof a === 'string') : [];
  return named.filter((alias) => projectAliases.includes(alias));
}

/** The imported document with the basics applied (the server validates the rest). */
export function importDocumentWith(document: unknown, basics: DraftBasics): unknown {
  if (!documentSummary(document)) return document;
  const doc = document as { workflow: Record<string, unknown> };
  return { ...doc, workflow: applyBasics(doc.workflow, basics) };
}

/** Top-level stages in order, with their loop/map body keys (the template preview). */
export function stageOutline(graph: WorkflowGraph): Array<{ key: string; kind: string; body: string[]; max?: number }> {
  return graph.stages
    .filter((s) => !s.parentKey)
    .map((s) => ({
      key: s.key,
      kind: s.kind,
      body: graph.stages.filter((b) => b.parentKey === s.key).map((b) => b.key),
      ...(s.kind === 'loop' ? { max: s.loop.maxIterations } : {}),
    }));
}

/** Why Create is blocked, or null. */
export function blockingReason(start: StartPoint, basics: DraftBasics, opts: { template?: WorkflowTemplate; document?: unknown }): string | null {
  if (start === 'template' && !opts.template) return 'Pick a template';
  if (start === 'import' && !documentSummary(opts.document)) return 'Choose a workflow document';
  if (!basics.name.trim()) return 'Name the workflow';
  return null;
}
