// ────────────────────────────────────────────────────────────────
// StageKindPanels — the builder side panel of the non-agent stage kinds
// (P05: check, loop, map, sub-workflow, wait). An agent stage uses
// StagePropertiesPanel's tabs. Every kind shares the basics (name, key,
// description, enclosing container), the run condition (guard, join) and
// the compensation actions; the kind's own settings come from
// builder/{Loop,Check,Map,Subworkflow,Wait}Panel.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { X, AlertCircle, Layers, Undo2, Zap, Ungroup } from 'lucide-react';
import type { StageSpec } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type BuilderIssue, type StageUpdate } from '@/stores/workflowBuilderStore.js';
import { Button, Input, Textarea } from '@/components/ui/index.js';
import { CollapsibleSection } from './CollapsibleSection.js';
import { ExpressionField, FieldIssues, issuesAt } from './engineGate.js';
import { CompensationEditor, JoinFields, ParentField, StageKeyField } from './builder/fields.js';
import { LoopPanel } from './builder/LoopPanel.js';
import { CheckPanel } from './builder/CheckPanel.js';
import { MapPanel } from './builder/MapPanel.js';
import { SubworkflowPanel } from './builder/SubworkflowPanel.js';
import { WaitPanel } from './builder/WaitPanel.js';
import { isContainerStage } from './builder/containerLayout.js';
import { KIND_META } from './builder/kindMeta.js';

export interface StageKindPanelProps {
  stage: Exclude<StageSpec, { kind: 'agent' }>;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
  onClose: () => void;
}

export function StageKindPanel({ stage, onUpdate, issues, onClose }: StageKindPanelProps) {
  const unwrapContainer = useWorkflowBuilderStore((s) => s.unwrapContainer);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const Icon = KIND_META[stage.kind].icon;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-col border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-foreground">{stage.name || 'Untitled Stage'}</h3>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {stage.key} · {stage.kind}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isContainerStage(stage) && (
              <Button
                onClick={() => unwrapContainer(stage.key)}
                variant="ghost"
                size="sm"
                leftIcon={<Ungroup className="h-3.5 w-3.5" />}
                className="h-7 px-2 text-xs"
                title={`Remove the ${stage.kind} and keep its stages`}
              >
                Unwrap
              </Button>
            )}
            <Button onClick={onClose} aria-label="Close properties panel" variant="ghost" size="icon-sm">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {errorCount > 0 && (
          <p className="mx-4 mb-2 flex items-center gap-1.5 rounded-md bg-danger-muted px-2 py-1 text-[11px] text-danger">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {errorCount} {errorCount === 1 ? 'issue' : 'issues'} in this stage (shown next to each field)
          </p>
        )}
      </div>

      {/* Keyed by stage so local drafts reset on selection. */}
      <div className="flex-1 overflow-y-auto" key={stage.key}>
        <CollapsibleSection title="Basic" icon={<Layers className="h-3.5 w-3.5" />} defaultOpen>
          <div>
            <label htmlFor="stage-name" className="mb-1.5 block text-xs font-medium text-foreground">Name</label>
            <Input id="stage-name" value={stage.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder="Stage name" />
            <FieldIssues issues={issuesAt(issues, '/name')} />
          </div>
          <StageKeyField stage={stage} issues={issuesAt(issues, '/key')} />
          <div>
            <label htmlFor="stage-description" className="mb-1.5 block text-xs font-medium text-foreground">Description</label>
            <Textarea
              id="stage-description"
              value={stage.description ?? ''}
              onChange={(e) => onUpdate({ description: e.target.value || undefined })}
              rows={2}
              className="resize-none"
              placeholder="Optional description"
            />
          </div>
          <ParentField stage={stage} issues={issuesAt(issues, '/parentKey')} />
        </CollapsibleSection>

        {stage.kind === 'loop' ? (
          <LoopPanel stage={stage} onUpdate={onUpdate} issues={issues} />
        ) : stage.kind === 'check' ? (
          <CheckPanel stage={stage} onUpdate={onUpdate} issues={issues} />
        ) : stage.kind === 'map' ? (
          <MapPanel stage={stage} onUpdate={onUpdate} issues={issues} />
        ) : stage.kind === 'subworkflow' ? (
          <SubworkflowPanel stage={stage} onUpdate={onUpdate} issues={issues} />
        ) : (
          <WaitPanel stage={stage} onUpdate={onUpdate} issues={issues} />
        )}

        <CollapsibleSection title="Run condition" icon={<Zap className="h-3.5 w-3.5" />} defaultOpen={!!stage.guard || stage.join.mode !== 'all'}>
          <div>
            <label htmlFor="stage-guard" className="mb-1.5 block text-xs font-medium text-foreground">Guard</label>
            <ExpressionField
              id="stage-guard"
              expect="boolean"
              value={stage.guard ?? ''}
              onChange={(v) => onUpdate({ guard: v.trim() ? v : undefined })}
              placeholder="e.g. variables.env == 'prod'"
              issues={issuesAt(issues, '/guard')}
              ariaLabel="Guard expression"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Evaluated once the stage is ready; false skips it. Leave empty to always run.
            </p>
          </div>
          <JoinFields join={stage.join} onChange={(join) => onUpdate({ join })} issues={issues} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Compensation"
          icon={<Undo2 className="h-3.5 w-3.5" />}
          defaultOpen={!!stage.compensate?.length}
          badge={stage.compensate?.length ? String(stage.compensate.length) : undefined}
        >
          <CompensationEditor actions={stage.compensate} onChange={(compensate) => onUpdate({ compensate })} issues={issues} />
        </CollapsibleSection>
      </div>
    </div>
  );
}
