// Prompt tab (MStagePrompt): name, key (from the name while the stage is new — a saved stage's key is referenced by
// expressions, so it changes on desktop), description; context from (chips, + adds an earlier stage; none set =
// the direct predecessors) and Mode (Summary / Full / Structured / None); the prompts, each a label and a mono
// template with "Insert variable" (variables · earlier stages · run), its reference count, and a strip naming the
// variables it reads that the workflow does not declare, with "Declare" (adds a string variable to the draft).
import React from 'react';
import { View } from 'react-native';
import type { AgentStage, ContextSpec, StageSpec } from '@generatorai/workflow-spec';

import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { Menu } from '../../../ui/native/Menu';
import type { MenuEntry } from '../../../ui/native/Menu/Menu.types';
import { Button } from '../../../ui/primitives/Button';
import { Callout } from '../../../ui/primitives/Callout';
import { Chip } from '../../../ui/primitives/Chip';
import { IconButton } from '../../../ui/primitives/IconButton';
import { Input } from '../../../ui/primitives/Input';
import { Text } from '../../../ui/primitives/Text';
import { Textarea } from '../../../ui/primitives/Textarea';
import { toast } from '../../../ui/primitives/Toast';
import { stageKeyFor, topLevelOrder } from '../model/builderModel';
import { useBuilderStore } from '../builder/builderStore';
import type { GeneralProps, TabProps } from './fields';
import { insertRef, insertableRefs, refCount, undeclaredVariables } from './stageEditorModel';

const MODES: { value: ContextSpec['mode']; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'output', label: 'Full' },
  { value: 'structured', label: 'Structured' },
  { value: 'none', label: 'None' },
];

/** Name, key, description: every stage kind has them. `keyLocked`: the stage is saved (its key is referenced). */
export function GeneralFields({ stage, set, keyLocked, taken }: GeneralProps & { keyLocked: boolean; taken: ReadonlySet<string> }): React.ReactElement {
  const setName = (name: string): void => {
    const derived = !keyLocked && stage.key === stageKeyFor(stage.name, taken) ? stageKeyFor(name || 'stage', taken) : stage.key;
    set({ ...stage, name, key: derived } as StageSpec);
  };
  return (
    <ListSection footer={keyLocked ? 'A saved stage’s key is used by expressions; rename it on desktop.' : undefined}>
      <Input label="Name" value={stage.name} onChangeText={setName} maxLength={200} testID="stage-name" />
      <Input label={keyLocked ? 'Key' : 'Key · from name'} value={stage.key} onChangeText={(key) => set({ ...stage, key: key.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 48) } as StageSpec)} kind="mono" readOnly={keyLocked} testID="stage-key" />
      <Input label="Description (optional)" value={stage.description ?? ''} onChangeText={(d) => set({ ...stage, description: d || undefined } as StageSpec)} maxLength={2000} />
    </ListSection>
  );
}

export function PromptTab({ workflowId, stage, set, graph, keyLocked }: TabProps & { keyLocked: boolean }): React.ReactElement {
  const order = topLevelOrder(graph).map((s) => s.key);
  const others = graph.stages.filter((s) => s.key !== stage.key);
  const taken = new Set(others.map((s) => s.key));
  const from = stage.context.from;
  const refs = insertableRefs(graph, stage.key, order);
  const declared = graph.workflow.variables.map((v) => v.name);
  const setContext = (patch: Partial<ContextSpec>): void => set({ ...stage, context: { ...stage.context, ...patch } });
  const setPrompt = (i: number, patch: Partial<AgentStage['prompts'][number]>): void => set({ ...stage, prompts: stage.prompts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const declare = (name: string): void => {
    useBuilderStore.getState().edit(workflowId, (g) => ({ ...g, workflow: { ...g.workflow, variables: [...g.workflow.variables, { name, type: 'string', label: name, required: false }] } }));
    toast({ kind: 'background', message: `Declared ${name} (string) — set its label and default in Workflow settings.` });
  };
  const insertMenu: MenuEntry[] = (['Variables', 'Earlier stages', 'Run'] as const).flatMap((group) => {
    const items = refs.filter((r) => r.group === group);
    return items.length ? [{ id: `g-${group}`, label: group, children: items.map((r) => ({ id: r.ref, label: r.ref, subtitle: r.type })) }] : [];
  });
  const addable = others.filter((s) => !s.parentKey && !(from ?? []).includes(s.key));

  return (
    <View className="gap-6">
      <GeneralFields stage={stage} set={(s) => set(s as AgentStage)} keyLocked={keyLocked} taken={taken} />
      <ListSection>
        <View className="flex-row flex-wrap items-center gap-2 px-4 py-3">
          <Text role="body" className="flex-1">
            Context from
          </Text>
          {from === undefined ? (
            <Text role="footnote" tone="fg-3">
              Direct predecessors
            </Text>
          ) : (
            from.map((k) => <Chip key={k} variant="input" label={k} onRemove={() => setContext({ from: from.filter((x) => x !== k) })} />)
          )}
          {addable.length ? (
            <Menu
              title="Add context from"
              items={addable.map((s) => ({ id: s.key, label: s.name, subtitle: s.key }))}
              onSelect={(k) => setContext({ from: [...(from ?? []), k] })}
              trigger={<IconButton icon="plus" label="Add context source" size="sm" onPress={() => undefined} />}
            />
          ) : null}
        </View>
        <ListRow kind="segmented" title="Mode" segmented={{ value: stage.context.mode, onValueChange: (mode) => setContext({ mode: mode as ContextSpec['mode'] }), segments: MODES, testID: 'stage-context-mode' }} />
      </ListSection>

      <ListSection title="Prompts" count={stage.prompts.length} action={stage.prompts.length < 50 ? { label: 'Add prompt', onPress: () => set({ ...stage, prompts: [...stage.prompts, { label: `Prompt ${stage.prompts.length + 1}`, text: '' }] }) } : undefined}>
        {stage.prompts.length === 0 ? <ListRow kind="info" title="No prompts" subtitle="Add the turn the agent is sent." /> : null}
        {stage.prompts.map((p, i) => {
          const missing = undeclaredVariables([p.text], declared);
          return (
            <View key={i} className="gap-2 px-4 py-3" testID={`stage-prompt-${i}`}>
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Input label="Label" value={p.label} onChangeText={(label) => setPrompt(i, { label })} presentation="standalone" maxLength={200} />
                </View>
                <IconButton icon="trash" label={`Remove ${p.label}`} size="sm" onPress={() => set({ ...stage, prompts: stage.prompts.filter((_, j) => j !== i) })} />
              </View>
              <Textarea label={`${p.label} text`} value={p.text} onChangeText={(text) => setPrompt(i, { text })} mono minRows={5} maxRows={14} testID={`stage-prompt-${i}-text`} />
              {missing.map((name) => (
                <Callout key={name} tone="err" form="banner" title={`${name} isn't declared.`} action={{ label: 'Declare', onPress: () => declare(name) }} />
              ))}
              <View className="flex-row items-center gap-2">
                <Menu title="Insert variable" items={insertMenu} onSelect={(ref) => setPrompt(i, { text: insertRef(p.text, ref) })} trigger={<Button label="Insert variable" icon="variable" size="sm" onPress={() => undefined} />} testID={`stage-prompt-${i}-insert`} />
                <View className="flex-1" />
                <Text role="monoSm" tone="fg-3">{`${refCount(p.text)} refs`}</Text>
              </View>
            </View>
          );
        })}
      </ListSection>
    </View>
  );
}
