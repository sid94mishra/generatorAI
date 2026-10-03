// The stage editor (`/workflows/[id]/edit/stages/[stageKey]?tab=`; MStagePrompt … MStageHooks; M8-06): a
// full-screen editor over the builder — Cancel · the stage's name · Save (MD-85: Save writes the stage into the
// builder draft; the builder's Save commits the workflow) — with the six tabs as a scrollable tab row (MDF-83):
// Prompt, Session, Tools, Output, Policy, Hooks. Simple fields only; complex editors say "Edit on desktop" (MD-04).
// A non-agent stage edits its name, key and description here; its kind's settings are desktop editors (a loop
// has its Loop settings sheet).
import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import type { AgentStage, StageSpec } from '@generatorai/workflow-spec';

import { loopSettingsHref } from '../../../blocks/shell/hrefs';
import { useGrantedScopes } from '../../../services/auth/useCapability';
import { FullScreenEditor } from '../../../ui/layout/FullScreenEditor';
import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { TabRow } from '../../../ui/layout/TabRow';
import { Callout } from '../../../ui/primitives/Callout';
import { ErrorState } from '../../../ui/primitives/ErrorState';
import { Skeleton } from '../../../ui/primitives/Skeleton';
import { KIND_NAME } from '../model/builderModel';
import { useBuilderStore } from '../builder/builderStore';
import { useBuilderDraft } from '../builder/useBuilderDraft';
import { useCapabilityCatalog } from '../queries';
import { HooksTab } from './HooksTab';
import { OutputTab } from './OutputTab';
import { PolicyTab } from './PolicyTab';
import { GeneralFields, PromptTab } from './PromptTab';
import { SessionTab } from './SessionTab';
import { ToolsTab, useAgentCapabilities } from './ToolsTab';
import { STAGE_TABS, capabilityRows, parseStageTab, platformTools, renameStageKey, tabCounts, type StageTab } from './stageEditorModel';

type Href = Parameters<typeof router.push>[0];

const TAB_LABEL: Record<StageTab, string> = { prompt: 'Prompt', session: 'Session', tools: 'Tools', output: 'Output', policy: 'Policy', hooks: 'Hooks' };
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;

const close = (): void => {
  if (router.canGoBack()) router.back();
};

function AgentTabs({ workflowId, stage, set, keyLocked, isAdmin, tab, onTab }: { workflowId: string; stage: AgentStage; set: (s: AgentStage) => void; keyLocked: boolean; isAdmin: boolean; tab: StageTab; onTab: (t: StageTab) => void }): React.ReactElement | null {
  const graph = useBuilderStore((s) => s.drafts[workflowId]?.graph);
  if (!graph) return null;
  const props = { workflowId, stage, set, graph, isAdmin };
  switch (tab) {
    case 'prompt':
      return <PromptTab {...props} keyLocked={keyLocked} />;
    case 'session':
      return <SessionTab {...props} onCapabilities={() => onTab('tools')} />;
    case 'tools':
      return <ToolsTab {...props} />;
    case 'output':
      return <OutputTab {...props} />;
    case 'policy':
      return <PolicyTab {...props} />;
    case 'hooks':
      return <HooksTab {...props} />;
  }
}

export default function StageEditorScreen(): React.ReactElement {
  const { id = '', stageKey = '', tab } = useLocalSearchParams<{ id: string; stageKey: string; tab?: string }>();
  const navigation = useNavigation();
  const { draft, query } = useBuilderDraft(id);
  const original = draft?.graph.stages.find((s) => s.key === stageKey);
  const graph = draft?.graph;
  if (!original || !graph) {
    return (
      <FullScreenEditor title="Stage" onCancel={close} dirty={false} navigation={navigation as never} testID="stage-editor">
        {query.isError ? <ErrorState title="Couldn't load this workflow" error={query.error} onRetry={() => void query.refetch()} /> : draft ? <Callout tone="warn" title="This stage is no longer in the draft." /> : <Skeleton preset="list" count={5} />}
      </FullScreenEditor>
    );
  }
  return <StageEditorBody id={id} stageKey={stageKey} original={original} initialTab={parseStageTab(tab)} />;
}

function StageEditorBody({ id, stageKey, original, initialTab }: { id: string; stageKey: string; original: StageSpec; initialTab: StageTab }): React.ReactElement {
  const navigation = useNavigation();
  const isAdmin = useGrantedScopes().includes('admin:settings');
  const draft = useBuilderStore((s) => s.drafts[id]);
  const graph = draft!.graph;
  const [stage, setStage] = useState<StageSpec>(original);
  const [active, setActive] = useState<StageTab>(initialTab);

  const agent = stage.kind === 'agent' ? stage : null;
  const caps = useAgentCapabilities(agent?.session?.agentRef ?? graph.workflow.session.agentRef, graph.workflow.projectId ?? null);
  const catalog = useCapabilityCatalog();
  const keyLocked = Boolean(draft?.base.graph.stages.some((s) => s.key === stageKey));
  const dirty = JSON.stringify(stage) !== JSON.stringify(original);
  const taken = new Set(graph.stages.filter((s) => s.key !== stageKey).map((s) => s.key));
  const keyError = stage.key !== stageKey ? (!KEY_PATTERN.test(stage.key) ? 'Lower snake case, starting with a letter' : taken.has(stage.key) ? 'Another stage has this key' : null) : null;
  const nameError = !stage.name.trim() ? 'A stage needs a name' : null;

  const save = (): void => {
    if (keyError || nameError) return;
    const store = useBuilderStore.getState();
    store.edit(id, (g) => {
      const renamed = renameStageKey(g, stageKey, stage.key);
      return { ...renamed, stages: renamed.stages.map((s) => (s.key === stage.key ? stage : s)) };
    });
    store.select(id, stage.key);
    close();
  };
  const selectTab = (t: StageTab): void => {
    setActive(t);
    router.setParams({ tab: t });
  };

  const counts = agent ? tabCounts(agent, platformTools(agent, caps), capabilityRows(catalog.skills, caps?.skillIds ?? [], agent.session?.agentOverrides?.addSkillIds, agent.session?.agentOverrides?.removeSkillIds).filter((r) => r.on).length, capabilityRows(catalog.mcp, caps?.mcpServerIds ?? [], agent.session?.agentOverrides?.addMcpServerIds, agent.session?.agentOverrides?.removeMcpServerIds).filter((r) => r.on).length) : {};

  return (
    <FullScreenEditor
      title={stage.name || 'Stage'}
      primary={{ label: 'Save', onPress: save, disabled: !dirty || Boolean(keyError || nameError) }}
      onCancel={close}
      dirty={dirty}
      navigation={navigation as never}
      {...(agent ? { stepper: <TabRow accessibilityLabel="Stage sections" tabs={STAGE_TABS.map((t) => ({ id: t, label: TAB_LABEL[t], ...(counts[t] ? { count: counts[t] } : {}) }))} active={active} onSelect={(t) => selectTab(t as StageTab)} testID="stage-tab" /> } : {})}
      testID="stage-editor"
    >
      {keyError || nameError ? <Callout tone="err" form="banner" title={(keyError ?? nameError)!} /> : null}
      {agent ? (
        <AgentTabs workflowId={id} stage={agent} set={setStage} keyLocked={keyLocked} isAdmin={isAdmin} tab={active} onTab={selectTab} />
      ) : (
        <View className="gap-6">
          <GeneralFields stage={stage} set={setStage} keyLocked={keyLocked} taken={taken} />
          <ListSection footer={`${KIND_NAME[stage.kind]} settings beyond these are edited on desktop.`}>
            {stage.kind === 'loop' ? <ListRow kind="navigation" title="Loop settings" icon="repeat" onPress={() => router.push(loopSettingsHref(id, stageKey) as Href)} /> : <ListRow kind="info" title={`${KIND_NAME[stage.kind]} settings`} subtitle="Edit on desktop" icon="computer" />}
            <ListRow kind="value" title="Run only when" value={stage.guard ?? 'Always'} mono={Boolean(stage.guard)} />
          </ListSection>
        </View>
      )}
    </FullScreenEditor>
  );
}
