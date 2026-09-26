// ────────────────────────────────────────────────────────────────
// SubworkflowPanel — the inspector of a sub-workflow stage (P05 §4.2,
// WP-5B.2).
//
// The stage runs another PUBLISHED workflow as a child run: which one (by
// name, portable across export and import, or by id), which version (the
// one current when the stage starts, or a pinned number), the child's
// variables as expressions over this run, where the child works (the
// parent's mounts, or its own full lifecycle) and its share of the budget.
// Its output is the child's declared outputs.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Info, ListChecks, Variable, Workflow } from 'lucide-react';
import type { SubworkflowSpec, SubworkflowStage, WorkflowDefinitionSummary, WorkflowRef } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type BuilderIssue, type StageUpdate } from '@/stores/workflowBuilderStore.js';
import { useWorkflowDefinition, useWorkflowDefinitions } from '@/hooks/workflowQueries.js';
import { Select } from '@/components/ui/index.js';
import { CollapsibleSection } from '../CollapsibleSection.js';
import { NumberStepper } from '../NumberStepper.js';
import { FieldIssues, issuesAt } from '../engineGate.js';
import { BudgetFields, ExpressionTable } from './fields.js';

interface SubworkflowPanelProps {
  stage: SubworkflowStage;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
}

/** The definition a reference names, among the listed ones (the project first, then global). */
function resolveRef(ref: WorkflowRef, list: readonly WorkflowDefinitionSummary[], projectId: string | null): WorkflowDefinitionSummary | undefined {
  const live = list.filter((d) => !d.archivedAt);
  if ('id' in ref) return live.find((d) => d.id === ref.id);
  const named = live.filter((d) => d.name === ref.name);
  const inProject = named.find((d) => projectId !== null && d.projectId === projectId);
  const global = named.find((d) => d.projectId === null);
  if (ref.projectScope === 'project') return inProject;
  if (ref.projectScope === 'global') return global;
  return inProject ?? global ?? named[0];
}

export function SubworkflowPanel({ stage, onUpdate, issues }: SubworkflowPanelProps) {
  const sub = stage.subworkflow;
  const setSub = (updates: Partial<SubworkflowSpec>) => onUpdate({ subworkflow: { ...sub, ...updates } });
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? null);
  const definitionId = useWorkflowBuilderStore((s) => s.definitionId);
  const { data: definitions, isLoading } = useWorkflowDefinitions();
  const list = useMemo(() => (definitions ?? []).filter((d) => d.id !== definitionId), [definitions, definitionId]);
  const child = resolveRef(sub.workflowRef, list, projectId);
  const { data: childRecord } = useWorkflowDefinition(child?.id);
  const childVariables = childRecord?.graph.workflow.variables ?? [];
  const childOutputs = Object.keys(childRecord?.graph.workflow.outputs ?? {});
  const byId = 'id' in sub.workflowRef;

  const refOptions = [
    ...(child ? [] : [{ value: '', label: 'id' in sub.workflowRef ? sub.workflowRef.id : sub.workflowRef.name, description: 'Not found' }]),
    ...list.map((d) => ({
      value: d.id,
      label: d.name,
      description: `${d.status === 'draft' ? 'Draft (publish it first) · ' : ''}${d.projectId ? 'project' : 'global'}`,
    })),
  ];

  return (
    <div>
      <CollapsibleSection title="Workflow" icon={<Workflow className="h-3.5 w-3.5" />} defaultOpen>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Runs</label>
          <Select
            aria-label="Child workflow"
            value={child?.id ?? ''}
            onChange={(id) => {
              const d = list.find((x) => x.id === id);
              if (!d) return;
              setSub({ workflowRef: byId ? { id: d.id } : { name: d.name } });
            }}
            options={refOptions}
            placeholder={isLoading ? 'Loading workflows…' : 'Pick a workflow'}
          />
          <FieldIssues issues={issuesAt(issues, '/subworkflow/workflowRef')} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Refer to it by</label>
          <Select
            aria-label="Reference mode"
            value={byId ? 'id' : 'name'}
            onChange={(v) => {
              if (v === 'id' && child) setSub({ workflowRef: { id: child.id } });
              else if (v === 'name') setSub({ workflowRef: { name: child?.name ?? ('name' in sub.workflowRef ? sub.workflowRef.name : 'child-workflow') } });
            }}
            options={[
              { value: 'name', label: 'Name', description: 'Portable: an export imported elsewhere finds the workflow by name' },
              { value: 'id', label: 'Id', description: 'This exact definition' },
            ]}
          />
        </div>
        {!byId && 'name' in sub.workflowRef && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Look the name up in</label>
            <Select
              aria-label="Name scope"
              value={sub.workflowRef.projectScope ?? ''}
              onChange={(v) =>
                setSub({
                  workflowRef: v ? { name: (sub.workflowRef as { name: string }).name, projectScope: v as 'project' | 'global' } : { name: (sub.workflowRef as { name: string }).name },
                })
              }
              options={[
                { value: '', label: 'This project, then global' },
                { value: 'project', label: "This workflow's project only" },
                { value: 'global', label: 'Global workflows only' },
              ]}
            />
          </div>
        )}
        {child?.status === 'draft' && (
          <p className="text-[11px] text-warning">The child is a draft: publish it before this workflow is published or run.</p>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Version</label>
          <Select
            aria-label="Child version"
            value={sub.version === 'pin_at_run_start' ? 'pin' : 'number'}
            onChange={(v) => setSub({ version: v === 'pin' ? 'pin_at_run_start' : 1 })}
            options={[
              { value: 'pin', label: 'The published version when the stage starts' },
              { value: 'number', label: 'A pinned published version' },
            ]}
          />
          {sub.version !== 'pin_at_run_start' && (
            <div className="mt-2">
              <NumberStepper label="Version" value={sub.version} onChange={(version) => setSub({ version: Math.max(1, version) })} min={1} max={100_000} />
            </div>
          )}
          <FieldIssues issues={issuesAt(issues, '/subworkflow/version')} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Workspace</label>
          <Select
            aria-label="Child workspace"
            value={sub.workspace}
            onChange={(v) => setSub({ workspace: v as SubworkflowSpec['workspace'] })}
            options={[
              {
                value: 'inherit',
                label: "The parent's mounts",
                description: "The child edits this run's files; its own mounts and post-processing are skipped (this run commits)",
              },
              { value: 'isolated', label: 'Its own workspace', description: 'A full child lifecycle: its mounts, commit, push and PR' },
            ]}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Inputs"
        icon={<Variable className="h-3.5 w-3.5" />}
        defaultOpen
        badge={Object.keys(sub.inputs).length ? String(Object.keys(sub.inputs).length) : undefined}
      >
        <p className="text-[10px] text-muted-foreground">
          The child&apos;s variables, each an expression over this run, evaluated when the stage starts.
          {childVariables.some((v) => v.required && v.defaultValue === undefined) && (
            <> Required: {childVariables.filter((v) => v.required && v.defaultValue === undefined).map((v) => v.name).join(', ')}.</>
          )}
        </p>
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
      </CollapsibleSection>

      <CollapsibleSection title="Output" icon={<Info className="h-3.5 w-3.5" />} defaultOpen={false}>
        <p className="text-[10px] text-muted-foreground">
          <code>stages.{stage.key}.output</code> is the child&apos;s declared outputs
          {childOutputs.length > 0 ? (
            <>
              : <code>{childOutputs.join(', ')}</code>.
            </>
          ) : (
            ' (the child declares none yet).'
          )}{' '}
          Approvals, parked loops and waits of the child show on this run&apos;s page.
        </p>
      </CollapsibleSection>

      <CollapsibleSection title="Budget" icon={<ListChecks className="h-3.5 w-3.5" />} defaultOpen={!!stage.budget}>
        <p className="text-[10px] text-muted-foreground">The child run&apos;s budget: its share of this run&apos;s.</p>
        <BudgetFields budget={stage.budget} onChange={(budget) => onUpdate({ budget })} issues={issuesAt(issues, '/budget')} />
      </CollapsibleSection>

    </div>
  );
}
