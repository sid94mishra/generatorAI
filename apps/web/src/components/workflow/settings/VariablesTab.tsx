// ────────────────────────────────────────────────────────────────
// VariablesTab — Compact variable editor with table-like layout
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Info } from 'lucide-react';
import type { VariableDefinition } from '@generatorai/shared';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Button, Input, Select } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  string: { label: 'String', color: 'bg-info-muted text-info' },
  number: { label: 'Number', color: 'bg-success-muted text-success' },
  boolean: { label: 'Boolean', color: 'bg-done/15 text-done' },
  choice: { label: 'Choice', color: 'bg-warning-muted text-warning' },
  text: { label: 'Text', color: 'bg-info-muted text-info' },
};

/**
 * Coerce a typed default to the type the variable declares.
 *
 * The editor is a single text input for every type, so without this a
 * `number` variable persisted `"4"` and a `boolean` one persisted `"true"`.
 * Downstream consumers (the run dialog, CLI `--var`, the SDK, and
 * `variables.*` in edge-condition expressions) each had to re-guess the type;
 * storing it correctly in the definition is the actual fix. An input the user
 * is still mid-way through typing (`"1e"`, `"ye"`) is kept verbatim rather
 * than mangled — validation happens at run time.
 */
function coerceDefault(raw: string, type: VariableDefinition['type']): unknown {
  if (raw === '') return undefined;
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === 'boolean') {
    const lowered = raw.trim().toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
    return raw;
  }
  return raw;
}

/**
 * True when the label is still the one `addVariable` generated for this name
 * (`variable3` → "Variable 3"), or simply a copy of the name.
 */
export function isAutoLabel(label: string | undefined, name: string): boolean {
  if (!label) return true;
  if (label === name) return true;
  const generated = /^variable(\d+)$/.exec(name);
  return generated !== null && label === `Variable ${generated[1]}`;
}

export function VariablesTab() {
  const variables = useWorkflowBuilderStore((s) => s.variables);
  const setVariables = useWorkflowBuilderStore((s) => s.setVariables);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const addVariable = useCallback(() => {
    const baseName = 'variable';
    let counter = variables.length + 1;
    const existingNames = new Set(variables.map(v => v.name));
    while (existingNames.has(`${baseName}${counter}`)) counter++;
    const newVar: VariableDefinition = {
      name: `${baseName}${counter}`,
      type: 'string',
      label: `Variable ${counter}`,
      required: false,
    };
    setVariables([...variables, newVar]);
    setExpandedIndex(variables.length);
  }, [variables, setVariables]);

  const updateVariable = useCallback(
    (index: number, updates: Partial<VariableDefinition>) => {
      const updated = variables.map((v, i) => {
        if (i !== index) return v;
        const next = { ...v, ...updates };
        // The label is what the run form asks the user for. Renaming
        // `variable1` to `module` while the label still read "Variable 1" left
        // every run prompting for "Variable 1" — a name that means nothing to
        // whoever is starting the run. A label the user has actually written
        // is never touched.
        if (updates.name !== undefined && isAutoLabel(v.label, v.name)) {
          next.label = updates.name;
        }
        return next;
      });
      setVariables(updated);
    },
    [variables, setVariables],
  );

  const removeVariable = useCallback(
    (index: number) => {
      setVariables(variables.filter((_, i) => i !== index));
      if (expandedIndex === index) setExpandedIndex(null);
      else if (expandedIndex !== null && expandedIndex > index) setExpandedIndex(expandedIndex - 1);
    },
    [variables, setVariables, expandedIndex],
  );

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-center gap-1.5 rounded-md bg-info-muted px-3 py-2 text-xs text-info">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span>Variables are requested from users before starting a run. Use {'{{name}}'} in prompts to interpolate.</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">
          Variables ({variables.length})
        </label>
        <Button
          onClick={addVariable}
          variant="ghost"
          size="sm"
          className="h-auto flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-subtle"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Variable
        </Button>
      </div>

      {/* Variable list */}
      {variables.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No variables defined. Runs will start without asking for input.
          </p>
          <Button
            onClick={addVariable}
            variant="ghost"
            size="sm"
            className="h-auto mt-2 bg-transparent p-0 text-xs font-medium text-primary hover:bg-transparent hover:underline"
          >
            + Add your first variable
          </Button>
        </div>
      ) : (
        <div className="space-y-1">
          {variables.map((variable, index) => {
            const isExpanded = expandedIndex === index;
            const typeInfo = TYPE_LABELS[variable.type] ?? TYPE_LABELS['string']!;
            return (
              <div
                key={variable.name}
                className={cn(
                  'group rounded-lg border transition-all',
                  isExpanded
                    ? 'border-primary/30 bg-primary/[0.02]'
                    : 'border-border hover:border-emphasis',
                )}
              >
                {/* Compact row */}
                <div
                  className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                  onClick={() => setExpandedIndex(isExpanded ? null : index)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <code className="text-xs font-mono text-foreground min-w-[80px]">
                    {variable.name}
                  </code>
                  <span className="text-xs text-muted-foreground flex-1 truncate">
                    {variable.label}
                  </span>
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', typeInfo.color)}>
                    {typeInfo.label}
                  </span>
                  {variable.required && (
                    <span className="rounded-full bg-danger-muted px-1.5 py-0.5 text-[10px] font-medium text-danger">
                      Required
                    </span>
                  )}
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeVariable(index);
                    }}
                    aria-label={`Delete variable ${variable.name}`}
                    variant="ghost"
                    size="icon-sm"
                    className="h-auto w-auto rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-danger-muted hover:text-danger transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Expanded edit form */}
                {isExpanded && (
                  <div className="border-t border-border px-3 py-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name</label>
                        <Input
                          type="text"
                          value={variable.name}
                          onChange={(e) => updateVariable(index, { name: e.target.value })}
                          className="h-auto px-2.5 py-1.5 text-xs font-mono"
                          placeholder="variableName"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Label</label>
                        <Input
                          type="text"
                          value={variable.label}
                          onChange={(e) => updateVariable(index, { label: e.target.value })}
                          className="h-auto px-2.5 py-1.5 text-xs"
                          placeholder="Display label"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Type</label>
                        <Select
                          value={variable.type}
                          aria-label={`${variable.label || 'Variable'} type`}
                          onChange={(v) => {
                            const type = v as VariableDefinition['type'];
                            updateVariable(index, {
                              type,
                              // Re-read the existing default under the new type
                              // so switching String → Number turns "4" into 4.
                              defaultValue: coerceDefault(
                                variable.defaultValue === undefined || variable.defaultValue === null
                                  ? ''
                                  : String(variable.defaultValue),
                                type,
                              ),
                            });
                          }}
                          options={[
                            { value: 'string', label: 'String' },
                            { value: 'number', label: 'Number' },
                            { value: 'boolean', label: 'Boolean' },
                            { value: 'choice', label: 'Choice' },
                            { value: 'text', label: 'Text (multiline)' },
                          ]}
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex items-center gap-1.5 text-xs text-foreground">
                          <Checkbox
                            checked={variable.required}
                            onCheckedChange={(v) => updateVariable(index, { required: v === true })}
                            className="h-3.5 w-3.5"
                          />
                          Required
                        </label>
                      </div>
                    </div>
                    {variable.type === 'choice' && (
                      <div>
                        <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                          Options (comma-separated)
                        </label>
                        <Input
                          type="text"
                          value={variable.options?.join(', ') ?? ''}
                          onChange={(e) =>
                            updateVariable(index, {
                              options: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          className="h-auto px-2.5 py-1.5 text-xs"
                          placeholder="option1, option2, option3"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">Default Value</label>
                      <Input
                        type="text"
                        value={String(variable.defaultValue ?? '')}
                        onChange={(e) =>
                          updateVariable(index, {
                            defaultValue: coerceDefault(e.target.value, variable.type),
                          })
                        }
                        className="h-auto px-2.5 py-1.5 text-xs"
                        placeholder="Optional default"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        onClick={() => removeVariable(index)}
                        variant="ghost"
                        size="sm"
                        className="h-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-danger hover:bg-danger-muted transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
