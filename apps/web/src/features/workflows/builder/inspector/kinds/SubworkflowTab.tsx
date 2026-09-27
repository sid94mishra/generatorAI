// ────────────────────────────────────────────────────────────────
// The "Sub-workflow" tab of a sub-workflow stage (P05 §4.2): the stage
// runs another PUBLISHED workflow as a child run — which one (by name,
// portable across export and import, or by id), which version (the one
// current when the stage starts, or a pinned number), the child's
// variables as expressions over this run and where the child works. Its
// output is the child's declared outputs. The child's budget share lives
// on the Policy tab.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import type { SubworkflowSpec, SubworkflowStage, WorkflowDefinitionSummary, WorkflowRef } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type BuilderIssue, type StageUpdate } from '@/stores/workflowBuilderStore.js';
import { useWorkflowDefinition, useWorkflowDefinitions } from '@/hooks/workflowQueries.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { FieldIssues, issuesAt } from '../../fields/FieldIssues.js';
import { InspectorNote, InspectorRow, InspectorSection } from '../../fields/InspectorLayout.js';
import { ExpressionTable, num } from '../../fields/stageFields.js';

interface SubworkflowTabProps {
  stage: SubworkflowStage;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
}

/** The definition a reference names, among the listed ones (the project first, then global). */
export function resolveWorkflowRef(
  ref: WorkflowRef,
  list: readonly WorkflowDefinitionSummary[],
  projectId: string | null,
): WorkflowDefinitionSummary | undefined {
  const live = list.filter((d) => !d.archivedAt);
  if ('id' in ref) return live.find((d) => d.id === ref.id);
  const named = live.filter((d) => d.name === ref.name);
  const inProject = named.find((d) => projectId !== null && d.projectId === projectId);
  const global = named.find((d) => d.projectId === null);
  if (ref.projectScope === 'project') return inProject;
  if (ref.projectScope === 'global') return global;
  return inProject ?? global ?? named[0];
}

const WORKSPACE_HINTS: Record<SubworkflowSpec['workspace'], string> = {
  inherit: "The child edits this run's files; its own mounts and post-processing are skipped (this run commits).",
  isolated: 'A full child lifecycle: its mounts, commit, push and PR.',
};

/** Every section of the Sub-workflow tab (after the stage basics). */
export function SubworkflowSections({ stage, onUpdate, issues }: SubworkflowTabProps) {
  const sub = stage.subworkflow;
  const setSub = (updates: Partial<SubworkflowSpec>) => onUpdate({ subworkflow: { ...sub, ...updates } });
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? null);
  const definitionId = useWorkflowBuilderStore((s) => s.definitionId);
  const { data: definitions, isLoading } = useWorkflowDefinitions();
  const list = useMemo(() => (definitions ?? []).filter((d) => d.id !== definitionId), [definitions, definitionId]);
  const child = resolveWorkflowRef(sub.workflowRef, list, projectId);
  const { data: childRecord } = useWorkflowDefinition(child?.id);
  const childVariables = childRecord?.graph.workflow.variables ?? [];
  const requiredVariables = childVariables.filter((v) => v.required && v.defaultValue === undefined).map((v) => v.name);
  const childOutputs = Object.keys(childRecord?.graph.workflow.outputs ?? {});
  const byId = 'id' in sub.workflowRef;
  const refName = 'name' in sub.workflowRef ? sub.workflowRef.name : undefined;
  const refIssues = issuesAt(issues, '/subworkflow/workflowRef');

  const refItems = [
    ...(child ? [] : [{ value: '', label: 'id' in sub.workflowRef ? sub.workflowRef.id : sub.workflowRef.name, meta: 'not found' }]),
    ...list.map((d) => ({
      value: d.id,
      label: d.name,
      meta: `${d.status === 'draft' ? 'draft · ' : ''}${d.projectId ? 'project' : 'global'}`,
    })),
  ];

  return (
    <>
      <InspectorSection title="Workflow">
        <InspectorRow label="Runs" hint={isLoading ? 'Loading workflows…' : child ? undefined : 'Not found: pick a published workflow.'}>
          <Select
            aria-label="Child workflow"
            size="sm"
            value={child?.id ?? ''}
            onValueChange={(id) => {
              const d = list.find((x) => x.id === id);
              if (!d) return;
              setSub({ workflowRef: byId ? { id: d.id } : { name: d.name } });
            }}
            items={refItems}
            placeholder={isLoading ? 'Loading workflows…' : 'Pick a workflow'}
            invalid={!isLoading && !child}
          />
          {child?.status === 'draft' ? (
            <InspectorNote tone="warn">The child is a draft: publish it before this workflow is published or run.</InspectorNote>
          ) : null}
          <FieldIssues issues={refIssues} />
        </InspectorRow>
        <InspectorRow
          label="Refer to it by"
          hint={byId ? 'This exact definition.' : 'Portable: an export imported elsewhere finds the workflow by name.'}
        >
          <SegmentedControl<'name' | 'id'>
            label="Reference mode"
            value={byId ? 'id' : 'name'}
            onValueChange={(v) => {
              if (v === 'id' && child) setSub({ workflowRef: { id: child.id } });
              else if (v === 'name') setSub({ workflowRef: { name: child?.name ?? refName ?? 'child-workflow' } });
            }}
            items={[
              { value: 'name', label: 'Name' },
              { value: 'id', label: 'Id', disabled: !child, reason: 'Pick a workflow first' },
            ]}
          />
        </InspectorRow>
        {!byId && refName !== undefined && 'name' in sub.workflowRef ? (
          <InspectorRow label="Look up in">
            <Select
              aria-label="Name scope"
              size="sm"
              value={sub.workflowRef.projectScope ?? ''}
              onValueChange={(v) =>
                setSub({ workflowRef: v ? { name: refName, projectScope: v as 'project' | 'global' } : { name: refName } })
              }
              items={[
                { value: '', label: 'This project, then global' },
                { value: 'project', label: "This workflow's project only" },
                { value: 'global', label: 'Global workflows only' },
              ]}
            />
          </InspectorRow>
        ) : null}
        <InspectorRow label="Version">
          <div className="flex items-center gap-2">
            <Select
              aria-label="Child version"
              size="sm"
              className="min-w-0 flex-1"
              value={sub.version === 'pin_at_run_start' ? 'pin' : 'number'}
              onValueChange={(v) => v && setSub({ version: v === 'pin' ? 'pin_at_run_start' : 1 })}
              items={[
                { value: 'pin', label: 'Published when the stage starts' },
                { value: 'number', label: 'A pinned published version' },
              ]}
            />
            {sub.version !== 'pin_at_run_start' ? (
              <NumberField
                size="sm"
                aria-label="Version"
                className="w-24"
                value={sub.version}
                onValueChange={(v) => setSub({ version: Math.max(1, num(v, 1)) })}
                min={1}
                max={100_000}
              />
            ) : null}
          </div>
          <FieldIssues issues={issuesAt(issues, '/subworkflow/version')} />
        </InspectorRow>
        <InspectorRow label="Workspace" hint={WORKSPACE_HINTS[sub.workspace]}>
          <SegmentedControl<SubworkflowSpec['workspace']>
            label="Child workspace"
            value={sub.workspace}
            onValueChange={(workspace) => setSub({ workspace })}
            items={[
              { value: 'inherit', label: "Parent's mounts" },
              { value: 'isolated', label: 'Its own' },
            ]}
          />
          <FieldIssues issues={issuesAt(issues, '/subworkflow/workspace')} />
        </InspectorRow>
      </InspectorSection>

      <InspectorSection title="Inputs" count={Object.keys(sub.inputs).length || undefined}>
        <InspectorNote>
          The child&apos;s variables, each an expression over this run, evaluated when the stage starts.
          {requiredVariables.length > 0 ? ` Required: ${requiredVariables.join(', ')}.` : ''}
        </InspectorNote>
        <ExpressionTable
          record={Object.keys(sub.inputs).length ? sub.inputs : undefined}
          onChange={(inputs) => setSub({ inputs: inputs ?? {} })}
          issues={issues}
          pointer="/subworkflow/inputs"
          noun="input"
          placeholder="e.g. stages.build.output.artifactPath or variables.target"
          suggested={childVariables.map((v) => v.name)}
          addLabel="Add input"
        />
      </InspectorSection>

      <InspectorSection title="Output">
        <InspectorNote>
          <InlineCode dense>stages.{stage.key}.output</InlineCode> is the child&apos;s declared outputs
          {childOutputs.length > 0 ? (
            <>
              : <InlineCode dense>{childOutputs.join(', ')}</InlineCode>.
            </>
          ) : (
            ' (the child declares none yet).'
          )}{' '}
          Approvals, parked loops and waits of the child show on this run&apos;s page.
        </InspectorNote>
      </InspectorSection>
    </>
  );
}
