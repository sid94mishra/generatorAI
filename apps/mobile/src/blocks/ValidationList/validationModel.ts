// MB-37 ValidationList model (03 MB-37; MWorkflowValidate): the headline ("3 errors · 1 warning" / "All clear"), the
// issues errors-first with the stage each belongs to (named from the stage key, or read from the JSON pointer
// `/stages/<i>`), and the per-stage error counts the builder's cards show. Quick fixes render only with MG-33.
// Pure, unit-tested.
import type { ValidationIssue } from '@generatorai/workflow-spec';

export function validationHeadline(issues: readonly ValidationIssue[]): string {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  if (!issues.length) return 'All clear';
  return [errors ? `${errors} error${errors === 1 ? '' : 's'}` : null, warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
}

/** The stage key an issue belongs to: its `stageKey`, else the stage its pointer names. */
export function issueStageKey(issue: ValidationIssue, stageKeys: readonly string[]): string | null {
  if (issue.stageKey) return issue.stageKey;
  const m = /^\/stages\/(\d+)/.exec(issue.path);
  return m ? (stageKeys[Number(m[1])] ?? null) : null;
}

export function sortIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** Errors per stage key (the builder card's "⊗ 1"). */
export function errorsByStage(issues: readonly ValidationIssue[], stageKeys: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of issues) {
    if (i.severity !== 'error') continue;
    const key = issueStageKey(i, stageKeys);
    if (key) out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}
