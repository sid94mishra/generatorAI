// The stage editor's small field helpers (M8-06): a duration field ("10m", committed on blur), a number field that
// may be empty, and the "Edit on desktop" row for an editor the phone does not have (MD-04).
import React, { useState } from 'react';
import type { AgentStage, StageSpec, WorkflowGraph } from '@generatorai/workflow-spec';

import { ListRow } from '../../../ui/layout/ListRow';
import { Field } from '../../../ui/primitives/Field';
import { Input } from '../../../ui/primitives/Input';
import { formatDuration, parseDuration } from './stageEditorModel';

export interface TabProps {
  workflowId: string;
  stage: AgentStage;
  set: (next: AgentStage) => void;
  graph: WorkflowGraph;
  isAdmin: boolean;
}

export interface GeneralProps {
  stage: StageSpec;
  set: (next: StageSpec) => void;
}

export function DurationInput({ label, value, onChange, placeholder = '—', testID }: { label: string; value: number | undefined; onChange: (ms: number | undefined) => void; placeholder?: string; testID?: string }): React.ReactElement {
  // The text being typed; null shows the committed value.
  const [draft, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const text = draft ?? formatDuration(value);
  const commit = (): void => {
    if (draft === null) return;
    const ms = parseDuration(draft);
    if (ms === null) {
      setError('Use 30s, 10m or 1h');
      return;
    }
    setError(undefined);
    setText(null);
    onChange(ms);
  };
  return (
    <Field {...(error ? { error } : {})}>
      <Input label={label} value={text} onChangeText={setText} onBlur={commit} onSubmitEditing={commit} kind="mono" placeholder={placeholder} returnKeyType="done" {...(error ? { error } : {})} {...(testID ? { testID } : {})} />
    </Field>
  );
}

export function OptionalNumberInput({ label, value, onChange, placeholder = '—', prefix, testID }: { label: string; value: number | undefined; onChange: (n: number | undefined) => void; placeholder?: string; prefix?: string; testID?: string }): React.ReactElement {
  const [draft, setText] = useState<string | null>(null);
  const text = draft ?? (value === undefined ? '' : String(value));
  const commit = (): void => {
    if (draft === null) return;
    const n = Number(draft.replace(prefix ?? '', '').trim());
    setText(null);
    onChange(draft.trim() && Number.isFinite(n) && n > 0 ? n : undefined);
  };
  return <Input label={label} value={text} onChangeText={setText} onBlur={commit} onSubmitEditing={commit} kind="number" placeholder={placeholder} returnKeyType="done" {...(testID ? { testID } : {})} />;
}

export function DesktopOnlyRow({ title, subtitle }: { title: string; subtitle?: string }): React.ReactElement {
  return <ListRow kind="info" title={title} subtitle={subtitle ? `${subtitle} · Edit on desktop` : 'Edit on desktop'} icon="computer" />;
}
