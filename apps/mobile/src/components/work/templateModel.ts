// ────────────────────────────────────────────────────────────────
// Workflow templates — pure parsing for the "From template" sheet.
//
// `GET /templates` returns WorkflowTemplate objects from the registry; the
// sheet needs only a name, a line of description, a category to group by
// and a stage count. `POST /workflow-definitions/import { templateId }`
// instantiates one.
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
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null);

export function parseTemplates(raw: unknown): TemplateView[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateView[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    const id = str(r['id']);
    if (!id) continue;
    out.push({
      id,
      name: str(r['name']) ?? id,
      description: str(r['description']),
      category: str(r['category']),
      stageCount: Array.isArray(r['stages']) ? r['stages'].length : 0,
      variableCount: Array.isArray(r['variables']) ? r['variables'].length : 0,
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
  if (t.description) parts.push(t.description);
  return parts.join(' · ');
}
