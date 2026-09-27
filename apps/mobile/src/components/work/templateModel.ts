// ────────────────────────────────────────────────────────────────
// Workflow templates — pure parsing for the "From template" sheet.
//
// `GET /templates` returns `WorkflowTemplate` records (`{ id, category,
// graph }`, @generatorai/workflow-spec); the name, description, inputs and
// lifecycle live in `graph.workflow`. The sheet needs only a name, a line of
// description, a category to group by and a stage count.
// `POST /workflow-definitions/import { templateId }` instantiates one.
//
// Tested in src/__tests__/templateModel.test.ts.
// ────────────────────────────────────────────────────────────────

export interface TemplateView {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  stageCount: number;
  variableCount: number;
  /** `graph.workflow.lifecycle.requiresCodebase`: runs refuse to start without a codebase. */
  requiresCodebase: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function parseTemplates(raw: unknown): TemplateView[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateView[] = [];
  for (const t of raw) {
    const r = obj(t);
    const id = str(r['id']);
    if (!id) continue;
    const graph = obj(r['graph']);
    const workflow = obj(graph['workflow']);
    out.push({
      id,
      name: str(workflow['name']) ?? id,
      description: str(workflow['description']),
      category: str(r['category']),
      stageCount: Array.isArray(graph['stages']) ? graph['stages'].length : 0,
      variableCount: Array.isArray(workflow['variables']) ? workflow['variables'].length : 0,
      requiresCodebase: obj(workflow['lifecycle'])['requiresCodebase'] === true,
    });
  }
  return out.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name));
}

export function filterTemplates(list: readonly TemplateView[], query: string): TemplateView[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((t) =>
    [t.name, t.description, t.category].some((s) => (s ?? '').toLowerCase().includes(q)),
  );
}

export function templateSubtitle(t: TemplateView): string {
  const parts: string[] = [];
  if (t.category) parts.push(t.category);
  if (t.stageCount > 0) parts.push(`${t.stageCount} stage${t.stageCount === 1 ? '' : 's'}`);
  if (t.requiresCodebase) parts.push('needs a codebase');
  if (t.description) parts.push(t.description);
  return parts.join(' · ');
}
