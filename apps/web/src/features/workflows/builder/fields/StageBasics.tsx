// ────────────────────────────────────────────────────────────────
// The identity fields every stage kind starts its first tab with
// (WorkflowStagePrompt board): Name and Key side by side, the optional
// Description, and the enclosing container when there is one to pick.
// ────────────────────────────────────────────────────────────────

import type { StageSpec } from '@generatorai/workflow-spec';
import type { BuilderIssue, StageUpdate } from '@/stores/workflowBuilderStore.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { FieldIssues, issuesAt } from './FieldIssues.js';
import { ParentField, StageKeyField } from './stageFields.js';

export interface StageBasicsProps {
  stage: StageSpec;
  issues: readonly BuilderIssue[];
  onUpdate: (updates: StageUpdate) => void;
}

/** Name · Key, Description, In container. */
export function StageBasics({ stage, issues, onUpdate }: StageBasicsProps) {
  const nameIssues = issuesAt(issues, '/name');
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input
            size="sm"
            value={stage.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Stage name"
            invalid={nameIssues.some((i) => i.severity === 'error')}
          />
          <FieldIssues issues={nameIssues} />
        </Field>
        <StageKeyField stage={stage} issues={issuesAt(issues, '/key')} stacked />
      </div>
      <Field label="Description" optional>
        <Textarea
          value={stage.description ?? ''}
          onChange={(e) => onUpdate({ description: e.target.value || undefined })}
          rows={1}
          autosize={{ minRows: 1, maxRows: 4 }}
          placeholder="What this stage is for"
        />
      </Field>
      <ParentField stage={stage} issues={issuesAt(issues, '/parentKey')} />
    </div>
  );
}
