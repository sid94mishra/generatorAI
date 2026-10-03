// MB-36 VariableForm (03 MB-36; MWorkflowLaunch, MScriptRun): one control per declared input — string → Input,
// text → Textarea, number → numeric Input, boolean → Switch row, choice → Select row, list → Textarea (one item per
// line), json → mono Textarea with its parse status. Each shows the mono name and "Type · Required / default /
// optional"; the per-field error (from the model's `buildVariables`) replaces the help line once the form was
// submitted. Reserved names never reach it (the model drops `__*`).
import React from 'react';
import { View } from 'react-native';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Field } from '../../ui/primitives/Field';
import { Input } from '../../ui/primitives/Input';
import { Textarea } from '../../ui/primitives/Textarea';
import { variableDetail, type Draft, type DraftValue, type VariableDefinition } from './model/variableFormModel';

export interface VariableFormProps {
  variables: ReadonlyArray<VariableDefinition>;
  draft: Draft;
  onChange: (name: string, value: DraftValue) => void;
  /** Field name → message (shown as given; pass {} until the form was submitted). */
  errors?: Readonly<Record<string, string>>;
  title?: string;
  /** Section footer ("5 · typed"). */
  footer?: string;
  /** testIDs `<prefix>-<name>`. Default 'variable'. */
  testIDPrefix?: string;
}

function jsonStatus(text: string): string | undefined {
  if (!text.trim()) return undefined;
  try {
    JSON.parse(text);
    return 'Valid JSON';
  } catch {
    return undefined;
  }
}

export function VariableForm({ variables, draft, onChange, errors = {}, title = 'Variables', footer, testIDPrefix = 'variable' }: VariableFormProps): React.ReactElement | null {
  if (variables.length === 0) return null;
  return (
    <ListSection title={title} count={variables.length} {...(footer ? { footer } : {})}>
      {variables.map((def) => {
        const value = draft[def.name];
        const text = typeof value === 'string' ? value : '';
        const error = errors[def.name];
        const help = [variableDetail(def), def.description].filter(Boolean).join(' — ');
        const testID = `${testIDPrefix}-${def.name}`;
        switch (def.type) {
          case 'boolean':
            return <ListRow key={def.name} kind="toggle" title={def.name} subtitle={help} switchValue={value === true} onValueChange={(v) => onChange(def.name, v)} testID={testID} />;
          case 'choice':
            return (
              <ListRow
                key={def.name}
                kind="picker"
                title={def.name}
                subtitle={error ?? help}
                picker={{ value: text || null, placeholder: 'Choose', options: (def.options ?? []).map((o) => ({ value: o, label: o })), onValueChange: (v) => onChange(def.name, v), testID }}
              />
            );
          case 'text':
          case 'list':
          case 'json':
            return (
              <View key={def.name}>
                <Field help={def.type === 'list' ? `${help} — one item per line` : def.type === 'json' ? [help, jsonStatus(text)].filter(Boolean).join(' · ') : help} {...(error ? { error } : {})} required={Boolean(def.required)}>
                  <Textarea label={def.name} value={text} onChangeText={(v) => onChange(def.name, v)} placeholder={def.label} mono={def.type !== 'text'} presentation="row" minRows={def.type === 'json' ? 4 : 2} testID={testID} />
                </Field>
              </View>
            );
          default:
            return (
              <View key={def.name}>
                <Field help={help} {...(error ? { error } : {})} required={Boolean(def.required)}>
                  <Input label={def.name} value={text} onChangeText={(v) => onChange(def.name, v)} placeholder={def.label} kind={def.type === 'number' ? 'number' : 'mono'} presentation="row" testID={testID} />
                </Field>
              </View>
            );
        }
      })}
    </ListSection>
  );
}
