// ────────────────────────────────────────────────────────────────
// EdgeInspector — the inspector of a selected edge: "From → To", when it
// runs (on success · on failure · on completion · always), an optional
// `when` condition, whether it handles a failure of its source, its issues
// and Delete edge.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { EDGE_ON_VALUES, type EdgeOn, type EdgeSpec } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Inspector } from '@/ui/patterns/Inspector/Inspector.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { ExpressionField } from '../../fields/ExpressionField.js';
import { FieldIssues, issuesAt } from '../../fields/FieldIssues.js';
import { InspectorNote, InspectorSection } from '../../fields/InspectorLayout.js';
import { EDGE_HINTS, EDGE_LABELS } from '../../model/edgeStyles.js';
import { useInspectorChrome } from '../InspectorShell.js';
import { Row } from './Row.js';

export function EdgeInspector({ edgeId }: { edgeId: string }) {
  const edge = useWorkflowBuilderStore((s) => s.edges.find((e) => e.id === edgeId)?.data?.edge);
  const fromName = useWorkflowBuilderStore((s) => (edge ? s.nodes.find((n) => n.id === edge.from)?.data.stage.name : undefined));
  const toName = useWorkflowBuilderStore((s) => (edge ? s.nodes.find((n) => n.id === edge.to)?.data.stage.name : undefined));
  const allIssues = useWorkflowBuilderStore((s) => s.issues);
  const updateEdge = useWorkflowBuilderStore((s) => s.updateEdge);
  const removeEdge = useWorkflowBuilderStore((s) => s.removeEdge);
  const chrome = useInspectorChrome();
  const issues = useMemo(() => allIssues.filter((i) => i.edgeId === edgeId), [allIssues, edgeId]);
  if (!edge) return null;
  const update = (updates: Partial<EdgeSpec>) => updateEdge(edgeId, updates);

  return (
    <Inspector
      title={`${fromName || edge.from} → ${toName || edge.to}`}
      label="Edge inspector"
      eyebrow={chrome.eyebrow}
      subtitle={`${edge.from} → ${edge.to}`}
      actions={chrome.actions}
      footer={
        <Button variant="danger-ghost" size="sm" icon="trash" onClick={() => removeEdge(edgeId)}>
          Delete edge
        </Button>
      }
    >
      <InspectorSection title="Edge">
        <Row label="Runs when" hint={EDGE_HINTS[edge.on]}>
          <Select
            size="sm"
            aria-label="Edge condition"
            value={edge.on}
            onValueChange={(v) => v && update({ on: v as EdgeOn })}
            items={EDGE_ON_VALUES.map((on) => ({ value: on, label: EDGE_LABELS[on] }))}
          />
        </Row>
        <Row label="When" optional hint="False makes the edge inactive.">
          <ExpressionField
            expect="boolean"
            value={edge.when ?? ''}
            onChange={(v) => update({ when: v.trim() ? v : undefined })}
            placeholder="e.g. parent.status == 'completed' and variables.env == 'prod'"
            issues={issuesAt(issues, '/when')}
            ariaLabel="Edge when expression"
          />
        </Row>
        <div className="flex items-start gap-2.5">
          <Switch
            aria-label="Handles failure"
            checked={edge.handlesFailure === true}
            onCheckedChange={(checked) => update({ handlesFailure: checked || undefined })}
            className="mt-0.5"
          />
          <div className="min-w-0 flex-1">
            <p className="text-ui text-fg">Handles failure</p>
            <InspectorNote>A completion or always edge counts as handling a failure of the source.</InspectorNote>
          </div>
        </div>
        <FieldIssues issues={issues.filter((i) => !(i.field ?? '').startsWith('/when'))} />
      </InspectorSection>
    </Inspector>
  );
}
