// The list builder (MBuilderList, MBuilderGraph, MBuilderLoop, MWorkflowValidate, MWorkflowAgentDraft;
// `/workflows/[id]/edit`, a full-screen modal; MD-04, MD-85; M8-05). Header: Cancel / "Edit workflow" / Save (text,
// MD-85; the dirty guard asks before Cancel throws edits away). Under it: List / Graph, the neutral version chip
// (and "Agent draft"), "Unsaved changes" / "Saved", undo, redo, and More: Workflow settings (M8-07), Version history. An agent's draft opens with its
// banner (who drafted it, what it replaces, risk chips — neutral, MD-25 —, what changed, View diff · Discard ·
// Publish, the filled one while it shows). List: the top-level stages as cards — reorder only inside a linear chain
// (MD-04; the drag handle, or Move up / Move down in the menu and as accessibility actions), a loop card with its
// body, the edges a phone does not edit as read-only callouts; a card opens its stage editor (M8-06). Graph: MB-35
// read-only; a node opens its stage editor. Bottom toolbar: Add stage (after the selected one), Validate (MB-37 in a sheet), Publish vN,
// and Run / Test run (the filled one, MD-22 — secondary while the agent-draft banner shows). Save is a whole-graph
// save against the revision the draft started from; a 409 says someone else saved and offers theirs or yours.
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { riskFlags, type RiskFlag, type StageSpec } from '@generatorai/workflow-spec';

import { RunGraph } from '../../../blocks/RunGraph';
import { WORKFLOWS_HREF, addStageHref, builderValidateHref, loopSettingsHref, runSheetHref, stageEditorHref, workflowHref, workflowSettingsHref, workflowVersionsHref } from '../../../blocks/shell/hrefs';
import { errorsByStage } from '../../../blocks/ValidationList';
import { BottomToolbar } from '../../../ui/layout/BottomToolbar';
import { FullScreenEditor } from '../../../ui/layout/FullScreenEditor';
import { ReorderList } from '../../../ui/layout/ReorderList';
import { errorText } from '../../../ui/lib/format';
import { confirm } from '../../../ui/native/AlertDialog';
import { ContextMenu } from '../../../ui/native/ContextMenu';
import { Menu } from '../../../ui/native/Menu';
import type { MenuEntry } from '../../../ui/native/Menu/Menu.types';
import { SegmentedControl } from '../../../ui/native/SegmentedControl';
import { haptic } from '../../../ui/platform/haptics';
import { overflowIcon } from '../../../ui/platform/overflow';
import { Badge } from '../../../ui/primitives/Badge';
import { Button } from '../../../ui/primitives/Button';
import { Callout } from '../../../ui/primitives/Callout';
import { EmptyState } from '../../../ui/primitives/EmptyState';
import { ErrorState } from '../../../ui/primitives/ErrorState';
import { Icon } from '../../../ui/primitives/Icon';
import { IconButton } from '../../../ui/primitives/IconButton';
import { Pressable } from '../../../ui/primitives/Pressable';
import { Skeleton } from '../../../ui/primitives/Skeleton';
import { Text } from '../../../ui/primitives/Text';
import { toast } from '../../../ui/primitives/Toast';
import { canMove, deleteStage, diffLine, duplicateStage, edgeCallouts, graphDiff, linearChains, moveStage, nudge, topLevelOrder } from '../model/builderModel';
import { versionChip } from '../model/workflowsModel';
import { conflictRecord, useBuilderWrites, useDefinitionVersions, useWorkflow } from '../queries';
import { KIND_ICON } from './BuilderSheets';
import { changeCount, freshErrors, isDirty, useBuilderStore } from './builderStore';
import { useBuilderDraft, useValidateDraft } from './useBuilderDraft';

type Href = Parameters<typeof router.replace>[0];
type StageMenuId = 'up' | 'down' | 'edit' | 'duplicate' | 'delete' | 'loop';

export const RISK_WORD: Record<RiskFlag, string> = {
  writes_files: 'Writes files',
  commits: 'Commits',
  pushes: 'Pushes',
  opens_pr: 'Opens a PR',
  bypass_permissions: 'Bypasses approvals',
  runs_repo_code: 'Runs repo code',
  starts_other_workflows: 'Starts other workflows',
  uses_workflow_tools: 'Uses workflow tools',
  worktree_per_item: 'Worktree per item',
  plans_stages_at_run_time: 'Plans stages at run time',
};

function stageWho(stage: StageSpec): string | null {
  if (stage.kind === 'agent') return stage.session?.agentRef?.split(':').pop() ?? null;
  if (stage.kind === 'check') return [stage.check.command, ...stage.check.args].join(' ');
  if (stage.kind === 'loop') return `Loop · max ${stage.loop.maxIterations}${stage.loop.exits[0] ? ` · until ${stage.loop.exits[0].reason}` : ''}`;
  if (stage.kind === 'map') return 'Map · per item';
  if (stage.kind === 'wait') return `Wait · ${stage.wait.type}`;
  return 'Sub-workflow';
}

function StageCard({ stage, index, selected, errors, menu, onMenu, onPress, handle, callouts, body }: { stage: StageSpec; index: number; selected: boolean; errors: number; menu: MenuEntry[]; onMenu: (id: string) => void; onPress: () => void; handle: React.ReactElement | null; callouts: ReturnType<typeof edgeCallouts>; body: StageSpec[] }): React.ReactElement {
  const approval = (stage.kind === 'agent' && Boolean(stage.approval)) || (stage.kind === 'wait' && stage.wait.type === 'approval');
  const model = stage.kind === 'agent' ? stage.session?.model : undefined;
  return (
    <View className="gap-1 px-gutter pb-1.5">
      <ContextMenu items={menu} onSelect={onMenu}>
        <Pressable
          onPress={onPress}
          frame="none"
          accessibilityRole="button"
          accessibilityLabel={`${index + 1}. ${stage.name}, ${stage.key}${errors ? `, ${errors} error${errors === 1 ? '' : 's'}` : ''}`}
          accessibilityState={{ selected }}
          className={selected ? 'rounded-card border border-fg bg-raised' : errors ? 'rounded-card border border-err bg-raised' : 'rounded-card border border-line-soft bg-raised'}
          testID={`builder-stage-${stage.key}`}
        >
          <View className="min-h-row-2 flex-row items-center gap-3 py-2.5 ps-3 pe-1">
            <Text role="monoSm" tone="fg-3">
              {index + 1}
            </Text>
            <Icon concept={KIND_ICON[stage.kind]} size={16} tone="fg-2" />
            <View className="flex-1 gap-0.5">
              <View className="flex-row flex-wrap items-center gap-1.5">
                <Text role="body" weight={600} numberOfLines={1} className="shrink">
                  {stage.name}
                </Text>
                {approval ? <Badge label="Approval" icon="hand" size="sm" /> : null}
                {errors ? <Badge label={String(errors)} icon="status-failed" size="sm" /> : null}
              </View>
              <View className="flex-row items-center gap-1.5">
                <Text role="monoSm" tone="fg-2" numberOfLines={1}>
                  {stage.key}
                </Text>
                {stageWho(stage) ? (
                  <Text role="footnote" tone="fg-3" numberOfLines={1} className="shrink">
                    {`· ${stageWho(stage)}`}
                  </Text>
                ) : null}
                <View className="flex-1" />
                {model ? (
                  <Text role="monoSm" tone="fg-3" numberOfLines={1}>
                    {model}
                  </Text>
                ) : null}
              </View>
            </View>
            {handle}
          </View>
          {body.length ? (
            <View className="gap-1 pb-2.5 pe-3 ps-9">
              {body.map((b, i) => (
                <View key={b.key} className="flex-row items-center gap-2 rounded-control bg-sunken px-3 py-2">
                  <Text role="monoSm" tone="fg-3">
                    {i + 1}
                  </Text>
                  <Icon concept={KIND_ICON[b.kind]} size={14} tone="fg-3" />
                  <Text role="subhead" numberOfLines={1} className="shrink">
                    {b.name}
                  </Text>
                  <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
                    {b.key}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Pressable>
      </ContextMenu>
      {callouts.map((c, i) => (
        <View key={i} className="ms-6 flex-row items-center gap-1.5 self-start rounded-control border border-line-soft px-2 py-1">
          <Icon concept={c.dashed ? 'branch' : 'forward'} size={12} tone="fg-3" />
          <Text role="footnote" tone="fg-2" numberOfLines={1}>{`→ ${c.to}`}</Text>
          <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
            {c.words}
          </Text>
        </View>
      ))}
    </View>
  );
}

function AgentDraftBanner({ id, onPublish, onDiscard, publishing }: { id: string; onPublish: () => void; onDiscard: () => void; publishing: boolean }): React.ReactElement | null {
  const draft = useBuilderStore((s) => s.drafts[id]);
  const replaces = useWorkflow(draft?.base.authoredBy?.replacesWorkflowId ?? '');
  if (!draft?.base.authoredBy) return null;
  const by = draft.base.authoredBy;
  const flags = riskFlags(draft.graph);
  const diff = replaces.data ? graphDiff(replaces.data.graph, draft.graph) : null;
  const who = by.kind === 'chat' ? 'an agent in a chat' : by.kind === 'orchestrator' ? 'the orchestrator' : by.kind === 'stage' ? 'a workflow stage' : (by.clientName ?? 'an external agent');
  return (
    <View className="mx-gutter mb-2 gap-2 rounded-card-lg border border-line bg-raised p-3" testID="builder-agent-draft">
      <View className="flex-row items-start gap-2">
        <Icon concept="wand" size={16} tone="fg-2" />
        <Text role="footnote" className="flex-1">
          {`Drafted by ${who}${replaces.data ? ` · replaces ${replaces.data.graph.workflow.name}` : ''}`}
        </Text>
      </View>
      {flags.length ? (
        <View className="flex-row flex-wrap gap-1.5">
          {flags.map((f) => (
            <Badge key={f} label={RISK_WORD[f]} tone="outline" size="sm" />
          ))}
        </View>
      ) : null}
      {diff ? (
        <Text role="footnote" tone="fg-3">
          {diffLine(diff)}
        </Text>
      ) : null}
      <View className="flex-row items-center gap-2">
        <Button label="Versions" variant="ghost" size="sm" onPress={() => router.push(workflowVersionsHref(id) as Href)} />
        <View className="flex-1" />
        <Button label="Discard" size="sm" onPress={onDiscard} testID="builder-draft-discard" />
        <Button label="Publish" variant="primary" size="sm" loading={publishing} onPress={onPublish} testID="builder-draft-publish" />
      </View>
    </View>
  );
}

export default function BuilderScreen(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { draft, query: workflow } = useBuilderDraft(id);
  const versions = useDefinitionVersions(id);
  const writes = useBuilderWrites(id);
  const { validate } = useValidateDraft(id);
  const store = useBuilderStore.getState;
  const [busy, setBusy] = useState<'save' | 'publish' | 'run' | null>(null);

  const graph = draft?.graph;
  const order = useMemo(() => (graph ? topLevelOrder(graph) : []), [graph]);
  const chains = useMemo(() => (graph ? linearChains(graph) : new Map<string, number | null>()), [graph]);
  const issues = draft?.validation?.issues;
  const errors = useMemo(() => errorsByStage(issues ?? [], (graph?.stages ?? []).map((s) => s.key)), [issues, graph]);
  const dirty = isDirty(draft);
  const record = draft?.base;
  const chip = record ? versionChip(record, versions.data) : null;
  const nextVersion = (versions.data ?? []).filter((v) => v.kind === 'published').reduce((m, v) => Math.max(m, v.version), 0) + 1;
  const agentDraft = Boolean(record?.authoredBy && record.status === 'draft');
  const blocked = freshErrors(draft);

  // The draft lives while the builder group does: leaving it (Cancel, Back after the dirty guard, Run) drops it.
  useEffect(() => () => useBuilderStore.getState().close(id), [id]);
  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(workflowHref(id) as Href);
  };
  const edit = (change: Parameters<ReturnType<typeof store>['edit']>[1]): void => store().edit(id, change);

  /** Save when dirty; resolves with the saved (or unchanged) record, null when the save did not happen. */
  const save = async (): Promise<boolean> => {
    const d = store().drafts[id];
    if (!d || !isDirty(d)) return true;
    try {
      const saved = await writes.save(d.graph, d.base.revision);
      store().rebase(saved, false);
      haptic('success');
      return true;
    } catch (e) {
      const current = conflictRecord(e);
      if (current) {
        const keep = await confirm({ title: 'Saved elsewhere', message: `Someone saved this workflow (revision ${current.revision}) while you edited. Keep your version and overwrite theirs, or load theirs and drop your edits?`, confirmLabel: 'Keep mine', cancelLabel: 'Load theirs' });
        store().rebase(current, keep);
        if (keep) return save();
        return false;
      }
      toast({ kind: 'error', message: errorText(e) });
      return false;
    }
  };
  const run = async (key: 'save' | 'publish' | 'run', job: () => Promise<void>): Promise<void> => {
    setBusy(key);
    try {
      await job();
    } finally {
      setBusy(null);
    }
  };
  const showValidation = (): void => router.push(builderValidateHref(id) as Href);
  const publish = (): void =>
    void run('publish', async () => {
      if (!(await save())) return;
      const issues = await validate();
      if (issues?.some((i) => i.severity === 'error')) {
        toast({ kind: 'error', message: 'Fix the errors before publishing.' });
        showValidation();
        return;
      }
      try {
        const published = await writes.publish();
        store().rebase(published, false);
        haptic('success');
        toast({ kind: 'background', message: `Published ${published.graph.workflow.name}` });
      } catch (e) {
        toast({ kind: 'error', message: errorText(e) });
      }
    });
  const runIt = (): void =>
    void run('run', async () => {
      if (!(await save())) return;
      close();
      router.push(runSheetHref(id) as Href);
    });
  const discard = (): void =>
    void confirm({ title: 'Discard this draft?', message: 'The agent’s draft is deleted. The workflow it replaces is not touched.', confirmLabel: 'Discard draft', icon: 'trash' }).then((ok) => {
      if (!ok) return;
      writes
        .discard()
        .then(() => {
          router.dismissTo(WORKFLOWS_HREF as Href);
        })
        .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
    });
  /** A card or a node opens its stage editor (M8-06) and becomes the selection Add stage inserts after. */
  const openStage = (key: string): void => {
    store().select(id, key);
    router.push(stageEditorHref(id, key) as Href);
  };
  const addStage = (): void => router.push(addStageHref(id, store().drafts[id]?.selected) as Href);
  const stageMenu = (stage: StageSpec, index: number): MenuEntry[] => [
    ...(canMove(order, chains, index, index - 1) ? [{ id: 'up', label: 'Move up', icon: 'chevron-up' as const }] : []),
    ...(canMove(order, chains, index, index + 1) ? [{ id: 'down', label: 'Move down', icon: 'chevron-down' as const }] : []),
    { type: 'separator' },
    { id: 'edit', label: 'Edit stage', icon: 'edit' },
    ...(stage.kind === 'loop' ? [{ id: 'loop', label: 'Loop settings', icon: 'repeat' as const }] : []),
    { type: 'separator' },
    { id: 'duplicate', label: 'Duplicate', icon: 'copy' },
    { type: 'separator' },
    { id: 'delete', label: 'Delete…', icon: 'trash', destructive: true },
  ];
  const onStageMenu = (stage: StageSpec, mid: StageMenuId): void => {
    switch (mid) {
      case 'up':
      case 'down':
        edit((g) => nudge(g, stage.key, mid === 'up' ? -1 : 1));
        return;
      case 'edit':
        openStage(stage.key);
        return;
      case 'loop':
        router.push(loopSettingsHref(id, stage.key) as Href);
        return;
      case 'duplicate': {
        let key = stage.key;
        edit((g) => {
          const r = duplicateStage(g, stage.key);
          key = r.key;
          return r.graph;
        });
        store().select(id, key);
        return;
      }
      case 'delete': {
        const before = store().drafts[id]?.graph;
        edit((g) => deleteStage(g, stage.key));
        haptic('warning');
        toast({ kind: 'undo', message: `Deleted ${stage.name}`, action: { label: 'Undo', onPress: () => before && edit(() => before) } });
      }
    }
  };

  if (workflow.isLoading || (!draft && workflow.data)) {
    return (
      <FullScreenEditor title="Edit workflow" onCancel={close} dirty={false} navigation={navigation as never} testID="builder">
        <View>
          <Skeleton preset="list" count={5} />
        </View>
      </FullScreenEditor>
    );
  }
  if (workflow.isError || !draft || !graph) {
    return (
      <FullScreenEditor title="Edit workflow" onCancel={close} dirty={false} navigation={navigation as never} testID="builder">
        <ErrorState title="Couldn't load this workflow" error={workflow.error} onRetry={() => void workflow.refetch()} />
      </FullScreenEditor>
    );
  }

  // Two rows (phone width): the view switch at its own width with undo / redo / More, then the version chip and the
  // save state, which truncates rather than squeezing the switch.
  const toolbar = (
    <View className="gap-1 px-gutter pb-2">
      <View className="flex-row items-center gap-1">
        <View className="shrink-0">
          <SegmentedControl<'list' | 'graph'>
            accessibilityLabel="Builder view"
            value={draft.view}
            onValueChange={(v) => store().setView(id, v)}
            segments={[
              { value: 'list', label: 'List' },
              { value: 'graph', label: 'Graph' },
            ]}
            testID="builder-view"
          />
        </View>
        <View className="flex-1" />
        <IconButton icon="undo" label="Undo" size="sm" disabled={!draft.past.length} onPress={() => store().undo(id)} testID="builder-undo" />
        <IconButton icon="redo" label="Redo" size="sm" disabled={!draft.future.length} onPress={() => store().redo(id)} testID="builder-redo" />
        <Menu
          accessibilityLabel="More builder actions"
          items={[
            { id: 'settings', label: 'Workflow settings', icon: 'settings', testID: 'builder-settings' },
            { id: 'versions', label: 'Version history', icon: 'history', testID: 'builder-versions' },
          ]}
          onSelect={(mid) => router.push((mid === 'settings' ? workflowSettingsHref(id) : workflowVersionsHref(id)) as Href)}
          trigger={<IconButton icon={overflowIcon} label="More builder actions" size="sm" onPress={() => undefined} testID="builder-more" />}
        />
      </View>
      <View className="flex-row items-center gap-2">
        {chip ? <Badge label={chip.label} {...(chip.suffix && record?.status === 'published' ? { suffix: chip.suffix } : {})} size="sm" /> : null}
        {agentDraft ? <Badge label="Agent draft" icon="wand" size="sm" /> : null}
        <Text role="footnote" tone="fg-3" numberOfLines={1} className="flex-1" testID="builder-save-state">
          {dirty ? '● Unsaved changes' : 'Saved'}
        </Text>
      </View>
    </View>
  );

  const notices = (
    <View>
      {record?.needsAttention.length ? (
        <View className="px-gutter pb-2">
          <Callout tone="warn" title="Needs attention" body={record.needsAttention.join('\n')} />
        </View>
      ) : null}
      {agentDraft ? <AgentDraftBanner id={id} onPublish={publish} onDiscard={discard} publishing={busy === 'publish'} /> : null}
    </View>
  );

  // Bottom toolbar at phone width: Add stage and Validate are the icon capsule (named for assistive tech), Publish a
  // text button, Run / Test run the filled primary. The agent draft's banner carries the filled Publish; Run steps
  // back to secondary there (MD-22: one filled action). It pays its own bottom inset, so it is the fixed body's last
  // child rather than the editor's sticky bar (which would pay it again).
  const runAction = { label: record?.status === 'draft' ? 'Test run' : 'Run', icon: 'play' as const, onPress: runIt, loading: busy === 'run', disabled: busy !== null || blocked, testID: 'builder-run' };
  return (
    <FullScreenEditor
      title="Edit workflow"
      primary={{ label: 'Save', onPress: () => void run('save', async () => void (await save())), disabled: !dirty || busy !== null, loading: busy === 'save' }}
      onCancel={close}
      dirty={dirty}
      dirtyCount={changeCount(draft)}
      navigation={navigation as never}
      body="fixed"
      testID="builder"
    >
      {toolbar}
      {draft.view === 'graph' ? (
        <View className="flex-1 px-gutter pb-2">
          {graph.stages.length ? (
            <RunGraph
              variant="canvas"
              graph={graph}
              onNodePress={openStage}
              onList={() => store().setView(id, 'list')}
              testID="builder-graph"
            />
          ) : (
            <EmptyState copyKey="builderEmpty" />
          )}
        </View>
      ) : order.length === 0 ? (
        <View className="flex-1 px-gutter">
          {notices}
          <EmptyState copyKey="builderEmpty" action={{ label: 'Add stage', icon: 'plus', onPress: addStage }} />
        </View>
      ) : (
        <View className="flex-1">
          <ReorderList
            data={order}
            keyExtractor={(s) => s.key}
            itemLabel={(s) => s.name}
            editing
            canMove={(from, to) => canMove(order, chains, from, to)}
            onMove={(key, to) => edit((g) => moveStage(g, key, to))}
            header={notices}
            footer={<View className="h-6" />}
            renderItem={(stage, handle) => {
              const index = order.indexOf(stage);
              return (
                <StageCard
                  stage={stage}
                  index={index}
                  selected={draft.selected === stage.key}
                  errors={errors.get(stage.key) ?? 0}
                  menu={stageMenu(stage, index)}
                  onMenu={(mid) => onStageMenu(stage, mid as StageMenuId)}
                  onPress={() => openStage(stage.key)}
                  handle={chains.get(stage.key) !== null ? handle : null}
                  callouts={edgeCallouts(graph, stage.key)}
                  body={graph.stages.filter((s) => s.parentKey === stage.key)}
                />
              );
            }}
            testID="builder-list"
          />
        </View>
      )}
      <BottomToolbar
        nav={[
          { icon: 'plus', label: 'Add stage', onPress: addStage, testID: 'builder-add-stage' },
          { icon: 'check', label: 'Validate', onPress: showValidation, testID: 'builder-validate' },
        ]}
        actions={agentDraft ? [runAction] : [{ label: record?.status === 'draft' && !record.currentVersionId ? 'Publish' : `Publish v${nextVersion}`, onPress: publish, loading: busy === 'publish', disabled: busy !== null || blocked || (!dirty && !record?.hasUnpublishedChanges && record?.status === 'published'), testID: 'builder-publish' }]}
        {...(agentDraft ? {} : { primary: runAction })}
        testID="builder-toolbar"
      />
    </FullScreenEditor>
  );
}
