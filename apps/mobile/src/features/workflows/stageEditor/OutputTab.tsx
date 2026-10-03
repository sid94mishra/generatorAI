// Output tab (MStageOutput): Format (Text / JSON); the JSON Schema as a summary row (its editor is desktop, MD-04);
// Extraction and Summary; the rules — contains / not contains / min / max length / regex are edited here, a JSON
// Schema rule is added from the stage's schema, custom scripts (admin) and judges are desktop editors; Max repairs.
import React from 'react';
import { View } from 'react-native';
import type { OutputContract, ResultValidationRule } from '@generatorai/workflow-spec';

import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { Chip } from '../../../ui/primitives/Chip';
import { Field } from '../../../ui/primitives/Field';
import { IconButton } from '../../../ui/primitives/IconButton';
import { Input } from '../../../ui/primitives/Input';
import { Text } from '../../../ui/primitives/Text';
import { DesktopOnlyRow, type TabProps } from './fields';
import { RULE_LABEL, SIMPLE_RULES, newRule, regexProblem, ruleDetail, schemaFieldCount } from './stageEditorModel';

function RuleEditor({ rule, onChange, onRemove, index }: { rule: ResultValidationRule; onChange: (r: ResultValidationRule) => void; onRemove: () => void; index: number }): React.ReactElement {
  let body: React.ReactNode;
  if (rule.type === 'contains' || rule.type === 'not_contains') {
    body = <Input label="Text" value={rule.value} onChangeText={(value) => onChange({ ...rule, value })} presentation="standalone" testID={`stage-rule-${index}-value`} />;
  } else if (rule.type === 'min_length' || rule.type === 'max_length') {
    body = <Input label="Characters" value={String(rule.value)} onChangeText={(t) => onChange({ ...rule, value: Math.max(0, Math.floor(Number(t) || 0)) })} kind="number" presentation="standalone" />;
  } else if (rule.type === 'regex') {
    const problem = regexProblem(rule.pattern);
    body = (
      <Field {...(problem ? { error: problem } : {})}>
        <Input label="Pattern" value={rule.pattern} onChangeText={(pattern) => onChange({ ...rule, pattern })} kind="mono" presentation="standalone" {...(problem ? { error: problem } : {})} testID={`stage-rule-${index}-pattern`} />
      </Field>
    );
  } else {
    body = (
      <Text role="footnote" tone="fg-3" numberOfLines={2}>
        {`${ruleDetail(rule)} · Edit on desktop`}
      </Text>
    );
  }
  return (
    <View className="gap-2 px-4 py-3" testID={`stage-rule-${index}`}>
      <View className="flex-row items-center">
        <Text role="body" weight={600} className="flex-1">
          {RULE_LABEL[rule.type]}
        </Text>
        <IconButton icon="x" label={`Remove ${RULE_LABEL[rule.type]} rule`} size="sm" onPress={onRemove} />
      </View>
      {body}
    </View>
  );
}

export function OutputTab({ stage, set }: TabProps): React.ReactElement {
  const out = stage.output;
  const setOut = (patch: Partial<OutputContract>): void => set({ ...stage, output: { ...out, ...patch } });
  const rules = out.rules;
  const fields = schemaFieldCount(out.schema);
  const maxRepairs = stage.repair?.maxRepairs ?? 2;
  return (
    <View className="gap-6">
      <ListSection>
        <ListRow kind="segmented" title="Format" segmented={{ value: out.format, onValueChange: (f) => setOut({ format: f as 'text' | 'json' }), segments: [{ value: 'text', label: 'Text' }, { value: 'json', label: 'JSON' }], testID: 'stage-output-format' }} />
        {out.format === 'json' ? <DesktopOnlyRow title="JSON Schema" subtitle={out.schema ? `${fields} fields` : 'No schema'} /> : null}
        {out.format === 'json' ? (
          <ListRow kind="segmented" title="Extraction" segmented={{ value: out.extraction, onValueChange: (e) => setOut({ extraction: e as OutputContract['extraction'] }), segments: [{ value: 'auto', label: 'Auto' }, { value: 'native', label: 'Native' }, { value: 'tool', label: 'Tool' }, { value: 'final_json_block', label: 'Final block' }] }} />
        ) : null}
        <ListRow kind="segmented" title="Summary" segmented={{ value: out.summary, onValueChange: (v) => setOut({ summary: v as OutputContract['summary'] }), segments: [{ value: 'auto', label: 'Auto' }, { value: 'llm', label: 'LLM' }, { value: 'none', label: 'None' }] }} />
      </ListSection>

      <ListSection title="Rules" count={rules.length} footer="Custom scripts (admin) and Judge rules are edited on desktop.">
        {rules.map((r, i) => (
          <RuleEditor key={i} index={i} rule={r} onChange={(next) => setOut({ rules: rules.map((x, j) => (j === i ? next : x)) })} onRemove={() => setOut({ rules: rules.filter((_, j) => j !== i) })} />
        ))}
        <View className="flex-row flex-wrap gap-2 px-4 py-3">
          {SIMPLE_RULES.map((t) => (
            <Chip key={t} variant="add" label={RULE_LABEL[t]} icon="plus" onPress={() => setOut({ rules: [...rules, newRule(t)] })} disabled={rules.length >= 20} testID={`stage-add-rule-${t}`} />
          ))}
          {out.schema ? <Chip variant="add" label="JSON Schema" icon="plus" onPress={() => setOut({ rules: [...rules, { type: 'json_schema', schema: out.schema! }] })} disabled={rules.length >= 20} /> : null}
        </View>
      </ListSection>

      <ListSection footer="A failed rule sends the reasons back to the agent before retrying.">
        <ListRow kind="stepper" title="Max repairs" stepper={{ value: maxRepairs, onValueChange: (n) => set({ ...stage, repair: { maxRepairs: n, restartOnExhausted: stage.repair?.restartOnExhausted ?? true } }), min: 0, max: 5, testID: 'stage-max-repairs' }} />
      </ListSection>
    </View>
  );
}
