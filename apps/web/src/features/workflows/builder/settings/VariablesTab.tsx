// ────────────────────────────────────────────────────────────────
// Variables tab (WorkflowSettingsPanel board): the run inputs as a table —
// Name · Type · Req. · Default — whose rows expand into their edit form,
// the inline "New variable" form (a reserved or taken name is refused as it
// is typed) and the chips of what the Run dialog asks for at launch.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VariableDefinition } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Chip, ChipList } from '@/ui/primitives/Chip/Chip.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Table, TableBody, TableCell, TableHeadCell, TableHeader, TableRow } from '@/ui/primitives/Table/Table.js';
import { FieldIssues } from '../fields/FieldIssues.js';
import { InspectorNote, InspectorRow, InspectorSection } from '../fields/InspectorLayout.js';
import {
  RESERVED_VARIABLE_ROOTS,
  VARIABLE_TYPES,
  coerceDefault,
  defaultPreview,
  defaultText,
  isAutoLabel,
  isReservedVariableName,
  nextVariableName,
  parseOptions,
  runDialogFields,
  typeShortLabel,
  variableNameError,
  type VariableType,
} from './variables.js';

let rowIdCounter = 0;
const nextRowId = () => `var-row-${++rowIdCounter}`;

const TYPE_ITEMS = VARIABLE_TYPES.map((t) => ({ value: t.value, label: t.label }));
const COLUMNS = ['minmax(0,1fr)', 60, 28, 72] as const;

/** The value of the Select on a type change: the existing default re-read under the new type. */
function retype(variable: VariableDefinition, type: VariableType): Partial<VariableDefinition> {
  return {
    type,
    // Switching String → Number turns "4" into 4.
    defaultValue: coerceDefault(defaultText(variable.defaultValue, variable.type), type),
  };
}

export function VariablesTab() {
  const variables = useWorkflowBuilderStore((s) => s.workflow.variables);
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const updateWorkflow = useWorkflowBuilderStore((s) => s.updateWorkflow);
  const setVariables = useCallback((next: VariableDefinition[]) => updateWorkflow({ variables: next }), [updateWorkflow]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // Stable row identities (D-10): keyed by name, a row remounted on every
  // keystroke of a rename and the input lost focus. Rows added or removed
  // here keep their ids; a list replaced from outside (undo, reload) gets
  // fresh ones.
  const rowIds = useRef<string[]>([]);
  if (rowIds.current.length !== variables.length) {
    rowIds.current = variables.map((_, i) => rowIds.current[i] ?? nextRowId());
  }

  const addVariable = (variable: VariableDefinition) => {
    rowIds.current = [...rowIds.current, nextRowId()];
    setVariables([...variables, variable]);
    setAdding(false);
  };

  const updateVariable = (index: number, updates: Partial<VariableDefinition>) => {
    setVariables(
      variables.map((v, i) => {
        if (i !== index) return v;
        const next = { ...v, ...updates };
        // The label is what the Run dialog asks for: a rename carries an
        // automatic label along; a label the user wrote is never touched.
        if (updates.name !== undefined && isAutoLabel(v.label, v.name)) next.label = updates.name;
        return next;
      }),
    );
  };

  const removeVariable = (index: number) => {
    rowIds.current = rowIds.current.filter((_, i) => i !== index);
    setVariables(variables.filter((_, i) => i !== index));
    if (expandedIndex === index) setExpandedIndex(null);
    else if (expandedIndex !== null && expandedIndex > index) setExpandedIndex(expandedIndex - 1);
  };

  const fields = runDialogFields(variables);

  return (
    <>
      <InspectorSection
        title="Run inputs"
        count={variables.length || undefined}
        action={
          <Button size="sm" icon="plus" onClick={() => setAdding(true)} disabled={adding}>
            Add variable
          </Button>
        }
      >
        <InspectorNote>
          Variables are requested from users before starting a run. Use {'{{name}}'} in prompts to interpolate.
        </InspectorNote>

        {variables.length === 0 && !adding ? (
          <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line px-4 py-5 text-center">
            <p className="text-small text-fg-3">No variables defined. Runs will start without asking for input.</p>
            <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(true)}>
              Add your first variable
            </Button>
          </div>
        ) : null}

        {variables.length > 0 ? (
          <Table columns={COLUMNS} inset="card" size="dense" label="Variables" bare>
            <TableHeader>
              <TableHeadCell>Name</TableHeadCell>
              <TableHeadCell>Type</TableHeadCell>
              <TableHeadCell>Req.</TableHeadCell>
              <TableHeadCell align="end">Default</TableHeadCell>
            </TableHeader>
            <TableBody>
              {variables.map((variable, index) => {
                const expanded = expandedIndex === index;
                const others = variables.filter((_, i) => i !== index).map((v) => v.name);
                const nameError = variableNameError(variable.name, others);
                const rowIssues = issues.filter(
                  (i) => i.path === `/workflow/variables/${index}` || i.path.startsWith(`/workflow/variables/${index}/`),
                );
                const preview = defaultPreview(variable.defaultValue, variable.type);
                const invalid = nameError !== null || rowIssues.some((i) => i.severity === 'error');
                return (
                  <VariableRows
                    key={rowIds.current[index]}
                    variable={variable}
                    expanded={expanded}
                    invalid={invalid}
                    preview={preview}
                    nameError={nameError}
                    rowIssues={rowIssues}
                    onToggle={() => setExpandedIndex(expanded ? null : index)}
                    onUpdate={(updates) => updateVariable(index, updates)}
                    onRemove={() => removeVariable(index)}
                  />
                );
              })}
            </TableBody>
          </Table>
        ) : null}

        {adding ? (
          <NewVariableForm taken={variables.map((v) => v.name)} suggestedName={nextVariableName(variables)} onAdd={addVariable} onCancel={() => setAdding(false)} />
        ) : null}
      </InspectorSection>

      {fields.length > 0 ? (
        <InspectorSection title="At launch, the Run dialog asks for" data-testid="variables-run-preview">
          <ChipList max={4}>
            {fields.map((f) => (
              <Chip key={f.name} title={f.required ? `${f.label} (required)` : f.label}>
                {f.label}
                {f.defaultValue !== null ? <span className="font-mono text-micro text-fg-3">{f.defaultValue}</span> : null}
              </Chip>
            ))}
          </ChipList>
        </InspectorSection>
      ) : null}
    </>
  );
}

interface VariableRowsProps {
  variable: VariableDefinition;
  expanded: boolean;
  invalid: boolean;
  preview: string | null;
  nameError: string | null;
  rowIssues: Parameters<typeof FieldIssues>[0]['issues'];
  onToggle: () => void;
  onUpdate: (updates: Partial<VariableDefinition>) => void;
  onRemove: () => void;
}

/** One variable: its table row and, expanded, its edit form. */
function VariableRows({ variable, expanded, invalid, preview, nameError, rowIssues, onToggle, onUpdate, onRemove }: VariableRowsProps) {
  const label = variable.label ?? '';
  return (
    <>
      <TableRow selected={expanded}>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            icon={expanded ? 'chevron-down' : 'chevron-right'}
            aria-expanded={expanded}
            title={label || variable.name}
            onClick={onToggle}
            className="-ml-2 max-w-full min-w-0 justify-start"
          >
            <span className={invalid ? 'truncate font-mono text-err' : 'truncate font-mono text-fg'}>{variable.name || '(unnamed)'}</span>
          </Button>
        </TableCell>
        <TableCell className="text-fg-2">{typeShortLabel(variable.type)}</TableCell>
        <TableCell className="text-fg-3">
          {variable.required ? (
            <Icon concept="check" size={12} label="Required" />
          ) : (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">Optional</span>
            </>
          )}
        </TableCell>
        <TableCell align="end" mono title={preview ?? undefined}>
          <span className="truncate">{preview ?? '—'}</span>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow className="h-auto hover:bg-transparent aria-selected:bg-transparent">
          <TableCell className="col-span-full flex-col items-stretch gap-2.5 py-3">
            <div className="grid grid-cols-2 gap-2.5">
              <InspectorRow label="Name" stacked error={nameError ?? undefined}>
                <Input
                  size="sm"
                  mono
                  value={variable.name}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                  placeholder="variable_name"
                  invalid={nameError !== null}
                  aria-label="Variable name"
                  spellCheck={false}
                />
              </InspectorRow>
              <InspectorRow label="Label" stacked error={label.trim() ? undefined : 'A label is required'}>
                <Input
                  size="sm"
                  value={label}
                  onChange={(e) => onUpdate({ label: e.target.value })}
                  placeholder="Display label"
                  invalid={!label.trim()}
                  aria-label="Variable label"
                />
              </InspectorRow>
              <InspectorRow label="Type" stacked>
                <Select
                  size="sm"
                  aria-label={`${label || 'Variable'} type`}
                  value={variable.type}
                  onValueChange={(v) => v && onUpdate(retype(variable, v as VariableType))}
                  items={TYPE_ITEMS}
                />
              </InspectorRow>
              <InspectorRow label="Default" stacked optional>
                <Input
                  size="sm"
                  mono
                  value={defaultText(variable.defaultValue, variable.type)}
                  onChange={(e) => onUpdate({ defaultValue: coerceDefault(e.target.value, variable.type) })}
                  placeholder={variable.type === 'list' ? 'a, b, c' : 'Optional default'}
                  aria-label="Default value"
                />
              </InspectorRow>
            </div>
            {variable.type === 'choice' ? (
              <InspectorRow label="Options" stacked hint="Comma-separated">
                <OptionsInput options={variable.options} onCommit={(options) => onUpdate({ options: options.length > 0 ? options : undefined })} />
              </InspectorRow>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <Checkbox checked={variable.required} onCheckedChange={(v) => onUpdate({ required: v })} label="Required" />
              <Button variant="danger-ghost" size="sm" icon="trash" aria-label={`Delete variable ${variable.name}`} onClick={onRemove}>
                Delete
              </Button>
            </div>
            <FieldIssues issues={rowIssues} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/** "New variable": added only once its name is valid, so a reserved name never reaches the graph. */
function NewVariableForm({
  taken,
  suggestedName,
  onAdd,
  onCancel,
}: {
  taken: readonly string[];
  suggestedName: string;
  onAdd: (variable: VariableDefinition) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(suggestedName);
  const [type, setType] = useState<VariableType>('string');
  const [label, setLabel] = useState('');
  const [defaultRaw, setDefaultRaw] = useState('');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const trimmed = name.trim();
  const nameError = variableNameError(trimmed, taken);

  const submit = () => {
    if (nameError) return;
    const parsedOptions = parseOptions(options);
    const defaultValue = coerceDefault(defaultRaw, type);
    onAdd({
      name: trimmed,
      type,
      label: label.trim() || trimmed,
      required,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(type === 'choice' && parsedOptions.length > 0 ? { options: parsedOptions } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line-soft bg-raised p-3" data-testid="variables-new">
      <div className="flex items-center justify-between">
        <p className="text-ui font-semibold text-fg">New variable</p>
        <IconButton icon="x" size="sm" label="Cancel new variable" onClick={onCancel} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <InspectorRow label="Name" stacked error={nameError ?? undefined}>
          <Input
            size="sm"
            mono
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            invalid={nameError !== null}
            aria-label="New variable name"
            spellCheck={false}
            autoFocus
          />
        </InspectorRow>
        <InspectorRow label="Type" stacked>
          <Select size="sm" aria-label="New variable type" value={type} onValueChange={(v) => v && setType(v as VariableType)} items={TYPE_ITEMS} />
        </InspectorRow>
      </div>
      {isReservedVariableName(trimmed) ? (
        <InspectorNote>
          Also reserved: <span className="font-mono">{RESERVED_VARIABLE_ROOTS.join(', ')}</span> and the{' '}
          <span className="font-mono">__</span>, <span className="font-mono">repo_path_</span>, <span className="font-mono">repo_branch_</span> prefixes.
        </InspectorNote>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        <InspectorRow label="Label" stacked optional>
          <Input size="sm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={trimmed || 'Display label'} aria-label="New variable label" />
        </InspectorRow>
        <InspectorRow label="Default" stacked optional>
          <Input size="sm" mono value={defaultRaw} onChange={(e) => setDefaultRaw(e.target.value)} aria-label="New variable default" />
        </InspectorRow>
      </div>
      {type === 'choice' ? (
        <InspectorRow label="Options" stacked hint="Comma-separated">
          <Input size="sm" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="option1, option2" aria-label="New variable options" />
        </InspectorRow>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <Checkbox checked={required} onCheckedChange={setRequired} label="Required" />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={nameError !== null} onClick={submit}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Choice options edited as the raw text the user types and parsed on blur.
 * Parsing on every keystroke turned "a," back into "a", so the comma
 * vanished and a second option could only be pasted (D-11).
 */
function OptionsInput({ options, onCommit }: { options: string[] | undefined; onCommit: (options: string[]) => void }) {
  const joined = (options ?? []).join(', ');
  const [draft, setDraft] = useState(joined);
  useEffect(() => setDraft(joined), [joined]);
  return (
    <Input
      size="sm"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(parseOptions(draft))}
      placeholder="option1, option2, option3"
      aria-label="Choice options"
    />
  );
}
