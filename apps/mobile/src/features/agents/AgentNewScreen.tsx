// New agent — start from (MAgentNew; `/agents/new`, a route sheet; MD-85: Continue is the footer's `lg` primary):
// Blank, Duplicate a built-in (radio rows), or Duplicate one of yours (a page of this sheet, MD-62); the scope
// (Global / Project + the project); a note naming what the editor opens with. Continue replaces the sheet with the
// full-screen editor (`/agents/create?from=…`).
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { slugifyAgentName } from '@generatorai/shared';

import { AGENTS_HREF } from '../../blocks/shell/hrefs';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { RouteSheet } from '../../ui/native/Sheet';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Select } from '../../ui/native/Select';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { modelLine, agentFacts, type AgentListItem } from './model/agentsModel';
import { useAgents, useProjectsForAgents } from './queries';

type Href = Parameters<typeof router.replace>[0];

export default function AgentNewScreen(): React.ReactElement {
  const navigation = useNavigation();
  const agents = useAgents();
  const projects = useProjectsForAgents();
  const [from, setFrom] = useState<string>('blank');
  const [page, setPage] = useState<'main' | 'yours'>('main');
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [projectId, setProjectId] = useState<string | null>(null);
  const builtIns = useMemo(() => (agents.data ?? []).filter((a) => a.scope === 'system'), [agents.data]);
  const yours = useMemo(() => (agents.data ?? []).filter((a) => a.scope !== 'system'), [agents.data]);
  const source: AgentListItem | null = from === 'blank' ? null : (agents.data ?? []).find((a) => `agent:${a.id}` === from) ?? null;
  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(AGENTS_HREF as Href);
  };
  const proceed = (): void => {
    const q = new URLSearchParams({ from, scope, ...(scope === 'project' && projectId ? { projectId } : {}) });
    router.replace(`/agents/create?${q}` as Href);
  };
  const projectName = (projects.data ?? []).find((p) => p.id === projectId)?.name;
  const note = source ? `Opens the editor as “${source.name} copy”, slug ${slugifyAgentName(`${source.name} copy`)}.` : 'Opens a blank editor: write the instructions, pick the capabilities.';
  const row = (a: AgentListItem) => (
    <ListRow
      key={a.id}
      kind="radio"
      icon="agents"
      title={a.name}
      subtitle={[modelLine(a.runtime), ...agentFacts(a).filter((f) => f !== 'read-only')].filter(Boolean).join(' · ') || a.description}
      selected={from === `agent:${a.id}`}
      onPress={() => setFrom(`agent:${a.id}`)}
      testID={`agent-new-from-${a.slug}`}
    />
  );

  if (page === 'yours') {
    return (
      <RouteSheet title="Your agents" back={{ label: 'New agent', onPress: () => setPage('main') }} onDismiss={close} scrollable navigation={navigation as never}>
        <ListSection>{yours.map(row)}</ListSection>
      </RouteSheet>
    );
  }
  return (
    <RouteSheet
      title="New agent"
      onDismiss={close}
      scrollable
      navigation={navigation as never}
      footer={<Button label="Continue" variant="primary" size="lg" fullWidth disabled={scope === 'project' && !projectId} {...(scope === 'project' && !projectId ? { disabledReason: 'Choose the project.' } : {})} onPress={proceed} testID="agent-new-continue" />}
      testID="agent-new"
    >
      <View className="gap-4">
        <ListSection title="Start from">
          <ListRow kind="radio" icon="plus" title="Blank agent" subtitle="Write instructions, pick capabilities" selected={from === 'blank'} onPress={() => setFrom('blank')} testID="agent-new-blank" />
        </ListSection>
        {agents.isLoading ? <Skeleton preset="list" count={2} /> : null}
        {builtIns.length ? <ListSection title="Duplicate a built-in" footer="Built-ins are read-only.">{builtIns.map(row)}</ListSection> : null}
        {yours.length ? (
          <ListSection>
            <ListRow kind="navigation" icon="copy" title="Duplicate one of yours…" value={source && source.scope !== 'system' ? source.name : String(yours.length)} onPress={() => setPage('yours')} testID="agent-new-yours" />
          </ListSection>
        ) : null}
        <View className="gap-2 px-4">
          <SegmentedControl<'global' | 'project'>
            accessibilityLabel="Scope"
            value={scope}
            onValueChange={setScope}
            segments={[
              { value: 'global', label: 'Global', icon: 'link' },
              { value: 'project', label: 'Project', icon: 'folder-open' },
            ]}
            fullWidth
            testID="agent-new-scope"
          />
          {scope === 'project' ? (
            <Select
              label="Project"
              value={projectId}
              placeholder="Choose a project"
              options={(projects.data ?? []).filter((p) => p.status !== 'archived').map((p) => ({ value: p.id, label: p.name }))}
              onValueChange={setProjectId}
              searchable={(projects.data?.length ?? 0) > 20}
              presentation="field"
              testID="agent-new-project"
            />
          ) : null}
          <Callout
            tone="info"
            title={scope === 'project' ? `Only available in ${projectName ?? 'the project'}. A project agent shadows a Global one with the same slug.` : 'Available in every project.'}
          />
          <Callout tone="info" title={note} />
        </View>
      </View>
    </RouteSheet>
  );
}
