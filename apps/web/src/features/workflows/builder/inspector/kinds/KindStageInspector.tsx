// ────────────────────────────────────────────────────────────────
// The inspector of a non-agent stage (check, loop, map, sub-workflow,
// wait; WorkflowLoopBuilder board). Two tabs:
//
//   <Kind>   the stage basics (Name · Key, Description, container), then
//            the kind's own sections (LoopTab, CheckTab, MapTab,
//            SubworkflowTab, WaitTab)
//   Policy   the run condition (join, guard), the kind's policy parts (a
//            check's timeouts and retry; a map's or sub-workflow's
//            budget) and the compensation actions
//
// None of these kinds has stage hooks in the spec, so there is no Hooks
// tab. A container (loop, map) can be unwrapped from the footer: the
// container goes, its stages stay.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import type { StageKind } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { isContainerStage } from '@/stores/workflowContainerLayout.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { ExpressionField } from '../../fields/ExpressionField.js';
import { StageIssueList, issuesAt } from '../../fields/FieldIssues.js';
import { InspectorRow, InspectorSection } from '../../fields/InspectorLayout.js';
import { StageBasics } from '../../fields/StageBasics.js';
import { BudgetFields, CompensationEditor, JoinFields } from '../../fields/stageFields.js';
import { KIND_META } from '../../model/kindMeta.js';
import { StageInspectorShell, tabCount } from '../InspectorShell.js';
import type { OtherStageSpec, StageInspectorProps } from '../types.js';
import { CheckPolicySections, CheckSections } from './CheckTab.js';
import { LoopSections } from './LoopTab.js';
import { MapSections } from './MapTab.js';
import { SubworkflowSections } from './SubworkflowTab.js';
import { WaitSections } from './WaitTab.js';

const POLICY_TAB = 'policy';

/** The JSON pointers the Policy tab of a kind edits (the rest belong to the kind's tab). */
export function policyPointers(kind: Exclude<StageKind, 'agent'>): string[] {
  const base = ['/guard', '/join', '/compensate'];
  if (kind === 'check') return [...base, '/check/timeoutMs', '/timeouts', '/retry'];
  if (kind === 'map' || kind === 'subworkflow') return [...base, '/budget'];
  return base;
}

const hasError = (issues: readonly BuilderIssue[]) => issues.some((i) => i.severity === 'error');

/** The Check · Loop · Map · Sub-workflow · Wait stage inspector. */
export function KindStageInspector({ stage, issues, onUpdate, tab, onTabChange }: StageInspectorProps<OtherStageSpec>) {
  const unwrapContainer = useWorkflowBuilderStore((s) => s.unwrapContainer);
  const kindTab = stage.kind;
  const active = tab === POLICY_TAB ? POLICY_TAB : kindTab;
  const policyIssues = issuesAt(issues, ...policyPointers(stage.kind));
  const kindIssues = issues.filter((i) => !policyIssues.includes(i));

  const tabs = [
    { value: kindTab, label: KIND_META[stage.kind].name, count: tabCount(undefined, hasError(kindIssues)) },
    { value: POLICY_TAB, label: 'Policy', count: tabCount(stage.compensate?.length, hasError(policyIssues)) },
  ];

  const footer = isContainerStage(stage) ? (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-small text-fg-3">Remove the {stage.kind} and keep its stages</span>
      <Button size="sm" icon="ungroup" title={`Remove the ${stage.kind} and keep its stages`} onClick={() => unwrapContainer(stage.key)}>
        Unwrap
      </Button>
    </div>
  ) : undefined;

  let body: ReactNode;
  if (active === POLICY_TAB) {
    body = <PolicySections stage={stage} issues={issues} onUpdate={onUpdate} />;
  } else {
    const kindProps = { onUpdate, issues };
    body = (
      <>
        <InspectorSection title="Basics">
          <StageBasics stage={stage} issues={issues} onUpdate={onUpdate} />
        </InspectorSection>
        {stage.kind === 'loop' ? (
          <LoopSections stage={stage} {...kindProps} />
        ) : stage.kind === 'check' ? (
          <CheckSections stage={stage} {...kindProps} />
        ) : stage.kind === 'map' ? (
          <MapSections stage={stage} {...kindProps} />
        ) : stage.kind === 'subworkflow' ? (
          <SubworkflowSections stage={stage} {...kindProps} />
        ) : (
          <WaitSections stage={stage} {...kindProps} />
        )}
      </>
    );
  }

  return (
    <StageInspectorShell stage={stage} tabs={tabs} tab={active} onTabChange={onTabChange} footer={footer}>
      <StageIssueList issues={issues} />
      {body}
    </StageInspectorShell>
  );
}

/** Join · Guard, the kind's policy parts, Compensation. */
function PolicySections({ stage, issues, onUpdate }: Pick<StageInspectorProps<OtherStageSpec>, 'stage' | 'issues' | 'onUpdate'>) {
  return (
    <>
      <InspectorSection title="Run condition">
        <JoinFields join={stage.join} onChange={(join) => onUpdate({ join })} issues={issues} />
        <InspectorRow label="Guard" hint="Evaluated once the stage is ready; false skips it. Leave empty to always run.">
          <ExpressionField
            expect="boolean"
            value={stage.guard ?? ''}
            onChange={(v) => onUpdate({ guard: v.trim() ? v : undefined })}
            placeholder="e.g. variables.env == 'prod'"
            issues={issuesAt(issues, '/guard')}
            ariaLabel="Guard expression"
          />
        </InspectorRow>
      </InspectorSection>

      {stage.kind === 'check' ? <CheckPolicySections stage={stage} onUpdate={onUpdate} issues={issues} /> : null}
      {stage.kind === 'map' || stage.kind === 'subworkflow' ? (
        <InspectorSection title="Budget" hint={stage.kind === 'map' ? 'all items' : "the child run's"}>
          <BudgetFields budget={stage.budget} onChange={(budget) => onUpdate({ budget })} issues={issuesAt(issues, '/budget')} />
        </InspectorSection>
      ) : null}

      <InspectorSection title="Compensation" count={stage.compensate?.length || undefined}>
        <CompensationEditor actions={stage.compensate} onChange={(compensate) => onUpdate({ compensate })} issues={issues} />
      </InspectorSection>
    </>
  );
}
