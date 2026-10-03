// New workflow (M8-01; MWorkflowNew, MWorkflowNewBasics; 04 §2.4): the three start points and the draft each creates.
// Blank → an empty graph; a template → its graph; Import JSON → the pasted document (validated by the spec first).
// The basics (name, description, project, codebases, default session) apply on top in every case, so what the form
// shows is what the draft gets. Templates filter by their category chips (MG-30: `category` is on every template).
// Pure, unit-tested.
import {
  WORKFLOW_FORMAT_VERSION,
  importGraph,
  type ValidationIssue,
  type WorkflowGraphInput,
  type WorkflowTemplate,
} from '@generatorai/workflow-spec';

export type StartPoint = 'blank' | 'template' | 'import';

export interface DraftSession {
  model?: string;
  agentRef?: string;
  reasoningEffort?: string;
  permissionMode?: string;
}

export interface DraftBasics {
  name: string;
  description: string;
  /** '' = no project (global). */
  projectId: string;
  codebaseAliases: readonly string[];
  session: DraftSession;
}

export const TEMPLATE_CATEGORY_LABEL: Record<WorkflowTemplate['category'], string> = {
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

const KIND_WORD: Record<string, string> = { loop: 'Loop', map: 'Fan-out', check: 'Check', wait: 'Wait', subworkflow: 'Sub-workflow' };

export interface TemplateView {
  id: string;
  name: string;
  description: string | null;
  category: WorkflowTemplate['category'];
  /** Top-level stages. */
  stageCount: number;
  /** Control-flow kinds it uses ("Loop", "Check"), and "Approval" when a stage parks for a person. */
  kinds: string[];
  variables: string[];
  /** Top-level stages in order, with their keys (the preview). */
  stages: { key: string; name: string; kind: string; body: { key: string; name: string }[] }[];
  template: WorkflowTemplate;
}

export function templateViews(templates: readonly WorkflowTemplate[]): TemplateView[] {
  return templates
    .map((t) => {
      const stages = t.graph.stages;
      const top = stages.filter((s) => !s.parentKey);
      const kinds = [...new Set(stages.map((s) => KIND_WORD[s.kind]).filter((k): k is string => Boolean(k)))];
      if (stages.some((s) => (s.kind === 'agent' && s.approval) || (s.kind === 'wait' && s.wait.type === 'approval'))) kinds.push('Approval');
      return {
        id: t.id,
        name: t.graph.workflow.name,
        description: t.graph.workflow.description ?? null,
        category: t.category,
        stageCount: top.length,
        kinds,
        variables: t.graph.workflow.variables.map((v) => v.name),
        stages: top.map((s) => ({ key: s.key, name: s.name, kind: s.kind, body: stages.filter((c) => c.parentKey === s.key).map((c) => ({ key: c.key, name: c.name })) })),
        template: t,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The category chips present, in catalogue order. */
export function templateCategories(views: readonly TemplateView[]): WorkflowTemplate['category'][] {
  const present = new Set(views.map((v) => v.category));
  return (Object.keys(TEMPLATE_CATEGORY_LABEL) as WorkflowTemplate['category'][]).filter((c) => present.has(c));
}

export function filterTemplates(views: readonly TemplateView[], category: string | null, query: string): TemplateView[] {
  const q = query.trim().toLowerCase();
  return views.filter((v) => (!category || v.category === category) && (!q || [v.name, v.description ?? '', ...v.kinds].some((s) => s.toLowerCase().includes(q))));
}

function applyBasics(workflow: Record<string, unknown>, basics: DraftBasics): Record<string, unknown> {
  const lifecycle = (workflow['lifecycle'] as Record<string, unknown> | undefined) ?? {};
  const session = { ...((workflow['session'] as Record<string, unknown> | undefined) ?? {}) };
  for (const [k, v] of Object.entries(basics.session)) {
    if (v) session[k] = v;
    else delete session[k];
  }
  const description = basics.description.trim();
  const rest = { ...workflow };
  delete rest['description'];
  return {
    ...rest,
    name: basics.name.trim(),
    ...(description ? { description } : {}),
    projectId: basics.projectId || null,
    session,
    lifecycle: { ...lifecycle, codebaseAliases: [...basics.codebaseAliases] },
  };
}

/** The graph the draft is created from. */
export function draftGraph(start: StartPoint, basics: DraftBasics, source?: { template?: WorkflowTemplate; imported?: unknown }): WorkflowGraphInput {
  if (start === 'template' && source?.template) {
    const g = source.template.graph;
    return { ...g, workflow: applyBasics(g.workflow as unknown as Record<string, unknown>, basics) as WorkflowGraphInput['workflow'] };
  }
  if (start === 'import' && source?.imported && typeof source.imported === 'object') {
    const doc = source.imported as WorkflowGraphInput;
    return { ...doc, workflow: applyBasics(doc.workflow as unknown as Record<string, unknown>, basics) as WorkflowGraphInput['workflow'] };
  }
  return { formatVersion: WORKFLOW_FORMAT_VERSION, workflow: applyBasics({}, basics) as WorkflowGraphInput['workflow'], stages: [], edges: [] };
}

export interface ImportCheck {
  /** The parsed document (when it is JSON at all). */
  document: unknown;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** What the document holds, for the basics' defaults. */
  summary: { name: string; description: string; stages: number; projectId: string | null } | null;
}

/** Parse and validate pasted text against the spec (the server validates again). */
export function checkImport(text: string): ImportCheck {
  const result = importGraph(text);
  let document: unknown = null;
  try {
    document = JSON.parse(text);
  } catch {
    document = null;
  }
  const doc = document as { workflow?: { name?: unknown; description?: unknown; projectId?: unknown }; stages?: unknown } | null;
  const summary =
    doc && typeof doc === 'object' && doc.workflow && typeof doc.workflow === 'object'
      ? {
          name: typeof doc.workflow.name === 'string' ? doc.workflow.name : '',
          description: typeof doc.workflow.description === 'string' ? doc.workflow.description : '',
          stages: Array.isArray(doc.stages) ? doc.stages.length : 0,
          projectId: typeof doc.workflow.projectId === 'string' ? doc.workflow.projectId : null,
        }
      : null;
  return {
    document,
    errors: result.issues.filter((i) => i.severity === 'error'),
    warnings: result.issues.filter((i) => i.severity !== 'error'),
    summary,
  };
}

/** Why Create is disabled, or null. */
export function createBlocker(start: StartPoint, basics: DraftBasics, opts: { templateId: string | null; importCheck: ImportCheck | null; takenNames: ReadonlySet<string> }): string | null {
  const name = basics.name.trim();
  if (start === 'template' && !opts.templateId) return 'Choose a template';
  if (start === 'import') {
    if (!opts.importCheck?.document) return 'Paste a workflow document';
    if (opts.importCheck.errors.length) return 'Fix the document first';
  }
  if (!name) return 'Name the workflow';
  if (opts.takenNames.has(name.toLowerCase())) return 'A workflow already has this name';
  return null;
}
