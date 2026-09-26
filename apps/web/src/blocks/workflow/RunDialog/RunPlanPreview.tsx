// ────────────────────────────────────────────────────────────────
// WF-11 RunDialogPlanPreview (03-component-inventory-domain.md §4): the 360
// aside of the Run dialog — what the server will do for the form as it
// stands (`POST /workflow-runs/plan`, P04): stage layers (‖ parallel),
// approvals, codebases, setup, before/after steps, permission, risks and
// warnings. Props only; the dialog plans and passes the result.
// ────────────────────────────────────────────────────────────────

import { Fragment, type ReactNode } from 'react';
import type { InvocationPlan } from '@generatorai/workflow-spec';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/index.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { formatWorkflowApiIssue } from '../apiErrors.js';
import { PERMISSION_LABELS, type StartError } from './runDialogModel.js';

export interface RunPlanPreviewProps {
  plan: InvocationPlan | null;
  /** A plan request is in flight. */
  loading: boolean;
  /** The last plan request was refused. */
  error: StartError | null;
  /** The shown plan is for an earlier state of the form. */
  stale: boolean;
  /** Nothing saved to plan yet (the builder's unsaved draft). */
  unavailable?: string;
  /** Footnote ("Published workflows run v7"). */
  footnote?: ReactNode;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-small">
      <span className="w-24 shrink-0 text-fg-3">{label}</span>
      <span className="min-w-0 flex-1 text-fg-2">{children}</span>
    </div>
  );
}

export function RunPlanPreview({ plan, loading, error, stale, unavailable, footnote }: RunPlanPreviewProps) {
  const layers = new Map<number, InvocationPlan['stages']>();
  for (const s of plan?.stages ?? []) layers.set(s.layer, [...(layers.get(s.layer) ?? []), s]);
  const ordered = [...layers.entries()].sort(([a], [b]) => a - b);
  const approvals = (plan?.stages ?? []).filter((s) => s.approvalRequired && !s.skipped);
  const skippedByGuard = (plan?.stages ?? []).filter((s) => s.skipReason === 'guard_false');

  return (
    <div className="flex flex-col gap-4" data-testid="run-plan-preview">
      <div className="flex items-center gap-2">
        <span className="text-title text-fg">Plan preview</span>
        <span className="text-small text-fg-3">updates as you edit</span>
        <span className="ml-auto flex items-center gap-1 text-small">
          {loading ? (
            <Spinner size={12} label="Planning" />
          ) : error ? (
            <>
              <Icon concept="status-failed" size={12} className="text-err" />
              <span className="text-err">Refused</span>
            </>
          ) : plan && !stale ? (
            <>
              <Icon concept="status-succeeded" size={12} className="text-ok" />
              <span className="text-ok">Valid</span>
            </>
          ) : null}
        </span>
      </div>

      {unavailable ? <p className="text-small text-fg-3">{unavailable}</p> : null}

      {error ? (
        <Callout tone="err" title={error.message}>
          {error.issues.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {error.issues.map((issue, i) => (
                <li key={i}>{formatWorkflowApiIssue(issue)}</li>
              ))}
            </ul>
          ) : null}
        </Callout>
      ) : null}

      {plan ? (
        <div className={cn('flex flex-col gap-4', stale && 'text-fg-3')}>
          <ol className="flex flex-col gap-1.5" aria-label="Stage layers">
            {ordered.map(([layer, stages]) => (
              <li key={layer} className="flex flex-wrap items-center gap-1.5">
                <span className="w-6 shrink-0 font-mono text-micro text-fg-3">L{layer + 1}</span>
                {stages.map((s, i) => (
                  <Fragment key={s.key}>
                    {i > 0 ? <span className="text-micro text-fg-3" aria-hidden="true">‖</span> : null}
                    <Chip
                      mono
                      size="sm"
                      className={cn(s.skipped && 'text-fg-3 line-through')}
                      title={[
                        s.name,
                        s.skipped ? `skipped (${s.skipReason === 'guard_false' ? 'guard is false' : 'override'})` : null,
                        s.model ? `model ${s.model}` : null,
                        s.approvalRequired ? 'waits for approval' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    >
                      {s.key}
                      {s.approvalRequired && !s.skipped ? <Icon concept="hand" size={12} className="text-warn" /> : null}
                    </Chip>
                  </Fragment>
                ))}
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-2">
            {skippedByGuard.length > 0 ? (
              <Row label="Conditional">{skippedByGuard.map((s) => s.key).join(', ')} · guard is false now</Row>
            ) : null}
            {approvals.length > 0 ? <Row label="Approval">{approvals.map((s) => s.key).join(', ')}</Row> : null}
            <Row label="Codebases">
              {plan.codebases.length === 0
                ? 'None'
                : plan.codebases
                    .map((c) => `${c.alias}${c.baseRef ? ` @ ${c.baseRef}` : ''} · ${c.mode === 'in_place' ? 'in place' : 'new worktree'}`)
                    .join(', ')}
            </Row>
            {plan.prepare.length > 0 ? <Row label="Setup">{plan.prepare.join(' · ')}</Row> : null}
            {plan.preprocessing.length > 0 ? <Row label="Before">{plan.preprocessing.join(', ')}</Row> : null}
            <Row label="Post-processing">{plan.postProcessing.length > 0 ? plan.postProcessing.join(' → ') : 'Nothing'}</Row>
            <Row label="Permission">{PERMISSION_LABELS[plan.permissionMode]}</Row>
            {plan.stages.some((s) => s.model && !s.skipped) ? (
              <Row label="Models">
                {plan.stages
                  .filter((s) => s.model && !s.skipped)
                  .map((s) => `${s.key}: ${s.model}`)
                  .join(', ')}
              </Row>
            ) : null}
          </div>

          {plan.risks.map((r) => (
            <Callout key={r.code} tone="warn" title={r.message} />
          ))}

          {plan.warnings.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-ui text-fg">
                Warnings <span className="font-mono text-micro text-fg-3">{plan.warnings.length}</span>
              </span>
              {plan.warnings.map((w, i) => (
                <Callout key={i} tone="warn" title={w.message} />
              ))}
            </div>
          ) : null}
          {stale && !loading ? <p className="text-small text-fg-3">The form changed; the plan refreshes in a moment.</p> : null}
        </div>
      ) : null}

      {footnote ? <p className="text-small text-fg-3">{footnote}</p> : null}
    </div>
  );
}
