// ────────────────────────────────────────────────────────────────
// Validation issues next to the field they point at (D-25), with the
// issue's quick fix (P07 WP-7.6) when it has one, plus the inspector's
// "issues in this stage" list for issues whose field has no control.
// ────────────────────────────────────────────────────────────────

import type { BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { quickFixFor } from '../model/issueFixes.js';

/** Issues whose field is `prefix` or lies under it. */
export function issuesAt(issues: readonly BuilderIssue[], ...prefixes: string[]): BuilderIssue[] {
  return issues.filter((i) => prefixes.some((p) => i.field === p || (i.field ?? '').startsWith(`${p}/`)));
}

/** The fix button of an issue (nothing when it has none). */
export function IssueFixButton({ issue, short = false, className }: { issue: BuilderIssue; short?: boolean; className?: string }) {
  const fix = quickFixFor(issue);
  if (!fix) return null;
  return (
    <Button
      size="sm"
      variant={short ? 'secondary' : 'ghost'}
      icon={short ? 'plus' : 'wand'}
      title={fix.label}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        fix.apply();
      }}
    >
      {short ? fix.short : fix.label}
    </Button>
  );
}

/** Issue messages shown under a field. */
export function FieldIssues({ issues, className }: { issues: readonly BuilderIssue[]; className?: string }) {
  if (issues.length === 0) return null;
  return (
    <ul className={cn('flex flex-col gap-1', className)} data-testid="field-issues">
      {issues.map((issue, i) => (
        <li
          key={`${issue.code}:${issue.path}:${i}`}
          className={cn('flex items-start gap-1.5 text-small', issue.severity === 'error' ? 'text-err' : 'text-warn')}
        >
          <Icon concept={issue.severity === 'error' ? 'status-failed' : 'warning'} size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {issue.message}
            {issue.hint ? <span className="text-fg-3"> — {issue.hint}</span> : null}
          </span>
          <IssueFixButton issue={issue} className="-my-0.5 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Every issue of the selected stage, at the top of the inspector: the ones
 * whose field has no control (a field of another kind, an unknown field)
 * would otherwise show nowhere. Each carries its quick fix when it has one.
 */
export function StageIssueList({ issues }: { issues: readonly BuilderIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (errors.length === 0 && warnings.length === 0) return null;
  const counts = [
    errors.length > 0 ? `${errors.length} ${errors.length === 1 ? 'error' : 'errors'}` : '',
    warnings.length > 0 ? `${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}` : '',
  ].filter(Boolean);
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-card border px-3 py-2 text-small',
        errors.length > 0 ? 'border-err bg-err-bg' : 'border-warn bg-warn-bg',
      )}
      data-testid="stage-issues"
    >
      <p className={cn('flex items-center gap-1.5 font-medium', errors.length > 0 ? 'text-err' : 'text-warn')}>
        <Icon concept={errors.length > 0 ? 'status-failed' : 'warning'} size={12} />
        {counts.join(', ')} in this stage
      </p>
      <ul className="flex flex-col gap-1">
        {[...errors, ...warnings].map((issue, i) => (
          <li key={`${issue.code}:${issue.path}:${i}`} className="flex items-start gap-1.5 text-fg">
            <span className="min-w-0 flex-1">
              {issue.field ? <span className="font-mono text-micro text-fg-3">{issue.field.slice(1).replace(/\//g, '.')}: </span> : null}
              {issue.message}
            </span>
            <IssueFixButton issue={issue} className="-my-0.5 shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  );
}
