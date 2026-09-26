// ────────────────────────────────────────────────────────────────
// Budget tab: the run's spending budget (`workflow.budget`: turns, cost,
// tokens, wall clock) and how many stages may run at once (`maxParallel`,
// engine default 4).
// ────────────────────────────────────────────────────────────────

import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { FieldIssues } from '../fields/FieldIssues.js';
import { InspectorRow, InspectorSection } from '../fields/InspectorLayout.js';
import { BudgetFields } from '../fields/stageFields.js';

/** The engine's default for `maxParallel`. */
const DEFAULT_MAX_PARALLEL = 4;

export function BudgetTab() {
  const budget = useWorkflowBuilderStore((s) => s.workflow.budget);
  const maxParallel = useWorkflowBuilderStore((s) => s.workflow.maxParallel);
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const updateWorkflow = useWorkflowBuilderStore((s) => s.updateWorkflow);

  return (
    <>
      <InspectorSection title="Run budget" hint="The whole run stops when it is spent">
        <BudgetFields
          budget={budget}
          onChange={(next) => updateWorkflow({ budget: next })}
          issues={issues.filter((i) => i.path.startsWith('/workflow/budget'))}
        />
      </InspectorSection>
      <InspectorSection title="Concurrency">
        <InspectorRow label="Max parallel" hint={`Stages running at once. Empty uses the default (${DEFAULT_MAX_PARALLEL}).`}>
          <NumberField
            size="sm"
            aria-label="Max parallel stages"
            value={maxParallel ?? null}
            onValueChange={(v) => updateWorkflow({ maxParallel: v && v > 0 ? Math.min(32, Math.round(v)) : undefined })}
            min={1}
            max={32}
            step={1}
            unit="stages"
          />
          <FieldIssues issues={issues.filter((i) => i.path === '/workflow/maxParallel')} />
        </InspectorRow>
      </InspectorSection>
    </>
  );
}
