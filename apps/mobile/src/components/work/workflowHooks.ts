// ────────────────────────────────────────────────────────────────
// Workflow hooks — read-only rows for the workflow screen.
//
// A definition carries `hooks?: WorkflowHookDefinition[]` (workflow-level
// lifecycle hooks). Editing them stays on the desktop; the phone only says
// what will run and when.
//
// Tested in src/__tests__/workflowHooks.test.ts.
// ────────────────────────────────────────────────────────────────

export interface HookRowView {
  id: string;
  name: string;
  phase: string;
  type: string;
  enabled: boolean;
  /** "On run start · script · stops the run on failure" */
  subtitle: string;
}

/** `on_run_start` → "On run start". */
export function phaseLabel(phase: string): string {
  const text = phase.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown phase';
}

const FAILURE_LABEL: Record<string, string> = {
  abort: 'stops the run on failure',
  skip: 'skips on failure',
  continue: 'continues on failure',
};

export function parseWorkflowHooks(raw: unknown): HookRowView[] {
  if (!Array.isArray(raw)) return [];
  const out: HookRowView[] = [];
  raw.forEach((h, index) => {
    if (!h || typeof h !== 'object') return;
    const r = h as Record<string, unknown>;
    const phase = typeof r['phase'] === 'string' ? r['phase'] : '';
    const type = typeof r['type'] === 'string' ? r['type'] : 'hook';
    const name = typeof r['name'] === 'string' && r['name'] ? r['name'] : `${phaseLabel(phase)} hook`;
    const failure = typeof r['failurePolicy'] === 'string' ? FAILURE_LABEL[r['failurePolicy']] : undefined;
    out.push({
      id: typeof r['id'] === 'string' && r['id'] ? r['id'] : `${index}`,
      name,
      phase,
      type,
      enabled: r['enabled'] !== false,
      subtitle: [phaseLabel(phase), type, failure].filter(Boolean).join(' · '),
    });
  });
  return out;
}
