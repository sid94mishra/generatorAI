// Hooks tab (MStageHooks): each stage hook with its switch, name, phase and type; a script hook expands into its
// simple fields — phase, command and args (command-bearing: admin only, W-34), timeout, if it fails; HTTP and
// function hooks and compensation are desktop editors (MD-04). Add hook adds a script hook (admin). The workflow's
// own hooks are listed at the end.
import React, { useState } from 'react';
import { View } from 'react-native';
import { HOOK_PHASE_INFO, STAGE_HOOK_PHASES, type HookDefinition, type StageHookPhase } from '@generatorai/workflow-spec';

import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { Switch } from '../../../ui/native/Switch';
import { Badge } from '../../../ui/primitives/Badge';
import { Collapsible } from '../../../ui/primitives/Collapsible';
import { IconButton } from '../../../ui/primitives/IconButton';
import { Input } from '../../../ui/primitives/Input';
import { Text } from '../../../ui/primitives/Text';
import { DesktopOnlyRow, DurationInput, type TabProps } from './fields';

export const phaseLabel = (p: string): string => p.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const FAILURE: Record<HookDefinition['failurePolicy'], string> = { abort: 'Fail the stage', skip: 'Skip hook', continue: 'Log and continue' };

function HookRow({ hook, index, isAdmin, onChange, onRemove }: { hook: HookDefinition; index: number; isAdmin: boolean; onChange: (h: HookDefinition) => void; onRemove: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const script = hook.config.type === 'script' ? hook.config : null;
  const header = (
    <View className="flex-row items-center gap-3 py-2">
      <Switch value={hook.enabled} onValueChange={(enabled) => onChange({ ...hook, enabled })} label={`${hook.name} enabled`} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Text role="body" weight={600} numberOfLines={1} className="shrink">
            {hook.name}
          </Text>
          <Badge label={phaseLabel(hook.phase)} size="sm" />
          <Badge label={phaseLabel(hook.type)} size="sm" tone="outline" />
          {script && !isAdmin ? <Badge label="Admin only" icon="lock" size="sm" tone="outline" /> : null}
        </View>
        {script ? (
          <Text role="monoSm" tone="fg-3" numberOfLines={1}>
            {[script.command, ...(script.args ?? [])].join(' ')}
          </Text>
        ) : null}
      </View>
    </View>
  );
  return (
    <View className="px-4" testID={`stage-hook-${index}`}>
      <Collapsible expanded={open} onExpandedChange={setOpen} header={header} accessibilityLabel={hook.name}>
        {script ? (
          <View className="gap-2 pb-3">
            <ListRow kind="picker" title="Phase" picker={{ value: hook.phase, options: STAGE_HOOK_PHASES.map((p) => ({ value: p, label: phaseLabel(p), description: HOOK_PHASE_INFO[p].description })), onValueChange: (phase) => onChange({ ...hook, phase: phase as StageHookPhase }) }} />
            <Input label="Name" value={hook.name} onChangeText={(name) => onChange({ ...hook, name })} presentation="standalone" />
            <View className="flex-row gap-2">
              <View className="w-32">
                <Input label="Command" value={script.command} onChangeText={(command) => onChange({ ...hook, config: { ...script, command } })} kind="mono" presentation="standalone" readOnly={!isAdmin} />
              </View>
              <View className="flex-1">
                <Input label="Args" value={(script.args ?? []).join(' ')} onChangeText={(t) => onChange({ ...hook, config: { ...script, args: t.split(/\s+/).filter(Boolean) } })} kind="mono" presentation="standalone" readOnly={!isAdmin} />
              </View>
            </View>
            <Text role="footnote" tone="fg-3">
              Command and args are literals; templated values go in the environment (desktop).
            </Text>
            <View className="flex-row items-end gap-2">
              <View className="flex-1">
                <DurationInput label="Timeout" value={hook.timeoutMs} onChange={(ms) => onChange({ ...hook, timeoutMs: Math.max(100, ms ?? 30_000) })} />
              </View>
              <View className="flex-1">
                <ListRow kind="picker" title="If it fails" picker={{ value: hook.failurePolicy, options: (Object.keys(FAILURE) as HookDefinition['failurePolicy'][]).map((f) => ({ value: f, label: FAILURE[f] })), onValueChange: (f) => onChange({ ...hook, failurePolicy: f as HookDefinition['failurePolicy'] }) }} />
              </View>
            </View>
            {isAdmin ? (
              <View className="flex-row justify-end">
                <IconButton icon="trash" label={`Delete ${hook.name}`} onPress={onRemove} />
              </View>
            ) : null}
          </View>
        ) : (
          <View className="pb-3">
            <Text role="footnote" tone="fg-3">{`${phaseLabel(hook.type)} hooks are edited on desktop.`}</Text>
          </View>
        )}
      </Collapsible>
    </View>
  );
}

export function HooksTab({ stage, set, graph, isAdmin }: TabProps): React.ReactElement {
  const hooks = stage.hooks;
  const add = (): void => {
    const id = `hook_${Date.now().toString(36)}`;
    set({ ...stage, hooks: [...hooks, { id, name: 'New hook', type: 'script', phase: 'pre_run', priority: 0, enabled: true, failurePolicy: 'skip', timeoutMs: 30_000, retries: 0, config: { type: 'script', command: 'npm', args: ['run', 'lint'] } }] });
  };
  const workflowHooks = graph.workflow.hooks;
  return (
    <View className="gap-6">
      <ListSection title="Stage hooks" count={hooks.length} action={isAdmin && hooks.length < 50 ? { label: 'Add hook', onPress: add } : undefined} footer={isAdmin ? undefined : 'Adding or changing a command needs admin access.'}>
        {hooks.length === 0 ? <ListRow kind="info" title="No stage hooks" /> : null}
        {hooks.map((h, i) => (
          <HookRow key={h.id} hook={h} index={i} isAdmin={isAdmin} onChange={(next) => set({ ...stage, hooks: hooks.map((x, j) => (j === i ? next : x)) })} onRemove={() => set({ ...stage, hooks: hooks.filter((_, j) => j !== i) })} />
        ))}
      </ListSection>
      <ListSection>
        <DesktopOnlyRow title="Compensate" subtitle={stage.compensate?.length ? `${stage.compensate.length} undo step${stage.compensate.length === 1 ? '' : 's'}` : 'Undo step if a later stage fails'} />
      </ListSection>
      <ListSection title="Workflow hooks" count={workflowHooks.length}>
        {workflowHooks.length === 0 ? <ListRow kind="info" title="No workflow hooks" /> : null}
        {workflowHooks.map((h) => (
          <ListRow key={h.id} kind="value" title={h.name} subtitle={h.phase} value={phaseLabel(h.type)} />
        ))}
      </ListSection>
    </View>
  );
}
