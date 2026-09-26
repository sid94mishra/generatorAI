// ────────────────────────────────────────────────────────────────
// Output tab (WorkflowStageHooks board, right): the output contract —
// format, JSON Schema (its fields as chips), extraction, summary,
// instructions — the validation rules checked before the stage completes
// (contains, not contains, min/max length, regex, JSON Schema, custom
// script, judge) and repair turns.
// ────────────────────────────────────────────────────────────────

import { RepairPolicySchema, type ResultValidationRule } from '@generatorai/workflow-spec';
import type { BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Chip, ChipList } from '@/ui/primitives/Chip/Chip.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { ExpressionField } from '../../../fields/ExpressionField.js';
import { FieldIssues, issuesAt } from '../../../fields/FieldIssues.js';
import { InspectorNote, InspectorSection } from '../../../fields/InspectorLayout.js';
import { ArgsEditor, JsonObjectEditor, num } from '../../../fields/stageFields.js';
import type { AgentStageSpec } from '../../types.js';
import { Row } from '../Row.js';
import type { AgentTabProps } from './tabProps.js';

type Output = AgentStageSpec['output'];
type RuleType = ResultValidationRule['type'];

const RULE_TYPES: { value: RuleType; label: string; meta: string }[] = [
  { value: 'contains', label: 'Contains', meta: 'text' },
  { value: 'not_contains', label: 'Not contains', meta: 'text' },
  { value: 'min_length', label: 'Min length', meta: 'chars' },
  { value: 'max_length', label: 'Max length', meta: 'chars' },
  { value: 'regex', label: 'Regex', meta: 'pattern' },
  { value: 'json_schema', label: 'JSON Schema', meta: 'schema' },
  { value: 'custom_script', label: 'Custom script', meta: 'admin' },
  { value: 'judge', label: 'Judge', meta: 'model' },
];

const RULE_HINTS: Record<RuleType, string> = {
  contains: 'Output must contain this text.',
  not_contains: 'Output must not contain this text.',
  min_length: 'Output must be at least N characters.',
  max_length: 'Output must be at most N characters.',
  regex: 'Output must match this pattern.',
  json_schema: 'Output must be JSON matching this schema.',
  custom_script: 'A command validates the output (exit 0 passes).',
  judge: 'A model scores the output 0-10 against a rubric; below the threshold the stage repairs.',
};

/** A fresh rule of `type`, keeping the failure message. */
function blankRule(type: RuleType, message?: string): ResultValidationRule {
  const m = message ? { message } : {};
  switch (type) {
    case 'contains':
    case 'not_contains':
      return { type, value: '', ...m };
    case 'min_length':
    case 'max_length':
      return { type, value: 100, ...m };
    case 'regex':
      return { type, pattern: '', ...m };
    case 'json_schema':
      return { type, schema: { type: 'object' }, ...m };
    case 'custom_script':
      return { type, command: '', args: [], timeoutMs: 60_000, ...m };
    case 'judge':
      return { type, rubric: '', threshold: 7, ...m };
  }
}

/** The fields of one rule type. */
function RuleFields({ rule, n, onChange }: { rule: ResultValidationRule; n: number; onChange: (rule: ResultValidationRule) => void }) {
  switch (rule.type) {
    case 'contains':
    case 'not_contains':
      return (
        <Input
          mono
          size="sm"
          value={rule.value}
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
          placeholder="Text to check for…"
          aria-label={`Rule ${n} text`}
        />
      );
    case 'regex':
      return (
        <div className="flex items-center gap-1.5">
          <Input
            mono
            size="sm"
            className="min-w-0 flex-1"
            value={rule.pattern}
            onChange={(e) => onChange({ ...rule, pattern: e.target.value })}
            // No slashes: the pattern is the regex body (D-26).
            placeholder="e.g. export\s+default"
            aria-label={`Rule ${n} pattern`}
            spellCheck={false}
          />
          <Input
            mono
            size="sm"
            className="w-16"
            value={rule.flags ?? ''}
            onChange={(e) => onChange({ ...rule, flags: e.target.value || undefined })}
            placeholder="flags"
            aria-label={`Rule ${n} flags (i, m, s)`}
            spellCheck={false}
          />
        </div>
      );
    case 'min_length':
    case 'max_length':
      return (
        <NumberField
          size="sm"
          className="w-40"
          aria-label={`Rule ${n} length`}
          unit="chars"
          value={rule.value}
          onValueChange={(v) => onChange({ ...rule, value: Math.max(0, Math.round(num(v))) })}
          min={0}
        />
      );
    case 'json_schema':
      return <JsonObjectEditor value={rule.schema} onChange={(schema) => onChange({ ...rule, schema: schema ?? {} })} ariaLabel={`Rule ${n} JSON Schema`} />;
    case 'custom_script':
      return (
        <div className="flex flex-col gap-1.5">
          <Input
            mono
            size="sm"
            value={rule.command}
            onChange={(e) => onChange({ ...rule, command: e.target.value })}
            placeholder="Executable (e.g. node)"
            aria-label={`Rule ${n} command`}
            spellCheck={false}
          />
          <ArgsEditor args={rule.args} onChange={(args) => onChange({ ...rule, args })} ariaLabel={`Rule ${n} arguments`} />
          <InspectorNote>The output arrives in the STAGE_OUTPUT environment variable. Saving it needs the admin:settings scope.</InspectorNote>
        </div>
      );
    case 'judge':
      return (
        <div className="flex flex-col gap-2">
          <Row label="Rubric" stacked>
            <Textarea
              value={rule.rubric}
              onChange={(e) => onChange({ ...rule, rubric: e.target.value })}
              rows={3}
              placeholder="What a good output is (the judge scores 0-10 against it)"
              aria-label={`Rule ${n} rubric`}
            />
          </Row>
          <div className="grid grid-cols-2 gap-2">
            <Row label="Pass at" stacked>
              <NumberField
                size="sm"
                aria-label={`Rule ${n} threshold`}
                unit="of 10"
                value={rule.threshold}
                onValueChange={(v) => onChange({ ...rule, threshold: Math.max(0, Math.min(10, num(v))) })}
                min={0}
                max={10}
                step={0.5}
              />
            </Row>
            <Row label="Model" stacked optional>
              <Input
                mono
                size="sm"
                value={rule.model ?? ''}
                onChange={(e) => onChange({ ...rule, model: e.target.value || undefined })}
                placeholder="the stage’s model"
                aria-label={`Rule ${n} judge model`}
                spellCheck={false}
              />
            </Row>
          </div>
          <Checkbox
            size="sm"
            label="Show the judge the working-tree diff"
            checked={rule.include?.includes('diff') ?? false}
            onCheckedChange={(next) => onChange({ ...rule, include: next ? ['diff'] : undefined })}
          />
          <InspectorNote>Runs in a fresh tool-less session.</InspectorNote>
        </div>
      );
  }
}

function RulesEditor({ rules, onChange, issues }: { rules: ResultValidationRule[]; onChange: (rules: ResultValidationRule[]) => void; issues: readonly BuilderIssue[] }) {
  const replace = (idx: number, rule: ResultValidationRule) => onChange(rules.map((r, i) => (i === idx ? rule : r)));
  return (
    <InspectorSection
      title="Rules"
      count={rules.length || undefined}
      action={
        <Button variant="ghost" size="sm" icon="plus" onClick={() => onChange([...rules, blankRule('contains', `Validation rule ${rules.length + 1}`)])}>
          Add rule
        </Button>
      }
      data-testid="output-rules"
    >
      {rules.length === 0 ? <InspectorNote>No validation rules. Add rules to verify the stage output.</InspectorNote> : null}
      {rules.map((rule, idx) => {
        const n = idx + 1;
        return (
          <div key={idx} className="flex flex-col gap-2 rounded-card border border-line-soft p-2.5">
            <div className="flex items-center gap-1.5">
              <Select
                size="sm"
                className="min-w-0 flex-1"
                aria-label={`Rule ${n} type`}
                value={rule.type}
                onValueChange={(v) => v && replace(idx, blankRule(v as RuleType, rule.message))}
                items={RULE_TYPES}
              />
              <IconButton icon="trash" size="sm" label={`Remove rule ${n}`} onClick={() => onChange(rules.filter((_, i) => i !== idx))} />
            </div>
            <InspectorNote>{RULE_HINTS[rule.type]}</InspectorNote>
            <RuleFields rule={rule} n={n} onChange={(next) => replace(idx, next)} />
            <Input
              size="sm"
              value={rule.message ?? ''}
              onChange={(e) => replace(idx, { ...rule, message: e.target.value || undefined })}
              placeholder="Failure message shown on validation failure"
              aria-label={`Rule ${n} failure message`}
            />
            <FieldIssues issues={issuesAt(issues, `/output/rules/${idx}`)} />
          </div>
        );
      })}
      {rules.length > 0 ? (
        <InspectorNote>Rules are evaluated after the stage completes. A failed rule sends the reasons back to the agent (repair) before retrying.</InspectorNote>
      ) : null}
      <FieldIssues issues={issues.filter((i) => i.field === '/output/rules')} />
    </InspectorSection>
  );
}

/** The top-level property names of a JSON Schema (the board's field chips); null when it has none. */
function schemaFields(schema: Record<string, unknown> | undefined): string[] | null {
  const props = schema?.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null;
  const names = Object.keys(props);
  return names.length > 0 ? names : null;
}

/** Output issues shown next to a control; the rest are listed at the end of the tab. */
const SHOWN_OUTPUT = /^\/output\/(schema|format|instructions|rules)(\/|$)/;

export function OutputTab({ stage, onUpdate, issues }: AgentTabProps) {
  const output = stage.output;
  const setOutput = (updates: Partial<Output>) => {
    const next: Record<string, unknown> = { ...output, ...updates };
    for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
    onUpdate({ output: next as Output });
  };
  const fields = schemaFields(output.schema);
  const otherOutputIssues = issuesAt(issues, '/output').filter((i) => !SHOWN_OUTPUT.test(i.field ?? ''));

  return (
    <>
      <InspectorSection title="Output contract" data-testid="output-contract">
        <Row label="Format" hint={output.format === 'json' ? 'A JSON value, validated against the schema.' : 'Free text.'}>
          <SegmentedControl
            label="Output format"
            value={output.format}
            onValueChange={(format) => setOutput({ format })}
            items={[
              { value: 'text', label: 'Text' },
              { value: 'json', label: 'JSON' },
            ]}
          />
        </Row>
        <Row label="JSON Schema" stacked hint={fields ? `${fields.length} ${fields.length === 1 ? 'field' : 'fields'}` : 'Expressions are typed from it.'}>
          {fields ? (
            <ChipList max={8} size="sm">
              {fields.map((f) => (
                <Chip key={f} mono size="sm">
                  {f}
                </Chip>
              ))}
            </ChipList>
          ) : null}
          <JsonObjectEditor
            value={output.schema}
            onChange={(schema) => setOutput({ schema })}
            placeholder={'{\n  "type": "object",\n  "properties": { "verdict": { "type": "string" } }\n}'}
            ariaLabel="Output JSON Schema"
          />
          <FieldIssues issues={issuesAt(issues, '/output/schema', '/output/format')} />
        </Row>
        <Row label="Extraction" hint="Auto picks native, then the submit_output tool, then the final JSON block.">
          <SegmentedControl
            label="Output extraction"
            value={output.extraction}
            onValueChange={(extraction) => setOutput({ extraction })}
            items={[
              { value: 'auto', label: 'Auto' },
              { value: 'native', label: 'Native' },
              { value: 'tool', label: 'Tool' },
              { value: 'final_json_block', label: 'Final JSON block' },
            ]}
          />
        </Row>
        <Row label="Summary" hint="What successors read in Summary context.">
          <SegmentedControl
            label="Output summary"
            value={output.summary}
            onValueChange={(summary) => setOutput({ summary })}
            items={[
              { value: 'auto', label: 'Auto' },
              { value: 'llm', label: 'LLM' },
              { value: 'none', label: 'None' },
            ]}
          />
        </Row>
        <Row label="Instructions" stacked>
          <ExpressionField
            mode="template"
            value={output.instructions ?? ''}
            onChange={(instructions) => setOutput({ instructions: instructions || undefined })}
            rows={2}
            ariaLabel="Output instructions"
            placeholder="Describe the expected output; appended to the final prompt"
            issues={issuesAt(issues, '/output/instructions')}
          />
        </Row>
      </InspectorSection>
      <RulesEditor rules={output.rules} onChange={(rules) => setOutput({ rules })} issues={issues} />
      <InspectorSection
        title="Repair"
        action={
          <Switch
            aria-label="Repair turns"
            checked={!!stage.repair}
            onCheckedChange={(checked) => onUpdate({ repair: checked ? RepairPolicySchema.parse({}) : undefined })}
          />
        }
      >
        <InspectorNote>Ask the agent to fix output that fails its contract before retrying.</InspectorNote>
        <FieldIssues issues={issuesAt(issues, '/repair')} />
      </InspectorSection>
      <FieldIssues issues={otherOutputIssues} />
    </>
  );
}
