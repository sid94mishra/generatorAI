// Session tab (MStageModel): the agent (optional; "Customize capabilities" opens the Tools tab), Model · from the
// agent or the workflow, Provider, Reasoning effort, Context window, Agent mode, Max turns (only here), Permission
// (inherit or a mode; Bypass and Don't ask need admin), Session reuse and Session group. Every row left at its
// default inherits (the stage's `session` is a partial merged over the workflow's).
import React from 'react';
import { View } from 'react-native';
import { PERMISSION_MODES, type PermissionMode, type SessionSpec } from '@generatorai/workflow-spec';

import { useModelPickerCatalog } from '../../../blocks/TurnSheet';
import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { Callout } from '../../../ui/primitives/Callout';
import { Input } from '../../../ui/primitives/Input';
import { useSelectableAgents } from '../queries';
import type { TabProps } from './fields';
import { harnessProviderLabel } from '@generatorai/shared';
import { effortChoices } from '@generatorai/client-core';

const INHERIT = '';
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const EFFORT_LABEL: Record<string, string> = { xhigh: 'Extra high' };
const PERMISSION_LABEL: Record<PermissionMode, string> = { default: 'Ask', acceptEdits: 'Accept edits', plan: 'Plan', bypassPermissions: 'Bypass', dontAsk: "Don't ask" };

export function SessionTab({ stage, set, graph, isAdmin, onCapabilities }: TabProps & { onCapabilities: () => void }): React.ReactElement {
  const agents = useSelectableAgents(graph.workflow.projectId ?? null);
  const catalog = useModelPickerCatalog();
  const s = stage.session ?? {};
  const wf = graph.workflow.session;
  const setSession = (patch: Partial<SessionSpec>): void => {
    const next = { ...s, ...patch };
    for (const k of Object.keys(next) as (keyof SessionSpec)[]) if (next[k] === undefined) delete next[k];
    set({ ...stage, session: Object.keys(next).length ? next : undefined });
  };
  const agent = (agents.data ?? []).find((a) => (a as { ref?: string }).ref === s.agentRef);
  const models = catalog.catalog?.models ?? [];
  const modelFrom = s.agentRef ? 'from agent' : wf.model ? 'from workflow' : 'server default';
  const overrides = s.agentOverrides;
  const capCount = (overrides?.addSkillIds?.length ?? 0) + (overrides?.addMcpServerIds?.length ?? 0);
  const permission = s.permissionMode ?? INHERIT;
  const permissionOptions = [{ value: INHERIT, label: `Inherit workflow${wf.permissionMode ? ` · ${PERMISSION_LABEL[wf.permissionMode]}` : ''}` }, ...PERMISSION_MODES.map((m) => ({ value: m, label: PERMISSION_LABEL[m], ...((m === 'bypassPermissions' || m === 'dontAsk') && !isAdmin ? { disabled: true, description: 'Needs admin access' } : {}) }))];
  const effective = (s.permissionMode ?? wf.permissionMode) as PermissionMode | undefined;

  return (
    <View className="gap-6">
      <ListSection>
        <ListRow
          kind="picker"
          title="Agent (optional)"
          icon="agents"
          picker={{ value: s.agentRef ?? INHERIT, options: [{ value: INHERIT, label: wf.agentRef ? `Workflow's · ${wf.agentRef}` : 'None' }, ...(agents.data ?? []).map((a) => ({ value: (a as { ref?: string }).ref ?? a.id, label: a.name, description: (a as { ref?: string }).ref }))], onValueChange: (agentRef) => setSession({ agentRef: agentRef || undefined }), searchable: (agents.data?.length ?? 0) > 12, testID: 'stage-agent' }}
        />
        <ListRow kind="navigation" title="Customize capabilities" icon="tool" value={capCount ? `${capCount} added` : agent ? 'From agent' : undefined} onPress={onCapabilities} testID="stage-capabilities" />
      </ListSection>
      <ListSection>
        <ListRow kind="picker" title={`Model · ${modelFrom}`} icon="model" picker={{ value: s.model ?? INHERIT, options: [{ value: INHERIT, label: cap(modelFrom) }, ...models.map((m) => ({ value: m.id, label: m.name, description: harnessProviderLabel(m.provider) }))], onValueChange: (model) => setSession({ model: model || undefined }), searchable: models.length > 12, testID: 'stage-model' }} />
        <ListRow kind="picker" title="Provider" picker={{ value: s.harnessType ?? INHERIT, options: [{ value: INHERIT, label: 'By model' }, ...(catalog.catalog?.providers ?? []).map((p) => ({ value: p.type, label: p.label }))], onValueChange: (h) => setSession({ harnessType: (h || undefined) as SessionSpec['harnessType'] }), testID: 'stage-provider' }} />
        <ListRow kind="picker" title="Reasoning effort" icon="think" picker={{ value: s.reasoningEffort ?? INHERIT, options: [{ value: INHERIT, label: 'Default' }, ...effortChoices(s.model ? models.find((m) => m.id === s.model)?.source : undefined).map((e) => ({ value: e, label: EFFORT_LABEL[e] ?? cap(e) }))], onValueChange: (e) => setSession({ reasoningEffort: (e || undefined) as SessionSpec['reasoningEffort'] }), testID: 'stage-effort' }} />
        <ListRow kind="segmented" title="Context window" segmented={{ value: s.contextTier ?? 'default', onValueChange: (t) => setSession({ contextTier: t === 'default' ? undefined : (t as SessionSpec['contextTier']) }), segments: [{ value: 'default', label: 'Standard' }, { value: 'long_context', label: 'Long' }] }} />
      </ListSection>
      <ListSection>
        <ListRow kind="segmented" title="Agent mode" segmented={{ value: s.defaultAgentMode ?? INHERIT, onValueChange: (m) => setSession({ defaultAgentMode: (m || undefined) as SessionSpec['defaultAgentMode'] }), segments: [{ value: INHERIT, label: 'Inherit' }, { value: 'auto', label: 'Auto' }, { value: 'plan', label: 'Plan' }] }} />
        <ListRow kind="stepper" title="Max turns" stepper={{ value: s.maxTurns ?? 0, onValueChange: (n) => setSession({ maxTurns: n > 0 ? n : undefined }), min: 0, max: 1000, step: 5, format: (v) => (v ? String(v) : 'Inherit'), testID: 'stage-max-turns' }} />
        <ListRow kind="picker" title="Permission" icon="shield" picker={{ value: permission, options: permissionOptions, onValueChange: (m) => setSession({ permissionMode: (m || undefined) as PermissionMode | undefined }), testID: 'stage-permission' }} />
      </ListSection>
      {effective === 'acceptEdits' ? <Callout tone="warn" form="banner" title="Accept edits still asks before shell commands." /> : null}
      {effective === 'bypassPermissions' ? <Callout tone="warn" form="banner" title="Bypass runs every tool without asking." /> : null}
      <ListSection>
        <ListRow kind="segmented" title="Session reuse" segmented={{ value: stage.sessionReuse, onValueChange: (r) => set({ ...stage, sessionReuse: r as 'fresh' | 'continue' }), segments: [{ value: 'fresh', label: 'Fresh' }, { value: 'continue', label: 'Continue' }] }} />
        <Input label="Session group" value={stage.sessionGroup ?? ''} onChangeText={(g) => set({ ...stage, sessionGroup: g.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 48) || undefined })} kind="mono" placeholder="Optional" testID="stage-session-group" />
      </ListSection>
    </View>
  );
}
